/**
 * 股市视图类型定义。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义纯函数 DTO-to-ViewModel 转换的输出类型，供组件层读取。
 * 2. 不做什么：不包含 API DTO 定义（那是 services/api/stockMarket 的职责）。
 *
 * 输入 / 输出：
 * - 输入：无（仅类型声明）。
 * - 输出：组件层可直接消费的视图模型接口。
 *
 * 数据流 / 状态流：
 * API DTO -> viewTransform.ts 纯函数转换 -> 本文件定义的 View 类型 -> 组件渲染。
 *
 * 复用设计说明：
 * - 所有视图类型集中定义，避免组件文件中散落重复定义。
 * - 被 viewTransform.ts 和所有股市相关组件复用。
 *
 * 关键边界条件与坑点：
 * 1. 与 API DTO 保持命名区分：DTO 以 Dto 结尾，View 以 View/ViewModel 结尾。
 * 2. 所有展示文案字段以 Text 结尾，明确表示是已格式化的字符串。
 */

export type StockMarketTone = 'up' | 'down' | 'flat';

export interface StockMarketStockView {
  stockId: string;
  code: string;
  name: string;
  sector: string;
  description: string;
  selected: boolean;
  hasHolding: boolean;
  changeTone: StockMarketTone;
  priceText: string;
  changeText: string;
  limitStatus: 'up' | 'down' | 'none';
  limitStatusText: string;
  holdingQtyText: string;
  holdingMarketValueText: string;
  holdingSummaryText: string;
  unrealizedPnlText: string;
  unrealizedPnlPercentText: string;
  unrealizedPnlTone: StockMarketTone;
  maxSellQtyText: string;
}

export interface StockMarketPortfolioView {
  totalHoldingQtyText: string;
  totalCostText: string;
  totalMarketValueText: string;
  totalUnrealizedPnlText: string;
  totalUnrealizedPnlPercentText: string;
  totalUnrealizedPnlTone: StockMarketTone;
}

export interface StockMarketOverviewViewModel {
  stocks: StockMarketStockView[];
  selectedStock: StockMarketStockView | null;
  portfolio: StockMarketPortfolioView;
  nextRefreshText: string;
}

export interface StockMarketTradePreview {
  quantity: number;
  grossAmount: number;
  sellGrossAmount: number;
  commissionAmount: number;
  sellCommissionAmount: number;
  stampDutyAmount: number;
  transferFeeAmount: number;
  sellTransferFeeAmount: number;
  buyFeeAmount: number;
  sellFeeAmount: number;
  buyCost: number;
  sellReceive: number;
  maxAffordableBuyQty: number;
  maxSellQty: number;
  maxTradeQty: number;
  grossAmountText: string;
  sellGrossAmountText: string;
  commissionAmountText: string;
  sellCommissionAmountText: string;
  stampDutyAmountText: string;
  transferFeeAmountText: string;
  sellTransferFeeAmountText: string;
  buyFeeAmountText: string;
  sellFeeAmountText: string;
  buyCostText: string;
  sellReceiveText: string;
  maxAffordableBuyQtyText: string;
  maxSellQtyText: string;
}

export interface StockMarketCandlestickView {
  key: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  openPriceText: string;
  highPriceText: string;
  lowPriceText: string;
  closePriceText: string;
  changeText: string;
  tone: StockMarketTone;
  timeText: string;
  reasonText: string;
}

export interface StockMarketMovingAveragePointView {
  time: number;
  value: number;
}

export interface StockMarketMovingAverageView {
  key: 'ma5' | 'ma10' | 'ma30';
  labelText: string;
  valueText: string;
  data: StockMarketMovingAveragePointView[];
}

export interface StockMarketHistoryViewModel {
  candlesticks: StockMarketCandlestickView[];
  movingAverages: StockMarketMovingAverageView[];
}

export interface StockMarketTradeRecordView {
  id: number;
  sideText: string;
  sideTone: StockMarketTone;
  stockText: string;
  quantityText: string;
  unitPriceText: string;
  grossAmountText: string;
  feeText: string;
  netAmountText: string;
  realizedPnlText: string;
  realizedPnlTone: StockMarketTone;
  timeText: string;
}

export interface StockMarketProfitSummaryView {
  totalHoldingQtyText: string;
  totalMarketValueText: string;
  totalCostText: string;
  realizedPnlText: string;
  realizedPnlTone: StockMarketTone;
  unrealizedPnlText: string;
  unrealizedPnlTone: StockMarketTone;
  totalPnlText: string;
  totalPnlTone: StockMarketTone;
}

export interface StockMarketProfitDailyView {
  dayKey: string;
  dailyPnlText: string;
  dailyPnlTone: StockMarketTone;
  totalPnlText: string;
  totalPnlTone: StockMarketTone;
  realizedPnlText: string;
  realizedPnlTone: StockMarketTone;
  unrealizedPnlText: string;
  unrealizedPnlTone: StockMarketTone;
  totalMarketValueText: string;
  totalCostText: string;
}

export interface StockMarketProfitDetailViewModel {
  summary: StockMarketProfitSummaryView;
  dailyRows: StockMarketProfitDailyView[];
}

export type PendingOrderSide = 'buy' | 'sell';
export type PendingOrderStatus = 'active' | 'filled' | 'cancelled' | 'expired';
export type PendingOrderTriggerMode = 'normal' | 'premium';

export interface PendingOrderView {
  id: number;
  stockId: string;
  stockName: string;
  stockCode: string;
  side: PendingOrderSide;
  sideText: string;
  sideTone: StockMarketTone;
  status: PendingOrderStatus;
  statusText: string;
  quantity: number;
  quantityText: string;
  limitPriceSpiritStones: number;
  limitPriceText: string;
  triggerMode: PendingOrderTriggerMode;
  triggerModeText: string;
  createdAt: number;
  createdAtText: string;
}
