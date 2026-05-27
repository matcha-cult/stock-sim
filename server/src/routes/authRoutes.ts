/**
 * 认证路由（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：用户注册、登录、启动信息查询。
 * 2. 不做什么：不处理手机号登录、验证码、密码重置等复杂功能。
 *
 * 输入 / 输出：
 * - 输入：用户名、密码。
 * - 输出：JWT Token、用户信息、角色信息。
 */
import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createQpsLimitMiddleware } from '../middleware/qpsLimit.js';
import { register, login, bootstrap, verifyToken } from '../services/authService.js';
import { checkCharacter } from '../services/characterService.js';
import { sendSuccess, sendResult } from '../middleware/response.js';

const router: RouterType = Router();

const AUTH_QPS_LIMIT_MESSAGE = '认证请求过于频繁，请稍后再试';

const registerQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:auth:register',
  limit: 6,
  windowMs: 10 * 60 * 1000,
  message: AUTH_QPS_LIMIT_MESSAGE,
  resolveScope: () => 'global',
});

const loginQpsLimit = createQpsLimitMiddleware({
  keyPrefix: 'qps:auth:login',
  limit: 12,
  windowMs: 60 * 1000,
  message: AUTH_QPS_LIMIT_MESSAGE,
  resolveScope: () => 'global',
});

type AuthPayload = {
  username?: string;
  password?: string;
};

// 注册接口
router.post('/register', registerQpsLimit, asyncHandler(async (req, res) => {
  const payload = (req.body ?? {}) as AuthPayload;
  const username = payload.username?.trim() ?? '';
  const password = payload.password ?? '';

  if (!username || !password) {
    res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    return;
  }

  const result = await register(username, password);
  sendResult(res, result);
}));

// 登录接口
router.post('/login', loginQpsLimit, asyncHandler(async (req, res) => {
  const payload = (req.body ?? {}) as AuthPayload;
  const username = payload.username?.trim() ?? '';
  const password = payload.password ?? '';

  if (!username || !password) {
    res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    return;
  }

  const result = await login(username, password);
  sendResult(res, result);
}));

// 启动信息接口（用于持久登录恢复）
router.get('/bootstrap', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: '登录状态无效，请重新登录' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const { valid, decoded } = verifyToken(token);

  if (!valid || !decoded) {
    res.status(401).json({ success: false, message: '登录状态无效，请重新登录' });
    return;
  }

  const userId = decoded.id;
  const result = await bootstrap(userId);

  if (!result.success) {
    res.status(401).json({ success: false, message: '用户不存在' });
    return;
  }

  sendSuccess(res, result.data);
}));

export default router;