/**
 * 灵田系统 V3 — 核心服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：灵田开垦、概览查询、种子买卖、种植（含变异+杂交触发）、
 *    收获（含品质+变异效果+种子产出）、灵材出售（按品质+1000单位交易）、格子扩展、等阶突破。
 * 2. 不做什么：不做变异判定逻辑（farmMutationService）、不做杂交判定逻辑（farmHybridService）。
 *
 * 数据流 / 状态流：
 * 玩家请求 → route → service → DB query + consumeSpiritStones/addSpiritStones → 返回 DTO。
 *
 * 复用设计说明：
 * - 货币操作复用 consumeSpiritStones / addSpiritStones。
 * - 生长状态计算复用 farmTypes.computeCropState。
 * - 变异效果计算复用 farmMutationService。
 * - 杂交触发复用 farmHybridService.tryHybridOnPlant。
 * - 配置读取复用 farmConfigLoader 的 Map 索引。
 *
 * 关键边界条件与坑点：
 * 1. 收获用 SELECT FOR UPDATE 锁同一行 farm_cell，天然串行。
 * 2. V3 需要手动开垦灵田（reclaimFarm），不再自动创建 profile。
 * 3. 种子袋扣减必须 WHERE quantity >= N 防止超扣。
 * 4. V3 引入等级（Level）和等阶（Tier）两个独立维度。
 */
import { query, withTransaction } from '../../config/database.js';
import { consumeSpiritStones, addSpiritStones } from '../inventory/shared/consume.js';
import {
  getCropConfig,
  getSeedConfig,
  getFarmTierConfig,
  getAllFarmTiers,
  getPlotsConfig,
  getGridConfig,
  getXiRangConfig,
  getCellReclaimConfig,
  getInitialSeeds,
  getAllCrops,
  getAllSeeds,
  getAllRecipes,
  getAccelerationMultiplier,
} from './farmConfigLoader.js';
import {
  computeCropState,
  getAdjacentCells,
  getHybridAdjacentCells,
  calculateLevelUpExpRequired,
  calculateLevelMutationBonus,
  type FarmOverviewDto,
  type FarmCellDto,
  type SeedInventoryItem,
  type HarvestInventoryItem,
  type HarvestInventoryItemDto,
  type HarvestInventoryPageResult,
  type FarmInfoDto,
  type CropStateDto,
  type FarmStaticConfigDto,
  type SeedConfigDto,
  type CropConfigDto,
  type HybridRecipeConfigDto,
  type MutationType,
  type CropQuality,
  type DecorationType,
} from './farmTypes.js';
import {
  rollMutation,
  rollQuality,
  applyGoldMutation,
  computeSpeedMultiplier,
  computeWitherMultiplier,
  computeYieldMultiplier,
  computeSellPriceMultiplier,
  rollMutationInheritance,
} from './farmMutationService.js';
import { tryHybridOnPlant, checkHybridRevocation } from './farmHybridService.js';
import { logActivity } from './farmActivityLogService.js';

// ==================== 类型定义 ====================

type CellRow = {
  row: number;
  col: number;
  unlocked: boolean;
  crop_id: string | null;
  planted_at_epoch: number | null;
  mutated: boolean;
  mutation_type: string | null;
  pending_hybrid_seed: string | null;
  planted_generation: number;
};

type DecorationRow = {
  row: number;
  col: number;
  decoration_type: string;
};

type SeedRow = {
  id: number;
  item_id: string;
  quantity: number;
  mutation_type: string;
  generation: number;
};

type HarvestRow = {
  crop_id: string;
  quantity: number;
  quality: string;
};

/** V3: farm_tier（等阶）+ farm_level（等级）分离 */
type ProfileRow = {
  id: number;
  farm_tier: number;
  farm_level: number;
  farm_exp: string;
  max_row: number;
  initial_seeds_claimed: boolean;
};

// ==================== 灵田开垦 ====================

/** 创建灵田格子（开垦或扩展时调用） */
async function createCells(characterId: number, rows: number): Promise<void> {
  const gridConfig = getGridConfig();
  const cellValues: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < gridConfig.fixedCols; c++) {
      cellValues.push(`(${characterId}, ${r}, ${c}, true, NOW())`);
    }
  }
  // 同时创建未解锁的格子（row >= rows 且 < maxRows）
  for (let r = rows; r < gridConfig.maxRows; r++) {
    for (let c = 0; c < gridConfig.fixedCols; c++) {
      cellValues.push(`(${characterId}, ${r}, ${c}, false, NOW())`);
    }
  }
  await query(
    `INSERT INTO farm_cell (character_id, row, col, unlocked, updated_at)
     VALUES ${cellValues.join(', ')}
     ON CONFLICT (character_id, row, col) DO NOTHING`,
    [],
  );
}

/** 发放初始种子（从 plots.json 的 initialSeeds 配置读取） */
async function grantInitialSeeds(characterId: number): Promise<void> {
  const initialSeeds = getInitialSeeds();
  if (initialSeeds.length === 0) return;

  const seedValues = initialSeeds
    .map((s) => `(${characterId}, '${s.itemId}', ${s.quantity}, '', 0, NOW())`)
    .join(', ');
  await query(
    `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
     VALUES ${seedValues}
     ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
     SET quantity = farm_seed_inventory.quantity + EXCLUDED.quantity,
         updated_at = CURRENT_TIMESTAMP`,
    [],
  );
}

/** 获取灵田档案（不存在返回 null） */
async function getFarmProfile(characterId: number): Promise<ProfileRow | null> {
  const result = await query<ProfileRow>(
    `SELECT id, farm_tier, farm_level, farm_exp, max_row, initial_seeds_claimed
     FROM farm_profile WHERE character_id = $1`,
    [characterId],
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/** 开垦灵田（首次创建 farm_profile + 16 格 + 初始种子） */
export async function reclaimFarm(characterId: number): Promise<{
  success: boolean;
  message: string;
  cost?: { spiritStones: number; xiRang: number; totalSpiritStones: number };
}> {
  return withTransaction(async () => {
    // 检查是否已开垦
    const existing = await getFarmProfile(characterId);
    if (existing) {
      return { success: false, message: '灵田已开垦' };
    }

    const gridConfig = getGridConfig();
    const cellReclaimConfig = getCellReclaimConfig();
    const xiRangConfig = getXiRangConfig();

    // 计算费用：首次开垦 16 格，每格 1000 灵石 + 1 息壤
    const cellCount = gridConfig.initialRows * gridConfig.fixedCols;
    const spiritStoneCost = cellCount * cellReclaimConfig.spiritStoneCost;
    const xiRangCount = cellCount * cellReclaimConfig.xiRangCost;
    const totalSpiritStones = spiritStoneCost + xiRangCount * xiRangConfig.pricePerUnit;

    // 扣除灵石
    const consumeResult = await consumeSpiritStones(characterId, BigInt(totalSpiritStones), {
      bizType: 'farm_reclaim',
      memo: '开垦灵田',
    });
    if (!consumeResult.success) {
      return { success: false, message: `灵石不足（需要 ${totalSpiritStones}）` };
    }

    // 创建 farm_profile
    await query(
      `INSERT INTO farm_profile (character_id, farm_tier, farm_level, farm_exp, max_row, initial_seeds_claimed, updated_at)
       VALUES ($1, 1, 0, 0, $2, false, NOW())`,
      [characterId, gridConfig.initialRows],
    );

    // 创建格子
    await createCells(characterId, gridConfig.initialRows);

    // 发放初始种子
    await grantInitialSeeds(characterId);
    await query(
      `UPDATE farm_profile SET initial_seeds_claimed = true WHERE character_id = $1`,
      [characterId],
    );

    return {
      success: true,
      message: '灵田开垦成功',
      cost: { spiritStones: spiritStoneCost, xiRang: xiRangCount, totalSpiritStones },
    };
  });
}

/** 获取开垦费用信息（前端展示用） */
export function getReclaimCost(): { spiritStones: number; xiRang: number; xiRangPricePerUnit: number; totalSpiritStones: number } {
  const gridConfig = getGridConfig();
  const cellReclaimConfig = getCellReclaimConfig();
  const xiRangConfig = getXiRangConfig();

  const cellCount = gridConfig.initialRows * gridConfig.fixedCols;
  const spiritStones = cellCount * cellReclaimConfig.spiritStoneCost;
  const xiRang = cellCount * cellReclaimConfig.xiRangCost;
  const totalSpiritStones = spiritStones + xiRang * xiRangConfig.pricePerUnit;

  return { spiritStones, xiRang, xiRangPricePerUnit: xiRangConfig.pricePerUnit, totalSpiritStones };
}

// ==================== 概览 ====================

export async function getFarmOverview(characterId: number): Promise<FarmOverviewDto> {
  const profile = await getFarmProfile(characterId);
  const now = Date.now();

  // 未开垦：返回开垦费用信息
  if (!profile) {
    return {
      reclaimed: false,
      farmInfo: null,
      cells: [],
      seedBag: [],
      harvestBag: [],
      serverNow: now,
      reclaimCost: getReclaimCost(),
    };
  }

  const [cellRows, decoRows, seedRows, harvestRows] = await Promise.all([
    query<CellRow>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type, pending_hybrid_seed, planted_generation
       FROM farm_cell WHERE character_id = $1
       ORDER BY row, col`,
      [characterId],
    ),
    query<DecorationRow>(
      `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
      [characterId],
    ),
    query<SeedRow>(
      `SELECT id, item_id, quantity, mutation_type, generation FROM farm_seed_inventory WHERE character_id = $1`,
      [characterId],
    ),
    query<HarvestRow>(
      `SELECT crop_id, quantity, quality FROM farm_harvest_inventory WHERE character_id = $1`,
      [characterId],
    ),
  ]);

  // 构建装饰物索引
  const decoByCell = new Map<string, DecorationType>();
  for (const d of decoRows.rows) {
    decoByCell.set(`${d.row},${d.col}`, d.decoration_type as DecorationType);
  }

  const gridConfig = getGridConfig();

  // 注：杂交种子发放已移至收获时统一检查（金光变或优质品质）
  // 详见设计文档 3.6 节

  const farmInfo = buildFarmInfoDto(profile);
  const cells = cellRows.rows.map((row) => buildCellDto(row, decoByCell, now, gridConfig));
  const seedBag = buildSeedInventoryDto(seedRows.rows);
  const harvestBag = buildHarvestInventoryDto(harvestRows.rows);

  return { reclaimed: true, farmInfo, cells, seedBag, harvestBag, serverNow: now };
}

/** 灵材仓库分页查询（服务端分页） */
export async function getHarvestInventory(
  characterId: number,
  page: number = 1,
  pageSize: number = 20,
): Promise<HarvestInventoryPageResult> {
  const clampedPage = Math.max(1, page);
  const clampedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const offset = (clampedPage - 1) * clampedPageSize;

  const [countResult, dataResult] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM farm_harvest_inventory WHERE character_id = $1 AND quantity > 0`,
      [characterId],
    ),
    query<HarvestRow>(
      `SELECT crop_id, quantity, quality
       FROM farm_harvest_inventory
       WHERE character_id = $1 AND quantity > 0
       ORDER BY crop_id, quality
       LIMIT $2 OFFSET $3`,
      [characterId, clampedPageSize, offset],
    ),
  ]);

  const total = Number(countResult.rows[0].count);
  const items: HarvestInventoryItemDto[] = dataResult.rows.map((row) => {
    const crop = getCropConfig(row.crop_id);
    return {
      cropId: row.crop_id,
      quantity: row.quantity,
      quality: row.quality as CropQuality,
      name: crop?.name ?? row.crop_id,
      element: crop?.element ?? [],
      requiredTier: crop?.requiredTier ?? 1,
      sellPricePerUnit: crop?.sellPricePerUnit ?? 0,
      harvestTradeUnit: crop?.harvestTradeUnit ?? 1,
      harvestUnit: crop?.harvestUnit ?? '',
    };
  });

  return { items, total, page: clampedPage, pageSize: clampedPageSize };
}

// ==================== 种子商店 ====================

export async function buySeed(
  characterId: number,
  itemId: string,
  quantity: number,
): Promise<{ success: boolean; message: string }> {
  return withTransaction(async () => {
    const seedConfig = getSeedConfig(itemId);
    if (!seedConfig) return { success: false, message: '种子不存在' };
    if (seedConfig.buyPrice <= 0) {
      return { success: false, message: '该种子不可购买' };
    }
    if (quantity <= 0 || quantity > seedConfig.maxStack) {
      return { success: false, message: '数量无效' };
    }

    const profile = await getFarmProfile(characterId);
    if (!profile) return { success: false, message: '请先开垦灵田' };
    if (seedConfig.requiredTier > profile.farm_tier) {
      return { success: false, message: `需要等阶 ${getFarmTierConfig(seedConfig.requiredTier)?.displayName ?? seedConfig.requiredTier}` };
    }

    const totalCost = BigInt(seedConfig.buyPrice * quantity);
    const consumeResult = await consumeSpiritStones(characterId, totalCost, {
      bizType: 'farm_buy_seed',
      bizId: itemId,
      memo: `购买 ${seedConfig.name} x${quantity}`,
    });
    if (!consumeResult.success) return { success: false, message: consumeResult.message };

    await query(
      `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
       VALUES ($1, $2, $3, '', 0, NOW())
       ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
       SET quantity = farm_seed_inventory.quantity + $3,
           updated_at = CURRENT_TIMESTAMP`,
      [characterId, itemId, quantity],
    );

    return { success: true, message: `购买成功，花费 ${totalCost} 灵石` };
  });
}

export async function sellSeed(
  characterId: number,
  itemId: string,
  quantity: number,
  mutationType: string | null,
): Promise<{ success: boolean; message: string }> {
  return withTransaction(async () => {
    const seedConfig = getSeedConfig(itemId);
    if (!seedConfig) return { success: false, message: '种子不存在' };
    if (quantity <= 0) return { success: false, message: '数量无效' };

    const dbMutationType = mutationType ?? '';
    const result = await query(
      `UPDATE farm_seed_inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $2 AND item_id = $3 AND quantity >= $1
         AND mutation_type = $4
       RETURNING id`,
      [quantity, characterId, itemId, dbMutationType],
    );
    if (result.rowCount === 0) return { success: false, message: '种子数量不足' };

    const totalEarn = BigInt(seedConfig.sellPrice * quantity);
    await addSpiritStones(characterId, totalEarn, {
      bizType: 'farm_sell_seed',
      bizId: itemId,
      memo: `出售 ${seedConfig.name} x${quantity}`,
    });

    await query(
      `DELETE FROM farm_seed_inventory WHERE character_id = $1 AND item_id = $2 AND quantity = 0`,
      [characterId, itemId],
    );

    return { success: true, message: `出售成功，获得 ${totalEarn} 灵石` };
  });
}

// ==================== 种植 ====================

export interface PlantResult {
  success: boolean;
  message: string;
  mutationType?: MutationType | null;
  hybridTriggered?: boolean;
  hybridResultSeedName?: string | null;
  /** 成功时返回播种后的格子完整数据，前端可局部更新 */
  cell?: FarmCellDto;
}

export async function plantCrop(
  characterId: number,
  row: number,
  col: number,
  seedId: number,
): Promise<PlantResult> {
  return withTransaction(async () => {
    // 通过 seedId 查询种子信息（锁定行）
    const seedRowResult = await query<{
      id: number;
      item_id: string;
      quantity: number;
      mutation_type: string;
      generation: number;
    }>(
      `SELECT id, item_id, quantity, mutation_type, generation
       FROM farm_seed_inventory
       WHERE character_id = $1 AND id = $2 AND quantity >= 1
       FOR UPDATE`,
      [characterId, seedId],
    );
    if (seedRowResult.rowCount === 0) return { success: false, message: '种子不存在或数量不足' };
    const seedRow = seedRowResult.rows[0];

    const seedConfig = getSeedConfig(seedRow.item_id);
    if (!seedConfig) return { success: false, message: '种子配置不存在' };

    const cropConfig = getCropConfig(seedConfig.cropId);
    if (!cropConfig) return { success: false, message: '作物配置不存在' };

    const profile = await getFarmProfile(characterId);
    if (!profile) return { success: false, message: '请先开垦灵田' };
    if (cropConfig.requiredTier > profile.farm_tier) {
      return { success: false, message: `需要等阶 ${getFarmTierConfig(cropConfig.requiredTier)?.displayName ?? cropConfig.requiredTier}` };
    }

    // 锁定目标格子
    const cellResult = await query<CellRow>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type
       FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3 FOR UPDATE`,
      [characterId, row, col],
    );
    if (cellResult.rowCount === 0) return { success: false, message: '格子不存在' };
    const cell = cellResult.rows[0];
    if (!cell.unlocked) return { success: false, message: '格子未解锁' };
    if (cell.crop_id) return { success: false, message: '格子已有作物' };

    const plantedGeneration = seedRow.generation;
    const seedMutationType = seedRow.mutation_type;

    // 扣减种子（数量减 1，如果为 0 则删除记录）
    await query(
      `UPDATE farm_seed_inventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [seedId],
    );
    // 如果数量为 0，删除记录（可选，保持数据整洁）
    await query(
      `DELETE FROM farm_seed_inventory WHERE id = $1 AND quantity = 0`,
      [seedId],
    );

    // 判定变异
    // 如果种子自带变异（变异种子），直接使用；否则判定是否发生新变异
    let finalMutationType: MutationType | null = null;
    if (seedMutationType) {
      // 变异种子：遗传判定（50%概率保留）
      if (rollMutationInheritance()) {
        finalMutationType = seedMutationType as MutationType;
      }
    } else {
      // 普通种子：查询相邻装饰物聚灵阵加成
      const extraRate = 0; // 聚灵阵加成由装饰物系统提供，当前简化为 0
      finalMutationType = rollMutation(extraRate);
    }

    const now = Date.now();

    // 查询装饰物索引（用于杂交时的相邻计算）
    const decoRows = await query<DecorationRow>(
      `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
      [characterId],
    );
    const decoByCell = new Map<string, DecorationType>();
    for (const d of decoRows.rows) {
      decoByCell.set(`${d.row},${d.col}`, d.decoration_type as DecorationType);
    }

    // 写入格子（使用统一时间源 now，避免数据库时间与 Node.js 时间不一致）
    await query(
      `UPDATE farm_cell
       SET crop_id = $1, planted_at = TO_TIMESTAMP($8), mutated = $2, mutation_type = $3,
           planted_generation = $4,
           pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $5 AND row = $6 AND col = $7`,
      [cropConfig.cropId, finalMutationType != null, finalMutationType, plantedGeneration, characterId, row, col, now / 1000],
    );

    // 尝试杂交触发
    const hybridResult = await tryHybridOnPlant(characterId, row, col, cropConfig.cropId, now);

    // 写入活动日志：播种
    await logActivity({
      characterId,
      activityType: 'plant',
      row,
      col,
      cropId: cropConfig.cropId,
      metadata: {
        seedItemId: seedRow.item_id,
        generation: plantedGeneration,
        mutationType: finalMutationType,
      },
    });

    // 写入活动日志：变异（如果发生）
    if (finalMutationType) {
      await logActivity({
        characterId,
        activityType: 'mutation',
        row,
        col,
        cropId: cropConfig.cropId,
        metadata: { mutationType: finalMutationType },
      });
    }

    // 查询播种后的格子数据并构建 DTO
    const updatedCellResult = await query<CellRow>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type, pending_hybrid_seed, planted_generation
       FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, row, col],
    );
    const updatedCell = buildCellDto(updatedCellResult.rows[0], decoByCell, Date.now(), getGridConfig());

    return {
      success: true,
      message: `播种 ${cropConfig.name} 成功`,
      mutationType: finalMutationType,
      hybridTriggered: hybridResult.triggered,
      hybridResultSeedName: hybridResult.resultSeedName,
      cell: updatedCell,
    };
  });
}

// ==================== 收获 ====================

export interface HarvestResult {
  success: boolean;
  message: string;
  withered?: boolean;
  witheredSeedItemId?: string | null;
  quantity?: number;
  quality?: CropQuality;
  mutationType?: MutationType | null;
  seedProduced?: boolean;
  seedItemId?: string;
  seedMutationType?: string | null;
}

export async function harvestCrop(
  characterId: number,
  row: number,
  col: number,
): Promise<HarvestResult> {
  return withTransaction(async () => {
    const cellResult = await query<{
      row: number;
      col: number;
      crop_id: string | null;
      planted_at_epoch: number | null;
      mutated: boolean;
      mutation_type: string | null;
      planted_generation: number;
      pending_hybrid_seed: string | null;
    }>(
      `SELECT row, col, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type, planted_generation, pending_hybrid_seed
       FROM farm_cell
       WHERE character_id = $1 AND row = $2 AND col = $3 FOR UPDATE`,
      [characterId, row, col],
    );
    if (cellResult.rowCount === 0) return { success: false, message: '格子不存在' };
    const cell = cellResult.rows[0];
    if (!cell.crop_id || cell.planted_at_epoch == null) {
      return { success: false, message: '格子无作物' };
    }

    const cropConfig = getCropConfig(cell.crop_id);
    if (!cropConfig) return { success: false, message: '配置缺失' };

    const plantedAt = Math.floor(Number(cell.planted_at_epoch));
    const now = Date.now();
    const mutationType = cell.mutation_type as MutationType | null;

    // 查询相邻装饰物
    const decoRows = await query<DecorationRow>(
      `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
      [characterId],
    );
    const decoByCell = new Map<string, string>();
    for (const d of decoRows.rows) {
      decoByCell.set(`${d.row},${d.col}`, d.decoration_type);
    }
    const gridConfig = getGridConfig();
    const adjacent = getAdjacentCells(row, col, gridConfig.maxRows, gridConfig.fixedCols);
    let springCount = 0;
    let stoneCount = 0;
    let arrayCount = 0;
    for (const adj of adjacent) {
      const deco = decoByCell.get(`${adj.row},${adj.col}`);
      if (deco === 'spring') springCount++;
      else if (deco === 'stone') stoneCount++;
      else if (deco === 'array') arrayCount++;
    }

    // 计算速度倍率和枯萎倍率
    const speedMul = computeSpeedMultiplier(mutationType, springCount);
    const witherMul = computeWitherMultiplier(mutationType);
    const accelMul = getAccelerationMultiplier();
    const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

    if (state.stage === 'growing') {
      return { success: false, message: '作物尚未成熟' };
    }

    if (state.stage === 'withered') {
      // 金光变枯萎留种：枯萎后自然掉落 1 颗种子，50% 概率遗传金光变
      let witheredSeedItemId: string | null = null;
      let witheredSeedMutationType: string | null = null;
      if (mutationType === 'gold' && cropConfig.seedFromYield) {
        witheredSeedItemId = cropConfig.seedItemId;
        const newSeedGeneration = cell.planted_generation + 1;
        if (rollMutationInheritance()) {
          witheredSeedMutationType = 'gold';
        }
        await query(
          `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
           VALUES ($1, $2, 1, $3, $4, NOW())
           ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
           SET quantity = farm_seed_inventory.quantity + 1,
               updated_at = CURRENT_TIMESTAMP`,
          [characterId, witheredSeedItemId, witheredSeedMutationType ?? '', newSeedGeneration],
        );
        // 枯萎但有种子掉落：发放经验（根据作物配置的 expGain，缺省为 1）
        await query(
          `UPDATE farm_profile SET farm_exp = farm_exp + $2, updated_at = CURRENT_TIMESTAMP WHERE character_id = $1`,
          [characterId, cropConfig.expGain ?? 1],
        );
        await checkAndLevelUp(characterId);
      }
      // 枯萎且无种子：+0 经验

      await query(
        `UPDATE farm_cell SET crop_id = NULL, planted_at = NULL, mutated = false,
                mutation_type = NULL, planted_generation = 0,
                pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE character_id = $1 AND row = $2 AND col = $3`,
        [characterId, row, col],
      );

      // 写入活动日志：枯萎
      await logActivity({
        characterId,
        activityType: 'wither',
        row,
        col,
        cropId: cell.crop_id,
        metadata: {
          mutationType,
          generation: cell.planted_generation,
          seedDropped: witheredSeedItemId != null,
          seedMutationType: witheredSeedMutationType,
        },
      });

      return {
        success: true,
        message: '作物已枯萎',
        withered: true,
        witheredSeedItemId,
      };
    }

    // 判定品质
    let quality = rollQuality();

    // 金光变提升品质
    if (mutationType === 'gold') {
      quality = applyGoldMutation(quality);
    }

    // 计算产量
    const baseYield = cropConfig.yieldMin + Math.floor(Math.random() * (cropConfig.yieldMax - cropConfig.yieldMin + 1));
    const yieldMul = computeYieldMultiplier(mutationType, quality, stoneCount);
    const actualYield = Math.max(Math.floor(baseYield * yieldMul), 1);

    // 写入灵材仓库（按品质分别计数）
    await query(
      `INSERT INTO farm_harvest_inventory (character_id, crop_id, quantity, quality, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (character_id, crop_id, quality) DO UPDATE
       SET quantity = farm_harvest_inventory.quantity + $3,
           updated_at = CURRENT_TIMESTAMP`,
      [characterId, cropConfig.cropId, actualYield, quality],
    );

    // 种子产出判定：金光变必然产种，优质也必然产种（100%）
    // 详见设计文档 4.6 节
    let seedProduced = false;
    let seedItemId: string | undefined;
    let seedMutationType: string | null = null;

    // 判断是否可产种子：如果配置了 seedableStage，则只有在该阶段或之后收获才能产种子
    const canProduceSeed = cropConfig.seedableStage == null
      ? true  // 未配置：任何可收获阶段均可
      : state.stageIndex >= cropConfig.seedableStage;  // 配置了：必须在指定阶段或之后

    // 三代限制：第 4 代及以上（planted_generation >= 3）且非金光变时，不产种子
    // 详见设计文档 3.7 节
    const isGeneration4Plus = cell.planted_generation >= 3;
    const canProduceSeedByGeneration = !isGeneration4Plus || mutationType === 'gold';

    // 金光变必然产种，优质必然产种（不再使用 rollHqSeed 概率判定）
    const shouldProduceSeed = (mutationType === 'gold' || quality === 'hq')
      && canProduceSeed
      && canProduceSeedByGeneration
      && cropConfig.seedFromYield;

    if (shouldProduceSeed) {
      seedProduced = true;
      seedItemId = cropConfig.seedItemId;

      // 判定是否遗传变异
      if (mutationType && rollMutationInheritance()) {
        seedMutationType = mutationType;
      }

      // 种子产出：是否从产量扣除
      if (actualYield > 0) {
        await query(
          `UPDATE farm_harvest_inventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP
           WHERE character_id = $1 AND crop_id = $2 AND quality = $3 AND quantity >= 1`,
          [characterId, cropConfig.cropId, quality],
        );
      }

      // 发放种子到种子袋（代数 = 种植种子代数 + 1）
      const newSeedGeneration = cell.planted_generation + 1;
      if (seedMutationType) {
        await query(
          `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
           VALUES ($1, $2, 1, $3, $4, NOW())
           ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
           SET quantity = farm_seed_inventory.quantity + 1,
               updated_at = CURRENT_TIMESTAMP`,
          [characterId, seedItemId, seedMutationType, newSeedGeneration],
        );
      } else {
        await query(
          `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
           VALUES ($1, $2, 1, '', $3, NOW())
           ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
           SET quantity = farm_seed_inventory.quantity + 1,
               updated_at = CURRENT_TIMESTAMP`,
          [characterId, seedItemId, newSeedGeneration],
        );
      }
    }

    // 发放杂交种子（如果有 pending_hybrid_seed 且满足条件）
    // 条件：金光变或优质品质（详见设计文档 3.6 节）
    let hybridSeedDistributed = false;
    let hybridSeedItemId: string | null = null;
    if (cell.pending_hybrid_seed && (mutationType === 'gold' || quality === 'hq')) {
      hybridSeedItemId = cell.pending_hybrid_seed;
      const seedConfig = getSeedConfig(hybridSeedItemId);
      if (seedConfig) {
        // 发放杂交种子（第 1 代）
        await query(
          `INSERT INTO farm_seed_inventory (character_id, item_id, quantity, mutation_type, generation, updated_at)
           VALUES ($1, $2, 1, '', 1, NOW())
           ON CONFLICT (character_id, item_id, mutation_type, generation) DO UPDATE
           SET quantity = farm_seed_inventory.quantity + 1,
               updated_at = CURRENT_TIMESTAMP`,
          [characterId, hybridSeedItemId],
        );
        hybridSeedDistributed = true;
      }
    }

    // 发放经验（根据作物配置的 expGain，缺省为 1）
    await query(
      `UPDATE farm_profile SET
         farm_exp = farm_exp + $3,
         total_harvest_count = total_harvest_count + 1,
         harvest_count_by_crop = jsonb_set(
           COALESCE(harvest_count_by_crop, '{}')::jsonb,
           ARRAY[$1],
           to_jsonb(COALESCE((harvest_count_by_crop::jsonb)->>$1, '0')::int + 1)
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $2`,
      [cropConfig.cropId, characterId, cropConfig.expGain ?? 1],
    );

    // 检查等级升级（自动升级）
    await checkAndLevelUp(characterId);

    // 清空格子（包括 pending_hybrid_seed）
    await query(
      `UPDATE farm_cell SET crop_id = NULL, planted_at = NULL, mutated = false,
              mutation_type = NULL, planted_generation = 0,
              pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, row, col],
    );

    // 写入活动日志：收获
    await logActivity({
      characterId,
      activityType: 'harvest',
      row,
      col,
      cropId: cell.crop_id,
      metadata: {
        quantity: actualYield,
        quality,
        mutationType,
        generation: cell.planted_generation,
        seedProduced,
        seedItemId,
        seedMutationType,
        hybridSeedDistributed,
        hybridSeedItemId,
      },
    });

    return {
      success: true,
      message: `收获 ${cropConfig.name} x${actualYield}`,
      quantity: actualYield,
      quality,
      mutationType,
      seedProduced,
      seedItemId,
      seedMutationType,
      hybridSeedDistributed,
      hybridSeedItemId,
    };
  });
}

/** 一键收菜结果 */
export interface HarvestAllResult {
  success: boolean;
  message: string;
  harvestedCount: number;
  results: Array<{ row: number; col: number; success: boolean; message: string }>;
}

/** 一键收获所有成熟作物 */
export async function harvestAll(characterId: number): Promise<HarvestAllResult> {
  // 查询所有有作物的格子
  const cellRows = await query<{
    row: number;
    col: number;
    crop_id: string;
    planted_at_epoch: number;
    mutation_type: string | null;
  }>(
    `SELECT row, col, crop_id,
            EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
            mutation_type
     FROM farm_cell
     WHERE character_id = $1 AND crop_id IS NOT NULL`,
    [characterId],
  );

  if (cellRows.rows.length === 0) {
    return { success: true, message: '没有可收获的作物', harvestedCount: 0, results: [] };
  }

  // 查询装饰物索引（用于计算生长状态）
  const decoRows = await query<{ row: number; col: number; decoration_type: string }>(
    `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
    [characterId],
  );
  const decoByCell = new Map<string, string>();
  for (const d of decoRows.rows) {
    decoByCell.set(`${d.row},${d.col}`, d.decoration_type);
  }

  const gridConfig = getGridConfig();
  const accelMul = getAccelerationMultiplier();
  const now = Date.now();

  // 筛选可收获的格子
  const harvestableCells: Array<{ row: number; col: number }> = [];
  for (const cell of cellRows.rows) {
    const cropConfig = getCropConfig(cell.crop_id);
    if (!cropConfig) continue;

    const plantedAt = Math.floor(Number(cell.planted_at_epoch));
    const mutationType = cell.mutation_type as MutationType | null;

    // 计算相邻灵泉数量（速熟变加成）
    let springCount = 0;
    const adjacent = getHybridAdjacentCells(cell.row, cell.col, gridConfig.maxRows, gridConfig.fixedCols);
    for (const adj of adjacent) {
      if (decoByCell.get(`${adj.row},${adj.col}`) === 'spring') springCount++;
    }

    const speedMul = computeSpeedMultiplier(mutationType, springCount);
    const witherMul = computeWitherMultiplier(mutationType);
    const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

    if (state.stage === 'harvestable') {
      harvestableCells.push({ row: cell.row, col: cell.col });
    }
  }

  if (harvestableCells.length === 0) {
    return { success: true, message: '没有成熟的作物', harvestedCount: 0, results: [] };
  }

  // 逐个收获
  const results: Array<{ row: number; col: number; success: boolean; message: string }> = [];
  let harvestedCount = 0;
  for (const { row, col } of harvestableCells) {
    const result = await harvestCrop(characterId, row, col);
    results.push({ row, col, success: result.success, message: result.message });
    if (result.success) harvestedCount++;
  }

  return {
    success: true,
    message: `收获 ${harvestedCount} 块作物`,
    harvestedCount,
    results,
  };
}

// ==================== 灵材出售 ====================

// ==================== 铲除 ====================

export interface RemoveResult {
  success: boolean;
  message: string;
  /** 是否撤销了已判定的杂交 */
  hybridRevoked?: boolean;
}

/**
 * 铲除作物。
 * 如果作物处于萌芽阶段（stageIndex === 0）且有待发放的杂交种子，撤销杂交（不发放种子）。
 * 同时检查相邻格子：如果移除当前作物后，某个相邻作物的杂交配方无法满足，也撤销该杂交。
 * 详见设计文档 3.8 节：提前铲除惩罚机制。
 */
export async function removeCrop(
  characterId: number,
  row: number,
  col: number,
): Promise<RemoveResult> {
  return withTransaction(async () => {
    const cellResult = await query<{
      crop_id: string | null;
      planted_at_epoch: number | null;
      mutation_type: string | null;
      pending_hybrid_seed: string | null;
      planted_generation: number;
    }>(
      `SELECT crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutation_type, pending_hybrid_seed, planted_generation
       FROM farm_cell
       WHERE character_id = $1 AND row = $2 AND col = $3 FOR UPDATE`,
      [characterId, row, col],
    );
    if (cellResult.rowCount === 0) return { success: false, message: '格子不存在' };
    const cell = cellResult.rows[0];
    if (!cell.crop_id || cell.planted_at_epoch == null) {
      return { success: false, message: '格子无作物' };
    }

    const cropConfig = getCropConfig(cell.crop_id);
    if (!cropConfig) return { success: false, message: '配置缺失' };

    const plantedAt = Math.floor(Number(cell.planted_at_epoch));
    const now = Date.now();
    const mutationType = cell.mutation_type as MutationType | null;

    // 查询相邻装饰物（用于计算生长状态）
    const decoRows = await query<DecorationRow>(
      `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
      [characterId],
    );
    const decoByCell = new Map<string, string>();
    for (const d of decoRows.rows) {
      decoByCell.set(`${d.row},${d.col}`, d.decoration_type);
    }
    const gridConfig = getGridConfig();
    const adjacent = getAdjacentCells(row, col, gridConfig.maxRows, gridConfig.fixedCols);
    let springCount = 0;
    for (const adj of adjacent) {
      if (decoByCell.get(`${adj.row},${adj.col}`) === 'spring') springCount++;
    }

    const speedMul = computeSpeedMultiplier(mutationType, springCount);
    const witherMul = computeWitherMultiplier(mutationType);
    const accelMul = getAccelerationMultiplier();
    const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

    // 提前铲除惩罚：萌芽阶段（stageIndex === 0）铲除时，撤销已判定的杂交
    let hybridRevoked = false;
    if (state.stageIndex === 0 && cell.pending_hybrid_seed) {
      hybridRevoked = true;
    }

    // 清除格子数据（包括 pending_hybrid_seed）
    await query(
      `UPDATE farm_cell SET crop_id = NULL, planted_at = NULL, mutated = false,
              mutation_type = NULL, planted_generation = 0,
              pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, row, col],
    );

    // 检查相邻格子：移除当前作物后，是否有作物的杂交配方无法满足
    // 如果有，撤销该杂交
    const removedCropId = cell.crop_id;
    for (const adj of adjacent) {
      const adjCellResult = await query<{
        crop_id: string | null;
        pending_hybrid_seed: string | null;
      }>(
        `SELECT crop_id, pending_hybrid_seed
         FROM farm_cell
         WHERE character_id = $1 AND row = $2 AND col = $3 AND crop_id IS NOT NULL AND pending_hybrid_seed IS NOT NULL
         FOR UPDATE`,
        [characterId, adj.row, adj.col],
      );
      if (adjCellResult.rowCount === 0) continue;
      const adjCell = adjCellResult.rows[0];
      if (!adjCell.crop_id || !adjCell.pending_hybrid_seed) continue;

      // 查询该相邻格子的四方向相邻作物配置（不包括当前被铲除的格子）
      const adjAdjacent = getHybridAdjacentCells(adj.row, adj.col, gridConfig.maxRows, gridConfig.fixedCols);
      const adjAdjacentCropConfigs: Array<{ cropId: string }> = [];
      for (const adjAdj of adjAdjacent) {
        // 跳过当前被铲除的格子
        if (adjAdj.row === row && adjAdj.col === col) continue;
        const adjAdjCellResult = await query<{ crop_id: string | null }>(
          `SELECT crop_id FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3 AND crop_id IS NOT NULL`,
          [characterId, adjAdj.row, adjAdj.col],
        );
        if ((adjAdjCellResult.rowCount ?? 0) > 0 && adjAdjCellResult.rows[0].crop_id) {
          const cropConfig = getCropConfig(adjAdjCellResult.rows[0].crop_id!);
          if (cropConfig) {
            adjAdjacentCropConfigs.push(cropConfig);
          }
        }
      }

      // 检查是否需要撤销杂交
      const shouldRevoke = checkHybridRevocation(
        adjCell.crop_id,
        adjAdjacentCropConfigs as any,
        adjCell.pending_hybrid_seed,
      );
      if (shouldRevoke) {
        await query(
          `UPDATE farm_cell SET pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE character_id = $1 AND row = $2 AND col = $3`,
          [characterId, adj.row, adj.col],
        );
        hybridRevoked = true;
      }
    }

    // 写入活动日志：铲除
    await logActivity({
      characterId,
      activityType: 'remove',
      row,
      col,
      cropId: cell.crop_id,
      metadata: {
        mutationType,
        generation: cell.planted_generation,
        stageIndex: state.stageIndex,
        hybridRevoked,
        pendingHybridSeed: cell.pending_hybrid_seed,
      },
    });

    return {
      success: true,
      message: hybridRevoked ? '作物已铲除，杂交种子已撤销' : '作物已铲除',
      hybridRevoked,
    };
  });
}

// ==================== 移植 ====================

export interface TransplantResult {
  success: boolean;
  message: string;
  fromCell?: FarmCellDto;
  toCell?: FarmCellDto;
}

/**
 * 移植作物到另一个空格子。
 * 限制：只能移植未成熟（growing 阶段）的作物。
 * 移植后杂交状态（pending_hybrid_seed）清除，需重新触发。
 */
export async function transplantCrop(
  characterId: number,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
): Promise<TransplantResult> {
  return withTransaction(async () => {
    // 校验源格子和目标格子不为同一位置
    if (fromRow === toRow && fromCol === toCol) {
      return { success: false, message: '源格子和目标格子不能相同' };
    }

    // 锁定源格子和目标格子
    const cellsResult = await query<{
      row: number;
      col: number;
      unlocked: boolean;
      crop_id: string | null;
      planted_at_epoch: number | null;
      mutated: boolean;
      mutation_type: string | null;
      planted_generation: number;
      pending_hybrid_seed: string | null;
    }>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type, planted_generation, pending_hybrid_seed
       FROM farm_cell
       WHERE character_id = $1 AND ((row = $2 AND col = $3) OR (row = $4 AND col = $5))
       FOR UPDATE`,
      [characterId, fromRow, fromCol, toRow, toCol],
    );
    if (cellsResult.rowCount !== 2) {
      return { success: false, message: '格子不存在' };
    }

    const fromCell = cellsResult.rows.find((r) => r.row === fromRow && r.col === fromCol)!;
    const toCell = cellsResult.rows.find((r) => r.row === toRow && r.col === toCol)!;

    // 校验源格子有作物
    if (!fromCell.crop_id || !fromCell.planted_at_epoch) {
      return { success: false, message: '源格子没有作物' };
    }

    // 校验目标格子为空且已解锁
    if (!toCell.unlocked) {
      return { success: false, message: '目标格子未解锁' };
    }
    if (toCell.crop_id) {
      return { success: false, message: '目标格子已有作物' };
    }

    // 校验源作物处于未成熟阶段
    const cropConfig = getCropConfig(fromCell.crop_id);
    if (!cropConfig) {
      return { success: false, message: '作物配置不存在' };
    }
    const plantedAt = Math.floor(Number(fromCell.planted_at_epoch));
    const now = Date.now();
    const speedMul = computeSpeedMultiplier(fromCell.mutation_type as MutationType | null, 0);
    const witherMul = computeWitherMultiplier(fromCell.mutation_type as MutationType | null);
    const accelMul = getAccelerationMultiplier();
    const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

    if (state.stage !== 'growing') {
      return { success: false, message: '只能移植未成熟的作物' };
    }

    // 查询装饰物索引（用于返回 DTO）
    const decoRows = await query<{ row: number; col: number; decoration_type: string }>(
      `SELECT row, col, decoration_type FROM farm_decoration WHERE character_id = $1`,
      [characterId],
    );
    const decoByCell = new Map<string, DecorationType>();
    for (const d of decoRows.rows) {
      decoByCell.set(`${d.row},${d.col}`, d.decoration_type as DecorationType);
    }

    // 将源格子数据复制到目标格子（清除 pending_hybrid_seed）
    await query(
      `UPDATE farm_cell
       SET crop_id = $1, planted_at = TO_TIMESTAMP($2), mutated = $3, mutation_type = $4,
           planted_generation = $5, pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $6 AND row = $7 AND col = $8`,
      [
        fromCell.crop_id,
        plantedAt / 1000,  // 在 JS 中转换为秒级时间戳
        fromCell.mutated,
        fromCell.mutation_type,
        fromCell.planted_generation,
        characterId,
        toRow,
        toCol,
      ],
    );

    // 清空源格子
    await query(
      `UPDATE farm_cell
       SET crop_id = NULL, planted_at = NULL, mutated = false, mutation_type = NULL,
           planted_generation = 0, pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, fromRow, fromCol],
    );

    // 写入活动日志
    await logActivity({
      characterId,
      activityType: 'transplant',
      row: toRow,
      col: toCol,
      cropId: fromCell.crop_id,
      metadata: {
        fromRow,
        fromCol,
        generation: fromCell.planted_generation,
      },
    });

    // 返回更新后的格子数据
    const updatedFromResult = await query<CellRow>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type
       FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, fromRow, fromCol],
    );
    const updatedToResult = await query<CellRow>(
      `SELECT row, col, unlocked, crop_id,
              EXTRACT(EPOCH FROM planted_at) * 1000 AS planted_at_epoch,
              mutated, mutation_type
       FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, toRow, toCol],
    );

    const gridConfig = getGridConfig();
    return {
      success: true,
      message: '移植成功',
      fromCell: buildCellDto(updatedFromResult.rows[0], decoByCell, now, gridConfig),
      toCell: buildCellDto(updatedToResult.rows[0], decoByCell, now, gridConfig),
    };
  });
}

// ==================== 灵材出售 ====================

/**
 * 出售灵材。按 cropConfig.harvestTradeUnit 个体 = 1 交易单位。
 * quantity 参数为交易单位数（不是个体数）。
 * 实际消耗的个体数 = quantity × harvestTradeUnit。
 */
export async function sellHarvest(
  characterId: number,
  cropId: string,
  quality: CropQuality,
  tradeUnits: number,
): Promise<{ success: boolean; message: string }> {
  return withTransaction(async () => {
    const cropConfig = getCropConfig(cropId);
    if (!cropConfig) return { success: false, message: '作物不存在' };
    if (tradeUnits <= 0) return { success: false, message: '数量无效' };

    const tradeUnitSize = cropConfig.harvestTradeUnit;
    const individualCount = tradeUnits * tradeUnitSize;

    // 扣减灵材库存
    const result = await query(
      `UPDATE farm_harvest_inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $2 AND crop_id = $3 AND quality = $4 AND quantity >= $1
       RETURNING id`,
      [individualCount, characterId, cropId, quality],
    );
    if (result.rowCount === 0) return { success: false, message: '灵材不足' };

    // 计算售价（品质影响单价）
    const priceMul = computeSellPriceMultiplier(quality);
    const unitPrice = Math.floor(cropConfig.sellPricePerUnit * priceMul);
    const totalEarn = BigInt(unitPrice * tradeUnits);

    await addSpiritStones(characterId, totalEarn, {
      bizType: 'farm_sell_harvest',
      bizId: `${cropId}_${quality}`,
      memo: `出售 ${cropConfig.name}(${quality}) x${tradeUnits} 单位`,
    });

    await logActivity({
      characterId,
      activityType: 'sell',
      row: -1,
      col: -1,
      cropId,
      metadata: {
        quality,
        tradeUnits,
        individualCount,
        unitPrice,
        totalEarn: Number(totalEarn),
      },
    });

    await query(
      `DELETE FROM farm_harvest_inventory WHERE character_id = $1 AND crop_id = $2 AND quality = $3 AND quantity = 0`,
      [characterId, cropId, quality],
    );

    return { success: true, message: `出售成功，获得 ${totalEarn} 灵石` };
  });
}

export async function sellAllHarvest(
  characterId: number,
): Promise<{ success: boolean; message: string; totalEarn: number }> {
  return withTransaction(async () => {
    const rows = await query<HarvestRow>(
      `SELECT crop_id, quantity, quality FROM farm_harvest_inventory WHERE character_id = $1 AND quantity > 0`,
      [characterId],
    );
    if (rows.rows.length === 0) return { success: true, message: '没有可出售的灵材', totalEarn: 0 };

    let totalEarn = 0;
    for (const row of rows.rows) {
      const cropConfig = getCropConfig(row.crop_id);
      if (!cropConfig) continue;
      const tradeUnitSize = cropConfig.harvestTradeUnit;
      const tradeUnits = Math.floor(row.quantity / tradeUnitSize);
      if (tradeUnits <= 0) continue;
      const priceMul = computeSellPriceMultiplier(row.quality as CropQuality);
      const unitPrice = Math.floor(cropConfig.sellPricePerUnit * priceMul);
      totalEarn += unitPrice * tradeUnits;
    }

    if (totalEarn === 0) return { success: true, message: '没有可出售的灵材', totalEarn: 0 };

    // 出售时按各作物 harvestTradeUnit 的整数倍扣除，余数保留
    for (const row of rows.rows) {
      const cropConfig = getCropConfig(row.crop_id);
      if (!cropConfig) continue;
      const tradeUnitSize = cropConfig.harvestTradeUnit;
      const tradeUnits = Math.floor(row.quantity / tradeUnitSize);
      if (tradeUnits <= 0) continue;
      const deductCount = tradeUnits * tradeUnitSize;
      await query(
        `UPDATE farm_harvest_inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP
         WHERE character_id = $2 AND crop_id = $3 AND quality = $4`,
        [deductCount, characterId, row.crop_id, row.quality],
      );
    }

    await query(
      `DELETE FROM farm_harvest_inventory WHERE character_id = $1 AND quantity = 0`,
      [characterId],
    );

    await addSpiritStones(characterId, BigInt(totalEarn), {
      bizType: 'farm_sell_harvest',
      memo: '一键出售全部灵材',
    });

    await logActivity({
      characterId,
      activityType: 'sell',
      row: -1,
      col: -1,
      metadata: {
        isSellAll: true,
        items: rows.rows.map(r => {
          const cropConfig = getCropConfig(r.crop_id);
          const tradeUnitSize = cropConfig?.harvestTradeUnit ?? 1;
          const tradeUnits = Math.floor(r.quantity / tradeUnitSize);
          return {
            cropId: r.crop_id,
            cropName: cropConfig?.name ?? r.crop_id,
            quality: r.quality,
            tradeUnits,
          };
        }),
        totalEarn,
      },
    });

    return { success: true, message: `出售成功，获得 ${totalEarn} 灵石`, totalEarn };
  });
}

// ==================== 格子扩展 ====================

/**
 * 扩展单个格子。
 * 费用 = 1000 灵石 + 当前等阶 xiRangCost × 息壤单价
 */
export async function expandCell(
  characterId: number,
  row: number,
  col: number,
): Promise<{ success: boolean; message: string }> {
  return withTransaction(async () => {
    const profile = await getFarmProfile(characterId);
    if (!profile) return { success: false, message: '请先开垦灵田' };

    const gridConfig = getGridConfig();
    const cellReclaimConfig = getCellReclaimConfig();
    const xiRangConfig = getXiRangConfig();
    const tierConfig = getFarmTierConfig(profile.farm_tier);

    // 校验格子范围
    if (row < 0 || row >= gridConfig.maxRows || col < 0 || col >= gridConfig.fixedCols) {
      return { success: false, message: '格子坐标无效' };
    }

    // 校验格子是否已解锁
    const cellResult = await query<{ unlocked: boolean }>(
      `SELECT unlocked FROM farm_cell WHERE character_id = $1 AND row = $2 AND col = $3 FOR UPDATE`,
      [characterId, row, col],
    );
    if (cellResult.rowCount === 0) return { success: false, message: '格子不存在' };
    if (cellResult.rows[0].unlocked) return { success: false, message: '格子已解锁' };

    // 计算费用：1000 灵石 + 当前等阶 xiRangCost × 息壤单价
    const spiritStoneCost = cellReclaimConfig.spiritStoneCost;
    const xiRangCost = tierConfig?.xiRangCost ?? 1;
    const totalCost = spiritStoneCost + xiRangCost * xiRangConfig.pricePerUnit;

    // 扣除灵石
    const consumeResult = await consumeSpiritStones(characterId, BigInt(totalCost), {
      bizType: 'farm_expand_cell',
      bizId: `cell_${row}_${col}`,
      memo: `扩展格子 (${row + 1}-${col + 1})`,
    });
    if (!consumeResult.success) return { success: false, message: consumeResult.message };

    // 解锁格子
    await query(
      `UPDATE farm_cell SET unlocked = true, updated_at = CURRENT_TIMESTAMP
       WHERE character_id = $1 AND row = $2 AND col = $3`,
      [characterId, row, col],
    );

    // 检查是否需要更新 max_row（如果解锁了新行的第一个格子）
    if (row + 1 > profile.max_row) {
      await query(
        `UPDATE farm_profile SET max_row = $1, updated_at = CURRENT_TIMESTAMP WHERE character_id = $2`,
        [row + 1, characterId],
      );
    }

    return { success: true, message: `格子 ${row + 1}-${col + 1} 扩展成功` };
  });
}

// ==================== 等阶突破 ====================

/**
 * 等阶突破（黄级 → 玄级 → 地级 → 天级）。
 * 条件：达到最小等级 + 消耗灵石（费用 = 当前格子数 × 目标等阶 xiRangCost × 息壤单价）
 */
export async function upgradeTier(
  characterId: number,
): Promise<{ success: boolean; message: string; newTier?: number }> {
  return withTransaction(async () => {
    const profile = await getFarmProfile(characterId);
    if (!profile) return { success: false, message: '请先开垦灵田' };

    const currentTier = profile.farm_tier;
    const nextTierConfig = getFarmTierConfig(currentTier + 1);
    if (!nextTierConfig) return { success: false, message: '已达最高等阶' };

    // 检查等级要求
    if (profile.farm_level < nextTierConfig.minLevel) {
      return { success: false, message: `需要等级 ${nextTierConfig.minLevel}（当前 ${profile.farm_level}）` };
    }

    const gridConfig = getGridConfig();
    const xiRangConfig = getXiRangConfig();

    // 计算费用：当前格子数 × 目标等阶 xiRangCost × 息壤单价
    const cellCount = profile.max_row * gridConfig.fixedCols;
    const totalCost = cellCount * nextTierConfig.xiRangCost * xiRangConfig.pricePerUnit;

    // 扣除灵石
    const consumeResult = await consumeSpiritStones(characterId, BigInt(totalCost), {
      bizType: 'farm_upgrade_tier',
      bizId: `tier_${nextTierConfig.tier}`,
      memo: `等阶突破 → ${nextTierConfig.displayName}`,
    });
    if (!consumeResult.success) return { success: false, message: consumeResult.message };

    // 更新等阶
    await query(
      `UPDATE farm_profile SET farm_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE character_id = $2`,
      [nextTierConfig.tier, characterId],
    );

    return {
      success: true,
      message: `等阶突破为 ${nextTierConfig.displayName}`,
      newTier: nextTierConfig.tier,
    };
  });
}

// ==================== DTO 构建 ====================

/** 检查并执行等级升级（自动升级） */
async function checkAndLevelUp(characterId: number): Promise<void> {
  const profile = await getFarmProfile(characterId);
  if (!profile) return;

  let currentLevel = profile.farm_level;
  let currentExp = Number(profile.farm_exp);

  // 循环升级（可能一次收获升多级）
  while (currentLevel < 100) {
    const requiredExp = calculateLevelUpExpRequired(currentLevel + 1);
    if (currentExp >= requiredExp) {
      currentExp -= requiredExp;
      currentLevel++;
    } else {
      break;
    }
  }

  // 更新等级和经验
  if (currentLevel !== profile.farm_level || currentExp !== Number(profile.farm_exp)) {
    await query(
      `UPDATE farm_profile SET farm_level = $1, farm_exp = $2, updated_at = CURRENT_TIMESTAMP WHERE character_id = $3`,
      [currentLevel, currentExp, characterId],
    );
  }
}

function buildFarmInfoDto(profile: ProfileRow): FarmInfoDto {
  const tier = profile.farm_tier;
  const level = profile.farm_level;
  const exp = Number(profile.farm_exp);

  const tierConfig = getFarmTierConfig(tier);
  const nextTierConfig = getFarmTierConfig(tier + 1);
  const xiRangConfig = getXiRangConfig();

  // 计算下一级所需经验
  const nextLevelExpRequired = level < 100 ? calculateLevelUpExpRequired(level + 1) : 0;

  // 计算下一等阶信息
  let nextTier: FarmInfoDto['nextTier'] = null;
  if (nextTierConfig) {
    // 突破费用 = 当前格子数 × 目标等阶 xiRangCost × 息壤单价
    const cellCount = profile.max_row * getGridConfig().fixedCols;
    const totalSpiritStoneCost = cellCount * nextTierConfig.xiRangCost * xiRangConfig.pricePerUnit;
    nextTier = {
      tier: nextTierConfig.tier,
      name: nextTierConfig.name,
      displayName: nextTierConfig.displayName,
      minLevel: nextTierConfig.minLevel,
      xiRangCost: nextTierConfig.xiRangCost,
      totalSpiritStoneCost,
    };
  }

  return {
    farmTier: tier,
    farmTierName: tierConfig?.displayName ?? '未知',
    farmLevel: level,
    farmExp: exp,
    nextLevelExpRequired,
    maxRow: profile.max_row,
    currentTierXiRangCost: tierConfig?.xiRangCost ?? 1,
    xiRangPricePerUnit: xiRangConfig.pricePerUnit,
    nextTier,
  };
}

function buildCellDto(
  row: CellRow,
  decoByCell: Map<string, DecorationType>,
  now: number,
  gridConfig: { maxRows: number; fixedCols: number },
): FarmCellDto {
  const deco = decoByCell.get(`${row.row},${row.col}`);
  const base: FarmCellDto = {
    row: row.row,
    col: row.col,
    unlocked: row.unlocked,
    cropId: row.crop_id,
    cropName: null,
    cropElement: [],
    cropRarity: null,
    cropState: null,
    mutated: row.mutated,
    mutationType: row.mutation_type as MutationType | null,
    plantedAt: row.planted_at_epoch != null ? Math.floor(Number(row.planted_at_epoch)) : null,
    plantedGeneration: row.planted_generation,
    hasDecoration: deco != null,
    decorationType: deco ?? null,
    pendingHybridSeedItemId: row.pending_hybrid_seed,
    pendingHybridSeedName: null,
  };

  // 获取杂交种子名称
  if (row.pending_hybrid_seed) {
    const seedConfig = getSeedConfig(row.pending_hybrid_seed);
    if (seedConfig) {
      base.pendingHybridSeedName = seedConfig.name;
    }
  }

  if (!row.crop_id || row.planted_at_epoch == null) return base;

  const cropConfig = getCropConfig(row.crop_id);
  if (!cropConfig) return base;

  const plantedAt = Math.floor(Number(row.planted_at_epoch));
  const mutationType = row.mutation_type as MutationType | null;

  // 计算相邻格子的灵泉数量（用于速熟变倍率）
  const adjacent = getAdjacentCells(row.row, row.col, gridConfig.maxRows, gridConfig.fixedCols);
  let springCount = 0;
  for (const adj of adjacent) {
    if (decoByCell.get(`${adj.row},${adj.col}`) === 'spring') springCount++;
  }

  const speedMul = computeSpeedMultiplier(mutationType, springCount);
  const witherMul = computeWitherMultiplier(mutationType);
  const accelMul = getAccelerationMultiplier();
  const state = computeCropState(cropConfig, plantedAt, now, speedMul, witherMul, accelMul);

  return {
    ...base,
    cropName: cropConfig.name,
    cropElement: cropConfig.element,
    cropRarity: cropConfig.rarity,
    cropState: {
      ...state,
      maturedAt: state.maturedAt != null ? Math.floor(state.maturedAt) : null,
      witheredAt: state.witheredAt != null ? Math.floor(state.witheredAt) : null,
      intervals: state.intervals.map((iv) => ({
        ...iv,
        startAt: Math.floor(iv.startAt),
        endAt: iv.endAt === Infinity ? Infinity : Math.floor(iv.endAt),
      })),
    },
  };
}

function buildSeedInventoryDto(rows: SeedRow[]): SeedInventoryItem[] {
  return rows
    .filter((row) => row.quantity > 0)
    .map((row) => ({
      id: row.id,
      itemId: row.item_id,
      quantity: row.quantity,
      mutationType: (row.mutation_type || null) as MutationType | null,
      generation: row.generation,
    }));
}

function buildHarvestInventoryDto(rows: HarvestRow[]): HarvestInventoryItem[] {
  return rows
    .filter((r) => r.quantity > 0)
    .map((row) => ({
      cropId: row.crop_id,
      quantity: row.quantity,
      quality: row.quality as CropQuality,
    }));
}

// ==================== 静态配置 ====================

/** 获取灵田静态配置（种子目录 + 灵材目录 + 杂交配方 + 全局配置） */
export function getFarmStaticConfig(): FarmStaticConfigDto {
  const seeds: SeedConfigDto[] = getAllSeeds()
    .filter((s) => s.enabled)
    .map((s) => {
      const cropConfig = getCropConfig(s.cropId);
      return {
        itemId: s.itemId,
        cropId: s.cropId,
        name: s.name,
        traits: cropConfig?.traits ?? [],
        element: cropConfig?.element ?? [],
        buyPrice: s.buyPrice,
        sellPrice: s.sellPrice,
        requiredTier: s.requiredTier,
        enabled: s.enabled,
        seedUnit: s.seedUnit,
        maxStack: s.maxStack,
      };
    })
    .sort((a, b) => a.requiredTier - b.requiredTier || a.buyPrice - b.buyPrice);

  const crops: CropConfigDto[] = getAllCrops()
    .filter((c) => c.enabled)
    .map((c) => ({
      cropId: c.cropId,
      name: c.name,
      rarity: c.rarity,
      element: c.element,
      harvestUnit: c.harvestUnit,
      sellPricePerUnit: c.sellPricePerUnit,
      harvestTradeUnit: c.harvestTradeUnit,
      requiredTier: c.requiredTier,
      yieldMin: c.yieldMin,
      yieldMax: c.yieldMax,
      growthStageMinutes: c.growthStageMinutes,
      stageLabels: c.stageLabels,
      witherAfterMinutes: c.witherAfterMinutes,
      // 总生长时间 = 前 (n-1) 个阶段的总和，最后一个阶段（如"成熟"）是收获点，
      // 实际持续时间由 witherAfterMinutes 决定，不计入总生长时间
      totalGrowthMinutes: c.growthStageMinutes.slice(0, -1).reduce((sum, m) => sum + m, 0),
    }));

  const hybridRecipes: HybridRecipeConfigDto[] = getAllRecipes()
    .filter((r) => r.enabled)
    .map((r) => {
      const resultSeed = getSeedConfig(r.resultSeedItemId);
      return {
        recipeId: r.recipeId,
        name: r.name,
        baseCropId: r.baseCropId,
        requiredAdjacent: r.requiredAdjacent,
        resultCropName: resultSeed?.name ?? r.resultSeedItemId,
      };
    });

  return {
    seeds,
    crops,
    hybridRecipes,
    grid: getGridConfig(),
    xiRang: getXiRangConfig(),
    cellReclaim: getCellReclaimConfig(),
    farmTiers: [...getAllFarmTiers()],
    accelerationMultiplier: getAccelerationMultiplier(),
  };
}

// ==================== 活动日志 ====================

/** 活动日志行类型 */
type ActivityLogRow = {
  id: string;
  activity_type: string;
  row: number;
  col: number;
  crop_id: string | null;
  metadata: Record<string, unknown>;
  created_at_epoch: number;
};

/** 活动日志 DTO */
export interface ActivityLogDto {
  id: string;
  activityType: string;
  row: number;
  col: number;
  cropId: string | null;
  cropName: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

/** 获取活动日志（分页） */
export async function getFarmLog(
  characterId: number,
  page: number = 1,
  pageSize: number = 20,
): Promise<{ logs: ActivityLogDto[]; total: number }> {
  const clampedPage = Math.max(1, page);
  const clampedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const offset = (clampedPage - 1) * clampedPageSize;

  const [result, countResult] = await Promise.all([
    query<ActivityLogRow>(
      `SELECT id::text, activity_type, row, col, crop_id, metadata,
              EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_epoch
       FROM farm_activity_log
       WHERE character_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [characterId, clampedPageSize, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM farm_activity_log WHERE character_id = $1`,
      [characterId],
    ),
  ]);

  const cropMap = new Map(getAllCrops().map((c) => [c.cropId, c.name]));
  const total = Number(countResult.rows[0].count);

  const logs = result.rows.map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    row: row.row,
    col: row.col,
    cropId: row.crop_id,
    cropName: row.crop_id ? (cropMap.get(row.crop_id) ?? row.crop_id) : null,
    metadata: row.metadata,
    createdAt: Math.floor(Number(row.created_at_epoch)),
  }));

  return { logs, total };
}
