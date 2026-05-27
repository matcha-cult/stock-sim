/**
 * 股市接口封装。
 *
 * 集中定义股市概览、走势、交易记录、收益详情、买卖与清仓请求的 DTO 和 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';
import { withRequestParams } from './requestConfig';

export type StockMarketTradeSide = 'buy' | 'sell';

export interface StockMarketStockDto {
  stockId: string;
  code: string;
  name: string;
  shortName: string;
  sector: string;
  description: string;
  priceSpiritStones: number;
  lastChangeBps: number;
  updatedAt: number;
  holdingQty: number;
  holdingCostSpiritStones: number;
  holdingMarketValueSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  maxSellQty: number;
}

export interface StockMarketNewsImpactDto {
  stockId: string;
  stockName: string;
  direction: string;
  changeBps: number;
  reason: string | null;
}

export interface StockMarketNewsDto {
  tickId: number;
  tickHour: number;
  headline: string;
  summary: string;
  impacts: StockMarketNewsImpactDto[];
  createdAt: number;
}

export interface StockMarketPortfolioDto {
  totalHoldingQty: number;
  totalCostSpiritStones: number;
  totalMarketValueSpiritStones: number;
  totalUnrealizedPnlSpiritStones: number;
}

export interface StockMarketTradeRulesDto {
  feeRateDenominator: number;
  commissionRate: number;
  stampDutyRate: number;
  transferFeeRate: number;
  minPriceSpiritStones: number;
}

export interface StockMarketOverviewDto {
  stocks: StockMarketStockDto[];
  latestNews: StockMarketNewsDto | null;
  newsRecords: StockMarketNewsDto[];
  portfolio: StockMarketPortfolioDto;
  tradeRules: StockMarketTradeRulesDto;
  nextRefreshAt: number;
}

export interface StockMarketHistoryPointDto {
  stockId: string;
  priceSpiritStones: number;
  openPriceSpiritStones: number;
  highPriceSpiritStones: number;
  lowPriceSpiritStones: number;
  closePriceSpiritStones: number;
  changeBps: number;
  direction: string;
  reason: string | null;
  createdAt: number;
}

export interface StockMarketTradeRecordDto {
  id: number;
  stockId: string;
  stockName: string;
  stockCode: string;
  side: StockMarketTradeSide;
  quantity: number;
  unitPriceSpiritStones: number;
  grossAmountSpiritStones: number;
  feeSpiritStones: number;
  netAmountSpiritStones: number;
  realizedPnlSpiritStones: number | null;
  createdAt: number;
}

export interface StockMarketProfitSummaryDto {
  totalHoldingQty: number;
  totalMarketValueSpiritStones: number;
  totalCostSpiritStones: number;
  realizedPnlSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  totalPnlSpiritStones: number;
}

export interface StockMarketProfitDailyDto {
  dayKey: string;
  dailyPnlSpiritStones: number;
  totalPnlSpiritStones: number;
  realizedPnlSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  totalMarketValueSpiritStones: number;
  totalCostSpiritStones: number;
}

export interface StockMarketProfitDetailDto {
  summary: StockMarketProfitSummaryDto;
  daily: StockMarketProfitDailyDto[];
}

interface StockMarketApiResponse<TData> {
  success: boolean;
  message?: string;
  data?: TData;
}

export type StockMarketOverviewResponse = StockMarketApiResponse<StockMarketOverviewDto>;
export type StockMarketHistoryResponse = StockMarketApiResponse<{ points: StockMarketHistoryPointDto[] }>;
export type StockMarketTradesResponse = StockMarketApiResponse<{
  records: StockMarketTradeRecordDto[];
  total: number;
  page: number;
  pageSize: number;
}>;
export type StockMarketProfitDetailResponse = StockMarketApiResponse<StockMarketProfitDetailDto>;
export type StockMarketTradeResponse = StockMarketApiResponse<never>;

export const getStockMarketOverview = (
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketOverviewResponse> => {
  return api.get('/api/stock-market/overview', requestConfig);
};

export const getStockMarketHistory = (
  stockId: string,
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketHistoryResponse> => {
  return api.get('/api/stock-market/history', withRequestParams(requestConfig, { stockId }));
};

export const getStockMarketTrades = (
  params?: { page?: number },
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketTradesResponse> => {
  return api.get('/api/stock-market/trades', withRequestParams(requestConfig, { page: params?.page }));
};

export const getStockMarketProfitDetail = (
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketProfitDetailResponse> => {
  return api.get('/api/stock-market/profit-detail', requestConfig);
};

export const buyStockMarketStock = (
  body: { stockId: string; quantity: number },
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketTradeResponse> => {
  return api.post('/api/stock-market/buy', body, requestConfig);
};

export const sellStockMarketStock = (
  body: { stockId: string; quantity: number },
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketTradeResponse> => {
  return api.post('/api/stock-market/sell', body, requestConfig);
};

export const clearStockMarketPosition = (
  body: { stockId?: string },
  requestConfig?: AxiosRequestConfig,
): Promise<StockMarketTradeResponse> => {
  return api.post('/api/stock-market/clear', body, requestConfig);
};
