/**
 * 登录/注册弹窗组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供用户登录/注册表单，调用 AuthStore 方法。
 * 2. 不做什么：不管理认证状态，只负责表单收集。
 *
 * 输入 / 输出：
 * - 输入：无（直接读取 AuthStore）。
 * - 输出：登录/注册成功后 AuthStore 状态更新。
 *
 * 数据流 / 状态流：
 * 用户填表单 -> 提交 -> AuthStore.login/register -> 成功则自动关闭弹窗（状态变化由 App 路由处理）。
 *
 * 复用设计说明：
 * - 替代旧 client 的 AuthModal.tsx，用 MobX Observer 替代 useContext。
 * - 使用 antd Modal + Form + Tabs 布局，不手写样式。
 *
 * 关键边界条件与坑点：
 * 1. 失败时通过 antd message 提示，不复用拦截器自动 toast（因为是业务层主动控制提示）。
 * 2. 登录成功后不需要手动跳转，App 组件会因 authStore.isAuthenticated 变化自动渲染主界面。
 */

import { useContext, useState } from 'react';
import { Observer } from 'mobx-react-lite';
import { Modal, Form, Input, Button, message, Tabs } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';

export default function AuthModal(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  return (
    <Observer>
      {() => {
        const { authStore } = rootStore;
        const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
        const [loading, setLoading] = useState(false);

        const handleLogin = async (values: { username: string; password: string }) => {
          setLoading(true);
          try {
            const result = await authStore.login(values.username, values.password);
            if (result.success) {
              message.success(result.message);
            } else {
              message.error(result.message);
            }
          } finally {
            setLoading(false);
          }
        };

        const handleRegister = async (values: { username: string; password: string }) => {
          setLoading(true);
          try {
            const result = await authStore.register(values.username, values.password);
            if (result.success) {
              message.success(result.message);
            } else {
              message.error(result.message);
            }
          } finally {
            setLoading(false);
          }
        };

        return (
          <Modal
            open
            footer={null}
            title={null}
            centered
            width={400}
            closable={false}
            maskClosable={false}
            data-component="auth-modal"
          >
            <Tabs
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key as 'login' | 'register')}
              items={[
                {
                  key: 'login',
                  label: '登录',
                  children: (
                    <Form onFinish={handleLogin} layout="vertical">
                      <Form.Item
                        name="username"
                        rules={[{ required: true, message: '请输入用户名' }]}
                      >
                        <Input prefix={<UserOutlined />} placeholder="用户名" />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        rules={[{ required: true, message: '请输入密码' }]}
                      >
                        <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          登录
                        </Button>
                      </Form.Item>
                    </Form>
                  ),
                },
                {
                  key: 'register',
                  label: '注册',
                  children: (
                    <Form onFinish={handleRegister} layout="vertical">
                      <Form.Item
                        name="username"
                        rules={[
                          { required: true, message: '请输入用户名' },
                          { min: 3, message: '用户名至少3个字符' },
                        ]}
                      >
                        <Input prefix={<UserOutlined />} placeholder="用户名" />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        rules={[
                          { required: true, message: '请输入密码' },
                          { min: 6, message: '密码至少6个字符' },
                        ]}
                      >
                        <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} block>
                          注册
                        </Button>
                      </Form.Item>
                    </Form>
                  ),
                },
              ]}
            />
          </Modal>
        );
      }}
    </Observer>
  );
}
