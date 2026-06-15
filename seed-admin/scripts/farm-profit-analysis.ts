#!/usr/bin/env node
/**
 * 灵田收益预估脚本。
 *
 * 作用：读取种子、作物、杂交配方数据，计算每种产物的预期收益。
 * 输出：CSV 文件，包含最低、最高、平均收益。
 *
 * 收益计算考虑：
 * - 种子成本（商店购买价格）
 * - 产量范围（yieldMin ~ yieldMax）
 * - 品质分布（优质20%、普通70%、劣质10%）
 * - 品质效果（优质售价×2、劣质售价×0.5+产量×0.5）
 * - 变异概率（5%）和变异效果
 * - 种子产出价值（优质或金光变产出种子）
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── 类型定义 ──

interface CropConfig {
  cropId: string;
  name: string;
  element: string | null;
  rarity: string;
  enabled: boolean;
  yieldMin: number;
  yieldMax: number;
  sellPricePerUnit: number;
  harvestTradeUnit: number;
  seedItemId: string;
  seedFromYield: boolean;
}

interface SeedConfig {
  itemId: string;
  cropId: string;
  name: string;
  buyPrice: number;
  sellPrice: number;
  enabled: boolean;
}

interface HybridRecipe {
  recipeId: string;
  name: string;
  baseCropId: string;
  requiredCrops: string[];
  resultCropId: string;
  resultSeedItemId: string;
  enabled: boolean;
}

// ── 配置常量 ──

const QUALITY_RATES = { hq: 0.2, normal: 0.7, lq: 0.1 };
const MUTATION_RATE = 0.05;
const POSITIVE_MUTATION_RATE = 0.9;
const NEGATIVE_MUTATION_RATE = 0.1;
const MUTATION_INHERIT_RATE = 0.5;

// ── 数据加载 ──

const SEED_DIR = join(process.cwd(), '../server/data/seeds/farm');

function loadJsonFile<T>(filename: string): T {
  const content = readFileSync(join(SEED_DIR, filename), 'utf-8');
  return JSON.parse(content) as T;
}

// ── 收益计算 ──

/**
 * 计算单次收获的预期收益（不含种子成本）。
 * 返回 [最低收益, 最高收益, 期望收益]
 */
function calculateHarvestRevenue(
  crop: CropConfig,
  seed: SeedConfig | undefined,
): { min: number; max: number; expected: number } {
  const { yieldMin, yieldMax, sellPricePerUnit, harvestTradeUnit, seedFromYield } = crop;

  // 交易单位换算：每体售价
  const pricePerBody = sellPricePerUnit / harvestTradeUnit;

  // 计算各种情况下的收益
  const scenarios: Array<{ probability: number; yield: number; revenue: number; seedValue: number }> = [];

  // 遍历品质
  for (const [quality, qualityRate] of Object.entries(QUALITY_RATES)) {
    // 遍历变异（无变异 + 各种变异）
    const noMutationRate = 1 - MUTATION_RATE;

    // 无变异情况
    const { yield: yieldMul, priceMul, producesSeed } = getQualityEffect(quality as 'hq' | 'normal' | 'lq', null);
    const minYield = Math.max(Math.floor(yieldMin * yieldMul), 1);
    const maxYield = Math.max(Math.floor(yieldMax * yieldMul), 1);
    const revenuePerBody = pricePerBody * priceMul;
    const seedValue = producesSeed && seed ? seed.sellPrice : 0;

    scenarios.push({
      probability: qualityRate * noMutationRate,
      yield: minYield,
      revenue: minYield * revenuePerBody + seedValue,
      seedValue,
    });
    scenarios.push({
      probability: qualityRate * noMutationRate,
      yield: maxYield,
      revenue: maxYield * revenuePerBody + seedValue,
      seedValue,
    });

    // 正面变异（金光变、丰收变）
    const positiveMutations = ['gold', 'double_yield'] as const;
    for (const mutation of positiveMutations) {
      const mutationRate = MUTATION_RATE * POSITIVE_MUTATION_RATE * (1 / positiveMutations.length);
      const effect = getQualityEffect(quality as 'hq' | 'normal' | 'lq', mutation);
      const minY = Math.max(Math.floor(yieldMin * effect.yield), 1);
      const maxY = Math.max(Math.floor(yieldMax * effect.yield), 1);
      const rev = pricePerBody * effect.priceMul;
      const sv = effect.producesSeed && seed ? seed.sellPrice : 0;

      scenarios.push({
        probability: qualityRate * mutationRate,
        yield: minY,
        revenue: minY * rev + sv,
        seedValue: sv,
      });
      scenarios.push({
        probability: qualityRate * mutationRate,
        yield: maxY,
        revenue: maxY * rev + sv,
        seedValue: sv,
      });
    }

    // 负面变异（歉收变）
    const halfYieldRate = MUTATION_RATE * NEGATIVE_MUTATION_RATE;
    const halfEffect = getQualityEffect(quality as 'hq' | 'normal' | 'lq', 'half_yield');
    const halfMinY = Math.max(Math.floor(yieldMin * halfEffect.yield), 1);
    const halfMaxY = Math.max(Math.floor(yieldMax * halfEffect.yield), 1);
    const halfRev = pricePerBody * halfEffect.priceMul;
    const halfSv = halfEffect.producesSeed && seed ? seed.sellPrice : 0;

    scenarios.push({
      probability: qualityRate * halfYieldRate,
      yield: halfMinY,
      revenue: halfMinY * halfRev + halfSv,
      seedValue: halfSv,
    });
    scenarios.push({
      probability: qualityRate * halfYieldRate,
      yield: halfMaxY,
      revenue: halfMaxY * halfRev + halfSv,
      seedValue: halfSv,
    });
  }

  // 计算最小、最大、期望收益
  let minRevenue = Infinity;
  let maxRevenue = -Infinity;
  let expectedRevenue = 0;

  for (const s of scenarios) {
    if (s.revenue < minRevenue) minRevenue = s.revenue;
    if (s.revenue > maxRevenue) maxRevenue = s.revenue;
    expectedRevenue += s.probability * s.revenue;
  }

  return { min: minRevenue, max: maxRevenue, expected: expectedRevenue };
}

/**
 * 获取品质+变异的效果。
 */
function getQualityEffect(
  quality: 'hq' | 'normal' | 'lq',
  mutation: 'gold' | 'double_yield' | 'half_yield' | null,
): { yield: number; priceMul: number; producesSeed: boolean } {
  let yieldMul = 1;
  let priceMul = 1;
  let producesSeed = false;

  // 品质效果
  if (quality === 'hq') {
    priceMul = 2;
    producesSeed = true;
  } else if (quality === 'lq') {
    yieldMul = 0.5;
    priceMul = 0.5;
  }

  // 变异效果（金光变提升品质）
  if (mutation === 'gold') {
    if (quality === 'lq') {
      quality = 'normal';
      priceMul = 1;
      yieldMul = 1;
    } else if (quality === 'normal') {
      quality = 'hq';
      priceMul = 2;
      producesSeed = true;
    }
    producesSeed = true; // 金光变必然产种
  } else if (mutation === 'double_yield') {
    yieldMul *= 2;
  } else if (mutation === 'half_yield') {
    yieldMul *= 0.5;
  }

  return { yield: yieldMul, priceMul, producesSeed };
}

// ── 主逻辑 ──

interface ResultRow {
  cropId: string;
  cropName: string;
  element: string;
  rarity: string;
  seedName: string;
  seedCost: number;
  seedSellPrice: number;
  yieldMin: number;
  yieldMax: number;
  sellPricePerUnit: number;
  harvestTradeUnit: number;
  minRevenue: number;
  maxRevenue: number;
  expectedRevenue: number;
  minProfit: number;
  maxProfit: number;
  expectedProfit: number;
  roi: string;
}

function main() {
  // 加载数据
  const cropsRaw = loadJsonFile<{ crops: CropConfig[] }>('crops.json');
  const seedsRaw = loadJsonFile<{ seeds: SeedConfig[] }>('seeds.json');
  const recipesRaw = loadJsonFile<{ recipes: HybridRecipe[] }>('hybridRecipes.json');

  const crops = cropsRaw.crops.filter((c) => c.enabled);
  const seeds = seedsRaw.seeds.filter((s) => s.enabled);
  const recipes = recipesRaw.recipes.filter((r) => r.enabled);

  // 构建索引
  const seedByItemId = new Map(seeds.map((s) => [s.itemId, s]));
  const seedByCropId = new Map(seeds.map((s) => [s.cropId, s]));
  const cropById = new Map(crops.map((c) => [c.cropId, c]));

  // 标记哪些是杂交产物
  const hybridCropIds = new Set(recipes.map((r) => r.resultCropId));

  const results: ResultRow[] = [];

  for (const crop of crops) {
    const seed = seedByCropId.get(crop.cropId);
    if (!seed) continue;

    // 计算收益
    const revenue = calculateHarvestRevenue(crop, seed);

    // 种子成本（商店购买的种子，杂交种子成本为0）
    const seedCost = hybridCropIds.has(crop.cropId) ? 0 : seed.buyPrice;

    // 利润 = 收益 - 种子成本
    const minProfit = revenue.min - seedCost;
    const maxProfit = revenue.max - seedCost;
    const expectedProfit = revenue.expected - seedCost;

    // 投资回报率
    const roi = seedCost > 0 ? ((expectedProfit / seedCost) * 100).toFixed(1) + '%' : 'N/A（杂交）';

    results.push({
      cropId: crop.cropId,
      cropName: crop.name,
      element: crop.element || '—',
      rarity: crop.rarity,
      seedName: seed.name,
      seedCost,
      seedSellPrice: seed.sellPrice,
      yieldMin: crop.yieldMin,
      yieldMax: crop.yieldMax,
      sellPricePerUnit: crop.sellPricePerUnit,
      harvestTradeUnit: crop.harvestTradeUnit,
      minRevenue: Math.round(revenue.min * 100) / 100,
      maxRevenue: Math.round(revenue.max * 100) / 100,
      expectedRevenue: Math.round(revenue.expected * 100) / 100,
      minProfit: Math.round(minProfit * 100) / 100,
      maxProfit: Math.round(maxProfit * 100) / 100,
      expectedProfit: Math.round(expectedProfit * 100) / 100,
      roi,
    });
  }

  // 按稀有度排序
  const rarityOrder: Record<string, number> = {
    common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5,
  };
  results.sort((a, b) => (rarityOrder[a.rarity] ?? 0) - (rarityOrder[b.rarity] ?? 0));

  // 输出 CSV
  const csvHeader = [
    '作物ID', '作物名称', '元素', '稀有度',
    '种子名称', '种子成本', '种子售价',
    '最小产量', '最大产量', '售价/单位', '交易单位',
    '最低收益', '最高收益', '期望收益',
    '最低利润', '最高利润', '期望利润', '投资回报率',
  ].join(',');

  const csvRows = results.map((r) => [
    r.cropId, r.cropName, r.element, r.rarity,
    r.seedName, r.seedCost, r.seedSellPrice,
    r.yieldMin, r.yieldMax, r.sellPricePerUnit, r.harvestTradeUnit,
    r.minRevenue, r.maxRevenue, r.expectedRevenue,
    r.minProfit, r.maxProfit, r.expectedProfit, r.roi,
  ].join(','));

  const csvContent = '﻿' + csvHeader + '\n' + csvRows.join('\n');
  const outputPath = join(process.cwd(), 'farm-profit-analysis.csv');
  writeFileSync(outputPath, csvContent, 'utf-8');

  console.log(`✅ 收益预估完成，已输出到 ${outputPath}`);
  console.log(`\n共分析 ${results.length} 种作物：`);
  console.log('- 商店种子：', results.filter((r) => r.seedCost > 0).length);
  console.log('- 杂交产物：', results.filter((r) => r.seedCost === 0).length);

  // 打印摘要
  console.log('\n=== 利润排行（按期望利润）===');
  const sorted = [...results].sort((a, b) => b.expectedProfit - a.expectedProfit);
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const r = sorted[i];
    console.log(`${i + 1}. ${r.cropName}：期望利润 ${r.expectedProfit} 灵石（${r.roi}）`);
  }
}

main();
