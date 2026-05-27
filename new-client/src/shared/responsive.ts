/**
 * 响应式检测工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供视口宽度检测，判断是否为移动端。
 * 2. 不做什么：不做布局调整，只提供布尔值状态。
 *
 * 输入 / 输出：
 * - 输入：window matchMedia 事件。
 * - 输出：`useIsMobile` hook 返回布尔值。
 *
 * 数据流 / 状态流：
 * 初始化读取 matchMedia -> 监听 change 事件 -> 更新 state -> 返回 isMobile。
 *
 * 复用设计说明：
 * - 从旧 client 的 shared/responsive.ts 1:1 迁移，无逻辑变更。
 * - 被需要响应式布局的组件复用。
 *
 * 关键边界条件与坑点：
 * 1. SSR 环境无 window，需要防御性判断。
 * 2. 断点 768px 与设计体系保持一致，不要随意修改。
 */

import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

export const isMobileViewport = (width: number): boolean => width <= MOBILE_BREAKPOINT;

export const readIsMobileViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
};

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobileViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const sync = () => setIsMobile(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  return isMobile;
};
