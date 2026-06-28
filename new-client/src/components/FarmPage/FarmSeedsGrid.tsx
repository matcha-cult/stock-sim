/**
 * 灵田种子卡片网格 — 共用组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：渲染一组种子的可选卡片网格（含变异、代数、元素、数量），处理选中高亮。
 * 2. 不做什么：不做筛选逻辑、不做分组、不做业务动作（种植 / 分配由调用方决定）。
 *
 * 输入 / 输出：
 * - 输入：种子数组（至少需要 name/quantity/mutationType/generation/element）、选中 ID、点击回调。
 * - 输出：网格 UI，选中高亮由 `selectedId` 控制。
 *
 * 数据流 / 状态流：
 * 调用方提供数据（已筛选 / 已分组），本组件只负责渲染。
 *
 * 复用设计说明：
 * - 播种弹窗（FarmPlotsGrid）传入种子袋筛选结果，点击选择种子 ID 进行种植。
 * - 模板编辑器（FarmTemplatePanel）传入按 itemId+mutationType 分组的种子，点击选择种子分组进行模板分配。
 * - 两处使用同一种子卡片视觉风格，避免重复实现。
 *
 * 关键边界条件与坑点：
 * 1. 空列表显示 Empty，不做 fallback 渲染。
 * 2. 暗黑模式：所有颜色使用 antd design token，不使用硬编码颜色值。
 */

import { Typography, Tag } from 'antd';
import { theme } from 'antd';
import { ElementTag } from './ElementTag';
import { MUTATION_LABELS } from './farmConstants';
import type { MutationType } from '../../services/api/farm';

const { Text } = Typography;

/** 种子卡片所需的最小数据结构 */
export interface SeedGridItem {
  /** 唯一标识（种植用 seed_inventory.id，或分组的 itemId|mutation 拼接） */
  id: number | string;
  /** 种子名称 */
  name: string;
  /** 数量 */
  quantity: number;
  /** 变异类型 */
  mutationType: MutationType | null;
  /** 代数 */
  generation: number;
  /** 元素列表 */
  element: string[];
}

interface FarmSeedsGridProps {
  seeds: SeedGridItem[];
  selectedId: number | string | null;
  onSelect: (id: number | string) => void;
}

export function FarmSeedsGrid({ seeds, selectedId, onSelect }: FarmSeedsGridProps) {
  const { token } = theme.useToken();

  if (seeds.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
        gap: 8,
      }}
    >
      {seeds.map((seed) => {
        const isSelected = selectedId === seed.id;
        return (
          <div
            key={seed.id}
            onClick={() => onSelect(seed.id)}
            style={{
              position: 'relative',
              padding: '8px 6px',
              border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorder}`,
              borderRadius: token.borderRadius,
              cursor: 'pointer',
              backgroundColor: isSelected ? token.colorPrimaryBg : undefined,
              minHeight: 60,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {/* 左上角：变异 */}
            {seed.mutationType && MUTATION_LABELS[seed.mutationType] && (
              <Tag
                color={MUTATION_LABELS[seed.mutationType].color}
                style={{
                  position: 'absolute',
                  top: 2,
                  left: 2,
                  fontSize: 10,
                  margin: 0,
                  padding: '0 4px',
                  lineHeight: '16px',
                  transform: 'scale(0.9)',
                  transformOrigin: 'top left',
                }}
              >
                {MUTATION_LABELS[seed.mutationType].label}
              </Tag>
            )}
            {/* 右上角：代数 */}
            {seed.generation > 0 && (
              <Tag
                color={seed.generation >= 3 ? 'red' : 'blue'}
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  fontSize: 10,
                  margin: 0,
                  padding: '0 4px',
                  lineHeight: '16px',
                  transform: 'scale(0.9)',
                  transformOrigin: 'top right',
                }}
              >
                G{seed.generation}
              </Tag>
            )}
            {/* 名称 */}
            <Text strong style={{ fontSize: 12, textAlign: 'center' }}>{seed.name}</Text>
            {/* 左下角：元素 */}
            {seed.element.length > 0 && (
              <div style={{ position: 'absolute', bottom: 2, left: 2, transform: 'scale(0.9)', transformOrigin: 'bottom left' }}>
                <ElementTag elements={seed.element as ('金' | '木' | '水' | '火' | '土')[]} />
              </div>
            )}
            {/* 右下角：数量 */}
            <Text type="secondary" style={{ fontSize: 11, position: 'absolute', bottom: 2, right: 4 }}>×{seed.quantity}</Text>
          </div>
        );
      })}
    </div>
  );
}
