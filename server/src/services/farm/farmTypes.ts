/**
 * 灵田系统 V3 — 类型定义与纯函数。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义所有 V3 灵田配置类型、DTO 类型、生长阶段计算纯函数、相邻计算纯函数。
 * 2. 不做什么：不做数据库操作、不做请求处理。
 *
 * 数据流 / 状态流：
 * 配置 JSON → farmConfigLoader 加载 → 本模块类型约束 → farmService/farmHybridService/farmMutationService 使用。
 *
 * 复用设计说明：
 * - 类型定义集中管理，避免 service / route / DTO 各层重复定义近似类型。
 * - computeCropState 是纯函数，被 overview / harvest / plant 等多个接口复用。
 * - getAdjacentCells 是纯函数，被杂交判定、装饰物效果计算复用。
 *
 * 关键边界条件与坑点：
 * 1. stageLabels.length 必须等于 growthStageMinutes.length（farmConfigLoader 启动校验）。
 * 2. computeCropState 的 speedMultiplier 可能受装饰物影响，此处传入的是已合并的总倍率。
 * 3. V3 使用 (row, col) 坐标，引入等级（Level）和等阶（Tier）两个独立维度。
 */

// ── 灵根类型 ──

export type CropElement = '金' | '木' | '水' | '火' | '土';

// ── 变异类型 ──

export type MutationType =
  | 'gold'           // 金光变：品质提升一档
  | 'double_yield'   // 丰收变：产量 ×2
  | 'speed_ripen'     // 速熟变：生长周期缩短 30%
  | 'wither_early'    // 早衰变：枯萎时间提前 50%
  | 'half_yield';     // 歉收变：产量减半

// ── 品质类型 ──

export type CropQuality = 'hq' | 'normal' | 'lq';

// ── 装饰物类型 ──

export type DecorationType = 'spring' | 'stone' | 'array';

// ── 配置类型（对应 JSON 配置文件）──

export interface CropConfig {
  cropId: string;
  name: string;
  description: string;
  /** 作物元素数组（单属性如 ["金"]，双属性如 ["水", "木"]，无属性如 []） */
  element: CropElement[];
  rarity: string;
  sortOrder: number;
  enabled: boolean;
  growthStageMinutes: number[];
  stageLabels: string[];
  /** 可收获的阶段索引（0-based）。到达此阶段后即可收获。默认/未设置时使用最后一阶段。 */
  harvestableStage?: number;
  /** 可产出种子的阶段索引（0-based）。只有在此阶段收获才能尝试产种子。null 表示任何可收获阶段均可（由 seedFromYield 控制）。 */
  seedableStage?: number | null;
  witherAfterMinutes: number;
  yieldMin: number;
  yieldMax: number;
  sellPricePerUnit: number;
  /** 出售交易单位大小（多少个体制成 1 交易单位） */
  harvestTradeUnit: number;
  expGain: number;
  /** 种植所需的最低等阶（1-4，对应黄/玄/地/天） */
  requiredTier: number;
  seedItemId: string;
  seedUnit: string;
  harvestUnit: string;
  seedFromYield: boolean;
}

export interface SeedConfig {
  itemId: string;
  cropId: string;
  name: string;
  description: string;
  buyPrice: number;
  sellPrice: number;
  stackable: boolean;
  maxStack: number;
  /** 种植所需的最低等阶（1-4，对应黄/玄/地/天） */
  requiredTier: number;
  enabled: boolean;
  sortOrder: number;
  seedUnit: string;
}

export interface HybridRecipeConfig {
  recipeId: string;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  /** 基础作物 cropId（种植时触发作物的 cropId） */
  baseCropId: string;
  /** 所需相邻作物的 cropId 集合 */
  requiredCrops: string[];
  /** 最少需要满足的数量（可选，默认等于 requiredCrops.length 即全部满足） */
  minRequired?: number;
  resultCropId: string;
  resultSeedItemId: string;
  resultQuantity: number;
}

/** 杂交配方 DTO（返回给前端） */
export interface HybridRecipeConfigDto {
  recipeId: string;
  name: string;
  /** 基础作物 cropId */
  baseCropId: string;
  /** 所需相邻作物的 cropId 集合 */
  requiredCrops: string[];
  /** 最少需要满足的数量（可选） */
  minRequired?: number;
  /** 结果作物名称 */
  resultCropName: string;
}

export interface GridConfig {
  initialRows: number;
  initialCols: number;
  maxRows: number;
  fixedCols: number;
}

/** 息壤配置（全局统一） */
export interface XiRangConfig {
  /** 息壤单价（灵石/单位），用于前端展示 */
  pricePerUnit: number;
}

/** 格子开垦配置 */
export interface CellReclaimConfig {
  /** 开垦单格所需灵石 */
  spiritStoneCost: number;
  /** 开垦单格所需息壤（黄级基准） */
  xiRangCost: number;
}

/** 初始种子配置 */
export interface InitialSeedConfig {
  itemId: string;
  quantity: number;
}

/** 等阶配置（V3：替代原 FarmLevelConfig） */
export interface FarmTierConfig {
  /** 等阶（1-4，对应黄/玄/地/天） */
  tier: number;
  /** 等阶名称（如"黄级"） */
  name: string;
  /** 显示名称（如"黄级（凡土）"） */
  displayName: string;
  /** 突破到此等阶所需的最小等级 */
  minLevel: number;
  /** 从黄级累计到此等阶的每格息壤消耗量 */
  xiRangCost: number;
}

export interface MutationConfig {
  baseRate: number;
  positiveRate: number;
  neutralRate: number;
  negativeRate: number;
  inheritRate: number;
}

export interface QualityConfig {
  hqRate: number;
  normalRate: number;
  lqRate: number;
}

export interface PlotsConfig {
  grid: GridConfig;
  xiRang: XiRangConfig;
  cellReclaim: CellReclaimConfig;
  farmTiers: FarmTierConfig[];
  initialSeeds: InitialSeedConfig[];
  mutation: MutationConfig;
  quality: QualityConfig;
  /** 全局加速倍率（默认 1.0）。开发环境可设置为 > 1 加快 debug。作用于所有作物的经过时间。 */
  accelerationMultiplier: number;
}

// ── DTO 类型（API 返回）──

export type CropStage = 'growing' | 'harvestable' | 'withered';

/**
 * 单个生长区间。前端据此本地计算：
 * 1. 当前处于哪个区间（二分查找 now）
 * 2. 区间内进度条百分比
 * 3. 阶段标签与视觉状态
 *
 * startAt/endAt 均为绝对时间戳（ms）。最后一个区间（枯萎）endAt = Infinity。
 */
export interface StageIntervalDto {
  startAt: number;
  endAt: number;
  stage: CropStage;
  stageIndex: number;
  stageLabel: string;
}

export interface CropStateDto {
  stage: CropStage;
  progressBps: number;
  stageIndex: number;
  stageLabel: string;
  maturedAt: number | null;
  witheredAt: number | null;
  /** 完整生命周期区间列表，升序。前端调度器 + 进度条插值均从此字段派生。 */
  intervals: StageIntervalDto[];
}

export interface FarmCellDto {
  row: number;
  col: number;
  unlocked: boolean;
  cropId: string | null;
  cropName: string | null;
  /** 作物元素数组 */
  cropElement: CropElement[];
  cropRarity: string | null;
  cropState: CropStateDto | null;
  mutated: boolean;
  mutationType: MutationType | null;
  plantedAt: number | null;
  hasDecoration: boolean;
  decorationType: DecorationType | null;
  /** 待发放的杂交种子 itemId（种植时判定成功，收获时发放） */
  pendingHybridSeedItemId: string | null;
  /** 待发放的杂交种子名称（前端显示用） */
  pendingHybridSeedName: string | null;
}

// ── 静态配置 DTO（/api/farm/config）──

/** 种子静态配置（商店目录用） */
export interface SeedConfigDto {
  itemId: string;
  cropId: string;
  name: string;
  /** 灵根元素数组（如 ["金"]、["水", "木"]），空数组表示无元素 */
  element: CropElement[];
  buyPrice: number;
  sellPrice: number;
  /** 种植所需的最低等阶（1-4） */
  requiredTier: number;
  enabled: boolean;
  seedUnit: string;
  maxStack: number;
}

/** 灵材静态配置（仓库目录用，含产量、生长阶段等信息） */
export interface CropConfigDto {
  cropId: string;
  name: string;
  rarity: string;
  /** 作物元素数组 */
  element: CropElement[];
  harvestUnit: string;
  sellPricePerUnit: number;
  /** 出售交易单位大小（多少个体制成 1 交易单位） */
  harvestTradeUnit: number;
  /** 种植所需的最低等阶（1-4） */
  requiredTier: number;
  /** 最小产量 */
  yieldMin: number;
  /** 最大产量 */
  yieldMax: number;
  /** 各阶段所需时间（分钟） */
  growthStageMinutes: number[];
  /** 各阶段标签 */
  stageLabels: string[];
  /** 成熟后枯萎时间（分钟） */
  witherAfterMinutes: number;
  /** 总生长时间（分钟），前端计算用 */
  totalGrowthMinutes: number;
}

/** 灵田静态配置（种子目录 + 灵材目录 + 全局配置） */
export interface FarmStaticConfigDto {
  seeds: SeedConfigDto[];
  crops: CropConfigDto[];
  /** 杂交配方列表 */
  hybridRecipes: HybridRecipeConfigDto[];
  grid: {
    initialRows: number;
    initialCols: number;
    maxRows: number;
    fixedCols: number;
  };
  xiRang: {
    pricePerUnit: number;
  };
  cellReclaim: {
    spiritStoneCost: number;
    xiRangCost: number;
  };
  farmTiers: FarmTierConfig[];
  accelerationMultiplier: number;
}

// ── 动态库存 DTO（/api/farm/overview）──

/** 种子袋中的单条记录（动态部分） */
export interface SeedInventoryItem {
  /** 数据库记录 ID（用于唯一标识种子，因为 itemId + mutationType + generation 可能重复） */
  id: number;
  itemId: string;
  quantity: number;
  mutationType: MutationType | null;
  /** 种子代数（0=商店/初始种子，1=杂交产出，2+=后代） */
  generation: number;
}

/** 灵材仓库中的单条记录（动态部分） */
export interface HarvestInventoryItem {
  cropId: string;
  quantity: number;
  quality: CropQuality;
}

/** 灵田概览信息（V3：等级 + 等阶分离） */
export interface FarmInfoDto {
  /** 当前等阶（1-4） */
  farmTier: number;
  /** 等阶显示名称（如"黄级（凡土）"） */
  farmTierName: string;
  /** 当前等级（0-100） */
  farmLevel: number;
  /** 当前等级经验 */
  farmExp: number;
  /** 下一级所需经验（0 表示已满级） */
  nextLevelExpRequired: number;
  /** 当前解锁的最大行数 */
  maxRow: number;
  /** 当前等阶的每格息壤消耗（用于前端展示扩展费用） */
  currentTierXiRangCost: number;
  /** 息壤单价（用于前端展示） */
  xiRangPricePerUnit: number;
  /** 下一级等信息（null 表示已满级） */
  nextTier: {
    tier: number;
    name: string;
    displayName: string;
    minLevel: number;
    xiRangCost: number;
    /** 突破所需灵石（当前格子数 × xiRangCost × 单价） */
    totalSpiritStoneCost: number;
  } | null;
}

/** 灵田概览（精简版：移除静态配置，只返回动态数据） */
export interface FarmOverviewDto {
  /** 是否已开垦灵田（false 表示需要显示开垦界面） */
  reclaimed: boolean;
  farmInfo: FarmInfoDto | null;
  cells: FarmCellDto[];
  /** 种子袋（动态：itemId + quantity + mutationType） */
  seedBag: SeedInventoryItem[];
  /** 灵材仓库（动态：cropId + quantity + quality） */
  harvestBag: HarvestInventoryItem[];
  serverNow: number;
  /** 开垦费用信息（reclaimed=false 时使用） */
  reclaimCost?: {
    spiritStones: number;
    xiRang: number;
    xiRangPricePerUnit: number;
    totalSpiritStones: number;
  };
}

// ── 纯函数 ──

/**
 * 计算等级升级所需经验（线性递增公式）。
 * 公式：100 + 50 * (level - 1)
 * - 1 级升 2 级：100 经验
 * - 2 级升 3 级：150 经验
 * - 100 级：5050 经验
 */
export function calculateLevelUpExpRequired(level: number): number {
  return 100 + 50 * (level - 1);
}

/**
 * 计算等级对变异概率的加成（每级 ±0.1%，最高 ±10%）。
 * @returns 加成百分比（如 5 表示 +5%）
 */
export function calculateLevelMutationBonus(level: number): number {
  return Math.min(level * 0.1, 10);
}

/**
 * 八方向偏移量（含对角线），用于装饰物效果计算。
 */
const ADJACENT_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/**
 * 四方向偏移量（上下左右），用于杂交判定。
 */
const HYBRID_ADJACENT_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

/**
 * 计算指定格子的八方向相邻坐标（装饰物效果用）。
 * 纯函数，不查数据库，仅做边界裁剪。
 */
export function getAdjacentCells(
  row: number,
  col: number,
  maxRow: number,
  maxCol: number,
): Array<{ row: number; col: number }> {
  const result: Array<{ row: number; col: number }> = [];
  for (const [dr, dc] of ADJACENT_OFFSETS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < maxRow && nc >= 0 && nc < maxCol) {
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

/**
 * 计算指定格子的四方向相邻坐标（杂交判定用）。
 * 纯函数，不查数据库，仅做边界裁剪。
 */
export function getHybridAdjacentCells(
  row: number,
  col: number,
  maxRow: number,
  maxCol: number,
): Array<{ row: number; col: number }> {
  const result: Array<{ row: number; col: number }> = [];
  for (const [dr, dc] of HYBRID_ADJACENT_OFFSETS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < maxRow && nc >= 0 && nc < maxCol) {
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

/**
 * 实时计算作物当前生长状态。
 * 不依赖 tick 推进，每次查询根据 planted_at 即时计算。
 *
 * speedMultiplier: 综合速度倍率（含装饰物灵泉加成 + 速熟变效果），由调用方预计算后传入。
 * witherMultiplier: 枯萎时间倍率（早衰变为 0.5），由调用方预计算后传入。
 * accelerationMultiplier: 全局加速倍率（开发环境用），由调用方从配置读取后传入。
 *
 * 阶段时点计算规则：
 * 1. 萌芽阶段（stageIndex=0）不应用速熟变：effectiveMinutes = elapsedMinutes
 * 2. 后续阶段应用速熟变：effectiveMinutes = firstStage + (elapsed - firstStage) * speedMul
 * 3. 枯萎时间应用早衰变：witheredAt = harvestableAt + witherAfterMinutes * witherMul
 * 4. intervals 包含完整生命周期区间，前端据此本地计算进度条与调度唤醒
 * 5. 全局加速：elapsedMinutes 乘以 accelerationMultiplier，所有阶段等比例加速
 *
 * 变异效果规则：萌芽阶段（stageIndex=0）所有变异效果均不生效，从第二阶段开始生效。
 */
export function computeCropState(
  cropConfig: CropConfig,
  plantedAt: number,
  now: number,
  speedMultiplier: number,
  witherMultiplier: number,
  accelerationMultiplier: number = 1.0,
): CropStateDto {
  const elapsedMinutes = ((now - plantedAt) / 60_000) * accelerationMultiplier;
  const firstStageMinutes = cropConfig.growthStageMinutes[0];

  // 辅助函数：effective分钟 → 真实经过分钟（逆运算，考虑速熟变和加速）
  // intervals 的 startAt/endAt 是加速后的真实时间戳，前端可直接显示
  const toElapsed = (eff: number): number => {
    let realMinutes: number;
    if (eff <= firstStageMinutes) {
      realMinutes = eff;
    } else {
      realMinutes = firstStageMinutes + (eff - firstStageMinutes) / speedMultiplier;
    }
    // 加速：真实时间 = 有效时间 / 加速倍率
    return realMinutes / accelerationMultiplier;
  };

  // 计算可收获阶段的开始时间（harvestableStage 指定可收获的阶段索引）
  // 可收获开始时间 = 前 harvestableStageIndex 个阶段的累计时间（不含该阶段本身）
  const harvestableStageIndex = cropConfig.harvestableStage ?? (cropConfig.growthStageMinutes.length - 1);
  const harvestableMinutes = cropConfig.growthStageMinutes
    .slice(0, harvestableStageIndex)
    .reduce((sum, m) => sum + m, 0);

  // 关键时点（绝对时间戳，ms）— 统一公式，不分支
  // intervals 使用加速后的时间，前端可直接显示
  const harvestableAt = plantedAt + toElapsed(harvestableMinutes) * 60_000;
  // 枯萎时间也需要考虑加速
  const witheredAt = harvestableAt + (cropConfig.witherAfterMinutes * witherMultiplier / accelerationMultiplier) * 60_000;

  // 构建完整生命周期区间列表
  const intervals: StageIntervalDto[] = [];
  let intervalStart = plantedAt;
  let accEff = 0;

  for (let i = 0; i < cropConfig.growthStageMinutes.length; i++) {
    accEff += cropConfig.growthStageMinutes[i];
    const intervalEnd = plantedAt + toElapsed(accEff) * 60_000;
    const isHarvestable = i >= harvestableStageIndex;

    intervals.push({
      startAt: intervalStart,
      endAt: intervalEnd,
      stage: isHarvestable ? 'harvestable' : 'growing',
      stageIndex: i,
      stageLabel: cropConfig.stageLabels[i] ?? (isHarvestable ? '可收获' : '生长中'),
    });

    intervalStart = intervalEnd;
  }

  // 最后一个生长区间结束后，添加可收获等待期或枯萎期
  if (intervalStart >= harvestableAt && intervals.length > 0) {
    // harvestableStage = last，最后一个生长区间即为可收获，延伸到 witheredAt
    intervals[intervals.length - 1].endAt = witheredAt;
  } else if (intervalStart < witheredAt) {
    // harvestableStage < last，添加独立的可收获等待区间
    intervals.push({
      startAt: intervalStart,
      endAt: witheredAt,
      stage: 'harvestable',
      stageIndex: harvestableStageIndex,
      stageLabel: cropConfig.stageLabels[harvestableStageIndex] ?? '可收获',
    });
  }

  // 枯萎区间
  intervals.push({
    startAt: witheredAt,
    endAt: Infinity,
    stage: 'withered',
    stageIndex: -1,
    stageLabel: '枯萎',
  });

  // Effective minutes: 萌芽阶段不应用速熟变
  let effectiveMinutes: number;
  if (elapsedMinutes <= firstStageMinutes) {
    effectiveMinutes = elapsedMinutes;
  } else {
    effectiveMinutes = firstStageMinutes + (elapsedMinutes - firstStageMinutes) * speedMultiplier;
  }

  // 当前状态判定（使用绝对时间戳比较，避免分支不一致）
  if (now >= witheredAt) {
    return { stage: 'withered', progressBps: 10_000, stageIndex: -1, stageLabel: '枯萎', maturedAt: harvestableAt, witheredAt, intervals };
  }
  if (now >= harvestableAt) {
    // 已进入可收获阶段（可能继续生长到更后面的阶段，但已可收获）
    // 计算当前实际阶段索引
    let actualStageIndex = harvestableStageIndex;
    let accumulated = 0;
    for (let i = 0; i < cropConfig.growthStageMinutes.length; i++) {
      accumulated += cropConfig.growthStageMinutes[i];
      if (effectiveMinutes < accumulated) {
        actualStageIndex = i;
        break;
      }
    }
    const stageLabel = cropConfig.stageLabels[actualStageIndex] ?? '可收获';
    return { stage: 'harvestable', progressBps: 10_000, stageIndex: actualStageIndex, stageLabel, maturedAt: harvestableAt, witheredAt, intervals };
  }

  let accumulated = 0;
  for (let i = 0; i < cropConfig.growthStageMinutes.length; i++) {
    accumulated += cropConfig.growthStageMinutes[i];
    if (effectiveMinutes < accumulated) {
      const stageStart = accumulated - cropConfig.growthStageMinutes[i];
      const stageProgress = (effectiveMinutes - stageStart) / cropConfig.growthStageMinutes[i];
      return {
        stage: 'growing',
        progressBps: Math.floor(stageProgress * 10_000),
        stageIndex: i,
        stageLabel: cropConfig.stageLabels[i] ?? '生长中',
        maturedAt: harvestableAt,
        witheredAt,
        intervals,
      };
    }
  }

  // Fallback（理论上不会到达，因为 now < harvestableAt 时必然在某个生长阶段内）
  const lastLabel = cropConfig.stageLabels[harvestableStageIndex] ?? '可收获';
  return { stage: 'harvestable', progressBps: 10_000, stageIndex: harvestableStageIndex, stageLabel: lastLabel, maturedAt: harvestableAt, witheredAt, intervals };
}
