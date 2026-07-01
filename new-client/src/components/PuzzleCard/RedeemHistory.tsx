/**
 * 常驻刮刮乐兑奖历史列表。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示所有票据记录，支持分页，未兑奖中奖票据可在此兑奖。
 * 2. 不做什么：不处理购票逻辑（由 TicketSelect 负责）。
 *
 * 输入 / 输出：
 * - 输入：历史数据、加载状态、兑奖回调、分页回调。
 * - 输出：PC 端 Table，Mobile 端 List+Card。
 *
 * 复用设计说明：
 * - PC 端使用 antd Table 展示完整信息。
 * - Mobile 端使用 antd List + Card 适配触控。
 * - 时间格式化统一走 formatTime 工具函数。
 *
 * 关键边界条件与坑点：
 * 1. 未兑奖 + 中奖的票据才显示"兑奖"按钮。
 * 2. 已兑奖的票据显示"已兑奖"文本，无操作按钮。
 * 3. 未中奖的票据不显示任何操作（购票时已扣费，无奖金可领）。
 */
import { Table, List, Card, Tag, Button, Flex, Typography, Pagination, Space } from 'antd';
import { useIsMobile } from '../../shared/responsive';
import type { HistoryItemDto } from '../../services/api/puzzleCard';

const { Text } = Typography;

interface RedeemHistoryProps {
  items: HistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  redeeming: boolean;
  onRedeem: (item: HistoryItemDto) => void;
  onPageChange: (page: number) => void;
}

const formatPrize = (amount: number): string => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toLocaleString();
};

const formatTime = (ts: number): string => {
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const getStatusTag = (item: HistoryItemDto) => {
  if (item.redeemedAt !== null) return <Tag color="green">已兑奖</Tag>;
  if (item.prizeAmount > 0) return <Tag color="gold">待兑奖</Tag>;
  return <Tag>未中奖</Tag>;
};

const RedeemHistory = ({
  items, total, page, pageSize, loading, redeeming, onRedeem, onPageChange,
}: RedeemHistoryProps) => {
  const isMobile = useIsMobile();

  // PC 端 Table
  if (!isMobile) {
    const columns = [
      { title: '票种', dataIndex: 'typeName', key: 'typeName', width: 80 },
      { title: '票号', dataIndex: 'ticketNumber', key: 'ticketNumber', width: 80, render: (v: number) => `#${v}` },
      {
        title: '购买时间', dataIndex: 'createdAt', key: 'createdAt', width: 120,
        render: (v: number) => formatTime(v),
      },
      {
        title: '奖金', dataIndex: 'prizeAmount', key: 'prizeAmount', width: 120,
        render: (v: number) => v > 0 ? <Text strong>{formatPrize(v)}</Text> : <Text type="secondary">—</Text>,
      },
      { title: '状态', key: 'status', width: 100, render: (_: unknown, item: HistoryItemDto) => getStatusTag(item) },
      {
        title: '操作', key: 'action', width: 100,
        render: (_: unknown, item: HistoryItemDto) => {
          if (item.redeemedAt !== null) return <Text type="secondary">已兑奖</Text>;
          if (item.prizeAmount <= 0) return null;
          return (
            <Button
              type="primary"
              size="small"
              loading={redeeming}
              onClick={() => onRedeem(item)}
            >
              兑奖
            </Button>
          );
        },
      },
    ];

    return (
      <Flex vertical gap={12}>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
        {total > pageSize && (
          <Flex justify="center">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={onPageChange}
              size="small"
            />
          </Flex>
        )}
      </Flex>
    );
  }

  // Mobile 端 List + Card
  return (
    <Flex vertical gap={12}>
      <List
        dataSource={items}
        loading={loading}
        renderItem={(item) => (
          <List.Item style={{ padding: 0, border: 'none' }}>
            <Card size="small" style={{ width: '100%' }}>
              <Flex justify="space-between" align="center">
                <Flex vertical gap={4}>
                  <Text strong>{item.typeName} #{item.ticketNumber}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(item.createdAt)}</Text>
                  <Text>
                    奖金：{item.prizeAmount > 0 ? <Text strong>{formatPrize(item.prizeAmount)}</Text> : <Text type="secondary">—</Text>}
                  </Text>
                </Flex>
                <Flex vertical align="flex-end" gap={4}>
                  {getStatusTag(item)}
                  {item.redeemedAt === null && item.prizeAmount > 0 && (
                    <Button
                      type="primary"
                      size="small"
                      loading={redeeming}
                      onClick={() => onRedeem(item)}
                    >
                      兑奖
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Card>
          </List.Item>
        )}
      />
      {total > pageSize && (
        <Flex justify="center">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={onPageChange}
            size="small"
          />
        </Flex>
      )}
    </Flex>
  );
};

export default RedeemHistory;
