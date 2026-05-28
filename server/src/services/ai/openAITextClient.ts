/**
 * AI 文本模型统一入口（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1) 做什么：仅使用 OpenAI SDK 调用文本模型，对外暴露统一的 `callConfiguredTextModel`。
 * 2) 做什么：让股市 AI 新闻等业务层只调用这一个入口，不感知底层 provider 差异。
 * 3) 不做什么：不支持 Anthropic provider、不拼业务 prompt、不做业务 JSON 校验，也不吞掉请求异常。
 * 4) 精简版不做什么：不支持 Anthropic provider，仅使用 OpenAI SDK。
 *
 * 输入/输出：
 * - 输入：system/user 消息、可选 responseFormat、可选 seed、请求超时。
 * - 输出：`{ modelName, promptSnapshot, content }`。
 *
 * 数据流/状态流：
 * 业务 prompt -> callConfiguredTextModel -> OpenAI SDK -> 统一提取 content -> 调用方做 JSON 解析/业务校验。
 *
 * 关键边界条件与坑点：
 * 1) OpenAI SDK 返回的 message content 可能是字符串，也可能是分段数组；这里必须统一提取，否则业务层又会回到重复解析。
 * 2) 精简版仅支持 OpenAI provider，若配置为 anthropic 则返回 null。
 */
import OpenAI from 'openai';
import { readTextModelConfig, type TextModelScope } from './modelConfig.js';
import {
  buildTechniqueTextModelPayload,
  extractTechniqueTextModelContent,
  resolveOpenAICompatibleResponseFormat,
  type TechniqueTextModelResponseFormat,
} from '../shared/techniqueTextModelShared.js';

export type OpenAITextModelCallResult = {
  modelName: string;
  promptSnapshot: string;
  content: string;
};

const normalizeCompletionContent = (rawContent: unknown): string => {
  if (typeof rawContent === 'string') return rawContent;
  if (!Array.isArray(rawContent)) return '';
  return extractTechniqueTextModelContent(
    rawContent.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { text: null };
      }
      const row = entry as { text?: string | null };
      return {
        text: typeof row.text === 'string' ? row.text : null,
      };
    }),
  );
};

export const callConfiguredTextModel = async (params: {
  modelScope: TextModelScope;
  responseFormat?: TechniqueTextModelResponseFormat;
  systemMessage: string;
  userMessage: string;
  seed?: number;
  temperature?: number;
  timeoutMs: number;
}): Promise<OpenAITextModelCallResult | null> => {
  const config = readTextModelConfig(params.modelScope);
  if (!config) return null;

  // 精简版仅支持 OpenAI provider
  if (config.provider === 'anthropic') {
    console.warn('精简版不支持 Anthropic provider，请使用 OpenAI 配置');
    return null;
  }

  const payload = buildTechniqueTextModelPayload({
    modelName: config.modelName,
    responseFormat: resolveOpenAICompatibleResponseFormat(
      {
        provider: 'openai',
        baseURL: config.baseURL,
        modelName: config.modelName,
      },
      params.responseFormat,
    ),
    systemMessage: params.systemMessage,
    userMessage: params.userMessage,
    seed: params.seed,
    temperature: params.temperature,
  });

  // 调试：打印完整提示词
  //console.log('[AI Prompt] === System Message ===');
  //console.log(params.systemMessage);
  //console.log('[AI Prompt] === User Message ===');
  //console.log(params.userMessage);
  //console.log('[AI Prompt] === End ===');

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: params.timeoutMs,
  });
  const completion = await client.chat.completions.create(payload);

  // 调试：打印模型响应
  console.log('[AI Response] Model:', config.modelName, '| Content length:', completion.choices[0]?.message?.content?.length ?? 0);

  return {
    modelName: config.modelName,
    promptSnapshot: JSON.stringify(payload),
    content: normalizeCompletionContent(completion.choices[0]?.message?.content),
  };
};
