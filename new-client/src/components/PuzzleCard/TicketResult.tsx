/**
 * 常驻刮刮乐票据结果展示。
 *
 * 作用：一键开奖后展示格子的数字、中奖状态、奖金。
 * 支持七喜（和为7）和三元（三个相同）两种玩法。
 */
import { Row, Col, Flex, Typography, Tag } from 'antd';
import type { PuzzleTicketDto } from '../../services/api/puzzleCard';
import { QIXI_PRIZE_TIERS, SANYUAN_PRIZE_TIERS } from '../../services/api/puzzleCard';

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
  const isSanyuan = ticket.typeKey === 'SANYUAN';
  const prizeTiers = isSanyuan ? SANYUAN_PRIZE_TIERS : QIXI_PRIZE_TIERS;

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>{ticket.typeKey}</Title>
        <Text type="secondary">#{ticket.ticketNumber}</Text>
      </Flex>

      <Row gutter={[12, 12]}>
        {Array.from({ length: totalCells }, (_, cellIndex) => {
          const cellNumbers = grid.slice(cellIndex * numbersPerCell, (cellIndex + 1) * numbersPerCell);
          const tier = prizeTiers[cellIndex];

          // 七喜：和为7中奖；三元：三个数字相同中奖
          let isWin: boolean;
          let displayText: string;

          if (isSanyuan) {
            isWin = cellNumbers[0] === cellNumbers[1] && cellNumbers[1] === cellNumbers[2];
            displayText = cellNumbers.join(' ');
          } else {
            const cellSum = cellNumbers.reduce((a, b) => a + b, 0);
            isWin = cellSum === 7;
            displayText = `${cellNumbers.join(' + ')} = ${cellSum}`;
          }

          return (
            <Col key={cellIndex} span={isSanyuan ? 8 : 12}>
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
                    {displayText}
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
