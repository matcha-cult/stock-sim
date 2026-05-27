# 股市系统完整抽离计划

## 一、背景与目标

### 背景
原项目 `idle-jiuzhou` 包含完整的修仙游戏系统，股市系统作为其中一个功能模块存在。现有 `stock-market-service` 目录已有一个简化版本，但功能不完整，缺少 K 线图、完整事件系统、AI 新闻场景选择等核心功能。

### 目标
将股市系统完整抽离到独立的 `stock-sim` 项目，满足以下要求：
1. **独立运行**：不依赖原项目的其他游戏功能
2. **完整功能**：股市功能一个不能少，包含用户认证、角色管理、股市交易、AI 新闻生成
3. **默认股市界面**：抽离后游戏主界面默认是股市板块
4. **高性能设计**：保留原有的连接池、事务管理、缓存机制
5. **初始灵石**：创建角色时默认 10000 灵石

---

## 二、新项目目录结构

```
stock-sim/
├── README.md
├── package.json                    # Monorepo 根配置
├── pnpm-workspace.yaml             # pnpm 工作区定义
├── pnpm-lock.yaml
├── .gitignore
├── docker-compose.yml              # 开发环境 Docker 配置
├── docs/
│   └── AGENTS.md                   # 开发规范文档
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx                # React 渲染入口
│       ├── App.tsx                 # 应用主入口（股市作为默认界面）
│       ├── components/
│       │   ├── Header.tsx          # 顶部导航
│       │   ├── AuthModal.tsx       # 登录/注册弹窗
│       │   ├── CharacterCreateModal.tsx  # 角色创建弹窗
│       │   ├── StockMarketModal/   # 股市弹窗组件
│       │   └── StockMarketPanel.tsx  # 股市主界面
│       ├── styles/
│       │   ├── index.scss          # 全局样式
│       │   └── variables.scss      # 样式变量
│       ├── services/api/           # API 封装
│       └── shared/                 # 共享模块
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma           # 数据库模型
│   ├── data/seeds/
│   │   └── stock_def.json          # 股票定义
│   └── src/
│       ├── app.ts                  # Express 主入口
│       ├── bootstrap/
│       │   └ registerRoutes.ts     # 路由注册
│       ├── config/                 # 配置文件
│       ├── middleware/             # 中间件
│       ├── routes/                 # 路由
│       ├── services/               # 服务层
│       │   ├── stockMarket/        # 股市核心服务（完整复制）
│       │   ├── authService.ts      # 认证服务（精简版）
│       │   ├── characterService.ts # 角色服务（精简版）
│       │   ├── ai/                 # AI 服务
│       │   ├── shared/             # 共享服务
│       │   └── inventory/shared/   # 货币服务
│       └── utils/                  # 工具函数
```

---

## 三、需要完整复制的股市核心文件

### 3.1 后端股市服务（完整复制，一个不能少）

| 文件 | 说明 |
|------|------|
| `stockMarketService.ts` | 核心交易服务（概览、历史、买卖、清仓、收益详情） |
| `stockMarketScheduler.ts` | 30分钟调度器 |
| `stockMarketAi.ts` | AI 新闻生成 |
| `stockMarketRules.ts` | 数值规则（涨跌限制、手续费计算） |
| `stockMarketTime.ts` | 时间工具 |
| `stockMarketDefinitions.ts` | 股票定义索引 |
| `stockMarketNewsEventContext.ts` | 新闻事件上下文 |
| `stockMarketScenarioSelector.ts` | 场景选择器 |
| `stockMarketPriceScaleBackfill.ts` | 价格回填 |
| `stockMarketRoutes.ts` | 股市路由 |
| `stock_def.json` | 股票静态定义 |

### 3.2 前端股市组件（完整复制）

| 文件 | 说明 |
|------|------|
| `StockMarketModal/index.tsx` | 股市弹窗主组件 |
| `StockMarketModal/index.scss` | 股市弹窗样式 |
| `StockMarketModal/stockMarketView.ts` | 视图模型转换 |
| `StockMarketModal/StockMarketCandlestickChart.tsx` | K 线图组件 |
| `stockMarket.ts` | 股市 API |

---

## 四、需要精简的核心文件

### 4.1 authService.ts（精简版）

**移除内容**：
- 手机号登录、验证码登录
- 第三方登录
- 密码重置
- 会话管理（session_token）
- 验证码服务依赖

**保留内容**：
- 用户注册（用户名+密码）
- 用户登录（用户名+密码）
- JWT Token 生成和验证
- 启动信息查询（bootstrap）

### 4.2 characterService.ts（精简版）

**移除内容**：
- 境界、地图、房间位置管理
- 成就系统
- 体力恢复
- 自动施法、自动分解设置
- 在线战斗位置同步
- 改名卡功能

**保留内容**：
- 角色查询
- 角色创建（默认灵石 10000）
- 灵石余额管理

### 4.3 auth.ts 中间件（精简版）

**移除内容**：
- 并发请求限制（userConnectionSlots）
- 会话验证（session_token）

**保留内容**：
- JWT Token 验证
- 角色查询

---

## 五、数据库模型设计

### 5.1 精简版 Prisma Schema

**用户表**：保留基础字段（id, username, password, created_at, updated_at）

**角色表**：精简字段，默认灵石 10000
- id, user_id, nickname, gender, title
- spirit_stones（默认 10000）
- silver（默认 0）
- created_at, updated_at

**股市相关表**：完整复制
- stock_market_quote
- stock_market_tick
- stock_market_price_history
- stock_market_news_event
- character_stock_holding
- stock_market_trade_record

---

## 六、前端主界面设计

### 6.1 App.tsx 结构

```tsx
function App() {
  const { isAuthenticated, hasCharacter, character, loading } = useAuthContext();

  if (loading) return <Spin />;
  
  // 未登录：显示登录/注册弹窗
  if (!isAuthenticated) return <AuthModal open={true} />;
  
  // 已登录无角色：显示角色创建弹窗
  if (!hasCharacter) return <CharacterCreateModal open={true} />;
  
  // 已登录有角色：显示股市主界面
  return (
    <>
      <Header />
      <main>
        <StockMarketPanel spiritStones={character.spiritStones} />
      </main>
    </>
  );
}
```

### 6.2 StockMarketPanel.tsx

- 复用 StockMarketModal 的核心逻辑
- 去掉 Modal 包装层
- 作为应用主界面直接展示
- 交易成功后刷新灵石余额

---

## 七、关键修改点

### 7.1 角色默认灵石改为 10000

**文件**：`server/src/services/characterService.ts`

**修改内容**：
```typescript
// 创建角色时灵石默认值
INSERT INTO characters (
  user_id, nickname, gender, title,
  spirit_stones, silver
) VALUES (
  $1, $2, $3, '散修',
  10000, 0  // 默认灵石 10000
)
```

### 7.2 前端 API 类型转换

**文件**：`client/src/shared/authContext.tsx`

**修改内容**：
- 灵石字段从 `bigint` 转换为 `number`，方便前端显示
- API 返回数据中 spirit_stones 需要转换为数字

---

## 八、启动步骤

```bash
# 1. 安装依赖
cd stock-sim
pnpm install

# 2. 启动 Docker 服务（PostgreSQL + Redis）
docker compose up -d

# 3. 配置环境变量
cd server
cp .env.example .env
# 编辑 .env 填写 AI API 密钥等

# 4. 初始化数据库
pnpm prisma:generate
pnpm prisma:migrate

# 5. 启动后端
pnpm dev

# 6. 启动前端
cd ../client
pnpm dev

# 7. 访问 http://localhost:5173
```

---

## 九、验证清单

| 功能 | 验证内容 |
|------|----------|
| 用户注册 | 注册新用户，获取 JWT Token |
| 用户登录 | 登录成功，返回用户和角色信息 |
| 角色创建 | 创建角色，灵石为 10000 |
| 股市概览 | 查看股票列表、新闻、持仓汇总 |
| K 线图 | 查看选中股票的 K 线图 |
| 买入股票 | 买入成功，扣减灵石 |
| 卖出股票 | 卖出成功，增加灵石 |
| 清仓操作 | 清仓单只或全部持仓 |
| 交易记录 | 分页查看历史记录 |
| 收益详情 | 查看总收益、已实现盈亏 |

---

**文档生成时间**：2026-05-26

**计划版本**：v1.0