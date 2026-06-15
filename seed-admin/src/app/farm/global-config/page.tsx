"use client";

import { Button, Form, InputNumber, Card, App, Table, Space } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

interface FarmTier {
  tier: number;
  name: string;
  displayName: string;
  minLevel: number;
  xiRangCost: number;
}

interface InitialSeed {
  itemId: string;
  quantity: number;
}

interface GlobalConfig {
  id: number;
  initialRows: number;
  initialCols: number;
  maxRows: number;
  fixedCols: number;
  expansions: unknown[];
  xiRangPrice: number;
  cellReclaimSpiritStone: number;
  cellReclaimXiRang: number;
  farmTiers: FarmTier[];
  initialSeeds: InitialSeed[];
  mutationBaseRate: number;
  mutationPositiveRate: number;
  mutationNeutralRate: number;
  mutationNegativeRate: number;
  mutationInheritRate: number;
  qualityHqRate: number;
  qualityNormalRate: number;
  qualityLqRate: number;
  hybridCooldownMinutes: number;
  accelerationMultiplier: number;
}

export default function GlobalConfigPage() {
  const { message } = App.useApp();
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const fetchConfig = async () => {
    setLoading(true);
    const res = await fetch("/api/farm/global-config");
    const result = await res.json();
    if (result) {
      setConfig(result);
      form.setFieldsValue(result);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSubmit = async () => {
    const values = await form.validateFields();

    if (config) {
      await fetch("/api/farm/global-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      message.success("更新成功");
    } else {
      await fetch("/api/farm/global-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      message.success("创建成功");
    }

    fetchConfig();
  };

  const farmTierColumns = [
    { title: "等级", dataIndex: "tier", key: "tier", width: 80 },
    { title: "名称", dataIndex: "name", key: "name", width: 100 },
    { title: "显示名称", dataIndex: "displayName", key: "displayName", width: 150 },
    { title: "最低等级", dataIndex: "minLevel", key: "minLevel", width: 100 },
    { title: "息壤成本", dataIndex: "xiRangCost", key: "xiRangCost", width: 100 },
  ];

  const initialSeedColumns = [
    { title: "物品ID", dataIndex: "itemId", key: "itemId", width: 200 },
    { title: "数量", dataIndex: "quantity", key: "quantity", width: 100 },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>灵田全局配置</h1>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSubmit}>
          保存配置
        </Button>
      </div>

      <Form form={form} layout="vertical">
        <Card title="网格配置" style={{ marginBottom: 16 }}>
          <Space size="large">
            <Form.Item name="initialRows" label="初始行数" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="initialCols" label="初始列数" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="maxRows" label="最大行数" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="fixedCols" label="固定列数" rules={[{ required: true }]}>
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
          </Space>
        </Card>

        <Card title="息壤配置" style={{ marginBottom: 16 }}>
          <Space size="large">
            <Form.Item name="xiRangPrice" label="息壤单价" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="cellReclaimSpiritStone" label="格子回收灵石" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="cellReclaimXiRang" label="格子回收息壤" rules={[{ required: true }]}>
              <InputNumber style={{ width: 150 }} />
            </Form.Item>
          </Space>
        </Card>

        <Card title="田地等级" style={{ marginBottom: 16 }}>
          <Form.Item name="farmTiers">
            <Table
              columns={farmTierColumns}
              dataSource={config?.farmTiers || []}
              rowKey="tier"
              pagination={false}
              size="small"
            />
          </Form.Item>
        </Card>

        <Card title="初始种子" style={{ marginBottom: 16 }}>
          <Form.Item name="initialSeeds">
            <Table
              columns={initialSeedColumns}
              dataSource={config?.initialSeeds || []}
              rowKey="itemId"
              pagination={false}
              size="small"
            />
          </Form.Item>
        </Card>

        <Card title="突变概率" style={{ marginBottom: 16 }}>
          <Space size="large">
            <Form.Item name="mutationBaseRate" label="基础突变率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="mutationPositiveRate" label="正面突变率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="mutationNeutralRate" label="中性突变率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="mutationNegativeRate" label="负面突变率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="mutationInheritRate" label="继承率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
          </Space>
        </Card>

        <Card title="品质概率" style={{ marginBottom: 16 }}>
          <Space size="large">
            <Form.Item name="qualityHqRate" label="高品质率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="qualityNormalRate" label="普通品质率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="qualityLqRate" label="低品质率" rules={[{ required: true }]}>
              <InputNumber step={0.01} min={0} max={1} style={{ width: 150 }} />
            </Form.Item>
          </Space>
        </Card>

        <Card title="其他配置" style={{ marginBottom: 16 }}>
          <Space size="large">
            <Form.Item name="accelerationMultiplier" label="加速倍率" rules={[{ required: true }]}>
              <InputNumber step={0.1} style={{ width: 150 }} />
            </Form.Item>
          </Space>
        </Card>
      </Form>
    </div>
  );
}
