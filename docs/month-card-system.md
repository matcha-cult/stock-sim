# 月卡系统

> **一阶段**：GM 发放基础月卡机制（GM 发放 + 每日领取 + 到期自动过期 + 排行展示）
>
> **二阶段**：多档位月卡（周卡/季卡/年卡）+ GM 批量发放 + 特权 Buff

---

## 一、设计目标

### 1.1 核心规则

- 月卡由 **GM 后台发放**（指定角色 + 天数），玩家无法自行购买
- 月卡有效期 **30 天**（默认值，GM 发放时可指定天数）
- 月卡有效期内，玩家每天可领取 **每日奖励**（灵石返还 + 额外收益加成）
- 有效期内重复发放 → **延长有效期**（叠加天数，不覆盖）
- 到期后自动过期，需 GM 再次发放才能续期
- 排行榜中展示月卡激活状态（已有 stub 接口 `getMonthCardActiveMapByCharacterIds`）

### 1.2 每日奖励结构

| 奖励项 | 说明 | 数值 |
|--------|------|------|
| 每日灵石返还 | 每天登录领取 | 500 灵石 |
| 刮刮乐加成 | 刮刮乐奖金 +10% | 结算时乘算 |
| 店铺租金加成 | 店铺租金 +10% | 收租时乘算 |

> 上述数值可通过配置热更新，无需改代码。

### 1.3 经济模型

- 月卡无灵石售价，纯 GM 发放（不可购买）
- 30 天累计返还：500 × 30 = 15000 灵石（GM 发放后的玩家每日产出）
- 额外收益加成（刮刮乐 +10%、租金 +10%）为 GM 赋予的增益效果
- 日均灵石产出期望 ≈ 2928（刮刮乐）+ 租金收入，加成后约增加 300~500/天
- GM 可通过控制发放人数和天数来调节游戏内经济

### 1.4 防刷设计

- 每日奖励 **每个角色每天只能领取一次**，按 UTC 日期判断
- 使用 `SELECT ... FOR UPDATE` 行锁防止并发双领
- 领取记录写入 `month_card_daily_claim` 表，可审计

---

## 二、数据库设计

### 2.1 `month_card_ownership` 表

```sql
CREATE TABLE month_card_ownership (
  id                BIGSERIAL PRIMARY KEY,
  character_id      INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  activated_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMP(6) NOT NULL,              -- 到期时间（UTC）
  status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active/expired/revoked
  total_days_purchased INT NOT NULL DEFAULT 0,          -- 累计发放天数（历史）
  purchase_count    INT NOT NULL DEFAULT 0,             -- 发放次数（GM 操作次数）
  created_at        TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_month_card_character ON month_card_ownership(character_id, status);
CREATE INDEX idx_month_card_expires ON month_card_ownership(expires_at);
CREATE INDEX idx_month_card_character_active
  ON month_card_ownership(character_id, status, expires_at);
```

**说明**：
- 每个角色同一时刻最多一条 `active` 记录（通过代码逻辑保证，非数据库约束）
- 发放时更新 `expires_at`，不创建新记录
- 到期后由定时任务或惰性查询将 `status` 改为 `expired`

### 2.2 `month_card_daily_claim` 表

```sql
CREATE TABLE month_card_daily_claim (
  id                BIGSERIAL PRIMARY KEY,
  character_id      INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  claim_date        DATE NOT NULL,                        -- UTC 日期
  reward_spirit_stones BIGINT NOT NULL,                   -- 当日领取的灵石
  created_at        TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(character_id, claim_date)
);

CREATE INDEX idx_daily_claim_character_date
  ON month_card_daily_claim(character_id, claim_date DESC);
```

**说明**：
- 唯一约束 `(character_id, claim_date)` 防止同一天重复领取
- 每日奖励领取后写入此表

### 2.3 `month_card_config` 表（配置表）

```sql
CREATE TABLE month_card_config (
  id                    BIGSERIAL PRIMARY KEY,
  config_key            VARCHAR(64) NOT NULL UNIQUE,     -- 配置键，固定 "default"
  duration_days         SMALLINT NOT NULL,               -- 有效天数（30）
  daily_reward_spirit_stones BIGINT NOT NULL,            -- 每日灵石返还
  scratch_bonus_bps     SMALLINT NOT NULL DEFAULT 0,     -- 刮刮乐加成（基点，1000=10%）
  shop_rent_bonus_bps   SMALLINT NOT NULL DEFAULT 0,     -- 店铺租金加成（基点）
  description           VARCHAR(200),
  created_at            TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP(6) NOT NULL DEFAULT NOW()
);
```

**说明**：
- 当前只有一档「默认月卡」，配置键固定为 `"default"`
- 二阶段扩展多档位时，新增配置记录即可
- 基点（bps）表示法：1000 = 10%，避免浮点数

### 2.4 Prisma Schema（新增部分）

```prisma
// 月卡持有记录
model month_card_ownership {
  id                    BigInt   @id @default(autoincrement())
  character_id          Int
  activated_at          DateTime @default(now()) @db.Timestamp(6)
  expires_at            DateTime @db.Timestamp(6)
  status                String   @default("active") @db.VarChar(20) -- active/expired/revoked
  total_days_purchased  Int      @default(0)
  purchase_count        Int      @default(0)
  created_at            DateTime @default(now()) @db.Timestamp(6)
  updated_at            DateTime @updatedAt @db.Timestamp(6)

  character             characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@index([character_id, status], map: "idx_month_card_character")
  @@index([expires_at], map: "idx_month_card_expires")
  @@index([character_id, status, expires_at], map: "idx_month_card_character_active")
}

// 月卡每日领取记录
model month_card_daily_claim {
  id                    BigInt   @id @default(autoincrement())
  character_id          Int
  claim_date            DateTime @db.Date
  reward_spirit_stones  BigInt
  created_at            DateTime @default(now()) @db.Timestamp(6)

  character             characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@unique([character_id, claim_date], map: "uq_daily_claim_character_date")
  @@index([character_id, claim_date], map: "idx_daily_claim_character_date")
}

// 月卡配置
model month_card_config {
  id                    BigInt   @id @default(autoincrement())
  config_key            String   @unique @db.VarChar(64)
  duration_days         Int      @db.SmallInt
  daily_reward_spirit_stones BigInt
  scratch_bonus_bps     Int      @default(0) @db.SmallInt
  shop_rent_bonus_bps   Int      @default(0) @db.SmallInt
  description           String?  @db.VarChar(200)
  created_at            DateTime @default(now()) @db.Timestamp(6)
  updated_at            DateTime @updatedAt @db.Timestamp(6)
}
```

### 2.5 `characters` 表变更

无需变更。月卡状态通过关联查询 `month_card_ownership` 获取。

---

## 三、种子数据

### 3.1 种子文件位置

```
server/src/seeds/monthCardConfig.json
```

### 3.2 种子结构

```json
{
  "configs": [
    {
      "configKey": "default",
      "durationDays": 30,
      "dailyRewardSpiritStones": 500,
      "scratchBonusBps": 1000,
      "shopRentBonusBps": 1000,
      "description": "标准月卡"
    }
  ]
}
```

### 3.3 种子导入机制

```bash
# 导入/刷新月卡配置种子
cd server && pnpm tsx src/seeds/monthCardConfigSeed.ts
```

导入逻辑与刮刮乐配置导入一致：
- 以 `config_key` 为唯一键，UPSERT 策略
- 包裹在事务中，失败时全部回滚
- 导入时校验：`durationDays > 0`、`dailyRewardSpiritStones >= 0`

### 3.4 运行时缓存

```typescript
class MonthCardConfigCache {
  private config: MonthCardConfig | null = null;

  async loadFromDb(): Promise<void> { ... }
  getConfig(): MonthCardConfig { ... }
}
```

应用启动时加载，避免每次发放/领取都查数据库。

---

## 四、后端架构

### 4.1 文件清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `server/src/seeds/monthCardConfig.json` | 种子数据 |
| **新增** | `server/src/seeds/monthCardConfigSeed.ts` | 种子导入脚本 |
| **新增** | `server/src/services/monthCard/monthCardService.ts` | 月卡核心服务 |
| **新增** | `server/src/services/monthCard/monthCardConfigCache.ts` | 运行时配置缓存 |
| **新增** | `server/src/services/monthCard/monthCardTypes.ts` | 共享类型 |
| **新增** | `server/src/routes/monthCardRoutes.ts` | 玩家侧 HTTP 路由（查询状态 + 领取） |
| **新增** | `server/src/routes/gmMonthCardRoutes.ts` | GM 侧 HTTP 路由（发放 + 回收） |
| **修改** | `server/src/bootstrap/registerRoutes.ts` | 注册月卡路由 + GM 路由 |
| **修改** | `server/prisma/schema.prisma` | 新增 3 张表 |
| **修改** | `server/src/services/shared/monthCardBenefits.ts` | Stub → 真实实现 |
| **修改** | `server/src/services/ledgerService.ts` | 新增 biz_type |
| **修改** | `server/src/services/scratchGame/scratchTicketService.ts` | 接入刮刮乐加成 |
| **修改** | `server/src/services/shop/shopService.ts` | 接入租金加成 |

### 4.2 公开 API（Service 层）

| 方法 | 签名 | 说明 |
|------|------|------|
| `getMonthCardStatus` | `(characterId: number) => MonthCardStatusDto` | 获取月卡状态（是否激活、到期时间、今日是否已领） |
| `gmGrantMonthCard` | `(characterId: number, days?: number) => GrantResultDto` | GM 发放月卡（指定角色 + 天数，激活/续费） |
| `gmRevokeMonthCard` | `(characterId: number) => RevokeResultDto` | GM 回收月卡（立即失效 + 标记 expired） |
| `claimDailyReward` | `(characterId: number) => ClaimResultDto` | 领取每日奖励 |
| `getMonthCardActiveMapByCharacterIds` | `(characterIds: number[]) => Map<number, boolean>` | 批量查询激活状态（替换 stub） |

### 4.3 类型定义

```typescript
interface MonthCardStatusDto {
  isActive: boolean;           // 月卡是否激活
  expiresAt: number | null;    // 到期时间戳（毫秒），未激活为 null
  daysRemaining: number | null; // 剩余天数，未激活为 null
  todayClaimed: boolean;       // 今日是否已领取
  config: MonthCardConfigDto | null;  // 当前配置
}

interface MonthCardConfigDto {
  configKey: string;
  durationDays: number;
  dailyRewardSpiritStones: number;
  scratchBonusBps: number;
  shopRentBonusBps: number;
  description: string;
}

interface GrantResultDto {
  success: boolean;
  message: string;
  expiresAt: number | null;     // 发放后到期时间
  daysRemaining: number | null;
  isNewGrant: boolean;          // 是否首次发放（true=新发放，false=续期）
}

interface RevokeResultDto {
  success: boolean;
  message: string;
  wasActive: boolean;           // 回收前是否激活
}

interface ClaimResultDto {
  success: boolean;
  message: string;
  rewardSpiritStones: number;   // 本次领取的灵石
  balanceAfter: number;         // 领取后余额
}
```

### 4.4 `gmGrantMonthCard` 流程

```
POST /api/gm/month-card/grant
  │
  ├─ 1. 鉴权：requireGM 中间件（仅 GM 权限可调用）
  │
  ├─ 2. 加载配置（从缓存）
  │     └─ duration = config.durationDays（默认 30 天，GM 可传参覆盖）
  │
  ├─ 3. SELECT character FOR UPDATE
  │
  ├─ 4. 查询当前 active 月卡记录
  │     ├─ 有 active 记录 → 续期（expiresAt += duration 天）
  │     └─ 无 active 记录 → 新发放（insert 新记录）
  │
  ├─ 5. 写入流水
  │     └─ biz_type='gm_grant_month_card'
  │     └─ memo='GM 发放月卡（30天）' / 'GM 续费月卡（+30天）'
  │
  └─ 6. 返回 GrantResultDto
        └─ expiresAt, daysRemaining, isNewGrant
```

**关键逻辑**：
- 续期时 `expiresAt = MAX(now(), 原expiresAt) + duration 天`
  - 如果已过期：从当前时间算起
  - 如果未过期：从原到期时间累加
- 发放后更新 `total_days_purchased` 和 `purchase_count`
- 使用 `SELECT ... FOR UPDATE` 防止并发双发放
- 不扣灵石，不校验余额
- GM 可传 `days` 参数自定义天数，默认取配置的 `durationDays`

### 4.5 `gmRevokeMonthCard` 流程（新增）

```
POST /api/gm/month-card/revoke
  │
  ├─ 1. 鉴权：requireGM 中间件（仅 GM 权限可调用）
  │
  ├─ 2. SELECT character FOR UPDATE
  │
  ├─ 3. 查询当前 active 月卡记录
  │     └─ WHERE character_id = ? AND status = 'active'
  │
  ├─ 4. 无 active 记录 → 直接返回（幂等，不报错）
  │
  ├─ 5. 有 active 记录 → 更新：
  │     ├─ status = 'revoked'
  │     ├─ expires_at = NOW()
  │     └─ updated_at = NOW()
  │
  ├─ 6. 写入流水
  │     └─ biz_type='gm_revoke_month_card'
  │     └─ memo='GM 回收月卡'
  │
  └─ 7. 返回 RevokeResultDto
        └─ wasActive: true
```

**关键逻辑**：
- 无 active 记录时直接返回 `wasActive: false`，保持幂等
- 回收后玩家立即失去所有月卡权益（加成失效、无法领取每日奖励）
- 使用 `SELECT ... FOR UPDATE` 防止并发冲突
- `status` 新增 `'revoked'` 值，与 `'expired'` 区分（便于审计 GM 操作）

### 4.6 `claimDailyReward` 流程

```
POST /api/month-card/claim-daily
  │
  ├─ 1. 加载配置
  │     └─ dailyReward = config.dailyRewardSpiritStones
  │
  ├─ 2. SELECT character FOR UPDATE
  │
  ├─ 3. 校验月卡状态
  │     ├─ 查询 active 记录 WHERE character_id = ? AND status = 'active'
  │     ├─ 校验 expires_at > NOW()
  │     └─ 未激活 → 返回错误
  │
  ├─ 4. 校验今日是否已领取
  │     └─ SELECT FROM month_card_daily_claim
  │          WHERE character_id = ? AND claim_date = TODAY
  │     └─ 已领取 → 返回错误
  │
  ├─ 5. 发放灵石（balance += dailyReward）
  │
  ├─ 6. 写入领取记录
  │     └─ INSERT INTO month_card_daily_claim (character_id, claim_date, reward)
  │
  ├─ 7. 写入流水
  │     └─ biz_type='month_card_daily'
  │     └─ memo='月卡每日领取'
  │
  └─ 8. 返回 ClaimResultDto
```

### 4.7 `getMonthCardActiveMapByCharacterIds` 流程（替换 stub）

```typescript
// server/src/services/shared/monthCardBenefits.ts（真实实现）

export const getMonthCardActiveMapByCharacterIds = async (
  characterIds: number[],
): Promise<Map<number, boolean>> => {
  if (characterIds.length === 0) return new Map();

  const result = await query(
    `SELECT character_id FROM month_card_ownership
     WHERE character_id = ANY($1::int[])
       AND status = 'active'
       AND expires_at > NOW()`,
    [characterIds],
  );

  const activeSet = new Set(result.rows.map(r => Number(r.character_id)));
  const map = new Map<number, boolean>();
  for (const id of characterIds) {
    map.set(id, activeSet.has(id));
  }
  return map;
};
```

**说明**：
- 使用 `ANY($1::int[])` 批量查询，避免 N+1
- 同时校验 `status = 'active'` 和 `expires_at > NOW()`
- 所有输入 ID 都存在于返回 Map 中（未激活的为 false）

### 4.8 到期状态更新策略

采用 **惰性更新**，不依赖定时任务：

- 查询月卡状态时：`expires_at > NOW()` 判断是否有效
- 当检测到 `expires_at <= NOW()` 时：
  - 将 `status` 更新为 `expired`
  - 返回 `isActive: false`

```typescript
// 在 getMonthCardStatus 中
const row = await query(
  `SELECT * FROM month_card_ownership
   WHERE character_id = $1 AND status = 'active'
   LIMIT 1`,
  [characterId],
);

if (row && new Date(row.expires_at) <= new Date()) {
  // 已过期，更新状态
  await query(
    `UPDATE month_card_ownership SET status = 'expired', updated_at = NOW()
     WHERE id = $1`,
    [row.id],
  );
  return { isActive: false, ... };
}
```

### 4.9 刮刮乐加成接入

在 `scratchTicketService.settle` 中：

```typescript
// 结算前查询月卡加成
const monthCardConfig = monthCardConfigCache.getConfig();
const hasMonthCard = await checkMonthCardActive(characterId);
const bonusBps = hasMonthCard ? monthCardConfig.scratchBonusBps : 0;

// 对总奖金应用加成
if (bonusBps > 0) {
  totalPrize = totalPrize + (totalPrize * BigInt(bonusBps)) / 10000n;
}
```

流水备注中体现加成：
```
memo='刮刮乐开奖：总奖金+月卡加成(10%)'
```

### 4.10 店铺租金加成接入

在 `shopService.collectRent` 中：

```typescript
// 收租前查询月卡加成
const monthCardConfig = monthCardConfigCache.getConfig();
const hasMonthCard = await checkMonthCardActive(characterId);
const bonusBps = hasMonthCard ? monthCardConfig.shopRentBonusBps : 0;

// 对租金应用加成
if (bonusBps > 0) {
  rentAmount = rentAmount + (rentAmount * BigInt(bonusBps)) / 10000n;
}
```

---

## 五、HTTP 路由

| 方法 | 路径 | 鉴权 | QPS | 说明 |
|------|------|------|-----|------|
| `GET` | `/api/month-card/status` | `requireCharacter` | 5/s | 获取月卡状态 + 配置 |
| `POST` | `/api/month-card/claim-daily` | `requireCharacter` | 1/s | 领取每日奖励 |
| `POST` | `/api/gm/month-card/grant` | `requireGM` | 1/s | GM 发放/续费月卡（body: `{ characterId, days? }`） |
| `POST` | `/api/gm/month-card/revoke` | `requireGM` | 1/s | GM 回收月卡（body: `{ characterId }`） |

### 5.1 路由文件

```
server/src/routes/monthCardRoutes.ts        ← 玩家侧路由
server/src/routes/gmMonthCardRoutes.ts      ← GM 侧路由
```

### 5.2 路由注册

```typescript
// server/src/bootstrap/registerRoutes.ts
import monthCardRoutes from '../routes/monthCardRoutes.js';
import gmMonthCardRoutes from '../routes/gmMonthCardRoutes.js';
app.use('/api/month-card', monthCardRoutes);
app.use('/api/gm/month-card', gmMonthCardRoutes);
```

---

## 六、前端架构

### 6.1 文件清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `new-client/src/services/api/monthCard.ts` | API 封装 + DTO 类型 |
| **新增** | `new-client/src/stores/MonthCardStore.ts` | MobX Store |
| **新增** | `new-client/src/components/MonthCardModal/index.tsx` | 月卡弹窗组件（对齐 source MonthCardModal） |
| **新增** | `new-client/src/components/MonthCardModal/index.scss` | 月卡样式（对齐 source 项目的 color-mix 主题变量风格） |
| **新增** | `new-client/src/components/MonthCardModal/monthCardDisplay.ts` | 展示规则模块（状态文案、权益图标、角标逻辑，对齐 source） |

### 6.2 API 封装

```typescript
// new-client/src/services/api/monthCard.ts

interface MonthCardStatusDto {
  isActive: boolean;
  expiresAt: number | null;
  daysRemaining: number | null;
  todayClaimed: boolean;
  config: MonthCardConfigDto | null;
}

interface MonthCardConfigDto {
  configKey: string;
  durationDays: number;
  priceSpiritStones: number;
  dailyRewardSpiritStones: number;
  scratchBonusBps: number;
  shopRentBonusBps: number;
  description: string;
}

interface PurchaseResultDto {
  success: boolean;
  message: string;
  expiresAt: number | null;
  daysRemaining: number | null;
  balanceAfter: number;
}

interface ClaimResultDto {
  success: boolean;
  message: string;
  rewardSpiritStones: number;
  balanceAfter: number;
}

/** 获取月卡状态 */
export const getMonthCardStatus = (): Promise<{
  success: boolean; data: MonthCardStatusDto | null; message?: string;
}> => api.get('/api/month-card/status');

/** 领取每日奖励 */
export const claimDailyReward = (): Promise<{
  success: boolean; data: ClaimResultDto | null; message?: string;
}> => api.post('/api/month-card/claim-daily', {});
```

### 6.3 Store 设计

```typescript
// new-client/src/stores/MonthCardStore.ts

class MonthCardStore {
  private readonly dedup = new RequestDedup();

  // 状态
  isActive: boolean = false;
  expiresAt: number | null = null;
  daysRemaining: number | null = null;
  todayClaimed: boolean = false;
  config: MonthCardConfigDto | null = null;

  loading: boolean = false;
  isClaiming: boolean = false;

  async refreshStatus(background = false) { ... }
  async claimDaily(): Promise<{ success: boolean; message: string }> { ... }
  reset(): void { ... }
}
```

**数据流**：
```
组件挂载 → refreshStatus() → GET /api/month-card/status → 更新 observable
用户点击领取 → claimDaily() → POST /api/month-card/claim-daily → 更新 observable
```

### 6.4 组件设计

#### 6.4.1 MonthCardModal 组件

```
MonthCardModal (observer)
  │
  ├─ 头部区域
  │   ├─ 标题："月卡"
  │   ├─ 状态标签：
  │   │   ├─ 未激活 → "未激活"
  │   │   ├─ 已激活 → "剩余 X 天（YYYY-MM-DD 到期）"
  │   │   └─ 已过期 → "已过期"
  │   └─ 刷新按钮
  │
  ├─ 权益展示区域
  │   ├─ 每日领取：500 灵石/天
  │   ├─ 刮刮乐加成：+10%
  │   └─ 店铺租金加成：+10%
  │
  ├─ 操作区域
  │   └─ 今日未领取 + 已激活 → "领取今日奖励（500 灵石）"按钮
  │
  └─ 领取结果提示
      └─ 成功 → toast / 结果弹窗
      └─ 失败 → toast 错误
```

#### 6.4.2 月卡入口放置

建议放置在 `StockMarketPage` 的顶部导航栏或侧边栏，与刮刮乐入口并列。也可在首页放置快捷入口。

### 6.5 视觉样式设计

#### 6.5.1 整体布局（对齐 source 项目 MonthCardModal）

月卡采用 **Modal 弹窗** 形式，结构与 source 项目的 `MonthCardModal` 一致：

```
.monthcard-modal
  .monthcard-shell
    .monthcard-header          ← 标题栏（"修仙月卡"）
    .monthcard-body
      .monthcard-vip-card      ← VIP 卡片（状态展示）
        .monthcard-vip-bg-fx   ← 背景装饰层
        .monthcard-vip-content-wrapper
          .monthcard-vip-header ← 月卡名称
          .monthcard-vip-main   ← 状态值 + 操作按钮
      .monthcard-privileges    ← 权益网格（5 列 / 3 列 / 3 列响应式）
      .monthcard-claim-panel   ← 每日领取区域
```

#### 6.5.2 VIP 卡片样式（复用 source 项目的 color-mix 主题变量）

```scss
/* 月卡 VIP 卡片 —— 使用 color-mix 混合主题变量，
   浅色下淡蓝渐变，深色下深蓝渐变，避免硬编码 rgba。 */
.monthcard-vip-card {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--primary-color) 20%, var(--border-color-soft));
  background:
    linear-gradient(135deg,
      color-mix(in srgb, var(--primary-color) 12%, var(--panel-bg-soft)) 0%,
      color-mix(in srgb, var(--primary-color) 4%, var(--panel-bg)) 100%);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-color) 3%, transparent);

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at top right, color-mix(in srgb, var(--primary-color) 6%, transparent), transparent 40%);
    pointer-events: none;
  }
}

/* 背景装饰层（FX 层）—— 可选的 subtle 粒子/光斑效果 */
.monthcard-vip-bg-fx {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle 2px at 20% 30%, color-mix(in srgb, var(--primary-color) 8%, transparent), transparent),
    radial-gradient(circle 1px at 60% 70%, color-mix(in srgb, var(--primary-color) 5%, transparent), transparent),
    radial-gradient(circle 1.5px at 80% 20%, color-mix(in srgb, var(--primary-color) 6%, transparent), transparent);
  opacity: 0.6;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
```

#### 6.5.3 状态样式（对齐 source 的 buildMonthCardPanelState）

状态文案统一由 `buildMonthCardPanelState` 纯函数输出，不做组件内硬编码：

| 状态 | statusValue | statusHint |
|------|-------------|------------|
| 未激活 | "未激活" | "月卡仅由 GM 发放" |
| 已激活 | "剩余 X 天" | "到期时间：YYYY-MM-DD HH:mm" |
| 已到期 | "已到期" | "月卡仅由 GM 发放，可联系 GM 续期" |

#### 6.5.4 响应式断点（对齐 source 项目）

| 断点 | 行为 |
|------|------|
| `max-height: 920px` | 压缩 padding / gap / 图标尺寸 |
| `max-width: 900px` | 权益网格改为 3 列，隐藏描述文案 |
| `max-width: 768px` | 全面压缩字号 / 间距，按钮缩小 |
| `max-width: 768px` + `max-height: 780px` | 极限压缩小屏场景 |

#### 6.5.5 过渡动画（对齐 source 项目风格）

source 项目不使用 `@keyframes` 呼吸光晕，只使用 **transition** 微交互：

```scss
/* 领取按钮 loading 态 */
.monthcard-claim-action .ant-btn {
  transition: opacity 0.18s ease, visibility 0.18s ease;
}

/* 权益图标 hover */
.monthcard-privilege-icon {
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.05);
  }
}
```

#### 6.5.6 待领取角标（对齐 source 的 buildMonthCardIndicator）

月卡入口处的角标逻辑复用 source 项目的 `buildMonthCardIndicator`：

```typescript
export const buildMonthCardIndicator = (
  input: { active: boolean; canClaim: boolean },
): { badgeDot: boolean; tooltip?: string } => {
  if (!input.active || !input.canClaim) {
    return { badgeDot: false };
  }
  return { badgeDot: true, tooltip: '今日月卡奖励待领取' };
};
```

- 仅使用 `Badge dot` 红点，不使用数字角标
- tooltip 提示"今日月卡奖励待领取"
- 使用 `transition: opacity 0.18s ease` 控制显隐

#### 6.5.7 排行榜月卡标识

排行榜中已激活月卡的角色，昵称旁显示月卡图标：

```
排名  玩家              灵石
1     张三 🌕月卡      99,800
2     李四             88,500
3     王五 🌗月卡      77,200
```

- 剩余天数 > 15 天 → 金色月亮图标
- 剩余天数 ≤ 15 天 → 银色月亮图标
- 使用 `transition: opacity 0.18s ease` 控制显示，不引入动画

#### 6.5.8 性能约束

- 所有交互使用 CSS `transition`，不使用 `@keyframes` 持续动画（对齐 source 项目风格）
- `monthcard-vip-bg-fx` 使用 CSS `radial-gradient` 静态光斑，不触发 GPU 持续渲染
- 排行榜徽章使用稳定 `key`，不引起整行重渲染
- `prefers-reduced-motion` 时禁用所有 `transform` 过渡

### 6.6 `monthCardDisplay` 展示规则模块（对齐 source 项目架构）

与 source 项目的 `monthCardDisplay.ts` 一致，将"接口返回的权益数值 → UI 文案"收敛到单一入口：

```typescript
// new-client/src/components/MonthCardModal/monthCardDisplay.ts

/**
 * 月卡弹窗展示规则共享模块
 *
 * 作用：集中维护月卡奖励图标、特权文案、状态文案与按钮文案，
 *       避免这些高频变化点散落在弹窗组件里。
 * 不做什么：不请求接口、不持有 React 状态，也不负责具体 DOM 渲染。
 */

// 每日奖励展示
export type MonthCardDailyReward = {
  id: string;
  name: string;
  icon: string;  // 始终走共享资源 IMG_LINGSHI
  amount: number;
  type: 'spiritStone';
};

// 权益展示输入（从接口 benefits 映射）
export type MonthCardBenefitDisplayInput = {
  scratchBonusBps: number;     // 刮刮乐加成（基点）
  shopRentBonusBps: number;    // 店铺租金加成（基点）
  dailyRewardSpiritStones: number;  // 每日灵石返还
};

// 权益图标
export type MonthCardPrivilegeIconName =
  | 'GiftOutlined'       // 每日灵石
  | 'ThunderboltOutlined' // 刮刮乐加成
  | 'ShopOutlined'       // 店铺租金加成
  | 'ClockCircleOutlined'; // 到期时间提示

export type MonthCardPrivilege = {
  id: string;
  name: string;
  description: string;
  iconName: MonthCardPrivilegeIconName;
};

// 状态面板
export type MonthCardPanelState = {
  statusValue: string;   // "剩余 X 天" / "已到期" / "未激活"
  statusHint: string;    // 到期时间 / 提示文案（如"月卡仅由 GM 发放"）
};

// 纯函数输出
export const getMonthCardPrivileges = (
  benefits: MonthCardBenefitDisplayInput,
): MonthCardPrivilege[] => { ... };

export const buildMonthCardDailyRewards = (
  dailySpiritStones: number,
): MonthCardDailyReward[] => { ... };

export const buildMonthCardPanelState = ({
  active, isExpired, daysLeft, expireAt,
}: { active: boolean; isExpired: boolean; daysLeft: number; expireAt: string | null }): MonthCardPanelState => { ... };

export const buildMonthCardIndicator = (
  input: { active: boolean; canClaim: boolean },
): { badgeDot: boolean; tooltip?: string } => { ... };
```

**数据流**：
```
API 返回月卡状态 → monthCardDisplay 纯函数转换 → MonthCardModal 组件渲染
```

**关键边界**：
1. 灵石奖励图标必须始终走共享资源 `IMG_LINGSHI`
2. 百分比与加成数值来自接口，不在组件里写死
3. 模块不做请求、不做状态管理，只做纯函数转换

### 6.7 RootStore 注册

```typescript
// new-client/src/stores/RootStore.ts
import { MonthCardStore } from './MonthCardStore';

export class RootStore {
  // ... 现有 Store
  monthCardStore: MonthCardStore;

  constructor() {
    // ... 现有初始化
    this.monthCardStore = new MonthCardStore();
  }
}
```

---

## 七、biz_type 扩展

在 `ledgerService.ts` 的 `SpiritStonesLedgerBizType` 中新增：

```typescript
type SpiritStonesLedgerBizType =
  // ... 现有类型
  | 'gm_grant_month_card'      // GM 发放月卡（发放灵石给玩家）
  | 'gm_revoke_month_card'     // GM 回收月卡
  | 'month_card_daily';        // 月卡每日领取（发放灵石）

中文映射：

```typescript
export const LEDGER_BIZ_TYPE_LABELS: Record<SpiritStonesLedgerBizType, string> = {
  // ... 现有映射
  gm_grant_month_card: 'GM 发放月卡',
  gm_revoke_month_card: 'GM 回收月卡',
  month_card_daily: '月卡每日领取',
};
```

---

## 八、交互流程（玩家视角）

```
1. 玩家进入月卡面板
   └─ 加载完成 → 显示月卡状态（未激活/剩余X天/已过期）
   └─ 同时显示权益列表（每日领取、刮刮乐加成、租金加成）

2. 未激活/已过期状态
   └─ 面板提示"月卡仅由 GM 发放"（无购买/续费按钮）

3. 每天首次进入面板（已激活状态）
   ├─ "领取今日奖励"按钮可用
   ├─ 点击 → 领取 500 灵石
   │   └─ 成功 → 加灵石 → 写入流水 → 写入领取记录
   └─ 按钮变灰，显示"今日已领取"

4. 月卡到期
   └─ 下次进入面板 → 显示"已过期"
   └─ 提示"月卡仅由 GM 发放"
```

### 8.1 GM 操作流程

```
GM 后台 → 选择角色 → 填写天数（默认 30） → 发放
  │
  ├─ 目标未激活 → 新发放，激活月卡
  ├─ 目标已激活 → 续期，expiresAt 累加天数
  └─ 目标已过期 → 重新激活，从当前时间算起

GM 后台 → 选择角色 → 回收月卡
  │
  ├─ 目标已激活 → 立即标记为 revoked，权益失效
  └─ 目标未激活/已回收 → 幂等，无操作
```

---

## 九、安全设计

### 9.1 防刷措施

| 措施 | 说明 |
|------|------|
| `SELECT ... FOR UPDATE` | 发放/领取/回收时行锁，防止并发 |
| 唯一约束 `(character_id, claim_date)` | 数据库层面拦截同天重复领取 |
| `expires_at > NOW()` 校验 | 过期后无法领取 |
| `requireGM` 鉴权 | GM 发放/回收接口仅 GM 权限可调用 |
| QPS 限制 | GM 接口 1次/秒 |

### 9.2 经济安全

| 措施 | 说明 |
|------|------|
| 事务一致性 | 发放/回收 + 流水写入同一事务 |
| 流水可追溯 | `biz_type='gm_grant_month_card'` / `'gm_revoke_month_card'` / `'month_card_daily'` |
| 加成只影响产出 | 加成不修改月卡本身配置，只在结算侧应用 |
| 回收可审计 | `status='revoked'` 与 `status='expired'` 区分，便于审计 GM 操作 |

---

## 十、关键边界条件与坑点

### 10.1 已知边界

1. **日期统一 UTC**：`claim_date` 使用 UTC 日期，避免时区跨日
2. **发放逻辑**：已过期时从当前时间算起，未过期时从原到期时间累加
3. **惰性过期更新**：不依赖定时任务，查询时自动标记过期
4. **`updated_at` 显式写入**：raw SQL INSERT 时需 `now(), now()`
5. **配置缓存**：应用启动时加载，热更新需重启或提供刷新接口
6. **加成计算使用整数**：`amount * bps / 10000`，避免浮点精度问题
7. **流水备注**：发放时注明"新发放"或"续期"，回收时注明"GM 回收"，便于审计
8. **排行榜集成**：`getMonthCardActiveMapByCharacterIds` 替换 stub 后需验证性能
9. **GM 权限校验**：发放/回收接口必须经过 `requireGM` 中间件
10. **Store 请求去重**：`refreshStatus` 使用 RequestDedup（in-flight 守卫），`claimDaily` 使用 isXxx 防重
11. **回收幂等**：对未激活角色回收月卡不报错，直接返回 `wasActive: false`

---

## 十一、二阶段规划

### 11.1 多档位月卡

- 新增配置记录：`weekly`（7天）、`quarterly`（90天）、`yearly`（365天）
- GM 发放时选择档位并传入 `configKey` 参数

### 11.2 GM 批量发放

- GM 后台展示角色列表（支持搜索、筛选：在线玩家、特定等级、特定排名）
- 列表每行提供 checkbox，勾选后顶部统一操作栏「发放月卡」
- 勾选提交时传入角色 ID 数组 + 天数（默认 30）
- 批量操作结果统计：成功 N 人、失败 M 人（附失败原因）

### 11.3 特权 Buff 扩展

- 挂单手续费减免
- 股市交易税率优惠
- 每日额外刮刮乐票

---

## 十二、文件变更汇总

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| **新增** | `server/src/seeds/monthCardConfig.json` | 种子数据 |
| **新增** | `server/src/seeds/monthCardConfigSeed.ts` | 种子导入脚本 |
| **新增** | `server/src/services/monthCard/monthCardService.ts` | 月卡核心服务 |
| **新增** | `server/src/services/monthCard/monthCardConfigCache.ts` | 运行时配置缓存 |
| **新增** | `server/src/services/monthCard/monthCardTypes.ts` | 共享类型 |
| **新增** | `server/src/routes/monthCardRoutes.ts` | HTTP 路由 |
| **新增** | `new-client/src/services/api/monthCard.ts` | API 封装 |
| **新增** | `new-client/src/stores/MonthCardStore.ts` | MobX Store |
| **新增** | `new-client/src/components/MonthCardModal/index.tsx` | 月卡弹窗组件 |
| **新增** | `new-client/src/components/MonthCardModal/index.scss` | 月卡样式（color-mix 主题变量） |
| **新增** | `new-client/src/components/MonthCardModal/monthCardDisplay.ts` | 展示规则模块 |
| **修改** | `server/prisma/schema.prisma` | 新增 3 张表 |
| **修改** | `server/src/bootstrap/registerRoutes.ts` | 注册月卡路由 |
| **修改** | `server/src/services/shared/monthCardBenefits.ts` | Stub → 真实实现 |
| **修改** | `server/src/services/ledgerService.ts` | 新增 biz_type |
| **修改** | `server/src/services/scratchGame/scratchTicketService.ts` | 接入刮刮乐加成 |
| **修改** | `server/src/services/shop/shopService.ts` | 接入租金加成 |
| **修改** | `new-client/src/stores/RootStore.ts` | 新增 monthCardStore |
