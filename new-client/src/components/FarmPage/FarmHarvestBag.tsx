/**
 * 灵田系统 V3 — 灵材仓库组件（服务端分页）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示灵材仓库（服务端分页表格），提供出售操作（按各作物配置的 harvestTradeUnit 个体 = 1 交易单位）。
 * 2. 不做什么：不做种子袋或灵田网格。
 *
 * 数据流 / 状态流：
 * - 组件 mount → farmStore.fetchHarvestInventory(1) 加载首页。
 * - FarmStore.harvestBagWithConfig（服务端已 join 作物配置）→ 渲染。
 * - 翻页 → farmStore.fetchHarvestInventory(page)。
 * - 用户操作 → FarmStore 方法 → 自动刷新当前页。
 *
 * 复用设计说明：
 * - 作物信息由后端分页接口一并返回（HarvestInventoryItemDto），前端无需再 join staticConfig。
 * - 元素颜色、等阶名称复用 farmConstants。
 * - 分页组件使用 antd Pagination，与 LedgerTab 一致。
 *
 * 关键边界条件与坑点：
 * 1. 交易单位大小由每种灵材的 harvestTradeUnit 配置决定（如灵根 1000、灵莲 10）。
 * 2. 不足 harvestTradeUnit 的余数不可出售，保留在背包中。
 * 3. 出售最后一页最后一项后，当前页可能为空；保留空页显示，用户可手动翻页。
 */

import { useContext, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button, Tag, Flex, Typography, InputNumber,
  Descriptions, Empty, App, Table, Pagination,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';
import type { HarvestInventoryItemDto, CropQuality, CropElement } from '../../services/api/farm';
import ResponsiveModal from '../../shared/ResponsiveModal';
import { TIER_NAMES } from './farmConstants';
import { ElementTag } from './ElementTag';

const { Text } = Typography;

const QUALITY_CONFIG: Record<CropQuality, { label: string; color: string }> = {
  hq: { label: '优质', color: 'gold' },
  normal: { label: '普通', color: 'default' },
  lq: { label: '劣质', color: 'default' },
};

const FarmHarvestBag = observer(function FarmHarvestBag() {
  const { message: messageApi } = App.useApp();
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  const [sellModal, setSellModal] = useState<{ cropId: string; quality: CropQuality } | null>(null);
  const [sellTradeUnits, setSellTradeUnits] = useState(1);

  // 首次挂载加载首页
  useEffect(() => {
    if (!farmStore.harvestInventory.length && farmStore.harvestInventoryTotal === 0) {
      farmStore.fetchHarvestInventory(1);
    }
  }, []);

  // 灵材列表（直接使用后端分页数据，已含作物配置）
  const harvestItems: HarvestInventoryItemDto[] = farmStore.harvestBagWithConfig;

  const handleSell = async () => {
    if (!sellModal || sellTradeUnits <= 0) return;
    const ok = await farmStore.sellHarvest(sellModal.cropId, sellModal.quality, sellTradeUnits);
    if (ok) {
      messageApi.success('出售成功');
      setSellModal(null);
      setSellTradeUnits(1);
    }
  };

  const handleSellAll = async () => {
    const totalEarn = await farmStore.sellAllHarvest();
    if (totalEarn > 0) {
      messageApi.success(`一键出售成功，获得 ${totalEarn} 灵石`);
    }
  };

  const handlePageChange = (page: number) => {
    farmStore.fetchHarvestInventory(page);
  };

  // 灵材仓库表格列定义
  const harvestColumns: ColumnsType<HarvestInventoryItemDto> = [
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
      title: '品质',
      dataIndex: 'quality',
      key: 'quality',
      width: 60,
      align: 'center',
      render: (quality: CropQuality) => {
        const config = QUALITY_CONFIG[quality];
        return (
          <Tag color={config.color} style={{ fontSize: 11, margin: 0 }}>
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 90,
      align: 'center',
      sorter: (a, b) => a.quantity - b.quantity,
      render: (qty: number, record) => (
        <Text>
          {qty.toLocaleString()} {record.harvestUnit}
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
      title: '单价',
      key: 'unitPrice',
      width: 100,
      align: 'right',
      render: (_, record) => {
        const priceMul = record.quality === 'hq' ? 2 : record.quality === 'lq' ? 0.5 : 1;
        const unitPrice = Math.floor(record.sellPricePerUnit * priceMul);
        return (
          <Text type="secondary">{unitPrice} 灵石/{record.harvestTradeUnit}{record.harvestUnit}</Text>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      align: 'center',
      render: (_, record) => {
        const tradeUnits = Math.floor(record.quantity / record.harvestTradeUnit);
        return (
          <Button
            type="link"
            size="small"
            disabled={tradeUnits <= 0}
            onClick={() => {
              setSellModal({ cropId: record.cropId, quality: record.quality });
              setSellTradeUnits(1);
            }}
          >
            出售
          </Button>
        );
      },
    },
  ];

  return (
    <Flex vertical gap="middle">
      <Flex justify="flex-end">
        <Button
          icon={<ShoppingCartOutlined />}
          onClick={handleSellAll}
          disabled={farmStore.harvestInventoryTotal === 0}
        >
          一键出售
        </Button>
      </Flex>

      {farmStore.harvestInventoryTotal === 0 && !farmStore.harvestInventoryLoading ? (
        <Empty description="灵材仓库为空" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Table
            dataSource={harvestItems}
            columns={harvestColumns}
            rowKey={(record) => `${record.cropId}-${record.quality}`}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            loading={farmStore.harvestInventoryLoading}
          />
          {farmStore.harvestInventoryTotal > farmStore.harvestInventoryPageSize && (
            <Flex justify="center">
              <Pagination
                size="small"
                current={farmStore.harvestInventoryPage}
                pageSize={farmStore.harvestInventoryPageSize}
                total={farmStore.harvestInventoryTotal}
                showSizeChanger={false}
                onChange={handlePageChange}
              />
            </Flex>
          )}
        </>
      )}

      {/* 出售弹窗 */}
      <ResponsiveModal
        title="出售灵材"
        open={sellModal != null}
        onClose={() => { setSellModal(null); setSellTradeUnits(1); }}
        onOk={handleSell}
      >
        {(() => {
          if (!sellModal) return null;
          const item = harvestItems.find(
            (h) => h.cropId === sellModal.cropId && h.quality === sellModal.quality,
          );
          if (!item) return null;
          const maxTradeUnits = Math.floor(item.quantity / item.harvestTradeUnit);
          const qualityConfig = QUALITY_CONFIG[item.quality];
          const priceMul = item.quality === 'hq' ? 2 : item.quality === 'lq' ? 0.5 : 1;
          const unitPrice = Math.floor(item.sellPricePerUnit * priceMul);
          return (
            <Flex vertical gap="middle">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="名称">{item.name}</Descriptions.Item>
                <Descriptions.Item label="品质">
                  <Tag color={qualityConfig.color}>{qualityConfig.label}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="持有">{item.quantity.toLocaleString()} {item.harvestUnit}</Descriptions.Item>
                <Descriptions.Item label="可出售">{maxTradeUnits} 单位</Descriptions.Item>
                <Descriptions.Item label="单价">
                  {unitPrice} 灵石/{item.harvestTradeUnit}{item.harvestUnit}
                </Descriptions.Item>
                <Descriptions.Item label="总价">{unitPrice * sellTradeUnits} 灵石</Descriptions.Item>
              </Descriptions>
              <InputNumber
                min={1}
                max={maxTradeUnits}
                value={sellTradeUnits}
                onChange={(v) => setSellTradeUnits(v ?? 1)}
                style={{ width: '100%' }}
                addonAfter="单位"
              />
            </Flex>
          );
        })()}
      </ResponsiveModal>
    </Flex>
  );
});

export default FarmHarvestBag;
