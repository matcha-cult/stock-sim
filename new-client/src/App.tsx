/**
 * 应用主路由组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据认证状态显示不同界面（登录/角色创建/股市主界面）。
 * 2. 不做什么：不处理具体业务逻辑，只负责界面路由。
 *
 * 输入 / 输出：
 * - 输入：AuthStore 的 observable 状态。
 * - 输出：相应界面。
 *
 * 数据流 / 状态流：
 * RootStore.authStore -> 认证状态检查 -> 显示对应界面 -> 用户交互更新 Store。
 *
 * 复用设计说明：
 * - 替代旧 client 的 React Context + useState 路由，用 MobX Observer 驱动。
 * - 所有子组件通过 RootStore 读取认证/股市/主题状态。
 *
 * 关键边界条件与坑点：
 * 1. 认证状态未确定时显示加载状态，避免闪烁。
 * 2. 必须用 Observer 包裹以确保 authStore 变化时重新渲染。
 */

import { useContext } from 'react';
import { Observer } from 'mobx-react-lite';
import { Spin, Layout } from 'antd';
import { RootStoreContext } from './stores/RootStore';
import AppHeader from './components/AppHeader';
import AuthModal from './components/AuthModal';
import CharacterCreateModal from './components/CharacterCreateModal';
import StockMarketPage from './components/StockMarketPage';

const { Content } = Layout;

function AppContent(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  return (
    <Observer>
      {() => {
        const { authStore, stockStore } = rootStore;

        if (authStore.loading) {
          return (
            <Layout data-section="app-loading" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" data-loading="auth-check" />
            </Layout>
          );
        }

        if (!authStore.isAuthenticated) {
          return <AuthModal />;
        }

        if (!authStore.hasCharacter) {
          return <CharacterCreateModal />;
        }

        return (
          <Layout data-section="app-main-layout" style={{ minHeight: '100vh' }}>
            <AppHeader />
            <Content data-section="stock-market-content">
              <StockMarketPage />
            </Content>
          </Layout>
        );
      }}
    </Observer>
  );
}

export default function App(): React.ReactNode {
  return <AppContent />;
}
