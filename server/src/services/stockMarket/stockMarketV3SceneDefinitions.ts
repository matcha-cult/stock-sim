/**
 * V3 场景定义。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：定义全部场景池，每个场景包含涨跌因子、反转列表、生命周期参数。
 * 2. 不做什么：不执行场景切换、不运行反转引擎、不读写数据库。
 *
 * 输入 / 输出：
 * - 输入：无（静态常量）。
 * - 输出：场景列表、场景 Map、场景 ID 集合。
 *
 * 数据流 / 状态流：
 * 场景管理器加载本模块 → 按 ID 选取当前场景 → 涨跌因子传给 AI prompt。
 *
 * 复用设计说明：
 * - 场景定义是高频调参入口，集中在此模块后，场景管理器、AI prompt 构建、反转引擎都从此读取。
 * - 涨跌方向枚举和强度常量也集中在此，避免各模块各自定义范围。
 *
 * 关键边界条件与坑点：
 * 1. 每个场景必须覆盖全部启用股票，不能有遗漏（neutral 也算覆盖）。
 * 2. 反转列表中的 stockId 必须在启用股票白名单中，否则校验会失败。
 * 3. 场景 minTicks 必须 < maxTicks，否则生命周期判定会死锁。
 */

import { getEnabledStockIdSet } from './stockMarketDefinitions.js';

// ==================== 方向与强度常量 ====================

export type V3StockDirection = 'bullish' | 'bearish' | 'neutral';

export type V3StockDirectionEntry = {
  stockId: string;
  direction: V3StockDirection;
  strength: number;    // 1~3，对应幅度区间
  reason: string;      // 人类可读理由，传给 AI
};

export type V3SceneTwist = {
  stockId: string;
  directionOverride: 'bullish' | 'bearish';
  strengthOverride: number;  // 1~2，不超过 ±10%
  narrativeReason: string;   // 反转的叙事理由
};

export type V3SceneDefinition = {
  id: string;
  name: string;
  description: string;
  minTicks: number;
  maxTicks: number;
  baseDirections: V3StockDirectionEntry[];
  possibleTwists: V3SceneTwist[];
};

// ==================== 强度 → 百分比范围映射 ====================

/** 强度 1：±2% ~ ±6% */
export const V3_STRENGTH_1_MIN = 2.0;
export const V3_STRENGTH_1_MAX = 6.0;

/** 强度 2：±6% ~ ±10% */
export const V3_STRENGTH_2_MIN = 6.0;
export const V3_STRENGTH_2_MAX = 10.0;

/** 强度 3：±10% ~ ±12% */
export const V3_STRENGTH_3_MIN = 10.0;
export const V3_STRENGTH_3_MAX = 12.0;

/** 反转强度上限：不超过强度 2 */
export const V3_TWIST_MAX_STRENGTH = 2;

// ==================== 场景池 ====================

/**
 * 场景 A：和平岁月
 * 南北停战后第三年，商路畅通，军备废弛。
 * 商贸/丹药/拍卖类受益，军事/宗门类承压。
 */
const SCENE_PEACE: V3SceneDefinition = {
  id: 'scene-peace',
  name: '和平岁月',
  description: '南北停战许久，异族退守南方，北州商路恢复畅通，各宗门休养生息。和平表面下暗流涌动——边防松懈、军备废弛、商会势力膨胀。',
  minTicks: 6,
  maxTicks: 20,
  baseDirections: [
    { stockId: 'stock-jianqi-wall', direction: 'bearish', strength: 2, reason: '和平时期边防松懈，军功需求下降，长城军费削减' },  // 剑气长城 · 宗门：军事防御，和平期利空
    { stockId: 'stock-chixiao-sword', direction: 'bearish', strength: 1, reason: '战事减少，沧雪剑宗弟子轮换频率降低' },  // 沧雪剑宗 · 宗门：剑修宗门，联动长城
    { stockId: 'stock-xuantie-mining', direction: 'neutral', strength: 1, reason: '矿材供应稳定，需求变化不大' },  // 星钛矿业 · 矿材：原材料，不受战争影响
    { stockId: 'stock-tiangong-armory', direction: 'bearish', strength: 2, reason: '战时法器订单减少，炼器需求下降' },  // 天罡器阁 · 炼器：武器护甲，和平期订单减少
    { stockId: 'stock-lingzhou-shipyard', direction: 'bullish', strength: 2, reason: '商路畅通，船运贸易量增长' },  // 龙洲船坞 · 交通：商路恢复，航运受益
    { stockId: 'stock-qingyun-danfang', direction: 'bullish', strength: 2, reason: '和平时期丹药需求增长，各宗门炼丹活动频繁' },  // 琼玉丹坊 · 丹药：民用丹药需求增长
    { stockId: 'stock-yunmeng-herb', direction: 'bullish', strength: 1, reason: '丹药需求拉动灵草价格上涨' },  // 云梦药畦 · 灵植：丹药上游，跟随受益
    { stockId: 'stock-xinghe-auction', direction: 'bullish', strength: 2, reason: '压轴拍品增多，拍卖行业繁荣' },  // 星瀚拍卖 · 拍卖：和平期藏品流通活跃
    { stockId: 'stock-beizhou-treasure', direction: 'bullish', strength: 2, reason: '日常贸易活跃，宝楼客流量增长' },  // 碧州宝楼 · 商贸：民间贸易繁荣
    { stockId: 'stock-wuerdaha-trade', direction: 'bullish', strength: 3, reason: '商路畅通，灵石汇兑量创历史新高' },  // 乌尔达哈商会 · 商贸：汇兑龙头，最大受益者
    { stockId: 'stock-qiankun-array', direction: 'neutral', strength: 1, reason: '阵法需求稳定，城池扩建放缓' },  // 乾坤阵台 · 阵法：民用需求平稳
    { stockId: 'stock-wanjuan-academy', direction: 'bullish', strength: 1, reason: '和平时期讲经会增多，求学修士增加' },  // 无极书院 · 功法：文教消费受益于和平
  ],
  possibleTwists: [
    { stockId: 'stock-jianqi-wall', directionOverride: 'bullish', strengthOverride: 1, narrativeReason: '和平但长城守军意外发现古代防御阵法遗迹，声望大涨' },  // 剑气长城反转：意外发现
    { stockId: 'stock-chixiao-sword', directionOverride: 'bullish', strengthOverride: 1, narrativeReason: '沧雪剑宗意外获得上古剑谱传承，声名大噪' },  // 沧雪剑宗反转：传承利好
    { stockId: 'stock-wuerdaha-trade', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '商会汇兑所爆出假灵石丑闻，信用受损' },  // 乌尔达哈反转：信用危机
  ],
};

/**
 * 场景 B：妖潮入侵
 * 南疆妖潮汹涌，异族异动，北州边防告急。
 * 军事/炼器/丹药类受益，商贸/拍卖类承压。
 */
const SCENE_DEMON_TIDE: V3SceneDefinition = {
  id: 'scene-demon-tide',
  name: '妖潮入侵',
  description: '南疆妖潮汹涌，异族在长城以南三百里集结。北州各宗门紧急动员，军需物资需求激增，但商路受阻，市场恐慌情绪蔓延。',
  minTicks: 10,
  maxTicks: 30,
  baseDirections: [
    { stockId: 'stock-jianqi-wall', direction: 'bullish', strength: 3, reason: '妖潮压境，长城战功需求激增，军费拨款加倍' },  // 剑气长城 · 宗门：战争前线，最大受益者
    { stockId: 'stock-chixiao-sword', direction: 'bullish', strength: 2, reason: '沧雪剑宗弟子紧急调往长城驻防，声望大涨' },  // 沧雪剑宗 · 宗门：联动长城，驻防受益
    { stockId: 'stock-xuantie-mining', direction: 'bullish', strength: 2, reason: '战时矿材需求大，军方大量采购铁矿' },  // 星钛矿业 · 矿材：军需原材料，战争拉动
    { stockId: 'stock-tiangong-armory', direction: 'bullish', strength: 3, reason: '护甲、法器订单暴增，炼器工坊昼夜不停' },  // 天罡器阁 · 炼器：武器装备，军需龙头
    { stockId: 'stock-lingzhou-shipyard', direction: 'bearish', strength: 2, reason: '部分商路被妖潮阻断，船运量下降' },  // 龙洲船坞 · 交通：商路受阻，航运受损
    { stockId: 'stock-qingyun-danfang', direction: 'bullish', strength: 2, reason: '伤药、回气丹等战时丹药需求暴增' },  // 琼玉丹坊 · 丹药：战时医疗需求
    { stockId: 'stock-yunmeng-herb', direction: 'bullish', strength: 1, reason: '丹药原材料需求拉动灵草价格' },  // 云梦药畦 · 灵植：丹药上游，跟随受益
    { stockId: 'stock-xinghe-auction', direction: 'bearish', strength: 2, reason: '战乱期压轴拍品减少，拍卖行客流锐减' },  // 星瀚拍卖 · 拍卖：战乱期藏品流通减少
    { stockId: 'stock-beizhou-treasure', direction: 'bearish', strength: 1, reason: '部分商路中断，宝楼货源不稳定' },  // 碧州宝楼 · 商贸：供应链受阻
    { stockId: 'stock-wuerdaha-trade', direction: 'bearish', strength: 2, reason: '商路受阻，汇兑量下降，但军需汇兑有所增长' },  // 乌尔达哈商会 · 商贸：民间汇兑受损
    { stockId: 'stock-qiankun-array', direction: 'bullish', strength: 2, reason: '长城护阵升级，各宗门请求加固防御阵法' },  // 乾坤阵台 · 阵法：防御阵法需求增长
    { stockId: 'stock-wanjuan-academy', direction: 'neutral', strength: 1, reason: '书院弟子参与后勤，但教学不受直接影响' },  // 无极书院 · 功法：文教中性
  ],
  possibleTwists: [
    { stockId: 'stock-lingzhou-shipyard', directionOverride: 'bullish', strengthOverride: 2, narrativeReason: '船坞被军方征用建造战船，订单逆势大增' },  // 龙洲船坞反转：军征订单
    { stockId: 'stock-xinghe-auction', directionOverride: 'bullish', strengthOverride: 1, narrativeReason: '拍卖行紧急拍卖战时战略物资，成交额逆势增长' },  // 星瀚拍卖反转：军资拍卖
    { stockId: 'stock-jianqi-wall', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '长城外来剑修被爆出通敌丑闻，部分将领被撤职查办' },  // 剑气长城反转：通敌丑闻
    { stockId: 'stock-wanjuan-academy', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '书院弟子被爆出通敌丑闻' },  // 无极书院反转：学术丑闻
  ],
};

/**
 * 场景 C：丹方突破
 * 青云丹坊发布新丹方，引发丹药产业链连锁反应。
 * 丹药/灵草类受益，其他板块中性。
 */
const SCENE_PILL_BREAKTHROUGH: V3SceneDefinition = {
  id: 'scene-pill-breakthrough',
  name: '丹方突破',
  description: '青云丹坊首席炼丹师成功复原上古丹方，引发北州丹药产业链连锁反应。各宗门争先采购，灵草原材料供不应求。',
  minTicks: 3,
  maxTicks: 8,
  baseDirections: [
    { stockId: 'stock-jianqi-wall', direction: 'neutral', strength: 1, reason: '长城边防无直接变化' },  // 剑气长城 · 宗门：军事防御，不受丹方影响
    { stockId: 'stock-chixiao-sword', direction: 'neutral', strength: 1, reason: '宗门事务无直接变化' },  // 沧雪剑宗 · 宗门：剑修，与丹药无关
    { stockId: 'stock-xuantie-mining', direction: 'neutral', strength: 1, reason: '矿材市场无直接变化' },  // 星钛矿业 · 矿材：原材料，不受丹方影响
    { stockId: 'stock-tiangong-armory', direction: 'neutral', strength: 1, reason: '炼器市场无直接变化' },  // 天罡器阁 · 炼器：炼器，与丹药无关
    { stockId: 'stock-lingzhou-shipyard', direction: 'neutral', strength: 1, reason: '交通市场无直接变化' },  // 龙洲船坞 · 交通：航运，不受丹方影响
    { stockId: 'stock-qingyun-danfang', direction: 'bullish', strength: 3, reason: '新丹方引爆市场需求，订单排到下个月' },  // 琼玉丹坊 · 丹药：事件主体，最大受益者
    { stockId: 'stock-yunmeng-herb', direction: 'bullish', strength: 3, reason: '丹药需求暴增，灵草原材料价格翻倍' },  // 云梦药畦 · 灵植：丹药上游，同等受益
    { stockId: 'stock-xinghe-auction', direction: 'bullish', strength: 1, reason: '新型丹药成为压轴拍品，拍卖会热度上升' },  // 星瀚拍卖 · 拍卖：丹药拍卖蹭热度
    { stockId: 'stock-beizhou-treasure', direction: 'neutral', strength: 1, reason: '宝楼日常贸易影响有限' },  // 碧州宝楼 · 商贸：零售，不受丹方直接影响
    { stockId: 'stock-wuerdaha-trade', direction: 'neutral', strength: 1, reason: '商会汇兑无直接变化' },  // 乌尔达哈商会 · 商贸：汇兑，不受丹方影响
    { stockId: 'stock-qiankun-array', direction: 'neutral', strength: 1, reason: '阵法市场无直接变化' },  // 乾坤阵台 · 阵法：阵法，与丹药无关
    { stockId: 'stock-wanjuan-academy', direction: 'neutral', strength: 1, reason: '书院无直接变化' },  // 无极书院 · 功法：文教，与丹药无关
  ],
  possibleTwists: [
    { stockId: 'stock-qingyun-danfang', directionOverride: 'bearish', strengthOverride: 2, narrativeReason: '丹方泄露事件曝光，竞品宗门抢先仿制，市场份额受冲击' },  // 琼玉丹坊反转：技术泄露
    { stockId: 'stock-yunmeng-herb', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '灵草主产区遭遇病虫害，减产消息传出' },  // 云梦药畦反转：自然灾害
  ],
};

/**
 * 场景 D：矿脉发现
 * 星钛矿业发现新灵矿脉，北州原材料市场震动。
 * 矿材/炼器类受益，其他板块中性。
 */
const SCENE_MINERAL_DISCOVERY: V3SceneDefinition = {
  id: 'scene-mineral-discovery',
  name: '灵脉发现',
  description: '星钛矿业在北州西部发现一条极品灵矿脉，矿材产量预期大幅增长。北州各宗门和炼器工坊闻讯而动，矿材价格短期承压但长期利好。',
  minTicks: 6,
  maxTicks: 20,
  baseDirections: [
    { stockId: 'stock-jianqi-wall', direction: 'neutral', strength: 1, reason: '长城无直接变化' },  // 剑气长城 · 宗门：军事防御，不受矿脉影响
    { stockId: 'stock-chixiao-sword', direction: 'neutral', strength: 1, reason: '宗门无直接变化' },  // 沧雪剑宗 · 宗门：剑修，与矿材无关
    { stockId: 'stock-xuantie-mining', direction: 'bullish', strength: 3, reason: '新灵矿脉发现，产量预期翻倍，股价大涨' },  // 星钛矿业 · 矿材：事件主体，最大受益者
    { stockId: 'stock-tiangong-armory', direction: 'bullish', strength: 2, reason: '矿材供应增加，炼器成本下降，利润空间扩大' },  // 天罡器阁 · 炼器：原材料降价，成本受益
    { stockId: 'stock-lingzhou-shipyard', direction: 'neutral', strength: 1, reason: '交通无直接变化' },  // 龙洲船坞 · 交通：航运，不受矿脉影响
    { stockId: 'stock-qingyun-danfang', direction: 'neutral', strength: 1, reason: '丹药无直接变化' },  // 琼玉丹坊 · 丹药：丹药，与矿材无关
    { stockId: 'stock-yunmeng-herb', direction: 'neutral', strength: 1, reason: '灵草无直接变化' },  // 云梦药畦 · 灵植：灵植，与矿材无关
    { stockId: 'stock-xinghe-auction', direction: 'bullish', strength: 1, reason: '矿石标本成为拍卖新宠' },  // 星瀚拍卖 · 拍卖：稀有矿石蹭热度
    { stockId: 'stock-beizhou-treasure', direction: 'neutral', strength: 1, reason: '宝楼无直接变化' },  // 碧州宝楼 · 商贸：零售，不受矿脉影响
    { stockId: 'stock-wuerdaha-trade', direction: 'bullish', strength: 1, reason: '矿材贸易量增长，汇兑需求增加' },  // 乌尔达哈商会 · 商贸：矿石贸易受益
    { stockId: 'stock-qiankun-array', direction: 'neutral', strength: 1, reason: '阵法无直接变化' },  // 乾坤阵台 · 阵法：阵法，与矿材无关
    { stockId: 'stock-wanjuan-academy', direction: 'neutral', strength: 1, reason: '书院无直接变化' },  // 无极书院 · 功法：文教，与矿材无关
  ],
  possibleTwists: [
    { stockId: 'stock-xuantie-mining', directionOverride: 'bearish', strengthOverride: 2, narrativeReason: '新矿脉质量不及预期，含杂质过多，市场失望' },  // 星钛矿业反转：质量不及预期
    { stockId: 'stock-tiangong-armory', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '新矿石与现有炼器工艺不兼容，器阁需重新调试配方' },  // 天罡器阁反转：工艺不兼容
  ],
};

/**
 * 场景 E：讲经盛会
 * 无极书院举办讲经大会，北州文教市场火热。
 * 功法/阵法/丹药类受益，其他板块中性。
 */
const SCENE_ACADEMY_FESTIVAL: V3SceneDefinition = {
  id: 'scene-academy-festival',
  name: '讲经盛会',
  description: '无极书院举办讲经大会，各宗门派弟子前来听讲。北州文教市场随之火热，秘卷、阵法道具、辅助丹药需求全面增长。',
  minTicks: 3,
  maxTicks: 8,
  baseDirections: [
    { stockId: 'stock-jianqi-wall', direction: 'neutral', strength: 1, reason: '长城无直接变化' },  // 剑气长城 · 宗门：军事防御，不受文教影响
    { stockId: 'stock-chixiao-sword', direction: 'neutral', strength: 1, reason: '宗门无直接变化' },  // 沧雪剑宗 · 宗门：剑修，与讲经无关
    { stockId: 'stock-xuantie-mining', direction: 'neutral', strength: 1, reason: '矿材无直接变化' },  // 星钛矿业 · 矿材：原材料，不受文教影响
    { stockId: 'stock-tiangong-armory', direction: 'neutral', strength: 1, reason: '炼器无直接变化' },  // 天罡器阁 · 炼器：炼器，与讲经无关
    { stockId: 'stock-lingzhou-shipyard', direction: 'bullish', strength: 1, reason: '求学修士增多，交通需求小幅增长' },  // 龙洲船坞 · 交通：修士往来增多，航运受益
    { stockId: 'stock-qingyun-danfang', direction: 'bullish', strength: 1, reason: '辅助修炼丹药需求增长' },  // 琼玉丹坊 · 丹药：修炼辅助丹药蹭热度
    { stockId: 'stock-yunmeng-herb', direction: 'bullish', strength: 1, reason: '丹药原材料需求小幅增长' },  // 云梦药畦 · 灵植：丹药上游，跟随受益
    { stockId: 'stock-xinghe-auction', direction: 'bullish', strength: 1, reason: '古籍秘卷成为拍卖热点' },  // 星瀚拍卖 · 拍卖：古籍拍卖受益
    { stockId: 'stock-beizhou-treasure', direction: 'bullish', strength: 1, reason: '修士云集，宝楼住宿餐饮需求增长' },  // 碧州宝楼 · 商贸：人流增长带动消费
    { stockId: 'stock-wuerdaha-trade', direction: 'neutral', strength: 1, reason: '商会无直接变化' },  // 乌尔达哈商会 · 商贸：汇兑，不受讲经影响
    { stockId: 'stock-qiankun-array', direction: 'bullish', strength: 2, reason: '讲经会场需大量阵法道具支撑，阵台订单暴增' },  // 乾坤阵台 · 阵法：会场布置需求
    { stockId: 'stock-wanjuan-academy', direction: 'bullish', strength: 3, reason: '讲经大会门票、秘卷销售收入爆发' },  // 无极书院 · 功法：事件主体，最大受益者
  ],
  possibleTwists: [
    { stockId: 'stock-wanjuan-academy', directionOverride: 'bearish', strengthOverride: 2, narrativeReason: '讲经大会上爆出学术丑闻，主讲长老被停职调查' },  // 无极书院反转：学术丑闻
    { stockId: 'stock-qiankun-array', directionOverride: 'bearish', strengthOverride: 1, narrativeReason: '会场阵法搭建时出现重大失误，阵台声誉受损' },  // 乾坤阵台反转：工程事故
  ],
};

// ==================== 导出 ====================

export const V3_SCENE_DEFINITIONS: readonly V3SceneDefinition[] = Object.freeze([
  SCENE_PEACE,
  SCENE_DEMON_TIDE,
  SCENE_PILL_BREAKTHROUGH,
  SCENE_MINERAL_DISCOVERY,
  SCENE_ACADEMY_FESTIVAL,
]);

export const V3_SCENE_BY_ID = new Map<string, V3SceneDefinition>(
  V3_SCENE_DEFINITIONS.map((scene) => [scene.id, scene] as const),
);

export const V3_SCENE_IDS = new Set(V3_SCENE_DEFINITIONS.map((s) => s.id));

/** 从可用场景池中排除指定 ID，随机选一个。 */
export const pickNextScene = (excludeSceneId: string | null, seed: number): V3SceneDefinition => {
  const available = V3_SCENE_DEFINITIONS.filter(
    (s) => s.id !== excludeSceneId,
  );
  if (available.length === 0) {
    // 理论上不会发生（至少 5 个场景），兜底返回第一个
    return V3_SCENE_DEFINITIONS[0];
  }
  return available[seed % available.length];
};

/** 校验场景定义的完整性（启动时调用）。 */
export const validateV3SceneDefinitions = (): string | null => {
  const enabledStockIds = getEnabledStockIdSet();
  for (const scene of V3_SCENE_DEFINITIONS) {
    if (scene.minTicks < 1) return `场景 ${scene.id} minTicks < 1`;
    if (scene.maxTicks <= scene.minTicks) return `场景 ${scene.id} maxTicks <= minTicks`;
    const stockIdsInScene = new Set(scene.baseDirections.map((d) => d.stockId));
    for (const stockId of enabledStockIds) {
      if (!stockIdsInScene.has(stockId)) {
        return `场景 ${scene.id} 缺少股票 ${stockId}`;
      }
    }
    for (const twist of scene.possibleTwists) {
      if (!enabledStockIds.has(twist.stockId)) {
        return `场景 ${scene.id} 反转 stockId ${twist.stockId} 不在启用列表中`;
      }
      if (twist.strengthOverride < 1 || twist.strengthOverride > V3_TWIST_MAX_STRENGTH) {
        return `场景 ${scene.id} 反转强度 ${twist.strengthOverride} 超出范围 1~${V3_TWIST_MAX_STRENGTH}`;
      }
    }
  }
  return null;
};
