/**
 * 常驻刮刮乐票种选择列表。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示所有可购买的票种卡片，点击触发购票。
 * 2. 不做什么：不处理购票逻辑（由 usePuzzleCard hook 负责）。
 *
 * 输入 / 输出：
 * - 输入：onPurchase 回调、isPurchasing 状态。
 * - 输出：票种卡片网格。
 *
 * 复用设计说明：
 * - 票种配置从 services/api/puzzleCard.ts 的 PUZZLE_CARD_TYPES 读取。
 * - 使用 antd Row/Col 响应式布局，PC 3 列、Mobile 1 列。
 *
 * 关键边界条件与坑点：
 * 1. 未开放的票种（isReady=false）显示"敬请期待"且不可点击。
 * 2. 购票中按钮显示 loading 状态，禁止重复点击。
 */
import { Row, Col, Card, Button, Tag, Typography, Flex } from 'antd';
import { useIsMobile } from '../../shared/responsive';
import { PUZZLE_CARD_TYPES } from '../../services/api/puzzleCard';

const { Text, Paragraph } = Typography;

interface TicketSelectProps {
  onPurchase: (typeKey: string) => void;
  onBatchPurchase: (typeKey: string) => void;
  isPurchasing: boolean;
  isBatchPurchasing: boolean;
  dailyPurchaseInfo: { todayCount: number; todayThreshold: number } | null;
}

// 开放所有已实装的票种
const READY_TYPE_KEYS = new Set(['QIXI', 'SANYUAN']);

const formatPrice = (price: number): string => {
  if (price >= 10000) return `${(price / 10000).toFixed(0)}万`;
  return price.toLocaleString();
};

const TicketSelect = ({ onPurchase, onBatchPurchase, isPurchasing, isBatchPurchasing, dailyPurchaseInfo }: TicketSelectProps) => {
  const isMobile = useIsMobile();
  const colSpan = isMobile ? 24 : 8;

  return (
    <Row gutter={[12, 12]}>
      {PUZZLE_CARD_TYPES.map((type) => {
        const isReady = READY_TYPE_KEYS.has(type.typeKey);

        return (
          <Col key={type.typeKey} span={colSpan}>
            <Card size="small">
              <Flex vertical gap={8}>
                <Text strong style={{ fontSize: 16 }}>{type.name}</Text>
                <Text type="danger" strong style={{ fontSize: 20 }}>
                  {formatPrice(type.price)} 灵石/张
                </Text>
                <Tag color="blue">{type.gridRows}×{type.gridCols} 格子</Tag>
                {dailyPurchaseInfo && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    今日已购 {dailyPurchaseInfo.todayCount} 张{dailyPurchaseInfo.todayCount >= dailyPurchaseInfo.todayThreshold ? '（已触发惩罚）' : `（距离惩罚还差 ${dailyPurchaseInfo.todayThreshold - dailyPurchaseInfo.todayCount} 张）`}
                  </Text>
                )}
                <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                  {type.description}
                </Paragraph>
                {type.rules && (
                  <Flex vertical gap={4} style={{ background: 'var(--panel-bg)', padding: 8, borderRadius: 4 }}>
                    <Text strong style={{ fontSize: 12 }}>玩法规则：</Text>
                    {type.rules.map((rule, i) => (
                      <Text key={i} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        • {rule}
                      </Text>
                    ))}
                  </Flex>
                )}
                <Flex gap={8}>
                  <Button
                    type="primary"
                    block
                    loading={isPurchasing}
                    disabled={!isReady || isBatchPurchasing}
                    onClick={() => onPurchase(type.typeKey)}
                  >
                    {isReady ? '购买 1 张' : '敬请期待'}
                  </Button>
                  <Button
                    block
                    loading={isBatchPurchasing}
                    disabled={!isReady || isPurchasing}
                    onClick={() => onBatchPurchase(type.typeKey)}
                  >
                    {isReady ? '批量 20 张' : '敬请期待'}
                  </Button>
                </Flex>
              </Flex>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
};

export default TicketSelect;
