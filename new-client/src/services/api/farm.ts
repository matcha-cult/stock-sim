/**
 * 灵田系统 V3 — API 封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：封装灵田相关 HTTP 请求，定义 DTO 类型。
 * 2. 不做什么：不处理业务逻辑、不管理状态。
 *
 * 数据流 / 状态流：
 * Store 调用 API → 返回 ApiPayload → Store 更新 observable。
 *
 * 复用设计说明：
 * - DTO 类型与后端 farmTypes.ts 保持一致，避免重复定义。
 * - V3 新增 reclaim/expand-cell/upgrade-tier 接口，移除旧的 unlock-cell/upgrade-level。
 *
 * 关键边界条件与坑点：
 * 1. V3 等级（Level）与等阶（Tier）分离：farmTier 1-4（黄/玄/地/天），farmLevel 0-100。
 * 2. 未开垦玩家（reclaimed=false）需展示开垦界面，不可种植。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core.js';

// ==================== 静态配置 DTO ====================

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
  hybridRecipes: HybridRecipeDto[];
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
  farmTiers: Array<{
    tier: number;
    name: string;
    displayName: string;
    minLevel: number;
    xiRangCost: number;
  }>;
  accelerationMultiplier: number;
}

/** 相邻条件类型：特性条件 */
export interface TraitAdjacentConditionDto {
  type: 'trait';
  /** 特性名称（如 "禾本"、"金灵"） */
  value: string;
  /** 最少需要满足的数量 */
  minCount: number;
}

/** 相邻条件类型：元素条件 */
export interface ElementAdjacentConditionDto {
  type: 'element';
  /** 元素名称（如 "金"、"木"） */
  value: CropElement;
  /** 最少需要满足的数量 */
  minCount: number;
}

/** 相邻条件类型：元素条件引用 */
export interface ElementConditionAdjacentConditionDto {
  type: 'elementCondition';
  /** 条件 ID（如 "single_element_invasion"、"dual_element_generation"、"wu_xing_gui_yuan"） */
  conditionId: string;
  /** 单元素条件时的元素参数 */
  element?: CropElement;
  /** 多元素条件时的元素参数数组 */
  elements?: CropElement[];
}

/** 相邻条件联合类型 */
export type RequiredAdjacentConditionDto =
  | TraitAdjacentConditionDto
  | ElementAdjacentConditionDto
  | ElementConditionAdjacentConditionDto;

/** 杂交配方 DTO（V4：基于特性 + 元素条件） */
export interface HybridRecipeDto {
  recipeId: string;
  name: string;
  /** 基础作物 cropId */
  baseCropId: string;
  /** 相邻条件数组 */
  requiredAdjacent: RequiredAdjacentConditionDto[];
  /** 结果作物名称 */
  resultCropName: string;
}

// ==================== 动态库存 DTO ====================

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

// ==================== DTO 类型 ====================

export type CropElement = '金' | '木' | '水' | '火' | '土';
export type MutationType = 'gold' | 'double_yield' | 'speed_ripen' | 'wither_early' | 'half_yield';
export type CropQuality = 'hq' | 'normal' | 'lq';
export type DecorationType = 'spring' | 'stone' | 'array';
export type CropStage = 'growing' | 'harvestable' | 'withered';

/**
 * 单个生长区间。前端据此本地计算：
 * 1. 当前处于哪个区间（比较 now 与 startAt/endAt）
 * 2. 区间内进度条百分比
 * 3. 阶段标签与视觉状态
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

export interface PlantResult {
  success: boolean;
  message: string;
  mutationType?: MutationType | null;
  hybridTriggered?: boolean;
  hybridResultSeedName?: string | null;
  /** 成功时返回播种后的格子完整数据，前端可局部更新 */
  cell?: FarmCellDto;
}

export interface HarvestResult {
  success: boolean;
  message: string;
  withered?: boolean;
  witheredSeedItemId?: string | null;
  quantity?: number;
  quality?: CropQuality;
  mutationType?: MutationType | null;
  seedProduced?: boolean;
  seedItemId?: string;
  seedMutationType?: string | null;
}

export interface TransplantResult {
  success: boolean;
  message: string;
  fromCell?: FarmCellDto;
  toCell?: FarmCellDto;
}

export interface ActionResult {
  success: boolean;
  message: string;
}

export interface SellAllResult {
  success: boolean;
  message: string;
  totalEarn: number;
}

export interface HarvestAllResult {
  success: boolean;
  message: string;
  harvestedCount: number;
  results: Array<{ row: number; col: number; success: boolean; message: string }>;
}

// ==================== API 请求 ====================

export const getFarmOverview = (config?: AxiosRequestConfig) =>
  api.get<FarmOverviewDto>('/api/farm/overview', config);

/** 获取灵田静态配置（只调用一次） */
export const getFarmConfig = () =>
  api.get<FarmStaticConfigDto>('/api/farm/config');

export const buySeed = (itemId: string, quantity: number) =>
  api.post<ActionResult>('/api/farm/buy-seed', { itemId, quantity });

export const sellSeed = (itemId: string, quantity: number, mutationType: string | null) =>
  api.post<ActionResult>('/api/farm/sell-seed', { itemId, quantity, mutationType });

export const plantCrop = (row: number, col: number, seedId: number) =>
  api.post<PlantResult>('/api/farm/plant', { row, col, seedId });

export const harvestCrop = (row: number, col: number) =>
  api.post<HarvestResult>('/api/farm/harvest', { row, col });

export const harvestAll = () =>
  api.post<HarvestAllResult>('/api/farm/harvest-all');

export const removeCrop = (row: number, col: number) =>
  api.post<ActionResult & { hybridRevoked?: boolean }>('/api/farm/remove', { row, col });

export const transplantCrop = (fromRow: number, fromCol: number, toRow: number, toCol: number) =>
  api.post<TransplantResult>('/api/farm/transplant', { fromRow, fromCol, toRow, toCol });

export const sellHarvest = (cropId: string, quality: CropQuality, tradeUnits: number) =>
  api.post<ActionResult>('/api/farm/sell-harvest', { cropId, quality, tradeUnits });

export const sellAllHarvest = () =>
  api.post<SellAllResult>('/api/farm/sell-all-harvest');

// ==================== V3：开垦 / 扩展 / 突破 ====================

/** 活动日志 DTO */
export interface ActivityLogDto {
  id: string;
  activityType: string;
  row: number;
  col: number;
  cropId: string | null;
  cropName: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

/** 活动日志分页响应 */
export interface ActivityLogPageResult {
  logs: ActivityLogDto[];
  total: number;
}

/** 获取活动日志（分页） */
export const getFarmLog = (page: number = 1, pageSize: number = 20, config?: AxiosRequestConfig) =>
  api.get<ActivityLogPageResult>('/api/farm/log', { params: { page, pageSize }, ...config });

/** 开垦灵田（首次 16 格） */
export const reclaimFarm = () =>
  api.post<ActionResult>('/api/farm/reclaim');

/** 扩展单个格子 */
export const expandCell = (row: number, col: number) =>
  api.post<ActionResult>('/api/farm/expand-cell', { row, col });

/** 等阶突破（黄→玄→地→天） */
export const upgradeTier = () =>
  api.post<ActionResult & { newTier?: number }>('/api/farm/upgrade-tier');
