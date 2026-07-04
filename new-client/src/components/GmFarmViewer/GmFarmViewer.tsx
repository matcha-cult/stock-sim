/**
 * GM 灵田查看器组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：GM 查询指定玩家的灵田数据，细分为 4 个子 tab：灵田格子、种子袋、灵材仓库、操作日志。
 * 2. 不做什么：不提供任何修改/删除功能，不处理业务逻辑（由后端 service 负责）。
 *
 * 输入 / 输出：
 * - 输入：无（内部维护查询条件与选中角色状态）。
 * - 输出：查询栏 + 角色信息 + 4 个子 tab 数据展示。
 *
 * 数据流 / 状态流：
 * 用户输入角色 ID 或昵称 -> 点击查询 -> gmGetFarmOverview() -> 渲染 4 个子 tab。
 * 子 tab 切换时按需加载操作日志（分页）。
 *
 * 复用设计说明：
 * - API 调用复用 services/api/gmFarm.ts。
 * - 元素颜色 / 变异标签复用 FarmPage/farmConstants。
 * - 活动日志列渲染复用 FarmActivityLog 的 ACTIVITY_LABELS / renderDetail 模式。
 * - 请求去重复用 RequestDedup（仅 in-flight 守卫，与项目规范一致）。
 *
 * 关键边界条件与坑点：
 * 1. 昵称查询走后端 ILIKE 模糊匹配（取 id 最小的一个），建议运维人员精确查询时使用角色 ID。
 * 2. 灵田格子展示使用表格模式（只读），不显示进度条，阶段信息由后端返回的 cropState.stageLabel 直接渲染。
 * 3. 时间戳使用 Asia/Shanghai 时区格式化（与 CLAUDE.md 规范一致）。
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  App, Button, Card, Descriptions, Empty, Flex, Input, Pagination,
  Spin, Table, Tabs, Tag, Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  gmGetFarmOverview,
  gmGetFarmLog,
  type GmFarmOverviewResponse,
  type GmFarmLookupParams,
} from '../../services/api/gmFarm';
import type {
  FarmCellDto,
  SeedInventoryItem,
  HarvestInventoryItem,
  SeedConfigDto,
  CropConfigDto,
  ActivityLogDto,
} from '../../services/api/farm';
import { ELEMENT_COLORS, MUTATION_LABELS, TIER_NAMES } from '../FarmPage/farmConstants';
import { RequestDedup } from '../../stores/RequestDedup';

const { Text } = Typography;

const dedup = new RequestDedup();

const PAGE_SIZE_LOG = 20;

const ACTIVITY_LABELS: Record<string, { label: string; color: string }> = {
  plant: { label: '播种', color: 'green' },
  harvest: { label: '收获', color: 'gold' },
  remove: { label: '铲除', color: 'red' },
  wither: { label: '枯萎', color: 'default' },
  hybrid: { label: '杂交', color: 'purple' },
  mutation: { label: '变异', color: 'orange' },
};

const QUALITY_LABELS: Record<string, { label: string; color: string }> = {
  hq: { label: '优质', color: 'gold' },
  normal: { label: '普通', color: 'default' },
  lq: { label: '劣质', color: 'orange' },
};

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

const formatTime = (ts: number): string => TIME_FORMATTER.format(new Date(ts));

type SubTabKey = 'cells' | 'seeds' | 'harvest' | 'log';

const GmFarmViewer: React.FC = () => {
  const { message } = App.useApp();

  const [characterIdInput, setCharacterIdInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');

  const [data, setData] = useState<GmFarmOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState(false);

  const [activeTab, setActiveTab] = useState<SubTabKey>('cells');

  const [logs, setLogs] = useState<ActivityLogDto[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLoading, setLogLoading] = useState(false);

  // 种子 / 作物配置索引（来自 overview 返回的 staticConfig）
  const seedConfigMap = useMemo<Map<string, SeedConfigDto>>(() => {
    if (!data) return new Map();
    const map = new Map<string, SeedConfigDto>();
    for (const seed of data.staticConfig.seeds) {
      map.set(seed.itemId, seed);
    }
    return map;
  }, [data]);

  const cropConfigMap = useMemo<Map<string, CropConfigDto>>(() => {
    if (!data) return new Map();
    const map = new Map<string, CropConfigDto>();
    for (const crop of data.staticConfig.crops) {
      map.set(crop.cropId, crop);
    }
    return map;
  }, [data]);

  const lookupParams = useCallback((): GmFarmLookupParams | null => {
    const cid = Number(characterIdInput);
    const characterId = Number.isFinite(cid) && cid > 0 ? cid : undefined;
    const nickname = nicknameInput.trim() || undefined;
    if (characterId == null && !nickname) return null;
    return { characterId, nickname };
  }, [characterIdInput, nicknameInput]);

  const fetchOverview = useCallback(async () => {
    const params = lookupParams();
    if (params == null) {
      message.warning('请输入角色ID或昵称');
      return;
    }
    const key = `overview:${params.characterId ?? ''}:${params.nickname ?? ''}`;
    if (!dedup.enter(key)) return;

    setLoading(true);
    setQueried(true);
    const promise = (async () => {
      try {
        const result = await gmGetFarmOverview(params);
        if (result.success && result.data) {
          setData(result.data);
          setLogPage(1);
          setLogs([]);
          setLogTotal(0);
        } else {
          message.error(result.message ?? '查询灵田数据失败');
          setData(null);
        }
      } catch {
        message.error('查询灵田数据失败');
        setData(null);
      } finally {
        setLoading(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [lookupParams, message]);

  const fetchLogs = useCallback(async (page: number) => {
    if (data == null) return;
    const key = `log:${data.characterId}:${page}`;
    if (!dedup.enter(key)) return;

    setLogLoading(true);
    const promise = (async () => {
      try {
        const result = await gmGetFarmLog(
          { characterId: data.characterId },
          page,
          PAGE_SIZE_LOG,
        );
        if (result.success && result.data) {
          setLogs(result.data.logs);
          setLogTotal(result.data.total);
          setLogPage(result.data.page);
        } else {
          message.error(result.message ?? '查询活动日志失败');
        }
      } catch {
        message.error('查询活动日志失败');
      } finally {
        setLogLoading(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [data, message]);

  // 切换到 log tab 时自动加载
  useEffect(() => {
    if (activeTab !== 'log' || data == null) return;
    if (logs.length === 0 && logTotal === 0) {
      void fetchLogs(1);
    }
  }, [activeTab, data, logs.length, logTotal, fetchLogs]);

  const handleSearch = () => {
    void fetchOverview();
  };

  const handleReset = () => {
    setCharacterIdInput('');
    setNicknameInput('');
    setData(null);
    setQueried(false);
    setLogs([]);
    setLogTotal(0);
    setLogPage(1);
    setActiveTab('cells');
  };

  const handleRefresh = () => {
    void fetchOverview();
    if (activeTab === 'log') {
      void fetchLogs(logPage);
    }
  };

  // 种子袋：合并静态配置与动态库存
  const seedBagRows = useMemo(() => {
    if (!data) return [];
    return data.overview.seedBag.map((item) => {
      const seedConfig = seedConfigMap.get(item.itemId);
      const cropConfig = item.itemId ? cropConfigMap.get(seedConfig?.cropId ?? '') ?? null : null;
      return {
        ...item,
        seedName: seedConfig?.name ?? item.itemId,
        cropName: cropConfig?.name ?? seedConfig?.cropId ?? '-',
        cropElement: cropConfig?.element ?? [],
      };
    });
  }, [data, seedConfigMap, cropConfigMap]);

  // 灵材仓库：合并静态配置
  const harvestBagRows = useMemo(() => {
    if (!data) return [];
    return data.overview.harvestBag.map((item) => {
      const cropConfig = cropConfigMap.get(item.cropId);
      return {
        ...item,
        cropName: cropConfig?.name ?? item.cropId,
        cropElement: cropConfig?.element ?? [],
      };
    });
  }, [data, cropConfigMap]);

  return (
    <Card
      size="small"
      title="GM灵田查看器"
      extra={
        data && (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
        )
      }
      data-section="gm-farm-viewer"
    >
      <Flex vertical gap={16}>
        {/* 查询栏 */}
        <Flex gap={12} wrap="wrap" align="flex-end">
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>角色ID</span>
            <Input
              style={{ width: 120 }}
              size="small"
              placeholder="输入角色ID"
              value={characterIdInput}
              onChange={(e) => setCharacterIdInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Flex>
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>昵称</span>
            <Input
              style={{ width: 160 }}
              size="small"
              placeholder="模糊匹配昵称"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Flex>
          <Button
            type="primary"
            size="small"
            icon={<SearchOutlined />}
            onClick={handleSearch}
            loading={loading}
          >
            查询
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleReset}
          >
            重置
          </Button>
        </Flex>

        {/* 数据区 */}
        <Spin spinning={loading}>
          {data == null ? (
            queried && !loading ? (
              <Empty description="未找到匹配的灵田数据" />
            ) : null
          ) : (
            <Flex vertical gap={12}>
              {/* 角色信息 + 灵田概览 */}
              <CharacterSummary data={data} />

              {/* 4 个子 tab */}
              <Tabs
                activeKey={activeTab}
                onChange={(k) => setActiveTab(k as SubTabKey)}
                destroyInactiveTabPane
                type="card"
                size="small"
                items={[
                  {
                    key: 'cells',
                    label: `灵田格子 (${data.overview.cells.length})`,
                    children: (
                      <CellsTable
                        cells={data.overview.cells}
                      />
                    ),
                  },
                  {
                    key: 'seeds',
                    label: `种子袋 (${seedBagRows.length})`,
                    children: (
                      <SeedsTable rows={seedBagRows} />
                    ),
                  },
                  {
                    key: 'harvest',
                    label: `灵材仓库 (${harvestBagRows.length})`,
                    children: (
                      <HarvestTable rows={harvestBagRows} />
                    ),
                  },
                  {
                    key: 'log',
                    label: '操作日志',
                    children: (
                      <LogTable
                        logs={logs}
                        loading={logLoading}
                        page={logPage}
                        total={logTotal}
                        onPageChange={(p) => void fetchLogs(p)}
                      />
                    ),
                  },
                ]}
              />
            </Flex>
          )}
        </Spin>
      </Flex>
    </Card>
  );
};

// ---- 角色信息 + 灵田概览 ----

function CharacterSummary({ data }: { data: GmFarmOverviewResponse }): React.ReactNode {
  const { overview, characterId, nickname } = data;
  const farmInfo = overview.farmInfo;

  if (!overview.reclaimed || !farmInfo) {
    return (
      <Card size="small" data-element="character-summary">
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, md: 3 }}
          title={`${nickname} (#${characterId})`}
        >
          <Descriptions.Item label="灵田状态">
            <Tag color="default">未开垦</Tag>
          </Descriptions.Item>
          {overview.reclaimCost && (
            <>
              <Descriptions.Item label="开垦费用">
                {overview.reclaimCost.totalSpiritStones.toLocaleString()} 灵石
              </Descriptions.Item>
              <Descriptions.Item label="需要息壤">
                {overview.reclaimCost.xiRang} 单位
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Card>
    );
  }

  const tierName = TIER_NAMES[farmInfo.farmTier] ?? `T${farmInfo.farmTier}`;

  return (
    <Card size="small" data-element="character-summary">
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, md: 3, lg: 4 }}
        title={`${nickname} (#${characterId})`}
      >
        <Descriptions.Item label="等阶">
          <Tag color="blue">{farmInfo.farmTierName}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="等级">
          Lv.{farmInfo.farmLevel}
        </Descriptions.Item>
        <Descriptions.Item label="经验">
          {farmInfo.farmExp.toLocaleString()}
          {farmInfo.nextLevelExpRequired > 0
            ? ` / ${farmInfo.nextLevelExpRequired.toLocaleString()}`
            : ' (满级)'}
        </Descriptions.Item>
        <Descriptions.Item label="灵田规模">
          {farmInfo.maxRow} × 4（{tierName}）
        </Descriptions.Item>
        {farmInfo.nextTier && (
          <>
            <Descriptions.Item label="下一等阶">
              {farmInfo.nextTier.displayName}（Lv.{farmInfo.nextTier.minLevel}+）
            </Descriptions.Item>
            <Descriptions.Item label="突破费用">
              {farmInfo.nextTier.totalSpiritStoneCost.toLocaleString()} 灵石
            </Descriptions.Item>
          </>
        )}
      </Descriptions>
    </Card>
  );
}

// ---- 灵田格子表格 ----

type CellRow = FarmCellDto;

function CellsTable({ cells }: { cells: FarmCellDto[] }): React.ReactNode {
  const columns = useMemo<ColumnsType<CellRow>>(() => [
    {
      title: '位置',
      key: 'pos',
      width: 70,
      render: (_: unknown, r: CellRow) => (
        <Text type="secondary">{r.row + 1}-{r.col + 1}</Text>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      filters: [
        { text: '未解锁', value: 'locked' },
        { text: '空地', value: 'empty' },
        { text: '已装饰', value: 'deco' },
        { text: '生长中', value: 'growing' },
        { text: '可收获', value: 'harvestable' },
        { text: '已枯萎', value: 'withered' },
      ],
      onFilter: (value, r) => {
        if (!r.unlocked) return value === 'locked';
        if (!r.cropId) return value === (r.hasDecoration ? 'deco' : 'empty');
        return value === (r.cropState?.stage ?? 'empty');
      },
      render: (_: unknown, r: CellRow) => {
        if (!r.unlocked) return <Tag color="default">未解锁</Tag>;
        if (!r.cropId) {
          if (r.hasDecoration) return <Tag color="cyan">已装饰</Tag>;
          return <Tag>空地</Tag>;
        }
        const stage = r.cropState?.stage;
        if (stage === 'harvestable') return <Tag color="gold">可收获</Tag>;
        if (stage === 'withered') return <Tag color="default">已枯萎</Tag>;
        return <Tag color="green">生长中</Tag>;
      },
    },
    {
      title: '作物',
      key: 'crop',
      width: 140,
      render: (_: unknown, r: CellRow) => {
        if (!r.cropId) return <Text type="secondary">-</Text>;
        return (
          <Flex vertical gap={2}>
            <Flex gap={4} align="center" wrap="wrap">
              <Text strong>{r.cropName ?? r.cropId}</Text>
              {r.cropElement.map((e) => (
                <span
                  key={e}
                  style={{
                    display: 'inline-block',
                    fontSize: 10,
                    padding: '0 4px',
                    borderRadius: 2,
                    background: ELEMENT_COLORS[e],
                    color: '#fff',
                    lineHeight: '16px',
                  }}
                >
                  {e}
                </span>
              ))}
            </Flex>
            {r.cropRarity && (
              <Text type="secondary" style={{ fontSize: 11 }}>{r.cropRarity}</Text>
            )}
          </Flex>
        );
      },
    },
    {
      title: '阶段',
      key: 'stage',
      width: 100,
      render: (_: unknown, r: CellRow) => {
        if (!r.cropState) return <Text type="secondary">-</Text>;
        return (
          <Flex vertical gap={2}>
            <Text>{r.cropState.stageLabel}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {Math.floor(r.cropState.progressBps / 100)}%
            </Text>
          </Flex>
        );
      },
    },
    {
      title: '变异',
      dataIndex: 'mutationType',
      width: 90,
      render: (v: string | null, r: CellRow) => {
        if (!r.mutated || !v) return <Text type="secondary">-</Text>;
        const cfg = MUTATION_LABELS[v];
        return cfg
          ? <Tag color={cfg.color} style={{ fontSize: 11 }}>{cfg.label}</Tag>
          : <Tag style={{ fontSize: 11 }}>{v}</Tag>;
      },
    },
    {
      title: '装饰',
      key: 'deco',
      width: 80,
      render: (_: unknown, r: CellRow) => {
        if (!r.hasDecoration || !r.decorationType) return <Text type="secondary">-</Text>;
        const labels: Record<string, string> = {
          spring: '灵泉',
          stone: '镇石',
          array: '阵法',
        };
        return <Tag color="cyan">{labels[r.decorationType] ?? r.decorationType}</Tag>;
      },
    },
    {
      title: '种植时间',
      dataIndex: 'plantedAt',
      width: 160,
      render: (ts: number | null) => ts == null
        ? <Text type="secondary">-</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(ts)}</Text>,
    },
    {
      title: '代数',
      dataIndex: 'plantedGeneration',
      width: 60,
      align: 'center',
      render: (v: number) => v > 0 ? `G${v}` : <Text type="secondary">-</Text>,
    },
  ], []);

  return (
    <Table<CellRow>
      columns={columns}
      dataSource={cells}
      rowKey={(r) => `${r.row}-${r.col}`}
      size="small"
      pagination={false}
      scroll={{ x: 800 }}
      style={{ fontSize: 13 }}
      locale={{ emptyText: <Empty description="无灵田格子数据" /> }}
    />
  );
}

// ---- 种子袋表格 ----

type SeedRow = SeedInventoryItem & {
  seedName: string;
  cropName: string;
  cropElement: string[];
};

function SeedsTable({ rows }: { rows: SeedRow[] }): React.ReactNode {
  const columns = useMemo<ColumnsType<SeedRow>>(() => [
    {
      title: '种子名',
      dataIndex: 'seedName',
      width: 140,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '对应作物',
      dataIndex: 'cropName',
      width: 120,
    },
    {
      title: '元素',
      dataIndex: 'cropElement',
      width: 100,
      render: (elements: string[]) => (
        <Flex gap={2} wrap="wrap">
          {elements.length === 0
            ? <Text type="secondary">-</Text>
            : elements.map((e) => (
              <span
                key={e}
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  padding: '0 4px',
                  borderRadius: 2,
                  background: ELEMENT_COLORS[e],
                  color: '#fff',
                  lineHeight: '16px',
                }}
              >
                {e}
              </span>
            ))}
        </Flex>
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 70,
      align: 'right',
      render: (v: number) => <Text strong>{v}</Text>,
    },
    {
      title: '变异',
      dataIndex: 'mutationType',
      width: 90,
      render: (v: string | null) => {
        if (!v) return <Text type="secondary">-</Text>;
        const cfg = MUTATION_LABELS[v];
        return cfg
          ? <Tag color={cfg.color} style={{ fontSize: 11 }}>{cfg.label}</Tag>
          : <Tag style={{ fontSize: 11 }}>{v}</Tag>;
      },
    },
    {
      title: '代数',
      dataIndex: 'generation',
      width: 60,
      align: 'center',
      render: (v: number) => v > 0 ? `G${v}` : <Text type="secondary">-</Text>,
    },
  ], []);

  return (
    <Table<SeedRow>
      columns={columns}
      dataSource={rows}
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 600 }}
      style={{ fontSize: 13 }}
      locale={{ emptyText: <Empty description="种子袋为空" /> }}
    />
  );
}

// ---- 灵材仓库表格 ----

type HarvestRow = HarvestInventoryItem & {
  cropName: string;
  cropElement: string[];
};

function HarvestTable({ rows }: { rows: HarvestRow[] }): React.ReactNode {
  const columns = useMemo<ColumnsType<HarvestRow>>(() => [
    {
      title: '作物名',
      dataIndex: 'cropName',
      width: 140,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '元素',
      dataIndex: 'cropElement',
      width: 100,
      render: (elements: string[]) => (
        <Flex gap={2} wrap="wrap">
          {elements.length === 0
            ? <Text type="secondary">-</Text>
            : elements.map((e) => (
              <span
                key={e}
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  padding: '0 4px',
                  borderRadius: 2,
                  background: ELEMENT_COLORS[e],
                  color: '#fff',
                  lineHeight: '16px',
                }}
              >
                {e}
              </span>
            ))}
        </Flex>
      ),
    },
    {
      title: '品质',
      dataIndex: 'quality',
      width: 80,
      render: (q: string) => {
        const cfg = QUALITY_LABELS[q];
        return cfg
          ? <Tag color={cfg.color}>{cfg.label}</Tag>
          : <Tag>{q}</Tag>;
      },
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 90,
      align: 'right',
      render: (v: number) => <Text strong>{v.toLocaleString()}</Text>,
    },
  ], []);

  return (
    <Table<HarvestRow>
      columns={columns}
      dataSource={rows}
      rowKey={(r) => `${r.cropId}-${r.quality}`}
      size="small"
      pagination={false}
      scroll={{ x: 450 }}
      style={{ fontSize: 13 }}
      locale={{ emptyText: <Empty description="灵材仓库为空" /> }}
    />
  );
}

// ---- 操作日志表格 ----

/** 渲染日志详情（纯文本，与 FarmActivityLog 保持一致） */
const renderLogDetail = (log: ActivityLogDto): string => {
  const meta = log.metadata;
  const cropName = log.cropName ?? log.cropId ?? '-';
  const pos = `(${log.row + 1}-${log.col + 1})`;

  switch (log.activityType) {
    case 'plant': {
      const parts = [cropName, pos];
      const generation = meta.generation as number;
      if (generation > 0) parts.push(`G${generation}`);
      const mutationType = meta.mutationType as string | null;
      if (mutationType) parts.push(MUTATION_LABELS[mutationType]?.label ?? mutationType);
      if (meta.hybridTriggered) parts.push('触发杂交');
      return parts.join(' ');
    }
    case 'harvest': {
      const quantity = meta.quantity as number;
      const quality = meta.quality as string;
      const qualityLabel = QUALITY_LABELS[quality]?.label ?? quality;
      const parts = [cropName, pos, qualityLabel, `×${quantity}`];
      if (meta.seedProduced) parts.push('产种子');
      return parts.join(' ');
    }
    case 'remove': {
      const parts = [cropName, pos];
      if (meta.hybridRevoked) parts.push('撤销杂交');
      return parts.join(' ');
    }
    case 'wither': {
      const parts = [cropName, pos];
      if (meta.seedDropped) parts.push('掉落种子');
      return parts.join(' ');
    }
    case 'hybrid': {
      const recipeName = meta.recipeName as string;
      const resultSeedName = meta.resultSeedName as string;
      return `${recipeName} → ${resultSeedName}`;
    }
    case 'mutation': {
      const mutationType = meta.mutationType as string;
      return `${cropName} ${pos} ${MUTATION_LABELS[mutationType]?.label ?? mutationType}`;
    }
    default:
      return '-';
  }
};

const LOG_COLUMNS: ColumnsType<ActivityLogDto> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    width: 150,
    render: (ts: number) => <Text type="secondary">{formatTime(ts)}</Text>,
  },
  {
    title: '类型',
    dataIndex: 'activityType',
    width: 80,
    render: (type: string) => {
      const cfg = ACTIVITY_LABELS[type];
      return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : type;
    },
  },
  {
    title: '详情',
    key: 'detail',
    render: (_: unknown, record: ActivityLogDto) => renderLogDetail(record),
  },
];

interface LogTableProps {
  logs: ActivityLogDto[];
  loading: boolean;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

function LogTable({ logs, loading, page, total, onPageChange }: LogTableProps): React.ReactNode {
  return (
    <Flex vertical gap={8}>
      <Table<ActivityLogDto>
        columns={LOG_COLUMNS}
        dataSource={logs}
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        scroll={{ x: 500 }}
        style={{ fontSize: 13 }}
        locale={{ emptyText: <Empty description="暂无活动记录" /> }}
      />
      {total > PAGE_SIZE_LOG && (
        <Flex justify="center">
          <Pagination
            size="small"
            current={page}
            pageSize={PAGE_SIZE_LOG}
            total={total}
            showSizeChanger={false}
            showTotal={(t) => `共 ${t} 条`}
            onChange={onPageChange}
          />
        </Flex>
      )}
    </Flex>
  );
}

export default GmFarmViewer;
