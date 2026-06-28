/**
 * 灵田系统 V3 — 种子袋组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示种子袋（持有种子列表，含作物产量、生长时间等信息），提供出售操作。
 * 2. 不做什么：不做种子商店（由 FarmSeedShop 负责）。
 *
 * 数据流 / 状态流：
 * FarmStore.seedBagWithConfig + staticConfig.crops → 渲染。用户操作 → FarmStore 方法 → 自动刷新。
 *
 * 复用设计说明：
 * - 作物信息（产量、生长阶段）通过 cropId 从 staticConfig.crops 查找，避免重复存储。
 */

import { useContext, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button, Tag, Flex, Typography, InputNumber,
  Descriptions, Empty, App, Table, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RootStoreContext } from '../../stores/RootStore';
import type { SeedConfigDto, SeedInventoryItem, CropConfigDto, CropElement } from '../../services/api/farm';
import ResponsiveModal from '../../shared/ResponsiveModal';
import { MUTATION_LABELS, TIER_NAMES } from './farmConstants';
import { ElementTag } from './ElementTag';

const { Text } = Typography;

/** 格式化生长时间（分钟 → 可读字符串） */
const formatGrowthTime = (minutes: number): string => {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}时${m}分` : `${h}时`;
};

/** 种子袋行类型（库存 + 种子配置 + 作物配置） */
type SeedBagItem = SeedInventoryItem & SeedConfigDto & { crop: CropConfigDto | null };

const FarmSeedBag = observer(function FarmSeedBag() {
  const { message: messageApi } = App.useApp();
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  const [sellModal, setSellModal] = useState<{ itemId: string; name: string; mutationType: string | null } | null>(null);
  const [sellQuantity, setSellQuantity] = useState(1);

  // 构建作物索引（cropId → cropConfig）
  const cropMap = useMemo(() => {
    const map = new Map<string, CropConfigDto>();
    if (farmStore.staticConfig) {
      for (const crop of farmStore.staticConfig.crops) {
        map.set(crop.cropId, crop);
      }
    }
    return map;
  }, [farmStore.staticConfig]);

  // 种子袋列表（附加作物信息）
  const seedBagItems: SeedBagItem[] = useMemo(() => {
    return farmStore.seedBagWithConfig.map((item) => ({
      ...item,
      crop: cropMap.get(item.cropId) ?? null,
    }));
  }, [farmStore.seedBagWithConfig, cropMap]);

  const handleSell = async () => {
    if (!sellModal || sellQuantity <= 0) return;
    const ok = await farmStore.sellSeed(sellModal.itemId, sellQuantity, sellModal.mutationType);
    if (ok) {
      messageApi.success('出售成功');
      setSellModal(null);
      setSellQuantity(1);
    }
  };

  // 种子袋表格列定义
  const seedBagColumns: ColumnsType<SeedBagItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '元素',
      dataIndex: 'element',
      key: 'element',
      width: 70,
      align: 'center',
      render: (element: CropElement[]) => <ElementTag elements={element} />,
    },
    {
      title: '变异',
      dataIndex: 'mutationType',
      key: 'mutationType',
      width: 80,
      align: 'center',
      render: (mutationType: string | null) =>
        mutationType ? (
          <Tag
            color={MUTATION_LABELS[mutationType]?.color}
            style={{ fontSize: 11, margin: 0 }}
          >
            {MUTATION_LABELS[mutationType]?.label ?? mutationType}
          </Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '代数',
      dataIndex: 'generation',
      key: 'generation',
      width: 50,
      align: 'center',
      render: (generation: number) => {
        if (generation === 0) return <Text type="secondary">—</Text>;
        // 第 3 代及以上种下后收获的已是 G4+，非金光变不产种子
        const isGen3Plus = generation >= 3;
        return (
          <Tag
            color={isGen3Plus ? 'red' : 'default'}
            style={{ fontSize: 11, margin: 0 }}
          >
            G{generation}
          </Tag>
        );
      },
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 70,
      align: 'center',
      sorter: (a, b) => a.quantity - b.quantity,
      render: (qty: number, record) => (
        <Text type={qty > 0 ? undefined : 'secondary'}>
          {qty}{record.seedUnit}
        </Text>
      ),
    },
    {
      title: '等阶',
      dataIndex: 'requiredTier',
      key: 'requiredTier',
      width: 50,
      align: 'center',
      render: (tier: number) => (
        <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>
          {TIER_NAMES[tier] ?? tier}
        </Tag>
      ),
    },
    {
      title: '产量',
      key: 'yield',
      width: 120,
      align: 'center',
      render: (_, record) => {
        if (!record.crop) return <Text type="secondary">—</Text>;
        return (
          <Text>{record.crop.yieldMin}~{record.crop.yieldMax} {record.crop.harvestUnit} {record.crop.name}</Text>
        );
      },
    },
    {
      title: '生长',
      key: 'growthTime',
      width: 70,
      align: 'center',
      render: (_, record) => {
        if (!record.crop) return <Text type="secondary">—</Text>;
        const { stageLabels, growthStageMinutes } = record.crop;
        // 最后一个阶段（如"成熟"）是收获点，持续时间由 witherAfterMinutes 决定，不在此展示
        const tooltipParts = stageLabels.map((label, i) => {
          if (i === stageLabels.length - 1) return label;
          return `${label}: ${formatGrowthTime(growthStageMinutes[i])}`;
        });
        return (
          <Tooltip title={tooltipParts.join(' → ')}>
            <Text>{formatGrowthTime(record.crop.totalGrowthMinutes)}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '单价',
      dataIndex: 'sellPrice',
      key: 'sellPrice',
      width: 90,
      align: 'right',
      render: (price: number, record) => (
        <Text type="secondary">{price} 灵石/{record.seedUnit}</Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      align: 'center',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          disabled={record.quantity <= 0 || record.sellPrice <= 0}
          onClick={() => setSellModal({
            itemId: record.itemId,
            name: record.name,
            mutationType: record.mutationType,
          })}
        >
          出售
        </Button>
      ),
    },
  ];

  return (
    <Flex vertical gap="middle">
      {/* 种子袋表格 */}
      {seedBagItems.length === 0 ? (
        <Empty description="种子袋为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          dataSource={seedBagItems}
          columns={seedBagColumns}
          rowKey={(record) => `${record.itemId}-${record.mutationType ?? 'normal'}-${record.generation}`}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      )}

      {/* 出售弹窗 */}
      <ResponsiveModal
        title="出售种子"
        open={sellModal != null}
        onClose={() => { setSellModal(null); setSellQuantity(1); }}
        onOk={handleSell}
      >
        {(() => {
          if (!sellModal) return null;
          const seed = seedBagItems.find(
            (s) => s.itemId === sellModal.itemId && s.mutationType === sellModal.mutationType,
          );
          if (!seed) return null;
          return (
            <Flex vertical gap="middle">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="名称">
                  {seed.name} {seed.mutationType && `[${MUTATION_LABELS[seed.mutationType]?.label}]`}
                </Descriptions.Item>
                <Descriptions.Item label="持有">{seed.quantity}{seed.seedUnit}</Descriptions.Item>
                <Descriptions.Item label="单价">{seed.sellPrice} 灵石/{seed.seedUnit}</Descriptions.Item>
                <Descriptions.Item label="总价">{seed.sellPrice * sellQuantity} 灵石</Descriptions.Item>
              </Descriptions>
              <InputNumber
                min={1}
                max={seed.quantity}
                value={sellQuantity}
                onChange={(v) => setSellQuantity(v ?? 1)}
                style={{ width: '100%' }}
              />
            </Flex>
          );
        })()}
      </ResponsiveModal>
    </Flex>
  );
});

export default FarmSeedBag;
