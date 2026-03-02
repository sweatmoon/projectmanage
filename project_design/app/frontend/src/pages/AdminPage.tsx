import { useState, useEffect } from 'react';
import { client } from '@/lib/api';
import { Shield, Users, Activity, LogIn, Clock, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

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

type TabType = 'stats' | 'logs' | 'users';
type LogFilter = 'all' | 'login' | 'api';

function formatDateTime(dt: string | null) {
  if (!dt) return '-';
  return new Date(dt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
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

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [loading, setLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const fetchStats = async () => {
    try {
      const data = await client.admin.getStats();
      setStats(data);
    } catch {
      toast.error('통계 로드 실패');
    }
  };

  const fetchLogs = async (filter: LogFilter = logFilter) => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? { action: filter, limit: 200 } : { limit: 200 };
      const data = await client.admin.getLogs(params);
      setLogs(data);
    } catch {
      toast.error('로그 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await client.admin.getUsers();
      setUsers(data);
    } catch {
      toast.error('사용자 목록 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') fetchLogs();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'stats') fetchStats();
  }, [activeTab]);

  const handleRoleChange = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`역할을 '${newRole}'으로 변경하시겠습니까?`)) return;
    try {
      await client.admin.updateUserRole(userId, newRole);
      toast.success('역할이 변경되었습니다.');
      fetchUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '역할 변경 실패');
    }
  };

  const handleLogFilterChange = (f: LogFilter) => {
    setLogFilter(f);
    fetchLogs(f);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-gray-900">관리자 페이지</h1>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'stats', label: '대시보드', icon: Activity },
          { key: 'logs', label: '접속 로그', icon: LogIn },
          { key: 'users', label: '사용자 관리', icon: Users },
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

      {/* 대시보드 탭 */}
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
                { label: '전체 사용자', value: stats.total_users, color: 'bg-blue-50 text-blue-700', icon: Users },
                { label: '오늘 로그인', value: stats.total_logins_today, color: 'bg-green-50 text-green-700', icon: LogIn },
                { label: '오늘 API 호출', value: stats.total_api_calls_today, color: 'bg-yellow-50 text-yellow-700', icon: Activity },
                { label: '7일 활성 사용자', value: stats.active_users_7days, color: 'bg-purple-50 text-purple-700', icon: Clock },
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

      {/* 접속 로그 탭 */}
      {activeTab === 'logs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-2">
              {(['all', 'login', 'api'] as LogFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => handleLogFilterChange(f)}
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
                          <span className="text-xs text-gray-500 font-mono">{log.method && <span className="text-purple-600 mr-1">{log.method}</span>}{log.path ?? '-'}</span>
                        </td>
                        <td className="px-4 py-2.5">{statusBadge(log.status_code)}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{log.ip_address ?? '-'}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{log.duration_ms != null ? `${log.duration_ms}ms` : '-'}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)} className="text-gray-400 hover:text-gray-600">
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

      {/* 사용자 관리 탭 */}
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
                          user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.created_at)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.last_login)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRoleChange(user.id, user.role)}
                          className="px-3 py-1 rounded text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                        >
                          {user.role === 'admin' ? '→ user' : '→ admin'}
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
