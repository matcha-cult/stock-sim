# 股市 AI 新闻事件系统分析

## 一、系统架构概览

### 核心模块

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| 事件上下文选择器 | `server/src/services/stockMarket/stockMarketNewsEventContext.ts` | 维护事件池权重，决定续写旧事件还是开新事件 |
| AI 新闻生成 | `server/src/services/stockMarket/stockMarketAi.ts` | 构造 prompt，调用 LLM，校验结构化输出 |
| 交易服务 | `server/src/services/stockMarket/stockMarketService.ts` | 调度 tick 流程，冷却/加载/持久化事件，写入价格 |
| 场景选择器 | `server/src/services/stockMarket/stockMarketScenarioSelector.ts` | 从 8 个预设场景中选一个作为 AI 题材引导 |
| 数据库 | `prisma/schema.prisma` | 事件表、tick 表、价格历史表 |

### 前端查看器

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| DEV 新闻事件查看器 | `new-client/src/components/DevNewsViewer/DevNewsViewer.tsx` | Dev 模式下可见的事件列表 + Drawer 续写链展示 |
| 股市主页面 | `new-client/src/components/StockMarketPage.tsx` | 主 tab 中追加 "DEV新闻事件查看器" |

---

## 二、事件生命周期

### 状态机

```
active ──(144 tick 未续写)──▶ cooling ──(288 tick 未续写)──▶ resolved
```

- **`active`**：正常续写中，续写时 `last_tick_id` 被更新，超时计数器重置
- **`cooling`**：冷却中，仍可被续写（续写后回到 active）
- **`resolved`**：已结案，移出候选池，不再参与续写

### 超时阈值常量

```typescript
STOCK_MARKET_NEWS_EVENT_ACTIVE_TO_COOLING_TICKS = 144   // active → cooling
STOCK_MARKET_NEWS_EVENT_COOLING_TO_RESOLVED_TICKS = 288 // cooling → resolved
STOCK_MARKET_NEWS_EVENT_CONTEXT_LIMIT = 6               // 候选池最大事件数
```

### 续写上限

**无硬性次数上限**。只要事件持续被权重选中续写，`last_tick_id` 持续更新，事件就永远不会超时进入 cooling。理论上一支事件可以无限续写下去。

实际约束来自间接因素：
- 事件池满（6 条）时新事件权重降低，已有事件之间互相稀释竞争
- AI 可能主动返回 `resolve` action 结束事件
- 场景选择器可能将焦点转移到其他题材

---

## 三、数据库表结构与关联

### 核心表

```
stock_market_tick                           stock_market_news_event
┌────────────────────────────┐             ┌────────────────────────────┐
│ id              (bigint PK)│◄──event_id─ │ id              (bigint PK)│
│ tick_hour       (timestamp)│             │ status          (varchar 20)│  active|cooling|resolved
│ status          (varchar 20)│             │ theme           (text)    │  每次续写可覆盖
│ headline        (text)     │             │ headline        (text)    │  每次续写可覆盖
│ summary         (text)     │             │ summary         (text)    │  每次续写可覆盖
│ model_name      (varchar)  │             │ stage           (varchar) │  每次续写可覆盖
│ prompt_snapshot (text)     │             │ affected_stock_ids (text[])│ 每次续写可覆盖
│ event_id        (bigint?)  │──关联────▶  │ started_tick_id (bigint?) │  创建时锚定
│ error_message   (text)     │             │ last_tick_id    (bigint?) │  最后续写时锚定
│ created_at                 │             │ updated_at / created_at   │
│ finished_at               │             └────────────────────────────┘
└────────────────────────────┘

stock_market_quote                        stock_market_price_history
┌────────────────────────────┐            ┌────────────────────────────┐
│ stock_id        (text PK)  │            │ id              (bigint PK) │
│ current_price_spirit_stones│            │ stock_id        (varchar 96)│
│ last_change_bps (int)      │            │ tick_id         (bigint)    │ ◄── tick.id
│ last_tick_id    (bigint?)  │            │ price_spirit_stones (bigint)│
│ updated_at                 │            │ change_bps      (int)       │
└────────────────────────────┘            │ direction       (varchar 10)│
                                          │ reason          (text)      │
                                          │ created_at                  │
                                          └────────────────────────────┘
```

### 关联查询

查看某事件的完整续写链：

```sql
SELECT t.id, t.tick_hour, t.headline, t.summary, t.status,
       h.stock_id, h.change_bps, h.direction, h.reason
FROM stock_market_tick t
LEFT JOIN stock_market_price_history h ON h.tick_id = t.id AND h.reason != '市场正常起伏'
WHERE t.event_id = ?
ORDER BY t.tick_hour ASC, h.id ASC
```

---

## 四、`runScheduledTick()` 完整读表流程

每 30 分钟 tick 执行一次，严格按以下顺序：

```
① INSERT stock_market_tick
   └── 占位 tick 行，status='running'；若冲突 → skipped，后续全部跳过

② SELECT stock_market_quote
   └── WHERE stock_id IN (所有启用股票)；读取当前价格快照

③ loadRecentImpactStockIds()
    └── 查询最近 12 个 generated tick 的 price_history
        ┌─▶ selectStockMarketNewsEventContext() → 热度降权，避免 AI 反复写同一批股票
        │    · 对列表中股票按出现位置计算热度（越早越不热）
        │    · 事件包含热门股票 → 权重扣减（HOT_STOCK_PENALTY = 4/热度值）
        │    · 事件包含冷门股票 → 权重加分（COLD_STOCK_BONUS = 16/冷门数）
        │
        └─▶ selectStockMarketScenarioGuide() → 热度降权，推动场景轮换
             · 场景的 focusStockIds 近期频繁出现 → 权重扣减
             · 场景的 focusStockIds 近期没出现 → 权重加分

  ③½ loadRecentPriceTrend(32)
      └── 查询最近 32 个 generated tick 的 price_history，按股票聚合
          · 计算每只股票最近 N 次出现的净变化（netChangeBps）
          · 根据净变化判定方向：bullish（累计涨超 1%）、bearish（累计跌超 1%）、neutral
          · 传入 AI prompt 的 recentTrends 字段，指导 AI 做趋势对冲
          · bearish 股票 → AI 优先给予利好/修复题材
          · bullish 股票 → AI 适度给予利空/回调压力

④ coolInactiveNewsEvents(currentTickId)
   └── UPDATE stock_market_news_event
       · active  → cooling: last_tick_id 距当前 tick ≥ 144
       · cooling → resolved: last_tick_id 距当前 tick ≥ 288

⑤ loadActiveNewsEvents()
   └── SELECT stock_market_news_event WHERE status IN ('active', 'cooling') LIMIT 6
       · 字段: id, status, theme, headline, summary, stage, affected_stock_ids
       · 过滤掉 resolved 和不在启用列表中的股票 ID

   ─────────────────────────────────────────────────────────
   至此所有数据就绪，传入 AI 生成器
   ─────────────────────────────────────────────────────────

⑥ generateStockMarketAiNewsDraft({ definitions, quotes, recentImpactStockIds, recentTrends, activeEvents, tickHour })
   │
   ├── selectStockMarketNewsEventContext()  ← 纯函数：事件池权重计算 + 轮盘赌
   │   · 对每条事件计算权重，再加一个虚拟 "new" 候选
   │   · 输出: selectedEvent（一条或 null） + directive（continue/new）
   │
   ├── selectStockMarketScenarioGuide()     ← 纯函数：场景选择
   │   · 输出: { id, title, focusStockIds, guide }
   │
   ├── buildStockMarketUserMessage()        ← 拼接 prompt JSON
   │
   ├── callConfiguredTextModel()            ← 调用 LLM
   │
   ├── parseTechniqueTextModelJsonObject()  ← 解析返回 JSON
   │
   └── validateStockMarketAiNewsPayload()   ← 校验：白名单、涨跌范围、去重
       · selectedEvent 非空 → action 不能是 'new'
       · selectedEvent 为空 → action 必须是 'new'

⑦ applyGeneratedTick(params)  ← 事务写入
   │
   ├── SELECT stock_market_tick FOR UPDATE  ← 确认 tick 状态是 running
   ├── SELECT stock_market_quote FOR UPDATE ← 锁定受影响股票的价格行
   ├── UPDATE stock_market_tick             ← status='generated'
   ├── INSERT/UPDATE stock_market_news_event ← 持久化事件
   ├── UPDATE stock_market_tick SET event_id ← tick 关联事件
   ├── UPDATE stock_market_quote            ← 更新股票价格
   ├── INSERT stock_market_price_history    ← 写入 K 线数据
   └── 未受影响股票 → 随机噪音 → UPDATE + INSERT
```

---

## 五、事件权重计算详解

### 常量配置

```typescript
const STOCK_MARKET_NEWS_EVENT_BASE_WEIGHT     = 72;   // 基础权重
const STOCK_MARKET_NEWS_EVENT_ACTIVE_BONUS    = 28;   // active 状态加分
const STOCK_MARKET_NEWS_EVENT_COOLING_PENALTY = 18;   // cooling 状态扣分
const STOCK_MARKET_NEWS_EVENT_COLD_STOCK_BONUS = 16;  // 每只冷门股票加分
const STOCK_MARKET_NEWS_EVENT_HOT_STOCK_PENALTY = 4;  // 每热度单位扣分
const STOCK_MARKET_NEWS_EVENT_MIN_WEIGHT      = 10;   // 最低权重
const STOCK_MARKET_NEWS_EVENT_NEW_BASE_WEIGHT = 64;   // 新事件基础权重
const STOCK_MARKET_NEWS_EVENT_NEW_EMPTY_POOL_BONUS = 80; // 空池奖励
const STOCK_MARKET_NEWS_EVENT_NEW_CAPACITY_BONUS   = 8;  // 每空余槽位加分
const STOCK_MARKET_NEWS_EVENT_RANDOM_JITTER     = 18;   // 随机扰动 ±18
```

### 已有事件权重

```
weight = max(10,
  72                           // 基础权重
  + (status === 'active' ? 28 : -18)   // 状态加成
  + coldStockCount * 16                // 冷门股票加分
  - hotStockScore * 4                  // 热门股票扣分
  + random(-18, +18)                   // 随机扰动
)
```

### 新事件虚拟候选权重

```
weight = 64
       + max(0, 6 - candidateCount) * 8  // 容量奖励：每空余一个槽位 +8
       + (candidateCount === 0 ? 80 : 0)  // 空池奖励：无事件时 +80
       + random(-18, +18)                 // 随机扰动
```

### 轮盘赌选中

所有候选（已有事件 + "new" 虚拟候选）权重求和，用 seed 取模随机选一条。

### 新开事件的条件（权重对比）

| 场景 | "new" 权重 | 说明 |
|------|-----------|------|
| 事件池为空 | 64 + 80 + 48 = 192 | 几乎必然新建 |
| 事件池 1 条 | 64 + 40 + 扰动 = ~104 | 较大概率新建 |
| 事件池 5 条 | 64 + 8 + 扰动 = ~72 | 新建权重偏低 |
| 事件池满 6 条 | 64 + 0 + 扰动 = ~64 | 新建权重最低 |
| random(-18,+18) | ±18 | 边界情况可能翻盘 |

---

## 六、AI 续写时的事件上下文

### 传入 AI prompt 的 eventContext 结构

```jsonc
{
  "activeEvents": [              // 最多 6 条，全部 active/cooling 事件
    {
      "eventId": "123",
      "status": "active",
      "theme": "丹药需求激增",
      "headline": "青云门发布丹方新政",
      "summary": "青云门宣布...",
      "stage": "发酵期",
      "affectedStockIds": ["stock-qingyun-danfang", "stock-yunmeng-herb"]
    }
    // ... 最多 6 条
  ],
  "selectedEvent": {             // 权重轮盘赌选中的一条，或 null
    "eventId": "123",
    "status": "active",
    "theme": "丹药需求激增",
    "headline": "青云门发布丹方新政",
    "summary": "青云门宣布...",
    "stage": "发酵期",
    "affectedStockIds": ["stock-qingyun-danfang", "stock-yunmeng-herb"]
  },
  "eventDirective": "continue",  // "continue" 或 "new"
  "weights": [                   // 每条权重明细，用于调试
    { "eventId": "123", "weight": 98, "hotStockScore": 12, "coldStockCount": 1 },
    { "eventId": "new", "weight": 72, "hotStockScore": 0, "coldStockCount": 0 }
  ]
}
```

### 关键限制

- AI 续写时**只有当前事件的快照**，**没有历史 tick 的新闻内容**
- AI 不知道之前这条事件写过什么具体标题和摘要，只知道当前覆盖后的 `theme/headline/summary/stage`
- 每次 AI 续写时，这些字段会被 AI 返回的新值**覆盖更新**
- 所以 AI 实际是"根据当前事件摘要 + 场景引导"自由续写，而非"阅读完整历史后接续"

### AI 可用的 4 种 action

| action | 含义 | 何时允许 |
|--------|------|---------|
| `new` | 创建全新事件 | 仅当 selectedEvent 为空（directive = 'new'） |
| `continue` | 继续当前事件叙事 | 仅当 selectedEvent 非空 |
| `escalate` | 升级当前事件强度 | 仅当 selectedEvent 非空 |
| `resolve` | 结束当前事件 | 仅当 selectedEvent 非空，事件状态转为 resolved |

---

## 七、续写链查看器实现

### 后端新增接口

| 接口 | 说明 |
|------|------|
| `GET /api/stock-market/news-events` | 返回所有事件列表（含续写次数统计） |
| `GET /api/stock-market/news-events/:eventId/chain` | 返回单条事件的完整续写链 |

### 数据结构

```typescript
interface NewsEventDto {
  id: string;
  status: string;
  theme: string;
  headline: string;
  summary: string;
  stage: string;
  affectedStockIds: string[];
  startedTickId: string | null;
  lastTickId: string | null;
  continuationCount: number;
  lastContinuedAt: number | null;
}

interface NewsEventChainDto {
  event: {
    id: string; status: string; theme: string;
    headline: string; summary: string; stage: string;
    affectedStockIds: string[];
    startedTickId: string | null; lastTickId: string | null;
  };
  ticks: Array<{
    tickId: string;
    tickHour: number;
    headline: string;
    summary: string;
    status: string;
    impacts: Array<{
      stockId: string;
      stockName: string;
      changeBps: number;
      direction: string;
      reason: string | null;
    }>;
  }>;
}
```

### 前端展示

- 主页面 tab 列表中追加 "DEV新闻事件查看器"（仅 `import.meta.env.DEV` 可见）
- 事件列表：ID、状态标签、主题、阶段、关联股票中文名、续写次数、最后续写时间
- 点击事件行 → 右侧 Drawer 弹出时间线，按时间正序展示每个 tick 的标题、摘要、影响股票（带涨跌颜色）
