# Seed 配置管理界面设计文档

## 1. 项目概述

### 1.1 目标
构建一个独立的 Web 管理界面，用于可视化配置和生成 `server/data/seeds/` 下的 JSON 配置文件。

### 1.2 技术栈
- **前端框架**: Next.js 15 (App Router)
- **UI 组件**: Ant Design 6.x
- **数据库**: SQLite（文件存储，纳入 git 管理）
- **ORM**: Drizzle ORM（轻量、类型安全）
- **语言**: TypeScript

### 1.3 项目位置
```
seed-admin/                    # 新建独立项目目录
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx          # 首页/仪表盘
│   │   ├── farm/             # 灵田配置页面
│   │   ├── industry/         # 工业配置页面
│   │   ├── stock/            # 股票配置页面
│   │   ├── month-card/       # 月卡配置页面
│   │   └── api/              # API Routes
│   ├── db/                   # 数据库 schema 和连接
│   ├── components/           # 共享组件
│   └── lib/                  # 工具函数
├── data/
│   └── seed.db              # SQLite 数据库文件（git 跟踪）
├── package.json
├── next.config.ts
├── drizzle.config.ts
└── tsconfig.json
```

---

## 2. 数据库设计

### 2.1 表结构总览

```
farm_crops           # 作物配置
farm_seeds           # 种子物品配置
farm_hybrid_recipes  # 杂交配方
farm_global_config   # 灵田全局配置（单行）

industry_materials   # 材料配置
industry_machines    # 机器配置
industry_factories   # 工厂配置
industry_puppets     # 傀儡配置
industry_recipes     # 生产配方
industry_products    # 产品配置

stocks               # 股票定义

month_card_configs   # 月卡配置
```

### 2.2 Farm 模块表结构

#### farm_crops（作物配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| crop_id | TEXT UNIQUE | 作物唯一标识 |
| name | TEXT | 显示名称 |
| description | TEXT | 描述 |
| element | TEXT NULL | 元素（金木水火土） |
| rarity | TEXT | 稀有度（common/uncommon/rare） |
| sort_order | INTEGER | 排序权重 |
| enabled | INTEGER | 是否启用 |
| growth_stage_minutes | TEXT | JSON 数组，生长阶段时间 |
| stage_labels | TEXT | JSON 数组，阶段标签 |
| harvestable_stage | INTEGER NULL | 可收获阶段 |
| seedable_stage | INTEGER NULL | 可留种阶段 |
| wither_after_minutes | INTEGER | 成熟后枯萎时间 |
| yield_min | INTEGER | 最小产量 |
| yield_max | INTEGER | 最大产量 |
| sell_price_per_unit | INTEGER | 单位售价 |
| harvest_trade_unit | INTEGER | 收获交易单位 |
| exp_gain | INTEGER | 经验获取 |
| required_tier | INTEGER | 所需田地等级 |
| seed_item_id | TEXT | 对应种子物品 ID |
| seed_unit | TEXT | 种子单位 |
| harvest_unit | TEXT | 收获单位 |
| seed_from_yield | INTEGER | 收获是否产出种子 |

#### farm_seeds（种子物品配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| item_id | TEXT UNIQUE | 物品唯一标识 |
| crop_id | TEXT | 对应作物 ID（外键） |
| name | TEXT | 显示名称 |
| description | TEXT | 描述 |
| buy_price | INTEGER | 购买价格 |
| sell_price | INTEGER | 出售价格 |
| stackable | INTEGER | 是否可堆叠 |
| max_stack | INTEGER | 最大堆叠数 |
| required_tier | INTEGER | 所需田地等级 |
| enabled | INTEGER | 是否启用 |
| sort_order | INTEGER | 排序权重 |
| seed_unit | TEXT | 种子单位 |

#### farm_hybrid_recipes（杂交配方）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| recipe_id | TEXT UNIQUE | 配方唯一标识 |
| name | TEXT | 配方名称 |
| description | TEXT | 描述 |
| enabled | INTEGER | 是否启用 |
| sort_order | INTEGER | 排序权重 |
| parent_a_element | TEXT | 父本 A 元素 |
| parent_b_element | TEXT | 父本 B 元素 |
| result_crop_id | TEXT | 产物作物 ID（外键） |
| result_seed_item_id | TEXT | 产物种子物品 ID（外键） |
| result_quantity | INTEGER | 产物数量 |
| success_rate | REAL | 成功率（0-1） |

#### farm_global_config（灵田全局配置，单行）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 固定为 1 |
| initial_rows | INTEGER | 初始行数 |
| initial_cols | INTEGER | 初始列数 |
| max_rows | INTEGER | 最大行数 |
| fixed_cols | INTEGER | 固定列数 |
| expansions | TEXT | JSON 数组，扩建配置 |
| xi_rang_price | INTEGER | 息壤单价 |
| cell_reclaim_spirit_stone | INTEGER | 格子回收灵石成本 |
| cell_reclaim_xi_rang | INTEGER | 格子回收息壤成本 |
| farm_tiers | TEXT | JSON 数组，田地等级配置 |
| initial_seeds | TEXT | JSON 数组，初始种子配置 |
| mutation_base_rate | REAL | 突变基础率 |
| mutation_positive_rate | REAL | 正面突变率 |
| mutation_neutral_rate | REAL | 中性突变率 |
| mutation_negative_rate | REAL | 负面突变率 |
| mutation_inherit_rate | REAL | 继承突变率 |
| quality_hq_rate | REAL | 高品质率 |
| quality_normal_rate | REAL | 普通品质率 |
| quality_lq_rate | REAL | 低品质率 |
| quality_hq_seed_rate | REAL | 高品质种子率 |
| hybrid_cooldown_minutes | INTEGER | 杂交冷却时间 |
| acceleration_multiplier | REAL | 加速倍率 |

### 2.3 Industry 模块表结构

#### industry_materials（材料配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| material_id | TEXT UNIQUE | 材料唯一标识 |
| name | TEXT | 显示名称 |
| base_price | INTEGER | 基础价格 |
| volatility_bps | INTEGER | 波动基点 |
| min_sell_qty | INTEGER | 最小出售数量 |
| price_min | INTEGER | 价格下限 |
| price_max | INTEGER | 价格上限 |
| enabled | INTEGER | 是否启用 |

#### industry_machines（机器配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| machine_type | TEXT UNIQUE | 机器类型标识 |
| name | TEXT | 显示名称 |
| factory_type | TEXT | 对应工厂类型（外键） |
| base_price | INTEGER | 基础价格 |
| upgrade_cost_multiplier | REAL | 升级成本倍率 |
| output_per_level_bps | INTEGER | 每级产出基点 |
| max_upgrade_level | INTEGER | 最大升级等级 |
| description | TEXT | 描述 |

#### industry_factories（工厂配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| factory_type | TEXT UNIQUE | 工厂类型标识 |
| name | TEXT | 显示名称 |
| startup_cost | INTEGER | 启动成本 |
| max_puppets | INTEGER | 最大傀儡数 |

#### industry_puppets（傀儡配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| factory_type | TEXT UNIQUE | 工厂类型（外键） |
| base_cost_per_puppet | INTEGER | 每傀儡基础成本 |
| max_puppets | INTEGER | 最大傀儡数 |

#### industry_recipes（生产配方）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| recipe_id | TEXT UNIQUE | 配方唯一标识 |
| product_id | TEXT | 产物 ID |
| output_per_tick | INTEGER | 每 tick 产出 |
| min_puppets_per_machine | INTEGER | 每机器最少傀儡 |
| allowed_machine_types | TEXT | JSON 数组，允许的机器类型 |
| materials | TEXT | JSON 数组，所需材料 |

#### industry_products（产品配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| product_id | TEXT UNIQUE | 产品唯一标识 |
| name | TEXT | 显示名称 |
| description | TEXT | 描述 |
| value | INTEGER | 价值 |
| enabled | INTEGER | 是否启用 |

### 2.4 其他表结构

#### stocks（股票定义）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| stock_id | TEXT UNIQUE | 股票唯一标识 |
| code | TEXT UNIQUE | 股票代码 |
| name | TEXT | 公司名称 |
| short_name | TEXT | 简称 |
| sector | TEXT | 所属板块 |
| description | TEXT | 描述 |
| initial_price_spirit_stones | INTEGER | 初始价格（灵石） |
| sort_weight | INTEGER | 排序权重 |
| enabled | INTEGER | 是否启用 |

#### month_card_configs（月卡配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| config_key | TEXT UNIQUE | 配置键 |
| duration_days | INTEGER | 有效期天数 |
| daily_reward_spirit_stones | INTEGER | 每日灵石奖励 |
| scratch_bonus_bps | INTEGER | 刮刮乐奖励基点 |
| shop_rent_bonus_bps | INTEGER | 店铺租金奖励基点 |
| description | TEXT | 描述 |

---

## 3. 页面设计

### 3.1 页面路由

```
/                      # 仪表盘，展示各模块数据概览
/farm/crops           # 作物列表与编辑
/farm/seeds           # 种子物品列表与编辑
/farm/hybrid-recipes  # 杂交配方列表与编辑
/farm/global-config   # 灵田全局配置（表单页）
/industry/materials   # 材料列表与编辑
/industry/machines    # 机器列表与编辑
/industry/factories   # 工厂列表与编辑
/industry/puppets     # 傀儡配置列表与编辑
/industry/recipes     # 生产配方列表与编辑
/industry/products    # 产品列表与编辑
/stocks               # 股票定义列表与编辑
/month-card           # 月卡配置列表与编辑
```

### 3.2 列表页设计

#### 通用布局
```
┌─────────────────────────────────────────────────────────────┐
│  面包屑导航：灵田配置 > 作物管理                               │
├─────────────────────────────────────────────────────────────┤
│  操作栏：[+ 新增] [导出 JSON] [导入 JSON]                     │
├─────────────────────────────────────────────────────────────┤
│  搜索栏：名称/ID 搜索  |  稀有度筛选  |  启用状态筛选         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────┬────────┬──────┬──────┬──────┬──────┬──────────┐  │
│  │ 排序 │ 作物ID │ 名称 │ 元素 │ 稀有度│ 状态 │ 操作     │  │
│  ├──────┼────────┼──────┼──────┼──────┼──────┼──────────┤  │
│  │  0   │ spirit │ 灵根 │  金  │ common│ ✓   │编辑 删除 │  │
│  │  1   │ iron   │ 铁木 │ null │uncom │ ✓   │编辑 删除 │  │
│  └──────┴────────┴──────┴──────┴──────┴──────┴──────────┘  │
│  分页：< 1 2 3 >                                            │
└─────────────────────────────────────────────────────────────┘
```

#### 表格列配置（以作物为例）
- 排序：sort_order
- 作物ID：crop_id
- 名称：name
- 元素：element（Tag 组件，颜色映射）
- 稀有度：rarity（Tag 组件）
- 生长阶段：growth_stage_minutes（格式化显示）
- 产量：yield_min ~ yield_max
- 状态：enabled（Switch 或 Badge）
- 操作：编辑、删除、查看详情

### 3.3 编辑页设计

#### 抽屉式编辑（适合字段较少）
```
┌─────────────────────────────────────────┐
│  编辑作物                          [×]  │
├─────────────────────────────────────────┤
│  作物ID:    [spirit_root_gold      ]    │
│  名称:      [灵根·金                ]    │
│  描述:      [金属性灵根作物...      ]    │
│  元素:      [金 ▼]                      │
│  稀有度:    [common ▼]                  │
│  排序:      [0    ]                     │
│  启用:      [✓]                         │
│                                         │
│  生长阶段（分钟）:                       │
│  [10] [15] [20] [+ 添加]                │
│                                         │
│  阶段标签:                              │
│  [灵芽] [金苗] [成熟] [+ 添加]          │
│                                         │
│  产量范围:                              │
│  最小 [120] ~ 最大 [180]                │
│                                         │
│  ... 更多字段 ...                       │
│                                         │
│         [取消]  [保存]                   │
└─────────────────────────────────────────┘
```

#### 页面式编辑（适合字段较多，如全局配置）
```
┌─────────────────────────────────────────────────────────────┐
│  灵田全局配置                                               │
├─────────────────────────────────────────────────────────────┤
│  ┌─ 网格配置 ─────────────────────────────────────────────┐ │
│  │  初始行数: [4]    初始列数: [4]                         │ │
│  │  最大行数: [6]    固定列数: [4]                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ 息壤配置 ─────────────────────────────────────────────┐ │
│  │  单价: [8888]                                           │ │
│  │  格子回收灵石: [1000]  格子回收息壤: [1]               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ 田地等级 ─────────────────────────────────────────────┐ │
│  │  ┌────┬──────┬────────────┬──────────┬──────────┐      │ │
│  │  │等级│ 名称 │  显示名称  │ 最低等级 │ 息壤成本 │      │ │
│  │  ├────┼──────┼────────────┼──────────┼──────────┤      │ │
│  │  │ 1  │ 黄级 │ 黄级（灵壤）│    0     │    1     │      │ │
│  │  │ 2  │ 玄级 │ 玄级（灵壤）│   25     │    3     │      │ │
│  │  └────┴──────┴────────────┴──────────┴──────────┘      │ │
│  │  [+ 添加等级]                                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ 突变概率 ─────────────────────────────────────────────┐ │
│  │  基础突变率: [5%]                                       │ │
│  │  正面: [70%]  中性: [20%]  负面: [10%]                 │ │
│  │  继承率: [50%]                                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ 品质概率 ─────────────────────────────────────────────┐ │
│  │  高品质: [20%]  普通: [70%]  低品质: [10%]             │ │
│  │  高品质种子率: [30%]                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│                              [保存配置]                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 特殊字段编辑

#### JSON 数组字段（如 growth_stage_minutes）
使用 antd 的 Form.List 组件，支持动态添加/删除/排序

#### 关联选择（如种子选择对应作物）
使用 Select + 搜索，从关联表中加载选项

#### 数值范围字段（如 yield_min ~ yield_max）
使用 InputNumber 组合，带范围校验

#### 概率字段（如 success_rate）
- 存储为 0-1 小数
- 界面显示为百分比输入
- 提交时自动转换

---

## 4. API 设计

### 4.1 RESTful API 结构

```
/api/farm/crops
  GET      # 列表查询（支持分页、筛选）
  POST     # 新增
  PUT      # 更新
  DELETE   # 删除

/api/farm/crops/[id]
  GET      # 详情

/api/farm/seeds
  ... (同上)

/api/farm/hybrid-recipes
  ... (同上)

/api/farm/global-config
  GET      # 获取全局配置
  PUT      # 更新全局配置

/api/industry/materials
  ... (同上)

/api/industry/machines
  ... (同上)

/api/industry/factories
  ... (同上)

/api/industry/puppets
  ... (同上)

/api/industry/recipes
  ... (同上)

/api/industry/products
  ... (同上)

/api/stocks
  ... (同上)

/api/month-card
  ... (同上)

/api/export
  POST     # 导出 JSON 到 server/data/seeds/

/api/import
  POST     # 从 JSON 文件导入数据
```

---

## 5. 导出功能设计

### 5.1 导出流程

```
1. 用户点击"导出 JSON"
2. 调用 /api/export
3. 后端从 SQLite 读取数据
4. 按照目标 JSON 格式转换
5. 写入 server/data/seeds/ 对应文件
6. 返回导出结果
```

### 5.2 导出文件结构
```json
// farm/crops.json
{
  "crops": [
    { "cropId": "...", "name": "...", ... }
  ]
}

// farm/seeds.json
{
  "seeds": [
    { "itemId": "...", "cropId": "...", ... }
  ]
}

// farm/hybridRecipes.json
{
  "recipes": [
    {
      "recipeId": "...",
      "parentA": { "element": "金" },
      "parentB": { "element": "木" },
      ...
    }
  ]
}

// farm/plots.json
{
  "grid": { ... },
  "xiRang": { ... },
  "cellReclaim": { ... },
  "farmTiers": [ ... ],
  "initialSeeds": [ ... ],
  "mutation": { ... },
  "quality": { ... },
  "hybrid": { ... },
  "accelerationMultiplier": 1.0
}
```

---

## 6. 导入功能设计

### 6.1 导入流程

```
1. 用户选择 JSON 文件或粘贴 JSON
2. 前端校验 JSON 格式
3. 调用 /api/import
4. 后端解析 JSON
5. 清空对应表（或增量更新）
6. 批量插入 SQLite
7. 返回导入结果
```

### 6.2 导入模式

- **全量替换**：清空表后重新插入
- **增量更新**：根据唯一键更新或插入

默认使用全量替换，用户可选择增量更新。

---

## 7. UI 组件设计

### 7.1 共享组件

```
components/
├── Layout/
│   ├── AppLayout.tsx          # 主布局（侧边栏 + 内容区）
│   └── Breadcrumb.tsx         # 面包屑
├── DataTable/
│   ├── DataTable.tsx          # 通用数据表格
│   ├── SearchBar.tsx          # 搜索筛选栏
│   └── ActionBar.tsx          # 操作按钮栏
├── FormFields/
│   ├── JsonArrayField.tsx     # JSON 数组字段编辑器
│   ├── ProbabilityField.tsx   # 概率字段（百分比输入）
│   ├── RangeField.tsx         # 范围字段（min-max）
│   └── RelatedSelect.tsx      # 关联选择字段
└── common/
    ├── StatusBadge.tsx        # 状态徽章
    └── RarityTag.tsx          # 稀有度标签
```

### 7.2 主题适配

- 支持 antd 主题配置
- 默认使用浅色主题
- 预留深色主题扩展

---

## 8. 文件组织

### 8.1 完整目录结构

```
seed-admin/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 根布局
│   │   ├── page.tsx                # 仪表盘
│   │   ├── globals.css             # 全局样式
│   │   ├── farm/
│   │   │   ├── crops/
│   │   │   │   ├── page.tsx        # 作物列表
│   │   │   │   └── [id]/
│   │   │   │       └── edit/
│   │   │   │           └── page.tsx
│   │   │   ├── seeds/
│   │   │   │   └── page.tsx
│   │   │   ├── hybrid-recipes/
│   │   │   │   └── page.tsx
│   │   │   └── global-config/
│   │   │       └── page.tsx
│   │   ├── industry/
│   │   │   ├── materials/
│   │   │   │   └── page.tsx
│   │   │   ├── machines/
│   │   │   │   └── page.tsx
│   │   │   ├── factories/
│   │   │   │   └── page.tsx
│   │   │   ├── puppets/
│   │   │   │   └── page.tsx
│   │   │   ├── recipes/
│   │   │   │   └── page.tsx
│   │   │   └── products/
│   │   │       └── page.tsx
│   │   ├── stocks/
│   │   │   └── page.tsx
│   │   ├── month-card/
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── farm/
│   │       │   ├── crops/
│   │       │   │   └── route.ts
│   │       │   ├── seeds/
│   │       │   │   └── route.ts
│   │       │   ├── hybrid-recipes/
│   │       │   │   └── route.ts
│   │       │   └── global-config/
│   │       │       └── route.ts
│   │       ├── industry/
│   │       │   ├── materials/
│   │       │   │   └── route.ts
│   │       │   ├── machines/
│   │       │   │   └── route.ts
│   │       │   ├── factories/
│   │       │   │   └── route.ts
│   │       │   ├── puppets/
│   │       │   │   └── route.ts
│   │       │   ├── recipes/
│   │       │   │   └── route.ts
│   │       │   └── products/
│   │       │       └── route.ts
│   │       ├── stocks/
│   │       │   └── route.ts
│   │       ├── month-card/
│   │       │   └── route.ts
│   │       ├── export/
│   │       │   └── route.ts
│   │       └── import/
│   │           └── route.ts
│   ├── db/
│   │   ├── schema.ts              # Drizzle schema 定义
│   │   ├── index.ts               # 数据库连接
│   │   └── migrate.ts             # 迁移脚本
│   ├── components/
│   │   ├── Layout/
│   │   ├── DataTable/
│   │   ├── FormFields/
│   │   └── common/
│   └── lib/
│       ├── export.ts              # 导出逻辑
│       ├── import.ts              # 导入逻辑
│       └── utils.ts               # 工具函数
├── data/
│   └── seed.db                    # SQLite 数据库
├── public/
├── package.json
├── next.config.ts
├── drizzle.config.ts
├── tsconfig.json
└── .gitignore
```

---

## 9. 开发计划

### Phase 1: 项目初始化
- [ ] 创建 Next.js 项目
- [ ] 配置 antd、TypeScript、ESLint
- [ ] 配置 Drizzle ORM + SQLite
- [ ] 设计并创建数据库表
- [ ] 搭建基础布局（侧边栏导航）

### Phase 2: Farm 模块
- [ ] 作物列表与 CRUD
- [ ] 种子物品列表与 CRUD
- [ ] 杂交配方列表与 CRUD
- [ ] 全局配置页面
- [ ] JSON 数组字段组件

### Phase 3: Industry 模块
- [ ] 材料列表与 CRUD
- [ ] 机器列表与 CRUD
- [ ] 工厂列表与 CRUD
- [ ] 傀儡配置列表与 CRUD
- [ ] 配方列表与 CRUD
- [ ] 产品列表与 CRUD

### Phase 4: 其他模块
- [ ] 股票定义列表与 CRUD
- [ ] 月卡配置列表与 CRUD

### Phase 5: 导入导出
- [ ] 导出 JSON 功能
- [ ] 导入 JSON 功能
- [ ] 数据校验与错误处理

### Phase 6: 优化与测试
- [ ] UI 细节优化
- [ ] 性能优化（虚拟滚动等）
- [ ] 集成测试

---

## 10. 技术决策说明

### 10.1 为什么选择 Next.js 而不是复用 new-client？
- 管理界面是独立工具，不应耦合到主前端
- Next.js 的 SSR/SSG 能力更适合管理后台
- 独立的 API Routes 简化后端逻辑

### 10.2 为什么选择 SQLite 而不是复用 PostgreSQL？
- 管理界面是开发工具，不需要高并发
- SQLite 文件可直接纳入 git 管理
- 零配置，开箱即用
- 方便团队成员共享配置数据

### 10.3 为什么选择 Drizzle 而不是 Prisma？
- Drizzle 对 SQLite 支持更好
- 更轻量，启动更快
- 类型推导更自然
- 与 Next.js App Router 配合更好

### 10.4 为什么数据库文件放在 data/ 目录？
- 清晰的职责分离
- 方便 .gitignore 配置
- 便于备份和迁移

---

## 11. 后续扩展

### 11.1 可能的功能扩展
- 配置版本管理（git diff 集成）
- 配置对比（对比不同版本的差异）
- 批量操作（批量启用/禁用）
- 数据迁移工具（从旧格式迁移）
- 配置预览（模拟实际效果）

### 11.2 技术扩展
- 支持多环境配置（dev/staging/prod）
- 支持配置回滚
- 支持协作编辑（WebSocket 实时同步）
- 支持配置审核流程
