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
 * 4. 公式明细（租金公式、空间加成、空间针法扩展）仅 GM 权限或 dev 模式可见。
 * 5. 空间扩展费用计算器全员可见，公式明细仅 GM 权限或 dev 模式可见。
 */

import { useContext, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  App, Button, Card, Col, Descriptions, Empty, Flex, Modal, Row,
  Select, Segmented, Slider, Spin, Statistic, Tag, Tooltip, Typography, Divider, Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ShopOutlined, DollarOutlined, ArrowUpOutlined,
  ThunderboltOutlined, PlusOutlined,
  RiseOutlined, ApartmentOutlined,
  ExperimentOutlined, ReloadOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';
import ShopProfitCalculator from './ShopProfitCalculator';

const { Text, Title } = Typography;

// dev 模式判断
const isDevMode = import.meta.env.DEV === true;

// ==================== 权限判断 ====================

/** 公式明细可见性：GM 权限或 dev 模式下展示 */
const isFormulaVisible = (hasGmPermission: boolean): boolean => {
  return hasGmPermission || isDevMode;
};

// ==================== 空间扩展费用计算 ====================

/** 空间扩展基础费用 */
const SPACE_EXPANSION_BASE_COST = 200;
/** 扩展费用指数底数 */
const SPACE_EXPANSION_EXPONENT_BASE = 2;
/** 每次扩展增加面积 */
const SPACE_EXPANSION_AREA_INCREMENT = 10;

/** 装修等级配置（与后端 types.ts 对齐） */
const TIER_CONFIG: Record<string, {
  label: string;
  pricePerSqm: number;
  expansionMultiplier: number;
  rentMultiplier: number;
}> = {
  YELLOW: { label: '黄级', pricePerSqm: 10, expansionMultiplier: 1.0, rentMultiplier: 1.0 },
  MYSTIC: { label: '玄级', pricePerSqm: 30, expansionMultiplier: 1.5, rentMultiplier: 1.5 },
  EARTH: { label: '地级', pricePerSqm: 60, expansionMultiplier: 2.0, rentMultiplier: 3.0 },
  HEAVEN: { label: '天级', pricePerSqm: 100, expansionMultiplier: 3.0, rentMultiplier: 5.0 },
};

const TIER_ORDER = ['YELLOW', 'MYSTIC', 'EARTH', 'HEAVEN'] as const;

/** 店铺类型配置（与后端 types.ts 对齐） */
const SHOP_TYPE_CONFIG: Record<string, {
  name: string;
  initialArea: number;
  initialRent: number;
}> = {
  PLT: { name: '灵植', initialArea: 50, initialRent: 25 },
  MIN: { name: '矿材', initialArea: 40, initialRent: 20 },
  ART: { name: '法器', initialArea: 35, initialRent: 18 },
  DAN: { name: '丹药', initialArea: 30, initialRent: 15 },
  FBD: { name: '餐饮', initialArea: 25, initialRent: 15 },
  BOO: { name: '书籍', initialArea: 20, initialRent: 10 },
};

const SHOP_TYPE_ORDER = ['BOO', 'FBD', 'DAN', 'ART', 'MIN', 'PLT'] as const;

/**
 * 计算单次空间扩展费用。
 * 公式：基础费用 × 2^当前扩展次数 × 装修等级系数 + 扩展面积 × 装修单价
 */
const calcSingleExpansionCost = (expansionIndex: number, tierKey: string): number => {
  const tier = TIER_CONFIG[tierKey];
  const spaceCost = SPACE_EXPANSION_BASE_COST * Math.pow(SPACE_EXPANSION_EXPONENT_BASE, expansionIndex) * tier.expansionMultiplier;
  const decorCost = SPACE_EXPANSION_AREA_INCREMENT * tier.pricePerSqm;
  return Math.round(spaceCost + decorCost);
};

/** 空间扩展费用行数据 */
interface ExpansionCostRow {
  expansionIndex: number; // 从 0→1, 1→2, ...
  tierKey: string;
  shopTypeKey: string;
  singleCost: number;
}

/** 为指定店铺类型+装修等级生成全部扩展费用行 */
const buildExpansionCostRows = (shopTypeKey: string, tierKey: string, maxExpansion: number): ExpansionCostRow[] => {
  const rows: ExpansionCostRow[] = [];
  for (let i = 0; i < maxExpansion; i++) {
    rows.push({
      expansionIndex: i,
      tierKey,
      shopTypeKey,
      singleCost: calcSingleExpansionCost(i, tierKey),
    });
  }
  return rows;
};

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
  config,
  hasGmPermission,
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
  config?: {
    shopTypes: Record<string, { name: string; initialArea: number; initialRent: number; purchaseCost: number }>;
    decorationTiers: Record<string, {
      label: string;
      index: number;
      rentMultiplier: number;
    }>;
    constants: {
      upgradeLevelBonusRate: number;
    };
  } | null;
  hasGmPermission: boolean;
}) => {
  const shopConfig = config?.shopTypes[shop.shopType];
  const tierConfig = config?.decorationTiers[shop.decorationTier];
  const bonusRate = config?.constants.upgradeLevelBonusRate ?? 0.1;

  // GM 或 dev 模式下展示公式明细
  const formulaDetail = isFormulaVisible(hasGmPermission) && shopConfig && tierConfig ? (() => {
    const initialRent = shopConfig.initialRent;
    const initialArea = shopConfig.initialArea;
    const rentMultiplier = tierConfig.rentMultiplier;
    const spaceBonus = 1 + shop.spaceExpansion * 0.2;
    const upgradeBonus = 1 + shop.upgradeLevel * bonusRate;
    const expectedRent = initialRent * rentMultiplier * spaceBonus * upgradeBonus;

    return (
      <Flex vertical gap={2} style={{ background: 'rgba(250, 173, 20, 0.06)', borderRadius: 6, padding: '6px 10px', border: '1px dashed rgba(250, 173, 20, 0.3)' }}>
        <Text style={{ fontSize: 11, fontWeight: 500, color: '#d48806' }}>租金公式</Text>
        <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          初始租金 × 装修系数 × 空间加成 × 升级加成
        </Text>
        <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {initialRent} × {rentMultiplier} × {spaceBonus.toFixed(1)} × {upgradeBonus.toFixed(1)}
        </Text>
        <Flex justify="space-between" align="center">
          <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>计算结果</Text>
          <Text style={{ fontSize: 11, fontWeight: 500, color: expectedRent === shop.rentPerTick ? 'var(--colorSuccess)' : 'var(--colorError)' }}>
            {expectedRent.toFixed(1)} 灵石
            {expectedRent !== shop.rentPerTick && `（实际 ${shop.rentPerTick}）`}
          </Text>
        </Flex>
        <Divider style={{ margin: '6px 0' }} />
        <Text style={{ fontSize: 11, fontWeight: 500, color: '#d48806' }}>空间加成</Text>
        <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          公式：1 + 扩展次数 × 0.2
        </Text>
        <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          = 1 + {shop.spaceExpansion} × 0.2 = {spaceBonus.toFixed(1)}
        </Text>
        <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          当前面积 = 初始面积 + 扩展次数 × 10 = {initialArea} + {shop.spaceExpansion} × 10 = {shop.area} ㎡
        </Text>
      </Flex>
    );
  })() : null;

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

        {/* GM / dev 模式公式明细 */}
        {formulaDetail}

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
    rentPerTick: number;
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

  // 计算选中目标的成本明细
  const selectedTierConfig = selectedTier ? config.decorationTiers[selectedTier] : null;
  const selectedIdx = selectedTierConfig?.index ?? -1;
  const currentTierConfig = config.decorationTiers[shop.decorationTier];
  const isUpgrade = selectedTierConfig && selectedIdx > currentIdx;
  const isDowngrade = selectedTierConfig && selectedIdx < currentIdx;

  // 计算升级/降价后的租金
  const currentRentPerTick = shop.rentPerTick;
  const targetRentPerTick = (() => {
    if (!selectedTierConfig || !currentTierConfig) return null;
    // rentPerTick = initialRent × rentMultiplier × spaceBonus × upgradeBonus
    // 其中只有 rentMultiplier 因装修等级变化，其他不变
    const currentMultiplier = currentTierConfig.rentMultiplier;
    const targetMultiplier = selectedTierConfig.rentMultiplier;
    return (currentRentPerTick / currentMultiplier) * targetMultiplier;
  })();

  let costDetail: JSX.Element | null = null;
  if (isUpgrade && selectedTierConfig && currentTierConfig) {
    const diff = selectedTierConfig.pricePerSqm - currentTierConfig.pricePerSqm;
    const cost = diff * shop.area;
    costDetail = (
      <Flex vertical gap={4}>
        <Text type="secondary" style={{ fontSize: 12 }}>成本公式：</Text>
        <Text style={{ fontSize: 12 }}>(目标单价 - 当前单价) × 面积</Text>
        <Text style={{ fontSize: 12 }}>({selectedTierConfig.pricePerSqm} - {currentTierConfig.pricePerSqm}) × {shop.area} ㎡</Text>
        <Text strong style={{ fontSize: 13, color: 'var(--colorError)' }}>
          消耗 {formatSpiritStones(cost)} 灵石
        </Text>
        {spiritStones < cost && (
          <Tag color="red">灵石不足，差额 {formatSpiritStones(cost - spiritStones)} 灵石</Tag>
        )}
      </Flex>
    );
  } else if (isDowngrade && selectedTierConfig && currentTierConfig) {
    const diff = currentTierConfig.pricePerSqm - selectedTierConfig.pricePerSqm;
    const refund = diff * shop.area * config.constants.decorationRefundRate;
    costDetail = (
      <Flex vertical gap={4}>
        <Text type="secondary" style={{ fontSize: 12 }}>退款公式：</Text>
        <Text style={{ fontSize: 12 }}>(当前单价 - 目标单价) × 面积 × 回收比例</Text>
        <Text style={{ fontSize: 12 }}>({currentTierConfig.pricePerSqm} - {selectedTierConfig.pricePerSqm}) × {shop.area} × {config.constants.decorationRefundRate}</Text>
        <Text strong style={{ fontSize: 13, color: 'var(--colorSuccess)' }}>
          返还 {formatSpiritStones(refund)} 灵石
        </Text>
      </Flex>
    );
  }

  // 租金预览
  const rentPreview = targetRentPerTick !== null ? (
    <Flex vertical gap={4}>
      <Text type="secondary" style={{ fontSize: 12 }}>租金变化：</Text>
      <Flex justify="space-between" align="center">
        <Text type="secondary">每次产出</Text>
        <Flex gap={8} align="center">
          <Text style={{ fontSize: 12 }}>{formatSpiritStones(Math.round(currentRentPerTick))} 灵石</Text>
          <Text type="secondary">→</Text>
          <Text strong style={{ fontSize: 12, color: targetRentPerTick >= currentRentPerTick ? 'var(--colorSuccess)' : 'var(--colorError)' }}>
            {formatSpiritStones(Math.round(targetRentPerTick))} 灵石
          </Text>
        </Flex>
      </Flex>
    </Flex>
  ) : null;

  return (
    <Flex vertical gap={12}>
      <Text>当前装修：<Tag color={TIER_COLORS[shop.decorationTier]}>{shop.decorationTierLabel}</Tag></Text>
      {shop.isDecorating && (
        <Tag color="orange">装修中，当前 tick 无租金产出</Tag>
      )}
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="面积">{shop.area} ㎡</Descriptions.Item>
        <Descriptions.Item label="当前单价">{currentTierConfig?.pricePerSqm} 灵石/㎡</Descriptions.Item>
        <Descriptions.Item label="基础装修费">{formatSpiritStones((currentTierConfig?.pricePerSqm ?? 10) * shop.area)} 灵石</Descriptions.Item>
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
      {costDetail}
      {rentPreview}
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
  const [calcVisible, setCalcVisible] = useState(false);
  const [upgradeTableVisible, setUpgradeTableVisible] = useState(false);
  const [selectedShopType, setSelectedShopType] = useState<string>('BOO');
  const [selectedTier, setSelectedTier] = useState<string>('YELLOW');
  const [upgradeLevel, setUpgradeLevel] = useState<number>(10);

  const shopStore = rootStore?.shopStore;
  const authStore = rootStore?.authStore;
  const spiritStones = authStore?.spiritStones ?? 0;
  const hasGmPermission = authStore?.user?.permissions.includes('GM') ?? false;

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
  /** 已收租金总和（由各店铺 totalRentCollected 聚合） */
  const totalCollectedRent = shopStore.shops.reduce((sum, s) => sum + s.totalRentCollected, 0);

  return (
    <Flex vertical gap={12} style={{  }}>
      {/* 顶部汇总 */}
      <Card
        size="small"
        title="租金汇总"
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => shopStore.fetchShops()}
            loading={shopStore.loading}
          >
            刷新
          </Button>
        }
      >
        <Row gutter={16}>
          <Col span={8}>
            <Statistic
              title="待收租金"
              value={shopStore.totalPendingRent}
              suffix="灵石"
              valueStyle={{ fontSize: 16, fontWeight: 600 }}
              formatter={(v) => Number(v).toLocaleString('zh-CN')}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="已收租金"
              value={totalCollectedRent}
              suffix="灵石"
              valueStyle={{ fontSize: 16, fontWeight: 600 }}
              formatter={(v) => Number(v).toLocaleString('zh-CN')}
            />
          </Col>
          <Col span={8}>
            {nextRentAt ? (
              <Statistic.Countdown
                title="下次收租"
                value={nextRentAt.getTime()}
                format="mm 分 ss 秒"
                valueStyle={{ fontSize: 16, fontWeight: 600 }}
              />
            ) : (
              <Statistic title="下次收租" value={0} suffix="--" valueStyle={{ fontSize: 16, fontWeight: 600 }} />
            )}
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
        {isDevMode && (
          <Button
            icon={<ExperimentOutlined />}
            onClick={() => setCalcVisible(true)}
            style={{ borderColor: '#faad14', color: '#faad14' }}
          >
            店铺收益测算
          </Button>
        )}
        <Button
          icon={<SafetyCertificateOutlined />}
          onClick={() => setUpgradeTableVisible(true)}
          style={{ borderColor: '#722ed1', color: '#722ed1' }}
        >
          费用计算器
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
                config={shopStore.config}
                hasGmPermission={hasGmPermission}
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
      {expandShop && shopStore.config && (() => {
        const tierConfig = shopStore.config.decorationTiers[expandShop.decorationTier];
        const tierMulti = tierConfig?.expansionMultiplier ?? 1;
        const baseCost = shopStore.config.constants.spaceExpansionBaseCost;
        const expBase = 2;
        const spaceCost = baseCost * Math.pow(expBase, expandShop.spaceExpansion) * tierMulti;
        const decorCostPerSqm = tierConfig?.pricePerSqm ?? 10;
        const decorCost = decorCostPerSqm * 10;
        const totalCost = spaceCost + decorCost;

        // 升级前后对比数据
        const currentLevel = expandShop.upgradeLevel;
        const nextLevel = currentLevel + 1;
        const currentArea = expandShop.area;
        const nextArea = currentArea + 10;
        const currentRent = expandShop.rentPerTick;
        // 扩展后租金 = 初始租金 × 装修系数 × 新空间加成 × 升级加成
        const shopConfig = shopStore.config.shopTypes[expandShop.shopType];
        const nextSpaceBonus = 1 + (expandShop.spaceExpansion + 1) * 0.2;
        const upgradeBonus = 1 + nextLevel * (shopStore.config.constants.upgradeLevelBonusRate ?? 0.1);
        const nextRent = shopConfig
          ? shopConfig.initialRent * tierConfig.rentMultiplier * nextSpaceBonus * upgradeBonus
          : currentRent;

        return (
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
            okButtonProps={{ disabled: spiritStones < totalCost }}
          >
            <Flex vertical gap={12}>
              {/* 升级前后对比面板 */}
              <Flex
                vertical
                gap={6}
                style={{
                  background: 'var(--fill-quaternary)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  扩展效果预览
                </Text>
                {/* 扩展等级 */}
                <Flex justify="space-between" align="center">
                  <Text type="secondary">扩展等级</Text>
                  <Flex gap={8} align="center">
                    <Text>+{expandShop.spaceExpansion}</Text>
                    <Text type="secondary">→</Text>
                    <Text strong style={{ color: 'var(--colorSuccess)' }}>+{expandShop.spaceExpansion + 1}</Text>
                  </Flex>
                </Flex>
                {/* 面积 */}
                <Flex justify="space-between" align="center">
                  <Text type="secondary">面积</Text>
                  <Flex gap={8} align="center">
                    <Text>{currentArea} ㎡</Text>
                    <Text type="secondary">→</Text>
                    <Text strong style={{ color: 'var(--colorSuccess)' }}>{nextArea} ㎡</Text>
                  </Flex>
                </Flex>
                {/* 每次租金 */}
                <Flex justify="space-between" align="center">
                  <Text type="secondary">每次租金</Text>
                  <Flex gap={8} align="center">
                    <Text>{formatSpiritStones(currentRent)} 灵石</Text>
                    <Text type="secondary">→</Text>
                    <Text strong style={{ color: 'var(--colorSuccess)' }}>{formatSpiritStones(Math.round(nextRent))} 灵石</Text>
                  </Flex>
                </Flex>
                {/* 装修等级（不变） */}
                <Flex justify="space-between" align="center">
                  <Text type="secondary">装修等级</Text>
                  <Text>{expandShop.decorationTierLabel}</Text>
                </Flex>
              </Flex>

              <Divider style={{ margin: '8px 0' }} />

              {/* 费用明细 */}
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
              {isFormulaVisible(hasGmPermission) && (
                <Flex vertical gap={2} style={{ background: 'rgba(250, 173, 20, 0.06)', borderRadius: 6, padding: '6px 10px', border: '1px dashed rgba(250, 173, 20, 0.3)' }}>
                  <Text style={{ fontSize: 11, fontWeight: 500, color: '#d48806' }}>公式明细</Text>
                  <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    空间阵法费用 = 基础费用 × 2^n × 装修等级系数
                  </Text>
                  <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    = {baseCost} × {expBase}^{expandShop.spaceExpansion} × {tierMulti}
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                    = {formatSpiritStones(spaceCost)} 灵石
                  </Text>
                  <Divider style={{ margin: '4px 0' }} />
                  <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    扩展面积装修费用 = 10 ㎡ × 单价
                  </Text>
                  <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    = 10 × {formatSpiritStones(decorCostPerSqm)} = {formatSpiritStones(decorCost)} 灵石
                  </Text>
                  <Divider style={{ margin: '4px 0' }} />
                  <Text style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                    合计 = {formatSpiritStones(spaceCost)} + {formatSpiritStones(decorCost)} = {formatSpiritStones(totalCost)} 灵石
                  </Text>
                </Flex>
              )}
            </Flex>
          </Modal>
        );
      })()}

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
                      初始面积 {cfg.initialArea} ㎡，每次收取租金 {cfg.initialRent} 灵石
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
      {/* 空间扩展费用计算器 */}
      {upgradeTableVisible && (
        <Modal
          open
          title="空间扩展费用计算器"
          onCancel={() => setUpgradeTableVisible(false)}
          footer={null}
          width={720}
        >
          <Flex vertical gap={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              公式：基础费用(200) × 2^当前扩展次数 × 装修等级系数 + 扩展面积(10㎡) × 装修单价
            </Text>
            {(() => {
              const tier = TIER_CONFIG[selectedTier];
              const shopCfg = SHOP_TYPE_CONFIG[selectedShopType];
              const maxExpansion = shopStore.config?.constants.spaceExpansionMaxCount ?? 20;
              const maxUpgradeLevel = shopStore.config?.constants.upgradeMaxLevel ?? 50;

              // 每次租金 = 初始租金 × 装修租金系数 × 空间加成 × 升级加成
              const calcRentPerTick = (expansion: number): number => {
                const spaceBonus = 1 + expansion * 0.2;
                const upgradeBonus = 1 + upgradeLevel * 0.1;
                return shopCfg.initialRent * tier.rentMultiplier * spaceBonus * upgradeBonus;
              };

              type TableRow = {
                expansionIndex: number;
                singleCost: number;
                cumulative: number;
                rentPerTick: number;
                areaAfterExpansion: number;
              };

              /** 渲染一个区间表格 */
              const renderTable = (from: number, to: number, baseCumulative: number) => {
                let cumulative = baseCumulative;
                const rows: TableRow[] = [];
                for (let i = from; i < to; i++) {
                  const cost = calcSingleExpansionCost(i, selectedTier);
                  cumulative += cost;
                  const expansionAfter = i + 1;
                  rows.push({
                    expansionIndex: i,
                    singleCost: cost,
                    cumulative,
                    rentPerTick: Math.round(calcRentPerTick(expansionAfter) * 10) / 10,
                    areaAfterExpansion: shopCfg.initialArea + expansionAfter * 10,
                  });
                }

                const columns: ColumnsType<TableRow> = [
                  {
                    title: '扩展次数',
                    dataIndex: 'expansionIndex',
                    key: 'expansionIndex',
                    width: 70,
                    align: 'center',
                    render: (v: number) => <Tag color="blue">+{v + 1}</Tag>,
                  },
                  {
                    title: '本次费用',
                    dataIndex: 'singleCost',
                    key: 'singleCost',
                    width: 90,
                    align: 'right',
                    render: (v: number) => `${v.toLocaleString()}`,
                  },
                  {
                    title: '累计费用',
                    dataIndex: 'cumulative',
                    key: 'cumulative',
                    width: 90,
                    align: 'right',
                    render: (v: number) => <Text strong>{v.toLocaleString()}</Text>,
                  },
                  {
                    title: '面积(㎡)',
                    dataIndex: 'areaAfterExpansion',
                    key: 'areaAfterExpansion',
                    width: 65,
                    align: 'center',
                    render: (v: number) => v,
                  },
                  {
                    title: '每次租金',
                    dataIndex: 'rentPerTick',
                    key: 'rentPerTick',
                    width: 80,
                    align: 'right',
                    render: (v: number) => <Text type="success">{v.toFixed(1)}</Text>,
                  },
                ];

                return (
                  <Table<TableRow>
                    columns={columns}
                    dataSource={rows}
                    rowKey="expansionIndex"
                    size="small"
                    pagination={false}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}>
                          <Text strong>小计({from}→{to})</Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} />
                        <Table.Summary.Cell index={2}>
                          <Flex justify="flex-end">
                            <Text strong style={{ color: 'var(--colorError)' }}>
                              {cumulative.toLocaleString()} 灵石
                            </Text>
                          </Flex>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} />
                        <Table.Summary.Cell index={4} />
                      </Table.Summary.Row>
                    )}
                  />
                );
              };

              // 计算全累计
              let grandTotal = 0;
              for (let i = 0; i < maxExpansion; i++) {
                grandTotal += calcSingleExpansionCost(i, selectedTier);
              }

              // 第一表不需要 baseCumulative，第二表需要第一表的累计
              const midPoint = Math.floor(maxExpansion / 2);
              let firstTableCumulative = 0;
              for (let i = 0; i < midPoint; i++) {
                firstTableCumulative += calcSingleExpansionCost(i, selectedTier);
              }

              return (
                <>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {shopCfg.name} · {tier.label} · 初始面积 {shopCfg.initialArea} ㎡ · 扩展系数 {tier.expansionMultiplier}x · 单价 {tier.pricePerSqm} 灵石/㎡
                  </Text>
                  <Flex gap={12} align="center" wrap="wrap">
                    <Flex gap={6} align="center">
                      <Text style={{ fontSize: 12 }}>店铺类型</Text>
                      <Segmented<string>
                        size="small"
                        value={selectedShopType}
                        onChange={setSelectedShopType}
                        options={SHOP_TYPE_ORDER.map((t) => ({
                          label: SHOP_TYPE_CONFIG[t].name,
                          value: t,
                        }))}
                      />
                    </Flex>
                    <Flex gap={6} align="center">
                      <Text style={{ fontSize: 12 }}>装修等级</Text>
                      <Segmented<string>
                        size="small"
                        value={selectedTier}
                        onChange={setSelectedTier}
                        options={TIER_ORDER.map((t) => ({
                          label: TIER_CONFIG[t].label,
                          value: t,
                        }))}
                      />
                    </Flex>
                    <Flex gap={6} align="center" style={{ flex: 1, minWidth: 180 }}>
                      <Text style={{ fontSize: 12 }}>店铺等级</Text>
                      <Slider
                        min={0}
                        max={maxUpgradeLevel}
                        value={upgradeLevel}
                        onChange={setUpgradeLevel}
                        style={{ flex: 1 }}
                        tooltip={{ formatter: (v) => `Lv.${v ?? 0}` }}
                        marks={Object.fromEntries(
                          [0, 10, 20, 30, 40, 50].filter(v => v <= maxUpgradeLevel).map(v => [v, String(v)])
                        )}
                      />
                      <Text strong style={{ minWidth: 36, textAlign: 'center' }}>Lv.{upgradeLevel}</Text>
                    </Flex>
                  </Flex>
                  {renderTable(0, midPoint, 0)}
                  {renderTable(midPoint, maxExpansion, firstTableCumulative)}
                  <Divider style={{ margin: '6px 0' }} />
                  <Flex justify="flex-end">
                    <Text type="secondary" style={{ fontSize: 12 }}>0→{maxExpansion} 总费用：</Text>
                    <Text strong style={{ color: 'var(--colorError)', marginLeft: 6 }}>
                      {grandTotal.toLocaleString()} 灵石
                    </Text>
                  </Flex>
                </>
              );
            })()}
          </Flex>
        </Modal>
      )}

      {/* dev-only: 店铺收益测算弹窗 */}
      {isDevMode && calcVisible && shopStore.config && shopStore.shops.length > 0 && (
        <Modal
          open
          title="店铺收益测算（仅 dev）"
          onCancel={() => setCalcVisible(false)}
          footer={null}
          width={900}
        >
          <ShopProfitCalculator config={shopStore.config} shops={shopStore.shops} />
        </Modal>
      )}
    </Flex>
  );
});

export default ShopPanel;
