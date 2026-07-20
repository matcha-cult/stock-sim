/**
 * 祭品选择器弹窗组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示玩家可用的祭品列表（表格形式），支持按元素/特性筛选，选择祭品放入祭坛格子。
 * 2. 不做什么：不处理召唤逻辑（由父组件处理）。
 *
 * 数据流 / 状态流：
 * 父组件传入 availableOfferings -> 用户筛选/选择 -> 触发 onSelect。
 *
 * 复用设计说明：
 * - 使用 antd Modal + Table + Segmented 组合，自动适配主题。
 * - 筛选状态本地管理，不影响父组件。
 * - 元素筛选支持单元素和双元素（相生组合：木火/火土/土金/金水/水木）。
 *
 * 关键边界条件与坑点：
 * 1. 如果玩家没有任何祭品，需要展示空状态提示。
 * 2. 已选中的祭品需要高亮显示（通过 selectedOffering 匹配 itemId + quality）。
 */
import { useState, useMemo } from 'react';
import { Modal, Table, Tag, Flex, Segmented, Empty, theme, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { OfferingDto } from '../../../services/api/beast.js';

// 品质标签映射
const QUALITY_MAP: Record<string, { label: string; color: string }> = {
  hq: { label: '优质', color: 'gold' },
  normal: { label: '普通', color: 'default' },
  lq: { label: '劣质', color: 'gray' },
};

// 元素颜色映射
const ELEMENT_COLOR_MAP: Record<string, string> = {
  金: 'gold',
  木: 'green',
  水: 'blue',
  火: 'red',
  土: 'orange',
};

// 元素筛选选项（按五行顺序：木火土金水，双元素为相生组合）
const ELEMENT_FILTERS = [
  { key: 'all', label: '全' },
  { key: 'none', label: '无' },
  { key: '木', label: '木' },
  { key: '火', label: '火' },
  { key: '土', label: '土' },
  { key: '金', label: '金' },
  { key: '水', label: '水' },
  { key: '木火', label: '木火' },
  { key: '火土', label: '火土' },
  { key: '土金', label: '土金' },
  { key: '金水', label: '金水' },
  { key: '水木', label: '水木' },
];

interface OfferingPickerProps {
  open: boolean;
  onClose: () => void;
  availableOfferings: OfferingDto[];
  selectedOffering: OfferingDto | null;
  onSelect: (offering: OfferingDto) => void;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
}

const OfferingPicker = function OfferingPicker({
  open,
  onClose,
  availableOfferings,
  selectedOffering,
  onSelect,
  onRefresh,
  isRefreshing,
}: OfferingPickerProps) {
  const { token } = theme.useToken();
  const [elementFilter, setElementFilter] = useState<string>('all');
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [traitFilter, setTraitFilter] = useState<string>('all');

  // 收集所有唯一特性，按灵根类（木火土金水顺序）优先排序
  const allTraits = useMemo(() => {
    const traitSet = new Set<string>();
    for (const o of availableOfferings) {
      for (const t of o.traits) traitSet.add(t);
    }
    const traits = Array.from(traitSet);
    // 灵根类优先，按五行顺序：木火土金水
    const spiritRootOrder = ['灵根', '木灵', '火灵', '土灵', '金灵', '水灵'];
    return traits.sort((a, b) => {
      const aIdx = spiritRootOrder.indexOf(a);
      const bIdx = spiritRootOrder.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [availableOfferings]);

  // 特性筛选选项
  const traitFilters = useMemo(() => {
    return [
      { key: 'all', label: '全' },
      ...allTraits.map((t) => ({ key: t, label: t })),
    ];
  }, [allTraits]);

  // 过滤后的祭品列表
  const filteredOfferings = useMemo(() => {
    let result = availableOfferings.filter((o) => o.quantity >= o.tradeUnit);

    if (qualityFilter !== 'all') {
      if (qualityFilter === 'none') {
        result = result.filter((o) => !o.quality);
      } else {
        result = result.filter((o) => o.quality === qualityFilter);
      }
    }

    if (elementFilter !== 'all') {
      if (elementFilter === 'none') {
        result = result.filter((o) => o.element.length === 0);
      } else {
        const filterElements = elementFilter.split('');
        result = result.filter((o) => {
          if (o.element.length !== filterElements.length) return false;
          return filterElements.every((e) => o.element.includes(e));
        });
      }
    }

    if (traitFilter !== 'all') {
      result = result.filter((o) => o.traits.includes(traitFilter));
    }

    return result;
  }, [availableOfferings, qualityFilter, elementFilter, traitFilter]);

  // 表格列定义
  const columns: ColumnsType<OfferingDto> = [
    {
      title: '品质',
      dataIndex: 'quality',
      key: 'quality',
      width: 60,
      render: (quality: string | undefined) => {
        const qualityInfo = quality ? QUALITY_MAP[quality] : null;
        return qualityInfo ? (
          <Tag color={qualityInfo.color} style={{ fontSize: 11, margin: 0 }}>
            {qualityInfo.label}
          </Tag>
        ) : '-';
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 80,
    },
    {
      title: '库存',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 70,
      align: 'right',
      render: (qty: number) => qty.toLocaleString(),
    },
    {
      title: '1单位数量',
      dataIndex: 'tradeUnit',
      key: 'tradeUnit',
      width: 90,
      align: 'right',
    },
    {
      title: '元素',
      dataIndex: 'element',
      key: 'element',
      width: 100,
      render: (elements: string[]) => (
        <Flex gap={4} style={{ whiteSpace: 'nowrap' }}>
          {elements.map((e) => (
            <Tag key={e} color={ELEMENT_COLOR_MAP[e] ?? 'default'} style={{ margin: 0 }}>
              {e}
            </Tag>
          ))}
        </Flex>
      ),
    },
    {
      title: '特性',
      dataIndex: 'traits',
      key: 'traits',
      render: (traits: string[]) => (
        <Flex gap={4} style={{ whiteSpace: 'nowrap' }}>
          {traits.map((t) => (
            <Tag key={t} color="green" style={{ margin: 0, fontSize: 11 }}>
              {t}
            </Tag>
          ))}
        </Flex>
      ),
    },
  ];

  // 行选择样式
  const rowClassName = (record: OfferingDto) => {
    const isSelected = selectedOffering !== null &&
      record.itemId === selectedOffering.itemId &&
      record.quality === selectedOffering.quality;
    return isSelected ? 'selected-row' : '';
  };

  return (
    <Modal
      title={
        <Flex justify="space-between" align="center">
          <span>选择祭品</span>
          <Button
            icon={<ReloadOutlined />}
            size="small"
            loading={isRefreshing}
            onClick={onRefresh}
            style={{ marginRight: 24 }}
          >
            刷新
          </Button>
        </Flex>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <Flex vertical gap={12}>
        {/* 筛选区域 */}
        <Segmented
          block
          size="small"
          options={[
            { label: '全', value: 'all' },
            { label: '优质', value: 'hq' },
            { label: '普通', value: 'normal' },
            { label: '劣质', value: 'lq' },
            { label: '无品质', value: 'none' },
          ]}
          value={qualityFilter}
          onChange={(v) => setQualityFilter(v as string)}
        />
        <Segmented
          block
          size="small"
          options={ELEMENT_FILTERS.map((f) => ({ label: f.label, value: f.key }))}
          value={elementFilter}
          onChange={(v) => setElementFilter(v as string)}
        />
        {allTraits.length > 0 && (
          <Segmented
            block
            size="small"
            options={traitFilters.map((f) => ({ label: f.label, value: f.key }))}
            value={traitFilter}
            onChange={(v) => setTraitFilter(v as string)}
          />
        )}

        {/* 表格区域 */}
        {filteredOfferings.length === 0 ? (
          <Empty description="暂无可用祭品（库存不足或无匹配筛选条件）" />
        ) : (
          <Table
            columns={columns}
            dataSource={filteredOfferings}
            rowKey={(record) => record.quality ? `${record.itemId}_${record.quality}` : record.itemId}
            rowClassName={rowClassName}
            size="small"
            pagination={false}
            scroll={{ y: 400 }}
            onRow={(record) => ({
              onClick: () => onSelect(record),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Flex>

      {/* 选中行高亮样式 */}
      <style>{`
        .selected-row {
          background-color: ${token.colorPrimaryBg} !important;
        }
        .selected-row:hover {
          background-color: ${token.colorPrimaryBgHover} !important;
        }
      `}</style>
    </Modal>
  );
};

export default OfferingPicker;
