/**
 * GM 股市持仓查看器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：GM 查看所有玩家的股票持仓汇总，支持搜索玩家、查看玩家详细持仓、强制抛售股票。
 * 2. 不做什么：不提供编辑/删除持仓功能，不修改非股市相关数据。
 *
 * 输入 / 输出：
 * - 输入：无（内部维护筛选条件与选中状态）。
 * - 输出：玩家持仓汇总列表 + 玩家详细持仓 Drawer + 强制抛售操作。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> gmGetHoldingsList() -> 渲染 Table -> 点击行 -> gmGetCharacterHoldings() -> 渲染 Drawer。
 * 强制抛售 -> gmForceSellStock() -> 刷新玩家详细持仓 + 刷新汇总列表。
 *
 * 复用设计说明：
 * - API 调用复用 api.get/post()，颜色判断复用 resolveStockMarketTone / getStockMarketToneClassName。
 * - 数值格式化复用已有的 formatSpiritStones 工具（或内联实现）。
 * - 表格布局与 GmNewsViewer / GmLedgerViewer 保持一致的交互模式。
 *
 * 关键边界条件与坑点：
 * 1. 强制抛售受限于挂单冻结数量，可卖 = 持仓 - 冻结后向下取整。
 * 2. 抛售成功后需要同时刷新玩家汇总和详情，否则数据不一致。
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  App, Button, Card, Descriptions, Drawer, Empty, Flex, Input, Pagination,
  Spin, Table, Tag, Typography, Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
const { Text } = Typography;
import { ReloadOutlined, SearchOutlined, FallOutlined } from '@ant-design/icons';
import {
  gmGetHoldingsList,
  gmGetCharacterHoldings,
  gmForceSellStock,
  type GmPlayerHoldingSummaryDto,
  type GmCharacterHoldingDto,
  type GmCharacterHoldingItemDto,
} from '../../services/api/stockMarket';
import {
  resolveStockMarketTone,
  getStockMarketToneClassName,
} from '../../domain/stock-market/viewTransform';

const formatSpiritStones = (value: number): string => {
  if (Math.abs(value) >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 1_0000) {
    return `${(value / 1_0000).toFixed(2)}万`;
  }
  return value.toLocaleString();
};

const GmStockViewer: React.FC = () => {
  const { message, modal } = App.useApp();

  // ---- 玩家汇总列表 ----
  const [records, setRecords] = useState<GmPlayerHoldingSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 筛选条件
  const [searchCharacterId, setSearchCharacterId] = useState('');
  const [searchNickname, setSearchNickname] = useState('');

  const fetchHoldingsList = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params: { page: number; pageSize: number; nickname?: string; characterId?: number } = {
        page: p,
        pageSize,
      };
      const cid = Number(searchCharacterId);
      if (Number.isFinite(cid) && cid > 0) {
        params.characterId = cid;
      }
      if (searchNickname.trim()) {
        params.nickname = searchNickname.trim();
      }

      const result = await gmGetHoldingsList(params);
      if (result.success && result.data) {
        setRecords(result.data.records);
        setTotal(result.data.total);
        setPage(result.data.page);
      } else {
        message.error(result.message ?? '查询持仓汇总失败');
      }
    } catch {
      message.error('查询持仓汇总失败');
    } finally {
      setLoading(false);
    }
  }, [searchCharacterId, searchNickname, message]);

  const handleSearch = () => {
    void fetchHoldingsList(1);
  };

  const handleReset = () => {
    setSearchCharacterId('');
    setSearchNickname('');
    void fetchHoldingsList(1);
  };

  useEffect(() => {
    void fetchHoldingsList(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 玩家详细持仓 ----
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [characterHoldings, setCharacterHoldings] = useState<GmCharacterHoldingDto | null>(null);
  const [characterLoading, setCharacterLoading] = useState(false);

  const fetchCharacterHoldings = useCallback(async (characterId: number) => {
    setCharacterLoading(true);
    try {
      const result = await gmGetCharacterHoldings(characterId);
      if (result.success && result.data) {
        setCharacterHoldings(result.data);
      } else {
        message.error(result.message ?? '查询玩家持仓失败');
        setCharacterHoldings(null);
      }
    } catch {
      message.error('查询玩家持仓失败');
      setCharacterHoldings(null);
    } finally {
      setCharacterLoading(false);
    }
  }, [message]);

  const handleSelectCharacter = useCallback((characterId: number) => {
    if (selectedCharacterId === characterId) {
      setSelectedCharacterId(null);
      setCharacterHoldings(null);
    } else {
      setSelectedCharacterId(characterId);
      void fetchCharacterHoldings(characterId);
    }
  }, [selectedCharacterId, fetchCharacterHoldings]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedCharacterId(null);
    setCharacterHoldings(null);
  }, []);

  // ---- 强制抛售 ----
  const [sellingStockId, setSellingStockId] = useState<string | null>(null);

  const handleForceSell = useCallback((characterId: number, holding: GmCharacterHoldingItemDto) => {
    if (holding.availableQty <= 0) {
      message.warning('无可卖持仓');
      return;
    }

    let sellQuantity = holding.availableQty;
    modal.confirm({
      title: `确认强制抛售 ${holding.name}？`,
      content: (
        <Flex vertical gap={4} style={{ fontSize: 13 }}>
          <Text>角色：{characterHoldings?.nickname}(#{characterId})</Text>
          <Text>股票：{holding.name}（{holding.code}）</Text>
          <Text>持仓：{holding.quantity} 股（冻结 {holding.frozenQuantity} 股）</Text>
          <Text>可卖：{holding.availableQty} 股</Text>
          <Text>当前价：{holding.currentPriceSpiritStones} 灵石</Text>
          <Text>预估到账：约 {formatSpiritStones(holding.currentPriceSpiritStones * holding.availableQty)} 灵石</Text>
        </Flex>
      ),
      okText: '确认抛售',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSellingStockId(holding.stockId);
        try {
          const result = await gmForceSellStock(characterId, { stockId: holding.stockId, quantity: sellQuantity });
          if (result.success) {
            message.success(`抛售成功，卖出 ${result.soldQuantity ?? 0} 股，到账 ${formatSpiritStones(result.netAmountSpiritStones ?? 0)} 灵石`);
            // 刷新详情和汇总
            await fetchCharacterHoldings(characterId);
            await fetchHoldingsList(page);
          } else {
            message.error(result.message ?? '抛售失败');
          }
        } catch {
          message.error('抛售请求失败');
        } finally {
          setSellingStockId(null);
        }
      },
    });
  }, [characterHoldings, message, fetchCharacterHoldings, fetchHoldingsList, page]);

  // ---- 汇总列表列 ----
  const summaryColumns = useMemo<ColumnsType<GmPlayerHoldingSummaryDto>>(() => [
    {
      title: '角色ID',
      dataIndex: 'characterId',
      key: 'characterId',
      width: 80,
      fixed: 'left',
      render: (id: number) => <Typography.Text code>{id}</Typography.Text>,
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
      fixed: 'left',
      render: (name: string, record: GmPlayerHoldingSummaryDto) => (
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {record.title ? `[${record.title}] ` : ''}{name}
        </span>
      ),
    },
    {
      title: '持仓股数',
      dataIndex: 'totalHoldingQty',
      key: 'totalHoldingQty',
      width: 90,
      align: 'right',
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '市值',
      dataIndex: 'totalMarketValueSpiritStones',
      key: 'totalMarketValueSpiritStones',
      width: 100,
      align: 'right',
      render: (v: number) => formatSpiritStones(v),
    },
    {
      title: '成本',
      dataIndex: 'totalCostSpiritStones',
      key: 'totalCostSpiritStones',
      width: 100,
      align: 'right',
      render: (v: number) => formatSpiritStones(v),
    },
    {
      title: '浮盈亏',
      dataIndex: 'unrealizedPnlSpiritStones',
      key: 'unrealizedPnlSpiritStones',
      width: 100,
      align: 'right',
      render: (v: number) => {
        const tone = v > 0 ? 'green' : v < 0 ? 'red' : 'default';
        const sign = v > 0 ? '+' : '';
        return <Tag color={tone}>{sign}{formatSpiritStones(v)}</Tag>;
      },
    },
    {
      title: '已实现',
      dataIndex: 'realizedPnlSpiritStones',
      key: 'realizedPnlSpiritStones',
      width: 100,
      align: 'right',
      render: (v: number) => {
        const tone = v > 0 ? 'green' : v < 0 ? 'red' : 'default';
        const sign = v > 0 ? '+' : '';
        return <Tag color={tone}>{sign}{formatSpiritStones(v)}</Tag>;
      },
    },
    {
      title: '总盈亏',
      dataIndex: 'totalPnlSpiritStones',
      key: 'totalPnlSpiritStones',
      width: 110,
      align: 'right',
      sorter: (a: GmPlayerHoldingSummaryDto, b: GmPlayerHoldingSummaryDto) => a.totalPnlSpiritStones - b.totalPnlSpiritStones,
      defaultSortOrder: 'descend',
      render: (v: number) => {
        const tone = v > 0 ? 'green' : v < 0 ? 'red' : 'default';
        const sign = v > 0 ? '+' : '';
        return (
          <Tag color={tone} style={{ fontWeight: 600 }}>
            {sign}{formatSpiritStones(v)}
          </Tag>
        );
      },
    },
    {
      title: '股票数',
      dataIndex: 'stockCount',
      key: 'stockCount',
      width: 70,
      align: 'center',
      render: (v: number) => <Tag>{v} 支</Tag>,
    },
  ], []);

  return (
    <Card
      size="small"
      title="GM股市持仓查看器"
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void fetchHoldingsList(page)} loading={loading}>
          刷新
        </Button>
      }
      data-section="gm-stock-viewer"
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

      {/* 玩家汇总列表 */}
      {records.length === 0 && !loading ? (
        <Empty description="暂无持仓数据" />
      ) : (
        <Table<GmPlayerHoldingSummaryDto>
          columns={summaryColumns}
          dataSource={records}
          rowKey="characterId"
          size="small"
          loading={loading}
          pagination={{ pageSize, showSizeChanger: false, current: page }}
          scroll={{ x: 1000 }}
          style={{ fontSize: 13 }}
          onRow={(record) => ({
            onClick: () => handleSelectCharacter(record.characterId),
            style: {
              cursor: 'pointer',
              background: selectedCharacterId === record.characterId ? 'var(--bg-hover)' : undefined,
            },
          })}
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
            onChange={(p) => void fetchHoldingsList(p)}
          />
        </Flex>
      )}

      {/* Drawer 展示玩家详细持仓 */}
      <Drawer
        open={Boolean(selectedCharacterId)}
        onClose={handleCloseDrawer}
        width={800}
        title={characterHoldings ? `${characterHoldings.nickname} (#${characterHoldings.characterId}) 持仓详情` : '持仓详情'}
        extra={
          characterHoldings?.title && (
            <Tag color="blue" style={{ margin: 0 }}>{characterHoldings.title}</Tag>
          )
        }
      >
        <CharacterHoldingDrawer
          characterHoldings={characterHoldings}
          loading={characterLoading}
          sellingStockId={sellingStockId}
          onForceSell={selectedCharacterId != null
            ? (holding) => handleForceSell(selectedCharacterId, holding)
            : () => {}}
        />
      </Drawer>
    </Card>
  );
};

// ---- 玩家详细持仓 Drawer 内容 ----

interface CharacterHoldingDrawerProps {
  characterHoldings: GmCharacterHoldingDto | null;
  loading: boolean;
  sellingStockId: string | null;
  onForceSell: (holding: GmCharacterHoldingItemDto) => void;
}

function CharacterHoldingDrawer({
  characterHoldings,
  loading,
  sellingStockId,
  onForceSell,
}: CharacterHoldingDrawerProps): React.ReactNode {
  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!characterHoldings) {
    return <Empty description="无持仓数据" />;
  }

  const { portfolio, holdings } = characterHoldings;

  return (
    <Flex vertical gap={16}>
      {/* 持仓汇总卡片 */}
      <Card size="small" title="持仓汇总">
        <Descriptions column={2} size="small" data-element="holding-portfolio">
          <Descriptions.Item label="总股数">{portfolio.totalHoldingQty.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="总市值">{formatSpiritStones(portfolio.totalMarketValueSpiritStones)} 灵石</Descriptions.Item>
          <Descriptions.Item label="总成本">{formatSpiritStones(portfolio.totalCostSpiritStones)} 灵石</Descriptions.Item>
          <Descriptions.Item label="浮盈亏">
            <span className={getStockMarketToneClassName(resolveStockMarketTone(portfolio.totalUnrealizedPnlSpiritStones))}>
              {formatSpiritStones(portfolio.totalUnrealizedPnlSpiritStones)} 灵石
            </span>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* 持仓明细 */}
      {holdings.length === 0 ? (
        <Empty description="该角色暂无持仓" />
      ) : (
        <Table<GmCharacterHoldingItemDto>
          columns={[
            {
              title: '股票',
              key: 'stock',
              width: 140,
              render: (_: unknown, record: GmCharacterHoldingItemDto) => (
                <Flex vertical>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{record.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{record.code} · {record.sector}</span>
                </Flex>
              ),
            },
            {
              title: '持仓',
              dataIndex: 'quantity',
              key: 'quantity',
              width: 70,
              align: 'right',
              render: (v: number, record: GmCharacterHoldingItemDto) => (
                <Flex vertical align="flex-end">
                  <span>{v.toLocaleString()}</span>
                  {record.frozenQuantity > 0 && (
                    <span style={{ fontSize: 11, color: '#faad14' }}>(冻结 {record.frozenQuantity})</span>
                  )}
                </Flex>
              ),
            },
            {
              title: '可卖',
              dataIndex: 'availableQty',
              key: 'availableQty',
              width: 60,
              align: 'right',
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: '成本',
              dataIndex: 'costSpiritStones',
              key: 'costSpiritStones',
              width: 90,
              align: 'right',
              render: (v: number) => formatSpiritStones(v),
            },
            {
              title: '现价',
              dataIndex: 'currentPriceSpiritStones',
              key: 'currentPriceSpiritStones',
              width: 70,
              align: 'right',
              render: (v: number) => formatSpiritStones(v),
            },
            {
              title: '市值',
              dataIndex: 'marketValueSpiritStones',
              key: 'marketValueSpiritStones',
              width: 90,
              align: 'right',
              render: (v: number) => formatSpiritStones(v),
            },
            {
              title: '浮盈亏',
              key: 'unrealizedPnl',
              width: 100,
              align: 'right',
              render: (_: unknown, record: GmCharacterHoldingItemDto) => {
                const tone = resolveStockMarketTone(record.unrealizedPnlSpiritStones);
                const sign = record.unrealizedPnlSpiritStones > 0 ? '+' : '';
                return (
                  <Flex vertical align="flex-end">
                    <span className={getStockMarketToneClassName(tone)}>
                      {sign}{formatSpiritStones(record.unrealizedPnlSpiritStones)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {record.unrealizedPnlPercent > 0 ? '+' : ''}{record.unrealizedPnlPercent.toFixed(1)}%
                    </span>
                  </Flex>
                );
              },
            },
            {
              title: '操作',
              key: 'action',
              width: 80,
              fixed: 'right',
              render: (_: unknown, record: GmCharacterHoldingItemDto) => (
                <Button
                  size="small"
                  danger
                  icon={<FallOutlined />}
                  disabled={record.availableQty <= 0}
                  loading={sellingStockId === record.stockId}
                  onClick={() => onForceSell(record)}
                >
                  抛售
                </Button>
              ),
            },
          ]}
          dataSource={holdings}
          rowKey="stockId"
          size="small"
          pagination={false}
          scroll={{ x: 800 }}
          style={{ fontSize: 13 }}
        />
      )}
    </Flex>
  );
}

export default GmStockViewer;
