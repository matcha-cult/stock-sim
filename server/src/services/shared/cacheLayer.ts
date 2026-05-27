/**
 * 缓存层（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供简单的内存缓存功能，用于角色ID查询缓存。
 * 2. 不做什么：不处理 Redis 缓存，不处理复杂缓存策略。
 *
 * 输入 / 输出：
 * - 输入：缓存键、缓存值、过期时间。
 * - 输出：缓存值或 null。
 */
import { Redis } from 'ioredis';

let redis: Redis | null = null;

/**
 * 初始化 Redis 客户端。
 */
export function initCacheLayer(redisClient: Redis): void {
  redis = redisClient;
}

/**
 * 获取缓存值。
 */
export async function getCachedValue<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * 设置缓存值。
 */
export async function setCachedValue<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  if (!redis) return;

  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
  } catch {
    // 缓存失败不影响主流程
  }
}

/**
 * 删除缓存值。
 */
export async function deleteCachedValue(key: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(key);
  } catch {
    // 缓存删除失败不影响主流程
  }
}

/**
 * 生成缓存键。
 */
export function createCacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}