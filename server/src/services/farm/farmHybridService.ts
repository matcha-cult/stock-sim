/**
 * 灵田 V4 — 杂交触发服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：种植时批量查询相关格子数据，匹配杂交配方，判定是否触发，记录待发放杂交种子。
 * 2. 不做什么：不做基础种植/收获（farmService）、不做变异判定（farmMutationService）、不做杂交种子实际发放（收获时发放，在 farmService 中处理）。
 *
 * 数据流 / 状态流：
 * farmService.plantCrop → tryHybridOnPlant() → 批量查询 2-邻域格子 → 配方匹配 → 记录 pending_hybrid_seed。
 *
 * 复用设计说明：
 * - 配置读取复用 farmConfigLoader 的 Map 索引（getRecipesByBaseCrop）。
 * - 相邻格子计算复用 farmTypes.getHybridAdjacentCells（四方向）。
 * - 元素条件判定复用 farmElementConditionService.checkElementCondition。
 * - 单次批量查询替代 N+1 查询，减少数据库往返。
 *
 * 关键边界条件与坑点：
 * 1. 只有无属性作物（element = []）才能作为父本触发杂交。
 * 2. 相邻作物必须处于非成熟阶段（stage !== 'harvestable'），已成熟的作物不参与杂交。
 * 3. 杂交种子在收获时发放（条件：金光变或优质品质），此服务只负责记录 pending_hybrid_seed。
 * 4. 杂交使用四方向（上下左右），不包含对角线。
 * 5. 种下任何作物时，都要检查：新种作物（如果是无属性）+ 所有相邻非成熟无属性作物。
 */
import { query } from '../../config/database.js';
import {
  getCropConfig,
  getSeedConfig,
  getGridConfig,
  getAccelerationMultiplier,
  getRecipesByBaseCrop,
} from './farmConfigLoader.js';
import {
  getHybridAdjacentCells,
  computeCropState,
  type HybridRecipeConfig,
  type RequiredAdjacentCondition,
  type CropConfig,
  type CropElement,
  type MutationType,
} from './farmTypes.js';
import { computeSpeedMultiplier, computeWitherMultiplier } from './farmMutationService.js';
import { checkElementCondition } from './farmElementConditionService.js';

// ── 常量 ──

/**
 * 稀有度优先级映射（数字越大越稀有）。
 * 模块级常量，避免每次调用都创建对象。
 */
const RARITY_ORDER: Readonly<Record<string, number>> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/**
 * 有效变异类型集合，用于将数据库字符串转换为 MutationType。
 */
const VALID_MUTATION_TYPES: ReadonlySet<string> = new Set([
  'gold', 'double_yield', 'speed_ripen', 'wither_early', 'half_yield',
]);

// ── 类型 ──

export interface HybridTriggerResult {
  triggered: boolean;
  recipeName: string | null;
  resultSeedName: string | null;
  resultQuantity: number;
}

/** 无结果占位符，避免每次创建新对象 */
const NO_RESULT: Readonly<HybridTriggerResult> = {
  triggered: false,
  recipeName: null,
  resultSeedName: null,
  resultQuantity: 0,
};

/** 已解析的格子作物数据 */
interface CellCropData {
  cropConfig: CropConfig;
  /** 种植时间（毫秒时间戳） */
  plantedAt: number;
  mutationType: MutationType | null;
  /** 是否可收获 */
  isHarvestable: boolean;
}

// ── 核心逻辑 ──

/**
 * 种植时尝试触发杂交。
 *
 * 性能优化：
 * - 单次批量查询新种作物的 2-邻域（距离 ≤ 2 的所有格子），覆盖所有可能的相邻格子。
 * - 构建本地 Map 索引，O(1) 查找格子数据。
 * - 使用 recipesByBaseCrop 索引（O(1)）替代遍历全部配方（O(n)）。
 *
 * 新设计：
 * 1. 只有无属性作物（element = []）才能作为父本触发杂交
 * 2. 配方匹配基于 requiredAdjacent 条件（trait/element/elementCondition）
 * 3. 多配方匹配时，按产物稀有度排序，选择最高的
 * 4. 种下任何作物时，都要检查：新种作物（如果是无属性）+ 所有相邻非成熟无属性作物
 */
export async function tryHybridOnPlant(
  characterId: number,
  newRow: number,
  newCol: number,
  newCropId: string,
  now: number,
): Promise<HybridTriggerResult> {
  const newCropConfig = getCropConfig(newCropId);
  if (!newCropConfig) return NO_RESULT;

  const gridConfig = getGridConfig();
  const accelMul = getAccelerationMultiplier();

  // 1. 收集所有需要查询的格子位置（新种作物的 2-邻域）
  // 2-邻域 = 所有距离 ≤ 2 的格子，覆盖新种作物 + 相邻作物 + 它们的相邻作物
  const positionsToQuery: Array<{ row: number; col: number }> = [];
  const posKeySet = new Set<string>();

  // 添加新种作物自身
  const addPosition = (row: number, col: number): void => {
    if (row < 0 || row >= gridConfig.maxRows || col < 0 || col >= gridConfig.fixedCols) return;
    const key = `${row},${col}`;
    if (posKeySet.has(key)) return;
    posKeySet.add(key);
    positionsToQuery.push({ row, col });
  };

  addPosition(newRow, newCol);

  // 添加新种作物的 1-邻域（四方向相邻）
  const newCropNeighbors = getHybridAdjacentCells(newRow, newCol, gridConfig.maxRows, gridConfig.fixedCols);
  for (const n of newCropNeighbors) {
    addPosition(n.row, n.col);
  }

  // 添加新种作物每个邻居的邻居（形成 2-邻域）
  for (const n of newCropNeighbors) {
    const nn = getHybridAdjacentCells(n.row, n.col, gridConfig.maxRows, gridConfig.fixedCols);
    for (const nnc of nn) {
      addPosition(nnc.row, nnc.col);
    }
  }

  if (positionsToQuery.length === 0) return NO_RESULT;

  // 2. 单次批量查询所有相关格子的完整数据（作物 + 装饰物）
  // 使用 unnest + WITH ORDINALITY 保持位置顺序，便于参数化
  const posRows = positionsToQuery.map((p) => p.row);
  const posCols = positionsToQuery.map((p) => p.col);

  const [cellRows, decoRows] = await Promise.all([
    query<{ row: number; col: number; crop_id: string | null; planted_at_epoch: number | null; mutation_type: string | null }>(
      `SELECT u.row, u.col, fc.crop_id,
              EXTRACT(EPOCH FROM fc.planted_at) * 1000 AS planted_at_epoch,
              fc.mutation_type
       FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS u(row, col, ord)
       LEFT JOIN farm_cell fc
         ON fc.character_id = $1 AND fc.row = u.row AND fc.col = u.col AND fc.crop_id IS NOT NULL`,
      [characterId, posRows, posCols],
    ),
    query<{ row: number; col: number; decoration_type: string }>(
      `SELECT u.row, u.col, fd.decoration_type
       FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS u(row, col, ord)
       INNER JOIN farm_decoration fd
         ON fd.character_id = $1 AND fd.row = u.row AND fd.col = u.col`,
      [characterId, posRows, posCols],
    ),
  ]);

  // 3. 构建装饰物索引（position key → decoration_type）
  const decoByCell = new Map<string, string>();
  for (const d of decoRows.rows) {
    decoByCell.set(`${d.row},${d.col}`, d.decoration_type);
  }

  // 4. 构建格子数据索引 (position key → CellCropData)
  const cellDataMap = new Map<string, CellCropData>();
  for (const row of cellRows.rows) {
    if (!row.crop_id || row.planted_at_epoch == null) continue;

    const cropConfig = getCropConfig(row.crop_id);
    if (!cropConfig) continue;

    const mutationType = parseMutationType(row.mutation_type);
    const plantedAt = Math.floor(Number(row.planted_at_epoch));
    const posKey = `${row.row},${row.col}`;

    // 计算四方向相邻中灵泉装饰物的数量
    const adjPositions = getHybridAdjacentCells(row.row, row.col, gridConfig.maxRows, gridConfig.fixedCols);
    let springCount = 0;
    for (const adjPos of adjPositions) {
      if (decoByCell.get(`${adjPos.row},${adjPos.col}`) === 'spring') {
        springCount++;
      }
    }

    const speedMul = computeSpeedMultiplier(mutationType, springCount);
    const witherMul = computeWitherMultiplier(mutationType);
    const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

    cellDataMap.set(posKey, {
      cropConfig,
      plantedAt,
      mutationType,
      isHarvestable: state.stage === 'harvestable',
    });
  }

  // 4. 确定需要检查杂交的格子列表
  // 条件：新种作物（如果是无属性）+ 相邻非成熟无属性作物
  const cellsToCheck: Array<{ row: number; col: number; cropId: string }> = [];

  // 新种作物如果是无属性，需要检查（它刚种下，一定是非成熟的）
  if (newCropConfig.element.length === 0) {
    cellsToCheck.push({ row: newRow, col: newCol, cropId: newCropId });
  }

  // 检查相邻作物，找出非成熟的无属性作物
  for (const neighbor of newCropNeighbors) {
    const neighborKey = `${neighbor.row},${neighbor.col}`;
    const neighborData = cellDataMap.get(neighborKey);
    if (!neighborData) continue;
    if (neighborData.cropConfig.element.length > 0) continue; // 只检查无属性作物
    if (neighborData.isHarvestable) continue; // 跳过已成熟的作物

    cellsToCheck.push({ row: neighbor.row, col: neighbor.col, cropId: neighborData.cropConfig.cropId });
  }

  if (cellsToCheck.length === 0) return NO_RESULT;

  // 5. 对每个需要检查的格子，查找最佳匹配配方
  let bestResult: HybridTriggerResult = { ...NO_RESULT };
  let bestRarity = -1;

  for (const cell of cellsToCheck) {
    // 获取该格子的四方向相邻作物配置
    const adjPositions = getHybridAdjacentCells(cell.row, cell.col, gridConfig.maxRows, gridConfig.fixedCols);
    const adjCropConfigs: CropConfig[] = [];

    for (const adjPos of adjPositions) {
      const adjKey = `${adjPos.row},${adjPos.col}`;
      const adjData = cellDataMap.get(adjKey);
      if (!adjData) continue;
      // 杂交判定只考虑非成熟的相邻作物
      if (adjData.isHarvestable) continue;
      adjCropConfigs.push(adjData.cropConfig);
    }

    if (adjCropConfigs.length === 0) continue;

    // 使用索引查询配方（O(1)），替代遍历全部配方（O(n)）
    const candidateRecipes = getRecipesByBaseCrop(cell.cropId);
    if (candidateRecipes.length === 0) continue;

    // 查找所有满足条件的配方
    const matchingRecipes: HybridRecipeConfig[] = [];
    for (const recipe of candidateRecipes) {
      if (checkRequiredAdjacent(recipe.requiredAdjacent, adjCropConfigs)) {
        matchingRecipes.push(recipe);
      }
    }

    if (matchingRecipes.length === 0) continue;

    // 按稀有度排序，选择最高的
    matchingRecipes.sort((a, b) => {
      const cropA = getCropConfig(a.resultCropId);
      const cropB = getCropConfig(b.resultCropId);
      const rarityA = cropA ? getRarityOrder(cropA.rarity) : 0;
      const rarityB = cropB ? getRarityOrder(cropB.rarity) : 0;
      if (rarityA !== rarityB) return rarityB - rarityA;
      return a.sortOrder - b.sortOrder;
    });

    const bestRecipe = matchingRecipes[0];

    // 查询该格子当前的 pending_hybrid_seed
    const pendingRows = await query<{ pending_hybrid_seed: string | null }>(
      `SELECT pending_hybrid_seed FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, cell.row, cell.col],
    );
    const currentPending = pendingRows.rows[0]?.pending_hybrid_seed;

    // 如果配方相同，跳过
    if (bestRecipe.resultSeedItemId === currentPending) continue;

    // 如果已有 pending_hybrid_seed，比较稀有度（只有新配方更高才覆盖）
    if (currentPending) {
      const currentSeed = getSeedConfig(currentPending);
      const newSeed = getSeedConfig(bestRecipe.resultSeedItemId);
      if (currentSeed && newSeed) {
        const currentCrop = getCropConfig(currentSeed.cropId);
        const newCrop = getCropConfig(newSeed.cropId);
        if (currentCrop && newCrop) {
          const currentRarity = getRarityOrder(currentCrop.rarity);
          const newRarity = getRarityOrder(newCrop.rarity);
          if (newRarity <= currentRarity) continue;
        }
      }
    }

    // 更新 pending_hybrid_seed
    await query(
      `UPDATE farm_cell SET pending_hybrid_seed = $1, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $2 AND row = $3 AND col = $4`,
      [bestRecipe.resultSeedItemId, characterId, cell.row, cell.col],
    );

    // 记录全局最佳结果（稀有度最高的）
    const resultCrop = getCropConfig(bestRecipe.resultCropId);
    const recipeRarity = resultCrop ? getRarityOrder(resultCrop.rarity) : 0;
    if (recipeRarity > bestRarity) {
      const seedConfig = getSeedConfig(bestRecipe.resultSeedItemId);
      bestResult = {
        triggered: true,
        recipeName: bestRecipe.name,
        resultSeedName: seedConfig?.name ?? bestRecipe.resultSeedItemId,
        resultQuantity: bestRecipe.resultQuantity,
      };
      bestRarity = recipeRarity;
    }
  }

  return bestResult;
}

// ── 条件判定 ──

/**
 * 检查相邻作物是否满足配方的所有 requiredAdjacent 条件。
 */
function checkRequiredAdjacent(
  requiredAdjacent: RequiredAdjacentCondition[],
  adjacentCrops: CropConfig[],
): boolean {
  for (const condition of requiredAdjacent) {
    if (!checkSingleCondition(condition, adjacentCrops)) {
      return false;
    }
  }
  return true;
}

function checkSingleCondition(
  condition: RequiredAdjacentCondition,
  adjacentCrops: CropConfig[],
): boolean {
  switch (condition.type) {
    case 'trait':
      return checkTraitCondition(condition, adjacentCrops);
    case 'element':
      return checkElementConditionDirect(condition, adjacentCrops);
    case 'elementCondition':
      return checkElementCondition(
        condition.conditionId,
        adjacentCrops,
        {
          element: condition.element,
          elements: condition.elements,
        },
      );
    default:
      return false;
  }
}

/**
 * 特性条件：检查相邻作物中具有指定特性的数量。
 */
function checkTraitCondition(
  condition: { type: 'trait'; value: string; minCount: number },
  adjacentCrops: CropConfig[],
): boolean {
  let count = 0;
  for (const crop of adjacentCrops) {
    if (crop.traits.includes(condition.value)) {
      count++;
    }
  }
  return count >= condition.minCount;
}

/**
 * 元素条件（直接）：检查相邻作物中具有指定元素的数量。
 */
function checkElementConditionDirect(
  condition: { type: 'element'; value: CropElement; minCount: number },
  adjacentCrops: CropConfig[],
): boolean {
  let count = 0;
  for (const crop of adjacentCrops) {
    if (crop.element.includes(condition.value)) {
      count++;
    }
  }
  return count >= condition.minCount;
}

// ── 内部工具 ──

/**
 * 获取稀有度优先级（模块级常量查找）。
 */
function getRarityOrder(rarity: string): number {
  return RARITY_ORDER[rarity] ?? 0;
}

/**
 * 将数据库 mutation_type 字符串转换为 MutationType。
 * 避免使用 as any 强制转换。
 */
function parseMutationType(raw: string | null): MutationType | null {
  if (raw == null || !VALID_MUTATION_TYPES.has(raw)) return null;
  return raw as MutationType;
}

/**
 * 检查铲除作物后，相邻作物的 pending_hybrid_seed 是否需要撤销。
 *
 * 使用 recipesByBaseCrop 索引优化（O(1)）替代遍历全部配方（O(n)）。
 */
export function checkHybridRevocation(
  adjacentCropId: string,
  adjacentCropConfigs: CropConfig[],
  currentPendingSeed: string | null,
): boolean {
  if (!currentPendingSeed) return false;

  // 使用索引查询配方（O(1)）
  const candidateRecipes = getRecipesByBaseCrop(adjacentCropId);
  const matchingRecipes: HybridRecipeConfig[] = [];

  for (const recipe of candidateRecipes) {
    if (checkRequiredAdjacent(recipe.requiredAdjacent, adjacentCropConfigs)) {
      matchingRecipes.push(recipe);
    }
  }

  // 如果没有匹配的配方，需要撤销
  if (matchingRecipes.length === 0) return true;

  // 按稀有度排序，选择最高的
  matchingRecipes.sort((a, b) => {
    const cropA = getCropConfig(a.resultCropId);
    const cropB = getCropConfig(b.resultCropId);
    const rarityA = cropA ? getRarityOrder(cropA.rarity) : 0;
    const rarityB = cropB ? getRarityOrder(cropB.rarity) : 0;
    if (rarityA !== rarityB) return rarityB - rarityA;
    return a.sortOrder - b.sortOrder;
  });

  const bestRecipe = matchingRecipes[0];

  // 如果最佳匹配的配方与原来的 pending_hybrid_seed 不同，需要撤销
  return bestRecipe.resultSeedItemId !== currentPendingSeed;
}
