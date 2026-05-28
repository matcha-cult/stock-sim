/**
 * 认证服务（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：用户注册、登录、JWT Token 生成和验证。
 * 2. 不做什么：不处理手机号登录、验证码、第三方登录、会话管理等复杂功能。
 *
 * 输入 / 输出：
 * - 输入：用户名、密码。
 * - 输出：JWT Token、用户信息、角色信息。
 *
 * 数据流 / 状态流：
 * 注册请求 -> 检查用户名唯一性 -> 密码加密 -> 创建用户 -> 返回 Token。
 * 登录请求 -> 验证用户名密码 -> 生成 Token -> 返回用户和角色信息。
 *
 * 复用设计说明：
 * - 精简版仅保留用户名密码登录，移除所有第三方和验证码功能。
 * - 保留密码强度验证和 bcrypt 加密。
 * - 返回角色信息供前端直接使用。
 *
 * 关键边界条件与坑点：
 * 1. 密码必须使用 bcrypt 加密，不能明文存储。
 * 2. JWT Token 有效期通过环境变量配置。
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'stock-sim-secret';
// JWT 有效期：7 天 = 604800 秒
const JWT_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60; // 604800

const SALT_ROUNDS = 10;
const PASSWORD_MIN_LENGTH = 6;

export interface JwtPayload {
  id: number;
  username: string;
}

export interface TokenVerifyResult {
  valid: boolean;
  decoded?: JwtPayload;
}

/**
 * 用户注册。
 */
export const register = async (
  username: string,
  password: string,
): Promise<{ success: boolean; message: string; data?: { token: string; user: { id: number; username: string } } }> => {
  // 参数校验
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return { success: false, message: '用户名不能为空' };
  }
  if (normalizedUsername.length < 3) {
    return { success: false, message: '用户名至少3个字符' };
  }
  if (normalizedUsername.length > 50) {
    return { success: false, message: '用户名最长50字符' };
  }
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { success: false, message: `密码至少${PASSWORD_MIN_LENGTH}个字符` };
  }

  // 检查用户名是否已存在
  const existingUser = await query('SELECT id FROM users WHERE username = $1', [normalizedUsername]);
  if (existingUser.rows.length > 0) {
    return { success: false, message: '用户名已存在' };
  }

  // 加密密码
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // 创建用户
  const result = await query(
    'INSERT INTO users (username, password, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id, username',
    [normalizedUsername, hashedPassword],
  );

  const user = result.rows[0];
  const token = generateToken({ id: Number(user.id), username: String(user.username) });

  return {
    success: true,
    message: '注册成功',
    data: {
      token,
      user: { id: Number(user.id), username: String(user.username) },
    },
  };
};

/**
 * 用户登录。
 */
export const login = async (
  username: string,
  password: string,
): Promise<{ success: boolean; message: string; data?: { token: string; user: { id: number; username: string }; character?: { id: number; nickname: string; spiritStones: number } | null } }> => {
  // 参数校验
  const normalizedUsername = username.trim();
  if (!normalizedUsername || !password) {
    return { success: false, message: '用户名和密码不能为空' };
  }

  // 查询用户
  const userResult = await query(
    'SELECT id, username, password FROM users WHERE username = $1',
    [normalizedUsername],
  );

  if (userResult.rows.length === 0) {
    return { success: false, message: '用户名或密码错误' };
  }

  const user = userResult.rows[0];
  const hashedPassword = user.password;

  if (!hashedPassword) {
    return { success: false, message: '用户名或密码错误' };
  }

  // 验证密码
  const passwordMatch = await bcrypt.compare(password, hashedPassword);
  if (!passwordMatch) {
    return { success: false, message: '用户名或密码错误' };
  }

  // 更新最后登录时间
  await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

  // 查询角色
  const characterResult = await query(
    'SELECT id, nickname, spirit_stones, silver FROM characters WHERE user_id = $1',
    [user.id],
  );

  const character = characterResult.rows.length > 0
    ? {
      id: Number(characterResult.rows[0].id),
      nickname: String(characterResult.rows[0].nickname),
      spiritStones: Number(characterResult.rows[0].spirit_stones),
      silver: Number(characterResult.rows[0].silver ?? 0),
    }
    : null;

  // 生成 Token
  const token = generateToken({ id: Number(user.id), username: String(user.username) });

  return {
    success: true,
    message: '登录成功',
    data: {
      token,
      user: { id: Number(user.id), username: String(user.username) },
      character,
    },
  };
};

/**
 * 获取启动信息（验证登录状态并返回角色信息）。
 */
export const bootstrap = async (
  userId: number,
): Promise<{ success: boolean; data?: { user: { id: number; username: string }; character?: { id: number; nickname: string; gender: string; title: string | null; spiritStones: number } | null } }> => {
  // 查询用户
  const userResult = await query('SELECT id, username FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return { success: false };
  }

  const user = userResult.rows[0];

  // 查询角色
  const characterResult = await query(
    'SELECT id, nickname, gender, title, spirit_stones, silver FROM characters WHERE user_id = $1',
    [userId],
  );

  const character = characterResult.rows.length > 0
    ? {
      id: Number(characterResult.rows[0].id),
      nickname: String(characterResult.rows[0].nickname),
      gender: String(characterResult.rows[0].gender),
      title: characterResult.rows[0].title ? String(characterResult.rows[0].title) : null,
      spiritStones: Number(characterResult.rows[0].spirit_stones),
      silver: Number(characterResult.rows[0].silver ?? 0),
    }
    : null;

  return {
    success: true,
    data: {
      user: { id: Number(user.id), username: String(user.username) },
      character,
    },
  };
};

/**
 * 生成 JWT Token。
 */
export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN_SECONDS });
};

/**
 * 验证 JWT Token。
 */
export const verifyToken = (token: string): TokenVerifyResult => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return { valid: true, decoded };
  } catch {
    return { valid: false };
  }
};