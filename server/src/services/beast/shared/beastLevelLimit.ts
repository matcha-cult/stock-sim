/**
 * 灵兽等级限制规则（纯函数）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据角色境界确定灵兽等级上限。
 * 2. 不做什么：不操作数据库。
 *
 * 关键边界条件与坑点：
 * 1) 境界列表需与角色系统的境界定义保持一致。
 * 2) 默认返回 100 级上限（兜底值）。
 */

/**
 * 境界 → 灵兽等级上限映射。
 */
const REALM_LEVEL_LIMITS: Record<string, number> = {
  '凡人': 10,
  '练气': 20,
  '筑基': 40,
  '金丹': 60,
  '元婴': 80,
  '化神': 100,
  '炼虚': 120,
  '合体': 150,
  '大乘': 200,
  '渡劫': 250,
};

/**
 * 根据角色境界获取灵兽等级上限。
 */
export const resolveBeastLevelLimit = (realmTitle: string | null | undefined): number => {
  if (!realmTitle) return 100;
  return REALM_LEVEL_LIMITS[realmTitle] ?? 100;
};
