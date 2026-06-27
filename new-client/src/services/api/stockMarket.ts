/**
 * 股市接口封装。
 *
 * 集中定义股市概览、走势、交易记录、收益详情、买卖与清仓请求的 DTO 和 API 函数。
 */
import type { AxiosRequestConfig } from 'axios';
import api from './core';
import { SILENT_API_REQUEST_CONFIG, withRequestParams } from './requestConfig';

export { SILENT_API_REQUEST_CONFIG };

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
  limitUpPriceSpiritStones: number;
  limitDownPriceSpiritStones: number;
  limitStatus: 'up' | 'down' | 'none';
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
  limitUpPercent: number;
  limitDownPercent: number;
  limitEnabled: boolean;
}

export interface StockMarketOverviewDto {
  stocks: StockMarketStockDto[];
  latestNews: StockMarketNewsDto | null;
  newsRecords: StockMarketNewsDto[];
  portfolio: StockMarketPortfolioDto;
  tradeRules: StockMarketTradeRulesDto;
  nextRefreshAt: number;
}

/**
 * 历史走势单条 K 线数据（字段名使用单字母缩写以压缩报文体积）。
 * o=开盘, h=最高, l=最低, c=收盘, cb=涨跌幅bp, r=原因, t=时间戳秒。
 */
export interface StockMarketHistoryPointDto {
  o: number;
  h: number;
  l: number;
  c: number;
  cb: number;
  r: string;
  t: number;
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
export type StockMarketHistoryResponse = StockMarketApiResponse<{ stockId: string; points: StockMarketHistoryPointDto[] }>;
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

// ---- 新闻事件查看器 (DEV) ----

export interface NewsEventImpactDto {
  stockId: string;
  stockName: string;
  changeBps: number;
  direction: string;
  reason: string | null;
}

export interface NewsEventChainTickDto {
  tickId: string;
  tickHour: number;
  headline: string;
  summary: string;
  status: string;
  impacts: NewsEventImpactDto[];
}

export interface NewsEventDto {
  id: string;
  status: string;
  theme: string;
  headline: string;
  summary: string;
  stage: string;
  affectedStockIds: string[];
  startedTickId: string | null;
  lastTickId: string | null;
  continuationCount: number;
  lastContinuedAt: number | null;
}

export interface NewsEventChainDto {
  event: {
    id: string;
    status: string;
    theme: string;
    headline: string;
    summary: string;
    stage: string;
    affectedStockIds: string[];
    startedTickId: string | null;
    lastTickId: string | null;
  };
  ticks: NewsEventChainTickDto[];
}

export type NewsEventListResponse = { success: boolean; data: NewsEventDto[]; message?: string };
export type NewsEventChainResponse = { success: boolean; data: NewsEventChainDto | null; message?: string };

export const getNewsEventList = (
  requestConfig?: AxiosRequestConfig,
): Promise<NewsEventListResponse> => {
  return api.get('/api/stock-market/news-events', requestConfig);
};

export const getNewsEventChain = (
  eventId: string,
  requestConfig?: AxiosRequestConfig,
): Promise<NewsEventChainResponse> => {
  return api.get(`/api/stock-market/news-events/${eventId}/chain`, requestConfig);
};

// ---- 挂单 ----

export type PendingOrderSide = 'buy' | 'sell';
export type PendingOrderStatus = 'active' | 'filled' | 'cancelled' | 'expired';
export type PendingOrderTriggerMode = 'normal' | 'premium';

export interface PendingOrderDto {
  id: number;
  stockId: string;
  stockName: string;
  stockCode: string;
  side: PendingOrderSide;
  status: PendingOrderStatus;
  quantity: number;
  limitPriceSpiritStones: number;
  frozenSpiritStones: number;
  triggerMode: PendingOrderTriggerMode;
  createdAt: number;
}

interface CreatePendingOrderResponse {
  success: boolean;
  message?: string;
  orderId?: number;
}

interface PendingOrdersListResponse {
  success: boolean;
  data: { orders: PendingOrderDto[] };
}

export const createPendingOrder = (
  body: {
    stockId: string;
    side: PendingOrderSide;
    quantity: number;
    limitPrice: number;
    triggerMode?: PendingOrderTriggerMode;
  },
  requestConfig?: AxiosRequestConfig,
): Promise<CreatePendingOrderResponse> => {
  return api.post('/api/stock-market/pending-orders', body, requestConfig);
};

export const cancelPendingOrder = (
  orderId: number,
  requestConfig?: AxiosRequestConfig,
): Promise<CreatePendingOrderResponse> => {
  return api.delete(`/api/stock-market/pending-orders/${orderId}`, requestConfig);
};

export const getPendingOrders = (
  requestConfig?: AxiosRequestConfig,
): Promise<PendingOrdersListResponse> => {
  return api.get('/api/stock-market/pending-orders', requestConfig);
};

// ---- GM 股市查看器 ----

export interface GmPlayerHoldingSummaryDto {
  characterId: number;
  nickname: string;
  title: string | null;
  totalHoldingQty: number;
  totalMarketValueSpiritStones: number;
  totalCostSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  realizedPnlSpiritStones: number;
  totalPnlSpiritStones: number;
  stockCount: number;
}

export interface GmCharacterHoldingItemDto {
  stockId: string;
  code: string;
  name: string;
  sector: string;
  quantity: number;
  frozenQuantity: number;
  availableQty: number;
  costSpiritStones: number;
  currentPriceSpiritStones: number;
  marketValueSpiritStones: number;
  unrealizedPnlSpiritStones: number;
  unrealizedPnlPercent: number;
}

export interface GmCharacterHoldingDto {
  characterId: number;
  nickname: string;
  title: string | null;
  holdings: GmCharacterHoldingItemDto[];
  portfolio: {
    totalHoldingQty: number;
    totalCostSpiritStones: number;
    totalMarketValueSpiritStones: number;
    totalUnrealizedPnlSpiritStones: number;
  };
}

export type GmHoldingsListResponse = {
  success: boolean;
  message?: string;
  data: {
    records: GmPlayerHoldingSummaryDto[];
    total: number;
    page: number;
    pageSize: number;
  };
};

export type GmCharacterHoldingResponse = {
  success: boolean;
  message?: string;
  data: GmCharacterHoldingDto;
};

export type GmForceSellResponse = {
  success: boolean;
  message?: string;
  soldStockCount?: number;
  soldQuantity?: number;
  netAmountSpiritStones?: number;
};

export const gmGetHoldingsList = (
  params?: {
    page?: number;
    pageSize?: number;
    nickname?: string;
    characterId?: number;
  },
  requestConfig?: AxiosRequestConfig,
): Promise<GmHoldingsListResponse> => {
  return api.get('/api/stock-market/gm/holdings', withRequestParams(requestConfig, {
    page: params?.page,
    pageSize: params?.pageSize,
    nickname: params?.nickname,
    characterId: params?.characterId,
  }));
};

export const gmGetCharacterHoldings = (
  characterId: number,
  requestConfig?: AxiosRequestConfig,
): Promise<GmCharacterHoldingResponse> => {
  return api.get(`/api/stock-market/gm/holdings/${characterId}`, requestConfig);
};

export const gmForceSellStock = (
  characterId: number,
  body: { stockId: string; quantity?: number },
  requestConfig?: AxiosRequestConfig,
): Promise<GmForceSellResponse> => {
  return api.post(`/api/stock-market/gm/sell/${characterId}`, body, requestConfig);
};

// ---- GM 挂单管理 ----

export interface GmPendingOrderDto extends PendingOrderDto {
  characterId: number;
  nickname: string;
  title: string | null;
  currentPriceSpiritStones: number;
}

export type GmPendingOrderListResponse = {
  success: boolean;
  message?: string;
  data: {
    records: GmPendingOrderDto[];
    total: number;
    page: number;
  };
};

export const gmGetAllPendingOrders = (
  params?: {
    page?: number;
    pageSize?: number;
    nickname?: string;
    characterId?: number;
    stockId?: string;
    side?: PendingOrderSide;
  },
  requestConfig?: AxiosRequestConfig,
): Promise<GmPendingOrderListResponse> => {
  return api.get('/api/stock-market/gm/pending-orders', withRequestParams(requestConfig, {
    page: params?.page,
    pageSize: params?.pageSize,
    nickname: params?.nickname,
    characterId: params?.characterId,
    stockId: params?.stockId,
    side: params?.side,
  }));
};

export const gmCancelPendingOrder = (
  orderId: number,
  requestConfig?: AxiosRequestConfig,
): Promise<{ success: boolean; message?: string }> => {
  return api.delete(`/api/stock-market/gm/pending-orders/${orderId}`, requestConfig);
};
