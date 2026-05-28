# 股市行情 AI 提示词组装设计文档

## 1. 概述

本文档描述股市行情调度系统中 AI 大模型提示词的组装架构、数据流与设计决策。系统每 30 分钟触发一次 AI 新闻生成，AI 以"九州修仙录"世界观撰写股市新闻，并输出结构化涨跌影响数据。

## 2. 文件架构

```
server/
├── prisma/
│   └── schema.prisma                 ← 数据库模型：stock_market_news_event 等
├── src/
│   └── services/
│       ├── stockMarket/
│       │   ├── stockMarketAi.ts              ← 核心：prompt 组装、AI 调用循环、响应校验
│       │   ├── stockMarketScenarioSelector.ts ← 场景池选择：题材轮换与权重计算
│       │   ├── stockMarketNewsEventContext.ts ← 事件池选择：多事件延续/新开决策
│       │   ├── stockMarketService.ts         ← 调度服务：事件读写、价格更新、tick 编排
│       │   ├── stockMarketRules.ts           ← 数值规则：AI 涨跌校验、价格计算、随机噪音生成
│       │   └── stockMarketScheduler.ts       ← 调度器：30 分钟定时触发
│       ├── ai/
│       │   ├── openAITextClient.ts            ← 统一 AI 调用入口（OpenAI SDK）
│       │   └── modelConfig.ts                 ← 模型配置：环境变量 → 结构化配置
│       └── shared/
│           └── techniqueTextModelShared.ts    ← 共享层：payload 构造、seed、noise hash、JSON 解析
```

## 3. 提示词双层结构

### 3.1 System Message（固定角色设定）

位置：`stockMarketAi.ts:342-353`

纯文本，8 条规则，职责分工：

| 规则 | 内容 |
|------|------|
| 角色定义 | 九州修仙录坊间财经新闻撰稿人 |
| 题材约束 | 贴合修仙商业、宗门、丹药、炼器、阵法、拍卖 |
| 输出类型 | 判断具体涨跌百分比，不输出价格/投资建议 |
| 市场平衡 | 多空平衡，不持续单边利好或利空 |
| 对冲要求 | 受益股与受损股配对，单股影响时保持温和 |
| 格式约束 | 只输出合法 JSON，严格符合 response_format |
| 范围约束 | changePercent ∈ [-8, 8]，最多两位小数 |
| 唯一性约束 | 同一条 impacts 内 stockId 不重复 |

### 3.2 User Message（JSON 格式，动态注入）

位置：`stockMarketAi.ts:355-442`

通过 `JSON.stringify()` 序列化，包含 9 个顶级字段：

```
┌─────────────────────────────┐
│         User Message        │
├─────────────────────────────┤
│ tickHour              时间  │
│ promptNoiseHash      扰动码 │
│ attempt              重试计数│
│ previousFailureReason 失败原因│
│ marketScenario        场景指引│
│ scenarioSelection     场景权重│
│ eventContext          事件上下文│
│ stocks              股票全列表│
│ outputRules          输出规则│
└─────────────────────────────┘
```

各字段详细说明：

| 字段 | 类型 | 来源 | 说明 |
|------|------|------|------|
| `tickHour` | `string` (ISO) | 调度器传入 | 当前行情 tick 时间 |
| `promptNoiseHash` | `string` (16 hex) | `buildTextModelPromptNoiseHash()` | 创作扰动码，隐式影响命名/意象/措辞节奏 |
| `attempt` | `number` (1-3) | 重试循环 | 告知 AI 当前尝试次数 |
| `previousFailureReason` | `string \| null` | 上次失败原因 | 引导 AI 修正错误 |
| `marketScenario` | `object` | `selectStockMarketScenarioGuide()` | 本轮场景指引，包含 id/title/focusStockIds/guide |
| `scenarioSelection` | `object` | 场景权重明细 | 近期已波动股票 + 各场景权重 |
| `eventContext` | `object` | `selectStockMarketNewsEventContext()` | 活跃事件列表 + 选中事件 + 动作指令 |
| `stocks` | `Array` | 股票定义 + 价格快照 | 全部可用股票信息 |
| `outputRules` | `string[]` | 硬编码 20 条规则 | 输出格式、涨跌范围、多空配对、事件续写等 |

## 4. 动态上下文注入

### 4.1 场景池 `stockMarketScenarioSelector.ts`

8 个固定题材，每个包含 `id`、`title`、`focusStockIds`、`guide` 四要素：

| ID | 标题 | 核心股票 |
|----|------|---------|
| `alchemy-supply` | 丹药与灵植供需轮动 | 青云丹坊、云梦灵药、星河拍卖 |
| `mining-armory` | 矿材与炼器成本博弈 | 玄铁矿场、天工炼器、北州商贸 |
| `transport-array` | 交通与阵法替代竞争 | 灵舟工坊、乾坤阵台、北州商贸 |
| `academy-sect` | 功法与宗门声望变化 | 万卷阁、赤霄剑宗、星河拍卖 |
| `auction-commerce` | 拍卖与商贸资金分流 | 星河拍卖、北州商贸、万卷阁 |
| `sect-defense` | 边境战事与防务委托 | 赤霄剑宗、天工炼器、乾坤阵台、灵舟工坊 |
| `weather-harvest` | 节气收成与材料价格 | 云梦灵药、青云丹坊、玄铁矿场、天工炼器 |
| `market-rotation` | 市场风险偏好切换 | 青云丹坊、万卷阁、星河拍卖、北州商贸 |

**权重计算逻辑**：

```
权重 = max(12, 100 + 冷门数×28 + 事件关联数×42 - 热度分×9 + 随机扰动[-24,24])
```

- 基础权重：100
- 冷门股票加权：每个 +28（近 32 次未出现的 focusStock 计为冷门）
- 事件关联股票加权：每个 +42
- 热门股票降权：热度分 × -9（近 12 次出现计热度）
- 随机扰动：±24
- 最小权重保底：12（非禁用，仅降概率）

### 4.2 事件池 `stockMarketNewsEventContext.ts`

**权重计算逻辑**：

```
已有事件权重 = max(10, 72 + 状态Δ + 冷门数×16 - 热度分×4 + 随机扰动[-18,18])
新事件权重  = 64 + 空池奖励(80) + 容量奖励(×8) + 随机扰动[-18,18]

其中 状态Δ = active(+28) | cooling(-18)
```

**事件状态**：
- `active`：正在进行的新闻事件
- `cooling`：冷却中的事件，权重 -18 惩罚，仍可被选中续写
- `resolved`：已收尾，不进入候选池

**状态自动流转**（`stockMarketService.ts:coolInactiveNewsEvents`）：

每个 tick 在加载事件前执行冷却检查，基于 `last_tick_id` 与当前 tick 的差值：

```
active ── 超过 12 tick 未续写 ──→ cooling ── 超过 24 tick 未续写 ──→ resolved
```

- `STOCK_MARKET_NEWS_EVENT_ACTIVE_TO_COOLING_TICKS = 12`（约 6 小时）
- `STOCK_MARKET_NEWS_EVENT_COOLING_TO_RESOLVED_TICKS = 24`（约 12 小时）
- 冷却中的事件仍可能被 AI 续写，一旦被续写状态恢复为 `active`

**新事件开启条件**：
- 空池（无候选事件）时 +80 基础奖励
- 有容量（当前事件数 < 6）时每格 +8 奖励

#### 事件存储表 `stock_market_news_event`

位置：`prisma/schema.prisma:86-98`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BigInt (自增) | 事件主键 |
| `status` | String(20) | `active` / `cooling` / `resolved` |
| `theme` | String? | 事件题材 |
| `headline` | String? | 事件标题 |
| `summary` | String? | 事件摘要 |
| `stage` | String(50)? | 事件阶段 |
| `affected_stock_ids` | String[] | 关联股票 ID 数组 |
| `started_tick_id` | BigInt? | 起始 tick ID |
| `last_tick_id` | BigInt? | 最后一次更新的 tick ID |
| `updated_at` | DateTime | 更新时间 |
| `created_at` | DateTime | 创建时间 |

**读写流程**（`stockMarketService.ts`）：

- **冷却检查**：`coolInactiveNewsEvents()` → 每个 tick 执行两次 UPDATE：
  - `active` 超过 12 tick 未更新 → `cooling`
  - `cooling` 超过 24 tick 未更新 → `resolved`
- **读取**：`loadActiveNewsEvents()` → `SELECT` 非 resolved 事件，取最近 6 条（`STOCK_MARKET_NEWS_EVENT_CONTEXT_LIMIT`）作为 prompt 上下文
- **写入**：`persistNewsEventForTick()` → 新事件执行 `INSERT`，续写事件执行 `UPDATE`（更新 theme/headline/summary/stage/affected_stock_ids/last_tick_id；`action='resolve'` 时状态设为 `resolved`）

### 4.3 Prompt Noise Hash

位置：`techniqueTextModelShared.ts:307-312`

```typescript
buildTextModelPromptNoiseHash(scope, seed)
  = SHA256(`${scope}:${seed}`)[0:16]
```

- 16 位 hex 字符串
- 作为创作扰动码注入 user message
- AI 被指示隐式影响命名/意象/措辞节奏，禁止显式输出该字符串

## 5. Response Schema 约束

位置：`stockMarketAi.ts:99-182`

采用 `json_schema` + `strict: true` 模式，关键设计：

### 5.1 顶级结构

```
{
  "headline": string (4-40字符),
  "summary": string (12-160字符),
  "event": { 事件对象 },
  "impacts": [ 影响数组 ]
}
```

### 5.2 事件对象

| 字段 | 类型 | 约束 |
|------|------|------|
| `action` | `string` | `enum: ["new", "continue", "escalate", "resolve"]` |
| `theme` | `string` | 2-32 字符 |
| `headline` | `string` | 4-40 字符 |
| `summary` | `string` | 12-120 字符 |
| `stage` | `string` | 2-24 字符 |
| `affectedStockIds` | `string[]` | 1-8 项，`enum` 动态注入白名单 |

### 5.3 影响对象

| 字段 | 类型 | 约束 |
|------|------|------|
| `stockId` | `string` | `enum` 动态注入当前启用股票列表 |
| `changePercent` | `number` | `minimum: -8, maximum: 8` |
| `reason` | `string` | 4-80 字符 |

**关键设计**：`stockId` 的 `enum` 数组在运行时动态注入 `enabledStockIds`，利用模型的 JSON Schema 遵循能力从源头减少非法输出。

## 6. AI 调用流程

位置：`stockMarketAi.ts:444-520`

```
generateStockMarketAiNewsDraft(params)
  │
  ├─ 最多 3 次重试 (STOCK_MARKET_AI_MAX_ATTEMPTS)
  │
  ├─ Step 1: generateTechniqueTextModelSeed()
  │       生成随机 seed ∈ [1, 2147483647]
  │
  ├─ Step 2: buildTextModelPromptNoiseHash("stock-market-news:attempt", seed)
  │       生成 16 位噪声扰动码
  │
  ├─ Step 3: selectStockMarketNewsEventContext()
  │       选择延续事件 or 新事件
  │
  ├─ Step 4: buildStockMarketUserMessage()
  │       注入场景、事件、股票、规则等全部动态参数
  │
  ├─ Step 5: buildStockMarketResponseFormat()
  │       构造 JSON Schema（含动态 stockId enum）
  │
  ├─ Step 6: callConfiguredTextModel()
  │       │
  │       ├─ readTextModelConfig('stockMarket')
  │       ├─ buildTechniqueTextModelPayload()
  │       └─ OpenAI SDK → chat.completions.create()
  │
  ├─ Step 7: parseTechniqueTextModelJsonObject()
  │       剥离 <think> 标签 → 提取 JSON 对象
  │
  ├─ Step 8: validateStockMarketAiNewsPayload()
  │       白名单校验 + 去重 + 范围校验 + 事件 action 校验
  │
  └─ 成功 → 返回 StockMarketAiNewsDraft
     全部失败 → 返回失败原因
```

### 6.1 重试策略

| 参数 | 值 | 说明 |
|------|-----|------|
| 最大尝试 | 3 | `STOCK_MARKET_AI_MAX_ATTEMPTS` |
| 温度 | 0.8 | `STOCK_MARKET_AI_TEMPERATURE` |
| 失败信息传递 | 是 | `previousFailureReason` 注入 prompt |
| 每次独立 seed | 是 | 保证每次生成不同的随机扰动 |

## 7. 模型配置

位置：`modelConfig.ts:79-84`

| 环境变量 | 说明 |
|---------|------|
| `AI_STOCK_MARKET_MODEL_PROVIDER` | `openai` 或 `anthropic` |
| `AI_STOCK_MARKET_MODEL_URL` | API base URL（OpenAI 必填） |
| `AI_STOCK_MARKET_MODEL_KEY` | API Key（必须配置才启用） |
| `AI_STOCK_MARKET_MODEL_NAME` | 模型名（支持逗号分隔候选列表） |

**运行时参数**：

| 参数 | 值 |
|------|-----|
| temperature | 0.8 |
| 超时 | `AI_GENERATION_TIMEOUT_MS` |

## 8. 共享层 `techniqueTextModelShared.ts`

提供以下能力，避免各业务模块重复实现：

| 函数 | 作用 |
|------|------|
| `generateTechniqueTextModelSeed()` | 生成 `[1, 2147483647]` 随机 seed |
| `buildTextModelPromptNoiseHash()` | SHA256 派生 16 位噪声扰动码 |
| `buildTechniqueTextModelPayload()` | 构造标准 OpenAI 请求体 |
| `buildTechniqueTextModelJsonSchemaResponseFormat()` | 构造 `strict: true` 的 JSON Schema |
| `resolveOpenAICompatibleResponseFormat()` | DeepSeek 自动降级 `json_schema → json_object` |
| `extractTechniqueTextModelContent()` | 统一提取模型 content（字符串/分段数组） |
| `parseTechniqueTextModelJsonObject()` | 剥离 `<think>` → 解析 JSON → 提取嵌入候选 |

### 8.1 JSON 解析策略

模型返回可能包含 `<think>` 标签或嵌入在多余文本中，解析采用三步策略：

1. **剥离思维链**：`/<think\b[^>]*>[\s\S]*?<\/think>/gi` 全局替换
2. **直接解析**：尝试 `JSON.parse()` 整个字符串
3. **嵌入式提取**：遍历扫描 `{...}` 块，按 `preferredTopLevelKeys` 匹配度选择最优候选

## 9. 设计要点

### 9.1 为什么 User Message 用 JSON 而非自然语言

- 结构化注入天然避免拼接歧义
- 字段名即标签，模型理解成本低
- `JSON.stringify()` 一次序列化，避免手动拼接引号/换号
- 新增字段只需扩展对象，无需改拼接逻辑

### 9.2 为什么场景/事件选择用加权随机而非轮询

- 加权随机保证冷门题材有被选中的概率，同时不完全排除热门
- 权重随近期影响动态变化，实现"热降冷升"的自然轮换
- 最小权重保底确保任何场景不会被永久禁用
- 随机扰动打破确定性，避免玩家看出固定轮换模式

### 9.3 为什么 Schema 用动态 enum 注入

- 模型侧强制 `stockId` 来自白名单，减少服务端校验失败率
- 更换股票时自动同步，无需修改 Schema 定义
- `strict: true` 配合 enum 可显著降低幻觉输出

### 9.4 为什么重试时传递 failureReason

- 将失败信息作为 prompt 的一部分注入，引导模型自我修正
- 比降低 temperature 重试更有效（保留创造力，只修正错误模式）
- 3 次重试覆盖大部分解析失败/校验失败场景

## 10. 随机噪音波动

### 10.1 概述

每个 tick 中，除了 AI 新闻明确影响的股票外，其余未被影响的股票也会追加一个微幅随机波动，模拟市场自然噪音。

### 10.2 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STOCK_MARKET_NOISE_MIN_CHANGE_PERCENT` | `0.1` | 噪音下限（百分比），即 0.1% |
| `STOCK_MARKET_NOISE_MAX_CHANGE_PERCENT` | `0.5` | 噪音上限（百分比），即 0.5% |

### 10.3 噪音生成函数

位置：`stockMarketRules.ts`

```typescript
generateStockMarketNoiseChangeBps(seed, stockId, tickHour): number
```

**确定性**：基于 `tickId + stockId` 的 MD5 hash 生成随机值，同一 tick 同一股票调用结果一致（幂等）。

**范围**：

- 正方向：`[minBps, maxBps]` 即 `[1, 5]` 基点（默认）
- 负方向：`[-maxBps, -minBps]` 即 `[-5, -1]` 基点（默认）
- 正负方向由 hash 的最低位决定

### 10.4 执行流程

在 `applyGeneratedTick()` 事务内：

```
1. AI 影响股票 → 更新 quote + history（reason = AI 原因）
2. 计算差集 = 全部股票 - AI 影响股票
3. 对差集每个股票：
   a. generateStockMarketNoiseChangeBps(tickId, stockId, tickHour)
   b. applyStockMarketPriceChange(currentPrice, changeBps)
   c. UPDATE quote
   d. INSERT history (reason = '市场正常起伏')
```

**关键设计**：

- 噪音在 AI impacts **之后** 追加，不覆盖 AI 决策
- 同一 `withTransaction` 内执行，保证一致性
- 噪音幅度（±0.1% ~ ±0.5%）远小于 AI 正常波动（±1% ~ ±8%），不会干扰多空配对
- 噪音写入 `stock_market_price_history`（K 线可见），但新闻查询通过 `WHERE reason != '市场正常起伏'` 过滤掉，不显示在新闻列表中
- tick 失败（AI 未返回）时不触发噪音

