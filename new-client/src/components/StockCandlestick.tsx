/**
 * K 线走势图组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：用 TradingView Lightweight Charts 渲染选中股票的 K 线、均线、右侧价格轴和加载/空状态。
 * 2. 不做什么：不发起历史请求、不计算 OHLC、不决定涨跌业务规则。
 *
 * 输入 / 输出：
 * - 输入：`model` 为 viewTransform 已派生好的 K 线和均线数据，`loading` 表示历史请求状态。
 * - 输出：一个由第三方 canvas 图表承载的行情图。
 *
 * 数据流 / 状态流：
 * history DTO -> viewTransform 一次性派生 OHLC 与均线 -> 本组件把数据写入 lightweight-charts series。
 *
 * 复用设计说明：
 * - 图表库实例、series 创建、尺寸自适应和主题同步集中在本组件，避免弹窗主文件维护第三方图表生命周期。
 * - 均线和 K 线数据仍复用 viewTransform 的纯函数输出，后续换图表库也只影响本组件。
 *
 * 关键边界条件与坑点：
 * 1. 图表库只能在浏览器 DOM 容器可用后创建，卸载时必须 remove，避免反复打开泄漏 canvas。
 * 2. lightweight-charts 的时间戳单位是秒，数据层已经前置转换，组件只做类型收敛。
 * 3. 不能调用 fitContent，否则少量历史点会被强行撑满宽度。
 * 4. 价格轴自动缩放要额外扩展 min/max，避免最高价、最低价和均线贴住上下边缘。
 */

import { LineChartOutlined } from '@ant-design/icons';
import { Spin, Flex, Card, Tag } from 'antd';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type AutoscaleInfoProvider,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Point,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  getStockMarketToneClassName,
} from '../domain/stock-market/viewTransform';
import type {
  StockMarketHistoryViewModel,
  StockMarketMovingAverageView,
  StockMarketTone,
  StockMarketCandlestickView,
} from '../domain/stock-market/types';

interface StockCandlestickProps {
  model: StockMarketHistoryViewModel;
  loading: boolean;
  latestPriceText: string;
  latestChangeText: string;
  latestTone: StockMarketTone;
}

type ChartRefs = {
  chart: IChartApi;
  candlestickSeries: ISeriesApi<'Candlestick'>;
  movingAverageSeriesByKey: Map<StockMarketMovingAverageView['key'], ISeriesApi<'Line'>>;
};

type TooltipData = {
  timeText: string;
  changeText: string;
  openPriceText: string;
  highPriceText: string;
  lowPriceText: string;
  closePriceText: string;
  reasonText: string;
  tone: StockMarketTone;
};

type TooltipRefs = {
  root: HTMLDivElement | null;
  time: HTMLDivElement | null;
  change: HTMLDivElement | null;
  open: HTMLDivElement | null;
  high: HTMLDivElement | null;
  low: HTMLDivElement | null;
  close: HTMLDivElement | null;
  reason: HTMLDivElement | null;
};

const CHART_COLORS = {
  upFill: '#f05b4f',
  upStroke: '#b9342d',
  downFill: '#58a678',
  downStroke: '#2f7f5c',
  ma5: '#4f88a7',
  ma10: '#d8bd80',
  ma30: '#9c8aa4',
};

const MA_COLOR_BY_KEY: Record<StockMarketMovingAverageView['key'], string> = {
  ma5: CHART_COLORS.ma5,
  ma10: CHART_COLORS.ma10,
  ma30: CHART_COLORS.ma30,
};

const MA_KEYS: readonly StockMarketMovingAverageView['key'][] = ['ma5', 'ma10', 'ma30'];
const CHART_BAR_SPACING = 6;
const CHART_MIN_BAR_SPACING = 3;
const CHART_RIGHT_OFFSET = 1;
const CHART_MIN_VISIBLE_BARS = 72;
const PRICE_RANGE_PADDING_RATIO = 0.12;
const PRICE_RANGE_MIN_PADDING = 2;
const TOOLTIP_OFFSET = 12;
const TOOLTIP_EDGE_GAP = 8;

const readCssColor = (element: HTMLElement, variableName: string, fallback: string): string => {
  const value = getComputedStyle(element).getPropertyValue(variableName).trim();
  return value || fallback;
};

const toChartTime = (value: number): UTCTimestamp => value as UTCTimestamp;

const resolveVisibleBarCount = (containerWidth: number): number => {
  return Math.max(CHART_MIN_VISIBLE_BARS, Math.ceil(containerWidth / CHART_BAR_SPACING));
};

const autoscaleInfoProvider: AutoscaleInfoProvider = (baseImplementation) => {
  const baseInfo = baseImplementation();
  if (!baseInfo?.priceRange) return baseInfo;

  const { minValue, maxValue } = baseInfo.priceRange;
  const valueRange = Math.max(0, maxValue - minValue);
  const padding = Math.max(PRICE_RANGE_MIN_PADDING, valueRange * PRICE_RANGE_PADDING_RATIO);

  return {
    ...baseInfo,
    priceRange: {
      minValue: Math.max(0, minValue - padding),
      maxValue: maxValue + padding,
    },
  };
};

const hideTooltip = (tooltipRoot: HTMLDivElement | null): void => {
  tooltipRoot?.classList.remove('is-visible');
};

const updateTooltip = (
  refs: TooltipRefs,
  container: HTMLDivElement | null,
  point: Point,
  data: TooltipData,
): void => {
  if (!refs.root || !refs.time || !refs.change || !refs.open || !refs.high || !refs.low || !refs.close || !refs.reason || !container) return;

  refs.time.textContent = data.timeText;
  refs.change.textContent = data.changeText;
  refs.change.className = `stock-market-kline-tooltip-change ${getStockMarketToneClassName(data.tone)}`;
  refs.open.textContent = `开 ${data.openPriceText}`;
  refs.high.textContent = `高 ${data.highPriceText}`;
  refs.low.textContent = `低 ${data.lowPriceText}`;
  refs.close.textContent = `收 ${data.closePriceText}`;
  refs.reason.textContent = data.reasonText;

  const tooltipWidth = refs.root.offsetWidth;
  const tooltipHeight = refs.root.offsetHeight;
  const maxLeft = Math.max(TOOLTIP_EDGE_GAP, container.clientWidth - tooltipWidth - TOOLTIP_EDGE_GAP);
  const maxTop = Math.max(TOOLTIP_EDGE_GAP, container.clientHeight - tooltipHeight - TOOLTIP_EDGE_GAP);
  const preferredLeft = point.x + TOOLTIP_OFFSET + tooltipWidth > container.clientWidth
    ? point.x - tooltipWidth - TOOLTIP_OFFSET
    : point.x + TOOLTIP_OFFSET;
  const preferredTop = point.y + TOOLTIP_OFFSET + tooltipHeight > container.clientHeight
    ? point.y - tooltipHeight - TOOLTIP_OFFSET
    : point.y + TOOLTIP_OFFSET;
  const left = Math.min(maxLeft, Math.max(TOOLTIP_EDGE_GAP, preferredLeft));
  const top = Math.min(maxTop, Math.max(TOOLTIP_EDGE_GAP, preferredTop));

  refs.root.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  refs.root.classList.add('is-visible');
};

const StockCandlestick = memo(function StockCandlestick({
  model,
  loading,
  latestPriceText,
  latestChangeText,
  latestTone,
}: StockCandlestickProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRootRef = useRef<HTMLDivElement | null>(null);
  const tooltipTimeRef = useRef<HTMLDivElement | null>(null);
  const tooltipChangeRef = useRef<HTMLDivElement | null>(null);
  const tooltipOpenRef = useRef<HTMLDivElement | null>(null);
  const tooltipHighRef = useRef<HTMLDivElement | null>(null);
  const tooltipLowRef = useRef<HTMLDivElement | null>(null);
  const tooltipCloseRef = useRef<HTMLDivElement | null>(null);
  const tooltipReasonRef = useRef<HTMLDivElement | null>(null);
  const chartRefs = useRef<ChartRefs | null>(null);
  const tooltipDataByTimeRef = useRef<ReadonlyMap<number, TooltipData>>(new Map());
  const hasChartData = model.candlesticks.length > 0;
  const shouldRenderChart = !loading && hasChartData;

  const candlestickData = useMemo<CandlestickData<UTCTimestamp>[]>(() => {
    return model.candlesticks.map((candlestick: StockMarketCandlestickView) => ({
      time: toChartTime(candlestick.time),
      open: candlestick.open,
      high: candlestick.high,
      low: candlestick.low,
      close: candlestick.close,
    }));
  }, [model.candlesticks]);

  const movingAverageDataByKey = useMemo(() => {
    const dataByKey = new Map<StockMarketMovingAverageView['key'], LineData<UTCTimestamp>[]>();
    for (const average of model.movingAverages) {
      dataByKey.set(average.key, average.data.map((point) => ({
        time: toChartTime(point.time),
        value: point.value,
      })));
    }
    return dataByKey;
  }, [model.movingAverages]);

  const tooltipDataByTime = useMemo(() => {
    const dataByTime = new Map<number, TooltipData>();
    for (const candlestick of model.candlesticks) {
      dataByTime.set(candlestick.time, {
        timeText: candlestick.timeText,
        changeText: candlestick.changeText,
        openPriceText: candlestick.openPriceText,
        highPriceText: candlestick.highPriceText,
        lowPriceText: candlestick.lowPriceText,
        closePriceText: candlestick.closePriceText,
        reasonText: candlestick.reasonText,
        tone: candlestick.tone,
      });
    }
    return dataByTime;
  }, [model.candlesticks]);

  useEffect(() => {
    tooltipDataByTimeRef.current = tooltipDataByTime;
    hideTooltip(tooltipRootRef.current);
  }, [tooltipDataByTime]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldRenderChart) return undefined;

    const textColor = readCssColor(container, '--text-secondary', '#5f6368');
    const backgroundColor = readCssColor(container, '--panel-bg', '#ffffff');
    const gridColor = readCssColor(container, '--border-color-soft', 'rgba(0, 0, 0, 0.10)');

    const chart = createChart(container, {
      autoSize: true,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
        fontSize: 12,
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: gridColor, style: LineStyle.Dotted, visible: true },
        horzLines: { color: gridColor, style: LineStyle.Solid, visible: true },
      },
      rightPriceScale: {
        borderVisible: false,
        entireTextOnly: false,
        minimumWidth: 52,
        scaleMargins: { top: 0.08, bottom: 0.06 },
        ticksVisible: false,
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: false,
        fixRightEdge: true,
        rightOffset: CHART_RIGHT_OFFSET,
        barSpacing: CHART_BAR_SPACING,
        minBarSpacing: CHART_MIN_BAR_SPACING,
        timeVisible: false,
        visible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        horzLine: { color: textColor, style: LineStyle.Dotted, width: 1, visible: true, labelVisible: true },
        vertLine: { color: textColor, style: LineStyle.Dotted, width: 1, visible: true, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (price: number) => price.toFixed(2) },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: CHART_COLORS.upFill,
      downColor: CHART_COLORS.downFill,
      borderVisible: true,
      borderUpColor: CHART_COLORS.upStroke,
      borderDownColor: CHART_COLORS.downStroke,
      wickUpColor: CHART_COLORS.upStroke,
      wickDownColor: CHART_COLORS.downStroke,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
      lastValueVisible: true,
      autoscaleInfoProvider,
    });

    const movingAverageSeriesByKey = new Map<StockMarketMovingAverageView['key'], ISeriesApi<'Line'>>();
    for (const key of MA_KEYS) {
      const series = chart.addLineSeries({
        color: MA_COLOR_BY_KEY[key],
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider,
      });
      movingAverageSeriesByKey.set(key, series);
    }

    const handleCrosshairMove = (param: MouseEventParams): void => {
      if (!param.point || typeof param.time !== 'number') {
        hideTooltip(tooltipRootRef.current);
        return;
      }

      const tooltipData = tooltipDataByTimeRef.current.get(param.time);
      if (!tooltipData) {
        hideTooltip(tooltipRootRef.current);
        return;
      }

      updateTooltip(
        {
          root: tooltipRootRef.current,
          time: tooltipTimeRef.current,
          change: tooltipChangeRef.current,
          open: tooltipOpenRef.current,
          high: tooltipHighRef.current,
          low: tooltipLowRef.current,
          close: tooltipCloseRef.current,
          reason: tooltipReasonRef.current,
        },
        containerRef.current,
        param.point,
        tooltipData,
      );
    };

    chartRefs.current = { chart, candlestickSeries, movingAverageSeriesByKey };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      hideTooltip(tooltipRootRef.current);
      chartRefs.current = null;
      chart.remove();
    };
  }, [shouldRenderChart]);

  useEffect(() => {
    const refs = chartRefs.current;
    if (!refs || !shouldRenderChart) return;
    refs.candlestickSeries.setData(candlestickData);
    for (const average of model.movingAverages) {
      refs.movingAverageSeriesByKey.get(average.key)?.setData(
        movingAverageDataByKey.get(average.key) ?? [],
      );
    }
    const visibleBarCount = resolveVisibleBarCount(containerRef.current?.clientWidth ?? 0);
    refs.chart.timeScale().setVisibleLogicalRange({
      from: candlestickData.length - visibleBarCount - CHART_RIGHT_OFFSET,
      to: candlestickData.length - 1 + CHART_RIGHT_OFFSET,
    });
  }, [candlestickData, model.movingAverages, movingAverageDataByKey, shouldRenderChart]);

  return (
    <Card
      id="candlestick-card"
      data-section="stock-market-history"
      size="small"
      title={
        <span>
          <LineChartOutlined /> 近期走势
        </span>
      }
      extra={
        <span className={getStockMarketToneClassName(latestTone)}>
          {latestPriceText} {latestChangeText}
        </span>
      }
    >
      {loading ? (
        <Flex justify="center" style={{ padding: 16 }}>
          <Spin size="small" />
        </Flex>
      ) : null}
      {!loading && !hasChartData ? (
        <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 16 }}>暂无走势记录</div>
      ) : null}
      {shouldRenderChart ? (
        <div className="stock-market-kline-chart" aria-label="股票近期K线" data-element="kline-container">
          <Flex gap={12} style={{ marginBottom: 8 }} data-element="ma-list">
            {model.movingAverages.map((average) => (
              <Tag key={average.key} style={{ color: MA_COLOR_BY_KEY[average.key] }}>
                {average.labelText}: {average.valueText}
              </Tag>
            ))}
          </Flex>
          <div ref={containerRef} className="stock-market-kline-canvas" data-element="kline-canvas" />
          <div ref={tooltipRootRef} className="stock-market-kline-tooltip" aria-hidden="true">
            <div className="stock-market-kline-tooltip-head">
              <div ref={tooltipTimeRef} className="stock-market-kline-tooltip-time" />
              <div ref={tooltipChangeRef} className="stock-market-kline-tooltip-change" />
            </div>
            <div className="stock-market-kline-tooltip-price-grid">
              <div ref={tooltipOpenRef} className="stock-market-kline-tooltip-price" />
              <div ref={tooltipHighRef} className="stock-market-kline-tooltip-price" />
              <div ref={tooltipLowRef} className="stock-market-kline-tooltip-price" />
              <div ref={tooltipCloseRef} className="stock-market-kline-tooltip-price" />
            </div>
            <div ref={tooltipReasonRef} className="stock-market-kline-tooltip-reason" />
          </div>
        </div>
      ) : null}
    </Card>
  );
});

export default StockCandlestick;
