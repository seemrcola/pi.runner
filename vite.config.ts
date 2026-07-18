import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import electron, { type ElectronOptions } from 'vite-plugin-electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createPreloadTarget(input: string): ElectronOptions {
  return {
    onstart({ reload }) {
      reload()
    },
    vite: {
      build: {
        outDir: 'dist/electron',
        emptyOutDir: false,
        rolldownOptions: {
          input,
          platform: 'node',
          output: {
            format: 'cjs',
            codeSplitting: false,
            entryFileNames: '[name].mjs',
            chunkFileNames: '[name].mjs',
            assetFileNames: '[name].[ext]',
          },
        },
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-backend/**', '**/dist-electron/**'],
  },
  build: {
    outDir: 'dist/renderer',
    rolldownOptions: {
      onLog(level, log, handler) {
        const message = String(log.message ?? '')
        if (
          level === 'warn' &&
          log.code === 'INVALID_ANNOTATION' &&
          message.includes('node_modules/@vueuse/core/')
        ) {
          return
        }
        handler(level, log)
      },
      output: {
        codeSplitting: {
          groups: [
            { name: 'vue-vendor', test: /node_modules\/(vue|@vue|reka-ui)\// },
            { name: 'markdown-vendor', test: /node_modules\/(marked|marked-highlight|highlight\.js|dompurify)\// },
          ],
        },
      },
    },
  },
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist/electron',
            emptyOutDir: false,
            rolldownOptions: {
              platform: 'node',
            },
          },
        },
      },
      createPreloadTarget('electron/preload.ts'),
      createPreloadTarget('electron/petPreload.ts'),
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
})
