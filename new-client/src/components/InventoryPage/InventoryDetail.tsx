/**
 * 统一背包系统 — 物品详情组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示物品详细信息，提供物品操作按钮（出售）。
 * 2. 不做什么：不处理物品列表、不管理筛选状态。
 *
 * 输入 / 输出：
 * - 输入：物品详情数据、加载状态、操作回调。
 * - 输出：物品详情 UI。
 *
 * 数据流 / 状态流：
 * 父组件传入物品详情 → 渲染详情 → 用户点击操作按钮 → 回调父组件。
 *
 * 复用设计说明：
 * - 使用 antd Descriptions 展示属性信息。
 * - 使用 antd Tag 展示品质、变异等标签。
 * - 使用 antd Button 提供操作按钮。
 * - 使用 antd Divider 分隔不同区域。
 * - 使用 antd Spin 显示加载状态。
 * - 使用 antd Empty 显示未选中状态。
 *
 * 关键边界条件与坑点：
 * 1. 未选中物品时显示 Empty 组件。
 * 2. 加载中时显示 Spin 组件。
 * 3. 不同品质、变异类型使用不同颜色标签。
 * 4. 出售按钮需要根据物品是否可出售（sellable）禁用。
 */

import React, { useState, useCallback } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Button,
  Divider,
  Spin,
  Empty,
  InputNumber,
  Flex,
  Typography,
  App,
} from 'antd';
import { observer } from 'mobx-react-lite';
import { ShoppingCartOutlined } from '@ant-design/icons';
import type { InventoryItemDetailDto } from '../../services/api/inventory';
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  QUALITY_LABELS,
  QUALITY_COLORS,
  RARITY_LABELS,
  RARITY_COLORS,
  MUTATION_TYPE_LABELS,
  MUTATION_TYPE_COLORS,
} from './constants';
import ItemIcon from './ItemIcon';

const { Text, Title } = Typography;

interface InventoryDetailProps {
  item: InventoryItemDetailDto | null;
  loading: boolean;
  onSell: (itemId: number, quantity: number) => Promise<boolean>;
}

const InventoryDetail = observer(function InventoryDetail({
  item,
  loading,
  onSell,
}: InventoryDetailProps) {
  const { message: messageApi } = App.useApp();
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellLoading, setSellLoading] = useState(false);

  const handleSell = useCallback(async () => {
    if (!item || sellQuantity <= 0) return;

    setSellLoading(true);
    try {
      const success = await onSell(item.id, sellQuantity);
      if (success) {
        messageApi.success(`出售成功，获得 ${item.sellPrice * sellQuantity} 灵石`);
        setSellQuantity(1);
      }
    } finally {
      setSellLoading(false);
    }
  }, [item, sellQuantity, onSell, messageApi]);

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 300 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!item) {
    return <Empty description="请选择一个物品查看详情" />;
  }

  return (
    <Card>
      <Flex vertical gap={16}>
        {/* 物品标题区域 */}
        <Flex align="center" gap={16}>
          <ItemIcon icon={item.icon} size={64} />

          <Flex vertical gap={8} flex={1}>
            <Title level={5} style={{ margin: 0 }}>
              {item.itemName}
            </Title>
            <Flex gap={8} wrap="wrap">
              {/* 分类标签 */}
              <Tag color={CATEGORY_COLORS[item.category]}>
                {CATEGORY_LABELS[item.category] || item.category}
              </Tag>

              {/* 稀有度标签 */}
              {item.rarity && (
                <Tag color={RARITY_COLORS[item.rarity]}>
                  {RARITY_LABELS[item.rarity] || item.rarity}
                </Tag>
              )}

              {/* 品质标签 */}
              {item.quality && (
                <Tag color={QUALITY_COLORS[item.quality]}>
                  {QUALITY_LABELS[item.quality] || item.quality}
                </Tag>
              )}

              {/* 变异类型标签 */}
              {item.mutationType && (
                <Tag color={MUTATION_TYPE_COLORS[item.mutationType]}>
                  {MUTATION_TYPE_LABELS[item.mutationType] || item.mutationType}
                </Tag>
              )}
            </Flex>
          </Flex>
        </Flex>

        {/* 物品描述 */}
        {item.description && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {item.description}
          </Text>
        )}

        <Divider style={{ margin: '8px 0' }} />

        {/* 物品属性 */}
        <Descriptions
          column={1}
          size="small"
          labelStyle={{ width: 100, fontWeight: 500 }}
        >
          <Descriptions.Item label="数量">
            {item.quantity} / {item.maxStack}
          </Descriptions.Item>

          {/* 代数（仅种子显示） */}
          {item.generation != null && item.generation > 0 && (
            <Descriptions.Item label="代数">第 {item.generation} 代</Descriptions.Item>
          )}

          {/* 耐久度（仅装备显示） */}
          {item.durability != null && (
            <Descriptions.Item label="耐久度">{item.durability}</Descriptions.Item>
          )}

          {/* 等级（仅装备/道具显示） */}
          {item.level != null && item.level > 1 && (
            <Descriptions.Item label="等级">Lv.{item.level}</Descriptions.Item>
          )}

          {/* 出售价格 */}
          {item.sellable && (
            <Descriptions.Item label="出售价格">
              {item.sellPrice} 灵石 / 个
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* 操作区域 */}
        {item.sellable && (
          <>
            <Divider style={{ margin: '8px 0' }} />
            <Flex vertical gap={12}>
              <Text strong>出售物品</Text>
              <Flex gap={8} align="center">
                <InputNumber
                  min={1}
                  max={item.quantity}
                  value={sellQuantity}
                  onChange={(value) => setSellQuantity(value || 1)}
                  style={{ width: 100 }}
                />
                <Text type="secondary">
                  预计获得 {item.sellPrice * sellQuantity} 灵石
                </Text>
              </Flex>
              <Button
                type="primary"
                icon={<ShoppingCartOutlined />}
                loading={sellLoading}
                onClick={handleSell}
                disabled={sellQuantity <= 0 || sellQuantity > item.quantity}
              >
                出售
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
});

export default InventoryDetail;
