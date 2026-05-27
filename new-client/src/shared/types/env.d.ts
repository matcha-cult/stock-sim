/// <reference types="@rsbuild/core/types" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      API_URL?: string;
    }
  }
}

export {};
