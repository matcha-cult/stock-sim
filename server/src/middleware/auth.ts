/**
 * 统一鉴权中间件（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：验证 JWT Token，提取用户ID和角色ID。
 * 2. 不做什么：不处理并发请求限制，不验证 session_token。
 *
 * 输入 / 输出：
 * - 输入：HTTP Authorization Bearer Token。
 * - 输出：
 *   - `requireAuth` 成功时在 `req.userId` 写入用户ID；失败返回 401。
 *   - `requireCharacter` 在 requireAuth 基础上查询角色ID，写入 `req.characterId`；角色不存在返回 404。
 *
 * 复用设计说明：
 * - 精简版移除并发请求限制功能，简化认证流程。
 * - 保留 JWT 验证和角色查询核心逻辑。
 *
 * 关键边界条件与坑点：
 * 1. 401 文案统一为"登录状态无效，请重新登录"。
 * 2. 角色不存在返回 404，文案为"角色不存在"。
 */
import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../services/authService.js';
import { query } from '../config/database.js';

const AUTH_INVALID_MESSAGE = '登录状态无效，请重新登录';

const readBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token ? token : null;
};

const parseUserIdFromToken = (token: string): number | null => {
  const { valid, decoded } = verifyToken(token);
  if (!valid || !decoded) return null;
  const userId = Number(decoded.id);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return userId;
};

const getCharacterIdByUserId = async (userId: number): Promise<number | null> => {
  const result = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [userId]);
  if (result.rows.length === 0) return null;
  return Number(result.rows[0].id);
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  const userId = parseUserIdFromToken(token);
  if (!userId) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  req.userId = userId;
  next();
};

/**
 * 鉴权 + 角色查询中间件。
 * 成功时同时在 req 上写入 userId 和 characterId；角色不存在返回 404。
 */
export const requireCharacter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  const userId = parseUserIdFromToken(token);
  if (!userId) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  req.userId = userId;

  const characterId = await getCharacterIdByUserId(userId);
  if (!characterId) {
    res.status(404).json({ success: false, message: '角色不存在' });
    return;
  }

  req.characterId = characterId;
  next();
};

export const getOptionalUserId = (req: Request): number | undefined => {
  const token = readBearerToken(req);
  if (!token) return undefined;
  const userId = parseUserIdFromToken(token);
  return userId ?? undefined;
};

/**
 * 鉴权 + GM 权限校验中间件。
 * 验证 JWT Token 且 permissions 包含 'GM'，否则返回 403。
 * 成功时在 req 上写入 userId。
 */
export const requireGm = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  const { valid, decoded } = verifyToken(token);
  if (!valid || !decoded) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  const userId = Number(decoded.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(401).json({ success: false, message: AUTH_INVALID_MESSAGE });
    return;
  }

  const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
  if (!permissions.includes('GM')) {
    res.status(403).json({ success: false, message: '需要 GM 权限才能访问此接口' });
    return;
  }

  req.userId = userId;
  next();
};