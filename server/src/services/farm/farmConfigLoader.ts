/**
 * 灵田 V3 静态配置加载器（纯内存，Map 索引）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/farm/ 目录加载 4 个 JSON 配置到内存，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做种子 UPSERT、不做热更新、不持久化。
 *
 * 输入 / 输出：
 * - 输入：crops.json / seeds.json / hybridRecipes.json / plots.json
 * - 输出：内存缓存，通过 getXxxConfig() 同步获取。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 → 构建 Map 索引 → 交叉校验 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 industryConfigLoader 同模式，使用 Map 索引（O(1) vs O(n)）。
 * - 校验规则严格：启动即报错，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时抛错，因为灵田配置是核心依赖。
 * 2. 启动顺序：必须在 farmRoutes 注册前调用 initFarmConfig()。
 * 3. V3 杂交配方按灵根元素组合索引，而非按 cropId。
 * 4. V3 引入等级（Level）和等阶（Tier）两个独立维度。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  type CropConfig,
  type SeedConfig,
  type HybridRecipeConfig,
  type PlotsConfig,
  type FarmTierConfig,
  type CropElement,
} from './farmTypes.js';

// ── 内存缓存 ──

let cropById: Map<string, CropConfig> | null = null;
let seedByItemId: Map<string, SeedConfig> | null = null;
/** 按 baseCropId 分组的配方索引 */
let recipesByBaseCrop: Map<string, HybridRecipeConfig[]> | null = null;
let plotsConfig: PlotsConfig | null = null;
let tierByTier: Map<number, FarmTierConfig> | null = null;

const SEED_DIR = join(process.cwd(), 'data/seeds/farm');

// ── 通用 JSON 加载器 ──

async function loadJsonFile<T>(filename: string): Promise<T> {
  const content = await readFile(join(SEED_DIR, filename), 'utf-8');
  return JSON.parse(content) as T;
}

// ── 初始化 ──

export async function initFarmConfig(): Promise<void> {
  const [cropsRaw, seedsRaw, recipesRaw, plotsRaw] = await Promise.all([
    loadJsonFile<{ crops: CropConfig[] }>('crops.json'),
    loadJsonFile<{ seeds: SeedConfig[] }>('seeds.json'),
    loadJsonFile<{ recipes: HybridRecipeConfig[] }>('hybridRecipes.json'),
    loadJsonFile<PlotsConfig>('plots.json'),
  ]);

  const crops = cropsRaw.crops.filter((c) => c.enabled);
  const seeds = seedsRaw.seeds.filter((s) => s.enabled);
  const recipes = recipesRaw.recipes.filter((r) => r.enabled);

  cropById = new Map(crops.map((c) => [c.cropId, c]));
  seedByItemId = new Map(seeds.map((s) => [s.itemId, s]));

  // 按 baseCropId 分组索引配方
  const recipeMap = new Map<string, HybridRecipeConfig[]>();
  for (const r of recipes) {
    const list = recipeMap.get(r.baseCropId) ?? [];
    list.push(r);
    recipeMap.set(r.baseCropId, list);
  }
  // 每个 baseCropId 下的配方按 sortOrder 升序排序（用于多配方匹配时的优先级）
  for (const list of recipeMap.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  recipesByBaseCrop = recipeMap;

  plotsConfig = plotsRaw;
  tierByTier = new Map(plotsRaw.farmTiers.map((t) => [t.tier, t]));

  validateConfig(crops, seeds, recipes, plotsRaw);
}

// ── 交叉校验（启动即报错）──

function validateConfig(
  crops: CropConfig[],
  seeds: SeedConfig[],
  recipes: HybridRecipeConfig[],
  plots: PlotsConfig,
): void {
  const errors: string[] = [];

  // cropId 唯一
  const cropIds = new Set<string>();
  for (const c of crops) {
    if (cropIds.has(c.cropId)) errors.push(`重复 cropId: ${c.cropId}`);
    cropIds.add(c.cropId);
  }

  // itemId 唯一
  const itemIds = new Set<string>();
  for (const s of seeds) {
    if (itemIds.has(s.itemId)) errors.push(`重复 itemId: ${s.itemId}`);
    itemIds.add(s.itemId);
  }

  // seedItemId 引用
  for (const c of crops) {
    if (!seedByItemId!.has(c.seedItemId)) {
      errors.push(`crop ${c.cropId} 引用不存在的 seedItemId: ${c.seedItemId}`);
    }
  }

  // seed→crop 反向引用
  for (const s of seeds) {
    if (!cropById!.has(s.cropId)) {
      errors.push(`seed ${s.itemId} 引用不存在的 cropId: ${s.cropId}`);
    }
  }

  // stageLabels 长度 === growthStageMinutes 长度
  for (const c of crops) {
    if (c.stageLabels.length !== c.growthStageMinutes.length) {
      errors.push(
        `crop ${c.cropId}: stageLabels.length(${c.stageLabels.length}) !== growthStageMinutes.length(${c.growthStageMinutes.length})`,
      );
    }
  }

  // 杂交配方引用校验
  for (const r of recipes) {
    // baseCropId 必须存在
    if (!cropById!.has(r.baseCropId)) {
      errors.push(`recipe ${r.recipeId}: baseCropId ${r.baseCropId} 不存在`);
    }
    // requiredAdjacent 校验（新格式）
    for (const req of r.requiredAdjacent) {
      if (req.type === 'elementCondition') {
        // elementCondition 类型：检查 conditionId 是否合法
        const validConditions = ['single_element_invasion', 'dual_element_generation', 'wu_xing_gui_yuan'];
        if (!validConditions.includes(req.conditionId)) {
          errors.push(`recipe ${r.recipeId}: 未知的 conditionId ${req.conditionId}`);
        }
        // 单元素条件必须有 element 参数
        if (req.conditionId === 'single_element_invasion' && !req.element) {
          errors.push(`recipe ${r.recipeId}: single_element_invasion 必须指定 element`);
        }
        // 双元素条件必须有 elements 参数
        if (req.conditionId === 'dual_element_generation' && (!req.elements || req.elements.length !== 2)) {
          errors.push(`recipe ${r.recipeId}: dual_element_generation 必须指定 2 个元素`);
        }
      }
    }
    // resultCropId 必须存在
    if (!cropById!.has(r.resultCropId)) {
      errors.push(`recipe ${r.recipeId}: resultCropId ${r.resultCropId} 不存在`);
    }
    // resultSeedItemId 必须存在
    if (!seedByItemId!.has(r.resultSeedItemId)) {
      errors.push(`recipe ${r.recipeId}: resultSeedItemId ${r.resultSeedItemId} 不存在`);
    }
  }

  // farmTier 连续性（1-4）
  const tiers = [...plots.farmTiers].sort((a, b) => a.tier - b.tier);
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].tier !== i + 1) {
      errors.push(`farmTier 不连续：期望 tier ${i + 1}，实际 ${tiers[i].tier}`);
    }
  }

  // farmTier minLevel 递增
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minLevel <= tiers[i - 1].minLevel) {
      errors.push(`farmTier ${tiers[i].tier} 的 minLevel(${tiers[i].minLevel}) 必须大于 ${tiers[i - 1].tier} 的 minLevel(${tiers[i - 1].minLevel})`);
    }
  }

  // initialSeeds 引用校验
  for (const initSeed of plots.initialSeeds) {
    if (!seedByItemId!.has(initSeed.itemId)) {
      errors.push(`initialSeeds 引用不存在的 itemId: ${initSeed.itemId}`);
    }
  }

  // grid 配置校验
  const { grid } = plots;
  if (grid.initialCols !== grid.fixedCols) {
    errors.push(`grid.initialCols(${grid.initialCols}) 必须等于 grid.fixedCols(${grid.fixedCols})`);
  }
  if (grid.initialRows > grid.maxRows) {
    errors.push(`grid.initialRows(${grid.initialRows}) 不能大于 grid.maxRows(${grid.maxRows})`);
  }

  if (errors.length > 0) {
    throw new Error(`灵田配置校验失败:\n${errors.join('\n')}`);
  }
}

// ── 同步获取 ──

export function getCropConfig(cropId: string): CropConfig | undefined {
  return cropById?.get(cropId);
}

export function getSeedConfig(itemId: string): SeedConfig | undefined {
  return seedByItemId?.get(itemId);
}

/** 获取等阶配置（V3：替代原 getFarmLevelConfig） */
export function getFarmTierConfig(tier: number): FarmTierConfig | undefined {
  return tierByTier?.get(tier);
}

export function getPlotsConfig(): PlotsConfig {
  return plotsConfig!;
}

export function getGridConfig() {
  const grid = plotsConfig!.grid;
  // 支持通过环境变量覆盖 maxRows，便于开发/测试调整灵田大小
  const envMaxRows = process.env.FARM_MAX_ROWS;
  if (envMaxRows) {
    const parsed = parseInt(envMaxRows, 10);
    if (!isNaN(parsed) && parsed >= grid.initialRows) {
      return { ...grid, maxRows: parsed };
    }
  }
  return grid;
}

/** 获取息壤配置（全局统一） */
export function getXiRangConfig() {
  return plotsConfig!.xiRang;
}

/** 获取格子开垦配置 */
export function getCellReclaimConfig() {
  return plotsConfig!.cellReclaim;
}

/** 获取初始种子配置 */
export function getInitialSeeds() {
  return plotsConfig!.initialSeeds;
}

export function getMutationConfig() {
  return plotsConfig!.mutation;
}

export function getQualityConfig() {
  return plotsConfig!.quality;
}

export function getAccelerationMultiplier(): number {
  const envValue = process.env.FARM_ACCELERATION_MULTIPLIER;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return plotsConfig?.accelerationMultiplier ?? 1.0;
}

export function getAllCrops(): readonly CropConfig[] {
  return cropById ? [...cropById.values()].sort((a, b) => a.sortOrder - b.sortOrder) : [];
}

export function getAllSeeds(): readonly SeedConfig[] {
  return seedByItemId ? [...seedByItemId.values()].sort((a, b) => a.sortOrder - b.sortOrder) : [];
}

export function getAllRecipes(): readonly HybridRecipeConfig[] {
  if (!recipesByBaseCrop) return [];
  const all: HybridRecipeConfig[] = [];
  for (const list of recipesByBaseCrop.values()) {
    all.push(...list);
  }
  return all.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 按 baseCropId 获取配方列表（O(1) 索引查询）。
 * 返回的列表已按 sortOrder 升序排序。
 */
export function getRecipesByBaseCrop(baseCropId: string): readonly HybridRecipeConfig[] {
  return recipesByBaseCrop?.get(baseCropId) ?? [];
}

/** 获取所有等阶配置（按 tier 升序） */
export function getAllFarmTiers(): readonly FarmTierConfig[] {
  return tierByTier ? [...tierByTier.values()].sort((a, b) => a.tier - b.tier) : [];
}
