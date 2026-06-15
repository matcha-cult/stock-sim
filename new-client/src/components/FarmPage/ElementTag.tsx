/**
 * 元素标签组件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：渲染作物的元素标签，支持单元素和多元素（双元素渐变、三元素以上多色分割）。
 * 2. 不做什么：不做元素逻辑判断、不做颜色计算（颜色来自 ELEMENT_COLORS）。
 *
 * 输入 / 输出：
 * - 输入：elements（元素数组，如 ["金"]、["水", "木"]）
 * - 输出：渲染后的 Tag 组件
 *
 * 数据流 / 状态流：
 * 纯展示组件，无状态。
 *
 * 复用设计说明：
 * - 被种子商店、种子袋、灵材仓库、杂交指南等多处复用。
 * - 统一元素渲染样式，避免各处重复实现渐变/分割逻辑。
 *
 * 关键边界条件与坑点：
 * 1. 空数组显示 "—"（无元素）。
 * 2. 单元素使用纯色背景。
 * 3. 双元素使用线性渐变（从左到右）。
 * 4. 三元素及以上使用等分多色渐变。
 */
import { Tag, Typography } from 'antd';
import { ELEMENT_COLORS } from './farmConstants';
import type { CropElement } from '../../services/api/farm';

const { Text } = Typography;

interface ElementTagProps {
  /** 元素数组 */
  elements: CropElement[];
}

/**
 * 生成多元素渐变背景。
 * - 单元素：纯色
 * - 双元素：50%-50% 分割
 * - 三元素及以上：等分渐变
 */
function getElementBackground(elements: CropElement[]): string {
  if (elements.length === 0) return 'transparent';
  if (elements.length === 1) return ELEMENT_COLORS[elements[0]] ?? '#999';

  // 多元素：等分渐变
  const colors = elements.map((e) => ELEMENT_COLORS[e] ?? '#999');
  const step = 100 / colors.length;
  const stops = colors.map((color, i) => {
    const start = Math.round(i * step);
    const end = Math.round((i + 1) * step);
    return `${color} ${start}%, ${color} ${end}%`;
  }).join(', ');
  return `linear-gradient(to right, ${stops})`;
}

/**
 * 获取元素显示文本。
 */
function getElementText(elements: CropElement[]): string {
  return elements.join('·');
}

export function ElementTag({ elements }: ElementTagProps) {
  if (elements.length === 0) {
    return <Text type="secondary">—</Text>;
  }

  return (
    <Tag
      style={{
        fontSize: 11,
        margin: 0,
        background: getElementBackground(elements),
        border: 'none',
        color: '#fff',
        fontWeight: 500,
      }}
    >
      {getElementText(elements)}
    </Tag>
  );
}
