/**
 * GM 灵石管理接口封装。
 *
 * 提供 GM 查询角色信息、调整灵石余额（单人/全体）的 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';

export type GmAdjustTarget = 'single' | 'all';
export type GmAdjustOperation = 'add' | 'reduce';
export type GmAdjustBizType = 'gm_compensation' | 'gm_rebate';

export interface GmCharacterInfo {
  characterId: number;
  nickname: string;
  spiritStones: number;
}

export interface GmAdjustParams {
  target: GmAdjustTarget;
  characterId?: number;
  operation: GmAdjustOperation;
  amount: number;
  bizType: GmAdjustBizType;
  memo: string;
}

export interface GmSingleAdjustResult {
  success: boolean;
  message: string;
  remaining?: number;
}

export interface GmAllAdjustResult {
  success: boolean;
  message: string;
  totalCount: number;
  successCount: number;
  skippedCount: number;
}

export type GmAdjustResult = GmSingleAdjustResult | GmAllAdjustResult;

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * GM 查询角色基本信息（昵称 + 当前余额）。
 */
export const lookupCharacterById = (
  characterId: number,
  requestConfig?: AxiosRequestConfig,
): Promise<ApiResponse<GmCharacterInfo>> => {
  return api.get(`/api/stock-market/gm/character/${characterId}`, requestConfig);
};

/**
 * GM 调整灵石余额（单人或全体）。
 */
export const adjustSpiritStones = (
  body: GmAdjustParams,
  requestConfig?: AxiosRequestConfig,
): Promise<ApiResponse<GmAdjustResult>> => {
  return api.post('/api/stock-market/gm/spirit-stones/adjust', body, requestConfig);
};
