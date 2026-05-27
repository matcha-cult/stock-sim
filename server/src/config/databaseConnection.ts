/**
 * 数据库连接配置统一入口
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中解析 `DATABASE_URL` 与 `DB_*`，为 Prisma CLI 与运行时连接池提供同一份连接串。
 * 2. 做什么：把连接串拼装规则收敛到单一模块，避免部署脚本、Prisma 配置、服务端连接池各自维护一套逻辑。
 * 3. 不做什么：不创建数据库连接，不承担查询、事务、迁移等业务行为。
 *
 * 输入/输出：
 * - 输入：环境变量对象，通常是 `process.env`。
 * - 输出：标准化的 PostgreSQL 连接串。
 *
 * 数据流/状态流：
 * `process.env` -> 优先读取 `DATABASE_URL` -> 若缺失则从 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` 组装 -> 返回给 Prisma 与 `pg` 复用。
 *
 * 关键边界条件与坑点：
 * 1. `DATABASE_URL` 一旦显式提供，必须原样复用，避免 Prisma 与运行时对同一数据库地址产生不同解释。
 * 2. 当密码、用户名包含空格或 `@` 等特殊字符时，组装连接串必须进行 URL 编码，否则生产环境极易出现“本地可用、部署失败”的差异。
 */

type DatabaseEnvironment = NodeJS.ProcessEnv;
const DATABASE_ENV_KEYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;
type DatabaseEnvKey = (typeof DATABASE_ENV_KEYS)[number];

const normalizeEnvValue = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const encodeDatabasePathSegment = (value: string): string => {
  return encodeURIComponent(value).replace(/%2F/giu, '/');
};

const readRequiredDatabaseEnv = (
  env: DatabaseEnvironment,
  key: DatabaseEnvKey,
): string => {
  const value = normalizeEnvValue(env[key]);
  if (value) {
    return value;
  }

  throw new Error(`缺少数据库环境变量：${key}`);
};

const buildPostgresConnectionString = (env: DatabaseEnvironment): string => {
  const host = readRequiredDatabaseEnv(env, 'DB_HOST');
  const port = readRequiredDatabaseEnv(env, 'DB_PORT');
  const database = readRequiredDatabaseEnv(env, 'DB_NAME');
  const user = readRequiredDatabaseEnv(env, 'DB_USER');
  const password = readRequiredDatabaseEnv(env, 'DB_PASSWORD');

  return [
    'postgresql://',
    encodeURIComponent(user),
    ':',
    encodeURIComponent(password),
    '@',
    host,
    ':',
    port,
    '/',
    encodeDatabasePathSegment(database),
  ].join('');
};

export const resolveDatabaseConnectionString = (env: DatabaseEnvironment): string => {
  const explicitDatabaseUrl = normalizeEnvValue(env.DATABASE_URL);
  if (explicitDatabaseUrl) {
    return explicitDatabaseUrl;
  }

  return buildPostgresConnectionString(env);
};
