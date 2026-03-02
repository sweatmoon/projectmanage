import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Index from './pages/Index';
import ProjectDetail from './pages/ProjectDetail';
import StaffingRowDetail from './pages/StaffingRowDetail';
import PersonDetail from './pages/PersonDetail';
import NotFound from './pages/NotFound';
import AuthCallback from './pages/AuthCallback';
import AdminPage from './pages/AdminPage';
import { client, authStore } from './lib/api';

const queryClient = new QueryClient();

// ── auth_error 파라미터 처리 (콜백 오류 시 백엔드에서 리다이렉트) ──
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const authError = urlParams.get('auth_error');
  if (authError) {
    urlParams.delete('auth_error');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', newUrl);
    // React 마운트 후 토스트 표시
    setTimeout(() => {
      toast.error(`로그인 오류: ${decodeURIComponent(authError)}`, { duration: 8000 });
    }, 500);
  }
}

// ── 인증 가드 ───────────────────────────────────────────────
function AuthGuard({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    async function check() {
      // localhost/DEV 빌드가 아니면 무조건 프로덕션 OIDC 사용
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const isDevBuild  = import.meta.env.DEV === true;
      const isDevMode   = isLocalhost && isDevBuild;

      if (authStore.isLoggedIn()) {
        // 토큰 유효성 서버에서 재확인
        try {
          const user = await client.auth.getMe();
          if (!user) {
            // 서버가 토큰 거부 → 강제 로그아웃
            authStore.clearToken();
            window.location.href = isDevMode ? '/auth/dev-login' : '/auth/login';
            return;
          }
          authStore.setUser(user);
          if (requireAdmin && user.role !== 'admin') {
            window.location.href = '/';
            return;
          }
          setAuthed(true);
        } catch {
          authStore.clearToken();
          window.location.href = isDevMode ? '/auth/dev-login' : '/auth/login';
          return;
        }
      } else if (isDevMode) {
        window.location.href = '/auth/dev-login';
        return;
      } else {
        window.location.href = '/auth/login';
        return;
      }
      setChecking(false);
    }
    check();
  }, [requireAdmin]);

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
