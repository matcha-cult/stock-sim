/**
 * 祭坛服务
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供祭坛召唤相关的数据查询服务（获取可用祭品、配方信息等）。
 * 2. 不做什么：不处理 HTTP 参数、不处理召唤逻辑（在 beastSummonService 中）。
 *
 * 数据流 / 状态流：
 * 前端请求 -> beastAltarService -> SQL + 配置 -> DTO。
 *
 * 关键边界条件与坑点：
 * 1. 祭品来源于灵田系统的种子库存和作物库存。
 * 2. 需要关联作物配置获取元素和特性信息。
 */
import { query } from '../../config/database.js';
import { getCropConfig, getAllCrops } from '../farm/farmConfigLoader.js';
import { getItemsByCategory, getItemDefinition } from '../inventory/itemConfigLoader.js';

interface ServiceResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

// ==================== 祭品信息 ====================

export interface OfferingDto {
  itemId: string;
  name: string;
  quantity: number;
  element: string[];
  traits: string[];
  source: 'seed' | 'harvest' | 'relic';
  tradeUnit: number;
  quality?: 'hq' | 'normal' | 'lq';
}

/**
 * 获取玩家可用于祭坛的祭品库存。
 * 从统一背包获取种子（category='seed'）、作物（category='material'，subcategory 为 grain/vegetable/spirit_root 等）和圣物（subcategory='relic'）。
 */
export const getAvailableOfferings = async (
  characterId: number,
): Promise<ServiceResult<OfferingDto[]>> => {
  // 从内存配置预筛选 itemKey，再查库（替代旧的 JOIN item_definitions）
  const seedItemKeys = getItemsByCategory('seed').map((item) => item.itemKey);
  const materialItemKeys = getItemsByCategory('material')
    .filter((item) => ['grain', 'vegetable', 'fruit', 'spirit_root', 'herb', 'ore'].includes(item.subcategory ?? ''))
    .map((item) => item.itemKey);
  // 圣物类祭品（无属性 SSR 召唤用）
  const relicItemKeys = getItemsByCategory('material')
    .filter((item) => item.subcategory === 'relic')
    .map((item) => item.itemKey);

  const [seedRows, materialRows, relicRows] = await Promise.all([
    seedItemKeys.length > 0
      ? query<{ item_key: string; quantity: string | number; quality: string | null }>(
          `SELECT item_key, quantity, quality
           FROM inventory_items
           WHERE character_id = $1 AND item_key = ANY($2) AND quantity > 0`,
          [characterId, seedItemKeys],
        )
      : { rows: [] as Array<{ item_key: string; quantity: string | number; quality: string | null }>, rowCount: 0 },
    materialItemKeys.length > 0
      ? query<{ item_key: string; quantity: string | number; quality: string | null }>(
          `SELECT item_key, quantity, quality
           FROM inventory_items
           WHERE character_id = $1 AND item_key = ANY($2) AND quantity > 0`,
          [characterId, materialItemKeys],
        )
      : { rows: [] as Array<{ item_key: string; quantity: string | number; quality: string | null }>, rowCount: 0 },
    relicItemKeys.length > 0
      ? query<{ item_key: string; quantity: string | number; quality: string | null }>(
          `SELECT item_key, quantity, quality
           FROM inventory_items
           WHERE character_id = $1 AND item_key = ANY($2) AND quantity > 0`,
          [characterId, relicItemKeys],
        )
      : { rows: [] as Array<{ item_key: string; quantity: string | number; quality: string | null }>, rowCount: 0 },
  ]);

  const offeringsMap = new Map<string, OfferingDto>();

  // 处理种子
  for (const row of seedRows.rows) {
    const quantity = Number(row.quantity);
    if (quantity <= 0) continue;

    // 从内存配置获取 attributes
    const itemDef = getItemDefinition(row.item_key);
    const cropId = itemDef?.attributes?.cropId;
    if (!cropId) continue;

    const cropConfig = getCropConfig(cropId);
    if (!cropConfig) continue;

    // 从 items.attributes 获取 element 和 traits
    const element = itemDef?.attributes?.element ?? [];
    const traits = itemDef?.attributes?.traits ?? [];
    const tradeUnit = cropConfig.harvestUnit === '颗' ? 20 : 1; // 简化：灵根类种子交易单位为20

    offeringsMap.set(row.item_key, {
      itemId: row.item_key,
      name: cropConfig.name,
      quantity,
      element,
      traits,
      source: 'seed',
      tradeUnit,
    });
  }

  // 处理作物材料（按品质分别记录）
  for (const row of materialRows.rows) {
    const quantity = Number(row.quantity);
    if (quantity <= 0) continue;

    // 从内存配置获取 attributes
    const itemDef = getItemDefinition(row.item_key);
    const cropId = itemDef?.attributes?.cropId;
    if (!cropId) {
      // 没有 cropId 的素材不参与祭坛
      continue;
    }

    const cropConfig = getCropConfig(cropId);
    if (!cropConfig) continue;

    // 从 items.attributes 获取 element, traits, tradeUnit
    const element = itemDef?.attributes?.element ?? [];
    const traits = itemDef?.attributes?.traits ?? [];
    const tradeUnit = itemDef?.attributes?.tradeUnit ?? 1;

    const quality = (row.quality as 'hq' | 'normal' | 'lq') ?? 'normal';
    // 用 item_key + quality 作为唯一键，区分不同品质
    const key = `${row.item_key}_${quality}`;
    const existing = offeringsMap.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      offeringsMap.set(key, {
        itemId: row.item_key,
        name: cropConfig.name,
        quantity,
        element,
        traits,
        source: 'harvest',
        tradeUnit,
        quality,
      });
    }
  }

  // 处理圣物类祭品（无属性，用于 SSR 召唤）
  for (const row of relicRows.rows) {
    const quantity = Number(row.quantity);
    if (quantity <= 0) continue;

    const itemDef = getItemDefinition(row.item_key);
    if (!itemDef) continue;

    // 圣物类祭品：无元素、带特性标签、交易单位为 1
    offeringsMap.set(row.item_key, {
      itemId: row.item_key,
      name: itemDef.name,
      quantity,
      element: [], // 无属性
      traits: ['圣物'], // 添加特性标签，便于筛选
      source: 'relic',
      tradeUnit: 1, // 圣物交易单位为 1
    });
  }

  return { success: true, data: Array.from(offeringsMap.values()) };
};
