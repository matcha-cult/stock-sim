# seed-admin 前端 antd 紧凑模式改造计划

## 背景

当前 seed-admin 前端页面存在以下问题：
1. 未使用 antd 紧凑模式（compact theme）
2. 过度使用 div+css 实现布局，未充分利用 antd 组件
3. 页面顶部标题栏统一使用 `div style={{ display: "flex" }}` 实现，应改为 antd `Flex` 组件

## 改造范围

仅涉及 `seed-admin/src/app` 下的页面文件，共 5 个页面：

| 序号 | 页面 | 文件路径 | 状态 |
|------|------|----------|------|
| 1 | 全局配置 | `src/components/AntdProvider.tsx` | ✅ 已完成 |
| 2 | 首页仪表盘 | `src/app/page.tsx` | ✅ 已完成 |
| 3 | 作物管理 | `src/app/farm/crops/page.tsx` | ✅ 已完成 |
| 4 | 种子管理 | `src/app/farm/seeds/page.tsx` | ✅ 已完成 |
| 5 | 杂交配方 | `src/app/farm/hybrid-recipes/page.tsx` | ✅ 已完成 |
| 6 | 全局配置页面 | `src/app/farm/global-config/page.tsx` | ✅ 已完成 |

## 改造内容

### 1. 全局配置（AntdProvider.tsx）

**当前问题：**
- 使用 `theme.defaultAlgorithm`，未启用紧凑模式

**改造方案：**
```typescript
// 修改前
theme={{
  algorithm: theme.defaultAlgorithm,
}}

// 修改后
theme={{
  algorithm: theme.compactAlgorithm,
}}
```

### 2. 首页仪表盘（page.tsx）

**当前问题：**
- 第 93-103 行：顶部标题栏使用 `<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>`
- 外层使用 `<div>` 包裹，可改为 antd `Flex` 或保持 div（语义化）

**改造方案：**
```typescript
// 修改前
<div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
  <h1 style={{ margin: 0 }}>仪表盘</h1>
  <Space>...</Space>
</div>

// 修改后
<Flex justify="space-between" align="center" style={{ marginBottom: 24 }}>
  <Typography.Title level={3} style={{ margin: 0 }}>仪表盘</Typography.Title>
  <Space>...</Space>
</Flex>
```

### 3. 作物管理 / 种子管理 / 杂交配方 / 全局配置页面

这 4 个页面结构相似，统一改造：

**当前问题（以 crops/page.tsx 为例）：**
- 第 206 行：顶部标题栏使用 `<div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>`

**改造方案：**
```typescript
// 修改前
<div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
  <h1 style={{ margin: 0 }}>作物管理</h1>
  <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
    新增作物
  </Button>
</div>

// 修改后
<Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
  <Typography.Title level={3} style={{ margin: 0 }}>作物管理</Typography.Title>
  <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
    新增作物
  </Button>
</Flex>
```

## 执行顺序

1. ✅ 全局配置（AntdProvider.tsx）— 启用紧凑模式
2. ✅ 首页仪表盘
3. ✅ 作物管理
4. ✅ 种子管理
5. ✅ 杂交配方
6. ✅ 全局配置页面

## 验收标准

- 所有页面使用 antd 紧凑模式
- 顶部标题栏统一使用 `Flex` + `Typography.Title` 组件
- 禁止在页面中使用 `div style={{ display: "flex" }}` 实现布局
- `tsc -b` 校验通过
- 页面功能不受影响，仅布局优化

---

**更新时间：** 2026-06-16
