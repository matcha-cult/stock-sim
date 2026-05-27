/**
 * 静态定义索引共享工厂
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：把“静态定义数组 -> 按 id 读取的只读索引”抽成共享工厂，统一处理索引构建与缓存复用。
 * 2. 做什么：允许调用方注入过滤条件，把 enabled、可见性等高频规则集中在单一入口定义。
 * 3. 不做什么：不负责加载静态配置，也不决定具体业务模块的过滤口径。
 *
 * 输入/输出：
 * - 输入：定义加载函数 `loadDefinitions`，以及定义是否纳入索引的判断函数 `include`。
 * - 输出：返回一个 getter；调用 getter 可得到 `ReadonlyMap<string, T>`。
 *
 * 数据流/状态流：
 * staticConfigLoader 暴露定义数组 -> 本工厂按数组引用判断是否重建 -> 业务模块读取只读索引。
 *
 * 关键边界条件与坑点：
 * 1. 缓存失效必须依赖“源数组引用变化”，否则静态配置 reload 后会继续命中旧索引。
 * 2. 工厂不做额外兜底过滤，所有业务口径都必须由调用方显式传入，避免不同场景互相污染。
 */

export type StaticDefinitionIndexEntry = {
  id: string;
};

type DefinitionSnapshot<T extends StaticDefinitionIndexEntry> = {
  source: readonly T[];
  byId: ReadonlyMap<string, T>;
};

type CreateStaticDefinitionIndexGetterOptions<T extends StaticDefinitionIndexEntry> = {
  loadDefinitions: () => readonly T[];
  include: (definition: T) => boolean;
};

const buildStaticDefinitionMap = <T extends StaticDefinitionIndexEntry>(
  definitions: readonly T[],
  include: (definition: T) => boolean,
): ReadonlyMap<string, T> => {
  const byId = new Map<string, T>();
  for (const definition of definitions) {
    if (!include(definition)) continue;
    byId.set(definition.id, definition);
  }
  return byId;
};

export const createStaticDefinitionIndexGetter = <T extends StaticDefinitionIndexEntry>(
  options: CreateStaticDefinitionIndexGetterOptions<T>,
): (() => ReadonlyMap<string, T>) => {
  let snapshot: DefinitionSnapshot<T> | null = null;

  return (): ReadonlyMap<string, T> => {
    const definitions = options.loadDefinitions();
    if (snapshot?.source !== definitions) {
      snapshot = {
        source: definitions,
        byId: buildStaticDefinitionMap(definitions, options.include),
      };
    }
    return snapshot.byId;
  };
};
