/**
 * 统一背包系统 — HTTP 路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供背包物品查询（分页）、物品详情、物品出售等接口。
 * 2. 不做什么：不处理业务逻辑（全部在 service 层）。
 *
 * 数据流 / 状态流：
 * 前端请求 → 本路由解析参数 → service → DTO → sendSuccess。
 *
 * 复用设计说明：
 * - 路由层只做鉴权/QPS/参数归一化，业务逻辑集中在 service。
 * - 货币操作成功后推送角色刷新（safePushCharacterUpdate）。
 * - QPS 限制复用 createQpsLimitMiddleware。
 * - 背包查询复用 unifiedInventoryService.getItemsByCharacter。
 *
 * 关键边界条件与坑点：
 * 1. 分页查询使用服务端分页，避免一次性加载所有物品。
 * 2. 物品出售需要校验物品是否可出售（sellable）。
 * 3. 所有操作都需要记录流水账。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCharacter } from '../middleware/auth.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { safePushCharacterUpdate } from '../middleware/pushUpdate.js';
import { sendSuccess } from '../middleware/response.js';
import { parsePositiveInt } from '../services/shared/httpParam.js';
import { query } from '../config/database.js';
import {
  removeItem,
  type InventoryItemDto,
} from '../services/inventory/unifiedInventoryService.js';
import { addSpiritStones } from '../services/inventory/shared/consume.js';
import { getItemDefinition, getAllItems } from '../services/inventory/itemConfigLoader.js';
import { BusinessError } from '../errors/BusinessError.js';

const router: RouterType = Router();

const QPS_WINDOW_MS = 1000;
const QPS_MESSAGE = '请求过于频繁，请稍后再试';

const createInventoryQpsLimit = (routeKey: string, limit: number) =>
  createQpsLimitMiddleware({
    keyPrefix: `qps:inventory:${routeKey}`,
    limit,
    windowMs: QPS_WINDOW_MS,
    message: QPS_MESSAGE,
    resolveScope: (req) => req.userId!,
  });

const itemsQpsLimit = createInventoryQpsLimit('items', 20);
const itemDetailQpsLimit = createInventoryQpsLimit('item-detail', 30);
const sellItemQpsLimit = createInventoryQpsLimit('sell-item', 10);

/**
 * 数据库行 + 内存配置 → InventoryItemDto。
 * 替代旧的 JOIN item_definitions 方案：SQL 只查 inventory_items，配置信息从 itemConfigLoader 补充。
 */
const rowToBaseDto = (row: any): InventoryItemDto => {
  const def = getItemDefinition(row.item_key);
  return {
    id: row.id,
    characterId: row.character_id,
    itemKey: row.item_key,
    itemName: def?.name ?? row.item_key,
    category: def?.category ?? 'unknown',
    quantity: row.quantity,
    mutationType: row.mutation_type,
    generation: row.generation,
    quality: row.quality,
    durability: row.durability,
    level: row.level,
    customAttributes: row.custom_attributes,
    icon: def?.icon ?? null,
    rarity: def?.rarity ?? null,
    maxStack: def?.maxStack ?? 999,
    createdAt: Math.floor(Number(row.created_at_epoch)),
    updatedAt: Math.floor(Number(row.updated_at_epoch)),
  };
};

/** 基础 DTO + 详情扩展字段 → 完整详情 DTO */
const rowToDetailDto = (row: any) => {
  const def = getItemDefinition(row.item_key);
  return {
    ...rowToBaseDto(row),
    subcategory: def?.subcategory ?? null,
    rarity: def?.rarity ?? null,
    maxStack: def?.maxStack ?? 999,
    description: def?.description ?? null,
    sellable: def?.sellable ?? false,
    sellPrice: def?.sellPrice ?? 0,
    buyable: def?.buyable ?? false,
    buyPrice: def?.buyPrice ?? 0,
    attributes: def?.attributes ?? null,
  };
};

// ==================== 物品查询接口 ====================

/**
 * 排序策略：
 * - quantity 排序可在 SQL 层完成（直接对 inventory_items.quantity 排序）。
 * - name / category / rarity 排序在 JS 层完成（这些字段来自内存配置，不在数据库中）。
 */
type SortStrategy = { kind: 'sql'; sql: string } | { kind: 'js'; compare: (a: any, b: any) => number };

const SORT_STRATEGIES: Record<string, SortStrategy> = {
  name_asc: { kind: 'js', compare: (a, b) => a.itemName.localeCompare(b.itemName) },
  name_desc: { kind: 'js', compare: (a, b) => b.itemName.localeCompare(a.itemName) },
  quantity_asc: { kind: 'sql', sql: 'i.quantity ASC, i.item_key ASC' },
  quantity_desc: { kind: 'sql', sql: 'i.quantity DESC, i.item_key ASC' },
  category_asc: { kind: 'js', compare: (a, b) => a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName) },
  category_desc: { kind: 'js', compare: (a, b) => b.category.localeCompare(a.category) || a.itemName.localeCompare(b.itemName) },
  rarity_desc: { kind: 'js', compare: (a, b) => (b.rarity ?? '').localeCompare(a.rarity ?? '') || a.itemName.localeCompare(b.itemName) },
};
const DEFAULT_SORT = 'name_asc';

/**
 * 从内存配置中预筛选匹配的 itemKey 列表。
 * 用于替代旧的 JOIN item_definitions WHERE d.xxx = ... 方案。
 */
const filterItemKeysFromConfig = (filters: {
  category?: string;
  subcategory?: string;
  rarity?: string;
  keyword?: string;
}): string[] | null => {
  const hasConfigFilter = filters.category || filters.subcategory || filters.rarity || filters.keyword;
  if (!hasConfigFilter) return null; // 无需过滤，返回 null 表示不限制

  const allItems = getAllItems();
  return allItems
    .filter((item) => {
      if (filters.category && item.category !== filters.category) return false;
      if (filters.subcategory && item.subcategory !== filters.subcategory) return false;
      if (filters.rarity && item.rarity !== filters.rarity) return false;
      if (filters.keyword && !item.name.includes(filters.keyword)) return false;
      return true;
    })
    .map((item) => item.itemKey);
};

/**
 * 查询背包物品（分页）
 *
 * GET /api/inventory/items
 * Query Parameters:
 *   - page: number (default: 1)
 *   - pageSize: number (default: 200, max: 200)
 *   - category?: string
 *   - subcategory?: string
 *   - quality?: string (hq / normal / lq)
 *   - rarity?: string (common(黄) / uncommon(玄) / rare(地) / legendary(天))
 *   - keyword?: string (物品名称模糊搜索)
 *   - sort?: string (name_asc / name_desc / quantity_asc / quantity_desc / category_asc / category_desc / rarity_desc)
 *
 * 过滤策略：category / subcategory / rarity / keyword 从内存配置预筛选 itemKey，
 * 再用 ANY($N) 查库。quality 直接在 SQL 层过滤。
 * 排序分两种：quantity 排序在 SQL 层；name / category / rarity 排序在 JS 层。
 */
router.get(
  '/items',
  requireCharacter,
  itemsQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const page = parsePositiveInt(req.query.page) ?? 1;
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize) ?? 200, 200);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const subcategory = typeof req.query.subcategory === 'string' ? req.query.subcategory : undefined;
    const quality = typeof req.query.quality === 'string' ? req.query.quality : undefined;
    const rarity = typeof req.query.rarity === 'string' ? req.query.rarity : undefined;
    const keyword = typeof req.query.keyword === 'string' && req.query.keyword.trim()
      ? req.query.keyword.trim()
      : undefined;
    const sortKey = typeof req.query.sort === 'string' ? req.query.sort : DEFAULT_SORT;
    const sortStrategy = SORT_STRATEGIES[sortKey] || SORT_STRATEGIES[DEFAULT_SORT];

    // 从内存配置预筛选 itemKey
    const matchedKeys = filterItemKeysFromConfig({ category, subcategory, rarity, keyword });
    if (matchedKeys && matchedKeys.length === 0) {
      sendSuccess(res, { items: [], total: 0, page, pageSize });
      return;
    }

    // 构建 SQL 查询
    const conditions: string[] = ['i.character_id = $1', 'i.quantity > 0'];
    const params: any[] = [characterId];
    let paramIdx = 2;

    if (matchedKeys) {
      conditions.push(`i.item_key = ANY($${paramIdx})`);
      params.push(matchedKeys);
      paramIdx++;
    }
    if (quality) {
      conditions.push(`i.quality = $${paramIdx}`);
      params.push(quality);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    if (sortStrategy.kind === 'sql') {
      // SQL 层排序 + 分页
      const [countResult, dataResult] = await Promise.all([
        query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM inventory_items i WHERE ${whereClause}`,
          params,
        ),
        query<any>(
          `SELECT i.id, i.character_id, i.item_key, i.quantity,
                  i.mutation_type, i.generation, i.quality, i.durability, i.level,
                  i.custom_attributes,
                  EXTRACT(EPOCH FROM i.created_at) AS created_at_epoch,
                  EXTRACT(EPOCH FROM i.updated_at) AS updated_at_epoch
           FROM inventory_items i
           WHERE ${whereClause}
           ORDER BY ${sortStrategy.sql}
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, pageSize, (page - 1) * pageSize],
        ),
      ]);

      const total = Number(countResult.rows[0].count);
      const items: InventoryItemDto[] = dataResult.rows.map(rowToBaseDto);
      sendSuccess(res, { items, total, page, pageSize });
    } else {
      // JS 层排序：需要先获取所有匹配行，排序后分页
      const dataResult = await query<any>(
        `SELECT i.id, i.character_id, i.item_key, i.quantity,
                i.mutation_type, i.generation, i.quality, i.durability, i.level,
                i.custom_attributes,
                EXTRACT(EPOCH FROM i.created_at) AS created_at_epoch,
                EXTRACT(EPOCH FROM i.updated_at) AS updated_at_epoch
         FROM inventory_items i
         WHERE ${whereClause}`,
        params,
      );

      const allItems = dataResult.rows.map(rowToBaseDto);
      allItems.sort(sortStrategy.compare);

      const total = allItems.length;
      const startIdx = (page - 1) * pageSize;
      const items = allItems.slice(startIdx, startIdx + pageSize);
      sendSuccess(res, { items, total, page, pageSize });
    }
  }),
);

// ==================== 物品详情接口 ====================

/**
 * 查询物品详情
 *
 * GET /api/inventory/items/:itemId
 */
router.get(
  '/items/:itemId',
  requireCharacter,
  itemDetailQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const itemId = parsePositiveInt(req.params.itemId);

    if (!itemId) {
      throw new BusinessError('无效的物品 ID');
    }

    const result = await query<any>(
      `SELECT
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
       WHERE i.id = $1 AND i.character_id = $2`,
      [itemId, characterId],
    );

    if (result.rowCount === 0) {
      throw new BusinessError('物品不存在');
    }

    const row = result.rows[0];

    sendSuccess(res, rowToDetailDto(row));
  }),
);

// ==================== 物品出售接口 ====================

/**
 * 出售物品
 *
 * POST /api/inventory/items/:itemId/sell
 * Body: { quantity: number }
 */
router.post(
  '/items/:itemId/sell',
  requireCharacter,
  sellItemQpsLimit,
  asyncHandler(async (req, res) => {
    const characterId = req.characterId!;
    const itemId = parsePositiveInt(req.params.itemId);
    const quantity = parsePositiveInt(req.body?.quantity);

    if (!itemId) {
      throw new BusinessError('无效的物品 ID');
    }

    if (!quantity || quantity <= 0) {
      throw new BusinessError('数量必须大于0');
    }

    // 查询物品信息（配置信息从内存获取）
    const itemResult = await query<any>(
      `SELECT
        i.id,
        i.quantity,
        i.mutation_type,
        i.generation,
        i.quality,
        i.item_key
       FROM inventory_items i
       WHERE i.id = $1 AND i.character_id = $2`,
      [itemId, characterId],
    );

    if (itemResult.rowCount === 0) {
      throw new BusinessError('物品不存在');
    }

    const item = itemResult.rows[0];
    const itemDef = getItemDefinition(item.item_key);
    if (!itemDef) {
      throw new BusinessError('物品配置不存在');
    }

    if (!itemDef.sellable) {
      throw new BusinessError('该物品不可出售');
    }

    if (item.quantity < quantity) {
      throw new BusinessError('物品数量不足');
    }

    // 扣除物品
    const removeResult = await removeItem({
      characterId,
      itemKey: item.item_key,
      quantity,
      attributes: {
        mutationType: item.mutation_type || undefined,
        generation: item.generation || undefined,
        quality: item.quality || undefined,
      },
      operationType: 'sell',
      bizType: 'inventory_sell_item',
      bizId: String(itemId),
      memo: `出售 ${itemDef.name} x${quantity}`,
    });

    if (!removeResult.success) {
      throw new BusinessError(removeResult.message);
    }

    // 计算售价
    const totalEarn = BigInt(itemDef.sellPrice * quantity);

    // 增加灵石
    await addSpiritStones(characterId, totalEarn, {
      bizType: 'inventory_sell_item',
      bizId: String(itemId),
      memo: `出售 ${itemDef.name} x${quantity}`,
    });

    // 推送角色刷新
    safePushCharacterUpdate(req.userId!);

    sendSuccess(res, {
      success: true,
      message: `出售成功，获得 ${totalEarn} 灵石`,
      totalEarn: Number(totalEarn),
    });
  }),
);

export default router;
