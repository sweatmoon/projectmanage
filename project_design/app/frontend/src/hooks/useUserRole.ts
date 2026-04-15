/**
 * useUserRole - 현재 로그인 사용자의 역할(role)을 반환하는 훅
 *
 * role: 'admin' | 'leader' | 'user' | 'viewer' | 'audit_viewer' | 'writer'
 *
 * ─────────────────────────────────────────────────────────────────────────
 * writer(작성자) 역할 권한 상세:
 *
 *   ✅ 제안리스크 탭 → 모든 기능 허용
 *      - 목록/상세/일정 조회
 *      - 시뮬레이션 (인력 제외 후 리스크 재계산 — DB 변경 없음)
 *      - 텍스트 출력 (배치 결과를 텍스트 형식으로 변환 — DB 변경 없음)
 *
 *   ✅ 사업별 일정(gantt) 탭 → 읽기 전용 조회 허용 (인력 정보 숨김)
 *      - 단계 막대/기간/공수 조회 가능
 *      - 인력 수/이름 등 인력 정보는 표시 안 함
 *      - 단계 수정 불가 (readOnly 모드)
 *
 *   ❌ 그 외 탭(홈·프로젝트·인력별일정·인력·리포트) → 메뉴에서 숨김
 *      - URL 직접 접근 시에도 proposal-risk로 리다이렉트
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 사용 예시:
 *   const { role, isViewer, canWrite, isWriter } = useUserRole();
 *   <button disabled={!canWrite}>저장</button>
 *   {!isWriter && <Button>인력 추가</Button>}
 */

import { authStore } from '@/lib/api';

export interface UserRoleInfo {
  role: string;
  isAdmin: boolean;
  isViewer: boolean;        // viewer = 전체 조회 전용 (쓰기 일체 불가)
  isWriter: boolean;        // writer = 제안리스크 작성자 (proposal-risk + gantt 탭 허용)
  canWrite: boolean;        // 일반 쓰기 가능 여부 (viewer/writer면 false)
  /** writer가 접근 가능한 탭 목록 */
  writerAllowedTabs: string[];
}

export function useUserRole(): UserRoleInfo {
  const user = authStore.getUser();
  const role = user?.role ?? 'user';
  const isWriter = role === 'writer';

  return {
    role,
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    isWriter,
    // viewer와 writer는 일반적인 데이터 쓰기(추가/수정/삭제) 불가
    canWrite: role !== 'viewer' && role !== 'writer',
    // writer가 접근 가능한 탭: 제안리스크 + 사업별일정(인력 정보 숨김 읽기 전용)
    writerAllowedTabs: ['proposal-risk', 'gantt'],
  };
}
