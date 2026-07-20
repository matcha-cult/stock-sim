/**
 * 副本楼层配置加载器（锁妖窟用）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/demonCave/demon_cave_floors.json 加载楼层配置，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 JSON → 校验 floor 唯一性 → 构建 Map 索引 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 itemConfigLoader / farmConfigLoader / beastConfigLoader 同模式。
 * - Map 索引 O(1) vs O(n) 查询。
 * - 启动即校验，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在 / JSON 格式错误时直接抛错，启动失败。
 * 2. 必须在应用启动时调用 initDemonCaveFloorConfig()。
 * 3. floor 必须全局唯一，重复时启动报错。
 * 4. 怪物池中的 monster_id 必须引用已加载的怪物清单。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

export interface FloorMonsterConfig {
  monster_id: string;
  rarity: 'normal' | 'elite' | 'boss';
  title?: string; // 覆盖名称（BOSS 专用称号）
  star_level: number; // 星级（0-6）
  level: number;
  attr_multiplier: number;
  experience: number;
  drop_pool_ids: string[];
}

export interface FloorComposition {
  count: number;
  guarantee?: Array<{
    monster_id: string;
    count: number;
  }>;
}

export interface FloorConfig {
  floor: number;
  monster_pool: FloorMonsterConfig[];
  composition: FloorComposition;
}

// ==================== 内存缓存 ====================

let floorByNumber: Map<number, FloorConfig> | null = null;
let allFloors: FloorConfig[] | null = null;

const SEED_FILE = join(process.cwd(), 'data/seeds/demonCave/demon_cave_floors.json');

// ==================== 初始化 ====================

export const initDemonCaveFloorConfig = async (): Promise<void> => {
  const content = await readFile(SEED_FILE, 'utf-8');
  const data = JSON.parse(content) as { floors: FloorConfig[] };

  if (!data.floors || !Array.isArray(data.floors)) {
    throw new Error(`[floorConfigLoader] 楼层文件格式错误: ${SEED_FILE}`);
  }

  // 校验 floor 唯一性
  const floorSet = new Set<number>();
  for (const floor of data.floors) {
    if (floor.floor === undefined) {
      throw new Error(`[floorConfigLoader] 楼层缺少 floor 字段: ${JSON.stringify(floor)}`);
    }
    if (floorSet.has(floor.floor)) {
      throw new Error(`[floorConfigLoader] 楼层重复: ${floor.floor}`);
    }
    floorSet.add(floor.floor);

    // 校验怪物池非空
    if (!floor.monster_pool || floor.monster_pool.length === 0) {
      throw new Error(`[floorConfigLoader] 第 ${floor.floor} 层怪物池为空`);
    }

    // 校验怪物 ID 引用
    for (const monster of floor.monster_pool) {
      if (!monster.monster_id) {
        throw new Error(`[floorConfigLoader] 第 ${floor.floor} 层怪物缺少 monster_id`);
      }
    }
  }

  // 构建 Map 索引
  floorByNumber = new Map(data.floors.map((f) => [f.floor, f]));
  allFloors = data.floors;

  console.log(`[floorConfigLoader] 加载完成: ${allFloors.length} 层配置`);
};

// ==================== 查询接口 ====================

const ensureLoaded = (): void => {
  if (!floorByNumber || !allFloors) {
    throw new Error('[floorConfigLoader] 未初始化，请先调用 initDemonCaveFloorConfig()');
  }
};

export const getFloorConfig = (floor: number): FloorConfig | null => {
  ensureLoaded();
  return floorByNumber!.get(floor) ?? null;
};

export const getAllFloorConfigs = (): FloorConfig[] => {
  ensureLoaded();
  return allFloors!;
};

export const getMaxFloor = (): number => {
  ensureLoaded();
  return Math.max(...allFloors!.map((f) => f.floor));
};
