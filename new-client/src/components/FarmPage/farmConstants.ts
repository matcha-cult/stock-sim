/**
 * 灵田系统 V3 — 共享常量。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义灵田系统各组件共享的常量（元素颜色、变异标签、等阶名称等）。
 * 2. 不做什么：不包含业务逻辑或 React 组件。
 *
 * 复用设计说明：
 * - 元素颜色映射被 FarmSeedBag、FarmSeedShop、FarmHybridGuide 等多处复用。
 * - 集中管理避免重复定义，确保视觉一致性。
 */

/** 五行元素对应颜色（HEX） */
export const ELEMENT_COLORS: Record<string, string> = {
  '木': '#228B22',
  '火': '#FF4500',
  '土': '#8B4513',
  '金': '#FFD700',
  '水': '#4169E1',
};

/** 五行元素显示顺序（相生顺序：木→火→土→金→水） */
export const ELEMENT_ORDER: readonly string[] = ['木', '火', '土', '金', '水'];

/** 变异类型标签（显示名 + 颜色） */
export const MUTATION_LABELS: Record<string, { label: string; color: string }> = {
  gold: { label: '金光变', color: 'gold' },
  double_yield: { label: '丰收变', color: 'green' },
  speed_ripen: { label: '速熟变', color: 'blue' },
  wither_early: { label: '早衰变', color: 'orange' },
  half_yield: { label: '歉收变', color: 'red' },
};

/** 等阶名称（1=黄, 2=玄, 3=地, 4=天） */
export const TIER_NAMES: Record<number, string> = { 1: '黄', 2: '玄', 3: '地', 4: '天' };
