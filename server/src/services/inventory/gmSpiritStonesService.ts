/**
 * GM 灵石批量调整服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：给指定玩家或全体玩家增加/减少灵石，并正确记录流水账。
 * 2. 不做什么：不修改股票持仓、不处理挂单。
 *
 * 输入 / 输出：
 * - 输入：调整目标（单人/全体）、操作方向（增/减）、数量、业务类型、备注。
 * - 输出：单人调整结果（success/remaining），全体调整结果（成功数/跳过数）。
 *
 * 数据流 / 状态流：
 * 单人 → 复用 addSpiritStones / consumeSpiritStones（内部自动记流水）
 * 全体 → withTransaction 内批量 UPDATE + 批量 recordSpiritStones
 *
 * 关键边界条件与坑点：
 * 1. 全体减少时必须跳过余额不足的玩家，不能中断整体流程。
 * 2. 全体增加时无需余额校验，但必须为每人各记一条独立流水。
 * 3. 流水记录必须在同一事务内，保证余额和流水一致性。
 */
import { withTransaction, query } from '../../config/database.js';
import {
  consumeSpiritStones,
  addSpiritStones,
} from '../inventory/shared/consume.js';
import {
  recordSpiritStones,
  type SpiritStonesLedgerBizType,
} from '../ledgerService.js';

export type GmAdjustTarget = 'single' | 'all';
export type GmAdjustOperation = 'add' | 'reduce';
export type GmAdjustBizType = Extract<SpiritStonesLedgerBizType, 'gm_compensation' | 'gm_rebate'>;

export type GmAdjustParams = {
  target: GmAdjustTarget;
  characterId?: number;
  operation: GmAdjustOperation;
  amount: number;
  bizType: GmAdjustBizType;
  memo: string;
};

export type GmSingleAdjustResult = {
  success: boolean;
  message: string;
  remaining?: number;
};

export type GmAllAdjustResult = {
  success: boolean;
  message: string;
  totalCount: number;
  successCount: number;
  skippedCount: number;
};

export type GmAdjustResult = GmSingleAdjustResult | GmAllAdjustResult;

/**
 * 查找角色基本信息（昵称 + 当前余额）。
 */
export const lookupCharacterInfo = async (
  characterId: number,
): Promise<{ characterId: number; nickname: string; spiritStones: number } | null> => {
  const result = await query<{ id: number; nickname: string; spirit_stones: string | number }>(
    `SELECT id, nickname, spirit_stones FROM characters WHERE id = $1 LIMIT 1`,
    [characterId],
  );
  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  return {
    characterId: row.id,
    nickname: row.nickname,
    spiritStones: Number(row.spirit_stones),
  };
};

/**
 * GM 调整灵石余额（单人或全体）。
 */
export const adjustSpiritStones = async (params: GmAdjustParams): Promise<GmAdjustResult> => {
  if (params.target === 'single') {
    return adjustSingle(params);
  }
  return adjustAll(params);
};

/**
 * 单人调整：复用 addSpiritStones / consumeSpiritStones。
 */
const adjustSingle = async (params: GmAdjustParams): Promise<GmSingleAdjustResult> => {
  if (!params.characterId) {
    return { success: false, message: '单人调整必须指定角色ID' };
  }
  const amount = BigInt(params.amount);
  const bizMeta = {
    bizType: params.bizType,
    memo: params.memo || undefined,
  };

  if (params.operation === 'add') {
    const result = await addSpiritStones(params.characterId, amount, bizMeta);
    if (!result.success) {
      return { success: false, message: result.message };
    }
    return {
      success: true,
      message: `已为玩家 #${params.characterId} 增加 ${params.amount} 灵石`,
      remaining: result.remaining ? Number(result.remaining) : undefined,
    };
  }

  // reduce
  const result = await consumeSpiritStones(params.characterId, amount, bizMeta);
  if (!result.success) {
    return { success: false, message: result.message };
  }
  return {
    success: true,
    message: `已从玩家 #${params.characterId} 扣除 ${params.amount} 灵石`,
    remaining: result.remaining ? Number(result.remaining) : undefined,
  };
};

/**
 * 全体调整：批量 SQL 更新 + 批量记流水。
 */
const adjustAll = async (params: GmAdjustParams): Promise<GmAllAdjustResult> => {
  return withTransaction(async () => {
    const amount = BigInt(params.amount);

    if (params.operation === 'add') {
      return await adjustAllAdd(amount, params.bizType, params.memo);
    }

    return await adjustAllReduce(amount, params.bizType, params.memo);
  });
};

/**
 * 全体增加：直接批量 UPDATE + 批量记流水。
 */
const adjustAllAdd = async (
  amount: bigint,
  bizType: SpiritStonesLedgerBizType,
  memo: string,
): Promise<GmAllAdjustResult> => {
  // 先查所有角色及其当前余额
  const charResult = await query<{ id: number; nickname: string; spirit_stones: string | number }>(
    `SELECT id, spirit_stones, nickname FROM characters`,
    [],
  );

  const rows = charResult.rows;
  const totalCount = rows.length;
  if (totalCount === 0) {
    return { success: true, message: '没有可调整的玩家', totalCount: 0, successCount: 0, skippedCount: 0 };
  }

  // 批量更新余额
  const ids = rows.map((r) => r.id);
  await query(
    `UPDATE characters SET spirit_stones = spirit_stones + $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
    [amount.toString(), ids],
  );

  // 批量记流水（每人在同一事务内独立记录）
  for (const row of rows) {
    const oldBalance = BigInt(row.spirit_stones);
    const newBalance = oldBalance + amount;
    await recordSpiritStones({
      characterId: row.id,
      amount,
      balanceAfter: newBalance,
      bizType,
      memo: memo || `GM 全体增加灵石 ${Number(amount)} 点`,
    });
  }

  return { success: true, message: `已为全体玩家增加 ${Number(amount)} 灵石`, totalCount, successCount: totalCount, skippedCount: 0 };
};

/**
 * 全体减少：过滤余额充足的角色，批量扣减 + 批量记流水。
 * 余额不足的角色跳过（不中断整体流程）。
 */
const adjustAllReduce = async (
  amount: bigint,
  bizType: SpiritStonesLedgerBizType,
  memo: string,
): Promise<GmAllAdjustResult> => {
  // 查所有角色及其当前余额
  const charResult = await query<{ id: number; nickname: string; spirit_stones: string | number }>(
    `SELECT id, spirit_stones, nickname FROM characters`,
    [],
  );

  const rows = charResult.rows;
  const totalCount = rows.length;
  if (totalCount === 0) {
    return { success: true, message: '没有可调整的玩家', totalCount: 0, successCount: 0, skippedCount: 0 };
  }

  // 过滤余额充足的角色
  const eligibleRows = rows.filter((r) => BigInt(r.spirit_stones) >= amount);
  const skippedCount = totalCount - eligibleRows.length;

  if (eligibleRows.length === 0) {
    return { success: true, message: '所有玩家余额均不足以扣除', totalCount, successCount: 0, skippedCount };
  }

  // 批量扣减（只对余额充足的角色）
  const ids = eligibleRows.map((r) => r.id);
  await query(
    `UPDATE characters SET spirit_stones = spirit_stones - $1, updated_at = NOW() WHERE id = ANY($2::int[])`,
    [amount.toString(), ids],
  );

  // 批量记流水
  for (const row of eligibleRows) {
    const oldBalance = BigInt(row.spirit_stones);
    const newBalance = oldBalance - amount;
    await recordSpiritStones({
      characterId: row.id,
      amount: -amount,
      balanceAfter: newBalance,
      bizType,
      memo: memo || `GM 全体扣除灵石 ${Number(amount)} 点`,
    });
  }

  return { success: true, message: `已为全体玩家扣除 ${Number(amount)} 灵石`, totalCount, successCount: eligibleRows.length, skippedCount };
};
