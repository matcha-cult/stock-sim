/**
 * 灵田 V3 — 杂交触发服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：种植时检查四方向相邻格子，匹配杂交配方，判定是否触发，记录待发放杂交种子。
 * 2. 不做什么：不做基础种植/收获（farmService）、不做变异判定（farmMutationService）、不做杂交种子实际发放（收获时发放，在 farmService 中处理）。
 *
 * 数据流 / 状态流：
 * farmService.plantCrop → tryHybridOnPlant() → 查询相邻格子 → 配方匹配 → 记录 pending_hybrid_seed。
 *
 * 复用设计说明：
 * - 配置读取复用 farmConfigLoader 的 Map 索引（findMatchingRecipe）。
 * - 相邻格子计算复用 farmTypes.getHybridAdjacentCells（四方向）。
 *
 * 关键边界条件与坑点：
 * 1. 杂交匹配依据是物种（crop_id），不是灵根元素。
 * 2. 相邻作物必须处于非成熟阶段（生长中），已成熟的作物不参与杂交。
 * 3. 杂交种子在收获时发放（条件：金光变或优质品质），此服务只负责记录 pending_hybrid_seed。
 * 4. 杂交使用四方向（上下左右），不包含对角线。
 */
import { query } from '../../config/database.js';
import {
  getCropConfig,
  getSeedConfig,
  findBestMatchingRecipe,
  getGridConfig,
  getAccelerationMultiplier,
} from './farmConfigLoader.js';
import {
  getHybridAdjacentCells,
  computeCropState,
} from './farmTypes.js';
import { computeSpeedMultiplier, computeWitherMultiplier } from './farmMutationService.js';

// ── 类型 ──

export interface HybridTriggerResult {
  triggered: boolean;
  recipeName: string | null;
  resultSeedName: string | null;
  resultQuantity: number;
}

interface AdjacentCellRow {
  row: number;
  col: number;
  crop_id: string | null;
  planted_at: Date | string | null;
  planted_at_epoch: number | null;
  mutation_type: string | null;
}

interface DecorationRow {
  row: number;
  col: number;
  decoration_type: string;
}

// ── 核心逻辑 ──

/**
 * 种植时尝试触发杂交。
 *
 * 在事务内调用（已持有目标格子的行锁），查询相邻格子并判定。
 * 成功后记录 pending_hybrid_seed（不立即发放，收获时发放）。
 *
 * 新设计：杂交匹配依据是物种（crop_id），不是灵根元素。
 * 配方结构：baseCropId + requiredCrops ⊆ 相邻作物集合 → 产物
 *
 * 检查逻辑：
 * 1. 种下后，扫描所有可能触发杂交的作物（新种作物 + 相邻非成熟作物）
 * 2. 对每个作物，查找所有匹配的配方，选择稀有度最高的
 * 3. 如果已有 pending_hybrid_seed，只有新配方稀有度更高时才覆盖
 */
export async function tryHybridOnPlant(
  characterId: number,
  newRow: number,
  newCol: number,
  newCropId: string,
  now: number,
): Promise<HybridTriggerResult> {
  const noResult: HybridTriggerResult = {
    triggered: false,
    recipeName: null,
    resultSeedName: null,
    resultQuantity: 0,
  };

  const gridConfig = getGridConfig();

  // 查询新种作物的四方向相邻格子
  const adjacentPositions = getHybridAdjacentCells(newRow, newCol, gridConfig.maxRows, gridConfig.fixedCols);
  if (adjacentPositions.length === 0) return noResult;

  // 批量查询相邻格子的作物状态 + 装饰物
  const adjRows = await query<AdjacentCellRow>(
    `SELECT row, col, crop_id, planted_at,
            EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
            mutation_type
     FROM farm_cell
     WHERE character_id = $1
       AND (row, col) IN (${adjacentPositions.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(',')})
       AND crop_id IS NOT NULL`,
    [characterId, ...adjacentPositions.flatMap((p) => [p.row, p.col])],
  );

  // 批量查询相邻格子的装饰物（用于计算灵泉加成）
  const decoRows = await query<DecorationRow>(
    `SELECT row, col, decoration_type
     FROM farm_decoration
     WHERE character_id = $1
       AND (row, col) IN (${adjacentPositions.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(',')})`,
    [characterId, ...adjacentPositions.flatMap((p) => [p.row, p.col])],
  );

  // 构建装饰物索引（以 (row,col) 为 key）
  const decoByCell = new Map<string, string>();
  for (const d of decoRows.rows) {
    decoByCell.set(`${d.row},${d.col}`, d.decoration_type);
  }

  // 收集所有需要检查杂交的作物位置（新种作物 + 相邻非成熟作物）
  const cellsToCheck: Array<{ row: number; col: number; cropId: string; isNew: boolean }> = [];

  // 添加新种作物（一定是非成熟的）
  cellsToCheck.push({ row: newRow, col: newCol, cropId: newCropId, isNew: true });

  // 添加相邻非成熟作物
  for (const adjRow of adjRows.rows) {
    if (!adjRow.crop_id || adjRow.planted_at_epoch == null) continue;

    const adjCropConfig = getCropConfig(adjRow.crop_id);
    if (!adjCropConfig) continue;

    // 检查是否处于非成熟阶段
    const adjMutationType = adjRow.mutation_type as string | null;
    const adjSpringCount = countAdjacentDecoration(adjRow.row, adjRow.col, decoByCell, 'spring');
    const adjSpeedMul = computeSpeedMultiplier(adjMutationType as any, adjSpringCount);
    const adjWitherMul = computeWitherMultiplier(adjMutationType as any);
    const adjPlantedAt = Math.floor(Number(adjRow.planted_at_epoch));
    const accelMul = getAccelerationMultiplier();
    const adjState = computeCropState(adjCropConfig, adjPlantedAt, now, adjSpeedMul, adjWitherMul, accelMul);
    if (adjState.stage === 'harvestable') continue;

    cellsToCheck.push({ row: adjRow.row, col: adjRow.col, cropId: adjRow.crop_id, isNew: false });
  }

  // 对每个需要检查的作物，查找最佳匹配配方
  let bestResult: HybridTriggerResult = noResult;

  for (const cellToCheck of cellsToCheck) {
    // 获取该作物的四方向相邻格子
    const checkAdjacentPositions = getHybridAdjacentCells(cellToCheck.row, cellToCheck.col, gridConfig.maxRows, gridConfig.fixedCols);
    if (checkAdjacentPositions.length === 0) continue;

    // 查询该作物的相邻格子中的作物
    const checkAdjRows = await query<{ crop_id: string | null; row: number; col: number }>(
      `SELECT row, col, crop_id
       FROM farm_cell
       WHERE character_id = $1
         AND (row, col) IN (${checkAdjacentPositions.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(',')})
         AND crop_id IS NOT NULL`,
      [characterId, ...checkAdjacentPositions.flatMap((p) => [p.row, p.col])],
    );

    // 收集该作物的非成熟相邻作物集合
    const checkAdjacentCropIds = new Set<string>();
    for (const checkAdjRow of checkAdjRows.rows) {
      if (!checkAdjRow.crop_id) continue;

      // 如果是新种作物的位置，一定是非成熟的，直接添加
      if (checkAdjRow.row === newRow && checkAdjRow.col === newCol) {
        checkAdjacentCropIds.add(checkAdjRow.crop_id);
        continue;
      }

      const checkAdjCropConfig = getCropConfig(checkAdjRow.crop_id);
      if (!checkAdjCropConfig) continue;

      // 检查该作物是否处于非成熟阶段
      const checkAdjDetailRows = await query<{ planted_at_epoch: number | null; mutation_type: string | null }>(
        `SELECT EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch, mutation_type
         FROM farm_cell
         WHERE character_id = $1 AND row = $2 AND col = $3`,
        [characterId, checkAdjRow.row, checkAdjRow.col],
      );
      if (checkAdjDetailRows.rowCount === 0 || !checkAdjDetailRows.rows[0].planted_at_epoch) continue;
      const detail = checkAdjDetailRows.rows[0];

      const checkAdjMutationType = detail.mutation_type as string | null;
      const checkAdjSpringCount = countAdjacentDecoration(checkAdjRow.row, checkAdjRow.col, decoByCell, 'spring');
      const checkAdjSpeedMul = computeSpeedMultiplier(checkAdjMutationType as any, checkAdjSpringCount);
      const checkAdjWitherMul = computeWitherMultiplier(checkAdjMutationType as any);
      const checkAdjPlantedAt = Math.floor(Number(detail.planted_at_epoch));
      const accelMul = getAccelerationMultiplier();
      const checkAdjState = computeCropState(checkAdjCropConfig, checkAdjPlantedAt, now, checkAdjSpeedMul, checkAdjWitherMul, accelMul);
      if (checkAdjState.stage === 'harvestable') continue;

      checkAdjacentCropIds.add(checkAdjRow.crop_id);
    }

    // 查找最佳匹配配方（稀有度最高的）
    const bestRecipe = findBestMatchingRecipe(cellToCheck.cropId, checkAdjacentCropIds);
    if (!bestRecipe) continue;

    // 查询该作物当前的 pending_hybrid_seed
    const currentPendingRows = await query<{ pending_hybrid_seed: string | null }>(
      `SELECT pending_hybrid_seed FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, cellToCheck.row, cellToCheck.col],
    );
    const currentPending = currentPendingRows.rows[0]?.pending_hybrid_seed;

    // 如果配方相同，跳过
    if (bestRecipe.resultSeedItemId === currentPending) continue;

    // 如果已有 pending_hybrid_seed，比较稀有度
    if (currentPending) {
      const currentSeedConfig = getSeedConfig(currentPending);
      const newSeedConfig = getSeedConfig(bestRecipe.resultSeedItemId);
      if (currentSeedConfig && newSeedConfig) {
        const currentCropConfig = getCropConfig(currentSeedConfig.cropId);
        const newCropConfig = getCropConfig(newSeedConfig.cropId);
        if (currentCropConfig && newCropConfig) {
          const currentRarity = getRarityOrder(currentCropConfig.rarity);
          const newRarity = getRarityOrder(newCropConfig.rarity);
          // 只有新配方稀有度更高时才覆盖
          if (newRarity <= currentRarity) continue;
        }
      }
    }

    // 更新 pending_hybrid_seed
    await query(
      `UPDATE farm_cell SET pending_hybrid_seed = $1, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $2 AND row = $3 AND col = $4`,
      [bestRecipe.resultSeedItemId, characterId, cellToCheck.row, cellToCheck.col],
    );

    // 记录最佳结果（稀有度最高的）
    const seedConfig = getSeedConfig(bestRecipe.resultSeedItemId);
    const resultCropConfig = getCropConfig(bestRecipe.resultCropId);
    const newRarity = resultCropConfig ? getRarityOrder(resultCropConfig.rarity) : 0;
    const currentBestRarity = bestResult.triggered && bestResult.resultSeedName
      ? getRarityOrder(getSeedConfig(bestResult.resultSeedName)?.cropId ? getCropConfig(getSeedConfig(bestResult.resultSeedName)!.cropId)?.rarity ?? 'common' : 'common')
      : -1;

    if (newRarity > currentBestRarity) {
      bestResult = {
        triggered: true,
        recipeName: bestRecipe.name,
        resultSeedName: seedConfig?.name ?? bestRecipe.resultSeedItemId,
        resultQuantity: bestRecipe.resultQuantity,
      };
    }
  }

  return bestResult;
}

/**
 * 稀有度优先级映射（数字越大越稀有）
 */
function getRarityOrder(rarity: string): number {
  const order: Record<string, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
  };
  return order[rarity] ?? 0;
}

// ── 内部工具 ──

function countAdjacentDecoration(
  row: number,
  col: number,
  decoByCell: Map<string, string>,
  type: string,
): number {
  // 计算指定格子四方向中有多少个指定类型的装饰物
  // 注意：杂交使用四方向（上下左右）
  const gridConfig = getGridConfig();
  const adjacent = getHybridAdjacentCells(row, col, gridConfig.maxRows, gridConfig.fixedCols);
  let count = 0;
  for (const adj of adjacent) {
    if (decoByCell.get(`${adj.row},${adj.col}`) === type) count++;
  }
  return count;
}
