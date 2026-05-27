/**
 * 接口请求配置共享常量。
 *
 * 统一收口"关闭自动错误 toast"的请求配置。
 * 提供 withRequestParams 合并调用方透传配置与本次请求参数。
 */
import type { AxiosRequestConfig } from 'axios';

type RequestParamValue = string | number | boolean | null | undefined;
type RequestParams = Record<string, RequestParamValue>;

interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  meta?: {
    autoErrorToast?: boolean;
  };
}

const isPlainRequestParams = (value: AxiosRequestConfig['params']): value is RequestParams => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const SILENT_API_REQUEST_META = {
  autoErrorToast: false,
} as const;

export const SILENT_API_REQUEST_CONFIG: ExtendedAxiosRequestConfig = {
  meta: SILENT_API_REQUEST_META,
};

export const withRequestParams = <TParams extends RequestParams>(
  requestConfig: ExtendedAxiosRequestConfig | undefined,
  params: TParams,
): ExtendedAxiosRequestConfig => {
  const baseParams = isPlainRequestParams(requestConfig?.params) ? requestConfig.params : {};
  return {
    ...requestConfig,
    params: {
      ...baseParams,
      ...params,
    },
  };
};
