"use client";

import { Layout, Menu } from "antd";
import {
  HomeOutlined,
  ExperimentOutlined,
  ToolOutlined,
  StockOutlined,
  CreditCardOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const { Sider, Content } = Layout;

const menuItems = [
  {
    key: "/",
    icon: <HomeOutlined />,
    label: "仪表盘",
  },
  {
    key: "farm",
    icon: <ExperimentOutlined />,
    label: "灵田配置",
    children: [
      { key: "/farm/crops", label: "作物管理" },
      { key: "/farm/seeds", label: "种子管理" },
      { key: "/farm/hybrid-recipes", label: "杂交配方" },
      { key: "/farm/global-config", label: "全局配置" },
    ],
  },
  {
    key: "industry",
    icon: <ToolOutlined />,
    label: "工业配置",
    children: [
      { key: "/industry/materials", label: "材料管理" },
      { key: "/industry/machines", label: "机器管理" },
      { key: "/industry/factories", label: "工厂管理" },
      { key: "/industry/puppets", label: "傀儡配置" },
      { key: "/industry/recipes", label: "配方管理" },
      { key: "/industry/products", label: "产品管理" },
    ],
  },
  {
    key: "/stocks",
    icon: <StockOutlined />,
    label: "股票配置",
  },
  {
    key: "/month-card",
    icon: <CreditCardOutlined />,
    label: "月卡配置",
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const selectedKeys = [pathname];
  const openKeys = menuItems
    .filter((item) => "children" in item && item.children?.some((child) => child.key === pathname))
    .map((item) => item.key);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={240}>
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            fontWeight: 600,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          Seed Admin
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: "#fff",
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
