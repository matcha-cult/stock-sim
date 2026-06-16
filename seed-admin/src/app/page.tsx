"use client";

import { Card, Col, Row, Statistic, Button, Space, App, Flex, Typography } from "antd";
import {
  ExperimentOutlined,
  ShoppingOutlined,
  ToolOutlined,
  SettingOutlined,
  ExportOutlined,
  ImportOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

interface DashboardStats {
  crops: number;
  seeds: number;
  hybridRecipes: number;
}

export default function HomePage() {
  const { message } = App.useApp();
  const [stats, setStats] = useState<DashboardStats>({
    crops: 0,
    seeds: 0,
    hybridRecipes: 0,
  });
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      const fetchTotal = async (url: string): Promise<number> => {
        try {
          const res = await fetch(url);
          if (!res.ok) return 0;
          const data = await res.json();
          return data.total || 0;
        } catch {
          return 0;
        }
      };

      const [crops, seeds, hybridRecipes] = await Promise.all([
        fetchTotal("/api/farm/crops?pageSize=1"),
        fetchTotal("/api/farm/seeds?pageSize=1"),
        fetchTotal("/api/farm/hybrid-recipes?pageSize=1"),
      ]);

      setStats({ crops, seeds, hybridRecipes });
    };

    fetchStats();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/export", { method: "POST" });
      const result = await res.json();
      if (result.success) {
        message.success(result.message);
      } else {
        message.error(result.message);
      }
    } catch (error) {
      message.error(`导出失败: ${error}`);
    }
    setExporting(false);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (result.success) {
        message.success(result.message);
      } else {
        message.error(result.message);
      }
    } catch (error) {
      message.error(`导入失败: ${error}`);
    }
    setImporting(false);
  };

  return (
    <div>
      <Flex justify="space-between" align="center" style={{ marginBottom: 24 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>仪表盘</Typography.Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={handleImport} loading={importing}>
            从文件导入
          </Button>
          <Button type="primary" icon={<ExportOutlined />} onClick={handleExport} loading={exporting}>
            导出到文件
          </Button>
        </Space>
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="作物数量"
              value={stats.crops}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="种子数量"
              value={stats.seeds}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="杂交配方"
              value={stats.hybridRecipes}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="全局配置"
              value={1}
              prefix={<SettingOutlined />}
              suffix="套"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
