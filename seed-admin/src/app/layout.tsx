import type { Metadata } from "next";
import "./globals.css";
import AntdProvider from "@/components/AntdProvider";
import AppLayout from "@/components/Layout/AppLayout";

export const metadata: Metadata = {
  title: "Seed Admin",
  description: "Seed 配置管理界面",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full">
        <AntdProvider>
          <AppLayout>{children}</AppLayout>
        </AntdProvider>
      </body>
    </html>
  );
}
