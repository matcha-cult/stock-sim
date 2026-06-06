/**
 * 玩家名称展示组件（带月卡流光 / GM 红色流光特效 + GM 标志）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：渲染玩家名称，GM 显示红色流光 + 前置 GM 标志，月卡激活显示金色流光。
 * 2. 不做什么：不查询月卡/GM 状态（由调用方传入）。
 *
 * 输入 / 输出：
 * - 输入：name（必填）、monthCardActive（可选）、isGm（可选）、ellipsis（可选截断）。
 * - 输出：带样式的名称文本（GM 时带 GM 标志）。
 *
 * 数据流 / 状态流：
 * 调用方传入 isGm / monthCardActive -> CSS class 条件挂载 -> ::after 伪元素流光动画。
 *
 * 复用设计说明：
 * - 所有需要显示玩家名称的地方（排行、AppHeader 等）统一用此组件。
 * - GM 优先：isGm 为 true 时只显示 GM 红色流光 + GM 标志，不显示月卡特效。
 *
 * 关键边界条件与坑点：
 * 1. GM 流光和月卡流光共用同一套 ::after 伪元素结构，只是渐变色不同。
 * 2. ellipsis 截断需要检测溢出，避免与 ::after 冲突。
 */

import { Tag, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import './PlayerName.css';

interface PlayerNameProps {
  name: string;
  monthCardActive?: boolean;
  isGm?: boolean;
  ellipsis?: boolean;
  className?: string;
}

const MAX_DISPLAY_LENGTH = 12;

function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength)}...`;
}

export default function PlayerName({ name, monthCardActive = false, isGm = false, ellipsis, className }: PlayerNameProps): React.ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const displayName = ellipsis ? truncateName(name, MAX_DISPLAY_LENGTH) : name;

  // 特效判断：GM 优先
  const showGmShimmer = isGm;
  const showMonthCardShimmer = monthCardActive && !isGm;
  const showShimmer = showGmShimmer || showMonthCardShimmer;

  // 检测是否溢出
  useEffect(() => {
    if (!ellipsis || !ref.current) return;
    setOverflowing(ref.current.scrollWidth > ref.current.clientWidth);
  }, [ellipsis, displayName]);

  const content = (
    <span className="player-name-wrapper">
      {isGm && (
        <Tag color="error" variant="filled" className="player-name-gm-tag">GM</Tag>
      )}
      <span
        ref={ref}
        className={[
          'player-name',
          showGmShimmer && 'is-gm',
          showMonthCardShimmer && 'is-month-card-active',
          className,
        ].filter(Boolean).join(' ')}
        data-text={showShimmer ? displayName : undefined}
      >
        {displayName}
      </span>
    </span>
  );

  if (ellipsis && overflowing) {
    return <Tooltip title={name}>{content}</Tooltip>;
  }

  return content;
}
