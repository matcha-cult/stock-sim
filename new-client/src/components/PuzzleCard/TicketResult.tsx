/**
 * 常驻刮刮乐票据结果展示。
 *
 * 作用：一键开奖后展示 4 个格子的数字、和值、中奖状态、奖金。
 */
import { Row, Col, Flex, Typography, Tag } from 'antd';
import type { PuzzleTicketDto } from '../../services/api/puzzleCard';
import { QIXI_PRIZE_TIERS } from '../../services/api/puzzleCard';

const { Text, Title } = Typography;

interface TicketResultProps {
  ticket: PuzzleTicketDto;
  numbersPerCell: number;
}

const formatPrize = (amount: number): string => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toLocaleString();
};

const TicketResult = ({ ticket, numbersPerCell }: TicketResultProps) => {
  const grid = ticket.ticketData.grid;
  const totalCells = ticket.gridRows * ticket.gridCols;

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>{ticket.typeKey}</Title>
        <Text type="secondary">#{ticket.ticketNumber}</Text>
      </Flex>

      <Row gutter={[12, 12]}>
        {Array.from({ length: totalCells }, (_, cellIndex) => {
          const cellNumbers = grid.slice(cellIndex * numbersPerCell, (cellIndex + 1) * numbersPerCell);
          const cellSum = cellNumbers.reduce((a, b) => a + b, 0);
          const isWin = cellSum === 7;
          const tier = QIXI_PRIZE_TIERS[cellIndex];

          return (
            <Col key={cellIndex} span={12}>
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  border: `1px solid ${isWin ? '#52c41a' : 'var(--border-color)'}`,
                  borderRadius: 8,
                  background: isWin ? 'rgba(82, 196, 26, 0.05)' : 'var(--panel-bg)',
                }}
              >
                <Flex vertical gap={8} align="center">
                  <Text strong style={{ fontSize: 18 }}>
                    {cellNumbers.join(' + ')} = {cellSum}
                  </Text>
                  <Flex gap={8} align="center" wrap>
                    {isWin ? (
                      <Tag color="success" style={{ margin: 0 }}>中奖</Tag>
                    ) : (
                      <Tag style={{ margin: 0 }}>未中奖</Tag>
                    )}
                    {tier && (
                      <Text type="warning" style={{ fontSize: 13 }}>
                        {formatPrize(tier.prizeAmount)}
                      </Text>
                    )}
                  </Flex>
                </Flex>
              </div>
            </Col>
          );
        })}
      </Row>
    </Flex>
  );
};

export default TicketResult;
