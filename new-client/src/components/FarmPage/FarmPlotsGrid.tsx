/**
 * 灵田系统 V3 — 主界面组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示 4×N 网格的地块状态，提供播种、收获、扩展等操作入口。
 * 2. 不做什么：不做具体格子的阶段刷新（由 CellCard 自行管理）。
 *
 * 布局设计：
 * - PC端：左侧灵田网格 + 右侧（种子袋 + 灵材仓库）
 * - 移动端：灵田网格 + 底部操作栏（种子袋/灵材仓库/攻略均为弹窗）
 *
 * 数据流 / 状态流：
 * FarmStore.reclaimed + cells + farmInfo → 网格渲染。
 * 每个 CellCard 直接使用后端返回的阶段信息（stage/stageIndex/stageLabel），
 * 进度条每 1s 局部刷新（仅生长中的格子）。
 *
 * 关键边界条件与坑点：
 * 1. CellCard 的进度条每 1s 局部刷新（仅生长中的格子）。
 * 2. 阶段信息直接使用后端返回值，确保前后端一致。
 * 3. 未开垦玩家（reclaimed=false）显示开垦界面。
 */

import { useContext, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Card, Row, Col, Button, Tag, Flex, Typography, Popover, Segmented,
  Descriptions, Tooltip, Empty, App, Drawer, Tabs, theme, Statistic,
} from 'antd';
import {
  LockOutlined, ThunderboltOutlined, CheckOutlined,
  ShoppingOutlined, InboxOutlined, QuestionCircleOutlined, ReloadOutlined, SwapOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { RootStoreContext } from '../../stores/RootStore';
import { useIsMobile } from '../../shared/responsive';
import ResponsiveModal from '../../shared/ResponsiveModal';
import type { FarmCellDto, CropQuality } from '../../services/api/farm';
import FarmSeedBag from './FarmSeedBag';
import FarmSeedShop from './FarmSeedShop';
import FarmHarvestBag from './FarmHarvestBag';
import FarmHybridGuide from './FarmHybridGuide';
import FarmActivityLog from './FarmActivityLog';
import { ELEMENT_COLORS, MUTATION_LABELS } from './farmConstants';
import { ElementTag } from './ElementTag';

const { Text } = Typography;

const QUALITY_LABELS: Record<CropQuality, { label: string; color: string }> = {
  hq: { label: '优质', color: 'gold' },
  normal: { label: '普通', color: 'default' },
  lq: { label: '劣质', color: 'default' },
};

// ── 攻略内容组件（PC 弹窗 / 移动端弹窗复用） ──
const GuideContent = () => (
  <Flex vertical gap={12}>
    <div>
      <Text strong>基本玩法</Text>
      <ul style={{ paddingLeft: 16, marginTop: 4, marginBottom: 0 }}>
        <li>点击空地播种，选择种子袋中的种子</li>
        <li>成熟后点击收获，过期则枯萎</li>
        <li>初始 4×4 网格，可扩展新行</li>
      </ul>
    </div>
    <div>
      <Text strong>五行灵根</Text>
      <Flex gap={4} wrap="wrap" style={{ marginTop: 4 }}>
        {(['金', '木', '水', '火', '土'] as const).map((e) => (
          <Tag
            key={e}
            style={{
              fontSize: 11,
              margin: 0,
              backgroundColor: ELEMENT_COLORS[e],
              borderColor: ELEMENT_COLORS[e],
              color: '#fff',
              fontWeight: 500,
            }}
          >
            {e}
          </Tag>
        ))}
      </Flex>
    </div>
    <div>
      <Text strong>变异（种植时 5% 触发）</Text>
      <ul style={{ paddingLeft: 16, marginTop: 4, marginBottom: 0, fontSize: 12 }}>
        <li><Tag color="gold" style={{ fontSize: 10 }}>金光变</Tag>品质提升一档 + 必然产种</li>
        <li><Tag color="green" style={{ fontSize: 10 }}>丰收变</Tag>产量 ×2</li>
        <li><Tag color="blue" style={{ fontSize: 10 }}>速熟变</Tag>生长周期 −30%</li>
        <li><Tag color="orange" style={{ fontSize: 10 }}>早衰变</Tag>枯萎时间提前</li>
        <li><Tag color="red" style={{ fontSize: 10 }}>歉收变</Tag>产量减半</li>
      </ul>
    </div>
    <div>
      <Text strong>品质与杂交</Text>
      <ul style={{ paddingLeft: 16, marginTop: 4, marginBottom: 0, fontSize: 12 }}>
        <li>收获品质：优质 20% / 普通 70% / 劣质 10%</li>
        <li>相邻非成熟作物 → 种植时自动触发杂交</li>
        <li>优质收获或金光变 → 必然产出种子</li>
        <li>出售灵材：1000 个体 = 1 交易单位，优质 ×2、劣质 ×0.5</li>
      </ul>
    </div>
  </Flex>
);

const FarmPlotsGrid = observer(function FarmPlotsGrid() {
  const { message: messageApi, modal } = App.useApp();
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;
  const isMobile = useIsMobile();
  const { token } = theme.useToken();

  const [plantModal, setPlantModal] = useState<{ row: number; col: number } | null>(null);
  const [selectedSeedId, setSelectedSeedId] = useState<number | null>(null);
  const [elementFilter, setElementFilter] = useState<string>('all');
  const [transplantMode, setTransplantMode] = useState<{ fromRow: number; fromCol: number } | null>(null);
  const [bagModalOpen, setBagModalOpen] = useState(false);
  const [bagModalTab, setBagModalTab] = useState('seeds');
  const [pcTab, setPcTab] = useState('seeds');
  const [seedDrawerOpen, setSeedDrawerOpen] = useState(false);
  const [harvestDrawerOpen, setHarvestDrawerOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // ── V3：未开垦状态，显示开垦界面 ──
  if (!farmStore.reclaimed) {
    const cost = farmStore.reclaimCost;
    return (
      <Card title="灵田开垦" style={{ textAlign: 'center', padding: 24 }}>
        <Typography.Paragraph>
          你尚未开垦灵田，需要支付以下费用方可开垦：
        </Typography.Paragraph>
        {cost && (
          <Descriptions column={1} bordered size="small" style={{ maxWidth: 400, margin: '0 auto 16px' }}>
            <Descriptions.Item label="格子费用">
              16 格 × {cost.spiritStones / 16} 灵石/格 = {cost.spiritStones} 灵石
            </Descriptions.Item>
            <Descriptions.Item label="息壤费用">
              16 单位 × {cost.xiRangPricePerUnit} 灵石/单位 = {cost.xiRang * cost.xiRangPricePerUnit} 灵石
            </Descriptions.Item>
            <Descriptions.Item label="总计">
              <Text strong style={{ color: '#f5222d' }}>{cost.totalSpiritStones} 灵石</Text>
            </Descriptions.Item>
            <Descriptions.Item label="获得">4×4 网格（16 格）+ 初始种子</Descriptions.Item>
          </Descriptions>
        )}
        <Button
          type="primary"
          size="large"
          onClick={async () => {
            const ok = await farmStore.reclaimFarm();
            if (ok) messageApi.success('灵田开垦成功！获得 4×4 网格和初始种子');
          }}
        >
          开垦灵田
        </Button>
      </Card>
    );
  }

  // V3：已开垦，farmInfo 必定存在
  const farmInfo = farmStore.farmInfo!;

  const handlePlant = async () => {
    if (!plantModal || !selectedSeedId) return;
    const result = await farmStore.plant(plantModal.row, plantModal.col, selectedSeedId);
    if (result) {
      if (result.hybridTriggered) {
        messageApi.success(`播种成功，触发杂交：${result.hybridResultSeedName}`);
      } else {
        messageApi.success('播种成功');
      }
      setPlantModal(null);
      setSelectedSeedId(null);
    }
  };

  const handleHarvest = async (row: number, col: number) => {
    const result = await farmStore.harvest(row, col);
    if (result) {
      if (result.withered) {
        if (result.witheredSeedItemId) {
          messageApi.warning('作物已枯萎，金光变自然掉落 1 颗种子。');
        } else {
          messageApi.info('作物已枯萎，已清理。');
        }
      } else {
        messageApi.success(
          `收获 ${result.quantity} 颗（${QUALITY_LABELS[result.quality ?? 'normal'].label}）`
          + (result.seedProduced ? ' + 种子 1 颗' : '')
        );
      }
    }
  };

  const handleRemove = (row: number, col: number) => {
    modal.confirm({
      title: '铲除作物',
      content: `确认铲除格子 ${row + 1}-${col + 1} 的作物吗？`,
      onOk: async () => {
        const result = await farmStore.remove(row, col);
        if (result?.success) {
          if (result.hybridRevoked) {
            messageApi.warning('作物已铲除，已判定的杂交种子被撤销。');
          } else {
            messageApi.success('作物已铲除');
          }
        }
      },
    });
  };

  const handleExpandCell = (row: number, col: number) => {
    modal.confirm({
      title: '扩展格子',
      content: `确认扩展格子 ${row + 1}-${col + 1} 吗？`,
      onOk: async () => {
        const ok = await farmStore.expandCell(row, col);
        if (ok) messageApi.success('格子扩展成功');
      },
    });
  };

  // 进入移植模式
  const handleStartTransplant = (row: number, col: number) => {
    setTransplantMode({ fromRow: row, fromCol: col });
    messageApi.info('点击空格子完成移植，点击取消按钮退出');
  };

  // 完成移植（点击目标格子）
  const handleTransplantTo = async (toRow: number, toCol: number) => {
    if (!transplantMode) return;
    const { fromRow, fromCol } = transplantMode;
    const result = await farmStore.transplant(fromRow, fromCol, toRow, toCol);
    if (result?.success) {
      messageApi.success('移植成功');
      setTransplantMode(null);
    }
  };

  // 取消移植模式
  const handleCancelTransplant = () => {
    setTransplantMode(null);
  };

  const availableSeeds = farmStore.seedBagWithConfig.filter((s) => s.quantity > 0 && s.enabled);

  // 元素筛选
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

  const filteredSeeds = useMemo(() => {
    if (elementFilter === 'all') return availableSeeds;
    if (elementFilter === 'none') return availableSeeds.filter((s) => s.element.length === 0);
    // 单属性或双属性
    const filterElements = elementFilter.split('');
    return availableSeeds.filter((s) => {
      if (s.element.length !== filterElements.length) return false;
      return filterElements.every((e) => s.element.includes(e as never));
    });
  }, [availableSeeds, elementFilter]);

  // 按行分组格子
  const gridRows: FarmCellDto[][] = [];
  for (const cell of farmStore.cells) {
    if (!gridRows[cell.row]) gridRows[cell.row] = [];
    gridRows[cell.row].push(cell);
  }

  // ── 灵田主卡片（信息 + 网格） ──
  const farmMainCardExtra = (
    <Flex gap={4}>
      {isMobile && (
        <>
          <Button
            size="small"
            icon={<ShoppingOutlined />}
            onClick={() => { setBagModalTab('seeds'); setBagModalOpen(true); }}
          >
            种子
          </Button>
          <Button
            size="small"
            icon={<InboxOutlined />}
            onClick={() => { setBagModalTab('harvest'); setBagModalOpen(true); }}
          >
            灵材
          </Button>
        </>
      )}
      <Button
        size="small"
        icon={<QuestionCircleOutlined />}
        onClick={() => setGuideOpen(true)}
      >
        {isMobile ? null : '攻略'}
      </Button>
      <Tooltip title="刷新数据">
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => farmStore.fetchOverview()}
        />
      </Tooltip>
    </Flex>
  );

  const farmMainCard = (
    <Card
      title="抹茶灵田"
      extra={farmMainCardExtra}
    >
      {/* 灵田信息 */}
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="灵田等阶">
          <Tag color="purple">{farmInfo.farmTierName}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="灵田等级">
          <Tag color="blue">Lv.{farmInfo.farmLevel}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="经验">
          {farmInfo.farmExp}{farmInfo.nextLevelExpRequired > 0 ? ` / ${farmInfo.nextLevelExpRequired}` : '（满级）'}
        </Descriptions.Item>
        {farmInfo.nextTier && (
          <Descriptions.Item label="下一级等阶" span={2}>
            <Flex align="center" gap={8}>
              <Tooltip title={`总消耗 ${farmInfo.nextTier.totalSpiritStoneCost} 灵石（息壤 ×${farmInfo.nextTier.xiRangCost} 单价 ${farmInfo.xiRangPricePerUnit}）`}>
                <Text>{farmInfo.nextTier.displayName}（需要 Lv.{farmInfo.nextTier.minLevel} + {farmInfo.nextTier.xiRangCost} 息壤）</Text>
              </Tooltip>
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={() => farmStore.upgradeTier()}
              >
                突破
              </Button>
              <Button
                size="small"
                icon={<CheckOutlined />}
                onClick={async () => {
                  const count = await farmStore.harvestAll();
                  if (count > 0) {
                    messageApi.success(`收获 ${count} 块作物`);
                  } else {
                    messageApi.info('没有成熟的作物');
                  }
                }}
              >
                一键收菜
              </Button>
            </Flex>
          </Descriptions.Item>
        )}
      </Descriptions>

      {/* 已达最高等阶时，单独显示一键收菜按钮 */}
      {!farmInfo.nextTier && (
        <Flex justify="flex-end" style={{ marginBottom: 12 }}>
          <Button
            size="small"
            icon={<CheckOutlined />}
            onClick={async () => {
              const count = await farmStore.harvestAll();
              if (count > 0) {
                messageApi.success(`收获 ${count} 块作物`);
              } else {
                messageApi.info('没有成熟的作物');
              }
            }}
          >
            一键收菜
          </Button>
        </Flex>
      )}

      {/* 灵田网格 */}
      {gridRows.map((rowCells, rowIdx) => (
        <Row gutter={[8, 8]} key={rowIdx} style={{ marginBottom: rowIdx < gridRows.length - 1 ? 8 : 0 }}>
          {rowCells.map((cell) => {
            const isTransplantSource = transplantMode?.fromRow === cell.row && transplantMode?.fromCol === cell.col;
            const isTransplantTarget = transplantMode != null && !cell.cropId && cell.unlocked;
            return (
              <Col xs={6} key={`${cell.row}-${cell.col}`}>
                <CellCard
                  cell={cell}
                  isMobile={isMobile}
                  isTransplantSource={isTransplantSource}
                  isTransplantTarget={isTransplantTarget}
                  onPlant={() => setPlantModal({ row: cell.row, col: cell.col })}
                  onHarvest={() => handleHarvest(cell.row, cell.col)}
                  onRemove={() => handleRemove(cell.row, cell.col)}
                  onExpand={() => handleExpandCell(cell.row, cell.col)}
                  onTransplant={() => handleStartTransplant(cell.row, cell.col)}
                  onTransplantTarget={() => handleTransplantTo(cell.row, cell.col)}
                />
              </Col>
            );
          })}
        </Row>
      ))}

      {/* 移植模式取消按钮 */}
      {transplantMode && (
        <Flex justify="center" style={{ marginTop: 12 }}>
          <Button onClick={handleCancelTransplant}>取消移植</Button>
        </Flex>
      )}
    </Card>
  );

  return (
    <>
      {isMobile ? (
        // ── 移动端：单列布局 ──
        farmMainCard
      ) : (
        // ── PC端：左右分栏 ──
        <Row gutter={16} align="stretch">
          <Col style={{ width: 640 }}>
            {farmMainCard}
          </Col>
          <Col flex="1" style={{ minWidth: 0 }}>
            <Card size="small" style={{ height: '100%' }}>
              <Tabs
                activeKey={pcTab}
                onChange={setPcTab}
                size="small"
                style={{ height: '100%' }}
                tabBarExtraContent={pcTab === 'log' ? (
                  <Tooltip title="刷新日志">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={farmStore.activityLogsLoading}
                      onClick={() => farmStore.fetchLog(farmStore.activityLogsPage)}
                    />
                  </Tooltip>
                ) : null}
                items={[
                  { key: 'seeds', label: '种子袋', children: <FarmSeedBag /> },
                  { key: 'shop', label: '种子商店', children: <FarmSeedShop /> },
                  { key: 'harvest', label: '灵材仓库', children: <FarmHarvestBag /> },
                  { key: 'hybrid', label: '杂交指南', children: <FarmHybridGuide /> },
                  { key: 'log', label: '活动日志', children: <FarmActivityLog /> },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 播种弹窗 */}
      <ResponsiveModal
        title={`播种 ${plantModal ? `${plantModal.row + 1}-${plantModal.col + 1}` : ''}`}
        open={plantModal != null}
        onClose={() => { setPlantModal(null); setSelectedSeedId(null); setElementFilter('all'); }}
        onOk={handlePlant}
        okButtonProps={{ disabled: !selectedSeedId }}
      >
        {availableSeeds.length === 0 ? (
          <Empty description="种子袋为空，请先购买种子" />
        ) : (
          <Flex vertical gap={8}>
            <Segmented
              block
              size="small"
              options={ELEMENT_FILTERS.map((f) => ({ label: f.label, value: f.key }))}
              value={elementFilter}
              onChange={(v) => setElementFilter(v as string)}
            />
            {filteredSeeds.length === 0 ? (
              <Empty description="无符合条件的种子" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                  gap: 8,
                }}
              >
                {filteredSeeds.map((seed) => {
              const isSelected = selectedSeedId === seed.id;
              return (
                <div
                  key={seed.id}
                  onClick={() => setSelectedSeedId(seed.id)}
                  style={{
                    position: 'relative',
                    padding: '8px 6px',
                    border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorder}`,
                    borderRadius: 6,
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
                  {seed.mutationType && (
                    <Tag
                      color={MUTATION_LABELS[seed.mutationType]?.color}
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
                      {MUTATION_LABELS[seed.mutationType]?.label ?? seed.mutationType}
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
                      <ElementTag elements={seed.element} />
                    </div>
                  )}
                  {/* 右下角：数量 */}
                  <Text type="secondary" style={{ fontSize: 11, position: 'absolute', bottom: 2, right: 4 }}>×{seed.quantity}</Text>
                </div>
              );
            })}
              </div>
            )}
          </Flex>
        )}
      </ResponsiveModal>

      {/* 移动端：背包 Tabs 抽屉（底部冒出） */}
      {isMobile && (
        <Drawer
          title="背包"
          open={bagModalOpen}
          onClose={() => setBagModalOpen(false)}
          placement="bottom"
          height="70vh"
          styles={{ body: { padding: '16px' } }}
        >
          <Tabs
            activeKey={bagModalTab}
            onChange={setBagModalTab}
            tabBarExtraContent={bagModalTab === 'log' ? (
              <Tooltip title="刷新日志">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={farmStore.activityLogsLoading}
                  onClick={() => farmStore.fetchLog(farmStore.activityLogsPage)}
                />
              </Tooltip>
            ) : null}
            items={[
              { key: 'seeds', label: '种子袋', children: <FarmSeedBag /> },
              { key: 'shop', label: '种子商店', children: <FarmSeedShop /> },
              { key: 'harvest', label: '灵材仓库', children: <FarmHarvestBag /> },
              { key: 'hybrid', label: '杂交指南', children: <FarmHybridGuide /> },
              { key: 'log', label: '活动日志', children: <FarmActivityLog /> },
            ]}
          />
        </Drawer>
      )}

      {/* PC端：种子袋抽屉 */}
      {!isMobile && (
        <Drawer
          title="种子袋"
          open={seedDrawerOpen}
          onClose={() => setSeedDrawerOpen(false)}
          width={480}
        >
          <FarmSeedBag />
        </Drawer>
      )}

      {/* PC端：灵材仓库抽屉 */}
      {!isMobile && (
        <Drawer
          title="灵材仓库"
          open={harvestDrawerOpen}
          onClose={() => setHarvestDrawerOpen(false)}
          width={480}
        >
          <FarmHarvestBag />
        </Drawer>
      )}

      {/* 攻略弹窗 */}
      <ResponsiveModal
        title="灵田攻略"
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      >
        <GuideContent />
      </ResponsiveModal>
    </>
  );
});

// ── 单格组件 ──

interface CellCardProps {
  cell: FarmCellDto;
  isMobile: boolean;
  isTransplantSource?: boolean;
  isTransplantTarget?: boolean;
  onPlant: () => void;
  onHarvest: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onTransplant: () => void;
  onTransplantTarget: () => void;
}

// 格式化阶段结束时间（UTC+8）
const STAGE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

// 格式化阶段时间（mm/dd HH:mm:ss）
const STAGE_DETAIL_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

/** 格式化时长为"共X时XX分"或"共XX分" */
const formatDuration = (startMs: number, endMs: number): string => {
  const totalMinutes = Math.round((endMs - startMs) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `共${hours}时${minutes.toString().padStart(2, '0')}分`;
  return `共${minutes}分`;
};

const CellCard = observer(function CellCard({
  cell,
  isMobile,
  isTransplantSource,
  isTransplantTarget,
  onPlant,
  onHarvest,
  onRemove,
  onExpand,
  onTransplant,
  onTransplantTarget,
}: CellCardProps) {
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;
  const { token } = theme.useToken();

  // 计算服务器当前时间（考虑本地时间偏移）
  const getServerNow = () => farmStore.serverNow + (Date.now() - farmStore.serverNowFetchedAt);
  // 统一正方形样式：aspect-ratio: 1 保证宽高始终相等，不依赖容器高度
  const squareStyle: React.CSSProperties = { aspectRatio: '1' };
  // 格子背景色加深（亮色/暗色模式均适用）
  const cellBgColor = token.colorFillQuaternary;
  // 移动端使用更紧凑的内边距与字号，避免文字溢出
  const bodyPadding = isMobile ? 4 : 8;
  const nameFontSize = isMobile ? 10 : 12;
  const tagFontSize = isMobile ? 9 : 10;
  const coordFontSize = isMobile ? 10 : 12;
  const iconFontSize = isMobile ? 18 : 24;

  const centerBody: Record<string, React.CSSProperties> = {
    body: {
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: bodyPadding,
    },
  };

  // intervals 已包含加速和速熟变，前端直接用服务器时间对比
  const intervals = cell.cropState?.intervals ?? [];

  // 本地追踪当前阶段（倒计时结束时自动切换）
  const [currentStageIndex, setCurrentStageIndex] = useState(cell.cropState?.stageIndex ?? 0);

  // cropState 变化时（overview 刷新），同步本地阶段
  useEffect(() => {
    if (cell.cropState?.stageIndex != null) {
      setCurrentStageIndex(cell.cropState.stageIndex);
    }
  }, [cell.cropState?.stageIndex]);

  // 当前阶段倒计时结束时，切换到下一阶段
  const handleStageFinish = () => {
    setCurrentStageIndex((prev) => prev + 1);
  };

  if (!cell.unlocked) {
    return (
      <Card
        size="small"
        style={{ ...squareStyle, textAlign: 'center', opacity: 0.6, backgroundColor: cellBgColor }}
        styles={centerBody}
      >
        <LockOutlined style={{ fontSize: iconFontSize, marginBottom: isMobile ? 4 : 8 }} />
        <Text type="secondary" style={{ fontSize: coordFontSize }}>{cell.row + 1}-{cell.col + 1}</Text>
        <Button size="small" type="link" style={{ fontSize: isMobile ? 11 : undefined }} onClick={onExpand}>扩展</Button>
      </Card>
    );
  }

  if (!cell.cropId || !cell.cropState) {
    // 移植模式下，空格子显示为移植目标
    if (isTransplantTarget) {
      return (
        <Card
          size="small"
          style={{
            ...squareStyle, textAlign: 'center', cursor: 'pointer',
            backgroundColor: token.colorSuccessBg,
            borderColor: token.colorSuccessBorder,
          }}
          styles={centerBody}
          onClick={onTransplantTarget}
        >
          <SwapOutlined style={{ fontSize: iconFontSize, color: token.colorSuccess, marginBottom: isMobile ? 4 : 8 }} />
          <Text type="secondary" style={{ fontSize: coordFontSize }}>{cell.row + 1}-{cell.col + 1}</Text>
          <Text style={{ fontSize: nameFontSize, color: token.colorSuccess }}>点击移植</Text>
        </Card>
      );
    }
    return (
      <Card
        size="small"
        style={{ ...squareStyle, textAlign: 'center', cursor: 'pointer', backgroundColor: cellBgColor }}
        styles={centerBody}
        onClick={onPlant}
      >
        <Text type="secondary" style={{ fontSize: coordFontSize }}>{cell.row + 1}-{cell.col + 1}</Text>
        <Text type="secondary" style={{ fontSize: nameFontSize }}>空地</Text>
        <Button size="small" type="link" style={{ fontSize: isMobile ? 11 : undefined }}>播种</Button>
      </Card>
    );
  }

  // 根据本地追踪的 currentStageIndex 获取当前阶段信息
  const currentInterval = intervals.find((iv) => iv.stageIndex === currentStageIndex);
  const state = {
    stage: currentInterval?.stage ?? cell.cropState.stage,
    stageIndex: currentStageIndex,
    stageLabel: currentInterval?.stageLabel ?? cell.cropState.stageLabel,
  };

  const isHarvestable = state.stage === 'harvestable';
  const isWithered = state.stage === 'withered';
  // 萌芽阶段（stageIndex=0）不显示变异标签
  const isGerminating = state.stageIndex === 0;
  const mutation = cell.mutationType && !isGerminating ? MUTATION_LABELS[cell.mutationType] : null;
  // cropElement 是数组，取第一个元素作为主颜色
  const primaryElement = cell.cropElement.length > 0 ? cell.cropElement[0] : null;
  const elementColor = primaryElement ? ELEMENT_COLORS[primaryElement] : undefined;
  // 阶段标签文字作为背景
  const stageChar = state.stageLabel;

  return (
    <Card
      size="small"
      style={{
        ...squareStyle,
        borderColor: isHarvestable ? '#52c41a' : isWithered ? '#999' : undefined,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: cellBgColor,
      }}
      styles={{ body: { padding: bodyPadding, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' } }}
    >
      {/* 阶段标签背景 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: isMobile ? 24 : 32,
          fontWeight: 'bold',
          color: elementColor ?? '#999',
          opacity: 0.15,
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {stageChar}
      </div>

      <Flex justify="space-between" align="center" gap={2} style={{ position: 'relative', zIndex: 1 }}>
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ fontSize: 11, maxWidth: 280 }}>
              {/* 阶段时间 */}
              {intervals.filter(iv => iv.stage !== 'withered' && iv.endAt !== Infinity).map((iv, idx, arr) => {
                const nextLabel = arr[idx + 1]?.stageLabel ?? '枯萎';
                return (
                  <div key={iv.stageIndex} style={{ marginBottom: 4, whiteSpace: 'nowrap' }}>
                    <Text strong>{iv.stageLabel} → {nextLabel}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      始 {STAGE_DETAIL_FORMATTER.format(iv.startAt)} 终 {STAGE_DETAIL_FORMATTER.format(iv.endAt)} {formatDuration(iv.startAt, iv.endAt)}
                    </Text>
                  </div>
                );
              })}
              {/* 作物信息：产量 + 售价 */}
              {(() => {
                const cropConfig = farmStore.staticConfig?.crops.find((c) => c.cropId === cell.cropId);
                if (!cropConfig) return null;
                return (
                  <div style={{ marginTop: 6, borderTop: '1px solid ' + token.colorBorderSecondary, paddingTop: 6 }}>
                    <div>
                      <Text type="secondary">产量：</Text>
                      <Text>{cropConfig.yieldMin}~{cropConfig.yieldMax} {cropConfig.harvestUnit}</Text>
                    </div>
                    <div>
                      <Text type="secondary">售价：</Text>
                      <Text>{cropConfig.sellPricePerUnit} 灵石/{cropConfig.harvestTradeUnit}{cropConfig.harvestUnit}</Text>
                    </div>
                  </div>
                );
              })()}
              {/* 已触发杂交 */}
              {cell.pendingHybridSeedName && (
                <div style={{ marginTop: 6, borderTop: '1px solid ' + token.colorBorderSecondary, paddingTop: 6 }}>
                  <Text strong style={{ fontSize: 10 }}>已触发杂交：</Text>
                  <div style={{ fontSize: 10, marginTop: 2 }}>
                    <Text>→ {cell.pendingHybridSeedName}</Text>
                  </div>
                </div>
              )}
            </div>
          }
        >
          <Text
            strong
            style={{ fontSize: nameFontSize, color: elementColor, minWidth: 0, flex: 1, cursor: 'pointer' }}
            ellipsis
          >
            {cell.cropName}
          </Text>
        </Popover>
        {mutation && (
          <Tag
            color={mutation.color}
            style={{ fontSize: tagFontSize, lineHeight: isMobile ? '14px' : '16px', padding: '0 3px', marginLeft: 2, flexShrink: 0 }}
          >
            {mutation.label}
          </Tag>
        )}
      </Flex>

      {/* 当前阶段倒计时 */}
      {state.stage !== 'withered' && cell.cropState && (() => {
        const currentIv = intervals.find(iv => iv.stageIndex === currentStageIndex && iv.endAt !== Infinity);
        if (!currentIv) return null;
        return (
          <Flex justify="center" align="center" style={{ fontSize: isMobile ? 10 : 11 }}>
            <Statistic.Timer
              type="countdown"
              value={currentIv.endAt}
              format="HH:mm:ss"
              valueStyle={{ fontSize: isMobile ? 10 : 11, lineHeight: 1 }}
              onFinish={handleStageFinish}
            />
          </Flex>
        );
      })()}

      {cell.pendingHybridSeedName && (
        <Text
          type="secondary"
          style={{ fontSize: isMobile ? 9 : 10, position: 'relative', zIndex: 1 }}
          ellipsis={{ tooltip: `杂交已触发：${cell.pendingHybridSeedName}` }}
        >
          杂交：{cell.pendingHybridSeedName}
        </Text>
      )}

      <div style={{ flex: 1 }} />

      {isHarvestable && (
        <Button
          size="small"
          type="primary"
          icon={<CheckOutlined />}
          block
          onClick={onHarvest}
          style={{ fontSize: isMobile ? 12 : undefined, position: 'relative', zIndex: 1 }}
        >
          收获
        </Button>
      )}
      {isWithered && (
        <Button
          size="small"
          danger
          block
          onClick={onHarvest}
          style={{ fontSize: isMobile ? 12 : undefined, position: 'relative', zIndex: 1 }}
        >
          清理
        </Button>
      )}
      {!isHarvestable && !isWithered && (
        <Flex gap={4}>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            block={isMobile}
            onClick={onRemove}
            style={{ fontSize: isMobile ? 12 : undefined, position: 'relative', zIndex: 1 }}
          >
            {isMobile ? null : '铲除'}
          </Button>
          <Button
            size="small"
            icon={<SwapOutlined />}
            block={isMobile}
            onClick={onTransplant}
            style={{ fontSize: isMobile ? 12 : undefined, position: 'relative', zIndex: 1 }}
          >
            {isMobile ? null : '移植'}
          </Button>
        </Flex>
      )}
    </Card>
  );
});

export default FarmPlotsGrid;
