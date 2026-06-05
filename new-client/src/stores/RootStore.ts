/**
 * 根 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：作为 MobX 单一根节点，持有并注入所有子 Store 实例。
 * 2. 不做什么：不直接管理业务状态，只负责子 Store 的创建与传递。
 *
 * 输入 / 输出：
 * - 输入：无（构造时自动创建子 Store）。
 * - 输出：authStore、stockStore、themeStore。
 *
 * 数据流 / 状态流：
 * RootStore 构造 -> 创建 AuthStore / StockStore / ThemeStore -> 子 Store 通过 root 引用互相访问。
 *
 * 复用设计说明：
 * - 单一 RootStore 模式：所有子 Store 通过 constructor 传入 root 引用，避免跨 Store 重复创建依赖。
 * - 组件层通过 React Context 或 Provider 注入 RootStore，全局共享。
 *
 * 关键边界条件与坑点：
 * 1. 子 Store 的构造顺序有依赖关系：AuthStore 和 StockStore 不需要依赖其他 Store，ThemeStore 独立。
 * 2. RootStore 必须是单例，避免多处创建导致状态分裂。
 */

import { createContext } from 'react';
import { makeAutoObservable } from 'mobx';
import { AuthStore } from './AuthStore';
import { StockStore } from './StockStore';
import { ThemeStore } from './ThemeStore';
import { ShopStore } from './ShopStore';
import { ScratchStore } from './ScratchStore';
import { MonthCardStore } from './MonthCardStore';

export class RootStore {
  authStore: AuthStore;
  stockStore: StockStore;
  themeStore: ThemeStore;
  shopStore: ShopStore;
  scratchStore: ScratchStore;
  monthCardStore: MonthCardStore;

  constructor() {
    this.themeStore = new ThemeStore();
    this.stockStore = new StockStore();
    this.authStore = new AuthStore();
    this.shopStore = new ShopStore(this);
    this.scratchStore = new ScratchStore();
    this.monthCardStore = new MonthCardStore();
    makeAutoObservable(this);
  }
}

export const RootStoreContext = createContext<RootStore | null>(null);
