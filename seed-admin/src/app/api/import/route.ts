import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { farmCrops, farmSeeds, farmHybridRecipes, farmGlobalConfig } from "@/db/schema";
import fs from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { module } = body;

    const seedsDir = path.join(process.cwd(), "..", "server", "data", "seeds");
    const farmDir = path.join(seedsDir, "farm");

    if (module === "crops" || !module) {
      const cropsFile = path.join(farmDir, "crops.json");
      if (fs.existsSync(cropsFile)) {
        const cropsData = JSON.parse(fs.readFileSync(cropsFile, "utf-8"));
        db.delete(farmCrops).run();
        for (const crop of cropsData.crops) {
          db.insert(farmCrops)
            .values({
              cropId: crop.cropId,
              name: crop.name,
              description: crop.description,
              element: JSON.stringify(crop.element),
              rarity: crop.rarity,
              sortOrder: crop.sortOrder,
              enabled: crop.enabled,
              growthStageMinutes: JSON.stringify(crop.growthStageMinutes),
              stageLabels: JSON.stringify(crop.stageLabels),
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
            })
            .run();
        }
      }
    }

    if (module === "seeds" || !module) {
      const seedsFile = path.join(farmDir, "seeds.json");
      if (fs.existsSync(seedsFile)) {
        const seedsData = JSON.parse(fs.readFileSync(seedsFile, "utf-8"));
        db.delete(farmSeeds).run();
        for (const seed of seedsData.seeds) {
          db.insert(farmSeeds)
            .values({
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
            })
            .run();
        }
      }
    }

    if (module === "hybridRecipes" || !module) {
      const recipesFile = path.join(farmDir, "hybridRecipes.json");
      if (fs.existsSync(recipesFile)) {
        const recipesData = JSON.parse(fs.readFileSync(recipesFile, "utf-8"));
        db.delete(farmHybridRecipes).run();
        for (const recipe of recipesData.recipes) {
          db.insert(farmHybridRecipes)
            .values({
              recipeId: recipe.recipeId,
              name: recipe.name,
              description: recipe.description,
              enabled: recipe.enabled,
              sortOrder: recipe.sortOrder,
              baseCropId: recipe.baseCropId,
              requiredCrops: JSON.stringify(recipe.requiredCrops),
              minRequired: recipe.minRequired ?? null,
              resultCropId: recipe.resultCropId,
              resultSeedItemId: recipe.resultSeedItemId,
              resultQuantity: recipe.resultQuantity,
            })
            .run();
        }
      }
    }

    if (module === "plots" || !module) {
      const plotsFile = path.join(farmDir, "plots.json");
      if (fs.existsSync(plotsFile)) {
        const plotsData = JSON.parse(fs.readFileSync(plotsFile, "utf-8"));
        db.delete(farmGlobalConfig).run();
        db.insert(farmGlobalConfig)
          .values({
            id: 1,
            initialRows: plotsData.grid.initialRows,
            initialCols: plotsData.grid.initialCols,
            maxRows: plotsData.grid.maxRows,
            fixedCols: plotsData.grid.fixedCols,
            expansions: JSON.stringify(plotsData.grid.expansions),
            xiRangPrice: plotsData.xiRang.pricePerUnit,
            cellReclaimSpiritStone: plotsData.cellReclaim.spiritStoneCost,
            cellReclaimXiRang: plotsData.cellReclaim.xiRangCost,
            farmTiers: JSON.stringify(plotsData.farmTiers),
            initialSeeds: JSON.stringify(plotsData.initialSeeds),
            mutationBaseRate: plotsData.mutation.baseRate,
            mutationPositiveRate: plotsData.mutation.positiveRate,
            mutationNeutralRate: plotsData.mutation.neutralRate,
            mutationNegativeRate: plotsData.mutation.negativeRate,
            mutationInheritRate: plotsData.mutation.inheritRate,
            qualityHqRate: plotsData.quality.hqRate,
            qualityNormalRate: plotsData.quality.normalRate,
            qualityLqRate: plotsData.quality.lqRate,
            qualityHqSeedRate: plotsData.quality.hqSeedRate ?? 0,
            accelerationMultiplier: plotsData.accelerationMultiplier,
          })
          .run();
      }
    }

    return NextResponse.json({ success: true, message: "导入成功" });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: `导入失败: ${error}` },
      { status: 500 }
    );
  }
}
