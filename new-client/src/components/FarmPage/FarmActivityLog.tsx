/**
 * 灵田系统 V3 — 活动日志组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：以表格形式展示灵田活动日志（播种/收获/铲除/枯萎/杂交/变异记录）。
 * 2. 不做什么：不做日志写入（由后端 service 负责）。
 *
 * 数据流 / 状态流：
 * 组件挂载时调用 FarmStore.fetchLog → activityLogs 更新 → Table 渲染。
 *
 * 复用设计说明：
 * - 活动类型标签映射集中管理。
 * - 时间格式化使用项目统一的时区格式。
 *
 * 关键边界条件与坑点：
 * 1. 日志按时间倒序排列，最新在前。
 * 2. metadata 内容根据 activityType 不同有不同字段，需要分别处理。
 */

import { useContext, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RootStoreContext } from '../../stores/RootStore';
import type { ActivityLogDto } from '../../services/api/farm';

const { Text } = Typography;

/** 活动类型标签 */
const ACTIVITY_LABELS: Record<string, { label: string; color: string }> = {
  plant: { label: '播种', color: 'green' },
  harvest: { label: '收获', color: 'gold' },
  remove: { label: '铲除', color: 'red' },
  wither: { label: '枯萎', color: 'default' },
  hybrid: { label: '杂交', color: 'purple' },
  mutation: { label: '变异', color: 'orange' },
};

/** 变异类型标签 */
const MUTATION_LABELS: Record<string, string> = {
  gold: '金光变',
  double_yield: '丰收变',
  speed_ripen: '速熟变',
  wither_early: '早衰变',
  half_yield: '歉收变',
};

/** 品质标签 */
const QUALITY_LABELS: Record<string, string> = {
  hq: '优质',
  normal: '普通',
  lq: '劣质',
};

// 使用 Intl.DateTimeFormat 确保 Asia/Shanghai 时区（与 CLAUDE.md 规范一致）
// 格式：2026/06/14 17:49:52
const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

/** 格式化时间戳（Asia/Shanghai 时区） */
const formatTime = (ts: number): string => {
  // createdAt 已经是毫秒时间戳，不需要 * 1000
  return ACTIVITY_TIME_FORMATTER.format(new Date(ts));
};

/** 渲染日志详情（纯文本） */
const renderDetail = (log: ActivityLogDto): string => {
  const meta = log.metadata;
  const cropName = log.cropName ?? log.cropId ?? '-';
  const pos = `(${log.row + 1}-${log.col + 1})`;

  switch (log.activityType) {
    case 'plant': {
      const parts = [cropName, pos];
      const generation = meta.generation as number;
      if (generation > 0) parts.push(`G${generation}`);
      const mutationType = meta.mutationType as string | null;
      if (mutationType) parts.push(MUTATION_LABELS[mutationType] ?? mutationType);
      if (meta.hybridTriggered) parts.push('触发杂交');
      return parts.join(' ');
    }
    case 'harvest': {
      const quantity = meta.quantity as number;
      const quality = meta.quality as string;
      const qualityLabel = QUALITY_LABELS[quality] ?? quality;
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
      return `${cropName} ${pos} ${MUTATION_LABELS[mutationType] ?? mutationType}`;
    }
    default:
      return '-';
  }
};

/** 表格列定义 */
const COLUMNS: ColumnsType<ActivityLogDto> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    width: 120,
    render: (ts: number) => <Text type="secondary">{formatTime(ts)}</Text>,
  },
  {
    title: '类型',
    dataIndex: 'activityType',
    width: 80,
    render: (type: string) => {
      const config = ACTIVITY_LABELS[type];
      return config ? <Tag color={config.color}>{config.label}</Tag> : type;
    },
  },
  {
    title: '详情',
    key: 'detail',
    render: (_: unknown, record: ActivityLogDto) => renderDetail(record),
  },
];

/** 灵田活动日志组件 */
const FarmActivityLog = observer(function FarmActivityLog() {
  const rootStore = useContext(RootStoreContext)!;
  const { farmStore } = rootStore;

  useEffect(() => {
    farmStore.fetchLog(1);
  }, [farmStore]);

  const dataSource = useMemo(() => farmStore.activityLogs, [farmStore.activityLogs]);

  return (
    <Table
      columns={COLUMNS}
      dataSource={dataSource}
      rowKey="id"
      size="small"
      loading={farmStore.activityLogsLoading}
      locale={{ emptyText: '暂无活动记录' }}
      pagination={{
        current: farmStore.activityLogsPage,
        pageSize: farmStore.activityLogsPageSize,
        total: farmStore.activityLogsTotal,
        showSizeChanger: false,
        showTotal: (total) => `共 ${total} 条`,
        onChange: (page) => farmStore.fetchLog(page),
      }}
    />
  );
});

export default FarmActivityLog;
