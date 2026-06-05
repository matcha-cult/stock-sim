/**
 * 月卡服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理月卡发放、回收、状态查询、每日领取。
 *    - GM 发放月卡：指定角色 + 天数，激活或续期。
 *    - GM 回收月卡：立即失效，标记为 revoked。
 *    - 玩家领取每日奖励：校验激活状态 + 今日是否已领，发放灵石。
 * 2. 不做什么：不处理灵石余额不足的购买校验（改为 GM 发放，无购买逻辑）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、发放天数（可选）。
 * - 输出：月卡状态 DTO、发放结果 DTO、回收结果 DTO、领取结果 DTO。
 *
 * 数据流 / 状态流：
 * GM 发放 → 查询 active 记录 → 有则续期，无则新建 → 更新 expiresAt → 写入流水；
 * GM 回收 → 查询 active 记录 → 标记 revoked + expiresAt = NOW() → 写入流水；
 * 每日领取 → 校验 active + expiresAt > NOW() → 校验未领取 → 发放灵石 → 写入领取记录 + 流水。
 *
 * 关键边界条件与坑点：
 * 1. 日期统一 UTC，避免时区导致跨日重复领取。
 * 2. 发放/回收/领取均使用 SELECT ... FOR UPDATE 防止并发冲突。
 * 3. 续期逻辑：已过期从当前时间算起，未过期从原到期时间累加。
 * 4. 回收幂等：对未激活角色回收不报错，直接返回 wasActive: false。
 */
import { query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import {
  updateCharacterSpiritStones,
} from '../characterService.js';
import {
  recordSpiritStones,
  type SpiritStonesLedgerBizType,
} from '../ledgerService.js';
import { monthCardConfigCache } from './monthCardConfigCache.js';
import type {
  MonthCardStatusDto,
  GrantResultDto,
  RevokeResultDto,
  ClaimResultDto,
} from './monthCardTypes.js';

// ========== DTO 构建 ==========

const buildStatusDto = (
  row: Record<string, unknown> | null,
  todayClaimed: boolean,
): MonthCardStatusDto => {
  if (!row) {
    return { isActive: false, expiresAt: null, daysRemaining: null, todayClaimed, config: null };
  }

  const expiresAt = new Date(row.expires_at as string);
  const now = new Date();

  if (expiresAt <= now) {
    return { isActive: false, expiresAt: null, daysRemaining: null, todayClaimed, config: null };
  }

  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    isActive: true,
    expiresAt: expiresAt.getTime(),
    daysRemaining,
    todayClaimed,
    config: monthCardConfigCache.getConfig(),
  };
};

// ========== 公共逻辑 ==========

const getUtcDay = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

// ========== 公开 API ==========

class MonthCardService {
  /**
   * 获取玩家月卡状态。
   */
  async getMonthCardStatus(characterId: number): Promise<MonthCardStatusDto> {
    const result = await query(
      `SELECT expires_at FROM month_card_ownership
       WHERE character_id = $1 AND status = 'active'
       ORDER BY expires_at DESC
       LIMIT 1`,
      [characterId],
    );

    const row = result.rows.length > 0 ? result.rows[0] : null;

    // 如果已过期，惰性更新状态
    if (row) {
      const expiresAt = new Date(row.expires_at as string);
      if (expiresAt <= new Date()) {
        await query(
          `UPDATE month_card_ownership SET status = 'expired', updated_at = NOW()
           WHERE character_id = $1 AND status = 'active'`,
          [characterId],
        );
      }
    }

    // 检查今日是否已领取
    const today = getUtcDay();
    const claimResult = await query(
      `SELECT id FROM month_card_daily_claim
       WHERE character_id = $1 AND claim_date = $2
       LIMIT 1`,
      [characterId, today],
    );

    const todayClaimed = claimResult.rows.length > 0;
    return buildStatusDto(row, todayClaimed);
  }

  /**
   * GM 发放月卡。
   * 仅 GM 可调用，不扣灵石。
   */
  @Transactional
  async gmGrantMonthCard(
    characterId: number,
    days?: number,
  ): Promise<GrantResultDto> {
    const config = monthCardConfigCache.getConfig();
    const durationDays = days ?? config.durationDays;

    if (durationDays <= 0) {
      return { success: false, message: '发放天数必须 > 0', expiresAt: null, daysRemaining: null, isNewGrant: false };
    }

    // 查询角色是否存在
    const charResult = await query(
      `SELECT id FROM characters WHERE id = $1`,
      [characterId],
    );
    if (charResult.rows.length === 0) {
      return { success: false, message: '角色不存在', expiresAt: null, daysRemaining: null, isNewGrant: false };
    }

    // 查询当前 active 记录（FOR UPDATE 防止并发）
    const lockResult = await query(
      `SELECT id, expires_at, status FROM month_card_ownership
       WHERE character_id = $1 AND status = 'active'
       ORDER BY expires_at DESC
       LIMIT 1
       FOR UPDATE`,
      [characterId],
    );

    const now = new Date();
    let expiresAt: Date;
    let isNewGrant: boolean;

    if (lockResult.rows.length > 0) {
      // 续期：已过期从当前时间算起，未过期从原到期时间累加
      const oldExpiresAt = new Date(lockResult.rows[0].expires_at as string);
      const baseDate = oldExpiresAt > now ? oldExpiresAt : now;
      expiresAt = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

      await query(
        `UPDATE month_card_ownership
         SET expires_at = $1, total_days_purchased = total_days_purchased + $2,
             purchase_count = purchase_count + 1, updated_at = NOW()
         WHERE id = $3`,
        [expiresAt.toISOString(), durationDays, lockResult.rows[0].id],
      );
      isNewGrant = false;
    } else {
      // 新发放
      expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      await query(
        `INSERT INTO month_card_ownership
          (character_id, expires_at, status, total_days_purchased, purchase_count, created_at, updated_at)
         VALUES ($1, $2, 'active', $3, 1, NOW(), NOW())`,
        [characterId, expiresAt.toISOString(), durationDays],
      );
      isNewGrant = true;
    }

    // 写入流水
    const ledgerBizType: SpiritStonesLedgerBizType = 'gm_grant_month_card';
    await recordSpiritStones({
      characterId,
      amount: 0n, // 发放不直接改灵石，只是激活权益
      balanceAfter: 0n, // 余额不变，流水记录用 0
      bizType: ledgerBizType,
      memo: isNewGrant ? `GM 发放月卡（${durationDays}天）` : `GM 续期月卡（+${durationDays}天）`,
    });

    const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      success: true,
      message: isNewGrant ? '月卡发放成功' : '月卡续期成功',
      expiresAt: expiresAt.getTime(),
      daysRemaining,
      isNewGrant,
    };
  }

  /**
   * GM 回收月卡。
   * 仅 GM 可调用，立即失效。
   */
  @Transactional
  async gmRevokeMonthCard(
    characterId: number,
  ): Promise<RevokeResultDto> {
    // 查询当前 active 记录
    const lockResult = await query(
      `SELECT id FROM month_card_ownership
       WHERE character_id = $1 AND status = 'active'
       LIMIT 1`,
      [characterId],
    );

    if (lockResult.rows.length === 0) {
      // 幂等：未激活直接返回
      return { success: true, message: '月卡未激活，无需回收', wasActive: false };
    }

    // 标记 revoked
    await query(
      `UPDATE month_card_ownership
       SET status = 'revoked', expires_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [lockResult.rows[0].id],
    );

    // 写入流水
    await recordSpiritStones({
      characterId,
      amount: 0n,
      balanceAfter: 0n,
      bizType: 'gm_revoke_month_card',
      memo: 'GM 回收月卡',
    });

    return { success: true, message: '月卡已回收', wasActive: true };
  }

  /**
   * 玩家领取每日奖励。
   */
  @Transactional
  async claimDailyReward(characterId: number): Promise<ClaimResultDto> {
    const config = monthCardConfigCache.getConfig();
    const today = getUtcDay();

    // 1. 校验月卡状态（FOR UPDATE）
    const lockResult = await query(
      `SELECT id, expires_at FROM month_card_ownership
       WHERE character_id = $1 AND status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [characterId],
    );

    if (lockResult.rows.length === 0) {
      return { success: false, message: '月卡未激活', rewardSpiritStones: 0, balanceAfter: 0 };
    }

    const expiresAt = new Date(lockResult.rows[0].expires_at as string);
    if (expiresAt <= new Date()) {
      // 惰性更新
      await query(
        `UPDATE month_card_ownership SET status = 'expired', updated_at = NOW()
         WHERE id = $1`,
        [lockResult.rows[0].id],
      );
      return { success: false, message: '月卡已过期', rewardSpiritStones: 0, balanceAfter: 0 };
    }

    // 2. 校验今日是否已领取
    const claimCheck = await query(
      `SELECT id FROM month_card_daily_claim
       WHERE character_id = $1 AND claim_date = $2
       LIMIT 1`,
      [characterId, today],
    );

    if (claimCheck.rows.length > 0) {
      return { success: false, message: '今日已领取', rewardSpiritStones: 0, balanceAfter: 0 };
    }

    // 3. 发放灵石
    const rewardAmount = BigInt(config.dailyRewardSpiritStones);
    const spiritResult = await updateCharacterSpiritStones(
      characterId,
      rewardAmount,
      {
        bizType: 'month_card_daily',
        memo: '月卡每日领取',
      },
    );

    if (!spiritResult.success) {
      return { success: false, message: '灵石发放失败', rewardSpiritStones: 0, balanceAfter: 0 };
    }

    // 4. 写入领取记录
    await query(
      `INSERT INTO month_card_daily_claim
        (character_id, claim_date, reward_spirit_stones, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [characterId, today, rewardAmount.toString()],
    );

    return {
      success: true,
      message: '领取成功',
      rewardSpiritStones: config.dailyRewardSpiritStones,
      balanceAfter: Number(spiritResult.newBalance),
    };
  }
}

export const monthCardService = new MonthCardService();
