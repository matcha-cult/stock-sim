/**
 * 服务端全局配置接口。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：获取服务端运行模式标志（如灵田内测开关），无需鉴权。
 * 2. 不做什么：不处理用户数据、不做鉴权请求。
 *
 * 数据流 / 状态流：
 * 前端 GET /api/server-config → 返回 { farmBetaWipeMode: boolean }。
 *
 * 复用设计说明：
 * - 独立模块：配置获取与认证流程解耦，任何组件均可调用。
 * - 无需 token：接口不要求登录即可访问。
 */
import api from './core';

export interface ServerConfigDto {
  farmBetaWipeMode: boolean;
}

export const fetchServerConfig = (): Promise<ServerConfigDto> =>
  api.get<ServerConfigDto>('/api/server-config').then((r) => r.data);
