import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import {
  Shield, Users, Activity, LogIn, Clock, RefreshCw,
  ChevronDown, ChevronUp, Search, Download, Archive,
  FileText, Filter, X, ChevronLeft, ChevronRight,
  Trash2, RotateCcw,
  UserPlus, CheckCircle2, XCircle, Bell, HelpCircle,
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

type TabType = 'stats' | 'logs' | 'users' | 'audit' | 'pending';

interface PendingUserItem {
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

// ── 역할 정의 ────────────────────────────────────────────────
const ROLE_CONFIG: Record<string, {
  label: string;
  color: string;       // badge bg+text
  borderColor: string; // dropdown border
  dotColor: string;    // 설명 패널 dot
  description: string;
  permissions: string[];
}> = {
  admin: {
    label: '관리자',
    color: 'bg-purple-100 text-purple-700',
    borderColor: 'border-purple-200 hover:border-purple-400',
    dotColor: 'bg-purple-400',
    description: '시스템 전체를 관리할 수 있는 최고 권한입니다.',
    permissions: [
      '모든 사업·단계·투입공수 생성/수정/삭제',
      '달력 일정 추가/제거',
      '사용자 역할 변경 및 권한 신청 승인/거부',
      '감사 로그 조회 및 롤백',
      '접속 로그 및 통계 조회',
    ],
  },
  leader: {
    label: '리더',
    color: 'bg-indigo-100 text-indigo-700',
    borderColor: 'border-indigo-200 hover:border-indigo-400',
    dotColor: 'bg-indigo-400',
    description: '프로젝트 리더로서 일정 관리 권한을 가집니다.',
    permissions: [
      '모든 사업·단계·투입공수 조회',
      '달력 일정 추가/제거 (일반 사용자와 차별화)',
      '데이터 수정 권한 (관리자 승인 불필요)',
      '감사 로그 조회 불가',
      '사용자 관리 불가',
    ],
  },
  user: {
    label: '일반',
    color: 'bg-gray-100 text-gray-600',
    borderColor: 'border-gray-200 hover:border-gray-400',
    dotColor: 'bg-gray-400',
    description: '기본 사용자 권한으로 조회 및 일부 편집이 가능합니다.',
    permissions: [
      '사업·단계·투입공수 조회 및 편집',
      '달력 일정 조회만 가능 (추가/제거 불가)',
      '본인 프로필 조회',
      '감사 로그·접속 로그 조회 불가',
      '사용자 관리 불가',
    ],
  },
  viewer: {
    label: '뷰어',
    color: 'bg-teal-100 text-teal-700',
    borderColor: 'border-teal-200 hover:border-teal-400',
    dotColor: 'bg-teal-400',
    description: '읽기 전용 접근만 허용됩니다. 어떤 데이터도 변경할 수 없습니다.',
    permissions: [
      '모든 데이터 조회 전용 (읽기만 가능)',
      '사업·단계·투입공수 수정 불가',
      '달력 일정 추가/제거 불가',
      '관리자 기능 전체 불가',
    ],
  },
  audit_viewer: {
    label: '감사자',
    color: 'bg-blue-100 text-blue-700',
    borderColor: 'border-blue-200 hover:border-blue-400',
    dotColor: 'bg-blue-400',
    description: '감사 목적으로 로그만 열람할 수 있는 특수 역할입니다.',
    permissions: [
      '감사 로그 전체 조회',
      '접속 로그 조회',
      '사업·일정 데이터 수정 불가',
      '사용자 관리 불가',
    ],
  },
};

const ROLE_ORDER = ['user', 'leader', 'viewer', 'admin', 'audit_viewer'];

// ── 역할 드롭다운 컴포넌트 ─────────────────────────────────────
function RoleDropdown({
  userId,
  currentRole,
  onRoleChange,
  disabled = false,
}: {
  userId: string;
  currentRole: string;
  onRoleChange: (userId: string, newRole: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const cfg = ROLE_CONFIG[currentRole] ?? ROLE_CONFIG.user;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all
          ${cfg.color} ${cfg.borderColor} disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <span>{cfg.label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">역할 선택</p>
          </div>
          {ROLE_ORDER.map(role => {
            const rc = ROLE_CONFIG[role];
            const isActive = role === currentRole;
            return (
              <button
                key={role}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onRoleChange(userId, role);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors
                  ${isActive ? 'bg-gray-50' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rc.dotColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${rc.color}`}>{rc.label}</span>
                    {isActive && <span className="text-[10px] text-gray-400">현재</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug truncate">{rc.description.split('.')[0]}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 승인 드롭다운 (권한 신청 탭용) ──────────────────────────────
function ApproveDropdown({
  userId,
  onApprove,
  disabled = false,
}: {
  userId: string;
  onApprove: (userId: string, role: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const APPROVE_ROLES = ['user', 'leader', 'admin'];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        {disabled ? '처리 중...' : '승인'}
        {!disabled && <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">승인 역할 선택</p>
          </div>
          {APPROVE_ROLES.map(role => {
            const rc = ROLE_CONFIG[role];
            return (
              <button
                key={role}
                onClick={() => { setOpen(false); onApprove(userId, role); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rc.dotColor}`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${rc.color}`}>{rc.label}</span>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{rc.description.split('.')[0]}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 권한 설명 패널 ─────────────────────────────────────────────
function RoleInfoPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors"
      >
        <HelpCircle className="w-4 h-4" />
        권한 안내
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
          {ROLE_ORDER.map(role => {
            const rc = ROLE_CONFIG[role];
            return (
              <div key={role} className={`rounded-xl border p-4 ${rc.color.includes('purple') ? 'border-purple-100 bg-purple-50/40' : rc.color.includes('indigo') ? 'border-indigo-100 bg-indigo-50/40' : rc.color.includes('teal') ? 'border-teal-100 bg-teal-50/40' : rc.color.includes('blue') ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50/40'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${rc.dotColor}`} />
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${rc.color}`}>{rc.label}</span>
                </div>
                <p className="text-xs text-gray-600 mb-2.5">{rc.description}</p>
                <ul className="space-y-1">
                  {rc.permissions.map((p, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-500">
                      <span className="mt-0.5 flex-shrink-0">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

  // 권한 신청 대기 사용자 상태
  const [pendingUsers, setPendingUsers] = useState<PendingUserItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingFilter, setPendingFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [reviewingUser, setReviewingUser] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState<string | null>(null);


  // 감사 로그 상태
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSkip, setAuditSkip] = useState(0);
  const AUDIT_LIMIT = 50;
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [auditSearch, setAuditSearch] = useState('');
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // 체크박스 선택 상태
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [bulkRollingBack, setBulkRollingBack] = useState(false);

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

  const fetchPendingUsers = async (filter = pendingFilter) => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? { status: filter } : {};
      const res = await client.admin.getPendingUsers(params);
      setPendingUsers(res);
    } catch { toast.error('권한 신청 목록 로드 실패'); }
    finally { setLoading(false); }
  };

  const fetchPendingCount = async () => {
    try {
      const res = await client.admin.getPendingCount();
      setPendingCount(res.pending_count);
    } catch { /* 무시 */ }
  };

  const handleApproveUser = async (userId: string, role = 'user') => {
    setReviewingUser(userId);
    try {
      await client.admin.reviewPendingUser(userId, { action: 'approve', role });
      toast.success('사용자를 승인했습니다.');
      fetchPendingUsers();
      fetchPendingCount();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '승인 실패');
    } finally { setReviewingUser(null); }
  };

  const handleRejectUser = async (userId: string) => {
    setReviewingUser(userId);
    try {
      await client.admin.reviewPendingUser(userId, { action: 'reject', reject_reason: rejectReason || undefined });
      toast.success('사용자를 거부했습니다.');
      setShowRejectDialog(null);
      setRejectReason('');
      fetchPendingUsers();
      fetchPendingCount();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '거부 실패');
    } finally { setReviewingUser(null); }
  };

  const handleDeletePending = async (userId: string) => {
    if (!confirm('이 신청 기록을 삭제하시겠습니까?')) return;
    try {
      await client.admin.deletePendingUser(userId);
      toast.success('삭제되었습니다.');
      fetchPendingUsers();
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

  useEffect(() => { fetchStats(); fetchPendingCount(); }, []);
  useEffect(() => {
    if (activeTab === 'logs')      fetchLogs();
    if (activeTab === 'users')     fetchUsers();
    if (activeTab === 'stats')     fetchStats();
    if (activeTab === 'audit')     fetchAuditLogs(0);
    if (activeTab === 'pending')   { fetchPendingUsers(); fetchPendingCount(); }
  }, [activeTab]);

  // ── 사용자 삭제 ────────────────────────────────────────────
  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`'${email}' 사용자를 삭제하시겠습니까?\n삭제 후 재로그인 시 권한 신청이 필요합니다.`)) return;
    try {
      await client.admin.deleteUser(userId);
      toast.success('사용자가 삭제되었습니다.');
      fetchUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '삭제 실패');
    }
  };

  // ── 역할 변경 (드롭다운용 - 직접 역할 지정) ─────────────────
  const handleRoleChange = async (userId: string, newRole: string) => {
    const rc = ROLE_CONFIG[newRole];
    if (!confirm(`역할을 '${rc?.label ?? newRole}'(으)로 변경하시겠습니까?`)) return;
    try {
      await client.admin.updateUserRole(userId, newRole);
      toast.success(`역할이 '${rc?.label ?? newRole}'(으)로 변경되었습니다.`);
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
  // ── 체크박스 토글 ────────────────────────────────────────
  const toggleSelectLog = (eventId: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const rollbackable = auditLogs.filter(l =>
      ['CREATE','UPDATE','DELETE','STATUS_CHANGE'].includes(l.event_type)
    );
    const allSelected = rollbackable.every(l => selectedEventIds.has(l.event_id));
    setSelectedEventIds(allSelected ? new Set() : new Set(rollbackable.map(l => l.event_id)));
  };

  // ── 일괄 롤백 ────────────────────────────────────────────
  const handleBulkRollback = async () => {
    if (selectedEventIds.size === 0) return;
    if (!confirm(
      `[일괄 롤백 확인]\n\n선택한 ${selectedEventIds.size}개 항목을 롤백하겠습니까?\n\n` +
      `• project/phase 이벤트는 하위 데이터(단계·투입공수·일정) 포함 복원/삭제\n` +
      `• 같은 사업/단계가 여러 번 선택된 경우 1번만 처리됩니다\n\n` +
      `⚠️ 즉시 DB에 반영되며 되돌릴 수 없습니다.`
    )) return;
    setBulkRollingBack(true);
    try {
      const res = await client.admin.bulkRollback(Array.from(selectedEventIds));
      const failedItems = res.results.filter(r => !r.ok);
      if (failedItems.length === 0) {
        toast.success(`일괄 롤백 완료: ${res.success}/${res.total}개 성공`);
      } else {
        toast.warning(
          `일괄 롤백 부분 완료: ${res.success}/${res.total}개 성공, ${res.failed}개 실패\n` +
          failedItems.map(f => `• ${f.entity_type}/${f.entity_id}: ${f.message}`).join('\n')
        );
      }
      setSelectedEventIds(new Set());
      fetchAuditLogs(auditSkip);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '일괄 롤백 실패');
    } finally {
      setBulkRollingBack(false);
    }
  };

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
      fetchAuditLogs(auditSkip);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '롤백 실패');
    }
  };

  // ── 사업 전체 롤백 ──────────────────────────────────────
  const handleProjectRollback = async (log: AuditLogItem) => {
    if (!log.entity_id) { toast.error('entity_id가 없습니다.'); return; }
    const projectId = parseInt(log.entity_id);
    const projectName = log.description ?? `사업 #${projectId}`;
    const isDelete = log.event_type === 'DELETE';
    const action = isDelete ? '복원' : '삭제';
    if (!confirm(
      `[사업 전체 ${action} 확인]\n\n` +
      `"${projectName}"\n\n` +
      `이 사업과 하위 단계/투입공수/일정을 모두 ${action}하겠습니까?\n\n` +
      `⚠️ 즉시 DB에 반영되며 되돌릴 수 없습니다.`
    )) return;
    try {
      const res = await client.admin.projectRollback(projectId);
      toast.success(
        `사업 전체 ${action} 완료 — 단계 ${res.restored.phases}개, 투입공수 ${res.restored.staffing}개, 일정 ${res.restored.calendar}개`
      );
      fetchAuditLogs(auditSkip);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '사업 롤백 실패');
    }
  };

  // ── 단계 전체 롤백 ──────────────────────────────────────
  const handlePhaseRollback = async (log: AuditLogItem) => {
    if (!log.entity_id) { toast.error('entity_id가 없습니다.'); return; }
    const phaseId = parseInt(log.entity_id);
    const phaseName = log.description ?? `단계 #${phaseId}`;
    const isDelete = log.event_type === 'DELETE';
    const action = isDelete ? '복원' : '삭제';
    if (!confirm(
      `[단계 전체 ${action} 확인]\n\n` +
      `"${phaseName}"\n\n` +
      `이 단계와 하위 투입공수/일정을 모두 ${action}하겠습니까?\n\n` +
      `⚠️ 즉시 DB에 반영되며 되돌릴 수 없습니다.`
    )) return;
    try {
      const res = await client.admin.phaseRollback(phaseId);
      toast.success(
        `단계 전체 ${action} 완료 — 투입공수 ${res.restored.staffing}개, 일정 ${res.restored.calendar}개`
      );
      fetchAuditLogs(auditSkip);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '단계 롤백 실패');
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
          { key: 'pending',   label: '권한 신청', icon: UserPlus },
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
            {key === 'pending' && pendingCount > 0 && (
              <span className="ml-1 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                {pendingCount}
              </span>
            )}
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
                    <th className="px-3 py-3 w-8">
                      {/* 전체 선택 체크박스 */}
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-purple-600"
                        checked={(() => {
                          const rollbackable = auditLogs.filter(l =>
                            ['CREATE','UPDATE','DELETE','STATUS_CHANGE'].includes(l.event_type)
                          );
                          return rollbackable.length > 0 && rollbackable.every(l => selectedEventIds.has(l.event_id));
                        })()}
                        onChange={toggleSelectAll}
                        title="롤백 가능한 항목 전체 선택"
                      />
                    </th>
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
                    <tr><td colSpan={7} className="text-center text-gray-400 py-8">감사 로그가 없습니다</td></tr>
                  ) : auditLogs.map(log => (
                    <>
                      <tr
                        key={log.event_id}
                        className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                          selectedEventIds.has(log.event_id) ? 'bg-purple-50/40' :
                          log.is_system_action ? 'bg-gray-50/50' : ''}`}
                        onClick={() => setExpandedAudit(expandedAudit === log.event_id ? null : log.event_id)}
                      >
                        {/* 체크박스 셀 */}
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          {['CREATE','UPDATE','DELETE','STATUS_CHANGE'].includes(log.event_type) ? (
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 rounded border-gray-300 accent-purple-600"
                              checked={selectedEventIds.has(log.event_id)}
                              onChange={() => toggleSelectLog(log.event_id)}
                            />
                          ) : (
                            <span className="w-3.5 h-3.5 block" />
                          )}
                        </td>
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
                          <td colSpan={7} className="px-4 py-3">
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
                                <div className="pt-2 border-t border-blue-100 space-y-2">
                                  {/* 캘린더 셀: 자동 롤백 불가 안내 */}
                                  {log.entity_type === 'calendar_entry' && !log.entity_id ? (
                                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                                      ⚠️ 일정 셀은 여러 개를 일괄 변경하므로 자동 롤백이 불가합니다.
                                      위 변경 필드에서 before_data를 확인하여 수동으로 되돌려 주세요.
                                    </p>
                                  ) : log.entity_type === 'project' ? (
                                    /* 사업: 전체 통째 롤백 버튼 */
                                    <>
                                      <button
                                        onClick={() => handleProjectRollback(log)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                                   bg-red-50 text-red-700 border border-red-200
                                                   hover:bg-red-100 transition-colors"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        사업 전체 {log.event_type === 'DELETE' ? '복원' : '삭제'} (단계·투입공수·일정 포함)
                                      </button>
                                      <p className="text-xs text-gray-400">
                                        ⚠️ 이 사업과 하위 모든 데이터를 한 번에 {log.event_type === 'DELETE' ? '복원' : '삭제'}합니다.
                                      </p>
                                    </>
                                  ) : log.entity_type === 'phase' ? (
                                    /* 단계: 전체 통째 롤백 버튼 */
                                    <>
                                      <button
                                        onClick={() => handlePhaseRollback(log)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                                   bg-red-50 text-red-700 border border-red-200
                                                   hover:bg-red-100 transition-colors"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        단계 전체 {log.event_type === 'DELETE' ? '복원' : '삭제'} (투입공수·일정 포함)
                                      </button>
                                      <p className="text-xs text-gray-400">
                                        ⚠️ 이 단계와 하위 투입공수·일정을 한 번에 {log.event_type === 'DELETE' ? '복원' : '삭제'}합니다.
                                      </p>
                                    </>
                                  ) : (
                                    /* staffing / people 등 단건 롤백 */
                                    <>
                                      <button
                                        onClick={() => handleRollback(log)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                                   bg-orange-50 text-orange-700 border border-orange-200
                                                   hover:bg-orange-100 transition-colors"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        이 시점으로 롤백
                                      </button>
                                      <p className="text-xs text-gray-400">
                                        ⚠️ 이 레코드를 해당 이벤트 발생 직전 상태로 복원합니다. 신중하게 사용하세요.
                                      </p>
                                    </>
                                  )}
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

          {/* ── 일괄 롤백 플로팅 바 ── */}
          {selectedEventIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                            flex items-center gap-4 px-5 py-3
                            bg-gray-900 text-white rounded-2xl shadow-2xl border border-gray-700
                            animate-in slide-in-from-bottom-4 duration-200">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 flex items-center justify-center bg-purple-500 rounded-full text-xs font-bold">
                  {selectedEventIds.size}
                </span>
                <span className="text-sm font-medium">개 항목 선택됨</span>
              </div>
              <div className="w-px h-5 bg-gray-600" />
              <button
                onClick={handleBulkRollback}
                disabled={bulkRollingBack}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                           bg-red-500 hover:bg-red-400 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {bulkRollingBack ? '롤백 중...' : '일괄 롤백'}
              </button>
              <button
                onClick={() => setSelectedEventIds(new Set())}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" /> 선택 해제
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
          {/* 권한 안내 토글 패널 */}
          <div className="mb-4">
            <RoleInfoPanel />
          </div>

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
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">가입일</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">마지막 접속</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">역할</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-gray-400 py-8">사용자가 없습니다</td></tr>
                  ) : users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{user.name ?? '-'}</div>
                        <div className="text-xs text-gray-400">{user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500 max-w-[120px] truncate" title={user.id}>{user.id}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.last_login)}</td>
                      <td className="px-4 py-3">
                        <RoleDropdown
                          userId={user.id}
                          currentRole={user.role}
                          onRoleChange={handleRoleChange}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="사용자 삭제"
                        >
                          <Trash2 className="w-4 h-4" />
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



      {/* ── 권한 신청 탭 ── */}
      {activeTab === 'pending' && (
        <div>
          {/* 안내 배너 */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <Bell className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <strong>권한 신청 관리</strong> — 구글 계정으로 로그인했지만 허용 목록에 없는 사용자들의 접근 신청을 여기서 승인하거나 거부할 수 있습니다.
                승인하면 자동으로 사용자 목록에 추가되어 서비스를 이용할 수 있습니다.
              </div>
            </div>
          </div>

          {/* 필터 + 새로고침 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              {(['pending', 'all', 'approved', 'rejected'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setPendingFilter(f); fetchPendingUsers(f); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    pendingFilter === f ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {f === 'all' ? '전체' : f === 'pending' ? `대기 중 ${pendingCount > 0 ? `(${pendingCount})` : ''}` : f === 'approved' ? '승인됨' : '거부됨'}
                </button>
              ))}
            </div>
            <button onClick={() => { fetchPendingUsers(); fetchPendingCount(); }} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
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
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">Google ID</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">신청일</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">상태</th>
                    <th className="text-left px-4 py-3 text-gray-600 font-medium">처리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-gray-400 py-10">
                        {pendingFilter === 'pending' ? '대기 중인 권한 신청이 없습니다.' : '신청 내역이 없습니다.'}
                      </td>
                    </tr>
                  ) : pendingUsers.map(u => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{u.name ?? '-'}</div>
                        <div className="text-xs text-blue-600">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500 max-w-[120px] truncate" title={u.user_id}>
                        {u.user_id}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(u.requested_at)}</td>
                      <td className="px-4 py-3">
                        {u.status === 'pending' && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">대기 중</span>
                        )}
                        {u.status === 'approved' && (
                          <div>
                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">승인됨</span>
                            <div className="text-xs text-gray-400 mt-1">{formatDateTime(u.reviewed_at)}</div>
                          </div>
                        )}
                        {u.status === 'rejected' && (
                          <div>
                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded">거부됨</span>
                            {u.reject_reason && (
                              <div className="text-xs text-red-500 mt-1 max-w-[150px] truncate" title={u.reject_reason}>
                                {u.reject_reason}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                              <ApproveDropdown
                                userId={u.user_id}
                                onApprove={handleApproveUser}
                                disabled={reviewingUser === u.user_id}
                              />
                            </div>
                            <button
                              onClick={() => setShowRejectDialog(u.user_id)}
                              disabled={reviewingUser === u.user_id}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              거부
                            </button>
                          </div>
                        )}
                        {u.status !== 'pending' && (
                          <button
                            onClick={() => handleDeletePending(u.user_id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 거부 사유 입력 다이얼로그 */}
          {showRejectDialog && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-base font-semibold text-gray-800 mb-1">접근 신청 거부</h3>
                <p className="text-sm text-gray-500 mb-4">
                  거부 사유를 입력하면 사용자가 확인할 수 있습니다. (선택사항)
                </p>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="예: 해당 프로젝트 구성원이 아닙니다."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300 mb-4"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRejectUser(showRejectDialog)}
                    disabled={reviewingUser === showRejectDialog}
                    className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {reviewingUser === showRejectDialog ? '처리 중...' : '거부 확정'}
                  </button>
                  <button
                    onClick={() => { setShowRejectDialog(null); setRejectReason(''); }}
                    className="flex-1 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
