import { NextResponse } from "next/server";
import { db } from "@/db";
import { farmCrops, farmSeeds, farmHybridRecipes, farmGlobalConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

export async function POST() {
  try {
    const seedsDir = path.join(process.cwd(), "..", "server", "data", "seeds");
    const farmDir = path.join(seedsDir, "farm");

    if (!fs.existsSync(farmDir)) {
      fs.mkdirSync(farmDir, { recursive: true });
    }

    const crops = db.select().from(farmCrops).all();
    const cropsJson = {
      crops: crops.map((crop) => ({
        cropId: crop.cropId,
        name: crop.name,
        description: crop.description,
        element: crop.element,
        rarity: crop.rarity,
        sortOrder: crop.sortOrder,
        enabled: crop.enabled,
        growthStageMinutes: JSON.parse(crop.growthStageMinutes),
        stageLabels: JSON.parse(crop.stageLabels),
        witherAfterMinutes: crop.witherAfterMinutes,
        yieldMin: crop.yieldMin,
        yieldMax: crop.yieldMax,
        sellPricePerUnit: crop.sellPricePerUnit,
        harvestTradeUnit: crop.harvestTradeUnit,
        expGain: crop.expGain,
        requiredTier: crop.requiredTier,
        seedItemId: crop.seedItemId,
        seedUnit: crop.seedUnit,
        harvestUnit: crop.harvestUnit,
        seedFromYield: crop.seedFromYield,
      })),
    };
    fs.writeFileSync(path.join(farmDir, "crops.json"), JSON.stringify(cropsJson, null, 2));

    const seeds = db.select().from(farmSeeds).all();
    const seedsJson = {
      seeds: seeds.map((seed) => ({
        itemId: seed.itemId,
        cropId: seed.cropId,
        name: seed.name,
        description: seed.description,
        buyPrice: seed.buyPrice,
        sellPrice: seed.sellPrice,
        stackable: seed.stackable,
        maxStack: seed.maxStack,
        requiredTier: seed.requiredTier,
        enabled: seed.enabled,
        sortOrder: seed.sortOrder,
        seedUnit: seed.seedUnit,
      })),
    };
    fs.writeFileSync(path.join(farmDir, "seeds.json"), JSON.stringify(seedsJson, null, 2));

    const recipes = db.select().from(farmHybridRecipes).all();
    const recipesJson = {
      recipes: recipes.map((recipe) => ({
        recipeId: recipe.recipeId,
        name: recipe.name,
        description: recipe.description,
        enabled: recipe.enabled,
        sortOrder: recipe.sortOrder,
        baseCropId: recipe.baseCropId,
        requiredCrops: JSON.parse(recipe.requiredCrops),
        resultCropId: recipe.resultCropId,
        resultSeedItemId: recipe.resultSeedItemId,
        resultQuantity: recipe.resultQuantity,
      })),
    };
    fs.writeFileSync(path.join(farmDir, "hybridRecipes.json"), JSON.stringify(recipesJson, null, 2));

    const globalConfig = db.select().from(farmGlobalConfig).where(eq(farmGlobalConfig.id, 1)).get();
    if (globalConfig) {
      const plotsJson = {
        grid: {
          initialRows: globalConfig.initialRows,
          initialCols: globalConfig.initialCols,
          maxRows: globalConfig.maxRows,
          fixedCols: globalConfig.fixedCols,
          expansions: JSON.parse(globalConfig.expansions),
        },
        xiRang: {
          pricePerUnit: globalConfig.xiRangPrice,
        },
        cellReclaim: {
          spiritStoneCost: globalConfig.cellReclaimSpiritStone,
          xiRangCost: globalConfig.cellReclaimXiRang,
        },
        farmTiers: JSON.parse(globalConfig.farmTiers),
        initialSeeds: JSON.parse(globalConfig.initialSeeds),
        mutation: {
          baseRate: globalConfig.mutationBaseRate,
          positiveRate: globalConfig.mutationPositiveRate,
          neutralRate: globalConfig.mutationNeutralRate,
          negativeRate: globalConfig.mutationNegativeRate,
          inheritRate: globalConfig.mutationInheritRate,
        },
        quality: {
          hqRate: globalConfig.qualityHqRate,
          normalRate: globalConfig.qualityNormalRate,
          lqRate: globalConfig.qualityLqRate,
        },
        accelerationMultiplier: globalConfig.accelerationMultiplier,
      };
      fs.writeFileSync(path.join(farmDir, "plots.json"), JSON.stringify(plotsJson, null, 2));
    }

    return NextResponse.json({ success: true, message: "导出成功" });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: `导出失败: ${error}` },
      { status: 500 }
    );
  }
}
