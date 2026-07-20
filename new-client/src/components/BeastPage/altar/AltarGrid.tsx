/**
 * 祭坛 6 格网格组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：渲染 6 个祭品格子的布局，响应式适配桌面端和移动端。
 * 2. 不做什么：不处理祭品选择逻辑（由父组件处理）。
 *
 * 数据流 / 状态流：
 * 父组件传入 offerings 数组 -> 渲染 6 个格子 -> 点击触发 onSlotClick。
 *
 * 复用设计说明：
 * - 纯布局组件，无状态，使用 antd Row/Col 实现响应式网格。
 * - 桌面端和移动端使用相同的 2x3 网格布局（更简洁一致）。
 *
 * 关键边界条件与坑点：
 * 1. offerings 数组长度固定为 6，空位用 null 填充。
 * 2. 移动端和桌面端布局保持一致，避免复杂切换。
 */
import { Row, Col } from 'antd';
import AltarSlot from './AltarSlot.js';
import type { OfferingDto } from '../../../services/api/beast.js';

interface AltarGridProps {
  offerings: (OfferingDto | null)[];
  onSlotClick: (index: number) => void;
  onSlotClear: (index: number) => void;
}

const AltarGrid = function AltarGrid({ offerings, onSlotClick, onSlotClear }: AltarGridProps) {
  return (
    <Row gutter={[16, 16]} justify="center">
      {offerings.map((offering, index) => (
        <Col key={index} span={8}>
          <AltarSlot
            index={index}
            itemName={offering?.name ?? null}
            quantity={offering?.quantity ?? null}
            tradeUnit={offering?.tradeUnit}
            element={offering?.element}
            quality={offering?.quality}
            onClick={() => onSlotClick(index)}
            onClear={() => onSlotClear(index)}
          />
        </Col>
      ))}
    </Row>
  );
};

export default AltarGrid;
