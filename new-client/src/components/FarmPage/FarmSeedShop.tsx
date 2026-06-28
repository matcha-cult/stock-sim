/**
 * 灵田系统 V3 — 种子商店组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示商店种子目录（含作物产量、生长时间等信息），提供购买操作。
 * 2. 不做什么：不做种子袋（由 FarmSeedBag 负责）。
 *
 * 数据流 / 状态流：
 * FarmStore.shopSeeds + staticConfig.crops → 渲染。用户操作 → FarmStore 方法 → 自动刷新。
 *
 * 复用设计说明：
 * - 作物信息（产量、生长阶段）通过 cropId 从 staticConfig.crops 查找，避免重复存储。
 */

import { useContext, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button, Tag, Flex, Typography, InputNumber,
  Descriptions, Empty, App, Table, Tooltip, Space,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RootStoreContext } from '../../stores/RootStore';
import type { SeedConfigDto, CropConfigDto, CropElement } from '../../services/api/farm';
import ResponsiveModal from '../../shared/ResponsiveModal';
import { TIER_NAMES } from './farmConstants';
import { ElementTag } from './ElementTag';

const { Text } = Typography;

/** 格式化生长时间（分钟 → 可读字符串） */
const formatGrowthTime = (minutes: number): string => {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}时${m}分` : `${h}时`;
};

/** 种子行类型（种子配置 + 关联的作物配置 + 持有量） */
type SeedShopItem = SeedConfigDto & { crop: CropConfigDto | null; owned: number };

const FarmSeedShop = observer(function FarmSeedShop() {
  const { message: messageApi } = App.useApp();
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  const [buyModal, setBuyModal] = useState(false);
  const [buyItemId, setBuyItemId] = useState<string | null>(null);
  const [buyQuantity, setBuyQuantity] = useState(1);

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

  // 构建种子袋数量索引（itemId → 总持有量，合并不同变异类型）
  const seedBagQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of farmStore.seedBag) {
      map.set(item.itemId, (map.get(item.itemId) ?? 0) + item.quantity);
    }
    return map;
  }, [farmStore.seedBag]);

  // 种子列表（附加作物信息和持有量）
  const shopItems: SeedShopItem[] = useMemo(() => {
    return farmStore.shopSeeds.map((seed) => ({
      ...seed,
      crop: cropMap.get(seed.cropId) ?? null,
      owned: seedBagQtyMap.get(seed.itemId) ?? 0,
    }));
  }, [farmStore.shopSeeds, cropMap, seedBagQtyMap]);

  const handleBuy = async () => {
    if (!buyItemId || buyQuantity <= 0) return;
    const ok = await farmStore.buySeed(buyItemId, buyQuantity);
    if (ok) {
      messageApi.success('购买成功');
      setBuyModal(false);
      setBuyItemId(null);
      setBuyQuantity(1);
    }
  };

  // 种子商店表格列定义
  const shopColumns: ColumnsType<SeedShopItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '科属',
      dataIndex: 'traits',
      key: 'traits',
      width: 80,
      align: 'center',
      render: (traits: string[]) => (
        <Space size={2} wrap>
          {traits.map((trait) => (
            <Tag key={trait} style={{ fontSize: 11, margin: 0 }}>{trait}</Tag>
          ))}
        </Space>
      ),
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
      title: '单价',
      dataIndex: 'buyPrice',
      key: 'buyPrice',
      width: 90,
      align: 'right',
      render: (price: number, record) => (
        <Text>{price} 灵石/{record.seedUnit}</Text>
      ),
    },
    {
      title: '已持有',
      dataIndex: 'owned',
      key: 'owned',
      width: 60,
      align: 'center',
      render: (owned: number) => (
        <Text type={owned > 0 ? undefined : 'secondary'}>{owned}</Text>
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
        return (
          <Tooltip title={record.crop.stageLabels.map((label, i) =>
            `${label}: ${formatGrowthTime(record.crop!.growthStageMinutes[i])}`,
          ).join(' → ')}>
            <Text>{formatGrowthTime(record.crop.totalGrowthMinutes)}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '枯萎',
      key: 'witherTime',
      width: 60,
      align: 'center',
      render: (_, record) => {
        if (!record.crop) return <Text type="secondary">—</Text>;
        return <Text>{formatGrowthTime(record.crop.witherAfterMinutes)}</Text>;
      },
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
          onClick={() => {
            setBuyItemId(record.itemId);
            setBuyQuantity(1);
            setBuyModal(true);
          }}
        >
          购买
        </Button>
      ),
    },
  ];

  return (
    <Flex vertical gap="middle">
      {shopItems.length === 0 ? (
        <Empty description="暂无可购买的种子" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          dataSource={shopItems}
          columns={shopColumns}
          rowKey={(record, index) => `${record.itemId}-${index}`}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      )}

      {/* 购买弹窗 */}
      <ResponsiveModal
        title="购买种子"
        open={buyModal}
        onClose={() => { setBuyModal(false); setBuyItemId(null); setBuyQuantity(1); }}
        onOk={handleBuy}
      >
        {(() => {
          const seed = farmStore.shopSeeds.find((s) => s.itemId === buyItemId);
          if (!seed) return null;
          return (
            <Flex vertical gap="middle">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="名称">{seed.name}</Descriptions.Item>
                <Descriptions.Item label="单价">{seed.buyPrice} 灵石/{seed.seedUnit}</Descriptions.Item>
                <Descriptions.Item label="总价">{seed.buyPrice * buyQuantity} 灵石</Descriptions.Item>
              </Descriptions>
              <InputNumber
                min={1}
                max={seed.maxStack}
                value={buyQuantity}
                onChange={(v) => setBuyQuantity(v ?? 1)}
                style={{ width: '100%' }}
              />
              <Space size="small">
                <Text type="secondary" style={{ fontSize: 12 }}>快捷：</Text>
                {[5, 10, 20, 50].map((qty) => (
                  <Button
                    key={qty}
                    size="small"
                    type={buyQuantity === qty ? 'primary' : 'default'}
                    onClick={() => setBuyQuantity(qty)}
                  >
                    {qty}
                  </Button>
                ))}
              </Space>
            </Flex>
          );
        })()}
      </ResponsiveModal>
    </Flex>
  );
});

export default FarmSeedShop;
