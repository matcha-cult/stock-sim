/**
 * 锁妖窟经验奖励系统
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：计算战斗胜利后的经验奖励，发放经验给灵兽并检查升级
 * 2. 不做什么：不处理灵兽升级逻辑（由 beastLevelSystem 统一处理）
 *
 * 经验计算规则：
 * 按怪物逐只叠加：每只怪物贡献 level × 10 × 层型加成 的经验
 * 层型加成：normal ×1.0 | elite ×1.5 | boss ×2.0
 *
 * 关键边界条件与坑点：
 * 1. 经验值使用 BigInt 存储，避免大数精度问题
 * 2. 经验计算结果向下取整
 * 3. 经验发放后自动检查升级
 */

import { query } from '../../config/database.js';
import { addBeastExperienceAndLevelUp } from '../beast/beastLevelSystem.js';
import type { DemonCaveFloorKind, MonsterData } from './algorithm.js';

/**
 * 计算经验奖励（按怪物逐只叠加）
 *
 * 每只怪物的经验来自楼层配置的 experience 字段
 * 总经验 = 所有怪物经验之和
 *
 * @param monsters - 怪物列表（包含 experience 字段）
 * @returns 经验值
 */
export const calculateExperience = (
  monsters: MonsterData[],
): bigint => {
  let totalExp = 0;
  for (const monster of monsters) {
    totalExp += monster.experience;
  }

  return BigInt(Math.floor(totalExp));
};

/**
 * 给灵兽添加经验并检查升级
 *
 * 使用新的升级系统，自动检查并处理升级。
 *
 * @param beastId - 灵兽 ID
 * @param exp - 经验值
 * @returns 升级结果
 */
export const addBeastExperience = async (
  beastId: number,
  exp: bigint,
): Promise<{
  success: boolean;
  totalExp: bigint;
  leveledUp: boolean;
  newLevel?: number;
  levelsGained?: number;
}> => {
  const result = await addBeastExperienceAndLevelUp(beastId, exp);

  if (!result.success) {
    return { success: false, totalExp: BigInt(0), leveledUp: false };
  }

  // 获取当前经验
  const expResult = await query<{ progress_exp: bigint | string }>(
    `SELECT progress_exp::bigint AS progress_exp FROM character_beast WHERE id = $1`,
    [beastId],
  );

  const totalExp = expResult.rows.length > 0
    ? BigInt(expResult.rows[0].progress_exp)
    : BigInt(0);

  return {
    success: true,
    totalExp,
    leveledUp: result.leveledUp,
    newLevel: result.leveledUp ? result.newLevel : undefined,
    levelsGained: result.leveledUp ? result.levelsGained : undefined,
  };
};
