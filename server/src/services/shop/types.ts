/**
 * 收租系统 — 店铺领域类型定义。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义店铺类型、装修等级、租金计算相关的 TypeScript 类型和常量。
 * 2. 不做什么：不包含业务逻辑、不处理数据库操作。
 *
 * 复用设计说明：
 * - 所有店铺类型常量集中在此，service / route / scheduler 统一引用。
 * - 前端类型可直接复用本文件的定义（通过 API DTO 转换）。
 *
 * 关键边界条件与坑点：
 * 1. 初始租金含 0.5 的类型（如丹药 22.5）在存储时需 ×100 转为整数分（2250）。
 * 2. 装修等级系数翻倍增长，扩展费用指数增长，两者不可混淆。
 */

// ==================== 店面类型 ====================

export const SHOP_TYPES = {
  PLANT: 'PLT',   // 灵植
  MINERAL: 'MIN', // 矿材
  ARTIFACT: 'ART', // 法器
  PILL: 'DAN',     // 丹药
  FOOD: 'FBD',     // 餐饮
  BOOK: 'BOO',     // 书籍
} as const;

export type ShopType = typeof SHOP_TYPES[keyof typeof SHOP_TYPES];

export const SHOP_TYPE_CONFIG: Record<ShopType, {
  name: string;
  initialArea: number;
  initialRent: number; // 初始租金（灵石/tick，含小数）
  purchaseCost: number; // 购买成本（灵石），0 表示免费（初始店铺）
}> = {
  [SHOP_TYPES.PLANT]: { name: '灵植', initialArea: 50, initialRent: 25, purchaseCost: 200000 },
  [SHOP_TYPES.MINERAL]: { name: '矿材', initialArea: 40, initialRent: 20, purchaseCost: 120000 },
  [SHOP_TYPES.ARTIFACT]: { name: '法器', initialArea: 35, initialRent: 18, purchaseCost: 80000 },
  [SHOP_TYPES.PILL]: { name: '丹药', initialArea: 30, initialRent: 22.5, purchaseCost: 150000 },
  [SHOP_TYPES.FOOD]: { name: '餐饮', initialArea: 25, initialRent: 15, purchaseCost: 50000 },
  [SHOP_TYPES.BOOK]: { name: '书籍', initialArea: 20, initialRent: 10, purchaseCost: 0 },
};

// ==================== 装修等级 ====================

export const DECORATION_TIERS = {
  YELLOW: 'YELLOW',   // 黄
  MYSTIC: 'MYSTIC',   // 玄
  EARTH: 'EARTH',     // 地
  HEAVEN: 'HEAVEN',   // 天
} as const;

export type DecorationTier = typeof DECORATION_TIERS[keyof typeof DECORATION_TIERS];

/** 装修等级索引（用于公式中的指数计算） */
export const DECORATION_TIER_INDEX: Record<DecorationTier, number> = {
  [DECORATION_TIERS.YELLOW]: 0,
  [DECORATION_TIERS.MYSTIC]: 1,
  [DECORATION_TIERS.EARTH]: 2,
  [DECORATION_TIERS.HEAVEN]: 3,
};

/** 装修等级显示名 */
export const DECORATION_TIER_LABEL: Record<DecorationTier, string> = {
  [DECORATION_TIERS.YELLOW]: '黄级',
  [DECORATION_TIERS.MYSTIC]: '玄级',
  [DECORATION_TIERS.EARTH]: '地级',
  [DECORATION_TIERS.HEAVEN]: '天级',
};

/** 装修等级租金系数 */
export const DECORATION_TIER_RENT_MULTIPLIER: Record<DecorationTier, number> = {
  [DECORATION_TIERS.YELLOW]: 1.0,
  [DECORATION_TIERS.MYSTIC]: 2.0,
  [DECORATION_TIERS.EARTH]: 4.0,
  [DECORATION_TIERS.HEAVEN]: 8.0,
};

/** 装修单价（灵石/㎡） */
export const DECORATION_TIER_PRICE_PER_SQM: Record<DecorationTier, number> = {
  [DECORATION_TIERS.YELLOW]: 10,
  [DECORATION_TIERS.MYSTIC]: 30,
  [DECORATION_TIERS.EARTH]: 60,
  [DECORATION_TIERS.HEAVEN]: 100,
};

/** 装修等级顺序（从低到高） */
export const DECORATION_TIER_ORDER: DecorationTier[] = [
  DECORATION_TIERS.YELLOW,
  DECORATION_TIERS.MYSTIC,
  DECORATION_TIERS.EARTH,
  DECORATION_TIERS.HEAVEN,
];

// ==================== 数值常量 ====================

/** 基础租金（灵石/tick）— 已废弃，改用 SHOP_TYPE_CONFIG 中的初始租金 */
export const BASE_RENT_PER_TICK = 10;

/** 空间阵法扩展每次增加的面积（㎡） */
export const SPACE_EXPANSION_AREA_INCREMENT = 10;

/** 空间阵法扩展基础费用（灵石） */
export const SPACE_EXPANSION_BASE_COST = 50;

/** 空间阵法扩展费用指数底数 */
export const SPACE_EXPANSION_EXPONENT_BASE = 2;

/** 各装修等级的空间阵法扩展费用系数 */
export const DECORATION_TIER_EXPANSION_MULTIPLIER: Record<DecorationTier, number> = {
  [DECORATION_TIERS.YELLOW]: 1.0,
  [DECORATION_TIERS.MYSTIC]: 1.5,
  [DECORATION_TIERS.EARTH]: 2.0,
  [DECORATION_TIERS.HEAVEN]: 3.0,
};

/** 收租 tick 间隔分钟数，默认 30 分钟，可通过环境变量 SHOP_RENT_TICK_INTERVAL_MINUTES 配置 */
const SHOP_RENT_TICK_INTERVAL_MINUTES_ENV = parseInt(process.env.SHOP_RENT_TICK_INTERVAL_MINUTES ?? '30', 10);
export const SHOP_RENT_TICK_INTERVAL_MINUTES = Number.isFinite(SHOP_RENT_TICK_INTERVAL_MINUTES_ENV) && SHOP_RENT_TICK_INTERVAL_MINUTES_ENV > 0
  ? SHOP_RENT_TICK_INTERVAL_MINUTES_ENV
  : 30;
export const SHOP_RENT_TICK_INTERVAL_MS = SHOP_RENT_TICK_INTERVAL_MINUTES * 60 * 1000;

/** 租金累积上限 tick 数（24 小时 / 收租 tick 间隔） */
export const MAX_PENDING_RENT_TICKS = Math.floor((24 * 60) / SHOP_RENT_TICK_INTERVAL_MINUTES);

/** 装修降级回收比例 */
export const DECORATION_REFUND_RATE = 0.6;

/** 升级等级租金加成系数（每级 +10%） */
export const UPGRADE_LEVEL_BONUS_RATE = 0.1;

/** 升级所需收租次数基数（每级 × 10） */
export const UPGRADE_TICKS_BASE = 10;

/** 初始店铺类型（角色创建时赠送） */
export const INITIAL_SHOP_TYPE = SHOP_TYPES.BOOK;

/** 初始店铺装修等级 */
export const INITIAL_SHOP_TIER = DECORATION_TIERS.YELLOW;

// ==================== 纯函数工具 ====================

/**
 * 计算每 tick 租金（单位：分，即存储单位）。
 *
 * 公式：初始租金 × 装修系数 × 空间加成 × 升级加成
 * 结果转为整数分（×100）。
 */
export const calculateRentPerTick = (params: {
  shopType: ShopType;
  decorationTier: DecorationTier;
  spaceExpansion: number;
  upgradeLevel: number;
}): bigint => {
  const config = SHOP_TYPE_CONFIG[params.shopType];
  if (!config) throw new Error(`未知店铺类型: ${params.shopType}`);

  const rentMultiplier = DECORATION_TIER_RENT_MULTIPLIER[params.decorationTier];
  const spaceBonus = 1 + params.spaceExpansion * 0.5;
  const upgradeBonus = 1 + params.upgradeLevel * UPGRADE_LEVEL_BONUS_RATE;

  const rawRent = config.initialRent * rentMultiplier * spaceBonus * upgradeBonus;
  return BigInt(Math.round(rawRent * 100));
};

/**
 * 计算装修费用（单位：整数灵石）。
 * characters.spirit_stones 以整数灵石存储，所以直接返回整数灵石。
 */
export const calculateDecorationCost = (params: {
  currentTier: DecorationTier;
  targetTier: DecorationTier;
  area: number;
}): bigint => {
  const currentPrice = DECORATION_TIER_PRICE_PER_SQM[params.currentTier];
  const targetPrice = DECORATION_TIER_PRICE_PER_SQM[params.targetTier];
  const diff = Math.abs(targetPrice - currentPrice);
  return BigInt(Math.round(diff * params.area));
};

/**
 * 计算降级退款金额（单位：整数灵石）。
 * characters.spirit_stones 以整数灵石存储，所以直接返回整数灵石。
 */
export const calculateDecorationRefund = (params: {
  currentTier: DecorationTier;
  targetTier: DecorationTier;
  area: number;
}): bigint => {
  const currentPrice = DECORATION_TIER_PRICE_PER_SQM[params.currentTier];
  const targetPrice = DECORATION_TIER_PRICE_PER_SQM[params.targetTier];
  const diff = currentPrice - targetPrice;
  return BigInt(Math.round(diff * params.area * DECORATION_REFUND_RATE));
};

/**
 * 计算空间阵法扩展费用（单位：灵石，整数）。
 *
 * 公式：基础费用 × 2^当前扩展次数 × 装修等级系数
 * characters.spirit_stones 以整数灵石存储，所以这里直接返回整数灵石。
 */
export const calculateSpaceExpansionCost = (params: {
  currentExpansion: number;
  decorationTier: DecorationTier;
}): bigint => {
  const tierMultiplier = DECORATION_TIER_EXPANSION_MULTIPLIER[params.decorationTier];
  const cost = SPACE_EXPANSION_BASE_COST
    * Math.pow(SPACE_EXPANSION_EXPONENT_BASE, params.currentExpansion)
    * tierMultiplier;
  return BigInt(Math.round(cost));
};

/**
 * 计算升级到下一级所需累计收租次数。
 */
export const calculateUpgradeTicksNeeded = (currentLevel: number): number => {
  return UPGRADE_TICKS_BASE * (currentLevel + 1);
};
