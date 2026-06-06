/**
 * 月卡接口封装。
 *
 * 提供获取月卡状态、领取每日奖励、GM 发放/回收月卡的 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';

export interface MonthCardConfigDto {
  configKey: string;
  durationDays: number;
  dailyRewardSpiritStones: number;
  scratchBonusBps: number;
  shopRentBonusBps: number;
  description: string;
}

export interface MonthCardStatusDto {
  isActive: boolean;
  expiresAt: number | null;
  daysRemaining: number | null;
  todayClaimed: boolean;
  config: MonthCardConfigDto | null;
}

export interface ClaimResultDto {
  success: boolean;
  message: string;
  rewardSpiritStones: number;
  balanceAfter: number;
}

export interface GmGrantMonthCardResult {
  success: boolean;
  message: string;
  expiresAt: number | null;
  daysRemaining: number | null;
  isNewGrant: boolean;
}

export interface GmRevokeMonthCardResult {
  success: boolean;
  message: string;
  wasActive: boolean;
}

/**
 * 获取月卡状态。
 */
export const getMonthCardStatus = (
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: MonthCardStatusDto | null; message?: string }> => {
  return api.get('/api/month-card/status', requestConfig);
};

/**
 * 领取每日奖励。
 */
export const claimDailyReward = (
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: ClaimResultDto | null; message?: string }> => {
  return api.post('/api/month-card/claim-daily', {}, requestConfig);
};

/**
 * GM 发放/续期月卡。
 */
export const gmGrantMonthCard = (
  characterId: number,
  days?: number,
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: GmGrantMonthCardResult | null; message?: string }> => {
  return api.post('/api/gm/month-card/grant', { characterId, days }, requestConfig);
};

/**
 * GM 回收月卡。
 */
export const gmRevokeMonthCard = (
  characterId: number,
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: GmRevokeMonthCardResult | null; message?: string }> => {
  return api.post('/api/gm/month-card/revoke', { characterId }, requestConfig);
};
