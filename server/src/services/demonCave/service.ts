/**
 * 锁妖窟服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理锁妖窟进度、提供楼层预览、处理挑战开始与结算
 * 2. 不做什么：不处理 HTTP 参数、不直接实现战斗逻辑
 *
 * 数据流 / 状态流：
 * route -> demonCaveService -> demonCaveAlgorithm + SQL -> DTO
 *
 * 关键边界条件与坑点：
 * 1. 同一角色任一时刻只能有一条 active run
 * 2. 通关当前层后才能解锁下一层
 */

import { query, withTransaction } from '../../config/database.js';
import { resolveDemonCaveFloor, type ResolvedDemonCaveFloor } from './algorithm.js';
import { loadBeastDetailById, type BeastDetailDto } from '../beast/shared/beastView.js';
import { simulateBattle, type BattleResult } from './battleSimulation.js';
import { addIdleRepeatJob, addIdleNextJob, removeIdleRepeatJob } from './idleBattleQueue.js';
import { calculateExperience, addBeastExperience } from './experienceReward.js';
import { settleIdleReward, formatIdleDuration, getIdleHistory } from './idleSettlement.js';
import { calculateIdleDuration, calculateBattleCount } from './idleSettlement.js';
import { getMaxFloor } from './floorConfigLoader.js';
import { calcBattleDrops, distributeDrops, type BattleDropSummary } from './dropService.js';

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== DTO 类型 ====================

export interface DemonCaveProgressDto {
  beastIds: number[];
  beastNames: string[];
  bestFloor: number;
  currentFloor: number;
  currentRunId: string | null;
  currentBattleId: string | null;
  lastSettledFloor: number;
  isIdling: boolean;
  idleFloor: number | null;
  idleStartedAt: string | null;
  currentHistoryId: number | null;
}

export interface DemonCaveOverviewDto {
  progress: DemonCaveProgressDto;
  beasts: BeastDetailDto[];
  floorPreview: {
    floor: number;
    kind: 'normal' | 'elite' | 'boss';
    monsterCount: number;
    monsterNames: string[];
  };
  isMaxFloorReached: boolean;
  ongoingBattle?: {
    runId: string;
    floor: number;
    kind: 'normal' | 'elite' | 'boss';
    beasts: BeastDetailDto[];
    monsters: Array<{
      id: string;
      defId: string;
      name: string;
      level: number;
      element: string[];
      baseAttrs: Record<string, number>;
      skills: string[];
      passiveSkills: string[];
    }>;
  };
}

export interface DemonCaveFloorPreviewDto {
  floor: number;
  kind: 'normal' | 'elite' | 'boss';
  monsterCount: number;
  monsterNames: string[];
}

// ==================== 进度管理 ====================

/**
 * 获取或创建锁妖窟进度
 */
const ensureDemonCaveProgress = async (
  characterId: number,
): Promise<DemonCaveProgressDto> => {
  const result = await query<{
    beast_ids: number[];
    best_floor: number | string;
    current_floor: number | string;
    current_run_id: string | null;
    current_battle_id: string | null;
    last_settled_floor: number | string;
    is_idling: boolean;
    idle_floor: number | string | null;
    idle_started_at: Date | string | null;
    current_history_id: number | string | null;
    epoch: number | string | null;
  }>(
    `SELECT beast_ids, best_floor, current_floor, current_run_id, current_battle_id, last_settled_floor,
            is_idling, idle_floor, current_history_id, EXTRACT(EPOCH FROM idle_started_at) AS epoch
     FROM character_demon_cave_progress
     WHERE character_id = $1`,
    [characterId],
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    const beastIds = row.beast_ids || [];

    // 获取灵兽名称
    let beastNames: string[] = [];
    if (beastIds.length > 0) {
      const beastResult = await query<{ id: number; nickname: string }>(
        `SELECT id, nickname FROM character_beast WHERE id = ANY($1)`,
        [beastIds],
      );
      beastNames = beastResult.rows.map((r) => r.nickname);
    }

    return {
      beastIds,
      beastNames,
      bestFloor: Number(row.best_floor),
      currentFloor: Number(row.current_floor),
      currentRunId: row.current_run_id,
      currentBattleId: row.current_battle_id,
      lastSettledFloor: Number(row.last_settled_floor),
      isIdling: row.is_idling,
      idleFloor: row.idle_floor !== null ? Number(row.idle_floor) : null,
      idleStartedAt: row.epoch !== null ? new Date(Number(row.epoch) * 1000).toISOString() : null,
      currentHistoryId: row.current_history_id !== null ? Number(row.current_history_id) : null,
    };
  }

  // 创建初始进度
  await query(
    `INSERT INTO character_demon_cave_progress (character_id, best_floor, current_floor, last_settled_floor)
     VALUES ($1, 0, 1, 0)`,
    [characterId],
  );

  return {
    beastIds: [],
    beastNames: [],
    bestFloor: 0,
    currentFloor: 1,
    currentRunId: null,
    currentBattleId: null,
    lastSettledFloor: 0,
    isIdling: false,
    idleFloor: null,
    idleStartedAt: null,
    currentHistoryId: null,
  };
};

// ==================== 概览接口 ====================

/**
 * 获取锁妖窟概览（进度 + 灵兽详情 + 当前层预览）
 */
export const getDemonCaveOverview = async (
  characterId: number,
): Promise<ServiceResult<DemonCaveOverviewDto>> => {
  const progress = await ensureDemonCaveProgress(characterId);
  const maxFloor = getMaxFloor();

  // 检查是否已达顶层
  const isMaxFloorReached = progress.currentFloor > maxFloor;
  const displayFloor = isMaxFloorReached ? maxFloor : progress.currentFloor;

  const floorResolution = resolveDemonCaveFloor(displayFloor, progress.beastIds.length || 1);

  // 获取所有灵兽详情
  const beasts: BeastDetailDto[] = [];
  for (const beastId of progress.beastIds) {
    const beast = await loadBeastDetailById(beastId);
    if (beast) {
      beasts.push(beast);
    }
  }

  // 如果有进行中的挑战，恢复战斗数据
  let ongoingBattle: DemonCaveOverviewDto['ongoingBattle'] | undefined;
  if (progress.currentRunId && progress.beastIds.length > 0 && !isMaxFloorReached) {
    const battleBeasts: BeastDetailDto[] = [];
    for (const beastId of progress.beastIds) {
      const beast = await loadBeastDetailById(beastId);
      if (beast) {
        battleBeasts.push(beast);
      }
    }

    if (battleBeasts.length > 0) {
      ongoingBattle = {
        runId: progress.currentRunId,
        floor: floorResolution.floor,
        kind: floorResolution.kind,
        beasts: battleBeasts,
        monsters: floorResolution.monsters.map((m) => ({
          id: m.id,
          defId: m.defId,
          name: m.name,
          level: m.level,
          element: m.element,
          baseAttrs: m.baseAttrs as unknown as Record<string, number>,
          skills: m.skills,
          passiveSkills: m.passiveSkills,
        })),
      };
    }
  }

  return {
    success: true,
    data: {
      progress,
      beasts,
      floorPreview: floorResolution.preview,
      isMaxFloorReached,
      ...(ongoingBattle && { ongoingBattle }),
    },
  };
};

// ==================== 楼层预览 ====================

/**
 * 预览指定楼层的怪物组合
 */
export const previewDemonCaveFloor = async (
  characterId: number,
  floor: number,
): Promise<ServiceResult<DemonCaveFloorPreviewDto>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  // 只能预览已解锁的楼层（1 ~ bestFloor + 1）
  if (floor < 1 || floor > progress.bestFloor + 1) {
    return { success: false, message: '该楼层尚未解锁' };
  }

  const floorResolution = resolveDemonCaveFloor(floor, progress.beastIds.length || 1);

  return {
    success: true,
    data: floorResolution.preview,
  };
};

// ==================== 设置出战灵兽 ====================

/**
 * 设置锁妖窟出战灵兽
 */
/**
 * 设置出战灵兽队伍
 *
 * @param characterId - 角色 ID
 * @param beastIds - 灵兽 ID 列表（1-4 只）
 */
export const setDemonCaveBeastTeam = async (
  characterId: number,
  beastIds: number[],
): Promise<ServiceResult<DemonCaveProgressDto>> => {
  // 验证数量限制
  if (beastIds.length === 0 || beastIds.length > 4) {
    return { success: false, message: '灵兽队伍数量必须在 1-4 只之间' };
  }

  // 验证所有灵兽属于该角色
  const beastResult = await query<{ id: number; character_id: number }>(
    `SELECT id, character_id FROM character_beast WHERE id = ANY($1)`,
    [beastIds],
  );

  if (beastResult.rows.length !== beastIds.length) {
    return { success: false, message: '部分灵兽不存在' };
  }

  for (const beast of beastResult.rows) {
    if (Number(beast.character_id) !== characterId) {
      return { success: false, message: '灵兽不属于该角色' };
    }
  }

  // 确保进度存在
  await ensureDemonCaveProgress(characterId);

  // 更新出战灵兽队伍
  await query(
    `UPDATE character_demon_cave_progress
     SET beast_ids = $1,
         updated_at = NOW()
     WHERE character_id = $2`,
    [beastIds, characterId],
  );

  const progress = await ensureDemonCaveProgress(characterId);

  return {
    success: true,
    data: progress,
  };
};

// ==================== 挑战开始 ====================

/**
 * 开始挑战当前层
 *
 * 执行单次战斗并等待结果，返回战斗数据
 */
export const startDemonCaveChallenge = async (
  characterId: number,
  floor?: number,
): Promise<ServiceResult<{
  floor: number;
  kind: 'normal' | 'elite' | 'boss';
  beasts: BeastDetailDto[];
  monsters: Array<{
    id: string;
    defId: string;
    name: string;
    level: number;
    element: string[];
    baseAttrs: Record<string, number>;
    skills: string[];
    passiveSkills: string[];
  }>;
  battleResult: {
    success: boolean;
    rounds: number;
    reason: 'victory' | 'defeat' | 'timeout';
    experience: string;
    battleLogs: Array<{
      round: number;
      attacker: string;
      defender: string;
      action: 'attack' | 'miss' | 'parry' | 'critical' | 'death';
      damage?: number;
      remainingHp?: number;
      isCrit?: boolean;
      isParry?: boolean;
      isElementBonus?: boolean;
      message: string;
    }>;
  };
  battleDrops: BattleDropSummary;
}>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  // 检查是否已设置出战灵兽队伍
  if (!progress.beastIds || progress.beastIds.length === 0) {
    return { success: false, message: '请先设置出战灵兽' };
  }

  // 验证楼层参数（默认为 currentFloor）
  const challengeFloor = floor ?? progress.currentFloor;
  if (challengeFloor < 1 || challengeFloor > progress.bestFloor + 1) {
    return { success: false, message: '楼层未解锁' };
  }

  // 检查是否已达顶层
  const maxFloor = getMaxFloor();
  if (challengeFloor > maxFloor) {
    return { success: false, message: '已通关所有关卡，无后续关卡' };
  }

  // 获取所有灵兽详情
  const beasts: BeastDetailDto[] = [];
  for (const beastId of progress.beastIds) {
    const beast = await loadBeastDetailById(beastId);
    if (!beast) {
      return { success: false, message: `灵兽 ${beastId} 数据加载失败` };
    }
    beasts.push(beast);
  }

  const floorResolution = resolveDemonCaveFloor(challengeFloor, beasts.length);

  // 同步执行战斗（不走 Worker 队列，避免状态卡住）
  const battleResult = simulateBattle(beasts, floorResolution.monsters);

  // 计算经验（无论胜负都计算，用于返回给前端）
  const experienceReward = calculateExperience(floorResolution.monsters);

  // 处理层数推进
  let battleDrops: BattleDropSummary = { drops: [], totalItems: 0 };
  if (battleResult.success) {
    // 胜利：更新 best_floor 和 current_floor，发放经验
    const newBestFloor = Math.max(progress.bestFloor, progress.currentFloor);
    const newCurrentFloor = progress.currentFloor + 1;

    await query(
      `UPDATE character_demon_cave_progress
       SET best_floor = $1,
           current_floor = $2,
           last_settled_floor = $3,
           updated_at = NOW()
       WHERE character_id = $4`,
      [newBestFloor, newCurrentFloor, progress.currentFloor, characterId],
    );

    // 发放经验给所有灵兽（平均分配）
    const expPerBeast = experienceReward / BigInt(beasts.length);
    for (const beast of beasts) {
      await addBeastExperience(beast.id, expPerBeast);
    }

    // 计算并发放掉落
    battleDrops = calcBattleDrops(floorResolution.monsters);
    if (battleDrops.drops.length > 0) {
      await distributeDrops(
        characterId,
        battleDrops.drops,
        progress.currentFloor,
        'challenge',
      );
    }
  }

  return {
    success: true,
    data: {
      floor: floorResolution.floor,
      kind: floorResolution.kind,
      beasts,
      monsters: floorResolution.monsters.map((m) => ({
        id: m.id,
        defId: m.defId,
        name: m.name,
        level: m.level,
        element: m.element,
        baseAttrs: m.baseAttrs as unknown as Record<string, number>,
        skills: m.skills,
        passiveSkills: m.passiveSkills,
      })),
      battleResult: {
        success: battleResult.success,
        rounds: battleResult.rounds,
        reason: battleResult.reason,
        experience: experienceReward.toString(),
        battleLogs: battleResult.logs,
      },
      battleDrops,
    },
  };
};

// ==================== 挑战结算 ====================

/**
 * 结算挑战结果
 *
 * 战斗结果由服务端计算，基于灵兽和怪物属性
 * 胜利后发放经验奖励
 *
 * @param characterId - 角色 ID
 * @param runId - 战斗 run ID
 */
export const settleDemonCaveChallenge = async (
  characterId: number,
  runId: string,
): Promise<ServiceResult<{
  success: boolean;
  bestFloor: number;
  currentFloor: number;
  battleDetails: {
    beastPower: number;
    monsterPower: number;
    powerDiff: number;
    winRate: number;
    rounds: number;
    reason: 'victory' | 'defeat' | 'timeout';
  };
  experienceReward?: bigint;
  totalExperience?: bigint;
  battleDrops?: BattleDropSummary;
}>> => {
  return withTransaction(async (client) => {
    // 查询当前进度
    const progressResult = await client.query<{
      best_floor: number | string;
      current_floor: number | string;
      current_run_id: string | null;
      beast_ids: number[];
    }>(
      `SELECT best_floor, current_floor, current_run_id, beast_ids
       FROM character_demon_cave_progress
       WHERE character_id = $1`,
      [characterId],
    );

    if (progressResult.rows.length === 0) {
      return { success: false, message: '进度不存在' };
    }

    const progress = progressResult.rows[0];
    const currentRunId = progress.current_run_id;

    if (!currentRunId || currentRunId !== runId) {
      return { success: false, message: 'runId 不匹配或挑战已结束' };
    }

    const bestFloor = Number(progress.best_floor);
    const currentFloor = Number(progress.current_floor);
    const beastIds = progress.beast_ids || [];

    if (!beastIds || beastIds.length === 0) {
      return { success: false, message: '未设置出战灵兽' };
    }

    // 获取灵兽和怪物数据（支持多灵兽）
    const beasts: BeastDetailDto[] = [];
    for (const id of beastIds) {
      const b = await loadBeastDetailById(id);
      if (b) beasts.push(b);
    }
    if (beasts.length === 0) {
      return { success: false, message: '灵兽数据加载失败' };
    }

    const floorResolution = resolveDemonCaveFloor(currentFloor, beasts.length);
    const monsters = floorResolution.monsters;

    // 调试日志：对比挑战模式的灵兽和怪物数据
    console.log(`[Challenge] 楼层 ${currentFloor}，灵兽 ${beasts.length} 只`);
    console.log(`[Challenge] 灵兽战力：${beasts.map(b => `${b.name}(HP:${b.computedAttrs.max_hp},ATK:${b.computedAttrs.atk})`).join(', ')}`);
    console.log(`[Challenge] 怪物战力：${monsters.map(m => `${m.name}(HP:${m.baseAttrs.max_hp},ATK:${m.baseAttrs.atk})`).join(', ')}`);

    // 模拟战斗（多灵兽）
    const battleResult = simulateBattle(beasts, monsters);
    const battleSuccess = battleResult.success;

    // 计算战力对比（用于展示）- 使用第一只灵兽作为代表
    const beast = beasts[0];
    const beastPower = beasts.reduce((sum, b) => {
      return sum + b.computedAttrs.max_hp + b.computedAttrs.atk * 2 + b.computedAttrs.def * 1.5;
    }, 0);
    const monsterPower = monsters.reduce((sum, m) => {
      return sum + (m.baseAttrs.max_hp + m.baseAttrs.atk * 2 + m.baseAttrs.def * 1.5);
    }, 0);
    const powerDiff = beastPower - monsterPower;
    const totalPower = beastPower + monsterPower;
    const winRate = totalPower > 0 ? (beastPower / totalPower) * 100 : 50;

    const battleDetails = {
      beastPower,
      monsterPower,
      powerDiff,
      winRate,
      rounds: battleResult.rounds,
      reason: battleResult.reason,
    };

    if (battleSuccess) {
      // 通关：更新 best_floor 和 current_floor
      const newBestFloor = Math.max(bestFloor, currentFloor);
      const newCurrentFloor = currentFloor + 1;

      // 计算并发放经验奖励
      const experienceReward = calculateExperience(monsters);

      await client.query(
        `UPDATE character_demon_cave_progress
         SET best_floor = $1,
             current_floor = $2,
             last_settled_floor = $3,
             current_run_id = NULL,
             current_battle_id = NULL,
             updated_at = NOW()
         WHERE character_id = $4`,
        [newBestFloor, newCurrentFloor, currentFloor, characterId],
      );

      // 发放经验给所有灵兽（平均分配）
      const expPerBeast = experienceReward / BigInt(beasts.length);
      for (const beast of beasts) {
        await addBeastExperience(beast.id, expPerBeast);
      }
      const expResult = await addBeastExperience(beasts[0].id, BigInt(0)); // 获取总经验用于返回

      // 计算并发放掉落
      const battleDrops = calcBattleDrops(monsters);
      if (battleDrops.drops.length > 0) {
        await distributeDrops(
          characterId,
          battleDrops.drops,
          currentFloor,
          'challenge',
        );
      }

      return {
        success: true,
        data: {
          success: true,
          bestFloor: newBestFloor,
          currentFloor: newCurrentFloor,
          battleDetails,
          experienceReward,
          totalExperience: expResult.totalExp,
          battleDrops,
        },
      };
    } else {
      // 失败：清除 run，不更新楼层
      await client.query(
        `UPDATE character_demon_cave_progress
         SET current_run_id = NULL,
             current_battle_id = NULL,
             updated_at = NOW()
         WHERE character_id = $1`,
        [characterId],
      );

      return {
        success: true,
        data: {
          success: false,
          bestFloor,
          currentFloor,
          battleDetails,
        },
      };
    }
  });
};

// ==================== 放弃挑战 ====================

/**
 * 放弃当前挑战（清理 currentRunId）
 *
 * 用于用户在战斗界面返回但未结算的情况
 *
 * @param characterId - 角色 ID
 */
export const abandonDemonCaveChallenge = async (
  characterId: number,
): Promise<ServiceResult<DemonCaveProgressDto>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  // 检查是否有进行中的挑战
  if (!progress.currentRunId) {
    // 没有挑战需要放弃，直接返回当前进度
    return {
      success: true,
      data: progress,
    };
  }

  // 清除当前挑战状态
  await query(
    `UPDATE character_demon_cave_progress
     SET current_run_id = NULL,
         current_battle_id = NULL,
         updated_at = NOW()
     WHERE character_id = $1`,
    [characterId],
  );

  const updatedProgress = await ensureDemonCaveProgress(characterId);

  return {
    success: true,
    data: updatedProgress,
  };
};

// ==================== 挂机开始 ====================

/**
 * 开始挂机
 *
 * @param characterId - 角色 ID
 * @param floor - 挂机楼层（必须是已通关的楼层）
 */
export const startDemonCaveIdle = async (
  characterId: number,
  floor: number,
): Promise<ServiceResult<DemonCaveProgressDto>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  // 检查是否已设置出战灵兽
  if (!progress.beastIds || progress.beastIds.length === 0) {
    return { success: false, message: '请先设置出战灵兽' };
  }

  // 检查是否已在挂机
  if (progress.isIdling) {
    return { success: false, message: '已在挂机中' };
  }

  // 检查是否有进行中的挑战
  if (progress.currentRunId) {
    return { success: false, message: '请先完成当前挑战' };
  }

  // 检查楼层是否已通关（只能挂机已通关的楼层）
  if (floor < 1 || floor > progress.bestFloor) {
    return { success: false, message: '该楼层尚未通关' };
  }

  // 创建挂机历史记录（状态为"进行中"）
  const historyResult = await query<{ id: number }>(
    `INSERT INTO demon_cave_idle_history (
      character_id, beast_ids, beast_names, floor,
      status, idle_started_at
    ) VALUES ($1, $2, $3, $4, 'active', NOW())
    RETURNING id`,
    [characterId, progress.beastIds, progress.beastNames, floor],
  );

  const historyId = historyResult.rows[0].id;

  // 获取灵兽和怪物数据（支持多灵兽）
  const beasts: BeastDetailDto[] = [];
  for (const id of progress.beastIds) {
    const b = await loadBeastDetailById(id);
    if (b) beasts.push(b);
  }
  if (beasts.length === 0) {
    return { success: false, message: '灵兽数据加载失败' };
  }

  const floorResolution = resolveDemonCaveFloor(floor, beasts.length);
  const monsters = floorResolution.monsters;

  // 添加第一场战斗任务（初始延迟 1 秒）
  // 后续战斗由 Worker 根据实际回合数动态调度
  await addIdleNextJob(
    {
      characterId,
      beastId: progress.beastIds[0], // 主灵兽 ID（用于兼容）
      idleFloor: floor,
      historyId,
      beasts, // 多灵兽模式
      monsters,
    },
    0, // 第一场战斗，初始延迟 = 0 × 1500 + 1000 = 1 秒
  );

  // 开始挂机
  await query(
    `UPDATE character_demon_cave_progress
     SET is_idling = TRUE,
         idle_floor = $1,
         idle_started_at = NOW(),
         current_history_id = $2,
         updated_at = NOW()
     WHERE character_id = $3`,
    [floor, historyId, characterId],
  );

  const updatedProgress = await ensureDemonCaveProgress(characterId);

  return {
    success: true,
    data: updatedProgress,
  };
};

// ==================== 挂机停止 ====================

/**
 * 停止挂机（移除重复任务）
 *
 * @param characterId - 角色 ID
 */
export const stopDemonCaveIdle = async (
  characterId: number,
): Promise<ServiceResult<{
  progress: DemonCaveProgressDto;
}>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  // 检查是否在挂机
  if (!progress.isIdling) {
    return { success: false, message: '当前未在挂机' };
  }

  if (!progress.currentHistoryId) {
    return { success: false, message: '挂机数据异常' };
  }

  // 移除重复任务
  await removeIdleRepeatJob(characterId, progress.currentHistoryId);

  // 计算挂机时长
  const durationSeconds = progress.idleStartedAt
    ? Math.floor((Date.now() - new Date(progress.idleStartedAt).getTime()) / 1000)
    : 0;

  // 更新历史记录为"已结束"
  await query(
    `UPDATE demon_cave_idle_history
     SET status = 'completed',
         idle_ended_at = NOW(),
         duration_seconds = $1
     WHERE id = $2`,
    [durationSeconds, progress.currentHistoryId],
  );

  // 停止挂机状态
  await query(
    `UPDATE character_demon_cave_progress
     SET is_idling = FALSE,
         idle_floor = NULL,
         idle_started_at = NULL,
         current_history_id = NULL,
         updated_at = NOW()
     WHERE character_id = $1`,
    [characterId],
  );

  const updatedProgress = await ensureDemonCaveProgress(characterId);

  return {
    success: true,
    data: {
      progress: updatedProgress,
    },
  };
};

// ==================== 挂机历史 ====================

/**
 * 获取挂机历史记录
 *
 * @param characterId - 角色 ID
 * @param limit - 返回数量限制
 * @param offset - 偏移量
 */
export const getDemonCaveIdleHistory = async (
  characterId: number,
  limit: number = 20,
  offset: number = 0,
): Promise<ServiceResult<{
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
}>> => {
  const result = await getIdleHistory(characterId, limit, offset);

  return {
    success: true,
    data: result,
  };
};

/**
 * 获取挂机战斗日志（分页 + 倒序）
 *
 * @param characterId - 角色 ID
 * @param historyId - 挂机历史记录 ID
 * @param limit - 每页数量（默认 20）
 * @param offset - 偏移量（默认 0）
 */
export const getIdleBattleLogs = async (
  characterId: number,
  historyId: number,
  limit: number = 20,
  offset: number = 0,
): Promise<ServiceResult<{
  logs: Array<{
    id: number;
    battleIndex: number;
    result: string;
    rounds: number;
    experience: string;
  }>;
  total: number;
  limit: number;
  offset: number;
}>> => {
  // 验证历史记录属于该角色
  const historyResult = await query<{ id: number }>(
    `SELECT id FROM demon_cave_idle_history
     WHERE id = $1 AND character_id = $2`,
    [historyId, characterId],
  );

  if (historyResult.rows.length === 0) {
    return { success: false, message: '记录不存在' };
  }

  // 获取总数
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM demon_cave_idle_battle_log
     WHERE history_id = $1`,
    [historyId],
  );
  const total = Number(countResult.rows[0].count);

  // 获取分页数据（倒序，最新的在前）
  const logsResult = await query<{
    id: number;
    battle_index: number;
    result: string;
    rounds: number;
    experience: string;
  }>(
    `SELECT id, battle_index, result, rounds, experience
     FROM demon_cave_idle_battle_log
     WHERE history_id = $1
     ORDER BY battle_index DESC
     LIMIT $2 OFFSET $3`,
    [historyId, limit, offset],
  );

  const logs = logsResult.rows.map((row) => ({
    id: row.id,
    battleIndex: row.battle_index,
    result: row.result,
    rounds: row.rounds,
    experience: row.experience,
  }));

  return {
    success: true,
    data: { logs, total, limit, offset },
  };
};

/**
 * 获取单场战斗的详细日志
 *
 * @param characterId - 角色 ID
 * @param battleLogId - 战斗日志 ID
 */
export const getIdleBattleLogDetail = async (
  characterId: number,
  battleLogId: number,
): Promise<ServiceResult<{
  battleIndex: number;
  result: string;
  rounds: number;
  experience: string;
  battleLogs: Array<{
    round: number;
    attacker: string;
    defender: string;
    action: string;
    damage?: number;
    remainingHp?: number;
    isCrit?: boolean;
    isParry?: boolean;
    isElementBonus?: boolean;
    message: string;
  }>;
}>> => {
  // 验证战斗日志属于该角色
  const logResult = await query<{
    battle_index: number;
    result: string;
    rounds: number;
    experience: string;
    battle_logs: Array<{
      round: number;
      attacker: string;
      defender: string;
      action: string;
      damage?: number;
      remainingHp?: number;
      isCrit?: boolean;
      isParry?: boolean;
      isElementBonus?: boolean;
      message: string;
    }> | null;
  }>(
    `SELECT b.battle_index, b.result, b.rounds, b.experience, b.battle_logs
     FROM demon_cave_idle_battle_log b
     JOIN demon_cave_idle_history h ON b.history_id = h.id
     WHERE b.id = $1 AND h.character_id = $2`,
    [battleLogId, characterId],
  );

  if (logResult.rows.length === 0) {
    return { success: false, message: '战斗记录不存在' };
  }

  const row = logResult.rows[0];

  return {
    success: true,
    data: {
      battleIndex: row.battle_index,
      result: row.result,
      rounds: row.rounds,
      experience: row.experience,
      battleLogs: row.battle_logs || [],
    },
  };
};

/**
 * 测试战斗（输出完整战斗信息）
 *
 * @param characterId - 角色 ID
 * @param floor - 楼层（可选，默认当前楼层）
 */
export const testBattle = async (
  characterId: number,
  floor?: number,
): Promise<ServiceResult<{
  beast: {
    id: number;
    name: string;
    level: number;
    element: string;
    attrs: Record<string, number>;
  };
  monsters: Array<{
    name: string;
    level: number;
    element: string;
    attrs: Record<string, number>;
  }>;
  battleResult: {
    success: boolean;
    rounds: number;
    reason: string;
    logs: Array<{
      round: number;
      message: string;
    }>;
  };
}>> => {
  const progress = await ensureDemonCaveProgress(characterId);

  if (!progress.beastIds || progress.beastIds.length === 0) {
    return { success: false, message: '未设置出战灵兽' };
  }

  // 获取所有灵兽数据
  const beasts: BeastDetailDto[] = [];
  for (const id of progress.beastIds) {
    const b = await loadBeastDetailById(id);
    if (b) beasts.push(b);
  }
  if (beasts.length === 0) {
    return { success: false, message: '灵兽数据加载失败' };
  }

  const targetFloor = floor || progress.currentFloor;
  const floorResolution = resolveDemonCaveFloor(targetFloor, beasts.length);
  const monsters = floorResolution.monsters;

  // 模拟战斗（多灵兽）
  const battleResult = simulateBattle(beasts, monsters);

  // 使用第一只灵兽作为代表展示
  const beast = beasts[0];

  return {
    success: true,
    data: {
      beast: {
        id: beast.id,
        name: beast.name,
        level: beast.level,
        element: beast.element[0] || 'none',
        attrs: {
          max_hp: beast.computedAttrs.max_hp,
          atk: beast.computedAttrs.atk,
          def: beast.computedAttrs.def,
          spd: beast.computedAttrs.spd,
          accuracy: beast.computedAttrs.accuracy,
          dodge: beast.computedAttrs.dodge,
          parry: beast.computedAttrs.parry,
          crit_rate: beast.computedAttrs.crit_rate,
          crit_dmg: beast.computedAttrs.crit_dmg,
        },
      },
      monsters: monsters.map((m) => ({
        name: m.name,
        level: m.level,
        element: m.element[0] || 'none',
        attrs: {
          max_hp: m.baseAttrs.max_hp,
          atk: m.baseAttrs.atk,
          def: m.baseAttrs.def,
          spd: m.baseAttrs.spd,
          accuracy: m.baseAttrs.accuracy,
          dodge: m.baseAttrs.dodge,
          parry: m.baseAttrs.parry,
          crit_rate: m.baseAttrs.crit_rate,
          crit_dmg: m.baseAttrs.crit_dmg,
        },
      })),
      battleResult: {
        success: battleResult.success,
        rounds: battleResult.rounds,
        reason: battleResult.reason,
        logs: battleResult.logs.map((log) => ({
          round: log.round,
          message: log.message,
        })),
      },
    },
  };
};
