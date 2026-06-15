/**
 * 灵田 V2 — 变异与品质判定服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：变异触发判定、变异类型分配、品质判定、变异遗传判定、变异效果计算。
 * 2. 不做什么：不做数据库操作、不做杂交判定。
 *
 * 数据流 / 状态流：
 * farmService.plantCrop → rollMutation() → 写入 cell.mutated/mutation_type
 * farmService.harvestCrop → rollQuality() + applyMutationEffect() → 计算实际产量和品质
 *
 * 复用设计说明：
 * - 所有概率判定集中在此模块，farmService 只调用不计算。
 * - 变异效果计算为纯函数，可被收获接口和离线结算复用。
 *
 * 关键边界条件与坑点：
 * 1. 变异判定在种植时完成，品质判定在收获时完成，两者独立。
 * 2. 金光变提升品质时，优质不再提升（避免溢出）。
 * 3. 速熟变和早衰变影响时间计算，需要在 computeCropState 之前应用倍率。
 */
import { getMutationConfig, getQualityConfig } from './farmConfigLoader.js';
import type { MutationType, CropQuality } from './farmTypes.js';

// ── 变异触发 ──

const POSITIVE_MUTATIONS: readonly MutationType[] = ['gold', 'double_yield', 'speed_ripen'];
const NEGATIVE_MUTATIONS: readonly MutationType[] = ['wither_early', 'half_yield'];

/**
 * 判定是否发生变异，并返回变异类型。
 * 返回 null 表示未发生变异。
 *
 * 变异概率分布：
 * - 正面变异（金光变/丰收变/速熟变）：positiveRate + neutralRate（原中性变异已移除）
 * - 负面变异（早衰变/歉收变）：negativeRate
 */
export function rollMutation(
  extraMutationRate: number,
): MutationType | null {
  const config = getMutationConfig();
  const totalRate = config.baseRate + extraMutationRate;

  if (Math.random() >= totalRate) return null;

  const roll = Math.random();
  let pool: readonly MutationType[];
  // 原中性变异（彩虹变）已移除，neutralRate 概率合并到正面变异
  if (roll < config.positiveRate + config.neutralRate) {
    pool = POSITIVE_MUTATIONS;
  } else {
    pool = NEGATIVE_MUTATIONS;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 判定变异种子是否遗传变异给后代。
 */
export function rollMutationInheritance(): boolean {
  const config = getMutationConfig();
  return Math.random() < config.inheritRate;
}

// ── 品质判定 ──

/**
 * 判定收获品质。
 * 在收获时调用，独立于变异判定。
 */
export function rollQuality(): CropQuality {
  const config = getQualityConfig();
  const roll = Math.random();
  if (roll < config.hqRate) return 'hq';
  if (roll < config.hqRate + config.normalRate) return 'normal';
  return 'lq';
}

/**
 * 金光变提升品质一档。
 * 劣质→普通，普通→优质，优质不变。
 */
export function applyGoldMutation(quality: CropQuality): CropQuality {
  switch (quality) {
    case 'lq': return 'normal';
    case 'normal': return 'hq';
    case 'hq': return 'hq';
  }
}

// ── 变异效果计算 ──

/**
 * 计算速度倍率（速熟变 + 装饰物灵泉加成）。
 * 基础为 1.0，速熟变缩短 30% → 倍率 = 1/0.7 ≈ 1.4286
 * 装饰物灵泉每个 +20%，可叠加。
 */
export function computeSpeedMultiplier(
  mutationType: MutationType | null,
  adjacentSpringCount: number,
): number {
  let multiplier = 1.0;
  if (mutationType === 'speed_ripen') {
    multiplier /= 0.7;
  }
  // 灵泉加成：每个 +20%，上限 +100%
  const springBonus = Math.min(adjacentSpringCount * 0.2, 1.0);
  multiplier *= (1 + springBonus);
  return multiplier;
}

/**
 * 计算枯萎时间倍率（早衰变效果）。
 * 早衰变枯萎时间提前 50% → 倍率 = 0.5
 * 正常为 1.0。
 */
export function computeWitherMultiplier(
  mutationType: MutationType | null,
): number {
  return mutationType === 'wither_early' ? 0.5 : 1.0;
}

/**
 * 计算产量倍率（丰收变 + 歉收变 + 品质 + 装饰物灵石加成）。
 *
 * 基础产量在 yieldMin~yieldMax 之间随机。
 * 品质影响：hq ×1（售价翻倍但产量不变），lq ×0.5
 * 变异影响：double_yield ×2，half_yield ×0.5
 * 装饰物灵石：每个 +10%，上限 +50%
 */
export function computeYieldMultiplier(
  mutationType: MutationType | null,
  quality: CropQuality,
  adjacentStoneCount: number,
): number {
  let multiplier = 1.0;

  // 品质产量影响
  if (quality === 'lq') multiplier *= 0.5;

  // 变异产量影响
  if (mutationType === 'double_yield') multiplier *= 2;
  if (mutationType === 'half_yield') multiplier *= 0.5;

  // 灵石加成：每个 +10%，上限 +50%
  const stoneBonus = Math.min(adjacentStoneCount * 0.1, 0.5);
  multiplier *= (1 + stoneBonus);

  return multiplier;
}

/**
 * 计算售价倍率（品质影响）。
 * hq ×2，normal ×1，lq ×0.5
 */
export function computeSellPriceMultiplier(quality: CropQuality): number {
  switch (quality) {
    case 'hq': return 2;
    case 'normal': return 1;
    case 'lq': return 0.5;
  }
}
