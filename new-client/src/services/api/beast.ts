/**
 * 灵兽系统 API 封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：封装灵兽相关 HTTP 请求，定义 DTO 类型。
 * 2. 不做什么：不处理业务逻辑、不管理状态。
 *
 * 数据流 / 状态流：
 * Store/组件 调用 API → 返回 ApiPayload → Store 更新 observable。
 */
import api from './core.js';

// ==================== DTO 类型 ====================

export interface BeastDisplayDto {
  id: number;
  beastDefId: string;
  bloodlineId: string | null;
  bloodlineName: string | null;
  bloodlineRarity: string | null;
  transformForm: string | null;
  name: string;
  templateName: string;
  templateId: string;
  description: string | null;
  avatar: string | null;
  level: number;
  progressExp: number;
  aptitudeBonus: number;
  cultivationCount: number;
  beastTier: string;
  starLevel: number;
  isTransformed: boolean;
  isActive: boolean;
  customTag: string | null;
  element: string[];
  role: string;
  maxTechniqueSlots: number;
  innateTechniqueIds: string[];
}

export interface BeastComputedAttrsDto {
  max_hp: number;
  max_mp: number;
  atk: number;
  magic_atk: number;
  def: number;
  magic_def: number;
  spd: number;
  accuracy: number;
  dodge: number;
  parry: number;
  crit_rate: number;
  crit_dmg: number;
  crit_dmg_reduce: number;
  anti_crit: number;
  dmg_bonus: number;
  heal_bonus: number;
  heal_reduce: number;
  life_steal: number;
  cdr: number;
  control_resist: number;
  metal_resist: number;
  wood_resist: number;
  water_resist: number;
  fire_resist: number;
  earth_resist: number;
  hp_regen: number;
  mp_regen: number;
}

export interface BeastTechniqueDto {
  id: number;
  techniqueId: string;
  currentLayer: number;
  isInnate: boolean;
  learnedFromItemDefId: string | null;
}

export interface BeastDetailDto extends BeastDisplayDto {
  computedAttrs: BeastComputedAttrsDto;
  baseAttrsOverride: Record<string, number>;
  levelGainsOverride: Record<string, number>;
  templateBaseAttrs: Record<string, number>;
  templateLevelGains: Record<string, number>;
  techniques: BeastTechniqueDto[];
}

export interface BeastOverviewDto {
  beasts: BeastDisplayDto[];
  activeBeastId: number | null;
  maxBeastCount: number;
}

export interface BeastSkillPolicySlotDto {
  skillId: string;
  priority: number;
  enabled: boolean;
}

export interface SummonGenerateDto extends BeastDetailDto {
  minSpiritStones: number;
}

export interface CultivationResultDto {
  bonusIncrease: number;
  newAptitudeBonus: number;
  newCultivationCount: number;
  decayCoefficient: number;
}

export interface CultivationPreviewDto {
  bonusIncreasePerTime: number;
  totalBonusIncrease: number;
  decayCoefficient: number;
  currentCultivationCount: number;
  projectedCultivationCount: number;
}

export interface TierUpRequirementDto {
  minLevel: number;
  consumeItem: string;
  consumeItemCount: number;
  consumeSpiritStones: number;
}

export interface TierUpCheckDto {
  canTierUp: boolean;
  failedReasons: string[];
  nextTier: string | null;
  requirement: TierUpRequirementDto | null;
}

export interface TransformCheckDto {
  canTransform: boolean;
  failedReasons: string[];
}

export interface OfferingDto {
  itemId: string;
  name: string;
  quantity: number;
  element: string[];
  traits: string[];
  source: 'seed' | 'harvest';
  tradeUnit: number;
  quality?: 'hq' | 'normal' | 'lq';
}

export type BeastActionType = 'summon' | 'release' | 'cultivate' | 'tier_up' | 'transform';

export interface BeastActionLogDto {
  id: number;
  characterId: number;
  actionType: BeastActionType;
  actionTypeLabel: string;
  spiritStonesCost: number;
  otherCost: string | null;
  actionDetail: string | null;
  createdAt: number;
}

export interface ActionLogPageResult {
  logs: BeastActionLogDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== API 方法 ====================

/** 获取灵兽总览 */
export const fetchBeastOverview = () =>
  api.get<BeastOverviewDto>('/api/beast/overview');

/** 获取灵兽详情 */
export const fetchBeastPreview = (beastId: number) =>
  api.get<BeastDetailDto>(`/api/beast/preview?beastId=${beastId}`);

/** 批量获取灵兽详情 */
export const fetchBeastBatchPreview = (beastIds: number[]) =>
  api.get<BeastDetailDto[]>(`/api/beast/preview/batch?beastIds=${beastIds.join(',')}`);

/** 查询技能策略 */
export const fetchBeastSkillPolicy = (beastId: number) =>
  api.get<{ slots: BeastSkillPolicySlotDto[] }>(`/api/beast/skill-policy?beastId=${beastId}`);

/** 更新技能策略 */
export const updateBeastSkillPolicy = (beastId: number, slots: BeastSkillPolicySlotDto[]) =>
  api.put<{ slots: BeastSkillPolicySlotDto[] }>('/api/beast/skill-policy', { beastId, slots });

/** 出战 */
export const activateBeast = (beastId: number) =>
  api.post('/api/beast/activate', { beastId });

/** 收回 */
export const dismissBeast = () =>
  api.post('/api/beast/dismiss', {});

/** 放生（解除契约） */
export const releaseBeast = (beastId: number) =>
  api.post('/api/beast/release', { beastId });

/** 赐名 */
export const renameBeast = (beastId: number, name: string, description?: string) =>
  api.post('/api/beast/renameWithCard', { beastId, name, description });

/** 更新自定义标签 */
export const updateBeastCustomTag = (beastId: number, customTag: string | null) =>
  api.post('/api/beast/update-custom-tag', { beastId, customTag });

/** 经验灌注 */
export const injectBeastExp = (beastId: number, exp: number) =>
  api.post('/api/beast/inject-exp', { beastId, exp });

/** 祭坛召唤 */
export const generateSummon = (offerings: { itemId: string; quality?: 'hq' | 'normal' | 'lq' }[], spiritStones: number) =>
  api.post<SummonGenerateDto>('/api/beast/summon/generate', { offerings, spiritStones });

/** 批量召唤（自动签订契约） */
export interface BatchSummonResult {
  successCount: number;
  failCount: number;
  errors: string[];
}

export const batchSummon = (offerings: { itemId: string; quality?: 'hq' | 'normal' | 'lq' }[], spiritStones: number, count: number) =>
  api.post<BatchSummonResult>('/api/beast/altar/summon/batch', { offerings, spiritStones, count });

/** 确认召唤 */
export const confirmSummon = (beastId: number) =>
  api.post(`/api/beast/summon/${beastId}/confirm`, {});

/** 放弃召唤 */
export const discardSummon = (beastId: number) =>
  api.post(`/api/beast/summon/${beastId}/discard`, {});

/** 单次培育 */
export const cultivateBeast = (beastId: number, itemId: string) =>
  api.post<CultivationResultDto>('/api/beast/cultivate', { beastId, itemId });

/** 批量培育 */
export const batchCultivateBeast = (beastId: number, itemId: string, count: number) =>
  api.post('/api/beast/cultivate/batch', { beastId, itemId, count });

/** 培育预览 */
export const fetchCultivationPreview = (beastId: number, itemId: string, count: number = 1) =>
  api.get<CultivationPreviewDto>(`/api/beast/cultivation-preview?beastId=${beastId}&itemId=${itemId}&count=${count}`);

export interface TierUpResultDto {
  previousTier: string;
  newTier: string;
  cultivationCountReset: boolean;
  autoBoughtPill?: boolean;
  pillCost?: number;
  spiritStonesCost?: number;
}

/** 品阶提升 */
export const tierUpBeast = (beastId: number, autoBuyPill: boolean = false) =>
  api.post<TierUpResultDto>('/api/beast/tier-up', { beastId, autoBuyPill });

/** 化形 */
export const transformBeast = (beastId: number) =>
  api.post('/api/beast/transform', { beastId });

/** 检查品阶提升条件 */
export const checkTierUp = (beastId: number) =>
  api.get<TierUpCheckDto>(`/api/beast/tier-up/check?beastId=${beastId}`);

/** 检查化形条件 */
export const checkTransform = (beastId: number) =>
  api.get<TransformCheckDto>(`/api/beast/transform/check?beastId=${beastId}`);

/** 获取祭坛可用祭品 */
export const fetchAltarOfferings = () =>
  api.get<OfferingDto[]>('/api/beast/altar/offerings');

/** 召唤配方信息 */
export interface AltarRecipeDto {
  bloodlineName: string;
  transformForm: string;
  rarity: string;
  description: string;
}

/** 获取祭坛召唤配方 */
export const fetchAltarRecipes = () =>
  api.get<AltarRecipeDto[]>('/api/beast/altar/recipes');

/** 获取操作日志 */
export const fetchBeastActionLogs = (page: number = 1) =>
  api.get<ActionLogPageResult>(`/api/beast/action-log?page=${page}`);

/** 灵兽融合响应 */
export interface FuseBeastsResponse {
  newBeastId: number;
  newStarLevel: number;
}

/** 灵兽融合 */
export const fuseBeasts = (beastIds: number[]) =>
  api.post<FuseBeastsResponse>('/api/beast/fuse', { beastIds });
