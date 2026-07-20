/**
 * 统一背包系统 — 物品图标组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：渲染物品图标，支持真实图片加载和占位符降级。
 * 2. 不做什么：不处理图标资源管理、不提供图标编辑能力。
 *
 * 输入 / 输出：
 * - 输入：icon（图片 URL 或 null）、size（渲染尺寸）、fallback（降级占位符）。
 * - 输出：物品图标 UI。
 *
 * 数据流 / 状态流：
 * 父组件传入 icon → 有值则渲染 <img> → 加载失败时 onError 降级为占位符。
 *
 * 复用设计说明：
 * - 被 InventoryItemCell（网格格子）和 InventoryDetail（详情面板）复用。
 * - 统一的加载失败降级逻辑，避免两处重复实现。
 *
 * 关键边界条件与坑点：
 * 1. icon 为空字符串时等同于 null，应显示占位符。
 * 2. 图片加载失败（404 / CORS）必须降级，不能显示裂图。
 */

import React, { useState, useCallback } from 'react';
import { theme } from 'antd';

interface ItemIconProps {
  icon: string | null | undefined;
  size?: number;
  fallback?: string;
}

const ItemIcon: React.FC<ItemIconProps> = ({
  icon,
  size = 48,
  fallback = '📦',
}) => {
  const { token } = theme.useToken();
  const [failed, setFailed] = useState(false);

  const handleError = useCallback(() => {
    setFailed(true);
  }, []);

  const showImage = icon && !failed;

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: token.colorFillSecondary,
        borderRadius: size > 48 ? 8 : 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {showImage ? (
        <img
          src={icon}
          alt=""
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      ) : (
        fallback
      )}
    </div>
  );
};

export default ItemIcon;
