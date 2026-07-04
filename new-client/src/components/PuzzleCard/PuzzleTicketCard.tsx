/**
 * 常驻刮刮乐票据卡片组件。
 *
 * 作用：渲染单张票据的卡片，显示票号、格子、奖金、状态。
 * 用于批量购买结果和兑奖历史列表。
 *
 * 输入 / 输出：
 * - 输入：票据数据（grid、matchedLines、prizeAmount、ticketNumber 等）
 * - 输出：移动端风格的 Card 组件
 *
 * 复用设计说明：
 * - 批量购买结果：每张票一个卡片
 * - 兑奖历史：每条记录一个卡片
 */
import { Card, Tag, Flex, Typography } from 'antd';
import type { MatchedLineDto } from '../../services/api/puzzleCard';

const { Text } = Typography;

interface PuzzleTicketCardProps {
  ticketNumber: number;
  typeName?: string;
  typeKey?: string;
  grid: number[];
  matchedLines: MatchedLineDto[];
  prizeAmount: number;
  redeemedAt?: number | null;
}

const formatPrize = (amount: number): string => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toLocaleString();
};

const isCellMatched = (cellIndex: number, matchedLines: MatchedLineDto[], typeKey?: string): boolean => {
  const prefix = typeKey === 'SANYUAN' ? 'sanyuan_cell_' : 'cell_';
  return matchedLines.some(m => m.tierKey === `${prefix}${cellIndex}`);
};

const QixiGrid = ({ grid, matchedLines }: { grid: number[]; matchedLines: MatchedLineDto[] }) => {
  return (
    <Flex gap={4} wrap>
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
    </Flex>
  );
};

const SanyuanGrid = ({ grid, matchedLines }: { grid: number[]; matchedLines: MatchedLineDto[] }) => {
  return (
    <Flex gap={4} wrap>
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
    </Flex>
  );
};

const PuzzleTicketCard = ({ ticketNumber, typeName, typeKey, grid, matchedLines, prizeAmount, redeemedAt }: PuzzleTicketCardProps) => {
  const statusTag = redeemedAt !== null && redeemedAt !== undefined
    ? <Tag color="green">已兑奖</Tag>
    : null;

  return (
    <Card size="small" style={{ width: '100%', maxWidth: 400, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, right: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>#{ticketNumber}</Text>
      </div>

      <Flex vertical gap={8}>
        {typeName && <Text strong>{typeName}</Text>}

        {typeKey === 'SANYUAN' ? (
          <SanyuanGrid grid={grid} matchedLines={matchedLines} />
        ) : (
          <QixiGrid grid={grid} matchedLines={matchedLines} />
        )}

        <Flex justify="space-between" align="center">
          <Flex gap={8} align="center">
            <Text>
              奖金：{prizeAmount > 0 ? <Text strong>{formatPrize(prizeAmount)}</Text> : <Text type="secondary">—</Text>}
            </Text>
            {statusTag}
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );
};

export default PuzzleTicketCard;
