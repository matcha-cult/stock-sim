/**
 * 灵兽品阶等级限制规则（纯函数）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据灵兽品阶确定等级上限（界限突破系统）。
 * 2. 不做什么：不操作数据库，不涉及角色境界限制。
 *
 * 关键边界条件与坑点：
 * 1) 品阶列表需与 beastTierRules.ts 中的 TIER_ORDER 保持一致。
 * 2) 默认返回 10 级上限（黄级兜底值）。
 */

/**
 * 品阶 → 灵兽等级上限映射（界限突破系统）。
 */
const TIER_LEVEL_LIMITS: Record<string, number> = {
  'huang': 10,  // 黄级最高 10 级
  'xuan': 20,   // 玄级最高 20 级
  'di': 35,     // 地级最高 35 级
  'tian': 50,   // 天级最高 50 级
};

/**
 * 根据灵兽品阶获取等级上限。
 */
export const resolveBeastTierLevelLimit = (beastTier: string | null | undefined): number => {
  if (!beastTier) return 10;
  return TIER_LEVEL_LIMITS[beastTier] ?? 10;
};
