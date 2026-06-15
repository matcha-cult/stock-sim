"use client";

import { Button, Table, Tag, Switch, Modal, Form, Input, InputNumber, Select, App, Popconfirm, Space } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

interface Seed {
  id: number;
  itemId: string;
  cropId: string;
  name: string;
  description: string;
  buyPrice: number;
  sellPrice: number;
  stackable: boolean;
  maxStack: number;
  requiredTier: number;
  enabled: boolean;
  sortOrder: number;
  seedUnit: string;
}

export default function SeedsPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<Seed[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSeed, setEditingSeed] = useState<Seed | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(`/api/farm/seeds?page=${page}&pageSize=${pageSize}`);
    const result = await res.json();
    setData(result.items);
    setTotal(result.total);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize]);

  const handleAdd = () => {
    setEditingSeed(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      stackable: true,
      maxStack: 999,
      requiredTier: 1,
      sortOrder: 0,
    });
    setModalVisible(true);
  };

  const handleEdit = (record: Seed) => {
    setEditingSeed(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/farm/seeds?id=${id}`, { method: "DELETE" });
    message.success("删除成功");
    fetchData();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();

    if (editingSeed) {
      await fetch("/api/farm/seeds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingSeed.id, ...values }),
      });
      message.success("更新成功");
    } else {
      await fetch("/api/farm/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      message.success("创建成功");
    }

    setModalVisible(false);
    fetchData();
  };

  const columns = [
    { title: "排序", dataIndex: "sortOrder", key: "sortOrder", width: 80 },
    { title: "物品ID", dataIndex: "itemId", key: "itemId", width: 200 },
    { title: "作物ID", dataIndex: "cropId", key: "cropId", width: 180 },
    { title: "名称", dataIndex: "name", key: "name", width: 150 },
    {
      title: "购买价",
      dataIndex: "buyPrice",
      key: "buyPrice",
      width: 100,
    },
    {
      title: "出售价",
      dataIndex: "sellPrice",
      key: "sellPrice",
      width: 100,
    },
    {
      title: "堆叠",
      key: "stack",
      width: 100,
      render: (_: unknown, record: Seed) =>
        record.stackable ? `${record.maxStack}` : "不可堆叠",
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      render: (val: boolean) => (
        <Tag color={val ? "green" : "default"}>{val ? "启用" : "禁用"}</Tag>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, record: Seed) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>种子管理</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增种子
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1200 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => {
            setPage(page);
            setPageSize(pageSize);
          },
        }}
      />

      <Modal
        title={editingSeed ? "编辑种子" : "新增种子"}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="itemId" label="物品ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="cropId" label="作物ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="buyPrice" label="购买价格" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="sellPrice" label="出售价格" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="stackable" label="可堆叠" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="maxStack" label="最大堆叠" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="requiredTier" label="所需等级" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="seedUnit" label="种子单位" rules={[{ required: true }]}>
              <Input style={{ width: 150 }} />
            </Form.Item>
          </Space>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
