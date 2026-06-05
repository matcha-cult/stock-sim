/**
 * 月卡弹窗展示规则共享模块
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中维护月卡状态文案、权益图标、角标逻辑，避免高频变化点散落在组件里。
 * 2. 不做什么：不请求接口、不持有 React 状态，也不负责具体 DOM 渲染。
 *
 * 输入/输出：
 * - 输入：月卡每日灵石数量、权益数值、是否激活、是否到期、剩余天数、到期时间。
 * - 输出：状态面板文案、权益展示数组、角标状态。
 *
 * 数据流/状态流：
 * 月卡接口状态 -> 本模块纯函数 -> MonthCardModal 组件渲染。
 *
 * 关键边界条件与坑点：
 * 1. 灵石奖励图标使用项目统一的灵石图标路径。
 * 2. 百分比与加成数值来自接口，不在组件里写死。
 */

// 状态面板
export type MonthCardPanelState = {
  statusValue: string;   // "剩余 X 天" / "已到期" / "未激活"
  statusHint: string;    // 到期时间 / 提示文案
};

export type MonthCardPanelStateInput = {
  active: boolean;
  isExpired: boolean;
  daysLeft: number;
  expireAt: number | null;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatExpireAt = (expireAt: number | null): string => {
  if (!expireAt) return '';
  const date = new Date(expireAt);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

export const buildMonthCardPanelState = ({
  active,
  isExpired,
  daysLeft,
  expireAt,
}: MonthCardPanelStateInput): MonthCardPanelState => {
  if (active) {
    const expireText = formatExpireAt(expireAt);
    return {
      statusValue: `剩余 ${Math.max(0, daysLeft)} 天`,
      statusHint: expireText ? `到期时间：${expireText}` : '月卡生效中，可每日领取一次奖励。',
    };
  }

  if (isExpired) {
    return {
      statusValue: '已到期',
      statusHint: '月卡仅由 GM 发放，可联系 GM 续期。',
    };
  }

  return {
    statusValue: '未激活',
    statusHint: '月卡仅由 GM 发放。',
  };
};

// 角标
export type MonthCardIndicatorInput = {
  active: boolean;
  canClaim: boolean;
};

export type MonthCardIndicatorView = {
  badgeDot: boolean;
  tooltip?: string;
};

export const buildMonthCardIndicator = (
  input: MonthCardIndicatorInput,
): MonthCardIndicatorView => {
  if (!input.active || !input.canClaim) {
    return { badgeDot: false };
  }
  return {
    badgeDot: true,
    tooltip: '今日月卡奖励待领取',
  };
};
