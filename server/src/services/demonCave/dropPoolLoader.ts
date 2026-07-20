/**
 * 掉落池加载器（锁妖窟用）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/demonCave/drop_pools.json 加载掉落池定义，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 JSON → 校验 id 唯一性 → 构建 Map 索引 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 itemConfigLoader / farmConfigLoader / beastConfigLoader 同模式。
 * - Map 索引 O(1) vs O(n) 查询。
 * - 启动即校验，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在 / JSON 格式错误时直接抛错，启动失败。
 * 2. 必须在应用启动时调用 initDropPoolConfig()。
 * 3. id 必须全局唯一，重复时启动报错。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

export interface DropItem {
  item_id: string;
  rate: number; // 0-1
  min: number;
  max: number;
}

export interface DropPoolConfig {
  id: string;
  name: string;
  drops: DropItem[];
}

// ==================== 内存缓存 ====================

let poolById: Map<string, DropPoolConfig> | null = null;
let allPools: DropPoolConfig[] | null = null;

const SEED_FILE = join(process.cwd(), 'data/seeds/demonCave/drop_pools.json');

// ==================== 初始化 ====================

export const initDropPoolConfig = async (): Promise<void> => {
  const content = await readFile(SEED_FILE, 'utf-8');
  const data = JSON.parse(content) as { pools: DropPoolConfig[] };

  if (!data.pools || !Array.isArray(data.pools)) {
    throw new Error(`[dropPoolLoader] 掉落池文件格式错误: ${SEED_FILE}`);
  }

  // 校验 id 唯一性
  const idSet = new Set<string>();
  for (const pool of data.pools) {
    if (!pool.id) {
      throw new Error(`[dropPoolLoader] 掉落池缺少 id 字段: ${JSON.stringify(pool)}`);
    }
    if (idSet.has(pool.id)) {
      throw new Error(`[dropPoolLoader] 掉落池 id 重复: ${pool.id}`);
    }
    idSet.add(pool.id);
  }

  // 构建 Map 索引
  poolById = new Map(data.pools.map((p) => [p.id, p]));
  allPools = data.pools;

  console.log(`[dropPoolLoader] 加载完成: ${allPools.length} 个掉落池定义`);
};

// ==================== 查询接口 ====================

const ensureLoaded = (): void => {
  if (!poolById || !allPools) {
    throw new Error('[dropPoolLoader] 未初始化，请先调用 initDropPoolConfig()');
  }
};

export const getDropPoolById = (id: string): DropPoolConfig | null => {
  ensureLoaded();
  return poolById!.get(id) ?? null;
};

export const getDropPoolsByIds = (ids: string[]): DropPoolConfig[] => {
  ensureLoaded();
  return ids.map((id) => poolById!.get(id)).filter((p): p is DropPoolConfig => p !== null);
};

export const getAllDropPools = (): DropPoolConfig[] => {
  ensureLoaded();
  return allPools!;
};
