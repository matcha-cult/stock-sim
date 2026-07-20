/**
 * 统一背包系统 — 常量定义。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义背包界面使用的常量（物品分类、品质、稀有度等）。
 * 2. 不做什么：不定义业务逻辑、不定义 API 接口。
 *
 * 复用设计说明：
 * - 常量集中在本文件，避免多处重复定义。
 * - 被多个组件复用（InventoryGrid、InventoryDetail、InventoryFilter 等）。
 */

/** 物品分类标签映射 */
export const CATEGORY_LABELS: Record<string, string> = {
  seed: '种子',
  material: '灵材',
  equipment: '装备',
  consumable: '消耗品',
};

/** 物品分类颜色映射 */
export const CATEGORY_COLORS: Record<string, string> = {
  seed: 'green',
  material: 'blue',
  equipment: 'purple',
  consumable: 'orange',
};

/** 品质标签映射 */
export const QUALITY_LABELS: Record<string, string> = {
  hq: '优质',
  normal: '普通',
  lq: '劣质',
};

/** 品质颜色映射 */
export const QUALITY_COLORS: Record<string, string> = {
  hq: 'gold',
  normal: 'default',
  lq: 'default',
};

/** 稀有度标签映射 — 天地玄黄四阶（降序：天 > 地 > 玄 > 黄） */
export const RARITY_LABELS: Record<string, string> = {
  common: '黄',
  uncommon: '玄',
  rare: '地',
  legendary: '天',
};

/** 稀有度颜色映射 */
export const RARITY_COLORS: Record<string, string> = {
  common: 'default',
  uncommon: 'blue',
  rare: 'purple',
  legendary: 'gold',
};

/** 变异类型标签映射 */
export const MUTATION_TYPE_LABELS: Record<string, string> = {
  gold: '金光变',
  double_yield: '双倍产量',
  speed: '加速生长',
  wither_resist: '抗枯萎',
};

/** 变异类型颜色映射 */
export const MUTATION_TYPE_COLORS: Record<string, string> = {
  gold: 'gold',
  double_yield: 'green',
  speed: 'blue',
  wither_resist: 'purple',
};

/** 物品格子最小宽度（CSS Grid auto-fill 使用） */
export const GRID_CELL_MIN_WIDTH = 80;

/** 默认分页配置 */
export const DEFAULT_PAGE_SIZE = 200;
export const MAX_PAGE_SIZE = 200;

/** 排序选项标签映射 */
export const SORT_LABELS: Record<string, string> = {
  name_asc: '名称 A→Z',
  name_desc: '名称 Z→A',
  quantity_asc: '数量 少→多',
  quantity_desc: '数量 多→少',
  category_asc: '分类',
  category_desc: '分类 降序',
  rarity_desc: '稀有度',
};
