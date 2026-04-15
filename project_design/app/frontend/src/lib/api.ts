/**
 * REST API client
 * - JWT 토큰 sessionStorage 저장 (브라우저 종료 시 자동 만료)
 * - 30분 비활성 타임아웃 (마지막 활동 기준)
 * - 401 응답 시 자동 로그인 리다이렉트
 */
import axios from 'axios';

const V1_ENTITIES = '/api/v1/entities';

// ── 스토리지 키 ────────────────────────────────────────────
// sessionStorage: 탭/브라우저 종료 시 자동 삭제
const TOKEN_KEY    = 'gantt_token_v3';
const USER_KEY     = 'gantt_user_v3';
const LAST_ACT_KEY = 'gantt_last_activity';

// 30분 비활성 타임아웃 (ms)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

// ── authStore ──────────────────────────────────────────────
export interface AppUser {
  user_id: string;
  email: string;
  name: string;
  role: string;
}

export const authStore = {
  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string) {
    sessionStorage.setItem(TOKEN_KEY, token);
    this.updateActivity();
  },
  clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(LAST_ACT_KEY);
  },
  getUser(): AppUser | null {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  setUser(user: AppUser) {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  updateActivity() {
    sessionStorage.setItem(LAST_ACT_KEY, String(Date.now()));
  },
  isInactive(): boolean {
    const last = sessionStorage.getItem(LAST_ACT_KEY);
    if (!last) return true;
    return Date.now() - Number(last) > INACTIVITY_TIMEOUT_MS;
  },
  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    // 30분 비활성 체크
    if (this.isInactive()) {
      this.clearToken();
      return false;
    }
    // JWT exp 체크
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },
};

// ── 활동 감지: 마우스/키보드 이벤트마다 lastActivity 갱신 ──
if (typeof window !== 'undefined') {
  const refreshActivity = () => {
    if (authStore.getToken()) authStore.updateActivity();
  };
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt =>
    window.addEventListener(evt, refreshActivity, { passive: true })
  );

  // 30초마다 비활성 체크 → 만료 시 자동 로그아웃
  setInterval(() => {
    if (authStore.getToken() && authStore.isInactive()) {
      authStore.clearToken();
      window.location.href = '/auth/login';
    }
  }, 30_000);
}

// ── URL에서 토큰 파라미터 처리 (로그인 콜백 후) ───────────
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    authStore.setToken(tokenFromUrl);
    urlParams.delete('token');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', newUrl);
  }
}

// ── Axios 인스턴스 ─────────────────────────────────────────
const http = axios.create({ baseURL: '/' });

// 요청 인터셉터: 토큰 자동 첨부 + 활동 갱신
http.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    authStore.updateActivity();
  }
  return config;
});

// 응답 인터셉터: 401 시 로그인 페이지로
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.response?.data?.auth_required) {
      authStore.clearToken();
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

// ── Entity 클라이언트 ──────────────────────────────────────
const ENTITY_PATHS: Record<string, string> = {
  projects:        `${V1_ENTITIES}/projects`,
  people:          `${V1_ENTITIES}/people`,
  phases:          `${V1_ENTITIES}/phases`,
  staffing:        `${V1_ENTITIES}/staffing`,
  calendar_entries:`${V1_ENTITIES}/calendar_entries`,
};

interface QueryOptions {
  query?: Record<string, any>;
  limit?: number;
  sort?: string;
  skip?: number;
}
interface EntityResponse<T = any>       { data: { items: T[]; total?: number }; }
interface SingleEntityResponse<T = any> { data: T; }

function createEntityClient(entityName: string) {
  const basePath = ENTITY_PATHS[entityName];
  if (!basePath) throw new Error(`Unknown entity: ${entityName}`);
  return {
    async query(options: QueryOptions = {}): Promise<EntityResponse> {
      const params: Record<string, any> = {};
      if (options.query && Object.keys(options.query).length > 0) params.query = JSON.stringify(options.query);
      if (options.limit) params.limit = options.limit;
      if (options.sort)  params.sort  = options.sort;
      if (options.skip)  params.skip  = options.skip;
      const res = await http.get(basePath, { params });
      const raw = res.data;
      if (Array.isArray(raw))              return { data: { items: raw,       total: raw.length } };
      if (raw && Array.isArray(raw.items)) return { data: raw };
      return { data: { items: raw || [], total: 0 } };
    },
    async get({ id }: { id: string }): Promise<SingleEntityResponse> {
      const res = await http.get(`${basePath}/${id}`);
      return { data: res.data };
    },
    async create({ data }: { data: Record<string, any> }): Promise<SingleEntityResponse> {
      const res = await http.post(basePath, data);
      return { data: res.data };
    },
    async update({ id, data }: { id: string; data: Record<string, any> }): Promise<SingleEntityResponse> {
      const res = await http.put(`${basePath}/${id}`, data);
      return { data: res.data };
    },
    async delete({ id }: { id: string }): Promise<void> {
      await http.delete(`${basePath}/${id}`);
    },
  };
}

// 공식 인력 변경 이력 타입
export interface StaffingChangeRecord {
  id: number;
  staffing_id: number;
  project_id: number;
  phase_id: number;
  original_person_id: number | null;
  original_person_name: string;
  new_person_id: number | null;
  new_person_name: string;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

interface ApiCallOptions {  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: any;
  params?: Record<string, any>;
}

// ── Auth 클라이언트 ────────────────────────────────────────
const authClient = {
  login() {
    window.location.href = '/auth/login';
  },
  logout() {
    authStore.clearToken();
    // /auth/login 으로 바로 보내면 Synology SSO 세션이 살아있어 자동 재로그인됨
    // → 로그아웃 완료 페이지로 이동 후 사용자가 직접 재로그인 선택
    window.location.href = '/logged-out';
  },
  async getMe(): Promise<AppUser | null> {
    try {
      const res = await http.get('/auth/me');
      const user = res.data as AppUser;
      authStore.setUser(user);
      return user;
    } catch {
      return null;
    }
  },
  isLoggedIn: () => authStore.isLoggedIn(),
  getUser:    () => authStore.getUser(),
};

// ── 전체 client export ─────────────────────────────────────
export const client = {
  entities: {
    projects:        createEntityClient('projects'),
    people:          createEntityClient('people'),
    phases:          createEntityClient('phases'),
    staffing:        createEntityClient('staffing'),
    calendar_entries:createEntityClient('calendar_entries'),
  },

  people: {
    async batchUpsert(items: Array<{
      person_name: string;
      company?: string;
      position?: string;
      grade?: string;
      employment_status?: string;
      is_chief?: boolean;
      region?: string;
      can_travel?: boolean;
    }>): Promise<{
      created: Array<{ id: number; person_name: string; company?: string; position?: string; grade?: string; employment_status?: string; is_chief?: boolean; region?: string; can_travel?: boolean }>;
      updated: Array<{ id: number; person_name: string; company?: string; position?: string; grade?: string; employment_status?: string; is_chief?: boolean; region?: string; can_travel?: boolean }>;
      skipped: string[];
    }> {
      const res = await http.post('/api/v1/entities/people/batch-upsert', { items });
      return res.data;
    },

    async remapAll(): Promise<{ remapped: number; total_people: number; unlinked: number }> {
      const res = await http.post('/api/v1/entities/people/remap-all', {});
      return res.data;
    },
  },

  apiCall: {
    async invoke({ url, method, data, params }: ApiCallOptions) {
      const res = await http.request({ url, method, data, params });
      return res.data;
    },
  },

  home: {
    async getStats() {
      const res = await http.get('/api/v1/home/stats');
      return res.data as {
        active_project_count: number;
        proposal_count: number;
        people_count: number;
        utilization_rate: number;
        utilization_numerator: number;
        utilization_denominator: number;
        auditor_count: number;
        biz_days_ytd: number;
      };
    },
  },

  holidays: {
    /** DB 저장 공휴일 목록 반환. 빈 배열이면 프론트엔드 하드코딩 폴백 사용 */
    async list(): Promise<{ date: string; name: string }[]> {
      try {
        const res = await http.get('/api/v1/holidays');
        return (res.data?.holidays ?? []) as { date: string; name: string }[];
      } catch {
        return [];
      }
    },
    /** 어드민 관리용 전체 목록 (id, source 포함) */
    async adminList(): Promise<{ id: number; date: string; name: string; source: string; updated_at: string | null }[]> {
      const res = await http.get('/api/v1/holidays/admin/list');
      return res.data?.holidays ?? [];
    },
    /** 동기화 상태 조회 (어드민용) */
    async status() {
      const res = await http.get('/api/v1/holidays/status');
      return res.data;
    },
    /** 수동 동기화 트리거 (어드민 전용) */
    async sync() {
      const res = await http.post('/api/v1/holidays/sync');
      return res.data;
    },
    /** 공휴일 수동 추가 */
    async create(date_str: string, date_name: string) {
      const res = await http.post('/api/v1/holidays', { date_str, date_name });
      return res.data;
    },
    /** 공휴일 수정 */
    async update(id: number, data: { date_str?: string; date_name?: string }) {
      const res = await http.put(`/api/v1/holidays/${id}`, data);
      return res.data;
    },
    /** 공휴일 삭제 */
    async remove(id: number) {
      const res = await http.delete(`/api/v1/holidays/${id}`);
      return res.data;
    },
  },

  auth: authClient,

  admin: {
    async getStats() {
      const res = await http.get('/admin/stats');
      return res.data;
    },
    async getLogs(params?: { action?: string; user_id?: string; limit?: number; offset?: number }) {
      const res = await http.get('/admin/logs', { params });
      return res.data;
    },
    async getUsers() {
      const res = await http.get('/admin/users');
      return res.data;
    },
    async updateUserRole(userId: string, role: string) {
      const res = await http.put(`/admin/users/${userId}/role`, { role });
      return res.data;
    },
    async deleteUser(userId: string) {
      const res = await http.delete(`/admin/users/${encodeURIComponent(userId)}`);
      return res.data;
    },
    async getAuditLogs(params?: {
      event_type?: string; entity_type?: string; project_id?: number;
      user_id?: string; entity_id?: string; is_system_action?: boolean;
      date_from?: string; date_to?: string; search?: string;
      skip?: number; limit?: number;
    }) {
      const res = await http.get('/admin/audit', { params });
      return res.data;
    },
    async getAuditLogDetail(eventId: string) {
      const res = await http.get(`/admin/audit/${eventId}`);
      return res.data;
    },
    async getEntityTimeline(entityType: string, entityId: string) {
      const res = await http.get(`/admin/audit/timeline/${entityType}/${entityId}`);
      return res.data;
    },
    getAuditExportUrl(params?: Record<string, string | number | boolean | undefined>) {
      const token = authStore.getToken() ?? '';
      const base  = http.defaults.baseURL ?? '';
      const qs    = new URLSearchParams();
      if (params) Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== '') qs.append(k, String(v));
      });
      // ?token= 파라미터: 미들웨어에서 Authorization 헤더 없이도 JWT 인증 허용
      return `${base}/admin/audit/export/csv?${qs.toString()}&token=${token}`;
    },
    async triggerArchive(months = 6) {
      const res = await http.post('/admin/audit/archive', null, { params: { months } });
      return res.data;
    },
    async remapStaffingPersonIds() {
      const res = await http.post('/admin/remap-staffing-person-ids');
      return res.data as { ok: boolean; remapped: number; skipped: number; message: string };
    },
    // ── 접속 허용 사용자 관리 ──────────────────────────────────
    async getAllowedUsers() {
      const res = await http.get('/admin/allowed-users');
      return res.data;
    },
    async addAllowedUser(body: { user_id: string; display_name?: string; role: string; note?: string }) {
      const res = await http.post('/admin/allowed-users', body);
      return res.data;
    },
    async updateAllowedUser(userId: string, body: { role?: string; display_name?: string; is_active?: boolean; note?: string }) {
      const res = await http.put(`/admin/allowed-users/${encodeURIComponent(userId)}`, body);
      return res.data;
    },
    async deleteAllowedUser(userId: string) {
      const res = await http.delete(`/admin/allowed-users/${encodeURIComponent(userId)}`);
      return res.data;
    },
    async rollbackAuditLog(eventId: string) {
      const res = await http.post(`/admin/audit/rollback/${encodeURIComponent(eventId)}`);
      return res.data as {
        ok: boolean;
        event_id: string;
        entity_type: string;
        entity_id: string;
        rolled_back_fields: string[];
        rollback_audit_event_id: string;
      };
    },
    async projectRollback(projectId: number) {
      const res = await http.post(`/admin/audit/project-rollback/${projectId}`);
      return res.data as {
        ok: boolean;
        project_id: number;
        restored: { project: boolean; phases: number; staffing: number; calendar: number };
        rollback_audit_event_id: string;
      };
    },
    async phaseRollback(phaseId: number) {
      const res = await http.post(`/admin/audit/phase-rollback/${phaseId}`);
      return res.data as {
        ok: boolean;
        phase_id: number;
        restored: { phase: boolean; staffing: number; calendar: number };
        rollback_audit_event_id: string;
      };
    },
    async bulkRollback(eventIds: string[]) {
      const res = await http.post('/admin/audit/bulk-rollback', { event_ids: eventIds });
      return res.data as {
        total: number;
        success: number;
        failed: number;
        results: Array<{
          event_id: string;
          entity_type: string;
          entity_id: string | null;
          ok: boolean;
          message: string;
        }>;
      };
    },
    // ── 권한 신청 대기 사용자 관리 ──────────────────────────────
    async getPendingUsers(params?: { status?: string }) {
      const res = await http.get('/admin/pending-users', { params });
      return res.data as Array<{
        id: number;
        user_id: string;
        email: string;
        name: string | null;
        status: string;
        requested_at: string | null;
        reviewed_at: string | null;
        reviewed_by: string | null;
        note: string | null;
        reject_reason: string | null;
      }>;
    },
    async getPendingCount() {
      const res = await http.get('/admin/pending-users/count');
      return res.data as { pending_count: number };
    },
    async reviewPendingUser(userId: string, body: { action: string; role?: string; reject_reason?: string }) {
      const res = await http.post(`/admin/pending-users/${encodeURIComponent(userId)}/review`, body);
      return res.data;
    },
    async deletePendingUser(userId: string) {
      const res = await http.delete(`/admin/pending-users/${encodeURIComponent(userId)}`);
      return res.data;
    },
  },

  // ── 공식 인력 변경 이력 ──────────────────────────────────────
  staffingChange: {
    async create(data: {
      staffing_id: number;
      project_id: number;
      phase_id: number;
      original_person_id: number | null;
      original_person_name: string;
      new_person_id: number | null;
      new_person_name: string;
      reason?: string;
    }) {
      const res = await http.post('/api/v1/staffing-change', data);
      return res.data as StaffingChangeRecord;
    },
    async getByProject(projectId: number) {
      const res = await http.get(`/api/v1/staffing-change/by-project/${projectId}`);
      return res.data as StaffingChangeRecord[];
    },
    async getByStaffing(staffingId: number) {
      const res = await http.get(`/api/v1/staffing-change/by-staffing/${staffingId}`);
      return res.data as StaffingChangeRecord[];
    },
    async getByPhase(phaseId: number) {
      const res = await http.get(`/api/v1/staffing-change/by-phase/${phaseId}`);
      return res.data as StaffingChangeRecord[];
    },
  },
};
