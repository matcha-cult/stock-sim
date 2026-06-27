# 刮刮乐彩票系统

> **状态**：**已实现**（2026-06-07）
>
> **一阶段**：基础刮票机制（3 张独立票 + 顺序刮 + 动态格子数 + 开奖标记）
>
> **二阶段**：种子数据驱动开奖（可配置奖池、奖金、格子规格、选线结算）

---

## 一、设计目标

### 1.1 核心规则

- 玩家每天固定获得 **3 张独立彩票**（`ticket_number = 1/2/3`）
- **票号固定对应规格**：
  - 第 1 张 → **3×3**（九宫格，8 条线可选）
  - 第 2 张 → **4×4**（十六格，10 条线可选）
  - 第 3 张 → **5×5**（二十五格，12 条线可选）
- **按顺序结算**：当前票开奖结算完成后，自动切换到下一张
- 每张票有 **最大可刮数**（`max_scratch_count`），等于格子边长 N（3/4/5）
- **必须刮满才能开奖**：刮到 maxScratchCount 后才能选线开奖
- 每张票 **必须选线** 才能开奖，选线后点击"开奖"按钮，后端结算完成这张票才算刮完

### 1.2 选线结算

- 提交时玩家需要 **选择一条线**（line），可选线共 **2N + 2 条**：
  - 横向 N 条（第 0 行 ~ 第 N-1 行）
  - 纵向 N 条（第 0 列 ~ 第 N-1 列）
  - 对角线 2 条（左上→右下、右上→左下）
- 以该线上所有格子的值 **求和**，查奖金映射表，发放对应奖金
- 每张票独立选线、独立结算

#### 3×3 可选线示意

```
横向 3 条（row0/row1/row2）+ 纵向 3 条（col0/col1/col2）+ 对角线 2 条 = 共 8 条

  row0:  [0][1][2]        ───
  row1:  [3][4][5]              ───
  row2:  [6][7][8]                    ───

  col0:  [0][3][6]   col1: [1][4][7]   col2: [2][5][8]
         │                  │                  │
         │                  │                  │
         │                  │                  │

  diag0: [0][4][8]  对角线 ↘
  diag1: [2][4][6]  对角线 ↙
```

#### 4×4 可选线示意

```
横向 4 条 + 纵向 4 条 + 对角线 2 条 = 共 10 条

  row0:  [0][1][2][3]     ─────
  row1:  [4][5][6][7]            ─────
  row2:  [8][9][10][11]                 ─────
  row3:  [12][13][14][15]                    ─────

  col0~col3: 各 4 个纵向格子
  diag0: [0][5][10][15]   diag1: [3][6][9][12]
```

#### 5×5 可选线示意

```
横向 5 条 + 纵向 5 条 + 对角线 2 条 = 共 12 条

  diag0: [0][6][12][18][24]   diag1: [4][8][12][16][20]
```

### 1.3 防作弊

- 格子数值（`grid_values`）由服务端预生成，**不返回完整答案**
- 刮格子时，后端只返回被刮格子的值（`cellValue`）
- 使用 `SELECT ... FOR UPDATE` 行锁，防止并发双刮

### 1.4 种子数据驱动

- 每种规格（3×3、4×4、5×5）的格子数、最大/最小刮数、奖金映射表由 **种子数据** 定义
- 种子是 JSON 配置文件，支持热更新
- **票号与规格绑定**：ticket_number=1 对应 3×3、=2 对应 4×4、=3 对应 5×5，每天固定
- 每种规格 6 个奖级：
  - **特等奖** = 最小和（唯一值，如 3×3 的 6 = 1+2+3）
  - **一等奖** = 最大和（唯一值，如 3×3 的 24 = 7+8+9）
  - **二等奖~四等奖** = 靠近两端的区间
  - **安慰奖** = 均值附近的区间（概率最高）

---

## 二、数据库设计

### 2.1 `scratch_ticket` 表（二阶段变更）

```sql
CREATE TABLE scratch_ticket (
  id                BIGSERIAL PRIMARY KEY,
  character_id      INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  day               DATE NOT NULL,
  ticket_number     SMALLINT NOT NULL,
  config_key        VARCHAR(64) NOT NULL,           -- 关联种子配置键
  grid_size         SMALLINT NOT NULL,              -- 格子总数（9/16/25）
  grid_values       JSONB NOT NULL,                 -- 格子数值数组 [0..gridSize-1]
  scratched_mask    INT NOT NULL DEFAULT 0,         -- 位标记
  scratch_count     INT NOT NULL DEFAULT 0,         -- 该票已刮格子数
  max_scratch_count SMALLINT NOT NULL,              -- 该票最大可刮数
  status            VARCHAR(20) NOT NULL DEFAULT 'active',  -- 状态（新规则下仅有 active，可删除）
  settled           BOOLEAN NOT NULL DEFAULT FALSE,        -- 是否已开奖（核心状态字段）
  selected_line     VARCHAR(32),                    -- 选中的线（如 "row_0", "col_2", "diag_0"）
  line_sum          INT,                            -- 选中线的和值
  prize_tier        VARCHAR(32),                    -- 中奖等级键
  prize_amount      BIGINT,                         -- 该票奖金
  created_at        TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_scratch_character_day_ticket
  ON scratch_ticket(character_id, day, ticket_number);
CREATE INDEX idx_scratch_character_day ON scratch_ticket(character_id, day);
CREATE INDEX idx_scratch_character_status ON scratch_ticket(character_id, status);
CREATE INDEX idx_scratch_day_status ON scratch_ticket(day, status);
CREATE INDEX idx_scratch_settled ON scratch_ticket(character_id, day, settled);
```

### 2.2 `scratch_ticket_config` 表（二阶段新增）

种子数据加载到此表，运行时查询。

```sql
CREATE TABLE scratch_ticket_config (
  id                BIGSERIAL PRIMARY KEY,
  config_key        VARCHAR(64) NOT NULL UNIQUE,   -- 配置键，固定 "3x3"、"4x4"、"5x5"
  ticket_number     SMALLINT NOT NULL UNIQUE,      -- 绑定票号：1/2/3（1→3x3, 2→4x4, 3→5x5）
  grid_size         SMALLINT NOT NULL,             -- 格子总数（9/16/25）
  max_scratch_count SMALLINT NOT NULL,             -- 最大可刮数
  min_visible_count SMALLINT NOT NULL,             -- 最小可见数（可提交的下限）
  description       VARCHAR(200),                  -- 描述
  created_at        TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP(6) NOT NULL DEFAULT NOW()
);
```

### 2.3 `scratch_prize_tier` 表（二阶段新增）

奖金映射表，按 config 关联。和值区间基于 **选中线上的格子数**（而非总格子数）。

```sql
CREATE TABLE scratch_prize_tier (
  id              BIGSERIAL PRIMARY KEY,
  config_id       BIGINT NOT NULL REFERENCES scratch_ticket_config(id) ON DELETE CASCADE,
  tier_key        VARCHAR(32) NOT NULL,          -- 等级键：grand/special/first/second/third/consolation
  tier_name       VARCHAR(50) NOT NULL,          -- 显示名：特等奖/一等奖/二等奖...
  sum_min         INT NOT NULL,                  -- 线和值下限（含）
  sum_max         INT NOT NULL,                  -- 线和值上限（含）
  prize_type      VARCHAR(20) NOT NULL DEFAULT 'spirit_stones',
  prize_amount    BIGINT NOT NULL,               -- 奖金金额
  sort_order      SMALLINT NOT NULL DEFAULT 0,   -- 排序（0=最高奖）
  created_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(config_id, tier_key),
  CHECK(sum_min <= sum_max)
);

CREATE INDEX idx_prize_tier_config ON scratch_prize_tier(config_id);
```

### 2.4 字段说明

| 字段 | 表 | 说明 |
|------|------|------|
| `config_key` | scratch_ticket | 关联种子配置，固定为 "3x3"/"4x4"/"5x5" |
| `ticket_number` | scratch_ticket + config | 票号 1/2/3，与规格一一绑定 |
| `max_scratch_count` | scratch_ticket + config | 最大可刮数，必须刮满才能开奖 |
| `min_visible_count` | config | 最小可见数，等于 maxScratchCount（必须刮满） |
| `selected_line` | scratch_ticket | 玩家选中的线，格式 `row_N`/`col_N`/`diag_N` |
| `line_sum` | scratch_ticket | 选中线上所有格子的和值 |
| `prize_tier` | scratch_ticket | 中奖等级键，如 "grand"、"first" |
| `prize_amount` | scratch_ticket | 该票奖金（灵石） |

### 2.5 线和值概率特性

**格子值是不重复排列**：每张票的 `grid_values` 是 `[1, 2, ..., gridSize]` 的随机排列（无重复），不是 0-9 可重复随机。

一条线固定 N 个格子，线和范围：

| 规格（票号） | 格子值范围 | 线上格子数 | 线和范围 | 线和均值 | 说明 |
|------|---------|-----------|---------|---------|------|
| 3×3（第 1 张） | 1~9（不重复） | 3 | **6~24** | 15 | 最小 1+2+3=6，最大 7+8+9=24 |
| 4×4（第 2 张） | 1~16（不重复） | 4 | **10~58** | 34 | 最小 1+2+3+4=10，最大 13+14+15+16=58 |
| 5×5（第 3 张） | 1~25（不重复） | 5 | **15~115** | 65 | 最小 1+2+3+4+5=15，最大 21+22+23+24+25=115 |

- **最小和**（唯一组合）：概率极低，对应 **特等奖**
- **最大和**（唯一组合）：概率极低，对应 **一等奖**
- **靠近两端的区间**：概率低，对应 **二~四等奖**
- **均值附近**：概率最高，对应 **安慰奖**

### 2.6 Prisma Schema（变更部分）

```prisma
model scratch_ticket {
  id                BigInt   @id @default(autoincrement())
  character_id      Int
  day               DateTime @db.Date
  ticket_number     Int      @db.SmallInt
  config_key        String   @db.VarChar(64)
  grid_size         Int      @db.SmallInt
  grid_values       Json     @db.JsonB
  scratched_mask    Int      @default(0)
  scratch_count     Int      @default(0)
  max_scratch_count Int      @db.SmallInt
  status            String   @default("active") @db.VarChar(20)  // 新规则下仅有 active，可删除
  settled           Boolean  @default(false)  // 是否已开奖（核心状态字段）
  selected_line     String?  @db.VarChar(32)
  line_sum          Int?
  prize_tier        String?  @db.VarChar(32)
  prize_amount      BigInt?
  created_at        DateTime @default(now()) @db.Timestamp(6)
  updated_at        DateTime @updatedAt @db.Timestamp(6)

  character         characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@unique([character_id, day, ticket_number], map: "uq_scratch_character_day_ticket")
  @@index([character_id, day], map: "idx_scratch_character_day")
  @@index([character_id, status], map: "idx_scratch_character_status")
  @@index([day, status], map: "idx_scratch_day_status")
  @@index([character_id, day, settled], map: "idx_scratch_settled")
}

model scratch_ticket_config {
  id                BigInt   @id @default(autoincrement())
  config_key        String   @unique @db.VarChar(64)
  ticket_number     Int      @unique @db.SmallInt
  grid_size         Int      @db.SmallInt
  max_scratch_count Int      @db.SmallInt
  min_visible_count Int      @db.SmallInt
  description       String?  @db.VarChar(200)
  created_at        DateTime @default(now()) @db.Timestamp(6)
  updated_at        DateTime @updatedAt @db.Timestamp(6)

  prize_tiers       scratch_prize_tier[]
}

model scratch_prize_tier {
  id           BigInt   @id @default(autoincrement())
  config_id    BigInt
  tier_key     String   @db.VarChar(32)
  tier_name    String   @db.VarChar(50)
  sum_min      Int
  sum_max      Int
  prize_type   String   @default("spirit_stones") @db.VarChar(20)
  prize_amount BigInt
  sort_order   Int      @default(0) @db.SmallInt
  created_at   DateTime @default(now()) @db.Timestamp(6)

  config       scratch_ticket_config @relation(fields: [config_id], references: [id], onDelete: Cascade)

  @@unique([config_id, tier_key])
  @@index([config_id])
}
```

---

## 三、种子数据设计

### 3.1 种子文件位置

```
server/src/seeds/scratchGameConfig.json
```

### 3.2 种子结构

```typescript
interface ScratchGameSeed {
  configs: {
    configKey: string;       // 固定 "3x3", "4x4", "5x5"
    ticketNumber: number;    // 绑定票号：1/2/3
    gridSize: number;        // 9, 16, 25
    maxScratchCount: number; // 最大可刮数（必须刮满才能开奖）
    minVisibleCount: number; // 最小可见数，等于 maxScratchCount
    description: string;     // 描述
  }[];

  prizeTiers: {
    configKey: string;       // 关联到 configs.configKey
    tiers: {
      tierKey: string;       // 等级键
      tierName: string;      // 显示名
      sumMin: number;        // 线和值下限（含）
      sumMax: number;        // 线和值上限（含）
      prizeType: string;     // "spirit_stones"
      prizeAmount: number;   // 奖金（灵石）
      sortOrder: number;     // 排序，0=最高奖
    }[];
  }[];
}
```

### 3.3 完整种子数据（3×3 / 4×4 / 5×5）

每种规格 6 个奖级：1 特等奖 + 4 普通奖 + 1 安慰奖。
格子值 = `[1, 2, ..., gridSize]` 的随机排列（不重复）。

```json
{
  "configs": [
    {
      "configKey": "3x3",
      "ticketNumber": 1,
      "gridSize": 9,
      "maxScratchCount": 3,
      "minVisibleCount": 3,
      "description": "九宫格"
    },
    {
      "configKey": "4x4",
      "ticketNumber": 2,
      "gridSize": 16,
      "maxScratchCount": 4,
      "minVisibleCount": 4,
      "description": "十六格"
    },
    {
      "configKey": "5x5",
      "ticketNumber": 3,
      "gridSize": 25,
      "maxScratchCount": 5,
      "minVisibleCount": 5,
      "description": "二十五格"
    }
  ],
  "prizeTiers": [
    {
      "configKey": "3x3",
      "tiers": [
        { "tierKey": "grand",      "tierName": "特等奖", "sumMin": 6,  "sumMax": 6,   "prizeAmount": 50000, "sortOrder": 0 },
        { "tierKey": "regular_1",  "tierName": "一等奖", "sumMin": 24, "sumMax": 24,  "prizeAmount": 20000, "sortOrder": 1 },
        { "tierKey": "regular_2",  "tierName": "二等奖", "sumMin": 7,  "sumMax": 9,   "prizeAmount": 5000,  "sortOrder": 2 },
        { "tierKey": "regular_3",  "tierName": "三等奖", "sumMin": 19, "sumMax": 23,  "prizeAmount": 2000,  "sortOrder": 3 },
        { "tierKey": "regular_4",  "tierName": "四等奖", "sumMin": 10, "sumMax": 13,  "prizeAmount": 500,   "sortOrder": 4 },
        { "tierKey": "consolation","tierName": "安慰奖", "sumMin": 14, "sumMax": 18,  "prizeAmount": 300,   "sortOrder": 5 }
      ]
    },
    {
      "configKey": "4x4",
      "tiers": [
        { "tierKey": "grand",      "tierName": "特等奖", "sumMin": 10, "sumMax": 10,  "prizeAmount": 50000, "sortOrder": 0 },
        { "tierKey": "regular_1",  "tierName": "一等奖", "sumMin": 58, "sumMax": 58,  "prizeAmount": 20000, "sortOrder": 1 },
        { "tierKey": "regular_2",  "tierName": "二等奖", "sumMin": 11, "sumMax": 16,  "prizeAmount": 5000,  "sortOrder": 2 },
        { "tierKey": "regular_3",  "tierName": "三等奖", "sumMin": 45, "sumMax": 57,  "prizeAmount": 2000,  "sortOrder": 3 },
        { "tierKey": "regular_4",  "tierName": "四等奖", "sumMin": 17, "sumMax": 28,  "prizeAmount": 500,   "sortOrder": 4 },
        { "tierKey": "consolation","tierName": "安慰奖", "sumMin": 29, "sumMax": 44,  "prizeAmount": 300,   "sortOrder": 5 }
      ]
    },
    {
      "configKey": "5x5",
      "tiers": [
        { "tierKey": "grand",      "tierName": "特等奖", "sumMin": 15, "sumMax": 15,  "prizeAmount": 50000, "sortOrder": 0 },
        { "tierKey": "regular_1",  "tierName": "一等奖", "sumMin": 115,"sumMax": 115, "prizeAmount": 20000, "sortOrder": 1 },
        { "tierKey": "regular_2",  "tierName": "二等奖", "sumMin": 16, "sumMax": 25,  "prizeAmount": 5000,  "sortOrder": 2 },
        { "tierKey": "regular_3",  "tierName": "三等奖", "sumMin": 86, "sumMax": 114, "prizeAmount": 2000,  "sortOrder": 3 },
        { "tierKey": "regular_4",  "tierName": "四等奖", "sumMin": 26, "sumMax": 45,  "prizeAmount": 500,   "sortOrder": 4 },
        { "tierKey": "consolation","tierName": "安慰奖", "sumMin": 46, "sumMax": 85,  "prizeAmount": 300,   "sortOrder": 5 }
      ]
    }
  ]
}
```

### 3.4 线和值区间与概率（精确值，经脚本验证）

#### 3×3（线和 6~24，均值 15，84 种组合）

| 等级 | 线和范围 | 组合数 | 概率 | 奖金 | 期望贡献 |
|------|---------|--------|------|------|---------|
| 特等奖 | 6（最小和） | 1 | 1.19% | 50000 | 595 |
| 一等奖 | 24（最大和） | 1 | 1.19% | 20000 | 238 |
| 二等奖 | 7-9 | 6 | 7.14% | 5000 | 357 |
| 三等奖 | 19-23 | 15 | 17.86% | 2000 | 357 |
| 四等奖 | 10-13 | 23 | 27.38% | 500 | 137 |
| 安慰奖 | 14-18 | 38 | 45.24% | 300 | 136 |
| **合计** | **6-24** | **84** | **100%** | — | **≈1820/张** |

#### 4×4（线和 10~58，均值 34，1820 种组合）

| 等级 | 线和范围 | 组合数 | 概率 | 奖金 | 期望贡献 |
|------|---------|--------|------|------|---------|
| 特等奖 | 10 | 1 | 0.055% | 50000 | 27 |
| 一等奖 | 58 | 1 | 0.055% | 20000 | 11 |
| 二等奖 | 11-16 | 26 | 1.43% | 5000 | 71 |
| 三等奖 | 45-57 | 192 | 10.55% | 2000 | 211 |
| 四等奖 | 17-28 | 447 | 24.56% | 500 | 123 |
| 安慰奖 | 29-44 | 1153 | 63.35% | 300 | 190 |
| **合计** | **10-58** | **1820** | **100%** | — | **≈634/张** |

#### 5×5（线和 15~115，均值 65，53130 种组合）

| 等级 | 线和范围 | 组合数 | 概率 | 奖金 | 期望贡献 |
|------|---------|--------|------|------|---------|
| 特等奖 | 15 | 1 | 0.0019% | 50000 | 1 |
| 一等奖 | 115 | 1 | 0.0019% | 20000 | 0 |
| 二等奖 | 16-25 | 112 | 0.21% | 5000 | 11 |
| 三等奖 | 86-114 | 4489 | 8.45% | 2000 | 169 |
| 四等奖 | 26-45 | 4980 | 9.37% | 500 | 47 |
| 安慰奖 | 46-85 | 43547 | 81.96% | 300 | 246 |
| **合计** | **15-115** | **53130** | **100%** | — | **≈474/张** |

每天 3 张票（3×3 + 4×4 + 5×5），期望支出约 **2928 灵石/天/人**，占初始灵石 10000 的 **29.3%/天**。

> 上述奖金数值可通过种子数据热更新，无需改代码。

---

## 四、线定义与索引映射

### 4.1 格子索引约定

格子按行优先排列，索引从 0 开始：

```
3×3:
  [0][1][2]
  [3][4][5]
  [6][7][8]

4×4:
  [0] [1] [2] [3]
  [4] [5] [6] [7]
  [8] [9] [10][11]
  [12][13][14][15]
```

### 4.2 线的索引计算

对于 N×N 格子（N = sqrt(gridSize)）：

```typescript
interface LineDef {
  key: string;       // "row_0", "col_1", "diag_0", "diag_1"
  name: string;      // "第 1 行", "第 2 列", "主对角线", "副对角线"
  indices: number[]; // 该线包含的格子索引
}

function buildLines(gridSize: number): LineDef[] {
  const N = Math.round(Math.sqrt(gridSize));
  const lines: LineDef[] = [];

  // 横向 N 条
  for (let r = 0; r < N; r++) {
    const indices: number[] = [];
    for (let c = 0; c < N; c++) {
      indices.push(r * N + c);
    }
    lines.push({ key: `row_${r}`, name: `第 ${r + 1} 行`, indices });
  }

  // 纵向 N 条
  for (let c = 0; c < N; c++) {
    const indices: number[] = [];
    for (let r = 0; r < N; r++) {
      indices.push(r * N + c);
    }
    lines.push({ key: `col_${c}`, name: `第 ${c + 1} 列`, indices });
  }

  // 对角线 2 条
  const diag0: number[] = [];
  const diag1: number[] = [];
  for (let i = 0; i < N; i++) {
    diag0.push(i * N + i);          // 主对角线：[0][N+1][2N+2]...
    diag1.push(i * N + (N - 1 - i)); // 副对角线：[N-1][2N-2][3N-3]...
  }
  lines.push({ key: 'diag_0', name: '主对角线 ↘', indices: diag0 });
  lines.push({ key: 'diag_1', name: '副对角线 ↙', indices: diag1 });

  return lines;  // 总共 2N + 2 条
}
```

### 4.3 各规格线数

| 规格（票号） | N | 横向 | 纵向 | 对角线 | 总计 |
|------|---|------|------|--------|------|
| 3×3（第 1 张） | 3 | 3 | 3 | 2 | **8** |
| 4×4（第 2 张） | 4 | 4 | 4 | 2 | **10** |
| 5×5（第 3 张） | 5 | 5 | 5 | 2 | **12** |

---

## 五、种子导入机制

### 5.1 导入入口

```bash
# 导入/刷新刮刮乐配置种子
cd server && pnpm tsx src/seeds/scratchGameConfigSeed.ts
```

### 5.2 导入逻辑

```
读取 scratchGameConfig.json
  │
  ├─ 对每个 config：
  │   ├─ UPSERT scratch_ticket_config（按 config_key 匹配）
  │   └─ 获取 config_id
  │
  ├─ 对每个 prizeTiers 组：
  │   ├─ 找到对应 config_id
  │   ├─ 校验：sumMin/sumMax 是否无缝覆盖 [0, lineLen * cellValueMax]
  │   ├─ DELETE 该 config_id 下所有旧 tier（全量替换）
  │   └─ INSERT 新 tier 列表
  │
  └─ 输出导入结果：N 个配置，M 个奖金等级
```

### 5.3 幂等性与校验

- 以 `config_key` 为唯一键，重复导入时更新而非新增
- 奖金 tier 采用「先删后插」策略，保证与种子文件完全一致
- 导入时校验：
  - `maxScratchCount == minVisibleCount`（必须刮满才能开奖）
  - `maxScratchCount <= gridSize`
  - `maxScratchCount >= N`（至少要能覆盖一条线）
  - `ticketNumber ∈ [1, 2, 3]` 且与 `configKey` 对应（1→3x3, 2→4x4, 3→5x5）
  - 奖金 tier 的 `sumMin/sumMax` 无缝覆盖 `[理论最小和, 理论最大和]`
  - 奖金 tier 数量 = 6（1 特等 + 4 普通 + 1 安慰）
  - `gridSize` 必须是完全平方数，且 `sqrt(gridSize) == ticketNumber + 2`
- 导入操作包裹在事务中，失败时全部回滚

### 5.4 运行时缓存

种子数据在应用启动时加载到内存，避免每次开奖都查数据库：

```typescript
class ScratchPrizeConfigCache {
  private configs = new Map<string, TicketConfig>();
  private prizeTiers = new Map<string, PrizeTier[]>();  // key = configKey

  async loadFromDb(): Promise<void> { ... }
  getConfig(configKey: string): TicketConfig | null { ... }
  lookupPrize(configKey: string, lineSum: number): PrizeTier | null { ... }
  getLines(gridSize: number): LineDef[] { ... }  // 返回 2N+2 条线
}
```

---

## 六、后端架构

### 6.1 文件清单

| 文件 | 说明 |
|------|------|
| `server/prisma/schema.prisma` | model 定义 |
| `server/src/seeds/scratchGameConfig.json` | 种子数据 |
| `server/src/seeds/scratchGameConfigSeed.ts` | 种子导入脚本 |
| `server/src/services/scratchGame/scratchTicketService.ts` | 刮票服务（创建、查询、刮格子） |
| `server/src/services/scratchGame/scratchPrizeService.ts` | 开奖服务（选线、和值计算、奖金发放） |
| `server/src/services/scratchGame/scratchPrizeConfigCache.ts` | 运行时配置缓存 |
| `server/src/services/scratchGame/scratchTicketTypes.ts` | 共享类型定义 |
| `server/src/routes/scratchGameRoutes.ts` | HTTP 路由 |
| `server/src/bootstrap/registerRoutes.ts` | 路由注册 |

### 6.2 公开 API

| 方法 | 签名 | 说明 |
|------|------|------|
| `overview` | `(characterId: number) => OverviewDto` | 检测当天票据，按种子配置生成缺失票，返回票列表（未刮格子为 0） |
| `scratchCell` | `(characterId, ticketNumber, cellIndex) => ScratchResultDto` | 刮一个格子（校验未开奖 + 未刮满） |
| `settle` | `(characterId, ticketNumber, lineKey) => SettleResultDto` | 单张开奖（校验已刮满 + 已选线） |

### 6.3 类型定义

```typescript
interface ScratchTicketDto {
  id: string;
  characterId: number;
  day: string;
  ticketNumber: number;       // 1/2/3
  configKey: string;          // "3x3"/"4x4"/"5x5"
  gridSize: number;           // 格子总数
  scratchCount: number;       // 已刮格子数
  maxScratchCount: number;    // 最大可刮数（必须刮满才能开奖）
  revealedValues: number[];   // 未刮格子为 0，已刮/已开奖为真实值
  settled: boolean;           // 是否已开奖（核心状态）
  selectedLine: string | null;
  lineSum: number | null;
  prizeTier: string | null;
  prizeTierName: string | null;  // 奖级名称（如"特等奖"）
  prizeAmount: number | null;
  createdAt: number;
  updatedAt: number;
}

interface OverviewDto {
  tickets: ScratchTicketDto[];
  settledCount: number;         // 已开奖票数
  totalCount: number;           // 固定 3
  currentTicketNumber: number | null;  // 当前可操作票号（未 settled 的第一张）
  allSettled: boolean;          // 全部已开奖
}

interface ScratchResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  scratchCount: number;
  maxScratchCount: number;
}

interface SettleResultDto {
  settled: boolean;
  prize: number;
  lineSum: number;
  tierKey: string;
  tierName: string;
  nextTicketNumber: number | null;  // 下一张未 settled 票号
}
```

### 6.4 状态流转

新规则下刮格子不改变状态，只有两个状态：

```
active ──→ settled（开奖结算完成）
```

- `active`：票已创建，可刮格子（必须刮满 maxScratchCount 才能开奖）
- `settled`：已开奖，不可再刮格子或改选线

**注意**：必须刮满 maxScratchCount 才能开奖，刮不满则无法提交。

### 6.5 `overview` 流程

```
GET /api/scratch/overview
  │
  ├─ 1. 获取 UTC 日期
  │
  ├─ 2. 查询当天已有票
  │
  ├─ 3. 检查缺失票，按种子配置生成
  │     ├─ ticket_number=1 → config "3x3"（第 1 张，可直接创建）
  │     ├─ ticket_number=2 → config "4x4"（需票 1 settled）
  │     ├─ ticket_number=3 → config "5x5"（需票 2 settled）
  │     └─ 新建票时写入 config_key + max_scratch_count + grid_values（Fisher-Yates 洗牌）
  │
  ├─ 4. 构建 revealedValues
  │     ├─ 未开奖票：已刮格子返回真实值，未刮格子返回 0
  │     └─ 已开奖票：返回完整 grid_values + 兑奖信息
  │
  └─ 5. 返回 OverviewDto
        ├─ tickets: 票列表（含 revealedValues）
        ├─ settledCount: 已开奖票数
        ├─ currentTicketNumber: 当前可操作票号
        └─ allSettled: 是否全部已开奖
```

### 6.6 `scratchCell` 流程

```
POST /api/scratch/scratch { ticketNumber, cellIndex }
  │
  ├─ 1. 参数校验
  │
  ├─ 2. SELECT ... FOR UPDATE 锁定票
  │
  ├─ 3. 校验
  │     ├─ settled == false（未开奖）
  │     ├─ cellIndex < gridSize
  │     ├─ (mask & (1 << cellIndex)) == 0（未刮过）
  │     └─ scratch_count < maxScratchCount（未刮满）
  │
  ├─ 4. 取出 cellValue（不返回 grid_values）
  │
  ├─ 5. UPDATE
  │     ├─ newMask = mask | (1 << cellIndex)
  │     ├─ newCount = count + 1
  │     └─ 刮到 maxScratchCount 后不可再刮，但状态不变
  │
  └─ 6. 返回 ScratchResultDto
        ├─ ticket: ScratchTicketDto（含 revealedValues，前端可直接刷新）
        ├─ cellIndex: 格子索引
        ├─ cellValue: 格子数字
        ├─ scratchCount: newCount
        └─ maxScratchCount: 最大可刮数
```

### 6.7 `settleTicket` 流程（单张结算）

```
POST /api/scratch/settle { ticketNumber: 1, lineKey: "row_0" }
  │
  ├─ 1. SELECT ... FOR UPDATE 锁定该票
  │
  ├─ 2. 校验
  │     ├─ 票存在且属于当前角色
  │     ├─ settled == false（未开奖）
  │     ├─ scratch_count == maxScratchCount（已刮满）
  │     └─ lineKey 存在于 buildLines 结果中
  │
  │  注意：后端以提交的 lineKey 为准计算开奖，不校验 selected_line 字段。
  │  "已选线"是前端 UI 状态，后端不持久化直到开奖时才写入 selected_line。
  │
  ├─ 3. 计算开奖
  │     ├─ 读取 grid_values
  │     ├─ 根据 lineKey 获取线上格子索引
  │     ├─ lineSum = indices.reduce((sum, i) => sum + grid_values[i], 0)
  │     ├─ tier = scratchPrizeConfigCache.lookupPrize(configKey, lineSum)
  │     └─ 记录结果：{ ticketNumber, lineKey, lineName, lineSum, tierKey, tierName, prizeAmount }
  │
  ├─ 4. UPDATE scratch_ticket
  │     SET settled=true, selected_line=$1, line_sum=$2, prize_tier=$3, prize_amount=$4
  │     WHERE id=$5
  │
  ├─ 5. 如果 prizeAmount > 0：
  │     ├─ 更新角色灵石余额：spirit_stones += prizeAmount
  │     └─ 写入灵石流水账：
  │         biz_type='scratch_prize',
  │         memo='刮刮乐开奖：第1张(row_0,和值6,特等奖)'
  │
  └─ 6. 返回 SettleResultDto
        ├─ settled: true
        ├─ prize: prizeAmount
        └─ nextTicketNumber: 下一张未 settled 票号（null 表示全部完成）
```

---

## 七、HTTP 路由

| 方法 | 路径 | 鉴权 | QPS | 说明 |
|------|------|------|-----|------|
| `GET` | `/api/scratch/overview` | `requireCharacter` | 5/s | 检测当天票据，按种子配置生成缺失票，返回票列表（未刮格子为 0） |
| `POST` | `/api/scratch/scratch` | `requireCharacter` | 1/s | 刮一个格子（最多 maxScratchCount 个，必须刮满） |
| `POST` | `/api/scratch/settle` | `requireCharacter` | 1/s | 开奖单张票（需刮满 + 已选线，body: `{ ticketNumber, lineKey }`） |

---

## 八、交互流程（玩家视角）

```
1. 玩家进入刮刮乐页面
   └─ 加载完成 → 显示"第 1 张票"（3×3 九宫格，最大可刮 3 个）
   └─ 外圈标签可选（VerticalRightOutlined / ArrowDownOutlined / VerticalLeftOutlined + ArrowRightOutlined）
   └─ "开奖"按钮 disabled（未刮满）

2. 刮票 + 选线（可同步进行）
   ├─ 刮格子（必须刮满 maxScratchCount 个）
   │   ├─ 点击格子 → 格子变 loading → 后端返回数字 → 格子显示数字
   │   ├─ 进度显示 "Y/maxScratchCount"
   │   └─ 刮满 maxScratchCount 后不可继续刮，提示"已刮满，请选择开奖线"
   └─ 选线（刮票过程中可选）
       ├─ 点击外圈标签（顶部箭头 / 左侧箭头 / 右侧箭头）
       ├─ 选中线上的格子边框变蓝（#1890ff）
       └─ 已选线时，刮满后"开奖"按钮可用

3. 刮满 + 已选线 → 点击"开奖"
   ├─ 后端结算：计算选中线的和值 → 查奖金表 → 发放灵石 → 写入流水
   ├─ 票标记为 settled（已开奖）
   ├─ 显示开奖结果：规格、线、和值、等级、奖金
   └─ 自动切换到下一张票

4. 第 2 张票（4×4，最大可刮 4 个）
   └─ 重复步骤 2-3

5. 第 3 张票（5×5，最大可刮 5 个）
   └─ 重复步骤 2-3

6. 所有票都 settled 后
   ├─ 显示当天总奖金
   └─ 提示"今天的 3 张票已全部开奖完成"

7. 第二天再来
   └─ 新一天，重新获得 3 张新票，重复上述流程
```

### 8.1 关键交互规则

| 规则 | 说明 |
|------|------|
| **必须刮满** | 刮到 maxScratchCount 后才能开奖，不能提前或跳过 |
| **选线刮票中可选** | 刮格子时可选线，但开奖需同时满足刮满+已选线 |
| **maxScratchCount 限制** | 最多只能刮 maxScratchCount 个格子，不能多刮 |
| **顺序结算** | 当前票结算后才切换到下一张 |
| **已开奖不可改** | settled 状态的票不可再刮格子或改选线 |

---

## 九、外圈选线机制

玩家通过点击格子网格外围的标签来选择开奖线，而非弹窗或下拉选择器。

### 9.1 标签布局

整体布局为 `(N+2)列 × (N+1)行`，其中：
- 第 1 列：行号标签（`ArrowRightOutlined` 圆形按钮，32×32）
- 第 2 ~ N+1 列：格子
- 第 N+2 列（右侧操作列）：行标签选中指示（`ArrowLeftOutlined` 圆形按钮，32×32）
- 第 1 行：列标签（↘ + 列箭头 + ↙，圆形按钮，32×32）
- 第 2 ~ N+1 行：格子

**3×3（N=3）：5列 × 4行**

```
 ↘    ↓    ↓    ↓    ↙         ← 第1行：顶部列标签（ArrowDownOutlined rotate={315} | ArrowDownOutlined×N | ArrowDownOutlined rotate={45}）
    ────┬────┬────┬────┬────
 → │ 1  │ 2  │ 3  │    │    ← 第2行：第1行格子 + 右侧操作指示（ArrowRightOutlined 左侧，ArrowLeftOutlined 选中时）
   ├────┼────┼────┼────┤
 → │ 4  │ 5  │ 6  │    │    ← 第3行：第2行格子 + 右侧操作指示
   ├────┼────┼────┼────┤
 → │ 7  │ 8  │ 9  │    │    ← 第4行：第3行格子 + 右侧操作指示
   └────┴────┴────┴────┘
```

- 顶行（第1行）：N+2 个图标 = `ArrowDownOutlined rotate={315}`(↘) | `ArrowDownOutlined` × N(↓) | `ArrowDownOutlined rotate={45}`(↙)
- 左侧（第1列）：N 个 `ArrowRightOutlined`(→)
- 右侧（第N+2列）：N 个操作指示位，选中时显示 `ArrowLeftOutlined`(←)，未选中留空

**4×4（N=4）：6列 × 5行**

- 顶行：6 个图标 = `ArrowDownOutlined rotate={315}` | `ArrowDownOutlined` × 4 | `ArrowDownOutlined rotate={45}`
- 左侧：4 个 `ArrowRightOutlined`
- 右侧：4 个操作指示位（选中时 `ArrowLeftOutlined`，未选中留空）

**5×5（N=5）：7列 × 6行**

- 顶行：7 个图标 = `ArrowDownOutlined rotate={315}` | `ArrowDownOutlined` × 5 | `ArrowDownOutlined rotate={45}`
- 左侧：5 个 `ArrowRightOutlined`
- 右侧：5 个操作指示位（选中时 `ArrowLeftOutlined`，未选中留空）

### 9.2 选线规则

| 规则 | 说明 |
|------|------|
| **刮票过程中可选** | 刮格子时可随时点击外圈标签选线 |
| **视觉反馈** | 选中标签高亮（蓝色圆形实心按钮+白色图标），选中线上的格子边框变蓝 |
| **可更改** | 开奖前可随时点击其他标签更改选线 |
| **开奖条件** | 刮满 maxScratchCount + 已选线，开奖按钮才可用 |

---

## 十、安全设计

### 10.1 防作弊措施

| 措施 | 说明 |
|------|------|
| grid_values 不暴露 | 刮票期间不返回完整 grid_values |
| 选线后服务端计算 | 线和值在服务端计算 |
| 行锁防并发 | `SELECT ... FOR UPDATE` 防止并发双刮/双提交 |
| 位标记防重复 | 数据库层面拦截已刮格子 |
| 奖金配置只读缓存 | 运行时从内存缓存读取 |

### 10.2 经济安全

| 措施 | 说明 |
|------|------|
| 奖金总额可配置 | 通过种子 `prizeAmount` 控制 |
| 流水账可追溯 | `biz_type='scratch_prize'` 便于审计 |
| 事务一致性 | 开奖 + 奖金发放 + 流水写入同一事务 |

---

## 十一、关键边界条件与坑点

### 11.1 已知边界

1. **日期统一 UTC**：`getUtcDay()` 用 `new Date().toISOString().slice(0, 10)`
2. **`updated_at` 显式写入**：raw SQL INSERT 时 `now(), now()`
3. **bitmask 容量**：`INT` 最多 32 位，grid_size > 32 需改 `BIGINT`
4. **必须刮满才能开奖**：scratch_count == maxScratchCount 才能提交开奖
5. **选线必须**：开奖前必须选择一条线
6. **maxScratchCount 限制**：最多只能刮 maxScratchCount 个格子，不能多刮
7. **逐张结算**：当前票开奖后才切换到下一张
8. **奖金 tier 无缝覆盖**：`sumMin/sumMax` 必须覆盖该规格的理论线和值范围
9. **lineKey 合法性校验**：提交时校验 lineKey 是否存在于 buildLines 结果中
10. **事务与流水**：开奖 + 奖金 + 流水同一事务，失败全部回滚
11. **格子值不重复**：`grid_values` 是 `[1..gridSize]` 的 Fisher-Yates 洗牌
12. **maxScratchCount = N**：3×3 刮 3 个 / 4×4 刮 4 个 / 5×5 刮 5 个
13. **已开奖不可改**：settled 状态的票不可再刮格子或改选线

### 11.2 概率说明

- 格子值 = `[1, 2, ..., gridSize]` 的随机排列（Fisher-Yates 洗牌），无重复
- 3×3 线和 6 的概率：C(9,3)=84 种组合中仅 1 种（1+2+3），概率 ≈1.2%
- 特等奖 = 最小和（唯一值）：50000（所有规格统一）
- 一等奖 = 最大和（唯一值）：20000（所有规格统一）
- 二等奖 = 靠近最小和区域：5000
- 三等奖 = 靠近最大和区域：2000
- 四等奖 = 中低区：500
- 安慰奖 = 中高区（概率最高区）：300
- 每天总期望支出约 2928 灵石，占初始灵石 10000 的 29.3%

---

## 十二、文件变更汇总

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `server/src/seeds/scratchGameConfig.json` | 种子数据（规格 + 奖金映射） |
| **新增** | `server/src/seeds/scratchGameConfigSeed.ts` | 种子导入脚本 |
| **新增** | `server/src/services/scratchGame/scratchPrizeService.ts` | 开奖服务 |
| **新增** | `server/src/services/scratchGame/scratchPrizeConfigCache.ts` | 运行时配置缓存 |
| **新增** | `server/src/services/scratchGame/scratchTicketTypes.ts` | 共享类型 |
| **修改** | `server/prisma/schema.prisma` | 新增字段 + 两表 |
| **修改** | `server/src/services/scratchGame/scratchTicketService.ts` | 接入种子配置 + 状态流转 |
| **修改** | `server/src/routes/scratchGameRoutes.ts` | settle 接口变更 |
