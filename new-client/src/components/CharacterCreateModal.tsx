/**
 * 角色创建弹窗组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供角色昵称和性别选择表单，调用 AuthStore.createCharacter。
 * 2. 不做什么：不管理角色状态，只负责表单收集。
 *
 * 输入 / 输出：
 * - 输入：无（直接读取 AuthStore）。
 * - 输出：角色创建成功后 AuthStore.character 更新。
 *
 * 数据流 / 状态流：
 * 用户填表单 -> 提交 -> AuthStore.createCharacter -> 成功则 App 自动渲染主界面。
 *
 * 复用设计说明：
 * - 替代旧 client 的 CharacterCreateModal.tsx，用 MobX Observer 驱动。
 * - 使用 antd Modal + Form + Radio 布局，不手写样式。
 *
 * 关键边界条件与坑点：
 * 1. 失败时通过 antd message 提示。
 * 2. 创建成功后不需要手动跳转，App 组件会因 authStore.hasCharacter 变化自动渲染主界面。
 */

import { useContext, useState } from 'react';
import { Observer } from 'mobx-react-lite';
import { Modal, Form, Input, Radio, Button, message, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';

const { Text } = Typography;

export default function CharacterCreateModal(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  return (
    <Observer>
      {() => {
        const { authStore } = rootStore;
        const [loading, setLoading] = useState(false);

        const handleCreate = async (values: { nickname: string; gender: 'male' | 'female' }) => {
          setLoading(true);
          try {
            const result = await authStore.createCharacter(values.nickname, values.gender);
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
            title="创建角色"
            centered
            width={400}
            closable={false}
            maskClosable={false}
            data-component="character-create-modal"
          >
            <div data-element="hint" style={{ marginBottom: 16 }}>
              <Text type="success">
                创建角色后将获得 10000 灵石，可以立即体验股市交易！
              </Text>
            </div>
            <Form
              onFinish={handleCreate}
              layout="vertical"
              initialValues={{ gender: 'male' }}
            >
              <Form.Item
                name="nickname"
                label="昵称"
                rules={[
                  { required: true, message: '请输入昵称' },
                  { max: 50, message: '昵称最长50字符' },
                ]}
              >
                <Input prefix={<UserOutlined />} placeholder="角色昵称" />
              </Form.Item>
              <Form.Item name="gender" label="性别">
                <Radio.Group>
                  <Radio value="male">男</Radio>
                  <Radio value="female">女</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  创建角色
                </Button>
              </Form.Item>
            </Form>
          </Modal>
        );
      }}
    </Observer>
  );
}
