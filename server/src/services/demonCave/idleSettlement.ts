/**
 * 锁妖窟挂机结算系统
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：计算离线挂机期间的战斗次数、模拟战斗、保存历史记录
 * 2. 不做什么：不处理实时挂机逻辑（由前端轮询或用户手动结算）
 *
 * 挂机结算规则：
 * 1. 每场战斗假设耗时 30 秒
 * 2. 计算挂机时长内可完成的战斗次数
 * 3. 模拟每场战斗，统计胜负
 * 4. 保存挂机会话历史记录
 *
 * 关键边界条件与坑点：
 * 1. 挂机时长上限：24 小时（防止长期离线导致数据异常）
 * 2. 战斗次数向下取整
 * 3. 长时间挂机可能导致结算缓慢（后续可优化）
 */

import { query } from '../../config/database.js';
import { resolveDemonCaveFloor } from './algorithm.js';
import { calculateExperience, addBeastExperience } from './experienceReward.js';
import { simulateBattle } from './battleSimulation.js';
import { loadBeastDetailById, type BeastDetailDto } from '../beast/shared/beastView.js';
import type { MonsterData } from './algorithm.js';
import { calcBattleDrops, distributeDrops, type BattleDropSummary } from './dropService.js';

// 每场战斗假设耗时（秒）
const BATTLE_DURATION_SECONDS = 30;

// 挂机时长上限（秒）：24 小时
const MAX_IDLE_DURATION_SECONDS = 24 * 60 * 60;

/**
 * 计算挂机时长（秒）
 */
export const calculateIdleDuration = (idleStartedAt: string | Date): number => {
  const startTime = new Date(idleStartedAt).getTime();
  const now = Date.now();
  const durationSeconds = Math.floor((now - startTime) / 1000);

  return Math.min(durationSeconds, MAX_IDLE_DURATION_SECONDS);
};

/**
 * 计算挂机战斗次数
 */
export const calculateBattleCount = (durationSeconds: number): number => {
  return Math.floor(durationSeconds / BATTLE_DURATION_SECONDS);
};

/**
 * 格式化挂机时长为可读字符串
 */
export const formatIdleDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
};

/**
 * 结算挂机奖励
 *
 * 模拟每场战斗，统计胜负，保存历史记录
 */
export const settleIdleReward = async (
  characterId: number,
  beastIds: number[],
  beastNames: string[],
  idleFloor: number,
  idleStartedAt: string | Date,
): Promise<{
  battleCount: number;
  victoryCount: number;
  defeatCount: number;
  timeoutCount: number;
  totalExp: bigint;
  accumulatedExp: bigint;
  durationSeconds: number;
  durationText: string;
  totalDrops: BattleDropSummary;
}> => {
  // 计算挂机时长
  const durationSeconds = calculateIdleDuration(idleStartedAt);
  const battleCount = calculateBattleCount(durationSeconds);

  if (battleCount === 0) {
    return {
      battleCount: 0,
      victoryCount: 0,
      defeatCount: 0,
      timeoutCount: 0,
      totalExp: BigInt(0),
      accumulatedExp: BigInt(0),
      durationSeconds,
      durationText: formatIdleDuration(durationSeconds),
      totalDrops: { drops: [], totalItems: 0 },
    };
  }

  // 获取灵兽和怪物数据（支持多灵兽）
  const beasts: BeastDetailDto[] = [];
  for (const id of beastIds) {
    const b = await loadBeastDetailById(id);
    if (b) beasts.push(b);
  }
  if (beasts.length === 0) {
    throw new Error('灵兽数据加载失败');
  }

  const floorResolution = resolveDemonCaveFloor(idleFloor, beasts.length);
  const monsters = floorResolution.monsters;

  // 模拟每场战斗
  let victoryCount = 0;
  let defeatCount = 0;
  let timeoutCount = 0;
  let totalExp = BigInt(0);

  // 掉落汇总（累积所有胜利战斗的掉落）
  const dropMap = new Map<string, number>();

  for (let i = 0; i < battleCount; i++) {
    const battleResult = simulateBattle(beasts, monsters);

    if (battleResult.success) {
      victoryCount++;
      // 计算经验（按怪物叠加，经验值来自楼层配置）
      const exp = calculateExperience(monsters);
      totalExp += exp;

      // 计算掉落（每次胜利战斗独立计算）
      const battleDrops = calcBattleDrops(monsters);
      for (const drop of battleDrops.drops) {
        const current = dropMap.get(drop.itemId) ?? 0;
        dropMap.set(drop.itemId, current + drop.quantity);
      }
    } else if (battleResult.reason === 'timeout') {
      timeoutCount++;
    } else {
      defeatCount++;
    }
  }

  // 合并掉落结果
  const totalDrops: BattleDropSummary = {
    drops: Array.from(dropMap.entries()).map(([itemId, quantity]) => ({ itemId, quantity })),
    totalItems: Array.from(dropMap.values()).reduce((sum, q) => sum + q, 0),
  };

  // 发放总经验（平均分配给所有灵兽）
  const expPerBeast = totalExp / BigInt(beasts.length);
  let accumulatedExp = BigInt(0);
  for (const beast of beasts) {
    const expResult = await addBeastExperience(beast.id, expPerBeast);
    accumulatedExp = expResult.totalExp;
  }

  // 保存历史记录（先创建，获取 history_id 用于关联掉落记录）
  const historyResult = await query<{ id: number }>(
    `INSERT INTO demon_cave_idle_history (
      character_id, beast_ids, beast_names, floor,
      idle_started_at, idle_ended_at, duration_seconds,
      total_battles, victory_count, defeat_count, timeout_count,
      total_experience
    ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      characterId,
      beastIds,
      beastNames,
      idleFloor,
      new Date(idleStartedAt),
      durationSeconds,
      battleCount,
      victoryCount,
      defeatCount,
      timeoutCount,
      totalExp.toString(),
    ],
  );

  const historyId = historyResult.rows[0]?.id;

  // 发放掉落物品（关联到历史记录）
  if (totalDrops.drops.length > 0 && historyId) {
    await distributeDrops(
      characterId,
      totalDrops.drops,
      idleFloor,
      'idle',
      historyId,
    );
  }

  return {
    battleCount,
    victoryCount,
    defeatCount,
    timeoutCount,
    totalExp,
    accumulatedExp,
    durationSeconds,
    durationText: formatIdleDuration(durationSeconds),
    totalDrops,
  };
};

/**
 * 获取挂机历史记录
 */
export const getIdleHistory = async (
  characterId: number,
  limit: number = 20,
  offset: number = 0,
): Promise<{
  history: Array<{
    id: number;
    beastNames: string[];
    floor: number;
    status: 'active' | 'completed';
    idleStartedAt: string;
    idleEndedAt: string | null;
    durationSeconds: number | null;
    durationText: string;
    totalBattles: number | null;
    victoryCount: number;
    defeatCount: number;
    timeoutCount: number;
    totalExperience: string;
  }>;
  total: number;
}> => {
  // 查询总数
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM demon_cave_idle_history WHERE character_id = $1`,
    [characterId],
  );
  const total = parseInt(countResult.rows[0].count);

  // 查询记录
  const result = await query<{
    id: number;
    beast_names: string[];
    floor: number;
    status: string;
    idle_started_at: Date;
    idle_ended_at: Date | null;
    duration_seconds: number | null;
    total_battles: number | null;
    victory_count: number;
    defeat_count: number;
    timeout_count: number;
    total_experience: string;
  }>(
    `SELECT id, beast_names, floor, status, idle_started_at, idle_ended_at, duration_seconds,
            total_battles, victory_count, defeat_count, timeout_count, total_experience
     FROM demon_cave_idle_history
     WHERE character_id = $1
     ORDER BY
       CASE WHEN status = 'active' THEN 0 ELSE 1 END,
       COALESCE(idle_ended_at, idle_started_at) DESC
     LIMIT $2 OFFSET $3`,
    [characterId, limit, offset],
  );

  const history = result.rows.map((row) => {
    const durationText = row.duration_seconds !== null
      ? formatIdleDuration(row.duration_seconds)
      : '进行中';

    return {
      id: row.id,
      beastNames: row.beast_names || [],
      floor: row.floor,
      status: row.status as 'active' | 'completed',
      idleStartedAt: row.idle_started_at.toISOString(),
      idleEndedAt: row.idle_ended_at?.toISOString() ?? null,
      durationSeconds: row.duration_seconds,
      durationText,
      totalBattles: row.total_battles,
      victoryCount: row.victory_count,
      defeatCount: row.defeat_count,
      timeoutCount: row.timeout_count,
      totalExperience: row.total_experience,
    };
  });

  return { history, total };
};
