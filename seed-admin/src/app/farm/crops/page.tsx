"use client";

import { Button, Table, Space, Tag, Switch, Modal, Form, Input, InputNumber, Select, App, Popconfirm } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

interface Crop {
  id: number;
  cropId: string;
  name: string;
  description: string;
  element: string | null;
  rarity: string;
  sortOrder: number;
  enabled: boolean;
  growthStageMinutes: string;
  stageLabels: string;
  witherAfterMinutes: number;
  yieldMin: number;
  yieldMax: number;
  sellPricePerUnit: number;
  harvestTradeUnit: number;
  expGain: number;
  requiredTier: number;
  seedItemId: string;
  seedUnit: string;
  harvestUnit: string;
  seedFromYield: boolean;
}

const rarityColors: Record<string, string> = {
  common: "default",
  uncommon: "green",
  rare: "blue",
  epic: "purple",
  legendary: "orange",
};

const elementOptions = [
  { label: "金", value: "金" },
  { label: "木", value: "木" },
  { label: "水", value: "水" },
  { label: "火", value: "火" },
  { label: "土", value: "土" },
];

const rarityOptions = [
  { label: "普通", value: "common" },
  { label: "优秀", value: "uncommon" },
  { label: "稀有", value: "rare" },
  { label: "史诗", value: "epic" },
  { label: "传说", value: "legendary" },
];

export default function CropsPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<Crop[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCrop, setEditingCrop] = useState<Crop | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(`/api/farm/crops?page=${page}&pageSize=${pageSize}`);
    const result = await res.json();
    setData(result.items);
    setTotal(result.total);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize]);

  const handleAdd = () => {
    setEditingCrop(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      seedFromYield: false,
      sortOrder: 0,
      requiredTier: 1,
    });
    setModalVisible(true);
  };

  const handleEdit = (record: Crop) => {
    setEditingCrop(record);
    form.setFieldsValue({
      ...record,
      growthStageMinutes: JSON.parse(record.growthStageMinutes),
      stageLabels: JSON.parse(record.stageLabels),
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/farm/crops?id=${id}`, { method: "DELETE" });
    message.success("删除成功");
    fetchData();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      growthStageMinutes: JSON.stringify(values.growthStageMinutes),
      stageLabels: JSON.stringify(values.stageLabels),
    };

    if (editingCrop) {
      await fetch("/api/farm/crops", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCrop.id, ...payload }),
      });
      message.success("更新成功");
    } else {
      await fetch("/api/farm/crops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      message.success("创建成功");
    }

    setModalVisible(false);
    fetchData();
  };

  const columns = [
    { title: "排序", dataIndex: "sortOrder", key: "sortOrder", width: 80 },
    { title: "作物ID", dataIndex: "cropId", key: "cropId", width: 180 },
    { title: "名称", dataIndex: "name", key: "name", width: 120 },
    {
      title: "元素",
      dataIndex: "element",
      key: "element",
      width: 80,
      render: (val: string | null) => val || "-",
    },
    {
      title: "稀有度",
      dataIndex: "rarity",
      key: "rarity",
      width: 100,
      render: (val: string) => <Tag color={rarityColors[val]}>{val}</Tag>,
    },
    {
      title: "产量",
      key: "yield",
      width: 100,
      render: (_: unknown, record: Crop) => `${record.yieldMin}-${record.yieldMax}`,
    },
    {
      title: "售价",
      dataIndex: "sellPricePerUnit",
      key: "sellPricePerUnit",
      width: 80,
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
      render: (_: unknown, record: Crop) => (
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
        <h1 style={{ margin: 0 }}>作物管理</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增作物
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
        title={editingCrop ? "编辑作物" : "新增作物"}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={800}
      >
        <Form form={form} layout="vertical">
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
            <Form.Item name="element" label="元素">
              <Select options={elementOptions} allowClear style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="rarity" label="稀有度" rules={[{ required: true }]}>
              <Select options={rarityOptions} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="growthStageMinutes" label="生长阶段（分钟）" rules={[{ required: true }]}>
            <Select mode="tags" tokenSeparators={[","]} placeholder="输入数字，回车确认" />
          </Form.Item>
          <Form.Item name="stageLabels" label="阶段标签" rules={[{ required: true }]}>
            <Select mode="tags" tokenSeparators={[","]} placeholder="输入标签，回车确认" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="yieldMin" label="最小产量" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="yieldMax" label="最大产量" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sellPricePerUnit" label="单位售价" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="witherAfterMinutes" label="枯萎时间（分钟）" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="expGain" label="经验获取" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="requiredTier" label="所需等级" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="seedItemId" label="种子物品ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space size="large">
            <Form.Item name="seedUnit" label="种子单位" rules={[{ required: true }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="harvestUnit" label="收获单位" rules={[{ required: true }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="harvestTradeUnit" label="收获交易单位" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
          </Space>
          <Space size="large">
            <Form.Item name="seedFromYield" label="收获产出种子" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
