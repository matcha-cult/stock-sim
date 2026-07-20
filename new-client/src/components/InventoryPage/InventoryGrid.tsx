/**
 * 统一背包系统 — 物品格子网格组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：用 CSS Grid 自适应列数展示物品格子网格，支持分页。
 * 2. 不做什么：不处理物品操作、不管理筛选状态。
 *
 * 输入 / 输出：
 * - 输入：物品列表、分页信息、加载状态、选中物品 ID、点击回调。
 * - 输出：物品网格 UI。
 *
 * 数据流 / 状态流：
 * 父组件传入数据 → CSS Grid 自适应渲染 → 用户点击物品 → 回调父组件。
 *
 * 复用设计说明：
 * - 网格容器用 div + CSS Grid（非 antd Row/Col），因为需要 grid-auto-rows 固定行高。
 * - 列数由 CSS auto-fill 自适应容器宽度，不固定列数（后端不按格子位置存储）。
 * - 使用 antd Empty/Spin/Pagination 处理空态、加载、分页。
 *
 * 关键边界条件与坑点：
 * 1. 每个格子最小 80px，CSS Grid auto-fill 根据容器宽度自动计算列数。
 * 2. 物品列表为空时显示 Empty 组件。
 * 3. 加载中时显示 Spin 组件。
 */

import React, { useCallback } from 'react';
import { Pagination, Empty, Spin, Flex } from 'antd';
import type { InventoryItemDto } from '../../services/api/inventory';
import InventoryItemCell from './InventoryItemCell';
import './InventoryGrid.css';

interface InventoryGridProps {
  items: InventoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  selectedItemId: number | null;
  onItemClick: (itemId: number) => void;
  onPageChange: (page: number) => void;
}

const InventoryGrid: React.FC<InventoryGridProps> = ({
  items,
  total,
  page,
  pageSize,
  loading,
  selectedItemId,
  onItemClick,
  onPageChange,
}) => {
  const handleItemClick = useCallback(
    (itemId: number) => {
      onItemClick(itemId);
    },
    [onItemClick],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      onPageChange(newPage);
    },
    [onPageChange],
  );

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 300 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (items.length === 0) {
    return <Empty description="背包为空" />;
  }

  return (
    <Flex vertical gap={16}>
      <div className="inv-grid">
        {items.map((item) => (
          <InventoryItemCell
            key={item.id}
            item={item}
            selected={selectedItemId === item.id}
            onClick={handleItemClick}
          />
        ))}
      </div>

      {total > pageSize && (
        <Flex justify="center">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={handlePageChange}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 个物品`}
          />
        </Flex>
      )}
    </Flex>
  );
};

export default InventoryGrid;
