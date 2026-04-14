import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const config: UserConfig = {
    plugins: [vue()],
  }

  if (mode === 'production') {
    config.esbuild = {
      drop: ['console', 'debugger'],
    } as any
  }

  return config
})
