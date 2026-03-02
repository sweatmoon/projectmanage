import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Index from './pages/Index';
import ProjectDetail from './pages/ProjectDetail';
import StaffingRowDetail from './pages/StaffingRowDetail';
import PersonDetail from './pages/PersonDetail';
import NotFound from './pages/NotFound';
import AuthCallback from './pages/AuthCallback';
import AdminPage from './pages/AdminPage';
import { client, authStore } from './lib/api';

const queryClient = new QueryClient();

// ── 인증 가드 ───────────────────────────────────────────────
function AuthGuard({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    async function check() {
      // OIDC_ISSUER_URL이 없으면 dev mode → /auth/dev-login으로 토큰 발급
      // /auth/login에 GET 요청으로 OIDC 설정 여부 확인 (503=미설정=dev mode)
      let isDevMode = import.meta.env.DEV || window.location.hostname === 'localhost';
      if (!isDevMode) {
        try {
          const res = await fetch('/auth/login', { method: 'GET', redirect: 'manual' });
          // 503 = OIDC 미설정 = dev mode, 307/302 = OIDC 설정됨 = 프로덕션
          if (res.status === 503 || res.type === 'opaqueredirect') {
            // opaqueredirect = manual redirect = OIDC 설정된 리다이렉트
            isDevMode = res.status === 503;
          }
        } catch { isDevMode = true; /* 네트워크 오류면 dev mode 가정 */ }
      }

      if (authStore.isLoggedIn()) {
        if (!authStore.getUser()) {
          const user = await client.auth.getMe();
          if (user) authStore.setUser(user);
        }
        const user = authStore.getUser();
        if (requireAdmin && user?.role !== 'admin') {
          window.location.href = '/';
          return;
        }
        setAuthed(true);
      } else if (isDevMode) {
        // dev mode: 토큰 없으면 dev-login으로 자동 발급
        if (!authStore.isLoggedIn()) {
          window.location.href = '/auth/dev-login';
          return;
        }
        setAuthed(true);
      } else {
        window.location.href = '/auth/login';
        return;
      }
      setChecking(false);
    }
    check();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">인증 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!authed) return null;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          {/* 인증 콜백 (공개) */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* 인증 필요 경로 */}
          <Route path="/" element={<AuthGuard><Index /></AuthGuard>} />
          <Route path="/project/:id" element={<AuthGuard><ProjectDetail /></AuthGuard>} />
          <Route path="/project/:id/staffing" element={<AuthGuard><StaffingRowDetail /></AuthGuard>} />
          <Route path="/person/:id" element={<AuthGuard><PersonDetail /></AuthGuard>} />

          {/* 관리자 전용 */}
          <Route path="/admin" element={<AuthGuard requireAdmin><AdminPage /></AuthGuard>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
