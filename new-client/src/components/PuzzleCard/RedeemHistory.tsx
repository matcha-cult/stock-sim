/**
 * 常驻刮刮乐兑奖历史列表。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示所有票据记录，支持分页，未兑奖中奖票据可在此兑奖。
 *    显示每个格子的数字及和值，中奖格子高亮。
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
import type { HistoryItemDto, MatchedLineDto } from '../../services/api/puzzleCard';

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

// 判断某格子是否中奖
const isCellMatched = (cellIndex: number, matchedLines: MatchedLineDto[], typeKey?: string): boolean => {
  const prefix = typeKey === 'SANYUAN' ? 'sanyuan_cell_' : 'cell_';
  return matchedLines.some(m => m.tierKey === `${prefix}${cellIndex}`);
};

// 七喜票据格子渲染：Space + Tag，中奖标绿
const QixiTicketGrid = ({ grid, matchedLines }: { grid: number[]; matchedLines: MatchedLineDto[] }) => {
  return (
    <Space size={[4, 4]} wrap>
      {Array.from({ length: 4 }, (_, i) => {
        const num1 = grid[i * 2];
        const num2 = grid[i * 2 + 1];
        const sum = num1 + num2;
        const matched = isCellMatched(i, matchedLines, 'QIXI');
        return (
          <Tag key={i} color={matched ? 'green' : undefined} style={{ margin: 0, width: 64, textAlign: 'center' }}>
            {num1}+{num2}={sum}
          </Tag>
        );
      })}
    </Space>
  );
};

// 三元票据格子渲染：Space + Tag，中奖标绿
const SanyuanTicketGrid = ({ grid, matchedLines }: { grid: number[]; matchedLines: MatchedLineDto[] }) => {
  return (
    <Space size={[4, 4]} wrap>
      {Array.from({ length: 6 }, (_, i) => {
        const num1 = grid[i * 3];
        const num2 = grid[i * 3 + 1];
        const num3 = grid[i * 3 + 2];
        const matched = isCellMatched(i, matchedLines, 'SANYUAN');
        return (
          <Tag key={i} color={matched ? 'green' : undefined} style={{ margin: 0, width: 64, textAlign: 'center' }}>
            {num1} {num2} {num3}
          </Tag>
        );
      })}
    </Space>
  );
};

// 根据类型渲染票据格子
const TicketGrid = ({ grid, matchedLines, typeKey }: { grid: number[]; matchedLines: MatchedLineDto[]; typeKey?: string }) => {
  if (typeKey === 'SANYUAN') {
    return <SanyuanTicketGrid grid={grid} matchedLines={matchedLines} />;
  }
  return <QixiTicketGrid grid={grid} matchedLines={matchedLines} />;
};

const RedeemHistory = ({
  items, total, page, pageSize, loading, redeeming, onRedeem, onPageChange,
}: RedeemHistoryProps) => {
  const isMobile = useIsMobile();

  // PC 端 Table
  if (!isMobile) {
    const columns = [
      { title: '票种', dataIndex: 'typeName', key: 'typeName' },
      { title: '票号', dataIndex: 'ticketNumber', key: 'ticketNumber', render: (v: number) => `#${v}` },
      {
        title: '票据', key: 'ticket',
        render: (_: unknown, item: HistoryItemDto) => item.ticketData?.grid ? (
          <TicketGrid grid={item.ticketData.grid} matchedLines={item.matchedLines} typeKey={item.typeKey} />
        ) : null,
      },
      {
        title: '购买时间', dataIndex: 'createdAt', key: 'createdAt',
        render: (v: number) => formatTime(v),
      },
      {
        title: '奖金', dataIndex: 'prizeAmount', key: 'prizeAmount',
        render: (v: number) => v > 0 ? <Text strong>{formatPrize(v)}</Text> : <Text type="secondary">—</Text>,
      },
      { title: '状态', key: 'status', render: (_: unknown, item: HistoryItemDto) => getStatusTag(item) },
      {
        title: '操作', key: 'action',
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
          scroll={{ x: 'max-content' }}
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

  // 移动端 Card
  return (
    <Flex vertical gap={12}>
      <List
        dataSource={items}
        loading={loading}
        renderItem={(item) => (
          <List.Item style={{ padding: 0, border: 'none', marginBottom: 2 }}>
            <Card size="small" style={{ width: '100%', position: 'relative' }}>
              {/* 右上角：票据号 */}
              <div style={{ position: 'absolute', top: 8, right: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>#{item.ticketNumber}</Text>
              </div>

              {/* 内容区域 */}
              <Flex vertical gap={8}>
                <Text strong>{item.typeName}</Text>

                {/* 票据 tags */}
                {item.ticketData?.grid && (
                  <TicketGrid grid={item.ticketData.grid} matchedLines={item.matchedLines} typeKey={item.typeKey} />
                )}

                {/* 底部行：奖金 + 状态 + 日期 */}
                <Flex justify="space-between" align="center">
                  <Flex gap={8} align="center" wrap>
                    <Text>
                      奖金：{item.prizeAmount > 0 ? <Text strong>{formatPrize(item.prizeAmount)}</Text> : <Text type="secondary">—</Text>}
                    </Text>
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

                  {/* 右下角：日期 */}
                  <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(item.createdAt)}</Text>
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
