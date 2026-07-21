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
import { errorHandler } from './middleware/errorHandler.js';
import { initStockDefinitions } from './services/staticConfigLoader.js';
import { initializeStockMarketScheduler, stopStockMarketScheduler } from './services/stockMarket/stockMarketScheduler.js';
import { initializeShopRentScheduler, stopShopRentScheduler } from './services/shop/shopRentScheduler.js';
import { initMonthCardConfig } from './services/monthCard/monthCardConfigCache.js';
import { scratchPrizeConfigCache } from './services/scratchGame/scratchPrizeConfigCache.js';
import { initFarmConfig } from './services/farm/farmConfigLoader.js';
import { initItemConfig } from './services/inventory/itemConfigLoader.js';
import { initBeastConfig } from './services/beast/beastConfigLoader.js';
import { initMonsterTemplateConfig } from './services/demonCave/monsterTemplateLoader.js';
import { initDemonCaveMonsterConfig } from './services/demonCave/monsterConfigLoader.js';
import { initDropPoolConfig } from './services/demonCave/dropPoolLoader.js';
import { initDemonCaveFloorConfig } from './services/demonCave/floorConfigLoader.js';
import { initStarLevelConfig } from './services/shared/starLevelLoader.js';
import { startIdleBattleWorker, stopIdleBattleWorker } from './services/demonCave/idleBattleWorker.js';

dotenv.config();

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// 支持多个开发端口
const CORS_ORIGINS = [CORS_ORIGIN, 'http://localhost:5174'].filter(Boolean);

async function startServer() {
  // 测试数据库连接
  try {
    await pool.query('SELECT 1');
    logger.info('数据库连接池已初始化');
  } catch (error) {
    logger.error(error, '数据库连接失败');
    process.exit(1);
  }

  // 加载静态配置（股票定义等）
  await initStockDefinitions();
  logger.info('静态配置已加载');

  // 启动股市行情调度器（每 N 分钟生成 AI 新闻与行情 tick）
  const schedulerActive = await initializeStockMarketScheduler();
  logger.info(schedulerActive ? '股市行情调度器已启动' : '股市行情调度器已加载（tick 未启用）');

  // 启动收租调度器（独立 tick 间隔，不与股市行情混用）
  const shopRentActive = await initializeShopRentScheduler();
  logger.info(shopRentActive ? '店铺收租调度器已启动' : '店铺收租调度器已加载（tick 未启用）');

  // 加载月卡配置（纯内存，不写 DB）
  await initMonthCardConfig();
  logger.info('月卡配置缓存已加载（纯内存）');

  // 加载刮刮乐奖金配置（种子 UPSERT + 缓存加载）
  await scratchPrizeConfigCache.init();
  logger.info('刮刮乐奖金配置缓存已加载（种子已同步）');

  // 加载灵田配置（纯内存，Map 索引）
  await initFarmConfig();
  logger.info('灵田配置已加载（纯内存）');

  // 加载统一背包物品配置（纯内存，Map 索引）
  await initItemConfig();
  logger.info('统一背包物品配置已加载（纯内存）');

  // 加载灵兽配置（灵兽模板 + 成长参数 + 祭坛配方）
  await initBeastConfig();
  logger.info('灵兽配置已加载（纯内存）');

  // 加载星级配置（灵兽和怪物通用）
  await initStarLevelConfig();
  logger.info('星级配置已加载（纯内存）');

  // 加载锁妖窟怪物模板配置（纯内存，Map 索引）
  await initMonsterTemplateConfig();
  logger.info('锁妖窟怪物模板配置已加载（纯内存）');

  // 加载锁妖窟怪物清单配置（纯内存，Map 索引，引用模板）
  await initDemonCaveMonsterConfig();
  logger.info('锁妖窟怪物清单配置已加载（纯内存）');

  // 加载锁妖窟掉落池配置（纯内存，Map 索引）
  await initDropPoolConfig();
  logger.info('锁妖窟掉落池配置已加载（纯内存）');

  // 加载锁妖窟楼层配置（纯内存，Map 索引，引用怪物清单和掉落池）
  await initDemonCaveFloorConfig();
  logger.info('锁妖窟楼层配置已加载（纯内存）');

  // 测试 Redis 连接
  try {
    await redis.ping();
    logger.info('Redis 已连接');

    // 启动挂机战斗 Worker（依赖 Redis）
    startIdleBattleWorker();
    logger.info('挂机战斗 Worker 已启动');
  } catch (error) {
    logger.warn(error, 'Redis 连接失败，继续启动（部分功能可能受限）');
  }

  // 创建 Express 应用
  const app = express();
  const httpServer = createServer(app);

  // 中间件配置
  app.use(helmet());
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 注册路由
  registerRoutes(app);

  // 全局错误处理（必须在所有路由之后）
  app.use(errorHandler);

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
    stopShopRentScheduler();
    await stopIdleBattleWorker();
    await pool.end();
    await redis.quit();
    logger.info('服务已关闭');
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

startServer().catch((error) => {
  logger.error(error, '服务启动失败');
  process.exit(1);
});