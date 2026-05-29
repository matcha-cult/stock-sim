/**
 * 收租系统 — 店铺面板组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示角色所有店铺、待收租金、装修等级、升级等级、空间扩展状态，
 *    提供收取租金、装修调整、空间扩展、购买新店铺、免费领取初始店铺操作。
 * 2. 不做什么：不重复租金计算逻辑、不维护店铺状态（由 ShopStore 驱动）。
 *
 * 输入 / 输出：
 * - 输入：RootStore 的 shopStore（店铺数据）、authStore（灵石余额）。
 * - 输出：店铺功能完整界面。
 *
 * 数据流 / 状态流：
 * 页面加载 -> shopStore.fetchShops -> 用户操作 -> shopStore 方法 -> 自动刷新 shops + 角色灵石。
 *
 * 复用设计说明：
 * - 所有布局使用 antd 组件（Card, Flex, Tag, Button, Modal, Descriptions, Statistic）。
 * - 租金产出明细公式在前端展示，计算逻辑在后端 types.ts 收敛。
 *
 * 关键边界条件与坑点：
 * 1. 自动错误 toast 由 axios 拦截器负责，catch 不重复弹失败提示。
 * 2. 装修操作后有 tick 冷却，通过 isDecorating 字段提示用户。
 * 3. 购买店铺成本较高（5 万灵石起），需确保灵石余额可见。
 */

import { useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  App, Button, Card, Col, Descriptions, Empty, Flex, Modal, Row,
  Select, Spin, Statistic, Tag, Tooltip, Typography, Divider,
} from 'antd';
import {
  ShopOutlined, DollarOutlined, ArrowUpOutlined,
  ThunderboltOutlined, PlusOutlined,
  RiseOutlined, ApartmentOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';

const { Text, Title } = Typography;

// ==================== 装修等级颜色映射 ====================

const TIER_COLORS: Record<string, string> = {
  YELLOW: 'gold',
  MYSTIC: 'purple',
  EARTH: 'blue',
  HEAVEN: 'red',
};

// ==================== 工具函数 ====================

/** 格式化灵石显示 */
const formatSpiritStones = (value: number): string => {
  return value.toLocaleString('zh-CN');
};

// ==================== 子组件 ====================

/**
 * 单个店铺卡片。
 */
const ShopCard = observer(({
  shop,
  onCollectRent,
  onDecorate,
  onExpand,
}: {
  shop: {
    id: number;
    shopType: string;
    shopTypeName: string;
    area: number;
    decorationTier: string;
    decorationTierLabel: string;
    upgradeLevel: number;
    spaceExpansion: number;
    pendingRent: number;
    totalRentCollected: number;
    rentTickCount: number;
    rentPerTick: number;
    isDecorating: boolean;
  };
  onCollectRent: (id: number) => void;
  onDecorate: (id: number) => void;
  onExpand: (id: number) => void;
}) => {
  return (
    <Card
      size="small"
      style={{ height: '100%' }}
      data-element={`shop-card-${shop.id}`}
    >
      <Flex vertical gap={8}>
        {/* 头部：类型 + 装修等级 */}
        <Flex justify="space-between" align="center">
          <Flex align="center" gap={6}>
            <ShopOutlined style={{ fontSize: 16, color: 'var(--text-primary)' }} />
            <Text strong>{shop.shopTypeName}</Text>
          </Flex>
          <Tag color={TIER_COLORS[shop.decorationTier] ?? 'default'}>
            {shop.decorationTierLabel}
          </Tag>
        </Flex>

        {/* 装修中提示 */}
        {shop.isDecorating && (
          <Tag color="orange">装修中，当前 tick 无租金</Tag>
        )}

        {/* 面积 + 升级等级 */}
        <Flex gap={12} style={{ fontSize: 13 }}>
          <Text type="secondary">
            <ApartmentOutlined /> {shop.area} ㎡
          </Text>
          <Text type="secondary">
            <RiseOutlined /> Lv.{shop.upgradeLevel}
          </Text>
          {shop.spaceExpansion > 0 && (
            <Text type="secondary">
              <ThunderboltOutlined /> 扩展 +{shop.spaceExpansion}
            </Text>
          )}
        </Flex>

        {/* 租金信息 */}
        <Flex vertical gap={4} style={{ background: 'var(--fill-quaternary)', borderRadius: 6, padding: '8px 10px' }}>
          <Flex justify="space-between" align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>每次产出</Text>
            <Text style={{ fontSize: 13, fontWeight: 500 }}>
              {formatSpiritStones(shop.rentPerTick)} 灵石
            </Text>
          </Flex>
          <Flex justify="space-between" align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>待收租金</Text>
            <Text style={{ fontSize: 14, fontWeight: 600, color: 'var(--colorSuccess)' }}>
              {formatSpiritStones(shop.pendingRent)} 灵石
            </Text>
          </Flex>
        </Flex>

        {/* 操作按钮 */}
        <Flex gap={6} wrap="wrap">
          <Button
            size="small"
            type={shop.pendingRent > 0 ? 'primary' : 'default'}
            icon={<DollarOutlined />}
            onClick={() => onCollectRent(shop.id)}
            disabled={shop.pendingRent <= 0}
          >
            收取
          </Button>
          <Button
            size="small"
            icon={<ArrowUpOutlined />}
            onClick={() => onDecorate(shop.id)}
          >
            装修
          </Button>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => onExpand(shop.id)}
          >
            扩空间
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
});

/**
 * 装修弹窗。
 */
const DecorationModalContent = observer(({
  shop,
  config,
  spiritStones,
  onAdjust,
}: {
  shop: {
    id: number;
    decorationTier: string;
    decorationTierLabel: string;
    area: number;
    isDecorating: boolean;
  };
  config: {
    decorationTiers: Record<string, {
      label: string;
      index: number;
      pricePerSqm: number;
      rentMultiplier: number;
    }>;
    decorationTierOrder: string[];
    constants: {
      decorationRefundRate: number;
    };
  };
  spiritStones: number;
  onAdjust: (id: number, targetTier: string) => void;
}) => {
  const { modal } = App.useApp();
  const currentIdx = config.decorationTiers[shop.decorationTier]?.index ?? 0;

  const tierItems = config.decorationTierOrder.map((tier) => {
    const tierConfig = config.decorationTiers[tier];
    const idx = tierConfig.index;
    let actionText = '';
    let costText = '';
    let canAfford = true;

    if (idx === currentIdx) {
      actionText = '当前';
    } else if (idx > currentIdx) {
      const cost = (tierConfig.pricePerSqm - config.decorationTiers[shop.decorationTier]?.pricePerSqm) * shop.area;
      actionText = `升级 (${config.decorationTiers[shop.decorationTier]?.label}→${tierConfig.label})`;
      costText = `消耗 ${formatSpiritStones(cost)} 灵石`;
      canAfford = spiritStones >= cost;
    } else {
      const refund = (config.decorationTiers[shop.decorationTier]?.pricePerSqm - tierConfig.pricePerSqm)
        * shop.area * config.constants.decorationRefundRate;
      actionText = `降级 (${config.decorationTiers[shop.decorationTier]?.label}→${tierConfig.label})`;
      costText = `返还 ${formatSpiritStones(refund)} 灵石`;
    }

    return {
      value: tier,
      label: (
        <Flex justify="space-between" align="center">
          <Tag color={TIER_COLORS[tier] ?? 'default'}>{tierConfig.label}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{actionText}</Text>
          {costText && <Text type={canAfford ? 'secondary' : 'danger'} style={{ fontSize: 12 }}>{costText}</Text>}
        </Flex>
      ),
      disabled: idx === currentIdx,
    };
  });

  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  return (
    <Flex vertical gap={12}>
      <Text>当前装修：<Tag color={TIER_COLORS[shop.decorationTier]}>{shop.decorationTierLabel}</Tag></Text>
      {shop.isDecorating && (
        <Tag color="orange">装修中，当前 tick 无租金产出</Tag>
      )}
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="面积">{shop.area} ㎡</Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: '8px 0' }} />
      <Text>选择目标装修等级：</Text>
      <Select
        style={{ width: '100%' }}
        options={tierItems}
        value={selectedTier}
        onChange={setSelectedTier}
        placeholder="请选择"
      />
      <Button
        type="primary"
        block
        disabled={!selectedTier}
        onClick={() => {
          if (!selectedTier) return;
          modal.confirm({
            title: '确认装修调整',
            content: `确定将装修等级调整为 ${config.decorationTiers[selectedTier]?.label}？`,
            onOk: () => onAdjust(shop.id, selectedTier!),
          });
        }}
      >
        确认调整
      </Button>
    </Flex>
  );
});

// ==================== 主组件 ====================

const ShopPanel = observer(() => {
  const rootStore = useContext(RootStoreContext);
  const { message } = App.useApp();
  const [decorateShopId, setDecorateShopId] = useState<number | null>(null);
  const [expandShopId, setExpandShopId] = useState<number | null>(null);
  const [purchaseVisible, setPurchaseVisible] = useState(false);

  const shopStore = rootStore?.shopStore;
  const authStore = rootStore?.authStore;
  const spiritStones = authStore?.spiritStones ?? 0;

  // 初始化加载
  useEffect(() => {
    if (!shopStore) return;
    shopStore.fetchShops();
    shopStore.fetchConfig();
  }, [shopStore]);

  if (!shopStore) return <Empty description="店铺系统未初始化" />;

  // 装修弹窗对应店铺
  const decorateShop = shopStore.shops.find((s) => s.id === decorateShopId) ?? null;
  const expandShop = shopStore.shops.find((s) => s.id === expandShopId) ?? null;

  // 可购买店铺列表
  const ownedTypes = new Set(shopStore.shops.map((s) => s.shopType));
  const purchasableShops = shopStore.config
    ? Object.entries(shopStore.config.shopTypes)
      .filter(([type, cfg]) => type !== 'BOO' && cfg.purchaseCost > 0 && !ownedTypes.has(type))
      .sort(([, a], [, b]) => a.purchaseCost - b.purchaseCost)
    : [];

  // 基于后端返回的下次收租时间计算倒计时
  const nextRentAt = shopStore.nextRentAt;
  const getNextRentTime = (): string => {
    if (!nextRentAt) return '--';
    const remaining = nextRentAt.getTime() - Date.now();
    if (remaining <= 0) return '0 秒后收租';
    const totalSeconds = Math.floor(remaining / 1000);
    const diffMinutes = Math.floor(totalSeconds / 60);
    const diffSeconds = totalSeconds % 60;
    if (diffMinutes > 0) {
      return `${diffMinutes - 1} 分 ${diffSeconds} 秒后收租`;
    }
    return `${diffSeconds} 秒后收租`;
  };

  const [nextRentTime, setNextRentTime] = useState(getNextRentTime());
  useEffect(() => {
    const timer = setInterval(() => {
      setNextRentTime(getNextRentTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Flex vertical gap={12} style={{ padding: 12 }}>
      {/* 顶部汇总 */}
      <Card size="small">
        <Row gutter={16}>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>待收租金</Text>
            <Text style={{ fontSize: 20, fontWeight: 600 }}>{formatSpiritStones(shopStore.totalPendingRent)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}> 灵石</Text>
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>下次收租</Text>
            <Text style={{ fontSize: 20, fontWeight: 600 }}>{nextRentTime}</Text>
          </Col>
        </Row>
      </Card>

      {/* 操作栏 */}
      <Flex gap={8} wrap="wrap">
        <Button
          type="primary"
          icon={<DollarOutlined />}
          onClick={async () => {
            const result = await shopStore.collectAllRent();
            if (result.success) message.success(result.message);
            else message.error(result.message);
          }}
          disabled={shopStore.totalPendingRent <= 0}
        >
          一键收取全部
        </Button>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setPurchaseVisible(true)}
          disabled={purchasableShops.length === 0}
        >
          购买新店铺
        </Button>
      </Flex>

      {/* 店铺列表 */}
      {shopStore.loading ? (
        <Flex justify="center" style={{ padding: 40 }}>
          <Spin />
        </Flex>
      ) : shopStore.shops.length === 0 ? (
        <Empty
          description="暂无店铺"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button
            type="primary"
            icon={<ShopOutlined />}
            onClick={async () => {
              const result = await shopStore.claimInitialShop();
              if (result.success) message.success(result.message);
              else message.error(result.message);
            }}
          >
            免费领取初始店铺
          </Button>
        </Empty>
      ) : (
        <Row gutter={[12, 12]}>
          {shopStore.shops.map((shop) => (
            <Col xs={24} sm={12} md={8} key={shop.id}>
              <ShopCard
                shop={shop}
                onCollectRent={async (id) => {
                  const result = await shopStore.collectRent(id);
                  if (result.success) message.success(result.message);
                  else message.error(result.message);
                }}
                onDecorate={setDecorateShopId}
                onExpand={setExpandShopId}
              />
            </Col>
          ))}
        </Row>
      )}

      {/* 装修弹窗 */}
      {decorateShop && shopStore.config && (
        <Modal
          open
          title="装修调整"
          onCancel={() => setDecorateShopId(null)}
          footer={null}
          destroyOnClose
        >
          <DecorationModalContent
            shop={decorateShop}
            config={shopStore.config}
            spiritStones={spiritStones}
            onAdjust={async (id, tier) => {
              setDecorateShopId(null);
              const result = await shopStore.adjustDecoration(id, tier);
              if (result.success) message.success(result.message);
              else message.error(result.message);
            }}
          />
        </Modal>
      )}

      {/* 扩展空间确认弹窗 */}
      {expandShop && shopStore.config && (
        <Modal
          open
          title="空间阵法扩展"
          onCancel={() => setExpandShopId(null)}
          onOk={async () => {
            setExpandShopId(null);
            const result = await shopStore.expandSpace(expandShop.id);
            if (result.success) message.success(result.message);
            else message.error(result.message);
          }}
          okText="确认扩展"
          okButtonProps={{ disabled: spiritStones < (() => {
            const tierConfig = shopStore.config?.decorationTiers[expandShop.decorationTier];
            const tierMulti = tierConfig?.expansionMultiplier ?? 1;
            const spaceCost = 50 * Math.pow(2, expandShop.spaceExpansion) * tierMulti;
            const decorCost = (tierConfig?.pricePerSqm ?? 10) * 10;
            return spaceCost + decorCost;
          })() }}
        >
          {(() => {
            const tierConfig = shopStore.config?.decorationTiers[expandShop.decorationTier];
            const tierMulti = tierConfig?.expansionMultiplier ?? 1;
            const spaceCost = 50 * Math.pow(2, expandShop.spaceExpansion) * tierMulti;
            const decorCostPerSqm = tierConfig?.pricePerSqm ?? 10;
            const decorCost = decorCostPerSqm * 10; // 扩展面积 10 ㎡
            const totalCost = spaceCost + decorCost;
            return (
              <Flex vertical gap={12}>
                <Flex justify="space-between">
                  <Text>当前面积</Text>
                  <Text strong>{expandShop.area} ㎡</Text>
                </Flex>
                <Flex justify="space-between">
                  <Text>扩展后面积</Text>
                  <Text strong>{expandShop.area + 10} ㎡</Text>
                </Flex>
                <Divider style={{ margin: '8px 0' }} />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="装修等级">{expandShop.decorationTierLabel}</Descriptions.Item>
                </Descriptions>
                <Divider style={{ margin: '8px 0' }} />
                <Flex justify="space-between">
                  <Text>空间阵法扩展费用</Text>
                  <Text>{formatSpiritStones(spaceCost)} 灵石</Text>
                </Flex>
                <Flex justify="space-between">
                  <Text>扩展面积装修费用</Text>
                  <Text>10 ㎡ × {formatSpiritStones(decorCostPerSqm)} = {formatSpiritStones(decorCost)} 灵石</Text>
                </Flex>
                <Divider style={{ margin: '8px 0' }} />
                <Flex justify="space-between">
                  <Text strong>合计费用</Text>
                  <Text strong style={{ color: spiritStones >= totalCost ? 'var(--colorError)' : 'var(--text-disabled)' }}>
                    {formatSpiritStones(totalCost)} 灵石
                  </Text>
                </Flex>
                {spiritStones < totalCost && (
                  <Tag color="red">灵石不足，差额 {formatSpiritStones(totalCost - spiritStones)} 灵石</Tag>
                )}
              </Flex>
            );
          })()}
        </Modal>
      )}

      {/* 购买新店铺弹窗 */}
      {purchaseVisible && shopStore.config && (
        <Modal
          open
          title="购买新店铺"
          onCancel={() => setPurchaseVisible(false)}
          footer={null}
        >
          <Flex vertical gap={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每种类型最多 1 间，购买后自动获得黄级装修。
            </Text>
            {purchasableShops.map(([type, cfg]) => (
              <Card
                key={type}
                size="small"
                hoverable
                onClick={async () => {
                  setPurchaseVisible(false);
                  const result = await shopStore.purchaseShop(type);
                  if (result.success) message.success(result.message);
                  else message.error(result.message);
                }}
              >
                <Flex justify="space-between" align="center">
                  <Flex vertical>
                    <Text strong>{cfg.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      初始面积 {cfg.initialArea} ㎡，每次租金 {cfg.initialRent} 灵石
                    </Text>
                  </Flex>
                  <Text style={{ color: 'var(--colorError)', fontWeight: 600 }}>
                    {formatSpiritStones(cfg.purchaseCost)} 灵石
                  </Text>
                </Flex>
              </Card>
            ))}
            {purchasableShops.length === 0 && (
              <Empty description="所有类型店铺已购满" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Flex>
        </Modal>
      )}
    </Flex>
  );
});

export default ShopPanel;
