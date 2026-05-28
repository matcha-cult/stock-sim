/**
 * 应用入口。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：创建 React 根节点，注入 MobX RootStore、antd ConfigProvider（主题算法）、全局样式。
 * 2. 不做什么：不处理认证路由，不直接管理业务状态。
 *
 * 输入 / 输出：
 * - 输入：无。
 * - 输出：React 根节点渲染到 #root。
 *
 * 数据流 / 状态流：
 * 创建 RootStore -> 通过 Context 注入 -> App 组件读取状态做路由 -> antd ConfigProvider 消费主题。
 *
 * 复用设计说明：
 * - 单一 RootStore 实例通过 Context 注入，所有子组件通过 useContext 读取。
 * - antd theme.algorithm 根据 RootStore.themeStore.isDark 动态切换。
 * - theme.compactAlgorithm 始终启用，符合紧凑布局要求。
 *
 * 关键边界条件与坑点：
 * 1. RootStore 必须在渲染外创建，避免 React StrictMode 下重复构造。
 * 2. antd App 包裹层必须在 ConfigProvider 内，确保 message/modal 继承主题。
 * 3. data-theme 属性同步写入 body，供自定义 CSS 变量读取。
 */

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Observer } from 'mobx-react-lite';
import { ConfigProvider, App as AntdApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RootStore, RootStoreContext } from './stores/RootStore';
import App from './App';
import './styles/global.less';

function ThemeSync({ rootStore }: { rootStore: RootStore }): null {
  useEffect(() => {
    document.body.setAttribute('data-theme', rootStore.themeStore.isDark ? 'dark' : 'light');
  }, [rootStore.themeStore.isDark]);

  return null;
}

function Root() {
  const rootStore = new RootStore();

  return (
    <StrictMode>
      <RootStoreContext.Provider value={rootStore}>
        <Observer>
          {() => (
            <ConfigProvider
              locale={zhCN}
              theme={{
                algorithm: rootStore.themeStore.isDark
                  ? [theme.compactAlgorithm, theme.darkAlgorithm]
                  : [theme.compactAlgorithm],
                token: { colorPrimary: '#13c2c2' },
              }}
            >
              <ThemeSync rootStore={rootStore} />
              <AntdApp>
                <App />
              </AntdApp>
            </ConfigProvider>
          )}
        </Observer>
      </RootStoreContext.Provider>
    </StrictMode>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<Root />);
}
