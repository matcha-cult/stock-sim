/**
 * 统一背包系统 — 主页面组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：整合物品网格、物品详情、筛选组件，提供完整的背包管理界面。
 * 2. 不做什么：不处理具体业务逻辑，只负责界面布局和状态协调。
 *
 * 输入 / 输出：
 * - 输入：RootStore 的 inventoryStore。
 * - 输出：背包管理界面。
 *
 * 数据流 / 状态流：
 * 页面加载 → inventoryStore.fetchItems() → 渲染物品网格 → 用户选中物品 → inventoryStore.selectItem() → 渲染物品详情。
 *
 * 复用设计说明：
 * - 使用 antd Row + Col 实现左右分栏布局（PC 端）。
 * - 使用 antd Card 作为容器，自动适配暗黑模式。
 * - 使用 antd Flex 实现垂直布局和间距控制。
 * - 使用 useIsMobile 实现响应式适配。
 *
 * 关键边界条件与坑点：
 * 1. PC 端采用左右分栏布局（60% 物品网格 + 40% 物品详情）。
 * 2. 移动端采用单列布局，物品详情使用 Modal 展示。
 * 3. 首次挂载时自动加载物品列表。
 */

import React, { useContext, useEffect, useCallback } from 'react';
import { Row, Col, Card, Flex, Typography, Drawer } from 'antd';
import { observer } from 'mobx-react-lite';
import { RootStoreContext } from '../../stores/RootStore';
import { useIsMobile } from '../../shared/responsive';
import InventoryGrid from './InventoryGrid';
import InventoryDetail from './InventoryDetail';
import InventoryFilter from './InventoryFilter';

const { Title } = Typography;

const InventoryPage = observer(function InventoryPage() {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  const { inventoryStore } = rootStore;
  const isMobile = useIsMobile();

  // 首次挂载时加载物品列表
  useEffect(() => {
    if (inventoryStore.items.length === 0 && inventoryStore.total === 0) {
      inventoryStore.fetchItems(1);
    }
  }, []);

  // 物品点击回调
  const handleItemClick = useCallback(
    (itemId: number) => {
      inventoryStore.selectItem(itemId);
    },
    [inventoryStore],
  );

  // 分页变更回调
  const handlePageChange = useCallback(
    (page: number) => {
      inventoryStore.fetchItems(page);
    },
    [inventoryStore],
  );

  // 筛选变更回调
  const handleFilterChange = useCallback(
    (filters: Partial<import('../../services/api/inventory').InventoryFilters>) => {
      inventoryStore.setFilters(filters);
    },
    [inventoryStore],
  );

  // 清除筛选回调
  const handleClearFilters = useCallback(() => {
    inventoryStore.clearFilters();
  }, [inventoryStore]);

  // 出售物品回调
  const handleSell = useCallback(
    async (itemId: number, quantity: number) => {
      return await inventoryStore.sellItem(itemId, quantity);
    },
    [inventoryStore],
  );

  // PC 端布局：左右分栏
  if (!isMobile) {
    return (
      <Flex vertical gap={16} style={{ padding: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          背包
        </Title>

        {/* 筛选区域 */}
        <Card size="small">
          <InventoryFilter
            filters={inventoryStore.filters}
            onFilterChange={handleFilterChange}
            onClear={handleClearFilters}
          />
        </Card>

        {/* 物品网格 + 详情 */}
        <Row gutter={16}>
          <Col span={14}>
            <Card>
              <InventoryGrid
                items={inventoryStore.items}
                total={inventoryStore.total}
                page={inventoryStore.page}
                pageSize={inventoryStore.pageSize}
                loading={inventoryStore.loading}
                selectedItemId={inventoryStore.selectedItemId}
                onItemClick={handleItemClick}
                onPageChange={handlePageChange}
              />
            </Card>
          </Col>
          <Col span={10}>
            <InventoryDetail
              item={inventoryStore.selectedItem}
              loading={inventoryStore.selectedItemLoading}
              onSell={handleSell}
            />
          </Col>
        </Row>
      </Flex>
    );
  }

  // 移动端布局：单列
  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Title level={4} style={{ margin: 0 }}>
        背包
      </Title>

      {/* 筛选区域 */}
      <Card size="small">
        <InventoryFilter
          filters={inventoryStore.filters}
          onFilterChange={handleFilterChange}
          onClear={handleClearFilters}
        />
      </Card>

      {/* 物品网格 */}
      <Card>
        <InventoryGrid
          items={inventoryStore.items}
          total={inventoryStore.total}
          page={inventoryStore.page}
          pageSize={inventoryStore.pageSize}
          loading={inventoryStore.loading}
          selectedItemId={inventoryStore.selectedItemId}
          onItemClick={handleItemClick}
          onPageChange={handlePageChange}
        />
      </Card>

      {/* 物品详情（移动端底部 Drawer） */}
      <Drawer
        placement="bottom"
        height="70vh"
        open={!!inventoryStore.selectedItemId}
        onClose={() => inventoryStore.clearSelection()}
        title={inventoryStore.selectedItem?.itemName}
        destroyOnClose
      >
        <InventoryDetail
          item={inventoryStore.selectedItem}
          loading={inventoryStore.selectedItemLoading}
          onSell={handleSell}
        />
      </Drawer>
    </Flex>
  );
});

export default InventoryPage;
