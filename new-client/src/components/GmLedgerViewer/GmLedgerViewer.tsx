/**
 * GM 灵石流水账查看器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：GM 查询任意玩家的灵石流水，支持按角色ID、昵称模糊、业务类型过滤，支持分页。
 * 2. 不做什么：不提供编辑/删除功能，不修改任何流水数据。
 *
 * 输入 / 输出：
 * - 输入：无（内部维护过滤条件状态）。
 * - 输出：流水表格 + 过滤条件表单 + 分页器。
 *
 * 数据流 / 状态流：
 * 组件挂载或点击查询 -> gmQueryLedger() -> 渲染 Table -> 翻页 -> 重新请求。
 *
 * 关键边界条件与坑点：
 * 1. 角色ID 和昵称可以同时使用（AND 条件）。
 * 2. 时间使用完整时间戳，方便精确定位。
 */

import { useState, useCallback } from 'react';
import {
  App, Button, Card, Empty, Flex, Input, Pagination, Select, Spin, Table, Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { gmQueryLedger, LEDGER_BIZ_TYPE_LABELS, type LedgerRecordDto } from '../../services/api/ledger';
import { RequestDedup } from '../../stores/RequestDedup';

// 组件级请求去重（仅 in-flight 守卫）
const dedup = new RequestDedup();

const BIZ_TYPE_OPTIONS = Object.entries(LEDGER_BIZ_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const GmLedgerViewer: React.FC = () => {
  const { message } = App.useApp();

  const [records, setRecords] = useState<LedgerRecordDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // 过滤条件
  const [characterId, setCharacterId] = useState('');
  const [nickname, setNickname] = useState('');
  const [bizType, setBizType] = useState<string | undefined>(undefined);

  const fetchLedger = useCallback(async (p: number) => {
    const key = `ledger:${p}:${characterId}:${nickname}:${bizType}`;
    if (!dedup.enter(key)) return;

    setLoading(true);
    const promise = (async () => {
      try {
        const params: { characterId?: number; nickname?: string; bizType?: string; page: number } = { page: p };
        const cid = Number(characterId);
        if (Number.isFinite(cid) && cid > 0) {
          params.characterId = cid;
        }
        if (nickname.trim()) {
          params.nickname = nickname.trim();
        }
        if (bizType) {
          params.bizType = bizType;
        }

        const result = await gmQueryLedger(params);
        if (result.success && result.data) {
          setRecords(result.data.records);
          setTotal(result.data.total);
          setPage(result.data.page);
        } else {
          message.error(result.message ?? '查询流水失败');
        }
      } catch {
        message.error('查询流水失败');
      } finally {
        setLoading(false);
        dedup.complete(key);
      }
    })();
    dedup.start(key, promise);
    return promise;
  }, [characterId, nickname, bizType, message]);

  const handleSearch = () => {
    void fetchLedger(1);
  };

  const handleReset = () => {
    setCharacterId('');
    setNickname('');
    setBizType(undefined);
    void fetchLedger(1);
  };

  const columns: ColumnsType<LedgerRecordDto> = [
    {
      title: '角色ID',
      dataIndex: 'characterId',
      key: 'characterId',
      width: 90,
      render: (id: number) => <span style={{ fontFamily: 'monospace' }}>{id}</span>,
    },
    {
      title: '角色昵称',
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (ts: number) => {
        const d = new Date(ts * 1000);
        return d.toLocaleString('zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      },
    },
    {
      title: '业务类型',
      dataIndex: 'bizType',
      key: 'bizType',
      width: 120,
      render: (bizTypeVal: string) => {
        const label = LEDGER_BIZ_TYPE_LABELS[bizTypeVal] ?? bizTypeVal;
        return <Tag>{label}</Tag>;
      },
    },
    {
      title: '变动金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 140,
      align: 'right',
      render: (amount: number) => {
        const color = amount > 0 ? '#52c41a' : amount < 0 ? '#ff4d4f' : undefined;
        const sign = amount > 0 ? '+' : '';
        return <span style={{ color, fontWeight: 600 }}>{sign}{amount.toLocaleString()}</span>;
      },
    },
    {
      title: '变动后余额',
      dataIndex: 'balanceAfter',
      key: 'balanceAfter',
      width: 140,
      align: 'right',
      render: (balance: number) => balance.toLocaleString(),
    },
    {
      title: '对手方',
      dataIndex: 'counterparty',
      key: 'counterparty',
      width: 140,
      render: (cp: number | null, record: LedgerRecordDto) => {
        if (cp == null) return '-';
        return `${record.counterpartyNickname ?? '?'}(#${cp})`;
      },
    },
    {
      title: '备注',
      dataIndex: 'memo',
      key: 'memo',
      ellipsis: true,
      render: (memo: string | null) => memo ?? '-',
    },
  ];

  const locale = {
    emptyText: (
      <Empty
        description="没有找到符合条件的流水"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    ),
  };

  return (
    <Card title="GM流水账查询" size="small">
      <Flex vertical gap={16}>
        {/* 过滤条件 */}
        <Flex gap={12} wrap="wrap" align="flex-end">
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>角色ID</span>
            <Input
              style={{ width: 120 }}
              size="small"
              placeholder="输入角色ID"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Flex>
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>昵称</span>
            <Input
              style={{ width: 140 }}
              size="small"
              placeholder="模糊搜索昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Flex>
          <Flex vertical>
            <span style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>业务类型</span>
            <Select
              style={{ width: 140 }}
              size="small"
              placeholder="全部类型"
              value={bizType}
              allowClear
              options={BIZ_TYPE_OPTIONS}
              onChange={(v) => setBizType(v)}
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

        {/* 数据表格 */}
        <Spin spinning={loading}>
          <Table<LedgerRecordDto>
            columns={columns}
            dataSource={records}
            rowKey="id"
            size="small"
            locale={locale}
            pagination={false}
            scroll={{ x: 1000 }}
          />
        </Spin>

        {/* 分页 */}
        {total > pageSize && (
          <Flex justify="center">
            <Pagination
              size="small"
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger={false}
              showTotal={(t) => `共 ${t} 条`}
              onChange={(p) => void fetchLedger(p)}
            />
          </Flex>
        )}
      </Flex>
    </Card>
  );
};

export default GmLedgerViewer;
