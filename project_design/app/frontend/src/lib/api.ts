/**
 * REST API client
 * - JWT 토큰 자동 첨부 (localStorage)
 * - 401 응답 시 자동 로그인 리다이렉트
 */
import axios from 'axios';

const V1_ENTITIES = '/api/v1/entities';

// ── 토큰 관리 ──────────────────────────────────────────────
const TOKEN_KEY = 'app_token';
const USER_KEY = 'app_user';

export interface AppUser {
  user_id: string;
  email: string;
  name: string;
  role: string;
}

export const authStore = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  getUser(): AppUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  setUser(user: AppUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    // JWT exp 검사
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },
};

// URL에서 토큰 파라미터 처리 (콜백 후)
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    authStore.setToken(tokenFromUrl);
    // URL에서 token 파라미터 제거
    urlParams.delete('token');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    window.history.replaceState({}, '', newUrl);
  }
}

// ── Axios 인스턴스 ─────────────────────────────────────────
const http = axios.create({ baseURL: '/' });

// 요청 인터셉터: 토큰 자동 첨부
http.interceptors.request.use((config) => {
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
  projects: `${V1_ENTITIES}/projects`,
  people: `${V1_ENTITIES}/people`,
  phases: `${V1_ENTITIES}/phases`,
  staffing: `${V1_ENTITIES}/staffing`,
  calendar_entries: `${V1_ENTITIES}/calendar_entries`,
};

interface QueryOptions {
  query?: Record<string, any>;
  limit?: number;
  sort?: string;
  skip?: number;
}

interface EntityResponse<T = any> {
  data: { items: T[]; total?: number; };
}

interface SingleEntityResponse<T = any> {
  data: T;
}

function createEntityClient(entityName: string) {
  const basePath = ENTITY_PATHS[entityName];
  if (!basePath) throw new Error(`Unknown entity: ${entityName}`);

  return {
    async query(options: QueryOptions = {}): Promise<EntityResponse> {
      const params: Record<string, any> = {};
      if (options.query && Object.keys(options.query).length > 0) {
        params.query = JSON.stringify(options.query);
      }
      if (options.limit) params.limit = options.limit;
      if (options.sort) params.sort = options.sort;
      if (options.skip) params.skip = options.skip;
      const res = await http.get(basePath, { params });
      const rawData = res.data;
      if (Array.isArray(rawData)) return { data: { items: rawData, total: rawData.length } };
      if (rawData && Array.isArray(rawData.items)) return { data: rawData };
      return { data: { items: rawData || [], total: 0 } };
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

interface ApiCallOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: any;
  params?: Record<string, any>;
}

// ── Auth 클라이언트 ────────────────────────────────────────
const authClient = {
  login() {
    // 시놀로지 로그인 페이지로 리다이렉트
    window.location.href = '/auth/login';
  },
  logout() {
    authStore.clearToken();
    window.location.href = '/auth/logout';
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
  getUser: () => authStore.getUser(),
};

export const client = {
  entities: {
    projects: createEntityClient('projects'),
    people: createEntityClient('people'),
    phases: createEntityClient('phases'),
    staffing: createEntityClient('staffing'),
    calendar_entries: createEntityClient('calendar_entries'),
  },

  apiCall: {
    async invoke({ url, method, data, params }: ApiCallOptions) {
      const res = await http.request({ url, method, data, params });
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
    async getAuditLogs(params?: {
      event_type?: string;
      entity_type?: string;
      project_id?: number;
      user_id?: string;
      entity_id?: string;
      is_system_action?: boolean;
      date_from?: string;
      date_to?: string;
      search?: string;
      skip?: number;
      limit?: number;
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
      const token = localStorage.getItem('token') ?? '';
      const base = http.defaults.baseURL ?? '';
      const qs = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== '') qs.append(k, String(v));
        });
      }
      return `${base}/admin/audit/export/csv?${qs.toString()}&_token=${token}`;
    },
    async triggerArchive(months = 6) {
      const res = await http.post('/admin/audit/archive', null, { params: { months } });
      return res.data;
    },
  },
};
