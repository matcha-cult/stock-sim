/**
 * GM 挂单管理查看器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：GM 查看所有玩家的活跃挂单，支持按角色、昵称、股票、方向筛选，
 *    可强制取消任意挂单。
 * 2. 不做什么：不创建/修改挂单（由玩家端完成），不提供编辑功能。
 *
 * 输入 / 输出：
 * - 输入：筛选条件（角色ID、昵称、股票ID、买卖方向）。
 * - 输出：活跃挂单分页列表 + 取消操作结果。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> gmGetAllPendingOrders() -> 渲染 Table -> 点击取消 -> gmCancelPendingOrder() -> 刷新列表。
 *
 * 复用设计说明：
 * - API 调用复用 api.get/delete()，布局与 GmStockViewer / GmNewsViewer 保持一致。
 * - 数值格式化复用 StockMarketPage 中的 formatSpiritStones 或内联实现。
 * - 颜色判断复用 resolveStockMarketTone / getStockMarketToneClassName。
 *
 * 关键边界条件与坑点：
 * 1. 取消挂单后需刷新列表，否则数据不一致。
 * 2. 当前价可能为 null（股票无报价），需做容错展示。
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  App, Button, Card, Empty, Flex, Input, Pagination, Select, Spin, Table, Tag, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  gmGetAllPendingOrders,
  gmCancelPendingOrder,
  type GmPendingOrderDto,
  type PendingOrderSide,
} from '../../services/api/stockMarket';
import {
  resolveStockMarketTone,
  getStockMarketToneClassName,
} from '../../domain/stock-market/viewTransform';
import { RequestDedup } from '../../stores/RequestDedup';

// 组件级请求去重（TTL 5s）
const dedup = new RequestDedup(5_000);

const formatSpiritStones = (value: number): string => {
  if (Math.abs(value) >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 1_0000) {
    return `${(value / 1_0000).toFixed(2)}万`;
  }
  return value.toLocaleString();
};

const SIDE_LABEL: Record<PendingOrderSide, string> = {
  buy: '买入',
  sell: '卖出',
};

const SIDE_COLOR: Record<PendingOrderSide, string> = {
  buy: 'green',
  sell: 'red',
};

const TRIGGER_MODE_LABEL: Record<string, string> = {
  normal: '普通',
  premium: '溢价',
};

const GmPendingOrderViewer: React.FC = () => {
  const { message, modal } = App.useApp();

  // ---- 列表状态 ----
  const [records, setRecords] = useState<GmPendingOrderDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 筛选条件
  const [searchCharacterId, setSearchCharacterId] = useState('');
  const [searchNickname, setSearchNickname] = useState('');
  const [searchStockId, setSearchStockId] = useState('');
  const [searchSide, setSearchSide] = useState<PendingOrderSide | undefined>(undefined);

  const fetchList = useCallback(async (p: number) => {
    const key = `gm-pending:${p}:${searchCharacterId}:${searchNickname}:${searchStockId}:${searchSide}`;
    if (!dedup.enter(key)) return;

    setLoading(true);
    const promise = (async () => {
      try {
        const params: {
          page: number;
          pageSize: number;
          nickname?: string;
          characterId?: number;
          stockId?: string;
          side?: PendingOrderSide;
        } = { page: p, pageSize };
        const cid = Number(searchCharacterId);
        if (Number.isFinite(cid) && cid > 0) {
          params.characterId = cid;
        }
        if (searchNickname.trim()) {
          params.nickname = searchNickname.trim();
        }
        if (searchStockId.trim()) {
          params.stockId = searchStockId.trim();
        }
        if (searchSide) {
          params.side = searchSide;
        }

        const result = await gmGetAllPendingOrders(params);
        if (result.success && result.data) {
          setRecords(result.data.records);
          setTotal(result.data.total);
          setPage(result.data.page);
        } else {
          message.error(result.message ?? '查询挂单失败');
        }
      } catch {
        message.error('查询挂单失败');
      } finally {
        setLoading(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [searchCharacterId, searchNickname, searchStockId, searchSide, message]);

  const handleSearch = () => {
    void fetchList(1);
  };

  const handleReset = () => {
    setSearchCharacterId('');
    setSearchNickname('');
    setSearchStockId('');
    setSearchSide(undefined);
    void fetchList(1);
  };

  useEffect(() => {
    void fetchList(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelOrder = useCallback((order: GmPendingOrderDto) => {
    modal.confirm({
      title: `确认取消挂单 #${order.id}？`,
      content: (
        <Flex vertical gap={4} style={{ fontSize: 13 }}>
          <Typography.Text>玩家：{order.nickname}(#{order.characterId})</Typography.Text>
          <Typography.Text>股票：{order.stockName}（{order.stockCode}）</Typography.Text>
          <Typography.Text>方向：{SIDE_LABEL[order.side]}</Typography.Text>
          <Typography.Text>限价：{formatSpiritStones(order.limitPriceSpiritStones)} 灵石</Typography.Text>
          <Typography.Text>数量：{order.quantity} 股</Typography.Text>
          <Typography.Text>冻结：{formatSpiritStones(order.frozenSpiritStones)} 灵石</Typography.Text>
        </Flex>
      ),
      okText: '确认取消',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: async () => {
        try {
          const result = await gmCancelPendingOrder(order.id);
          if (result.success) {
            message.success(result.message ?? '已取消');
            await fetchList(page);
          } else {
            message.error(result.message ?? '取消失败');
          }
        } catch {
          message.error('取消请求失败');
        }
      },
    });
  }, [page, fetchList, message, modal]);

  // ---- 表格列 ----
  const columns = useMemo<ColumnsType<GmPendingOrderDto>>(() => [
    {
      title: '订单ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      fixed: 'left',
      render: (v: number) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '角色ID',
      dataIndex: 'characterId',
      key: 'characterId',
      width: 70,
      render: (v: number) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
      render: (name: string, record: GmPendingOrderDto) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {record.title ? `[${record.title}] ` : ''}{name}
        </span>
      ),
    },
    {
      title: '股票',
      key: 'stock',
      width: 110,
      render: (_: unknown, record: GmPendingOrderDto) => (
        <Flex vertical>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.stockName}</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{record.stockCode}</span>
        </Flex>
      ),
    },
    {
      title: '方向',
      dataIndex: 'side',
      key: 'side',
      width: 60,
      align: 'center',
      render: (v: PendingOrderSide) => <Tag color={SIDE_COLOR[v]}>{SIDE_LABEL[v]}</Tag>,
    },
    {
      title: '限价',
      dataIndex: 'limitPriceSpiritStones',
      key: 'limitPriceSpiritStones',
      width: 90,
      align: 'right',
      render: (v: number) => formatSpiritStones(v),
    },
    {
      title: '当前价',
      dataIndex: 'currentPriceSpiritStones',
      key: 'currentPriceSpiritStones',
      width: 90,
      align: 'right',
      render: (v: number, record: GmPendingOrderDto) => {
        if (v == null || v === 0) {
          return <span style={{ color: 'var(--text-disabled)' }}>--</span>;
        }
        const diff = record.side === 'buy'
          ? v - record.limitPriceSpiritStones
          : record.limitPriceSpiritStones - v;
        const tone = resolveStockMarketTone(diff);
        return (
          <span className={getStockMarketToneClassName(tone)}>
            {formatSpiritStones(v)}
          </span>
        );
      },
    },
    {
      title: '冻结',
      dataIndex: 'frozenSpiritStones',
      key: 'frozenSpiritStones',
      width: 90,
      align: 'right',
      render: (v: number) => formatSpiritStones(v),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 60,
      align: 'right',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '模式',
      dataIndex: 'triggerMode',
      key: 'triggerMode',
      width: 60,
      align: 'center',
      render: (v: string) => <Tag>{TRIGGER_MODE_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (v: number) => {
        const d = new Date(v);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_: unknown, record: GmPendingOrderDto) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleCancelOrder(record)}
        >
          取消
        </Button>
      ),
    },
  ], [handleCancelOrder]);

  return (
    <Card
      size="small"
      title="GM挂单管理"
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void fetchList(page)} loading={loading}>
          刷新
        </Button>
      }
      data-section="gm-pending-order-viewer"
    >
      {/* 筛选条件 */}
      <Flex gap={12} wrap="wrap" align="flex-end" style={{ marginBottom: 16 }}>
        <Flex vertical>
          <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>角色ID</span>
          <Input
            style={{ width: 120 }}
            size="small"
            placeholder="输入角色ID"
            value={searchCharacterId}
            onChange={(e) => setSearchCharacterId(e.target.value)}
            onPressEnter={handleSearch}
          />
        </Flex>
        <Flex vertical>
          <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>昵称</span>
          <Input
            style={{ width: 140 }}
            size="small"
            placeholder="模糊搜索昵称"
            value={searchNickname}
            onChange={(e) => setSearchNickname(e.target.value)}
            onPressEnter={handleSearch}
          />
        </Flex>
        <Flex vertical>
          <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>股票ID</span>
          <Input
            style={{ width: 120 }}
            size="small"
            placeholder="输入股票ID"
            value={searchStockId}
            onChange={(e) => setSearchStockId(e.target.value)}
            onPressEnter={handleSearch}
          />
        </Flex>
        <Flex vertical>
          <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>方向</span>
          <Select<PendingOrderSide | undefined>
            style={{ width: 100 }}
            size="small"
            placeholder="全部"
            value={searchSide}
            onChange={setSearchSide}
            options={[
              { label: '买入', value: 'buy' },
              { label: '卖出', value: 'sell' },
            ]}
            allowClear
          />
        </Flex>
        <Button
          type="primary"
          size="small"
          icon={<SearchOutlined />}
          onClick={handleSearch}
          loading={loading}
        >
          查询
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleReset}
        >
          重置
        </Button>
      </Flex>

      {/* 挂单列表 */}
      {records.length === 0 && !loading ? (
        <Empty description="暂无活跃挂单" />
      ) : (
        <Table<GmPendingOrderDto>
          columns={columns}
          dataSource={records}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize, showSizeChanger: false, current: page }}
          scroll={{ x: 1400 }}
          style={{ fontSize: 13 }}
        />
      )}

      {total > pageSize && (
        <Flex justify="center" style={{ marginTop: 12 }}>
          <Pagination
            size="small"
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            showTotal={(t) => `共 ${t} 条`}
            onChange={(p) => void fetchList(p)}
          />
        </Flex>
      )}
    </Card>
  );
};

export default GmPendingOrderViewer;
