/**
 * Express 应用主入口（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：整合所有路由、中间件，启动 HTTP 服务和股市行情调度器。
 * 2. 不做什么：不直接处理业务请求、不定义路由。
 *
 * 输入 / 输出：
 * - 输入：环境变量配置。
 * - 输出：HTTP 服务。
 */
// 全局 BigInt 序列化支持：Express res.json() 默认不支持 BigInt
// eslint-disable-next-line no-extend-native, @typescript-eslint/no-explicit-any
if (!(BigInt.prototype as any).toJSON) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { pool } from './config/database.js';
import { redis } from './config/redis.js';
import { logger } from './utils/logger.js';
import { registerRoutes } from './bootstrap/registerRoutes.js';
import { initStockDefinitions } from './services/staticConfigLoader.js';
import { initializeStockMarketScheduler, stopStockMarketScheduler } from './services/stockMarket/stockMarketScheduler.js';
import './types/express.d.ts';

dotenv.config();

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

async function startServer() {
  // 测试数据库连接
  try {
    await pool.query('SELECT 1');
    logger.info('数据库连接池已初始化');
  } catch (error) {
    logger.error('数据库连接失败:', error);
    process.exit(1);
  }

  // 加载静态配置（股票定义等）
  await initStockDefinitions();
  logger.info('静态配置已加载');

  // 启动股市行情调度器（每 N 分钟生成 AI 新闻与行情 tick）
  await initializeStockMarketScheduler();
  logger.info('股市行情调度器已启动');

  // 测试 Redis 连接
  try {
    await redis.ping();
    logger.info('Redis 已连接');
  } catch (error) {
    logger.warn('Redis 连接失败，继续启动（部分功能可能受限）:', error);
  }

  // 创建 Express 应用
  const app = express();
  const httpServer = createServer(app);

  // 中间件配置
  app.use(helmet());
  app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 注册路由
  registerRoutes(app);

  // 健康检查端点
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      await redis.ping();
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString() });
    }
  });

  // 启动 HTTP 服务
  httpServer.listen(PORT, () => {
    logger.info(`HTTP 服务已启动，端口: ${PORT}`);
  });

  // 注册关闭钩子
  const gracefulShutdown = async () => {
    logger.info('开始优雅关闭...');
    stopStockMarketScheduler();
    await pool.end();
    await redis.quit();
    logger.info('服务已关闭');
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

startServer().catch((error) => {
  logger.error('服务启动失败:', error);
  process.exit(1);
});