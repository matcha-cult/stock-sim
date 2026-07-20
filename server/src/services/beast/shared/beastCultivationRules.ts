/**
 * 灵兽培育规则（纯函数）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：计算培育衰减系数、单次/批量培育资质增加量。
 * 2. 不做什么：不操作数据库，不消耗物品。
 *
 * 关键边界条件与坑点：
 * 1) cultivation_count 从 0 开始，首次培育衰减系数为 1.0（无衰减）。
 * 2) 批量培育需要逐次计算衰减，不能简单乘法。
 */

/**
 * 计算衰减系数。
 * 衰减系数 = 1 / (1 + cultivationCount × decayRate)
 */
export const calcDecayCoefficient = (
  cultivationCount: number,
  decayRate: number,
): number => {
  const safeCount = Math.max(0, Math.floor(cultivationCount));
  const safeRate = Math.max(0, Number(decayRate) || 0.1);
  return 1 / (1 + safeCount * safeRate);
};

/**
 * 计算单次培育资质增加量。
 * 增加量 = 基础增加量 × 衰减系数
 */
export const calcCultivationIncrease = (
  baseIncrease: number,
  cultivationCount: number,
  decayRate: number,
): number => {
  const safeBase = Math.max(0, Number(baseIncrease) || 0);
  return safeBase * calcDecayCoefficient(cultivationCount, decayRate);
};

/**
 * 计算批量培育总资质增加量。
 * 每次培育后 cultivation_count 递增，衰减系数逐次变化。
 */
export const calcBatchCultivationIncrease = (
  baseIncrease: number,
  cultivationCount: number,
  decayRate: number,
  batchCount: number,
): number => {
  const safeBase = Math.max(0, Number(baseIncrease) || 0);
  const safeBatch = Math.max(0, Math.floor(batchCount));
  if (safeBase <= 0 || safeBatch <= 0) return 0;

  let totalIncrease = 0;
  for (let i = 0; i < safeBatch; i++) {
    totalIncrease += safeBase * calcDecayCoefficient(cultivationCount + i, decayRate);
  }
  return totalIncrease;
};

/**
 * 根据 base_aptitude_level 生成初始资质加成乘数。
 * 等级对应范围：1→1.00-1.05, 2→1.05-1.10, 3→1.10-1.15, 4→1.15-1.20, 5→1.20-1.25
 */
export const generateInitialAptitudeBonus = (
  baseAptitudeLevel: number,
): number => {
  const safeLevel = Math.max(1, Math.min(5, Math.floor(baseAptitudeLevel)));
  const minBonus = 1.0 + (safeLevel - 1) * 0.05;
  const maxBonus = minBonus + 0.05;
  return minBonus + Math.random() * (maxBonus - minBonus);
};
