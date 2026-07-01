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
import { Tabs, App, Spin, Flex } from 'antd';
import { usePuzzleCard } from '../../hooks/usePuzzleCard';
import TicketSelect from './TicketSelect';
import TicketGame from './TicketGame';
import RedeemHistory from './RedeemHistory';
import type { HistoryItemDto } from '../../services/api/puzzleCard';

type SubTabKey = 'scratch' | 'history';

const PuzzleCardPage = () => {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<SubTabKey>('scratch');
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const {
    activeTicket,
    history,
    purchasing,
    redeeming,
    loadingHistory,
    loadingActive,
    purchase,
    redeem,
    redeemFromHistory,
    refreshHistory,
    clearActive,
  } = usePuzzleCard();

  // 切换到"兑奖历史"时首次加载
  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded) {
      void refreshHistory(1);
      setHistoryLoaded(true);
    }
  }, [activeTab, historyLoaded, refreshHistory]);

  const handlePurchase = useCallback(async (typeKey: string) => {
    const ticket = await purchase(typeKey);
    if (ticket) {
      message.success(`购票成功：${ticket.typeKey} #${ticket.ticketNumber}`);
    }
  }, [purchase, message]);

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
  }, [clearActive]);

  if (loadingActive) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 200 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  const tabItems = [
    {
      key: 'scratch' as const,
      label: '刮奖',
      children: activeTicket ? (
        <TicketGame
          ticket={activeTicket}
          onRedeem={() => void handleRedeem()}
          onContinue={handleContinue}
          onBuyAnother={() => {
            clearActive();
          }}
          isRedeeming={redeeming}
        />
      ) : (
        <TicketSelect
          onPurchase={(typeKey) => void handlePurchase(typeKey)}
          isPurchasing={purchasing}
        />
      ),
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
