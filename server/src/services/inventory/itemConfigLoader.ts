/**
 * 统一背包系统 — 物品配置加载器（纯内存，Map 索引）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/inventory/ 目录加载物品定义 JSON，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 输入 / 输出：
 * - 输入：items.json（物品定义数组）
 * - 输出：内存缓存，通过 getItemDefinition() 等同步获取。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 → 构建 Map 索引 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 farmConfigLoader / industryConfigLoader 同模式，使用 Map 索引（O(1) vs O(n)）。
 * - 校验规则严格：启动即报错，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时抛错，因为物品配置是核心依赖。
 * 2. 启动顺序：必须在应用启动时调用 initItemConfig()。
 * 3. itemKey 必须全局唯一，重复时启动报错。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ── 类型定义 ──

export interface ItemDefinition {
  itemKey: string;
  name: string;
  category: string; // seed, material, equipment, consumable
  subcategory?: string;
  rarity?: string; // common(黄), uncommon(玄), rare(地), legendary(天)
  maxStack: number;
  sellable: boolean;
  sellPrice: number;
  buyable: boolean;
  buyPrice: number;
  attributes: Record<string, any>;
  description?: string;
  icon?: string;
}

// ── 内存缓存 ──

let itemByKey: Map<string, ItemDefinition> | null = null;
let itemsByCategory: Map<string, ItemDefinition[]> | null = null;
/** 按 cropId 索引的物品（material 优先，用于灵田系统查询作物属性） */
let itemByCropId: Map<string, ItemDefinition> | null = null;
let allItems: ItemDefinition[] | null = null;

const SEED_DIR = join(process.cwd(), 'data/seeds/inventory');

// ── 通用 JSON 加载器 ──

async function loadJsonFile<T>(filename: string): Promise<T> {
  const content = await readFile(join(SEED_DIR, filename), 'utf-8');
  return JSON.parse(content) as T;
}

// ── 初始化 ──

export async function initItemConfig(): Promise<void> {
  const raw = await loadJsonFile<{ items: ItemDefinition[] }>('items.json');
  const items = raw.items;

  // 校验 itemKey 唯一性
  const keySet = new Set<string>();
  for (const item of items) {
    if (keySet.has(item.itemKey)) {
      throw new Error(`[itemConfigLoader] 物品 itemKey 重复: ${item.itemKey}`);
    }
    keySet.add(item.itemKey);
  }

  // 构建 Map 索引
  itemByKey = new Map(items.map((item) => [item.itemKey, item]));
  allItems = items;

  // 按 category 分组索引
  const categoryMap = new Map<string, ItemDefinition[]>();
  for (const item of items) {
    const list = categoryMap.get(item.category) ?? [];
    list.push(item);
    categoryMap.set(item.category, list);
  }
  itemsByCategory = categoryMap;

  // 按 cropId 索引（material 优先，因为 material 包含完整的作物属性）
  const cropIdMap = new Map<string, ItemDefinition>();
  // 先添加 seed（作为后备）
  for (const item of items) {
    const cropId = item.attributes?.cropId;
    if (cropId && item.category === 'seed') {
      cropIdMap.set(cropId, item);
    }
  }
  // material 覆盖 seed（material 优先级更高）
  for (const item of items) {
    const cropId = item.attributes?.cropId;
    if (cropId && item.category === 'material') {
      cropIdMap.set(cropId, item);
    }
  }
  itemByCropId = cropIdMap;

  console.log(`[itemConfigLoader] 加载完成: ${items.length} 个物品定义`);
}

// ── 查询接口 ──

export function getItemDefinition(itemKey: string): ItemDefinition | null {
  if (!itemByKey) {
    throw new Error('[itemConfigLoader] 未初始化，请先调用 initItemConfig()');
  }
  return itemByKey.get(itemKey) ?? null;
}

export function getItemDefinitionOrThrow(itemKey: string): ItemDefinition {
  const item = getItemDefinition(itemKey);
  if (!item) {
    throw new Error(`[itemConfigLoader] 物品不存在: ${itemKey}`);
  }
  return item;
}

export function getAllItems(): ItemDefinition[] {
  if (!allItems) {
    throw new Error('[itemConfigLoader] 未初始化，请先调用 initItemConfig()');
  }
  return allItems;
}

export function getItemsByCategory(category: string): ItemDefinition[] {
  if (!itemsByCategory) {
    throw new Error('[itemConfigLoader] 未初始化，请先调用 initItemConfig()');
  }
  return itemsByCategory.get(category) ?? [];
}

export function hasItem(itemKey: string): boolean {
  if (!itemByKey) {
    throw new Error('[itemConfigLoader] 未初始化，请先调用 initItemConfig()');
  }
  return itemByKey.has(itemKey);
}

/**
 * 按 cropId 获取物品配置（material 优先）。
 * 用于灵田系统查询作物属性（element、traits 等）。
 */
export function getItemByCropId(cropId: string): ItemDefinition | null {
  if (!itemByCropId) {
    throw new Error('[itemConfigLoader] 未初始化，请先调用 initItemConfig()');
  }
  return itemByCropId.get(cropId) ?? null;
}

/**
 * 获取作物的元素和特性信息。
 * 从物品配置的 attributes 中读取。
 * @returns { element, traits } 或 null（如果作物不存在）
 */
export function getCropElementAndTraits(cropId: string): { element: string[]; traits: string[] } | null {
  const item = getItemByCropId(cropId);
  if (!item) return null;
  return {
    element: item.attributes?.element ?? [],
    traits: item.attributes?.traits ?? [],
  };
}
