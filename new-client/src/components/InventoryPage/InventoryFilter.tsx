/**
 * 统一背包系统 — 筛选组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供物品分类、品质、稀有度筛选 + 名称搜索 + 排序。
 * 2. 不做什么：不处理物品列表、不管理分页状态。
 *
 * 输入 / 输出：
 * - 输入：当前筛选条件、筛选变更回调、清除回调。
 * - 输出：筛选 UI。
 *
 * 数据流 / 状态流：
 * 父组件传入筛选条件 → 渲染筛选项 → 用户操作 → 回调父组件 → 父组件更新 filters 并重新查询。
 *
 * 复用设计说明：
 * - 使用 antd Select / Input.Search 实现筛选和搜索。
 * - 使用 antd Space 实现间距和自动换行。
 * - 筛选选项从 constants 映射表生成，避免硬编码。
 *
 * 关键边界条件与坑点：
 * 1. 筛选条件变化后由父组件负责重置到第一页。
 * 2. 搜索使用 Input.Search onSearch（回车或按钮触发），避免每次按键发请求。
 * 3. 清除按钮仅在有筛选/搜索条件时显示。
 */

import React, { useCallback, useState } from 'react';
import { Select, Space, Button, Input } from 'antd';
import { observer } from 'mobx-react-lite';
import { ClearOutlined, SearchOutlined } from '@ant-design/icons';
import type { InventoryFilters } from '../../services/api/inventory';
import { CATEGORY_LABELS, QUALITY_LABELS, RARITY_LABELS, SORT_LABELS } from './constants';

interface InventoryFilterProps {
  filters: InventoryFilters;
  onFilterChange: (filters: Partial<InventoryFilters>) => void;
  onClear: () => void;
}

const selectOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const InventoryFilter = observer(function InventoryFilter({
  filters,
  onFilterChange,
  onClear,
}: InventoryFilterProps) {
  const [keywordInput, setKeywordInput] = useState(filters.keyword ?? '');

  const handleChange = useCallback(
    (key: keyof InventoryFilters, value: string | undefined) => {
      onFilterChange({ [key]: value });
    },
    [onFilterChange],
  );

  const handleSearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      onFilterChange({ keyword: trimmed || undefined });
    },
    [onFilterChange],
  );

  const hasFilters = filters.category || filters.quality || filters.rarity || filters.keyword;

  return (
    <Space wrap size={[8, 8]}>
      <Select
        placeholder="分类"
        allowClear
        showSearch
        style={{ width: 110 }}
        value={filters.category}
        onChange={(v) => handleChange('category', v)}
        options={selectOptions(CATEGORY_LABELS)}
      />

      <Select
        placeholder="品质"
        allowClear
        style={{ width: 100 }}
        value={filters.quality}
        onChange={(v) => handleChange('quality', v)}
        options={selectOptions(QUALITY_LABELS)}
      />

      <Select
        placeholder="稀有度"
        allowClear
        style={{ width: 110 }}
        value={filters.rarity}
        onChange={(v) => handleChange('rarity', v)}
        options={selectOptions(RARITY_LABELS)}
      />

      <Select
        placeholder="排序"
        style={{ width: 130 }}
        value={filters.sort}
        onChange={(v) => handleChange('sort', v)}
        options={selectOptions(SORT_LABELS)}
      />

      <Input.Search
        placeholder="搜索物品名称"
        allowClear
        value={keywordInput}
        onChange={(e) => setKeywordInput(e.target.value)}
        onSearch={handleSearch}
        enterButton={<SearchOutlined />}
        style={{ width: 200 }}
      />

      {hasFilters && (
        <Button
          icon={<ClearOutlined />}
          onClick={() => {
            setKeywordInput('');
            onClear();
          }}
        >
          清除
        </Button>
      )}
    </Space>
  );
});

export default InventoryFilter;
