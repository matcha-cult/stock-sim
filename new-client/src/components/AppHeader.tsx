/**
 * 顶部导航组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：显示用户信息、灵石余额、主题切换、登出按钮。
 * 2. 不做什么：不处理认证逻辑，只负责展示和操作 Store。
 *
 * 输入 / 输出：
 * - 输入：RootStore 的 authStore 和 themeStore。
 * - 输出：Header 展示栏。
 *
 * 数据流 / 状态流：
 * Observer 读取 authStore.user/character、themeStore.isDark -> 渲染 -> 登出/主题切换回调修改 Store。
 *
 * 复用设计说明：
 * - 替代旧 client 的 Header.tsx，增加主题切换按钮。
 * - 使用 antd Header + Space + Typography 组件布局，不手写 div+CSS。
 *
 * 关键边界条件与坑点：
 * 1. 必须用 Observer 包裹以响应 character 变化（交易后灵石刷新）。
 * 2. 登出后清空 token 和 Store 状态，由 AuthStore 统一处理。
 */

import { useContext } from 'react';
import { Observer } from 'mobx-react-lite';
import { Button, Space, Typography, Layout } from 'antd';
import { LogoutOutlined, UserOutlined, BulbOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';

const { Header } = Layout;

const { Text } = Typography;

export default function AppHeader(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  return (
    <Observer>
      {() => {
        const { authStore, themeStore } = rootStore;
        const { user, character, logout } = authStore;

        return (
          <Header id="app-header" data-section="header" style={{ padding: '0 24px', background: 'var(--panel-bg)' }}>
            <div id="header-inner" data-element="header-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
              <div id="header-brand" data-element="brand">
                <Typography.Title level={4} style={{ margin: 0, color: 'var(--text-primary)' }}>
                  股市模拟系统
                </Typography.Title>
              </div>
              {user && (
                <Space size="middle" id="header-user" data-element="user-info">
                  <Text style={{ color: 'var(--text-primary)' }}>
                    <UserOutlined /> {character?.nickname ?? user.username}
                  </Text>
                  {character && (
                    <Text type="success" data-element="spirit-stones">
                      灵石: {(character.spiritStones ?? 0).toLocaleString()}
                    </Text>
                  )}
                  <Button
                    type="text"
                    icon={<BulbOutlined />}
                    onClick={() => themeStore.toggle()}
                    data-action="toggle-theme"
                  >
                    {themeStore.isDark ? '亮色' : '暗色'}
                  </Button>
                  <Button
                    type="text"
                    danger
                    icon={<LogoutOutlined />}
                    onClick={logout}
                    data-action="logout"
                  >
                    登出
                  </Button>
                </Space>
              )}
            </div>
          </Header>
        );
      }}
    </Observer>
  );
}
