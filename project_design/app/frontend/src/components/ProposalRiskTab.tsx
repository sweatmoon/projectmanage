import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { authStore } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle, AlertCircle, CheckCircle2, ChevronRight,
  ArrowLeft, RefreshCw, Loader2, Users, Calendar, Building2, Crown,
  ChevronDown, ChevronUp, Info,
} from 'lucide-react';

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface RiskSummary { danger: number; warning: number; total: number }

interface ProposalItem {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  is_won: boolean;
  start_date: string | null;
  end_date: string | null;
  risk_summary: RiskSummary;
  risk_types: string[];
}

interface ConflictItem {
  other_project_id: number;
  other_project_name: string;
  other_project_status: string;
  type_label: 'A' | 'P';
  other_phase_name: string;
  other_phase_start: string;
  other_phase_end: string;
  other_field: string;
  other_sub_field: string;
  other_field_highlight: boolean;   // 사업관리/품질보증 여부
  my_phase_name: string;
  my_phase_start: string;
  my_phase_end: string;
  overlap_start: string;
  overlap_end: string;
  overlap_days: number;
  overlap_md: number;
}

interface PersonSchedule {
  person_key: string;
  person_id: number | null;
  person_name: string;
  is_chief: boolean;
  grade: string;
  position: string;
  my_field: string;       // 본사업에서의 분야
  my_sub_field: string;
  total_overlap_days: number;
  total_overlap_md: number;
  has_conflict: boolean;
  conflicts: ConflictItem[];
}

interface ScheduleDetail {
  id: number;
  project_name: string;
  organization: string;
  start_date: string | null;
  end_date: string | null;
  summary: {
    total_people: number;
    conflict_people: number;
    total_overlap_days: number;
    total_overlap_md: number;
  };
  people: PersonSchedule[];
}

interface RiskDetailItem {
  type: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  count: number;
  reasons: string[];
  suggestions: string[];
  items: Record<string, any>[];
}

interface ProjectDetail {
  id: number;
  project_name: string;
  organization: string;
  start_date: string | null;
  end_date: string | null;
  is_won: boolean;
  assigned_people: {
    person_id: number | null;
    person_name: string;
    is_chief: boolean;
    grade: string;
    field: string;
  }[];
  risks: RiskDetailItem[];
  risk_summary: RiskSummary;
}

// ── 리스크 설정 ────────────────────────────────────────────────────────────────
const RISK_CONFIG: Record<string, { icon: typeof AlertTriangle; label: string; color: string }> = {
  schedule_conflict:   { icon: Calendar,  label: '인력 일정 중복',      color: 'text-orange-500' },
  chief_overload:      { icon: Users,     label: '총괄감리원 과다 투입', color: 'text-yellow-600' },
  chief_role_conflict: { icon: Crown,     label: '총괄감리원 역할 중복', color: 'text-red-500'    },
  org_duplicate:       { icon: Building2, label: '동일 기관 일정 중복',  color: 'text-purple-500' },
};

const SEVERITY_CONFIG = {
  danger:  { bg: 'bg-red-50',   border: 'border-red-200',   badge: 'bg-red-100 text-red-700',   dot: 'bg-red-500',   label: '위험' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700',dot: 'bg-amber-400', label: '주의' },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-200',  badge: 'bg-blue-100 text-blue-700',  dot: 'bg-blue-400',  label: '참고' },
};

// ── API 헬퍼 ──────────────────────────────────────────────────────────────────
function getAuthHeaders() {
  const token = authStore.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── 요약 뱃지 ─────────────────────────────────────────────────────────────────
function RiskBadges({ summary }: { summary: RiskSummary }) {
  if (summary.total === 0)
    return (
      <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
        <CheckCircle2 className="h-3.5 w-3.5" />정상
      </span>
    );
  return (
    <div className="flex items-center gap-1.5">
      {summary.danger > 0 && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
          <AlertCircle className="h-3 w-3" />위험 {summary.danger}
        </span>
      )}
      {summary.warning > 0 && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
          <AlertTriangle className="h-3 w-3" />주의 {summary.warning}
        </span>
      )}
    </div>
  );
}

// ── 사업 유형 뱃지 (A=감리, P=제안) ──────────────────────────────────────────
function TypeBadge({ type }: { type: 'A' | 'P' }) {
  if (type === 'A')
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-blue-100 text-blue-700 flex-shrink-0">
        A
      </span>
    );
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-orange-100 text-orange-700 flex-shrink-0">
      P
    </span>
  );
}

// ── 분야 뱃지 (사업관리/품질보증 강조) ───────────────────────────────────────
function FieldBadge({ field, highlight }: { field: string; highlight: boolean }) {
  if (!field) return null;
  if (highlight)
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">
        ★ {field}
      </span>
    );
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600">
      {field}
    </span>
  );
}

// ── 인력 1명의 충돌 행 ────────────────────────────────────────────────────────
function PersonConflictRow({ person, isFirst }: { person: PersonSchedule; isFirst: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!person.has_conflict) {
    return (
      <tr className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {person.is_chief && <Crown className="h-3 w-3 text-purple-500 flex-shrink-0" />}
            <span className={`text-xs font-medium ${person.is_chief ? 'text-purple-700' : 'text-slate-700'}`}>
              {person.person_name}
            </span>
            {person.is_chief && (
              <span className="text-[10px] px-1 rounded-full bg-purple-100 text-purple-600">총괄</span>
            )}
          </div>
          {person.grade && <div className="text-[10px] text-gray-400 mt-0.5 pl-4">{person.grade}</div>}
        </td>
        <td className="px-3 py-2">
          <FieldBadge field={person.my_field} highlight={false} />
          {person.my_sub_field && (
            <span className="text-[10px] text-gray-400 ml-1">{person.my_sub_field}</span>
          )}
        </td>
        <td className="px-3 py-2 text-center" colSpan={4}>
          <span className="text-xs text-emerald-500 flex items-center justify-center gap-1">
            <CheckCircle2 className="h-3 w-3" />중복 없음
          </span>
        </td>
      </tr>
    );
  }

  return (
    <>
      {/* 인력 헤더 행 */}
      <tr
        className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
          person.is_chief ? 'bg-purple-50/40' : 'bg-white'
        }`}
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {person.is_chief && <Crown className="h-3 w-3 text-purple-500 flex-shrink-0" />}
            <span className={`text-xs font-semibold ${person.is_chief ? 'text-purple-700' : 'text-slate-700'}`}>
              {person.person_name}
            </span>
            {person.is_chief && (
              <span className="text-[10px] px-1 rounded-full bg-purple-100 text-purple-600">총괄</span>
            )}
          </div>
          {person.grade && <div className="text-[10px] text-gray-400 mt-0.5 pl-4">{person.grade}</div>}
        </td>
        <td className="px-3 py-2">
          <FieldBadge field={person.my_field} highlight={false} />
          {person.my_sub_field && (
            <span className="text-[10px] text-gray-400 ml-1">{person.my_sub_field}</span>
          )}
        </td>
        <td className="px-3 py-2 text-center">
          <span className="text-xs font-bold text-red-600">{person.total_overlap_days}일</span>
        </td>
        <td className="px-3 py-2 text-center">
          <span className="text-xs font-semibold text-orange-600">{person.total_overlap_md}MD</span>
        </td>
        <td className="px-3 py-2 text-center">
          <span className="text-xs text-gray-500">{person.conflicts.length}건</span>
        </td>
        <td className="px-3 py-2 text-right">
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 ml-auto" />
            : <ChevronDown className="h-3.5 w-3.5 text-gray-400 ml-auto" />
          }
        </td>
      </tr>

      {/* 충돌 상세 */}
      {expanded && person.conflicts.map((c, idx) => (
        <tr
          key={idx}
          className={`border-b border-gray-50 ${
            c.other_field_highlight
              ? 'bg-rose-50/60'
              : idx % 2 === 0 ? 'bg-gray-50/30' : 'bg-white'
          }`}
        >
          <td className="pl-8 pr-3 py-2" colSpan={2}>
            {/* 충돌 사업명 */}
            <div className="flex items-center gap-1.5">
              <TypeBadge type={c.type_label} />
              <span
                className="text-xs text-slate-700 font-medium truncate max-w-[180px]"
                title={c.other_project_name}
              >
                {c.other_project_name}
              </span>
              {c.other_field_highlight && (
                <span className="text-[10px] text-rose-600 font-bold flex-shrink-0">⚠</span>
              )}
            </div>
            {/* 충돌 단계 + 분야 */}
            <div className="flex items-center gap-1.5 mt-1 pl-6 flex-wrap">
              <span className="text-[10px] text-gray-500">{c.other_phase_name}</span>
              <span className="text-[10px] text-gray-400">{c.other_phase_start}~{c.other_phase_end}</span>
              <FieldBadge field={c.other_field} highlight={c.other_field_highlight} />
              {c.other_sub_field && (
                <span className="text-[10px] text-gray-400">{c.other_sub_field}</span>
              )}
            </div>
            {/* 본사업 단계 */}
            <div className="text-[10px] text-gray-400 mt-0.5 pl-6">
              ← 본사업: {c.my_phase_name} ({c.my_phase_start}~{c.my_phase_end})
            </div>
          </td>
          <td className="px-3 py-2 text-center">
            <span className="text-xs font-semibold text-red-600">{c.overlap_days}일</span>
            <div className="text-[10px] text-gray-400">{c.overlap_start}~{c.overlap_end}</div>
          </td>
          <td className="px-3 py-2 text-center">
            <span className="text-xs text-orange-600">{c.overlap_md}MD</span>
          </td>
          <td className="px-3 py-2" colSpan={2} />
        </tr>
      ))}
    </>
  );
}

// ── 일정 중복 상세 화면 ───────────────────────────────────────────────────────
function SchedulePanel({ projectId, projectName, onBack }: {
  projectId: number;
  projectName: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<ScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOnlyConflict, setShowOnlyConflict] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/v1/proposal-risk/${projectId}/schedule`, {
        headers: getAuthHeaders(),
      });
      setData(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-gray-400">
      <Loader2 className="h-6 w-6 animate-spin mr-2" />분석 중...
    </div>
  );
  if (!data) return null;

  const visiblePeople = showOnlyConflict
    ? data.people.filter(p => p.has_conflict)
    : data.people;

  const conflictPeople = data.people.filter(p => p.has_conflict);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-gray-500">
          <ArrowLeft className="h-4 w-4 mr-1" />목록
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-800 truncate">{data.project_name}</h2>
          <p className="text-xs text-gray-500">
            {data.organization}
            {data.start_date && ` · ${data.start_date} ~ ${data.end_date ?? '?'}`}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="새로고침">
          <RefreshCw className="h-4 w-4 text-gray-400" />
        </Button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="text-center py-3 bg-gray-50">
          <CardContent className="p-0">
            <p className="text-xl font-bold text-slate-700">{data.summary.total_people}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">전체 인력</p>
          </CardContent>
        </Card>
        <Card className={`text-center py-3 ${data.summary.conflict_people > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
          <CardContent className="p-0">
            <p className="text-xl font-bold text-red-600">{data.summary.conflict_people}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">중복 인력</p>
          </CardContent>
        </Card>
        <Card className={`text-center py-3 ${data.summary.total_overlap_days > 0 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50'}`}>
          <CardContent className="p-0">
            <p className="text-xl font-bold text-orange-600">{data.summary.total_overlap_days}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">총 중복일수</p>
          </CardContent>
        </Card>
        <Card className={`text-center py-3 ${data.summary.total_overlap_md > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50'}`}>
          <CardContent className="p-0">
            <p className="text-xl font-bold text-amber-600">{data.summary.total_overlap_md}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">총 중복공수</p>
          </CardContent>
        </Card>
      </div>

      {/* 범례 */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2 flex-wrap">
        <span className="font-semibold text-gray-600">범례</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold bg-blue-100 text-blue-700">A</span>
          감리사업
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold bg-orange-100 text-orange-700">P</span>
          타제안사업
        </span>
        <span className="inline-flex items-center gap-1">
          <Crown className="h-3 w-3 text-purple-500" />
          총괄급 인력
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="px-1 rounded text-[9px] font-bold bg-rose-100 text-rose-700 border border-rose-300">★ 사업관리</span>
          사업관리/품질보증 분야 강조
        </span>
      </div>

      {/* 필터 */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500">
          인력별 일정 중복 현황
          <span className="ml-2 text-gray-400 font-normal">
            ({conflictPeople.length}/{data.people.length}명 중복)
          </span>
        </p>
        <button
          onClick={() => setShowOnlyConflict(v => !v)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
            showOnlyConflict
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
          }`}
        >
          중복 인력만 보기
        </button>
      </div>

      {/* 인력 테이블 */}
      {visiblePeople.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-emerald-600 gap-2">
          <CheckCircle2 className="h-10 w-10" />
          <p className="font-semibold text-sm">일정 중복 인력 없음</p>
          <p className="text-xs text-gray-400">모든 인력의 일정이 정상입니다</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                <th className="text-left px-3 py-2.5 font-semibold">
                  인력 <span className="text-[10px] font-normal text-gray-400">(배치 순서)</span>
                </th>
                <th className="text-left px-3 py-2.5 font-semibold">본사업 분야</th>
                <th className="text-center px-3 py-2.5 font-semibold">중복일수</th>
                <th className="text-center px-3 py-2.5 font-semibold">중복공수</th>
                <th className="text-center px-3 py-2.5 font-semibold">충돌건수</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visiblePeople.map((person, idx) => (
                <PersonConflictRow
                  key={person.person_key}
                  person={person}
                  isFirst={idx === 0}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.people.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-xs">
          배정된 인력이 없거나 감리 단계 일정이 미입력되어 분석 불가
        </div>
      )}
    </div>
  );
}

// ── 리스크 카드 ───────────────────────────────────────────────────────────────
function RiskCard({ risk }: { risk: RiskDetailItem }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.info;
  const cfg = RISK_CONFIG[risk.type];
  const Icon = cfg?.icon ?? AlertTriangle;

  return (
    <div className={`rounded-xl border ${sev.border} ${sev.bg} overflow-hidden`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:brightness-95 transition"
        onClick={() => setExpanded(v => !v)}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${cfg?.color ?? 'text-gray-500'}`} />
        <span className="font-semibold text-sm flex-1">{risk.title}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sev.badge}`}>{sev.label}</span>
        <span className="text-xs text-gray-400 ml-1">{risk.count}건</span>
        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">🔍 원인 요약</p>
            <ul className="space-y-1">
              {risk.reasons.map((r, i) => (
                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">💡 해결 제안</p>
            <ul className="space-y-1">
              {risk.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1 flex gap-1.5">
                  <span>→</span>{s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 상세 패널 (리스크 요약 + 일정 중복 탭) ───────────────────────────────────
function DetailPanel({ project, onBack }: { project: ProposalItem; onBack: () => void }) {
  const [tab, setTab] = useState<'risk' | 'schedule'>('schedule');
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const res = await axios.get(`/api/v1/proposal-risk/${project.id}`, {
        headers: getAuthHeaders(),
      });
      setDetail(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDetail(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (tab === 'risk') loadDetail();
  }, [tab, loadDetail]);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-gray-500">
          <ArrowLeft className="h-4 w-4 mr-1" />목록
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-800 truncate">{project.project_name}</h2>
            {project.is_won && (
              <span className="px-1.5 py-0 rounded text-[10px] font-bold bg-blue-100 text-blue-700 flex-shrink-0">수주</span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {project.organization}
            {project.start_date && ` · ${project.start_date} ~ ${project.end_date ?? '?'}`}
          </p>
        </div>
        <RiskBadges summary={project.risk_summary} />
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('schedule')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'schedule'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📅 인력 일정 중복
        </button>
        <button
          onClick={() => setTab('risk')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'risk'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          🔍 리스크 분석
        </button>
      </div>

      {/* 탭 컨텐츠 */}
      {tab === 'schedule' && (
        <SchedulePanel
          projectId={project.id}
          projectName={project.project_name}
          onBack={onBack}
        />
      )}

      {tab === 'risk' && (
        loadingDetail ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />분석 중...
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* 배정 인력 */}
            {detail.assigned_people.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">배정 인력 (배치 순서)</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.assigned_people.map((p, i) => (
                    <span
                      key={p.person_id ?? i}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                        p.is_chief
                          ? 'bg-purple-50 border-purple-200 text-purple-700'
                          : 'bg-gray-50 border-gray-200 text-gray-600'
                      }`}
                    >
                      {p.is_chief && <Crown className="h-2.5 w-2.5" />}
                      {p.person_name}
                      {p.grade && <span className="opacity-60">·{p.grade}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 리스크 목록 */}
            {detail.risk_summary.total === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-emerald-600 gap-2">
                <CheckCircle2 className="h-12 w-12" />
                <p className="font-semibold">리스크 없음</p>
                {detail.assigned_people.length === 0 && (
                  <p className="text-xs text-amber-500 mt-1">
                    ※ 배정된 인력이 없거나 감리 단계 일정이 미입력된 경우 탐지 불가
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {detail.risks.map((risk, i) => (
                  <RiskCard key={i} risk={risk} />
                ))}
              </div>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}

// ── 메인: 목록 뷰 ─────────────────────────────────────────────────────────────
export default function ProposalRiskTab() {
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ProposalItem | null>(null);
  const [filter, setFilter] = useState<'all' | 'danger' | 'warning' | 'safe'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/proposal-risk/list', {
        headers: getAuthHeaders(),
      });
      setProposals(res.data.proposals ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = proposals.filter(p => {
    if (filter === 'danger')  return p.risk_summary.danger > 0;
    if (filter === 'warning') return p.risk_summary.warning > 0 && p.risk_summary.danger === 0;
    if (filter === 'safe')    return p.risk_summary.total === 0;
    return true;
  });

  if (selectedProject !== null)
    return (
      <DetailPanel
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
      />
    );

  return (
    <div className="space-y-4">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">제안일정 리스크 관리</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            제안 상태 사업의 인력·일정 리스크를 자동 분석합니다
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          새로고침
        </Button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { key: 'all',     label: `전체 (${proposals.length})` },
          { key: 'danger',  label: `위험 (${proposals.filter(p => p.risk_summary.danger > 0).length})` },
          { key: 'warning', label: `주의 (${proposals.filter(p => p.risk_summary.warning > 0 && p.risk_summary.danger === 0).length})` },
          { key: 'safe',    label: `정상 (${proposals.filter(p => p.risk_summary.total === 0).length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              filter === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />분석 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-400" />
          <p className="font-medium">해당하는 제안사업이 없습니다</p>
          {proposals.length === 0 && (
            <p className="text-xs mt-2 text-amber-500">
              ※ 상태가 '제안'인 사업이 없거나,<br />감리 단계 일정이 입력되지 않은 경우 분석 불가
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(proj => {
            const hasDanger  = proj.risk_summary.danger > 0;
            const hasWarning = proj.risk_summary.warning > 0;
            const borderColor = hasDanger
              ? 'border-l-red-500'
              : hasWarning ? 'border-l-amber-400' : 'border-l-emerald-400';

            return (
              <button
                key={proj.id}
                className={`w-full text-left rounded-xl border border-gray-200 border-l-4 ${borderColor}
                  bg-white hover:shadow-md transition-shadow px-4 py-3 flex items-center gap-3`}
                onClick={() => setSelectedProject(proj)}
              >
                {/* 리스크 아이콘 */}
                <div className="flex-shrink-0">
                  {hasDanger
                    ? <AlertCircle className="h-5 w-5 text-red-500" />
                    : hasWarning
                    ? <AlertTriangle className="h-5 w-5 text-amber-400" />
                    : <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                </div>

                {/* 사업 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-800 truncate">{proj.project_name}</span>
                    {proj.is_won && (
                      <span className="px-1.5 py-0 rounded text-[10px] font-bold bg-blue-100 text-blue-700">수주</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                    <span>{proj.organization}</span>
                    {proj.start_date && (
                      <span className="text-gray-400">
                        {proj.start_date} ~ {proj.end_date ?? '?'}
                      </span>
                    )}
                    <div className="flex gap-1">
                      {proj.risk_types.map(type => {
                        const cfg = RISK_CONFIG[type];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        return <Icon key={type} className={`h-3 w-3 ${cfg.color}`} title={cfg.label} />;
                      })}
                    </div>
                  </div>
                </div>

                {/* 리스크 요약 뱃지 */}
                <div className="flex-shrink-0">
                  <RiskBadges summary={proj.risk_summary} />
                </div>

                <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
