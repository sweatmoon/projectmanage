/**
 * useUserRole - 현재 로그인 사용자의 역할(role)을 반환하는 훅
 *
 * role: 'admin' | 'user' | 'viewer' | 'audit_viewer'
 *
 * 사용 예시:
 *   const { role, isViewer, canWrite } = useUserRole();
 *   <button disabled={!canWrite}>저장</button>
 */

import { authStore } from '@/lib/api';

export interface UserRoleInfo {
  role: string;
  isAdmin: boolean;
  isViewer: boolean;        // viewer = 조회 전용
  canWrite: boolean;        // viewer가 아니면 쓰기 가능
}

export function useUserRole(): UserRoleInfo {
  const user = authStore.getUser();
  const role = user?.role ?? 'user';

  return {
    role,
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    canWrite: role !== 'viewer',
  };
}
