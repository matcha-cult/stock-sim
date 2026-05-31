/**
 * 挂单交易卡片组件（仅提交挂单）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供挂单创建表单（方向、数量、限价、成交逻辑），绑定当前选中股票。
 * 2. 不做什么：不展示挂单列表（由 PendingOrderManagement tab 负责），不决定成交逻辑。
 *
 * 输入 / 输出：
 * - 输入：当前选中的股票 DTO、RootStore（authStore 余额 + stockStore 创建挂单）。
 * - 输出：挂单创建交互界面。
 *
 * 数据流 / 状态流：
 * 用户填写表单 -> 前端校验（余额/持仓） -> 调用 stockStore.createPendingOrder -> 后端校验 + 落库 + 刷新角色灵石。
 *
 * 复用设计说明：
 * - 布局使用 antd Card + Flex + Segmented，与 TradeBox 保持一致风格。
 * - 格式化函数复用 viewTransform 中的 formatStockMarketPrice / formatStockMarketQuantity。
 * - 校验逻辑集中在组件内，不抽象为 hook（仅一处使用）。
 *
 * 关键边界条件与坑点：
 * 1. 买入挂单的余额校验是前端预估（含费用），后端会二次精确校验，两者不一致时以后端为准。
 * 2. 卖出挂单的持仓校验基于选中股票的 maxSellQty，用户切换股票时需重置表单并同步限价。
 */

import { useCallback, useMemo, useEffect, useState, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import {
  App, Button, Card, Flex, InputNumber, Segmented, Tag,
} from 'antd';
import { ShoppingCartOutlined, FallOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';
import { useIsMobile } from '../shared/responsive';
import type { StockMarketStockDto } from '../services/api/stockMarket';
import type { PendingOrderSide, PendingOrderTriggerMode } from '../services/api/stockMarket';
import {
  formatStockMarketPrice,
  formatStockMarketCurrency,
} from '../domain/stock-market/viewTransform';

/** 佣金费率（万分之 30 = 0.03%）。 */
const COMMISSION_RATE = 30;
/** 印花税费率（万分之 50 = 0.05%，仅卖出）。 */
const STAMP_DUTY_RATE = 50;
/** 过户费率（万分之 1 = 0.001%）。 */
const TRANSFER_FEE_RATE = 1;
/** 费率分母（万分比基准，与后端 FEE_RATE_DENOMINATOR 一致）。 */
const FEE_RATE_DENOMINATOR = 100_000;

/**
 * 向上取整费用计算（与后端 calculateStockMarketFeeComponent 一致）。
 * 后端公式：ceil(grossAmountSpiritStones * rate / FEE_RATE_DENOMINATOR)
 */
const calcFeeSpiritStones = (
  grossAmountSpiritStones: number,
  rate: number,
): number => {
  if (grossAmountSpiritStones <= 0 || rate <= 0) return 0;
  return Math.ceil((grossAmountSpiritStones * rate) / FEE_RATE_DENOMINATOR);
};

/** 计算费用明细（与后端 calculateStockMarketTradeFeeBreakdown 一致）。 */
const calcTradeFeeBreakdown = (
  unitPrice: number,
  quantity: number,
  side: PendingOrderSide,
): {
  grossAmount: number;
  commissionFee: number;
  stampDuty: number;
  transferFee: number;
  totalFee: number;
  totalCost: number;
  netAmount: number;
} => {
  const grossAmount = unitPrice * quantity;
  const commissionFee = calcFeeSpiritStones(grossAmount, COMMISSION_RATE);
  const stampDuty = side === 'sell' ? calcFeeSpiritStones(grossAmount, STAMP_DUTY_RATE) : 0;
  const transferFee = calcFeeSpiritStones(grossAmount, TRANSFER_FEE_RATE);
  const totalFee = commissionFee + stampDuty + transferFee;
  return {
    grossAmount,
    commissionFee,
    stampDuty,
    transferFee,
    totalFee,
    totalCost: side === 'buy' ? grossAmount + totalFee : 0,
    netAmount: side === 'sell' && grossAmount > totalFee ? grossAmount - totalFee : 0,
  };
};

type FormState = {
  side: PendingOrderSide;
  quantity: number | null;
  limitPrice: number | null;
  triggerMode: PendingOrderTriggerMode;
};

const PendingOrderCard = observer(function PendingOrderCard({
  selectedStock,
}: {
  selectedStock: StockMarketStockDto | null;
}): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  const { authStore, stockStore } = rootStore;
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  // PC 端每项 49% 宽度（避免 50% 因 gap 导致换行），移动端自动 100%
  const halfItemStyle = useMemo(() => ({
    flex: isMobile ? '1 1 100%' : '0 0 calc(49% - 4px)',
  }), [isMobile]);

  const [form, setForm] = useState<FormState>({
    side: 'buy',
    quantity: 1,
    limitPrice: selectedStock?.priceSpiritStones ?? null,
    triggerMode: 'normal',
  });
  const [submitting, setSubmitting] = useState(false);

  // 选中股票变化时同步限价为当前股价
  useEffect(() => {
    if (selectedStock) {
      setForm((prev) => ({
        ...prev,
        limitPrice: selectedStock.priceSpiritStones,
      }));
    }
  }, [selectedStock?.stockId]);

  const handleSubmit = useCallback(async () => {
    if (!selectedStock || form.quantity === null || form.limitPrice === null) return;
    if (form.quantity <= 0 || form.limitPrice <= 0) return;

    // 前端预校验
    if (form.side === 'sell') {
      const maxSellQty = selectedStock.maxSellQty;
      if (form.quantity > maxSellQty) {
        message.error(`持仓不足，当前可卖 ${maxSellQty} 股`);
        return;
      }
    } else {
      // 使用精确费用计算进行余额预校验
      const fees = calcTradeFeeBreakdown(form.limitPrice, form.quantity, 'buy');
      if (fees.totalCost > authStore.spiritStones) {
        message.error(`灵石不足，预估需要 ${formatStockMarketCurrency(fees.totalCost)}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await stockStore.createPendingOrder({
        stockId: selectedStock.stockId,
        side: form.side,
        quantity: form.quantity,
        limitPrice: form.limitPrice,
        triggerMode: form.triggerMode,
      });
      if (result.success) {
        message.success(result.message);
        setForm((prev) => ({ ...prev, quantity: 1 }));
        // 创建挂单冻结灵石/股票，需刷新角色资源
        void authStore.refreshCharacter();
      } else {
        message.error(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [selectedStock, form, authStore, stockStore, message]);

  const stockCode = selectedStock?.code ?? '';
  const currentPriceText = selectedStock
    ? formatStockMarketPrice(selectedStock.priceSpiritStones)
    : '--';

  // 费用明细计算（数量或限价变化时重算）
  const feeBreakdown = useMemo(() => {
    if (form.quantity === null || form.quantity <= 0 || form.limitPrice === null || form.limitPrice <= 0) {
      return null;
    }
    return calcTradeFeeBreakdown(form.limitPrice, form.quantity, form.side);
  }, [form.quantity, form.limitPrice, form.side]);

  return (
    <Card size="small" data-element="pending-order-card">
      <Flex vertical gap={12}>
        {/* 标题栏 */}
        <Flex justify="space-between" align="center">
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>挂单交易</span>
          {selectedStock && (
            <Flex gap={8} align="center">
              <Tag>{stockCode}</Tag>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                当前价 {currentPriceText}
              </span>
            </Flex>
          )}
        </Flex>

        {/* 方向 + 成交逻辑（PC 端各 50%，移动端自动换行 100%） */}
        <Flex gap={8} align="center" wrap="wrap">
          <Flex gap={8} align="center" style={halfItemStyle}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>方向</span>
            <Segmented<PendingOrderSide>
              size="small"
              value={form.side}
              onChange={(side) => setForm((prev) => ({ ...prev, side }))}
              options={[
                { label: '买入', value: 'buy' as const, icon: <ShoppingCartOutlined /> },
                { label: '卖出', value: 'sell' as const, icon: <FallOutlined /> },
              ]}
            />
          </Flex>
          <Flex gap={8} align="center" style={halfItemStyle} wrap="wrap">
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>成交逻辑</span>
            <Segmented<PendingOrderTriggerMode>
              size="small"
              value={form.triggerMode}
              onChange={(triggerMode) => setForm((prev) => ({ ...prev, triggerMode }))}
              options={[
                { label: '常规', value: 'normal' as const },
                { label: '溢价', value: 'premium' as const },
              ]}
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              {form.triggerMode === 'normal'
                ? `买入≤限价 / 卖出≥限价`
                : `买入≥限价 / 卖出≤限价`}
            </span>
          </Flex>
        </Flex>

        {/* 数量 + 限价（PC 端各 50%，移动端自动换行 100%） */}
        <Flex gap={8} align="center" wrap="wrap">
          <Flex gap={8} align="center" wrap="wrap" style={halfItemStyle}>
            <Flex gap={4} align="center">
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>数量</span>
              <InputNumber<number>
                size="small"
                min={1}
                precision={0}
                value={form.quantity}
                onChange={(v) => setForm((prev) => ({ ...prev, quantity: v }))}
                style={{ width: 100 }}
              />
            </Flex>
            {selectedStock && (
              <Flex gap={4} wrap="wrap">
                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                  const unitPrice = form.side === 'buy' && form.limitPrice !== null && form.limitPrice > 0
                    ? form.limitPrice
                    : selectedStock.priceSpiritStones;
                  const maxQty = form.side === 'sell'
                    ? selectedStock.maxSellQty
                    : Math.max(0, Math.floor(authStore.spiritStones / unitPrice));
                  const qty = ratio === 1
                    ? maxQty
                    : Math.max(1, Math.floor(maxQty * ratio));
                  return (
                    <Button
                      key={ratio}
                      size="small"
                      disabled={maxQty <= 0}
                      onClick={() => setForm((prev) => ({ ...prev, quantity: qty }))}
                      data-action={`pending-order-qty-${ratio}`}
                    >
                      {ratio === 1 ? `全部(${maxQty})` : `${ratio * 100}%`}
                    </Button>
                  );
                })}
              </Flex>
            )}
          </Flex>
          <Flex gap={8} align="center" wrap="wrap" style={halfItemStyle}>
            <Flex gap={4} align="center">
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>限价</span>
              <InputNumber<number>
                size="small"
                min={0.01}
                precision={2}
                step={0.01}
                value={form.limitPrice}
                onChange={(v) => setForm((prev) => ({ ...prev, limitPrice: v }))}
                style={{ width: 120 }}
                addonAfter="灵石"
              />
            </Flex>
            {selectedStock && (
              <Flex gap={4} wrap="wrap">
                {[0.02, 0.05, 0.1].map((ratio) => {
                  const pct = `${(ratio * 100).toFixed(0)}%`;
                  const isBelow = (form.side === 'buy' && form.triggerMode === 'normal')
                    || (form.side === 'sell' && form.triggerMode === 'premium');
                  const price = Math.max(0.01, Number((
                    selectedStock.priceSpiritStones * (isBelow ? (1 - ratio) : (1 + ratio))
                  ).toFixed(2)));
                  return (
                    <Button
                      key={ratio}
                      size="small"
                      onClick={() => setForm((prev) => ({ ...prev, limitPrice: price }))}
                      data-action={`pending-order-price-${ratio}`}
                    >
                      {isBelow ? '-' : '+'}{pct}
                    </Button>
                  );
                })}
              </Flex>
            )}
          </Flex>
        </Flex>

        {/* 费用明细 */}
        {feeBreakdown !== null && (
          <Flex gap={8} align="center" wrap="wrap">
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', ...halfItemStyle }}>
              {form.side === 'buy'
                ? `买入费用(佣金+过户) ${formatStockMarketCurrency(feeBreakdown.totalFee)}`
                : `卖出费用(印花税+过户) ${formatStockMarketCurrency(feeBreakdown.totalFee)}`}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', color: form.side === 'buy' ? 'var(--color-error)' : 'var(--color-success)', ...halfItemStyle }}>
              {form.side === 'buy' ? `预计扣款 ${formatStockMarketCurrency(feeBreakdown.totalCost)}` : `预计到账 ${formatStockMarketCurrency(feeBreakdown.netAmount)}`}
            </span>
          </Flex>
        )}

        {/* 创建按钮 */}
        <Flex gap={8}>
          <Button
            size="small"
            type="primary"
            loading={submitting}
            disabled={!selectedStock || form.quantity === null || form.limitPrice === null || form.quantity <= 0 || form.limitPrice <= 0}
            onClick={handleSubmit}
            data-action="create-pending-order"
          >
            创建挂单
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
});

export default PendingOrderCard;
