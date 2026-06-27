<!-- markdownlint-disable MD024 MD060 -->

# 行情数据接口对接文档

## 通用说明

### 鉴权方式

所有接口均使用 `Authorization: Bearer <sk-...>` 白名单 API key 鉴权。

| 项目 | 说明 |
|------|------|
| **API key 格式** | 必须以 `sk-` 开头，后接随机字符 |
| **传递方式** | HTTP Header `Authorization: Bearer sk-xxxx` |
| **白名单配置** | 服务端环境变量 `MARKET_DATA_API_KEYS`（逗号分隔多个 key） |

**鉴权失败响应**（HTTP 401）：

```json
{
  "success": false,
  "message": "API key 无效或未授权"
}
```

### 限流策略

每个 API key 独立计数，默认 **5 次/秒**。超限返回 HTTP 429：

```json
{
  "success": false,
  "message": "行情请求过于频繁，请稍后再试"
}
```

### 通用响应格式

所有接口返回标准 JSON 结构：

```json
{
  "success": true | false,
  "data": { ... },      // 成功时存在
  "message": "错误描述" // 失败时存在
}
```

### 时间戳说明

所有时间字段均为 **Unix 毫秒时间戳**（JavaScript `Date.getTime()`），时区为 UTC。前端展示时需按用户时区转换。

---

## 接口一：获取当前股市行情快照

### 基础信息

| 项目 | 值 |
|------|-----|
| **接口名称** | 获取当前股市行情快照 |
| **请求路径** | `/api/market-data/quotes` |
| **请求方法** | `GET` |

### 请求示例

```bash
curl -X GET "https://your-domain.com/api/market-data/quotes" \
  -H "Authorization: Bearer sk-78ce54436402acae"
```

### 响应格式

**成功响应**（HTTP 200）：

```json
{
  "success": true,
  "data": {
    "stocks": [
      {
        "stockId": "stock_001",
        "code": "LH",
        "name": "灵石科技",
        "shortName": "灵石",
        "sector": "科技",
        "description": "专注灵石挖矿与交易的高科技企业",
        "priceSpiritStones": 125.50,
        "lastChangeBps": 150,
        "updatedAt": 1719408000000
      }
    ],
    "tradeRules": {
      "feeRateDenominator": 10000,
      "commissionRate": 25,
      "stampDutyRate": 0,
      "transferFeeRate": 0,
      "minPriceSpiritStones": 0.01
    },
    "nextRefreshAt": 1719411600000
  }
}
```

### 字段说明

#### `data.stocks` 数组

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `stockId` | string | 股票唯一标识 |
| `code` | string | 股票代码（如 `LH`） |
| `name` | string | 股票全称 |
| `shortName` | string | 股票简称（若无则回退到 `name`） |
| `sector` | string | 所属板块 |
| `description` | string | 股票描述（可能为空串） |
| `priceSpiritStones` | number | 当前价格（单位：灵石，最多两位小数） |
| `lastChangeBps` | number | 上次涨跌基点（1 bp = 0.01%，正数为涨，负数为跌） |
| `limitUpPriceSpiritStones` | number | 涨停价（单位：灵石，基于初始发行价计算） |
| `limitDownPriceSpiritStones` | number | 跌停价（单位：灵石，基于初始发行价计算） |
| `limitStatus` | string | 涨跌停状态：`'up'`（涨停）/ `'down'`（跌停）/ `'none'`（正常） |
| `updatedAt` | number | 报价更新时间（Unix 毫秒时间戳） |

#### `data.tradeRules` 对象

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `feeRateDenominator` | number | 手续费率分母（实际费率 = 分子 / 分母） |
| `commissionRate` | number | 佣金率分子（买卖双向收取） |
| `stampDutyRate` | number | 印花税率分子（仅卖出收取） |
| `transferFeeRate` | number | 过户费率分子（买卖双向收取） |
| `minPriceSpiritStones` | number | 最低交易价格（灵石） |
| `limitUpPercent` | number | 涨停幅度百分比（基于初始发行价，如 500 表示涨到初始价的 6 倍） |
| `limitDownPercent` | number | 跌停幅度百分比（基于初始发行价，如 50 表示跌到初始价的 50%） |
| `limitEnabled` | boolean | 是否启用涨跌停机制 |

#### `data.nextRefreshAt`

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `nextRefreshAt` | number | 下次行情刷新时间（Unix 毫秒时间戳） |

### 数据说明

1. **行情快照**：返回所有启用股票的当前报价，不含玩家持仓、新闻事件
2. **价格精度**：`priceSpiritStones` 最多两位小数
3. **涨跌基点**：`lastChangeBps` 为整数，150 表示 +1.50%，-200 表示 -2.00%
4. **初始报价**：服务启动后首次调用会触发初始报价写入（若 quote 表为空）
5. **数组顺序**：`stocks` 数组顺序与服务端股票定义一致（按 `sort_weight` + `id` 排序）

---

## 接口二：批量查询玩家持仓

### 基础信息

| 项目 | 值 |
|------|-----|
| **接口名称** | 批量查询玩家持仓 + 灵石余额 |
| **请求路径** | `/api/market-data/portfolios` |
| **请求方法** | `POST` |
| **单次上限** | 最多 100 个角色 ID |

### 请求格式

**请求体**（JSON）：

```json
{
  "characterIds": [1, 2, 3]
}
```

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `characterIds` | number[] | 是 | 角色 ID 数组，元素必须为正整数 |

### 请求示例

```bash
curl -X POST "https://your-domain.com/api/market-data/portfolios" \
  -H "Authorization: Bearer sk-78ce54436402acae" \
  -H "Content-Type: application/json" \
  -d '{"characterIds": [1, 2, 3]}'
```

### 响应格式

**成功响应**（HTTP 200）：

```json
{
  "success": true,
  "data": {
    "portfolios": [
      {
        "characterId": 1,
        "nickname": "修士甲",
        "spiritStonesBalance": 5000,
        "holdings": [
          {
            "stockId": "stock_001",
            "stockCode": "LH",
            "stockName": "灵石科技",
            "quantity": 100,
            "frozenQuantity": 0,
            "averageCostSpiritStones": 120.50,
            "currentPriceSpiritStones": 125.50,
            "marketValueSpiritStones": 12550,
            "unrealizedPnlSpiritStones": 500
          }
        ],
        "totalMarketValueSpiritStones": 12550,
        "totalUnrealizedPnlSpiritStones": 500
      }
    ]
  }
}
```

### 字段说明

#### `data.portfolios` 数组

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `characterId` | number | 角色 ID |
| `nickname` | string | 角色昵称（若无则回退到 `修士{characterId}`） |
| `spiritStonesBalance` | number | 灵石余额 |
| `holdings` | array | 持仓数组（仅包含 quantity > 0 的股票） |
| `totalMarketValueSpiritStones` | number | 持仓总市值（灵石） |
| `totalUnrealizedPnlSpiritStones` | number | 持仓总未实现盈亏（灵石） |

#### `portfolios[].holdings` 数组

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `stockId` | string | 股票唯一标识 |
| `stockCode` | string | 股票代码 |
| `stockName` | string | 股票名称 |
| `quantity` | number | 持仓数量（股） |
| `frozenQuantity` | number | 冻结数量（挂单中） |
| `averageCostSpiritStones` | number | 平均成本价（灵石） |
| `currentPriceSpiritStones` | number | 当前价格（灵石） |
| `marketValueSpiritStones` | number | 持仓市值（灵石） |
| `unrealizedPnlSpiritStones` | number | 未实现盈亏（灵石） |

### 数据说明

1. **角色不存在**：请求中不存在的 `characterId` 会被静默忽略，不会出现在响应中
2. **空持仓**：若角色存在但无持仓（`quantity = 0`），`holdings` 为空数组，`totalMarketValueSpiritStones` 和 `totalUnrealizedPnlSpiritStones` 为 0
3. **冻结数量**：`frozenQuantity` 表示挂单中尚未成交的部分，不可卖出
4. **未实现盈亏**：`unrealizedPnlSpiritStones = marketValueSpiritStones - (averageCostSpiritStones × quantity)`
5. **批量上限**：单次请求最多 100 个角色 ID，超出返回错误

### 错误响应

#### 400 Bad Request

```json
{
  "success": false,
  "message": "characterIds 必须为非空数组"
}
```

```json
{
  "success": false,
  "message": "单次查询上限 100 个角色"
}
```

```json
{
  "success": false,
  "message": "characterIds 元素必须为正整数"
}
```

---

## 接口三：批量卖出股票

### 基础信息

| 项目 | 值 |
|------|-----|
| **接口名称** | 批量卖出指定角色的指定股票 |
| **请求路径** | `/api/market-data/sell` |
| **请求方法** | `POST` |
| **单次上限** | 最多 100 笔卖出订单 |
| **限流** | 10 次/秒/API key（独立于 quotes/portfolios 的 5 次/秒） |

### 请求格式

**请求体**（JSON）：

```json
{
  "orders": [
    { "characterId": 1, "stockId": "stock_001", "quantity": 100 },
    { "characterId": 2, "stockId": "stock_002", "quantity": 50 }
  ]
}
```

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `orders` | array | 是 | 卖出订单数组 |
| `orders[].characterId` | number | 是 | 角色 ID（正整数） |
| `orders[].stockId` | string | 是 | 股票 ID（非空字符串） |
| `orders[].quantity` | number | 是 | 卖出数量（正整数） |

### 请求示例

```bash
curl -X POST "https://your-domain.com/api/market-data/sell" \
  -H "Authorization: Bearer sk-78ce54436402acae" \
  -H "Content-Type: application/json" \
  -d '{"orders": [{"characterId": 1, "stockId": "stock_001", "quantity": 100}]}'
```

### 响应格式

**成功响应**（HTTP 200）：

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "characterId": 1,
        "stockId": "stock_001",
        "quantity": 100,
        "success": true,
        "message": "卖出成功",
        "filledQuantity": 100
      },
      {
        "characterId": 2,
        "stockId": "stock_002",
        "quantity": 50,
        "success": false,
        "message": "可卖持仓数量不足",
        "filledQuantity": 0
      }
    ]
  }
}
```

### 字段说明

#### `data.results` 数组

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `characterId` | number | 角色 ID（与请求对应） |
| `stockId` | string | 股票 ID（与请求对应） |
| `quantity` | number | 请求卖出数量（与请求对应） |
| `success` | boolean | 该笔订单是否成功 |
| `message` | string | 结果消息（成功："卖出成功"；失败：错误原因） |
| `filledQuantity` | number | 实际成交数量（失败时为 0） |

### 数据说明

1. **独立事务**：每笔订单独立执行，互不影响。某笔失败不会回滚其他成功的订单。
2. **整体 200**：即使部分订单失败，整体 HTTP 响应仍为 200。通过每笔订单的 `success` 字段判断成败。
3. **卖出校验**：复用玩家端卖出逻辑，校验可卖数量、冻结数量（挂单中）、手续费等。失败原因可能包括：
   - `股票不存在`
   - `卖出数量不合法`
   - `未持有该股票`
   - `可卖持仓数量不足`
   - 等
4. **到账金额**：卖出成功后灵石会自动加到角色余额，具体金额按交易规则扣除手续费。
5. **批量上限**：单次请求最多 100 笔订单，超出返回错误。

### 错误响应

#### 400 Bad Request

```json
{
  "success": false,
  "message": "orders 必须为非空数组"
}
```

```json
{
  "success": false,
  "message": "单次卖出上限 100 笔"
}
```

```json
{
  "success": false,
  "message": "orders[0].characterId 必须为正整数"
}
```

---

## 对接建议

1. **缓存策略**：建议在客户端缓存行情数据，避免频繁轮询。可根据 `nextRefreshAt` 设置下次请求时间
2. **错误重试**：429 错误建议退避重试（指数退避），401 错误需检查 API key 配置
3. **批量查询**：`/portfolios` 接口支持批量查询，建议合并多个角色 ID 一次性请求，减少网络往返
4. **时区处理**：时间戳为 UTC，前端展示时按用户时区转换
