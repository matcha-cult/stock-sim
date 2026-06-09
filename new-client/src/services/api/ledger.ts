/**
 * 灵石流水账接口封装。
 *
 * 提供玩家自查流水、GM 查询玩家流水（分页）的 DTO 和 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';
import { withRequestParams } from './requestConfig';

export interface LedgerRecordDto {
  id: string;
  characterId: number;
  nickname: string;
  amount: number;
  balanceAfter: number;
  bizType: string;
  bizId: string | null;
  counterparty: number | null;
  counterpartyNickname: string | null;
  memo: string | null;
  createdAt: number;
}

export interface LedgerQueryResult {
  records: LedgerRecordDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LedgerExportResult {
  records: LedgerRecordDto[];
  total: number;
}

/**
 * 玩家查询自己的灵石流水。
 */
export const getMyLedger = (
  params?: { page?: number },
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: LedgerQueryResult; message?: string }> => {
  return api.get('/api/ledger/my', withRequestParams(requestConfig, { page: params?.page }));
};

/**
 * GM 查询玩家灵石流水。
 */
export const gmQueryLedger = (
  params?: {
    characterId?: number;
    nickname?: string;
    bizType?: string;
    page?: number;
  },
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: LedgerQueryResult; message?: string }> => {
  return api.get('/api/ledger/gm/query', withRequestParams(requestConfig, {
    characterId: params?.characterId,
    nickname: params?.nickname,
    bizType: params?.bizType,
    page: params?.page,
  }));
};

/**
 * GM 全量导出玩家灵石流水（无分页限制，上限 5000 条）。
 */
export const gmExportAllLedger = (
  params?: {
    characterId?: number;
    nickname?: string;
    bizType?: string;
  },
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; data: LedgerExportResult; message?: string }> => {
  return api.get('/api/ledger/gm/export-all', withRequestParams(requestConfig, {
    characterId: params?.characterId,
    nickname: params?.nickname,
    bizType: params?.bizType,
  }));
};

/**
 * 业务类型中文映射（与后端保持一致）。
 */
export const LEDGER_BIZ_TYPE_LABELS: Record<string, string> = {
  stock_buy: '股市买入',
  stock_sell: '股市卖出',
  stock_fee: '交易手续费',
  pending_create: '挂单创建',
  pending_fill: '挂单成交',
  pending_cancel: '挂单取消',
  shop_buy: '店铺购买',
  shop_upgrade: '店铺升级',
  shop_rent: '收取租金',
  player_transfer: '玩家转账',
  player_trade: '玩家交易',
  system_grant: '系统发放',
  system_deduct: '系统扣除',
  gm_compensation: 'GM维护补偿',
  gm_rebate: 'GM补涨',
  gm_grant_month_card: 'GM 发放月卡',
  gm_revoke_month_card: 'GM 回收月卡',
  month_card_daily: '月卡每日领取',
  scratch_prize: '刮刮乐奖金',
  other: '其他',
};
