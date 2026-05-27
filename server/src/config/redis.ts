/**
 * Redis 客户端配置（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：创建 Redis 连接，提供 ping/quit 方法。
 * 2. 不做什么：不做复杂的重连策略、错误处理。
 *
 * 输入 / 输出：
 * - 输入：环境变量 REDIS_URL。
 * - 输出：Redis 客户端实例。
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// 创建 Redis 客户端
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },
});

redis.on('connect', () => {
  console.log('✓ Redis 连接成功');
});

redis.on('error', (err: Error) => {
  console.error('✗ Redis 连接错误:', err.message);
});

redis.on('close', () => {
  console.log('Redis 连接已关闭');
});

/**
 * 测试 Redis 连接
 */
export const testRedisConnection = async (): Promise<boolean> => {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    console.error('Redis 连接测试失败:', error);
    return false;
  }
};

/**
 * 关闭 Redis 连接
 */
export const closeRedis = async (): Promise<void> => {
  await redis.quit();
};
