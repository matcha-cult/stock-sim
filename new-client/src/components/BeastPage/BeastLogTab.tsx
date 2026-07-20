/**
 * 灵兽操作日志 Tab 组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示玩家的灵兽操作日志（召唤、放生、培育、升阶、化形等），支持分页。
 * 2. 不做什么：不处理日志记录逻辑（由后端服务处理）。
 *
 * 数据流 / 状态流：
 * 组件 mount -> fetchBeastActionLogs -> 渲染日志列表 -> 分页切换。
 *
 * 复用设计说明：
 * - 使用 antd Table + Tag 组件展示日志。
 * - 分页使用 antd Pagination。
 * - 使用 RequestDedup 防止重复请求。
 *
 * 关键边界条件与坑点：
 * 1. 日志按时间倒序排列。
 * 2. 操作类型使用不同颜色标签区分。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, Table, Tag, Typography, Space, Flex } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { fetchBeastActionLogs } from '../../services/api/beast.js';
import type { BeastActionLogDto, BeastActionType } from '../../services/api/beast.js';
import { RequestDedup } from '../../stores/RequestDedup.js';

const { Title, Text } = Typography;

// 操作类型颜色映射
const ACTION_COLOR_MAP: Record<BeastActionType, string> = {
  summon: 'blue',
  release: 'red',
  cultivate: 'green',
  tier_up: 'purple',
  transform: 'orange',
};

const BeastLogTab = function BeastLogTab() {
  const [logs, setLogs] = useState<BeastActionLogDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const dedupRef = useRef(new RequestDedup());

  const loadLogs = useCallback(async (p: number) => {
    const dedup = dedupRef.current;
    const key = `beast-log:${p}`;
    if (!dedup.enter(key)) return;
    setLoading(true);
    try {
      const promise = (async () => {
        const result = await fetchBeastActionLogs(p);
        if (result.success && result.data) {
          setLogs(result.data.logs);
          setTotal(result.data.total);
        }
      })();
      dedup.start(key, promise);
      await promise;
    } finally {
      setLoading(false);
      dedup.complete(key);
    }
  }, []);

  useEffect(() => {
    loadLogs(page);
  }, [page, loadLogs]);

  const columns: ColumnsType<BeastActionLogDto> = [
    {
      title: '操作类型',
      dataIndex: 'actionTypeLabel',
      key: 'actionType',
      width: 100,
      render: (label: string, record) => (
        <Tag color={ACTION_COLOR_MAP[record.actionType]}>
          {label}
        </Tag>
      ),
    },
    {
      title: '灵石消耗',
      dataIndex: 'spiritStonesCost',
      key: 'spiritStonesCost',
      width: 120,
      render: (cost: number) => (
        <Text>{cost > 0 ? cost.toLocaleString() : '-'}</Text>
      ),
    },
    {
      title: '其他消耗',
      dataIndex: 'otherCost',
      key: 'otherCost',
      width: 200,
      render: (cost: string | null) => (
        <Text type="secondary">{cost ?? '-'}</Text>
      ),
    },
    {
      title: '操作详情',
      dataIndex: 'actionDetail',
      key: 'actionDetail',
      ellipsis: true,
      render: (detail: string | null) => (
        <Text>{detail ?? '-'}</Text>
      ),
    },
    {
      title: '操作时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (ts: number) => (
        <Text type="secondary">
          {new Date(ts * 1000).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}
        </Text>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Flex justify="space-between" align="center">
          <Title level={5} style={{ margin: 2 }}>操作日志</Title>
        </Flex>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
        <Flex justify="center">
          <Text type="secondary">
            共 {total} 条记录
          </Text>
        </Flex>
      </Space>
    </Card>
  );
};

export default BeastLogTab;
