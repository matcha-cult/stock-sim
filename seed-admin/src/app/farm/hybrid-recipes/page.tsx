"use client";

import { Button, Table, Tag, Modal, Form, Input, InputNumber, Select, App, Popconfirm, Space, Flex, Typography } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

interface HybridRecipe {
  id: number;
  recipeId: string;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  baseCropId: string;
  requiredCrops: string[];
  minRequired: number | null;
  resultCropId: string;
  resultSeedItemId: string;
  resultQuantity: number;
}

export default function HybridRecipesPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<HybridRecipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<HybridRecipe | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    const res = await fetch(`/api/farm/hybrid-recipes?page=${page}&pageSize=${pageSize}`);
    const result = await res.json();
    setData(result.items);
    setTotal(result.total);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize]);

  const handleAdd = () => {
    setEditingRecipe(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      sortOrder: 0,
      resultQuantity: 1,
      requiredCrops: [],
      minRequired: null,
    });
    setModalVisible(true);
  };

  const handleEdit = (record: HybridRecipe) => {
    setEditingRecipe(record);
    form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/farm/hybrid-recipes?id=${id}`, { method: "DELETE" });
    message.success("删除成功");
    fetchData();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();

    if (editingRecipe) {
      await fetch("/api/farm/hybrid-recipes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingRecipe.id, ...values }),
      });
      message.success("更新成功");
    } else {
      await fetch("/api/farm/hybrid-recipes", {
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
    { title: "配方ID", dataIndex: "recipeId", key: "recipeId", width: 180 },
    { title: "名称", dataIndex: "name", key: "name", width: 120 },
    {
      title: "基础作物",
      dataIndex: "baseCropId",
      key: "baseCropId",
      width: 150,
    },
    {
      title: "所需作物",
      dataIndex: "requiredCrops",
      key: "requiredCrops",
      width: 200,
      render: (crops: string[]) => (
        <Space wrap>
          {crops.map((crop) => (
            <Tag key={crop} color="blue">{crop}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "最少数量",
      dataIndex: "minRequired",
      key: "minRequired",
      width: 100,
      render: (val: number | null) => (val != null ? val : "全部"),
    },
    { title: "产物作物", dataIndex: "resultCropId", key: "resultCropId", width: 180 },
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
      render: (_: unknown, record: HybridRecipe) => (
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
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>杂交配方</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增配方
        </Button>
      </Flex>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1300 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 30, 50, 100, 500],
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => {
            setPage(page);
            setPageSize(pageSize);
          },
        }}
      />

      <Modal
        title={editingRecipe ? "编辑配方" : "新增配方"}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="recipeId" label="配方ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="baseCropId" label="基础作物ID" rules={[{ required: true }]}>
              <Input style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="requiredCrops" label="所需作物ID列表" rules={[{ required: true }]}>
              <Select mode="tags" tokenSeparators={[","]} placeholder="输入作物ID，回车确认" style={{ minWidth: 300 }} />
            </Form.Item>
          </Space>
          <Form.Item name="minRequired" label="最少满足数量（留空=全部）">
            <InputNumber style={{ width: 200 }} min={1} placeholder="留空表示需全部满足" />
          </Form.Item>
          <Form.Item name="resultCropId" label="产物作物ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="resultSeedItemId" label="产物种子物品ID" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space size="large">
            <Form.Item name="resultQuantity" label="产物数量" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Select
              options={[
                { label: "启用", value: true },
                { label: "禁用", value: false },
              ]}
              style={{ width: 120 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
