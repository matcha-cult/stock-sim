/**
 * 挂机历史记录组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示挂机历史记录列表，支持分页
 * 2. 不做什么：不处理挂机逻辑（由父组件负责）
 *
 * 数据流 / 状态流：
 * 组件加载 -> 请求历史数据 -> 展示列表 -> 分页加载
 *
 * 关键边界条件与坑点：
 * 1. 空列表时显示空状态
 * 2. 时间格式化使用用户本地时区
 */

import { useState, useEffect } from 'react';
import { Table, Tag, Typography, Flex, Button, Empty, Modal, Spin, Space } from 'antd';
import { HistoryOutlined, ReloadOutlined, EyeOutlined, GiftOutlined } from '@ant-design/icons';
import {
  getIdleHistory,
  getIdleBattleLogs,
  getIdleBattleLogDetail,
  getDropLogsByHistoryId,
  type IdleHistoryRecord,
  type IdleBattleLog,
  type IdleBattleLogDetail,
  type DropLogSummary,
} from '../../services/api/demonCave';

const { Text, Title } = Typography;

interface BattleLogsModalProps {
  open: boolean;
  historyId: number | null;
  onClose: () => void;
}

interface BattleDetailModalProps {
  open: boolean;
  battleLogId: number | null;
  onClose: () => void;
}

interface DropLogsModalProps {
  open: boolean;
  historyId: number | null;
  onClose: () => void;
}

function DropLogsModal({ open, historyId, onClose }: DropLogsModalProps) {
  const [loading, setLoading] = useState(false);
  const [drops, setDrops] = useState<DropLogSummary[]>([]);

  useEffect(() => {
    if (open && historyId) {
      const loadDrops = async () => {
        setLoading(true);
        setDrops([]);
        try {
          const res = await getDropLogsByHistoryId(historyId);
          if (res.success) {
            setDrops(res.data);
          }
        } catch (error) {
          console.error('加载掉落记录失败', error);
        } finally {
          setLoading(false);
        }
      };
      loadDrops();
    }
  }, [open, historyId]);

  if (!open) return null;

  // 物品名称映射（可从配置加载，这里先用 itemKey）
  const getItemName = (itemKey: string) => {
    const nameMap: Record<string, string> = {
      'tier-up-pill': '升阶丹',
      'material_hundun_jinghua': '混沌精华',
      'material_kunlun_yusui': '昆仑玉髓',
      'material_jiuwei_huohu': '九尾火狐',
      'material_taixu_zhi_lei': '太虚之蕾',
      'material_fenghuang_yu': '凤凰羽',
    };
    return nameMap[itemKey] || itemKey;
  };

  // 物品稀有度颜色
  const getItemColor = (itemKey: string) => {
    if (itemKey.includes('tier-up-pill')) return 'gold';
    if (itemKey.includes('legendary') || itemKey.includes('fenghuang') || itemKey.includes('taixu')) return 'purple';
    return 'blue';
  };

  return (
    <Modal
      title="掉落汇总"
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      {loading ? (
        <Flex justify="center" align="center" style={{ minHeight: 200 }}>
          <Spin size="large" />
        </Flex>
      ) : drops.length > 0 ? (
        <Flex vertical gap="small">
          {drops.map((drop) => (
            <Flex key={drop.itemKey} justify="space-between" align="center" style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <Space>
                <Tag color={getItemColor(drop.itemKey)}>{getItemName(drop.itemKey)}</Tag>
              </Space>
              <Text strong style={{ color: '#52c41a' }}>×{drop.totalQuantity}</Text>
            </Flex>
          ))}
          <Flex justify="flex-end" style={{ marginTop: 16 }}>
            <Text type="secondary">共 {drops.length} 种物品</Text>
          </Flex>
        </Flex>
      ) : (
        <Empty description="本次挂机无掉落" />
      )}
    </Modal>
  );
}

function BattleDetailModal({ open, battleLogId, onClose }: BattleDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<IdleBattleLogDetail | null>(null);

  useEffect(() => {
    if (open && battleLogId) {
      const loadDetail = async () => {
        setLoading(true);
        setDetail(null);
        try {
          const res = await getIdleBattleLogDetail(battleLogId);
          if (res.success) {
            setDetail(res.data);
          }
        } catch (error) {
          console.error('加载战斗详情失败', error);
        } finally {
          setLoading(false);
        }
      };
      loadDetail();
    }
  }, [open, battleLogId]);

  if (!open) return null;

  const resultColor = {
    victory: 'green',
    defeat: 'red',
    timeout: 'orange',
  };

  const resultText = {
    victory: '胜利',
    defeat: '失败',
    timeout: '超时',
  };

  const actionColor = (action: string, isCrit?: boolean, isParry?: boolean) => {
    if (isCrit) return '#ff4d4f';
    if (isParry) return '#faad14';
    if (action === 'miss') return '#8c8c8c';
    return '#1890ff';
  };

  return (
    <Modal
      title={detail ? `第 ${detail.battleIndex} 场战斗详情` : '战斗详情'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
    >
      {loading ? (
        <Flex justify="center" align="center" style={{ minHeight: 300 }}>
          <Spin size="large" />
        </Flex>
      ) : detail ? (
        <Flex vertical gap="middle">
          <Flex gap="small" align="center">
            <Text strong>结果：</Text>
            <Tag color={resultColor[detail.result]}>{resultText[detail.result]}</Tag>
            <Text strong>回合数：</Text>
            <Text>{detail.rounds}</Text>
            <Text strong>经验：</Text>
            <Text strong style={{ color: '#52c41a' }}>
              {detail.experience === '0' ? '-' : `+${detail.experience}`}
            </Text>
          </Flex>

          {detail.battleLogs && detail.battleLogs.length > 0 ? (
            <Flex vertical gap="small" style={{ maxHeight: 500, overflowY: 'auto' }}>
              {detail.battleLogs.map((log, idx) => (
                <Text
                  key={idx}
                  style={{
                    color: actionColor(log.action, log.isCrit, log.isParry),
                    fontWeight: log.isCrit ? 'bold' : 'normal',
                  }}
                >
                  [第 {log.round} 回合] {log.message}
                  {log.isElementBonus && (
                    <Tag color="purple" style={{ marginLeft: 8 }}>
                      五行克制
                    </Tag>
                  )}
                </Text>
              ))}
            </Flex>
          ) : (
            <Empty description="无详细战斗日志" />
          )}
        </Flex>
      ) : (
        <Empty description="加载失败" />
      )}
    </Modal>
  );
}

function BattleLogsModal({ open, historyId, onClose }: BattleLogsModalProps) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<IdleBattleLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedBattleLogId, setSelectedBattleLogId] = useState<number | null>(null);
  const pageSize = 20;

  useEffect(() => {
    if (open && historyId) {
      loadLogs(historyId, 1);
    }
  }, [open, historyId]);

  const loadLogs = async (id: number, currentPage: number = 1) => {
    setLoading(true);
    try {
      const offset = (currentPage - 1) * pageSize;
      const res = await getIdleBattleLogs(id, pageSize, offset);
      if (res.success) {
        setLogs(res.data.logs);
        setTotal(res.data.total);
        setPage(currentPage);
      }
    } catch (error) {
      console.error('加载战斗日志失败', error);
    } finally {
      setLoading(false);
    }
  };

  const resultColor = {
    victory: 'green',
    defeat: 'red',
    timeout: 'orange',
  };

  const resultText = {
    victory: '胜利',
    defeat: '失败',
    timeout: '超时',
  };

  return (
    <>
      <Modal
        title="战斗详情"
        open={open}
        onCancel={onClose}
        footer={null}
        width={900}
      >
        {loading ? (
          <Flex justify="center" align="center" style={{ minHeight: 300 }}>
            <Spin size="large" />
          </Flex>
        ) : (
          <Table
            columns={[
              {
                title: '场次',
                dataIndex: 'battleIndex',
                key: 'battleIndex',
                width: 80,
                render: (index: number) => <Text strong>第 {index} 场</Text>,
              },
              {
                title: '结果',
                dataIndex: 'result',
                key: 'result',
                width: 100,
                render: (result: 'victory' | 'defeat' | 'timeout') => (
                  <Tag color={resultColor[result]}>{resultText[result]}</Tag>
                ),
              },
              {
                title: '回合数',
                dataIndex: 'rounds',
                key: 'rounds',
                width: 100,
                render: (rounds: number) => <Text>{rounds} 回合</Text>,
              },
              {
                title: '经验',
                dataIndex: 'experience',
                key: 'experience',
                width: 120,
                render: (exp: string) => (
                  <Text strong style={{ color: '#52c41a' }}>
                    {exp === '0' ? '-' : `+${exp}`}
                  </Text>
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_: unknown, record: IdleBattleLog) => (
                  <Button
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => {
                      setSelectedBattleLogId(record.id);
                      setDetailModalOpen(true);
                    }}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
            dataSource={logs}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (newPage) => {
                if (historyId) {
                  loadLogs(historyId, newPage);
                }
              },
              showTotal: (total) => `共 ${total} 场战斗`,
            }}
            size="small"
          />
        )}
      </Modal>

      <BattleDetailModal
        open={detailModalOpen}
        battleLogId={selectedBattleLogId}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedBattleLogId(null);
        }}
      />
    </>
  );
}

export default function IdleHistory() {
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<IdleHistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [dropModalOpen, setDropModalOpen] = useState(false);
  const [selectedDropHistoryId, setSelectedDropHistoryId] = useState<number | null>(null);
  const pageSize = 10;

  const loadData = async (currentPage: number = 1) => {
    setLoading(true);
    try {
      const offset = (currentPage - 1) * pageSize;
      const res = await getIdleHistory(pageSize, offset);
      if (res.success) {
        setHistory(res.data.history);
        setTotal(res.data.total);
        setPage(currentPage);
      }
    } catch (error) {
      console.error('加载挂机历史失败', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const columns = [
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status: 'active' | 'completed') => (
        <Tag color={status === 'active' ? 'blue' : 'default'}>
          {status === 'active' ? '进行中' : '已结束'}
        </Tag>
      ),
    },
    {
      title: '灵兽',
      dataIndex: 'beastNames',
      key: 'beastNames',
      width: 160,
      render: (names: string[]) => (
        <Space wrap size={[4, 4]}>
          {names.map((name) => (
            <Tag key={name} color="blue">{name}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '楼层',
      dataIndex: 'floor',
      key: 'floor',
      width: 80,
      render: (floor: number) => <Text strong>地下 {floor} 层</Text>,
    },
    {
      title: '时长',
      dataIndex: 'durationText',
      key: 'durationText',
      width: 120,
    },
    {
      title: '战斗',
      key: 'battles',
      width: 200,
      render: (_: unknown, record: IdleHistoryRecord) => (
        <Flex gap="small">
          {record.status === 'completed' ? (
            <>
              <Tag color="green">{record.victoryCount} 胜</Tag>
              <Tag color="red">{record.defeatCount} 负</Tag>
              {record.timeoutCount > 0 && <Tag color="orange">{record.timeoutCount} 超时</Tag>}
              <Text type="secondary">共 {record.totalBattles} 场</Text>
            </>
          ) : (
            <Text type="secondary">进行中...</Text>
          )}
        </Flex>
      ),
    },
    {
      title: '经验',
      dataIndex: 'totalExperience',
      key: 'totalExperience',
      width: 120,
      render: (exp: string) => (
        <Text strong style={{ color: '#52c41a' }}>
          {exp === '0' ? '-' : `+${exp}`}
        </Text>
      ),
    },
    {
      title: '时间',
      dataIndex: 'idleEndedAt',
      key: 'idleEndedAt',
      width: 180,
      render: (time: string | null, record: IdleHistoryRecord) => (
        <Text type="secondary">
          {time ? new Date(time).toLocaleString('zh-CN') : new Date(record.idleStartedAt).toLocaleString('zh-CN')}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, record: IdleHistoryRecord) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedHistoryId(record.id);
              setModalOpen(true);
            }}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<GiftOutlined />}
            onClick={() => {
              setSelectedDropHistoryId(record.id);
              setDropModalOpen(true);
            }}
          >
            掉落
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Flex vertical gap="middle">
      <Flex justify="space-between" align="center">
        <Title level={4} style={{ margin: 0 }}>
          <HistoryOutlined style={{ marginRight: 8 }} />
          挂机历史
        </Title>
        <Button icon={<ReloadOutlined />} onClick={() => loadData(page)} loading={loading}>
          刷新
        </Button>
      </Flex>

      <Table
        columns={columns}
        dataSource={history}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (newPage) => loadData(newPage),
          showTotal: (total) => `共 ${total} 条记录`,
        }}
        locale={{
          emptyText: <Empty description="暂无挂机记录" />,
        }}
      />

      <BattleLogsModal
        open={modalOpen}
        historyId={selectedHistoryId}
        onClose={() => {
          setModalOpen(false);
          setSelectedHistoryId(null);
        }}
      />

      <DropLogsModal
        open={dropModalOpen}
        historyId={selectedDropHistoryId}
        onClose={() => {
          setDropModalOpen(false);
          setSelectedDropHistoryId(null);
        }}
      />
    </Flex>
  );
}
