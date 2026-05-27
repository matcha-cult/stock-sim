/**
 * 货币操作模块（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供灵石扣除和增加的原子操作。
 * 2. 不做什么：不处理物品消耗、银两、经验等其他资源。
 *
 * 输入 / 输出：
 * - 输入：角色ID、灵石数量。
 * - 输出：操作结果（成功/失败）。
 *
 * 数据流 / 状态流：
 * 扣除请求 -> 锁定角色行 -> 校验余额 -> 执行扣除 -> 返回结果。
 * 增加请求 -> 锁定角色行 -> 执行增加 -> 返回结果。
 *
 * 关键边界条件与坑点：
 * 1. 扣除时余额不足返回失败，不抛异常。
 * 2. 使用 bigint 精确计算，避免浮点误差。
 */
import { query } from '../../../config/database.js';

type ConsumeSpiritStonesResult =
  | { success: true; message: string; remaining?: bigint }
  | { success: false; message: string };

type AddSpiritStonesResult =
  | { success: true; message: string; remaining?: bigint }
  | { success: false; message: string };

/**
 * 扣除灵石。
 */
export const consumeSpiritStones = async (
  characterId: number,
  amount: bigint,
): Promise<ConsumeSpiritStonesResult> => {
  if (amount < 0) {
    return { success: false, message: '扣除数量不能为负数' };
  }

  const result = await query(
    `
    UPDATE characters
    SET spirit_stones = spirit_stones - $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2 AND spirit_stones >= $1
    RETURNING spirit_stones
    `,
    [amount.toString(), characterId],
  );

  if (result.rowCount === 0) {
    return { success: false, message: '灵石不足' };
  }

  return {
    success: true,
    message: '灵石扣除成功',
    remaining: BigInt(result.rows[0].spirit_stones),
  };
};

/**
 * 增加灵石。
 */
export const addSpiritStones = async (
  characterId: number,
  amount: bigint,
): Promise<AddSpiritStonesResult> => {
  if (amount < 0) {
    return { success: false, message: '增加数量不能为负数' };
  }

  const result = await query(
    `
    UPDATE characters
    SET spirit_stones = spirit_stones + $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING spirit_stones
    `,
    [amount.toString(), characterId],
  );

  if (result.rowCount === 0) {
    return { success: false, message: '角色不存在' };
  }

  return {
    success: true,
    message: '灵石增加成功',
    remaining: BigInt(result.rows[0].spirit_stones),
  };
};

/**
 * 查询角色灵石余额。
 */
export const getSpiritStonesBalance = async (characterId: number): Promise<bigint | null> => {
  const result = await query(
    'SELECT spirit_stones FROM characters WHERE id = $1',
    [characterId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return BigInt(result.rows[0].spirit_stones);
};