/**
 * GM 新闻事件查看器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：以列表展示所有新闻事件，点击事件后以时间线展示完整续写链路。
 * 2. 不做什么：不参与任何业务逻辑，仅供 GM 查看和调试。
 *
 * 输入 / 输出：
 * - 输入：definitionMap（股票 ID -> 中文名映射），自行调用 API 拉取事件列表和续写链。
 * - 输出：事件列表 + 续写时间线（支持 Drawer 内联展示）。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> getNewsEventList() -> 渲染 Table -> 点击行 -> getNewsEventChain() -> 渲染 Timeline。
 *
 * 复用设计说明：
 * - API 调用复用 api.get()，涨跌颜色复用 resolveStockMarketTone / getStockMarketToneClassName。
 * - 时间格式化复用 formatStockMarketTime。
 *
 * 关键边界条件与坑点：
 * 1. 续写链可能为空（事件创建了但 tick 未关联），需要友好展示空状态。
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  App, Button, Card, Drawer, Empty, Flex, Spin, Table, Tag, Timeline, Typography,
} from 'antd';
const { Text } = Typography;
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import {
  getNewsEventList,
  getNewsEventChain,
  SILENT_API_REQUEST_CONFIG,
  type NewsEventDto,
  type NewsEventChainDto,
  type NewsEventChainTickDto,
} from '../../services/api/stockMarket';
import {
  resolveStockMarketTone,
  getStockMarketToneClassName,
  formatStockMarketTime,
} from '../../domain/stock-market/viewTransform';

const statusColorMap: Record<string, string> = {
  active: 'processing',
  cooling: 'warning',
  resolved: 'default',
};

interface GmNewsViewerProps {
  definitionMap: ReadonlyMap<string, string>;
}

const GmNewsViewer: React.FC<GmNewsViewerProps> = ({ definitionMap }) => {
  const { message } = App.useApp();

  const [events, setEvents] = useState<NewsEventDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [chainData, setChainData] = useState<NewsEventChainDto | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getNewsEventList(SILENT_API_REQUEST_CONFIG);
      if (response.success) {
        setEvents(response.data ?? []);
      } else {
        message.error(response.message ?? '加载事件列表失败');
      }
    } catch {
      message.error('加载事件列表失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  const fetchChain = useCallback(async (eventId: string) => {
    setChainLoading(true);
    try {
      const response = await getNewsEventChain(eventId, SILENT_API_REQUEST_CONFIG);
      if (response.success) {
        setChainData(response.data ?? null);
      } else {
        message.error(response.message ?? '加载续写链失败');
        setChainData(null);
      }
    } catch {
      message.error('加载续写链失败');
      setChainData(null);
    } finally {
      setChainLoading(false);
    }
  }, [message]);

  const handleSelectEvent = useCallback((eventId: string) => {
    if (selectedEventId === eventId) {
      setSelectedEventId(null);
      setChainData(null);
    } else {
      setSelectedEventId(eventId);
      void fetchChain(eventId);
    }
  }, [selectedEventId, fetchChain]);

  const handleCloseChain = useCallback(() => {
    setSelectedEventId(null);
    setChainData(null);
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const eventColumns = useMemo<ColumnsType<NewsEventDto>>(() => [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
      render: (id: string) => <Text code>{id}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: string) => (
        <Tag color={statusColorMap[status] ?? 'default'}>{status}</Tag>
      ),
    },
    {
      title: '主题',
      dataIndex: 'theme',
      key: 'theme',
      width: 120,
      ellipsis: true,
      render: (theme: string) => <Text style={{ fontSize: 13 }}>{theme}</Text>,
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      key: 'stage',
      width: 80,
      render: (stage: string) => <Text style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{stage}</Text>,
    },
    {
      title: '关联股票',
      dataIndex: 'affectedStockIds',
      key: 'affectedStockIds',
      width: 140,
      render: (ids: string[]) => (
        <Flex gap={4} wrap="wrap">
          {ids.slice(0, 3).map((id) => (
            <Tag key={id} style={{ margin: 0, fontSize: 11 }}>{definitionMap.get(id) ?? id}</Tag>
          ))}
          {ids.length > 3 && <Tag style={{ margin: 0 }}>+{ids.length - 3}</Tag>}
        </Flex>
      ),
    },
    {
      title: '续写次数',
      dataIndex: 'continuationCount',
      key: 'continuationCount',
      width: 70,
      align: 'right',
      render: (count: number) => <Text style={{ fontWeight: 500 }}>{count}</Text>,
    },
    {
      title: '最后续写',
      dataIndex: 'lastContinuedAt',
      key: 'lastContinuedAt',
      width: 140,
      render: (ts: number | null) => ts ? formatStockMarketTime(ts) : '—',
    },
  ], [definitionMap]);

  const selectedEventInfo = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  return (
    <Card
      size="small"
      title="GM新闻事件查看器"
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={fetchEvents} loading={loading}>
          刷新
        </Button>
      }
      data-section="gm-news-viewer"
    >
      {/* 事件列表 */}
      {events.length === 0 && !loading ? (
        <Empty description="暂无事件数据" />
      ) : (
        <Table<NewsEventDto>
          columns={eventColumns}
          dataSource={events}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          loading={loading}
          scroll={{ x: 800 }}
          style={{ fontSize: 13 }}
          onRow={(record) => ({
            onClick: () => handleSelectEvent(record.id),
            style: {
              cursor: 'pointer',
              background: selectedEventId === record.id ? 'var(--bg-hover)' : undefined,
            },
          })}
        />
      )}

      {/* Drawer 模式展示续写链 */}
      <Drawer
        open={Boolean(selectedEventId)}
        onClose={handleCloseChain}
        width={720}
        title={selectedEventInfo ? `${selectedEventInfo.theme} (ID: ${selectedEventInfo.id})` : '事件续写链'}
        extra={
          <Tag color={statusColorMap[selectedEventInfo?.status ?? '']} style={{ margin: 0 }}>
            {selectedEventInfo?.status}
          </Tag>
        }
      >
        <ChainTimeline
          chainData={chainData}
          loading={chainLoading}
        />
      </Drawer>
    </Card>
  );
};

// ---- 续写时间线子组件 ----

interface ChainTimelineProps {
  chainData: NewsEventChainDto | null;
  loading: boolean;
}

function ChainTimeline({ chainData, loading }: ChainTimelineProps): React.ReactNode {
  if (loading) {
    return (
      <Card size="small">
        <Flex justify="center" style={{ padding: 24 }}>
          <Spin size="small" />
        </Flex>
      </Card>
    );
  }

  if (!chainData) {
    return (
      <Card size="small">
        <Empty description="无续写数据" />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title="续写链路"
      extra={
        <Flex gap={8} align="center">
          <Tag color="processing">{chainData.ticks.length} 个 tick</Tag>
        </Flex>
      }
    >
      {/* 事件基本信息 */}
      <Flex vertical gap={8} style={{ marginBottom: 16 }}>
        <Flex gap={8} align="center">
          <Text strong>事件：</Text>
          <Text style={{ fontSize: 13 }}>{chainData.event.headline || chainData.event.theme}</Text>
        </Flex>
        <Flex gap={8} align="center">
          <Text strong>阶段：</Text>
          <Text style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{chainData.event.stage}</Text>
        </Flex>
        {chainData.event.summary && (
          <Text style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{chainData.event.summary}</Text>
        )}
      </Flex>

      {/* 时间线 */}
      {chainData.ticks.length === 0 ? (
        <Empty description="该事件暂无续写记录" />
      ) : (
        <Timeline
          items={chainData.ticks.map((tick) => ({
            children: <TickNode key={tick.tickId} tick={tick} />,
          }))}
        />
      )}
    </Card>
  );
}

// ---- 单个 tick 节点 ----

interface TickNodeProps {
  tick: NewsEventChainTickDto;
}

function TickNode({ tick }: TickNodeProps): React.ReactNode {
  return (
    <Flex vertical gap={6}>
      {/* 时间 + 状态 */}
      <Flex justify="space-between" align="center">
        <Text style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {formatStockMarketTime(tick.tickHour)}
        </Text>
        <Tag style={{ fontSize: 11, padding: '0 6px' }}>{tick.status}</Tag>
      </Flex>

      {/* 新闻标题 + 摘要 */}
      {tick.headline && (
        <Text strong style={{ fontSize: 13 }}>{tick.headline}</Text>
      )}
      {tick.summary && (
        <Text style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tick.summary}</Text>
      )}

      {/* 影响股票 */}
      {tick.impacts.length > 0 && (
        <Flex vertical gap={2} style={{ marginTop: 4 }}>
          {tick.impacts.map((impact) => {
            const tone = resolveStockMarketTone(impact.changeBps);
            const sign = impact.changeBps > 0 ? '+' : '';
            return (
              <Flex key={impact.stockId} justify="space-between" align="center">
                <Text style={{ fontSize: 12 }}>{impact.stockName}</Text>
                <Text className={getStockMarketToneClassName(tone)} style={{ fontSize: 12, fontWeight: 500 }}>
                  {sign}{impact.changeBps.toFixed(2)}bp
                </Text>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}

export default GmNewsViewer;
