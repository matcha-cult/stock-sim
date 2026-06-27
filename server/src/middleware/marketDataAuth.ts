/**
 * 行情数据 API Key 鉴权中间件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：校验请求 Authorization: Bearer <key> 是否为白名单中的 sk- API key。
 * 2. 不做什么：不处理 JWT、不查询用户/角色身份、不做 QPS 限流。
 *
 * 输入 / 输出：
 * - 输入：HTTP Authorization 头中的 Bearer token。
 * - 输出：
 *   - 校验通过：调用 next()，不写入 req（无玩家上下文）。
 *   - 校验失败：返回 401 `{ success: false, message: '...' }`。
 *
 * 数据流 / 状态流：
 * 环境变量 `MARKET_DATA_API_KEYS`（逗号分隔 sk- 前缀 key）
 *   → 启动时一次性解析并冻结为 Set
 *   → 每次请求读取 Bearer token → 前缀校验 → Set.has 判定
 *
 * 复用设计说明：
 * - 与 JWT 鉴权（auth.ts）完全隔离：面向外部系统而非玩家客户端，独立中间件避免污染 JWT 路径。
 * - Bearer token 读取逻辑内聚在本文件，不与 auth.ts 共享（auth.ts 的 readBearerToken 未导出，且此处语义不同）。
 *
 * 关键边界条件与坑点：
 * 1. fail-closed：启动时若白名单为空（环境变量未设置、无合法 sk- key），直接抛错阻止服务启动，
 *    避免"配置缺失却默默放行"或"默默拒绝所有请求但无人察觉"的隐患。
 * 2. 只接受 sk- 前缀：即便白名单中混入非 sk- 条目，解析阶段即过滤掉，避免历史配置污染运行时。
 */
import type { NextFunction, Request, Response } from 'express';

const API_KEY_PREFIX = 'sk-';
const ENV_VAR_NAME = 'MARKET_DATA_API_KEYS';

const UNAUTHORIZED_MESSAGE = 'API key 无效或未授权';

/**
 * 解析白名单：按逗号拆分 → trim → 过滤空串和非法前缀 → 冻结为 Set。
 *
 * 为何用 Set 而非 timingSafeEqual 逐个比对：
 * API key 为高熵随机串（sk- + 32+ 位随机字符），Set.has 的哈希比对时序差异
 * 无法被用来反推 key 内容；timingSafeEqual 主要用于低熵场景（PIN、短密码）。
 */
const parseApiKeyWhitelist = (raw: string | undefined): ReadonlySet<string> => {
  if (!raw || !raw.trim()) return new Set();
  const keys = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.startsWith(API_KEY_PREFIX));
  return new Set(keys);
};

const API_KEY_WHITELIST: ReadonlySet<string> = parseApiKeyWhitelist(process.env[ENV_VAR_NAME]);

if (API_KEY_WHITELIST.size === 0) {
  throw new Error(
    `环境变量 ${ENV_VAR_NAME} 必须配置至少一个 ${API_KEY_PREFIX} 开头的 API key，否则行情接口无法以 fail-closed 方式启动`,
  );
}

const readBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token ? token : null;
};

export const requireMarketDataApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const key = readBearerToken(req);
  if (!key || !key.startsWith(API_KEY_PREFIX) || !API_KEY_WHITELIST.has(key)) {
    res.status(401).json({ success: false, message: UNAUTHORIZED_MESSAGE });
    return;
  }
  // 写入请求上下文，供下游 QPS 限流以 key 为 scope 独立计数
  req.marketDataApiKey = key;
  next();
};
