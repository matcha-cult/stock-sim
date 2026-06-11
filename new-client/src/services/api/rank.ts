/**
 * 排行接口封装。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义财富排行、股市市值排行、股市收益排行的 DTO 和 API 函数。
 * 2. 不做什么：不做数据格式化、不做缓存、不管理 UI 状态。
 *
 * 输入 / 输出：
 * - 输入：limit 参数（可选）。
 * - 输出：标准 { success, data } 响应。
 *
 * 数据流 / 状态流：
 * 组件/Store 调用 -> api.get -> 返回 DTO 列表。
 *
 * 复用设计说明：
 * - 复用核心 axios 实例（api），遵循项目统一请求拦截规范。
 * - 类型定义与后端 rankService.ts 导出类型对齐。
 *
 * 关键边界条件与坑点：
 * 1. metric 参数对财富排行无意义，仅股市排行需要。
 * 2. 后端返回字段为 camelCase，与 SQL 别名保持一致。
 */

import type { AxiosRequestConfig } from 'axios';
import api from './core';

// ============================================
// 类型定义
// ============================================

export type StockMarketRankMetric = 'value' | 'unrealizedProfit' | 'totalProfit' | 'totalLoss';

export type WealthRankDto = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  isGm: boolean;
  spiritStones: number;
  silver: number;
};

export type StockMarketRankDto = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  isGm: boolean;
  totalHoldingQty: number;
  totalMarketValueSpiritStones: number;
  totalCostSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  realizedPnlSpiritStones: number;
  totalPnlSpiritStones: number;
};

export type ShopRentRankDto = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  isGm: boolean;
  totalRentCollected: number;
  shopCount: number;
};

export type ScratchRankMetric = 'total' | 'grandCount' | 'firstCount';

export type ScratchRankDto = {
  rank: number;
  characterId: number;
  name: string;
  title: string;
  monthCardActive: boolean;
  isGm: boolean;
  totalPrizeAmount: number;
  settledCount: number;
  grandPrizeCount: number;
  firstPrizeCount: number;
};

interface RankApiResponse<TData> {
  success: boolean;
  message?: string;
  data?: TData;
}

// ============================================
// API 函数
// ============================================

export const getWealthRanks = (
  limit?: number,
  requestConfig?: AxiosRequestConfig,
): Promise<RankApiResponse<WealthRankDto[]>> => {
  const params: Record<string, unknown> = {};
  if (limit) params.limit = limit;
  return api.get('/api/rank/wealth', { params, ...requestConfig });
};

export const getStockMarketRanks = (
  metric: StockMarketRankMetric,
  limit?: number,
  requestConfig?: AxiosRequestConfig,
): Promise<RankApiResponse<StockMarketRankDto[]>> => {
  const params: Record<string, unknown> = { metric };
  if (limit) params.limit = limit;
  return api.get('/api/rank/stock-market', { params, ...requestConfig });
};

export const getShopRentRanks = (
  limit?: number,
  requestConfig?: AxiosRequestConfig,
): Promise<RankApiResponse<ShopRentRankDto[]>> => {
  const params: Record<string, unknown> = {};
  if (limit) params.limit = limit;
  return api.get('/api/rank/shop-rent', { params, ...requestConfig });
};

export const getScratchRanks = (
  metric: ScratchRankMetric,
  limit?: number,
  requestConfig?: AxiosRequestConfig,
): Promise<RankApiResponse<ScratchRankDto[]>> => {
  const params: Record<string, unknown> = { metric };
  if (limit) params.limit = limit;
  return api.get('/api/rank/scratch', { params, ...requestConfig });
};
