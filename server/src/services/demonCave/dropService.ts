/**
 * 锁妖窟掉落服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据掉落池配置计算战斗胜利后的物品掉落，发放物品到背包
 * 2. 不做什么：不处理战斗逻辑、不处理经验奖励
 *
 * 数据流 / 状态流：
 * 战斗胜利 -> 获取怪物掉落池 -> 按 rate 计算掉落 -> 批量添加物品到背包
 *
 * 复用设计说明：
 * - 复用 dropPoolLoader 的 Map 索引（O(1) 查询）
 * - 复用 unifiedInventoryService 的 addItem（统一背包系统）
 * - 掉落计算纯函数，无副作用，便于测试
 *
 * 关键边界条件与坑点：
 * 1. 每个掉落项独立判定（rate 0.05% = 0.0005）
 * 2. 掉落数量在 min-max 范围内随机
 * 3. 同一物品多次掉落合并为一条 addItem 调用
 * 4. 只有胜利的战斗才处理掉落
 */

import { getDropPoolById } from './dropPoolLoader.js';
import { addItem } from '../inventory/unifiedInventoryService.js';
import { query } from '../../config/database.js';
import type { MonsterData } from './algorithm.js';

// ==================== 类型定义 ====================

/**
 * 掉落结果（单个物品）
 */
export interface DropResult {
  itemId: string;
  quantity: number;
}

/**
 * 掉落汇总（一次战斗）
 */
export interface BattleDropSummary {
  drops: DropResult[];
  totalItems: number;
}

// ==================== 掉落计算（纯函数） ====================

/**
 * 计算单个掉落池的掉落结果
 *
 * @param poolId - 掉落池ID
 * @returns 掉落结果数组，空数组表示无掉落
 */
const calcDropPool = (poolId: string): DropResult[] => {
  const pool = getDropPoolById(poolId);
  if (!pool) {
    console.warn(`[dropService] 掉落池不存在: ${poolId}`);
    return [];
  }

  //console.log(`[dropService] 处理掉落池 ${poolId}，物品数量 ${pool.drops.length}`);

  const drops: DropResult[] = [];

  for (const dropItem of pool.drops) {
    // 独立判定是否掉落
    const roll = Math.random();
    const hit = roll < dropItem.rate;
    //console.log(`[dropService] 物品 ${dropItem.item_id}: rate=${dropItem.rate}, roll=${roll.toFixed(4)}, hit=${hit}`);

    if (hit) {
      // 计算掉落数量（min-max 范围）
      const quantity = calcDropQuantity(dropItem.min, dropItem.max);
      if (quantity > 0) {
        drops.push({ itemId: dropItem.item_id, quantity });
      }
    }
  }

  return drops;
};

/**
 * 计算掉落数量（min-max 范围内随机）
 *
 * @param min - 最小数量
 * @param max - 最大数量
 */
const calcDropQuantity = (min: number, max: number): number => {
  return min + Math.floor(Math.random() * (max - min + 1));
};

/**
 * 计算一场战斗的所有掉落
 *
 * @param monsters - 怪物数组（包含 dropPoolIds）
 * @returns 掉落汇总
 */
export const calcBattleDrops = (monsters: MonsterData[]): BattleDropSummary => {
  // 使用 Map 合并同一物品的多次掉落
  const dropMap = new Map<string, number>();

  for (const monster of monsters) {
    for (const poolId of monster.dropPoolIds) {
      const drops = calcDropPool(poolId);
      for (const drop of drops) {
        const current = dropMap.get(drop.itemId) ?? 0;
        dropMap.set(drop.itemId, current + drop.quantity);
      }
    }
  }

  // 转换为数组
  const drops: DropResult[] = [];
  for (const [itemId, quantity] of dropMap.entries()) {
    drops.push({ itemId, quantity });
  }

  //console.log(`[dropService] 最终掉落结果:`, drops);

  return {
    drops,
    totalItems: drops.reduce((sum, d) => sum + d.quantity, 0),
  };
};

// ==================== 掉落发放 ====================

/**
 * 发放掉落物品到背包，并写入掉落记录
 *
 * @param characterId - 角色ID
 * @param drops - 掉落结果数组
 * @param floor - 当前楼层
 * @param sourceType - 来源类型（'idle' 或 'challenge'）
 * @param historyId - 挂机历史记录ID（挑战模式为 undefined）
 * @returns 发放结果
 */
export const distributeDrops = async (
  characterId: number,
  drops: DropResult[],
  floor: number,
  sourceType: 'idle' | 'challenge',
  historyId?: number,
): Promise<{ successCount: number; failCount: number; errors: string[] }> => {
  console.log(`[dropService] 发放掉落：角色 ${characterId}，楼层 ${floor}，来源 ${sourceType}，历史 ${historyId ?? 'N/A'}，物品数量 ${drops.length}`);

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (const drop of drops) {
    console.log(`[dropService] 发放物品: ${drop.itemId} ×${drop.quantity}`);
    // 发放物品到背包
    const result = await addItem({
      characterId,
      itemKey: drop.itemId,
      quantity: drop.quantity,
      operationType: 'acquire',
      bizType: `demon_cave_${sourceType}`,
      bizId: historyId ? `history-${historyId}` : `floor-${floor}`,
      memo: `锁妖窟${sourceType === 'idle' ? '挂机' : '挑战'}掉落：${drop.itemId} ×${drop.quantity}`,
    });

    if (result.success) {
      successCount++;

      // 写入掉落记录
      await query(
        `INSERT INTO demon_cave_drop_log (character_id, history_id, source_type, floor, item_key, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [characterId, historyId ?? null, sourceType, floor, drop.itemId, drop.quantity],
      );
    } else {
      failCount++;
      errors.push(`发放 ${drop.itemId} 失败: ${result.message}`);
    }
  }

  return { successCount, failCount, errors };
};

/**
 * 计算并发放战斗掉落（一站式接口）
 *
 * @param characterId - 角色ID
 * @param monsters - 怪物数组
 * @param floor - 当前楼层
 * @param sourceType - 来源类型（'idle' 或 'challenge'）
 * @param historyId - 挂机历史记录ID（挑战模式为 undefined）
 * @returns 掉落汇总
 */
export const processBattleDrops = async (
  characterId: number,
  monsters: MonsterData[],
  floor: number,
  sourceType: 'idle' | 'challenge',
  historyId?: number,
): Promise<BattleDropSummary> => {
  const summary = calcBattleDrops(monsters);

  if (summary.drops.length > 0) {
    await distributeDrops(characterId, summary.drops, floor, sourceType, historyId);
  }

  return summary;
};

// ==================== 掉落记录查询 ====================

/**
 * 掉落记录 DTO
 */
export interface DropLogDto {
  id: string;
  historyId: number | null;
  sourceType: string;
  floor: number;
  itemKey: string;
  quantity: number;
  createdAt: number;
}

/** 掉落记录汇总 DTO */
export interface DropLogSummaryDto {
  itemKey: string;
  totalQuantity: number;
  maxFloor: number;
}

/**
 * 查询挂机历史的掉落记录（按物品汇总）
 *
 * @param historyId - 挂机历史记录ID
 * @returns 按物品汇总的掉落记录
 */
export const getDropLogsByHistoryId = async (
  historyId: number,
): Promise<DropLogSummaryDto[]> => {
  const result = await query<{
    item_key: string;
    total_quantity: string;
    max_floor: number;
  }>(
    `SELECT item_key,
            SUM(quantity)::bigint AS total_quantity,
            MAX(floor) AS max_floor
     FROM demon_cave_drop_log
     WHERE history_id = $1
     GROUP BY item_key
     ORDER BY total_quantity DESC`,
    [historyId],
  );

  return result.rows.map((row) => ({
    itemKey: row.item_key,
    totalQuantity: Number(row.total_quantity),
    maxFloor: row.max_floor,
  }));
};

/**
 * 查询角色最近的掉落记录
 *
 * @param characterId - 角色ID
 * @param limit - 返回数量限制
 * @param offset - 偏移量
 * @returns 掉落记录列表
 */
export const getRecentDropLogs = async (
  characterId: number,
  limit: number = 20,
  offset: number = 0,
): Promise<{ drops: DropLogDto[]; total: number }> => {
  // 查询总数
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM demon_cave_drop_log WHERE character_id = $1`,
    [characterId],
  );

  // 查询记录
  const result = await query<{
    id: string;
    history_id: number | null;
    source_type: string;
    floor: number;
    item_key: string;
    quantity: number;
    created_at: Date;
  }>(
    `SELECT id::text, history_id, source_type, floor, item_key, quantity,
            EXTRACT(EPOCH FROM created_at)::bigint AS created_at
     FROM demon_cave_drop_log
     WHERE character_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [characterId, limit, offset],
  );

  return {
    total: parseInt(countResult.rows[0].count),
    drops: result.rows.map((row) => ({
      id: row.id,
      historyId: row.history_id,
      sourceType: row.source_type,
      floor: row.floor,
      itemKey: row.item_key,
      quantity: row.quantity,
      createdAt: Number(row.created_at),
    })),
  };
};
