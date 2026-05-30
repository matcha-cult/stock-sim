/**
 * 股市主页面组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示股市概览、AI 新闻、选中股票走势、持仓摘要、买卖、清仓和交易记录、收益详情。
 * 2. 不做什么：不决定实际成交价与资金扣增（由后端决定），不手写 div+CSS 布局。
 *
 * 输入 / 输出：
 * - 输入：RootStore 的 authStore（灵石余额）和 stockStore（股市数据）。
 * - 输出：股市功能完整界面。
 *
 * 数据流 / 状态流：
 * 页面加载 -> stockStore.refreshOverview -> 选中股票变化 -> stockStore.refreshHistory -> 买卖/清仓 -> 后台刷新 overview + 角色灵石。
 *
 * 复用设计说明：
 * - 合并旧 client 的 StockMarketPanel + StockMarketModal 为单一组件，消除 ~1130 行重复代码。
 * - 所有布局使用 antd 组件（Layout, Row, Col, Card, List, Descriptions, Flex, Tabs, Drawer）。
 * - 纯函数视图转换来自 domain/stock-market/viewTransform.ts。
 * - 交易数量和可买/可卖快捷按钮集中在本组件，避免两处重复维护。
 *
 * 关键边界条件与坑点：
 * 1. 自动错误 toast 由 axios 拦截器负责，买卖 catch 不重复弹失败提示。
 * 2. 移动端使用 Drawer 展示股票详情，桌面端内联展示。
 * 3. 交易成功后必须同时刷新角色灵石（authStore.refreshCharacter 不在 StockStore 中，因为这是跨模块联动）。
 */

import { useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import {
  App, Button, Card, Col, Drawer, Dropdown, Empty, Flex, InputNumber,
  Layout, Pagination, Row, Segmented, Spin, Table, Tabs, Tag, Tooltip, type MenuProps,
  Descriptions,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined, FallOutlined, LeftOutlined, ReloadOutlined,
  RightOutlined, ShoppingCartOutlined, LineChartOutlined, CrownOutlined, ShopOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';
import { useIsMobile } from '../shared/responsive';
import type { StockMarketRankDto, WealthRankDto, ShopRentRankDto } from '../services/api/rank';
import { getShopRentRanks } from '../services/api/rank';
import type { StockMarketStockView, StockMarketTradePreview } from '../domain/stock-market/types';
import ShopPanel from './ShopPanel';
import {
  buildStockMarketOverviewViewModel,
  buildStockMarketTradePreview,
  buildStockMarketHistoryViewModel,
  buildStockMarketTradeRecordViews,
  buildStockMarketProfitDetailViewModel,
  formatStockMarketBps,
  getStockMarketToneClassName,
  resolveStockMarketTone,
  formatStockMarketTime,
} from '../domain/stock-market/viewTransform';
import StockCandlestick from './StockCandlestick';

const { Content } = Layout;

type RefreshMode = 'initial' | 'background';
type ActionKey = '' | 'buy' | 'buy-all' | 'sell' | 'clear-stock' | 'clear-all';
type ActiveTab = 'market' | 'profit' | 'records' | 'ranking' | 'shop';

const DEFAULT_TRADE_PAGE_SIZE = 20;

const StockMarketPage = observer(function StockMarketPage(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  const { authStore, stockStore } = rootStore;
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();

  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [localActionKey, setLocalActionKey] = useState<ActionKey>('');
  const [activeRankTab, setActiveRankTab] = useState<'wealth' | 'stockMarket' | 'shopRent'>('wealth');

  // 收租排行
  const [shopRentRanks, setShopRentRanks] = useState<ShopRentRankDto[]>([]);
  const fetchShopRentRanks = async (): Promise<void> => {
    try {
      const response = await getShopRentRanks(50);
      setShopRentRanks(response.data ?? []);
    } catch {
      setShopRentRanks([]);
    }
  };

  // 从 stockStore 读取数据并派生 ViewModel
  const overview = stockStore.overview;
  const selectedStockId = stockStore.selectedStockId;

  const overviewModel = useMemo(() => {
    return overview ? buildStockMarketOverviewViewModel(overview, selectedStockId) : null;
  }, [overview, selectedStockId]);

  // 从原始 overview 中获取选中股票的 DTO
  const selectedStockDto = useMemo(() => {
    if (!overview || !overviewModel?.selectedStock) return null;
    return overview.stocks.find((s) => s.stockId === overviewModel.selectedStock!.stockId) ?? null;
  }, [overview, overviewModel]);

  const selectedStockView = overviewModel?.selectedStock ?? null;

  const spiritStones = authStore.spiritStones;

  const tradePreview = useMemo(() => {
    if (!selectedStockDto || !overview) return null;
    return buildStockMarketTradePreview(selectedStockDto, quantity, overview.tradeRules, spiritStones);
  }, [overview, quantity, selectedStockDto, spiritStones]);

  const historyModel = useMemo(() =>
    buildStockMarketHistoryViewModel(stockStore.selectedStockId, stockStore.historyPoints),
    [stockStore.selectedStockId, stockStore.historyPoints],
  );

  const tradeRecordViews = useMemo(() =>
    buildStockMarketTradeRecordViews(stockStore.tradeRecords),
    [stockStore.tradeRecords],
  );

  const profitDetailModel = useMemo(() =>
    stockStore.profitDetail ? buildStockMarketProfitDetailViewModel(stockStore.profitDetail) : null,
    [stockStore.profitDetail],
  );

  const newsRecords = overview?.newsRecords ?? [];
  const newsIndex = stockStore.newsIndex;
  const activeNews = newsRecords[newsIndex] ?? null;

  // 新闻 tick 变化时重置索引
  useEffect(() => {
    stockStore.newsIndex = 0;
  }, [overview?.latestNews?.tickId]);

  // 新闻数量变化时修正索引范围
  useEffect(() => {
    stockStore.newsIndex = Math.min(stockStore.newsIndex, Math.max(0, newsRecords.length - 1));
  }, [newsRecords.length]);

  const handleShowNewerNews = useCallback(() => {
    stockStore.newsIndex = Math.max(0, stockStore.newsIndex - 1);
  }, [stockStore]);

  const handleShowOlderNews = useCallback(() => {
    stockStore.newsIndex = Math.min(Math.max(0, newsRecords.length - 1), stockStore.newsIndex + 1);
  }, [newsRecords.length, stockStore]);

  // 选中股票变化时拉取历史
  useEffect(() => {
    if (!selectedStockId) {
      stockStore.historyPoints = [];
      return;
    }
    void stockStore.refreshHistory(selectedStockId);
  }, [selectedStockId]);

  // 切换到交易记录 tab 时拉取
  useEffect(() => {
    if (activeTab !== 'records') return;
    void stockStore.refreshTrades(stockStore.tradePage);
  }, [activeTab, stockStore]);

  // 切换到收益 tab 时拉取
  useEffect(() => {
    if (activeTab !== 'profit' || stockStore.profitDetail) return;
    void stockStore.refreshProfitDetail();
  }, [activeTab, stockStore.profitDetail, stockStore]);

  // 切换到排行 tab 时拉取
  useEffect(() => {
    if (activeTab !== 'ranking') return;
    if (stockStore.wealthRanks.length > 0 && stockStore.stockMarketRanks.length > 0) return;
    void stockStore.refreshWealthRanks();
    void stockStore.refreshStockMarketRanks();
  }, [activeTab, stockStore]);

  // 排行维度切换时重新拉取
  useEffect(() => {
    if (activeTab !== 'ranking') return;
    void stockStore.refreshStockMarketRanks();
  }, [activeTab, stockStore]);

  // 移动端关闭详情
  useEffect(() => {
    if (!isMobile) {
      setMobileDetailOpen(false);
    }
  }, [isMobile]);

  // 初始化加载
  useEffect(() => {
    void stockStore.refreshOverview();
  }, [stockStore]);

  const handleQuantityChange = useCallback((value: number | null) => {
    setQuantity(value === null ? 1 : Math.max(1, Math.trunc(value)));
  }, []);

  const handleUseTradeLimitQuantity = useCallback((nextQuantity: number) => {
    if (nextQuantity <= 0) return;
    setQuantity(nextQuantity);
  }, []);

  // 当 tradePreview 变化时，修正数量在可交易范围内
  useEffect(() => {
    if (!tradePreview) return;
    setQuantity((current) => {
      const normalized = Math.max(1, Math.trunc(current));
      return normalized > tradePreview.maxTradeQty ? tradePreview.maxTradeQty : normalized;
    });
  }, [tradePreview]);

  const handleSelectStock = useCallback((stockId: string) => {
    stockStore.setSelectedStockIdWithFallback(stockId);
    if (isMobile) {
      setMobileDetailOpen(true);
    }
  }, [isMobile, stockStore]);

  // 后台刷新联动
  const refreshAfterTrade = useCallback(async () => {
    await stockStore.refreshOverview(true);
    await authStore.refreshCharacter();
    if (activeTab === 'records') {
      await stockStore.refreshTrades(stockStore.tradePage, true);
    }
    if (activeTab === 'profit') {
      await stockStore.refreshProfitDetail(true);
    }
  }, [activeTab, authStore, stockStore]);

  const handleTrade = useCallback(async (
    side: 'buy' | 'sell',
    overrideQuantity?: number,
    nextActionKey: ActionKey = side,
  ) => {
    if (!selectedStockDto || !tradePreview) return;

    const tradeQuantity = Math.max(0, Math.trunc(overrideQuantity ?? tradePreview.quantity));
    if (tradeQuantity <= 0) return;
    if (side === 'buy' && tradeQuantity > tradePreview.maxAffordableBuyQty) return;
    if (side === 'sell' && tradeQuantity > tradePreview.maxSellQty) return;

    setLocalActionKey(nextActionKey);
    try {
      const result = await stockStore.executeTrade(side, selectedStockDto.stockId, tradeQuantity);
      if (result.success) {
        message.success(result.message);
        await refreshAfterTrade();
      } else {
        message.error(result.message);
      }
    } finally {
      setLocalActionKey('');
    }
  }, [selectedStockDto, tradePreview, stockStore, message, refreshAfterTrade]);

  const handleClearPosition = useCallback((scope: 'stock' | 'all') => {
    if (scope === 'stock' && (!selectedStockDto || !tradePreview || tradePreview.maxSellQty <= 0)) return;
    if (scope === 'all' && (!overview || overview.portfolio.totalHoldingQty <= 0)) return;

    const actionKey: ActionKey = scope === 'stock' ? 'clear-stock' : 'clear-all';
    const title = scope === 'stock' && selectedStockDto
      ? `确认清仓 ${selectedStockDto.name}？`
      : '确认全部清仓？';
    const content = scope === 'stock' && selectedStockDto
      ? `将按当前价卖出该股票全部 ${selectedStockDto.maxSellQty} 股。`
      : `将按当前价卖出全部持仓 ${overview?.portfolio.totalHoldingQty ?? 0} 股。`;

    modal.confirm({
      title,
      content,
      okText: '清仓',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLocalActionKey(actionKey);
        try {
          const result = await stockStore.executeClear(
            scope === 'stock' && selectedStockDto ? selectedStockDto.stockId : undefined,
          );
          if (result.success) {
            message.success(result.message);
            await refreshAfterTrade();
          } else {
            message.error(result.message);
          }
        } finally {
          setLocalActionKey('');
        }
      },
    });
  }, [overview, selectedStockDto, tradePreview, stockStore, modal, message, refreshAfterTrade]);

  const handleTabChange = useCallback((key: string) => {
    if (key === 'market' || key === 'profit' || key === 'records' || key === 'ranking' || key === 'shop') {
      setActiveTab(key);
    }
  }, []);

  // 交易按钮可用性判断
  const maxTradeQty = tradePreview?.maxTradeQty ?? 1;
  const canBuy = Boolean(
    selectedStockDto && tradePreview && tradePreview.quantity > 0 && tradePreview.quantity <= tradePreview.maxAffordableBuyQty,
  );
  const maxAffordableBuyQty = tradePreview?.maxAffordableBuyQty ?? 0;
  const canBuyAll = Boolean(selectedStockDto && maxAffordableBuyQty > 0);
  const canSell = Boolean(
    selectedStockDto && tradePreview && tradePreview.quantity > 0 && tradePreview.quantity <= tradePreview.maxSellQty,
  );
  const canClearSelected = Boolean(selectedStockDto && tradePreview && tradePreview.maxSellQty > 0);
  const canClearAll = Boolean(overview && overview.portfolio.totalHoldingQty > 0);

  // 买入下拉菜单
  const buyActionMenuItems = useMemo<NonNullable<MenuProps['items']>>(() => [
    {
      key: 'buy-all',
      label: '梭哈',
      icon: <ShoppingCartOutlined />,
      disabled: !canBuyAll || localActionKey !== '',
    },
  ], [canBuyAll, localActionKey]);

  const handleBuyAll = useCallback(() => {
    if (!selectedStockDto || !tradePreview || maxAffordableBuyQty <= 0) return;
    modal.confirm({
      title: `确认全部买入 ${selectedStockDto.name}？`,
      content: `将按当前价买入该股票可买上限 ${tradePreview.maxAffordableBuyQtyText}。`,
      okText: '全部买入',
      cancelText: '取消',
      onOk: async () => {
        await handleTrade('buy', maxAffordableBuyQty, 'buy-all');
      },
    });
  }, [selectedStockDto, tradePreview, maxAffordableBuyQty, modal, handleTrade]);

  const handleBuyActionMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(({ key }) => {
    if (key === 'buy-all') handleBuyAll();
  }, [handleBuyAll]);

  // 卖出来菜单
  const sellActionMenuItems = useMemo<NonNullable<MenuProps['items']>>(() => [
    {
      key: 'clear-stock',
      label: '清仓',
      icon: <ClearOutlined />,
      disabled: !canClearSelected || localActionKey === 'clear-stock',
    },
  ], [canClearSelected, localActionKey]);

  const handleSellActionMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(({ key }) => {
    if (key === 'clear-stock') handleClearPosition('stock');
  }, [handleClearPosition]);

  const isLoading = stockStore.loading && !overviewModel;
  const isEmpty = !stockStore.loading && !overviewModel;

  // ---- 渲染 ----

  if (isLoading) {
    return (
      <Flex data-section="stock-market-loading" justify="center" align="center" style={{ minHeight: '60vh' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (isEmpty) {
    return (
      <Flex data-section="stock-market-empty" justify="center" align="center" style={{ minHeight: '60vh' }}>
        <Empty description="暂无股市数据" />
      </Flex>
    );
  }

  if (!overview || !overviewModel) return null;

  return (
    <Layout data-section="stock-market-page" style={{ padding: '16px 24px', background: 'transparent' }}>
      <Content>
        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          destroyInactiveTabPane
          items={[
            {
              key: 'market',
              label: '股市行情',
              children: (
                <MarketTabContent
                  overview={overview}
                  overviewModel={overviewModel}
                  selectedStock={selectedStockDto}
                  selectedStockView={selectedStockView}
                  tradePreview={tradePreview}
                  historyModel={historyModel}
                  historyLoading={stockStore.historyLoading}
                  activeNews={activeNews}
                  newsRecords={newsRecords}
                  newsIndex={newsIndex}
                  quantity={quantity}
                  maxTradeQty={maxTradeQty}
                  canBuy={canBuy}
                  canBuyAll={canBuyAll}
                  canSell={canSell}
                  canClearSelected={canClearSelected}
                  canClearAll={canClearAll}
                  maxAffordableBuyQty={maxAffordableBuyQty}
                  localActionKey={localActionKey}
                  isMobile={isMobile}
                  mobileDetailOpen={mobileDetailOpen}
                  onRefresh={() => void stockStore.refreshOverview()}
                  refreshLoading={stockStore.loading}
                  onSelectStock={handleSelectStock}
                  onQuantityChange={handleQuantityChange}
                  onUseLimitQuantity={handleUseTradeLimitQuantity}
                  onBuy={() => void handleTrade('buy')}
                  onBuyAll={handleBuyAll}
                  onSell={() => void handleTrade('sell')}
                  onClearStock={() => handleClearPosition('stock')}
                  onClearAll={() => handleClearPosition('all')}
                  onBuyMenuClick={handleBuyActionMenuClick}
                  onSellMenuClick={handleSellActionMenuClick}
                  onShowNewerNews={handleShowNewerNews}
                  onShowOlderNews={handleShowOlderNews}
                  buyActionMenuItems={buyActionMenuItems}
                  sellActionMenuItems={sellActionMenuItems}
                  onMobileDetailClose={() => {
                    setMobileDetailOpen(false);
                    stockStore.selectedStockId = '';
                  }}
                />
              ),
            },
            {
              key: 'profit',
              label: '股市收益',
              children: (
                <ProfitTab
                  profitModel={profitDetailModel}
                  profitLoading={stockStore.profitLoading}
                  onRefresh={() => void stockStore.refreshProfitDetail()}
                />
              ),
            },
            {
              key: 'records',
              label: '股市记录',
              children: (
                <RecordsTab
                  tradeRecordViews={tradeRecordViews}
                  tradesLoading={stockStore.tradesLoading}
                  tradePage={stockStore.tradePage}
                  tradePageSize={stockStore.tradePageSize}
                  tradeTotal={stockStore.tradeTotal}
                  onRefresh={() => void stockStore.refreshTrades(stockStore.tradePage)}
                  onPageChange={(page) => { stockStore.tradePage = page; }}
                />
              ),
            },
            {
              key: 'shop',
              label: '店铺',
              children: <ShopPanel />,
            },
            {
              key: 'ranking',
              label: '排行',
              children: (
                <RankingTab
                  wealthRanks={stockStore.wealthRanks}
                  stockMarketRanks={stockStore.stockMarketRanks}
                  shopRentRanks={shopRentRanks}
                  rankLoading={stockStore.rankLoading}
                  onRefreshWealth={() => void stockStore.refreshWealthRanks()}
                  onRefreshStockMarket={() => void stockStore.refreshStockMarketRanks()}
                  onRefreshShopRent={fetchShopRentRanks}
                  onTabChange={(tab) => {
                    setActiveRankTab(tab);
                  }}
                  activeRankTab={activeRankTab}
                />
              ),
            },
          ]}
        />
      </Content>

      {/* 移动端股票详情 Drawer */}
      {isMobile && (
        <Drawer
          placement="bottom"
          open={mobileDetailOpen && Boolean(selectedStockView)}
          onClose={() => {
            setMobileDetailOpen(false);
            stockStore.selectedStockId = '';
          }}
          height="72dvh"
          title={selectedStockDto ? selectedStockDto.name : '股票详情'}
          className="stock-market-detail-drawer"
          styles={{ body: { padding: '10px 12px 12px' } }}
          data-component="mobile-stock-drawer"
        >
          <StockDetailContent
            selectedStock={selectedStockDto}
            selectedStockView={selectedStockView}
            tradePreview={tradePreview}
            historyModel={historyModel}
            historyLoading={stockStore.historyLoading}
            quantity={quantity}
            maxTradeQty={maxTradeQty}
            canBuy={canBuy}
            canBuyAll={canBuyAll}
            canSell={canSell}
            canClearSelected={canClearSelected}
            maxAffordableBuyQty={maxAffordableBuyQty}
            localActionKey={localActionKey}
            onQuantityChange={handleQuantityChange}
            onUseLimitQuantity={handleUseTradeLimitQuantity}
            onBuy={() => void handleTrade('buy')}
            onBuyAll={handleBuyAll}
            onSell={() => void handleTrade('sell')}
            onClearStock={() => handleClearPosition('stock')}
            onBuyMenuClick={handleBuyActionMenuClick}
            onSellMenuClick={handleSellActionMenuClick}
            buyActionMenuItems={buyActionMenuItems}
            sellActionMenuItems={sellActionMenuItems}
          />
        </Drawer>
      )}
    </Layout>
  );
});

// ---- 子渲染块 ----

interface MarketTabContentProps {
  overview: import('../services/api/stockMarket').StockMarketOverviewDto;
  overviewModel: import('../domain/stock-market/types').StockMarketOverviewViewModel;
  selectedStock: import('../services/api/stockMarket').StockMarketStockDto | null;
  selectedStockView: import('../domain/stock-market/types').StockMarketStockView | null;
  tradePreview: StockMarketTradePreview | null;
  historyModel: import('../domain/stock-market/types').StockMarketHistoryViewModel;
  historyLoading: boolean;
  activeNews: import('../services/api/stockMarket').StockMarketNewsDto | null;
  newsRecords: import('../services/api/stockMarket').StockMarketNewsDto[];
  newsIndex: number;
  quantity: number;
  maxTradeQty: number;
  canBuy: boolean;
  canBuyAll: boolean;
  canSell: boolean;
  canClearSelected: boolean;
  canClearAll: boolean;
  maxAffordableBuyQty: number;
  localActionKey: ActionKey;
  isMobile: boolean;
  mobileDetailOpen: boolean;
  onRefresh: () => void;
  refreshLoading: boolean;
  onSelectStock: (stockId: string) => void;
  onQuantityChange: (v: number | null) => void;
  onUseLimitQuantity: (n: number) => void;
  onBuy: () => void;
  onBuyAll: () => void;
  onSell: () => void;
  onClearStock: () => void;
  onClearAll: () => void;
  onBuyMenuClick: NonNullable<MenuProps['onClick']>;
  onSellMenuClick: NonNullable<MenuProps['onClick']>;
  onShowNewerNews: () => void;
  onShowOlderNews: () => void;
  buyActionMenuItems: NonNullable<MenuProps['items']>;
  sellActionMenuItems: NonNullable<MenuProps['items']>;
  onMobileDetailClose: () => void;
}

function MarketTabContent(props: MarketTabContentProps): React.ReactNode {
  const {
    overviewModel, activeNews, newsRecords, newsIndex,
    isMobile, selectedStockView, selectedStock, tradePreview,
    historyModel, historyLoading, quantity, maxTradeQty,
    canBuy, canBuyAll, canSell, canClearSelected, canClearAll,
    maxAffordableBuyQty, localActionKey,
    onRefresh, refreshLoading, onSelectStock, onQuantityChange,
    onUseLimitQuantity, onBuy, onBuyAll, onSell, onClearStock, onClearAll,
    onBuyMenuClick, onSellMenuClick, onShowNewerNews, onShowOlderNews,
    buyActionMenuItems, sellActionMenuItems,
  } = props;

  return (
    <Flex vertical gap={16} data-section="market-tab">
      {/* 新闻 + 持仓汇总 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <NewsCard
            news={activeNews}
            newsRecords={newsRecords}
            newsIndex={newsIndex}
            nextRefreshText={overviewModel.nextRefreshText}
            onShowNewerNews={onShowNewerNews}
            onShowOlderNews={onShowOlderNews}
          />
        </Col>
        <Col xs={24} lg={12}>
          <PortfolioSummaryCard
            portfolio={overviewModel.portfolio}
            canClearAll={canClearAll}
            localActionKey={localActionKey}
            onClearAll={onClearAll}
          />
        </Col>
      </Row>

      {/* 股票列表 + 交易详情（PC 左右布局，移动端上下堆叠） */}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <StockListSection
            stocks={overviewModel.stocks}
            onSelectStock={onSelectStock}
            onRefresh={onRefresh}
            refreshLoading={refreshLoading}
          />
        </Col>
        <Col xs={24} xl={16}>
          {isMobile ? null : (
            <StockDetailContent
              selectedStock={selectedStock}
              selectedStockView={selectedStockView}
              tradePreview={tradePreview}
              historyModel={historyModel}
              historyLoading={historyLoading}
              quantity={quantity}
              maxTradeQty={maxTradeQty}
              canBuy={canBuy}
              canBuyAll={canBuyAll}
              canSell={canSell}
              canClearSelected={canClearSelected}
              maxAffordableBuyQty={maxAffordableBuyQty}
              localActionKey={localActionKey}
              onQuantityChange={onQuantityChange}
              onUseLimitQuantity={onUseLimitQuantity}
              onBuy={onBuy}
              onBuyAll={onBuyAll}
              onSell={onSell}
              onClearStock={onClearStock}
              onBuyMenuClick={onBuyMenuClick}
              onSellMenuClick={onSellMenuClick}
              buyActionMenuItems={buyActionMenuItems}
              sellActionMenuItems={sellActionMenuItems}
            />
          )}
        </Col>
      </Row>
    </Flex>
  );
}

// ---- 新闻卡片 ----

interface NewsCardProps {
  news: import('../services/api/stockMarket').StockMarketNewsDto | null;
  newsRecords: import('../services/api/stockMarket').StockMarketNewsDto[];
  newsIndex: number;
  nextRefreshText: string;
  onShowNewerNews: () => void;
  onShowOlderNews: () => void;
}

function NewsCard({ news, newsRecords, newsIndex, nextRefreshText, onShowNewerNews, onShowOlderNews }: NewsCardProps): React.ReactNode {
  return (
    <Card
      id="news-card"
      data-section="stock-market-news"
      size="small"
      style={{ height: '100%' }}
      title="股市新闻"
      extra={
        <Flex gap={8} align="center">
          {newsRecords.length > 0 && (
            <>
              <Tag data-element="news-counter">{newsIndex + 1}/{newsRecords.length}</Tag>
              <Tooltip title="查看更新的新闻">
                <Button
                  size="small"
                  icon={<LeftOutlined />}
                  disabled={newsIndex <= 0}
                  onClick={onShowNewerNews}
                  aria-label="查看更新的股市新闻"
                />
              </Tooltip>
              <Tooltip title="查看更早的新闻">
                <Button
                  size="small"
                  icon={<RightOutlined />}
                  disabled={newsIndex >= newsRecords.length - 1}
                  onClick={onShowOlderNews}
                  aria-label="查看更早的股市新闻"
                />
              </Tooltip>
            </>
          )}
          <Tag color="processing">下次 {nextRefreshText}</Tag>
        </Flex>
      }
    >
      {news ? (
        <Flex className="stock-market-news-content" data-element="news-content">
          {/* 左侧/上方：新闻标题与摘要 */}
          <Flex vertical gap={8} className="stock-market-news-body">
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{news.headline}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              {formatStockMarketTime(news.tickHour)}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{news.summary}</div>
          </Flex>
          {/* 右侧/下方：影响股票列表 */}
          {news.impacts.length > 0 && (
            <Flex vertical gap={4} className="stock-market-news-impacts" data-element="news-impacts">
              {news.impacts.map((impact) => {
                const tone = resolveStockMarketTone(impact.changeBps);
                return (
                  <Flex key={impact.stockId} justify="space-between" data-element="impact-item" className={getStockMarketToneClassName(tone)}>
                    <span style={{ color: 'var(--text-primary)' }}>{impact.stockName}</span>
                    <span style={{ fontWeight: 500 }} className={getStockMarketToneClassName(tone)}>
                      {formatStockMarketBps(impact.changeBps)}
                    </span>
                  </Flex>
                );
              })}
            </Flex>
          )}
        </Flex>
      ) : (
        <div style={{ color: 'var(--text-tertiary)' }}>暂未生成新闻，等待下一次后台刷新</div>
      )}
    </Card>
  );
}

// ---- 持仓汇总卡片 ----

interface PortfolioSummaryCardProps {
  portfolio: import('../domain/stock-market/types').StockMarketPortfolioView;
  canClearAll: boolean;
  localActionKey: ActionKey;
  onClearAll: () => void;
}

function PortfolioSummaryCard({ portfolio, canClearAll, localActionKey, onClearAll }: PortfolioSummaryCardProps): React.ReactNode {
  return (
    <Card
      id="portfolio-card"
      data-section="stock-market-portfolio"
      size="small"
      style={{ height: '100%' }}
      title="持仓汇总"
      extra={
        <Button
          danger
          size="small"
          icon={<ClearOutlined />}
          disabled={!canClearAll}
          loading={localActionKey === 'clear-all'}
          onClick={onClearAll}
          data-action="clear-all"
        >
          全部清仓
        </Button>
      }
    >
      <Row gutter={[12, 8]}>
        <Col span={6}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>总股数</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{portfolio.totalHoldingQtyText}</div>
          </div>
        </Col>
        <Col span={6}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>市值</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{portfolio.totalMarketValueText}</div>
          </div>
        </Col>
        <Col span={6}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>成本</div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{portfolio.totalCostText}</div>
          </div>
        </Col>
        <Col span={6}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              浮盈亏 <em className={getStockMarketToneClassName(portfolio.totalUnrealizedPnlTone)}>{portfolio.totalUnrealizedPnlPercentText}</em>
            </div>
            <div style={{ fontWeight: 600 }} className={getStockMarketToneClassName(portfolio.totalUnrealizedPnlTone)}>
              {portfolio.totalUnrealizedPnlText}
            </div>
          </div>
        </Col>
      </Row>
    </Card>
  );
}

// ---- 股票列表 ----

interface StockListSectionProps {
  stocks: import('../domain/stock-market/types').StockMarketStockView[];
  onSelectStock: (stockId: string) => void;
  onRefresh: () => void;
  refreshLoading: boolean;
}

function StockListSection({ stocks, onSelectStock, onRefresh, refreshLoading }: StockListSectionProps): React.ReactNode {
  return (
    <Card
      id="stock-list-card"
      data-section="stock-market-list"
      size="small"
      title="股票列表"
      extra={
        <Flex gap={8} align="center">
          <Tag>共 {stocks.length} 支</Tag>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={refreshLoading}
            data-action="refresh-market"
          >
            刷新
          </Button>
        </Flex>
      }
      bodyStyle={{ padding: '8px' }}
    >
      <Flex vertical gap={4} data-element="stock-list">
        {stocks.map((item) => (
          <StockListItem key={item.stockId} stockView={item} onClick={() => onSelectStock(item.stockId)} />
        ))}
      </Flex>
    </Card>
  );
}

interface StockListItemProps {
  stockView: StockMarketStockView;
  onClick: () => void;
}

function StockListItem({ stockView, onClick }: StockListItemProps): React.ReactNode {
  return (
    <Button
      type="text"
      block
      data-element="stock-item"
      data-selected={stockView.selected}
      data-holding={stockView.hasHolding}
      style={{ textAlign: 'left', height: 'auto', padding: '8px 12px' }}
      onClick={onClick}
    >
      <Flex vertical gap={4} style={{ width: '100%' }}>
        {/* 主行：左侧名称+代码行业，右侧价格+涨跌 */}
        <Flex justify="space-between" align="flex-start" style={{ minWidth: 0 }}>
          <Flex vertical style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{stockView.name}</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              {stockView.code} · {stockView.sector}
            </span>
          </Flex>
          <Flex vertical align="flex-end" style={{ flexShrink: 0 }}>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{stockView.priceText}</span>
            <span className={getStockMarketToneClassName(stockView.changeTone)} style={{ fontSize: 12 }}>
              {stockView.changeText}
            </span>
          </Flex>
        </Flex>
        {/* 持仓信息行 */}
        {stockView.hasHolding && (
          <Flex justify="space-between" align="center">
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {stockView.holdingSummaryText}
            </span>
            <Flex gap={8} align="center">
              <span className={getStockMarketToneClassName(stockView.unrealizedPnlTone)} style={{ fontSize: 12 }}>
                {stockView.unrealizedPnlText}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {stockView.unrealizedPnlPercentText}
              </span>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Button>
  );
}

// ---- 交易详情 ----

interface StockDetailContentProps {
  selectedStock: import('../services/api/stockMarket').StockMarketStockDto | null;
  selectedStockView: import('../domain/stock-market/types').StockMarketStockView | null;
  tradePreview: StockMarketTradePreview | null;
  historyModel: import('../domain/stock-market/types').StockMarketHistoryViewModel;
  historyLoading: boolean;
  quantity: number;
  maxTradeQty: number;
  canBuy: boolean;
  canBuyAll: boolean;
  canSell: boolean;
  canClearSelected: boolean;
  maxAffordableBuyQty: number;
  localActionKey: ActionKey;
  onQuantityChange: (v: number | null) => void;
  onUseLimitQuantity: (n: number) => void;
  onBuy: () => void;
  onBuyAll: () => void;
  onSell: () => void;
  onClearStock: () => void;
  onBuyMenuClick: NonNullable<MenuProps['onClick']>;
  onSellMenuClick: NonNullable<MenuProps['onClick']>;
  buyActionMenuItems: NonNullable<MenuProps['items']>;
  sellActionMenuItems: NonNullable<MenuProps['items']>;
}

function StockDetailContent({
  selectedStock, selectedStockView, tradePreview,
  historyModel, historyLoading, quantity, maxTradeQty,
  canBuy, canBuyAll, canSell, canClearSelected,
  maxAffordableBuyQty, localActionKey,
  onQuantityChange, onUseLimitQuantity,
  onBuy, onBuyAll, onSell, onClearStock,
  onBuyMenuClick, onSellMenuClick,
  buyActionMenuItems, sellActionMenuItems,
}: StockDetailContentProps): React.ReactNode {
  if (!selectedStock || !selectedStockView || !tradePreview) {
    return (
      <Flex data-section="stock-detail-empty" justify="center" style={{ padding: 24 }}>
        <Empty description="请选择股票" />
      </Flex>
    );
  }

  return (
    <Card id="stock-detail-card" data-section="stock-market-detail" size="small">
      <Flex vertical gap={16}>
        {/* 股票信息头部 */}
        <Flex justify="space-between" align="center" data-element="stock-detail-header">
          <div>
            <Flex gap={8} align="center">
              <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{selectedStock.name}</span>
              <Tag>{selectedStock.code}</Tag>
            </Flex>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginTop: 2 }}>{selectedStock.description}</div>
          </div>
          {/* <Flex align="center" gap={8}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{selectedStockView.priceText}</span>
            <span className={getStockMarketToneClassName(selectedStockView.changeTone)} style={{ fontWeight: 500 }}>
              {selectedStockView.changeText}
            </span>
          </Flex> */}
        </Flex>

        {/* 交易操作区（Card 容器，响应亮暗色） */}
        <Card size="small" data-element="trade-card">
          <TradeBox
            tradePreview={tradePreview}
            quantity={quantity}
            maxTradeQty={maxTradeQty}
            canBuy={canBuy}
            canBuyAll={canBuyAll}
            canSell={canSell}
            canClearSelected={canClearSelected}
            maxAffordableBuyQty={maxAffordableBuyQty}
            localActionKey={localActionKey}
            onQuantityChange={onQuantityChange}
            onUseLimitQuantity={onUseLimitQuantity}
            onBuy={onBuy}
            onBuyAll={onBuyAll}
            onSell={onSell}
            onClearStock={onClearStock}
            onBuyMenuClick={onBuyMenuClick}
            onSellMenuClick={onSellMenuClick}
            buyActionMenuItems={buyActionMenuItems}
            sellActionMenuItems={sellActionMenuItems}
          />
        </Card>

        {/* K 线图 */}
        <StockCandlestick
          model={historyModel}
          loading={historyLoading}
          latestPriceText={selectedStockView.priceText}
          latestChangeText={selectedStockView.changeText}
          latestTone={selectedStockView.changeTone}
        />
      </Flex>
    </Card>
  );
}

// ---- 交易操作区 ----

interface TradeBoxProps {
  tradePreview: StockMarketTradePreview;
  quantity: number;
  maxTradeQty: number;
  canBuy: boolean;
  canBuyAll: boolean;
  canSell: boolean;
  canClearSelected: boolean;
  maxAffordableBuyQty: number;
  localActionKey: ActionKey;
  onQuantityChange: (v: number | null) => void;
  onUseLimitQuantity: (n: number) => void;
  onBuy: () => void;
  onBuyAll: () => void;
  onSell: () => void;
  onClearStock: () => void;
  onBuyMenuClick: NonNullable<MenuProps['onClick']>;
  onSellMenuClick: NonNullable<MenuProps['onClick']>;
  buyActionMenuItems: NonNullable<MenuProps['items']>;
  sellActionMenuItems: NonNullable<MenuProps['items']>;
}

function TradeBox({
  tradePreview, quantity, maxTradeQty,
  canBuy, canBuyAll, canSell, canClearSelected,
  maxAffordableBuyQty, localActionKey,
  onQuantityChange, onUseLimitQuantity,
  onBuy, onBuyAll, onSell, onClearStock,
  onBuyMenuClick, onSellMenuClick,
  buyActionMenuItems, sellActionMenuItems,
}: TradeBoxProps): React.ReactNode {
  return (
    <div data-section="trade-box">
      <Row gutter={[16, 16]}>
        {/* 数量输入 + 买卖按钮（同一行） */}
        <Col span={24}>
          <Flex gap={8} align="center" wrap="wrap" justify="space-between">
            <Flex gap={8} align="center" data-element="trade-quantity">
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>数量</span>
              <InputNumber<number>
                size="small"
                min={1}
                max={maxTradeQty}
                precision={0}
                value={quantity}
                onChange={onQuantityChange}
                style={{ width: 120 }}
              />
            </Flex>
            <Flex gap={8} data-element="trade-actions">
              <Dropdown.Button
                size="small"
                type="primary"
                trigger={['click']}
                placement="bottomRight"
                disabled={!canBuy && !canBuyAll}
                loading={localActionKey === 'buy' || localActionKey === 'buy-all'}
                menu={{ items: buyActionMenuItems, onClick: onBuyMenuClick }}
                onClick={onBuy}
                data-action="buy"
              >
                <ShoppingCartOutlined /> 买入
              </Dropdown.Button>
              <Dropdown.Button
                size="small"
                trigger={['click']}
                placement="bottomRight"
                disabled={!canSell && !canClearSelected}
                loading={localActionKey === 'sell'}
                menu={{ items: sellActionMenuItems, onClick: onSellMenuClick }}
                onClick={onSell}
                data-action="sell"
              >
                <FallOutlined /> 卖出
              </Dropdown.Button>
              {/* <Button
                size="small"
                danger
                icon={<ClearOutlined />}
                disabled={!canClearSelected}
                loading={localActionKey === 'clear-stock'}
                onClick={onClearStock}
                data-action="clear-stock"
              >
                清仓
              </Button> */}
            </Flex>
          </Flex>
        </Col>

        {/* 交易预览 */}
        <Col span={24}>
          <Row gutter={[16, 8]} data-element="trade-preview">
            <Col span={12}>
              <TradePreviewItem label="买入成交额" value={tradePreview.grossAmountText} />
            </Col>
            <Col span={12}>
              <TradePreviewItem label="卖出成交额" value={tradePreview.sellGrossAmountText} />
            </Col>
            <Col span={12}>
              <TradePreviewItem label="买入扣款" value={tradePreview.buyCostText} />
            </Col>
            <Col span={12}>
              <TradePreviewItem label="卖出到账" value={tradePreview.sellReceiveText} />
            </Col>
            <Col span={12}>
              <TradePreviewItem label="买入费用" value={tradePreview.buyFeeAmountText} />
            </Col>
            <Col span={12}>
              <TradePreviewItem label="卖出费用" value={tradePreview.sellFeeAmountText} />
            </Col>
          </Row>
        </Col>

        {/* 快捷数量 */}
        <Col span={24}>
          <Row gutter={[16, 8]} data-element="trade-limits">
            <Col xs={24} sm={12}>
              <Flex gap={4} wrap="wrap" data-element="buy-limits">
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>可买</span>
                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                  const qty = ratio === 1
                    ? maxAffordableBuyQty
                    : Math.max(1, Math.floor(maxAffordableBuyQty * ratio));
                  return (
                    <Button
                      key={ratio}
                      size="small"
                      disabled={maxAffordableBuyQty <= 0}
                      onClick={() => onUseLimitQuantity(qty)}
                      data-action={`buy-${ratio}`}
                    >
                      {ratio === 1 ? `全部(${tradePreview.maxAffordableBuyQtyText})` : `${ratio * 100}%`}
                    </Button>
                  );
                })}
              </Flex>
            </Col>
            <Col xs={24} sm={12}>
              <Flex gap={4} wrap="wrap" data-element="sell-limits">
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>可卖</span>
                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                  const qty = ratio === 1
                    ? tradePreview.maxSellQty
                    : Math.max(1, Math.floor(tradePreview.maxSellQty * ratio));
                  return (
                    <Button
                      key={ratio}
                      size="small"
                      disabled={tradePreview.maxSellQty <= 0}
                      onClick={() => onUseLimitQuantity(qty)}
                      data-action={`sell-${ratio}`}
                    >
                      {ratio === 1 ? `全部(${tradePreview.maxSellQtyText})` : `${ratio * 100}%`}
                    </Button>
                  );
                })}
              </Flex>
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
}

function TradePreviewItem({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <Flex justify="space-between" data-element="trade-preview-item">
      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: 12 }}>{value}</span>
    </Flex>
  );
}

// ---- 收益详情 tab ----

interface ProfitTabProps {
  profitModel: import('../domain/stock-market/types').StockMarketProfitDetailViewModel | null;
  profitLoading: boolean;
  onRefresh: () => void;
}

function ProfitTab({ profitModel, profitLoading, onRefresh }: ProfitTabProps): React.ReactNode {
  if (profitLoading && !profitModel) {
    return (
      <Flex data-section="profit-loading" justify="center" style={{ padding: 24 }}>
        <Spin size="small" />
      </Flex>
    );
  }

  if (!profitModel) {
    return (
      <Flex data-section="profit-empty" justify="center" style={{ padding: 24 }}>
        <Empty description="暂无收益数据" />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16} data-section="profit-tab">
      <Card
        id="profit-summary-card"
        size="small"
        title="收益详情"
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={profitLoading}>
            刷新
          </Button>
        }
      >
        <Descriptions items={[
          {
            label: '总收益', children: (
              <span className={getStockMarketToneClassName(profitModel.summary.totalPnlTone)}>
                {profitModel.summary.totalPnlText}
              </span>
            )
          },
          {
            label: '已实现盈亏', children: (
              <span className={getStockMarketToneClassName(profitModel.summary.realizedPnlTone)}>
                {profitModel.summary.realizedPnlText}
              </span>
            )
          },
          {
            label: '持仓浮盈亏', children: (
              <span className={getStockMarketToneClassName(profitModel.summary.unrealizedPnlTone)}>
                {profitModel.summary.unrealizedPnlText}
              </span>
            )
          },
          { label: '总股数', children: profitModel.summary.totalHoldingQtyText },
          { label: '当前市值', children: profitModel.summary.totalMarketValueText },
          { label: '当前成本', children: profitModel.summary.totalCostText },
        ]} column={3} size="small" data-element="profit-summary" />
      </Card>

      {profitModel.dailyRows.length > 0 && (
        <Flex vertical gap={8} data-element="profit-daily">
          {profitModel.dailyRows.map((row) => (
            <Card key={row.dayKey} size="small" data-element="profit-daily-item">
              <Flex justify="space-between" align="center">
                <span style={{ color: 'var(--text-secondary)' }}>{row.dayKey}</span>
                <Tag className={getStockMarketToneClassName(row.totalPnlTone)}>
                  累计盈亏 {row.totalPnlText}
                </Tag>
              </Flex>
              <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                <Col span={8}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>当日收益</div>
                  <div className={getStockMarketToneClassName(row.dailyPnlTone)} style={{ fontWeight: 500 }}>{row.dailyPnlText}</div>
                </Col>
                <Col span={8}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>已实现</div>
                  <div className={getStockMarketToneClassName(row.realizedPnlTone)} style={{ fontWeight: 500 }}>{row.realizedPnlText}</div>
                </Col>
                <Col span={8}>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>持仓浮盈亏</div>
                  <div className={getStockMarketToneClassName(row.unrealizedPnlTone)} style={{ fontWeight: 500 }}>{row.unrealizedPnlText}</div>
                </Col>
              </Row>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

// ---- 排行 tab ----

interface RankingTabProps {
  wealthRanks: WealthRankDto[];
  stockMarketRanks: StockMarketRankDto[];
  shopRentRanks: ShopRentRankDto[];
  rankLoading: boolean;
  onRefreshWealth: () => void;
  onRefreshStockMarket: () => void;
  onRefreshShopRent: () => void;
  onTabChange: (tab: 'wealth' | 'stockMarket' | 'shopRent') => void;
  activeRankTab: 'wealth' | 'stockMarket' | 'shopRent';
}

const formatSpiritStones = (value: number): string => {
  if (Math.abs(value) >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 1_0000) {
    return `${(value / 1_0000).toFixed(2)}万`;
  }
  return value.toLocaleString();
};

const getRankBadgeColor = (rank: number): string => {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'volcano';
  if (rank === 3) return 'orange';
  return 'default';
};

const wealthRankColumns: ColumnsType<WealthRankDto> = [
  {
    title: '排名',
    dataIndex: 'rank',
    key: 'rank',
    width: 70,
    fixed: 'left',
    render: (rank: number) => {
      const color = getRankBadgeColor(rank);
      const icon = rank <= 3 ? <CrownOutlined /> : null;
      return (
        <Flex gap={4} align="center">
          {icon && <span style={{ color: color === 'gold' ? '#faad14' : color === 'volcano' ? '#fa541c' : '#fa8c16' }}>{icon}</span>}
          <Tag color={color} style={{ margin: 0, minWidth: 28, textAlign: 'center' }}>{rank}</Tag>
        </Flex>
      );
    },
  },
  {
    title: '角色',
    dataIndex: 'name',
    key: 'name',
    width: 120,
    fixed: 'left',
    render: (_: unknown, record: WealthRankDto) => (
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.name}</span>
    ),
  },
  {
    title: '灵石',
    dataIndex: 'spiritStones',
    key: 'spiritStones',
    width: 120,
    sorter: (a: WealthRankDto, b: WealthRankDto) => a.spiritStones - b.spiritStones,
    defaultSortOrder: 'descend',
    render: (value: number) => (
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
        {formatSpiritStones(value)}
      </span>
    ),
  },
  {
    title: '银两',
    dataIndex: 'silver',
    key: 'silver',
    width: 120,
    render: (value: number) => formatSpiritStones(value),
  },
];

const stockMarketRankColumns: ColumnsType<StockMarketRankDto> = [
  {
    title: '排名',
    dataIndex: 'rank',
    key: 'rank',
    width: 70,
    fixed: 'left',
    render: (rank: number) => {
      const color = getRankBadgeColor(rank);
      const icon = rank <= 3 ? <CrownOutlined /> : null;
      return (
        <Flex gap={4} align="center">
          {icon && <span style={{ color: color === 'gold' ? '#faad14' : color === 'volcano' ? '#fa541c' : '#fa8c16' }}>{icon}</span>}
          <Tag color={color} style={{ margin: 0, minWidth: 28, textAlign: 'center' }}>{rank}</Tag>
        </Flex>
      );
    },
  },
  {
    title: '角色',
    dataIndex: 'name',
    key: 'name',
    width: 120,
    fixed: 'left',
    render: (_: unknown, record: StockMarketRankDto) => (
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.name}</span>
    ),
  },
  {
    title: '持仓股数',
    dataIndex: 'totalHoldingQty',
    key: 'totalHoldingQty',
    width: 90,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.totalHoldingQty - b.totalHoldingQty,
    render: (value: number) => value.toLocaleString(),
  },
  {
    title: '市值',
    dataIndex: 'totalMarketValueSpiritStones',
    key: 'totalMarketValueSpiritStones',
    width: 110,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.totalMarketValueSpiritStones - b.totalMarketValueSpiritStones,
    defaultSortOrder: 'descend',
    render: (value: number) => (
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
        {formatSpiritStones(value)}
      </span>
    ),
  },
  {
    title: '成本',
    dataIndex: 'totalCostSpiritStones',
    key: 'totalCostSpiritStones',
    width: 110,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.totalCostSpiritStones - b.totalCostSpiritStones,
    render: (value: number) => formatSpiritStones(value),
  },
  {
    title: '浮盈亏',
    dataIndex: 'unrealizedPnlSpiritStones',
    key: 'unrealizedPnlSpiritStones',
    width: 110,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.unrealizedPnlSpiritStones - b.unrealizedPnlSpiritStones,
    render: (value: number) => {
      const tone = value > 0 ? 'green' : value < 0 ? 'red' : 'default';
      const sign = value > 0 ? '+' : '';
      return <Tag color={tone}>{sign}{formatSpiritStones(value)}</Tag>;
    },
  },
  {
    title: '已实现',
    dataIndex: 'realizedPnlSpiritStones',
    key: 'realizedPnlSpiritStones',
    width: 110,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.realizedPnlSpiritStones - b.realizedPnlSpiritStones,
    render: (value: number) => {
      const tone = value > 0 ? 'green' : value < 0 ? 'red' : 'default';
      const sign = value > 0 ? '+' : '';
      return <Tag color={tone}>{sign}{formatSpiritStones(value)}</Tag>;
    },
  },
  {
    title: '总盈亏',
    dataIndex: 'totalPnlSpiritStones',
    key: 'totalPnlSpiritStones',
    width: 110,
    align: 'right',
    sorter: (a: StockMarketRankDto, b: StockMarketRankDto) => a.totalPnlSpiritStones - b.totalPnlSpiritStones,
    render: (value: number) => {
      const tone = value > 0 ? 'green' : value < 0 ? 'red' : 'default';
      const sign = value > 0 ? '+' : '';
      return (
        <Tag color={tone} style={{ fontWeight: 600 }}>
          {sign}{formatSpiritStones(value)}
        </Tag>
      );
    },
  },
];

function RankingTab(props: RankingTabProps): React.ReactNode {
  const {
    wealthRanks, stockMarketRanks, shopRentRanks,
    rankLoading, onRefreshWealth, onRefreshStockMarket, onRefreshShopRent,
    onTabChange, activeRankTab,
  } = props;

  const onRefresh = activeRankTab === 'wealth'
    ? onRefreshWealth
    : activeRankTab === 'stockMarket'
      ? onRefreshStockMarket
      : onRefreshShopRent;

  if (rankLoading) {
    const currentData = activeRankTab === 'wealth'
      ? wealthRanks
      : activeRankTab === 'stockMarket'
        ? stockMarketRanks
        : shopRentRanks;
    if (currentData.length === 0) {
      return (
        <Flex data-section="ranking-loading" justify="center" style={{ padding: 24 }}>
          <Spin size="small" />
        </Flex>
      );
    }
  }

  return (
    <Flex vertical gap={12} data-section="ranking-tab">
      {/* 排行类型切换 */}
      <Flex justify="space-between" align="center" gap={12} wrap="wrap">
        <Segmented<'wealth' | 'stockMarket' | 'shopRent'>
          value={activeRankTab}
          onChange={onTabChange}
          options={[
            { label: '财富', value: 'wealth', icon: <CrownOutlined /> },
            { label: '股市', value: 'stockMarket', icon: <LineChartOutlined /> },
            { label: '收租', value: 'shopRent', icon: <ShopOutlined /> },
          ]}
        />
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          loading={rankLoading}
        >
          刷新
        </Button>
      </Flex>

      {/* 财富排行 */}
      {activeRankTab === 'wealth' ? (
        <Card size="small" style={{ overflow: 'hidden' }}>
          {wealthRanks.length === 0 ? (
            <Empty description="暂无排行数据" />
          ) : (
            <Table<WealthRankDto>
              columns={wealthRankColumns}
              dataSource={wealthRanks}
              rowKey="characterId"
              size="small"
              pagination={false}
              scroll={{ x: 500 }}
              style={{ fontSize: 13 }}
            />
          )}
        </Card>
      ) : activeRankTab === 'stockMarket' ? (
        <Card size="small" style={{ overflow: 'hidden' }}>
          {stockMarketRanks.length === 0 ? (
            <Empty description="暂无排行数据" />
          ) : (
            <Table<StockMarketRankDto>
              columns={stockMarketRankColumns}
              dataSource={stockMarketRanks}
              rowKey="characterId"
              size="small"
              pagination={false}
              scroll={{ x: 800 }}
              style={{ fontSize: 13 }}
            />
          )}
        </Card>
      ) : (
        <Card size="small" style={{ overflow: 'hidden' }}>
          {shopRentRanks.length === 0 ? (
            <Empty description="暂无排行数据" />
          ) : (
            <Table<ShopRentRankDto>
              columns={[
                {
                  title: '排名',
                  dataIndex: 'rank',
                  key: 'rank',
                  width: 60,
                  align: 'center',
                  render: (rank: number) => {
                    if (rank <= 3) {
                      const colors = ['#d48806', '#8c8c8c', '#b87a36'];
                      return <span style={{ color: colors[rank - 1], fontWeight: 600 }}>{rank}</span>;
                    }
                    return rank;
                  },
                },
                { title: '角色', dataIndex: 'name', key: 'name', ellipsis: true },
                {
                  title: '已收租金',
                  dataIndex: 'totalRentCollected',
                  key: 'totalRentCollected',
                  align: 'right',
                  render: (v: number) => `${formatSpiritStones(v)} 灵石`,
                },
                {
                  title: '店铺数',
                  dataIndex: 'shopCount',
                  key: 'shopCount',
                  width: 70,
                  align: 'center',
                },
              ]}
              dataSource={shopRentRanks}
              rowKey="characterId"
              size="small"
              pagination={false}
              scroll={{ x: 400 }}
              style={{ fontSize: 13 }}
            />
          )}
        </Card>
      )}
    </Flex>
  );
}

// ---- 交易记录 tab ----

interface RecordsTabProps {
  tradeRecordViews: import('../domain/stock-market/types').StockMarketTradeRecordView[];
  tradesLoading: boolean;
  tradePage: number;
  tradePageSize: number;
  tradeTotal: number;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
}

function RecordsTab({
  tradeRecordViews, tradesLoading, tradePage, tradePageSize, tradeTotal,
  onRefresh, onPageChange,
}: RecordsTabProps): React.ReactNode {
  if (tradesLoading) {
    return (
      <Flex data-section="records-loading" justify="center" style={{ padding: 24 }}>
        <Spin size="small" />
      </Flex>
    );
  }

  if (tradeRecordViews.length <= 0) {
    return (
      <Flex data-section="records-empty" justify="center" style={{ padding: 24 }}>
        <Empty description="暂无交易记录" />
      </Flex>
    );
  }

  return (
    <Flex vertical gap={16} data-section="records-tab">
      <Flex justify="space-between" align="center">
        <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>交易记录</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={tradesLoading}>
          刷新
        </Button>
      </Flex>

      <Flex vertical gap={8} data-element="trade-record-list">
        {tradeRecordViews.map((record) => (
          <Card key={record.id} size="small" data-element="trade-record">
            <Flex justify="space-between" align="center">
              <Flex gap={8} align="center">
                <Tag className={getStockMarketToneClassName(record.sideTone)}>{record.sideText}</Tag>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.stockText}</span>
              </Flex>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{record.timeText}</span>
            </Flex>
            <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
              <Col span={8}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>数量</div>
                <div style={{ fontWeight: 500 }}>{record.quantityText}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>单价</div>
                <div style={{ fontWeight: 500 }}>{record.unitPriceText}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>费用</div>
                <div style={{ fontWeight: 500 }}>{record.feeText}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>结算</div>
                <div style={{ fontWeight: 500 }}>{record.netAmountText}</div>
              </Col>
              <Col span={8}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>实现盈亏</div>
                <div className={getStockMarketToneClassName(record.realizedPnlTone)} style={{ fontWeight: 500 }}>
                  {record.realizedPnlText}
                </div>
              </Col>
            </Row>
          </Card>
        ))}
      </Flex>

      {tradeTotal > tradePageSize && (
        <Pagination
          size="small"
          current={tradePage}
          pageSize={tradePageSize}
          total={tradeTotal}
          showSizeChanger={false}
          onChange={onPageChange}
          data-element="trade-pagination"
        />
      )}
    </Flex>
  );
}

export default StockMarketPage;
