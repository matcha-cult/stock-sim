/**
 * 灵田种植模板管理面板。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示模板列表、创建/编辑/应用/删除/复制模板（4×4 固定网格）。
 * 2. 不做什么：不做种植核心逻辑（由 FarmStore 调用 API 完成）。
 *
 * 数据流 / 状态流：
 * FarmStore.templates → 模板列表渲染。
 * 创建模板：从空白开始，点格子弹出种子袋选择器，或点"导入当前灵田"批量填充。
 * 编辑模板：从现有模板项预填充，可逐个调整。
 * 应用模板：固定从 (0,0) 开始 → applyTemplate。
 *
 * 复用设计说明：
 * - 创建/编辑共用弹窗和 handleSaveTemplate，通过 editingTemplateId 区分模式。
 * - 种子选择器复用 SeedPickerPanel（与 FarmPlotsGrid 播种弹窗共用组件），含元素/特性/变异三维度筛选。
 * - 使用 antd 组件（Row/Col/Card/Table/Flex/Space/Popover）布局，确保主题适配。
 *
 * 关键边界条件与坑点：
 * 1. 模板固定 4×4，灵田行 4+ 在编辑器中仅展示、不可选。
 * 2. 编辑模式下，即使灵田已清空，仍可基于已有模板项编辑（seedItemId 直接存储）。
 * 3. 种子选择器 Popover 通过 seedPickerSlot 状态控制，同一时刻只开一个。
 */

import { useContext, useState, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Card, Button, Table, Space, Typography, Modal, Input, Empty, App, Tag, Flex, Popconfirm,
  Row, Col, Popover, Radio, theme,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, PlayCircleOutlined, EditOutlined, CopyOutlined,
  CheckCircleFilled, CheckCircleOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';
import type { PlantTemplateDto, CreateTemplateItemRequest, MutationType } from '../../services/api/farm';
import { MUTATION_LABELS } from './farmConstants';
import { SeedPickerPanel } from './SeedPickerPanel';
import ResponsiveModal from '../../shared/ResponsiveModal';

const { Text } = Typography;

/** 模板固定尺寸 */
const TEMPLATE_ROWS = 4;
const TEMPLATE_COLS = 4;

interface FarmCellAssignment {
  farmRow: number;
  farmCol: number;
  cropName: string;
  seedItemId: string;
  mutationType: MutationType | null;
  /** 是否选中（参与提交） */
  selected: boolean;
}

const FarmTemplatePanel = observer(function FarmTemplatePanel() {
  const { message: messageApi } = App.useApp();
  const { token } = theme.useToken();
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PlantTemplateDto | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  /** 4×4 模板编辑器：slotIndex (row*4+col) → 格子分配 */
  const [templateAssignments, setTemplateAssignments] = useState<Map<number, FarmCellAssignment>>(new Map());
  /** 编辑中的模板 ID（null 表示创建模式） */
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  /** 当前打开种子选择器的 slotIndex（null 表示关闭） */
  const [seedPickerSlot, setSeedPickerSlot] = useState<number | null>(null);
  /** 当前打开变异调整 Popover 的 slotIndex */
  const [mutationPopoverSlot, setMutationPopoverSlot] = useState<number | null>(null);

  // 构建灵田格子 Map（row,col → cell）
  const farmCellMap = useMemo(() => {
    const map = new Map<string, {
      cropId: string | null;
      cropName: string | null;
      mutationType: MutationType | null;
      plantedGeneration: number;
    }>();
    for (const cell of farmStore.cells) {
      map.set(`${cell.row},${cell.col}`, {
        cropId: cell.cropId,
        cropName: cell.cropName,
        mutationType: cell.mutationType,
        plantedGeneration: cell.plantedGeneration ?? 0,
      });
    }
    return map;
  }, [farmStore.cells]);

  /** 灵田实际行数（编辑器展示完整网格，行 4+ 禁用） */
  const fullFarmRows = farmStore.farmInfo?.maxRow ?? TEMPLATE_ROWS;
  /** 灵田固定列数 */
  const fixedCols = farmStore.staticConfig?.grid.fixedCols ?? TEMPLATE_COLS;

  // 应用模板时：按种子条件分组，统计需求 vs 种子袋可用数量
  const seedSummary = useMemo(() => {
    if (!selectedTemplate) return [];

    const reqMap = new Map<string, {
      seedItemId: string;
      mutationType: string | null;
      needed: number;
    }>();

    for (const item of selectedTemplate.items) {
      const key = `${item.seedItemId}|${item.mutationType ?? ''}`;
      const existing = reqMap.get(key);
      if (existing) {
        existing.needed += 1;
      } else {
        reqMap.set(key, {
          seedItemId: item.seedItemId,
          mutationType: item.mutationType ?? null,
          needed: 1,
        });
      }
    }

    return Array.from(reqMap.values()).map(({ seedItemId, mutationType, needed }) => {
      const seedConfig = farmStore.staticConfig?.seeds.find((s) => s.itemId === seedItemId);
      const available = farmStore.seedBag.reduce((sum, s) => {
        if (s.itemId !== seedItemId) return sum;
        if (mutationType !== null && s.mutationType !== mutationType) return sum;
        return sum + s.quantity;
      }, 0);
      return { seedItemId, mutationType, needed, available, seedName: seedConfig?.name ?? seedItemId };
    });
  }, [selectedTemplate, farmStore.staticConfig, farmStore.seedBag]);

  // ==================== Handlers ====================

  // 从种子袋选择种子放入 slot（覆盖已有分配）
  const handleSelectSeed = (slotIndex: number, seedId: number) => {
    const r = Math.floor(slotIndex / TEMPLATE_COLS);
    const c = slotIndex % TEMPLATE_COLS;
    const seedRecord = farmStore.seedBagWithConfig.find((s) => s.id === seedId);
    if (!seedRecord) return;

    setTemplateAssignments((prev) => {
      const next = new Map(prev);
      next.set(slotIndex, {
        farmRow: r,
        farmCol: c,
        cropName: seedRecord.name,
        seedItemId: seedRecord.itemId,
        mutationType: seedRecord.mutationType,
        selected: true,
      });
      return next;
    });
    setSeedPickerSlot(null);
  };

  // 切换 slot 的选中状态（不清除分配数据）
  const handleToggleSelection = (slotIndex: number) => {
    setTemplateAssignments((prev) => {
      const next = new Map(prev);
      const assignment = next.get(slotIndex);
      if (assignment) {
        next.set(slotIndex, { ...assignment, selected: !assignment.selected });
      }
      return next;
    });
  };

  // 修改已分配 slot 的变异类型（编辑模式下使用）
  const handleChangeMutation = (slotIndex: number, mutationType: MutationType | null) => {
    setTemplateAssignments((prev) => {
      const next = new Map(prev);
      const assignment = next.get(slotIndex);
      if (!assignment) return prev;
      next.set(slotIndex, { ...assignment, mutationType });
      return next;
    });
  };

  // 导入当前灵田布局到模板（仅前 4 行，需种子袋有对应种子）
  const handleImportFarm = () => {
    const initial = new Map<number, FarmCellAssignment>();
    for (const cell of farmStore.cells) {
      if (cell.cropId && cell.unlocked && cell.row < TEMPLATE_ROWS && cell.col < TEMPLATE_COLS) {
        const seedConfig = farmStore.staticConfig?.seeds.find((s) => s.cropId === cell.cropId);
        if (!seedConfig) continue;
        const seed = farmStore.seedBag.find((s) => s.itemId === seedConfig.itemId);
        if (!seed) continue;

        const slotIndex = cell.row * TEMPLATE_COLS + cell.col;
        initial.set(slotIndex, {
          farmRow: cell.row,
          farmCol: cell.col,
          cropName: cell.cropName ?? '作物',
          seedItemId: seed.itemId,
          mutationType: cell.mutationType,
          selected: true,
        });
      }
    }
    setTemplateAssignments(initial);
    messageApi.success(`已导入 ${initial.size} 个格子`);
  };

  // 清空所有选择
  const handleClearAll = () => {
    setTemplateAssignments(new Map());
    setSeedPickerSlot(null);
  };

  // 打开创建模板弹窗 — 空白状态
  const openCreateModal = () => {
    setEditingTemplateId(null);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateAssignments(new Map());
    setSeedPickerSlot(null);
    setCreateModalOpen(true);
  };

  // 打开编辑模板弹窗 — 从现有模板预填充
  const openEditModal = (template: PlantTemplateDto) => {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateDescription(template.description ?? '');

    const initial = new Map<number, FarmCellAssignment>();
    for (const item of template.items) {
      const slotIndex = item.rowOffset * TEMPLATE_COLS + item.colOffset;
      const seedConfig = farmStore.staticConfig?.seeds.find((s) => s.itemId === item.seedItemId);
      initial.set(slotIndex, {
        farmRow: item.rowOffset,
        farmCol: item.colOffset,
        cropName: seedConfig?.name ?? '未知作物',
        seedItemId: item.seedItemId,
        mutationType: item.mutationType as MutationType | null,
        selected: true,
      });
    }
    setTemplateAssignments(initial);
    setSeedPickerSlot(null);
    setCreateModalOpen(true);
  };

  // 复制模板 — 以现有模板数据预填充，进入创建模式
  const handleCopyTemplate = (template: PlantTemplateDto) => {
    setEditingTemplateId(null);
    setTemplateName(`${template.name} 副本`);
    setTemplateDescription(template.description ?? '');

    const initial = new Map<number, FarmCellAssignment>();
    for (const item of template.items) {
      const slotIndex = item.rowOffset * TEMPLATE_COLS + item.colOffset;
      const seedConfig = farmStore.staticConfig?.seeds.find((s) => s.itemId === item.seedItemId);
      initial.set(slotIndex, {
        farmRow: item.rowOffset,
        farmCol: item.colOffset,
        cropName: seedConfig?.name ?? '未知作物',
        seedItemId: item.seedItemId,
        mutationType: item.mutationType as MutationType | null,
        selected: true,
      });
    }
    setTemplateAssignments(initial);
    setSeedPickerSlot(null);
    setCreateModalOpen(true);
  };

  // 保存模板（创建或更新）
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      messageApi.warning('请输入模板名称');
      return;
    }
    // 统计已选中且已分配种子的格子
    const selectedWithSeeds = Array.from(templateAssignments.values()).filter(
      (a) => a.selected && a.seedItemId,
    );
    if (selectedWithSeeds.length === 0) {
      messageApi.warning('请至少选中一个格子并选择种子');
      return;
    }

    const items: CreateTemplateItemRequest[] = [];
    for (const [slotIndex, assignment] of templateAssignments.entries()) {
      // 跳过未选中或未选择种子的格子
      if (!assignment.selected || !assignment.seedItemId) {
        continue;
      }
      const rowOffset = Math.floor(slotIndex / TEMPLATE_COLS);
      const colOffset = slotIndex % TEMPLATE_COLS;

      items.push({
        rowOffset,
        colOffset,
        seedItemId: assignment.seedItemId,
        mutationType: assignment.mutationType,
      });
    }

    if (items.length === 0) {
      messageApi.error('没有有效的种植项，请为选中的格子选择种子');
      return;
    }

    const isEdit = editingTemplateId !== null;
    let success: boolean;

    if (isEdit) {
      success = await farmStore.updateTemplate(
        editingTemplateId,
        templateName.trim(),
        templateDescription.trim() || null,
        items,
      );
    } else {
      success = await farmStore.createTemplate(
        templateName.trim(),
        templateDescription.trim() || null,
        items,
      );
    }

    if (success) {
      messageApi.success(isEdit ? '模板更新成功' : '模板创建成功');
      setCreateModalOpen(false);
    } else {
      messageApi.error(isEdit ? '模板更新失败' : '模板创建失败');
    }
  };

  // 打开应用模板弹窗
  const openApplyModal = (template: PlantTemplateDto) => {
    setSelectedTemplate(template);
    setApplyModalOpen(true);
  };

  // 应用模板（固定从 0,0 开始）
  const handleApplyTemplate = async () => {
    if (!selectedTemplate) return;

    const result = await farmStore.applyTemplate(selectedTemplate.id);
    if (!result) {
      messageApi.error('应用模板失败');
      return;
    }

    if (result.success) {
      messageApi.success(`成功种植 ${result.plantedCount} 块作物`);
      setApplyModalOpen(false);
    } else {
      messageApi.error(result.message);
    }
  };

  // 删除模板
  const handleDeleteTemplate = async (templateId: number) => {
    const success = await farmStore.deleteTemplate(templateId);
    if (success) {
      messageApi.success('模板已删除');
    } else {
      messageApi.error('删除失败');
    }
  };

  // 模板编辑器可用的种子袋（quantity > 0）
  const availableSeedsForTemplate = useMemo(
    () => farmStore.seedBagWithConfig.filter((s) => s.quantity > 0),
    [farmStore.seedBagWithConfig],
  );

  // ==================== 创建/编辑模板弹窗内容 ====================

  const renderCreateModalContent = () => (
    <Flex vertical gap="middle">
      <Input
        placeholder="模板名称"
        value={templateName}
        onChange={(e) => setTemplateName(e.target.value)}
        maxLength={100}
      />
      <Input.TextArea
        placeholder="模板描述（可选）"
        value={templateDescription}
        onChange={(e) => setTemplateDescription(e.target.value)}
        maxLength={255}
        rows={2}
      />

      <Flex gap={8}>
        <Button size="small" onClick={handleImportFarm}>导入当前灵田</Button>
        <Button size="small" onClick={handleClearAll}>清空选择</Button>
      </Flex>

      <Text type="secondary" style={{ fontSize: 12 }}>
        {fullFarmRows > TEMPLATE_ROWS
          ? '点 + 添加种子 / 点 ✓ 移除 · 中央文本更换种子 · 右上标签调整变异 · 灰色区域超出模板范围'
          : '点 + 添加种子 / 点 ✓ 移除 · 中央文本更换种子 · 右上标签调整变异'}
      </Text>

      {/* 完整灵田网格 — 前 4 行可选，超出部分禁用 */}
      <Card size="small">
        <Row gutter={[4, 4]}>
          {Array.from({ length: fullFarmRows * fixedCols }).map((_, idx) => {
            const r = Math.floor(idx / fixedCols);
            const c = idx % fixedCols;
            const inTemplateRange = r < TEMPLATE_ROWS && c < TEMPLATE_COLS;
            const slotIndex = r * TEMPLATE_COLS + c;
            const cell = farmCellMap.get(`${r},${c}`);
            const hasCrop = !!cell?.cropId;
            const assignment = inTemplateRange ? templateAssignments.get(slotIndex) : null;
            const selected = !!assignment?.selected;
            const seedConfig = assignment
              ? farmStore.staticConfig?.seeds.find((s) => s.itemId === assignment.seedItemId)
              : null;
            const cropConfig = seedConfig
              ? farmStore.staticConfig?.crops.find((cr) => cr.cropId === seedConfig.cropId)
              : null;
            const mutInfo = assignment?.mutationType ? MUTATION_LABELS[assignment.mutationType] : null;
            const mutationPopoverOpen = inTemplateRange && selected && mutationPopoverSlot === slotIndex;

            return (
              <Col span={6} key={idx}>
                <Card
                  size="small"
                  style={{
                    opacity: !inTemplateRange ? 0.3 : 1,
                    width: '100%',
                    aspectRatio: '1',
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? token.colorPrimary : undefined,
                    position: 'relative',
                    backgroundColor: !inTemplateRange ? token.colorFillQuaternary : undefined,
                  }}
                  styles={{
                    body: {
                      padding: 4,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                    },
                  }}
                >
                  {!inTemplateRange ? (
                    <>
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        {r + 1}-{c + 1}
                      </Text>
                      <Text ellipsis style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.2 }}>
                        {hasCrop ? cell!.cropName : '空'}
                      </Text>
                    </>
                  ) : (
                    <>
                      {/* 左上角：选中状态切换（仅切换选中状态） */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 2,
                          left: 2,
                          lineHeight: 1,
                          cursor: 'pointer',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const assignment = templateAssignments.get(slotIndex);
                          if (assignment) {
                            // 已有分配数据，切换选中状态
                            handleToggleSelection(slotIndex);
                          } else {
                            // 无分配数据，创建新分配
                            if (hasCrop && cell) {
                              const seedConfig = farmStore.staticConfig?.seeds.find((s) => s.cropId === cell.cropId);
                              const seed = seedConfig ? farmStore.seedBag.find((s) => s.itemId === seedConfig.itemId) : null;
                              if (seedConfig && seed) {
                                const newAssignments = new Map(templateAssignments);
                                newAssignments.set(slotIndex, {
                                  farmRow: r,
                                  farmCol: c,
                                  cropName: cell.cropName ?? '作物',
                                  seedItemId: seed.itemId,
                                  mutationType: cell.mutationType,
                                  selected: true,
                                });
                                setTemplateAssignments(newAssignments);
                                return;
                              }
                            }
                            // 无作物：创建空分配，用户需点击中央文本选择种子
                            const newAssignments = new Map(templateAssignments);
                            newAssignments.set(slotIndex, {
                              farmRow: r,
                              farmCol: c,
                              cropName: '待选择',
                              seedItemId: '',
                              mutationType: null,
                              selected: true,
                            });
                            setTemplateAssignments(newAssignments);
                          }
                        }}
                      >
                        {selected ? (
                          <CheckCircleFilled style={{ fontSize: 14, color: token.colorPrimary }} />
                        ) : (
                          <CheckCircleOutlined style={{ fontSize: 14, color: token.colorTextQuaternary }} />
                        )}
                      </div>

                      {/* 中央：无边框按钮，点击打开种子选择 Modal */}
                      <Button
                        type="text"
                        block
                        style={{
                          padding: 0,
                          height: 'auto',
                          lineHeight: 1.2,
                          textAlign: 'center',
                          opacity: selected ? 1 : 0.5,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSeedPickerSlot(slotIndex);
                        }}
                      >
                        <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                          {r + 1}-{c + 1}
                        </Text>
                        <Text
                          ellipsis
                          style={{
                            fontSize: 11,
                            textAlign: 'center',
                            lineHeight: 1.2,
                          }}
                        >
                          {assignment ? (cropConfig?.name ?? assignment.cropName) : (hasCrop ? cell!.cropName : '空')}
                        </Text>
                      </Button>

                      {/* 右上角：变异类型（有分配数据时显示），点击调整 */}
                      {assignment && (
                        <Popover
                          content={
                            <div onClick={(e) => e.stopPropagation()}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                                调整变异类型
                              </Text>
                              <Radio.Group
                                size="small"
                                value={assignment!.mutationType ?? 'none'}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  handleChangeMutation(slotIndex, v === 'none' ? null : v as MutationType);
                                }}
                              >
                                <Flex vertical gap={2}>
                                  <Radio value="none" style={{ fontSize: 12 }}>无变异</Radio>
                                  {Object.entries(MUTATION_LABELS).map(([key, info]) => (
                                    <Radio key={key} value={key} style={{ fontSize: 12 }}>
                                      <Tag color={info.color} style={{ fontSize: 10, margin: 0, padding: '0 3px' }}>{info.label}</Tag>
                                    </Radio>
                                  ))}
                                </Flex>
                              </Radio.Group>
                            </div>
                          }
                          trigger="click"
                          open={mutationPopoverOpen}
                          onOpenChange={(open) => { if (!open) setMutationPopoverSlot(null); }}
                        >
                          <div
                            style={{ position: 'absolute', top: 2, right: 2, lineHeight: 1, cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMutationPopoverSlot(mutationPopoverSlot === slotIndex ? null : slotIndex);
                            }}
                          >
                            <Tag
                              color={mutInfo?.color ?? 'default'}
                              style={{
                                fontSize: 9,
                                margin: 0,
                                padding: '0 3px',
                                lineHeight: '14px',
                                transform: 'scale(0.85)',
                              }}
                            >
                              {mutInfo?.label ?? '无变异'}
                            </Tag>
                          </div>
                        </Popover>
                      )}
                    </>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      {Array.from(templateAssignments.values()).filter((a) => a.selected).length > 0 && (
        <Card size="small" title={`已选中 ${Array.from(templateAssignments.values()).filter((a) => a.selected).length} 个格子`}>
          <Flex wrap="wrap" gap={4}>
            {Array.from(templateAssignments.entries())
              .filter(([, assignment]) => assignment.selected)
              .map(([slotIndex, assignment]) => {
                const mutInfo = assignment.mutationType ? MUTATION_LABELS[assignment.mutationType] : null;
                return (
                  <Tag
                    key={slotIndex}
                    closable
                    onClose={() => handleToggleSelection(slotIndex)}
                    color="blue"
                  >
                    {assignment.farmRow + 1}-{assignment.farmCol + 1}: {assignment.cropName}
                    {mutInfo && ` [${mutInfo.label}]`}
                  </Tag>
                );
              })}
          </Flex>
        </Card>
      )}
    </Flex>
  );

  // ==================== 应用模板弹窗内容 ====================

  const renderApplyModalContent = () => {
    if (!selectedTemplate) return null;

    const itemMap = new Map<string, typeof selectedTemplate.items[0]>();
    for (const item of selectedTemplate.items) {
      itemMap.set(`${item.rowOffset},${item.colOffset}`, item);
    }

    return (
      <Flex vertical gap="middle">
        <Card size="small">
          <Flex vertical gap={4}>
            <Text strong>模板：{selectedTemplate.name}</Text>
            <Text type="secondary">
              包含 {selectedTemplate.items.length} 个种植项，将从 (1,1) 开始种植
            </Text>
          </Flex>
        </Card>

        {/* 4×4 预览 */}
        <Card size="small" title="模板预览">
          <Row gutter={[4, 4]}>
            {Array.from({ length: TEMPLATE_ROWS * TEMPLATE_COLS }).map((_, idx) => {
              const r = Math.floor(idx / TEMPLATE_COLS);
              const c = idx % TEMPLATE_COLS;
              const item = itemMap.get(`${r},${c}`);
              const seedConfig = item
                ? farmStore.staticConfig?.seeds.find((s) => s.itemId === item.seedItemId)
                : null;

              return (
                <Col span={6} key={idx}>
                  <Card
                    size="small"
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderWidth: item ? 2 : 1,
                      borderColor: item ? '#1677ff' : undefined,
                      position: 'relative',
                    }}
                    styles={{
                      body: {
                        padding: 4,
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    }}
                  >
                    <Text
                      ellipsis
                      style={{
                        fontSize: 11,
                        textAlign: 'center',
                        lineHeight: 1.2,
                      }}
                    >
                      {seedConfig?.name?.slice(0, 3) ?? '空'}
                    </Text>
                    {item?.mutationType && MUTATION_LABELS[item.mutationType] && (
                      <Tag
                        color={MUTATION_LABELS[item.mutationType].color}
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          left: 2,
                          fontSize: 9,
                          margin: 0,
                          padding: '0 3px',
                          lineHeight: '14px',
                          transform: 'scale(0.85)',
                          transformOrigin: 'bottom left',
                        }}
                      >
                        {MUTATION_LABELS[item.mutationType].label}
                      </Tag>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>

        {/* 种子需求摘要 */}
        <Card size="small" title={`种子需求（${selectedTemplate.items.length} 格）`}>
          <Flex vertical gap={4}>
            {seedSummary.map(({ seedName, mutationType, needed, available }) => {
              const mutInfo = mutationType ? MUTATION_LABELS[mutationType] : null;
              const enough = available >= needed;
              return (
                <Flex key={`${seedName}-${mutationType ?? ''}`} justify="space-between" align="center">
                  <Space size={4}>
                    <Text style={{ fontSize: 12 }}>{seedName}</Text>
                    {mutInfo && (
                      <Tag color={mutInfo.color} style={{ fontSize: 10, margin: 0, padding: '0 3px' }}>
                        {mutInfo.label}
                      </Tag>
                    )}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    需要 <Text strong style={{ fontSize: 12 }}>{needed}</Text>
                    {' · 可用 '}
                    <Text strong style={{ fontSize: 12, color: enough ? '#52c41a' : '#ff4d4f' }}>
                      {available}
                    </Text>
                  </Text>
                </Flex>
              );
            })}
          </Flex>
        </Card>

        <Card size="small" style={{ backgroundColor: 'rgba(0, 0, 0, 0.02)' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            将从 (1,1) 开始按模板布局种植，目标格子必须已解锁且为空。
          </Text>
        </Card>
      </Flex>
    );
  };

  // ==================== 主渲染 ====================

  return (
    <Flex vertical gap="middle">
      <Flex justify="space-between" align="center">
        <Text strong style={{ fontSize: 16 }}>种植模板</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          创建模板
        </Button>
      </Flex>

      {farmStore.templates.length === 0 ? (
        <Empty description="暂无模板" />
      ) : (
        <Table
          dataSource={farmStore.templates}
          rowKey="id"
          pagination={false}
          size="small"
          columns={[
            {
              title: '预览',
              dataIndex: 'items',
              width: 36,
              render: (items: PlantTemplateDto['items']) => {
                const occupied = new Set(items.map((i) => `${i.rowOffset},${i.colOffset}`));
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 5px)', gap: 0 }}>
                    {Array.from({ length: 16 }).map((_, idx) => {
                      const r = Math.floor(idx / 4);
                      const c = idx % 4;
                      const isSelected = occupied.has(`${r},${c}`);
                      return (
                        <div
                          key={idx}
                          style={{
                            width: 5,
                            height: 5,
                            backgroundColor: isSelected ? '#1677ff' : '#f0f0f0',
                            border: '0.5px solid #d9d9d9',
                            boxSizing: 'border-box',
                          }}
                        />
                      );
                    })}
                  </div>
                );
              },
            },
            {
              title: '名称',
              dataIndex: 'name',
              ellipsis: true,
            },
            {
              title: '描述',
              dataIndex: 'description',
              ellipsis: true,
              render: (desc: string | null) => desc ?? '-',
            },
            {
              title: '种植项',
              dataIndex: 'items',
              width: 70,
              align: 'center' as const,
              render: (items: PlantTemplateDto['items']) => `${items.length} 项`,
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_: unknown, record: PlantTemplateDto) => (
                <Space size={4}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => openApplyModal(record)}
                  >
                    应用
                  </Button>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditModal(record)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => handleCopyTemplate(record)}
                  >
                    复制
                  </Button>
                  <Popconfirm
                    title="确定删除此模板？"
                    onConfirm={() => handleDeleteTemplate(record.id)}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      {/* 创建/编辑模板弹窗 */}
      <Modal
        title={editingTemplateId !== null ? '编辑种植模板' : '创建种植模板'}
        open={createModalOpen}
        onOk={handleSaveTemplate}
        onCancel={() => setCreateModalOpen(false)}
        maskClosable={false}
        width={640}
      >
        {renderCreateModalContent()}
      </Modal>

      {/* 应用模板弹窗 */}
      <Modal
        title="应用种植模板"
        open={applyModalOpen}
        onOk={handleApplyTemplate}
        onCancel={() => setApplyModalOpen(false)}
        maskClosable={false}
      >
        {renderApplyModalContent()}
      </Modal>

      {/* 种子选择弹窗（Modal 形式，与播种逻辑一致） */}
      <ResponsiveModal
        title={seedPickerSlot !== null ? `选择种子 ${Math.floor(seedPickerSlot / TEMPLATE_COLS) + 1}-${(seedPickerSlot % TEMPLATE_COLS) + 1}` : '选择种子'}
        open={seedPickerSlot !== null}
        onClose={() => setSeedPickerSlot(null)}
        onOk={() => setSeedPickerSlot(null)}
        okText="完成"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        {seedPickerSlot !== null && (
          <SeedPickerPanel
            seeds={availableSeedsForTemplate}
            selectedId={
              templateAssignments.get(seedPickerSlot)?.seedItemId
                ? farmStore.seedBagWithConfig.find(
                    (s) =>
                      s.itemId === templateAssignments.get(seedPickerSlot)!.seedItemId &&
                      s.mutationType === templateAssignments.get(seedPickerSlot)!.mutationType,
                  )?.id ?? null
                : null
            }
            onSelect={(seedId) => handleSelectSeed(seedPickerSlot, seedId)}
          />
        )}
      </ResponsiveModal>
    </Flex>
  );
});

export default FarmTemplatePanel;
