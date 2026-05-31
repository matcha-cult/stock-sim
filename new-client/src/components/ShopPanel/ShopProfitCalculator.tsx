/**
 * dev-only 店铺收益测算器组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示每间店铺从当前状态升级到各装修等级/扩展次数/提升等级
 *    的成本与收益对比表，点击行查看收益曲线。
 * 2. 不做什么：不维护店铺状态（由 ShopStore 驱动），不做实际交易（纯测算）。
 *
 * 输入 / 输出：
 * - 输入：config（店铺配置）、shops（当前店铺列表）。
 * - 输出：测算对比表格 + 选中行的收益曲线图。
 *
 * 数据流 / 状态流：
 * 店铺当前状态 → 枚举所有目标组合 → 计算成本/收益 → 排序 → 表格展示
 * → 用户点击行 → 收益曲线图（复用 ShopProfitCurveChart）。
 *
 * 复用设计说明：
 * - 计算函数（calcRentPerTick 等）为纯函数，可单独测试。
 * - 收益曲线图复用 ShopProfitCurveChart 组件，不重复实现。
 * - CalcRow 类型从 ShopProfitCurveChart 导入，避免重复定义。
 *
 * 关键边界条件与坑点：
 * 1. 仅 dev 模式使用，生产环境不打包此组件（由调用方控制）。
 * 2. 扩展成本需累加从当前到目标的每次扩展费用，不能直接用目标次幂计算。
 * 3. 扩展面积的装修费用按每次扩展增量面积计算。
 */

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Flex, Table, Typography } from 'antd';
import ShopProfitCurveChart, { type CalcRow } from './ShopProfitCurveChart';

const { Text } = Typography;

// ==================== 类型定义 ====================

export type ShopProfitCalculatorProps = {
  config: {
    shopTypes: Record<string, { name: string; initialArea: number; initialRent: number; purchaseCost: number }>;
    decorationTiers: Record<string, {
      label: string;
      index: number;
      rentMultiplier: number;
      pricePerSqm: number;
      expansionMultiplier: number;
    }>;
    decorationTierOrder: string[];
    constants: {
      spaceExpansionAreaIncrement: number;
      spaceExpansionBaseCost: number;
      maxPendingRentTicks: number;
      decorationRefundRate: number;
      upgradeLevelBonusRate: number;
      upgradeTicksBase: number;
      rentTickIntervalMinutes: number;
    };
  };
  shops: Array<{
    id: number;
    shopType: string;
    shopTypeName: string;
    area: number;
    decorationTier: string;
    decorationTierLabel: string;
    upgradeLevel: number;
    spaceExpansion: number;
    rentPerTick: number;
  }>;
};

// ==================== 纯计算函数 ====================

/**
 * 计算每次收租的租金产出。
 */
const calcRentPerTick = (
  initialRent: number,
  tierMultiplier: number,
  expansion: number,
  upgradeLevel: number,
  bonusRate: number,
): number => {
  const spaceBonus = 1 + expansion * 0.2;
  const upgradeBonus = 1 + upgradeLevel * bonusRate;
  return initialRent * tierMultiplier * spaceBonus * upgradeBonus;
};

/**
 * 计算装修调整成本（升级到更高等级时的差价）。
 */
const calcDecorationCost = (
  currentPricePerSqm: number,
  targetPricePerSqm: number,
  area: number,
): number => {
  return Math.abs(targetPricePerSqm - currentPricePerSqm) * area;
};

/**
 * 计算单次空间扩展费用。
 */
const calcExpansionCost = (
  baseCost: number,
  expansion: number,
  tierMultiplier: number,
): number => {
  return baseCost * Math.pow(2, expansion) * tierMultiplier;
};

/**
 * 计算升级到指定等级所需的 tick 数。
 */
const calcUpgradeTicksNeeded = (level: number, base: number): number => {
  return base * (level + 1);
};

// ==================== 主组件 ====================

/**
 * 格式化灵石显示（组件内私有，避免依赖外部）。
 */
const formatSpiritStones = (value: number): string => {
  return value.toLocaleString('zh-CN');
};

const ShopProfitCalculator = observer(({ config, shops }: ShopProfitCalculatorProps) => {
  const { constants, decorationTiers, decorationTierOrder } = config;

  const rows: CalcRow[] = [];
  const TICKS_PER_DAY = (24 * 60) / constants.rentTickIntervalMinutes;

  for (const shop of shops) {
    const shopConfig = config.shopTypes[shop.shopType];
    if (!shopConfig) continue;

    const currentTierIdx = decorationTiers[shop.decorationTier]?.index ?? 0;
    const currentPricePerSqm = decorationTiers[shop.decorationTier]?.pricePerSqm ?? 10;

    // 枚举目标装修等级（从当前等级到最高）
    for (let ti = currentTierIdx; ti < decorationTierOrder.length; ti++) {
      const targetTier = decorationTierOrder[ti];
      const targetTierConfig = decorationTiers[targetTier];
      if (!targetTierConfig) continue;

      // 枚举扩展次数（从当前到 +4）
      const maxExtraExpansion = 4;
      for (let extraExp = 0; extraExp <= maxExtraExpansion; extraExp++) {
        const targetExpansion = shop.spaceExpansion + extraExp;

        // 枚举升级等级（从当前到 +4）
        const maxExtraUpgrade = 4;
        for (let extraUp = 0; extraUp <= maxExtraUpgrade; extraUp++) {
          const targetUpgradeLevel = shop.upgradeLevel + extraUp;

          // 跳过当前状态本身
          if (ti === currentTierIdx && extraExp === 0 && extraUp === 0) continue;

          const targetRent = calcRentPerTick(
            shopConfig.initialRent,
            targetTierConfig.rentMultiplier,
            targetExpansion,
            targetUpgradeLevel,
            constants.upgradeLevelBonusRate,
          );

          // 装修成本（仅当 tier 变化）
          const decorationCost = ti > currentTierIdx
            ? calcDecorationCost(currentPricePerSqm, targetTierConfig.pricePerSqm, shop.area)
            : 0;

          // 扩展成本（累加从当前到目标的每次扩展费用）
          let expansionCost = 0;
          const tierMulti = targetTierConfig.expansionMultiplier;
          const baseCost = config.constants.spaceExpansionBaseCost;
          for (let e = shop.spaceExpansion; e < targetExpansion; e++) {
            expansionCost += calcExpansionCost(baseCost, e, tierMulti);
          }
          // 扩展面积的装修费用
          expansionCost += targetTierConfig.pricePerSqm * constants.spaceExpansionAreaIncrement * extraExp;

          const totalCost = decorationCost + expansionCost;
          const rentIncrease = targetRent - shop.rentPerTick;
          const ticksToRecover = rentIncrease > 0 ? Math.ceil(totalCost / rentIncrease) : Infinity;
          const ticksToUpgrade = calcUpgradeTicksNeeded(targetUpgradeLevel, constants.upgradeTicksBase);

          rows.push({
            shopName: shop.shopTypeName,
            currentRent: shop.rentPerTick,
            targetTierLabel: targetTierConfig.label,
            targetExpansion,
            targetUpgradeLevel,
            rentPerTick: targetRent,
            rentIncrease,
            decorationCost,
            expansionCost,
            totalCost,
            ticksToRecover,
            ticksToUpgrade,
          });
        }
      }
    }
  }

  // 按总成本排序
  rows.sort((a, b) => a.totalCost - b.totalCost);

  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const selectedRow = selectedRowIdx !== null ? rows[selectedRowIdx] ?? null : null;

  const columns = [
    { title: '店铺', dataIndex: 'shopName', key: 'shopName', width: 80 },
    { title: '当前产出', dataIndex: 'currentRent', key: 'currentRent', width: 80, render: (v: number) => `${v.toFixed(1)}` },
    { title: '装修', dataIndex: 'targetTierLabel', key: 'targetTierLabel', width: 60 },
    { title: '扩展', dataIndex: 'targetExpansion', key: 'targetExpansion', width: 50, render: (v: number) => `+${v}` },
    { title: '等级', dataIndex: 'targetUpgradeLevel', key: 'targetUpgradeLevel', width: 50, render: (v: number) => `Lv.${v}` },
    { title: '新产出/次', dataIndex: 'rentPerTick', key: 'rentPerTick', width: 90, render: (v: number) => `${v.toFixed(1)}` },
    { title: '产出提升/次', dataIndex: 'rentIncrease', key: 'rentIncrease', width: 90, render: (v: number) => `+${v.toFixed(1)}` },
    { title: '装修成本', dataIndex: 'decorationCost', key: 'decorationCost', width: 90, render: (v: number) => formatSpiritStones(v) },
    { title: '扩展成本', dataIndex: 'expansionCost', key: 'expansionCost', width: 90, render: (v: number) => formatSpiritStones(v) },
    { title: '总成本', dataIndex: 'totalCost', key: 'totalCost', width: 90, render: (v: number) => formatSpiritStones(v) },
    { title: '回本tick数', dataIndex: 'ticksToRecover', key: 'ticksToRecover', width: 90, render: (v: number) => v === Infinity ? '∞' : `${v} (~${(v / TICKS_PER_DAY).toFixed(1)}天)` },
    { title: '升级tick数', dataIndex: 'ticksToUpgrade', key: 'ticksToUpgrade', width: 90, render: (v: number) => `${v} (~${(v / TICKS_PER_DAY).toFixed(1)}天)` },
  ];

  return (
    <Flex vertical gap={12}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        基于当前状态，枚举各店铺升级装修、扩展空间、提升等级后的成本与收益。点击表格行查看收益曲线。
      </Text>
      <Table<CalcRow>
        size="small"
        columns={columns}
        dataSource={rows}
        rowKey={(_, idx) => `${idx}`}
        scroll={{ y: 400 }}
        pagination={false}
        onRow={(_, idx) => ({
          style: { cursor: 'pointer' },
          onClick: () => setSelectedRowIdx(idx ?? null),
        })}
        rowClassName={(_, idx) => idx === selectedRowIdx ? 'ant-table-row-selected' : ''}
      />
      {selectedRow && (
        <ShopProfitCurveChart row={selectedRow} ticksPerDay={TICKS_PER_DAY} />
      )}
    </Flex>
  );
});

export default ShopProfitCalculator;
