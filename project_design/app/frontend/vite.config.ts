import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// 빌드마다 고유한 타임스탬프 생성 → Vite 해시가 바뀌도록 강제
const BUILD_TS = Date.now();

// ── HMR 호스트 자동 감지 ────────────────────────────────────
// 로컬(localhost), 샌드박스(*.sandbox.novita.ai), 기타 환경 모두 대응
// VITE_HMR_HOST 환경변수로 명시적 지정 가능 (CI/CD 등)
const hmrHost = process.env.VITE_HMR_HOST || undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ── 개발 서버 (npm run dev) ────────────────────────────────
  server: {
    host: true,         // 0.0.0.0 - 외부 접속 허용
    port: 8080,
    strictPort: true,
    allowedHosts: 'all',

    // HMR: VITE_HMR_HOST 지정 시 해당 호스트, 미지정 시 Vite 기본값(자동)
    hmr: hmrHost
      ? { host: hmrHost, protocol: 'wss', clientPort: 443 }
      : true,

    // 백엔드 프록시 (개발 시 Vite:8080 → FastAPI:8000)
    proxy: {
      '/api':    { target: 'http://localhost:8000', changeOrigin: true },
      '/auth':   { target: 'http://localhost:8000', changeOrigin: true },
      '/admin':  { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
    },

    watch: { usePolling: true, interval: 600 },
  },

  // ── 프리뷰 서버 (npm run preview) ─────────────────────────
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: 'all',
  },

  // ── 프로덕션 빌드 (npm run build) ─────────────────────────
  build: {
    rollupOptions: {
      output: {
        // 빌드 타임스탬프를 파일명에 포함 → CDN 캐시 강제 무효화
        entryFileNames: `assets/[name]-[hash]-${BUILD_TS}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_TS}.js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
        manualChunks: {
          'react-vendor':  ['react', 'react-dom'],
          'router-vendor': ['react-router-dom'],
          'ui-vendor': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-label',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
            '@radix-ui/react-tooltip',
          ],
          'form-vendor':   ['react-hook-form', '@hookform/resolvers', 'zod'],
          'utils-vendor':  ['axios', 'clsx', 'tailwind-merge', 'class-variance-authority', 'date-fns', 'lucide-react'],
          'query-vendor':  ['@tanstack/react-query'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
