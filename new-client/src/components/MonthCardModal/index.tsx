/**
 * 月卡弹窗组件（antd 组件布局版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示月卡状态、权益列表、每日领取入口。
 *    - 使用 antd Card, Flex, Tag, List, Descriptions 组件布局，不手写 div+CSS。
 *    - 已激活 + 今日未领取时显示领取按钮。
 * 2. 不做什么：不处理 GM 发放逻辑（GM 面板独立调用）。
 *
 * 输入 / 输出：
 * - 输入：open / onClose props。
 * - 输出：月卡弹窗 UI。
 *
 * 数据流 / 状态流：
 * Modal 打开 -> refreshStatus -> 读取月卡状态 -> 渲染；
 * 用户点击领取 -> claimDaily -> 更新状态 -> 显示结果。
 *
 * 复用设计说明：
 * - 权益列表使用 antd List，避免手动 map + className 堆砌。
 * - 状态展示使用 antd Tag，统一视觉风格。
 * - 被 StockMarketPage 或任意父组件受控调用。
 *
 * 关键边界条件与坑点：
 * 1. Modal open 变化时触发 refreshStatus，避免重复请求。
 * 2. 领取操作使用 isClaiming 防重，不做请求去重。
 * 3. 未激活/已过期状态使用 Tag 组件展示，不使用硬编码样式。
 */

import { useCallback, useContext, useMemo, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { App, Button, Card, Flex, List, Modal, Space, Tag, Typography, Descriptions } from 'antd';
import {
  GiftOutlined,
  ThunderboltOutlined,
  ShopOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';

const { Text } = Typography;

interface MonthCardModalProps {
  open: boolean;
  onClose: () => void;
}

interface PrivilegeItem {
  id: string;
  name: string;
  description: string;
  icon: JSX.Element;
}

const MonthCardModal = observer(function MonthCardModal({ open, onClose }: MonthCardModalProps): JSX.Element | null {
  const rootStore = useContext(RootStoreContext);
  const { message } = App.useApp();
  if (!rootStore) return null;

  const { monthCardStore } = rootStore;

  const active = monthCardStore.isActive;
  const daysRemaining = monthCardStore.daysRemaining ?? 0;
  const canClaim = active && !monthCardStore.todayClaimed;
  const isExpired = !active && monthCardStore.expiresAt !== null;

  const config = monthCardStore.config;

  const handleRefresh = useCallback(async () => {
    await monthCardStore.refreshStatus();
  }, [monthCardStore]);

  const handleClaim = useCallback(async () => {
    if (monthCardStore.isClaiming || !canClaim) return;
    const result = await monthCardStore.claimDaily();
    if (result.success) {
      message.success(`领取成功 +${config?.dailyRewardSpiritStones ?? 0} 灵石`);
    } else {
      message.error(result.message || '领取失败');
    }
  }, [monthCardStore, canClaim, config, message]);

  // Modal 打开时刷新状态
  useEffect(() => {
    if (open) {
      void monthCardStore.refreshStatus();
    }
  }, [open, monthCardStore]);

  // 权益列表
  const privileges: PrivilegeItem[] = useMemo(() => {
    if (!config) return [];
    const items: PrivilegeItem[] = [
      {
        id: 'daily-reward',
        name: '每日灵石',
        description: `${config.dailyRewardSpiritStones} 灵石/天`,
        icon: <GiftOutlined />,
      },
    ];

    if (config.scratchBonusBps > 0) {
      items.push({
        id: 'scratch-bonus',
        name: '刮刮乐加成',
        description: `刮刮乐奖金 +${Math.round(config.scratchBonusBps / 10)}%`,
        icon: <ThunderboltOutlined />,
      });
    }

    if (config.shopRentBonusBps > 0) {
      items.push({
        id: 'shop-rent-bonus',
        name: '店铺租金加成',
        description: `店铺租金 +${Math.round(config.shopRentBonusBps / 10)}%`,
        icon: <ShopOutlined />,
      });
    }

    return items;
  }, [config]);

  // 状态标签
  const statusTag = useMemo(() => {
    if (!active && !isExpired) {
      return (
        <Tag icon={<InfoCircleOutlined />} color="default">
          未激活
        </Tag>
      );
    }
    if (isExpired) {
      return (
        <Tag icon={<ClockCircleOutlined />} color="default">
          已到期
        </Tag>
      );
    }
    return (
      <Tag icon={<CheckCircleOutlined />} color="success">
        已激活 · 剩余 {daysRemaining} 天
      </Tag>
    );
  }, [active, isExpired, daysRemaining]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={600}
      destroyOnHidden
      maskClosable
      title="修仙月卡"
      afterClose={() => {
        monthCardStore.reset();
      }}
    >
      <Flex vertical gap={12}>
        {/* 状态卡片 */}
        <Card
          size="small"
          title={
            <Space>
              <GiftOutlined />
              <Text strong>{config?.description || '修行月卡'}</Text>
            </Space>
          }
          extra={
            <Button
              type="text"
              size="small"
              icon={<ClockCircleOutlined />}
              onClick={handleRefresh}
              loading={monthCardStore.loading}
            >
              刷新
            </Button>
          }
        >
          {statusTag}
        </Card>

        {/* 权益列表 */}
        {active && (
          <Card size="small" title="月卡专属特权">
            <List
              dataSource={privileges}
              renderItem={(item: PrivilegeItem) => (
                <List.Item>
                  <Flex align="center" gap={8} style={{ width: '100%' }}>
                    <Tag icon={item.icon} color="processing" style={{ minWidth: 28, textAlign: 'center' }}>
                      {item.name}
                    </Tag>
                    <Text type="secondary">{item.description}</Text>
                  </Flex>
                </List.Item>
              )}
            />
          </Card>
        )}

        {/* 每日领取 */}
        {active && config && (
          <Card size="small" title="每日领礼">
            <Flex justify="space-between" align="center">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="奖励">
                  <Flex align="center" gap={8}>
                    <GiftOutlined style={{ fontSize: 20 }} />
                    <Text strong>灵石 x{config.dailyRewardSpiritStones}</Text>
                  </Flex>
                </Descriptions.Item>
              </Descriptions>
              <Button
                type="primary"
                disabled={!canClaim || monthCardStore.isClaiming}
                loading={monthCardStore.isClaiming && canClaim}
                onClick={handleClaim}
              >
                {monthCardStore.todayClaimed ? '今日已领取' : '领取奖励'}
              </Button>
            </Flex>
          </Card>
        )}
      </Flex>
    </Modal>
  );
});

export default MonthCardModal;
