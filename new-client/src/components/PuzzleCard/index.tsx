/**
 * 常驻刮刮乐根组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：二级 Tabs 切换（刮奖/兑奖历史），协调 TicketSelect、TicketGame、RedeemHistory。
 * 2. 不做什么：不处理具体业务逻辑（由 usePuzzleCard hook 负责）。
 *
 * 输入 / 输出：
 * - 输入：无（自动从 usePuzzleCard 获取状态）。
 * - 输出：完整无限刮刮乐界面。
 *
 * 数据流 / 状态流：
 * usePuzzleCard 提供状态 → 根组件按 activeTab 渲染对应 sub-tab → sub-tab 内部交互 → 回调更新状态。
 *
 * 复用设计说明：
 * - 二级 Tabs 使用 antd Tabs，与主页面风格一致。
 * - 历史列表加载时机：切换到"兑奖历史" tab 时首次加载，后续翻页按需。
 *
 * 关键边界条件与坑点：
 * 1. 活跃票据存在时，"刮奖" tab 显示 TicketGame；否则显示 TicketSelect。
 * 2. 兑奖完成后清空 activeTicket，回到 TicketSelect。
 * 3. "兑奖历史" tab 使用 destroyInactiveTabPane，切回时重新加载。
 */
import { useState, useCallback, useEffect } from 'react';
import { Tabs, App, Spin, Flex, Card, Typography, Tag, Button } from 'antd';
import { usePuzzleCard } from '../../hooks/usePuzzleCard';
import TicketSelect from './TicketSelect';
import TicketGame from './TicketGame';
import RedeemHistory from './RedeemHistory';
import PuzzleTicketCard from './PuzzleTicketCard';
import type { HistoryItemDto } from '../../services/api/puzzleCard';

type SubTabKey = 'scratch' | 'history';

const { Text } = Typography;

const formatPrize = (amount: number): string => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toLocaleString();
};

const PuzzleCardPage = () => {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<SubTabKey>('scratch');
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const {
    activeTicket,
    batchResult,
    history,
    purchasing,
    batchPurchasing,
    redeeming,
    loadingHistory,
    dailyPurchaseInfo,
    purchase,
    batchPurchase,
    redeem,
    redeemFromHistory,
    refreshHistory,
    clearActive,
    clearBatchResult,
  } = usePuzzleCard();

  // 切换到"兑奖历史"时首次加载
  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded) {
      void refreshHistory(1);
      setHistoryLoaded(true);
    }
  }, [activeTab, historyLoaded, refreshHistory]);

  const handlePurchase = useCallback(async (typeKey: string) => {
    const result = await purchase(typeKey);
    if (result) {
      message.success(`购票成功：${result.ticket.typeKey} #${result.ticket.ticketNumber}`);
    }
  }, [purchase, message]);

  const handleBatchPurchase = useCallback(async (typeKey: string) => {
    const result = await batchPurchase(typeKey);
    if (result) {
      const winCount = result.tickets.filter(t => t.prizeAmount > 0).length;
      message.success(
        `批量购票成功！${result.tickets.length}张，中奖${winCount}张，` +
        `总奖金 ${formatPrize(result.totalPrize)} 灵石，净${result.netProfit >= 0 ? '赚' : '亏'} ${formatPrize(Math.abs(result.netProfit))} 灵石`,
      );
    }
  }, [batchPurchase, message]);

  const handleRedeem = useCallback(async () => {
    const result = await redeem();
    if (result) {
      if (result.prizeAmount > 0) {
        message.success(`兑奖成功！+${result.prizeAmount.toLocaleString()} 灵石`);
      }
      // 兑奖完成后刷新历史（如果历史已加载）
      if (historyLoaded) void refreshHistory(1);
    }
  }, [redeem, message, historyLoaded, refreshHistory]);

  const handleRedeemFromHistory = useCallback(async (item: HistoryItemDto) => {
    if (!item.redeemCode) {
      message.error('该票据无法兑奖');
      return;
    }
    const result = await redeemFromHistory(Number(item.id), item.redeemCode);
    if (result) {
      if (result.prizeAmount > 0) {
        message.success(`兑奖成功！+${result.prizeAmount.toLocaleString()} 灵石`);
      }
      void refreshHistory(history?.page ?? 1);
    }
  }, [redeemFromHistory, message, refreshHistory, history]);

  const handleContinue = useCallback(() => {
    clearActive();
    clearBatchResult();
    void refreshHistory(1);
  }, [clearActive, clearBatchResult, refreshHistory]);

  const renderScratchTab = () => {
    if (activeTicket) {
      return (
        <TicketGame
          ticket={activeTicket}
          onRedeem={() => void handleRedeem()}
          onContinue={handleContinue}
          onBuyAnother={() => {
            clearActive();
          }}
          isRedeeming={redeeming}
          todayCount={dailyPurchaseInfo?.todayCount}
          todayThreshold={dailyPurchaseInfo?.todayThreshold}
        />
      );
    }

    if (batchResult) {
      const winCount = batchResult.tickets.filter(t => t.prizeAmount > 0).length;
      return (
        <Flex vertical gap={12}>
          <Card size="small">
            <Flex gap={8} wrap>
              <Tag color="blue">共 {batchResult.tickets.length} 张</Tag>
              <Tag color="green">中奖 {winCount} 张</Tag>
              <Tag color="gold">总奖金 {formatPrize(batchResult.totalPrize)} 灵石</Tag>
              <Tag color={batchResult.netProfit >= 0 ? 'success' : 'error'}>
                净{batchResult.netProfit >= 0 ? '赚' : '亏'} {formatPrize(Math.abs(batchResult.netProfit))} 灵石
              </Tag>
            </Flex>
            {dailyPurchaseInfo && (
              <Flex style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  今日已购 {dailyPurchaseInfo.todayCount} 张{dailyPurchaseInfo.todayCount >= dailyPurchaseInfo.todayThreshold ? '（已触发惩罚）' : `（距离惩罚还差 ${dailyPurchaseInfo.todayThreshold - dailyPurchaseInfo.todayCount} 张）`}
                </Text>
              </Flex>
            )}
          </Card>

          <Flex wrap gap={12}>
            {batchResult.tickets.map((ticket) => (
              <PuzzleTicketCard
                key={ticket.id}
                ticketNumber={ticket.ticketNumber}
                typeKey={ticket.typeKey}
                grid={ticket.ticketData.grid}
                matchedLines={ticket.matchedLines}
                prizeAmount={ticket.prizeAmount}
                redeemedAt={ticket.redeemedAt}
              />
            ))}
          </Flex>

          <Button type="primary" block onClick={handleContinue}>
            继续购票
          </Button>
        </Flex>
      );
    }

    return (
      <TicketSelect
        onPurchase={(typeKey) => void handlePurchase(typeKey)}
        onBatchPurchase={(typeKey) => void handleBatchPurchase(typeKey)}
        isPurchasing={purchasing}
        isBatchPurchasing={batchPurchasing}
      />
    );
  };

  const tabItems = [
    {
      key: 'scratch' as const,
      label: '刮奖',
      children: renderScratchTab(),
    },
    {
      key: 'history' as const,
      label: '兑奖历史',
      children: history ? (
        <RedeemHistory
          items={history.items}
          total={history.total}
          page={history.page}
          pageSize={history.pageSize}
          loading={loadingHistory}
          redeeming={redeeming}
          onRedeem={(item) => void handleRedeemFromHistory(item)}
          onPageChange={(p) => void refreshHistory(p)}
        />
      ) : (
        <Flex justify="center" style={{ minHeight: 200 }}>
          <Spin />
        </Flex>
      ),
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(k) => setActiveTab(k as SubTabKey)}
      destroyInactiveTabPane
      items={tabItems}
    />
  );
};

export default PuzzleCardPage;
