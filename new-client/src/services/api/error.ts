/**
 * 统一接口错误模块。
 *
 * 把 HTTP 异常、网络异常、业务失败（success=false）统一为同一错误结构。
 * 提供通用错误文案提取、提示函数与登录态错误分流。
 */
import axios from 'axios';

export type UnifiedApiErrorKind = 'business' | 'http' | 'network' | 'unknown';

export interface UnifiedApiError {
  isUnifiedApiError: true;
  kind: UnifiedApiErrorKind;
  message: string;
  httpStatus: number | null;
  code: string | null;
  bizSuccess: boolean | null;
  raw: unknown;
}

export interface ErrorNotifier {
  error: (content: string) => unknown;
}

export const API_ERROR_TOAST_EVENT = 'api:error-toast';

export interface ApiErrorToastDetail {
  message: string;
  error: UnifiedApiError;
}

const DEFAULT_FALLBACK_MESSAGE = '网络错误';
const AUTH_INVALID_HTTP_STATUS = 401;
const TEMPORARY_UNAVAILABLE_MIN_STATUS = 500;
const TEMPORARY_UNAVAILABLE_MAX_STATUS = 599;
const REQUEST_TIMEOUT_HTTP_STATUS = 408;
const TOO_MANY_REQUESTS_HTTP_STATUS = 429;

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};

const toCodeString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const code = value.trim();
    return code ? code : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const toNullableStatus = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
};

const getRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
};

const getAxiosResponseDataRecord = (error: UnifiedApiError): Record<string, unknown> | null => {
  const rawRecord = getRecord(error.raw);
  const responseRecord = getRecord(rawRecord?.response);
  return getRecord(responseRecord?.data);
};

const getFallbackMessage = (fallback?: string): string => {
  return toNonEmptyString(fallback) ?? DEFAULT_FALLBACK_MESSAGE;
};

const debugLogUnifiedApiError = (_context: string, _error: UnifiedApiError): void => {
  // 开发态可在此处输出结构化日志
  void _context;
  void _error;
};

export const toUnifiedApiError = (error: unknown, fallback?: string): UnifiedApiError => {
  const fallbackMessage = getFallbackMessage(fallback);

  if (getRecord(error)?.isUnifiedApiError === true) {
    const normalized = error as UnifiedApiError;
    return {
      ...normalized,
      message: toNonEmptyString(normalized.message) ?? fallbackMessage,
    };
  }

  if (axios.isAxiosError(error)) {
    const responseData = getRecord(error.response?.data);
    const payloadMessage = toNonEmptyString(responseData?.message);
    const axiosMessage = toNonEmptyString(error.message);
    const message = payloadMessage ?? axiosMessage ?? fallbackMessage;
    const code = toCodeString(responseData?.code) ?? toCodeString(error.code);
    const status = toNullableStatus(error.response?.status);
    const bizSuccess = typeof responseData?.success === 'boolean' ? responseData.success : null;
    const kind: UnifiedApiErrorKind = status === null ? 'network' : 'http';
    const normalized: UnifiedApiError = {
      isUnifiedApiError: true,
      kind,
      message,
      httpStatus: status,
      code,
      bizSuccess,
      raw: error,
    };
    debugLogUnifiedApiError('axios', normalized);
    return normalized;
  }

  const record = getRecord(error);
  if (record) {
    const message = toNonEmptyString(record.message) ?? fallbackMessage;
    const bizSuccess = typeof record.success === 'boolean' ? record.success : null;
    const code = toCodeString(record.code);
    const status = toNullableStatus(record.httpStatus) ?? toNullableStatus(record.status);
    const kind: UnifiedApiErrorKind = bizSuccess === false ? 'business' : status === null ? 'unknown' : 'http';
    const normalized: UnifiedApiError = {
      isUnifiedApiError: true,
      kind,
      message,
      httpStatus: status,
      code,
      bizSuccess,
      raw: error,
    };
    debugLogUnifiedApiError('plain-object', normalized);
    return normalized;
  }

  if (typeof error === 'string') {
    const normalized: UnifiedApiError = {
      isUnifiedApiError: true,
      kind: 'unknown',
      message: toNonEmptyString(error) ?? fallbackMessage,
      httpStatus: null,
      code: null,
      bizSuccess: null,
      raw: error,
    };
    debugLogUnifiedApiError('string', normalized);
    return normalized;
  }

  const normalized: UnifiedApiError = {
    isUnifiedApiError: true,
    kind: 'unknown',
    message: fallbackMessage,
    httpStatus: null,
    code: null,
    bizSuccess: null,
    raw: error,
  };
  debugLogUnifiedApiError('unknown', normalized);
  return normalized;
};

export const getUnifiedApiErrorMessage = (error: unknown, fallback: string): string => {
  return toUnifiedApiError(error, fallback).message;
};

export const notifyUnifiedApiError = (
  notifier: ErrorNotifier | null | undefined,
  error: unknown,
  fallback: string,
): UnifiedApiError => {
  const normalized = toUnifiedApiError(error, fallback);
  notifier?.error(normalized.message);
  return normalized;
};

export const shouldAutoErrorToast = (config?: { meta?: { autoErrorToast?: boolean } } | null): boolean => {
  return config?.meta?.autoErrorToast !== false;
};

export const isSessionKickedApiError = (error: UnifiedApiError): boolean => {
  return getAxiosResponseDataRecord(error)?.kicked === true;
};

export const isAuthExpiredApiError = (error: UnifiedApiError): boolean => {
  return error.httpStatus === AUTH_INVALID_HTTP_STATUS || isSessionKickedApiError(error);
};

export const isTemporaryUnavailableApiError = (error: UnifiedApiError): boolean => {
  if (error.kind === 'network') {
    return true;
  }
  const status = error.httpStatus;
  if (status === null) {
    return false;
  }
  return (
    status === REQUEST_TIMEOUT_HTTP_STATUS ||
    status === TOO_MANY_REQUESTS_HTTP_STATUS ||
    (status >= TEMPORARY_UNAVAILABLE_MIN_STATUS && status <= TEMPORARY_UNAVAILABLE_MAX_STATUS)
  );
};

export const emitApiErrorToast = (detail: ApiErrorToastDetail): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiErrorToastDetail>(API_ERROR_TOAST_EVENT, { detail }));
};
