/**
 * 从 seeds.json + crops.json 生成完整的 items.json。
 * 生成的文件供 itemConfigLoader 和 init-item-definitions 脚本使用。
 *
 * 稀有度直接取用作物 crops.json 的 rarity 字段，不做价格推导。
 * 系统支持 天地玄黄 四阶（legendary / rare / uncommon / common）。
 */
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface SeedRaw {
  itemId: string;
  cropId: string;
  name: string;
  description: string;
  buyPrice: number;
  sellPrice: number;
  maxStack: number;
  requiredTier: number;
  seedUnit: string;
}

interface CropRaw {
  cropId: string;
  name: string;
  description: string;
  rarity: string;
  sellPricePerUnit: number;
  harvestTradeUnit: number;
  harvestUnit: string;
  seedItemId: string;
}

interface ItemDef {
  itemKey: string;
  name: string;
  category: string;
  subcategory: string;
  rarity: string;
  maxStack: number;
  sellable: boolean;
  sellPrice: number;
  buyable: boolean;
  buyPrice: number;
  attributes: Record<string, any>;
  description: string;
  icon: string;
}

const deriveSubcategory = (cropId: string): string => {
  if (cropId.startsWith('spirit_root')) return 'spirit_root';
  if (cropId.includes('rice') || cropId.startsWith('rice')) return 'grain';
  if (cropId.includes('hu') || cropId === 'ling_hu') return 'gourd';
  if (cropId.includes('lian') || cropId === 'ling_lian') return 'lotus';
  return 'herb';
};

/**
 * 归一化稀有度：天地玄黄 四阶（降序：天 > 地 > 玄 > 黄）。
 * 对应内部值：legendary(天) / rare(地) / uncommon(玄) / common(黄)。
 */
const normalizeRarity = (raw: string): string => {
  if (raw === 'legendary' || raw === 'rare' || raw === 'uncommon' || raw === 'common') return raw;
  return 'common';
};

async function main() {
  const seedsPath = join(process.cwd(), 'data/seeds/farm/seeds.json');
  const cropsPath = join(process.cwd(), 'data/seeds/farm/crops.json');
  const outputPath = join(process.cwd(), 'data/seeds/inventory/items.json');

  const seedsRaw = JSON.parse(await readFile(seedsPath, 'utf-8')) as { seeds: SeedRaw[] };
  const cropsRaw = JSON.parse(await readFile(cropsPath, 'utf-8')) as { crops: CropRaw[] };

  // 建立 cropId → rarity 索引（O(1) 查找）
  const cropRarityMap = new Map<string, string>();
  for (const crop of cropsRaw.crops) {
    cropRarityMap.set(crop.cropId, crop.rarity);
  }

  const items: ItemDef[] = [];

  // 生成种子定义：稀有度取对应作物的 rarity
  for (const seed of seedsRaw.seeds) {
    const cropRarity = cropRarityMap.get(seed.cropId) ?? 'common';
    items.push({
      itemKey: seed.itemId,
      name: seed.name,
      category: 'seed',
      subcategory: deriveSubcategory(seed.cropId),
      rarity: normalizeRarity(cropRarity),
      maxStack: 9999,
      sellable: true,
      sellPrice: seed.sellPrice,
      buyable: seed.buyPrice > 0,
      buyPrice: seed.buyPrice,
      attributes: {
        cropId: seed.cropId,
        requiredTier: seed.requiredTier,
        seedUnit: seed.seedUnit,
      },
      description: seed.description,
      icon: `${seed.itemId}.png`,
    });
  }

  // 生成灵材定义：稀有度直接取作物的 rarity
  for (const crop of cropsRaw.crops) {
    items.push({
      itemKey: `material_${crop.cropId}`,
      name: crop.name,
      category: 'material',
      subcategory: deriveSubcategory(crop.cropId),
      rarity: normalizeRarity(crop.rarity),
      maxStack: 9999,
      sellable: true,
      sellPrice: crop.sellPricePerUnit,
      buyable: false,
      buyPrice: 0,
      attributes: {
        cropId: crop.cropId,
        tradeUnit: crop.harvestTradeUnit,
        harvestUnit: crop.harvestUnit,
      },
      description: crop.description,
      icon: `material_${crop.cropId}.png`,
    });
  }

  await writeFile(outputPath, JSON.stringify({ items }, null, 2));
  console.log(`已生成 ${items.length} 个物品定义到 ${outputPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
