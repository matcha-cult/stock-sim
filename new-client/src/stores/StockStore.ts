/**
 * 股市 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理股市概览、历史走势、交易记录、收益详情、排行榜、挂单的请求状态和响应数据。
 * 2. 不做什么：不做 UI 渲染、不直接操作表单状态。
 *
 * 输入 / 输出：
 * - 输入：刷新概览/历史/交易/收益的请求触发。
 * - 输出：overview、historyPoints、tradeRecords、profitDetail 等 observable 状态。
 *
 * 数据流 / 状态流：
 * 组件触发 refresh* -> API 请求 -> observable 更新 -> 组件通过 computed 读取 ViewModel。
 *
 * 复用设计说明：
 * - 替代旧 client 组件内的 useState + useCallback 请求流，用 MobX observable 驱动。
 * - 请求逻辑集中在本模块，组件层只做 UI 交互 + 调用 Store 方法。
 * - 被 RootStore 持有，所有需要股市数据的组件通过 RootStore 读取。
 * - 请求去重统一使用 RequestDedup，避免 StrictMode double-mount 和快速切 tab 重复请求。
 *
 * 关键边界条件与坑点：
 * 1. 选中股票不存在于新概览时需要自动回退到第一支。
 * 2. 后台刷新使用静默配置，不弹自动错误 toast。
 * 3. 历史请求需要在选中股票变化时触发，组件侧通过 effect 联动。
 * 4. dedup.enter() 必须在设置 loading 之前调用；dedup.complete() 必须在 finally 中调用。
 */

import { makeAutoObservable } from 'mobx';
import {
  buyStockMarketStock,
  clearStockMarketPosition,
  getStockMarketHistory,
  getStockMarketOverview,
  getStockMarketProfitDetail,
  getStockMarketTrades,
  sellStockMarketStock,
  type StockMarketHistoryPointDto,
  type StockMarketOverviewDto,
  type StockMarketProfitDetailDto,
  type StockMarketTradeRecordDto,
  type StockMarketTradeSide,
  createPendingOrder,
  cancelPendingOrder,
  getPendingOrders,
  type PendingOrderDto,
  type PendingOrderSide,
  type PendingOrderTriggerMode,
} from '../services/api/stockMarket';
import {
  getWealthRanks,
  getStockMarketRanks,
  type WealthRankDto,
  type StockMarketRankDto,
} from '../services/api/rank';
import { SILENT_API_REQUEST_CONFIG } from '../services/api/requestConfig';
import { RequestDedup } from './RequestDedup';

const DEFAULT_TRADE_PAGE_SIZE = 20;

export class StockStore {
  /** 请求去重实例（TTL 5s）。 */
  private readonly dedup = new RequestDedup(5_000);

  overview: StockMarketOverviewDto | null = null;
  selectedStockId: string = '';
  historyPoints: StockMarketHistoryPointDto[] = [];
  historyLoading: boolean = false;
  tradeRecords: StockMarketTradeRecordDto[] = [];
  tradeTotal: number = 0;
  tradePage: number = 1;
  tradePageSize: number = DEFAULT_TRADE_PAGE_SIZE;
  tradesLoading: boolean = false;
  profitDetail: StockMarketProfitDetailDto | null = null;
  profitLoading: boolean = false;
  loading: boolean = false;
  actionKey: string = '';
  newsIndex: number = 0;

  // 排行相关
  wealthRanks: WealthRankDto[] = [];
  stockMarketRanks: StockMarketRankDto[] = [];
  rankLoading: boolean = false;

  // 挂单相关
  pendingOrders: PendingOrderDto[] = [];
  pendingOrdersLoading: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  setSelectedStockId(id: string): void {
    this.selectedStockId = id;
  }

  async refreshOverview(background = false): Promise<void> {
    if (!this.dedup.enter('overview', background)) return;

    if (!background) this.loading = true;
    const promise = (async () => {
      try {
        const response = await getStockMarketOverview(
          background ? SILENT_API_REQUEST_CONFIG : undefined,
        );
        const nextOverview = response.data ?? null;
        this.overview = nextOverview;
        if (nextOverview) {
          const exists = nextOverview.stocks.some((s) => s.stockId === this.selectedStockId);
          this.selectedStockId = exists ? this.selectedStockId : nextOverview.stocks[0]?.stockId ?? '';
        }
      } catch {
        if (!background) {
          this.overview = null;
        }
      } finally {
        if (!background) this.loading = false;
        this.dedup.complete('overview');
      }
    })();
    this.dedup.start('overview', promise);
    return promise;
  }

  setSelectedStockIdWithFallback(id: string): void {
    if (!this.overview) {
      this.selectedStockId = id;
      return;
    }
    const exists = this.overview.stocks.some((s) => s.stockId === id);
    this.selectedStockId = exists ? id : this.overview.stocks[0]?.stockId ?? '';
  }

  async refreshHistory(stockId: string): Promise<void> {
    this.historyLoading = true;
    try {
      const response = await getStockMarketHistory(stockId, SILENT_API_REQUEST_CONFIG);
      this.historyPoints = response.data?.points ?? [];
    } catch {
      this.historyPoints = [];
    } finally {
      this.historyLoading = false;
    }
  }

  async refreshTrades(page: number, background = false): Promise<void> {
    const key = `trades:${page}`;
    if (!this.dedup.enter(key, background)) return;

    if (!background) this.tradesLoading = true;
    const promise = (async () => {
      try {
        const response = await getStockMarketTrades(
          { page },
          background ? SILENT_API_REQUEST_CONFIG : undefined,
        );
        const data = response.data;
        this.tradeRecords = data?.records ?? [];
        this.tradeTotal = data?.total ?? 0;
        this.tradePage = data?.page ?? page;
        this.tradePageSize = data?.pageSize ?? DEFAULT_TRADE_PAGE_SIZE;
      } catch {
        if (!background) {
          this.tradeRecords = [];
          this.tradeTotal = 0;
        }
      } finally {
        if (!background) this.tradesLoading = false;
        this.dedup.complete(key);
      }
    })();
    this.dedup.start(key, promise);
    return promise;
  }

  async refreshProfitDetail(background = false): Promise<void> {
    if (!this.dedup.enter('profit', background)) return;

    if (!background) this.profitLoading = true;
    const promise = (async () => {
      try {
        const response = await getStockMarketProfitDetail(
          background ? SILENT_API_REQUEST_CONFIG : undefined,
        );
        this.profitDetail = response.data ?? null;
      } catch {
        if (!background) {
          this.profitDetail = null;
        }
      } finally {
        if (!background) this.profitLoading = false;
        this.dedup.complete('profit');
      }
    })();
    this.dedup.start('profit', promise);
    return promise;
  }

  async refreshWealthRanks(background = false): Promise<void> {
    if (!this.dedup.enter('wealth', background)) return;

    if (!background) this.rankLoading = true;
    const promise = (async () => {
      try {
        const response = await getWealthRanks(50, background ? SILENT_API_REQUEST_CONFIG : undefined);
        this.wealthRanks = response.data ?? [];
      } catch {
        if (!background) {
          this.wealthRanks = [];
        }
      } finally {
        if (!background) this.rankLoading = false;
        this.dedup.complete('wealth');
      }
    })();
    this.dedup.start('wealth', promise);
    return promise;
  }

  async refreshStockMarketRanks(background = false): Promise<void> {
    if (!this.dedup.enter('stockMarketRanks', background)) return;

    if (!background) this.rankLoading = true;
    const promise = (async () => {
      try {
        const response = await getStockMarketRanks(
          'value',
          50,
          background ? SILENT_API_REQUEST_CONFIG : undefined,
        );
        this.stockMarketRanks = response.data ?? [];
      } catch {
        if (!background) {
          this.stockMarketRanks = [];
        }
      } finally {
        if (!background) this.rankLoading = false;
        this.dedup.complete('stockMarketRanks');
      }
    })();
    this.dedup.start('stockMarketRanks', promise);
    return promise;
  }

  async executeTrade(
    side: StockMarketTradeSide,
    stockId: string,
    quantity: number,
  ): Promise<{ success: boolean; message: string }> {
    this.actionKey = side;
    try {
      const response = side === 'buy'
        ? await buyStockMarketStock({ stockId, quantity })
        : await sellStockMarketStock({ stockId, quantity });
      if (response.success) {
        return { success: true, message: response.message ?? (side === 'buy' ? '买入成功' : '卖出成功') };
      }
      return { success: false, message: response.message ?? '交易失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '交易失败';
      return { success: false, message };
    } finally {
      this.actionKey = '';
    }
  }

  async executeClear(stockId?: string): Promise<{ success: boolean; message: string }> {
    this.actionKey = stockId ? 'clear-stock' : 'clear-all';
    try {
      const response = await clearStockMarketPosition({ stockId });
      if (response.success) {
        return { success: true, message: response.message ?? '清仓成功' };
      }
      return { success: false, message: response.message ?? '清仓失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '清仓失败';
      return { success: false, message };
    } finally {
      this.actionKey = '';
    }
  }

  reset(): void {
    this.overview = null;
    this.selectedStockId = '';
    this.historyPoints = [];
    this.historyLoading = false;
    this.tradeRecords = [];
    this.tradeTotal = 0;
    this.tradePage = 1;
    this.tradePageSize = DEFAULT_TRADE_PAGE_SIZE;
    this.tradesLoading = false;
    this.profitDetail = null;
    this.profitLoading = false;
    this.loading = false;
    this.actionKey = '';
    this.newsIndex = 0;
    this.wealthRanks = [];
    this.stockMarketRanks = [];
    this.rankLoading = false;
    this.pendingOrders = [];
    this.pendingOrdersLoading = false;
    this.dedup.reset();
  }

  // ---- 挂单操作 ----

  async refreshPendingOrders(): Promise<void> {
    if (!this.dedup.enter('pendingOrders')) return;

    this.pendingOrdersLoading = true;
    const promise = (async () => {
      try {
        const response = await getPendingOrders(SILENT_API_REQUEST_CONFIG);
        this.pendingOrders = response.data?.orders ?? [];
      } catch {
        this.pendingOrders = [];
      } finally {
        this.pendingOrdersLoading = false;
        this.dedup.complete('pendingOrders');
      }
    })();
    this.dedup.start('pendingOrders', promise);
    return promise;
  }

  async createPendingOrder(params: {
    stockId: string;
    side: PendingOrderSide;
    quantity: number;
    limitPrice: number;
    triggerMode?: PendingOrderTriggerMode;
  }): Promise<{ success: boolean; message: string; orderId?: number }> {
    try {
      const response = await createPendingOrder(params);
      if (response.success) {
        await this.refreshPendingOrders();
        return { success: true, message: response.message ?? '挂单创建成功', orderId: response.orderId };
      }
      return { success: false, message: response.message ?? '挂单创建失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '挂单创建失败';
      return { success: false, message };
    }
  }

  async cancelPendingOrder(orderId: number): Promise<{ success: boolean; message: string }> {
    try {
      const response = await cancelPendingOrder(orderId);
      if (response.success) {
        await this.refreshPendingOrders();
        return { success: true, message: response.message ?? '挂单已取消' };
      }
      return { success: false, message: response.message ?? '取消失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '取消失败';
      return { success: false, message };
    }
  }
}
