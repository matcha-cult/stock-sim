/**
 * 刮刮乐主组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示当天 3 张刮刮乐票——刮格子、外圈选线、开奖结算。
 *    - 使用 useScratch hook 获取数据。
 *    - 每张票独立渲染网格 + 外圈标签。
 *    - 刮满后可选择线并点击"开奖"。
 * 2. 不做什么：不决定中奖规则（后端决定）、不管理全局状态。
 *
 * 输入 / 输出：
 * - 输入：无（自动从 useScratch 获取数据）。
 * - 输出：刮刮乐完整界面。
 *
 * 数据流 / 状态流：
 * useScratch 提供概览数据 -> 用户点击格子刮票 -> 用户点击外圈标签选线 -> 用户点击开奖 -> 后端结算 -> 刷新概览。
 *
 * 复用设计说明：
 * - API 层复用 services/api/scratch.ts。
 * - 状态管理复用 hooks/useScratch.ts。
 * - 线定义逻辑（buildLines）与服务端一致。
 *
 * 关键边界条件与坑点：
 * 1. 格子索引按行优先排列：[0][1][2]...
 * 2. 位标记 scratchedMask：第 i 位为 1 表示第 i 格已刮。
 * 3. 已开奖的票不可再刮或改选线。
 * 4. 必须刮满 maxScratchCount 且已选线才能开奖。
 * 5. 网格边长 N = sqrt(gridSize)，线数 = 2N + 2。
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Button, Card, Descriptions, Empty, Flex, Space, Spin, Tag, Result, Typography, Modal, Table, Collapse } from 'antd';
import { ReloadOutlined, CheckOutlined, ArrowDownOutlined, ArrowRightOutlined, BookOutlined } from '@ant-design/icons';
import { useScratch } from '../hooks/useScratch';
import type { ScratchTicketDto, ScratchSettleResultDto, ScratchConfigDto } from '../services/api/scratch';

const { Text } = Typography;

// ========== 线定义（与服务端 buildLines 一致） ==========

interface LineDef {
  key: string;
  name: string;
  indices: number[];
}

const buildLines = (gridSize: number): LineDef[] => {
  const N = Math.round(Math.sqrt(gridSize));
  if (N * N !== gridSize) throw new Error(`gridSize ${gridSize} 不是完全平方数`);

  const lines: LineDef[] = [];

  for (let r = 0; r < N; r++) {
    const indices = Array.from({ length: N }, (_, c) => r * N + c);
    lines.push({ key: `row_${r}`, name: `第 ${r + 1} 行`, indices });
  }

  for (let c = 0; c < N; c++) {
    const indices = Array.from({ length: N }, (_, r) => r * N + c);
    lines.push({ key: `col_${c}`, name: `第 ${c + 1} 列`, indices });
  }

  const diag0: number[] = [];
  const diag1: number[] = [];
  for (let i = 0; i < N; i++) {
    diag0.push(i * N + i);
    diag1.push(i * N + (N - 1 - i));
  }
  lines.push({ key: 'diag_0', name: '主对角线 ↘', indices: diag0 });
  lines.push({ key: 'diag_1', name: '副对角线 ↙', indices: diag1 });

  return lines;
};

// ========== 工具函数 ==========

const formatSpiritStones = (value: number): string => {
  if (value >= 1_0000) return `${(value / 1_0000).toFixed(1)}万`;
  return value.toLocaleString();
};

const TICKET_CONFIGS: Record<string, { label: string; desc: string }> = {
  '3x3': { label: '九宫格', desc: '3×3' },
  '4x4': { label: '十六格', desc: '4×4' },
  '5x5': { label: '二十五格', desc: '5×5' },
};

// ========== 主组件 ==========

export default function ScratchCardPage(): React.ReactNode {
  const { overview, config, loading, cellLoading, settleLoading, refreshOverview, scratchCell, settleTicket, advanceToNextTicket } = useScratch();
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScratchSettleResultDto | null>(null);
  const [selectedTicketNumber, setSelectedTicketNumber] = useState<number | null>(null);
  const [rulesVisible, setRulesVisible] = useState(false);

  // 当前票：优先使用用户手动选择的票号，否则自动选当前可操作票
  const currentTicket = useMemo(() => {
    if (!overview?.tickets.length) return null;
    const manual = selectedTicketNumber;
    if (manual != null) {
      const found = overview.tickets.find(t => t.ticketNumber === manual);
      if (found) return found;
    }
    const currentNumber = overview.currentTicketNumber;
    return overview.tickets.find(t => t.ticketNumber === currentNumber)
      ?? overview.tickets.find(t => !t.settled)
      ?? overview.tickets[0]
      ?? null;
  }, [overview, selectedTicketNumber]);

  // 当前票的线定义
  const lines = useMemo(() => {
    if (!currentTicket) return [];
    return buildLines(currentTicket.gridSize);
  }, [currentTicket]);

  // 已开奖的票不需要选线状态
  useEffect(() => {
    if (currentTicket?.settled) {
      setSelectedLine(null);
    }
  }, [currentTicket]);

  // 格子点击
  const handleCellClick = useCallback(async (cellIndex: number) => {
    if (!currentTicket || currentTicket.settled) return;

    const ticket = currentTicket;
    if (ticket.settled) return;
    if ((ticket.scratchedMask & (1 << cellIndex)) !== 0) return; // 已刮
    if (ticket.scratchCount >= ticket.maxScratchCount) return; // 已刮满
    if (cellLoading) return; // 正在刮

    await scratchCell(ticket.ticketNumber, cellIndex);
  }, [currentTicket, cellLoading, scratchCell]);

  // 选线
  const handleLineSelect = useCallback((lineKey: string) => {
    setSelectedLine(prev => prev === lineKey ? null : lineKey);
  }, []);

  // 开奖
  const handleSettle = useCallback(async () => {
    if (!currentTicket || !selectedLine) return;
    if (currentTicket.scratchCount < currentTicket.maxScratchCount) return;

    const ticket = currentTicket;
    const lineKey = selectedLine;
    const result = await settleTicket(ticket.ticketNumber, lineKey);
    if (result) {
      setLastResult(result);
      // 保留 selectedLine 高亮显示玩家选择的线
    }
  }, [currentTicket, selectedLine, settleTicket]);

  // 显示选线：未开奖用组件状态，已开奖用后端返回的 selectedLine
  const displaySelectedLine = currentTicket?.settled ? (currentTicket.selectedLine ?? null) : selectedLine;

  // 已选线的和值统计（未刮开的格子按 0 计算）
  const lineSumDetail = useMemo(() => {
    if (!displaySelectedLine || !currentTicket) return null;
    const lineDef = lines.find(l => l.key === displaySelectedLine);
    if (!lineDef) return null;

    const items: { index: number; value: number; revealed: boolean }[] = lineDef.indices.map(idx => {
      const isRevealed = (currentTicket.scratchedMask & (1 << idx)) !== 0;
      return {
        index: idx,
        value: isRevealed ? (currentTicket.revealedValues[idx] ?? 0) : 0,
        revealed: isRevealed,
      };
    });
    const total = items.reduce((sum, item) => sum + item.value, 0);
    return { items, total, lineName: lineDef.name };
  }, [displaySelectedLine, currentTicket, lines]);

  // 所有 hooks / 计算必须在 early return 之前
  const cellSize = 48;
  const gap = 4;

  const isScratchFull = (currentTicket?.scratchCount ?? 0) >= (currentTicket?.maxScratchCount ?? 0);
  const canSettle = isScratchFull && selectedLine !== null && !(currentTicket?.settled);

  if (!overview || !overview.tickets.length) {
    return (
      <Card style={{ maxWidth: 600, margin: '0 auto' }}>
        <Empty description="暂无刮刮乐数据" />
      </Card>
    );
  }

  if (loading || !currentTicket) {
    return (
      <Card style={{ maxWidth: 600, margin: '0 auto' }}>
        <Flex justify="center" style={{ padding: '40px 0' }}>
          <Spin size="large" />
        </Flex>
      </Card>
    );
  }

  return (
    <Card
      title="刮刮乐"
      extra={
        <Flex gap={8}>
          <Button
            icon={<BookOutlined />}
            size="small"
            onClick={() => setRulesVisible(true)}
          >
            规则
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void refreshOverview()}
            size="small"
          >
            刷新
          </Button>
        </Flex>
      }
      style={{ maxWidth: 600, margin: '0 auto' }}
    >
      <Flex vertical gap={20}>
        {/* 全部已开奖提示 */}
        {overview.allSettled && (
          <Tag color="success">今天 {overview.totalCount} 张票已全部开奖完成</Tag>
        )}

        {/* 票切换 */}
        <Space wrap>
          {overview.tickets.map(t => {
            const config = TICKET_CONFIGS[t.configKey] ?? { label: `票${t.ticketNumber}`, desc: '' };
            return (
              <Button
                key={t.ticketNumber}
                type={t.ticketNumber === currentTicket.ticketNumber ? 'primary' : 'default'}
                size="small"
                onClick={() => setSelectedTicketNumber(t.ticketNumber)}
                icon={t.settled ? <CheckOutlined /> : undefined}
              >
                第{t.ticketNumber}张 {config.desc}
              </Button>
            );
          })}
        </Space>

        {/* 当前票信息 */}
        <Flex gap={8} wrap="wrap" align="center">
          <Text strong>
            第 {currentTicket.ticketNumber} 张
          </Text>
          <Tag color="blue">{TICKET_CONFIGS[currentTicket.configKey]?.desc}</Tag>
          <Tag>
            已刮 {currentTicket.scratchCount}/{currentTicket.maxScratchCount}
          </Tag>
          {currentTicket.settled && (
            <Tag color="success">已开奖</Tag>
          )}
        </Flex>

        {/* 已选线和值计算过程 */}
        {lineSumDetail && !currentTicket.settled && (
          <Card size="small" type="inner">
            <Flex vertical gap={6}>
              <Text type="secondary" style={{ fontSize: 12 }}>{lineSumDetail.lineName} 和值计算：</Text>
              <Flex gap={4} wrap="wrap" align="center">
                {lineSumDetail.items.map((item, idx) => (
                  <span key={item.index}>
                    <Tag
                      color={item.revealed ? 'blue' : 'default'}
                      style={{
                        opacity: item.revealed ? 1 : 0.45,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {item.revealed ? item.value : 0}
                    </Tag>
                    {idx < lineSumDetail.items.length - 1 && (
                      <Text type="secondary" style={{ margin: '0 2px' }}>+</Text>
                    )}
                  </span>
                ))}
                <Text type="secondary" style={{ margin: '0 6px' }}>=</Text>
                <Text strong style={{ color: '#1890ff', fontSize: 16 }}>{lineSumDetail.total}</Text>
              </Flex>
            </Flex>
          </Card>
        )}

        {/* 刮票网格 + 外圈选线 */}
        <Flex justify="center">
          <ScratchGrid
            ticket={currentTicket}
            lines={lines}
            selectedLine={displaySelectedLine}
            cellLoading={cellLoading}
            cellSize={cellSize}
            gap={gap}
            onCellClick={handleCellClick}
            onLineSelect={handleLineSelect}
          />
        </Flex>

        {/* 操作按钮 */}
        <Flex gap={8} justify="center" wrap="wrap">
          <Button
            type="primary"
            icon={<CheckOutlined />}
            disabled={!canSettle}
            loading={settleLoading}
            onClick={handleSettle}
            size="large"
          >
            开奖
          </Button>
          {lastResult && (
            <Button
              type="default"
              onClick={() => {
                setSelectedLine(null);
                setSelectedTicketNumber(null);
                setLastResult(null);
                advanceToNextTicket();
              }}
              size="large"
            >
              {lastResult.nextTicketNumber ? '刮下一张' : '刷新'}
            </Button>
          )}
        </Flex>

        {/* 开奖结果（inline 显示在按钮下方） */}
        {lastResult && (
          <Result
            status={lastResult.tierKey !== 'none' ? 'success' : 'info'}
            title={lastResult.tierName}
            subTitle={lastResult.tierKey !== 'none'
              ? `获得 ${formatSpiritStones(lastResult.prize)} 灵石`
              : '很遗憾，未中奖'}
          />
        )}

        {/* 已开奖票信息 */}
        {currentTicket.settled && !lastResult && (
          <Card size="small" type="inner">
            <Descriptions
              items={[
                { label: '线和值', children: currentTicket.lineSum },
                { label: '奖级', children: currentTicket.prizeTierName ?? '未中奖' },
                { label: '奖金', children: currentTicket.prizeAmount != null ? `${formatSpiritStones(currentTicket.prizeAmount)} 灵石` : '-' },
              ]}
              column={3}
              size="small"
            />
          </Card>
        )}

        {/* 当前票开奖规则 */}
        <TicketRulesSection currentTicket={currentTicket} config={config} />

      </Flex>

      {/* 开奖规则弹窗 */}
      <Modal
        title="开奖规则"
        open={rulesVisible}
        onCancel={() => setRulesVisible(false)}
        footer={<Button type="primary" onClick={() => setRulesVisible(false)}>知道了</Button>}
        width={560}
      >
        <RulesModalContent config={config} />
      </Modal>
    </Card>
  );
}

// ========== 子组件 ==========

/**
 * 当前票的开奖规则（内联显示在卡片最下方）。
 * 只显示当前选中票的规则，包含：奖级表格 + 可选线列表。
 */
function TicketRulesSection({
  currentTicket,
  config,
}: {
  currentTicket: ScratchTicketDto | null;
  config: ScratchConfigDto[] | null;
}): React.ReactNode {
  if (!currentTicket || !config?.length) return null;

  const currentConfig = config.find(c => c.ticketNumber === currentTicket.ticketNumber);
  if (!currentConfig) return null;

  const tierColumns = [
    { title: '奖级', dataIndex: 'tierName' as const, key: 'tierName', width: 80 },
    {
      title: '线和值',
      key: 'sumRange' as const,
      render: (_: unknown, record: { sumMin: number; sumMax: number }) =>
        record.sumMin === record.sumMax ? `${record.sumMin}` : `${record.sumMin}~${record.sumMax}`,
    },
    {
      title: '奖金',
      dataIndex: 'prizeAmount' as const,
      key: 'prizeAmount' as const,
      render: (v: number) => formatSpiritStones(v),
    },
  ];

  return (
    <Card size="small" type="inner" title="开奖规则">
      <Flex vertical gap={8}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {currentConfig.description}（{currentConfig.gridSize} 格），
          最多刮 {currentConfig.maxScratchCount} 格，刮满后可选线开奖。
        </Text>
        <Table
          size="small"
          columns={tierColumns}
          dataSource={currentConfig.prizeTiers}
          rowKey="tierKey"
          pagination={false}
        />
        <Text type="secondary" style={{ fontSize: 13 }}>
          可选线：{currentConfig.lines.map(l => l.name).join('、')}
        </Text>
      </Flex>
    </Card>
  );
}

/**
 * 开奖规则弹窗内容。
 * 按票据类型展示：票名 + 网格规格 + 奖级表格 + 可选线。
 */
function RulesModalContent({ config }: { config: ScratchConfigDto[] | null }): React.ReactNode {
  if (!config?.length) {
    return <Empty description="规则加载中" />;
  }

  return (
    <Collapse
      items={config.map(cfg => {
        const ticketConfig = TICKET_CONFIGS[cfg.configKey] ?? { label: `票${cfg.ticketNumber}`, desc: '' };
        const tierColumns = [
          { title: '奖级', dataIndex: 'tierName', key: 'tierName', width: 80 },
          {
            title: '线和值',
            key: 'sumRange',
            width: 100,
            render: (_: unknown, record: { sumMin: number; sumMax: number }) =>
              record.sumMin === record.sumMax ? `${record.sumMin}` : `${record.sumMin}~${record.sumMax}`,
          },
          {
            title: '奖金',
            dataIndex: 'prizeAmount',
            key: 'prizeAmount',
            width: 90,
            render: (v: number) => formatSpiritStones(v),
          },
        ];
        const lineNames = cfg.lines.map(l => l.name).join('、');

        return {
          key: cfg.ticketNumber,
          label: (
            <Flex gap={8} align="center">
              <Tag color="blue">第{cfg.ticketNumber}张</Tag>
              <span>{ticketConfig.desc}</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {cfg.maxScratchCount} 格
              </Text>
            </Flex>
          ),
          children: (
            <Flex vertical gap={12} style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <Text type="secondary">规格：</Text>
                {cfg.description}（{cfg.gridSize} 格），最多刮 {cfg.maxScratchCount} 格，刮满后可选线开奖。
              </div>
              <Table
                size="small"
                columns={tierColumns}
                dataSource={cfg.prizeTiers}
                rowKey="tierKey"
                pagination={false}
                style={{ fontSize: 13 }}
              />
              <div style={{ fontSize: 13 }}>
                <Text type="secondary">可选线：</Text>
                {lineNames}
              </div>
            </Flex>
          ),
        };
      })}
    />
  );
}

interface ScratchGridProps {
  ticket: ScratchTicketDto;
  lines: LineDef[];
  selectedLine: string | null;
  cellLoading: boolean;
  cellSize: number;
  gap: number;
  onCellClick: (cellIndex: number) => void;
  onLineSelect: (lineKey: string) => void;
}

function ScratchGrid({
  ticket,
  lines,
  selectedLine,
  cellLoading,
  cellSize,
  gap,
  onCellClick,
  onLineSelect,
}: ScratchGridProps): React.ReactNode {
  const N = Math.round(Math.sqrt(ticket.gridSize));

  // 线索引映射
  const selectedLineIndices = useMemo(() => {
    if (!selectedLine) return new Set<number>();
    const lineDef = lines.find(l => l.key === selectedLine);
    return new Set(lineDef?.indices ?? []);
  }, [selectedLine, lines]);

  // 顶部标签：↘(ArrowDownOutlined rotate 315°) | ↓(ArrowDownOutlined) × N | ↙(ArrowDownOutlined rotate 45°)
  const topLabels = useMemo(() => {
    const labels: { key: string; label: React.ReactNode; lineKey: string }[] = [];
    labels.push({ key: 'diag_0', label: <ArrowDownOutlined rotate={315} />, lineKey: 'diag_0' });
    for (let c = 0; c < N; c++) {
      labels.push({ key: `col_${c}`, label: <ArrowDownOutlined />, lineKey: `col_${c}` });
    }
    labels.push({ key: 'diag_1', label: <ArrowDownOutlined rotate={45} />, lineKey: 'diag_1' });
    return labels;
  }, [N]);

  // 左侧标签：→（用 antd 图标）
  const leftLabels = useMemo(() => {
    return Array.from({ length: N }, (_, r) => ({
      key: `row_${r}`,
      label: <ArrowRightOutlined />,
      lineKey: `row_${r}`,
    }));
  }, [N]);

  // 格子网格
  const cells = useMemo(() => {
    const result: React.ReactNode[] = [];
    for (let i = 0; i < ticket.gridSize; i++) {
      const row = Math.floor(i / N);
      const col = i % N;
      const isRevealed = (ticket.scratchedMask & (1 << i)) !== 0;
      const isSelected = selectedLineIndices.has(i);
      const isSettled = ticket.settled;

      // 已开奖或已刮的格子显示值，未刮格子共享 cellLoading loading 状态
      const displayValue = (isSettled || isRevealed) ? ticket.revealedValues[i] : (cellLoading ? <Spin size="small" /> : '?');

      // 未刮格子：灰色边框 + 灰色背景；已刮格子：主色 30% 背景；选线格子：主色边框
      const cellBorder = isSelected ? '2px solid #1890ff' : '1px solid var(--border-color-soft)';
      const cellBg = (isSettled || isRevealed) ? 'rgba(24, 144, 255, 0.1)' : 'var(--fill-button-default)';

      result.push(
        <div
          key={i}
          data-testid={`cell-${i}`}
          data-element="cell"
          data-cell-index={i}
          data-row={row}
          data-col={col}
          data-revealed={isRevealed ? 'true' : 'false'}
          style={{
            gridColumn: col + 2,
            gridRow: row + 2,
            width: cellSize,
            height: cellSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: cellBorder,
            borderRadius: 6,
            background: cellBg,
            cursor: !isSettled && !isRevealed && ticket.scratchCount < ticket.maxScratchCount ? 'pointer' : 'default',
            fontSize: isSettled || isRevealed ? 16 : 18,
            fontWeight: isSettled || isRevealed ? 600 : 400,
            color: isSettled || isRevealed ? 'var(--text-primary)' : 'var(--text-tertiary)',
            userSelect: 'none',
            transition: 'all 0.15s ease',
          }}
          onClick={() => {
            if (!isSettled && !isRevealed && ticket.scratchCount < ticket.maxScratchCount) {
              onCellClick(i);
            }
          }}
        >
          {displayValue}
        </div>,
      );
    }
    return result;
  }, [ticket, selectedLineIndices, cellLoading, cellSize, N, onCellClick]);

  // 右侧操作列：所有行都渲染空占位 div，不显示任何内容
  const rightIndicators = useMemo(() => {
    return Array.from({ length: N }, (_, r) => (
      <div
        key={`right_${r}`}
        data-testid={`right-label-row_${r}`}
        data-element="right-label"
        style={{
          gridColumn: N + 2,
          gridRow: r + 2,
          width: 48,
          height: 48,
        }}
      />
    ));
  }, [N]);

  // 左侧标签（48×48 圆形按钮，默认灰色背景+线框，选中主色线框）
  const leftLabelElements = useMemo(() => {
    return leftLabels.map(({ key, label, lineKey }) => {
      const isActive = selectedLine === lineKey;
      const row = parseInt(key.split('_')[1]);
      return (
        <div
          key={key}
          data-testid={`left-label-${lineKey}`}
          data-element="left-label"
          data-line-key={lineKey}
          style={{
            gridColumn: 1,
            gridRow: row + 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            cursor: 'pointer',
            color: isActive ? '#1890ff' : 'var(--text-secondary)',
            borderRadius: '50%',
            border: isActive ? '2px solid #1890ff' : '1px solid var(--border-secondary)',
            background: isActive ? 'rgba(24, 144, 255, 0.08)' : 'var(--fill-button-default)',
            userSelect: 'none',
            transition: 'all 0.15s ease',
          }}
          onClick={() => onLineSelect(lineKey)}
        >
          {label}
        </div>
      );
    });
  }, [leftLabels, selectedLine, cellSize, onLineSelect]);

  // 顶部标签（48×48 圆形按钮，未选中灰色线框，选中主色线框）
  const correctedTopLabels = useMemo(() => {
    return topLabels.map(({ key, label, lineKey }, idx) => {
      const isActive = selectedLine === lineKey;
      let colStart: number;
      if (key === 'diag_0') colStart = 1;
      else if (key === 'diag_1') colStart = N + 2;
      else colStart = idx + 1;

      return (
        <div
          key={key}
          data-testid={`top-label-${key}`}
          data-element="top-label"
          data-line-key={lineKey}
          style={{
            gridColumn: colStart,
            gridRow: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            cursor: 'pointer',
            color: isActive ? '#1890ff' : 'var(--text-secondary)',
            borderRadius: '50%',
            border: isActive ? '2px solid #1890ff' : '1px solid var(--border-secondary)',
            background: isActive ? 'rgba(24, 144, 255, 0.08)' : 'var(--fill-button-default)',
            userSelect: 'none',
            transition: 'all 0.15s ease',
          }}
          onClick={() => onLineSelect(lineKey)}
        >
          {label}
        </div>
      );
    });
  }, [topLabels, selectedLine, cellSize, N, onLineSelect]);

  // 网格列数 = 左侧标签列(1) + N个格子列 + 右侧操作列(1)

  return (
    <div
      data-testid="scratch-grid-container"
      data-grid-size={ticket.gridSize}
      data-grid-n={N}
      style={{
      display: 'inline-grid',
      gridTemplateColumns: `48px repeat(${N}, ${cellSize}px) 48px`,
      gridTemplateRows: `48px repeat(${N}, ${cellSize}px)`,
      gap: `${gap}px`,
      alignItems: 'center',
      justifyItems: 'center',
      padding: 12,
      background: 'var(--fill-quaternary)',
      borderRadius: 12,
      border: '1px solid var(--border-secondary)',
    }}>
      {/* 顶部标签 */}
      {correctedTopLabels}
      {/* 左侧标签 */}
      {leftLabelElements}
      {/* 格子 */}
      {cells}
      {/* 右侧操作列 */}
      {rightIndicators}
    </div>
  );
}
