/**
 * 服务端全局配置路由。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：向前端暴露服务端运行模式标志（如灵田内测开关），无需鉴权。
 * 2. 不做什么：不提供敏感配置、不返回用户数据。
 *
 * 数据流 / 状态流：
 * 前端 GET /api/server-config → 读取环境变量 → 返回 { farmBetaWipeMode }。
 *
 * 复用设计说明：
 * - 无需鉴权：未登录用户也需看到内测提示。
 * - 可扩展：后续若有其他全局标志（维护模式等），在此端点追加字段即可。
 *
 * 关键边界条件与坑点：
 * 1. 仅返回布尔标志，不暴露环境变量原始值。
 * 2. 无需 character 校验，不引入 requireCharacter 中间件。
 */
import { Router, type Router as RouterType } from 'express';
import { sendSuccess } from '../middleware/response.js';

const router: RouterType = Router();

router.get(
  '/',
  (_req, res) => {
    sendSuccess(res, {
      farmBetaWipeMode: process.env.FARM_BETA_WIPE_MODE === 'true',
    });
  },
);

export default router;
