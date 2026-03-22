import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import {
  Shield, Users, Activity, LogIn, Clock, RefreshCw,
  ChevronDown, ChevronUp, Search, Download, Archive,
  FileText, GitBranch, Filter, X, ChevronLeft, ChevronRight,
  UserCheck, ToggleLeft, ToggleRight, Trash2, PlusCircle, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

// ── 타입 ────────────────────────────────────────────────────
interface Stats {
  total_users: number;
  total_logins_today: number;
  total_api_calls_today: number;
  active_users_7days: number;
}

interface LogItem {
  id: number;
  timestamp: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  ip_address: string | null;
  user_agent: string | null;
  duration_ms: number | null;
}

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string | null;
  last_login: string | null;
}

interface AuditLogItem {
  id: number;
  event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  project_id: number | null;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  timestamp: string;
  client_ip: string | null;
  user_agent: string | null;
  request_path: string | null;
  request_id: string | null;
  before_data: string | null;
  after_data: string | null;
  changed_fields: string | null;
  is_system_action: boolean;
  description: string | null;
}

interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  skip: number;
  limit: number;
  has_more: boolean;
}

type TabType = 'stats' | 'logs' | 'users' | 'audit' | 'allowlist';

interface AllowedUserItem {
  id: number;
  user_id: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  note: string | null;
}

// ── 유틸 ────────────────────────────────────────────────────
function formatDateTime(dt: string | null) {
  if (!dt) return '-';
  return new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function eventTypeBadge(et: string) {
  const map: Record<string, string> = {
    CREATE:          'bg-green-100 text-green-700',
    UPDATE:          'bg-blue-100 text-blue-700',
    DELETE:          'bg-red-100 text-red-700',
    RESTORE:         'bg-teal-100 text-teal-700',
    STATUS_CHANGE:   'bg-yellow-100 text-yellow-700',
    BULK_IMPORT:     'bg-indigo-100 text-indigo-700',
    BULK_OVERWRITE:  'bg-orange-100 text-orange-700',
    SYNC:            'bg-cyan-100 text-cyan-700',
    LOGIN:           'bg-green-100 text-green-800',
    LOGOUT:          'bg-gray-100 text-gray-600',
    USER_ROLE_CHANGE:'bg-purple-100 text-purple-700',
    ROLLBACK:        'bg-orange-200 text-orange-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[et] ?? 'bg-gray-100 text-gray-500'}`}>
      {et}
    </span>
  );
}

function entityTypeBadge(et: string) {
  const map: Record<string, string> = {
    project:        'bg-blue-50 text-blue-600',
    phase:          'bg-purple-50 text-purple-600',
    staffing:       'bg-orange-50 text-orange-600',
    calendar_entry: 'bg-teal-50 text-teal-600',
    people:         'bg-pink-50 text-pink-600',
    user:           'bg-gray-50 text-gray-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[et] ?? 'bg-gray-50 text-gray-500'}`}>
      {et}
    </span>
  );
}

function actionBadge(action: string) {
  const map: Record<string, string> = {
    login: 'bg-green-100 text-green-700',
    logout: 'bg-gray-100 text-gray-600',
    api: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[action] ?? 'bg-gray-100 text-gray-500'}`}>
      {action}
    </span>
  );
}

function statusBadge(code: number | null) {
  if (!code) return null;
  const color = code < 300 ? 'text-green-600' : code < 400 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`text-xs font-mono ${color}`}>{code}</span>;
}

// ── JSON Diff 뷰어 ──────────────────────────────────────────
function JsonDiffViewer({ before, after, changed }: { before: string | null; after: string | null; changed: string | null }) {
  let changedObj: Record<string, { before: unknown; after: unknown }> = {};
  try { changedObj = changed ? JSON.parse(changed) : {}; } catch { /* noop */ }

  let beforeObj: Record<string, unknown> = {};
  let afterObj:  Record<string, unknown> = {};
  try { beforeObj = before ? JSON.parse(before) : {}; } catch { /* noop */ }
  try { afterObj  = after  ? JSON.parse(after)  : {}; } catch { /* noop */ }

  const changedKeys = Object.keys(changedObj);

  if (changedKeys.length === 0 && !before && !after) return null;

  return (
    <div className="mt-2 space-y-1">
      {changedKeys.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">변경된 필드:</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-2 py-1 text-gray-500 font-medium w-32">필드</th>
                <th className="text-left px-2 py-1 text-red-600 font-medium">이전</th>
                <th className="text-left px-2 py-1 text-green-600 font-medium">이후</th>
              </tr>
            </thead>
            <tbody>
              {changedKeys.map(k => (
                <tr key={k} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-mono text-gray-600">{k}</td>
                  <td className="px-2 py-1 font-mono bg-red-50 text-red-700 break-all">{JSON.stringify(changedObj[k].before)}</td>
                  <td className="px-2 py-1 font-mono bg-green-50 text-green-700 break-all">{JSON.stringify(changedObj[k].after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {before && (
            <div>
              <div className="text-xs font-semibold text-red-600 mb-1">이전 상태</div>
              <pre className="bg-red-50 text-red-700 text-xs p-2 rounded overflow-auto max-h-32 font-mono">{JSON.stringify(beforeObj, null, 2)}</pre>
            </div>
          )}
          {after && (
            <div>
              <div className="text-xs font-semibold text-green-600 mb-1">이후 상태</div>
              <pre className="bg-green-50 text-green-700 text-xs p-2 rounded overflow-auto max-h-32 font-mono">{JSON.stringify(afterObj, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 감사 로그 필터 컴포넌트 ──────────────────────────────────
interface AuditFilters {
  event_type: string;
  entity_type: string;
  project_id: string;
  user_id: string;
  search: string;
  date_from: string;
  date_to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  event_type: '', entity_type: '', project_id: '', user_id: '',
  search: '', date_from: '', date_to: '',
};

const EVENT_TYPES = ['CREATE','UPDATE','DELETE','RESTORE','STATUS_CHANGE','BULK_IMPORT','BULK_OVERWRITE','SYNC','LOGIN','LOGOUT','USER_ROLE_CHANGE'];
const ENTITY_TYPES = ['project','phase','staffing','calendar_entry','people','user'];

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function AdminPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'login' | 'api'>('all');
  const [loading, setLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  // 허용 사용자 상태
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserItem[]>([]);
  const [allowForm, setAllowForm] = useState({ user_id: '', display_name: '', role: 'user', note: '' });
  const [allowSaving, setAllowSaving] = useState(false);

  // 감사 로그 상태
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSkip, setAuditSkip] = useState(0);
  const AUDIT_LIMIT = 50;
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [auditSearch, setAuditSearch] = useState('');
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ── fetch 함수들 ───────────────────────────────────────────
  const fetchStats = async () => {
    try { setStats(await client.admin.getStats()); }
    catch { toast.error('통계 로드 실패'); }
  };

  const fetchLogs = async (filter = logFilter) => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? { action: filter, limit: 200 } : { limit: 200 };
      setLogs(await client.admin.getLogs(params));
    } catch { toast.error('로그 로드 실패'); }
    finally { setLoading(false); }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try { setUsers(await client.admin.getUsers()); }
    catch { toast.error('사용자 목록 로드 실패'); }
    finally { setLoading(false); }
  };

  const fetchAllowedUsers = async () => {
    setLoading(true);
    try { setAllowedUsers(await client.admin.getAllowedUsers()); }
    catch { toast.error('허용 사용자 목록 로드 실패'); }
    finally { setLoading(false); }
  };

  const handleAddAllowedUser = async () => {
    if (!allowForm.user_id.trim()) { toast.error('Synology 계정 ID를 입력하세요.'); return; }
    setAllowSaving(true);
    try {
      await client.admin.addAllowedUser({
        user_id: allowForm.user_id.trim(),
        display_name: allowForm.display_name.trim() || undefined,
        role: allowForm.role,
        note: allowForm.note.trim() || undefined,
      });
      toast.success(`${allowForm.user_id} 추가됨`);
      setAllowForm({ user_id: '', display_name: '', role: 'user', note: '' });
      fetchAllowedUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '추가 실패');
    } finally { setAllowSaving(false); }
  };

  const handleUpdateAllowedUserRole = async (userId: string, role: string) => {
    try {
      await client.admin.updateAllowedUser(userId, { role });
      toast.success('권한이 변경되었습니다.');
      fetchAllowedUsers();
    } catch { toast.error('권한 변경 실패'); }
  };

  const handleToggleAllowedUser = async (userId: string, isActive: boolean) => {
    try {
      await client.admin.updateAllowedUser(userId, { is_active: !isActive });
      toast.success(isActive ? '비활성화되었습니다.' : '활성화되었습니다.');
      fetchAllowedUsers();
    } catch { toast.error('상태 변경 실패'); }
  };

  const handleDeleteAllowedUser = async (userId: string) => {
    if (!confirm(`${userId} 을(를) 허용 목록에서 삭제하시겠습니까?`)) return;
    try {
      await client.admin.deleteAllowedUser(userId);
      toast.success('삭제되었습니다.');
      fetchAllowedUsers();
    } catch { toast.error('삭제 실패'); }
  };

  const fetchAuditLogs = useCallback(async (skip = 0) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        skip, limit: AUDIT_LIMIT,
      };
      if (auditFilters.event_type)  params.event_type  = auditFilters.event_type;
      if (auditFilters.entity_type) params.entity_type = auditFilters.entity_type;
      if (auditFilters.project_id)  params.project_id  = Number(auditFilters.project_id);
      if (auditFilters.user_id)     params.user_id     = auditFilters.user_id;
      if (auditFilters.search)      params.search      = auditFilters.search;
      if (auditFilters.date_from)   params.date_from   = new Date(auditFilters.date_from).toISOString();
      if (auditFilters.date_to)     params.date_to     = new Date(auditFilters.date_to).toISOString();

      const res: AuditLogListResponse = await client.admin.getAuditLogs(params);
      setAuditLogs(res.items);
      setAuditTotal(res.total);
      setAuditSkip(skip);
    } catch { toast.error('감사 로그 로드 실패'); }
    finally { setLoading(false); }
  }, [auditFilters]);

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => {
    if (activeTab === 'logs')      fetchLogs();
    if (activeTab === 'users')     fetchUsers();
    if (activeTab === 'stats')     fetchStats();
    if (activeTab === 'audit')     fetchAuditLogs(0);
    if (activeTab === 'allowlist') fetchAllowedUsers();
  }, [activeTab]);

  // ── 역할 변경 ──────────────────────────────────────────────
  const handleRoleChange = async (userId: string, currentRole: string) => {
    const roles = ['user', 'viewer', 'admin', 'audit_viewer'];
    const roleNames = { user: '일반사용자', viewer: '뷰어', admin: '관리자', audit_viewer: '감사자' };
    const nextRole = roles[(roles.indexOf(currentRole) + 1) % roles.length];
    if (!confirm(`역할을 '${roleNames[nextRole as keyof typeof roleNames]}'(으)로 변경하시겠습니까?`)) return;
    try {
      await client.admin.updateUserRole(userId, nextRole);
      toast.success('역할이 변경되었습니다.');
      fetchUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '역할 변경 실패');
    }
  };

  // ── CSV 다운로드 ──────────────────────────────────────────
  const handleExportCsv = () => {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (auditFilters.event_type)  params.event_type  = auditFilters.event_type;
    if (auditFilters.entity_type) params.entity_type = auditFilters.entity_type;
    if (auditFilters.project_id)  params.project_id  = Number(auditFilters.project_id);
    if (auditFilters.user_id)     params.user_id     = auditFilters.user_id;
    if (auditFilters.search)      params.search      = auditFilters.search;
    if (auditFilters.date_from)   params.date_from   = new Date(auditFilters.date_from).toISOString();
    if (auditFilters.date_to)     params.date_to     = new Date(auditFilters.date_to).toISOString();
    params.limit = 5000;
    const url = client.admin.getAuditExportUrl(params);
    window.open(url, '_blank');
  };

  // ── 아카이브 실행 ──────────────────────────────────────────
  const handleArchive = async () => {
    if (!confirm('12개월 이상 된 감사 로그를 아카이브 테이블로 이관하시겠습니까?')) return;
    try {
      const res = await client.admin.triggerArchive(12);
      toast.success(res.message);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '아카이브 실패');
    }
  };

  // ── 단건 롤백 ────────────────────────────────────────────
  const handleRollback = async (log: AuditLogItem) => {
    const rollbackTargets = ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'];
    if (!rollbackTargets.includes(log.event_type)) {
      toast.error(`'${log.event_type}' 이벤트는 롤백할 수 없습니다.`);
      return;
    }
    const entityLabel = log.description ?? `${log.entity_type}(${log.entity_id})`;
    if (!confirm(
      `[롤백 확인]\n\n` +
      `"${entityLabel}"\n\n` +
      `이 작업을 이전 상태로 되돌리겠습니까?\n` +
      `(${log.event_type} 이벤트 → 복원)\n\n` +
      `⚠️ 이 작업은 즉시 DB에 반영되며 되돌릴 수 없습니다.`
    )) return;
    try {
      const res = await client.admin.rollbackAuditLog(log.event_id);
      toast.success(
        `롤백 완료: ${res.entity_type}/${res.entity_id} — 복원 필드: ${res.rolled_back_fields.join(', ')}`
      );
      fetchAuditLogs(auditSkip); // 목록 새로고침
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '롤백 실패');
    }
  };

  const auditTotalPages = Math.ceil(auditTotal / AUDIT_LIMIT);
  const auditCurrentPage = Math.floor(auditSkip / AUDIT_LIMIT) + 1;

  // ── 렌더링 ────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors mr-2"
          title="홈으로"
        >
          <ChevronLeft className="w-5 h-5" />
          홈
        </button>
        <Shield className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-gray-900">관리자 페이지</h1>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'stats', label: '대시보드', icon: Activity },
          { key: 'audit', label: '감사 로그', icon: FileText },
          { key: 'logs',  label: '접속 로그', icon: LogIn },
          { key: 'users', label: '사용자 관리', icon: Users },
          { key: 'allowlist', label: '접근 허용 목록', icon: UserCheck },
        ] as { key: TabType; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── 대시보드 탭 ── */}
      {activeTab === 'stats' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={fetchStats} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: '전체 사용자',      value: stats.total_users,           color: 'bg-blue-50 text-blue-700',   icon: Users },
                { label: '오늘 로그인',      value: stats.total_logins_today,    color: 'bg-green-50 text-green-700', icon: LogIn },
                { label: '오늘 API 호출',    value: stats.total_api_calls_today, color: 'bg-yellow-50 text-yellow-700', icon: Activity },
                { label: '7일 활성 사용자',  value: stats.active_users_7days,    color: 'bg-purple-50 text-purple-700', icon: Clock },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className={`rounded-xl p-5 ${color}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-5 h-5 opacity-70" />
                    <span className="text-sm font-medium opacity-80">{label}</span>
                  </div>
                  <div className="text-3xl font-bold">{value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          )}
        </div>
      )}

      {/* ── 감사 로그 탭 ── */}
      {activeTab === 'audit' && (
        <div>
          {/* 툴바 */}
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            {/* 검색창 */}
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="설명, 변경값, 사용자 검색..."
                value={auditFilters.search}
                onChange={e => setAuditFilters(f => ({ ...f, search: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && fetchAuditLogs(0)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showFilters ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Filter className="w-4 h-4" /> 필터
              </button>
              <button
                onClick={() => fetchAuditLogs(0)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700"
              >
                <Search className="w-4 h-4" /> 검색
              </button>
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
              >
                <Download className="w-4 h-4" /> CSV
              </button>
              <button
                onClick={handleArchive}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-100 text-orange-700 text-sm font-medium hover:bg-orange-200"
              >
                <Archive className="w-4 h-4" /> 아카이브
              </button>
              <button onClick={() => fetchAuditLogs(0)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 고급 필터 패널 */}
          {showFilters && (
            <div className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">이벤트 타입</label>
                  <select
                    value={auditFilters.event_type}
                    onChange={e => setAuditFilters(f => ({ ...f, event_type: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  >
                    <option value="">전체</option>
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">엔티티 타입</label>
                  <select
                    value={auditFilters.entity_type}
                    onChange={e => setAuditFilters(f => ({ ...f, entity_type: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  >
                    <option value="">전체</option>
                    {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">프로젝트 ID</label>
                  <input
                    type="number"
                    placeholder="숫자 입력"
                    value={auditFilters.project_id}
                    onChange={e => setAuditFilters(f => ({ ...f, project_id: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">사용자 ID</label>
                  <input
                    type="text"
                    placeholder="사용자 ID"
                    value={auditFilters.user_id}
                    onChange={e => setAuditFilters(f => ({ ...f, user_id: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">시작일 (KST)</label>
                  <input
                    type="datetime-local"
                    value={auditFilters.date_from}
                    onChange={e => setAuditFilters(f => ({ ...f, date_from: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">종료일 (KST)</label>
                  <input
                    type="datetime-local"
                    value={auditFilters.date_to}
                    onChange={e => setAuditFilters(f => ({ ...f, date_to: e.target.value }))}
                    className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => { setAuditFilters(EMPTY_FILTERS); fetchAuditLogs(0); }}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
                >
                  <X className="w-3.5 h-3.5" /> 필터 초기화
                </button>
              </div>
            </div>
          )}

          {/* 총 건수 */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              총 <strong>{auditTotal.toLocaleString()}</strong>건
              {auditTotal > 0 && (
                <span className="ml-2 text-xs">
                  {auditCurrentPage} / {auditTotalPages} 페이지
                </span>
              )}
            </span>
          </div>

          {/* 테이블 */}
          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3 text-gray-600 font-medium w-36">시간 (KST)</th>
                    <th className="text-left px-3 py-3 text-gray-600 font-medium">이벤트</th>
                    <th className="text-left px-3 py-3 text-gray-600 font-medium">대상</th>
                    <th className="text-left px-3 py-3 text-gray-600 font-medium">사용자</th>
                    <th className="text-left px-3 py-3 text-gray-600 font-medium">설명</th>
                    <th className="px-3 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 py-8">감사 로그가 없습니다</td></tr>
                  ) : auditLogs.map(log => (
                    <>
                      <tr
                        key={log.event_id}
                        className={`hover:bg-gray-50 transition-colors cursor-pointer ${log.is_system_action ? 'bg-gray-50/50' : ''}`}
                        onClick={() => setExpandedAudit(expandedAudit === log.event_id ? null : log.event_id)}
                      >
                        <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          {formatDateTime(log.timestamp)}
                          {log.is_system_action && (
                            <span className="ml-1 px-1 py-0.5 bg-gray-200 text-gray-500 text-xs rounded">시스템</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            {eventTypeBadge(log.event_type)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            {entityTypeBadge(log.entity_type)}
                            {log.entity_id && (
                              <span className="text-xs text-gray-400 font-mono">#{log.entity_id}</span>
                            )}
                            {log.project_id && (
                              <span className="text-xs text-blue-400">P{log.project_id}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-700 text-xs">{log.user_name ?? '-'}</div>
                          <div className="text-xs text-gray-400">{log.user_id ?? ''}</div>
                          {log.user_role && (
                            <span className="text-xs text-purple-500">[{log.user_role}]</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 max-w-xs truncate">
                          {log.description ?? '-'}
                        </td>
                        <td className="px-3 py-2.5">
                          <button className="text-gray-400 hover:text-gray-600">
                            {expandedAudit === log.event_id
                              ? <ChevronUp className="w-4 h-4" />
                              : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>

                      {/* 확장 상세 행 */}
                      {expandedAudit === log.event_id && (
                        <tr key={`${log.event_id}-detail`} className="bg-blue-50/30">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-3">
                              {/* 메타 정보 */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-400">Event ID: </span>
                                  <span className="font-mono text-gray-600 break-all">{log.event_id}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Request ID: </span>
                                  <span className="font-mono text-gray-600">{log.request_id ?? '-'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">IP: </span>
                                  <span className="font-mono text-gray-600">{log.client_ip ?? '-'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">경로: </span>
                                  <span className="font-mono text-gray-600">{log.request_path ?? '-'}</span>
                                </div>
                              </div>

                              {/* Diff 뷰어 */}
                              {(log.changed_fields || log.before_data || log.after_data) && (
                                <JsonDiffViewer
                                  before={log.before_data}
                                  after={log.after_data}
                                  changed={log.changed_fields}
                                />
                              )}

                              {/* 롤백 버튼 */}
                              {['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE'].includes(log.event_type) && (
                                <div className="pt-2 border-t border-blue-100">
                                  <button
                                    onClick={() => handleRollback(log)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                               bg-orange-50 text-orange-700 border border-orange-200
                                               hover:bg-orange-100 transition-colors"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    이 시점으로 롤백
                                  </button>
                                  <p className="mt-1 text-xs text-gray-400">
                                    ⚠️ 이 레코드를 해당 이벤트 발생 직전 상태로 복원합니다. 신중하게 사용하세요.
                                  </p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 페이지네이션 */}
          {auditTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => fetchAuditLogs(Math.max(0, auditSkip - AUDIT_LIMIT))}
                disabled={auditSkip === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:bg-gray-100"
              >
                <ChevronLeft className="w-4 h-4" /> 이전
              </button>
              <span className="text-sm text-gray-600">
                {auditCurrentPage} / {auditTotalPages}
              </span>
              <button
                onClick={() => fetchAuditLogs(auditSkip + AUDIT_LIMIT)}
                disabled={!auditLogs.length || auditLogs.length < AUDIT_LIMIT}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:bg-gray-100"
              >
                다음 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 접속 로그 탭 ── */}
      {activeTab === 'logs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              {(['all', 'login', 'api'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setLogFilter(f); fetchLogs(f); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    logFilter === f ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'all' ? '전체' : f === 'login' ? '로그인' : 'API'}
                </button>
              ))}
            </div>
            <button onClick={() => fetchLogs()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">시간</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">사용자</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">액션</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">경로</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">상태</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">IP</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">응답시간</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-gray-400 py-8">로그가 없습니다</td></tr>
                  ) : logs.map(log => (
                    <>
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{formatDateTime(log.timestamp)}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-800">{log.user_name ?? '-'}</div>
                          <div className="text-xs text-gray-400">{log.user_email ?? ''}</div>
                        </td>
                        <td className="px-4 py-2.5">{actionBadge(log.action)}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-xs text-gray-500 font-mono">
                            {log.method && <span className="text-purple-600 mr-1">{log.method}</span>}
                            {log.path ?? '-'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">{statusBadge(log.status_code)}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{log.ip_address ?? '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{log.duration_ms != null ? `${log.duration_ms}ms` : '-'}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {expandedLog === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                      {expandedLog === log.id && (
                        <tr key={`${log.id}-expand`} className="bg-gray-50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">User Agent: </span>
                              <span className="font-mono break-all">{log.user_agent ?? '-'}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 사용자 관리 탭 ── */}
      {activeTab === 'users' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={fetchUsers} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">사용자</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">ID</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">역할</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">가입일</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">마지막 접속</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">역할 변경</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 py-8">사용자가 없습니다</td></tr>
                  ) : users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{user.name ?? '-'}</div>
                        <div className="text-xs text-gray-400">{user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{user.id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          user.role === 'admin'        ? 'bg-purple-100 text-purple-700' :
                          user.role === 'audit_viewer' ? 'bg-blue-100 text-blue-700'    :
                                                         'bg-gray-100 text-gray-600'
                        }`}>
                          {user.role === 'audit_viewer' ? '감사자' : user.role === 'admin' ? '관리자' : user.role === 'viewer' ? '뷰어' : '일반'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.last_login)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRoleChange(user.id, user.role)}
                          className="px-3 py-1 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                        >
                          역할 변경
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      {/* ── 접근 허용 목록 탭 ── */}
      {activeTab === 'allowlist' && (
        <div>
          {/* 안내 배너 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
            <strong>접근 허용 목록</strong>이 비어 있으면 모든 Synology 계정으로 로그인이 가능합니다.
            사용자를 한 명이라도 추가하면, 목록에 있는 계정만 접근할 수 있습니다.
          </div>

          {/* 추가 폼 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-purple-500" />
              새 허용 사용자 추가
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Synology 계정 ID <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={allowForm.user_id}
                  onChange={e => setAllowForm(f => ({ ...f, user_id: e.target.value }))}
                  placeholder="예: john"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">표시 이름 (선택)</label>
                <input
                  type="text"
                  value={allowForm.display_name}
                  onChange={e => setAllowForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="예: 홍길동"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">권한</label>
                <select
                  value={allowForm.role}
                  onChange={e => setAllowForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  <option value="user">일반사용자</option>
                  <option value="viewer">뷰어 (조회만)</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">메모 (선택)</label>
                <input
                  type="text"
                  value={allowForm.note}
                  onChange={e => setAllowForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="예: 개발팀"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleAddAllowedUser}
                disabled={allowSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                <PlusCircle className="w-4 h-4" />
                {allowSaving ? '추가 중...' : '추가'}
              </button>
            </div>
          </div>

          {/* 목록 */}
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-500">총 {allowedUsers.length}명 등록됨</span>
            <button onClick={fetchAllowedUsers} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12">로딩 중...</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">계정 ID</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">표시 이름</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">권한</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">상태</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">메모</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">등록일</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allowedUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-gray-400 py-10">
                        등록된 허용 사용자가 없습니다.<br />
                        <span className="text-xs text-gray-300">현재 모든 Synology 계정이 접근 가능합니다.</span>
                      </td>
                    </tr>
                  ) : allowedUsers.map(u => (
                    <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-mono font-medium text-gray-800">{u.user_id}</td>
                      <td className="px-4 py-3 text-gray-600">{u.display_name || '-'}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          onChange={e => handleUpdateAllowedUserRole(u.user_id, e.target.value)}
                          className={`px-2 py-1 rounded text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                            u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                            u.role === 'viewer' ? 'bg-blue-100 text-blue-600' :
                            'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <option value="user">일반사용자</option>
                          <option value="viewer">뷰어 (조회만)</option>
                          <option value="admin">관리자</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleAllowedUser(u.user_id, u.is_active)}
                          className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors ${u.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-500 hover:bg-red-200'}`}
                        >
                          {u.is_active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          {u.is_active ? '활성' : '비활성'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{u.note || '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDateTime(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteAllowedUser(u.user_id)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
