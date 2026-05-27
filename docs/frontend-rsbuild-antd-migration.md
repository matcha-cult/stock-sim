# stock-sim 前端 Rsbuild + React 19 + Ant Design 6 + MobX 迁移细化设计文档

> 文档版本：v2.0
> 编写日期：2026-05-27
> 状态：待审批

---

## 一、迁移目标与边界

### 1.1 迁移目标

在 `stock-sim/` 根目录下新建**独立前端目录** `new-client/`，受 `pnpm-workspace.yaml` 管理，将 `client/` 下现有业务（认证、角色创建、股市交易、K 线图、收益/交易记录）迁移至新脚手架，要求：

1. **业务逻辑 1:1 迁移**：所有 API 调用、状态流转、数据派生、交互行为保持一致
2. **组件布局全部使用 Ant Design 组件**：禁止 `div + CSS` 直接搓布局，必须用 antd 的 Layout/Grid/Card/List/Descriptions/Flex 等组件
3. **不复用原有 SCSS 组件样式**：组件视觉由 antd 组件 + Design Token 驱动，不再手写 `index.scss` 级别的组件外观
4. **紧凑布局**：全局使用 `theme.compactAlgorithm`
5. **主题切换**：使用 antd 官网推荐的 `theme.algorithm` 切换方案，支持亮/暗一键切换，状态持久化到 `localStorage`
6. **样式排查辅助**：每个布局组件/容器必须设置 `id` 或 `data-*` 属性
7. **状态管理采用 MobX + 单一 RootStore**：使用 `mobx` + `mobx-react-lite` + `mobx-state-tree` 实现单一 RootStore 模式
8. **技术栈版本锁定**：
   - React 19
   - Ant Design 6
   - axios 固定 `1.14.0`

### 1.2 不迁移的内容

- 原 `StockMarketModal/index.scss` 全部样式（约 1750 行手写 CSS）— 改用 antd 组件 + Token 驱动
- 原 `App.scss` 中的手写布局样式 — 改用 antd Layout/Flex 组件
- 原 `globals.css` 中大量 `!important` 覆盖 antd 样式的 hack — 改用 Design Token 系统配置
- 原手动 `theme-dark` class 切换方案 — 改用 antd `ConfigProvider` theme 切换
- 原 `authContext.tsx` React Context 方案 — 改为由 MobX RootStore 管理

---

## 二、技术栈选型

| 维度 | 选型 | 版本 | 理由 |
|------|------|------|------|
| 构建工具 | Rsbuild + `@rsbuild/plugin-react` | ^2.0 | 高性能 Rspack 内核 |
| React | react / react-dom | ^19.2 | 用户明确要求，使用 React 19 新特性 |
| TypeScript | TypeScript | ~5.9 | 对齐参考版本 |
| UI 组件库 | antd | 6.3.1 | 用户明确要求 |
| 高级组件 | @ant-design/pro-components | 3.1.11-0 | 对齐参考版本，提供 ProTable/ProDescriptions 等 |
| 图标 | @ant-design/icons | ^6.2 | 对齐参考版本 |
| 状态管理 | mobx + mobx-react-lite + mobx-state-tree | ^6 / ^4 / ^7 | 用户明确要求，单一 RootStore 模式 |
| 路由 | react-router-dom | ^7.15 | 对齐参考版本，为后续扩展预留 |
| HTTP 客户端 | axios | 1.14.0（锁定） | 用户明确限定版本 |
| 工具库 | clsx + dayjs | ^2 / ^1.11 | 对齐参考版本，clsx 处理条件类名，dayjs 处理时间 |
| 图表库 | lightweight-charts | ^4.1 | 第三方 canvas 库，与 antd 无关 |
| CSS 方案 | antd Design Token + Less | — | antd 6 Token 系统为主，Less 仅用于局部样式补充（通过 `@rsbuild/plugin-less`） |

---

## 三、pnpm workspace 集成

### 3.1 新目录结构（顶层）

```
stock-sim/
├── pnpm-workspace.yaml          # 修改：添加 "new-client"
├── package.json                 # 根配置（已有，增加 new-client 脚本）
├── client/                      # 原前端（保留不动）
├── server/                      # 后端（保留不动）
└── new-client/                  # ← 新前端（本次迁移目标）
    ├── package.json
    ├── tsconfig.json
    ├── rsbuild.config.ts
    ├── index.html
    ├── .env
    ├── .env.production
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── stores/              # MobX 状态层
        ├── services/            # API 层
        ├── domain/              # 业务领域层
        ├── components/          # 业务组件层
        ├── shared/              # 跨模块共享（Hook、类型）
        └── styles/              # 最小全局样式（Less）
```

### 3.2 pnpm-workspace.yaml 修改

```yaml
packages:
  - "client"
  - "server"
  - "new-client"    # ← 新增
```

### 3.3 根 package.json 脚本补充

```json
{
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "dev:new-client": "pnpm --filter ./new-client dev",
    "build:new-client": "pnpm --filter ./new-client build",
    "dev:client": "pnpm --filter ./client dev",
    "dev:server": "pnpm --filter ./server dev",
    "build": "pnpm --parallel -r build",
    "build:client": "pnpm --filter ./client build",
    "build:server": "pnpm --filter ./server build",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down"
  }
}
```

---

## 四、new-client 目录结构（详细）

```
new-client/
├── package.json
├── tsconfig.json
├── rsbuild.config.ts
├── index.html
├── .env                          # 环境变量（开发）
├── .env.production
└── src/
    ├── main.tsx                  # React 19 渲染入口 + ConfigProvider
    ├── App.tsx                   # 应用主入口（状态路由）
    │
    ├── shared/                   # 跨模块共享
    │   ├── responsive.ts         # useIsMobile Hook（迁移）
    │   └── types/                # 全局类型声明
    │       └── env.d.ts          # Rsbuild 类型声明
    │
    ├── stores/                   # MobX 状态层（核心）
    │   ├── RootStore.ts          # 单一 RootStore，聚合所有子 Store
    │   ├── AuthStore.ts          # 认证状态（登录/注册/角色）
    │   ├── StockStore.ts         # 股市状态（概览/历史/交易/收益）
    │   └── ThemeStore.ts         # 主题状态（亮/暗切换）
    │
    ├── services/                 # API 层（完整迁移，零改动）
    │   ├── runtimeUrls.ts
    │   └── api/
    │       ├── core.ts           # axios 封装（适配 1.14.0）
    │       ├── error.ts          # 统一错误
    │       ├── requestConfig.ts  # 静默请求配置
    │       └── stockMarket.ts    # 股市 API
    │
    ├── domain/stock-market/      # 股市业务领域
    │   ├── types.ts              # View 类型声明
    │   ├── viewTransform.ts      # DTO → ViewModel 纯函数派生
    │   └── constants.ts          # 分页常量等
    │
    ├── components/               # 业务组件（全部用 antd 重写）
    │   ├── AppHeader/
    │   │   └── index.tsx         # 顶部导航（Layout.Header + Space）
    │   ├── AuthModal/
    │   │   └── index.tsx         # 登录/注册（Modal + Tabs + Form）
    │   ├── CharacterCreateModal/
    │   │   └── index.tsx         # 角色创建（Modal + Form + Alert）
    │   ├── StockMarket/
    │   │   ├── StockMarketPage.tsx   # 股市主页面（Tabs + Layout + Row/Col）
    │   │   ├── StockNewsCard.tsx     # 新闻卡片（Card + List）
    │   │   ├── PortfolioSummary.tsx  # 持仓汇总（Card + Statistic）
    │   │   ├── StockList.tsx         # 股票列表（List）
    │   │   ├── StockTradePanel.tsx   # 交易面板（Card + Space + InputNumber + Dropdown）
    │   │   ├── StockCandlestick.tsx  # K 线图（Card + lightweight-charts）
    │   │   ├── ProfitDetail.tsx      # 收益详情（Descriptions + List）
    │   │   └── TradeHistory.tsx      # 交易记录（ProTable 或 List + Pagination）
    │   └── ThemeSwitch/
    │       └── index.tsx         # 主题切换按钮（Switch + Tooltip）
    │
    └── styles/                   # 最小全局样式
        ├── global.less           # Reset + 滚动条
        └── kline.less            # K 线图容器最小样式
```

---

## 五、MobX 单一 RootStore 设计

### 5.1 架构总览

采用 **单一 RootStore 模式**，所有子 Store 挂载到 RootStore 实例上，通过 React Context 注入到组件树。子 Store 之间通过 RootStore 互相引用。

```
RootStore
├── authStore     → 用户认证、角色信息、登录态
├── stockStore    → 股市概览、历史、交易、收益、记录
└── themeStore    → 亮/暗主题模式
```

### 5.2 RootStore.ts

```typescript
/**
 * 单一 RootStore。
 *
 * 作用：
 * 1. 聚合所有子 Store，保证全局单一实例
 * 2. 子 Store 通过 rootStore 引用互相访问
 * 3. 通过 React Context 注入到组件树
 *
 * 数据流：
 * 组件 observer → 读取子 Store 属性 → MobX 自动追踪依赖 → 属性变化触发重渲染
 */
import { makeAutoObservable } from 'mobx';
import { AuthStore } from './AuthStore';
import { StockStore } from './StockStore';
import { ThemeStore } from './ThemeStore';

export class RootStore {
  authStore: AuthStore;
  stockStore: StockStore;
  themeStore: ThemeStore;

  constructor() {
    makeAutoObservable(this);
    this.authStore = new AuthStore(this);
    this.stockStore = new StockStore(this);
    this.themeStore = new ThemeStore(this);
  }
}

// React Context 注入
import { createContext, useContext } from 'react';

const RootStoreContext = createContext<RootStore | null>(null);

export const RootStoreProvider = RootStoreContext.Provider;

export const useRootStore = (): RootStore => {
  const store = useContext(RootStoreContext);
  if (!store) throw new Error('useRootStore 必须在 RootStoreProvider 内使用');
  return store;
};

// 便捷访问 hooks
export const useAuthStore = () => useRootStore().authStore;
export const useStockStore = () => useRootStore().stockStore;
export const useThemeStore = () => useRootStore().themeStore;
```

### 5.3 AuthStore.ts

替代原 `authContext.tsx`，将 `useState` + `useCallback` 替换为 MobX observable + action：

```typescript
/**
 * 认证状态 Store。
 *
 * 状态：
 * - user: 用户信息
 * - character: 角色信息（昵称、性别、灵石）
 * - loading: 初始化加载态
 *
 * 动作：
 * - login / register / createCharacter / logout / refreshCharacter
 *
 * 计算属性：
 * - isAuthenticated: 是否已登录
 * - hasCharacter: 是否有角色
 *
 * 数据流：
 * API 响应 → action 更新 observable 属性 → observer 组件自动重渲染
 */
import { makeAutoObservable, runInAction } from 'mobx';
import type { RootStore } from './RootStore';
import api from '../services/api/core';

export interface User { id: number; username: string; }
export interface Character { id: number; nickname: string; gender: string; title: string | null; spiritStones: number; }

export class AuthStore {
  user: User | null = null;
  character: Character | null = null;
  loading = true;

  constructor(private root: RootStore) {
    makeAutoObservable(this);
    void this.checkAuthStatus();
  }

  get isAuthenticated(): boolean { return this.user !== null; }
  get hasCharacter(): boolean { return this.character !== null; }

  checkAuthStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) { runInAction(() => { this.loading = false; }); return; }
    try {
      const response = await api.get<{ user: User; character: Character | null }>('/api/auth/bootstrap');
      runInAction(() => {
        if (response.success) {
          this.user = response.data.user;
          this.character = response.data.character ?? null;
        }
      });
    } catch {
      localStorage.removeItem('token');
      runInAction(() => { this.user = null; this.character = null; });
    } finally {
      runInAction(() => { this.loading = false; });
    }
  };

  login = async (username: string, password: string) => {
    /* ... 类似逻辑，runInAction 更新状态 ... */
  };

  register = async (username: string, password: string) => {
    /* ... */
  };

  createCharacter = async (nickname: string, gender: 'male' | 'female') => {
    /* ... */
  };

  logout = () => {
    localStorage.removeItem('token');
    runInAction(() => { this.user = null; this.character = null; });
  };

  refreshCharacter = async () => {
    /* ... */
  };
}
```

### 5.4 StockStore.ts

将原 `StockMarketPanel` / `StockMarketModal` 中的散乱状态收敛到单一 Store：

```typescript
/**
 * 股市状态 Store。
 *
 * 状态：
 * - overview / selectedStockId / historyPoints / tradeRecords / profitDetail
 * - activeTab / actionKey / newsIndex / quantity / tradePage
 * - 各 loading 态
 *
 * 动作：
 * - refreshOverview / refreshTrades / refreshProfitDetail
 * - handleTrade / handleClearPosition / handleSelectStock
 *
 * 计算属性：
 * - overviewModel → buildStockMarketOverviewViewModel 派生
 * - tradePreview → buildStockMarketTradePreview 派生
 * - historyModel → buildStockMarketHistoryViewModel 派生
 *
 * 性能设计：
 * - 派生数据通过 computed 属性缓存，仅在源 observable 变化时重算
 * - 相当于原 useMemo 的自动追踪版，不需要手动写依赖数组
 */
import { makeAutoObservable, computed, runInAction } from 'mobx';
import type { RootStore } from './RootStore';
import { buildStockMarketOverviewViewModel, buildStockMarketTradePreview, buildStockMarketHistoryViewModel } from '../../domain/stock-market/viewTransform';
import { getStockMarketOverview, getStockMarketHistory, /* ... */ } from '../../services/api/stockMarket';
import { SILENT_API_REQUEST_CONFIG } from '../../services/api/requestConfig';

export class StockStore {
  overview: StockMarketOverviewDto | null = null;
  selectedStockId = '';
  historyPoints: StockMarketHistoryPointDto[] = [];
  tradeRecords: StockMarketTradeRecordDto[] = [];
  tradeTotal = 0;
  tradePage = 1;
  tradePageSize = 20;
  profitDetail: StockMarketProfitDetailDto | null = null;
  quantity = 1;
  activeTab: 'market' | 'profit' | 'records' = 'market';
  actionKey: '' | 'buy' | 'buy-all' | 'sell' | 'clear-stock' | 'clear-all' = '';
  newsIndex = 0;

  loading = false;
  historyLoading = false;
  tradesLoading = false;
  profitLoading = false;

  constructor(private root: RootStore) {
    makeAutoObservable(this);
  }

  get spiritStones(): number {
    return this.root.authStore.character?.spiritStones ?? 0;
  }

  get selectedStock() {
    return this.overviewModel?.selectedStock?.stock ?? null;
  }

  get overviewModel() {
    return this.overview ? buildStockMarketOverviewViewModel(this.overview, this.selectedStockId) : null;
  }

  get tradePreview() {
    const stock = this.selectedStock;
    if (!stock || !this.overview) return null;
    return buildStockMarketTradePreview(stock, this.quantity, this.overview.tradeRules, this.spiritStones);
  }

  get historyModel() {
    return buildStockMarketHistoryViewModel(this.historyPoints);
  }

  // ... refreshOverview / refreshTrades / handleTrade 等 action 方法
}
```

### 5.5 ThemeStore.ts

```typescript
/**
 * 主题状态 Store。
 *
 * 状态：isDark（布尔值）
 * 动作：toggle / setDark / setLight
 * 持久化：localStorage
 * 初始值：localStorage 优先 → 系统偏好 → 默认浅色
 */
import { makeAutoObservable } from 'mobx';
import type { RootStore } from './RootStore';

export class ThemeStore {
  isDark = this.readInitialTheme();

  constructor(private root: RootStore) {
    makeAutoObservable(this);
  }

  private readInitialTheme(): boolean {
    const stored = localStorage.getItem('theme-mode');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toggle = () => {
    this.isDark = !this.isDark;
    localStorage.setItem('theme-mode', this.isDark ? 'dark' : 'light');
  };

  setDark = () => { this.isDark = true; localStorage.setItem('theme-mode', 'dark'); };
  setLight = () => { this.isDark = false; localStorage.setItem('theme-mode', 'light'); };
}
```

### 5.6 组件连接方式

使用 `mobx-react-lite` 的 `observer` 高阶组件：

```tsx
import { observer } from 'mobx-react-lite';
import { useAuthStore, useStockStore } from '../stores/RootStore';

const StockMarketPage = observer(function StockMarketPage() {
  const authStore = useAuthStore();
  const stockStore = useStockStore();

  // 直接读取 observable 属性，MobX 自动追踪依赖
  const { user, character } = authStore;
  const { overviewModel, tradePreview, selectedStock } = stockStore;

  return ( /* JSX */ );
});
```

**对比原 React Context + useState 方案的优势：**
- 不需要 `useMemo` + 依赖数组，computed 属性自动缓存
- 不需要 `useCallback` 包裹，action 方法引用天然稳定
- 子 Store 之间通过 RootStore 引用互相访问，不需要多层 Context
- 状态更新更精准，只有真正消费的组件会重渲染

---

## 六、组件层迁移方案（核心）

### 6.1 原则

- **禁止直接照搬原组件**：每个组件必须重新设计，使用 antd 6 组件拼装布局
- **业务逻辑保留**：`stockMarketView.ts` 中的纯函数派生逻辑 1:1 迁移
- **样式由 Token 驱动**：不再手写 `.stock-market-*` 类名，改用 antd 组件的 `styles` prop + Design Token
- **布局组件加 `id` / `data-*`**：所有布局容器必须加标识
- **组件通过 `observer` 连接 MobX**：不通过 props 透传状态，直接从 Store 读取

### 6.2 React 19 适配要点

| 变更点 | 原代码 | React 19 新写法 |
|--------|--------|----------------|
| `React.FC` 类型 | `const Comp: React.FC<Props>` | `function Comp(props: Props)` |
| `React.ReactNode` 返回值 | `function Comp(): React.ReactNode` | 直接返回 JSX，类型推断 |
| `forwardRef` | `React.forwardRef` | 原生 `ref` prop（React 19 支持将 ref 作为 prop） |
| `useContext` | `useContext(AuthContext)` | 不需要，改用 `useAuthStore()` |
| `Suspense` | 可用 | React 19 增强支持 Server Components |
| Form 动作 | `form.submit()` | React 19 支持 `formAction` prop |

### 6.3 Ant Design 6 适配要点

antd 6 基于 antd 5 的设计系统做了以下变更（基于用户提供的对齐版本 `6.3.1`）：

| 变更点 | 影响 |
|--------|------|
| `ConfigProvider` 的 `theme` API 保持兼容 | `algorithm` / `token` / `components` 用法不变 |
| `theme.compactAlgorithm` 保持可用 | 紧凑布局方案不变 |
| `theme.darkAlgorithm` 保持可用 | 暗色主题方案不变 |
| `App` 组件（`App.useApp()`）保持可用 | message / modal / notification 访问方式不变 |
| 组件 `styles` / `classNames` prop 增强 | 更多组件支持语义化样式定制 |
| 部分组件默认 `size` 或行为可能调整 | 通过 `ConfigProvider.componentSize` 统一控制 |

**关键风险**：antd 6 的 breaking changes 需要通过实际开发验证。如有 API 废弃，编码阶段即时调整。

### 6.4 各组件映射关系

#### 6.4.1 AppHeader

| 原实现 | 新实现 |
|--------|--------|
| `<header>` + 手写 flex | `Layout.Header` + `Space` + `Flex` |
| 品牌名 `<h1>` | `Typography.Title level={4}` |
| 主题切换：无 | 嵌入 `<ThemeSwitch>` |

```tsx
// 结构示意
<Layout.Header id="app-header" style={{ paddingInline: 24 }}>
  <Flex align="center" justify="space-between" style={{ width: '100%' }}>
    <Typography.Title level={4} style={{ margin: 0 }}>股市模拟系统</Typography.Title>
    <Space>
      <ThemeSwitch />
      <Typography.Text><UserOutlined /> {authStore.character?.nickname ?? authStore.user?.username}</Typography.Text>
      {authStore.character && (
        <Typography.Text type="success">灵石: {authStore.character.spiritStones.toLocaleString()}</Typography.Text>
      )}
      <Button type="text" icon={<LogoutOutlined />} onClick={authStore.logout}>登出</Button>
    </Space>
  </Flex>
</Layout.Header>
```

#### 6.4.2 AuthModal

保持 `Modal + Tabs + Form` 结构，用 antd 6 Form 规范重写。

#### 6.4.3 CharacterCreateModal

保持 `Modal + Form` 结构，增加 `Alert` 提示初始灵石。

#### 6.4.4 StockMarketPage（核心）

**不再合并 Modal/Panel 双实现，只保留单一页面组件。**

整体布局：

```tsx
<Layout id="stock-market-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
  <Flex id="stock-market-header" align="center" justify="space-between" style={{ padding: '10px 14px', borderBottom: '1px solid token' }}>
    <Typography.Title level={5} style={{ margin: 0 }}>股市</Typography.Title>
    <Button size="small" icon={<ReloadOutlined />} onClick={stockStore.refreshOverview} loading={stockStore.loading}>刷新</Button>
  </Flex>

  <Content id="stock-market-content" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
    <Tabs
      activeKey={stockStore.activeTab}
      onChange={stockStore.setActiveTab}  // ← MobX action
      items={[
        { key: 'market', label: '行情', children: <MarketTab /> },
        { key: 'profit', label: '收益详情', children: <ProfitTab /> },
        { key: 'records', label: '交易记录', children: <RecordsTab /> },
      ]}
      style={{ height: '100%' }}
    />
  </Content>
</Layout>
```

MarketTab 内部：

```tsx
<Flex id="market-tab-content" vertical gap={8} style={{ height: '100%' }}>
  <Row id="market-top-row" gutter={8}>
    <Col xs={24} lg={14}><StockNewsCard /></Col>
    <Col xs={24} lg={10}><PortfolioSummary /></Col>
  </Row>

  <Row id="market-bottom-row" gutter={8} style={{ flex: 1, minHeight: 0 }}>
    <Col xs={24} lg={10}><StockList /></Col>
    <Col xs={24} lg={14}>
      {stockStore.isMobile ? null : <StockTradePanel />}
    </Col>
  </Row>

  {stockStore.isMobile && stockStore.selectedStock && (
    <Drawer open height="72dvh" placement="bottom" onClose={stockStore.clearSelectedStock}>
      <StockTradePanel />
    </Drawer>
  )}
</Flex>
```

**关键子组件映射：**

| 子组件 | 原实现 | 新 antd 组件 |
|--------|--------|-------------|
| 新闻卡片 | `<section>` + 手写 grid | `Card` + `List` |
| 持仓汇总 | `<section>` + `.stat-grid` | `Card` + `Statistic` × 4 |
| 股票列表 | `<button>` 数组 + 手写 grid | `List` + 自定义 `renderItem` |
| 交易面板 | `.trade-box` + 手写 grid | `Card` + `Space` + `InputNumber` + `Dropdown.Button` |
| K 线图 | `.kline-chart` + 绝对定位 | `Card` + `ref` 挂载 lightweight-charts |
| 收益详情 | `<section>` + 手写 grid | `ProDescriptions` 或 `Descriptions` + `List` |
| 交易记录 | `<div>` 数组 + 手写 grid | `ProTable`（对齐版本已含 ProComponents）或 `List` + `Pagination` |

#### 6.4.5 ThemeSwitch

```tsx
<Tooltip title={themeStore.isDark ? '切换浅色' : '切换深色'}>
  <Switch
    checked={themeStore.isDark}
    onChange={themeStore.toggle}
    checkedChildren={<BulbOutlined />}
    unCheckedChildren={<CloudOutlined />}
    id="theme-switch"
    data-component="theme-switch"
  />
</Tooltip>
```

---

## 七、主题切换方案

### 7.1 ConfigProvider 配置

```tsx
// main.tsx
import { ConfigProvider, theme, type ThemeConfig } from 'antd';
import { RootStoreProvider, useThemeStore } from './stores/RootStore';

function ThemeAwareApp({ children }: { children: React.ReactNode }) {
  const themeStore = useThemeStore();

  const themeConfig: ThemeConfig = {
    algorithm: themeStore.isDark
      ? [theme.darkAlgorithm, theme.compactAlgorithm]
      : [theme.defaultAlgorithm, theme.compactAlgorithm],
    token: {
      colorPrimary: '#1677ff',
      borderRadius: 6,
      // 中国股市颜色习惯：涨=红，跌=绿
      colorError: '#f05b4f',    // 涨
      colorSuccess: '#52c41a',  // 跌
    },
    components: {
      Layout: { headerHeight: 48 },
      Card: { headerPadding: '10px 16px' },
      List: { paddingLG: 12 },
    },
  };

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      {children}
    </ConfigProvider>
  );
}
```

### 7.2 紧凑布局

通过 `theme.compactAlgorithm` 全局生效。需要进一步收紧的场景使用组件级 `size="small"`。

---

## 八、Rsbuild 构建配置

### 8.1 rsbuild.config.ts

```ts
import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginLess } from '@rsbuild/plugin-less';

export default defineConfig(({ mode }) => {
  // 加载 .env / .env.production 中的变量
  const { parsed } = loadEnv({ cwd: process.cwd(), mode });

  return {
    plugins: [pluginReact(), pluginLess()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    html: {
      template: './index.html',
    },
    source: {
      alias: {
        '@': './src',
      },
      // 将环境变量注入客户端代码，代码中通过 process.env.API_URL 访问
      define: {
        'process.env.API_URL': JSON.stringify(parsed.API_URL),
      },
    },
  };
});
```

### 8.2 package.json

```json
{
  "name": "stock-sim-new-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "rsbuild dev",
    "build": "rsbuild build",
    "preview": "rsbuild preview"
  },
  "dependencies": {
    "@ant-design/icons": "^6.2.2",
    "@ant-design/pro-components": "3.1.11-0",
    "antd": "6.3.1",
    "axios": "1.14.0",
    "clsx": "^2.1.1",
    "dayjs": "^1.11.20",
    "lightweight-charts": "^4.1.0",
    "mobx": "^6.15.3",
    "mobx-react-lite": "^4.1.1",
    "mobx-state-tree": "^7.2.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.15.0"
  },
  "devDependencies": {
    "@rsbuild/core": "^2.0.3",
    "@rsbuild/plugin-less": "^1.6.3",
    "@rsbuild/plugin-react": "^2.0.0",
    "@types/node": "^24.12.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "less": "^4.6.4",
    "typescript": "~5.9.3"
  }
}
```

### 8.3 环境变量

```
# .env
API_URL=http://localhost:3000

# .env.production
API_URL=/api
```

Rsbuild 通过 `source.define` 将环境变量注入客户端代码：

---

## 九、样式迁移策略

### 9.1 不再保留的样式文件

| 原文件 | 原因 |
|--------|------|
| `App.scss` | 改用 antd Layout/Flex 组件 |
| `styles/index.scss` | antd 全局覆盖改用 Design Token |
| `styles/globals.css` | CSS 变量由 antd Token 系统接管 |
| `components/StockMarketModal/index.scss` | 改用 antd 组件 + Token |

### 9.2 保留的最小 Less 样式

仅保留以下无法通过 antd Token 替代的样式（写在 Less 文件中）：

- K 线图 canvas 容器的绝对定位（`position: absolute; inset: 0`）
- K 线图 tooltip 的 `translate3d` 动画
- 涨跌色调的 `clsx` 条件类名样式（`.is-up` / `.is-down` / `.is-flat`）— 颜色值通过 Less 变量引用 antd Token

```less
// kline.less
.stock-kline-chart {
  position: relative;
  height: 196px;
  min-height: 196px;
  border-radius: 3px;
  overflow: hidden;

  .is-up { color: @ant-color-error; }
  .is-down { color: @ant-color-success; }
  .is-flat { color: @ant-color-text-secondary; }
}
```

### 9.3 样式排查标识

每个布局容器组件都加上 `id` 或 `data-*`：

```tsx
<Layout id="app-layout" data-component="app-layout">
  <Layout.Header id="app-header" data-component="app-header">
  <Content id="app-content" data-component="app-content">
    <Layout id="stock-market-page" data-component="stock-market-page">
      <Flex id="stock-market-header" data-component="stock-market-header">
      <Content id="stock-market-content" data-component="stock-market-content">
        <Flex id="market-tab-content" data-component="market-tab-content">
          <Row id="market-top-row" data-component="market-top-row">
          <Row id="market-bottom-row" data-component="market-bottom-row">
```

---

## 十、API 层迁移

### 10.1 直接复制（零改动）

以下文件直接迁移，不做任何修改：

- `services/runtimeUrls.ts`（`import.meta.env.VITE_API_URL` → `process.env.API_URL`）
- `services/api/error.ts`
- `services/api/requestConfig.ts`
- `services/api/stockMarket.ts`

### 10.2 core.ts 适配（微小改动）

原 `core.ts` 使用 `axios`，版本从 `^1.6.0` 锁定为 `1.14.0`。axios 1.x 系列 API 稳定，无 breaking change。但需确认：

- `AxiosRequestConfig` 类型名在 1.14.0 中是否仍有效（可能已改为 `RawAxiosRequestConfig`）
- `AxiosResponse` 类型保持稳定

如有类型名变化，在迁移时调整 import。

---

## 十一、数据派生层迁移

### 11.1 viewTransform.ts

原 `stockMarketView.ts` 中的纯函数派生逻辑 1:1 迁移到 `domain/stock-market/viewTransform.ts`。

**不变的部分：**
- 所有 `build*ViewModel` 函数体
- 所有格式化函数（`formatStockMarketCurrency` 等）
- 所有色调判断（`resolveStockMarketTone` 等）
- 所有费用计算（`calculateStockMarketBuyAmounts` 等）
- 二分法可买数量计算

**变化的部分：**
- 接口类型声明拆分到 `domain/stock-market/types.ts`
- `Intl.NumberFormat` / `Intl.DateTimeFormat` 常量提到模块级（不变）

### 11.2 MobX computed 替代 useMemo

原代码在组件中用 `useMemo` 派生 ViewModel：

```tsx
// 原代码
const overviewModel = useMemo(() =>
  overview ? buildStockMarketOverviewViewModel(overview, selectedStockId) : null,
  [overview, selectedStockId],
);
```

迁移后在 StockStore 中用 `computed`：

```typescript
// MobX Store
get overviewModel() {
  return this.overview
    ? buildStockMarketOverviewViewModel(this.overview, this.selectedStockId)
    : null;
}
```

**性能优势**：computed 属性自动缓存，不需要手动维护依赖数组，且在多个 observer 组件中共享同一份计算结果。

---

## 十二、迁移步骤

### 阶段一：脚手架搭建

1. 创建 `new-client/` 目录
2. 初始化 `package.json`（锁定版本如上）
3. 配置 `tsconfig.json` + `rsbuild.config.ts`
4. 修改 `pnpm-workspace.yaml` 添加 `new-client`
5. 修改根 `package.json` 添加 `dev:new-client` / `build:new-client` 脚本
6. 执行 `pnpm install` 确认依赖安装成功
7. 迁移 `services/` 层（零改动复制）
8. 创建 `index.html` + `main.tsx` 骨架

### 阶段二：MobX 状态层搭建

9. 实现 `stores/RootStore.ts`（单一 RootStore + Context 注入）
10. 实现 `stores/AuthStore.ts`（迁移 authContext 逻辑）
11. 实现 `stores/StockStore.ts`（迁移 StockMarketPanel 状态逻辑）
12. 实现 `stores/ThemeStore.ts`（主题切换 + localStorage 持久化）

### 阶段三：认证层组件

13. 用 antd 6 组件重写 `AuthModal`（Modal + Tabs + Form）
14. 用 antd 6 组件重写 `CharacterCreateModal`（Modal + Form + Alert）
15. 实现 `AppHeader`（Layout.Header + Space + ThemeSwitch）

### 阶段四：股市核心组件

16. 迁移 `viewTransform.ts` 纯函数（零改动）
17. 拆分 `types.ts` 类型声明
18. 用 antd 6 组件重写股市主页面：
    - `StockMarketPage.tsx`（Tabs + Layout 骨架 + observer）
    - `StockNewsCard.tsx`（Card 布局 + observer）
    - `PortfolioSummary.tsx`（Statistic 布局 + observer）
    - `StockList.tsx`（List 布局 + observer）
    - `StockTradePanel.tsx`（Card + 交易控件 + observer）
    - `StockCandlestick.tsx`（Card + K 线图 + memo）
    - `ProfitDetail.tsx`（Descriptions 布局 + observer）
    - `TradeHistory.tsx`（ProTable 或 List 布局 + observer）
19. 实现 `ThemeSwitch` 组件

### 阶段五：主题与收尾

20. 在 `ConfigProvider` 中接入亮/暗算法切换
21. 编写 `global.less` + `kline.less` 最小样式
22. 删除所有 SCSS 依赖
23. 运行 `tsc -b` 校验
24. 验证亮/暗主题一键切换
25. 验证紧凑布局
26. 验证移动端响应式（Grid breakpoints + Drawer）

---

## 十三、性能保障

### 13.1 保留的高性能设计

| 原实现 | 迁移后保持 |
|--------|-----------|
| `useMemo` 派生 ViewModel | `computed` 属性自动缓存 |
| 历史请求按选中股票延迟加载 | 保持（action 内逻辑） |
| 背景刷新静默模式 | 保持（`SILENT_API_REQUEST_CONFIG`） |
| 历史请求取消逻辑 | 保持（action 内 `cancelled` 标志） |
| K 线图 `memo` 包裹 | 保持（React.memo） |
| 一次性遍历构建 stock view + selected | 保持 |
| 二分法计算可买数量 | 保持 |
| `Map` 索引均线数据 | 保持 |

### 13.2 MobX 带来的额外性能优势

- `observer` 组件只在实际读取的 observable 属性变化时才重渲染
- computed 属性跨组件共享，避免多处重复 `useMemo`
- action 方法引用稳定，不需要 `useCallback`
- 不需要 `useContext` 导致的全量订阅，Context 只传递 RootStore 实例

### 13.3 新增性能优化

- antd `ProTable` / `List` 自带虚拟化
- `ConfigProvider` theme 切换不触发全量重渲染
- 紧凑布局减少组件 padding，间接减少渲染面积

---

## 十四、响应式适配

### 14.1 移动端适配策略

1. **antd `Grid` 组件的 `breakpoints`**：`<Row>` / `<Col>` 自动响应
2. **antd `Flex` 组件的 `wrap`**：自动换行
3. **`useIsMobile` Hook**（从 responsive.ts 迁移）：控制 Drawer vs 内联详情
4. **移动端详情 Drawer**：用 antd `<Drawer>` 组件替代

### 14.2 移动端特有交互

| 桌面端 | 移动端 |
|--------|--------|
| 股票详情内联展示 | 点击股票 → 底部 Drawer 弹出详情 |
| 两列 Grid 布局（Row/Col lg） | 单列 Flex 布局（Row/Col xs） |
| 页面直接展示 | 页面直接展示（去掉 Modal 包装） |

---

## 十五、风险与注意事项

### 15.1 Ant Design 6 Breaking Changes

antd 6 的具体 breaking changes 需要在开发中验证。重点检查：
- `ConfigProvider` theme API 是否有变更
- 各组件 prop 是否有废弃或重命名
- `theme.compactAlgorithm` / `theme.darkAlgorithm` 是否仍然可用
- `App.useApp()` 是否行为一致

### 15.2 React 19 Breaking Changes

- `React.FC` 不再是推荐写法，改用函数声明
- `defaultProps` 在函数组件中已完全移除（原代码未使用，无影响）
- `ref` 作为 prop 支持（原生，不需要 `forwardRef`）

### 15.3 MobX 与 React 19 兼容

- `mobx-react-lite` ^4.1 支持 React 18+，需确认对 React 19 的兼容性
- `observer` HOC 在 React 19 中应正常工作
- `useLocalObservable` 等 Hook 需确认兼容

### 15.4 K 线图与 antd Token 的衔接

`StockCandlestick` 通过 `readCssColor` 从 DOM 读取 CSS 变量来适配主题。迁移后：
- 方案 A：继续使用 CSS 变量（由 antd Token 自动生成到 `:root`）
- 方案 B：通过 `token2style`（antd 6 的 CSS-in-JS 运行时）读取 token

推荐方案 A，因为 lightweight-charts 的配置是 imperative 的。

### 15.5 axios 1.14.0 版本锁定

原 `core.ts` 使用了 `axios@^1.6.0`。锁定为 `1.14.0` 后需确认：
- `AxiosRequestConfig` 类型名是否存在
- `AxiosResponse` 类型是否稳定
- 拦截器 API 是否一致

---

## 十六、验收标准

| 验收项 | 标准 |
|--------|------|
| 功能完整 | 登录/注册/角色创建/概览/交易/清仓/K线图/收益/记录全部可用 |
| 主题切换 | 亮/暗一键切换，所有组件颜色正确，无 !important hack |
| 紧凑布局 | `compactAlgorithm` 全局生效，组件间距合理 |
| 响应式 | 桌面端/移动端自适应，移动端 Drawer 详情正常 |
| 类型安全 | `tsc -b` 零报错，无 any/unknown |
| 组件标识 | 每个布局容器有 `id` 或 `data-*` |
| 无 SCSS | 项目中不存在 `.scss` 文件 |
| 无 div+css 布局 | 布局由 antd Layout/Flex/Grid/Card/List/Descriptions 等组件完成 |
| MobX RootStore | 单一 RootStore 聚合所有状态，组件通过 `observer` 连接 |
| 版本锁定 | React 19 / antd 6 / axios 1.14.0 严格匹配 |
| workspace 集成 | `pnpm-workspace.yaml` 包含 `new-client`，`pnpm --filter ./new-client dev` 可运行 |

---

**文档结束。等待审批后方可开始编码。**
