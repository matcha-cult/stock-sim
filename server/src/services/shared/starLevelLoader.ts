/**
 * 星级配置加载器
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/star_level_config.json 加载星级定义，提供星级倍率查询
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 JSON → 校验数据完整性 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 itemConfigLoader / farmConfigLoader / beastConfigLoader 同模式。
 * - 数组索引 O(1) 查询（star 值即索引）。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在 / JSON 格式错误时直接抛错，启动失败。
 * 2. 必须在应用启动时调用 initStarLevelConfig()。
 * 3. star 值必须连续（0-6），缺失时启动报错。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

export interface StarLevelConfig {
  star: number;
  name: string;
  attr_multiplier: number;
}

// ==================== 内存缓存 ====================

let starLevels: StarLevelConfig[] | null = null;
let starLevelMap: Map<number, StarLevelConfig> | null = null;

const SEED_FILE = join(process.cwd(), 'data/seeds/star_level_config.json');

// ==================== 初始化 ====================

export const initStarLevelConfig = async (): Promise<void> => {
  const content = await readFile(SEED_FILE, 'utf-8');
  const data = JSON.parse(content) as { star_levels: StarLevelConfig[] };

  if (!data.star_levels || !Array.isArray(data.star_levels)) {
    throw new Error(`[starLevelLoader] 星级配置文件格式错误: ${SEED_FILE}`);
  }

  // 校验 star 值连续性（0-6）
  const expectedStars = [0, 1, 2, 3, 4, 5, 6];
  const actualStars = data.star_levels.map((s) => s.star).sort((a, b) => a - b);

  if (JSON.stringify(actualStars) !== JSON.stringify(expectedStars)) {
    throw new Error(`[starLevelLoader] 星级配置不完整，期望 ${expectedStars}，实际 ${actualStars}`);
  }

  // 缓存
  starLevels = data.star_levels;
  starLevelMap = new Map(data.star_levels.map((s) => [s.star, s]));

  console.log(`[starLevelLoader] 加载完成: ${starLevels.length} 个星级定义`);
};

// ==================== 查询接口 ====================

const ensureLoaded = (): void => {
  if (!starLevels || !starLevelMap) {
    throw new Error('[starLevelLoader] 未初始化，请先调用 initStarLevelConfig()');
  }
};

export const getStarLevelConfig = (star: number): StarLevelConfig | null => {
  ensureLoaded();
  return starLevelMap!.get(star) ?? null;
};

export const getStarLevelMultiplier = (star: number): number => {
  const config = getStarLevelConfig(star);
  return config?.attr_multiplier ?? 1.0;
};

export const getAllStarLevels = (): StarLevelConfig[] => {
  ensureLoaded();
  return starLevels!;
};

export const getMaxStarLevel = (): number => {
  ensureLoaded();
  return starLevels!.length - 1;
};
