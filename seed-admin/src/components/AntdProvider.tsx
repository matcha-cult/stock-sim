"use client";

import { ConfigProvider, theme, App } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";

export default function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <App>
        {children}
      </App>
    </ConfigProvider>
  );
}
