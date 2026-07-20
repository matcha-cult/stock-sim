/**
 * 星级系统配置
 *
 * 作用：定义灵兽和怪物的星级加成
 * 数据流：从后端配置同步（或前端硬编码，保持一致）
 */

export interface StarLevelConfig {
  star: number;
  name: string;
  attrMultiplier: number;
  color: string;
}

export const STAR_LEVEL_CONFIGS: StarLevelConfig[] = [
  { star: 0, name: '无星', attrMultiplier: 1.0, color: 'default' },
  { star: 1, name: '一星', attrMultiplier: 1.0, color: 'green' },
  { star: 2, name: '二星', attrMultiplier: 1.2, color: 'blue' },
  { star: 3, name: '三星', attrMultiplier: 1.35, color: 'purple' },
  { star: 4, name: '四星', attrMultiplier: 1.5, color: 'orange' },
  { star: 5, name: '五星', attrMultiplier: 1.7, color: 'red' },
  { star: 6, name: '六星', attrMultiplier: 2.0, color: 'gold' },
];

export const getStarLevelConfig = (star: number): StarLevelConfig => {
  return STAR_LEVEL_CONFIGS.find((c) => c.star === star) ?? STAR_LEVEL_CONFIGS[0];
};

export const getStarLevelMultiplier = (star: number): number => {
  return getStarLevelConfig(star).attrMultiplier;
};
