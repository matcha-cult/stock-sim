# 常驻刮刮乐系统设计

## 一、概述

常驻刮刮乐（puzzle_card）是独立于现有每日刮刮乐（scratch_ticket）的全新玩法系统。

### 与现有系统的隔离

| 维度 | 处理方式 |
|---|---|
| 数据库表 | 仅 `puzzle_card` 一张，与 `scratch_ticket*` 三张表零关联 |
| 配置数据 | 类型配置、奖级配置均为 TypeScript 内存常量，无数据库表 |
| 流水账 | 复用 `spirit_stones_ledger`，新增 `biz_type: puzzle_buy / puzzle_prize`，与 `scratch_buy / scratch_prize` 隔离 |
| 角色关联 | 仅 `character_id` FK |
| 前端模块 | 独立路由/组件 |

### 核心特点

- 无日限制，可随时购买
- 后端生成后直接返回全部信息，无需逐格刮开（无掩码）
- 兑奖需携带安保码（JWT signature），防止重复开奖和伪造

---

## 二、数据库表

### puzzle_card（唯一业务表）

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | BIGSERIAL | PK |
| character_id | INT | FK → characters.id |
| ticket_number | BIGINT | 角色历史第几张（单调递增） |
| type_key | VARCHAR(32) | 内存常量的 key |
| grid_rows | SMALLINT | 购票时快照 |
| grid_cols | SMALLINT | 购票时快照 |
| price_paid | BIGINT | 实际支付票价 |
| ticket_data | JSONB | 格子内容（生成即完整） |
| matched_lines | JSONB | 中奖详情 [{tierKey, tierName, prizeType, prizeAmount}] |
| prize_type | VARCHAR(20) | 奖品类型：spirit_stones / silver |
| prize_amount | BIGINT DEFAULT 0 | 总奖金绝对值（0=未中奖） |
| redeemed_at | TIMESTAMP(6) NULL | NULL=未兑奖 |
| created_at | TIMESTAMP(6) | 购票+开奖时间 |

### 索引与约束

```
唯一约束  (character_id, ticket_number)
索引      (character_id)
          (type_key)
```

### spirit_stones_ledger 新增 biz_type

| biz_type | 触发时机 | biz_id 格式 |
|---|---|---|
| puzzle_buy | 购票扣款 | `puzzle:<puzzle_card.id>` |
| puzzle_prize | 兑奖发奖 | `puzzle:<puzzle_card.id>` |

---

## 三、安保码机制

### JWT 结构

```
Header:  { "alg": "HS256", "typ": "JWT" }

Payload: {
  character_id,
  ticket_number,
  type_key,
  grid_rows,
  grid_cols,
  price_paid,
  ticket_data,
  matched_lines,
  prize_type,
  prize_amount
}

Signature: HMACSHA256(base64url(header) + "." + base64url(payload), JWT_SECRET)
```

**安保码（redeemCode）= JWT 三段式的最后一段（signature）。**

### 三重防护

| 防护 | 机制 |
|---|---|
| 校验合法性 | 服务端重签 JWT，signature 匹配 = 字段未被篡改、来源合法 |
| 防伪造 | 依赖 JWT_SECRET，无密钥无法构造有效 signature |
| 防重复兑奖 | `redeemed_at IS NULL` 原子 UPDATE，行锁串行化并发请求 |

---

## 四、业务流程

### 购票（原子操作）

```
1. 扣灵石
2. 按 type_key 从内存常量取规则
3. 随机生成 ticket_data（格子内容）
4. 立即结算 matched_lines + prize_amount
5. 构建 JWT payload → 取 signature 作为安保码
6. INSERT puzzle_card (redeemed_at = NULL)
7. INSERT ledger (biz_type='puzzle_buy')
8. 返回前端：完整票面 + redeemCode（奖金未入账）
```

### 兑奖（前端携带 { id, redeemCode }）

```
1. SELECT puzzle_card WHERE id = $1 AND redeemed_at IS NULL
   → 未找到 → 失败（票不存在或已兑奖）
2. 用查出的字段重建 JWT payload → 重签 → 比对 signature
   → 不等 → 失败（数据被篡改或 signature 伪造）
3. 原子 UPDATE:
     SET redeemed_at = NOW()
     WHERE id = $1 AND redeemed_at IS NULL
   → affected = 1 → 成功 → 发奖金 + INSERT ledger (biz_type='puzzle_prize')
   → affected = 0 → 失败（并发重复兑奖）
```

---

## 五、内存常量结构

### 通用类型定义

```typescript
// 奖级配置
interface PuzzlePrizeTier {
  tierKey: string;
  tierName: string;
  ruleMatch: Record<string, unknown>;  // 中奖判定条件
  prizeType: 'spirit_stones' | 'silver';
  prizeAmount: bigint;                  // 固定奖金绝对值
}

// 玩法类型配置
interface PuzzleCardType {
  typeKey: string;
  name: string;
  description: string;
  gridRows: number;
  gridCols: number;
  price: bigint;
  ruleType: string;
  prizeTiers: readonly PuzzlePrizeTier[];
}

// 类型注册表
const PUZZLE_CARD_TYPES: Record<string, PuzzleCardType> = { ... };
```

### 结算函数注册表

每种 `ruleType` 对应一个结算纯函数：

```typescript
type SettleFn = (grid: number[]) => {
  matchedLines: Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: bigint }>;
  prizeType: string;
  prizeAmount: bigint;
};

const SETTLE_FNS: Record<string, SettleFn> = { ... };
```

---

## 六、玩法：七喜（QIXI）

### 规则

| 属性 | 值 |
|---|---|
| 玩法名 | 七喜 |
| type_key | `QIXI` |
| 格子 | 4 格（2×2 网格） |
| 每格数字 | 1~6（等概率随机） |
| 票价 | 50,000 灵石 |
| 中奖条件 | 4 格数字之和 = 7 |
| 奖级判定 | 按第 1 格（左上角，阅读顺序）的值分档 |

### 奖级配置

| 奖级 | tierKey | 首格值 | 奖金 | 排列数 | 概率（和=7 时） | 无条件概率 |
|---|---|---|---|---|---|---|
| 一等奖 | first | 1 | 100,000,000（1亿） | 10 | 50% | 10/1296 ≈ 0.77% |
| 特等奖 | grand | 2 | 5,000,000（500万） | 6 | 30% | 6/1296 ≈ 0.46% |
| 二等奖 | second | 3 | 1,000,000（100万） | 3 | 15% | 3/1296 ≈ 0.23% |
| 三等奖 | third | 4 | 50,000（5万） | 1 | 5% | 1/1296 ≈ 0.08% |

> 和为 7 的全部组合：(1,1,1,4)×4 + (1,1,2,3)×12 + (1,2,2,2)×4 = 20 种；总样本 6⁴ = 1296。

### 内存常量

```typescript
const QIXI_PRIZE_TIERS = [
  { tierKey: 'first',  tierName: '一等奖', firstCellValue: 1, prizeType: 'spirit_stones', prizeAmount: 100_000_000n },
  { tierKey: 'grand',  tierName: '特等奖', firstCellValue: 2, prizeType: 'spirit_stones', prizeAmount: 5_000_000n },
  { tierKey: 'second', tierName: '二等奖', firstCellValue: 3, prizeType: 'spirit_stones', prizeAmount: 1_000_000n },
  { tierKey: 'third',  tierName: '三等奖', firstCellValue: 4, prizeType: 'spirit_stones', prizeAmount: 50_000n },
] as const;

const QIXI_CONFIG = {
  typeKey: 'QIXI',
  name: '七喜',
  description: '4格各填1~6，四数之和为7即中奖，按首格数字分档兑奖',
  gridRows: 2,
  gridCols: 2,
  price: 50_000n,
  ruleType: 'SUM_MATCH',
  prizeTiers: QIXI_PRIZE_TIERS,
} as const;
```

### 结算算法

```typescript
function settleQixi(grid: number[]) {
  const sum = grid.reduce((a, b) => a + b, 0);
  if (sum !== 7) {
    return { matchedLines: [], prizeType: 'spirit_stones', prizeAmount: 0n };
  }
  const firstVal = grid[0];
  const tier = QIXI_PRIZE_TIERS.find(t => t.firstCellValue === firstVal);
  if (!tier) {
    return { matchedLines: [], prizeType: 'spirit_stones', prizeAmount: 0n };
  }
  return {
    matchedLines: [{ tierKey: tier.tierKey, tierName: tier.tierName, prizeType: tier.prizeType, prizeAmount: tier.prizeAmount }],
    prizeType: tier.prizeType,
    prizeAmount: tier.prizeAmount,
  };
}
```

### 期望值分析

```
总中奖概率 = 20/1296 ≈ 1.54%

E[奖金] = (10/1296)×1亿 + (6/1296)×500万 + (3/1296)×100万 + (1/1296)×5万
        ≈ 771,605 + 23,148 + 2,315 + 39
        ≈ 797,107 灵石

票价 = 50,000 灵石
返还率 ≈ 1594%
```

> 奖金与票价为现实玩法等比放大 10000 倍，返还率与原始玩法一致，数字符合预期。

---

## 七、前端设计

### 1. 顶层 Tab 变更

`StockMarketPage.tsx` 主 Tabs：

| 变更 | key | label 变更 |
|---|---|---|
| 现有 | `scratch` | `刮刮乐` → `每日刮刮乐` |
| 新增 | `puzzle-card` | `无限刮刮乐` |

新 tab 渲染 `<PuzzleCardPage />`。

### 2. 无限刮刮乐页面结构

```
┌──────────────────────────────────────────┐
│ [刮奖]  [兑奖历史]    ← antd Tabs (二级) │
├──────────────────────────────────────────┤
│          当前 sub-tab 内容                │
└──────────────────────────────────────────┘
```

### 3. 「刮奖」sub-tab

**两种视图**，按状态切换：

| 状态 | 视图 | 触发条件 |
|---|---|---|
| 无活跃票据 | 票种选择列表 | 初始 / 兑奖完成后 |
| 有活跃票据 | 票据交互区 | 购票成功后 |

#### 3.1 票种选择列表

```
┌──────────────────────────────────────────┐
│  antd Row gutter={[12, 12]}              │
│                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 🎯 七喜   │ │ 🎰 ???   │ │ 🎲 ???   │ │
│  │ 50,000   │ │ 100,000  │ │ 200,000  │ │
│  │ 2×2 格子  │ │ 3×3 格子  │ │ 4×4 格子  │ │
│  │ 和为7兑奖 │ │ ???      │ │ ???      │ │
│  │ [购买]   │ │ [购买]   │ │ [购买]   │ │
│  └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ ???      │ │ ???      │ │ ???      │ │
│  │ ...      │ │ ...      │ │ ...      │ │
│  └──────────┘ └──────────┘ └──────────┘ │
└──────────────────────────────────────────┘
```

- **antd 组件**：`Row` + `Col`（PC: span=8 三列，Mobile: span=24 单列）、`Card` + `Card.Meta`
- 每张卡片：
  - 标题：`name`
  - 票价：`Typography.Text strong`
  - 规格：`Tag` 展示格子数（如 `2×2`）
  - 简述：`Typography.Paragraph type="secondary"`
  - 操作：`Button type="primary" block`
- 6 种票种，预留 5 个坑位（数据从内存常量 `PUZZLE_CARD_TYPES` 读取）

#### 3.2 票据交互区

**阶段 A：刮奖中**

```
┌──────────────────────────────────────────┐
│  Card                                    │
│  Flex justify="space-between"            │
│  七喜    票价 50,000    [规则 ?]          │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │         2×2 Grid                 │    │
│  │   ┌─────┐  ┌─────┐              │    │
│  │   │  ?  │  │  ?  │  点击翻开     │    │
│  │   └─────┘  └─────┘              │    │
│  │   ┌─────┐  ┌─────┐              │    │
│  │   │  ?  │  │  ?  │              │    │
│  │   └─────┘  └─────┘              │    │
│  │   当前和值：—                    │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Flex gap=12 justify="center"            │
│  [ 全部刮开 ]    [ 直接兑奖 ]             │
└──────────────────────────────────────────┘
```

**阶段 B：全部刮开 / 直接兑奖后**

```
┌──────────────────────────────────────────┐
│  Card                                    │
│  七喜    票价 50,000                      │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │         2×2 Grid（已翻开）        │    │
│  │   ┌─────┐  ┌─────┐              │    │
│  │   │  2  │  │  1  │              │    │
│  │   └─────┘  └─────┘              │    │
│  │   ┌─────┐  ┌─────┐              │    │
│  │   │  3  │  │  1  │              │    │
│  │   └─────┘  └─────┘              │    │
│  │   和值：7 ✓                      │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Alert type="success"                    │
│  🎉 恭喜中奖！一等奖 — 100,000,000 灵石  │
│                                          │
│  Flex justify="center"                   │
│  [     兑  奖     ]                      │
└──────────────────────────────────────────┘
```

未中奖时：`Alert type="info"`，不显示兑奖按钮，仅显示 `[继续刮奖]` 返回选择列表。

**阶段 C：兑奖完成后**

```
┌──────────────────────────────────────────┐
│  Result status="success"                 │
│  兑奖成功                                │
│  +100,000,000 灵石已到账                 │
│  [ 继续刮奖 ]                            │
└──────────────────────────────────────────┘
```

#### 3.3 格子交互

| 操作 | 行为 |
|---|---|
| 点击未翻开格子 | 翻开动画 → 显示数字 → 更新当前和值 |
| "全部刮开"按钮 | 依次翻开所有剩余格子（带延时动画） |
| "直接兑奖"按钮 | 跳过刮开，直接调兑奖 API |

- 格子状态：`未翻开`（灰色）→ `已翻开`（显示数字）
- 翻开动画：CSS `transform: rotateY(180deg)` 翻转
- 和值实时更新

### 4. 「兑奖历史」sub-tab

```
┌──────────────────────────────────────────┐
│  Flex justify="space-between"            │
│  我的票据           筛选: [全部 ▼]       │
│                                          │
│  PC: antd Table                          │
│  ┌──────────────────────────────────┐    │
│  │ 票种 | 购买时间 | 票号 | 奖金 | 操作│   │
│  │ 七喜 | 07-01 14:30 | #42 | 1亿 | [兑奖]│
│  │ 七喜 | 07-01 13:20 | #41 | 0   | —    │
│  │ 七喜 | 07-01 12:00 | #40 | 500万 | [已兑]│
│  └──────────────────────────────────┘    │
│                                          │
│  Mobile: antd List + Card                │
│  ┌──────────────────────────────────┐    │
│  │ Card: 七喜 #42    Tag: 待兑奖    │    │
│  │ 购买: 07-01 14:30  奖金: 1亿     │    │
│  │                      [ 兑奖 ]    │    │
│  ├──────────────────────────────────┤    │
│  │ Card: 七喜 #41    Tag: 未中奖    │    │
│  │ 购买: 07-01 13:20  奖金: 0      │    │
│  ├──────────────────────────────────┤    │
│  │ Card: 七喜 #40    Tag: 已兑奖    │    │
│  │ 购买: 07-01 12:00  奖金: 500万  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Pagination                              │
└──────────────────────────────────────────┘
```

| 状态 | Tag 颜色 | 操作列 |
|---|---|---|
| 未兑奖 + 中奖 | `gold` | `[兑奖]` 按钮 |
| 未兑奖 + 未中奖 | `default` | 无 |
| 已兑奖 | `green` | "已兑奖"文本 |

### 5. 文件结构

```
new-client/src/
├── components/
│   ├── StockMarketPage.tsx             # 修改：tab label + 新增 puzzle-card tab
│   └── PuzzleCard/
│       ├── index.tsx                   # 根组件，二级 Tabs
│       ├── TicketSelect.tsx            # 票种选择列表
│       ├── TicketGame.tsx              # 票据交互区（刮奖 + 兑奖）
│       ├── ScratchGrid.tsx             # 格子网格组件（翻开动画）
│       └── RedeemHistory.tsx           # 兑奖历史列表
├── hooks/
│   └── usePuzzleCard.ts               # 状态管理 hook
├── services/api/
│   └── puzzleCard.ts                  # API 接口封装
└── types/
    └── puzzleCard.ts                  # 类型定义
```

### 6. 状态管理（usePuzzleCard hook）

```typescript
interface PuzzleCardState {
  types: PuzzleCardType[];              // 内存常量
  activeTicket: PurchasedTicket | null; // 当前活跃票据
  revealedCells: number[];              // 已翻开格子索引
  history: TicketRecord[];              // 兑奖历史
  historyPage: number;
  historyTotal: number;
  purchasing: boolean;
  redeeming: boolean;
  loadingHistory: boolean;
}

interface PuzzleCardActions {
  purchase: (typeKey: string) => Promise<void>;
  revealCell: (index: number) => void;
  revealAll: () => void;
  redeem: () => Promise<void>;
  skipToSelect: () => void;
  loadHistory: (page: number) => Promise<void>;
  redeemFromHistory: (ticketId: number, redeemCode: string) => Promise<void>;
}
```

### 7. API 接口

```typescript
purchaseTicket(typeKey: string): Promise<ApiPayload<PurchasedTicket>>
redeemTicket(ticketId: number, redeemCode: string): Promise<ApiPayload<RedeemedTicket>>
getRedeemHistory(page: number, pageSize: number): Promise<ApiPayload<{ items: TicketRecord[], total: number }>>
getActiveTicket(): Promise<ApiPayload<PurchasedTicket | null>>
```

### 8. PurchasedTicket 响应结构

```typescript
interface PurchasedTicket {
  id: number;
  typeKey: string;
  name: string;
  gridRows: number;
  gridCols: number;
  ticketData: { grid: number[] };
  matchedLines: MatchedLine[];
  prizeType: string;
  prizeAmount: number;
  redeemCode: string;                   // 安保码
  pricePaid: number;
  createdAt: number;                    // Unix 秒
}
```

### 9. 主题适配

| 元素 | 适配方式 |
|---|---|
| 卡片背景/边框 | antd `Card` 自带主题色 |
| 格子未翻开 | `theme.token.colorFillSecondary` |
| 格子已翻开 | `theme.token.colorBgContainer` + 边框 |
| 中奖提示 | antd `Alert type="success"` |
| 未中奖提示 | antd `Alert type="info"` |
| 奖金数字 | `theme.token.colorTextHeading` |

禁止 inline style 硬编码颜色，统一走 antd token。

### 10. 移动端适配

| 场景 | PC（≥768px） | Mobile（<768px） |
|---|---|---|
| 票种列表 | `Col span=8`（3 列） | `Col span=24`（1 列） |
| 格子网格 | 格子 64×64 | 格子 48×48 |
| 兑奖历史 | `Table` | `List` + `Card` |
| 操作按钮 | `Space` 横排 | `Flex vertical` 竖排 |

通过 `useIsMobile()` hook 切换，断点 768px。
