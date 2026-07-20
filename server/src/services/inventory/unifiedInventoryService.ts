/**
 * 统一背包系统 — 核心服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供统一的物品增删查改接口，支持堆叠、属性匹配、流水记录。
 * 2. 不做什么：不做物品定义管理（由 itemConfigLoader 负责）、不做物品效果计算。
 *
 * 输入 / 输出：
 * - 输入：角色ID、物品itemKey、数量、属性、操作元信息。
 * - 输出：操作结果（成功/失败 + 数量变动）。
 *
 * 数据流 / 状态流：
 * 请求 → 校验物品定义 → 执行 SQL 原子操作 → 记录流水 → 返回结果。
 *
 * 复用设计说明：
 * - 货币操作复用 consumeSpiritStones / addSpiritStones。
 * - 物品配置查询复用 itemConfigLoader。
 * - 流水记录复用 ledgerService 模式。
 *
 * 关键边界条件与坑点：
 * 1. 严格遵循数据库并发更新规范：使用 SQL 原子表达式，禁止"读旧值 → JS 计算 → 绝对值写回"。
 * 2. 批量操作按 itemKey 排序加锁，防止死锁。
 * 3. 堆叠逻辑通过唯一约束实现：同一角色同一物品及属性组合只能有一条记录。
 * 4. 流水记录必须在同一事务内。
 */
import { query, withTransaction } from '../../config/database.js';
import { getItemDefinitionOrThrow, type ItemDefinition } from './itemConfigLoader.js';

// ── 类型定义 ──

export interface ItemAttributes {
  mutationType?: string;
  generation?: number;
  quality?: string;
  durability?: number;
  level?: number;
  customAttributes?: Record<string, any>;
}

export interface AddItemParams {
  characterId: number;
  itemKey: string;
  quantity: number;
  attributes?: ItemAttributes;
  operationType: string; // acquire, buy, craft, etc.
  bizType: string;
  bizId?: string;
  memo?: string;
}

export interface RemoveItemParams {
  characterId: number;
  itemKey: string;
  quantity: number;
  attributes?: ItemAttributes;
  operationType: string; // consume, sell, craft, etc.
  bizType: string;
  bizId?: string;
  memo?: string;
}

export interface InventoryItemDto {
  id: number;
  characterId: number;
  itemKey: string;
  itemName: string;
  category: string;
  quantity: number;
  mutationType: string | null;
  generation: number | null;
  quality: string | null;
  durability: number | null;
  level: number | null;
  customAttributes: Record<string, any> | null;
  icon: string | null;
  rarity: string | null;
  maxStack: number;
  createdAt: number;
  updatedAt: number;
}

type AddItemResult =
  | { success: true; message: string; newQuantity: number }
  | { success: false; message: string };

type RemoveItemResult =
  | { success: true; message: string; remaining: number }
  | { success: false; message: string };

// ── 核心方法 ──

/**
 * 添加物品到背包。
 * 支持多格堆叠：单格上限为 maxStack，超出后新建一格。
 *
 * 流程：
 * 1. 查找同一角色、同一物品、同一属性组合中 quantity < maxStack 的格子。
 * 2. 如果找到，填充该格子至 maxStack，溢出部分递归新建格子。
 * 3. 如果没有可用格子（全部满或不存在），新建一格。
 */
export const addItem = async (params: AddItemParams): Promise<AddItemResult> => {
  const { characterId, itemKey, quantity, attributes, operationType, bizType, bizId, memo } = params;

  if (quantity <= 0) {
    return { success: false, message: '数量必须大于0' };
  }

  // 校验物品定义（从内存配置获取）
  const itemDef = getItemDefinitionOrThrow(itemKey);
  const maxStack = itemDef.maxStack;

  // 构建属性条件
  const mutationType = attributes?.mutationType ?? null;
  const generation = attributes?.generation ?? null;
  const quality = attributes?.quality ?? null;
  const durability = attributes?.durability ?? null;
  const level = attributes?.level ?? null;
  const customAttributes = attributes?.customAttributes
    ? JSON.stringify(attributes.customAttributes)
    : null;

  // 执行多格堆叠逻辑
  return addItemWithOverflow({
    characterId,
    itemKey,
    quantity,
    maxStack,
    mutationType,
    generation,
    quality,
    durability,
    level,
    customAttributes,
    operationType,
    bizType,
    bizId,
    memo,
  });
};

/** 多格堆叠的递归实现 */
const addItemWithOverflow = async (params: {
  characterId: number;
  itemKey: string;
  quantity: number;
  maxStack: number;
  mutationType: string | null;
  generation: number | null;
  quality: string | null;
  durability: number | null;
  level: number | null;
  customAttributes: string | null;
  operationType: string;
  bizType: string;
  bizId?: string;
  memo?: string;
}): Promise<AddItemResult> => {
  const {
    characterId, itemKey, quantity, maxStack,
    mutationType, generation, quality, durability, level, customAttributes,
    operationType, bizType, bizId, memo,
  } = params;

  // 查找有空余的格子（quantity < maxStack）
  const existingSlot = await query<{ id: number; quantity: number }>(
    `SELECT id, quantity FROM inventory_items
     WHERE character_id = $1
       AND item_key = $2
       AND (mutation_type = $3 OR (mutation_type IS NULL AND $3 IS NULL))
       AND (generation = $4 OR (generation IS NULL AND $4 IS NULL))
       AND (quality = $5 OR (quality IS NULL AND $5 IS NULL))
       AND (level = $6 OR (level IS NULL AND $6 IS NULL))
       AND quantity < $7
     ORDER BY quantity DESC
     LIMIT 1
     FOR UPDATE`,
    [characterId, itemKey, mutationType, generation, quality, level, maxStack],
  );

  if (existingSlot.rowCount && existingSlot.rowCount > 0) {
    // 找到有空余的格子，填充它
    const slot = existingSlot.rows[0];
    const spaceAvailable = maxStack - slot.quantity;
    const toAdd = Math.min(quantity, spaceAvailable);
    const overflow = quantity - toAdd;

    await query(
      `UPDATE inventory_items
       SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [toAdd, slot.id],
    );

    // 记录流水
    await recordInventoryLedger({
      characterId,
      itemKey,
      operationType,
      quantityChange: toAdd,
      balanceAfter: slot.quantity + toAdd,
      bizType,
      bizId,
      memo: memo ? `${memo} (格子 ${slot.id})` : undefined,
    });

    // 如果有溢出，递归新建格子
    if (overflow > 0) {
      return addItemWithOverflow({
        ...params,
        quantity: overflow,
        memo: memo ? `${memo} [溢出]` : undefined,
      });
    }

    return { success: true, message: '添加成功', newQuantity: slot.quantity + toAdd };
  } else {
    // 没有可用格子，新建一格
    const toAdd = Math.min(quantity, maxStack);
    const overflow = quantity - toAdd;

    const result = await query<{ id: number; quantity: number }>(
      `INSERT INTO inventory_items (
        character_id, item_key, quantity,
        mutation_type, generation, quality, durability, level, custom_attributes,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING id, quantity`,
      [
        characterId, itemKey, toAdd,
        mutationType, generation, quality, durability, level, customAttributes,
      ],
    );

    const newRow = result.rows[0];

    // 记录流水
    await recordInventoryLedger({
      characterId,
      itemKey,
      operationType,
      quantityChange: toAdd,
      balanceAfter: newRow.quantity,
      bizType,
      bizId,
      memo: memo ? `${memo} (新格 ${newRow.id})` : undefined,
    });

    // 如果有溢出，递归新建格子
    if (overflow > 0) {
      return addItemWithOverflow({
        ...params,
        quantity: overflow,
        memo: memo ? `${memo} [溢出]` : undefined,
      });
    }

    return { success: true, message: '添加成功', newQuantity: newRow.quantity };
  }
};

/**
 * 从背包移除物品。
 * 支持跨格扣减：从多个格子中依次扣减，直至满足请求数量。
 *
 * 流程：
 * 1. 查找同一角色、同一物品、同一属性组合的所有格子（加锁）。
 * 2. 计算总数量，不足则失败。
 * 3. 依次从各格子扣减，扣至 0 则删除该格。
 * 4. 记录流水。
 */
export const removeItem = async (params: RemoveItemParams): Promise<RemoveItemResult> => {
  const { characterId, itemKey, quantity, attributes, operationType, bizType, bizId, memo } = params;

  if (quantity <= 0) {
    return { success: false, message: '数量必须大于0' };
  }

  // 构建属性条件
  const mutationType = attributes?.mutationType ?? null;
  const generation = attributes?.generation ?? null;
  const quality = attributes?.quality ?? null;

  return withTransaction(async (client) => {
    // 查找所有匹配的格子并加锁
    const slotsResult = await client.query<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM inventory_items
       WHERE character_id = $1
         AND item_key = $2
         AND (mutation_type = $3 OR (mutation_type IS NULL AND $3 IS NULL))
         AND (generation = $4 OR (generation IS NULL AND $4 IS NULL))
         AND (quality = $5 OR (quality IS NULL AND $5 IS NULL))
       ORDER BY quantity ASC
       FOR UPDATE`,
      [characterId, itemKey, mutationType, generation, quality],
    );

    const slots = slotsResult.rows;
    const totalAvailable = slots.reduce((sum, s) => sum + s.quantity, 0);

    if (totalAvailable < quantity) {
      return { success: false, message: '物品数量不足' };
    }

    let remaining = quantity;
    let lastSlotRemaining = 0;

    // 依次从各格子扣减
    for (const slot of slots) {
      if (remaining <= 0) break;

      const toRemove = Math.min(remaining, slot.quantity);
      const newQuantity = slot.quantity - toRemove;

      if (newQuantity === 0) {
        // 格子清空，删除
        await client.query(`DELETE FROM inventory_items WHERE id = $1`, [slot.id]);
      } else {
        // 部分扣减
        await client.query(
          `UPDATE inventory_items SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [toRemove, slot.id],
        );
        lastSlotRemaining = newQuantity;
      }

      remaining -= toRemove;
    }

    // 记录流水
    await recordInventoryLedger({
      characterId,
      itemKey,
      operationType,
      quantityChange: -quantity,
      balanceAfter: totalAvailable - quantity,
      bizType,
      bizId,
      memo,
    });

    return { success: true, message: '移除成功', remaining: lastSlotRemaining };
  });
};

/**
 * 查询角色背包中的物品。
 * 物品定义（名称、类别等）从内存配置获取。
 */
export const getItemsByCharacter = async (
  characterId: number,
  filters?: { category?: string; subcategory?: string },
): Promise<InventoryItemDto[]> => {
  let sql = `
    SELECT
      i.id,
      i.character_id,
      i.item_key,
      i.quantity,
      i.mutation_type,
      i.generation,
      i.quality,
      i.durability,
      i.level,
      i.custom_attributes,
      EXTRACT(EPOCH FROM i.created_at) AS created_at_epoch,
      EXTRACT(EPOCH FROM i.updated_at) AS updated_at_epoch
    FROM inventory_items i
    WHERE i.character_id = $1
  `;

  const params: any[] = [characterId];

  // 如果按类别过滤，先从内存获取匹配的 itemKey 列表
  if (filters?.category || filters?.subcategory) {
    const { getAllItems } = await import('./itemConfigLoader.js');
    const allItems = getAllItems();
    const matchedKeys = allItems
      .filter((item) => {
        if (filters.category && item.category !== filters.category) return false;
        if (filters.subcategory && item.subcategory !== filters.subcategory) return false;
        return true;
      })
      .map((item) => item.itemKey);

    if (matchedKeys.length === 0) {
      return [];  // 没有匹配的物品定义
    }

    sql += ` AND i.item_key = ANY($2)`;
    params.push(matchedKeys);
  }

  sql += ` ORDER BY i.item_key`;

  const result = await query<any>(sql, params);

  // 从内存配置获取物品定义信息
  const { getItemDefinition } = await import('./itemConfigLoader.js');

  return result.rows.map((row) => {
    const itemDef = getItemDefinition(row.item_key);
    return {
      id: row.id,
      characterId: row.character_id,
      itemKey: row.item_key,
      itemName: itemDef?.name ?? row.item_key,
      category: itemDef?.category ?? 'unknown',
      quantity: row.quantity,
      mutationType: row.mutation_type,
      generation: row.generation,
      quality: row.quality,
      durability: row.durability,
      level: row.level,
      customAttributes: row.custom_attributes,
      icon: itemDef?.icon ?? null,
      rarity: itemDef?.rarity ?? null,
      maxStack: itemDef?.maxStack ?? 999,
      createdAt: Math.floor(Number(row.created_at_epoch)),
      updatedAt: Math.floor(Number(row.updated_at_epoch)),
    };
  });
};

/**
 * 查询特定物品的数量。
 */
export const getItemQuantity = async (
  characterId: number,
  itemKey: string,
  attributes?: ItemAttributes,
): Promise<number> => {
  const mutationType = attributes?.mutationType ?? null;
  const generation = attributes?.generation ?? null;
  const quality = attributes?.quality ?? null;

  const result = await query<{ quantity: number }>(
    `
    SELECT quantity
    FROM inventory_items
    WHERE character_id = $1
      AND item_key = $2
      AND (mutation_type = $3 OR (mutation_type IS NULL AND $3 IS NULL))
      AND (generation = $4 OR (generation IS NULL AND $4 IS NULL))
      AND (quality = $5 OR (quality IS NULL AND $5 IS NULL))
    `,
    [characterId, itemKey, mutationType, generation, quality],
  );

  if (result.rowCount === 0) {
    return 0;
  }

  return result.rows[0].quantity;
};

/**
 * 批量操作（事务性）。
 * 按 itemKey 排序加锁，防止死锁。
 */
export const batchOperate = async (
  operations: Array<AddItemParams | RemoveItemParams>,
): Promise<{
  success: boolean;
  message: string;
  results: Array<{ success: boolean; message: string }>;
}> => {
  // 按 itemKey 排序，确保加锁顺序一致，防止死锁
  const sortedOps = [...operations].sort((a, b) => a.itemKey.localeCompare(b.itemKey));

  return await withTransaction(async () => {
    const results: Array<{ success: boolean; message: string }> = [];

    for (const op of sortedOps) {
      try {
        if ('operationType' in op) {
          // 判断是 add 还是 remove
          const isAdd = ['acquire', 'buy', 'craft'].includes(op.operationType);

          if (isAdd) {
            const result = await addItem(op as AddItemParams);
            results.push({ success: result.success, message: result.message });
          } else {
            const result = await removeItem(op as RemoveItemParams);
            results.push({ success: result.success, message: result.message });
          }
        }
      } catch (error) {
        results.push({
          success: false,
          message: error instanceof Error ? error.message : '操作失败',
        });
      }
    }

    const allSuccess = results.every((r) => r.success);

    return {
      success: allSuccess,
      message: allSuccess ? '批量操作成功' : '部分操作失败',
      results,
    };
  });
};

// ── 内部方法 ──

interface LedgerParams {
  characterId: number;
  itemKey: string;
  operationType: string;
  quantityChange: number;
  balanceAfter: number;
  bizType: string;
  bizId?: string;
  memo?: string;
}

async function recordInventoryLedger(params: LedgerParams): Promise<void> {
  const {
    characterId,
    itemKey,
    operationType,
    quantityChange,
    balanceAfter,
    bizType,
    bizId,
    memo,
  } = params;

  await query(
    `
    INSERT INTO inventory_ledger (
      character_id, item_key, operation_type,
      quantity_change, balance_after, biz_type, biz_id, memo,
      created_at
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7, $8,
      CURRENT_TIMESTAMP
    )
    `,
    [
      characterId,
      itemKey,
      operationType,
      quantityChange,
      balanceAfter,
      bizType,
      bizId,
      memo,
    ],
  );
}
