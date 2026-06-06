/**
 * 刮刮乐卡片组件（支持多票 + 动态格子数）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：展示当天 3 张刮刮乐票，支持按顺序刮完一张再下一张。
 *    - 格子数由 ticket.gridSize 动态决定（CSS grid-template-columns）。
 *    - 展示进度："第 X 张票 (Y/3)"、"已完成 X/3 张"。
 *    - 3 张全刮完后显示开奖按钮。
 * 2. 不做什么：不处理中奖结算逻辑、不预加载完整答案。
 *
 * 输入 / 输出：
 * - 输入：通过 RootStoreContext 读取 scratchStore。
 * - 输出：刮刮乐交互界面。
 *
 * 数据流 / 状态流：
 * 组件挂载 -> refreshTicket -> 读取 currentTicket ->
 * 用户点击格子 -> scratchStore.scratchCell -> 更新 currentTicket ->
 * 当前票 completed -> 自动切到下一张 -> 3 张全完 -> 显示开奖。
 *
 * 复用设计说明：
 * - 所有 API 调用在 ScratchStore，组件只做 UI。
 * - 格子布局用 CSS grid-template-columns 动态适配 gridSize。
 * - 已刮格子的值来自后端返回，前端不预知。
 *
 * 关键边界条件与坑点：
 * 1. gridSize 可能不是完全平方数（如 12），grid 列数用 Math.ceil(sqrt) 计算。
 * 2. 刮开动画期间禁用该格子点击，isScratching 锁控制。
 * 3. 失败时恢复未刮状态，不提前显示答案。
 */
import { useEffect, useState, useCallback, useContext, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { App, Button, Card, Empty, Flex, Spin, Tag } from 'antd';
import { ReloadOutlined, TrophyOutlined } from '@ant-design/icons';
import { RootStoreContext } from '../stores/RootStore';

/**
 * 从位标记判断某格是否已刮。
 */
const isCellScratched = (mask: number, index: number): boolean => {
  return (mask & (1 << index)) !== 0;
};

/**
 * 根据格子总数计算网格列数。
 * 9 -> 3 列, 25 -> 5 列, 16 -> 4 列。
 */
const getGridColumns = (gridSize: number): number => {
  const sqrt = Math.round(Math.sqrt(gridSize));
  if (sqrt * sqrt === gridSize) return sqrt;
  // 非完全平方数，fallback 到 3 列
  return 3;
};

type CellState = 'covered' | 'revealing' | 'revealed';

const ScratchCard = observer(function ScratchCard(): React.ReactNode {
  const rootStore = useContext(RootStoreContext);
  if (!rootStore) return null;

  const { scratchStore } = rootStore;
  const { message } = App.useApp();
  const {
    tickets, currentTicket, ticketLoading, isScratching, isSettling,
    lastScratchResult, completedCount, totalCount, allSettled,
  } = scratchStore;

  // 本地格子状态（key: `${ticketNumber}-${cellIndex}`）
  const [cellStates, setCellStates] = useState<Map<string, CellState>>(new Map());
  // 已刮格子的值
  const [cellValues, setCellValues] = useState<Map<string, number>>(new Map());

  // 当前票的列数
  const gridColumns = useMemo(() => {
    if (!currentTicket) return 3;
    return getGridColumns(currentTicket.gridSize);
  }, [currentTicket?.id]);

  // 当 currentTicket 变化时，初始化格子状态
  useEffect(() => {
    if (!currentTicket) return;
    const newMap = new Map<string, CellState>();
    for (let i = 0; i < currentTicket.gridSize; i++) {
      const key = `${currentTicket.ticketNumber}-${i}`;
      // 如果已有状态（从上一页切回来），保留
      if (cellStates.has(key)) {
        newMap.set(key, cellStates.get(key)!);
      } else {
        newMap.set(key, isCellScratched(currentTicket.scratchedMask, i) ? 'revealed' : 'covered');
      }
    }
    setCellStates(newMap);
  }, [currentTicket?.id]);

  // 记录刮开的格子值
  useEffect(() => {
    if (!lastScratchResult) return;
    const key = `${lastScratchResult.ticket.ticketNumber}-${lastScratchResult.cellIndex}`;
    setCellValues((prev) => {
      const next = new Map(prev);
      next.set(key, lastScratchResult.cellValue);
      return next;
    });
  }, [lastScratchResult]);

  // 加载彩票
  useEffect(() => {
    void scratchStore.refreshTicket();
  }, [scratchStore]);

  const handleScratchCell = useCallback(async (cellIndex: number) => {
    if (!currentTicket || isScratching) return;
    const key = `${currentTicket.ticketNumber}-${cellIndex}`;
    const state = cellStates.get(key);
    if (state !== 'covered') return;

    setCellStates((prev) => {
      const next = new Map(prev);
      next.set(key, 'revealing');
      return next;
    });

    const result = await scratchStore.scratchCell(currentTicket.ticketNumber, cellIndex);
    if (result.success) {
      const newValue = scratchStore.lastScratchResult?.cellValue;
      if (newValue !== undefined) {
        setCellValues((prev) => {
          const next = new Map(prev);
          next.set(key, newValue);
          return next;
        });
      }
      setCellStates((prev) => {
        const next = new Map(prev);
        next.set(key, 'revealed');
        return next;
      });

      // 当前票刚刮完
      if (scratchStore.lastScratchResult?.ticketCompleted) {
        message.success(`第 ${currentTicket.ticketNumber} 张票已刮完！`);
      }
      // 3 张全部刮完
      if (scratchStore.lastScratchResult?.allCompleted) {
        message.success('今天的 3 张票已全部刮完，可以开奖了！');
      }
    } else {
      setCellStates((prev) => {
        const next = new Map(prev);
        next.set(key, 'covered');
        return next;
      });
      if (result.message) {
        message.error(result.message);
      }
    }
  }, [currentTicket, isScratching, cellStates, scratchStore, message]);

  const handleSettle = useCallback(async () => {
    const result = await scratchStore.settle();
    if (result.success) {
      message.success('开奖成功！');
    } else {
      message.error(result.message);
    }
  }, [scratchStore, message]);

  // ========== 加载态 ==========
  if (ticketLoading && !currentTicket) {
    return (
      <Flex data-section="scratch-loading" justify="center" style={{ padding: 24 }}>
        <Spin size="small" />
      </Flex>
    );
  }

  // ========== 空态 ==========
  if (!currentTicket && tickets.length === 0) {
    return (
      <Flex data-section="scratch-empty" justify="center" style={{ padding: 24 }}>
        <Empty description="暂无彩票数据" />
      </Flex>
    );
  }

  // ========== 渲染 ==========
  const isCurrentCompleted = currentTicket?.status === 'completed';
  const canSettle = completedCount >= totalCount && !allSettled;

  return (
    <Flex vertical gap={16} data-section="scratch-card">
      {/* 头部：标题 + 进度 + 刷新 */}
      <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
        <Flex gap={8} align="center" wrap="wrap">
          <span style={{ fontWeight: 600, fontSize: 15 }}>刮刮乐</span>
          <Tag color="blue">已完成 {completedCount}/{totalCount} 张</Tag>
          {currentTicket && (
            <Tag color={isCurrentCompleted ? 'green' : 'orange'}>
              第 {currentTicket.ticketNumber} 张票
            </Tag>
          )}
          {allSettled && <Tag color="gold"><TrophyOutlined /> 已开奖</Tag>}
        </Flex>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void scratchStore.refreshTicket()}
          loading={ticketLoading}
        >
          刷新
        </Button>
      </Flex>

      {/* 当前票的格子 */}
      {currentTicket && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
          gap: 8,
          maxWidth: gridColumns * 90,
          margin: '0 auto',
        }}>
          {Array.from({ length: currentTicket.gridSize }, (_, cellIndex) => {
            const key = `${currentTicket.ticketNumber}-${cellIndex}`;
            const state = cellStates.get(key) ?? 'covered';
            const isCovered = state === 'covered';
            const isRevealing = state === 'revealing';
            const isRevealed = state === 'revealed';
            const value = cellValues.get(key);

            return (
              <Card
                key={cellIndex}
                size="small"
                data-element={`scratch-cell-${cellIndex}`}
                style={{
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isCovered && !isCurrentCompleted ? 'pointer' : 'default',
                  transition: 'all 0.3s ease',
                  transform: isRevealing ? 'scale(0.95)' : undefined,
                  opacity: isRevealing ? 0.7 : 1,
                  background: isCovered
                    ? 'linear-gradient(135deg, #d4a574 0%, #c08b5c 100%)'
                    : undefined,
                  border: isCovered ? '2px solid #a67c52' : undefined,
                }}
                bodyStyle={{
                  padding: 0,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={() => {
                  if (isCovered && !isCurrentCompleted) {
                    handleScratchCell(cellIndex);
                  }
                }}
              >
                {isCovered && (
                  <Flex
                    vertical
                    align="center"
                    justify="center"
                    style={{
                      width: '100%',
                      height: '100%',
                      minHeight: 60,
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 18,
                      textShadow: '1px 1px 2px rgba(0,0,0,0.3)',
                      userSelect: 'none',
                    }}
                  >
                    刮
                  </Flex>
                )}
                {isRevealing && <Spin size="small" />}
                {isRevealed && (
                  <span style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}>
                    {value !== undefined ? value : '?'}
                  </span>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 当前票已完成，提示下一张 */}
      {isCurrentCompleted && completedCount < totalCount && (
        <div style={{
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}>
          第 {currentTicket.ticketNumber} 张已刮完，自动进入第 {currentTicket.ticketNumber + 1} 张
        </div>
      )}

      {/* 3 张全部刮完，显示开奖按钮 */}
      {canSettle && (
        <Flex justify="center">
          <Button
            type="primary"
            icon={<TrophyOutlined />}
            size="large"
            onClick={handleSettle}
            loading={isSettling}
          >
            开奖
          </Button>
        </Flex>
      )}

      {/* 已开奖 */}
      {allSettled && (
        <div style={{
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 12,
        }}>
          今天的彩票已开奖，明天再来吧
        </div>
      )}
    </Flex>
  );
});

export default ScratchCard;
