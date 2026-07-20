/**
 * 祭坛召唤 Tab 主组件
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：整合祭坛召唤的完整流程——展示祭坛、选择祭品、输入灵石、召唤、确认/放弃。
 * 2. 不做什么：不处理单个子组件的内部逻辑（由子组件各自处理）。
 *
 * 数据流 / 状态流：
 * 1. 组件加载 -> 调用 fetchAltarOfferings 获取可用祭品。
 * 2. 用户选择祭品 -> 更新 altarOfferings 状态（6 格数组）。
 * 3. 用户输入灵石 -> 更新 spiritStones 状态。
 * 4. 用户点击召唤 -> 调用 generateSummon -> 展示结果。
 * 5. 用户确认/放弃 -> 调用 confirmSummon/discardSummon -> 重置状态。
 *
 * 复用设计说明：
 * - 使用 AltarGrid、OfferingPicker、SummonControls、SummonResultPanel 四个子组件。
 * - 状态管理集中在主组件，子组件通过 props 传递数据和回调。
 *
 * 关键边界条件与坑点：
 * 1. 祭坛 6 格，每格只能放一种物品，最多 6 种不同的祭品。
 * 2. 灵石必须 >= minSpiritStones 才能召唤（minSpiritStones 从后端获取）。
 * 3. 召唤结果需要展示 id，用于 confirm/discard。
 */
import { useState, useEffect, useRef } from 'react';
import { Card, Row, Col, Space, Alert, message, Typography, Button, Flex } from 'antd';
import { ClearOutlined, BookOutlined } from '@ant-design/icons';
import AltarGrid from './altar/AltarGrid.js';
import OfferingPicker from './altar/OfferingPicker.js';
import SummonControls from './altar/SummonControls.js';
import SummonResultPanel from './altar/SummonResultPanel.js';
import RecipeViewer from './altar/RecipeViewer.js';
import {
  fetchAltarOfferings,
  generateSummon,
  confirmSummon,
  discardSummon,
  batchSummon,
} from '../../services/api/beast.js';
import type { OfferingDto, SummonGenerateDto } from '../../services/api/beast.js';
import { RequestDedup } from '../../stores/RequestDedup.js';

const { Title } = Typography;

// 祭坛 6 格，空位用 null 填充
const EMPTY_ALTAR = Array(6).fill(null) as (OfferingDto | null)[];

// 默认最低灵石需求（统一50w）
const DEFAULT_MIN_STONES = 500000;

const BeastSummonTab = function BeastSummonTab() {
  // 可用祭品列表（从后端获取）
  const [availableOfferings, setAvailableOfferings] = useState<OfferingDto[]>([]);
  // 祭坛 6 格状态
  const [altarOfferings, setAltarOfferings] = useState<(OfferingDto | null)[]>(EMPTY_ALTAR);
  // 投入灵石数量
  const [spiritStones, setSpiritStones] = useState(0);
  // 最低灵石需求（从后端返回的结果中获取）
  const [minSpiritStones, setMinSpiritStones] = useState(DEFAULT_MIN_STONES);
  // 召唤结果
  const [summonResult, setSummonResult] = useState<SummonGenerateDto | null>(null);
  // 祭品选择弹窗状态
  const [pickerOpen, setPickerOpen] = useState(false);
  const [currentSlotIndex, setCurrentSlotIndex] = useState<number | null>(null);
  // 配方查看弹窗状态
  const [recipeViewerOpen, setRecipeViewerOpen] = useState(false);
  // 加载和提交状态
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 请求去重
  const dedupRef = useRef(new RequestDedup());

  // 初始化：获取可用祭品（使用 RequestDedup 防止重复请求）
  useEffect(() => {
    const dedup = dedupRef.current;
    if (!dedup.enter('altar-offerings')) return;
    const loadOfferings = async () => {
      setIsLoading(true);
      try {
        const promise = (async () => {
          const result = await fetchAltarOfferings();
          if (result.success && result.data) {
            setAvailableOfferings(result.data);
          }
        })();
        dedup.start('altar-offerings', promise);
        await promise;
      } catch (err) {
        message.error('获取祭品列表失败');
      } finally {
        setIsLoading(false);
        dedup.complete('altar-offerings');
      }
    };
    loadOfferings();
  }, []);

  // 刷新祭品列表（绕过 RequestDedup）
  const refreshOfferings = async () => {
    setIsRefreshing(true);
    try {
      const result = await fetchAltarOfferings();
      if (result.success && result.data) {
        setAvailableOfferings(result.data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // 点击祭品格子
  const handleSlotClick = (index: number) => {
    setCurrentSlotIndex(index);
    setPickerOpen(true);
  };

  // 清除祭品格子
  const handleSlotClear = (index: number) => {
    const newOfferings = [...altarOfferings];
    newOfferings[index] = null;
    setAltarOfferings(newOfferings);
  };

  // 选择祭品
  const handleSelectOffering = (offering: OfferingDto) => {
    if (currentSlotIndex === null) return;

    // 检查是否已在其他格子中选择了相同的祭品（相同 itemId 且相同品质）
    const existingIndex = altarOfferings.findIndex(
      (o, idx) => o?.itemId === offering.itemId && o?.quality === offering.quality && idx !== currentSlotIndex,
    );
    if (existingIndex >= 0) {
      message.warning('该祭品已在其他格子中，请选择不同的祭品');
      return;
    }

    // 更新祭坛状态
    const newOfferings = [...altarOfferings];
    newOfferings[currentSlotIndex] = offering;
    setAltarOfferings(newOfferings);

    // 关闭弹窗
    setPickerOpen(false);
    setCurrentSlotIndex(null);
  };

  // 开始召唤（支持批量）
  const handleSummon = async (count: number = 1) => {
    // 过滤出非空的祭品，包含品质信息
    const offerings = altarOfferings
      .filter((o): o is OfferingDto => o !== null)
      .map((o) => ({ itemId: o.itemId, quality: o.quality }));

    if (offerings.length === 0) {
      message.warning('请至少选择一个祭品');
      return;
    }

    if (spiritStones < minSpiritStones) {
      message.warning(`灵石不足，至少需要 ${minSpiritStones.toLocaleString()}`);
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      if (count === 1) {
        // 单次召唤：显示结果，等待确认
        const result = await generateSummon(offerings, spiritStones);
        if (result.success && result.data) {
          setSummonResult(result.data);
          message.success('召唤成功！');
        } else {
          setError(result.message ?? '召唤失败');
        }
      } else {
        // 批量召唤：调用批量接口，自动签订契约
        const result = await batchSummon(offerings, spiritStones, count);
        if (result.success && result.data) {
          const { successCount, failCount, errors } = result.data;
          if (successCount > 0) {
            message.success(`批量召唤成功！签订契约 ${successCount} 只${failCount > 0 ? `，失败 ${failCount} 只` : ''}`);
            resetSummonState();
          } else {
            setError(errors[0] || '批量召唤失败');
          }
        } else {
          setError('批量召唤失败');
        }
      }
    } catch (err) {
      setError('召唤失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // 签订契约
  const handleConfirm = async () => {
    if (!summonResult) return;

    setIsConfirming(true);
    try {
      const result = await confirmSummon(summonResult.id);
      if (result.success) {
        message.success('灵兽已加入您的队伍！');
        resetSummonState();
      } else {
        message.error(result.message ?? '确认失败');
      }
    } catch (err) {
      message.error('确认失败，请稍后重试');
    } finally {
      setIsConfirming(false);
    }
  };

  // 遣返山海世界
  const handleDiscard = async () => {
    if (!summonResult) return;

    setIsDiscarding(true);
    try {
      const result = await discardSummon(summonResult.id);
      if (result.success) {
        message.info('已遣返山海世界');
        resetSummonState();
      } else {
        message.error(result.message ?? '放弃失败');
      }
    } catch (err) {
      message.error('放弃失败，请稍后重试');
    } finally {
      setIsDiscarding(false);
    }
  };

  // 重置召唤状态
  const resetSummonState = () => {
    setSummonResult(null);
    setAltarOfferings(EMPTY_ALTAR);
    setSpiritStones(0);
    setError(null);
  };

  // 清理祭坛和灵石
  const handleClearAll = () => {
    setAltarOfferings(EMPTY_ALTAR);
    setSpiritStones(0);
    message.info('已清理祭坛和灵石');
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert message={error} type="error" closable onClose={() => setError(null)} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card
            size="small"
            title={
              <Flex justify="space-between" align="center">
                <Title level={5} style={{ margin: 2 }}>祭坛·为山海世界神灵献上祭品</Title>
                <Button
                  icon={<BookOutlined />}
                  size="small"
                  onClick={() => setRecipeViewerOpen(true)}
                >
                  配方
                </Button>
              </Flex>
            }
            loading={isLoading}
          >
            <AltarGrid
              offerings={altarOfferings}
              onSlotClick={handleSlotClick}
              onSlotClear={handleSlotClear}
            />
          </Card>
        </Col>

        <Col xs={24} md={10}>
          <Card
            size="small"
            title={
              <Flex justify="space-between" align="center">
                <Title level={5} style={{ margin: 2 }}>灵石·投入灵石以稳固传送通道</Title>
                <Button
                  icon={<ClearOutlined />}
                  size="small"
                  onClick={handleClearAll}
                  disabled={altarOfferings.every((o) => o === null) && spiritStones === 0}
                >
                  清理
                </Button>
              </Flex>
            }
          >
            <SummonControls
              spiritStones={spiritStones}
              onSpiritStonesChange={setSpiritStones}
              minSpiritStones={minSpiritStones}
              isGenerating={isGenerating}
              onSummon={handleSummon}
              disabled={!!summonResult}
            />
          </Card>
        </Col>
      </Row>

      {summonResult && (
        <SummonResultPanel
          result={summonResult}
          isConfirming={isConfirming}
          isDiscarding={isDiscarding}
          onConfirm={handleConfirm}
          onDiscard={handleDiscard}
        />
      )}

      <OfferingPicker
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setCurrentSlotIndex(null);
        }}
        availableOfferings={availableOfferings}
        selectedOffering={currentSlotIndex !== null ? altarOfferings[currentSlotIndex] : null}
        onSelect={handleSelectOffering}
        onRefresh={refreshOfferings}
        isRefreshing={isRefreshing}
      />

      <RecipeViewer
        open={recipeViewerOpen}
        onClose={() => setRecipeViewerOpen(false)}
      />
    </Space>
  );
};

export default BeastSummonTab;
