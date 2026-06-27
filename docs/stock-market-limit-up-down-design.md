# 股市涨停跌停算法设计文档

## 1. 概述

本文档描述股市系统中涨停/跌停算法的设计方案。涨跌停机制是一个**价格修正算法**，在每个 tick 价格更新后，对最终价格进行截断处理。

---

## 2. 核心算法

### 2.1 计算公式

**涨跌幅计算公式**：

- **涨幅** = （现价 - 原价）÷ 原价 × 100%
- **跌幅** = （原价 - 现价）÷ 原价 × 100%

**涨跌停价格计算**（基于初始发行价）：

```text
涨停价 = 初始发行价 × (1 + 涨停幅度)
跌停价 = 初始发行价 × (1 - 跌停幅度)
```

**价格修正算法**：

```typescript
// 计算涨跌停价格
const limitUpPrice = ceilDiv(initialPrice * (10000 + LIMIT_UP_BPS), 10000n);
const limitDownPrice = (initialPrice * (10000 - LIMIT_DOWN_BPS)) / 10000n;

// 截断价格
const finalPrice = Math.min(Math.max(theoreticalPrice, limitDownPrice), limitUpPrice);
```

### 2.2 配置管理

配置文件位置：`server/data/seeds/stockLimitConfig.json`

```json
{
  "limitUpPercent": 500,
  "limitDownPercent": 50,
  "enabled": true
}
```

| 字段                | 类型    | 默认值 | 说明                   |
| ------------------- | ------- | ------ | ---------------------- |
| `limitUpPercent`    | number  | 500    | 涨停幅度（百分比）     |
| `limitDownPercent`  | number  | 50     | 跌停幅度（百分比）     |
| `enabled`           | boolean | true   | 是否启用涨跌停         |

**运营调整**：修改配置文件后，下次 tick 自动生效，无需修改代码或重启服务。

### 2.3 示例计算

**天机书院**（初始价 158）：

| 配置       | 涨停价          | 跌停价         |
| ---------- | --------------- | -------------- |
| 500% / 50% | 158 × 6 = 948   | 158 × 0.5 = 79 |

**验证**：

- 涨停：(948 - 158) ÷ 158 × 100% = 500% ✓
- 跌停：(158 - 79) ÷ 158 × 100% = 50% ✓

**跌幅上限**：

- 最大跌幅 = -50.00%
- 价格最低只能跌到初始价的 50%

---

## 3. 实现方案

### 3.1 核心函数

`server/src/services/stockMarket/stockMarketRules.ts`

```typescript
/**
 * 计算涨跌停价格（基于初始发行价）。
 */
export const calculateStockMarketLimitPrices = (
  initialPrice: bigint,
): { limitUpPrice: bigint; limitDownPrice: bigint } => {
  const limitUpPrice = ceilDiv(
    initialPrice * BigInt(10000 + STOCK_MARKET_LIMIT_UP_BPS),
    10000n,
  );
  const limitDownPrice = (
    initialPrice * BigInt(10000 - STOCK_MARKET_LIMIT_DOWN_BPS)
  ) / 10000n;
  return { limitUpPrice, limitDownPrice };
};

/**
 * 应用涨跌停截断。
 */
export const applyStockMarketLimitPrice = (
  theoreticalPrice: bigint,
  limitUpPrice: bigint,
  limitDownPrice: bigint,
): bigint => {
  return Math.min(Math.max(theoreticalPrice, limitDownPrice), limitUpPrice);
};
```

### 3.2 集成位置

`server/src/services/stockMarket/stockMarketService.ts` 的 `applyGeneratedTick()` 方法：

```typescript
// 1. 计算理论新价格
const theoreticalPrice = applyStockMarketPriceChange(currentPrice, changeBps);

// 2. 获取涨跌停价格
const { limitUpPrice, limitDownPrice } = calculateStockMarketLimitPrices(initialPrice);

// 3. 应用涨跌停截断
const finalPrice = applyStockMarketLimitPrice(theoreticalPrice, limitUpPrice, limitDownPrice);

// 4. 更新价格
await query(`UPDATE stock_market_quote SET current_price_spirit_stones = $2 WHERE stock_id = $1`,
  [stockId, finalPrice.toString()]);
```

### 3.3 K 线涨跌停标记

**API 响应扩展**：

`GET /api/stock-market/history` 的 K 线数据添加涨跌停标记：

```typescript
type StockMarketHistoryPointDto = {
  o: number;      // 开盘价
  h: number;      // 最高价
  l: number;      // 最低价
  c: number;      // 收盘价
  cb: number;     // 涨跌幅
  r: string;      // 原因
  t: number;      // 时间戳
  lu?: boolean;   // 是否涨停（可选）
  ld?: boolean;   // 是否跌停（可选）
};
```

**后端计算逻辑**：

```typescript
// 在 buildHistoryPointDtos 中计算涨跌停标记
const initialPrice = getInitialPrice(stockId);
const { limitUpPrice, limitDownPrice } = calculateStockMarketLimitPrices(initialPrice);

const isLimitUp = closePrice >= limitUpPrice;
const isLimitDown = closePrice <= limitDownPrice;

return {
  o: openPrice,
  h: highPrice,
  l: lowPrice,
  c: closePrice,
  cb: changeBps,
  r: reason,
  t: timestamp,
  lu: isLimitUp || undefined,    // 只在涨停时返回
  ld: isLimitDown || undefined,  // 只在跌停时返回
};
```

**前端展示**：

- 涨停 K 线：顶部显示红色横线，或 K 线顶部添加"涨停"标签
- 跌停 K 线：底部显示绿色横线，或 K 线底部添加"跌停"标签
- 鼠标悬停时显示涨跌停提示

### 3.4 数据库

无需修改数据库结构。涨跌停价格从初始价动态计算，无需额外存储。

---

## 4. 边界条件

### 4.1 价格精度

- 涨停价向上取整到分（`ceilDiv`）
- 跌停价向下取整到分
- 避免因精度问题导致计算错误

### 4.2 跌幅上限

- 跌幅上限 = -50.00%
- 公式：（原价 - 保底价）÷ 原价 × 100% = 50%
- 无论行情多差，价格最低只能跌到初始价的 50%

### 4.3 连续波动

- 涨跌停价格基于固定的初始发行价，不随时间变化
- 价格可以在涨跌停区间外自由波动（被截断到边界）
- 每 tick 独立计算，不受前一 tick 影响

---

## 5. 测试要点

### 5.1 单元测试

- 涨跌停价格计算
  - 天机书院初始价 158，涨停价 948，跌停价 79
  - 青云丹坊初始价 100，涨停价 600，跌停价 50
- 价格截断逻辑
  - 理论价格 > 涨停价 → 截断到涨停价
  - 理论价格 < 跌停价 → 截断到跌停价
  - 理论价格在区间内 → 不截断

### 5.2 集成测试

- AI 输出 +10%，价格触及涨停价时，被截断
- AI 输出 -10%，价格触及跌停价时，被截断
- 价格在涨跌停区间内正常波动

---

## 6. 未来扩展

### 6.1 不同股票不同涨跌幅

可在配置文件中为每只股票配置独立的涨跌停幅度：

```json
{
  "limitUpPercent": 500,
  "limitDownPercent": 50,
  "stockOverrides": {
    "stock-tianji-shuyuan": { "limitUpPercent": 1000, "limitDownPercent": 60 }
  }
}
```

### 6.2 动态调整

根据市场波动率动态调整涨跌停幅度，需要额外的市场指标和决策逻辑。

---

## 7. 总结

涨跌停机制是一个简单的**价格修正算法**：

1. **计算涨跌停价格**：基于初始发行价和配置的幅度
2. **截断理论价格**：将理论价格限制在涨跌停区间内
3. **更新最终价格**：使用截断后的价格更新数据库

**核心特点**：

- 算法简单，不参与交易规则
- 配置灵活，支持运营动态调整
- 基于初始价，涨跌停价格固定不变
