/**
 * 灵石流水账 Tab（玩家自查）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示当前角色的灵石流水记录，支持分页。
 * 2. 不做什么：不展示其他玩家的流水，不提供编辑/删除功能。
 *
 * 输入 / 输出：
 * - 输入：无（自行调用 API）。
 * - 输出：流水表格 + 分页器。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> getMyLedger() -> 渲染 Table -> 翻页 -> 重新请求。
 *
 * 关键边界条件与坑点：
 * 1. 金额颜色：正数为绿色，负数为红色。
 * 2. 时间使用相对时间展示（如"2小时前"），更易读。
 */

import { useEffect, useState, useCallback } from 'react';
import { App, Button, Card, Empty, Flex, Pagination, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { getMyLedger, LEDGER_BIZ_TYPE_LABELS, type LedgerRecordDto } from '../services/api/ledger';

const LedgerTab: React.FC = () => {
  const { message } = App.useApp();

  const [records, setRecords] = useState<LedgerRecordDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchLedger = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await getMyLedger({ page: p });
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
    }
  }, [message]);

  useEffect(() => {
    void fetchLedger(1);
  }, [fetchLedger]);

  const columns: ColumnsType<LedgerRecordDto> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
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
      render: (bizType: string) => {
        const label = LEDGER_BIZ_TYPE_LABELS[bizType] ?? bizType;
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
        description="暂无流水记录"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    ),
  };

  return (
    <Card
      size="small"
      title="灵石流水"
      extra={
        <Button
          type="default"
          size="small"
          icon={<ReloadOutlined spin={loading} />}
          onClick={() => void fetchLedger(page)}
        >
          刷新
        </Button>
      }
    >
      <Spin spinning={loading}>
        <Flex vertical gap={16}>
          <Table<LedgerRecordDto>
            columns={columns}
            dataSource={records}
            rowKey="id"
            size="small"
            locale={locale}
            pagination={false}
          />

          {total > pageSize && (
            <Flex justify="center">
              <Pagination
                size="small"
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger={false}
                onChange={(p) => void fetchLedger(p)}
              />
            </Flex>
          )}
        </Flex>
      </Spin>
    </Card>
  );
};

export default LedgerTab;
