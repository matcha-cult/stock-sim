import { defineConfig, loadEnv } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginLess } from '@rsbuild/plugin-less';

export default defineConfig(({ mode }) => {
  const { parsed } = loadEnv({ cwd: process.cwd(), mode });
  console.log(`Loaded environment variables for mode "${mode}":`, parsed);
  return {
    plugins: [pluginReact(), pluginLess()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    html: {
      template: './index.html',
    },
    source: {
      alias: {
        '@': './src',
      },
      entry: {
        index: './src/main.tsx',
      },
      define: {
        'process.env.API_URL': JSON.stringify(parsed.API_URL ?? 'http://localhost:3000'),
      },
    },
  };
});
