# 灵田模板种植功能 — TCC 事务模型实现计划

## Context（背景）

用户希望新增一键模板种植功能，允许玩家保存种植布局为模板，后续可一键应用。该功能需要：
1. 新增数据库表存储玩家的种植模板
2. 使用 TCC（Try-Confirm-Cancel）两段式事务模型保证资源一致性
3. 要么全部种植成功，要么全部失败（原子性保证）

## 一、数据库设计

### 1.1 模板表 `farm_plant_template`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 模板 ID |
| character_id | INT NOT NULL | 玩家 ID（外键关联 characters） |
| name | VARCHAR(100) NOT NULL | 模板名称 |
| description | VARCHAR(255) | 模板描述（可选） |
| created_at | TIMESTAMP(6) | 创建时间 |
| updated_at | TIMESTAMP(6) | 更新时间 |

### 1.2 模板项表 `farm_plant_template_item`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 项 ID |
| template_id | INT NOT NULL | 模板 ID（外键关联 farm_plant_template） |
| row_offset | SMALLINT NOT NULL | 行偏移（相对于模板起点） |
| col_offset | SMALLINT NOT NULL | 列偏移（相对于模板起点） |
| seed_item_id | VARCHAR(64) NOT NULL | 种子 itemId（非 seed_inventory.id） |
| mutation_type | VARCHAR(32) | 变异类型筛选（NULL 表示任意） |
| generation | INT | 代数筛选（NULL 表示任意） |

**设计说明**：模板项存储种子选择条件（itemId + 可选的 mutationType/generation），而非 seed_inventory.id。原因：

- 种子库存 ID 会随消耗而变化
- 允许玩家用同类种子替换，增加灵活性

## 二、TCC 事务流程

**核心原则**：前端只调用一个主接口（`/api/farm/template/apply`），TCC 两阶段在 service 内部通过数据库事务实现。

### 2.1 整体架构

```text
前端请求
    ↓
主事务（withTransaction）
    ├── Try 阶段：资源校验 + 锁定（子事务 1）
    ├── Confirm 阶段：执行种植（子事务 2）
    └── 失败时：Cancel（自动回滚）
```

### 2.2 Try 阶段 — 资源校验与锁定

在**子事务**中完成（嵌套事务或事务内的逻辑阶段）：

1. 校验模板存在且属于当前玩家
2. 根据模板项计算所需种子（按 itemId + mutationType + generation 分组统计数量）
3. 校验玩家等阶是否满足所有种子的 requiredTier
4. 校验目标格子（根据起始坐标 + 偏移计算）全部已解锁且为空
5. **锁定种子记录**：`SELECT ... FOR UPDATE` 锁定相关 seed_inventory 行
6. 校验种子数量充足
7. 构建种植计划数据（cell_plans）

**Try 成功**：返回种植计划，进入 Confirm 阶段
**Try 失败**：返回错误信息，主事务回滚（自动 Cancel）

### 2.3 Confirm 阶段 — 执行种植

在**同一个主事务**中继续执行：

1. 遍历 cell_plans，对每个格子：
   - 扣除种子（UPDATE farm_seed_inventory SET quantity = quantity - 1）
   - 变异判定（复用 rollMutation / rollMutationInheritance）
   - 写入格子数据（UPDATE farm_cell）
   - 杂交触发（复用 tryHybridOnPlant）
   - 记录活动日志
2. 返回种植结果

**Confirm 成功**：主事务提交
**Confirm 失败**：主事务回滚（自动 Cancel，所有操作无效）

### 2.4 Cancel 阶段 — 自动回滚

- 由数据库事务机制自动处理
- Try 或 Confirm 任何步骤失败，整个主事务回滚
- 无需手动释放资源（因为资源锁定随事务结束而释放）

### 2.5 代码结构示意

```typescript
export async function applyPlantTemplate(
  characterId: number,
  templateId: number,
  startRow: number,
  startCol: number,
): Promise<ApplyTemplateResult> {
  return withTransaction(async () => {
    // ===== Try 阶段：资源校验 =====
    const template = await getTemplateForPlant(templateId, characterId);
    if (!template) {
      throw new TemplateError('模板不存在');
    }

    // 计算所需种子并校验
    const seedRequirements = calculateSeedRequirements(template.items);
    const lockedSeeds = await lockAndValidateSeeds(characterId, seedRequirements);

    // 校验格子并构建种植计划
    const cellPlans = await validateCellsAndBuildPlans(
      characterId, template.items, startRow, startCol
    );

    // ===== Confirm 阶段：执行种植 =====
    // 如果任何一步失败，整个事务自动回滚
    const results = [];
    for (const plan of cellPlans) {
      const result = await executePlantInTransaction(
        characterId, plan.row, plan.col, plan.seedInventoryId
      );
      results.push(result);
    }

    return {
      success: true,
      message: `种植 ${results.length} 块作物成功`,
      plantedCount: results.length,
      results,
    };
  });
  // ===== Cancel：无需手动处理，事务回滚自动清理 =====
}
```

## 三、后端服务层设计

### 3.1 新增文件：`farmTemplateService.ts`

```
关键函数：
- createTemplate(characterId, name, description, items): 创建模板
- getTemplates(characterId): 获取玩家模板列表
- getTemplateDetail(templateId, characterId): 获取模板详情
- deleteTemplate(templateId, characterId): 删除模板
- applyPlantTemplate(characterId, templateId, startRow, startCol): 应用模板种植（内部实现 TCC）
```

**内部辅助函数**（不对外暴露）：

```
- getTemplateForPlant(templateId, characterId): Try 阶段 - 获取模板并校验
- calculateSeedRequirements(items): Try 阶段 - 计算所需种子
- lockAndValidateSeeds(characterId, requirements): Try 阶段 - 锁定并校验种子
- validateCellsAndBuildPlans(characterId, items, startRow, startCol): Try 阶段 - 校验格子并构建种植计划
- executePlantInTransaction(characterId, row, col, seedId): Confirm 阶段 - 执行单个种植
```

### 3.2 API 路由设计

```
POST   /api/farm/template              创建模板
GET    /api/farm/template              获取模板列表
GET    /api/farm/template/:id          获取模板详情
DELETE /api/farm/template/:id          删除模板
POST   /api/farm/template/apply        应用模板种植（内部实现 TCC 两阶段）
```

**说明**：前端只需要调用 `/apply` 接口，TCC 两阶段（Try-Confirm-Cancel）在 service 内部通过数据库事务自动实现。

## 四、前端设计

### 4.1 新增组件：`FarmTemplatePanel.tsx`

功能：

- 模板列表展示（卡片/列表形式）
- 创建模板：点击已种植的格子，自动填充种子信息
- 应用模板：选择起始格子，预览种植效果，确认后一键种植
- 删除模板

### 4.2 API 封装：`farm.ts`

```typescript
// 新增类型
export interface PlantTemplateItem {
  rowOffset: number;
  colOffset: number;
  seedItemId: string;
  mutationType: string | null;
  generation: number | null;
}

export interface PlantTemplate {
  id: number;
  name: string;
  description: string | null;
  items: PlantTemplateItem[];
  createdAt: number;
}

export interface ApplyTemplateResult {
  success: boolean;
  message: string;
  plantedCount: number;
  results: PlantResult[];
}

// 新增 API
export const createTemplate = (name: string, description: string | null, items: PlantTemplateItem[]) => ...
export const getTemplates = () => ...
export const getTemplateDetail = (id: number) => ...
export const deleteTemplate = (id: number) => ...
export const applyPlantTemplate = (templateId: number, startRow: number, startCol: number) => ...
```

### 4.3 Store 扩展：`FarmStore.ts`

```typescript
// 新增状态
templates: PlantTemplate[] = [];
templatesLoading = false;

// 新增方法
async fetchTemplates(): Promise<void>
async createTemplate(name: string, description: string | null, items: PlantTemplateItem[]): Promise<boolean>
async deleteTemplate(id: number): Promise<boolean>
async applyTemplate(templateId: number, startRow: number, startCol: number): Promise<ApplyTemplateResult | null>
```

## 五、关键文件清单

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| server/migrations/add_farm_template.sql | 新增 | 模板表（farm_plant_template + farm_plant_template_item） |
| server/src/services/farm/farmTemplateService.ts | 新增 | 模板服务（CRUD + TCC 内部实现） |
| server/src/routes/farmRoutes.ts | 修改 | 新增模板相关路由 |
| server/src/services/farm/farmService.ts | 修改 | 抽取种植核心逻辑供模板服务复用 |

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| new-client/src/services/api/farm.ts | 修改 | 新增模板 API 和类型定义 |
| new-client/src/stores/FarmStore.ts | 修改 | 新增模板状态和方法 |
| new-client/src/components/FarmPage/FarmTemplatePanel.tsx | 新增 | 模板管理面板组件 |
| new-client/src/components/FarmPage/FarmPlotsGrid.tsx | 修改 | 集成模板入口 |

## 六、验证方案

### 6.1 后端验证

1. `tsc -b` 类型检查通过
2. 手动执行 SQL 迁移脚本
3. 使用 curl/Postman 测试 API：
   - 创建模板 → 获取列表 → 获取详情 → 应用种植 → 删除模板
   - 测试资源不足场景：模板需要 5 颗种子但只有 3 颗，应返回失败且种子未扣除
   - 测试格子占用场景：模板中某个格子已被占用，应返回失败且所有操作回滚

### 6.2 前端验证

1. `tsc -b` 类型检查通过
2. 启动开发服务器（需用户授权）
3. 测试流程：
   - 种植若干格子 → 创建模板 → 铲除作物 → 应用模板 → 验证种植结果
   - 测试资源不足场景：创建需要 5 颗种子的模板，只保留 3 颗，应用时应提示失败
   - 测试事务回滚：在应用模板过程中模拟某个格子被其他玩家占用，验证所有操作回滚

## 七、性能与边界考虑

1. **索引优化**：为 template_id、character_id 建立索引
2. **并发控制**：Try 阶段使用 SELECT FOR UPDATE 锁定种子记录，防止超扣
3. **事务范围**：整个 TCC 流程（Try + Confirm）在单个数据库事务中执行，保证原子性
4. **模板数量限制**：每个玩家最多 20 个模板，每个模板最多 16 个项（4×4 网格）
5. **错误处理**：任何步骤失败，整个事务自动回滚，无需手动清理
