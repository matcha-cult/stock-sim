/**
 * 运行时 URL 配置。
 *
 * 提供 API 服务的基础 URL。
 * Rsbuild 通过 source.define 注入 process.env.API_URL。
 */
export const API_BASE = process.env.API_URL ?? 'http://localhost:3000';
