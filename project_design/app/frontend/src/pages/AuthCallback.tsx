/**
 * AuthCallback.tsx
 * 
 * 시놀로지 NAS OIDC 콜백 처리 페이지
 * 
 * 흐름:
 * 1. 백엔드 /auth/callback 이 시놀로지에서 code를 받아 처리
 * 2. 처리 완료 후 /?token=JWT 로 리다이렉트
 * 3. api.ts의 URL 파라미터 처리 코드가 토큰을 localStorage에 저장
 * 4. 이 페이지는 사용되지 않지만, 만약 라우팅되면 /로 리다이렉트
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authStore } from '../lib/api';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // URL에서 토큰 파라미터 확인 (api.ts에서 이미 처리되었을 수 있음)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
      // 토큰 저장 (api.ts에서 이미 처리했을 수도 있지만 안전하게 다시 저장)
      authStore.setToken(token);
      // URL에서 token 파라미터 제거 후 홈으로
      navigate('/', { replace: true });
    } else if (authStore.isLoggedIn()) {
      // 이미 로그인된 경우
      navigate('/', { replace: true });
    } else {
      // 토큰 없음 - 오류 또는 재로그인
      const error = urlParams.get('error');
      if (error) {
        navigate(`/auth/error?msg=${encodeURIComponent(error)}`, { replace: true });
      } else {
        // 백엔드 OIDC 로그인으로 리다이렉트
        window.location.href = '/auth/login';
      }
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 text-sm">로그인 처리 중...</p>
        <p className="text-gray-400 text-xs mt-1">잠시만 기다려 주세요</p>
      </div>
    </div>
  );
}
