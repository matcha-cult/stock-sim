/**
 * 灵兽融合界面
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供 3x3 阵法布局，中间为阵眼，四角为祭品，支持点击格子选择灵兽
 * 2. 不做什么：不处理灵兽升级逻辑
 *
 * 融合规则：
 * - 5 只相同星级的灵兽才能融合（不限物种）
 * - 以阵眼灵兽为准（保留其物种）
 * - 融合后星级 +1
 * - 属性取所有灵兽最高值
 *
 * 数据流 / 状态流：
 * 用户点击格子 -> 弹出选择器 -> 校验星级 -> 更新阵法 -> 预览/融合
 */

import { useState, useMemo, useCallback } from 'react';
import { Card, Row, Col, Button, Table, Typography, Space, Tag, Flex, message, Modal, List } from 'antd';
import { SwapOutlined, ThunderboltOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { BeastDetailDto } from '../../services/api/beast';
import StarLevelDisplay from '../../components/StarLevelDisplay';

const { Title, Text } = Typography;

interface BeastFusionPanelProps {
  beasts: BeastDetailDto[];
  onFuse: (beastIds: number[]) => Promise<{ success: boolean; message?: string }>;
}

// 阵法位置定义
const ANCHOR_POSITION = 4; // 中间位置（阵眼）
const MATERIAL_POSITIONS = [0, 2, 6, 8]; // 四角位置（祭品）

/** 稀有度标签颜色 */
const RARITY_COLOR_MAP: Record<string, string> = {
  SSR: 'gold',
  SR: 'purple',
};

/** 品阶标签颜色 */
const TIER_COLOR_MAP: Record<string, string> = {
  huang: 'default',
  xuan: 'cyan',
  di: 'purple',
  tian: 'gold',
};

/** 品阶中文名 */
const TIER_NAME_MAP: Record<string, string> = {
  huang: '黄阶',
  xuan: '玄阶',
  di: '地阶',
  tian: '天阶',
};

export default function BeastFusionPanel({ beasts, onFuse }: BeastFusionPanelProps) {
  const [gridBeasts, setGridBeasts] = useState<(BeastDetailDto | null)[]>(Array(9).fill(null));
  const [previewData, setPreviewData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  // 获取阵眼灵兽
  const anchorBeast = gridBeasts[ANCHOR_POSITION];

  // 按星级分组灵兽
  const beastsGrouped = useMemo(() => {
    const map = new Map<number, BeastDetailDto[]>();
    if (!beasts || beasts.length === 0) return map;

    for (const beast of beasts) {
      if (!beast) continue; // 跳过 undefined 元素

      // 按星级分组
      if (!map.has(beast.starLevel)) {
        map.set(beast.starLevel, []);
      }
      map.get(beast.starLevel)!.push(beast);
    }
    return map;
  }, [beasts]);

  // 检查是否可以融合
  const canFuse = useMemo(() => {
    const filledBeasts = gridBeasts.filter((b) => b !== null);
    if (filledBeasts.length !== 5) return false;

    const anchor = gridBeasts[ANCHOR_POSITION];
    if (!anchor) return false;

    // 所有灵兽必须是相同星级（不限物种）
    const materials = MATERIAL_POSITIONS.map((pos) => gridBeasts[pos]).filter((b) => b !== null);
    if (materials.length !== 4) return false;

    return materials.every((m) => m.starLevel === anchor.starLevel);
  }, [gridBeasts]);

  // 打开选择器
  const handleOpenSelector = useCallback((position: number) => {
    setSelectedPosition(position);
    setSelectorVisible(true);
  }, []);

  // 选择灵兽
  const handleSelectBeast = useCallback(
    (beast: BeastDetailDto) => {
      if (selectedPosition === null) return;

      // 校验：如果已有阵眼，必须相同星级（不限物种）
      if (anchorBeast && selectedPosition !== ANCHOR_POSITION) {
        if (beast.starLevel !== anchorBeast.starLevel) {
          message.error(`必须选择${anchorBeast.starLevel}星的灵兽`);
          return;
        }
      }

      // 校验：如果选择的是祭品，而阵眼还未设置，先设置阵眼
      if (selectedPosition !== ANCHOR_POSITION && !anchorBeast) {
        const newGrid = [...gridBeasts];
        newGrid[ANCHOR_POSITION] = beast;
        setGridBeasts(newGrid);
        setSelectorVisible(false);
        setSelectedPosition(null);
        return;
      }

      // 检查是否已被其他格子使用
      const existingIndex = gridBeasts.findIndex((b) => b?.id === beast.id);
      if (existingIndex !== -1 && existingIndex !== selectedPosition) {
        message.error('该灵兽已被其他位置使用');
        return;
      }

      const newGrid = [...gridBeasts];
      newGrid[selectedPosition] = beast;
      setGridBeasts(newGrid);
      setPreviewData(null);
      setSelectorVisible(false);
      setSelectedPosition(null);
    },
    [selectedPosition, anchorBeast, gridBeasts]
  );

  // 移除格子中的灵兽
  const handleRemoveBeast = useCallback(
    (position: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const newGrid = [...gridBeasts];
      newGrid[position] = null;
      setGridBeasts(newGrid);
      setPreviewData(null);
    },
    [gridBeasts]
  );

  // 自动填充：从同星级的灵兽中自动选择
  const handleAutoFill = useCallback(() => {
    // 筛选可融合的灵兽（星级上限，排除出战中）
    const fusionEligibleBeasts = beasts.filter((b) => b.starLevel <= FUSION_MAX_STAR && !b.isActive);

    if (!anchorBeast) {
      // 如果没有阵眼，选择第一个可用的灵兽作为阵眼
      const firstBeast = fusionEligibleBeasts[0];
      if (!firstBeast) {
        message.error(`没有可融合的灵兽（需要 ${FUSION_MAX_STAR} 星以下且非出战状态）`);
        return;
      }

      const starBeasts = beastsGrouped.get(firstBeast.starLevel) ?? [];
      const availableStarBeasts = starBeasts.filter((b) => !b.isActive);
      if (availableStarBeasts.length < 5) {
        message.error(`需要至少 5 只${firstBeast.starLevel}星灵兽（非出战状态）`);
        return;
      }

      const newGrid = Array(9).fill(null);
      newGrid[ANCHOR_POSITION] = availableStarBeasts[0];
      for (let i = 0; i < 4; i++) {
        newGrid[MATERIAL_POSITIONS[i]] = availableStarBeasts[i + 1];
      }
      setGridBeasts(newGrid);
      message.success('已自动填充');
      return;
    }

    // 已有阵眼，填充祭品
    const starBeasts = beastsGrouped.get(anchorBeast.starLevel) ?? [];
    const usedIds = new Set(gridBeasts.filter((b) => b !== null).map((b) => b!.id));
    const available = starBeasts.filter((b) => !usedIds.has(b.id));

    if (available.length < 4) {
      message.error(`需要至少 4 只可用的${anchorBeast.starLevel}星灵兽`);
      return;
    }

    const newGrid = [...gridBeasts];
    for (let i = 0; i < 4; i++) {
      newGrid[MATERIAL_POSITIONS[i]] = available[i];
    }
    setGridBeasts(newGrid);
    message.success('已自动填充祭品');
  }, [anchorBeast, beasts, beastsGrouped, gridBeasts]);

  // 预览融合结果
  const handlePreview = useCallback(() => {
    if (!canFuse || !anchorBeast) return;

    const materials = MATERIAL_POSITIONS.map((pos) => gridBeasts[pos]).filter(
      (b): b is BeastDetailDto => b !== null
    );
    const allBeasts = [anchorBeast, ...materials];

    // 计算每只灵兽的实际基础属性和成长属性（模板 + override）
    const getBeastBaseAttrs = (beast: BeastDetailDto): Record<string, number> => {
      const result: Record<string, number> = { ...beast.templateBaseAttrs };
      for (const [key, value] of Object.entries(beast.baseAttrsOverride)) {
        result[key] = (result[key] ?? 0) + value;
      }
      return result;
    };

    const getBeastLevelGains = (beast: BeastDetailDto): Record<string, number> => {
      const result: Record<string, number> = { ...beast.templateLevelGains };
      for (const [key, value] of Object.entries(beast.levelGainsOverride)) {
        result[key] = (result[key] ?? 0) + value;
      }
      return result;
    };

    // 收集所有属性键
    const allAttrKeys = new Set<string>();
    for (const beast of allBeasts) {
      for (const key of Object.keys(getBeastBaseAttrs(beast))) {
        allAttrKeys.add(`base:${key}`);
      }
      for (const key of Object.keys(getBeastLevelGains(beast))) {
        allAttrKeys.add(`gain:${key}`);
      }
    }

    // 计算融合后的属性（取最高值）
    const fusedBaseAttrs: Record<string, number> = {};
    const fusedLevelGains: Record<string, number> = {};
    for (const beast of allBeasts) {
      const baseAttrs = getBeastBaseAttrs(beast);
      for (const [key, value] of Object.entries(baseAttrs)) {
        if (!fusedBaseAttrs[key] || value > fusedBaseAttrs[key]) {
          fusedBaseAttrs[key] = value;
        }
      }
      const levelGains = getBeastLevelGains(beast);
      for (const [key, value] of Object.entries(levelGains)) {
        if (!fusedLevelGains[key] || value > fusedLevelGains[key]) {
          fusedLevelGains[key] = value;
        }
      }
    }

    // 构建预览数据：每一行是一个属性，每一列是一个灵兽
    const previewRows: any[] = [];

    for (const key of allAttrKeys) {
      const [type, attrKey] = key.split(':');
      const isBase = type === 'base';
      const attrName = isBase ? `基础:${attrKey}` : `成长:${attrKey}`;

      const row: any = {
        key: `${type}:${attrKey}`,
        attrName,
        anchor: isBase
          ? getBeastBaseAttrs(anchorBeast)[attrKey] ?? 0
          : getBeastLevelGains(anchorBeast)[attrKey] ?? 0,
      };

      // 祭品列
      materials.forEach((beast, idx) => {
        row[`material${idx}`] = isBase
          ? getBeastBaseAttrs(beast)[attrKey] ?? 0
          : getBeastLevelGains(beast)[attrKey] ?? 0;
      });

      // 融合后列
      row.fused = isBase
        ? fusedBaseAttrs[attrKey] ?? 0
        : fusedLevelGains[attrKey] ?? 0;

      previewRows.push(row);
    }

    setPreviewData({
      rows: previewRows,
      materials,
      anchorBeast,
      fusedBaseAttrs,
      fusedLevelGains,
    });
  }, [canFuse, anchorBeast, gridBeasts]);

  // 执行融合
  const handleFuse = useCallback(async () => {
    if (!canFuse || !anchorBeast) return;

    setLoading(true);
    try {
      const materials = MATERIAL_POSITIONS.map((pos) => gridBeasts[pos]).filter(
        (b): b is BeastDetailDto => b !== null
      );
      const beastIds = [anchorBeast.id, ...materials.map((m) => m.id)];
      const result = await onFuse(beastIds);
      if (result.success) {
        message.success('融合成功！');
        setGridBeasts(Array(9).fill(null));
        setPreviewData(null);
      } else {
        // 融合失败，显示错误信息
        Modal.error({
          title: '融合失败',
          content: result.message || '融合失败',
        });
        // 不清空表单，保留用户选择
      }
    } catch (error) {
      // 异常情况（不应该发生，但作为兜底）
      const errorMessage = (error as any)?.message || '融合失败';
      Modal.error({
        title: '融合失败',
        content: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  }, [canFuse, anchorBeast, gridBeasts, onFuse]);

  // 渲染阵法格子
  const renderGridCell = (position: number) => {
    const isAnchor = position === ANCHOR_POSITION;
    const isMaterial = MATERIAL_POSITIONS.includes(position);
    const beast = gridBeasts[position];

    return (
      <Card
        size="small"
        hoverable
        onClick={() => handleOpenSelector(position)}
        style={{
          width: 140,
          height: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: isAnchor ? '2px solid #1890ff' : isMaterial ? '2px solid #faad14' : '1px dashed #d9d9d9',
          cursor: 'pointer',
        }}
      >
        {beast ? (
          <Flex vertical align="center" gap={4}>
            <StarLevelDisplay starLevel={beast.starLevel} />
            <Text strong style={{ fontSize: 13 }}>
              {beast.name}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              #{beast.id} Lv.{beast.level}
            </Text>
            <Flex gap={2}>
              <Tag
                color={beast.bloodlineRarity ? RARITY_COLOR_MAP[beast.bloodlineRarity] : (isAnchor ? 'blue' : 'orange')}
                style={{ fontSize: 10, margin: 0 }}
              >
                {beast.bloodlineRarity && `${beast.bloodlineRarity} `}{beast.bloodlineName ?? (isAnchor ? '阵眼' : '祭品')}
              </Tag>
              <Tag color={TIER_COLOR_MAP[beast.beastTier] || 'default'} style={{ fontSize: 10, margin: 0 }}>
                {TIER_NAME_MAP[beast.beastTier] || beast.beastTier}
              </Tag>
            </Flex>
            <CloseCircleOutlined
              style={{ color: '#ff4d4f', fontSize: 16 }}
              onClick={(e) => handleRemoveBeast(position, e)}
            />
          </Flex>
        ) : (
          <Flex vertical align="center" gap={8}>
            <Text type="secondary" style={{ fontSize: 24 }}>
              +
            </Text>
            <Text type="secondary">{isAnchor ? '点击选择阵眼' : isMaterial ? '点击选择祭品' : '空'}</Text>
          </Flex>
        )}
      </Card>
    );
  };

  // 预览表格列定义（动态生成）
  const previewColumns = useMemo(() => {
    if (!previewData) return [];

    const { materials, anchorBeast } = previewData;
    const columns: any[] = [
      {
        title: '属性',
        dataIndex: 'attrName',
        key: 'attrName',
        width: 120,
        fixed: 'left' as const,
      },
      {
        title: (
          <Space>
            <Tag color="blue">阵眼</Tag>
            <Text>{anchorBeast.name}</Text>
          </Space>
        ),
        dataIndex: 'anchor',
        key: 'anchor',
        width: 100,
        render: (value: number, record: any) => {
          const fusedValue = record.fused;
          const isMax = value === fusedValue;
          return (
            <Space>
              <Text>{value}</Text>
              {isMax && <Text strong style={{ color: '#52c41a' }}>✓</Text>}
            </Space>
          );
        },
      },
    ];

    // 祭品列
    materials.forEach((material: BeastDetailDto, idx: number) => {
      columns.push({
        title: (
          <Space>
            <Tag color="orange">祭品{idx + 1}</Tag>
            <Text>{material.name}</Text>
          </Space>
        ),
        dataIndex: `material${idx}`,
        key: `material${idx}`,
        width: 100,
        render: (value: number, record: any) => {
          const fusedValue = record.fused;
          const isMax = value === fusedValue;
          return (
            <Space>
              <Text>{value}</Text>
              {isMax && <Text strong style={{ color: '#52c41a' }}>✓</Text>}
            </Space>
          );
        },
      });
    });

    // 融合后列
    columns.push({
      title: (
        <Space>
          <Tag color="green">融合后</Tag>
          <StarLevelDisplay starLevel={anchorBeast.starLevel + 1} />
        </Space>
      ),
      dataIndex: 'fused',
      key: 'fused',
      width: 100,
      fixed: 'right' as const,
      render: (value: number) => <Text strong style={{ color: '#52c41a' }}>{value}</Text>,
    });

    return columns;
  }, [previewData]);

  // 融合升星上限：当前最高只能选择 3 星融合（5 星后有独特升星流程，待开发）
  const FUSION_MAX_STAR = 3;

  // 获取可选灵兽列表
  const getSelectableBeasts = () => {
    if (selectedPosition === null) return [];

    const isAnchorPosition = selectedPosition === ANCHOR_POSITION;

    // 如果是阵眼位置，显示所有可用灵兽（限制星级上限，排除出战中）
    if (isAnchorPosition && !anchorBeast) {
      return beasts.filter((b) => b.starLevel <= FUSION_MAX_STAR && !b.isActive);
    }

    // 如果已有阵眼，只显示相同星级的灵兽（不限物种，排除出战中）
    if (anchorBeast) {
      return beasts.filter(
        (b) =>
          b.starLevel === anchorBeast.starLevel &&
          !b.isActive &&
          !gridBeasts.some((gb) => gb?.id === b.id)
      );
    }

    return [];
  };

  return (
    <Flex vertical gap="large">
      {/* 阵法布局 */}
      <Card title="融合阵法">
        <Flex justify="center">
          <Row gutter={[16, 16]}>
            {[0, 1, 2].map((row) => (
              <Col span={24} key={row}>
                <Flex justify="center" gap={16}>
                  {[0, 1, 2].map((col) => {
                    const position = row * 3 + col;
                    return <div key={position}>{renderGridCell(position)}</div>;
                  })}
                </Flex>
              </Col>
            ))}
          </Row>
        </Flex>

        {/* 操作按钮 */}
        <Flex justify="center" gap="large" style={{ marginTop: 24 }}>
          <Button size="large" onClick={handleAutoFill}>
            自动填充
          </Button>
          <Button size="large" onClick={handlePreview} disabled={!canFuse}>
            <ThunderboltOutlined /> 预览
          </Button>
          <Button type="primary" size="large" onClick={handleFuse} disabled={!canFuse} loading={loading}>
            <SwapOutlined /> 融合
          </Button>
        </Flex>
      </Card>

      {/* 预览表格 */}
      {previewData && (
        <Card title="融合预览">
          <Table
            dataSource={previewData.rows}
            columns={previewColumns}
            pagination={false}
            scroll={{ x: 'max-content' }}
            size="small"
          />
        </Card>
      )}

      {/* 灵兽选择器 */}
      <Modal
        title={
          selectedPosition === ANCHOR_POSITION
            ? '选择阵眼灵兽'
            : `选择祭品灵兽${anchorBeast ? `（需要${anchorBeast.starLevel}星）` : ''}`
        }
        open={selectorVisible}
        onCancel={() => {
          setSelectorVisible(false);
          setSelectedPosition(null);
        }}
        footer={null}
        width={600}
      >
        <List
          dataSource={getSelectableBeasts()}
          renderItem={(beast) => (
            <List.Item
              onClick={() => handleSelectBeast(beast)}
              style={{ cursor: 'pointer' }}
              actions={[
                <Button type="link" key="select">
                  选择
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<StarLevelDisplay starLevel={beast.starLevel} />}
                title={
                  <Space>
                    <Text strong>{beast.name}</Text>
                    <Tag>Lv.{beast.level}</Tag>
                    <Tag color={beast.bloodlineRarity ? RARITY_COLOR_MAP[beast.bloodlineRarity] : 'blue'}>
                      {beast.bloodlineRarity && `${beast.bloodlineRarity} `}{beast.bloodlineName ?? '普通'}
                    </Tag>
                    <Tag color={TIER_COLOR_MAP[beast.beastTier] || 'default'}>
                      {TIER_NAME_MAP[beast.beastTier] || beast.beastTier}
                    </Tag>
                  </Space>
                }
                description={`攻击力: ${beast.computedAttrs.atk} | 生命值: ${beast.computedAttrs.max_hp}`}
              />
            </List.Item>
          )}
          locale={{ emptyText: '没有可用的灵兽' }}
        />
      </Modal>
    </Flex>
  );
}
