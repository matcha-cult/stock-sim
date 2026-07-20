/**
 * 召唤控制区域组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示灵石输入、资质加成、召唤按钮。
 * 2. 不做什么：不处理召唤逻辑（由父组件处理）。
 *
 * 数据流 / 状态流：
 * 父组件传入 spiritStones 和 minSpiritStones -> 用户输入 -> 触发 onChange 和 onSummon。
 *
 * 复用设计说明：
 * - 使用 antd InputNumber + Progress + Button 组合。
 * - 实时计算资质加成（每倍+2%，上限+10%）。
 *
 * 关键边界条件与坑点：
 * 1. 灵石数量必须 >= minSpiritStones 才能召唤。
 * 2. 资质加成公式：multiples = floor(spiritStones / minSpiritStones)，bonusPercent = min(10%, (multiples - 1) * 2%)。
 */
import { InputNumber, Progress, Button, Typography, Space, Flex } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface SummonControlsProps {
  spiritStones: number;
  onSpiritStonesChange: (value: number) => void;
  minSpiritStones: number;
  isGenerating: boolean;
  onSummon: (count: number) => void;
  disabled?: boolean;
}

const QUICK_ADD_AMOUNTS = [
  { amount: 100000, label: '+10w' },
  { amount: 200000, label: '+20w' },
  { amount: 500000, label: '+50w' },
  { amount: 1000000, label: '+100w' },
  { amount: -1000000, label: '-100w' },
  { amount: -500000, label: '-50w' },
  { amount: -200000, label: '-20w' },
  { amount: -100000, label: '-10w' },
];

const SummonControls = function SummonControls({
  spiritStones,
  onSpiritStonesChange,
  minSpiritStones,
  isGenerating,
  onSummon,
  disabled,
}: SummonControlsProps) {
  const canSummon = spiritStones >= minSpiritStones && !disabled;

  const handleQuickAdd = (amount: number) => {
    const newValue = Math.max(0, spiritStones + amount);
    onSpiritStonesChange(newValue);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Text strong>最低灵石需求：{minSpiritStones.toLocaleString()}</Text>

      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Text>投入灵石数量：</Text>
        <InputNumber
          style={{ width: '100%' }}
          value={spiritStones}
          onChange={(value) => onSpiritStonesChange(value ?? 0)}
          min={0}
          precision={0}
          placeholder="请输入灵石数量"
          disabled={isGenerating}
        />
        <Flex gap={8} wrap="wrap">
          {QUICK_ADD_AMOUNTS.map(({ amount, label }) => (
            <Button
              key={label}
              size="small"
              onClick={() => handleQuickAdd(amount)}
              disabled={isGenerating}
            >
              {label}
            </Button>
          ))}
        </Flex>
      </Space>

      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Text>
          灵石进度：{spiritStones.toLocaleString()} / {minSpiritStones.toLocaleString()}
          {spiritStones > minSpiritStones && (
            <Text type="success" style={{ marginLeft: 8 }}>
              ({Math.floor((spiritStones / minSpiritStones) * 100)}%)
              {spiritStones >= minSpiritStones * 2 && '（获得了额外加成）'}
            </Text>
          )}
        </Text>
        <Progress
          percent={Math.floor((spiritStones / minSpiritStones) * 100)}
          status={spiritStones >= minSpiritStones ? 'success' : 'active'}
          strokeColor={spiritStones >= minSpiritStones * 2 ? '#ff4d4f' : undefined}
        />
      </Space>

      <Flex gap={8}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={isGenerating}
          onClick={() => onSummon(1)}
          disabled={!canSummon}
          size="large"
          style={{ flex: 1 }}
        >
          开始召唤
        </Button>
        <Button
          icon={<ThunderboltOutlined />}
          loading={isGenerating}
          onClick={() => onSummon(10)}
          disabled={!canSummon}
          size="large"
          style={{ flex: 1 }}
        >
          召唤10次
        </Button>
      </Flex>
    </Space>
  );
};

export default SummonControls;
