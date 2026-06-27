# AI 新闻驱动器 V3 —— 场景轮换 + 反转 + 叙事轨迹

> **已废弃**：该方案实践失败，是废案。V3 驱动器（场景轮换 + 反转 + 叙事轨迹）已确认不再继续实装。

## 一、设计动机

### V1 的问题
- AI 完全自由决定涨跌，不可控、不可预见
- AI 每次只看到价格快照和数值趋势，不知道之前发生过什么新闻，叙事断裂
- 事件池续写机制是断裂的，不是连续的
- 场景是人为预设的轮盘赌，可能连续重复

### V3 的目标
- **涨跌可控**：每个场景预设涨跌因子，AI 不再自由判断涨跌
- **不可预见性**：子叙事反转层 + 叙事轨迹摘要，玩家不会摸清固定规律
- **叙事连续**：AI 能看到最近 N 条 tick 的叙事轨迹，写新闻有前因后果
- **场景轮换有序**：最少/最多 tick 约束，不可连续重复

---

## 二、系统架构

```
场景池管理器
  ├─ 当前场景（确定生命周期）
  ├─ 涨跌因子表（每只股票的方向 + 强度 + 可能反转）
  └─ 反转引擎（随机触发子叙事反转）

叙事轨迹生成器
  └─ 从 stock_market_tick 读最近 N 条 generated tick
       → 紧凑摘要（headline + direction + changeBps + 关联股票）

AI 新闻生成器（V3 专属）
  ├─ 场景基准方向 + 反转提示
  ├─ 叙事轨迹（前因后果）
  ├─ 当前价格快照
  └─ 输出：headline + summary + impacts（涨跌方向已由场景确定）

调度层
  └─ STOCK_MARKET_DRIVER=v3 → stockMarketV3Service.runScheduledTick()
```

---

## 三、场景池设计

### 3.1 场景结构

```typescript
type StockDirection = {
  stockId: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;    // 1~3，对应幅度区间
  reason: string;      // 人类可读理由，传给 AI
};

type SceneTwist = {
  stockId: string;
  directionOverride: 'bullish' | 'bearish';
  strengthOverride: number;
  narrativeReason: string;  // 反转的叙事理由
};

type StockMarketScene = {
  id: string;
  name: string;             // 场景名，如「和平岁月」
  description: string;      // 场景描述，用于 AI prompt
  minTicks: number;         // 最少持续 tick（默认 6）
  maxTicks: number;         // 最多持续 tick（默认 20）
  baseDirections: StockDirection[];  // 每只股票的基准方向
  possibleTwists: SceneTwist[];      // 可能的反转列表
};
```

### 3.2 场景生命周期

```
场景启动 → 至少运行 minTicks → 进入可结束窗口 → 随机结束或强制结束
                                                          │
                            已运行 ≥ maxTicks ←───────────┘
                            ↓
                       强制切换到下一个场景
```

- **最短生命周期**：6 tick（3 小时），确保场景有足够叙事展开
- **最长生命周期**：20 tick（10 小时），防止场景锁死
- **结束窗口**：6~20 tick 之间，每个 tick 有概率结束（推荐 15-25% 概率）
- **不可连续**：同一个场景不能在切换后立即重新出现，从剩余池中随机选下一个

### 3.3 涨跌强度映射

| 强度 | 幅度范围 | 含义 |
|------|---------|------|
| 1 | ±2% ~ ±6% | 轻微影响 |
| 2 | ±6% ~ ±10% | 中等影响 |
| 3 | ±10% ~ ±12% | 重大影响 |

反转的强度上限为 2（不超过 ±6%），避免反转盖过主趋势。

---

## 四、叙事轨迹

### 4.1 数据来源

直接查 `stock_market_tick`（无需新表）：

```sql
SELECT id, tick_hour, headline, summary,
       (SELECT json_agg(json_build_object(
         'stockId', stock_id,
         'changeBps', change_bps,
         'direction', direction,
         'reason', reason
       ))
        FROM stock_market_price_history
        WHERE tick_id = t.id) AS impacts
FROM stock_market_tick t
WHERE status = 'generated'
ORDER BY tick_hour DESC
LIMIT 8
```

### 4.2 传给 AI 的格式

```json
"narrativeTrail": [
  {
    "tickId": "145",
    "hour": "2026-06-02T08:00",
    "headline": "边境巡防连斩三妖，长城守备稳固",
    "summary": "剑气长城...",
    "impacts": [
      { "stockId": "stock-jianqi-wall", "direction": "up", "changeBps": 180 },
      { "stockId": "stock-chixiao-sword", "direction": "up", "changeBps": 120 }
    ]
  },
  ... 最近 7 条倒序
]
```

### 4.3 AI 能看到的东西

| 信息 | 用途 |
|------|------|
| 最近 8 条 tick 的 headline + summary | 知道之前发生过什么新闻 |
| 每条 tick 影响了哪些股票 + 涨跌 | 知道叙事弧线 |
| 某只股票连续跌/涨了几个 tick | 知道是否需要反转或修复 |
| 当前场景的基准方向 | 知道本轮大基调 |
| 反转提示（如有） | 知道哪些股票要逆趋势写 |

**结果**：AI 不再对着一个数字瞎编。它知道「长城已经连跌 3 个 tick，前两次理由分别是军费和妖潮，这次和平场景里如果还要让它跌，需要新的叙事角度；或者触发反转让它逆势涨」。

---

## 五、反转引擎

### 5.1 触发时机

每个 tick 独立判定，不与场景绑定：

```
每个 tick:
  对每个场景的 possibleTwists 列表：
    掷骰子（seed 驱动，可复现）
    如果骰中 → 将该反转加入本轮 activeTwists
```

### 5.2 触发概率

| 反转层级 | 概率 | 影响股票数 | 幅度上限 |
|---------|------|-----------|---------|
| **次级反转** | 20-30% | 1-3 只 | ±6%（强度 ≤2） |
| **黑天鹅** | 5-10% | 1 只 | ±8%（强度 3） |

### 5.3 反转与基准的关系

- 反转只覆盖特定股票的基准方向
- 反转后，该股票的方向和理由全部替换
- AI 看到 `narrativeTwist: true` + `twistReason`，专门写反转叙事

---

## 六、V3 驱动器表空间

### 6.1 内部表

| 表 | 用途 |
|----|------|
| `stock_market_v3_tick` | tick 占位 + 新闻 + 场景快照 |
| `stock_market_v3_scene_state` | 当前场景状态（场景 ID、已运行 tick 数、累计反转记录） |

### 6.2 V3 独立输出表（与 V1 完全隔离）

| 表 | 用途 |
|----|------|
| `stock_market_v3_quote` | V3 当前价格快照（不共享 V1 的 quote 表） |
| `stock_market_v3_price_history` | V3 K 线价格变动记录（不共享 V1 的 price_history 表） |

> **为什么隔离**：V3 与 V1 共享 `stock_market_price_history` 会导致 tick ID 冲突、外键需要全局修改，是完全无法兼容的方案。V3 所有输出数据自成一系，两套驱动器封闭运行，互不干扰。

### 6.3 表结构

```sql
-- tick 记录
CREATE TABLE stock_market_v3_tick (
  id              BIGSERIAL PRIMARY KEY,
  tick_hour       TIMESTAMP NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'running',
  scene_id        VARCHAR(64),                -- 当前场景 ID
  headline        TEXT,
  summary         TEXT,
  model_name      VARCHAR(96),
  prompt_snapshot TEXT,
  active_twists   JSONB,                      -- 本轮触发的反转列表
  narrative_trail JSONB,                      -- 传给 AI 的叙事轨迹快照
  created_at      TIMESTAMP DEFAULT NOW(),
  finished_at     TIMESTAMP
);

-- 场景状态（只存一行，记录当前场景进度）
CREATE TABLE stock_market_v3_scene_state (
  id              BIGSERIAL PRIMARY KEY,
  scene_id        VARCHAR(64) NOT NULL,       -- 当前场景 ID
  ticks_elapsed   INT NOT NULL DEFAULT 0,     -- 已运行 tick 数
  previous_scene_id VARCHAR(64),              -- 上一个场景 ID（用于不可连续校验）
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

---

## 七、V3 tick 流程

```
① INSERT stock_market_v3_tick              ← 占位 tick
   └── 若冲突 → skipped，后续全部跳过

② SELECT stock_market_quote                ← 读取当前价格快照

③ loadSceneState()                         ← 从 stock_market_v3_scene_state 读取场景状态
   └── 若无（首次启动）→ 初始化默认场景

④ maybeSwitchScene()                       ← 场景轮换判定
   ├── ticks_elapsed < minTicks → 不切换
   ├── ticks_elapsed >= maxTicks → 强制切换
   └── minTicks ≤ ticks_elapsed < maxTicks → 概率切换（15-25%）
   切换规则：从可用场景池中排除 previous_scene_id，随机选下一个

⑤ buildScenePrompt(scene)                  ← 构建当前场景的涨跌因子
   └── 输出：Map<stockId, StockDirection>

⑥ maybeTriggerTwists(scene, seed)          ← 反转引擎
   └── 输出：activeTwists（可能为空）

⑦ loadNarrativeTrail()                     ← 查最近 8 条 generated tick
   └── 从 stock_market_tick 读 headline + price_history 摘要

⑧ generateStockMarketV3AiNewsDraft()       ← 调用 AI
   ├── prompt = 场景描述 + 涨跌因子 + 反转提示 + 叙事轨迹 + 价格快照
   ├── AI 按涨跌方向写新闻（不决定涨跌）
   ├── callConfiguredTextModel()
   ├── parseTechniqueTextModelJsonObject()
   └── validateStockMarketV3AiNewsPayload() ← 校验：headline/summary 长度、impacts 方向与场景一致

⑨ applyGeneratedV3Tick()                   ← 事务写入
   ├── SELECT stock_market_v3_tick FOR UPDATE
   ├── SELECT stock_market_quote FOR UPDATE    ← 仍用 quote 做价格源（单行情源）
   ├── UPDATE stock_market_v3_tick         ← status='generated', 写入场景 ID、新闻、反转、轨迹快照
   ├── UPDATE stock_market_v3_scene_state  ← ticks_elapsed + 1, 若切换则更新 scene_id
   ├── UPDATE stock_market_quote           ← 按场景方向更新价格（AI 只提供叙事内容）
   └── INSERT stock_market_v3_price_history   ← V3 独立 K 线表，不写入 V1 的 price_history

⑩ pendingOrderService.processAllActiveOrders()  ← 撮合挂单（共享）
```

---

## 八、AI Prompt 设计（V3 专属）

```jsonc
{
  "tickHour": "2026-06-03T08:00:00Z",
  "scene": {
    "id": "scene-peace",
    "name": "和平岁月",
    "description": "南北停战协议签署后第三年，北州商路恢复畅通，各宗门休养生息。但和平表面下暗流涌动——边防松懈、军备废弛、商会势力膨胀。",
    "minTicksRemaining": 3,  // 还剩最少 N tick 才可结束
    "ticksElapsed": 8
  },
  "stockDirections": [
    {
      "stockId": "stock-jianqi-wall",
      "direction": "bearish",
      "strength": 2,
      "reason": "和平时期边防松懈，军功需求下降"
    },
    {
      "stockId": "stock-wuerdaha-trade",
      "direction": "bullish",
      "strength": 2,
      "reason": "商路畅通，汇兑量增长"
    },
    {
      "stockId": "stock-chixiao-sword",
      "direction": "bullish",
      "strength": 1,
      "narrativeTwist": true,
      "twistReason": "和平时期沧雪剑宗意外发现古剑传承，声名大噪，股价逆势上扬"
    }
    // ... 其余 11 只
  ],
  "narrativeTrail": [
    {
      "tickId": "145",
      "hour": "2026-06-02T08:00",
      "headline": "军费拨款延迟，长城粮草告急",
      "summary": "...",
      "impacts": [
        { "stockId": "stock-jianqi-wall", "direction": "down", "changeBps": -240 }
      ]
    }
    // ... 最近 7 条
  ],
  "outputRules": [
    "headline 4~40 字，summary 12~160 字",
    "news 内容必须与 stockDirections 中的方向一致",
    "bearish 股票的 reason 必须解释为什么跌，不能写利好内容",
    "bullish 股票的 reason 必须解释为什么涨，不能写利空内容",
    "标记了 narrativeTwist 的股票是反转叙事，要在新闻中特别写出转折感",
    "参考 narrativeTrail 了解最近的新闻脉络，不要重复使用相同的叙事角度",
    "impacts 的 changeBps 必须与 stockDirections 中的 direction 一致（bullish=正，bearish=负）",
    "strength 1 对应 ±2~4%，strength 2 对应 ±4~6%，strength 3 对应 ±6~8%",
    "neutral 股票不要放入 impacts",
    "不要连续使用 narrativeTrail 中出现过的叙事类型"
  ]
}
```

---

## 九、与 V1 的对比

| | V1 事件驱动 | V3 场景轮换驱动 |
|--|------------|----------------|
| 涨跌决定权 | AI 自由判断 | 场景规则预设 + 反转 |
| 轮换机制 | 权重轮盘赌（可能连续） | 确定轮换，min/max tick 约束，不可连续 |
| AI 自由度 | 高（决定涨跌 + 叙事） | 中（按涨跌方向写叙事，反转增加变数） |
| 叙事连续性 | 差（只看数值趋势） | 好（叙事轨迹提供前因后果） |
| 不可预见性 | 高（但不可控） | 中（反转 + 叙事轨迹提供变数） |
| GM 可控性 | 低 | 高（场景规则可预设、可调整） |

---

## 十、V1/V3 迁移策略

### 10.1 核心原则

**双驱动器完全隔离，不共享任何 K 线数据表。** V1 和 V3 各自拥有独立的 tick、quote、price_history 表。切换时通过行情源路由决定前端和撮合引擎读取哪一套数据。

不需要考虑 K 线数据的连续性。切换驱动器 = 开启一段全新的独立行情历史。

### 10.2 V1 → V3 切换流程

```
① 发布公告，锁定股市操作窗口
   └── 暂停新 tick 生成

② 一键强平所有玩家持仓
   ├── 按买入价返还资金（不产生盈亏）
   ├── 清空所有挂单
   └── 补偿方案：全体发放补偿（额度可配置）

③ 行情源切换
   ├── 更新全局配置：STOCK_MARKET_DRIVER=v3
   ├── 挂单撮合引擎开始读取 stock_market_v3_quote
   ├── 前端 K 线图切换读取 stock_market_v3_price_history
   └── V1 表数据完整保留，不再更新

④ V3 冷启动
   ├── 初始化 stock_market_v3_scene_state
   ├── 首个 tick 生成，K 线从 0 开始
   └── 与 V1 历史数据无任何关联
```

### 10.3 V3 → V1 回切流程

```
① 暂停 V3 tick 生成

② 一键强平所有玩家持仓 + 返还 + 补偿（同 10.2）

③ 行情源回切
   ├── 更新全局配置：STOCK_MARKET_DRIVER=v1
   ├── 挂单撮合引擎恢复读取 stock_market_quote
   ├── 前端 K 线图恢复读取 stock_market_price_history
   └── V3 表数据完整保留，不再更新

④ V1 续接
   ├── 从 V1 最后一个 tick 继续运行
   ├── K 线恢复 V1 走势（V3 期间的行情不会出现在 V1 历史中）
   └── V3 独立行情历史可事后单独查看
```

### 10.4 数据保留与查看

| 数据 | V1 运行期间 | V3 运行期间 |
|------|------------|------------|
| `stock_market_quote` | 实时更新 | 冻结在切换时刻 |
| `stock_market_price_history` | 实时更新 | 冻结在切换时刻 |
| `stock_market_v3_quote` | 未初始化 | 实时更新 |
| `stock_market_v3_price_history` | 不存在 | 实时更新 |
| `stock_market_tick` | 实时更新 | 冻结 |
| `stock_market_v3_tick` | 不存在 | 实时更新 |

切换后，旧数据完整保留，可独立查看历史回放，不影响当前行情。

### 10.5 为什么不做数据合并

- `stock_market_price_history` 的 tick_id 是主键自增，V3 直接写入会冲突
- 外键关联（挂单、交易记录）依赖 tick_id，合并需要全局修改外键
- K 线逻辑不具备连续性（V3 行情是独立生成的，不是 V1 的延续）
- 半兼容方案比完全隔离更复杂、风险更大

**结论：强平清仓 + 数据隔离 + 行情源切换 = 最干净的方案。**

## 十一、文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `server/src/services/stockMarket/stockMarketV3SceneDefinitions.ts` | 场景定义（涨跌因子 + 反转列表） |
| **新增** | `server/src/services/stockMarket/stockMarketV3StateManager.ts` | 场景状态管理（加载、切换、生命周期） |
| **新增** | `server/src/services/stockMarket/stockMarketV3NarrativeTrail.ts` | 叙事轨迹查询与构建 |
| **新增** | `server/src/services/stockMarket/stockMarketV3TwistEngine.ts` | 反转引擎（概率判定 + 反转选取） |
| **新增** | `server/src/services/stockMarket/stockMarketV3Ai.ts` | V3 AI 新闻生成（场景 prompt + 校验） |
| **新增** | `server/src/services/stockMarket/stockMarketV3Service.ts` | V3 驱动器入口 |
| **新增** | `server/src/services/stockMarket/stockMarketDriverConfig.ts` | 开关解析模块（v1/v3） |
| **新增** | `server/prisma/migrations/` | 新表迁移：v3_tick、v3_scene_state、v3_quote、v3_price_history |
| **修改** | `server/src/services/stockMarket/stockMarketScheduler.ts` | 路由增加 v3 |
| **修改** | `server/src/routes/` | 新闻查询 API 增加 v3 路由 |

---

## 十二、实施状态

### 已完成

| 模块 | 文件 | 状态 |
|------|------|------|
| 场景定义 | `stockMarketV3SceneDefinitions.ts` | ✅ 已实装，5 个场景，含校验函数 |
| 场景状态管理 | `stockMarketV3StateManager.ts` | ✅ 已实装，含切换概率 20% |
| 叙事轨迹 | `stockMarketV3NarrativeTrail.ts` | ✅ 已实装，默认 8 条 |
| 反转引擎 | `stockMarketV3TwistEngine.ts` | ✅ 已实装，触发概率 20% |
| AI 新闻生成 | `stockMarketV3Ai.ts` | ✅ 已实装，含方向一致性校验 |
| 驱动器入口 | `stockMarketV3Service.ts` | ✅ 已实装，完整 tick 流程 |
| 开关解析 | `stockMarketDriverConfig.ts` | ✅ 已实装 |
| 数据库迁移 | `prisma/schema.prisma` | ✅ 已添加 v3_tick + v3_scene_state |
| 调度路由 | `stockMarketScheduler.ts` | ✅ 已修改 |
| 新闻 API 路由 | `stockMarketRoutes.ts` | ✅ 已修改 |

### 场景池内容（可按需调整）

| 场景 | ID | 说明 |
|------|-----|------|
| 和平岁月 | scene-peace | 商贸/丹药涨，军事跌 |
| 妖潮入侵 | scene-demon-tide | 军事/炼器涨，商贸跌 |
| 丹方突破 | scene-pill-breakthrough | 丹药/灵草大涨，其余中性 |
| 灵脉发现 | scene-mineral-discovery | 矿材/炼器涨，其余中性 |
| 讲经盛会 | scene-academy-festival | 功法/阵法涨，其余中性 |

每个场景含 2~3 个反转可能，触发概率 20%。
