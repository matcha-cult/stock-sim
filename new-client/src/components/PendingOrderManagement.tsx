/**
 * 挂单管理 Tab 组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示当前用户的活跃挂单列表，支持取消挂单、刷新列表。
 * 2. 不做什么：不创建挂单（由 PendingOrderCard 负责），不决定成交逻辑。
 *
 * 输入 / 输出：
 * - 输入：RootStore（stockStore 挂单数据 + 取消操作）。
 * - 输出：挂单列表 + 取消交互界面。
 *
 * 数据流 / 状态流：
 * Tab 激活 -> stockStore.refreshPendingOrders -> 渲染列表 -> 用户点击取消 -> stockStore.cancelPendingOrder -> 刷新列表 + 刷新角色灵石。
 *
 * 复用设计说明：
 * - 列表使用 antd Table 展示，便于后续扩展筛选/排序。
 * - 格式化函数复用 viewTransform 中的 formatStockMarketPrice / formatStockMarketQuantity / formatStockMarketTime。
 * - 被 StockMarketPage 的 Tabs 容器持有。
 *
 * 关键边界条件与坑点：
 * 1. 列表仅在 Tab 激活时拉取，避免无意义的后台请求。
 * 2. 取消后自动刷新列表，保持数据最新。
 */

import { useCallback, useMemo, useEffect, useState, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import {
  App, Button, Card, Empty, Flex, Popconfirm, Popover, Table, Tag, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloseCircleOutlined, QuestionCircleOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';
import {
  formatStockMarketBps,
  formatStockMarketPrice,
  formatStockMarketQuantity,
  formatStockMarketTime,
  resolveStockMarketTone,
  getStockMarketToneClassName,
} from '../domain/stock-market/viewTransform';
import type { PendingOrderDto } from '../services/api/stockMarket';

const PendingOrderManagement = observer(function PendingOrderManagement(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  const { stockStore } = rootStore;
  const { message } = App.useApp();
  const [dataLoaded, setDataLoaded] = useState(false);

  // Tab 激活时拉取数据
  useEffect(() => {
    if (!dataLoaded) {
      void stockStore.refreshPendingOrders().then(() => setDataLoaded(true));
    }
  }, [dataLoaded, stockStore]);

  const handleRefresh = useCallback(() => {
    void stockStore.refreshPendingOrders();
  }, [stockStore]);

  const handleCancelOrder = useCallback(async (orderId: number) => {
    const result = await stockStore.cancelPendingOrder(orderId);
    if (result.success) {
      message.success(result.message);
      // 取消挂单返还灵石，需刷新角色资源
      void rootStore.authStore.refreshCharacter();
    } else {
      message.error(result.message);
    }
  }, [stockStore, message, rootStore]);

  // 当前股价 + 涨跌映射（从 overview 中读取）
  const stockInfoByStockId = useMemo(() => {
    const map = new Map<string, { priceSpiritStones: number; lastChangeBps: number }>();
    for (const stock of stockStore.overview?.stocks ?? []) {
      map.set(stock.stockId, { priceSpiritStones: stock.priceSpiritStones, lastChangeBps: stock.lastChangeBps });
    }
    return map;
  }, [stockStore.overview?.stocks]);

  const columns: ColumnsType<PendingOrderDto> = [
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      width: 70,
      render: (side: 'buy' | 'sell') => (
        <Tag className={getStockMarketToneClassName(resolveStockMarketTone(side === 'buy' ? 1 : -1))}>
          {side === 'buy' ? '买入' : '卖出'}
        </Tag>
      ),
    },
    {
      title: '股票',
      key: 'stock',
      width: 120,
      render: (_, record) => (
        <Flex gap={4} align="center">
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.stockName}</span>
          <Tag style={{ fontSize: 11 }}>{record.stockCode}</Tag>
        </Flex>
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right',
      render: (quantity: number) => formatStockMarketQuantity(quantity),
    },
    {
      title: '限价',
      dataIndex: 'limitPriceSpiritStones',
      key: 'limitPriceSpiritStones',
      width: 100,
      align: 'right',
      render: (price: number) => formatStockMarketPrice(price),
    },
    {
      title: (
        <span>
          冻结
          <Popover
            placement="topLeft"
            trigger="click"
            title="冻结说明"
            content={
              <div style={{ maxWidth: 280, lineHeight: 1.6, fontSize: 13 }}>
                <div style={{ marginBottom: 6 }}><b>买入单：</b>冻结灵石 = 限价金额 + 预估手续费（佣金 + 过户费），取消时全额返还，成交时按实际费用多退少补。</div>
                <div><b>卖出单：</b>冻结对应股票数量，不预扣费用；成交时手续费从所得中扣除。</div>
              </div>
            }
          >
            <QuestionCircleOutlined style={{ marginLeft: 4, color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12 }} />
          </Popover>
        </span>
      ),
      dataIndex: 'frozenSpiritStones',
      key: 'frozenSpiritStones',
      width: 110,
      align: 'right',
      render: (amount: number) => <span>{formatStockMarketPrice(amount)}</span>,
    },
    {
      title: '当前价',
      key: 'currentPrice',
      width: 100,
      align: 'right',
      render: (_, record) => {
        const info = stockInfoByStockId.get(record.stockId);
        if (info === undefined) return '--';
        return (
          <Flex vertical align="flex-end">
            <span>{formatStockMarketPrice(info.priceSpiritStones)}</span>
            <span
              className={getStockMarketToneClassName(resolveStockMarketTone(info.lastChangeBps))}
              style={{ fontSize: 11 }}
            >
              {formatStockMarketBps(info.lastChangeBps)}
            </span>
          </Flex>
        );
      },
    },
    {
      title: '成交逻辑',
      dataIndex: 'triggerMode',
      key: 'triggerMode',
      width: 70,
      render: (mode: 'normal' | 'premium') => (
        mode === 'premium'
          ? <Tag color="orange">溢价</Tag>
          : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>常规</span>
      ),
    },
    {
      title: '挂单时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (ts: number) => (
        <Tooltip title={new Date(ts).toLocaleString('zh-CN')}>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            {formatStockMarketTime(ts)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Popconfirm
          title="确认取消该挂单？"
          onConfirm={() => void handleCancelOrder(record.id)}
          okText="确认"
          cancelText="取消"
        >
          <Button
            size="small"
            danger
            icon={<CloseCircleOutlined />}
            data-action="cancel-pending-order"
          >
            取消
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="挂单管理"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={stockStore.pendingOrdersLoading}
        >
          刷新
        </Button>
      }
      data-section="pending-order-management"
    >
      {stockStore.pendingOrders.length === 0 ? (
        <Empty description="暂无挂单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table<PendingOrderDto>
          columns={columns}
          dataSource={stockStore.pendingOrders}
          rowKey="id"
          size="small"
          pagination={false}
          loading={stockStore.pendingOrdersLoading}
        />
      )}
    </Card>
  );
});

export default PendingOrderManagement;
