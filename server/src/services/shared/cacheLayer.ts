/**
 * 缓存层。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供简单的 Redis 缓存工具（`getCachedValue`/`setCachedValue`/`deleteCachedValue`/`createCacheKey`）。
 * 2. 做什么：提供通用双层缓存工厂 `createCacheLayer<K, T>`（内存 + Redis，支持 loader、并发去重、动态 TTL）。
 * 3. 不做什么：不处理业务逻辑（恢复计算、签名校验等），这些由各服务自行实现。
 *
 * 数据流：
 *   getCachedValue/setCachedValue/deleteCachedValue: 简单 Redis 读写
 *   createCacheLayer get: 内存（TTL 内）→ Redis（TTL 内）→ loader（DB 查询）→ 回填两层
 *   并发 get: 同 key 共享同一次 loader Promise，避免热点 key 在缓存失效瞬间重复打数据库
 *
 * 边界条件：
 * 1) Redis 不可用时，`createCacheLayer` 降级到仅内存缓存 + loader，不抛异常。
 * 2) loader 返回 null 时不缓存（避免缓存穿透需调用方自行处理）。
 * 3) 内存缓存无大小限制，长期运行需关注内存占用（可通过 `invalidateAll` 手动清理）。
 */

import { redis } from '../../config/redis.js';

// ============================================
// 简单 Redis 缓存 API（向后兼容）
// ============================================

export function initCacheLayer(redisClient: typeof redis): void {
  // redis 已全局导出，保留此函数为空操作以兼容旧调用
}

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

export async function deleteCachedValue(key: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.del(key);
  } catch {
    // 缓存删除失败不影响主流程
  }
}

export function createCacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}

// ============================================
// 双层缓存工厂（内存 + Redis）
// ============================================

type CacheKey = string | number;

export interface CacheLayerOptions<K extends CacheKey, T> {
  /** Redis 键前缀（如 'rank:wealth:'） */
  keyPrefix: string;
  /** Redis TTL（秒） */
  redisTtlSec: number;
  /** 内存 TTL（毫秒） */
  memoryTtlMs: number;
  /** 缓存未命中时的数据加载函数，返回 null 表示数据不存在 */
  loader: (key: K) => Promise<T | null>;
  /** 按缓存值动态调整 TTL */
  ttlResolver?: (input: {
    key: K;
    value: T;
    defaultRedisTtlSec: number;
    defaultMemoryTtlMs: number;
  }) => {
    redisTtlSec: number;
    memoryTtlMs: number;
  };
  /** 自定义序列化（默认 JSON.stringify） */
  serialize?: (value: T) => string;
  /** 自定义反序列化（默认 JSON.parse） */
  deserialize?: (raw: string) => T;
}

export interface CacheLayer<K extends CacheKey, T> {
  /** 读取缓存，未命中则调用 loader 加载并回填 */
  get: (key: K) => Promise<T | null>;
  /** 直接设置缓存值（跳过 loader） */
  set: (key: K, value: T) => Promise<void>;
  /** 删除指定 key 的缓存 */
  invalidate: (key: K) => Promise<void>;
  /** 清除所有内存缓存（Redis 缓存依赖 TTL 自然过期） */
  invalidateAll: () => void;
}

/**
 * 创建一个双层缓存实例。
 *
 * 复用点：所有需要 内存+Redis 双层缓存的场景均可使用，
 *   包括角色属性、装备快照、排行榜分页结果、邮件红点计数等。
 *
 * 使用示例：
 *   const wealthCache = createCacheLayer({
 *     keyPrefix: 'rank:wealth:',
 *     redisTtlSec: 30,
 *     memoryTtlMs: 5_000,
 *     loader: (limit) => loadWealthRanks(limit),
 *   });
 *   const data = await wealthCache.get(50);
 */
export function createCacheLayer<K extends CacheKey, T>(
  options: CacheLayerOptions<K, T>,
): CacheLayer<K, T> {
  const {
    keyPrefix,
    redisTtlSec,
    memoryTtlMs,
    loader,
    ttlResolver,
    serialize = JSON.stringify,
    deserialize = JSON.parse as (raw: string) => T,
  } = options;

  const memoryCache = new Map<K, { payload: T; expiresAt: number }>();
  const inFlightLoads = new Map<K, Promise<T | null>>();

  function redisKey(key: K): string {
    return `${keyPrefix}${String(key)}`;
  }

  function resolveEntryTtl(key: K, value: T): { redisTtlSec: number; memoryTtlMs: number } {
    const resolvedTtl = ttlResolver
      ? ttlResolver({
          key,
          value,
          defaultRedisTtlSec: redisTtlSec,
          defaultMemoryTtlMs: memoryTtlMs,
        })
      : {
          redisTtlSec,
          memoryTtlMs,
        };

    return {
      redisTtlSec: Math.max(1, Math.floor(resolvedTtl.redisTtlSec)),
      memoryTtlMs: Math.max(1, Math.floor(resolvedTtl.memoryTtlMs)),
    };
  }

  async function get(key: K): Promise<T | null> {
    // 1. 内存层
    const mem = memoryCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      return mem.payload;
    }
    // 内存过期则删除
    if (mem) memoryCache.delete(key);

    // 2. Redis 层
    try {
      const raw = await redis.get(redisKey(key));
      if (raw !== null) {
        const value = deserialize(raw);
        const entryTtl = resolveEntryTtl(key, value);
        memoryCache.set(key, { payload: value, expiresAt: Date.now() + entryTtl.memoryTtlMs });
        return value;
      }
    } catch {
      // Redis 不可用，继续走 loader
    }

    // 3. Loader（DB 查询）
    // 同 key 并发 miss 时复用同一个 loader Promise，避免热点 key 瞬时击穿数据库
    const inFlight = inFlightLoads.get(key);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = (async (): Promise<T | null> => {
      const loaded = await loader(key);
      if (loaded === null) return null;
      const entryTtl = resolveEntryTtl(key, loaded);

      // 回填两层
      memoryCache.set(key, { payload: loaded, expiresAt: Date.now() + entryTtl.memoryTtlMs });
      try {
        await redis.set(redisKey(key), serialize(loaded), 'EX', entryTtl.redisTtlSec);
      } catch {
        // Redis 不可用时仅保留内存缓存
      }

      return loaded;
    })();

    inFlightLoads.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      if (inFlightLoads.get(key) === loadPromise) {
        inFlightLoads.delete(key);
      }
    }
  }

  async function set(key: K, value: T): Promise<void> {
    const entryTtl = resolveEntryTtl(key, value);
    memoryCache.set(key, { payload: value, expiresAt: Date.now() + entryTtl.memoryTtlMs });
    inFlightLoads.delete(key);
    try {
      await redis.set(redisKey(key), serialize(value), 'EX', entryTtl.redisTtlSec);
    } catch {
      // Redis 不可用时仅保留内存缓存
    }
  }

  async function invalidate(key: K): Promise<void> {
    memoryCache.delete(key);
    inFlightLoads.delete(key);
    try {
      await redis.del(redisKey(key));
    } catch {
      // 忽略
    }
  }

  function invalidateAll(): void {
    memoryCache.clear();
    inFlightLoads.clear();
  }

  return { get, set, invalidate, invalidateAll };
}
