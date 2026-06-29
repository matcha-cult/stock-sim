# 百业（工厂）系统 1.0 设计文档

## 一、系统定位

百业系统是独立于股市行情、收租系统的第三个核心经济子系统。玩家作为「厂主」开工厂，每个 tick 系统自动完成「消耗原材料库存 → 生产 → 产出产品 → 按系统价格结算」的闭环。原材料需玩家提前从系统商城批量采购入库，每 tick 从库存扣减。玩家可控制两个策略维度：

1. **囤积 / 抛售策略**：产品产出后可不随 tick 自动出售，等系统价格上涨后手动抛售
2. **开工 / 停工控制**：灵机随时可停工止损，停工期间不消耗原材料、灵机能量和傀儡驱动灵石

核心风险：原材料价格波动，产品价格有涨有跌，灵机能量和傀儡驱动消耗灵石，工厂可能持续亏本。原材料需在系统商城按最小交易单位批量采购，需提前备货。

---

## 二、数据库表设计（Prisma Schema）

### 2.1 新增表

#### `industry_tick` — 百业系统独立 tick 记录

与 `stock_market_tick`、`shop_tick` 完全解耦，可独立配置 tick 间隔。

```prisma
model industry_tick {
  id            BigInt   @id @default(autoincrement())
  tick_hour     DateTime @unique @db.Timestamp(6)
  status        String   @db.VarChar(20)         // running/generated/failed
  error_message String?
  created_at    DateTime @default(now()) @db.Timestamp(6)
  finished_at   DateTime? @db.Timestamp(6)
}
```

#### `industry_material_price` — 原材料系统价格

每个 tick 由系统刷新一次，所有玩家看到的原材料价格一致。

```prisma
model industry_material_price {
  material_id          String   @id @db.VarChar(50)   // 如 "IRON_ORE", "WOOD", "HERB"
  price_per_unit       BigInt                          // 1 个最小交易单位的价格（分），如糖 1000 份 = 1750 分
  min_sell_qty         Int                             // 最小交易单位（份），商城进货/卖回都必须是此值整数倍
  change_bps           Int      @default(0)            // 相对上 tick 的涨跌基点
  last_tick_id         BigInt?
  updated_at           DateTime @default(now()) @db.Timestamp(6)
}
```

#### `industry_product_price` — 产品系统价格

每个 tick 由系统刷新一次，所有玩家看到的出售价格一致。

```prisma
model industry_product_price {
  product_id           String   @id @db.VarChar(50)   // 如 "IRON_SWORD", "WOOD_TABLE", "HEALTH_PILL"
  price_per_unit       BigInt                          // 单位价格（分）
  change_bps           Int      @default(0)
  last_tick_id         BigInt?
  updated_at           DateTime @default(now()) @db.Timestamp(6)
}
```

#### `industry_machine` — 灵机实例

每个工厂可安装多台灵机，灵机数量无上限。一台灵机对应一条生产线，灵机等级决定产出加成。

```prisma
model industry_machine {
  id                   BigInt   @id @default(autoincrement())
  factory_id           BigInt
  character_id         Int
  machine_type         String   @db.VarChar(50)       // 灵机类型，如 "FORGING_MACHINE"
  upgrade_level        Int      @default(1)           // 当前等级（1 = 基础机）
  status               String   @db.VarChar(20) @default("installed") // installed/running/stopped
  recipe_id            String   @db.VarChar(50)       // 当前绑定配方
  puppet_count         Int      @default(0)           // 分配到该灵机的傀儡数（≥1 才可开工）
  created_at           DateTime @default(now()) @db.Timestamp(6)
  updated_at           DateTime @updatedAt @db.Timestamp(6)

  factory              industry_factory @relation(fields: [factory_id], references: [id], onDelete: Cascade)

  @@index([factory_id])
  @@index([character_id, machine_type])
}
```

#### `industry_machine_price` — 灵机系统价格

灵机购买和升级价格由系统维护，所有玩家看到的价格一致。

```prisma
model industry_machine_price {
  machine_type         String   @id @db.VarChar(50)
  upgrade_from         Int                             // 从几级升（0 = 购买新机）
  upgrade_to           Int                             // 升到几级
  price                BigInt                          // 升级/购买价格（分）
  last_tick_id         BigInt?
  updated_at           DateTime @default(now()) @db.Timestamp(6)

  @@unique([machine_type, upgrade_from])
}
```

#### `industry_factory` — 玩家工厂实例

每个玩家可拥有多个工厂（同类型最多 1 个，类比店铺每种类型 1 间）。工厂建好后需安装灵机才能运行生产线，所有灵机共享同一个仓库（产品库存 + 原材料库存）。

```prisma
model industry_factory {
  id                   BigInt   @id @default(autoincrement())
  character_id         Int
  factory_type         String   @db.VarChar(50)       // 工厂类型
  status               String   @db.VarChar(20) @default("stopped") // stopped/running
  total_puppets        Int      @default(0)           // 工厂总傀儡数（分配到各灵机）
  auto_sell_ratio      Int      @default(100)         // 自动出售比例（百分比），0 = 关闭，100 = 全部
  material_inventory   Json     @default("{}")        // 原材料仓库：{"材料ID": {"qty": 份数, "cost_basis": 累计采购成本(分)}, ...}
  product_inventory    Json     @default("{}")        // 产品仓库：{"产品ID": 份数, ...}
  total_product_sold   Int      @default(0)           // 累计已出售产品数量（统计用）
  total_revenue        BigInt   @default(0)           // 累计销售收入（分）
  total_cost           BigInt   @default(0)           // 累计投入成本（分），含 startup_cost + 灵机采购 + 每 tick 材料 + 灵机能量 + 傀儡驱动
  last_tick_id         BigInt?                         // 上一次结算的 tick ID
  created_at           DateTime @default(now()) @db.Timestamp(6)
  updated_at           DateTime @updatedAt @db.Timestamp(6)

  character            characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@unique([character_id, factory_type])
  @@index([character_id])
  @@index([status])
}
```

#### `industry_recipe_material` — 配方所需原材料（一对多）

一个配方消耗多种原材料。

```prisma
model industry_recipe_material {
  id                   BigInt   @id @default(autoincrement())
  recipe_id            String   @db.VarChar(50)
  material_id          String   @db.VarChar(50)
  quantity_per_tick    Int                             // 每 tick 消耗数量
  created_at           DateTime @default(now()) @db.Timestamp(6)

  @@unique([recipe_id, material_id])
  @@index([recipe_id])
}
```

#### `industry_recipe` — 配方定义（静态，由 JSON 配置驱动）

定义「哪些原材料」产出「什么产品」。灵机绑定配方，每台灵机独立绑定一个配方。

```prisma
model industry_recipe {
  recipe_id            String   @id @db.VarChar(50)   // 如 "SWORD_FORGE", "WOOD_CRAFT"
  product_id           String   @db.VarChar(50)       // 产出产品 ID
  output_per_tick      Int                             // 每台灵机每 tick 基础产出数量
  min_puppets_per_machine Int                            // 灵机开工最低傀儡数
  allowed_machine_types String[] @db.VarChar(50)[]    // 允许使用此配方的灵机类型列表
  created_at           DateTime @default(now()) @db.Timestamp(6)
}
```

每个工厂对应一个对公账户，工厂所有收支均通过此账户。账户余额为工厂独立资产，与玩家个人灵石分离。

```prisma
model industry_factory_wallet {
  id                   BigInt   @id @default(autoincrement())
  factory_id           BigInt
  character_id         Int
  balance              BigInt   @default(0)           // 账户余额（分）
  total_deposit        BigInt   @default(0)           // 累计从个人账户转入（分）
  total_withdraw       BigInt   @default(0)           // 累计从账户转出到个人（分）
  total_tax_paid       BigInt   @default(0)           // 累计已缴税款（分）
  created_at           DateTime @default(now()) @db.Timestamp(6)
  updated_at           DateTime @updatedAt @db.Timestamp(6)

  factory              industry_factory @relation(fields: [factory_id], references: [id], onDelete: Cascade)

  @@unique([factory_id])
  @@index([character_id])
}
```

#### `industry_ledger` — 工厂对公账户流水

记录对公账户的每一笔收支，用于破产清算、玩家查账、GM 审计。

```prisma
model industry_ledger {
  id                   BigInt   @id @default(autoincrement())
  factory_id           BigInt
  character_id         Int
  factory_type         String   @db.VarChar(50)
  biz_type             String   @db.VarChar(32)       // 收支类型（见下方 biz_type 枚举表）
  amount               BigInt                          // 变动金额（分），正数=收入，负数=支出
  balance_after        BigInt                          // 变动后账户余额（分）
  ref_id               BigInt?                         // 关联记录 ID（如 production_log ID、trade_record ID）
  ref_type             String?  @db.VarChar(32)       // 关联记录类型
  note                 String?  @db.VarChar(500)      // 备注（GM 审计用，破产清算等复杂操作需记录完整明细）
  created_at           DateTime @default(now()) @db.Timestamp(6)

  @@index([factory_id, created_at])
  @@index([character_id, created_at])
  @@index([biz_type, created_at])
}
```

**biz_type 枚举**：

| biz_type | 说明 | 方向 |
| --- | --- | --- |
| `startup_cost` | 开工建厂（一次性投入） | 支出 |
| `machine_buy` | 购买灵机（一次性） | 支出 |
| `machine_upgrade` | 灵机升级 | 支出 |
| `machine_energy` | 灵机每 tick 能量消耗 | 支出 |
| `material_buy` | 商城采购原材料 | 支出 |
| `material_sell` | 原材料卖回商城 | 收入 |
| `puppet_drive` | 支付傀儡驱动灵石 | 支出 |
| `auto_sell` | tick 自动出售产品 | 收入 |
| `manual_sell` | 手动抛售产品 | 收入 |
| `fee` | 交易手续费扣除 | 支出 |
| `personal_deposit` | 从个人账户转入 | 收入 |
| `personal_withdraw` | 转出到个人账户 | 支出 |
| `withdraw_tax` | 对公→个人转账税费 | 支出 |
| `incident_loss` | 异常事件损失（灵机故障/维修费） | 支出 |
| `bankruptcy_settle` | 破产清算转入个人账户（扣除税费后剩余） | 特殊 |

#### `industry_production_log` — 生产记录（用于追溯与玩家查看）

记录每个 tick 每座工厂的生产明细，包含灵机能量消耗、傀儡驱动成本。

```prisma
model industry_production_log {
  id                   BigInt   @id @default(autoincrement())
  character_id         Int
  factory_id           BigInt
  factory_type         String   @db.VarChar(50)
  tick_id              BigInt
  material_cost        BigInt                          // 本 tick 原材料消耗折算成本（分，按加权平均采购成本折算，仅用于生产记录展示，不重复扣灵石）
  energy_cost          BigInt                          // 本 tick 灵机能量灵石消耗（分）
  puppet_cost          BigInt                          // 本 tick 傀儡驱动灵石消耗（分）
  total_cost           BigInt                          // 本 tick 总成本（分）= material_cost + energy_cost + puppet_cost
  output_quantity      Int                             // 本 tick 总产出数量（含灵机等级加成）
  base_output_quantity Int                             // 本 tick 基础产出（无灵机等级加成）
  machine_bonus_bps    Int      @default(0)            // 灵机等级加成基点
  auto_sold_quantity   Int      @default(0)            // 本 tick 自动出售数量
  auto_sold_revenue    BigInt   @default(0)            // 本 tick 自动出售收入（分）
  material_consumed    Json     @default("{}")        // 本 tick 消耗的原材料：{"材料ID": 份数, ...}
  product_inventory_after Json  @default("{}")        // 本 tick 结束后产品库存
  profit_loss          BigInt                          // 本 tick 盈亏（分）= revenue - cost
  incident_type        String?  @db.VarChar(30)       // 异常事件类型（material_shortage/balance_shortage/null）
  incident_detail      String?  @db.VarChar(500)      // 事件详情描述
  created_at           DateTime @default(now()) @db.Timestamp(6)

  character            characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@index([character_id, created_at])
  @@index([factory_id, created_at])
  @@index([tick_id])
}
```

#### `industry_trade_record` — 玩家手动出售记录

玩家手动抛售库存产品时写入，类比 `stock_market_trade_record`。

```prisma
model industry_trade_record {
  id                   BigInt   @id @default(autoincrement())
  character_id         Int
  factory_type         String   @db.VarChar(50)
  product_id           String   @db.VarChar(50)
  quantity             Int
  unit_price           BigInt                          // 成交时系统价格（分）
  gross_revenue        BigInt                          // 毛收入（分）
  fee                  BigInt   @default(0)            // 手续费（分）
  net_revenue          BigInt                          // 净收入（分）
  created_at           DateTime @default(now()) @db.Timestamp(6)

  character            characters @relation(fields: [character_id], references: [id], onDelete: Cascade)

  @@index([character_id, created_at])
  @@index([factory_type, created_at])
}
```

### 2.2 复用现有表

**`characters`** — 灵石扣减复用 `spirit_stones` 列。个人与对公账户之间的转账通过 `spirit_stones_ledger` 记录。

**`spirit_stones_ledger`** — 仅记录个人账户与对公账户之间的转账：

| biz_type | 说明 |
| --- | --- |
| `industry_deposit` | 个人灵石 → 工厂对公账户（转入） |
| `industry_withdraw` | 工厂对公账户 → 个人灵石（转出，扣税后到账） |

工厂内部所有收支（采购、灵机能量、傀儡驱动、出售、手续费、事件损失等）通过 `industry_ledger` 记录，不再写入 `spirit_stones_ledger`。

**`spirit_stones_ledger.biz_type`** 需从 `@db.VarChar(32)` 扩展到能容纳上述新值（现有最长 `stock_sell` = 10 字符，新值最长 `industry_manual_sell` = 20 字符，32 足够）。

**`spirit_stones_ledger` 转账关联约定**：当 biz_type 为 `industry_deposit` 或 `industry_withdraw` 时，`ref_type = 'industry_factory'`，`ref_id = industry_factory.id`，`note` 中携带工厂类型（如 `"factory_id=3, type=IRONWORKS"`），以便 GM 从个人账户流水追溯到具体工厂。

---

## 三、静态配置（JSON）

配置按维度拆分为多个文件，存放于 `server/data/seeds/industry/` 目录下，各自独立维护：

| 文件 | 内容 |
| --- | --- |
| `materials.json` | 原材料定义 |
| `products.json` | 产品定义 |
| `factories.json` | 工厂类型定义 |
| `machines.json` | 灵机类型 + 价格 + 升级配置 |
| `recipes.json` | 配方 + 原材料消耗 |
| `puppets.json` | 灵机傀儡配置 |

加载时通过 `staticConfigLoader` 统一读取，合并为完整配置。每个文件根 key 与文件名一致。

### 原材料（`materials.json`）

```json
[
  { "id": "IRON_ORE", "name": "铁矿石", "base_price": 5000, "volatility_bps": 300, "min_sell_qty": 10, "price_min": 500, "price_max": 25000, "enabled": true },
  { "id": "WOOD", "name": "木材", "base_price": 3000, "volatility_bps": 200, "min_sell_qty": 20, "price_min": 300, "price_max": 15000, "enabled": true },
  { "id": "HERB", "name": "灵草", "base_price": 8000, "volatility_bps": 500, "min_sell_qty": 5, "price_min": 800, "price_max": 40000, "enabled": true },
  { "id": "SUGAR", "name": "糖", "base_price": 1750, "volatility_bps": 1500, "min_sell_qty": 1000, "price_min": 1500, "price_max": 2000, "enabled": true },
  { "id": "CLAY", "name": "陶土", "base_price": 2000, "volatility_bps": 150, "min_sell_qty": 50, "price_min": 200, "price_max": 10000, "enabled": true },
  { "id": "FLOUR", "name": "面粉", "base_price": 2500, "volatility_bps": 200, "min_sell_qty": 500, "price_min": 250, "price_max": 12500, "enabled": true },
  { "id": "MUNG_BEAN", "name": "绿豆", "base_price": 3000, "volatility_bps": 250, "min_sell_qty": 500, "price_min": 300, "price_max": 15000, "enabled": true }
]
```

### 产品（`products.json`）

```json
[
  { "id": "IRON_SWORD", "name": "铁剑", "base_price": 20000, "volatility_bps": 400, "min_sell_qty": 10, "price_min": 2000, "price_max": 100000, "enabled": true },
  { "id": "IRON_ARMOR", "name": "铁甲", "base_price": 50000, "volatility_bps": 350, "min_sell_qty": 5, "price_min": 5000, "price_max": 250000, "enabled": true },
  { "id": "WOOD_TABLE", "name": "木桌", "base_price": 12000, "volatility_bps": 250, "min_sell_qty": 5, "price_min": 1200, "price_max": 60000, "enabled": true },
  { "id": "WOOD_CHAIR", "name": "木椅", "base_price": 8000, "volatility_bps": 200, "min_sell_qty": 10, "price_min": 800, "price_max": 40000, "enabled": true },
  { "id": "HEALTH_PILL", "name": "回灵丹", "base_price": 35000, "volatility_bps": 600, "min_sell_qty": 1, "price_min": 3500, "price_max": 175000, "enabled": true },
  { "id": "SUGAR_CAKE", "name": "糖糕", "base_price": 500, "volatility_bps": 200, "min_sell_qty": 1000, "price_min": 50, "price_max": 2500, "enabled": true },
  { "id": "HERB_CAKE", "name": "灵草糕", "base_price": 800, "volatility_bps": 300, "min_sell_qty": 500, "price_min": 80, "price_max": 4000, "enabled": true },
  { "id": "CLAY_POT", "name": "陶罐", "base_price": 6000, "volatility_bps": 200, "min_sell_qty": 20, "price_min": 600, "price_max": 30000, "enabled": true },
  { "id": "MUNG_BEAN_CAKE", "name": "绿豆糕", "base_price": 1200, "volatility_bps": 300, "min_sell_qty": 500, "price_min": 120, "price_max": 6000, "enabled": true }
]
```

### 工厂类型（`factories.json`）

每种工厂类型建好后需安装对应灵机才能运行。灵机类型与工厂类型一一对应。

```json
[
  { "type": "SMELTING", "name": "冶炼炉", "startup_cost": 5000, "max_puppets": 16 },
  { "type": "FORGING",  "name": "锻造台", "startup_cost": 4000, "max_puppets": 20 },
  { "type": "ALCHEMY",  "name": "炼丹炉", "startup_cost": 7000, "max_puppets": 10 }
]
```

### 灵机（`machines.json`）

灵机是工厂的生产核心，每台灵机对应一条生产线。工厂内灵机数量无上限，灵机可升级。初期灵机仅商城购买，后期开放灵机生产线自造。

```json
[
  {
    "machine_type": "SMELTING_MACHINE",
    "name": "冶炼机",
    "factory_type": "SMELTING",
    "base_price": 5000,
    "upgrade_cost_multiplier": 1.5,
    "output_per_level_bps": 2000,
    "max_upgrade_level": 10,
    "description": "冶炼矿石，产出金属锭、灵银等",
    "energy_per_tick": 800
  },
  {
    "machine_type": "FORGING_MACHINE",
    "name": "锻造机",
    "factory_type": "FORGING",
    "base_price": 4000,
    "upgrade_cost_multiplier": 1.5,
    "output_per_level_bps": 2000,
    "max_upgrade_level": 10,
    "description": "锻造金属，产出飞剑、法杖、护甲等",
    "energy_per_tick": 1000
  },
  {
    "machine_type": "ALCHEMY_MACHINE",
    "name": "炼丹机",
    "factory_type": "ALCHEMY",
    "base_price": 7000,
    "upgrade_cost_multiplier": 1.7,
    "output_per_level_bps": 2500,
    "max_upgrade_level": 10,
    "description": "炼制丹药，产出回灵丹、灵液等",
    "energy_per_tick": 1200
  }
]
```

### 配方（`recipes.json`）

```json
[
  {
    "recipe_id": "INGOT_SMELT",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["SMELTING_MACHINE"],
    "materials": []
  },
  {
    "recipe_id": "SILVER_REFINE",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["SMELTING_MACHINE"],
    "materials": []
  },
  {
    "recipe_id": "SWORD_FORGE",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["FORGING_MACHINE"],
    "materials": []
  },
  {
    "recipe_id": "ARMOR_FORGE",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["FORGING_MACHINE"],
    "materials": []
  },
  {
    "recipe_id": "PILL_REFINING",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["ALCHEMY_MACHINE"],
    "materials": []
  },
  {
    "recipe_id": "ELIXIR_BREW",
    "product_id": "",
    "output_per_tick": 0,
    "min_puppets_per_machine": 1,
    "allowed_machine_types": ["ALCHEMY_MACHINE"],
    "materials": []
  }
]
```

### 灵机傀儡（`puppets.json`）

不同类型工厂的灵机傀儡驱动成本不同。傀儡无需工资、无满意度，只需消耗灵石驱动。

```json
[
  { "factory_type": "SMELTING", "base_cost_per_puppet": 1500, "max_puppets": 16 },
  { "factory_type": "FORGING",  "base_cost_per_puppet": 1200, "max_puppets": 20 },
  { "factory_type": "ALCHEMY",  "base_cost_per_puppet": 2000, "max_puppets": 10 }
]
```

每个傀儡每 tick 消耗 `base_cost_per_puppet` 灵石（分）。工厂总傀儡成本 = Σ(各灵机傀儡数 × base_cost_per_puppet)。

### 3.1 配置字段说明

| 字段 | 含义 | 单位 |
| --- | --- | --- |
| `materials.base_price` | 原材料基准价（1 个最小交易单位的价格） | 分，如糖 1750 = 17.50 灵石 / 1000 份 |
| `materials.volatility_bps` | 原材料价格波动幅度上限 | 基点 |
| `materials.min_sell_qty` | 原材料最小交易单位（商城进货/卖回都必须是此值整数倍） | 份 |
| `materials.price_min` | 价格下限（1 个最小交易单位的最低价格） | 分 |
| `materials.price_max` | 价格上限（1 个最小交易单位的最高价格） | 分 |
| `products.base_price` | 产品基准价（每份产品的系统价格） | 分 |
| `products.volatility_bps` | 产品价格波动幅度上限 | 基点 |
| `products.min_sell_qty` | 产品最小交易单位（手动 / 自动出售必须为整数倍） | 份 |
| `products.price_min` | 价格下限 | 分 |
| `products.price_max` | 价格上限 | 分 |
| `factories.startup_cost` | 开工成本（一次性计入 `total_cost`） | 灵石 |
| `factories.max_puppets` | 工厂可配置傀儡上限（分配到所有灵机） | 个 |
| `machines.base_price` | 灵机购买价格（新机） | 灵石 |
| `machines.upgrade_cost_multiplier` | 升级成本递增倍率 | 倍率 |
| `machines.output_per_level_bps` | 每升 1 级产出加成基点 | 基点（2000 = +20%） |
| `machines.max_upgrade_level` | 灵机最高可升等级 | 级 |
| `machines.energy_per_tick` | 灵机开工时每 tick 能量消耗（灵石从对公账户扣减） | 分，如 1000 = 10.00 灵石 |
| `recipes.output_per_tick` | 每台灵机每 tick 基础产出数量 | 个 |
| `recipes.min_puppets_per_machine` | 灵机开工最低傀儡数 | 个 |
| `recipes.allowed_machine_types` | 允许使用此配方的灵机类型列表 | 数组 |
| `puppets.base_cost_per_puppet` | 每个傀儡每 tick 驱动灵石消耗 | 分，如 1500 = 15.00 灵石 |
| `puppets.max_puppets` | 该类型工厂可配置傀儡上限 | 个 |

---

## 四、核心业务流程

### 4.1 开工建厂

```text
玩家选择工厂类型 → 校验个人灵石 ≥ startup_cost → 扣除个人灵石
→ INSERT industry_factory (status='stopped', total_puppets=0, ...)
→ INSERT industry_factory_wallet (balance=startup_cost, total_deposit=startup_cost)
→ INSERT industry_ledger: startup_cost
→ INSERT spirit_stones_ledger: industry_deposit
→ 工厂状态 stopped，此时无灵机 → 无法启动，需先购买灵机
```

开工建厂后不立即生产，需购买灵机、配置傀儡、启动灵机后才开始结算。

### 4.2 配置 / 解配傀儡 & 分配到灵机

```text
玩家调整工厂总傀儡数量 → 校验 0 ≤ total_puppets ≤ max_puppets
→ UPDATE industry_factory SET total_puppets = N
→ 灵石增减（配置傀儡扣灵石，解配傀儡不发补偿）
→ 玩家手动将傀儡分配到各灵机
→ 各灵机 puppet_count 之和必须 ≤ factory.total_puppets
→ 傀儡数量/分配变化不影响当 tick，下一 tick 生效
```

### 4.2.1 购买 / 安装灵机

```text
玩家选择工厂 + 灵机类型 → 校验工厂类型匹配 + 对公账户余额 ≥ base_price
→ 对公账户扣除购买款（industry_ledger: machine_buy）
→ INSERT industry_machine (factory_id, machine_type, upgrade_level=1, recipe_id=默认配方, puppet_count=0)
→ 灵机默认绑定该类型第一个可用配方（按 recipes.allowed_machine_types 匹配）
→ 灵机初始状态 installed，需配置傀儡后手动启动
```

### 4.2.2 升级灵机

```text
玩家选择灵机 → 校验 upgrade_level < max_upgrade_level + 对公账户余额 ≥ 升级费用
→ 升级费用 = floor(base_price × upgrade_cost_multiplier ^ (upgrade_level - 1))
→ 对公账户扣除升级款（industry_ledger: machine_upgrade）
→ UPDATE industry_machine SET upgrade_level = N + 1
→ 产出加成立即生效，下一 tick 结算时应用新等级
```

### 4.2.3 切换灵机配方

```text
玩家选择灵机 + 新配方 → 校验新配方 allowed_machine_types 包含该灵机类型
→ UPDATE industry_machine SET recipe_id = 新配方
→ 切换后下一 tick 生效
```

### 4.2.4 配置灵机傀儡

```text
玩家选择灵机 + 傀儡数量 → 校验 puppet_count ≥ 0
→ 校验各灵机 puppet_count 之和 ≤ factory.total_puppets
→ UPDATE industry_machine SET puppet_count = N
→ 傀儡数量变化不影响当 tick，下一 tick 生效
```

### 4.2.4 商城购买 / 卖回原材料

```text
玩家选择材料 ID + 数量 → 校验 quantity ≥ min_sell_qty 且为 min_sell_qty 的整数倍
→ 校验对公账户余额 ≥ quantity / min_sell_qty × price_per_unit（购买时）
→ 读取当前 industry_material_price[material_id].price_per_unit

购买：
  → 对公账户扣除采购款（industry_ledger: material_buy）
  → 更新原材料仓库：
     old = factory.material_inventory[material_id] ?? {qty: 0, cost_basis: 0}
     new_cost_basis = old.cost_basis + quantity × price_per_unit
     new_qty = old.qty + quantity
     factory.material_inventory[material_id] = {qty: new_qty, cost_basis: new_cost_basis}

卖回：
  → 校验 factory.material_inventory[material_id].qty ≥ quantity
  → 按当前 price_per_unit 计算 gross_revenue
  → 计算加权平均成本：avg_cost = factory.material_inventory[material_id].cost_basis / factory.material_inventory[material_id].qty
  → 回收成本 = quantity × avg_cost
  → gross_revenue 加入对公账户（industry_ledger: material_sell）
  → 更新原材料仓库：
     new_qty = old.qty - quantity
     new_cost_basis = old.cost_basis - 回收成本
     factory.material_inventory[material_id] = {qty: new_qty, cost_basis: new_cost_basis}
```

注意：原材料卖回不收取手续费（类比产品手动出售收取微量手续费，但材料卖回免费，降低玩家调整库存的成本）。

### 4.3 生产 Tick 结算（核心循环）

每个 tick，调度器遍历所有 `status='running'` 的工厂，执行以下步骤：

```text
for each running factory:
  ── 阶段 A：灵机开工校验 ──
  1. 汇总所有运行中灵机的原材料需求、灵机能量消耗 & 傀儡成本:
     total_material_needed = {material_id: 0, ...}
     total_energy_cost = 0
     total_puppet_cost = 0
     for each machine where machine.status = 'running':
       IF machine.puppet_count < recipe.min_puppets_per_machine: 该机停工，跳过
       total_energy_cost += machine_config.energy_per_tick
       for each material in recipe:
         total_material_needed[material_id] += quantity_per_tick
       total_puppet_cost += machine.puppet_count × base_cost_per_puppet

  2. 校验原材料库存:
     for each material_id in total_material_needed:
       inv = factory.material_inventory[material_id] ?? {qty: 0, cost_basis: 0}
       IF inv.qty < total_material_needed[material_id]:
         → 原材料不足，该机/全线停工
         记录 production_log (profit_loss 为负，output=0)，记录 incident_type = "material_shortage"
         跳过后续步骤

  3. 检查对公账户余额（需支付灵机能量消耗 + 傀儡驱动灵石）:
     total_operating_cost = total_energy_cost + total_puppet_cost
     IF wallet.balance < total_operating_cost:
       → 尝试用已有产品库存抵成本:
          - 按 min_sell_qty 整数倍自动出售部分产品库存直到够支付或库存清空，收入进入对公账户
       → 若仍不够 → 工厂强制停工 (status='stopped')
          - 记录 production_log (profit_loss 为负，output=0)
          - 产品库存和原材料库存保留，玩家可向对公账户充值后重新开工

  ── 阶段 B：原材料消耗 & 产出 ──
  4. 从原材料库存扣减消耗量:
     for each material_id in total_material_needed:
       inv = factory.material_inventory[material_id]
       avg_cost = inv.qty > 0 ? inv.cost_basis / inv.qty : 0  // 加权平均单位成本，除零保护
       consumed_cost = total_material_needed[material_id] × avg_cost
       inv.qty -= total_material_needed[material_id]
       inv.cost_basis -= consumed_cost
       IF inv.qty <= 0: inv.qty = 0; inv.cost_basis = 0  // 防止浮点残差累积
       // 记录消耗明细到 production_log.material_consumed

  5. 对公账户扣除灵机能量消耗（industry_ledger: machine_energy）
  6. 对公账户扣除傀儡驱动灵石（industry_ledger: puppet_drive）

  7. 每台运行中的灵机产出:
     machine_bonus_bps = (machine.upgrade_level - 1) × output_per_level_bps
     output = floor(recipe.output_per_tick × (1 + machine_bonus_bps / 10000))
     factory.product_inventory[product_id] += output  // 按产品 ID 累加到产品仓库

  8. 可选：自动出售模式 → 按工厂级 auto_sell_ratio 出售产品仓库中各产品的部分库存
     - 遍历 product_inventory 中每个 product_id，按工厂的 auto_sell_ratio 计算该产品应出售数量 = floor(库存 × auto_sell_ratio / 100)
     - 校验：出售数量必须为该产品的 min_sell_qty 的整数倍且 ≥ min_sell_qty，不足则向下取最大整数倍
     - 不足 min_sell_qty 的部分留在仓库中，不强制出售
     - 按当前 product_price 计算收入（按产品 ID 分别计算）
     - tick 自动出售免手续费（见 4.5）
     - 收入进入对公账户（industry_ledger: auto_sell）

  9. 记录 production_log（含灵机等级加成、灵机能量消耗、傀儡驱动成本、原材料消耗明细）
```

#### 关键设计：库存抵成本机制

这是防止工厂因对公账户余额不足而永久停摆的容错设计。当对公账户余额不足以支付当 tick 的灵机能量 + 傀儡驱动灵石时：

1. 系统自动按当前产品价格出售产品仓库中各产品的一部分库存
2. 每种产品的出售数量必须是该产品的 `min_sell_qty` 的整数倍，不足整数倍的部分留在仓库
3. 所得灵石用于支付当 tick 灵机能量 + 傀儡驱动
4. 如果全部产品库存卖出仍不够 → 工厂停工，剩余产品库存和原材料库存均保留
5. 停工后玩家需向对公账户充值才能重新开工

注意：原材料库存**不参与**抵成本，因为原材料是已购资产，玩家可能高价囤积，系统不应强制折价变现。

### 4.4 玩家手动抛售

```text
玩家选择工厂 + 产品 ID → 输入卖出数量 → 校验 quantity ≤ factory.product_inventory[product_id]
→ 校验：quantity 必须是 min_sell_qty 的整数倍且 ≥ min_sell_qty，否则拒绝
→ 读取当前 product_price
→ 计算 gross_revenue = quantity × price_per_unit
→ 扣除手续费（见 4.5），手续费从 gross_revenue 中扣减
→ net_revenue 进入对公账户（industry_ledger: manual_sell）
→ factory.product_inventory[product_id] -= quantity
→ INSERT industry_trade_record
```

注意：手动抛售操作的是工厂**共享仓库**中的指定产品库存，不区分是哪条生产线产出的。仓库以 `{"产品ID": 数量}` JSON 格式存储。

### 4.5 个人账户 ↔ 对公账户转账

#### 个人 → 对公（充值，无手续费）

```text
玩家选择工厂 + 充值金额 → 校验个人灵石 ≥ amount
→ 扣除个人灵石（spirit_stones_ledger: industry_deposit）
→ 对公账户余额 += amount
→ INSERT industry_ledger (biz_type='personal_deposit', amount=+amount)
→ wallet.total_deposit += amount
```

#### 对公 → 个人（提现，需缴税）

```text
玩家选择工厂 + 提现金额 → 校验 wallet.balance ≥ amount
→ 计算税费：tax = ceil(amount × INDUSTRY_WITHDRAW_TAX_RATE / FEE_RATE_DENOMINATOR)
→ 到账金额：net_amount = amount - tax
→ 对公账户余额 -= amount
→ 个人灵石 += net_amount（spirit_stones_ledger: industry_withdraw，备注显示扣税后金额）
→ INSERT industry_ledger (biz_type='personal_withdraw', amount=-amount)
→ INSERT industry_ledger (biz_type='withdraw_tax', amount=-tax)
→ wallet.total_withdraw += net_amount
→ wallet.total_tax_paid += tax
```

#### 税率配置

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `INDUSTRY_WITHDRAW_TAX_RATE` | 对公→个人提现税率（万分比） | `500`（即 500/100000 = 0.5%） |
| `INDUSTRY_FEE_RATE_DENOMINATOR` | 费率分母 | `100000` |

设计意图：防止玩家将对公账户作为个人灵石的无成本中转站。提现税费计入 `total_tax_paid`，破产清算时作为已消耗成本。

### 4.6 手续费

手动出售收取固定比例手续费，类比股市：

```text
手续费 = gross_revenue × INDUSTRY_SELL_FEE_RATE / FEE_RATE_DENOMINATOR

默认: INDUSTRY_SELL_FEE_RATE = 20 (即 20/100000 = 0.02%)
FEE_RATE_DENOMINATOR = 100000

tick 自动出售免手续费（鼓励玩家开启自动出售，减少手动操作负担）
```

### 4.7 价格波动模型

每个 tick，原材料和产品价格各自独立波动，采用与股市类似的「基点 + 噪音」模型，但简化为纯随机：

```text
for each material/product:
  // 均值回归因子：价格偏离基准价越远，回归拉力越强
  mean_reversion_bps = round((base_price - current_price) / base_price × 10000)
  reversion_strength = 0.05  // 5% 的回归强度，可调
  base_noise_bps = random(-volatility_bps, +volatility_bps)
  noise_bps = base_noise_bps + round(mean_reversion_bps × reversion_strength)
  new_price = current_price × (1 + noise_bps / 10000)
  new_price = max(new_price, price_min)    // 硬下限，由 JSON 配置
  new_price = min(new_price, price_max)    // 硬上限，由 JSON 配置

  change_bps = noise_bps
  写入 industry_material_price / industry_product_price
```

**为什么用纯随机 + 均值回归？**

股市用 AI 生成新闻驱动涨跌，但百业系统的原材料/产品价格波动属于「宏观经济背景噪声」，不需要事件驱动。纯随机 + 波动幅度可调，足够制造囤积 / 抛售的策略空间。加入轻量均值回归（`reversion_strength = 0.05`）防止价格长期贴住 `price_min` / `price_max` 硬边界（纯随机游走模型的漂移问题）。波动幅度和回归强度由 JSON 配置控制，调参只需改一处。

**价格单位说明**：

- 原材料 `price_per_unit` 存储的是**1 个最小交易单位**的价格（分），如糖 `min_sell_qty = 1000`，`price_per_unit = 1750` 分 = 17.50 灵石 / 1000 份
- 产品 `price_per_unit` 存储的是**每份**产品的价格（分），如铁剑 `price_per_unit = 20000` 分 = 200 灵石 / 份
- 前端展示时需按 `min_sell_qty` 换算为玩家易懂的单位（如糖：17.50 灵石 / 1000 份 → 0.0175 灵石 / 份）

### 4.8 累计盈亏统计

对公账户盈亏不再通过 `total_cost` / `total_revenue` 累计字段维护，改为从 `industry_ledger` 流水实时计算：

```text
// 对公账户当期盈亏 = Σ(所有 industry_ledger.amount)
收入 = Σ(amount) WHERE biz_type IN ('material_sell', 'auto_sell', 'manual_sell', 'personal_deposit')
支出 = Σ(amount) WHERE biz_type IN ('startup_cost', 'machine_buy', 'machine_upgrade', 'machine_energy', 'material_buy', 'puppet_drive', 'fee', 'incident_loss', 'withdraw_tax', 'personal_withdraw')
对公账户盈亏 = 收入 + 支出（支出 amount 为负数，直接相加即可）

// 玩家个人视角（已扣除提现税费）
个人净收益 = personal_withdraw.net_amount + factory_remaining_balance - personal_deposit
```

`industry_factory_wallet` 表维护 3 个累计字段：

```text
total_deposit   // 累计从个人转入（分）
total_withdraw  // 累计转出到个人（分，税后实到）
total_tax_paid  // 累计已缴提现税（分）
```

**盈亏口径说明**：
- 对公账户余额 `wallet.balance` 为工厂当前可用资金
- 破产清算时，`wallet.balance` 扣除税费后转入玩家个人账户（见 §4.11 破产清算）
- `industry_ledger` 提供完整流水，支持按 tick 区间、biz_type 分组统计

### 4.9 最小交易单位规则

百业系统中，原材料和产品的商城交易受最小交易单位约束，生产消耗不受此约束。

**原材料商城交易约束**（进货 + 卖回）：

- 玩家从系统商城**购买**原材料时，数量必须是该材料 `min_sell_qty` 的**整数倍**，且 ≥ `min_sell_qty`
- 玩家将原材料**卖回**给系统商城时，数量同样必须是 `min_sell_qty` 的整数倍
- 例：糖 `min_sell_qty = 1000`，可买/卖 1000 / 2000 / 3000 份，不能买/卖 500 或 1500 份
- 设计意图：低单价原材料（如糖）通过大批量交易制造"门槛感"，玩家必须批量采购、提前备货

**产品商城交易约束**（手动出售 + 自动出售）：

- 单次出售数量必须是该产品 `min_sell_qty` 的**整数倍**，且 ≥ `min_sell_qty`
- 例：糖糕 `min_sell_qty = 1000`，可出售 1000 / 2000 / 3000 份，不能出售 500 或 1500 份
- 自动出售 tick 中，如果库存不是 `min_sell_qty` 的整数倍，**只出售最大整数倍部分，余数留在仓库**
- 设计意图：低单价产品通过大批量出售制造"囤积感"，玩家需要积累足够库存才能一次性抛售

**生产消耗（不受约束）**：

- 每 tick 生产时，系统按配方实际消耗量从原材料仓库扣减，**不受 `min_sell_qty` 限制**
- 例：绿豆糕配方消耗糖 1 份/ tick，即使糖 `min_sell_qty = 1000`，工厂仍可正常生产
- 但**原材料库存不足配方消耗量时，该灵机停工**
- 设计意图：玩家只需提前备足库存即可正常生产，生产规模不受交易单位限制

**对策略的影响**：

- 最小交易单位越大 → 玩家囤积周期越长 → 择时决策的权重越大（一次错误采购/抛售时机损失更大）
- 商城采购门槛越高 → 开工前需预留灵石批量采购 → 灵石不足的玩家不敢轻易开工
- 两者结合制造"要么大赚要么大亏"的博弈感，区别于股市小额买卖的"细水长流"

### 4.10 灵机傀儡系统

灵机傀儡是工厂的自动化驱动单元。每台灵机至少需要配置 1 个傀儡才能开工，傀儡数量越多产出越高。

#### 傀儡驱动成本

| 工厂类型 | 每傀儡每 tick 驱动灵石（分） | 傀儡上限 |
| --- | --- | --- |
| 冶炼炉 | 1500（15.00 灵石） | 16 |
| 锻造台 | 1200（12.00 灵石） | 20 |
| 炼丹炉 | 2000（20.00 灵石） | 10 |

- 傀儡无满意度、无事件、无工资波动，成本固定
- 每 tick 傀儡成本 = Σ(各灵机 puppet_count × base_cost_per_puppet)
- 傀儡数量由玩家在 `0 ~ max_puppets` 范围内自由调整

#### 傀儡数量 → 产出

每台灵机至少需要配置 1 个傀儡才能开工。傀儡数量不直接影响产出倍率——产出由灵机等级加成和配方基础产出决定。每台灵机配 1 个傀儡即可满效运转，多余傀儡只会增加驱动成本而不产生额外收益。

每台运行中的灵机还需额外消耗 `energy_per_tick` 灵石作为自身能量（从对公账户扣减），与傀儡驱动成本独立计算。灵机每 tick 总运营成本 = 灵机能量消耗 + 傀儡驱动成本。

玩家策略的核心是**「多开灵机」**而非**「多配傀儡」**——每台灵机配 1 傀儡，成本最优。增加产出的方式是购买更多灵机并各自配 1 傀儡，而非给单台灵机堆傀儡数量。

#### 策略博弈

玩家面临的**二元权衡**：

1. **少开灵机** → 驱动成本（傀儡 + 能量）低，但总产出受限，可能无法覆盖固定成本
2. **多开灵机** → 产出高，但每 tick 驱动灵石消耗线性增长（每台灵机 1 傀儡 × base_cost + energy_per_tick），产品价格下跌时亏损更大

**例**：锻造台开 2 台灵机，每台配 1 傀儡，每 tick 傀儡驱动 = 2 × 12 = 24 灵石，灵机能量 = 2 × 10 = 20 灵石，总运营 = 44 灵石。1 号机产出 2 把飞剑 × 200 = 400 灵石，2 号机产出 1 件护甲 = 500 灵石，总收入 900，运营 44，毛利 856。如果飞剑跌到 150，1 号机收入 = 300，总收入 = 800，毛利 = 756，仍盈利。但如果原材料成本也上涨，可能转亏。此时玩家可停工灵机止损，傀儡不产生额外成本，停工灵机不消耗能量。

### 4.11 灵机系统

每个工厂可安装多台灵机，灵机数量无上限。每台灵机是一台独立的生产单元：

- **独立绑定配方**：同工厂的不同灵机可以产出不同产品（如锻造台的 1 号锻造机产飞剑，2 号锻造机产护甲）
- **独立配置傀儡**：每台灵机有自己的 `puppet_count`，需 ≥ `min_puppets_per_machine` 才能开工
- **独立开关**：每台灵机可单独启动 / 停工
- **独立升级**：每台灵机可独立升级，等级越高产出加成越大
- **独立能量消耗**：每台开工中的灵机每 tick 消耗 `energy_per_tick` 灵石（从对公账户扣减），停工不消耗
- **共享仓库**：所有灵机的产品产出进入同一个产品仓库，原材料消耗共享原材料仓库

#### 灵机产出加成

```
灵机等级加成 = (upgrade_level - 1) × output_per_level_bps
实际产出 = floor(recipe.output_per_tick × (1 + machine_bonus_bps / 10000))
```

例：锻造机基础产出 2，灵机等级 3（+4000 bps = +40%）：
```
实际产出 = floor(2 × 1.40) = floor(2.80) = 2
```

注意：产出基数较小时，灵机等级加成的实际收益可能为 0（floor 后不变）。灵机升级策略仅在产出基数足够大时有意义。

#### 升级成本递增

```
升级费用 = floor(base_price × upgrade_cost_multiplier ^ (upgrade_level - 1))
```

以锻造机（base_price=4000, multiplier=1.5）为例：
- Lv0 → Lv1（购买新机）：4,000
- Lv1 → Lv2：4,000
- Lv2 → Lv3：6,000
- Lv3 → Lv4：9,000
- Lv4 → Lv5：13,500

#### 灵机与工厂类型约束

- 灵机只能安装到对应类型的工厂（锻造机 → 锻造台，不可装到其他工厂）
- 工厂内灵机数量无上限，但傀儡总数受 `max_puppets` 限制
- 灵机可切换绑定配方，但仅限 `allowed_machine_types` 包含该灵机类型的配方

#### 仓库模型

工厂仓库分为**原材料仓库**和**产品仓库**两部分，均为 JSON 格式存储：

```text
factory (锻造台)
├── material_inventory:
│   ├── IRON_ORE:    {qty: 1000, cost_basis: 5000000}  ← 数量(份) + 累计采购成本(分)
│   └── SPIRIT_SILVER: {qty: 200, cost_basis: 2400000}
├── product_inventory: {"IRON_SWORD": 10, "SPIRIT_TOOL": 3}  ← 产品库存（份）
├── machine_1 (类型: 锻造机, Lv3, 配方: 飞剑, puppet_count: 5, status: running)
├── machine_2 (类型: 锻造机, Lv1, 配方: 护甲, puppet_count: 4, status: running)
└── machine_3 (类型: 锻造机, Lv2, 配方: 飞剑, puppet_count: 0, status: installed)
```

- 原材料库存：玩家从系统商城批量采购入库，每 tick 生产时按配方实际消耗量扣减；每条材料记录 `{qty, cost_basis}` 用于加权平均成本核算
- 产品库存：每 tick 生产时产出累加，玩家可手动/自动出售
- 仓库库存不区分来源，玩家抛售时选择产品 ID 即可
- 多台灵机同时消耗同种原材料时，消耗量 = Σ(各机消耗量)，统一从原材料仓库扣减
- 各灵机的傀儡驱动成本独立计算但统一扣除，灵机能量按运行中灵机逐一累加后统一扣除

#### 傀儡分配约束

- 工厂总傀儡 `total_puppets` 是上限
- 各灵机 `puppet_count` 之和 ≤ `total_puppets`
- 未分配的傀儡（`total_puppets - Σ(puppet_count)`）处于「闲置」状态，**不产生驱动成本**
- 设计意图：傀儡无情感无工资，闲置不产生成本，但玩家已为购买/配置傀儡投入了灵石

### 4.12 破产清算

当玩家主动关闭工厂或对公账户余额为负且无法恢复时，触发破产清算流程：

```text
1. 读取对公账户当前余额: wallet.balance
2. 清算资产:
   - 原材料库存: 按当前系统价格全部卖回商城 → 收入进入对公账户
   - 产品库存: 按当前系统价格全部出售 → 收入进入对公账户
3. 清算后对公账户余额 = wallet.balance + 材料卖回收入 + 产品出售收入 - 手续费
4. 计算可转回个人金额:
   IF 清算后余额 ≥ 0:
     → 可转回 = 清算后余额（无需缴税，破产清算免税）
     → 个人灵石 += 可转回
     → spirit_stones_ledger: industry_bankruptcy_settle
   ELSE 清算后余额 < 0:
     → 可转回 = 0（资不抵债，玩家无回收）
5. 标记工厂状态:
   → industry_factory.status = 'bankrupt'
   → industry_machine 全部停止
   → 原材料/产品库存清空
   → wallet.total_withdraw += 清算后余额  // 记录到累计转出，保持统计口径一致
6. 记录清算流水:
   → INSERT industry_ledger (biz_type='bankruptcy_settle', amount=可转回, note='破产清算，免税转回个人账户')
```

**免税设计说明**：破产清算免税是为了避免「资不抵债 → 清算 → 还要再交税 → 玩家倒欠系统」的极端情况。正常提现（对公→个人）仍需缴税，仅破产清算走免税通道。

---

## 五、模块架构设计

```text
server/src/services/industry/
├── definitions.ts          # 静态配置索引（类比 stockMarketDefinitions）
├── rules.ts                # 数值规则、手续费、税率、价格波动函数、灵机升级成本
├── time.ts                 # tick 间隔计算（类比 stockMarketTime / shopRentTime）
├── types.ts                # 领域类型、常量、配置映射（类比 shop/types）
├── industryService.ts      # 核心服务：开工、买卖、查询、tick 结算
├── walletService.ts        # 对公账户：充值、提现、破产清算、余额查询
├── industryScheduler.ts    # 独立 tick 调度器（类比 shopRentScheduler）
├── priceEngine.ts          # 价格波动引擎（独立模块，纯函数）
├── machineService.ts       # 灵机管理：购买、升级、启停、配方切换、等级加成计算
├── puppetCostEngine.ts     # 傀儡驱动成本计算（纯函数）
└── energyCostEngine.ts     # 灵机能量消耗计算（纯函数）
```

### 5.1 模块职责

| 模块 | 职责 | 复用关系 |
| --- | --- | --- |
| `definitions.ts` | 加载 `data/seeds/industry/` 目录下 6 个 JSON 文件，构建材料/产品/工厂/灵机/配方/傀儡索引 | 复用 `staticConfigLoader` 模式 |
| `rules.ts` | 手续费计算、税率计算、价格上下限、定点数转换、灵机升级成本计算 | 复用股市 `stockMarketRules` 定点数模式 |
| `time.ts` | tick 间隔计算、下次 tick 时间 | 复用 `stockMarketTime` / `shopRentTime` 模式 |
| `types.ts` | 领域类型、DTO、常量配置 | 类比 `shop/types.ts` |
| `industryService.ts` | 开工、买卖、tick 结算、生产记录 | 类比 `shopService.ts` 单例模式 |
| `walletService.ts` | 对公账户充值、提现、破产清算、流水查询 | 封装个人账户交互逻辑 |
| `industryScheduler.ts` | 定时触发 tick | 类比 `shopRentScheduler.ts` 模式 |
| `priceEngine.ts` | 纯函数：给定当前价格 + 波动率 → 新价格 | 类比 `generateStockMarketNoiseChangeBps` |
| `machineService.ts` | 灵机购买、升级、启停、配方切换、等级加成计算、灵机与工厂类型校验 | 封装灵机生命周期管理 |
| `puppetCostEngine.ts` | 纯函数：傀儡数量 × 基准成本 → 每 tick 驱动灵石消耗 | 独立纯函数模块，tick 结算时调用 |
| `energyCostEngine.ts` | 纯函数：汇总运行中灵机 → 每 tick 能量灵石消耗 | 独立纯函数模块，tick 结算时调用 |

### 5.2 调度器模式（复用已有）

```text
industryScheduler.ts 严格复用 shopRentScheduler 的模式：
1. 模块级 inFlight 互斥
2. setTimeout 动态调度（非 setInterval），避免漂移
3. 启动/停止生命周期函数
4. 环境变量开关控制（INDUSTRY_SCHEDULER_ENABLED）
5. tick 间隔可配置（INDUSTRY_TICK_INTERVAL_MINUTES，默认 30）
```

### 5.3 灵机升级成本规则

```text
购买新机费用 = base_price
从 Lv(n) 升到 Lv(n+1) 费用 = floor(base_price × upgrade_cost_multiplier ^ (n - 1))

以锻造机（base_price=4000, upgrade_cost_multiplier=1.5）为例：
  Lv0→Lv1（新机）: 4,000
  Lv1→Lv2: 4,000
  Lv2→Lv3: 6,000
  Lv3→Lv4: 9,000
  Lv4→Lv5: 13,500

灵机等级产出加成:
  machine_bonus_bps = (upgrade_level - 1) × output_per_level_bps
  例：锻造机 Lv3，output_per_level_bps=2000 → +4000bps = +40% 产出
```

---

## 六、API 设计

### 6.1 玩家接口（`/api/industry`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/config` | 获取工厂配置（类型、灵机、配方、材料、产品、傀儡） |
| GET | `/overview` | 获取玩家所有工厂概览（状态、对公账户余额、原材料/产品库存、灵机列表） |
| POST | `/create` | 开工建厂（选择工厂类型，从个人账户扣除 startup_cost 进入对公账户） |
| POST | `/machine-buy` | 购买灵机并安装到工厂（从对公账户扣款，绑定默认配方） |
| POST | `/machine/:machineId/upgrade` | 升级指定灵机（从对公账户扣升级费用） |
| POST | `/machine/:machineId/start` | 启动指定灵机 |
| POST | `/machine/:machineId/stop` | 停止指定灵机 |
| POST | `/machine/:machineId/recipe` | 切换灵机绑定配方（仅限 allowed_machine_types 范围内） |
| POST | `/machine/:machineId/puppets` | 配置灵机傀儡数量 |
| POST | `/material-buy` | 从系统商城购买原材料（校验 min_sell_qty 整数倍，从对公账户扣款，入库） |
| POST | `/material-sell` | 将原材料卖回给系统商城（校验 min_sell_qty 整数倍，收入进对公账户，出库） |
| POST | `/:factoryId/puppets` | 调整工厂总傀儡数量 |
| POST | `/:factoryId/start` | 启动工厂（stopped → running） |
| POST | `/:factoryId/stop` | 停工工厂（running → stopped） |
| POST | `/:factoryId/sell` | 手动出售仓库库存产品（收入进对公账户） |
| POST | `/:factoryId/auto-sell` | 设置自动出售开关/比例 |
| POST | `/:factoryId/deposit` | 个人灵石 → 对公账户充值（无手续费） |
| POST | `/:factoryId/withdraw` | 对公账户 → 个人灵石提现（扣税） |
| POST | `/:factoryId/bankruptcy` | 申请破产清算（清算后余额免税转回个人） |
| GET | `/wallet` | 查询对公账户余额和累计统计 |
| GET | `/ledger` | 查询对公账户流水（分页、biz_type 过滤） |
| GET | `/machines` | 获取灵机配置和价格列表 |
| GET | `/prices` | 获取当前原材料和产品价格 |
| GET | `/prices/history` | 价格历史（指定 material_id 或 product_id） |
| GET | `/production-log` | 玩家生产记录（分页，含灵机能量消耗、傀儡驱动成本、灵机等级加成） |
| GET | `/trade-log` | 玩家手动出售记录（分页） |

### 6.2 GM 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/gm/factories` | 查询所有玩家工厂状态（分页、过滤） |
| GET | `/gm/wallets` | 查询所有对公账户余额（分页、排序） |
| GET | `/gm/ledger` | 查询全服对公账户流水（分页、biz_type 过滤） |
| GET | `/gm/production-log` | 查询全服生产记录 |
| POST | `/gm/force-tick` | 手动触发一次 tick（调试用） |

---

## 七、盈亏模型示例

以下示例中的「灵石」均为对公账户余额（系统内部以分为单位存储）。

以「锻造台」为例：

### 7.1 单 tick 收支

**假设当前价格**：

- 灵铁矿：5000 分/单位 = 50 灵石（系统商城价格，已采购入库）
- 飞剑：20000 分/单位 = 200 灵石（系统回收价格）
- 傀儡驱动：12 灵石/个/tick（= 1200 分，系统存储单位为分）
- 灵机能量：锻造机 10 灵石/台/tick（= 1000 分）
- 锻造台有 2 台锻造机：1 号机产飞剑，2 号机产护甲
- 锻造台原材料仓库已有足够灵铁矿

**1 号锻造机（产飞剑，配置 1 傀儡，灵机 Lv3）**：

- 灵铁矿消耗 × 5 份（从原材料仓库扣减，无灵石支出）
- 傀儡 × 1 × 12 = 12 灵石（驱动成本）
- 灵机能量 = 10 灵石（能量消耗）
- 基础产出 = 2 把飞剑 → 灵机加成 +40%（Lv3）→ floor(2 × 1.40) = 2 把（基数小 floor 后不变）
- 系统回收价值 400 灵石
- 单线利润（当 tick）：400 - 12 - 10 = 378 灵石（不含原材料采购成本）

**2 号锻造机（产护甲，配置 1 傀儡，灵机 Lv1）**：

- 灵铁矿消耗 × 10 份（从原材料仓库扣减，无灵石支出）
- 傀儡 × 1 × 12 = 12 灵石（驱动成本）
- 灵机能量 = 10 灵石（能量消耗）
- 基础产出 = 1 件护甲 → 无灵机加成
- 系统回收价值 500 灵石
- 单线利润（当 tick）：500 - 12 - 10 = 478 灵石（不含原材料采购成本）

**工厂合计（当 tick）**：378 + 478 = 856 灵石（不含原材料采购成本）

**完整盈亏口径**（含原材料采购成本）：

- 1 号机灵铁矿成本：5 份 × 50 灵石 = 250 灵石（采购时已计入 total_cost）
- 2 号机灵铁矿成本：10 份 × 50 灵石 = 500 灵石（采购时已计入 total_cost）
- 总成本 = 250 + 500 + 12 + 12 + 10 + 10 = 794 灵石
- 总收入 = 400 + 500 = 900 灵石
- 净盈亏 = 900 - 794 = 106 灵石（盈利）

### 7.2 亏本场景

如果灵铁矿涨到 80 灵石/单位（采购价），飞剑跌到 150，护甲跌到 350：

- 1 号机材料成本 = 5 × 80 = 400，傀儡驱动 = 12，灵机能量 = 10，收入 = 150 × 2 = 300 → 亏 122
- 2 号机材料成本 = 10 × 80 = 800，傀儡驱动 = 12，灵机能量 = 10，收入 = 350 × 1 = 350 → 亏 472
- 总亏损：-594 灵石/tick

**策略选择**：

1. 立即停工亏损灵机（2 号机），保留 1 号机继续生产
2. 全部停工，等价格恢复
3. 如果仓库有产品存货，可囤积等产品涨价后抛售
4. 原材料已采购入库但未消耗的部分不受影响，可等价格恢复后继续使用

### 7.2.1 灵机升级对盈亏的影响

接上例，2 号机亏 472 灵石。玩家选择将 2 号机从 Lv1 升到 Lv3（升级费用 4000 + 6000 = 10000 灵石，从对公账户扣）：

- 灵机加成 = (3 - 1) × 2000 bps = +40%
- 实际产出 = floor(1 × 1.40) = 1 件护甲（因为产出基数为 1，floor 后不变）
- 收入 = 350，亏损 = 350 - (800 + 12 + 10) = -472（与升级前相同，floor 抵消了加成）

**分析**：产出基数为 1 时，灵机等级加成 floor 后无实际增益，升级纯亏。这说明灵机升级策略只在产出基数 ≥ 10 时才有意义（40% × 10 = +4 件实际产出）。玩家应当只在高产出灵机升级，低产出灵机维持基础等级。

### 7.3 囤积策略

接上例，玩家判断灵铁矿和飞剑价格会恢复，选择只开 1 号机、2 号机停工、产品不出售：

- 1 号机每 tick 傀儡驱动 = 12 灵石 + 灵机能量 = 10 灵石（原材料已从库存扣减）
- 连续 5 个 tick，共支出运营 110 灵石
- 仓库积累飞剑 10 把（尚未出售）
- 第 6 个 tick 飞剑涨到 280、灵铁矿回到 50：
  - 当 tick 1 号机收入 = 280 × 2 = 560，运营 = 12 + 10 = 22 → 当 tick 盈利 538
  - 手动出售 10 把 = 2800 灵石（扣除手续费后约 2799）
- 覆盖之前亏损后仍有盈余

**原材料备货策略**：玩家需要在开工前批量采购灵铁矿入库。假设采购灵铁矿 1000 份 × 50 灵石 = 50000 灵石（一次性支出），这些原材料可在多个 tick 内持续消耗，摊薄到每 tick 的实际成本取决于产出效率。

### 7.4 傀儡配置对盈亏的影响

锻造台 2 台灵机，每台配 1 傀儡，每傀儡驱动 12 灵石/个/tick，每台锻造机能量 10 灵石/tick。

2 台灵机各配 1 傀儡（最优策略）：

- 每 tick 傀儡驱动 = 2 × 12 = 24 灵石，灵机能量 = 2 × 10 = 20 灵石
- 1 号机产出 2 把飞剑 = 400 灵石，2 号机产出 1 件护甲 = 500 灵石
- 总收入 900，运营 44，毛利 856

如果玩家将 2 号机减少到 0 傀儡：

- 2 号机无法开工，产出 0（不消耗灵机能量）
- 傀儡驱动 = 1 × 12 = 12 灵石，灵机能量 = 1 × 10 = 10 灵石
- 收入 = 400，运营 22，毛利 378
- **结论**：傀儡数量必须 ≥ 1 才能开工，0 则该机停产且不消耗能量

**核心策略**：傀儡是驱动单元，不是产出乘数。每台灵机配 1 个傀儡即可满效运转，多余傀儡只会增加驱动成本而不产生额外收益。玩家的策略核心是**「多开灵机」**而非**「多配傀儡」**——增加产出靠买更多灵机，而非给单台灵机堆傀儡。

### 7.5 最小交易单位对盈亏的影响

以「锻造台」生产飞剑为例：

**配置**：
- 灵铁矿 `min_sell_qty = 10`，单价 5000 分/单位 = 50.00 灵石 / 10 份（即 5 灵石/份）

**配方**（飞剑）：灵铁矿 5 份 → 飞剑 2 份 / tick

**产品**：飞剑 `min_sell_qty = 10`，单价 20000 分/份 = 200 灵石/份

**玩家面临的选择**：

1. 商城采购原材料（一次最少按 `min_sell_qty` 整数倍）：
   - 灵铁矿：至少买 10 份 = 50 灵石
   - 首次备货最低成本：50 灵石

2. 生产：每 tick 消耗灵铁矿 5 份 → 产出 2 把飞剑
   - 备货 1000 份灵铁矿可生产 200 个 tick
   - 每 tick 傀儡驱动 = 1 × 1200 分 = 12 灵石（1 傀儡即可开工）
   - 每 tick 灵机能量 = 1000 分 = 10 灵石
   - 每 tick 总运营 = 22 灵石

3. 飞剑价格跌到 150 灵石/份，玩家想抛售 → 必须至少卖 10 份的整数倍
   - 卖 10 份 = 2000 灵石收入
   - 不能卖 7 份，不能卖 15 份

4. 如果玩家只有 28 份库存，想卖 20 份 → 可以；剩余 8 份无法单独出售，必须等到库存再次积累到 10 的整数倍

**与炼丹炉对比**：飞剑 `min_sell_qty = 10`，`output_per_tick = 2`（每 tick 产 2 把），需 5 个 tick 才能凑够一次出售；回灵丹 `min_sell_qty = 1`，`output_per_tick = 1`（每 tick 产 1 颗），1 个 tick 即可满足出售门槛。虽然飞剑最小交易单位数值更大，但因为产出基数低，实际出售等待周期更长——**决定囤积压力的不是 min_sell_qty 绝对值，而是 min_sell_qty / output_per_tick 的 tick 倍数**。两者都要求玩家积累足够库存才能抛售，形成"先囤后卖"的策略张力。原材料 `min_sell_qty` 制造"批量采购门槛"，产品 `min_sell_qty` 制造"批量出售门槛"，两者结合强化择时决策的重要性。

---

## 八、边界条件与风险控制

### 8.1 玩家侧

| 场景 | 处理策略 |
| --- | --- |
| 对公账户余额不足以支付当 tick 灵机能量 + 傀儡驱动 | 先自动出售部分产品库存抵扣 → 仍不够则强制停工 |
| 产品库存为 0 时手动出售 | 返回「无库存可出售」 |
| 库存不足 `min_sell_qty` 时手动出售 | 返回「库存不足最小交易单位，无法出售」 |
| 库存是 `min_sell_qty` 的倍数但不够出售 | 正常出售 |
| 库存不是 `min_sell_qty` 的整数倍时自动出售 | 只出售最大整数倍部分，余数留在仓库 |
| 原材料库存 < 配方消耗量 | 该灵机因原材料不足停工，记录 `material_shortage` 事件 |
| 商城购买原材料数量不是 `min_sell_qty` 整数倍 | 拒绝购买，提示调整数量 |
| 商城卖回原材料数量不是 `min_sell_qty` 整数倍 | 拒绝卖回，提示调整数量 |
| 商城卖回原材料数量 > 库存 | 拒绝卖回，提示库存不足 |
| 对公账户余额不足时购买原材料 | 拒绝购买，提示向对公账户充值 |
| 同时拥有多个工厂 | 每个工厂独立 tick 结算，各有独立对公账户，互不影响 |
| 工厂停工后重新启动 | `startup_cost` 仅在建厂时一次性扣除，停工后重新启动无需再付；但若工厂被玩家主动删除重建，则需重新支付 |
| 傀儡数量/分配调整 | 当 tick 不生效，下一 tick 生效 |
| 产品价格极低（低于材料成本） | 最低价保护（`price_min` 硬下限），不会归零 |
| 灵机傀儡 < `min_puppets_per_machine` | 该灵机无法启动，提示配置更多傀儡 |
| 灵机停工（已停止/未分配傀儡/原材料不足） | 不消耗灵机能量，不消耗傀儡驱动 |
| 傀儡分配之和 > `total_puppets` | 拒绝分配，提示傀儡总数不足 |
| 闲置傀儡（未分配到灵机） | 不产生驱动成本 |
| 灵机升级到 max_upgrade_level | 拒绝升级，提示已达最高等级 |
| 灵机配方切换 | 新配方必须在该灵机 `allowed_machine_types` 范围内 |
| 灵机类型与工厂类型不匹配 | 拒绝安装，提示购买对应类型的灵机 |
| 工厂无任何运行中灵机时尝试启动 | 拒绝启动，提示至少安装并启动 1 台灵机 |
| 个人充值 → 对公账户 | 无手续费，即时到账 |
| 对公提现 → 个人账户 | 按税率扣费，到账金额 = 提现金额 - 税费 |
| 对公账户余额为 0 时提现 | 拒绝提现，提示余额不足 |
| 破产清算 | 清算后余额免税转回个人账户，工厂标记为 bankrupt |

### 8.2 系统侧

| 场景 | 处理策略 |
| --- | --- |
| tick 执行耗时超过间隔 | inFlight 互斥保护，跳过本轮 |
| 服务器重启后 | 根据 `tick_hour` 边界补算缺失的 tick |
| 原材料/产品/灵机配置变更 | 重启服务后生效（热加载不做） |
| 价格波动导致极端值 | 上下限保护（`price_min` / `price_max` 硬上下限） |
| 玩家库存无限膨胀 | 可考虑后续版本增加仓储上限，1.0 不设限 |
| 所有玩家同时亏损 | 经济系统正常设计，允许亏本存在 |

### 8.3 数值安全

- 所有价格存储单位为「分」（BigInt），与股市、收租保持一致
- 手续费使用向上取整（类比股市 `ceilDiv`），防止小额拆单绕过
- 价格波动使用确定性 hash 种子（类比股市噪音），保证同一 tick 所有玩家看到相同价格
- 灵石扣减使用 `consumeSpiritStones`（`UPDATE ... WHERE spirit_stones >= $1`），保证原子性

---

## 九、扩展性设计（1.0 预留，后续版本实现）

### 9.1 多配方切换

灵机可在 `allowed_machine_types` 已定义配方范围内切换。

后续可增加「切换冷却」机制（切换后需等 N 个 tick 才能再次切换）。

### 9.2 傀儡品质系统

后续可增加傀儡品质/等级（普通/精钢/灵纹），影响驱动成本或产出效率。

预留方式：`industry_machine` 表增加 `puppet_quality` 列即可扩展。

### 9.3 原材料仓储上限

原材料仓库不设存储上限。后续版本可增加「原材料仓储上限」机制，限制每种原材料的最大存储量。

预留方式：`industry_factory` 表的 `material_inventory` 已是 JSON 格式，只需在 JSON 配置中为每种材料增加 `max_storage_qty` 字段即可。

### 9.4 市场供需驱动

后续可引入「全服供需比」作为价格驱动因子——当全服某产品库存积压时，系统价格自动走低；供不应求时走高。

预留方式：`priceEngine.ts` 已独立为纯函数模块，替换内部算法即可，不影响上层调用。

### 9.5 工厂升级 / 装修

类比店铺系统，工厂可增加升级机制（提升产出效率、降低材料消耗、增加傀儡上限、解锁新灵机槽位）。

预留方式：`industry_factory` 表增加 `upgrade_level` 列，JSON 配置中为每个工厂增加 `unlockable_slots` 字段。

### 9.6 灵机共振系统

后续可增加「全服灵机共振」机制——当全服多数灵机同时运行时，触发行业性共振效应。

#### 共振层级结构

新增 `industry_resonance` 表，按行业类型自动分组：

```prisma
model industry_resonance {
  id                   BigInt   @id @default(autoincrement())
  factory_types        String[]                    // 覆盖的工厂类型，如 ["FORGING"]
  active_machines      Int      @default(0)       // 全服该行业运行中灵机数
  resonance_level      String   @db.VarChar(20)   @default("none")  // none/weak/strong/surge
  bonus_bps            Int      @default(0)       // 共振产出加成基点
  created_at           DateTime @default(now()) @db.Timestamp(6)
  updated_at           DateTime @updatedAt @db.Timestamp(6)
}
```

#### 共振效果

| 运行灵机占比 | 共振等级 | 效果 |
| --- | --- | --- |
| < 20% | 无（none） | 无额外效果 |
| 20% ~ 40% | 弱共振（weak） | 该行业所有灵机产出 +5% |
| 40% ~ 70% | 强共振（strong） | 该行业所有灵机产出 +10%，傀儡驱动成本 -5% |
| > 70% |  surge | 该行业所有灵机产出 +15%，傀儡驱动成本 -10%，但材料价格 +5%（供需紧张） |

#### 对玩家策略的影响

1. **同行同利** → 开工的玩家越多，共振越强，所有人受益
2. **逆向操作** → 多数人停工时共振消失，少数开工的玩家反而独享高价格（竞争少）
3. **共振可见** → 所有玩家都能看到各行业的共振状态，制造全服话题

---

## 十、与现有系统的关系

```text
       ┌───────────────────────────────────────────────┐
       │             characters (spirit_stones)         │
       │              ← 个人灵石余额 →                   │
       └──────┬──────────┬──────────────┬───────────────┘
              │          │              │
        ┌─────▼────┐ ┌──▼──────┐ ┌─────▼──────────────┐
        │stock_mkt │ │  shop   │ │    industry        │
        │(股市交易) │ │(收租)    │ │  (百业工厂)         │
        └─────┬────┘ └──┬──────┘ │ ┌────────────────┐ │
              │         │       │ │ factory_wallet │ │
              │         │       │ │ (对公账户余额)   │ │
              │         │       │ └───────┬────────┘ │
              │         │       └───┬─────┴─────┬────┘
              │         │           │ deposit   │
              │         │           │ withdraw  │
              ▼         ▼           ▼           ▼
       ┌────────────────────────────────────────────────┐
       │  spirit_stones_ledger (个人灵石变动流水)        │
       └────────────────────────────────────────────────┘
                           +
       ┌────────────────────────────────────────────────┐
       │  industry_ledger (仅百业对公账户流水)            │
       └────────────────────────────────────────────────┘

       资金流说明:
       - 股市、收租 → 直接操作个人灵石
       - 百业工厂 → 所有收支走对公账户（industry_ledger）
       - 个人 ↔ 对公：deposit（免费）/ withdraw（扣税）
       - 三个系统竞争同一个个人灵石余额
```

- **独立 tick**：`industry_tick` 不依赖 `stock_market_tick` 或 `shop_tick`，可独立配置间隔
- **共享个人余额**：三个系统操作同一个 `characters.spirit_stones`，玩家需要在股市、店铺、工厂之间分配灵石
- **对公账户独立**：百业工厂拥有独立的对公账户层（`industry_factory_wallet`），工厂内部所有收支不直接影响个人灵石
- **个人流水**：个人灵石变动通过 `spirit_stones_ledger` 记录（含 deposit/withdraw）
- **对公流水**：工厂对公账户收支通过 `industry_ledger` 记录（含采购、灵机能量、傀儡驱动、出售、手续费、事件损失等）

---

## 十一、环境变量

| 变量名 | 说明 | 默认值 |
| --- | --- | --- |
| `INDUSTRY_FEATURE_ENABLED` | 百业系统总开关 | `true` |
| `INDUSTRY_SCHEDULER_ENABLED` | tick 调度器开关 | `true` |
| `INDUSTRY_TICK_INTERVAL_MINUTES` | tick 间隔（分钟） | `30` |
| `INDUSTRY_SELL_FEE_RATE` | 手动出售手续费费率 | `20` (0.02%) |
| `INDUSTRY_FEE_RATE_DENOMINATOR` | 费率分母（手续费 / 提现税共用） | `100000` |
| `INDUSTRY_WITHDRAW_TAX_RATE` | 对公→个人提现税率（万分比） | `500` (0.5%) |
| `INDUSTRY_AUTO_SELL_RATIO` | 默认自动出售比例 | `100` (全部自动出售) |
| `INDUSTRY_PRICE_MIN_PERCENT` | 价格下限（基准价百分比，当 JSON 未配置 price_min 时生效） | `10` |
| `INDUSTRY_PRICE_MAX_PERCENT` | 价格上限（基准价百分比，当 JSON 未配置 price_max 时生效） | `500` |
| `INDUSTRY_MACHINE_CRAFTING_ENABLED` | 是否开放灵机生产线自造（后期功能） | `false` |

---

## 十二、1.0 范围界定

### 1.0 包含

- [x] 工厂开工 / 停工
- [x] 配置 / 解配傀儡
- [x] 每 tick 消耗原材料库存 + 灵机能量灵石 + 傀儡驱动灵石 + 产出产品
- [x] 原材料库存管理（玩家从商城批量采购入库，每 tick 按配方扣减）
- [x] 原材料商城进货 / 卖回（最小交易单位约束，从对公账户扣/入账）
- [x] 原材料 / 产品价格系统波动（纯随机）
- [x] 产品囤积 + 手动抛售（收入进对公账户）
- [x] tick 自动出售（免手续费，收入进对公账户）
- [x] 生产记录追溯
- [x] 玩家工厂概览查询（含对公账户余额、灵机列表）
- [x] 价格查询 + 价格历史
- [x] 灵石流水记录（个人与对公之间的转账记入 spirit_stones_ledger）
- [x] 对公账户独立流水（industry_ledger，支持审计和破产清算）
- [x] 个人 → 对公充值（无手续费）
- [x] 对公 → 个人提现（扣税）
- [x] 破产清算（清算后余额免税转回个人账户）
- [x] 亏本强制停工
- [x] 产品库存抵成本容错
- [x] 原材料最小交易单位约束（`min_sell_qty`，商城进货/卖回整数倍）
- [x] 产品最小交易单位约束（`min_sell_qty`，整数倍校验）
- [x] 灵机傀儡系统（配置/解配、驱动灵石消耗）
- [x] 灵机能量系统（开工时每台灵机每 tick 消耗 `energy_per_tick` 灵石，从对公账户扣减）
- [x] 灵机系统：购买、升级、启停、配方切换
- [x] 灵机等级产出加成（每台灵机独立升级，等级越高产出加成越大）
- [x] 灵机数量无上限（但受傀儡总数限制）
- [x] 灵机与工厂类型一一对应约束
- [x] 灵机共享仓库模型（原材料 + 产品）
- [x] 灵机最低傀儡数约束（不足不可开工）
- [x] 闲置傀儡不产生驱动成本
- [x] 原材料库存不足时灵机停工
- [x] 灵机升级成本递增模型

### 1.0 不包含（后续版本）

- [ ] 多配方切换冷却机制
- [ ] 傀儡品质 / 等级
- [ ] 原材料仓储上限
- [ ] 全服供需驱动价格
- [ ] 工厂升级 / 装修
- [ ] 玩家间产品交易
- [ ] 订单系统（类比股市挂单）
- [ ] GM 调价面板
- [ ] 灵机共振系统
- [ ] 灵机生产线自造（1.0 仅商城购买，后期开放玩家自建）
