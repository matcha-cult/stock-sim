# 灵田杂交系统 V4 设计文档

> 基于 V3 的重构，引入特性（traits）系统和元素抵消机制。

## 一、核心概念

### 1.1 特性（traits）

每个作物可以具有多个特性标签，用于杂交配方匹配。

**示例**：
| 作物 | 特性 | 元素 |
|------|------|------|
| 灵稻（rice_basic） | ["禾本"] | [] |
| 灵根·金（spirit_root_gold） | ["灵根", "金灵"] | ["金"] |
| 灵根·木（spirit_root_wood） | ["灵根", "木灵"] | ["木"] |
| 金灵稻（jin_ling_rice） | ["禾本"] | ["金"] |
| 碧粳稻（bi_jing_rice） | ["禾本"] | ["水", "木"] |
| 七星稻（qi_xing_rice） | ["禾本", "七星"] | [] |

**关键点**：
- **"金灵"特性只有灵根·金具有**，金灵稻不具有"金灵"特性
- 杂交产物继承"禾本"特性，但不继承"X灵"特性
- 这样可以防止特性无限传播，灵根作物是特性的唯一来源

### 1.2 杂交基础规则

1. **只有无属性作物才能作为父本触发杂交**（element = []）
2. 杂交在**种植时判定**，成功则记录 `pending_hybrid_seed`
3. 杂交种子在**收获时发放**（需满足金光变或优质品质条件）
4. 发放的种子是**第一代**（generation = 1）

---

## 二、杂交配方示例

### 2.1 金灵稻配方

**目标**：灵稻（无属性）+ 相邻有金灵特性作物 → 金灵稻种子

**配方定义**：
```json
{
  "recipeId": "hybrid_jin_ling_rice",
  "name": "金灵稻",
  "description": "灵稻受金灵根影响，孕育金灵稻",
  "baseCropId": "rice_basic",
  "requiredAdjacent": [
    {
      "type": "elementCondition",
      "conditionId": "single_element_invasion",
      "element": "金"
    }
  ],
  "resultCropId": "jin_ling_rice",
  "resultSeedItemId": "seed_jin_ling_rice",
  "resultQuantity": 1
}
```

**解释**：
- `baseCropId: "rice_basic"`：明确指定父本是灵稻（无属性）
- `requiredAdjacent`：使用"单元素入侵"条件，动态指定元素为"金"
- 检查相邻是否有金元素（灵根·金具有金元素）
- 所以必须在灵稻旁边种灵根·金才能触发杂交

**种植布局示例**：
```
[灵根·金] [灵稻] [空地]
           ↑
      种下灵稻时，
      相邻有灵根·金（金灵特性），
      触发杂交 → pending_hybrid_seed = seed_jin_ling_rice
```

### 2.2 碧粳稻配方

**目标**：灵稻（无属性）+ 相邻有水灵 + 木灵特性作物 → 碧粳稻种子

**配方定义**：
```json
{
  "recipeId": "hybrid_bi_jing_rice",
  "name": "碧粳稻",
  "description": "水木相生，孕育碧粳稻",
  "baseCropId": "rice_basic",
  "requiredAdjacent": [
    {
      "type": "elementCondition",
      "conditionId": "dual_element_generation",
      "elements": ["水", "木"]
    }
  ],
  "resultCropId": "bi_jing_rice",
  "resultSeedItemId": "seed_bi_jing_rice",
  "resultQuantity": 1
}
```

**解释**：
- 使用"元素相生"条件，动态指定元素为 ["水", "木"]
- 水生木，符合五行相生规律
- 检查相邻是否同时有水和木元素

**解释**：
- 相邻需要同时有"水灵"和"木灵"特性的作物
- 灵根·水具有"水灵"特性，灵根·木具有"木灵"特性
- 碧粳稻不具有"水灵"/"木灵"特性，不能作为特性来源
- 所以必须在灵稻旁边种灵根·水和灵根·木才能触发杂交

**种植布局示例**：
```
[灵根·水] [灵稻] [灵根·木]
           ↑
      种下灵稻时，
      相邻有灵根·水（水灵）+ 灵根·木（木灵），
      触发杂交 → pending_hybrid_seed = seed_bi_jing_rice
```

### 2.3 七星稻配方

**目标**：灵稻（无属性）+ 相邻至少 4 个禾本特性作物 + 五行元素抵消归零 → 七星稻种子

**配方定义**：
```json
{
  "recipeId": "hybrid_qi_xing_rice",
  "name": "七星稻",
  "description": "禾本汇聚，五行归元",
  "baseCropId": "rice_basic",
  "requiredAdjacent": [
    {
      "type": "trait",
      "value": "禾本",
      "minCount": 4
    },
    {
      "type": "elementCondition",
      "conditionId": "wu_xing_gui_yuan"
    }
  ],
  "resultCropId": "qi_xing_rice",
  "resultSeedItemId": "seed_qi_xing_rice",
  "resultQuantity": 1
}
```

**解释**：
- `trait: "禾本"`：相邻至少 4 个有"禾本"特性的作物
- `elementCondition: "wu_xing_gui_yuan"`：相邻作物的元素经过五行相克抵消后归零

**元素抵消规则（五行归元）**：
- 五行相克：木→土→水→火→金→木
- 收集所有相邻作物带来的元素影响（去重）
- 如果五种元素（金、木、水、火、土）全部出现 → 形成完整相克循环 → 全部抵消归零
- **不需要考虑元素数量**，只要五种元素都出现即可

**种植布局示例（成功 - 简化版）**：
```
        [碧粳稻]
        [水+木]
[金灵稻] [灵稻] [火灵稻]
[金]       ↑      [火]
        [土灵稻]
        [土]

种下灵稻时：
- 相邻 4 个禾本作物（碧粳稻、金灵稻、火灵稻、土灵稻）✓
- 受影响元素：水、木、金、火、土（五种齐全）✓
- 五行调和 → 归零 ✓
- 触发杂交 → pending_hybrid_seed = seed_qi_xing_rice
```

**种植布局示例（成功 - 完整版）**：
```
        [碧粳稻]
        [水+木]
[玄冰稻] [灵稻] [青炎稻]
[金+水]   ↑      [木+火]
        [炎土稻]
        [火+土]

种下灵稻时：
- 相邻 4 个禾本作物（碧粳稻、青炎稻、炎土稻、玄冰稻）✓
- 受影响元素：水、木、金、火、土（五种齐全）✓
- 五行调和 → 归零 ✓
- 触发杂交 → pending_hybrid_seed = seed_qi_xing_rice
```

**种植布局示例（失败 - 缺少元素）**：
```
        [碧粳稻]
        [水+木]
[金灵稻] [灵稻] [火灵稻]
[金]       ↑      [火]
        [空地]

种下灵稻时：
- 相邻 3 个禾本作物（碧粳稻、金灵稻、火灵稻）✓
- 受影响元素：水、木、金、火（缺少土）✗
- 不满足五行调和
```

---

## 三、元素抵消条件

### 3.1 设计原则

元素条件**不定义在 JSON 配置中**，而是硬编码在 TypeScript 工具类中。JSON 配置只需要通过 `conditionId` 引用条件即可。

**理由**：
- 元素条件是固定的业务逻辑，不需要动态配置
- 硬编码在代码中便于维护和调试
- 配方只需要引用 conditionId，保持配置简洁

### 3.2 条件定义（代码中）

在 `farmHybridService.ts` 或新建 `farmElementConditionService.ts` 中硬编码：

```typescript
// 条件 ID 常量
export const ELEMENT_CONDITIONS = {
  SINGLE_ELEMENT_INVASION: 'single_element_invasion',
  DUAL_ELEMENT_GENERATION: 'dual_element_generation',
  WU_XING_GUI_YUAN: 'wu_xing_gui_yuan',
} as const;

// 条件判定函数
export function checkElementCondition(
  conditionId: string,
  adjacentCrops: CropConfig[],
  params?: { element?: string; elements?: string[] }
): boolean {
  switch (conditionId) {
    case ELEMENT_CONDITIONS.SINGLE_ELEMENT_INVASION:
      return checkSingleElementInvasion(adjacentCrops, params?.element);
    case ELEMENT_CONDITIONS.DUAL_ELEMENT_GENERATION:
      return checkDualElementGeneration(adjacentCrops, params?.elements);
    case ELEMENT_CONDITIONS.WU_XING_GUI_YUAN:
      return checkWuXingGuiYuan(adjacentCrops);
    default:
      return false;
  }
}

// 单元素入侵：检查是否有指定元素
function checkSingleElementInvasion(adjacentCrops: CropConfig[], element?: string): boolean {
  if (!element) return false;
  return adjacentCrops.some(crop => crop.element.includes(element as CropElement));
}

// 元素相生：检查是否同时有两种元素
function checkDualElementGeneration(adjacentCrops: CropConfig[], elements?: string[]): boolean {
  if (!elements || elements.length !== 2) return false;
  const hasElement = (elem: string) => adjacentCrops.some(crop => crop.element.includes(elem as CropElement));
  return hasElement(elements[0]) && hasElement(elements[1]);
}

// 五行归元：检查五种元素是否全部出现
function checkWuXingGuiYuan(adjacentCrops: CropConfig[]): boolean {
  const elementSet = new Set<string>();
  for (const crop of adjacentCrops) {
    for (const elem of crop.element) {
      elementSet.add(elem);
    }
  }
  const requiredElements = ['金', '木', '水', '火', '土'];
  return requiredElements.every(elem => elementSet.has(elem));
}
```

**算法**：
```typescript
function checkWuXingGuiYuan(adjacentCrops: CropConfig[]): boolean {
  // 收集所有相邻作物带来的元素（去重）
  const elements = new Set<string>();
  for (const crop of adjacentCrops) {
    for (const elem of crop.element) {
      elements.add(elem);
    }
  }
  
  // 检查是否五种元素全部出现
  const requiredElements = ['金', '木', '水', '火', '土'];
  for (const elem of requiredElements) {
    if (!elements.has(elem)) {
      return false;
    }
  }
  
  // 五种元素齐全，形成完整相克循环，全部抵消
  return true;
}
```

---

## 四、杂交触发流程

### 4.1 种植时判定

```
种下作物 A：
1. 检查 A.element 是否为空（无属性）
   - 如果不是无属性 → 不触发杂交（结束）
   
2. 查找所有匹配的配方：
   - 配方的 baseCropId === A.cropId
   
3. 对每个配方，检查相邻作物是否满足 requiredAdjacent：
   - trait 条件：相邻有 N 个具有指定特性的作物
   - element 条件：相邻有 N 个具有指定元素的作物
   - elementCondition：相邻作物的元素经过抵消后满足条件
   
4. 多配方匹配时，按产物稀有度排序，选择最高的

5. 记录 pending_hybrid_seed（不立即发放）
```

### 4.2 收获时发放

```
收获作物 A：
1. 检查是否有 pending_hybrid_seed
   - 如果没有 → 不发放杂交种子
   
2. 检查是否满足发放条件：
   - 金光变（mutation_type = 'gold'）→ 发放
   - 优质品质（quality = 'hq'）→ 发放
   - 否则 → 不发放
   
3. 发放种子到种子袋（generation = 1）
```

---

## 五、配置结构

### 5.1 作物配置（crops.json）

新增 `traits` 字段：
```json
{
  "cropId": "rice_basic",
  "name": "灵稻",
  "traits": ["禾本"],
  "element": [],
  ...
}
```

```json
{
  "cropId": "spirit_root_gold",
  "name": "灵根·金",
  "traits": ["灵根", "金灵"],
  "element": ["金"],
  ...
}
```

```json
{
  "cropId": "jin_ling_rice",
  "name": "金灵稻",
  "traits": ["禾本"],
  "element": ["金"],
  ...
}
```

### 5.2 杂交配方（hybridRecipes.json）

新格式：
```json
{
  "recipeId": "hybrid_jin_ling_rice",
  "name": "金灵稻",
  "baseCropId": "rice_basic",
  "requiredAdjacent": [
    {
      "type": "trait",
      "value": "金灵",
      "minCount": 1
    }
  ],
  "resultCropId": "jin_ling_rice",
  "resultSeedItemId": "seed_jin_ling_rice",
  "resultQuantity": 1
}
```

### 5.3 元素条件（可选，用于前端展示）

如果需要在前端展示条件信息，可以保留 `elementConditions.json`，但只用于展示，不参与业务逻辑：

```json
{
  "conditions": [
    {
      "conditionId": "single_element_invasion",
      "name": "元素入侵",
      "description": "受单一元素影响"
    },
    {
      "conditionId": "dual_element_generation",
      "name": "元素相生",
      "description": "受两个相生元素影响"
    },
    {
      "conditionId": "wu_xing_gui_yuan",
      "name": "五行归元",
      "description": "五行元素齐全，相克抵消归零"
    }
  ]
}
```

**注意**：条件的判定逻辑硬编码在 TypeScript 中，JSON 配置仅用于前端展示条件名称和描述。

---

## 六、条件类型

### 6.1 trait 条件

检查相邻作物中具有指定特性的数量：
```json
{
  "type": "trait",
  "value": "金灵",
  "minCount": 1
}
```

### 6.2 element 条件

检查相邻作物中具有指定元素的数量：
```json
{
  "type": "element",
  "value": "金",
  "minCount": 1
}
```

### 6.3 elementCondition 条件

引用预定义的元素条件，支持动态指定元素：

**单元素条件**（如"单元素入侵"）：
```json
{
  "type": "elementCondition",
  "conditionId": "single_element_invasion",
  "element": "金"
}
```

**双元素条件**（如"元素相生"）：
```json
{
  "type": "elementCondition",
  "conditionId": "dual_element_generation",
  "elements": ["水", "木"]
}
```

**多元素条件**（如"五行归元"）：
```json
{
  "type": "elementCondition",
  "conditionId": "wu_xing_gui_yuan"
}
```

这种设计允许同一个条件被多个配方复用，只需改变 `element` 或 `elements` 参数。

---

## 七、实施步骤

### Phase 1：配置层面

1. 在 `crops.json` 中为所有作物添加 `traits` 字段
2. 创建 `elementConditions.json`（已完成）
3. 更新 `hybridRecipes.json` 为新格式

### Phase 2：类型定义

1. 在 `farmTypes.ts` 中添加：
   - `CropConfig.traits: string[]`
   - `RequiredAdjacentCondition` 类型（trait/element/elementCondition）
   - `elementCondition` 类型需要支持可选的 `element`（单元素）和 `elements`（多元素）字段
   - `ElementConditionConfig` 类型
   - 更新 `HybridRecipeConfig`：保留 `baseCropId`，新增 `requiredAdjacent`

### Phase 3：配置加载

1. 在 `farmConfigLoader.ts` 中：
   - 可选：加载 `elementConditions.json`（仅用于前端展示）
   - 构建 `elementConditionById` Map 索引（如果需要）

### Phase 4：条件判定逻辑

1. 新建 `farmElementConditionService.ts` 或在 `farmHybridService.ts` 中：
   - 定义条件 ID 常量（SINGLE_ELEMENT_INVASION、DUAL_ELEMENT_GENERATION、WU_XING_GUI_YUAN）
   - 实现条件判定函数（checkElementCondition）
   - 实现各个条件的具体判定逻辑

### Phase 5：杂交判定

1. 在 `farmHybridService.ts` 中：
   - 实现基于特性的父本匹配
   - 实现相邻条件判定（trait/element/elementCondition）
   - 实现元素抵消算法

---

## 八、关键设计决策

### 8.1 为什么只有无属性作物才能触发杂交？

- 无属性作物"灵气纯净"，能够融合其他作物的特性
- 有属性作物"灵气不纯"，无法引发杂交
- 这符合修仙世界观中的"无极生太极"理念

### 8.2 为什么用特性（traits）而不是直接指定作物 ID？

- 更灵活：一个配方可以匹配多种作物
- 扩展性：未来加新作物只需定义特性，不需要修改配方
- 组合性：可以基于任意特性组合创造新玩法

### 8.3 为什么元素抵消基于五行相克？

- 符合中国传统五行理论
- 增加策略深度：玩家需要计算元素平衡
- 直观易懂：相克关系容易理解

---

## 九、测试要点

### 9.1 金灵稻杂交

- [ ] 灵稻 + 相邻灵根·金 → 触发杂交
- [ ] 灵稻 + 相邻无金灵特性作物 → 不触发
- [ ] 有属性作物（如金灵稻）种下 → 不触发杂交

### 9.2 碧粳稻杂交

- [ ] 灵稻 + 相邻灵根·水 + 灵根·木 → 触发
- [ ] 灵稻 + 相邻只有灵根·水 → 不触发
- [ ] 灵稻 + 相邻只有灵根·木 → 不触发

### 9.3 七星稻杂交

- [ ] 灵稻 + 4 个禾本作物 + 五行归元 → 触发
- [ ] 灵稻 + 4 个禾本作物 + 元素未归零 → 不触发
- [ ] 灵稻 + 3 个禾本作物 + 五行归元 → 不触发（数量不足）

### 9.4 五行归元算法

- [ ] 五种元素齐全（金、木、水、火、土）→ 归零
- [ ] 缺少一种元素（如无土）→ 不归零
- [ ] 元素数量不影响结果（只要五种都出现即可）
- [ ] 碧粳稻[水,木] + 金灵稻[金] + 火灵稻[火] + 土灵稻[土] → 归零（五种齐全）

---

**文档版本**：V4.0  
**最后更新**：2026-06-17  
**状态**：待审批
