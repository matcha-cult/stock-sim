/**
 * 锁妖窟挂机战斗 Worker
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：消费挂机战斗任务队列，执行单场战斗模拟和奖励发放（流处理模式）
 * 2. 不做什么：不处理 HTTP 请求（由 API 层处理）
 *
 * 数据流 / 状态流：
 * 重复任务（每 1.5 秒）-> Worker 消费 -> 模拟单场战斗 -> 写入战斗日志 -> 更新统计
 *
 * 关键边界条件与坑点：
 * 1. 每场战斗独立处理，实时写入数据库
 * 2. Worker 在独立模块中启动，与 API 进程分离（可选）
 * 3. 使用事务确保经验发放和记录保存的原子性
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { query } from '../../config/database.js';
import { simulateBattle } from './battleSimulation.js';
import { calculateExperience, addBeastExperience } from './experienceReward.js';
import { resolveDemonCaveFloor } from './algorithm.js';
import { removeIdleRepeatJobFromWorker, addIdleNextJob } from './idleBattleQueue.js';
import type { IdleBattleJobData, IdleBattleJobResult } from './idleBattleQueue.js';
import { calcBattleDrops, distributeDrops } from './dropService.js';

// ==================== Worker 配置 ====================

const IDLE_BATTLE_QUEUE_NAME = 'demon-cave-idle-battles';

/** 调试开关：仅开启时输出处理战斗 / 战斗完成 / 任务完成的高频日志 */
const IDLE_WORKER_DEBUG = process.env.IDLE_WORKER_DEBUG === 'true';
const debugLog = (...args: unknown[]) => {
  if (IDLE_WORKER_DEBUG) console.log(...args);
};

/**
 * 创建 BullMQ 专用的 Redis 连接
 * BullMQ 需要独立的连接，不能复用现有的 Redis 实例
 */
const createBullMqConnection = (): IORedis => {
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ 需要这个设置
  });
};

/**
 * 处理单场挂机战斗
 */
const processIdleBattle = async (
  job: Job<IdleBattleJobData, IdleBattleJobResult>,
): Promise<IdleBattleJobResult> => {
  const {
    characterId,
    beastId,
    idleFloor,
    historyId,
    beast,
    beasts,
    monsters,
  } = job.data;

  const isChallengeMode = historyId === 0;

  // 支持多灵兽和单灵兽模式
  const beastList = beasts || (beast ? [beast] : []);
  if (beastList.length === 0) {
    console.error(`[IdleWorker] 无灵兽数据，无法战斗`);
    return {
      characterId,
      beastId,
      battleIndex: 0,
      result: 'timeout',
      rounds: 0,
      experience: '0',
    };
  }

  // 非挑战模式：检查历史记录是否存在且状态为 active
  if (!isChallengeMode) {
    const historyCheck = await query<{ id: number; status: string }>(
      `SELECT id, status FROM demon_cave_idle_history WHERE id = $1`,
      [historyId],
    );

    if (historyCheck.rows.length === 0 || historyCheck.rows[0].status !== 'active') {
      // 历史记录不存在或已结束，移除重复任务并直接完成
      console.log(`[IdleWorker] 历史记录 ${historyId} 不存在或已结束，移除重复任务`);

      // 移除重复任务
      await removeIdleRepeatJobFromWorker(characterId, historyId);

      // 直接完成任务，不抛出错误（避免重试）
      return {
        characterId,
        beastId,
        battleIndex: 0,
        result: 'timeout',
        rounds: 0,
        experience: '0',
      };
    }
  }

  // 获取当前战斗次数（作为 battle_index）
  let battleIndex = 1;
  if (!isChallengeMode) {
    const battleCountResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM demon_cave_idle_battle_log WHERE history_id = $1`,
      [historyId],
    );
    battleIndex = Number(battleCountResult.rows[0].count) + 1;
  }

  //debugLog(`[IdleWorker] 处理战斗：角色 ${characterId}，楼层 ${idleFloor}，第 ${battleIndex} 场，灵兽 ${beastList.length} 只${isChallengeMode ? '（挑战模式）' : ''}`);
  //debugLog(`[IdleWorker] 怪物数据：${monsters.length} 只，名称：${monsters.map(m => m.name).join(', ')}`);
  //debugLog(`[IdleWorker] 灵兽战力：${beastList.map(b => `${b.name}(HP:${b.computedAttrs.max_hp},ATK:${b.computedAttrs.atk})`).join(', ')}`);
  //debugLog(`[IdleWorker] 怪物战力：${monsters.map(m => `${m.name}(HP:${m.baseAttrs.max_hp},ATK:${m.baseAttrs.atk})`).join(', ')}`);

  // 模拟战斗（多灵兽 vs 多怪物）
  const battleResult = simulateBattle(beastList, monsters);

  let result: 'victory' | 'defeat' | 'timeout';
  let exp = BigInt(0);

  if (battleResult.success) {
    result = 'victory';
    // 计算经验（按怪物叠加，经验值来自楼层配置）
    exp = calculateExperience(monsters);
  } else if (battleResult.reason === 'timeout') {
    result = 'timeout';
  } else {
    result = 'defeat';
  }

  // 非挑战模式：写入战斗日志
  if (!isChallengeMode) {
    await query(
      `INSERT INTO demon_cave_idle_battle_log (
        history_id, battle_index, result, rounds, experience, battle_logs
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        historyId,
        battleIndex,
        result,
        battleResult.rounds,
        exp.toString(),
        JSON.stringify(battleResult.logs),
      ],
    );
  }

  // 发放经验给所有灵兽（实时结算）
  if (exp > BigInt(0)) {
    const expPerBeast = exp / BigInt(beastList.length);
    for (const beastDetail of beastList) {
      await addBeastExperience(beastDetail.id, expPerBeast);
    }
  }

  // 发放掉落（胜利时）
  if (result === 'victory') {
    const battleDrops = calcBattleDrops(monsters);
    if (battleDrops.drops.length > 0) {
      await distributeDrops(
        characterId,
        battleDrops.drops,
        idleFloor,
        'idle',
        isChallengeMode ? undefined : historyId,
      );
      debugLog(`[IdleWorker] 掉落：${battleDrops.drops.map(d => `${d.itemId}×${d.quantity}`).join(', ')}`);
    }
  }

  // 非挑战模式：更新历史记录的统计数据
  if (!isChallengeMode) {
    await query(
      `UPDATE demon_cave_idle_history
       SET total_battles = COALESCE(total_battles, 0) + 1,
           victory_count = victory_count + $1,
           defeat_count = defeat_count + $2,
           timeout_count = timeout_count + $3,
           total_experience = total_experience + $4
       WHERE id = $5`,
      [
        result === 'victory' ? 1 : 0,
        result === 'defeat' ? 1 : 0,
        result === 'timeout' ? 1 : 0,
        exp.toString(),
        historyId,
      ],
    );

    // 添加下一场战斗任务（动态延迟）
    // 检查历史记录是否仍为 active 状态（可能在战斗过程中被停止）
    const historyStatus = await query<{ status: string }>(
      `SELECT status FROM demon_cave_idle_history WHERE id = $1`,
      [historyId],
    );

    if (historyStatus.rows.length > 0 && historyStatus.rows[0].status === 'active') {
      await addIdleNextJob(job.data, battleResult.rounds);
    }
  }

  debugLog(
    `[IdleWorker] 战斗完成：角色 ${characterId}，第 ${battleIndex} 场，结果 ${result}，经验 ${exp}`,
  );

  return {
    characterId,
    beastId,
    battleIndex,
    result,
    rounds: battleResult.rounds,
    experience: exp.toString(),
    battleLogs: battleResult.logs,
  };
};

// ==================== Worker 实例 ====================

let idleBattleWorker: Worker<IdleBattleJobData, IdleBattleJobResult> | null = null;
let workerConnection: IORedis | null = null;

/**
 * 启动挂机战斗 Worker
 */
export const startIdleBattleWorker = (): void => {
  if (idleBattleWorker) {
    console.log('[IdleWorker] Worker 已在运行中');
    return;
  }

  // 创建专用的 Redis 连接
  workerConnection = createBullMqConnection();

  idleBattleWorker = new Worker<IdleBattleJobData, IdleBattleJobResult>(
    IDLE_BATTLE_QUEUE_NAME,
    processIdleBattle,
    {
      connection: workerConnection,
      concurrency: 5, // 同时处理 5 个任务
      limiter: {
        max: 10, // 每秒最多处理 10 个任务
        duration: 1000,
      },
    },
  );

  idleBattleWorker.on('completed', (job) => {
    debugLog(`[IdleWorker] 任务完成：${job.id}`);
  });

  idleBattleWorker.on('failed', (job, err) => {
    console.error(`[IdleWorker] 任务失败：${job?.id}`, err.message);
  });

  idleBattleWorker.on('error', (err) => {
    console.error('[IdleWorker] Worker 错误:', err.message);
  });

  console.log('[IdleWorker] Worker 已启动');
};

/**
 * 关闭挂机战斗 Worker
 */
export const stopIdleBattleWorker = async (): Promise<void> => {
  if (!idleBattleWorker) {
    return;
  }

  console.log('[IdleWorker] 正在关闭 Worker...');
  await idleBattleWorker.close();
  idleBattleWorker = null;

  // 关闭专用的 Redis 连接
  if (workerConnection) {
    await workerConnection.quit();
    workerConnection = null;
  }

  console.log('[IdleWorker] Worker 已关闭');
};

/**
 * 获取 Worker 实例（用于测试或监控）
 */
export const getIdleBattleWorker = (): Worker<IdleBattleJobData, IdleBattleJobResult> | null => {
  return idleBattleWorker;
};
