/**
 * 刮刮乐开奖服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：接收玩家对单张票的选线，计算线和值、查奖级、发奖金、写流水。
 * 2. 不做什么：不处理刮格子逻辑（由 scratchTicketService 负责）、不校验参数（由路由层负责）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID + 票号 + 选线 key。
 * - 输出：SettleResultDto（该票的线、和值、奖级、奖金 + 下一张票号）。
 *
 * 数据流 / 状态流：
 * SELECT FOR UPDATE 锁定该票 -> 校验状态 ->
 * 读 grid_values -> 根据 lineKey 计算 lineSum ->
 * 查 ScratchPrizeConfigCache 匹配奖级 -> UPDATE settled + 奖金字段 ->
 * 如果 prize > 0：角色灵石 += prize, 写流水 -> 查找下一张未 settled 票号 -> 返回结果。
 *
 * 复用设计说明：
 * - buildLines 在 scratchTicketTypes.ts 中统一定义。
 * - 奖级查询走 ScratchPrizeConfigCache 内存缓存，不查 DB。
 * - 灵石更新和流水写入复用已有的角色/流水操作模式。
 *
 * 关键边界条件与坑点：
 * 1. 必须在事务内执行（调用方用 @Transactional 包裹）。
 * 2. lineKey 必须存在于 buildLines 结果中，否则抛错。
 * 3. 未中奖时 tierKey='none', tierName='未中奖', prize=0，仍需写 settled 标记。
 * 4. 奖金发放使用角色表的 spirit_stones 字段 += 操作。
 * 5. 后端以提交的 lineKey 为准计算开奖，不持久化 selected_line 直到开奖时才写入。
 */
import { query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { recordSpiritStones } from '../ledgerService.js';
import { scratchPrizeConfigCache } from './scratchPrizeConfigCache.js';
import { buildLines, type SettleResultDto } from './scratchTicketTypes.js';
import { BusinessError } from '../../errors/BusinessError.js';

const TICKETS_PER_DAY = 3;
const getUtcDay = (): string => new Date().toISOString().slice(0, 10);

class ScratchPrizeService {
  /**
   * 开奖：单张票选线结算。
   * 前提：该票 settled == false 且 scratch_count == max_scratch_count。
   */
  @Transactional
  async settleSingle(
    characterId: number,
    ticketNumber: number,
    lineKey: string,
  ): Promise<SettleResultDto> {
    const day = getUtcDay();

    // 1. 锁定该票
    const lockResult = await query(
      `SELECT id, ticket_number, config_key, grid_size, grid_values,
              scratch_count, max_scratch_count, settled
       FROM scratch_ticket
       WHERE character_id = $1 AND day = $2 AND ticket_number = $3
       LIMIT 1
       FOR UPDATE`,
      [characterId, day, ticketNumber],
    );

    if (lockResult.rows.length === 0) {
      throw new BusinessError(`票号 ${ticketNumber} 不存在`);
    }

    const row = lockResult.rows[0];

    // 2. 校验
    if (Boolean(row.settled)) {
      throw new BusinessError(`票号 ${ticketNumber} 已开奖`);
    }

    const scratchCount = Number(row.scratch_count);
    const maxScratchCount = Number(row.max_scratch_count);
    if (scratchCount < maxScratchCount) {
      throw new BusinessError(`票号 ${ticketNumber} 尚未刮满（已刮 ${scratchCount}/${maxScratchCount}）`);
    }

    // 3. 计算开奖
    const configKey = String(row.config_key);
    const gridSize = Number(row.grid_size);
    const gridValues: number[] = row.grid_values as number[];

    const allLines = buildLines(gridSize);
    const lineDef = allLines.find(l => l.key === lineKey);
    if (!lineDef) {
      throw new BusinessError(`线 "${lineKey}" 不存在，可选线: ${allLines.map(l => l.key).join(', ')}`);
    }

    const lineSum = lineDef.indices.reduce((sum, idx) => sum + gridValues[idx], 0);

    const prize = scratchPrizeConfigCache.lookupPrize(configKey, lineSum);
    const tierKey = prize?.tierKey ?? 'none';
    const tierName = prize?.tierName ?? '未中奖';
    const prizeAmount = prize?.prizeAmount ?? 0;

    // 4. 更新票的开奖信息（prize_amount 始终记录理论应发金额，不兑奖时仅不发）
    const allMask = (1 << gridSize) - 1;
    await query(
      `UPDATE scratch_ticket
       SET settled = true, selected_line = $1, line_sum = $2,
           prize_tier = $3, prize_amount = $4, scratched_mask = $5, status = 'settled', updated_at = now()
       WHERE id = $6`,
      [lineKey, lineSum, tierKey, prizeAmount, allMask, String(row.id)],
    );

    // 5. 如果奖金 > 0：更新角色灵石 + 写流水
    if (prizeAmount > 0) {
      await query(
        `UPDATE characters SET spirit_stones = spirit_stones + $1, updated_at = now() WHERE id = $2`,
        [prizeAmount, characterId],
      );

      const balanceAfterRow = await query(
        `SELECT spirit_stones FROM characters WHERE id = $1`,
        [characterId],
      );
      const balanceAfter = BigInt(balanceAfterRow.rows[0].spirit_stones);

      const memo = `刮刮乐开奖：第${ticketNumber}张，${tierName}`;

      await recordSpiritStones({
        characterId,
        amount: BigInt(prizeAmount),
        balanceAfter,
        bizType: 'scratch_prize',
        memo,
      });
    }

    // 6. 查找下一张未 settled 票号
    const nextResult = await query(
      `SELECT ticket_number FROM scratch_ticket
       WHERE character_id = $1 AND day = $2 AND settled = false AND ticket_number > $3
       ORDER BY ticket_number
       LIMIT 1`,
      [characterId, day, ticketNumber],
    );
    const nextTicketNumber = nextResult.rows.length > 0
      ? Number(nextResult.rows[0].ticket_number)
      : null;

    // 7. 构建返回的票数据（settled 后返回完整 grid_values，mask 全置 1）
    const ticketRevealedValues = [...gridValues];
    const ticketScratchedMask = (1 << gridSize) - 1; // 所有位都置 1
    const prizeTierName = tierKey !== 'none'
      ? (scratchPrizeConfigCache.getPrizeTiers(configKey)?.find(t => t.tierKey === tierKey)?.tierName ?? null)
      : null;

    return {
      settled: true,
      prize: prizeAmount,
      lineSum,
      tierKey,
      tierName,
      nextTicketNumber,
      ticket: {
        ticketNumber: Number(row.ticket_number),
        configKey,
        gridSize,
        scratchCount: Number(row.scratch_count),
        maxScratchCount,
        scratchedMask: ticketScratchedMask,
        revealedValues: ticketRevealedValues,
        settled: true,
        selectedLine: lineKey,
        lineSum,
        prizeTier: tierKey !== 'none' ? tierKey : null,
        prizeTierName,
        prizeAmount: prizeAmount > 0 ? prizeAmount : null,
      },
    };
  }
}

export const scratchPrizeService = new ScratchPrizeService();
