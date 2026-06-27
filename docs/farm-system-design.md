# 灵田系统（种地玩法）设计方案

> **⚠️ 方案状态：失败版本，可玩性很低**
>
> 此方案已被标记为可玩性不足的设计，仅供参考或后续迭代时对比分析。

---

## 一、系统概述

### 定位

灵田系统是继股市、收租店铺、刮刮乐、月卡之后的又一个**灵石经济循环玩法**。玩家拥有自己的灵田，购买种子、播种、等待生长、收获灵材、出售或用于杂交培育新品种。

### 核心循环

```
灵石 → 购买种子 → 播种到地块 → 等待生长（real-time） → 收获灵材 → 出售得灵石 / 杂交出新品种
```

### 设计原则

1. **配置驱动**：农作物、种子商品、杂交配方、地块等级全部由 `data/seeds/farm/` 目录下的 JSON 配置驱动，**不入库**，纯内存缓存（与 `industryConfigLoader` 模式一致）
2. **real-time 生长**：与店铺收租类似，基于真实时间计算生长进度，不依赖 tick 推进状态
3. **异步调度辅助**：仅用于枯萎检测等"到点触发"场景，核心状态由查询时实时计算
4. **灵石流水统一**：所有灵石变动走 `consumeSpiritStones` / `addSpiritStones` + `recordSpiritStones`

---

## 二、JSON 配置设计（不入库，纯内存）

配置目录：`server/data/seeds/farm/`，启动时由 `farmConfigLoader.ts` 一次性加载到内存。

### 2.1 crops.json — 农作物定义

```jsonc
{
  "crops": [
    {
      "cropId": "spirit_rice",
      "name": "灵稻",
      "description": "最基础的灵田作物，生长稳定",
      "rarity": "common",                // common / uncommon / rare / epic / legendary
      "sortOrder": 0,
      "enabled": true,

      // ── 生长参数 ──
      "growthStageMinutes": [10, 20, 30], // 各生长阶段时长（分钟）
      // 约束：growthStageMinutes.length 必须等于 stageLabels.length
      // 派生：totalGrowthMinutes = sum(growthStageMinutes) = 60
      // 额外状态"已收获/空地块"不计入阶段，不需要 label
      "stageLabels": ["灵芽", "灵苗", "成熟"],
      "witherAfterMinutes": 120,          // 成熟后可等待收获的宽限期，超时枯萎

      // ── 产出 ──
      "yieldMin": 3,
      "yieldMax": 8,
      "sellPricePerUnit": 10,             // 单个灵材出售价格（灵石）
      "expGain": 5,                       // 收获时获得的经验值（预留字段）

      // ── 解锁条件 ──
      "unlockFarmLevel": 1,              // 需要灵田等级
      "seedItemId": "seed_spirit_rice",  // 对应种子商品的 itemId

      // ── 采灵相关（见第十一节）──
      "stealYieldPerHit": 2              // 每次被采灵，owner 损失该数量的灵材
    },
    {
      "cropId": "flame_lily",
      "name": "焰心莲",
      "description": "火属性灵花，生长缓慢但价值极高",
      "rarity": "rare",
      "sortOrder": 10,
      "enabled": true,
      "growthStageMinutes": [30, 60, 90, 120],
      "stageLabels": ["种衣裂开", "赤芽", "花苞", "盛放"],
      "witherAfterMinutes": 60,
      "yieldMin": 2,
      "yieldMax": 5,
      "sellPricePerUnit": 200,
      "expGain": 30,
      "unlockFarmLevel": 3,
      "seedItemId": "seed_flame_lily",
      "stealYieldPerHit": 1
    }
  ]
}
```

**关键设计说明：**

- `growthStageMinutes` 是数组，每项对应一个生长阶段的时长
- **硬约束：`stageLabels.length` 必须等于 `growthStageMinutes.length`**（两者一一对应）。额外状态"已收获/空地块"不计入阶段，不需要 label
- `witherAfterMinutes`：成熟后超过这个时间不收获，作物枯萎，产出为零。增加玩家上线频率压力
- 前端展示时根据 `plantedAt + sum(growthStageMinutes)` 实时计算当前阶段，不需要后端 push 状态
- **数值为占位符**，上线前需根据经济模型调参。设计目标：高稀有度作物利润/小时略高于低稀有度，但需要更高级灵田和更长在线时间作为门槛

### 2.2 seeds.json — 种子商品定义

```jsonc
{
  "seeds": [
    {
      "itemId": "seed_spirit_rice",
      "cropId": "spirit_rice",
      "name": "灵稻种子",
      "description": "灵稻的种子，播种后约60分钟成熟",
      "buyPrice": 20,                    // 购买价格（灵石）
      "sellPrice": 5,                    // 出售种子价格（低于购买价）
      "stackable": true,
      "maxStack": 999,
      "unlockFarmLevel": 1,
      "enabled": true,
      "sortOrder": 0
    },
    {
      "itemId": "seed_flame_lily",
      "cropId": "flame_lily",
      "name": "焰心莲种子",
      "description": "焰心莲的种子，需要灵田等级3",
      "buyPrice": 500,
      "sellPrice": 100,
      "stackable": true,
      "maxStack": 99,
      "unlockFarmLevel": 3,
      "enabled": true,
      "sortOrder": 10
    }
  ]
}
```

**说明：** 种子作为"物品"存在于玩家种子袋（seedInventory）中，不是直接购买后即种。购买 → 入袋 → 选地块 → 播种 → 消耗种子。杂交产出的新种子也进入种子袋。

### 2.3 hybridRecipes.json — 杂交配方

```jsonc
{
  "recipes": [
    {
      "recipeId": "hybrid_sunset_lotus",
      "name": "培育·落日莲",
      "description": "将灵稻与焰心莲杂交，可能培育出落日莲",
      "enabled": true,
      "sortOrder": 0,

      // ── 亲本要求 ──
      "parentA": {
        "cropId": "spirit_rice",
        "quantity": 5
      },
      "parentB": {
        "cropId": "flame_lily",
        "quantity": 2
      },

      // ── 产出 ──
      "resultSeedItemId": "seed_sunset_lotus",
      "resultQuantity": 1,

      // ── 概率与消耗 ──
      "successRate": 0.30,
      "costSpiritStones": 200,
      "cooldownMinutes": 30,

      // ── 解锁条件 ──
      "unlockFarmLevel": 3,
      "requiredHarvestCount": {
        "spirit_rice": 10,
        "flame_lily": 5
      }
    },
    {
      "recipeId": "hybrid_golden_wheat",
      "name": "培育·金穗麦",
      "description": "多株灵稻优选杂交",
      "enabled": true,
      "sortOrder": 1,
      "parentA": { "cropId": "spirit_rice", "quantity": 10 },
      "parentB": { "cropId": "spirit_rice", "quantity": 10 },
      "resultSeedItemId": "seed_golden_wheat",
      "resultQuantity": 3,
      "successRate": 0.50,
      "costSpiritStones": 100,
      "cooldownMinutes": 10,
      "unlockFarmLevel": 2,
      "requiredHarvestCount": { "spirit_rice": 20 }
    }
  ]
}
```

**杂交流程核心：**

- 消耗两种灵材（来自收获） + 灵石 → 概率获得新种子
- 亲本无序（A+B 与 B+A 视为同一配方）
- 失败时亲本和灵石仍然消耗，不返还
- 冷却时间内不可再次杂交（防止刷概率）

### 2.4 plots.json — 地块等级与解锁配置

```jsonc
{
  "plotTiers": [
    {
      "tier": 1,
      "name": "荒田",
      "growthSpeedBonusBps": 0,
      "yieldBonusBps": 0,
      "witherDelayBonusMinutes": 0
    },
    {
      "tier": 2,
      "name": "灵田",
      "growthSpeedBonusBps": 500,
      "yieldBonusBps": 0,
      "witherDelayBonusMinutes": 10
    },
    {
      "tier": 3,
      "name": "沃灵田",
      "growthSpeedBonusBps": 1000,
      "yieldBonusBps": 500,
      "witherDelayBonusMinutes": 30
    }
  ],

  "plotSlots": [
    { "slotIndex": 0, "unlockCost": 0,     "unlockFarmLevel": 1 },
    { "slotIndex": 1, "unlockCost": 500,   "unlockFarmLevel": 1 },
    { "slotIndex": 2, "unlockCost": 1000,  "unlockFarmLevel": 2 },
    { "slotIndex": 3, "unlockCost": 2000,  "unlockFarmLevel": 2 },
    { "slotIndex": 4, "unlockCost": 5000,  "unlockFarmLevel": 3 },
    { "slotIndex": 5, "unlockCost": 10000, "unlockFarmLevel": 4 }
  ],

  "farmLevels": [
    { "level": 1, "name": "凡土", "maxPlotTier": 1, "expRequired": 0,    "xiRangCount": 0,  "xiRangPricePerUnit": 0 },
    { "level": 2, "name": "灵壤", "maxPlotTier": 2, "expRequired": 100,  "xiRangCount": 3,  "xiRangPricePerUnit": 200 },
    { "level": 3, "name": "仙壤", "maxPlotTier": 3, "expRequired": 500,  "xiRangCount": 8,  "xiRangPricePerUnit": 500 },
    { "level": 4, "name": "神壤", "maxPlotTier": 3, "expRequired": 2000, "xiRangCount": 20, "xiRangPricePerUnit": 1000 }
    // 突破总灵石花费：Lv2=600, Lv3=4000, Lv4=20000
  ]
}
```

---

## 三、数据库设计

### 3.1 新增 Prisma Model

```prisma
// ========== 灵田系统 ==========

// 灵田地块表（每玩家最多 6 个地块，slot 固定）
model farm_plot {
  id                Int      @id @default(autoincrement())
  character_id      Int
  slot_index        Int      @db.SmallInt
  unlocked          Boolean  @default(false)
  plot_tier         Int      @default(1) @db.SmallInt
  crop_id           String?  @db.VarChar(64)     // 引用 crops.json cropId，无 FK（JSON 配置不入库）
  planted_at        DateTime? @db.Timestamp(6)
  steal_count       Int      @default(0) @db.SmallInt  // 已被采灵次数（0~maxStealPerPlot）

  created_at        DateTime @default(now()) @db.Timestamp(6)
  updated_at        DateTime @updatedAt @db.Timestamp(6)

  character         characters @relation(fields: [character_id], references: [id], onDelete: Cascade)
  steal_records     farm_steal_record[]

  @@unique([character_id, slot_index])
  @@index([character_id])
  @@index([character_id, crop_id], map: "idx_farm_plot_crop")
}

// 种子背包表
model farm_seed_inventory {
  id                Int      @id @default(autoincrement())
  character_id      Int
  item_id           String   @db.VarChar(64)
  quantity          Int      @default(0)

  created_at        DateTime @default(now()) @db.Timestamp(6)
  updated_at        DateTime @updatedAt @db.Timestamp(6)

  character         characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@unique([character_id, item_id])
  @@index([character_id])
}

// 灵材仓库表
model farm_harvest_inventory {
  id                Int      @id @default(autoincrement())
  character_id      Int
  crop_id           String   @db.VarChar(64)
  quantity          Int      @default(0)

  created_at        DateTime @default(now()) @db.Timestamp(6)
  updated_at        DateTime @updatedAt @db.Timestamp(6)

  character         characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@unique([character_id, crop_id])
  @@index([character_id])
}

// 角色灵田信息表
model farm_profile {
  id                    Int      @id @default(autoincrement())
  character_id          Int      @unique
  farm_level            Int      @default(1) @db.SmallInt
  farm_exp              BigInt   @default(0)
  last_hybrid_at        DateTime? @db.Timestamp(6)
  total_harvest_count   Int      @default(0)
  harvest_count_by_crop Json     @default("{}")
  initial_seeds_claimed Boolean  @default(false)  // 初始种子是否已发放（首次 upsert 时设为 true）

  created_at            DateTime @default(now()) @db.Timestamp(6)
  updated_at            DateTime @updatedAt @db.Timestamp(6)

  character             characters @relation(fields: [character_id], references: [id], onDelete: Cascade)
}
```

> **字段裁剪说明（相对于初始设计）**：
>
> - 删除 `farm_plot.harvested_at`：收获后地块直接清空 `crop_id`/`planted_at`，无场景需要"上次收获时间"
> - 删除 `farm_plot.withered`：枯萎状态由 `computeCropState()` 实时计算（`planted_at + growthMinutes + witherAfterMinutes < now`），不需要持久化标记
> - 删除 `farm_plot.hybrid_seed_flag`：全文无业务引用
> - `farm_harvest_inventory.quantity` 由 `BigInt` 改为 `Int`：灵材数量不会超过 Int 范围，与 `farm_seed_inventory.quantity` 保持一致

### 3.2 characters 表关联扩展

```prisma
// 在 characters model 中新增：
  farm_plots               farm_plot[]
  farm_seed_inventories    farm_seed_inventory[]
  farm_harvest_inventories farm_harvest_inventory[]
  farm_profile             farm_profile?
  farm_favorites           farm_favorite[]       // 我收藏的灵田
  farm_favorited_by        farm_favorite[]       // 收藏我的灵田（反向关联）
```

> 注：`farm_steal_record` 不关联 characters 表（通过 `thief_character_id` / `owner_character_id` 裸字段查询），因为采灵记录量大且查询模式以时间范围为主，不需要 Prisma relation。

### 3.3 流水 biz_type 扩展

在 `SpiritStonesLedgerBizType` 中新增：

```typescript
| 'farm_buy_seed'          // 购买种子
| 'farm_sell_harvest'      // 出售灵材
| 'farm_sell_seed'         // 出售种子
| 'farm_unlock_plot'       // 解锁地块
| 'farm_upgrade_plot'      // 升级地块
| 'farm_xirang'            // 购买息壤（灵田突破消耗）
| 'farm_hybrid'            // 杂交消耗
```

---

## 四、后端服务设计

### 4.1 文件组织

```
server/
├── data/seeds/farm/
│   ├── crops.json
│   ├── seeds.json
│   ├── hybridRecipes.json
│   └── plots.json
├── src/
│   ├── services/farm/
│   │   ├── farmConfigLoader.ts       # 配置加载器（纯内存，与 industryConfigLoader 一致）
│   │   ├── farmTypes.ts              # 类型定义 + 纯函数（费用计算等）
│   │   ├── farmService.ts            # 核心服务（种植、收获、购买种子、出售灵材）
│   │   ├── farmHybridService.ts      # 杂交服务（单独拆出，逻辑复杂）
│   │   ├── farmScheduler.ts          # 枯萎提醒调度器（可选）
│   │   └── farmDtoBuilder.ts         # DTO 构建（实时计算生长阶段）
│   ├── routes/farmRoutes.ts
```

### 4.2 farmConfigLoader.ts（纯内存，Map 索引）

启动时异步加载 4 个 JSON 到内存，内部构建 `Map<string, T>` 索引，提供同步 O(1) 查询：

- `getCropConfig(cropId)` — `Map<string, CropConfig>` 查询
- `getSeedConfig(itemId)` — `Map<string, SeedConfig>` 查询
- `getHybridRecipe(recipeId)` — `Map<string, HybridRecipeConfig>` 查询
- `findHybridRecipe(cropIdA, cropIdB)` — 无序匹配亲本（见下方 key 构造）
- `getPlotTierConfig(tier)` — `Map<number, PlotTierConfig>` 查询
- `getFarmLevelConfig(level)` — `Map<number, FarmLevelConfig>` 查询
- `getAllCrops()` / `getAllSeeds()` / `getAllRecipes()` — 返回按 `sortOrder` 排序的只读数组
- `getStealConfig()` — 返回 plots.json 中 `steal` 节点配置

**杂交配方无序匹配 key 构造：**

```typescript
// 将两个亲本 cropId 按字典序排序后拼接，作为 Map 的 key
function buildHybridKey(cropIdA: string, cropIdB: string): string {
  return [cropIdA, cropIdB].sort().join(':');
  // "flame_lily:spirit_rice" 或 "spirit_rice:spirit_rice"（自交）
}
```

`init()` 时构建两个 Map：
- `recipeById: Map<string, HybridRecipeConfig>` — key = recipeId
- `recipeByParents: Map<string, HybridRecipeConfig>` — key = buildHybridKey(parentA.cropId, parentB.cropId)

`findHybridRecipe(cropIdA, cropIdB)` 直接查 `recipeByParents.get(buildHybridKey(cropIdA, cropIdB))`。

**`init()` 交叉校验（启动即报错，不静默跳过）：**

| 校验项 | 规则 |
|--------|------|
| cropId 唯一 | crops 数组内 cropId 不重复 |
| itemId 唯一 | seeds 数组内 itemId 不重复 |
| seedItemId 引用 | 每个 crop.seedItemId 必须在 seeds Map 中存在 |
| seed→crop 反向引用 | 每个 seed.cropId 必须在 crops Map 中存在 |
| 杂交亲本引用 | 每个 recipe 的 parentA.cropId / parentB.cropId 必须在 crops Map 中存在 |
| 杂交产出引用 | 每个 recipe 的 resultSeedItemId 必须在 seeds Map 中存在 |
| 杂交 key 唯一 | 所有 recipe 的 buildHybridKey 不重复（防止同一亲本对多配方） |
| stageLabels 长度 | 每个 crop 的 `stageLabels.length === growthStageMinutes.length` |
| farmLevel 连续 | farmLevels 的 level 从 1 开始连续递增 |

> **与 industryConfigLoader 的差异**：industryConfigLoader 用 `.find()` 线性查找且校验较弱。farmConfigLoader 改用 Map 索引（作物数 ≤ 30 时性能无差异，但 Map 语义更清晰），并增加严格校验（启动即报错 vs 静默降级）。

### 4.3 farmService.ts 核心服务

```
class FarmService：
  // ── 概览 ──
  getFarmOverview(characterId)
    → 返回：灵田等级/经验、所有地块状态（实时计算生长阶段）、种子袋、灵材仓库

  // ── 种子商店 ──
  buySeed(characterId, itemId, quantity)
    → 扣灵石 → 增种子袋 → 记流水
  sellSeed(characterId, itemId, quantity)
    → 扣种子袋 → 加灵石 → 记流水

  // ── 种植 ──
  plantCrop(characterId, slotIndex, itemId)
    → 校验：地块已解锁、当前无作物、种子袋有该种子
    → 消耗种子 → 写入 farm_plot（crop_id + planted_at = NOW()）

  // ── 收获 ──
  harvestCrop(characterId, slotIndex)
    → 校验：作物已成熟（planted_at + growthMinutes * speedBonus <= now）
    → 校验：未枯萎（now <= matured_at + witherAfterMinutes）
    → 随机 yield → 入灵材仓库 → 加经验 → 清地块
    → 如已枯萎 → 产出为零，清地块

  // ── 地块管理 ──
  unlockPlot(characterId, slotIndex)
    → 扣灵石 → 设 unlocked=true
  upgradePlot(characterId, slotIndex)
    → 扣灵石 → plot_tier + 1

  // ── 灵田突破（消耗经验 + 购买息壤）──
  upgradeFarmLevel(characterId)
    → 校验：当前等级 < 最高等级
    → 查询下一等级配置 nextLevel = farmLevels[currentLevel + 1]
    → 校验：farm_exp >= nextLevel.expRequired
    → 计算息壤总费用：totalCost = nextLevel.xiRangCount × nextLevel.xiRangPricePerUnit
    → 校验：spirit_stones >= totalCost
    → 事务内执行：
      1. consumeSpiritStones(totalCost, biz_type: 'farm_xirang')
      2. farm_profile.farm_level = nextLevel.level
      3. 记流水
    → 返回 { newLevel, levelName, xiRangCount, totalCost }

  // ── 灵材出售 ──
  sellHarvest(characterId, cropId, quantity)
    → 扣灵材仓库 → 加灵石 → 记流水
  sellAllHarvest(characterId)
    → 批量出售全部灵材
```

### 4.3.1 灵田初始化流程（首次访问自动创建）

> **核心决策**：`farm_profile` 和初始地块在玩家首次访问灵田时自动创建（upsert），不需要单独的"开通灵田"接口。初始种子在同一事务中发放。

```
getFarmOverview(characterId)
  → 查询 farm_profile WHERE character_id = ?
  → 若不存在，在事务内执行初始化：
    1. INSERT farm_profile（farm_level=1, farm_exp=0, initial_seeds_claimed=false）
    2. 批量 INSERT 6 条 farm_plot（slot_index 0~5, unlocked=false, plot_tier=1）
       — slot 0 自动设 unlocked=true（免费赠送第一块地）
    3. INSERT farm_seed_inventory（item_id='seed_spirit_rice', quantity=10）
       — 赠送 10 包灵稻种子作为启动资源
    4. UPDATE farm_profile SET initial_seeds_claimed = true
  → 若已存在，直接返回

  → 继续正常 overview 逻辑：
    → 查询所有 farm_plot（含实时计算的生长状态）
    → 查询种子袋 farm_seed_inventory
    → 查询灵材仓库 farm_harvest_inventory
    → 组装 DTO 返回

并发安全：
  — 两个请求同时到达时，farm_profile 的 @@unique([character_id]) 约束保证只有一条
  — 使用 INSERT ... ON CONFLICT DO NOTHING + 后续 SELECT 模式
  — 或使用 advisory lock 串行化初始化（推荐，避免重复 INSERT 后清理）
```

**前端行为**：

- 玩家首次点击"灵田"Tab 时，`FarmStore.fetchOverview()` 触发后端初始化
- 初始化后返回的 overview 包含：1 块已解锁地块 + 10 包灵稻种子
- 前端无需区分"首次/非首次"，后端返回的数据结构一致
- `initial_seeds_claimed` 字段供 GM 工具使用（重置后可重新发放）

```
// 关键：不依赖 tick 推进，每次查询时根据 planted_at 实时计算
// 好处：服务器重启不丢失状态、不依赖调度器准确性

function computeCropState(
  cropConfig: CropConfig,
  plantedAt: Date,
  now: Date,
  plotTierConfig: PlotTierConfig,
): CropStateDto {
  const elapsedMinutes = (now.getTime() - plantedAt.getTime()) / 60_000;
  const speedMultiplier = 1 + plotTierConfig.growthSpeedBonusBps / 10_000;
  const effectiveMinutes = elapsedMinutes * speedMultiplier;

  const totalGrowth = sum(cropConfig.growthStageMinutes);
  const maturedAt = totalGrowth;
  const witheredAt = maturedAt + cropConfig.witherAfterMinutes;

  if (effectiveMinutes >= witheredAt) {
    return { stage: 'withered', progressBps: 10000, stageIndex: -1 };
  }
  if (effectiveMinutes >= maturedAt) {
    return { stage: 'harvestable', progressBps: 10000,
             stageIndex: stageLabels.length - 1 };
  }

  // 在生长中：计算当前阶段
  // growthStageMinutes[i] 是第 i 个阶段的时长
  // stageLabels.length === growthStageMinutes.length
  let accumulated = 0;
  for (let i = 0; i < cropConfig.growthStageMinutes.length; i++) {
    accumulated += cropConfig.growthStageMinutes[i];
    if (effectiveMinutes < accumulated) {
      const stageStart = accumulated - cropConfig.growthStageMinutes[i];
      const stageProgress =
        (effectiveMinutes - stageStart) / cropConfig.growthStageMinutes[i];
      return {
        stage: 'growing',
        progressBps: Math.floor(stageProgress * 10000),
        stageIndex: i,
      };
    }
  }

  // 不可达：effectiveMinutes < totalGrowth 已在上方判定
  // 但 TypeScript 需要显式返回，防御性兜底
  return { stage: 'harvestable', progressBps: 10000,
           stageIndex: cropConfig.stageLabels.length - 1 };
}
```

**性能考虑：**

- 纯数学计算，O(阶段数)，阶段数 <= 5，可忽略
- 在 `farmDtoBuilder.ts` 中统一封装，被 overview / harvest 等多个接口复用
- 不需要缓存（每次查询都是即时计算，无重复计算问题）

### 4.5 farmHybridService.ts 杂交服务

```
class FarmHybridService：
  // ── 查询可用配方 ──
  getAvailableRecipes(characterId)
    → 返回所有配方 + 当前材料是否充足 + 冷却状态

  // ── 执行杂交 ──
  executeHybrid(characterId, recipeId)
    → SELECT FOR UPDATE 锁 farm_profile
    → 校验：冷却（last_hybrid_at + cooldownMinutes < now）
    → 校验：灵材仓库材料充足
    → 校验：灵石充足
    → 消耗灵材 + 灵石
    → 随机判定成功/失败
    → 成功：种子入种子袋
    → 更新 last_hybrid_at
    → 记流水
    → 返回结果
```

**全局冷却机制说明：**

- `farm_profile.last_hybrid_at` 是**全局冷却**，不区分配方
- 执行任意配方后，所有配方的冷却都会更新
- 配方的 `cooldownMinutes` 表示"执行该配方后，下次可杂交的等待时间"
- 冷却校验取**当前选中配方的 cooldownMinutes**：`last_hybrid_at + recipe.cooldownMinutes < now`
- 设计目的：防止多配方并行刷概率。如果改为每配方独立冷却，需新增 `farm_hybrid_cooldown` 表，复杂度增加但收益有限

### 4.6 farmScheduler.ts（生长事件调度器）

与 `shopRentScheduler` 同模式：setTimeout 链式调度。

**职责**：定期扫描所有已种植地块，通过 SSE 推送两类事件：

| 事件 | 触发条件 | 扫描频率 |
|------|----------|----------|
| `farm:crop-mature` | 作物刚进入成熟态（effectiveMinutes >= totalGrowth） | 每 30s 扫描一次 |
| `farm:wither-warning` | 成熟后距枯萎还剩 5 分钟 | 每 60s 扫描一次 |

**实现要点**：
- 扫描范围：`farm_plot WHERE crop_id IS NOT NULL AND unlocked = true`
- 对每行调用 `computeCropState()` 判断当前状态
- 用内存 `Set<string>` 记录已推送事件（key = `${characterId}:${slotIndex}:${eventType}`），避免重复推送
- 地块收获/枯萎后清除对应 key
- 调度器不是核心必需的（枯萎检测已实时计算），仅用于主动推送通知

### 4.7 API 设计

```
// ── 概览 & 商店 ──
GET    /api/farm/overview              → 灵田概览（首次调用自动初始化，见 §4.3.1）
GET    /api/farm/shop                  → 种子商店列表（从配置读取 + 玩家等级过滤）

// ── 种植 & 收获 ──
POST   /api/farm/buy-seed              { itemId, quantity }
POST   /api/farm/sell-seed             { itemId, quantity }
POST   /api/farm/plant                 { slotIndex, itemId }
POST   /api/farm/harvest               { slotIndex }
POST   /api/farm/sell-harvest          { cropId, quantity }
POST   /api/farm/sell-all-harvest      {}

// ── 地块 & 灵田升级 ──
POST   /api/farm/unlock-plot           { slotIndex }
POST   /api/farm/upgrade-plot          { slotIndex }
POST   /api/farm/upgrade-level         {}  → 消耗经验 + 息壤灵石突破灵田等级

// ── 杂交 ──
GET    /api/farm/hybrid/recipes        → 可用配方列表
POST   /api/farm/hybrid/execute        { recipeId }

// ── SSE 推送 ──
GET    /api/farm/events?token=xxx      → EventSource 长连接（认证通过 query param）
```

**QPS 限制策略**（复用 `qpsLimit` 中间件）：

| 接口 | 限制 | 原因 |
|------|------|------|
| `GET /api/farm/overview` | 10 req/s | 高频轮询 |
| `POST /api/farm/harvest` | 5 req/s | 防并发收获 |
| `POST /api/farm/steal` | 10 req/s | 防刷采灵 |
| `POST /api/farm/buy-seed` | 5 req/s | 常规写操作 |
| 其他 POST | 5 req/s | 默认 |
| GET（除 overview） | 20 req/s | 常规读操作 |

---

## 五、前端设计

### 5.1 Store 设计

```typescript
// new-client/src/stores/FarmStore.ts (MobX)

@observable farmInfo: {
  farmLevel: number;
  farmLevelName: string;             // "凡土" / "灵壤" / "仙壤" / "神壤"
  farmExp: number;
  nextLevel: {
    level: number;
    name: string;
    expRequired: number;
    xiRangCount: number;             // 需要息壤数量
    xiRangPricePerUnit: number;      // 息壤单价
    totalSpiritStoneCost: number;    // = xiRangCount × xiRangPricePerUnit
  } | null;                          // null = 已满级
}

@observable plots: FarmPlotDto[]          // 地块列表（含实时生长状态）
@observable seedBag: SeedItemDto[]        // 种子袋
@observable harvestBag: HarvestItemDto[]  // 灵材仓库
@observable shopItems: ShopSeedDto[]      // 种子商店

@action loadOverview()                    // GET /api/farm/overview
@action buySeed / sellSeed / plant / harvest / sellHarvest / upgradeFarmLevel / ...
```

### 5.2 组件拆分

```
new-client/src/components/FarmPage/
├── FarmPage.tsx                  # 主页面容器（Tab 切换子视图）
├── FarmPlotsGrid.tsx             # 地块网格（核心视图）
│   └── FarmPlotCard.tsx          # 单个地块卡片（生长状态/进度条/操作按钮）
├── FarmSeedBag.tsx               # 种子袋面板
├── FarmHarvestBag.tsx            # 灵材仓库面板
├── FarmShop.tsx                  # 种子商店
├── FarmHybridPanel.tsx           # 杂交面板
├── FarmStatusBar.tsx             # 顶部状态栏（灵田等级、经验条）
└── FarmHybridResultModal.tsx     # 杂交结果弹窗

new-client/src/hooks/
└── useFarm.ts                    # 请求封装 + 轮询生长进度刷新
```

### 5.3 生长进度实时刷新策略

```
// 方案：前端本地倒计时 + 后端 overview 定时拉取
//
// 1. 拉取 overview 后，前端本地用 requestAnimationFrame / setInterval(1s)
//    更新进度条
// 2. 每 30 秒重新拉取 overview 同步后端状态（防止客户端时间漂移）
// 3. 到达"成熟"时刻时，自动触发一次收获按钮高亮提示
//
// 性能考虑：
// - 进度条更新只修改本地 observable，不触发 API 调用
// - 6 个地块的进度更新，每帧 < 0.1ms，无性能问题
// - 避免每个地块单独 setInterval → 统一一个 timer 驱动所有地块
```

### 5.4 页面布局

**桌面端：**

```
┌───────────────────────────────────────────────────────────┐
│ [灵壤 Lv.2] ████████░░ 100/500exp  [突破: 8息壤×500=4000] │
│                                                    [灵石:8500]│
├──────────────────────┬────────────────────────────────────┤
│                      │                          │
│   地块网格 (3x2)      │   侧边面板（可切换）      │
│  ┌────┐ ┌────┐ ┌────┐│  [种子袋] [灵材] [商店]   │
│  │灵稻│ │空地│ │焰心││  [杂交]                   │
│  │75% │ │    │ │莲  ││                          │
│  └────┘ └────┘ │30% ││  （选中面板内容区）        │
│  ┌────┐ ┌────┐ └────┘│                          │
│  │金穗│ │落日│ ┌────┐│                          │
│  │麦  │ │莲  │ │??? ││                          │
│  └────┘ └────┘ └────┘│                          │
│                      │                          │
├──────────────────────┴──────────────────────────┤
│ [收获] [播种] [收取全部灵材]                      │
└─────────────────────────────────────────────────┘
```

**移动端：**

```
┌───────────────────┐
│ 灵壤 Lv.2  8500灵石 │
├───────────────────┤
│ 地块网格 (2x3 竖排) │
│ ┌─────┐ ┌─────┐   │
│ │灵稻 │ │空地 │   │
│ │75%  │ │     │   │
│ └─────┘ └─────┘   │
│ ┌─────┐ ┌─────┐   │
│ │焰心 │ │金穗 │   │
│ │莲30%│ │麦   │   │
│ └─────┘ └─────┘   │
│ ┌─────┐ ┌─────┐   │
│ │落日 │ │ ??? │   │
│ │莲   │ │     │   │
│ └─────┘ └─────┘   │
├───────────────────┤
│ [种子] [灵材] [商店] │  ← 底部 Tab 切换
│ [杂交]             │
└───────────────────┘
```

---

## 六、核心业务流程

### 6.1 种植流程

```
玩家点击空地 → 弹出种子选择面板（从种子袋中过滤可种植的）
  → 选择种子 → POST /api/farm/plant { slotIndex, itemId }
  → 后端校验：
    1. 地块存在且已解锁
    2. 地块当前无作物（crop_id IS NULL）
    3. 种子袋中该种子数量 >= 1
    4. 作物 unlockFarmLevel <= 玩家灵田等级
  → 后端执行：
    1. 种子袋 quantity - 1
    2. farm_plot SET crop_id = ?, planted_at = NOW(), withered = false
    3. 返回更新后的 overview
```

### 6.2 收获流程

> 以下为基础收获流程。含采灵系统的完整流程（产量扣减逻辑）见 §11.11。

```
玩家点击成熟的地块 → POST /api/farm/harvest { slotIndex }
  → 后端校验：
    1. 地块有作物
    2. 已成熟（planted_at + effectiveGrowthMinutes <= now）
    3. 未枯萎（now <= matured_at + witherAfterMinutes）
  → 后端执行：
    1. 随机 yield = random(yieldMin, yieldMax)
    2. 灵材仓库 quantity + yield
    3. farm_profile.farm_exp + expGain
    4. farm_profile.harvest_count_by_crop[cropId] += 1
    5. 清地块：crop_id = NULL, planted_at = NULL
    6. 返回收获结果 { cropName, yield, expGain }
    // 注：升级由玩家主动调用 POST /api/farm/upgrade-level（需经验+息壤），非自动触发

  枯萎情况：
    1. 产出为 0
    2. 清地块
    3. 返回 { withered: true, yield: 0 }
```

### 6.3 杂交流程

```
玩家打开杂交面板 → GET /api/farm/hybrid/recipes
  → 展示所有配方 + 材料充足标记 + 冷却状态

玩家选择配方 → POST /api/farm/hybrid/execute { recipeId }
  → 后端执行（事务内）：
    1. SELECT FOR UPDATE 锁 farm_profile
    2. 校验冷却：last_hybrid_at + cooldownMinutes < now
    3. 校验灵材仓库：parentA.quantity, parentB.quantity 充足
    4. 校验灵石：spirit_stones >= costSpiritStones
    5. 消耗灵材（farm_harvest_inventory）
    6. 消耗灵石（consumeSpiritStones）
    7. 随机判定：Math.random() < successRate
    8. 成功 → 种子入种子袋（farm_seed_inventory）
    9. 更新 last_hybrid_at = NOW()
    10. 记流水（biz_type: farm_hybrid）
    11. 返回 { success: bool, resultSeedName?, consumedItems }
```

---

## 七、与现有系统的集成点

### 7.1 灵石经济

- 购买种子消耗灵石 → `consumeSpiritStones` + `biz_type: farm_buy_seed`
- 出售灵材获得灵石 → `addSpiritStones` + `biz_type: farm_sell_harvest`
- 杂交消耗灵石 → `consumeSpiritStones` + `biz_type: farm_hybrid`
- 解锁/升级地块 → `consumeSpiritStones` + `biz_type: farm_unlock_plot / farm_upgrade_plot`

### 7.2 流水查询

- 新增的 biz_type 自动出现在 LedgerTab 流水列表中
- 需要在 `LEDGER_BIZ_TYPE_LABELS` 中新增中文映射

### 7.3 前端路由

- 在 AppHeader 或主页面 Tab 中新增"灵田"入口
- 路由：`/farm`

### 7.4 启动流程（app.ts）

```typescript
// 新增：
import { initFarmConfig } from './services/farm/farmConfigLoader.js';

// 在 startServer() 中：
await initFarmConfig();
logger.info('灵田配置缓存已加载（纯内存）');
```

### 7.5 GM 工具扩展

- `GmFarmViewer` — 查看玩家灵田状态、种子袋、灵材仓库
- 可考虑：GM 发放种子/灵材功能

---

## 八、数据量与性能预估

| 指标 | 预估值 |
|------|--------|
| 作物种类 | 10~30 种 |
| 种子商品数 | 与作物数 1:1 |
| 杂交配方数 | 5~15 个 |
| 地块数/玩家 | 最多 6 个 |
| 查询频率/玩家 | overview 约 30s 一次 |
| 生长计算复杂度 | O(阶段数) <= O(5)，每地块 |
| overview 全量计算 | O(6 地块 x 5 阶段) = O(30)，可忽略 |

---

## 九、风险与边界条件

1. **时间一致性**：客户端和服务端时间可能不同步。解决方案：DTO 返回服务器 `now` 时间戳，前端用差值计算
2. **并发收获**：两个请求同时收获同一地块。解决方案：`SELECT FOR UPDATE` 锁地块行
3. **枯萎边界**：恰好在枯萎时刻点收获。解决方案：使用 `>=` 判定，服务端权威
4. **杂交冷却绕过**：客户端修改时间。解决方案：冷却由服务端 `last_hybrid_at` 判定
5. **配置缺失**：JSON 中引用了不存在的 cropId/itemId。解决方案：`farmConfigLoader.init()` 时做交叉校验，启动时即报错
6. **灵材溢出**：BigInt 存储无溢出风险；数量显示需做千分位格式化
7. **种子袋负数**：扣种子时必须 `WHERE quantity >= N` 或使用 `SELECT FOR UPDATE`

---

## 十、未来扩展方向（当前版本不实现）

以下为后续可能的扩展方向，当前版本不实现但预留接口设计空间：

- **灵田装饰**：纯展示，不影响数值
- **季节系统**：不同季节影响特定作物生长速度
- **灵田排行**：按收获总量/灵田等级排行
- **NPC 商人**：限时出售稀有种子
- **灵材合成**：灵材 → 丹药 → 增益 buff（与角色系统联动）

---

## 十一、采灵系统（偷菜玩法）

### 11.1 核心概念

**主题包装**：作物成熟后，多余灵气自然向四周弥散。其他修士可前往该灵田"采灵"——收集弥散出的灵气结晶。这不是"偷窃"，而是天地间灵气的自然流转——只不过手快有、手慢无。

**核心循环**：

```
作物成熟 → 灵气弥散（进入可采窗口）→ 他人来访采灵 →  owner 收获时产量减少
                         ↕
                   owner 及时收获 → 灵气收束 → 他人无法再采
```

**设计目标**：

1. 制造**上线动力**：不收获就会被采灵，产量打折
2. 制造**社交互动**：访问他人灵田、采灵日志、被采灵通知
3. 制造**策略博弈**：选择种高价值作物（被采损失大）vs 低价值作物（被采无所谓）
4. **不依赖好友系统**：通过"灵田广场"公开列表发现可访问的灵田

### 11.2 核心规则

| 规则 | 值 | 说明 |
|------|-----|------|
| 可采窗口 | 作物成熟后 ~ 枯萎前 | 未成熟不可采，枯萎后灵气消散不可采 |
| 保护期 | 成熟后前 5 分钟 | 仅 owner 可收获，他人不可采灵（给 owner 反应时间） |
| 单地块最大被采次数 | 3 次 | 防止被无限采 |
| 每次采灵损失 | `stealYieldPerHit`（由作物 JSON 配置） | 固定值，每次被采 owner 损失该数量的灵材 |
| 采灵者获得 | `floor(stealYieldPerHit × thiefGainRate)` | 灵气损耗 20%（弥散到天地间），避免通胀 |
| owner 收获时 | `max(baseYield - stealYieldPerHit × stealCount, 1)` | 最少保底 1 个灵材 |
| 每人每日采灵上限 | 20 次 | 防刷 |
| 对同一目标每日上限 | 3 次 | 防针对性骚扰 |
| 采灵冷却 | 10 秒 | 同一人对同一地块两次采灵间隔 |

**产量计算公式**：

```
// ── 采灵时（thief 视角）──
thiefGain = floor(cropConfig.stealYieldPerHit × stealConfig.thiefGainRate)

// ── owner 收获时 ──
baseYield     = random(yieldMin, yieldMax)     // 收获时随机
stolenTotal   = cropConfig.stealYieldPerHit × plot.steal_count
actualYield   = max(baseYield - stolenTotal, 1) // 保底 1
```

**示例**：灵稻 `stealYieldPerHit = 2`，`thiefGainRate = 0.80`，`yieldMin = 3, yieldMax = 8`

| 事件 | 计算 | 结果 |
|------|------|------|
| 第一次被采 | thiefGain = floor(2 × 0.8) = 1 | thief 获得 1 灵稻，owner 最终少 2 |
| 第二次被采 | thiefGain = floor(2 × 0.8) = 1 | thief 获得 1 灵稻，owner 最终少 2 |
| owner 收获 | baseYield = 6（随机），stolenTotal = 2×2 = 4 | actualYield = max(6-4, 1) = 2 |

> 注：采灵时不消耗 baseYield（baseYield 在收获时才随机），采灵量由 `stealYieldPerHit` 固定决定。详见 §11.5 "baseYield 一致性问题"。

### 11.3 配置扩展

在 `plots.json` 中新增 `steal` 节点：

```jsonc
{
  // ... 已有的 plotTiers / plotSlots / farmLevels

  "steal": {
    "enabled": true,
    "protectionMinutes": 5,          // 成熟后保护期（分钟）
    "maxStealPerPlot": 3,            // 单地块最大被采次数
    "thiefGainRate": 0.80,           // 采灵者实得比例（损耗 20%）
    // 注：每次采灵 owner 损失量由 crops.json 中 stealYieldPerHit 决定，不在此处配置
    "dailyStealLimit": 20,           // 每人每日采灵上限
    "perTargetDailyLimit": 3,        // 对同一目标每日上限
    "stealCooldownSeconds": 10,      // 同目标同地块冷却
    "minFarmLevelToSteal": 2,        // 采灵者最低灵田等级（新手保护）
    "minFarmLevelToBeProtected": 1   // 低于此等级的灵田免疫采灵（新手保护）
  }
}
```

### 11.4 数据库扩展

#### 新增表

```prisma
// 采灵记录表
model farm_steal_record {
  id                  Int      @id @default(autoincrement())
  thief_character_id  Int                         // 采灵者
  owner_character_id  Int                         // 灵田主人
  plot_id             Int                         // 对应 farm_plot.id
  slot_index          Int      @db.SmallInt       // 冗余存储，方便查询
  crop_id             String   @db.VarChar(64)    // 被采灵作物（引用 crops.json cropId，无 FK）
  stolen_quantity     Int      @db.SmallInt       // 本次 owner 损失量 = cropConfig.stealYieldPerHit
  thief_gain          Int      @db.SmallInt       // 采灵者实得 = floor(stolen_quantity × thiefGainRate)
  steal_sequence      Int      @db.SmallInt       // 该地块第几次被采（1/2/3）

  created_at          DateTime @default(now()) @db.Timestamp(6)

  plot                farm_plot @relation(fields: [plot_id], references: [id])

  @@index([thief_character_id, created_at], map: "idx_steal_thief_time")
  @@index([owner_character_id, created_at], map: "idx_steal_owner_time")
  @@index([plot_id], map: "idx_steal_plot")
}
```

> **关于 crop_id / item_id 无外键的说明**：作物和种子配置存储在 JSON 文件中（不入库），无法建立 DB 级外键约束。配置引用完整性由 `farmConfigLoader.init()` 启动时交叉校验保证（见 §4.2）。

> 注意：不新建独立的"灵田访问"表。访问量级大且不需持久化，用 Redis 或纯内存计数即可。如不需要精确统计，访问行为完全不落库。

> `steal_count` 字段已合入 §3.1 的 `farm_plot` 主 model，无需额外扩展。

#### 不需要新建的表

- **不需要"好友表"**：采灵通过"灵田广场"公开列表发现目标，不依赖好友关系
- **不需要"访问记录表"**：访问是轻量读操作，不落库

### 11.5 后端服务扩展

#### 新增文件

```
server/src/services/farm/
├── farmVisitService.ts      # 灵田访问 + 采灵操作
└── farmSseHub.ts            # SSE 推送中心（连接管理 + 事件分发）
```

#### farmVisitService.ts

```
class FarmVisitService：

  // ── 灵田广场（发现可访问的灵田）──
  getFarmPlaza(characterId, page, pageSize)
    → 返回：公开灵田列表（按最近有成熟作物的优先排序）
    → 过滤：排除自己的灵田
    → 过滤：排除低于 minFarmLevelToBeProtected 的新生灵田
    → 每条数据：{ characterId, nickname, farmLevel, maturedPlotCount,
                  topCropName, lastHarvestAt }
    → 不暴露具体产量和地块详情（需点进才看）

  // ── 访问他人灵田 ──
  visitFarm(visitorId, ownerCharacterId)
    → 返回：owner 的灵田概览（仅公开信息）
    → 包含：各地块作物状态、是否成熟、可采灵标记
    → 不包含：具体产量数值（用"灵气浓度"等模糊描述替代）
    → 记录访问行为到 Redis（可选，用于"最近访问"列表）

  // ── 采灵操作 ──
  stealCrop(thiefId, ownerCharacterId, slotIndex)
    → 事务内执行：
    1. 查询目标 farm_plot（WHERE character_id = ownerCharacterId AND slot_index = slotIndex）
       → 若不存在，返回"该灵田不存在"
    2. SELECT FOR UPDATE 锁目标 farm_plot
    3. 校验：thief != owner
    4. 校验：地块有作物（crop_id IS NOT NULL）
    5. 校验：作物已成熟且未枯萎
       成熟时刻 = planted_at + totalGrowthMinutes / speedMultiplier
       枯萎时刻 = maturedAt + witherAfterMinutes
       需满足：now >= maturedAt && now < witheredAt
    6. 校验：已过保护期
       可采时刻 = maturedAt + stealConfig.protectionMinutes
       需满足：now >= 可采时刻
       （注：speedMultiplier 由 plot_tier 的 growthSpeedBonusBps 决定，保护期基于"有效成熟时刻"计算）
    7. 校验：steal_count < maxStealPerPlot
    8. 校验：thief 今日采灵次数 < dailyStealLimit（Redis INCR 计数）
    9. 校验：thief 对该 owner 今日采灵次数 < perTargetDailyLimit（Redis INCR 计数）
    10. 校验：thief 灵田等级 >= minFarmLevelToSteal
    11. 校验：owner 灵田等级 >= minFarmLevelToBeProtected（owner 低于此值免疫）
    12. 校验：距上次对该地块采灵 > stealCooldownSeconds
        （查 farm_steal_record WHERE plot_id = ? AND thief_character_id = ? ORDER BY created_at DESC LIMIT 1）

    13. 计算采灵量：
        stolenQuantity = cropConfig.stealYieldPerHit        // owner 损失
        thiefGain      = floor(stolenQuantity × stealConfig.thiefGainRate)  // thief 实得

    14. 更新：
        - farm_plot.steal_count += 1
        - 写入 farm_steal_record
        - thief 灵材仓库 + thiefGain
    15. 通过 SSE 推送通知 owner（异步，不阻塞返回）
    16. 返回 { stolenQuantity, thiefGain, cropName, stealSequence }
```

**关于 baseYield 一致性问题（重要设计决策）**：

> 偷菜发生在 owner 收获之前，此时 baseYield 尚未随机。有三种方案：

| 方案 | 描述 | 优劣 |
|------|------|------|
| A. 播种时预随机 | 播种时生成 baseYield 存入 DB | 收获结果在播种时就已注定，缺乏惊喜感 |
| **B. 固定采灵量（推荐）** | 每个作物配置新增 `stealYieldPerHit` 字段，每次被采固定损失 N 个 | 简单明确，无需预随机。配置驱动，可精确调参 |
| C. 收获时种子随机 | 播种时存 seed，收获和偷菜都用同一 seed 生成 yield | 一致性最好，但实现复杂 |

**推荐方案 B**，配置扩展：

```jsonc
// crops.json 每个作物新增：
{
  "cropId": "spirit_rice",
  // ... 原有字段 ...
  "stealYieldPerHit": 2      // 每次被采灵，owner 损失 2 个灵材
}
```

采灵者获得：`floor(stealYieldPerHit × thiefGainRate)` = `floor(2 × 0.8)` = 1

Owner 收获时：`baseYield = random(yieldMin, yieldMax) - stealYieldPerHit × steal_count`，最少保底 1。

#### 对 farmService.ts 收获逻辑的修改

```
// 原 harvestCrop 收获流程修改：

  → 计算 baseYield = random(yieldMin, yieldMax)
  → 读取 steal_count
  → 计算 stolenTotal = stealYieldPerHit × steal_count
  → actualYield = max(baseYield - stolenTotal, 1)  // 保底 1
  → 入灵材仓库 actualYield
  → 清地块 + 重置 steal_count = 0
```

#### 服务端推送：SSE（Server-Sent Events）方案

> **为什么用 SSE 而非复用现有 Socket.IO：**
>
> 1. 项目已有 Socket.IO（`server/src/config/socket.ts`）用于聊天室，但采灵通知是纯服务端→客户端的**单向推送**，不需要双向通信
> 2. SSE 基于 HTTP、浏览器原生 `EventSource` 支持、无需额外依赖、自动重连，是此场景的最优解
> 3. **两套系统独立并存**：Socket.IO 服务聊天室（双向），SSE 服务灵田通知（单向）。各自的连接管理、心跳、断连重连互不干扰
> 4. 后续如果 Socket.IO 使用率下降，可考虑迁移到 SSE 统一；但当前阶段两者各司其职
>
> **架构影响**：新增 `GET /api/farm/events` SSE 端点 + `FarmSseHub` 单例。不修改现有 Socket.IO 代码。

**架构概览：**

```
                        HTTP 长连接（text/event-stream）
  Browser ────────────────────────────────────────────► Server
  (EventSource)         ◄── data: {"type":"farm:stolen",...}\n\n
                        ◄── :keepalive\n\n              (每30s心跳)
```

**新增文件 `farmSseHub.ts`**：

```
class FarmSseHub：
  // ── 连接管理 ──
  private connections: Map<number, ServerResponse[]>   // characterId → 活跃连接列表
  // 同一角色可能多端登录（手机+电脑），所以是数组

  // ── 注册连接（路由层调用）──
  addConnection(characterId, res)
    → 设置 res.writeHead(200, { Content-Type: 'text/event-stream', ... })
    → 发送初始心跳确认连接建立
    → 监听 res.on('close') 自动清理
    → 加入 connections Map

  // ── 推送事件（service 层调用）──
  pushToCharacter(characterId, eventType, payload)
    → 查找 connections.get(characterId)
    → 遍历写入 `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
    → 写入失败的连接自动移除

  // ── 心跳（调度器驱动）──
  startHeartbeat(intervalMs = 30_000)
    → 每 30s 向所有连接发送 `:keepalive\n\n`
    → 写入失败的连接自动移除

// 单例导出
```

**新增路由 `GET /api/farm/events`**：

```
// SSE 端点
// 认证：SSE 不支持自定义 Header，通过 query param 传递 token
// GET /api/farm/events?token=xxx

router.get('/events', async (req, res) => {
  const characterId = await authenticateSseToken(req.query.token);
  if (!characterId) { res.status(401).end(); return; }

  // 关键：禁用 Express 默认的响应缓冲
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');    // Nginx 禁用代理缓冲
  res.flushHeaders();

  farmSseHub.addConnection(characterId, res);
});
```

**采灵服务中调用**：

```
// farmVisitService.stealCrop() 末尾：

  // 事务提交后异步推送（不阻塞采灵响应）
  farmSseHub.pushToCharacter(ownerCharacterId, 'farm:stolen', {
    thiefNickname,
    cropName,
    slotIndex,
    stolenQuantity,
    thiefGain,
    stealSequence,
    timestamp: Date.now(),
  });
```

**多实例部署考虑**：

如果后续扩展到多 server 实例，SSE 连接是 per-instance 的，需要跨实例广播：

```
方案 A：Redis Pub/Sub（推荐）
  - 采灵后 PUBLISH 到 `farm:events:{characterId}` channel
  - 每个 server 实例 SUBSCRIBE 所有在线角色的 channel
  - 收到消息后推送到本地连接

方案 B：Redis Stream
  - 适用于需要消息持久化/回溯的场景
  - 采灵通知是即时消息，不需要回溯，Pub/Sub 足够

当前阶段（单实例）：直接内存 Map，不走 Redis。
后续扩展时只需替换 FarmSseHub 的 pushToCharacter 实现，上层调用不变。
```

### 11.6 API 设计

```
// ── 灵田广场（整合版：收藏 + 最近访问 + 全部列表）──
GET    /api/farm/plaza                        → 公开灵田列表（分页 + 排序）
         query: { page, pageSize, sortBy?: "recent" | "matured" | "stealable" }
         response: {
           tabs: {
             favorites: [{ characterId, nickname, farmLevel, maturedPlotCount, stealablePlotCount }],
             recentVisits: [{ characterId, nickname, farmLevel, maturedPlotCount, visitedAt }],
             all: { farms: [...], total, hasMore }
           }
         }

// ── 访问 ──
GET    /api/farm/visit/:characterId           → 访问他人灵田
         response: {
           owner: { characterId, nickname, farmLevel },
           plots: [
             { slotIndex, cropName, cropRarity, stage, stageLabel,
               canSteal: true/false, stealReason?: "保护期"/"已被采满"/"可采灵" },
             ...
           ],
           recentStealLog: [...],           // 最近的被采记录（owner 视角可见详情，visitor 视角模糊化）
           isFavorited: boolean             // 当前访客是否已收藏该灵田
         }

// ── 最近访问（完整列表，plaza 中仅展示前 5 条）──
GET    /api/farm/recent-visits              → 最近访问过的灵田列表（最多 20 条）
         response: { visits: [{ characterId, nickname, farmLevel, visitedAt, maturedPlotCount }] }

// ── 采灵（QPS 限制：10 req/s per character）──
POST   /api/farm/steal                        → 执行采灵
         body: { targetCharacterId, slotIndex }
         response: {
           success: true,
           cropName,
           stolenQuantity,       // owner 损失
           thiefGain,            // 采灵者实得
           stealSequence,        // 第几次
           remainingStealCount   // 该地块还可被采几次
         }
         errors: "保护期不可采" / "已被采满" / "今日采灵次数已满" / "冷却中" / "灵田等级不足"

// ── 采灵日志 ──
GET    /api/farm/steal-log/mine               → 我采了别人（采灵者视角）
GET    /api/farm/steal-log/stolen             → 别人采了我（owner 视角，含采灵者昵称）
         query: { page, pageSize, day? }

// ── 收藏 ──
POST   /api/farm/favorite                     → 收藏灵田（上限 30，后端校验）
         body: { targetCharacterId }
DELETE  /api/farm/favorite/:characterId        → 取消收藏
GET    /api/farm/favorites                    → 我的收藏列表
         response: { favorites: [{ characterId, nickname, farmLevel, favoritedAt, maturedPlotCount }] }

// ── SSE 推送 ──
GET    /api/farm/events?token=xxx             → 服务端推送（EventSource 长连接）
         event: farm:stolen                   → 被采灵通知
         event: farm:crop-mature              → 作物成熟通知
         event: farm:wither-warning           → 枯萎预警通知（成熟后 N 分钟未收获）
```

> **SSE 事件范围**：三个事件全部实现。`farm:crop-mature` 和 `farm:wither-warning` 由 `farmScheduler` 定时扫描触发（与枯萎检测调度器合并）。

### 11.7 前端设计扩展

#### 新增组件

```
new-client/src/components/FarmPage/
├── FarmPlaza.tsx                  # 灵田广场（公开灵田列表）
│   └── FarmPlazaCard.tsx          # 单个灵田卡片（头像、等级、成熟作物数）
├── FarmVisitView.tsx              # 访问他人灵田视图（只读 + 采灵按钮）
│   └── FarmPlotVisitCard.tsx      # 他人地块卡片（含"采灵"按钮 + 状态标记）
├── FarmStealLog.tsx               # 采灵日志面板（两个 Tab：我采的 / 被采的）
└── FarmStealToast.tsx             # 被采灵实时通知 toast

new-client/src/hooks/
├── useFarm.ts                     # 请求封装 + 轮询生长进度刷新
└── useFarmSse.ts                  # SSE 连接管理 hook
```

#### useFarmSse.ts — SSE 连接 Hook

```typescript
// 作用：管理 EventSource 生命周期，接收服务端推送事件
//
// 数据流：
// mount → 创建 EventSource(token) → 监听事件 → dispatch 到 Store
// unmount → eventSource.close()
//
// 性能考虑：
// - 整个 App 只维护一个 EventSource 连接，不在组件内重复创建
// - 使用 useRef 持有 EventSource 实例，避免重渲染
// - 连接断开时浏览器自动重连（EventSource 内置），无需手动处理

function useFarmSse(farmStore: FarmStore): void {
  // 1. mount 时：new EventSource('/api/farm/events?token=xxx')
  // 2. 监听事件：
  //    es.addEventListener('farm:stolen', (e) => {
  //      const data = JSON.parse(e.data);
  //      farmStore.onStolen(data);    // → 弹 toast + 红点标记
  //    })
  //    es.addEventListener('farm:crop-mature', (e) => { ... })
  //    es.addEventListener('farm:wither-warning', (e) => { ... })
  // 3. unmount 时：es.close()
}
```

**前端收到 SSE 事件后的行为：**

| 事件 | UI 反馈 |
|------|---------|
| `farm:stolen` | 弹出 toast "xxx 从你的灵田采走了 2 灵稻！" + 灵田 Tab 图标显示红点 |
| `farm:crop-mature` | 弹出 toast "你的灵稻已成熟，快去收获！" |
| `farm:wither-warning` | 弹出 toast "你的灵稻即将枯萎，还有 5 分钟！" |

#### 灵田广场页面布局

```
桌面端：
┌────────────────────────────────────────────────────┐
│ [灵田广场]                        [最近访问 ▼]      │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 剑仙李白  │  │ 散修张伟  │  │ 丹痴王某 │         │
│  │ Lv.3     │  │ Lv.2     │  │ Lv.4     │         │
│  │ 3块成熟   │  │ 1块成熟   │  │ 5块成熟   │         │
│  │ [探访 →] │  │ [探访 →] │  │ [探访 →] │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ ...      │  │ ...      │  │ ...      │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                    │
│              < 1 2 3 ... >                         │
└────────────────────────────────────────────────────┘

移动端：
┌───────────────────────┐
│ 灵田广场              │
├───────────────────────┤
│ ┌───────────────────┐ │
│ │ 剑仙李白  Lv.3    │ │
│ │ 3块成熟  [探访 →] │ │
│ ├───────────────────┤ │
│ │ 散修张伟  Lv.2    │ │
│ │ 1块成熟  [探访 →] │ │
│ ├───────────────────┤ │
│ │ ...               │ │
│ └───────────────────┘ │
│     < 1 2 3 ... >     │
└───────────────────────┘
```

#### 访问他人灵田视图

```
┌────────────────────────────────────────┐
│ [← 返回广场]   剑仙李白的灵田  Lv.3    │
├────────────────────────────────────────┤
│                                        │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ 灵稻   │  │ 焰心莲 │  │ 空地   │   │
│  │ 成熟 ✦ │  │ 成熟 ✦ │  │        │   │
│  │[采灵]  │  │[采灵]  │  │        │   │
│  └────────┘  └────────┘  └────────┘   │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ 落日莲 │  │ 金穗麦 │  │ 灵稻   │   │
│  │ 生长中 │  │ 成熟 ✦ │  │ 保护中 │   │
│  │        │  │[采灵]  │  │ 🔒5min │   │
│  └────────┘  └────────┘  └────────┘   │
│                                        │
│  今日已采: 3/20   对该主人: 1/3        │
├────────────────────────────────────────┤
│  [最近被采记录]                         │
│  10分钟前 · 散修张伟 · 采走灵稻 ×2     │
│  1小时前 · 丹痴王某 · 采走焰心莲 ×1    │
└────────────────────────────────────────┘

注：✦ 标记 = 可采灵状态
    🔒 = 保护期内不可采
    灰色 = 未成熟/已采满/已枯萎
```

### 11.8 采灵对经济系统的影响分析

#### 通缩设计（防止通胀）

- **灵气损耗**：采灵者获得 `floor(stealYieldPerHit × thiefGainRate)`，由于 `floor` 向下取整 + 20% 损耗，owner 损失与 thief 实得之间存在差值
- 净效果：每次采灵产生 `(stealYieldPerHit - floor(stealYieldPerHit × thiefGainRate)) × sellPrice` 的通缩

#### 数值示例

假设灵稻 sellPrice = 10，stealYieldPerHit = 2，thiefGainRate = 0.80：

| 角色 | 变动 |
|------|------|
| Owner（被采） | 收获时少 2 灵稻 → 少卖 20 灵石 |
| Thief（采灵者） | 获得 floor(2 × 0.80) = 1 灵稻 → 可卖 10 灵石 |
| 系统 | 净蒸发 10 灵石（通缩） |

> 通缩公式：`(2 - floor(2 × 0.8)) × 10 = (2 - 1) × 10 = 10` 灵石/次

#### 月卡联动（可选）

```jsonc
// monthCardConfig.json 扩展：
{
  "farmStealProtectionBps": 5000,   // 月卡持有者被采时，owner 损失减少 50%
  "farmStealImmunity": false         // 或：完全免疫采灵（更激进）
}
```

推荐温和方案：月卡持有者被采时，thief 获得的量减半（`thiefGainRate` 从 80% 降为 40%），owner 损失不变但 thief 收益降低，降低被月卡用户被针对的意愿。

### 11.9 新增流水 biz_type

```typescript
// SpiritStonesLedgerBizType 扩展：
| 'farm_steal_gain'       // 采灵所得（thief 出售采灵所得灵材时）
```

> 注意：采灵操作本身不产生灵石流动（只产生物资转移），灵石流水仅在 thief 出售灵材时产生。`farm_steal_record` 表记录的是物资流转，不是灵石流转。

### 11.10 风险与边界条件（采灵专项）

1. **并发采灵**：多人同时采同一地块。解决方案：`SELECT FOR UPDATE` 锁 `farm_plot`，串行化
2. **采灵时 owner 同时收获**：收获操作也锁同一行。谁先锁谁先执行。如果采灵先完成，owner 收获时看到更新后的 `steal_count`
3. ** harvest 与 steal 竞态**：收获和采灵都在事务内锁同一行，天然串行。无需额外处理
4. **每日计数跨日**：用 UTC 日期 + `farm_steal_record` 表 `COUNT` 实时查询（或 Redis `INCR` + TTL 86400 缓存）。推荐后者，高频查询不走 DB
5. **SSE 推送失败**：通知是非关键的，推送失败不影响采灵结果。EventSource 内置自动重连（默认 3s），断连期间的事件会丢失，但 owner 可在下次上线时通过采灵日志和红点标记查看。如果断连时间较长，前端回退到 30s 轮询 `steal-log/stolen` 兜底
6. **新号/小号刷采灵**：`minFarmLevelToSteal = 2` 阻止刚注册的角色采灵。`minFarmLevelToBeProtected = 1` 保护 1 级新手
7. **采灵者灵材仓库堆积**：采灵所得灵材与正常收获合并存储，共享 `farm_harvest_inventory`，无额外问题
8. **重复采灵同一成熟态**：`stealCooldownSeconds = 10` + `perTargetDailyLimit = 3` 双重限制
9. **灵田广场刷列表**：列表按"最近有成熟作物的优先"排序，但不暴露精确时间。恶意玩家无法通过列表定位"最佳偷菜时间"

### 11.11 与第六节收获流程的集成修改

原 6.2 收获流程需修改为：

```
玩家点击成熟的地块 → POST /api/farm/harvest { slotIndex }
  → 后端校验：（同原流程）
  → 后端执行：
    1. 随机 baseYield = random(yieldMin, yieldMax)
    2. 读取 steal_count
    3. stolenTotal = cropConfig.stealYieldPerHit × steal_count
    4. actualYield = max(baseYield - stolenTotal, 1)    // 保底 1
    5. 灵材仓库 quantity + actualYield
    6. farm_profile.farm_exp + expGain                   // 经验固定，不受被采灵影响
    7. farm_profile.harvest_count_by_crop[cropId] += 1
    8. 清地块：crop_id = NULL, planted_at = NULL, steal_count = 0
    9. 返回 { cropName, baseYield, actualYield, stolenTotal, expGain }
    // 注：升级由玩家主动调用 POST /api/farm/upgrade-level（需经验+息壤），非自动触发

注：
- expGain 固定由作物配置决定，不因被采灵而减少（种地经验来自"培育过程"而非"收获数量"）
- 即使 actualYield = 1（被采灵到保底），owner 仍获得全额经验
- stolenTotal 可能 > baseYield，此时 actualYield = 1（保底），stolenTotal 仍如实记录在返回值中
```

### 11.12 轻量社交：最近访问 + 收藏灵田

> **设计决策：不引入好友系统**。好友系统（请求/接受/黑名单/隐私/在线状态）是平台级能力，工程量大且当前项目无任何社交基础设施。通过"最近访问 + 收藏灵田"组合覆盖好友偷菜 80% 的体验，工程量不到好友系统的 1/5。

#### 11.12.1 最近访问

**用途**：覆盖"上次偷了一半还没偷完，下次快速回去"的回访需求。

**存储方案**：Redis ZSET（不入 DB）

```
Key:    farm:recent_visits:{characterId}
Type:   ZSET
Score:  访问时间戳（Unix 秒）
Member: targetCharacterId
TTL:    7 天（自动清理过期数据）
Max:    保留最近 20 条（ZREMRANGEBYRANK 0 -(MAX+1)）
```

**写入时机**：`GET /api/farm/visit/:characterId` 时自动记录（排除访问自己的灵田）。

**查询**：`ZREVRANGE farm:recent_visits:{characterId} 0 19 WITHSCORES` → 按时间倒序取前 20。

**性能**：O(log N) 写入 + O(K) 查询，K ≤ 20，可忽略。

**前端展示**：灵田广场页面顶部"最近访问"快捷入口区，横向滚动卡片。

#### 11.12.2 收藏灵田

**用途**：覆盖"固定偷几个人的"长期目标。相当于"好友"的轻量替代——单向关注，无需对方同意。

**存储方案**：DB 表（收藏是持久化行为，不适合纯 Redis）

```prisma
model farm_favorite {
  id                  Int      @id @default(autoincrement())
  character_id        Int                         // 收藏者
  target_character_id Int                         // 被收藏的灵田主人
  created_at          DateTime @default(now()) @db.Timestamp(6)

  @@unique([character_id, target_character_id])
  @@index([character_id])
}
```

**characters 表扩展**：

```prisma
  farm_favorites    farm_favorite[]    // 我收藏的
  farm_favorited_by farm_favorite[]    // 收藏我的（可选，用于反查）
```

**上限**：每人最多收藏 30 个灵田（防止刷收藏）。

**API**：

```
POST   /api/farm/favorite                     → 收藏（校验上限 30）
DELETE  /api/farm/favorite/:characterId        → 取消收藏
GET    /api/farm/favorites                    → 我的收藏列表（含各灵田成熟作物数）
```

**前端展示**：
- 访问他人灵田时，页面右上角"收藏/取消收藏"按钮（★/☆）
- 灵田广场页面"我的收藏"快捷入口区

#### 11.12.3 灵田广场整合

灵田广场页面整合三个数据源，分 Tab 或分区域展示：

```
┌────────────────────────────────────────────────────┐
│ [灵田广场]                                          │
├────────────────────────────────────────────────────┤
│                                                    │
│  ★ 我的收藏 (3)                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 剑仙李白  │  │ 丹痴王某  │  │ + 添加   │         │
│  │ Lv.3 2成熟│  │ Lv.4 5成熟│  │          │         │
│  │ [探访 →] │  │ [探访 →] │  │          │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                    │
│  🕐 最近访问 (5)                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ 散修张伟  │  │ 剑仙李白  │  │ ...      │         │
│  │ Lv.2 1成熟│  │ Lv.3 2成熟│  │          │         │
│  │ [探访 →] │  │ [探访 →] │  │          │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│                                                    │
│  🌾 全部灵田                          [排序 ▼]    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ ...      │  │ ...      │  │ ...      │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│              < 1 2 3 ... >                         │
└────────────────────────────────────────────────────┘

排序选项：
- 最近成熟（默认）：最近有作物成熟的排前面
- 可采灵优先：当前有可采灵地块的排前面
- 灵田等级：高等级排前面（可能有高价值作物）
```

**后端数据聚合**：

```
GET /api/farm/plaza 返回结构：

{
  tabs: {
    favorites: [                          // 最多 5 条，实时计算成熟作物数
      { characterId, nickname, farmLevel, maturedPlotCount, stealablePlotCount }
    ],
    recentVisits: [                       // 最多 5 条
      { characterId, nickname, farmLevel, maturedPlotCount, visitedAt }
    ],
    all: {                                // 分页
      farms: [...],
      total,
      hasMore
    }
  }
}
```

**性能考虑**：

- 收藏 + 最近访问最多各 5 条，合并查询
- 成熟作物数通过 `farm_plot WHERE character_id IN (...) AND crop_id IS NOT NULL AND 已成熟条件` 批量查询
- 收藏列表和最近访问列表可以一次 SQL 搞定（UNION 或两次轻量查询）
- 全部列表分页查询独立，不影响快捷入口

**"全部灵田"列表性能策略**：

对每行实时计算"成熟作物数"在玩家量增长后可能成为瓶颈（N 玩家 × 6 地块 = 6N 行逐行计算）。分层策略：

| 层级 | 方案 | 适用阶段 |
|------|------|----------|
| L1（当前） | 实时 SQL 计算 + 分页（pageSize ≤ 20） | 在线 ≤ 200 人 |
| L2 | 在 `farm_profile` 新增 `last_matured_at` 冗余字段，收获/种植时更新。广场按此字段粗排序，不精确计算成熟数 | 在线 200~2000 |
| L3 | Redis ZSET `farm:plaza_rank` 定时（每分钟）更新排序分 = 最近 24h 活跃种植数 | 在线 > 2000 |

当前实现 L1。`farmDtoBuilder.buildPlazaDto()` 封装计算逻辑，后续升级时只替换此函数内部实现。

#### 11.12.4 与采灵系统的交互

**收藏不提供任何特殊权限**——收藏只是快捷入口，不改变采灵规则：

- 收藏的人照样受保护期、冷却、每日上限约束
- 收藏不等于好友，对方不会收到通知
- 对方可以收藏你，也可以采你的灵田（双向独立）

**唯一联动**：灵田广场排序时，"可采灵优先"排序中，如果有多个灵田都可采灵，收藏的排在前面（同优先级内收藏优先）。

#### 11.12.5 前端组件补充

```
new-client/src/components/FarmPage/
├── FarmPlaza.tsx                  # 增加三个区域：收藏 / 最近访问 / 全部
│   ├── FarmFavoriteSection.tsx    # 收藏区（横向滚动卡片）
│   ├── FarmRecentVisitSection.tsx # 最近访问区（横向滚动卡片）
│   └── FarmPlazaCard.tsx          # 通用灵田卡片（三个区域复用）
├── FarmVisitView.tsx              # 增加收藏按钮（★/☆）
```

```typescript
// new-client/src/stores/FarmStore.ts 新增：
@observable favorites: FarmBriefDto[]       // 收藏列表
@observable recentVisits: FarmBriefDto[]    // 最近访问列表

@action toggleFavorite(targetCharacterId)   // 收藏/取消收藏
@action loadPlaza()                         // 加载整合广场数据
```

#### 11.12.6 未来升级路径

如果后续出现第二个需要社交的玩法，再升级为平台级好友系统：

```
轻量社交（当前）              →    好友系统（未来）
─────────────────                  ──────────────
farm_favorite 表               →    friend 表（双向 + 状态）
recent_visits Redis            →    保留（好友系统也需要最近互动）
灵田广场内嵌快捷入口            →    独立"好友列表"页面
单向关注                        →    双向好友 + 在线状态
无通知                         →    好友请求通知（SSE）
```

`farm_favorite` 表结构可以平滑迁移为 `friend` 表的子集（加 `status` 字段区分 pending/accepted），不需要重建。
