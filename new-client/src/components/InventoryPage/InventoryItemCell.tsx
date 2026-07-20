/**
 * 统一背包系统 — 物品格子组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示单个物品的图标、名称、数量角标、稀有度角标，处理点击选中。
 * 2. 不做什么：不处理物品操作、不管理状态、不渲染详情。
 *
 * 输入 / 输出：
 * - 输入：物品数据（InventoryItemDto）、选中状态、点击回调。
 * - 输出：物品格子 UI（div 容器 + CSS class 控制样式）。
 *
 * 数据流 / 状态流：
 * 父组件传入物品数据 → 渲染格子（图标 + 名称 + 角标）→ 用户点击 → 回调父组件。
 *
 * 复用设计说明：
 * - 格子容器用 div + CSS class（非 antd Card），因为需要自定义边框着色和角标绝对定位。
 * - 图标复用 ItemIcon 组件。
 * - 角标用 CSS 绝对定位实现，避免 antd Badge 的额外 DOM 和样式开销。
 * - 纯展示组件，不使用 observer（数据通过 props 传入，无 MobX observable 读取）。
 *
 * 关键边界条件与坑点：
 * 1. 数量角标仅在 quantity > 1 时显示（九州项目逻辑：stackMax > 1 的物品才需要角标）。
 * 2. 稀有度角标仅在 rarity 非 'common' 时显示，避免低品质物品角标过多。
 * 3. 选中态通过 is-active class 控制，边框色覆盖稀有度边框色。
 */

import React from 'react';
import { Tooltip } from 'antd';
import type { InventoryItemDto } from '../../services/api/inventory';
import { RARITY_LABELS } from './constants';
import ItemIcon from './ItemIcon';
import './InventoryItemCell.css';

interface InventoryItemCellProps {
  item: InventoryItemDto;
  selected: boolean;
  onClick: (itemId: number) => void;
}

const getRarityClass = (rarity: string | null): string => {
  if (!rarity) return 'inv-rarity-common';
  return `inv-rarity-${rarity}`;
};

const InventoryItemCell: React.FC<InventoryItemCellProps> = ({
  item,
  selected,
  onClick,
}) => {
  const showQty = item.quantity > 1;
  const showRarity = item.rarity && item.rarity !== 'common';

  const cellClasses = [
    'inv-cell',
    getRarityClass(item.rarity),
    selected ? 'is-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cellClasses}
      onClick={() => onClick(item.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(item.id);
        }
      }}
    >
      {showQty && (
        <span className="inv-cell__qty">{item.quantity}</span>
      )}
      {showRarity && item.rarity && (
        <span className="inv-cell__rarity">
          {RARITY_LABELS[item.rarity] || item.rarity}
        </span>
      )}
      <div className="inv-cell__icon">
        <ItemIcon icon={item.icon} size={34} />
      </div>
      <Tooltip title={item.itemName} mouseEnterDelay={0.5}>
        <div className="inv-cell__name">{item.itemName}</div>
      </Tooltip>
    </div>
  );
};

export default InventoryItemCell;
