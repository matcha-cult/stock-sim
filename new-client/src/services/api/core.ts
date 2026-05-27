/**
 * API 核心模块。
 *
 * 创建 axios 实例，处理请求/响应拦截，统一错误处理，提供类型安全的 API 方法。
 */
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import {
  emitApiErrorToast,
  shouldAutoErrorToast,
  toUnifiedApiError,
  type UnifiedApiError,
} from './error';
import { API_BASE } from '../runtimeUrls';

export interface ApiPayload<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
}

const axiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 token
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器 - 处理业务错误
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    const payload = response.data;
    if (payload && typeof payload === 'object' && 'success' in payload) {
      const success = (payload as { success?: unknown }).success;
      if (success === false) {
        const record = payload as { message?: unknown; code?: unknown };
        const normalized = toUnifiedApiError(
          {
            message: record.message,
            code: record.code,
            success: false,
            httpStatus: response.status,
            raw: payload,
          },
          '请求失败',
        );
        if (shouldAutoErrorToast(response.config as { meta?: { autoErrorToast?: boolean } } | undefined)) {
          emitApiErrorToast({ message: normalized.message, error: normalized });
        }
        return Promise.reject(normalized);
      }
    }
    return response;
  },
  (error) => {
    const normalized = toUnifiedApiError(error, '网络错误');
    if (shouldAutoErrorToast(error?.config as { meta?: { autoErrorToast?: boolean } } | undefined)) {
      emitApiErrorToast({ message: normalized.message, error: normalized });
    }
    return Promise.reject(normalized);
  },
);

/**
 * 类型安全的 API 客户端。
 * 封装 axios 实例方法，将 AxiosResponse 转换为 ApiPayload。
 * 失败时返回 { success: false, message } 格式，不抛异常。
 */
const api = {
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<ApiPayload<T>> {
    try {
      const response = await axiosInstance.get<ApiPayload<T>>(url, config);
      return response.data;
    } catch (error: unknown) {
      const normalized = error as UnifiedApiError;
      return {
        success: false,
        data: undefined as T,
        message: normalized.message,
      };
    }
  },

  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiPayload<T>> {
    try {
      const response = await axiosInstance.post<ApiPayload<T>>(url, data, config);
      return response.data;
    } catch (error: unknown) {
      const normalized = error as UnifiedApiError;
      return {
        success: false,
        data: undefined as T,
        message: normalized.message,
      };
    }
  },

  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiPayload<T>> {
    try {
      const response = await axiosInstance.put<ApiPayload<T>>(url, data, config);
      return response.data;
    } catch (error: unknown) {
      const normalized = error as UnifiedApiError;
      return {
        success: false,
        data: undefined as T,
        message: normalized.message,
      };
    }
  },

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<ApiPayload<T>> {
    try {
      const response = await axiosInstance.delete<ApiPayload<T>>(url, config);
      return response.data;
    } catch (error: unknown) {
      const normalized = error as UnifiedApiError;
      return {
        success: false,
        data: undefined as T,
        message: normalized.message,
      };
    }
  },

  raw: axiosInstance,
};

export default api;
