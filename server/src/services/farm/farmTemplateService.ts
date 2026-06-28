/**
 * 灵田种植模板服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：模板 CRUD、应用模板种植（TCC 两段式事务）。
 * 2. 不做什么：不做单个种植的核心逻辑（复用 farmService.plantCrop 的内部实现）。
 *
 * 数据流 / 状态流：
 * 前端请求 → route → 本服务 → DB query + 复用种植逻辑 → 返回 DTO。
 *
 * 复用设计说明：
 * - 种植核心逻辑（变异判定、杂交触发、活动日志）通过内部辅助函数复用。
 * - TCC 两阶段在单个 withTransaction 中完成：Try 校验 → Confirm 种植 → 失败自动回滚。
 *
 * 关键边界条件与坑点：
 * 1. Try 阶段必须用 SELECT FOR UPDATE 锁定种子记录，防止并发超扣。
 * 2. 模板项使用 seedItemId（而非 seed_inventory.id），因为库存 ID 会变化。
 * 3. 模板最多 16 项（4×4 网格），每个玩家最多 20 个模板。
 */
import { query, withTransaction } from '../../config/database.js';
import { getCropConfig, getSeedConfig, getFarmTierConfig } from './farmConfigLoader.js';
import {
  rollMutation,
  rollMutationInheritance,
} from './farmMutationService.js';
import type { MutationType } from './farmTypes.js';
import { tryHybridOnPlant } from './farmHybridService.js';
import { logActivity } from './farmActivityLogService.js';
import type { PlantResult } from './farmService.js';

// ==================== 类型定义 ====================

export interface PlantTemplateItemDto {
  id: number;
  rowOffset: number;
  colOffset: number;
  seedItemId: string;
  mutationType: string | null;
}

export interface PlantTemplateDto {
  id: number;
  name: string;
  description: string | null;
  items: PlantTemplateItemDto[];
  createdAt: number;
  updatedAt: number;
}

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  created_at_epoch: number;
  updated_at_epoch: number;
}

interface TemplateItemRow {
  id: number;
  template_id: number;
  row_offset: number;
  col_offset: number;
  seed_item_id: string;
  mutation_type: string | null;
}

interface SeedInventoryRow {
  id: number;
  item_id: string;
  quantity: number;
  mutation_type: string;
  generation: number;
}

interface CellRow {
  row: number;
  col: number;
  unlocked: boolean;
  crop_id: string | null;
}

// 种植计划项（Confirm 阶段使用）
interface PlantPlanItem {
  row: number;
  col: number;
  seedInventoryId: number;
  seedItemId: string;
  cropId: string;
  mutationType: string | null;
  generation: number;
}

// ==================== 常量 ====================

const MAX_TEMPLATES_PER_PLAYER = 20;
/** 模板固定为 4×4，与灵田初始大小一致，后续不再扩充 */
const TEMPLATE_ROWS = 4;
const TEMPLATE_COLS = 4;
const MAX_ITEMS_PER_TEMPLATE = TEMPLATE_ROWS * TEMPLATE_COLS;

// ==================== 模板 CRUD ====================

/** 创建种植模板 */
export async function createTemplate(
  characterId: number,
  name: string,
  description: string | null,
  items: Array<{
    rowOffset: number;
    colOffset: number;
    seedItemId: string;
    mutationType: string | null;
  }>,
): Promise<{ success: boolean; message: string; templateId?: number }> {
  if (!name.trim()) {
    return { success: false, message: '模板名称不能为空' };
  }
  if (items.length === 0) {
    return { success: false, message: '模板至少需要一个种植项' };
  }
  if (items.length > MAX_ITEMS_PER_TEMPLATE) {
    return { success: false, message: `模板最多 ${MAX_ITEMS_PER_TEMPLATE} 个种植项` };
  }

  // 校验偏移量在 4×4 范围内
  for (const item of items) {
    if (item.rowOffset < 0 || item.rowOffset >= TEMPLATE_ROWS || item.colOffset < 0 || item.colOffset >= TEMPLATE_COLS) {
      return { success: false, message: `模板偏移量超出 4×4 范围` };
    }
  }

  // 校验种子 itemId 有效
  for (const item of items) {
    const seedConfig = getSeedConfig(item.seedItemId);
    if (!seedConfig) {
      return { success: false, message: `种子 ${item.seedItemId} 不存在` };
    }
  }

  return withTransaction(async () => {
    // 检查模板数量限制
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM farm_plant_template WHERE character_id = $1`,
      [characterId],
    );
    if (Number(countResult.rows[0].count) >= MAX_TEMPLATES_PER_PLAYER) {
      return { success: false, message: `最多创建 ${MAX_TEMPLATES_PER_PLAYER} 个模板` };
    }

    // 插入模板
    const templateResult = await query<{ id: number }>(
      `INSERT INTO farm_plant_template (character_id, name, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [characterId, name.trim(), description],
    );
    const templateId = templateResult.rows[0].id;

    // 插入模板项
    if (items.length > 0) {
      const itemValues = items
        .map(
          (item) =>
            `(${templateId}, ${item.rowOffset}, ${item.colOffset}, '${item.seedItemId}', ${item.mutationType ? `'${item.mutationType}'` : 'NULL'})`,
        )
        .join(', ');
      await query(
        `INSERT INTO farm_plant_template_item (template_id, row_offset, col_offset, seed_item_id, mutation_type)
         VALUES ${itemValues}`,
        [],
      );
    }

    return { success: true, message: '模板创建成功', templateId };
  });
}

/** 获取玩家的所有模板 */
export async function getTemplates(characterId: number): Promise<PlantTemplateDto[]> {
  const [templateRows, itemRows] = await Promise.all([
    query<TemplateRow>(
      `SELECT id, name, description,
              EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_epoch,
              EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_epoch
       FROM farm_plant_template
       WHERE character_id = $1
       ORDER BY updated_at DESC`,
      [characterId],
    ),
    query<TemplateItemRow>(
      `SELECT id, template_id, row_offset, col_offset, seed_item_id, mutation_type
       FROM farm_plant_template_item
       WHERE template_id IN (SELECT id FROM farm_plant_template WHERE character_id = $1)
       ORDER BY template_id, row_offset, col_offset`,
      [characterId],
    ),
  ]);

  // 按 template_id 分组
  const itemsByTemplate = new Map<number, PlantTemplateItemDto[]>();
  for (const item of itemRows.rows) {
    const list = itemsByTemplate.get(item.template_id) ?? [];
    list.push({
      id: item.id,
      rowOffset: item.row_offset,
      colOffset: item.col_offset,
      seedItemId: item.seed_item_id,
      mutationType: item.mutation_type,
    });
    itemsByTemplate.set(item.template_id, list);
  }

  return templateRows.rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    items: itemsByTemplate.get(t.id) ?? [],
    createdAt: Math.floor(Number(t.created_at_epoch)),
    updatedAt: Math.floor(Number(t.updated_at_epoch)),
  }));
}

/** 获取模板详情 */
export async function getTemplateDetail(
  templateId: number,
  characterId: number,
): Promise<PlantTemplateDto | null> {
  const templateResult = await query<TemplateRow>(
    `SELECT id, name, description,
            EXTRACT(EPOCH FROM created_at) * 1000 AS created_at_epoch,
            EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_at_epoch
     FROM farm_plant_template
     WHERE id = $1 AND character_id = $2`,
    [templateId, characterId],
  );
  if (templateResult.rows.length === 0) return null;

  const t = templateResult.rows[0];
  const itemRows = await query<TemplateItemRow>(
    `SELECT id, template_id, row_offset, col_offset, seed_item_id, mutation_type
     FROM farm_plant_template_item
     WHERE template_id = $1
     ORDER BY row_offset, col_offset`,
    [templateId],
  );

  return {
    id: t.id,
    name: t.name,
    description: t.description,
    items: itemRows.rows.map((item) => ({
      id: item.id,
      rowOffset: item.row_offset,
      colOffset: item.col_offset,
      seedItemId: item.seed_item_id,
      mutationType: item.mutation_type,
    })),
    createdAt: Math.floor(Number(t.created_at_epoch)),
    updatedAt: Math.floor(Number(t.updated_at_epoch)),
  };
}

/** 删除模板 */
export async function deleteTemplate(
  templateId: number,
  characterId: number,
): Promise<{ success: boolean; message: string }> {
  const result = await query(
    `DELETE FROM farm_plant_template WHERE id = $1 AND character_id = $2`,
    [templateId, characterId],
  );
  if (result.rowCount === 0) {
    return { success: false, message: '模板不存在或不属于当前用户' };
  }
  return { success: true, message: '模板删除成功' };
}

/** 更新模板（名称/描述/种植项） */
export async function updateTemplate(
  templateId: number,
  characterId: number,
  name: string,
  description: string | null,
  items: Array<{
    rowOffset: number;
    colOffset: number;
    seedItemId: string;
    mutationType: string | null;
  }>,
): Promise<{ success: boolean; message: string }> {
  if (!name.trim()) {
    return { success: false, message: '模板名称不能为空' };
  }
  if (items.length === 0) {
    return { success: false, message: '模板至少需要一个种植项' };
  }
  if (items.length > MAX_ITEMS_PER_TEMPLATE) {
    return { success: false, message: `模板最多 ${MAX_ITEMS_PER_TEMPLATE} 个种植项` };
  }

  // 校验偏移量在 4×4 范围内
  for (const item of items) {
    if (item.rowOffset < 0 || item.rowOffset >= TEMPLATE_ROWS || item.colOffset < 0 || item.colOffset >= TEMPLATE_COLS) {
      return { success: false, message: `模板偏移量超出 4×4 范围` };
    }
  }

  // 校验种子 itemId 有效
  for (const item of items) {
    const seedConfig = getSeedConfig(item.seedItemId);
    if (!seedConfig) {
      return { success: false, message: `种子 ${item.seedItemId} 不存在` };
    }
  }

  return withTransaction(async () => {
    // 校验模板存在且属于当前玩家
    const checkResult = await query<{ id: number }>(
      `SELECT id FROM farm_plant_template WHERE id = $1 AND character_id = $2`,
      [templateId, characterId],
    );
    if (checkResult.rows.length === 0) {
      return { success: false, message: '模板不存在或不属于当前用户' };
    }

    // 更新模板基本信息
    await query(
      `UPDATE farm_plant_template SET name = $1, description = $2, updated_at = NOW()
       WHERE id = $3 AND character_id = $4`,
      [name.trim(), description, templateId, characterId],
    );

    // 删除旧的种植项
    await query(
      `DELETE FROM farm_plant_template_item WHERE template_id = $1`,
      [templateId],
    );

    // 插入新的种植项
    if (items.length > 0) {
      const itemValues = items
        .map(
          (item) =>
            `(${templateId}, ${item.rowOffset}, ${item.colOffset}, '${item.seedItemId}', ${item.mutationType ? `'${item.mutationType}'` : 'NULL'})`,
        )
        .join(', ');
      await query(
        `INSERT INTO farm_plant_template_item (template_id, row_offset, col_offset, seed_item_id, mutation_type)
         VALUES ${itemValues}`,
        [],
      );
    }

    return { success: true, message: '模板更新成功' };
  });
}

// ==================== 应用模板种植（TCC 两段式） ====================

export interface ApplyTemplateResult {
  success: boolean;
  message: string;
  plantedCount: number;
  results: PlantResult[];
}

/**
 * 应用模板种植（TCC 两段式事务）。
 *
 * Try 阶段：校验资源 + 锁定种子 + 构建种植计划
 * Confirm 阶段：执行种植（扣除种子、写入格子、触发杂交）
 * Cancel 阶段：事务自动回滚
 */
export async function applyPlantTemplate(
  characterId: number,
  templateId: number,
  startRow: number,
  startCol: number,
): Promise<ApplyTemplateResult> {
  return withTransaction(async () => {
    // ===== Try 阶段：资源校验与锁定 =====

    // 1. 获取模板
    const template = await getTemplateForPlant(templateId, characterId);
    if (!template) {
      return { success: false, message: '模板不存在', plantedCount: 0, results: [] };
    }
    if (template.items.length === 0) {
      return { success: false, message: '模板为空', plantedCount: 0, results: [] };
    }

    // 2. 计算实际格子坐标
    const plantTargets = template.items.map((item) => ({
      row: startRow + item.rowOffset,
      col: startCol + item.colOffset,
      seedItemId: item.seedItemId,
      requiredMutationType: item.mutationType,
    }));

    // 校验目标坐标在灵田范围内
    for (const target of plantTargets) {
      if (target.row < 0 || target.col < 0) {
        return { success: false, message: '模板起始位置超出灵田范围', plantedCount: 0, results: [] };
      }
    }

    // 3. 校验目标格子（全部已解锁且为空）
    const cellValidation = await validateCells(characterId, plantTargets);
    if (!cellValidation.success) {
      return { success: false, message: cellValidation.message, plantedCount: 0, results: [] };
    }

    // 4. 按种子条件分组，统计所需数量
    const seedRequirements = calculateSeedRequirements(plantTargets);

    // 5. 锁定种子记录并校验数量
    const lockedSeeds = await lockAndValidateSeeds(characterId, seedRequirements);
    if (!lockedSeeds.success || !lockedSeeds.seedMap) {
      return { success: false, message: lockedSeeds.message, plantedCount: 0, results: [] };
    }

    // 6. 校验等阶
    const tierValidation = await validateTier(characterId, plantTargets);
    if (!tierValidation.success) {
      return { success: false, message: tierValidation.message, plantedCount: 0, results: [] };
    }

    // 7. 构建种植计划（为每个目标分配具体的 seed_inventory.id）
    const plantPlans = buildPlantPlans(plantTargets, lockedSeeds.seedMap);

    // ===== Confirm 阶段：执行种植 =====
    const results: PlantResult[] = [];
    for (const plan of plantPlans) {
      const result = await executePlantInTransaction(
        characterId,
        plan.row,
        plan.col,
        plan.seedInventoryId,
        plan.seedItemId,
        plan.cropId,
        plan.mutationType,
        plan.generation,
      );
      results.push(result);
      if (!result.success) {
        // 种植失败，整个事务将回滚
        throw new Error(`种植失败: ${result.message}`);
      }
    }

    return {
      success: true,
      message: `种植 ${results.length} 块作物成功`,
      plantedCount: results.length,
      results,
    };
  });
}

// ==================== Try 阶段辅助函数 ====================

async function getTemplateForPlant(
  templateId: number,
  characterId: number,
): Promise<PlantTemplateDto | null> {
  return getTemplateDetail(templateId, characterId);
}

async function validateCells(
  characterId: number,
  targets: Array<{ row: number; col: number }>,
): Promise<{ success: boolean; message: string }> {
  // 批量查询所有目标格子
  const conditions = targets.map((t) => `(row = ${t.row} AND col = ${t.col})`).join(' OR ');
  const cellResult = await query<CellRow>(
    `SELECT row, col, unlocked, crop_id
     FROM farm_cell
     WHERE character_id = $1 AND (${conditions})
     FOR UPDATE`,
    [characterId],
  );

  const cellMap = new Map<string, CellRow>();
  for (const cell of cellResult.rows) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  for (const target of targets) {
    const cell = cellMap.get(`${target.row},${target.col}`);
    if (!cell) {
      return { success: false, message: `格子 (${target.row + 1}-${target.col + 1}) 不存在` };
    }
    if (!cell.unlocked) {
      return { success: false, message: `格子 (${target.row + 1}-${target.col + 1}) 未解锁` };
    }
    if (cell.crop_id) {
      return { success: false, message: `格子 (${target.row + 1}-${target.col + 1}) 已有作物` };
    }
  }

  return { success: true, message: '' };
}

interface SeedRequirement {
  seedItemId: string;
  mutationType: string | null;
  quantity: number;
}

function calculateSeedRequirements(
  targets: Array<{
    seedItemId: string;
    requiredMutationType: string | null;
  }>,
): SeedRequirement[] {
  // 按条件分组统计
  const reqMap = new Map<string, SeedRequirement>();
  for (const target of targets) {
    const key = `${target.seedItemId}|${target.requiredMutationType ?? ''}`;
    const existing = reqMap.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      reqMap.set(key, {
        seedItemId: target.seedItemId,
        mutationType: target.requiredMutationType,
        quantity: 1,
      });
    }
  }
  return Array.from(reqMap.values());
}

interface LockedSeedInfo {
  seedInventoryId: number;
  itemId: string;
  mutationType: string | null;
  generation: number;
  availableQuantity: number;
}

async function lockAndValidateSeeds(
  characterId: number,
  requirements: SeedRequirement[],
): Promise<{ success: boolean; message: string; seedMap?: Map<string, LockedSeedInfo[]> }> {
  // 收集所有需要锁定的 itemId
  const itemIds = [...new Set(requirements.map((r) => r.seedItemId))];

  // 锁定相关种子记录
  const seedResult = await query<SeedInventoryRow>(
    `SELECT id, item_id, quantity, mutation_type, generation
     FROM farm_seed_inventory
     WHERE character_id = $1 AND item_id = ANY($2) AND quantity > 0
     FOR UPDATE`,
    [characterId, itemIds],
  );

  // 按条件分组种子记录
  const seedMap = new Map<string, LockedSeedInfo[]>();
  for (const seed of seedResult.rows) {
    const key = `${seed.item_id}|${seed.mutation_type}`;
    const list = seedMap.get(key) ?? [];
    list.push({
      seedInventoryId: seed.id,
      itemId: seed.item_id,
      mutationType: seed.mutation_type || null,
      generation: seed.generation,
      availableQuantity: seed.quantity,
    });
    seedMap.set(key, list);
  }

  // 校验每个需求是否有足够的种子
  for (const req of requirements) {
    const mutationKey = req.mutationType ?? '';

    // 查找所有匹配的种子（按 seedItemId + mutationType）
    const matchingSeeds: LockedSeedInfo[] = [];
    for (const [key, seeds] of seedMap.entries()) {
      const [itemId, mutation] = key.split('|');
      if (itemId !== req.seedItemId) continue;
      if ((req.mutationType ?? '') !== mutation) continue;
      matchingSeeds.push(...seeds);
    }
    const totalAvailable = matchingSeeds.reduce((sum, s) => sum + s.availableQuantity, 0);
    if (totalAvailable < req.quantity) {
      const seedConfig = getSeedConfig(req.seedItemId);
      const seedName = seedConfig?.name ?? req.seedItemId;
      return {
        success: false,
        message: `种子 "${seedName}" 数量不足（需要 ${req.quantity}，可用 ${totalAvailable}）`,
      };
    }
  }

  return { success: true, message: '', seedMap };
}

async function validateTier(
  characterId: number,
  targets: Array<{ seedItemId: string }>,
): Promise<{ success: boolean; message: string }> {
  // 获取玩家等阶
  const profileResult = await query<{ farm_tier: number }>(
    `SELECT farm_tier FROM farm_profile WHERE character_id = $1`,
    [characterId],
  );
  if (profileResult.rows.length === 0) {
    return { success: false, message: '请先开垦灵田' };
  }
  const playerTier = profileResult.rows[0].farm_tier;

  // 检查所有种子的等阶要求
  for (const target of targets) {
    const seedConfig = getSeedConfig(target.seedItemId);
    if (!seedConfig) continue;
    const cropConfig = getCropConfig(seedConfig.cropId);
    if (!cropConfig) continue;
    if (cropConfig.requiredTier > playerTier) {
      const tierConfig = getFarmTierConfig(cropConfig.requiredTier);
      return {
        success: false,
        message: `种子 "${seedConfig.name}" 需要等阶 ${tierConfig?.displayName ?? cropConfig.requiredTier}`,
      };
    }
  }

  return { success: true, message: '' };
}

function buildPlantPlans(
  targets: Array<{
    row: number;
    col: number;
    seedItemId: string;
    requiredMutationType: string | null;
  }>,
  seedMap: Map<string, LockedSeedInfo[]>,
): PlantPlanItem[] {
  const plans: PlantPlanItem[] = [];

  // 跟踪已分配的种子数量
  const allocated = new Map<number, number>(); // seedInventoryId -> allocated count

  for (const target of targets) {
    // 查找可用的种子（按 seedItemId + mutationType 匹配，不限制 generation）
    let selectedSeed: LockedSeedInfo | null = null;
    const mutationKey = target.requiredMutationType ?? '';
    const key = `${target.seedItemId}|${mutationKey}`;
    const seeds = seedMap.get(key) ?? [];
    for (const seed of seeds) {
      const used = allocated.get(seed.seedInventoryId) ?? 0;
      if (seed.availableQuantity - used > 0) {
        selectedSeed = seed;
        break;
      }
    }

    if (!selectedSeed) {
      // 理论上不会到这里（Try 阶段已校验）
      continue;
    }

    // 记录分配
    const used = allocated.get(selectedSeed.seedInventoryId) ?? 0;
    allocated.set(selectedSeed.seedInventoryId, used + 1);

    // 获取 cropId
    const seedConfig = getSeedConfig(target.seedItemId);
    if (!seedConfig) continue;

    plans.push({
      row: target.row,
      col: target.col,
      seedInventoryId: selectedSeed.seedInventoryId,
      seedItemId: target.seedItemId,
      cropId: seedConfig.cropId,
      mutationType: selectedSeed.mutationType,
      generation: selectedSeed.generation,
    });
  }

  return plans;
}

// ==================== Confirm 阶段辅助函数 ====================

async function executePlantInTransaction(
  characterId: number,
  row: number,
  col: number,
  seedInventoryId: number,
  seedItemId: string,
  cropId: string,
  seedMutationType: string | null,
  plantedGeneration: number,
): Promise<PlantResult> {
  const seedConfig = getSeedConfig(seedItemId);
  const cropConfig = getCropConfig(cropId);
  if (!seedConfig || !cropConfig) {
    return { success: false, message: '配置缺失' };
  }

  // 扣减种子
  await query(
    `UPDATE farm_seed_inventory SET quantity = quantity - 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [seedInventoryId],
  );
  await query(
    `DELETE FROM farm_seed_inventory WHERE id = $1 AND quantity = 0`,
    [seedInventoryId],
  );

  // 判定变异
  let finalMutationType: MutationType | null = null;
  if (seedMutationType) {
    // 变异种子：遗传判定
    if (rollMutationInheritance()) {
      finalMutationType = seedMutationType as MutationType;
    }
  } else {
    // 普通种子：新变异判定
    finalMutationType = rollMutation(0);
  }

  const now = Date.now();

  // 写入格子
  await query(
    `UPDATE farm_cell
     SET crop_id = $1, planted_at = TO_TIMESTAMP($8), mutated = $2, mutation_type = $3,
         planted_generation = $4,
         pending_hybrid_seed = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE character_id = $5 AND row = $6 AND col = $7`,
    [cropId, finalMutationType != null, finalMutationType, plantedGeneration, characterId, row, col, now / 1000],
  );

  // 尝试杂交触发
  const hybridResult = await tryHybridOnPlant(characterId, row, col, cropId, now);

  // 写入活动日志：播种
  await logActivity({
    characterId,
    activityType: 'plant',
    row,
    col,
    cropId,
    metadata: {
      seedItemId,
      generation: plantedGeneration,
      mutationType: finalMutationType,
      isTemplatePlant: true,
    },
  });

  // 写入活动日志：变异（如果发生）
  if (finalMutationType) {
    await logActivity({
      characterId,
      activityType: 'mutation',
      row,
      col,
      cropId,
      metadata: { mutationType: finalMutationType },
    });
  }

  return {
    success: true,
    message: `播种 ${cropConfig.name} 成功`,
    mutationType: finalMutationType,
    hybridTriggered: hybridResult.triggered,
    hybridResultSeedName: hybridResult.resultSeedName,
  };
}
