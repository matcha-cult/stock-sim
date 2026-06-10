/**
 * V3 AI 新闻生成与方向校验。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：根据场景涨跌因子 + 反转提示 + 叙事轨迹构建 AI prompt，调用 LLM，校验输出方向一致性。
 * 2. 不做什么：不决定涨跌方向（方向由场景预设）、不直接改价格、不读写事件池。
 *
 * 输入 / 输出：
 * - 输入：场景定义、涨跌因子（含反转覆盖）、叙事轨迹、当前价格快照、tick 时间。
 * - 输出：校验后的新闻 headline + summary + impacts（涨跌方向已由场景确定，AI 只提供叙事内容）。
 *
 * 数据流 / 状态流：
 * 场景因子 + 反转 + 轨迹 -> buildV3Prompt -> callConfiguredTextModel -> parse JSON -> validate direction consistency -> 返回 draft。
 *
 * 复用设计说明：
 * - AI 调用入口复用 callConfiguredTextModel，JSON 解析复用 parseTechniqueTextModelJsonObject。
 * - 校验逻辑集中在此，确保 AI 输出的涨跌方向与场景预设一致。
 *
 * 关键边界条件与坑点：
 * 1. AI 返回的 changePercent 必须与 scene 中的 direction 一致（bullish=正，bearish=负）。
 * 2. neutral 股票不应出现在 impacts 中。
 * 3. 模型未配置或返回非 JSON 时记录失败，不使用本地模板兜底。
 */

import { AI_GENERATION_TIMEOUT_MS } from '../shared/aiGenerationTimeout.js';
import { callConfiguredTextModel } from '../ai/openAITextClient.js';
import {
  parseTechniqueTextModelJsonObject,
  buildTextModelPromptNoiseHash,
  generateTechniqueTextModelSeed,
  type TechniqueModelJsonObject,
  type TechniqueTextModelJsonSchemaObject,
} from '../shared/techniqueTextModelShared.js';
import type { StockMarketDefinition } from './stockMarketDefinitions.js';
import {
  normalizeStockMarketAiChangeBps,
  stockMarketPriceUnitsToSpiritStones,
  STOCK_MARKET_AI_MIN_ABS_CHANGE_PERCENT,
  STOCK_MARKET_MAX_ABS_CHANGE_BPS,
} from './stockMarketRules.js';
import type { V3SceneDefinition } from './stockMarketV3SceneDefinitions.js';
import type { V3ActiveTwist } from './stockMarketV3TwistEngine.js';
import type { V3NarrativeTrailEntry } from './stockMarketV3NarrativeTrail.js';

export type V3StockDirectionEntry = {
  stockId: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  reason: string;
  narrativeTwist?: boolean;
  twistReason?: string;
};

export type V3ValidatedImpact = {
  stockId: string;
  changeBps: number;
  reason: string;
};

export type V3AiNewsDraft = {
  headline: string;
  summary: string;
  impacts: V3ValidatedImpact[];
  modelName: string;
  promptSnapshot: string;
};

export type V3AiNewsDraftResult =
  | { success: true; draft: V3AiNewsDraft }
  | { success: false; reason: string };

const V3_AI_TEMPERATURE = 0.8;
const V3_AI_MAX_ATTEMPTS = 3;

const buildV3ResponseSchema = (
  enabledStockIds: readonly string[],
): TechniqueTextModelJsonSchemaObject => ({
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'impacts'],
  properties: {
    headline: {
      type: 'string',
      minLength: 4,
      maxLength: 40,
    },
    summary: {
      type: 'string',
      minLength: 12,
      maxLength: 160,
    },
    impacts: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stockId', 'changePercent', 'reason'],
        properties: {
          stockId: {
            type: 'string',
            enum: [...enabledStockIds],
          },
          changePercent: {
            type: 'number',
            minimum: -(STOCK_MARKET_MAX_ABS_CHANGE_BPS / 100),
            maximum: STOCK_MARKET_MAX_ABS_CHANGE_BPS / 100,
          },
          reason: {
            type: 'string',
            minLength: 4,
            maxLength: 80,
          },
        },
      },
    },
  },
});

const buildV3SystemMessage = (): string => {
  const maxChangePercent = STOCK_MARKET_MAX_ABS_CHANGE_BPS / 100;
  return [
    '你是九州修仙录世界中的坊间财经新闻撰稿人。',
    '每次只生成一条中文股市新闻，新闻必须贴合修仙商业、宗门、丹药、炼器、阵法、拍卖等题材。',
    '股票的涨跌方向已由世界局势确定，你不需要判断涨跌，只需要根据给定的方向写新闻内容。',
    `bullish 股票的 news 内容必须体现利好因素，bearish 股票的 news 内容必须体现利空因素。`,
    '标记了 narrativeTwist 的股票是反转叙事，需要在新闻中写出转折感（例如"虽值XX，但意外YYY"）。',
    '必须只输出合法 JSON 对象，JSON 字段必须严格符合 response_format schema。',
    `impacts 中每个 stockId 必须来自用户提供的股票列表，禁止虚构股票，changePercent 必须在 ${-maxChangePercent} 到 ${maxChangePercent} 之间且最多两位小数。`,
    '同一条 impacts 内每个 stockId 只能出现一次。',
    '不要连续使用 narrativeTrail 中出现过的叙事类型。',
  ].join('\n');
};

const buildV3UserMessage = (params: {
  definitions: readonly StockMarketDefinition[];
  quotes: Array<{ stockId: string; currentPriceUnits: bigint }>;
  tickHour: Date;
  scene: V3SceneDefinition;
  ticksElapsed: number;
  stockDirections: V3StockDirectionEntry[];
  narrativeTrail: V3NarrativeTrailEntry[];
  promptNoiseHash: string;
  attempt: number;
  previousFailureReason: string | null;
}): string => {
  const maxChangePercent = STOCK_MARKET_MAX_ABS_CHANGE_BPS / 100;
  const quoteByStockId = new Map(
    params.quotes.map((q) => [q.stockId, stockMarketPriceUnitsToSpiritStones(q.currentPriceUnits).toFixed(2)] as const),
  );

  // 强度 → 百分比范围映射
  const strengthToRange = (strength: number): string => {
    if (strength <= 1) return `±${STOCK_MARKET_AI_MIN_ABS_CHANGE_PERCENT}~6%`;
    if (strength === 2) return '6~10%';
    return '10~12%';
  };

  const strengthLabel = (strength: number): string => {
    if (strength <= 1) return '轻微';
    if (strength === 2) return '中等';
    return '重大';
  };

  return JSON.stringify({
    tickHour: params.tickHour.toISOString(),
    promptNoiseHash: params.promptNoiseHash,
    attempt: params.attempt,
    previousFailureReason: params.previousFailureReason,
    scene: {
      id: params.scene.id,
      name: params.scene.name,
      description: params.scene.description,
      ticksElapsed: params.ticksElapsed,
    },
    stockDirections: params.stockDirections.map((d) => ({
      ...d,
      strengthLabel: strengthLabel(d.strength),
      strengthRange: strengthToRange(d.strength),
      currentPrice: quoteByStockId.get(d.stockId) ?? '未知',
    })),
    narrativeTrail: params.narrativeTrail.slice(0, 8).map((t) => ({
      tickId: t.tickId,
      hour: t.hour,
      headline: t.headline,
      summary: t.summary,
      impacts: t.impacts.map((i) => ({
        stockId: i.stockId,
        changeBps: i.changeBps,
        direction: i.direction,
      })),
    })),
    outputRules: [
      'headline 4~40 字，summary 12~160 字，作为顶层 JSON 字段输出',
      'bullish 股票的 changePercent 必须为正数，bearish 股票的 changePercent 必须为负数',
      'changePercent 绝对值必须在 strengthRange 范围内，且不能为 0',
      `changePercent 绝对值上限为 ${maxChangePercent}%`,
      'neutral 股票不要放入 impacts',
      '标记了 narrativeTwist 的股票必须在 impacts 中出现，并在新闻中写出转折感',
      '优先输出 2~5 只受影响股票，多空配对或围绕同一主题',
      '参考 narrativeTrail 了解最近新闻脉络，不要重复使用相同的叙事角度',
      'reason 只解释新闻如何影响该股票，不重复填写涨跌数值',
      'stockId 必须逐字复制 stockDirections 中的 stockId',
      '如果 previousFailureReason 非空，本次必须修正该错误',
    ],
  });
};

const readTrimmedText = (source: TechniqueModelJsonObject, key: string, maxLength: number): string | null => {
  const value = source[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
};

const readChangeBps = (source: TechniqueModelJsonObject, stockId: string): number | null => {
  const value = source.changePercent;
  if (typeof value !== 'number') return null;
  const absValue = Math.abs(value);
  const clampedAbs = absValue < STOCK_MARKET_AI_MIN_ABS_CHANGE_PERCENT
    ? STOCK_MARKET_AI_MIN_ABS_CHANGE_PERCENT + (absValue - Math.floor(absValue))
    : absValue;
  return normalizeStockMarketAiChangeBps(Math.sign(value) * clampedAbs);
};

const readJsonObject = (source: TechniqueModelJsonObject, key: string): TechniqueModelJsonObject | null => {
  const value = source[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value;
};

export const validateV3AiNewsPayload = (
  payload: TechniqueModelJsonObject,
  directionMap: ReadonlyMap<string, { direction: 'bullish' | 'bearish' | 'neutral'; reason?: string }>,
): V3AiNewsDraftResult => {
  const headline = readTrimmedText(payload, 'headline', 60);
  const summary = readTrimmedText(payload, 'summary', 260);
  if (!headline || !summary) {
    return { success: false, reason: 'AI 新闻标题或摘要无效' };
  }

  const rawImpacts = payload.impacts;
  if (!Array.isArray(rawImpacts) || rawImpacts.length <= 0) {
    return { success: false, reason: 'AI 新闻影响列表无效' };
  }

  const seenStockIds = new Set<string>();
  const impacts: V3ValidatedImpact[] = [];
  for (const rawImpact of rawImpacts) {
    if (typeof rawImpact !== 'object' || rawImpact === null || Array.isArray(rawImpact)) {
      return { success: false, reason: 'AI 新闻影响项结构无效' };
    }
    const stockId = readTrimmedText(rawImpact, 'stockId', 96);
    if (!stockId) return { success: false, reason: 'AI 新闻影响股票 ID 无效' };

    // 方向一致性校验
    const expected = directionMap.get(stockId);
    if (!expected) {
      return { success: false, reason: `股票 ${stockId} 不在当前场景方向列表中` };
    }
    if (expected.direction === 'neutral') {
      return { success: false, reason: `中性股票 ${stockId} 不应出现在 impacts 中` };
    }

    const changeBps = readChangeBps(rawImpact, stockId);
    if (changeBps === null) return { success: false, reason: `股票 ${stockId} 涨跌数值无效` };

    // 方向校验：bullish 必须 >0，bearish 必须 <0
    if (expected.direction === 'bullish' && changeBps <= 0) {
      return { success: false, reason: `股票 ${stockId} 方向为 bullish，但涨跌为 ${changeBps} bps（应为正数）` };
    }
    if (expected.direction === 'bearish' && changeBps >= 0) {
      return { success: false, reason: `股票 ${stockId} 方向为 bearish，但涨跌为 ${changeBps} bps（应为负数）` };
    }

    const reason = readTrimmedText(rawImpact, 'reason', 80);
    if (!reason) return { success: false, reason: `股票 ${stockId} 影响理由无效` };

    if (seenStockIds.has(stockId)) {
      return { success: false, reason: 'AI 新闻影响股票重复' };
    }
    seenStockIds.add(stockId);
    impacts.push({ stockId, changeBps, reason });
  }

  return {
    success: true,
    draft: { headline, summary, impacts, modelName: '', promptSnapshot: '' },
  };
};

export const generateStockMarketV3AiNewsDraft = async (params: {
  definitions: readonly StockMarketDefinition[];
  quotes: Array<{ stockId: string; currentPriceUnits: bigint }>;
  tickHour: Date;
  scene: V3SceneDefinition;
  ticksElapsed: number;
  stockDirections: V3StockDirectionEntry[];
  narrativeTrail: V3NarrativeTrailEntry[];
}): Promise<V3AiNewsDraftResult> => {
  let previousFailureReason: string | null = null;
  const enabledStockIdSet = new Set(params.definitions.map((d) => d.id));

  console.log(`[StockMarketV3AI] 场景: ${params.scene.name}, ticksElapsed: ${params.ticksElapsed}, 叙事轨迹: ${params.narrativeTrail.length} 条`);

  for (let attempt = 1; attempt <= V3_AI_MAX_ATTEMPTS; attempt++) {
    if (previousFailureReason) {
      console.log(`[StockMarketV3AI] 第 ${attempt} 次重试，原因:`, previousFailureReason);
    }
    const seed = generateTechniqueTextModelSeed();

    let callResult: Awaited<ReturnType<typeof callConfiguredTextModel>> | null = null;
    try {
      const userMessage = buildV3UserMessage({
        ...params,
        attempt,
        previousFailureReason,
        promptNoiseHash: buildTextModelPromptNoiseHash(`stock-market-v3-news:${attempt}`, seed),
      });
      console.log(`[StockMarketV3AI] AI prompt 长度: ${userMessage.length} 字符`);
      callResult = await callConfiguredTextModel({
        modelScope: 'stockMarket',
        responseFormat: {
          type: 'json_object',
        },
        systemMessage: buildV3SystemMessage(),
        userMessage,
        seed,
        temperature: V3_AI_TEMPERATURE,
        timeoutMs: AI_GENERATION_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      previousFailureReason = `V3 股市 AI 文本模型调用失败: ${message}`;
      continue;
    }
    if (!callResult) {
      return { success: false, reason: 'V3 股市 AI 文本模型未配置' };
    }

    console.log(`[StockMarketV3AI] AI 响应: ${callResult.modelName}, 内容长度: ${callResult.content.length} 字符`);

    const parsed = parseTechniqueTextModelJsonObject(callResult.content, {
      preferredTopLevelKeys: ['headline', 'summary', 'impacts'],
    });
    if (!parsed.success) {
      previousFailureReason = `V3 AI 新闻 JSON 解析失败: ${parsed.reason}`;
      continue;
    }

    console.log('[StockMarketV3AI] JSON 解析成功，开始方向校验');

    // 构建方向映射表
    const directionMap = new Map<string, { direction: 'bullish' | 'bearish' | 'neutral'; reason?: string }>();
    for (const d of params.stockDirections) {
      directionMap.set(d.stockId, { direction: d.direction, reason: d.reason });
    }

    const validated = validateV3AiNewsPayload(parsed.data, directionMap);
    if (!validated.success) {
      previousFailureReason = validated.reason;
      continue;
    }

    return {
      success: true,
      draft: {
        ...validated.draft,
        modelName: callResult.modelName,
        promptSnapshot: callResult.promptSnapshot,
      },
    };
  }

  return { success: false, reason: previousFailureReason ?? 'V3 股市 AI 新闻生成失败' };
};
