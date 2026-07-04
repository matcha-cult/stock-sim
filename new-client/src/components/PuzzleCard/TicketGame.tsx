/**
 * 常驻刮刮乐票据交互区。
 *
 * 作用：一键开奖 + 兑奖。购买后直接展示结果，用户点击兑奖即可。
 */
import { useState, useCallback } from 'react';
import { Card, Button, Flex, Typography, Alert, Result } from 'antd';
import TicketResult from './TicketResult';
import type { PuzzleTicketDto } from '../../services/api/puzzleCard';
import { PUZZLE_CARD_TYPES } from '../../services/api/puzzleCard';

const { Text } = Typography;

interface TicketGameProps {
  ticket: PuzzleTicketDto;
  onRedeem: () => void;
  onContinue: () => void;
  onBuyAnother: () => void;
  isRedeeming: boolean;
  todayCount?: number;
  todayThreshold?: number;
}

const formatPrize = (amount: number): string => {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}亿`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)}万`;
  return amount.toLocaleString();
};

const TicketGame = ({ ticket, onRedeem, onContinue, onBuyAnother, isRedeeming, todayCount, todayThreshold }: TicketGameProps) => {
  const [redeemed, setRedeemed] = useState(false);

  const typeConfig = PUZZLE_CARD_TYPES.find(t => t.typeKey === ticket.typeKey);
  const numbersPerCell = typeConfig?.numbersPerCell ?? 1;
  const isWinner = ticket.prizeAmount > 0;

  const handleRedeem = useCallback(() => {
    onRedeem();
    setRedeemed(true);
  }, [onRedeem]);

  if (redeemed) {
    return (
      <Result
        status={isWinner ? 'success' : 'info'}
        title={isWinner ? '兑奖成功' : '未中奖'}
        subTitle={isWinner ? `+${formatPrize(ticket.prizeAmount)} 灵石已到账` : '很遗憾，未中奖'}
        extra={
          <Button type="primary" onClick={onContinue}>
            继续刮奖
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <Flex vertical gap={16}>
        <TicketResult ticket={ticket} numbersPerCell={numbersPerCell} />

        {isWinner ? (
          <Alert
            type="success"
            showIcon
            message={`恭喜中奖！共 ${ticket.matchedLines.length} 格中奖 — ${formatPrize(ticket.prizeAmount)} 灵石`}
          />
        ) : (
          <Alert type="info" showIcon message="未中奖" />
        )}

        <Flex justify="center" gap={12}>
          {isWinner && (
            <Button
              type="primary"
              size="large"
              onClick={handleRedeem}
              loading={isRedeeming}
            >
              兑奖
            </Button>
          )}
          <Button
            size="large"
            onClick={onBuyAnother}
          >
            再买一张
          </Button>
        </Flex>

        <Flex justify="center">
          <Text type="secondary">票价 {formatPrize(ticket.pricePaid)}</Text>
        </Flex>

        {todayCount !== undefined && todayThreshold !== undefined && (
          <Flex justify="center">
            <Text type="secondary" style={{ fontSize: 11 }}>
              今日已购 {todayCount} 张{todayCount >= todayThreshold ? '（已触发惩罚）' : `（距离惩罚还差 ${todayThreshold - todayCount} 张）`}
            </Text>
          </Flex>
        )}

        <Alert
          type="warning"
          showIcon
          message="限流提示"
          description="购票/兑奖限制：5秒内最多2次操作，请勿频繁点击"
          style={{ fontSize: 12 }}
        />
      </Flex>
    </Card>
  );
};

export default TicketGame;
