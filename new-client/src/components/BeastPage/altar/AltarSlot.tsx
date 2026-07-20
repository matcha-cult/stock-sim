/**
 * 祭坛单个格子组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示单个祭品格子的状态（空/已放置祭品），响应点击事件。
 * 2. 不做什么：不处理祭品选择逻辑（由父组件处理）。
 *
 * 数据流 / 状态流：
 * 父组件传入 item 和 quantity -> 渲染格子 -> 点击触发 onClick。
 *
 * 复用设计说明：
 * - 纯展示组件，无状态，可复用于任何需要展示单格物品的场景。
 * - 使用 antd Card + Badge 组合，自动适配主题。
 *
 * 关键边界条件与坑点：
 * 1. 空状态和已放置状态的视觉区分要清晰。
 * 2. 移动端点击区域要足够大（至少 80x80px）。
 */
import { Card, Tag, Typography, Flex, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

const { Text } = Typography;

// 品质标签映射
const QUALITY_MAP: Record<string, { label: string; color: string }> = {
  hq: { label: '优质', color: 'gold' },
  normal: { label: '普通', color: 'default' },
  lq: { label: '劣质', color: 'gray' },
};

interface AltarSlotProps {
  index: number;
  itemName: string | null;
  quantity: number | null;
  tradeUnit?: number;
  element?: string[];
  quality?: 'hq' | 'normal' | 'lq';
  onClick: () => void;
  onClear?: () => void;
}

const AltarSlot = function AltarSlot({
  index,
  itemName,
  quantity,
  tradeUnit,
  element,
  quality,
  onClick,
  onClear,
}: AltarSlotProps) {
  const isEmpty = !itemName;
  const qualityInfo = quality ? QUALITY_MAP[quality] : null;

  return (
    <Card
      hoverable
      size="small"
      style={{
        width: 80,
        height: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: isEmpty ? '1px dashed #d9d9d9' : undefined,
        position: 'relative',
      }}
      onClick={onClick}
    >
      {!isEmpty && onClear && (
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            padding: 0,
            width: 20,
            height: 20,
            minWidth: 20,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        />
      )}
      {isEmpty ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          祭品 {index + 1}
        </Text>
      ) : (
        <Flex vertical align="center" gap={4}>
          <Text strong style={{ fontSize: 12, textAlign: 'center' }}>
            {itemName}
          </Text>
          {qualityInfo && (
            <Tag color={qualityInfo.color} style={{ fontSize: 10, padding: '0 4px', margin: 0 }}>
              {qualityInfo.label}
            </Tag>
          )}
          <Text style={{ fontSize: 11, color: '#666' }}>
            ×{tradeUnit ?? 1}
          </Text>
          {element && element.length > 0 && (
            <Flex gap={2}>
              {element.map((e) => (
                <Tag key={e} color="blue" style={{ fontSize: 10, padding: '0 4px' }}>
                  {e}
                </Tag>
              ))}
            </Flex>
          )}
        </Flex>
      )}
    </Card>
  );
};

export default AltarSlot;
