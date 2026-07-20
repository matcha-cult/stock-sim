/**
 * 锁妖窟挂机战斗队列
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理挂机战斗的异步任务队列（流处理模式）
 * 2. 不做什么：不处理战斗计算逻辑（由 Worker 处理）
 *
 * 数据流 / 状态流：
 * 开始挂机 -> 添加重复任务（每 1.5 秒）-> Worker 逐场处理 -> 写入战斗日志
 * 停止挂机 -> 移除重复任务
 *
 * 关键边界条件与坑点：
 * 1. 使用 BullMQ 的重复任务实现实时挂机
 * 2. 每场战斗独立处理，实时写入数据库
 * 3. 使用 Redis 持久化，服务重启不丢失任务
 */

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import type { BeastDetailDto } from '../beast/shared/beastView.js';
import type { MonsterData } from './algorithm.js';

// ==================== 任务数据类型 ====================

export interface IdleBattleJobData {
  characterId: number;
  beastId: number; // 主灵兽 ID（用于兼容，后续可移除）
  idleFloor: number;
  historyId: number;
  beast?: BeastDetailDto; // 单灵兽模式（向后兼容）
  beasts?: BeastDetailDto[]; // 多灵兽模式
  monsters: MonsterData[];
}

export interface IdleBattleJobResult {
  characterId: number;
  beastId: number;
  battleIndex: number;
  result: 'victory' | 'defeat' | 'timeout';
  rounds: number;
  experience: string;
  battleLogs?: Array<{
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
}

// ==================== 队列配置 ====================

const IDLE_BATTLE_QUEUE_NAME = 'demon-cave-idle-battles';

/**
 * 创建 BullMQ 专用的 Redis 连接
 */
const createBullMqConnection = (): IORedis => {
  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ 需要这个设置
  });
};

let queueConnection: IORedis | null = null;

/**
 * 获取或创建队列连接
 */
const getQueueConnection = (): IORedis => {
  if (!queueConnection) {
    queueConnection = createBullMqConnection();
  }
  return queueConnection;
};

/**
 * 创建挂机战斗队列
 */
export const idleBattleQueue = new Queue<IdleBattleJobData, IdleBattleJobResult>(
  IDLE_BATTLE_QUEUE_NAME,
  {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 3, // 最多重试 3 次
      backoff: {
        type: 'exponential', // 指数退避
        delay: 2000, // 初始延迟 2 秒
      },
      removeOnComplete: {
        age: 3600, // 1 小时后删除已完成任务
        count: 1000, // 最多保留 1000 个已完成任务
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // 7 天后删除失败任务
      },
    },
  },
);

/**
 * 添加单次战斗任务并等待结果
 */
export const addSingleBattleJob = async (
  data: IdleBattleJobData,
): Promise<IdleBattleJobResult | null> => {
  const jobName = `single-${data.characterId}-${Date.now()}`;

  const job = await idleBattleQueue.add(jobName, data, {
    removeOnComplete: 1000, // 完成后保留 1 秒（给 waitUntilFinished 足够时间）
    removeOnFail: 1000,
  });

  // 创建 QueueEvents 实例来等待任务完成
  const queueEvents = new QueueEvents(IDLE_BATTLE_QUEUE_NAME, {
    connection: getQueueConnection(),
  });

  try {
    // 等待任务完成（最多等待 10 秒）
    const result = await job.waitUntilFinished(queueEvents, 10000);
    return result as IdleBattleJobResult | null;
  } finally {
    await queueEvents.close();
  }
};

/**
 * 添加重复任务（固定间隔，已弃用，改用动态调度）
 * @deprecated 使用 addIdleNextJob 替代，根据战斗结果动态计算间隔
 */
export const addIdleRepeatJob = async (
  data: IdleBattleJobData,
): Promise<string> => {
  const repeatJobName = `idle-${data.characterId}-${data.historyId}`;

  await idleBattleQueue.add(repeatJobName, data, {
    repeat: {
      every: 1500, // 每 1.5 秒执行一次
    },
  });

  return repeatJobName;
};

/**
 * 添加下一场战斗任务（动态延迟）
 *
 * 根据上一场战斗的回合数计算下一场战斗的延迟时间
 * 战力高的玩家回合少、战斗快、效率高
 *
 * @param data 战斗数据
 * @param lastRounds 上一场战斗的回合数（用于计算延迟）
 */
export const addIdleNextJob = async (
  data: IdleBattleJobData,
  lastRounds: number,
): Promise<string> => {
  const jobName = `idle-${data.characterId}-${data.historyId}-next`;

  // 计算战斗耗时：回合数 × 每回合时间 + 固定间隔
  const ROUND_DURATION_MS = 500; // 每回合 0.5 秒
  const PREPARATION_INTERVAL_MS = 500; // 战斗准备间隔 0.5 秒
  const delayMs = lastRounds * ROUND_DURATION_MS + PREPARATION_INTERVAL_MS;

  await idleBattleQueue.add(jobName, data, {
    delay: delayMs, // 动态延迟
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });

  return jobName;
};

/**
 * 移除挂机任务（支持动态调度模式）
 * 查找并移除所有与指定 characterId 和 historyId 相关的任务
 */
export const removeIdleRepeatJob = async (
  characterId: number,
  historyId: number,
): Promise<void> => {
  const jobNamePrefix = `idle-${characterId}-${historyId}`;
  try {
    // 1. 获取所有可重复的任务（兼容旧模式）
    const repeatableJobs = await idleBattleQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name.startsWith(jobNamePrefix)) {
        await idleBattleQueue.removeRepeatableByKey(job.key);
        console.log(`[IdleQueue] 移除重复任务配置: ${job.key}`);
      }
    }

    // 2. 清理延迟队列中的所有相关任务（新模式）
    const delayedJobs = await idleBattleQueue.getJobs(['delayed', 'waiting']);
    let removedCount = 0;
    for (const job of delayedJobs) {
      if (job.name.startsWith(jobNamePrefix)) {
        await job.remove();
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[IdleQueue] 移除了 ${removedCount} 个待处理任务`);
    }

    console.log(`[IdleQueue] 已完成挂机任务清理: ${jobNamePrefix}`);
  } catch (error) {
    console.error(`[IdleQueue] 移除挂机任务失败:`, error);
  }
};

/**
 * 从 Worker 内部移除挂机任务
 */
export const removeIdleRepeatJobFromWorker = async (
  characterId: number,
  historyId: number,
): Promise<void> => {
  const jobNamePrefix = `idle-${characterId}-${historyId}`;
  try {
    // 1. 获取所有可重复的任务（兼容旧模式）
    const repeatableJobs = await idleBattleQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name.startsWith(jobNamePrefix)) {
        await idleBattleQueue.removeRepeatableByKey(job.key);
        console.log(`[IdleWorker] 移除重复任务配置: ${job.key}`);
      }
    }

    // 2. 清理延迟队列中的所有相关任务（新模式）
    const delayedJobs = await idleBattleQueue.getJobs(['delayed', 'waiting']);
    let removedCount = 0;
    for (const job of delayedJobs) {
      if (job.name.startsWith(jobNamePrefix)) {
        await job.remove();
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`[IdleWorker] 移除了 ${removedCount} 个待处理任务`);
    }

    console.log(`[IdleWorker] 已完成挂机任务清理: ${jobNamePrefix}`);
  } catch (error) {
    console.error(`[IdleWorker] 移除挂机任务失败:`, error);
  }
};

/**
 * 关闭队列
 */
export const closeIdleBattleQueue = async (): Promise<void> => {
  await idleBattleQueue.close();
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
};
