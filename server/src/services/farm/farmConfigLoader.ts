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
let cropIdsByElement: Map<CropElement, string[]> | null = null;

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

  // 按灵根元素分组索引（用于杂交配方查找时快速获取同元素作物列表）
  const elementMap = new Map<CropElement, string[]>();
  for (const c of crops) {
    // 一个作物可能有多个元素（如双属性杂交产物）
    for (const elem of c.element) {
      const list = elementMap.get(elem) ?? [];
      list.push(c.cropId);
      elementMap.set(elem, list);
    }
  }
  cropIdsByElement = elementMap;

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
    // requiredCrops 中的每个 cropId 必须存在
    for (const reqCrop of r.requiredCrops) {
      if (!cropById!.has(reqCrop)) {
        errors.push(`recipe ${r.recipeId}: requiredCrops 中的 ${reqCrop} 不存在`);
      }
    }
    // minRequired 校验（如果设置）
    if (r.minRequired !== undefined) {
      if (r.minRequired < 1) {
        errors.push(`recipe ${r.recipeId}: minRequired(${r.minRequired}) 必须 >= 1`);
      }
      if (r.minRequired > r.requiredCrops.length) {
        errors.push(`recipe ${r.recipeId}: minRequired(${r.minRequired}) 不能大于 requiredCrops.length(${r.requiredCrops.length})`);
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

export function findHybridRecipe(elementA: CropElement, elementB: CropElement): HybridRecipeConfig | undefined {
  // 此函数已废弃，使用 findMatchingRecipe 代替
  return undefined;
}

/**
 * 根据基础作物和相邻作物集合，查找匹配的杂交配方。
 * 匹配逻辑：
 * - 如果配方设置了 minRequired：相邻作物中满足 requiredCrops 的数量 >= minRequired
 * - 如果配方未设置 minRequired：requiredCrops 是 adjacentCropIds 的子集（全部满足）
 * 多配方匹配时，按产物 rarity 降序排序，选择优先级最高的。
 *
 * @param baseCropId 新种作物的 cropId
 * @param adjacentCropIds 相邻作物的 cropId 集合
 * @returns 匹配的配方，或 undefined
 */
export function findMatchingRecipe(
  baseCropId: string,
  adjacentCropIds: Set<string>,
): HybridRecipeConfig | undefined {
  const recipes = recipesByBaseCrop?.get(baseCropId);
  if (!recipes || recipes.length === 0) return undefined;

  // 筛选出匹配的配方
  const matchingRecipes: HybridRecipeConfig[] = [];
  for (const recipe of recipes) {
    // 计算相邻作物中有多少个在 requiredCrops 中
    let matchCount = 0;
    for (const req of recipe.requiredCrops) {
      if (adjacentCropIds.has(req)) {
        matchCount++;
      }
    }
    // 判断是否满足配方要求
    const minRequired = recipe.minRequired ?? recipe.requiredCrops.length;
    if (matchCount >= minRequired) {
      matchingRecipes.push(recipe);
    }
  }

  if (matchingRecipes.length === 0) return undefined;

  // 多配方匹配时，按产物 rarity 降序排序
  const rarityOrder: Record<string, number> = {
    legendary: 5,
    epic: 4,
    rare: 3,
    uncommon: 2,
    common: 1,
  };

  matchingRecipes.sort((a, b) => {
    const cropA = cropById?.get(a.resultCropId);
    const cropB = cropById?.get(b.resultCropId);
    const rarityA = cropA ? (rarityOrder[cropA.rarity] ?? 0) : 0;
    const rarityB = cropB ? (rarityOrder[cropB.rarity] ?? 0) : 0;
    // 降序：rarity 高的优先
    if (rarityA !== rarityB) return rarityB - rarityA;
    // rarity 相同，按 sortOrder 升序
    return a.sortOrder - b.sortOrder;
  });

  return matchingRecipes[0];
}

/**
 * 根据基础作物和相邻作物集合，查找最佳匹配配方（稀有度最高）。
 * 与 findMatchingRecipe 相同，但显式返回稀有度最高的配方。
 *
 * @param baseCropId 基础作物的 cropId
 * @param adjacentCropIds 相邻作物的 cropId 集合
 * @returns 最佳匹配配方，或 undefined
 */
export function findBestMatchingRecipe(
  baseCropId: string,
  adjacentCropIds: Set<string>,
): HybridRecipeConfig | undefined {
  // 复用 findMatchingRecipe 的逻辑，它已经返回稀有度最高的配方
  return findMatchingRecipe(baseCropId, adjacentCropIds);
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

export function getCropIdsByElement(element: CropElement): readonly string[] {
  return cropIdsByElement?.get(element) ?? [];
}

/** 获取所有等阶配置（按 tier 升序） */
export function getAllFarmTiers(): readonly FarmTierConfig[] {
  return tierByTier ? [...tierByTier.values()].sort((a, b) => a.tier - b.tier) : [];
}
