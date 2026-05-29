/**
 * 店铺收益曲线图组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：用 recharts 渲染店铺收益曲线，展示累计收入与净收益随 tick 数的变化。
 * 2. 不做什么：不做收益计算逻辑（由 ShopPanel 的 calc 函数收敛）。
 *
 * 输入 / 输出：
 * - 输入：CalcRow（一行收益测算数据）、ticksPerDay（每天 tick 数）。
 * - 输出：recharts 曲线图。
 *
 * 数据流 / 状态流：
 * CalcRow.rentPerTick + totalCost → buildCurveData → CurveDataPoint[] → recharts LineChart。
 *
 * 复用设计说明：
 * - 曲线图组件独立于 ShopPanel，避免污染主组件文件。
 * - buildCurveData 为纯函数，便于单独测试。
 *
 * 关键边界条件与坑点：
 * 1. recharts Tooltip 与 antd Tooltip 命名冲突，需重命名导入。
 * 2. isAnimationActive 关闭以避免 Modal 中动画闪烁。
 * 3. ResponsiveContainer 需要父容器有明确高度。
 */

import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Flex, Typography } from 'antd';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ReferenceLine, Legend, ResponsiveContainer,
} from 'recharts';

const { Text } = Typography;

export type CalcRow = {
  shopName: string;
  currentRent: number;
  targetTierLabel: string;
  targetExpansion: number;
  targetUpgradeLevel: number;
  rentPerTick: number;
  rentIncrease: number;
  decorationCost: number;
  expansionCost: number;
  totalCost: number;
  ticksToRecover: number;
  ticksToUpgrade: number;
};

export type CurveDataPoint = {
  tick: number;
  day: string;
  cumulativeRevenue: number;
  netProfit: number;
};

const formatSpiritStones = (value: number): string => {
  return value.toLocaleString('zh-CN');
};

export const buildCurveData = (params: {
  rentPerTick: number;
  totalCost: number;
  ticksPerDay: number;
}): CurveDataPoint[] => {
  const breakEvenTicks = params.totalCost / Math.max(params.rentPerTick, 0.01);
  const maxTicks = Math.max(50, Math.ceil(breakEvenTicks * 1.5));
  const step = Math.max(1, Math.floor(maxTicks / 60));
  const points: CurveDataPoint[] = [];
  for (let t = 0; t <= maxTicks; t += step) {
    points.push({
      tick: t,
      day: (t / params.ticksPerDay).toFixed(1),
      cumulativeRevenue: Math.round(t * params.rentPerTick),
      netProfit: Math.round(t * params.rentPerTick - params.totalCost),
    });
  }
  const last = points[points.length - 1];
  if (last && last.tick < maxTicks) {
    points.push({
      tick: maxTicks,
      day: (maxTicks / params.ticksPerDay).toFixed(1),
      cumulativeRevenue: Math.round(maxTicks * params.rentPerTick),
      netProfit: Math.round(maxTicks * params.rentPerTick - params.totalCost),
    });
  }
  return points;
};

const ShopProfitCurveChart = observer(({
  row,
  ticksPerDay,
}: {
  row: CalcRow;
  ticksPerDay: number;
}) => {
  const curveData = useMemo(
    () => buildCurveData({
      rentPerTick: row.rentPerTick,
      totalCost: row.totalCost,
      ticksPerDay,
    }),
    [row.rentPerTick, row.totalCost, ticksPerDay],
  );

  return (
    <Flex vertical gap={8} style={{ marginTop: 12 }}>
      <Flex justify="space-between" align="center">
        <Text strong style={{ fontSize: 13 }}>
          {row.shopName} — {row.targetTierLabel} / 扩展+{row.targetExpansion} / Lv.{row.targetUpgradeLevel}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          总成本 {formatSpiritStones(row.totalCost)} 灵石，每次产出 {row.rentPerTick.toFixed(1)} 灵石
        </Text>
      </Flex>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={curveData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="tick"
            label={{ value: '收租 tick 数', position: 'insideBottom', offset: -4, fontSize: 12 }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 11 }}
            label={{ value: '灵石', angle: -90, position: 'insideLeft', offset: -4, fontSize: 12 }}
          />
          <RechartsTooltip
            formatter={(value: number, name: string) => [
              formatSpiritStones(value),
              name === 'cumulativeRevenue' ? '累计收入' : '净收益',
            ]}
            labelFormatter={(label) => `Tick ${label}`}
          />
          <Legend
            formatter={(value: string) =>
              value === 'cumulativeRevenue' ? '累计收入' : '净收益'
            }
          />
          <ReferenceLine y={0} stroke="#999" strokeDasharray="4 4" />
          {row.ticksToRecover !== Infinity && (
            <ReferenceLine
              x={row.ticksToRecover}
              stroke="#52c41a"
              strokeDasharray="3 3"
              label={{
                value: `回本 ~${row.ticksToRecover} tick`,
                position: 'top',
                fontSize: 11,
                fill: '#52c41a',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="cumulativeRevenue"
            stroke="#1890ff"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="netProfit"
            stroke="#52c41a"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Flex>
  );
});

export default ShopProfitCurveChart;
