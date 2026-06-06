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
import { Button, Dropdown, Popover, Space, Typography, Layout, Tooltip } from 'antd';
import { LogoutOutlined, UserOutlined, BulbOutlined, DollarOutlined, GoldOutlined, GiftOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { RootStoreContext } from '../stores/RootStore';
import { useState, useCallback } from 'react';
import MonthCardModal from './MonthCardModal';
import PlayerName from './PlayerName';

const { Header } = Layout;

const { Text } = Typography;

/**
 * 格式化数值：超过 4 位则缩为万/亿单位，不超过 4 位直接显示。
 */
const formatCompact = (value: number): string => {
  if (Math.abs(value) >= 1_0000_0000) return `${(value / 1_0000_0000).toFixed(2)}亿`;
  if (Math.abs(value) >= 1_0000) return `${(value / 1_0000).toFixed(2)}万`;
  return value.toLocaleString();
};

interface CurrencyDisplayProps {
  value: number;
  icon: JSX.Element;
}

function CurrencyDisplay({ value, icon }: CurrencyDisplayProps): JSX.Element {
  const compact = formatCompact(value);
  const fullText = value.toLocaleString();

  const element = (
    <span style={{ cursor: 'pointer', color: Math.abs(value) >= 1_0000 ? 'var(--color-success)' : 'inherit' }}>
      <Tooltip title={fullText}>
        {icon} {compact}
      </Tooltip>
    </span>
  );

  return element;
}

export default function AppHeader(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  const [monthCardOpen, setMonthCardOpen] = useState(false);
  if (!rootStore) return null;

  const handleOpenMonthCard = useCallback(() => {
    setMonthCardOpen(true);
  }, []);

  return (
    <>
      <Observer>
        {() => {
        const { authStore, themeStore } = rootStore;
        const { user, character, logout } = authStore;

        return (
          <Header id="app-header" data-section="header" style={{ padding: '0 24px', background: 'var(--panel-bg)' }}>
            <div id="header-inner" data-element="header-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
              <div id="header-brand" data-element="brand">
                <Typography.Title level={4} style={{ margin: 0, color: 'var(--text-primary)' }}>
                  抹茶修仙
                </Typography.Title>
              </div>
              {user && (
                <Space size="middle" id="header-user" data-element="user-info">
                  {character && (
                    <Space size="small">
                      <CurrencyDisplay
                        value={character.spiritStones ?? 0}
                        icon={<DollarOutlined />}
                      />
                      <CurrencyDisplay
                        value={character.silver ?? 0}
                        icon={<GoldOutlined />}
                      />
                    </Space>
                  )}
                  <Dropdown menu={{
                    items: [
                      ...(character
                        ? [{
                            key: 'monthcard',
                            icon: <GiftOutlined />,
                            label: '月卡',
                            onClick: handleOpenMonthCard,
                          }]
                        : []),
                      {
                        key: 'theme',
                        icon: <BulbOutlined />,
                        label: themeStore.isDark ? '切换亮色' : '切换暗色',
                        onClick: () => themeStore.toggle(),
                      },
                      {
                        key: 'logout',
                        icon: <LogoutOutlined />,
                        label: '登出',
                        danger: true,
                        onClick: logout,
                      },
                    ] satisfies MenuProps['items'],
                  }} trigger={['click']} placement="bottomRight">
                    <span>
                      <PlayerName
                        name={character?.nickname ?? user.username}
                        monthCardActive={character?.monthCardActive}
                        isGm={user?.permissions.includes('GM')}
                        className="app-header-username"
                      />
                    </span>
                  </Dropdown>
                </Space>
              )}
            </div>
          </Header>
        );
      }}
    </Observer>
    <MonthCardModal open={monthCardOpen} onClose={() => setMonthCardOpen(false)} />
  </>
  );
}
