/**
 * 认证 Store。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理用户登录/注册/角色创建/登出状态，提供角色信息刷新。
 * 2. 不做什么：不渲染登录表单，不直接操作 UI。
 *
 * 输入 / 输出：
 * - 输入：用户登录/注册/角色创建调用。
 * - 输出：user、character、isAuthenticated、hasCharacter 等 observable 状态。
 *
 * 数据流 / 状态流：
 * 构造时检查 localStorage token -> bootstrap 拉取 user + character -> 登录/注册更新 user（不返回 character）
 * -> 角色创建/refreshCharacter 更新 character。
 *
 * 复用设计说明：
 * - 替代旧 client 的 React Context AuthProvider，用 MobX observable 驱动。
 * - 认证 API 调用集中在本模块，组件层只做表单收集 + 调用 Store 方法。
 * - 被 RootStore 持有，所有需要认证状态的组件通过 RootStore 读取。
 *
 * 关键边界条件与坑点：
 * 1. bootstrap 返回 { user: { id, username }, character: { ... } | null }，character 为 null 表示无角色。
 * 2. login/register 返回 { user: { id, username }, token }，不包含 character。
 *    登录后 character 置为 null，需单独调用 refreshCharacter 获取。
 * 3. /api/character/info 和 /api/character/create 返回 { character: { spirit_stones: string, ... }, hasCharacter }，
 *    字段为 snake_case，spirit_stones 是字符串类型，必须 Number() 转换。
 * 4. refreshCharacter 静默失败，不弹错误提示。
 */

import { makeAutoObservable, runInAction } from 'mobx';
import api from '../services/api/core';

export interface UserDto {
  id: number;
  username: string;
}

export interface CharacterDto {
  id: number;
  nickname: string;
  gender: string;
  title: string | null;
  spiritStones: number;
  silver: number;
}

// 服务端 /api/character/info 返回的实际结构
interface CharacterInfoResponse {
  character: {
    id: number;
    nickname: string;
    gender: string;
    title: string | null;
    spirit_stones: string;
    silver: string;
    created_at: string;
    updated_at: string;
  };
  hasCharacter: boolean;
}

export interface AuthResult {
  success: boolean;
  message: string;
}

// 登录/注册返回的 data 结构（来自 authService.createAuthenticatedResult）
interface AuthPayload {
  user: {
    id: number;
    username: string;
  };
  token: string;
  character: {
    id: number;
    nickname: string;
    gender: string;
    title: string | null;
    spiritStones: number;
    silver: number;
  } | null;
}

// bootstrap 返回的 data 结构
interface BootstrapPayload {
  user: {
    id: number;
    username: string;
  };
  character: {
    id: number;
    nickname: string;
    gender: string;
    title: string | null;
    spiritStones: number;
    silver: number;
  } | null;
}

export class AuthStore {
  user: UserDto | null = null;
  character: CharacterDto | null = null;
  loading = true;

  constructor() {
    makeAutoObservable(this);
    this.checkInitialAuth();
  }

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  get hasCharacter(): boolean {
    return this.character !== null;
  }

  get spiritStones(): number {
    return this.character?.spiritStones ?? 0;
  }

  private async checkInitialAuth(): Promise<void> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      runInAction(() => {
        this.loading = false;
      });
      return;
    }
    await this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const response = await api.get<BootstrapPayload>('/api/auth/bootstrap');
      if (response.success) {
        runInAction(() => {
          this.user = response.data.user;
          this.character = response.data.character ?? null;
        });
      }
    } catch {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
      runInAction(() => {
        this.user = null;
        this.character = null;
      });
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  async login(username: string, password: string): Promise<AuthResult> {
    try {
      const response = await api.post<AuthPayload>('/api/auth/login', { username, password });
      if (response.success) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', response.data.token);
        }
        const raw = response.data.character;
        runInAction(() => {
          this.user = { id: response.data.user.id, username: response.data.user.username };
          this.character = raw
            ? { id: raw.id, nickname: raw.nickname, gender: raw.gender, title: raw.title, spiritStones: raw.spiritStones, silver: raw.silver }
            : null;
        });
        return { success: true, message: '登录成功' };
      }
      return { success: false, message: response.message ?? '登录失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '登录失败';
      return { success: false, message };
    }
  }

  async register(username: string, password: string): Promise<AuthResult> {
    try {
      const response = await api.post<AuthPayload>('/api/auth/register', { username, password });
      if (response.success) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', response.data.token);
        }
        runInAction(() => {
          this.user = { id: response.data.user.id, username: response.data.user.username };
          this.character = null; // register 不返回 character
        });
        return { success: true, message: '注册成功' };
      }
      return { success: false, message: response.message ?? '注册失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '注册失败';
      return { success: false, message };
    }
  }

  async createCharacter(nickname: string, gender: 'male' | 'female'): Promise<AuthResult> {
    try {
      const response = await api.post<CharacterInfoResponse>('/api/character/create', { nickname, gender });
      if (response.success) {
        runInAction(() => {
          const c = response.data.character;
          this.character = {
            id: c.id,
            nickname: c.nickname,
            gender: c.gender,
            title: c.title,
            spiritStones: Number(c.spirit_stones),
            silver: Number(c.silver ?? 0),
          };
        });
        return { success: true, message: '角色创建成功' };
      }
      return { success: false, message: response.message ?? '角色创建失败' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '角色创建失败';
      return { success: false, message };
    }
  }

  logout = (): void => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
    this.user = null;
    this.character = null;
  };

  async refreshCharacter(): Promise<void> {
    try {
      const response = await api.get<CharacterInfoResponse>('/api/character/info');
      if (response.success) {
        runInAction(() => {
          const c = response.data.character;
          this.character = {
            id: c.id,
            nickname: c.nickname,
            gender: c.gender,
            title: c.title,
            spiritStones: Number(c.spirit_stones),
            silver: Number(c.silver ?? 0),
          };
        });
      }
    } catch {
      // 静默失败
    }
  }
}
