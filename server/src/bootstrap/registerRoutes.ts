/**
 * 路由注册入口。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：注册所有 API 路由（认证、角色、股市）。
 * 2. 不做什么：不处理路由内部逻辑，只负责组装。
 *
 * 输入 / 输出：
 * - 输入：Express 应用实例。
 * - 输出：已注册路由的应用实例。
 */
import type express from 'express';
import authRoutes from '../routes/authRoutes.js';
import characterRoutes from '../routes/characterRoutes.js';
import stockMarketRoutes from '../routes/stockMarketRoutes.js';
import rankRoutes from '../routes/rankRoutes.js';
import shopRoutes from '../routes/shopRoutes.js';
import ledgerRoutes from '../routes/ledgerRoutes.js';

export function registerRoutes(app: express.Application): void {
  // 认证路由
  app.use('/api/auth', authRoutes);

  // 角色路由
  app.use('/api/character', characterRoutes);

  // 股市路由
  app.use('/api/stock-market', stockMarketRoutes);

  // 排行路由
  app.use('/api/rank', rankRoutes);

  // 店铺路由
  app.use('/api/shop', shopRoutes);

  // 灵石流水账路由
  app.use('/api/ledger', ledgerRoutes);
}