/**
 * 主题 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理全局主题模式（明亮/暗黑），持久化到 localStorage。
 * 2. 不做什么：不直接操作 antd ConfigProvider，只提供 observable 状态供组件读取。
 *
 * 输入 / 输出：
 * - 输入：用户切换操作、localStorage 初始化。
 * - 输出：`isDark` observable 布尔值。
 *
 * 数据流 / 状态流：
 * 构造时读取 localStorage -> 切换时写入 observable + localStorage -> ConfigProvider 消费 isDark。
 *
 * 复用设计说明：
 * - 单一主题状态被 RootStore 持有，所有需要主题感知的组件通过 RootStore 读取。
 * - localStorage key 集中定义，避免散落重复。
 *
 * 关键边界条件与坑点：
 * 1. SSR 环境无 localStorage，需要防御性判断。
 * 2. 主题切换需要触发 antd ConfigProvider 的 algorithm 重新计算，依赖 isDark 的 observable 变化。
 */

import { makeAutoObservable } from 'mobx';

const THEME_STORAGE_KEY = 'stock-sim-theme-mode';

export class ThemeStore {
  isDark: boolean;

  constructor() {
    this.isDark = this.readInitialTheme();
    makeAutoObservable(this);
  }

  private readInitialTheme(): boolean {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    // 跟随系统偏好
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  toggle(): void {
    this.isDark = !this.isDark;
    this.persistTheme();
  }

  setDark(isDark: boolean): void {
    this.isDark = isDark;
    this.persistTheme();
  }

  private persistTheme(): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, this.isDark ? 'dark' : 'light');
  }
}
