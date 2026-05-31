# AI 新闻驱动器切换方案设计

## 一、现状分析

### 1.1 当前调用链

```
app.ts:startServer()
  └─ initializeStockMarketScheduler()          ← 调度器入口
       └─ scheduleNextRun()                     ← setTimeout 到下一个 30min 边界
            └─ runScheduledStockMarketTick()    ← 触发函数
                 └─ stockMarketService.runScheduledTick(now)  ← 核心执行
                      ├─ INSERT stock_market_tick              ← ① 占位 tick
                      ├─ SELECT stock_market_quote             ← ② 价格快照
                      ├─ loadRecentImpactStockIds()            ← ③ 查 tick + price_history
                      ├─ loadRecentPriceTrend()                ← ④ 查 tick + price_history
                      ├─ coolInactiveNewsEvents()              ← ⑤ UPDATE news_event
                      ├─ loadActiveNewsEvents()                ← ⑥ SELECT news_event
                      ├─ generateStockMarketAiNewsDraft()      ← ⑦ AI 生成（含事件选择器 + 场景选择器）
                      └─ applyGeneratedTick()                  ← ⑧ 事务写入 tick/news_event/quote/price_history
```

### 1.2 旧驱动器强依赖的表

| 表 | 角色 | 读/写 |
|----|------|-------|
| `stock_market_tick` | tick 占位、状态、关联事件 | 读+写 |
| `stock_market_news_event` | 事件池状态机（active/cooling/resolved） | 读+写 |
| `stock_market_quote` | 股票当前价格 | 读+写 |
| `stock_market_price_history` | 价格变动历史 | 写 |

### 1.3 切换边界

旧驱动器的「内部状态表」与「市场输出表」需要区分：

- **内部状态表**（新驱动器禁止使用）：`stock_market_tick`、`stock_market_news_event`
- **市场输出表**（新旧驱动器共享）：`stock_market_quote`、`stock_market_price_history`

两者共享市场输出表是因为：无论哪个驱动器驱动，前端 K 线、持仓页、概览页消费的数据源必须统一。

---

## 二、切换开关设计

### 2.1 环境变量

```
STOCK_MARKET_DRIVER=v1 | v2
```

| 值 | 含义 |
|----|------|
| `v1`（默认） | 使用现有 AI 新闻驱动器（基于事件状态机） |
| `v2` | 使用新 AI 新闻驱动器（核心算法待补充） |

### 2.2 开关解析模块

新建 `server/src/services/stockMarket/stockMarketDriverConfig.ts`

```typescript
export type StockMarketDriverType = 'v1' | 'v2';

const VALID_DRIVERS: ReadonlySet<StockMarketDriverType> = new Set(['v1', 'v2']);

export const resolveStockMarketDriver = (): StockMarketDriverType => {
  const raw = process.env.STOCK_MARKET_DRIVER ?? 'v1';
  const normalized = raw.trim().toLowerCase();
  if (VALID_DRIVERS.has(normalized as StockMarketDriverType)) {
    return normalized as StockMarketDriverType;
  }
  return 'v1';
};
```

职责单一：解析环境变量，返回确定的驱动器类型。非法值默认回退 v1。

---

## 三、调度层改造

### 3.1 调度器路由

改造 `stockMarketScheduler.ts`：

```
initializeStockMarketScheduler()
  └─ resolveStockMarketDriver()
       ├─ 'v1' → 路由到 stockMarketService.runScheduledTick()     ← 现有逻辑不动
       └─ 'v2' → 路由到 stockMarketV2Service.runScheduledTick()   ← 新驱动器入口
```

具体改动：

```typescript
// stockMarketScheduler.ts - runScheduledStockMarketTick 改造前
const result = await stockMarketService.runScheduledTick(now);

// 改造后
const driver = resolveStockMarketDriver();
const result = driver === 'v1'
  ? await stockMarketService.runScheduledTick(now)
  : await stockMarketV2Service.runScheduledTick(now);
```

`initializeStockMarketScheduler()` 中的 `ensureInitialQuotes()` 保留，因为两个驱动器都需要初始报价。

### 3.2 gracefulShutdown 不受影响

`stopStockMarketScheduler()` 仅清理 setTimeout，不涉及驱动器内部状态，无需改动。

---

## 四、新驱动器接口契约

### 4.1 入口方法签名

新驱动器 `stockMarketV2Service` 必须实现与旧驱动器相同的入口方法：

```typescript
interface StockMarketV2Service {
  runScheduledTick(now: Date): Promise<{
    status: 'generated' | 'failed' | 'skipped';
    message: string;
  }>;
}
```

返回结构与旧驱动器一致，使调度层无需感知驱动器差异。

### 4.2 新驱动器独立表空间

新驱动器使用全新的内部状态表，不得读写 V1 驱动器的任何内部表：

| V1 表（V2 禁止使用） | V2 表 | 用途 |
|------|----------|------|
| `stock_market_tick` | `stock_market_v2_tick` | tick 占位、状态、世界状态快照 |
| `stock_market_news_event` | （无对应表） | V2 不需要事件状态机，每个 tick 即一条新闻 |
| （无对应表） | `stock_market_v2_world_state_log` | 世界状态历史快照 |
| （无对应表） | `stock_market_v2_narrative_log` | 叙事记忆，用于去重 |

**V2 明确禁止使用的 V1 模块**：

| V1 模块 | 禁止原因 | V2 替代方案 |
|---------|---------|------------|
| `stockMarketScenarioSelector.ts`（8 场景池） | 场景池是人为预设的题材轮换，与世界自己运转的理念矛盾 | 世界状态维度 + 区域描述自动生成叙事方向 |
| `stockMarketNewsEventContext.ts`（事件池权重） | 事件池续写机制是断裂的，不是连续的 | 世界状态持续演化，无需事件选择 |
| `selectStockMarketScenarioGuide()` | 场景引导是人为种子驱动 | 世界状态数值转人类可读描述，直接作为 AI prompt 上下文 |
| `selectStockMarketNewsEventContext()` | 事件轮盘赌是人为随机 | 世界状态演化自带随机性 + 均值回归 |

### 4.3 共享输出表

两个驱动器共享市场输出表，写入时使用 `FOR UPDATE` 行锁保证并发安全（虽然运行时只有一个驱动器活跃）：

| 表 | 用途 |
|----|------|
| `stock_market_quote` | 更新当前价格、last_change_bps |
| `stock_market_price_history` | 写入价格变动记录 |

### 4.4 未受影响股票处理

旧驱动器中，AI 新闻未覆盖的股票通过 `getTradePressureMap()` + 随机噪声补充涨跌。新驱动器需要自行处理这部分逻辑，或提供等效机制，确保每个 tick 中所有股票的 quote 和 price_history 都被更新（避免前端 K 线断档）。

---

## 五、完整运行时架构

```
                    STOCK_MARKET_DRIVER 环境变量
                               │
                               ▼
                    ┌─────────────────────┐
                    │  resolveStockMarket │
                    │  Driver()           │
                    └────────┬────────────┘
                             │
               ┌─────────────┼─────────────┐
               ▼                             ▼
        ┌──────────────┐           ┌──────────────────┐
        │   V1 Driver  │           │   V2 Driver      │
        │  (现有实现)   │           │  (新实现)         │
        ├──────────────┤           ├──────────────────┤
        │ stockMarket  │           │ stockMarketV2    │
        │ Service      │           │ Service          │
        │              │           │                  │
        │ 内部表:       │           │ 内部表:           │
        │  tick        │           │  v2_tick         │
        │  news_event  │           │  v2_news_event   │
        │              │           │  v2_scenario_state│
        └──────┬───────┘           └────────┬─────────┘
               │                            │
               └────────────┬───────────────┘
                            ▼
                 ┌──────────────────────┐
                 │    共享输出层          │
                 ├──────────────────────┤
                 │ stock_market_quote   │
                 │ stock_market_price_history │
                 └──────────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │    前端消费层          │
                 ├──────────────────────┤
                 │ 概览 / K线 / 持仓 / 新闻 │
                 └──────────────────────┘
```

---

## 六、前端兼容性

### 6.1 无需改动

前端消费的是 `stock_market_quote`、`stock_market_price_history` 以及 `stock_market_tick`（用于新闻查询的 JOIN）。

- **概览页**：查询 quote + 最近 tick + price_history → 不受影响
- **K 线**：查询 price_history → 不受影响
- **新闻列表**：通过 tick JOIN price_history → 受影响的点：

### 6.2 新闻查询适配

旧前端新闻查询依赖 `stock_market_tick` 的 `headline` / `summary` / `event_id` 字段。新驱动器使用 `stock_market_v2_tick`。

**方案**：新闻查询 API（`getNewsEventList`、`getNewsEventChain`）按驱动器类型路由到对应数据源。在 `stockMarketService` 中新增方法 `getNewsEventListV2`、`getNewsEventChainV2`，API 路由层根据 `STOCK_MARKET_DRIVER` 环境变量选择调用哪个。

```
GET /api/stock-market/news-events
  └─ resolveStockMarketDriver()
       ├─ 'v1' → stockMarketService.getNewsEventList()
       └─ 'v2' → stockMarketV2Service.getNewsEventList()

GET /api/stock-market/news-events/:eventId/chain
  └─ resolveStockMarketDriver()
       ├─ 'v1' → stockMarketService.getNewsEventChain(eventId)
       └─ 'v2' → stockMarketV2Service.getNewsEventChain(eventId)
```

返回 DTO 结构保持一致，前端无需改动。

---

## 七、切换操作流程

### 7.1 从 v1 切换到 v2

1. 修改 `.env` 中 `STOCK_MARKET_DRIVER=v2`
2. 重启服务
3. 调度器下一次 tick 触发时自动路由到 v2 驱动器
4. 旧驱动器内部表（tick、news_event）数据保留不变

### 7.2 从 v2 回切 v1

1. 修改 `.env` 中 `STOCK_MARKET_DRIVER=v1`
2. 重启服务
3. 调度器下一次 tick 触发时自动路由回 v1 驱动器
4. v2 内部表数据保留不变

### 7.3 数据隔离保证

切换过程中：
- v1 的 `news_event` 状态机不会被 v2 误读或误写
- v2 的内部状态不会被 v1 误读或误写
- 共享输出表（quote、price_history）的写入通过行锁隔离
- 前端新闻查询 API 跟随驱动器切换，始终查询当前活跃驱动器的数据源

---

## 八、文件变更清单（仅结构）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `server/src/services/stockMarket/stockMarketDriverConfig.ts` | 开关解析模块 |
| **修改** | `server/src/services/stockMarket/stockMarketScheduler.ts` | `runScheduledStockMarketTick` 增加驱动器路由 |
| **新增** | `server/src/services/stockMarket/stockMarketV2Service.ts` | 新驱动器服务（入口方法签名已定义，核心算法待补充） |
| **新增** | `server/prisma/migrations/` | 新表迁移：v2_tick、v2_news_event、v2_scenario_state |
| **修改** | `server/src/routes/` | 新闻事件查询 API 增加驱动器路由 |
| **新增** | `.env` 示例中添加 `STOCK_MARKET_DRIVER=v1` | 文档化开关 |

---

## 九、风险点与边界条件

1. **切换时点**：切换发生在服务重启后，不是热切换。两次 tick 之间切换是安全的，因为每个 tick 是独立事务。

2. **quote 行锁冲突**：两个驱动器运行时不会同时写入（环境变量排他），但 `applyGeneratedTick` 中的 `FOR UPDATE` 行锁需保留，防止未来出现并发场景。

3. **price_history 数据混杂**：切换后，price_history 中会同时存在 v1 和 v2 驱动的 tick 记录。前端 K 线按 tick_hour 排序，天然连续，不受影响。但如需区分来源，可在 price_history 中增加 `driver` 字段（`v1` / `v2`），此为可选项。

4. **新闻查看器兼容性**：`DevNewsViewer` 组件调用 `/api/stock-market/news-events` 和 `/api/stock-market/news-events/:id/chain`。API 路由层按驱动器切换数据源即可，组件层无需改动。

5. **初始报价**：`ensureInitialQuotes()` 由调度器 `initializeStockMarketScheduler()` 调用，在驱动器路由之前执行。两个驱动器共享初始报价逻辑，无需复制。

---

## 十、V2 驱动器核心算法：世界观驱动

### 10.0 设计哲学：世界是活的

V1 驱动器的本质是「事件池续写」——AI 从一组事件中挑选一条续写或开新。这种模式下，新闻的诞生是人为的、断裂的，事件之间缺乏自然关联。

V2 驱动器的核心理念是**「世界自己运转，新闻只是它的投影」**。不依赖事件池续写机制，而是先构建一个活着的世界状态，每 tick 世界状态自行演化，AI 根据当前世界状态生成新闻，新闻再驱动股票涨跌。

**关键区别**：

| | V1 事件驱动 | V2 世界观驱动 |
|--|------------|--------------|
| 叙事单位 | 离散事件（event） | 持续世界状态（world state） |
| 续写机制 | AI 续写已有事件快照 | 世界状态自然延续/突变 |
| 场景轮换 | 8 个预设场景权重轮盘赌（`stockMarketScenarioSelector`） | 世界状态维度自然演化，无预设场景池 |
| AI 自由度 | 在事件+场景框架内填充 | 根据世界状态自由叙事 |
| 股票波动来源 | 事件关联股票 | 世界状态 → 股票方向映射 |

**V2 彻底取缔的 V1 机制**：

- `stockMarketScenarioSelector.ts`（8 场景池 + 轮盘赌 + 场景引导文案）—— 由世界状态维度描述替代
- `stockMarketNewsEventContext.ts`（事件池权重 + 续写/冷却/ resolved 状态机）—— 由世界状态持续演化替代
- `selectStockMarketScenarioGuide()` / `selectStockMarketNewsEventContext()` —— V2 驱动器的 prompt 中不存在这两个函数的调用

### 10.1 世界观设定

#### 地理格局

```
                    ┌─────────────────────────────────────┐
                    │           北  州  富  饶  大  陆        │
                    │                                     │
                    │  琼玉丹坊  星钛矿业  龙洲船坞  天罡器阁   │
                    │  无极书院  云梦药畦  星瀚拍卖  碧州宝楼   │
                    │  乌尔达哈商会  沧雪剑宗  乾坤阵台         │
                    │                                     │
    ════════════════╪═══════════════════════════════════════╪═══════════════
    南  疆  蛮  荒  之  地      │     剑  气  长  城     │   妖  潮  /  异  族
    （不可交易区域）             │  （剑气长城 · 股票）    │   （叙事压力源）
    ════════════════╪═══════════════════════════════════════╪═══════════════
                    │                                     │
```

**三层结构**：

- **北州富饶大陆**：11 支股票全部位于北州，是经济活动的主体。宗门、丹药、矿材、炼器、灵植、拍卖、商贸、交通、阵法、功法——构成一个自洽的商业生态。
- **剑气长城**：南北交界处的军事要塞，既是宗门股票也是地理分界线。它的状态决定了南北之间的张力——战事紧张则军工/防务类股票受益，和平时期则承压。
- **南疆蛮荒之地**：不可交易区域，但是**叙事压力源**。妖潮、异族、蛮修、瘴气、古遗迹——所有来自南方的威胁和机遇，通过影响剑气长城和北州边防，间接驱动北州股票波动。南疆本身没有股票，但它的「活动度」是世界状态的核心变量之一。

#### 股票地域映射

| 区域 | 股票 | 经济角色 |
|------|------|---------|
| **北州 · 核心产业** | 琼玉丹坊、星钛矿业、天罡器阁 | 丹药/矿材/炼器三角，原材料→加工→成品产业链 |
| **北州 · 基础设施** | 龙洲船坞、乾坤阵台 | 交通+阵法，商路和城池的物理基础 |
| **北州 · 文教消费** | 无极书院、云梦药畦 | 功法+灵植，文化繁荣的指标 |
| **北州 · 流通渠道** | 星瀚拍卖、碧州宝楼、乌尔达哈商会 | 拍卖+商贸，资金和物资的流通管道 |
| **北州 · 军事宗门** | 沧雪剑宗 | 剑修宗门，与长城联动 |
| **南北交界** | 剑气长城 | 边境要塞，南北张力的直接载体 |

### 10.2 世界状态模型

#### 核心维度

世界状态由以下维度构成，每个维度是一个持续演化的数值：

```typescript
type WorldState = {
  // === 南北张力（0~100）===
  // 0 = 完全和平，100 = 全面战争
  // 张力上升来源：妖潮活动、异族异动、边境摩擦
  // 张力下降来源：和谈、停战协议、边防加固
  northSouthTension: number;

  // === 北州繁荣度（0~100）===
  // 0 = 萧条，100 = 极盛
  // 综合反映北州整体经济景气程度
  // 受商路畅通、宗门贸易、丹药流通、矿材供应等影响
  northernProsperity: number;

  // === 南疆活跃度（0~100）===
  // 0 = 沉寂，100 = 妖潮汹涌
  // 反映南方蛮荒之地的「活跃程度」
  // 独立演化，但高活跃度推高南北张力
  southernActivity: number;

  // === 区域子状态 ===
  regionStates: {
    // 丹药/灵植产业链景气度
    alchemySupplyChain: number;    // 0~100
    // 矿材/炼器产业链景气度
    miningForgeChain: number;      // 0~100
    // 商贸流通景气度
    commerceFlow: number;          // 0~100
    // 文教/阵法发展度
    cultureArray: number;          // 0~100
    // 军事防务强度
    militaryDefense: number;       // 0~100
  };

  // === 近期叙事记忆 ===
  // 记录最近 N 个 tick 发生过的叙事类型，避免 AI 重复写同一种题材
  recentNarratives: Array<{
    type: string;        // "妖潮入侵" / "丹药突破" / "矿脉发现" / ...
    tickId: bigint;
    severity: number;    // 1~5，影响程度
  }>;
};
```

#### 状态演化规则

每个 tick，世界状态按以下规则自行演化（**不依赖 AI，纯数值计算**）：

```
① 南疆活跃度独立演化
   southernActivity += random(-5, +5)  ← 有均值回归倾向，目标中值 40
   边界：0~100

② 南北张力由南疆活跃度 + 惯性驱动
   northSouthTension = northSouthTension * 0.7  ← 30% 向中值回归
                    + southernActivity * 0.3    ← 南疆活跃度 30% 传导
                    + random(-3, +3)             ← 随机边境事件
   边界：0~100

③ 北州繁荣度由区域子状态加权
   northernProsperity = weightedAvg(regionStates)
   各子状态也各自演化（±5 随机 + 均值回归）

④ 区域子状态互相影响
   · alchemySupplyChain 受 northernProsperity 正向影响
   · miningForgeChain 受 militaryDefense 正向影响（战时矿材需求大）
   · commerceFlow 受 northSouthTension 负向影响（战时商路受阻）
   · cultureArray 受 northernProsperity 正向影响
   · militaryDefense 受 northSouthTension 正向影响
```

**关键设计**：世界状态演化是确定性的（给定 seed 结果一致），但加入了足够的随机性使叙事有变化。均值回归防止任何维度长期锁死在极端值。

### 10.3 世界状态 → 股票映射

每个股票与世界状态的特定维度绑定，世界状态决定该股票的「基准方向」：

| 股票 | 绑定维度 | 方向逻辑 |
|------|---------|---------|
| 剑气长城 | northSouthTension, militaryDefense | 张力↑ → 利好（战功/军需），和平→ 横盘微跌 |
| 沧雪剑宗 | northSouthTension, militaryDefense | 同长城，联动但幅度略小 |
| 星钛矿业 | miningForgeChain, militaryDefense | 战时矿材需求大，冶炼景气时也好 |
| 天罡器阁 | miningForgeChain, militaryDefense | 法器/护甲在战时需求激增 |
| 龙洲船坞 | commerceFlow, northSouthTension | 商路畅通→利好，战时可能受征用或受损 |
| 琼玉丹坊 | alchemySupplyChain, northernProsperity | 繁荣期丹药需求大 |
| 云梦药畦 | alchemySupplyChain, northernProsperity | 灵草需求随繁荣度变化 |
| 乾坤阵台 | cultureArray, militaryDefense | 平时城池扩建用阵，战时护阵也用阵 |
| 无极书院 | cultureArray, northernProsperity | 繁荣期讲经会多，秘卷需求大 |
| 星瀚拍卖 | commerceFlow, northernProsperity | 繁荣+流通好→压轴拍品多 |
| 碧州宝楼 | commerceFlow, northernProsperity | 同拍卖，更偏日常贸易 |
| 乌尔达哈商会 | commerceFlow, northSouthTension | 商路畅通→利好，战时汇兑需求也大 |

映射规则是确定性的：**维度值 → 方向（bullish/bearish/neutral）→ 强度（0~3 级）**。

### 10.4 AI 叙事生成流程

```
每个 tick:

① 演化世界状态（纯数值计算，不调用 AI）
   worldState = evolveWorldState(worldState, tickId, seed)

② 计算每只股票的基准方向和强度
   stockDirections = mapWorldToStocks(worldState)

③ 从叙事记忆中查找近期未使用的叙事类型
   availableNarratives = filterRecentNarratives(worldState)

④ 构建 AI prompt，包含：
   · 当前世界状态摘要（人类可读描述，不是原始数值）
   · 每只股票的基准方向（提示 AI 不要逆趋势写）
   · 近期叙事记忆（避免重复）
   · 南疆活跃度和南北张力的「世界事件」（如「妖潮在长城以南三百里集结」）
   · 北州繁荣度的「社会事件」（如「北州商路繁荣，灵石汇兑量创新高」）

⑤ AI 根据世界状态生成新闻
   · AI 不需要决定涨跌方向和幅度（方向已由世界状态确定）
   · AI 只需要写新闻内容：标题、摘要、叙事类型
   · AI 的创造力用在叙事上，而不是数值判断上

⑥ 将 AI 新闻 + 世界状态方向 → 写入 tick/quote/price_history
```

**与 V1 的关键差异**：

- V1：AI 决定写什么新闻 + 影响哪些股票 + 涨跌多少 → 全部交给 AI
- V2：世界状态决定哪些股票涨/跌/横 → AI 只负责写新闻内容来包装这些变动

这保证了两个结果：
1. **世界是活的**：即使 AI 生成失败，世界状态仍在演化，股票仍有方向
2. **AI 不被滥用**：AI 不需要做数值判断，只做叙事填充，降低了 prompt 复杂度和校验难度

### 10.5 新驱动器内部表

```sql
-- tick 记录（替代 stock_market_tick）
CREATE TABLE stock_market_v2_tick (
  id              BIGSERIAL PRIMARY KEY,
  tick_hour       TIMESTAMP NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'running',  -- running|generated|failed
  headline        TEXT,
  summary         TEXT,
  model_name      VARCHAR(96),
  prompt_snapshot TEXT,
  world_state     JSONB,              -- 本 tick 的世界状态快照
  narrative_type  VARCHAR(64),        -- 本 tick 的叙事类型
  created_at      TIMESTAMP DEFAULT NOW(),
  finished_at     TIMESTAMP
);

-- 世界状态历史（可选，用于调试和回放）
CREATE TABLE stock_market_v2_world_state_log (
  id              BIGSERIAL PRIMARY KEY,
  tick_id         BIGINT REFERENCES stock_market_v2_tick(id),
  state_snapshot  JSONB NOT NULL,     -- 完整世界状态
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 叙事记忆（最近 N 条叙事记录，用于去重）
CREATE TABLE stock_market_v2_narrative_log (
  id              BIGSERIAL PRIMARY KEY,
  tick_id         BIGINT REFERENCES stock_market_v2_tick(id),
  narrative_type  VARCHAR(64) NOT NULL,
  severity        INT NOT NULL,       -- 1~5
  description     TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);
```

注意：**不使用 `stock_market_v2_news_event` 表**。V2 不需要事件状态机。世界状态本身就是持续存在的，不需要 active/cooling/resolved 的生命周期。如果后续需要「新闻事件查看器」功能，直接查 `stock_market_v2_tick` 即可——每个 tick 就是一条新闻。

### 10.6 新驱动器 tick 流程

```
① INSERT stock_market_v2_tick              ← 占位 tick
   └── 若冲突 → skipped，后续全部跳过

② SELECT stock_market_quote               ← 读取当前价格快照

③ loadWorldState()                        ← 从 stock_market_v2_world_state_log 读取最新世界状态
   └── 若无历史（首次启动）→ 初始化默认世界状态

④ evolveWorldState()                      ← 纯函数：根据规则演化世界状态
   └── 输出：新的 worldState

⑤ mapWorldToStocks(worldState)            ← 纯函数：世界状态 → 股票方向映射
   └── 输出：Map<stockId, { direction, strength }>

⑥ generateStockMarketV2AiNewsDraft()      ← 调用 AI
   ├── 构建 prompt（世界状态描述 + 股票方向提示 + 叙事去重）
   ├── callConfiguredTextModel()
   ├── parseTechniqueTextModelJsonObject()
   └── validateStockMarketV2AiNewsPayload() ← 校验：叙事类型、标题摘要长度

⑦ applyGeneratedV2Tick()                  ← 事务写入
   ├── SELECT stock_market_v2_tick FOR UPDATE
   ├── SELECT stock_market_quote FOR UPDATE
   ├── UPDATE stock_market_v2_tick         ← status='generated', 写入新闻和世界状态快照
   ├── INSERT stock_market_v2_world_state_log  ← 持久化世界状态
   ├── INSERT stock_market_v2_narrative_log    ← 记录叙事
   ├── UPDATE stock_market_quote            ← 更新股票价格（方向由世界状态确定）
   └── INSERT stock_market_price_history    ← 写入 K 线数据

⑧ pendingOrderService.processAllActiveOrders()  ← 撮合挂单（与 V1 共享）
```

### 10.7 AI Prompt 设计（草案）

```jsonc
{
  "tickHour": "2026-05-31T14:00:00Z",
  "worldState": {
    "northSouthTension": {
      "value": 62,
      "description": "长城以南三百里，妖气日浓。剑气长城的巡防修士已连续七日发现南疆异族试探性进攻。"
    },
    "northernProsperity": {
      "value": 71,
      "description": "北州商路畅通，各宗门贸易往来频繁，灵石汇兑量创下新高。"
    },
    "southernActivity": {
      "value": 78,
      "description": "南疆蛮荒之地妖潮涌动，多处灵脉出现异常波动。"
    },
    "regions": {
      "alchemySupplyChain": "丹药产业链景气，琼玉丹坊订单充足，云梦药畦灵草丰收。",
      "miningForgeChain": "矿材供应稳定，天罡器阁收到多笔军方订单。",
      "commerceFlow": "商路畅通，乌尔达哈商会报告本月汇兑量增长两成。",
      "cultureArray": "无极书院春季讲经会即将开幕，各地修士纷至沓来。",
      "militaryDefense": "剑气长城增派巡防，沧雪剑宗弟子轮换驻防。"
    }
  },
  "stockDirections": [
    { "stockId": "stock-jianqi-wall", "direction": "bullish", "strength": 3, "reason": "南北张力高，军事需求大" },
    { "stockId": "stock-chixiao-sword", "direction": "bullish", "strength": 2, "reason": "联动长城，驻防轮换" },
    { "stockId": "stock-xuantie-mining", "direction": "bullish", "strength": 1, "reason": "军方订单拉动矿材需求" },
    // ... 其余 9 支
  ],
  "recentNarratives": [
    { "type": "妖潮试探", "tickId": 142, "severity": 2 },
    { "type": "丹药突破", "tickId": 138, "severity": 3 },
    // ... 最近 10 条
  ],
  "outputRules": [
    "只生成一条中文新闻，围绕当前世界状态",
    "优先描写南北张力或北州繁荣度中变化最显著的维度",
    "不要重复近期已出现过的叙事类型（见 recentNarratives）",
    "headline 4~40 字，summary 12~160 字",
    "叙事类型（narrativeType）从预设列表中选择",
    "新闻内容必须与世界状态一致，不要写与当前局势矛盾的内容"
  ]
}
```

### 10.8 待补充

1. **世界状态初始化值**：默认 tension/prosperity/activity 的起始数值需要调参
2. **演化规则参数**：均值回归速度、随机波动幅度、区域子状态互影响系数
3. **股票映射强度表**：每只股票对应方向的强度计算规则（线性？指数？阈值？）
4. **叙事类型预设列表**：妖潮/和谈/丹方/矿脉/商路/讲经会/拍卖/战事/天灾/遗迹等
5. **叙事去重算法**：如何从 recentNarratives 中排除近期类型，给 AI 候选列表
6. **AI 输出 schema**：只需要 headline + summary + narrativeType，不需要 impacts/涨跌数值
7. **价格写入规则**：世界状态方向强度 → 具体涨跌基点的映射公式

以上内容是世界观框架，具体数值参数、演化公式、映射算法待确认世界观设定方向后补充。
