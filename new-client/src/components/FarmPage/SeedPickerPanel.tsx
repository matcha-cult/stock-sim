/**
 * 种子选择面板 — 共用组件（筛选 + 种子卡片网格）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供元素 / 特性 / 变异三维度筛选 + 种子卡片网格选择，内部维护筛选状态。
 * 2. 不做什么：不做业务动作（种植 / 分配由调用方在 onSelect 中决定）。
 *
 * 输入 / 输出：
 * - 输入：候选种子列表（SeedInventoryItem & SeedConfigDto）、当前选中 seedId、选中回调。
 * - 输出：带筛选的网格 UI，选中高亮由 selectedId 控制。
 *
 * 数据流 / 状态流：
 * 调用方提供全量种子列表 → 本组件内部筛选 → 渲染 FarmSeedsGrid → 用户点击回调到调用方。
 *
 * 复用设计说明：
 * - 播种弹窗（FarmPlotsGrid）：包装在 ResponsiveModal 中，onSelect 调用 farmStore.plant。
 * - 模板编辑器（FarmTemplatePanel）：包装在 Popover 或 Modal 中，onSelect 写入 templateAssignments。
 * - 筛选逻辑（元素 / 特性 / 变异）只在一处维护，避免两处重复。
 *
 * 关键边界条件与坑点：
 * 1. 候选种子应由调用方预先过滤（quantity > 0、enabled 等），本组件不做额外过滤。
 * 2. 元素筛选支持"无元素"和双元素组合（如"金水"）。
 */

import { useState, useMemo } from 'react';
import { Segmented, Empty, Flex } from 'antd';
import { FarmSeedsGrid } from './FarmSeedsGrid';
import type { SeedInventoryItem, SeedConfigDto, MutationType, CropElement } from '../../services/api/farm';

type AvailableSeed = SeedInventoryItem & SeedConfigDto;

interface SeedPickerPanelProps {
  seeds: AvailableSeed[];
  selectedId: number | null;
  onSelect: (seedId: number) => void;
  emptyText?: string;
}

// 元素筛选选项
const ELEMENT_FILTERS = [
  { key: 'all', label: '全' },
  { key: 'none', label: '无' },
  { key: '金', label: '金' },
  { key: '木', label: '木' },
  { key: '水', label: '水' },
  { key: '火', label: '火' },
  { key: '土', label: '土' },
  { key: '金水', label: '金水' },
  { key: '水木', label: '水木' },
  { key: '木火', label: '木火' },
  { key: '火土', label: '火土' },
  { key: '土金', label: '土金' },
];

// 特性筛选选项
const TRAIT_FILTERS = [
  { key: 'all', label: '全' },
  { key: '灵根', label: '灵根' },
  { key: '禾本', label: '禾本' },
  { key: '葫芦科', label: '葫芦科' },
];

// 变异筛选选项（仅正面变异 + 无变异）
const MUTATION_FILTERS = [
  { key: 'all', label: '全' },
  { key: 'none', label: '无变异' },
  { key: 'gold', label: '金光变' },
  { key: 'double_yield', label: '丰收变' },
  { key: 'speed_ripen', label: '速熟变' },
];

export function SeedPickerPanel({ seeds, selectedId, onSelect, emptyText }: SeedPickerPanelProps) {
  const [elementFilter, setElementFilter] = useState<string>('all');
  const [traitFilter, setTraitFilter] = useState<string>('all');
  const [mutationFilter, setMutationFilter] = useState<string>('all');

  const filteredSeeds = useMemo(() => {
    let result = seeds;

    if (elementFilter !== 'all') {
      if (elementFilter === 'none') {
        result = result.filter((s) => s.element.length === 0);
      } else {
        const filterElements = elementFilter.split('');
        result = result.filter((s) => {
          if (s.element.length !== filterElements.length) return false;
          return filterElements.every((e) => s.element.includes(e as CropElement));
        });
      }
    }

    if (traitFilter !== 'all') {
      result = result.filter((s) => s.traits.includes(traitFilter));
    }

    if (mutationFilter !== 'all') {
      if (mutationFilter === 'none') {
        result = result.filter((s) => !s.mutationType);
      } else {
        result = result.filter((s) => s.mutationType === mutationFilter);
      }
    }

    return result;
  }, [seeds, elementFilter, traitFilter, mutationFilter]);

  return (
    <Flex vertical gap={8}>
      <Segmented
        block
        size="small"
        options={ELEMENT_FILTERS.map((f) => ({ label: f.label, value: f.key }))}
        value={elementFilter}
        onChange={(v) => setElementFilter(v as string)}
      />
      <Segmented
        block
        size="small"
        options={TRAIT_FILTERS.map((f) => ({ label: f.label, value: f.key }))}
        value={traitFilter}
        onChange={(v) => setTraitFilter(v as string)}
      />
      <Segmented
        block
        size="small"
        options={MUTATION_FILTERS.map((f) => ({ label: f.label, value: f.key }))}
        value={mutationFilter}
        onChange={(v) => setMutationFilter(v as MutationType | 'all' | 'none')}
      />
      {filteredSeeds.length === 0 ? (
        <Empty description={emptyText ?? '无符合条件的种子'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <FarmSeedsGrid
          seeds={filteredSeeds}
          selectedId={selectedId}
          onSelect={(id) => onSelect(id as number)}
        />
      )}
    </Flex>
  );
}
