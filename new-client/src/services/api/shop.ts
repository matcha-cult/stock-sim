/**
 * 收租系统 — API 封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：封装店铺相关 HTTP 请求，定义 DTO 类型。
 * 2. 不做什么：不处理业务逻辑、不管理状态。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core.js';
import type { ApiPayload } from './core.js';

// ==================== DTO 类型 ====================

export type ShopDto = {
  id: number;
  shopType: string;
  shopTypeName: string;
  area: number;
  decorationTier: string;
  decorationTierLabel: string;
  upgradeLevel: number;
  spaceExpansion: number;
  pendingRent: number;
  totalRentCollected: number;
  rentTickCount: number;
  rentPerTick: number;
  isDecorating: boolean;
};

export type ShopOverviewDto = {
  shops: ShopDto[];
  totalPendingRent: number;
  nextRentAt: string;
};

export type CollectRentResult = {
  success: boolean;
  message: string;
  collectedRent?: number;
};

export type DecorationResult = {
  success: boolean;
  message: string;
  newTier?: string;
  cost?: number;
  refund?: number;
};

export type SpaceExpansionResult = {
  success: boolean;
  message: string;
  newExpansion?: number;
  newArea?: number;
  cost?: number;
};

export type ClaimInitialShopResult = {
  success: boolean;
  message: string;
  shop?: ShopDto;
};

export type PurchaseShopResult = {
  success: boolean;
  message: string;
  shop?: ShopDto;
  cost?: number;
};

export type CollectAllResult = {
  success: boolean;
  message: string;
  totalCollected: number;
};

export type ShopConfigDto = {
  shopTypes: Record<string, { name: string; initialArea: number; initialRent: number; purchaseCost: number }>;
  decorationTiers: Record<string, {
    label: string;
    index: number;
    rentMultiplier: number;
    pricePerSqm: number;
    expansionMultiplier: number;
  }>;
  decorationTierOrder: string[];
  constants: {
    spaceExpansionAreaIncrement: number;
    spaceExpansionBaseCost: number;
    spaceExpansionMaxCount: number;
    maxPendingRentTicks: number;
    decorationRefundRate: number;
    upgradeLevelBonusRate: number;
    upgradeTicksBase: number;
    upgradeMaxLevel: number;
    rentTickIntervalMinutes: number;
  };
};

// ==================== API 方法 ====================

export const getShopOverview = (
  requestConfig?: AxiosRequestConfig,
): Promise<ApiPayload<ShopOverviewDto>> => {
  return api.get('/api/shop/overview', requestConfig);
};

export const getShopConfig = (): Promise<ApiPayload<ShopConfigDto>> => {
  return api.get('/api/shop/config');
};

export const collectShopRent = (shopId: number): Promise<ApiPayload<CollectRentResult>> => {
  return api.post(`/api/shop/${shopId}/collect`);
};

export const collectAllRent = (): Promise<ApiPayload<CollectAllResult>> => {
  return api.post('/api/shop/collect-all');
};

export const adjustShopDecoration = (
  shopId: number,
  targetTier: string,
): Promise<ApiPayload<DecorationResult>> => {
  return api.post(`/api/shop/${shopId}/decoration`, { targetTier });
};

export const expandShopSpace = (shopId: number): Promise<ApiPayload<SpaceExpansionResult>> => {
  return api.post(`/api/shop/${shopId}/expand`);
};

export const claimInitialShop = (): Promise<ApiPayload<ClaimInitialShopResult>> => {
  return api.post('/api/shop/claim-initial');
};

export const purchaseShop = (shopType: string): Promise<ApiPayload<PurchaseShopResult>> => {
  return api.post('/api/shop/purchase', { shopType });
};
