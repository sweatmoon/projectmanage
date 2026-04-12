import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { authStore } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle, AlertCircle, CheckCircle2, ChevronRight,
  ArrowLeft, RefreshCw, Loader2, Users, Calendar, Building2, Crown,
  ChevronDown, ChevronUp, Play, Copy, FileText, Sparkles, UserMinus,
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
  other_field_highlight: boolean;
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
  my_field: string;
  my_sub_field: string;
  my_category: string;
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

// 시뮬레이션 결과 타입
interface ReplacementCandidate {
  person_id: number;
  person_name: string;
  is_chief: boolean;
  grade: string;
  position: string;
  is_available: boolean;
  company: string;
}

interface ExcludedDetail {
  person_key: string;
  person_name: string;
  is_chief: boolean;
  grade: string;
  my_field: string;
  my_category: string;
  resolved_days: number;
  resolved_md: number;
  conflict_count: number;
  replacement_candidates: ReplacementCandidate[];
  conflicts_summary: { other_project_name: string; type_label: string; overlap_days: number }[];
}

interface SimulateResult {
  project_id: number;
  excluded_keys: string[];
  original: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  simulated: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  delta: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  suggestions: string[];
  excluded_detail: ExcludedDetail[];
  risks: RiskDetailItem[];
  people: PersonSchedule[];
}

// 텍스트 출력 결과
interface TextSection {
  label: string;
  format: string;
  content: string;
}

interface TextOutputResult {
  project_id: number;
  project_name: string;
  organization: string;
  excluded_keys: string[];
  excluded_count: number;
  sections: TextSection[];
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

// ── 본사업 분야 셀 (field + sub_field 중복 방지) ──────────────────────────────
function MyFieldCell({ field, subField }: { field: string; subField: string }) {
  if (!field) return <span className="text-[10px] text-gray-300">-</span>;
  const showSub = subField && subField !== field;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <FieldBadge field={field} highlight={false} />
      {showSub && (
        <span className="text-[10px] text-gray-400">{subField}</span>
      )}
    </div>
  );
}

// ── 인력 1명의 충돌 행 ────────────────────────────────────────────────────────
function PersonConflictRow({ person, checked, onCheck, simMode }: {
  person: PersonSchedule;
  checked?: boolean;
  onCheck?: (key: string, checked: boolean) => void;
  simMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!person.has_conflict) {
    return (
      <tr className="border-b border-gray-50 hover:bg-gray-50/50">
        {simMode && (
          <td className="px-2 py-2 text-center">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => onCheck?.(person.person_key, e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
              title="이 인력 제외 시뮬레이션"
            />
          </td>
        )}
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
          <MyFieldCell field={person.my_field} subField={person.my_sub_field} />
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
      <tr
        className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
          checked ? 'bg-blue-50/60' : person.is_chief ? 'bg-purple-50/40' : 'bg-white'
        }`}
        onClick={() => !simMode && setExpanded(v => !v)}
      >
        {simMode && (
          <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={checked}
              onChange={e => onCheck?.(person.person_key, e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
              title="이 인력 제외 시뮬레이션"
            />
          </td>
        )}
        <td className="px-3 py-2" onClick={() => setExpanded(v => !v)}>
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
        <td className="px-3 py-2" onClick={() => setExpanded(v => !v)}>
          <MyFieldCell field={person.my_field} subField={person.my_sub_field} />
        </td>
        <td className="px-3 py-2 text-center" onClick={() => setExpanded(v => !v)}>
          <span className="text-xs font-bold text-red-600">{person.total_overlap_days}일</span>
        </td>
        <td className="px-3 py-2 text-center" onClick={() => setExpanded(v => !v)}>
          <span className="text-xs font-semibold text-orange-600">{person.total_overlap_md}MD</span>
        </td>
        <td className="px-3 py-2 text-center" onClick={() => setExpanded(v => !v)}>
          <span className="text-xs text-gray-500">{person.conflicts.length}건</span>
        </td>
        <td className="px-3 py-2 text-right" onClick={() => setExpanded(v => !v)}>
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-gray-400 ml-auto" />
            : <ChevronDown className="h-3.5 w-3.5 text-gray-400 ml-auto" />
          }
        </td>
      </tr>

      {expanded && person.conflicts.map((c, idx) => (
        <tr
          key={idx}
          className={`border-b border-gray-50 ${
            c.other_field_highlight
              ? 'bg-rose-50/60'
              : idx % 2 === 0 ? 'bg-gray-50/30' : 'bg-white'
          }`}
        >
          {simMode && <td />}
          <td className="pl-8 pr-3 py-2" colSpan={2}>
            <div className="flex items-center gap-1.5">
              <TypeBadge type={c.type_label} />
              <span className="text-xs text-slate-700 font-medium truncate max-w-[180px]" title={c.other_project_name}>
                {c.other_project_name}
              </span>
              {c.other_field_highlight && (
                <span className="text-[10px] text-rose-600 font-bold flex-shrink-0">⚠</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 pl-6 flex-wrap">
              <span className="text-[10px] text-gray-500">{c.other_phase_name}</span>
              <span className="text-[10px] text-gray-400">{c.other_phase_start}~{c.other_phase_end}</span>
              <FieldBadge field={c.other_field} highlight={c.other_field_highlight} />
            </div>
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

// ── 시뮬레이션 패널 ───────────────────────────────────────────────────────────
function SimulationPanel({ projectId }: { projectId: number }) {
  const [scheduleData, setScheduleData] = useState<ScheduleDetail | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [simResult, setSimResult] = useState<SimulateResult | null>(null);
  const [textOutput, setTextOutput] = useState<TextOutputResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [textLoading, setTextLoading] = useState(false);
  const [showOnlyConflict, setShowOnlyConflict] = useState(true);
  const [activeResultTab, setActiveResultTab] = useState<'effect' | 'text'>('effect');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 초기 데이터 로드
  const loadSchedule = useCallback(async () => {
    setLoadingSchedule(true);
    try {
      const res = await axios.get(`/api/v1/proposal-risk/${projectId}/schedule`, {
        headers: getAuthHeaders(),
      });
      setScheduleData(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSchedule(false);
    }
  }, [projectId]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  // 체크박스 변경 → 자동 시뮬레이션 (디바운스 300ms)
  const handleCheck = useCallback((key: string, checked: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      checked ? next.add(key) : next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSimulate(Array.from(selectedKeys));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedKeys, projectId]);

  const runSimulate = async (keys: string[]) => {
    setSimLoading(true);
    try {
      const res = await axios.post(
        `/api/v1/proposal-risk/${projectId}/simulate`,
        { excluded_person_keys: keys },
        { headers: getAuthHeaders() }
      );
      setSimResult(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setSimLoading(false);
    }
  };

  const runTextOutput = async () => {
    setTextLoading(true);
    try {
      const res = await axios.post(
        `/api/v1/proposal-risk/${projectId}/text-output`,
        { excluded_person_keys: Array.from(selectedKeys) },
        { headers: getAuthHeaders() }
      );
      setTextOutput(res.data);
      setActiveResultTab('text');
    } catch (e) {
      console.error(e);
    } finally {
      setTextLoading(false);
    }
  };

  const handleCopy = async (label: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedSection(label);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch { /* ignore */ }
  };

  const handleCopyAll = async () => {
    if (!textOutput) return;
    const all = textOutput.sections
      .map(s => `[${s.label}]\n${s.content}`)
      .join('\n\n');
    await handleCopy('__all__', all);
  };

  const people = scheduleData?.people ?? [];
  const conflictPeople = people.filter(p => p.has_conflict);
  const visiblePeople = showOnlyConflict ? conflictPeople : people;

  // 시뮬레이션 효과 계산
  const orig = simResult?.original;
  const sim  = simResult?.simulated;
  const delta = simResult?.delta;

  // 위험 레벨 색상
  function deltaColor(val: number) {
    if (val > 0) return 'text-emerald-600';
    if (val < 0) return 'text-red-600';
    return 'text-gray-400';
  }
  function deltaLabel(val: number) {
    if (val > 0) return `▼ ${val}`;
    if (val < 0) return `▲ ${Math.abs(val)}`;
    return '-';
  }

  if (loadingSchedule) return (
    <div className="flex items-center justify-center py-20 text-gray-400">
      <Loader2 className="h-6 w-6 animate-spin mr-2" />인력 데이터 로드 중...
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 안내 배너 */}
      <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 space-y-0.5">
          <p className="font-semibold">리스크 감소 시뮬레이션</p>
          <p>중복 인력 옆 체크박스를 선택하면 해당 인력을 제외했을 때의 리스크 변화를 실시간으로 계산합니다.</p>
          <p className="text-blue-500">※ DB에 저장되지 않으며 시뮬레이션 결과만 표시됩니다.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── 좌측: 인력 체크박스 테이블 ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">
              인력 선택
              {selectedKeys.size > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                  {selectedKeys.size}명 제외
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowOnlyConflict(v => !v)}
                className={`text-xs px-2 py-1 rounded-full border transition-all ${
                  showOnlyConflict
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                중복만
              </button>
              {selectedKeys.size > 0 && (
                <button
                  onClick={() => setSelectedKeys(new Set())}
                  className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-red-300"
                >
                  초기화
                </button>
              )}
            </div>
          </div>

          {people.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-xs">배정 인력 없음</div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                    <th className="px-2 py-2 text-center w-8">제외</th>
                    <th className="text-left px-3 py-2 font-semibold">인력</th>
                    <th className="text-left px-3 py-2 font-semibold">분야</th>
                    <th className="text-center px-3 py-2 font-semibold">중복일</th>
                    <th className="text-center px-3 py-2 font-semibold">MD</th>
                    <th className="text-center px-3 py-2 font-semibold">건</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePeople.map(person => (
                    <PersonConflictRow
                      key={person.person_key}
                      person={person}
                      checked={selectedKeys.has(person.person_key)}
                      onCheck={handleCheck}
                      simMode
                    />
                  ))}
                  {visiblePeople.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-emerald-500 text-xs">
                        <CheckCircle2 className="h-6 w-6 mx-auto mb-1" />
                        중복 인력 없음
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 우측: 시뮬레이션 결과 ── */}
        <div className="space-y-3">
          {/* 액션 버튼 */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runSimulate(Array.from(selectedKeys))}
              disabled={simLoading}
              className="flex-1"
            >
              {simLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              리스크 재계산
            </Button>
            <Button
              size="sm"
              onClick={runTextOutput}
              disabled={textLoading}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {textLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
              텍스트 출력
            </Button>
          </div>

          {/* 결과 탭 */}
          {(simResult || textOutput) && (
            <div className="flex gap-1 border-b border-gray-200">
              <button
                onClick={() => setActiveResultTab('effect')}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeResultTab === 'effect'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                📊 효과 분석
              </button>
              <button
                onClick={() => setActiveResultTab('text')}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  activeResultTab === 'text'
                    ? 'border-emerald-600 text-emerald-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                📝 텍스트 출력
                {textOutput && <span className="ml-1 text-[10px] text-emerald-500">●</span>}
              </button>
            </div>
          )}

          {/* 효과 분석 탭 */}
          {activeResultTab === 'effect' && simResult && (
            <div className="space-y-3">
              {simLoading && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />재계산 중...
                </div>
              )}

              {/* 수치 비교 */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 px-3 py-2">
                  <p className="text-xs font-semibold text-gray-600">리스크 수치 비교</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400">
                      <th className="text-left px-3 py-1.5 font-medium">항목</th>
                      <th className="text-center px-3 py-1.5 font-medium">현재</th>
                      <th className="text-center px-3 py-1.5 font-medium">시뮬레이션</th>
                      <th className="text-center px-3 py-1.5 font-medium">변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: '위험 건수', o: orig?.danger, s: sim?.danger, d: delta?.danger },
                      { label: '주의 건수', o: orig?.warning, s: sim?.warning, d: delta?.warning },
                      { label: '중복 인력', o: orig?.conflict_people, s: sim?.conflict_people, d: delta?.conflict_people },
                      { label: '중복 일수', o: orig?.overlap_days, s: sim?.overlap_days, d: delta?.overlap_days },
                      { label: '중복 공수', o: orig?.overlap_md, s: sim?.overlap_md, d: delta?.overlap_md, unit: 'MD' },
                    ].map(row => (
                      <tr key={row.label} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 text-gray-600">{row.label}</td>
                        <td className="px-3 py-1.5 text-center font-semibold text-gray-700">
                          {row.o ?? '-'}{row.unit ?? ''}
                        </td>
                        <td className="px-3 py-1.5 text-center font-semibold text-blue-600">
                          {row.s ?? '-'}{row.unit ?? ''}
                        </td>
                        <td className={`px-3 py-1.5 text-center font-bold ${deltaColor(row.d ?? 0)}`}>
                          {row.d !== undefined ? deltaLabel(row.d) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 제안 사항 */}
              {simResult.suggestions.length > 0 && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700">💡 시뮬레이션 기반 제안</p>
                  <ul className="space-y-1">
                    {simResult.suggestions.map((s, i) => (
                      <li key={i} className="text-xs text-emerald-700 flex gap-1.5">
                        <span className="text-emerald-400 flex-shrink-0">→</span>{s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 제외 인력별 상세 */}
              {simResult.excluded_detail.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                    <UserMinus className="h-3.5 w-3.5 text-blue-500" />
                    제외 인력별 효과
                  </p>
                  {simResult.excluded_detail.map(ed => (
                    <div key={ed.person_key} className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        {ed.is_chief && <Crown className="h-3.5 w-3.5 text-purple-500" />}
                        <span className="text-xs font-semibold text-slate-700">{ed.person_name}</span>
                        {ed.grade && <span className="text-[10px] text-gray-400">{ed.grade}</span>}
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {ed.my_field || ed.my_category}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px]">
                        <span className="text-emerald-600 font-semibold">↓ {ed.resolved_days}일 해소</span>
                        <span className="text-orange-600">({ed.resolved_md}MD)</span>
                        <span className="text-gray-400">{ed.conflict_count}건 충돌 제거</span>
                      </div>
                      {/* 충돌 사업 요약 */}
                      {ed.conflicts_summary.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {ed.conflicts_summary.map((c, i) => (
                            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              c.type_label === 'A'
                                ? 'bg-blue-50 border-blue-200 text-blue-600'
                                : 'bg-orange-50 border-orange-200 text-orange-600'
                            }`}>
                              {c.type_label}: {c.other_project_name.slice(0, 10)} ({c.overlap_days}일)
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 대체 후보 */}
                      {ed.replacement_candidates.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-gray-500">대체 후보</p>
                          {ed.replacement_candidates.map(c => (
                            <div key={c.person_id} className={`flex items-center gap-2 px-2 py-1 rounded ${
                              c.is_available ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-200'
                            }`}>
                              <span className={`text-[10px] font-semibold ${c.is_available ? 'text-emerald-700' : 'text-gray-500'}`}>
                                {c.person_name}
                              </span>
                              {c.grade && <span className="text-[10px] text-gray-400">{c.grade}</span>}
                              {c.company && <span className="text-[10px] text-gray-300">· {c.company}</span>}
                              <span className={`ml-auto text-[10px] font-bold ${c.is_available ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {c.is_available ? '✓ 투입 가능' : '일정 중복'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 시뮬레이션 후 잔여 리스크 */}
              {simResult.risks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500">
                    잔여 리스크 ({simResult.risks.length}건)
                  </p>
                  {simResult.risks.map((risk, i) => {
                    const sev = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.info;
                    const cfg = RISK_CONFIG[risk.type];
                    return (
                      <div key={i} className={`rounded-lg border ${sev.border} ${sev.bg} px-3 py-2 flex items-center gap-2`}>
                        <span className={`text-[10px] font-bold ${sev.badge} px-1.5 py-0.5 rounded-full`}>{sev.label}</span>
                        <span className="text-xs text-gray-700">{risk.title}</span>
                        <span className="text-xs text-gray-400 ml-auto">{risk.count}건</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {simResult.risks.length === 0 && selectedKeys.size > 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-emerald-600 gap-2">
                  <CheckCircle2 className="h-8 w-8" />
                  <p className="text-sm font-semibold">모든 리스크 해소</p>
                  <p className="text-xs text-gray-400">선택 인력 제외 시 리스크가 없어집니다</p>
                </div>
              )}
            </div>
          )}

          {/* 텍스트 출력 탭 */}
          {activeResultTab === 'text' && textOutput && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600">
                  {textOutput.excluded_count > 0 && (
                    <span className="text-blue-600">{textOutput.excluded_count}명 제외 후 </span>
                  )}
                  텍스트 출력
                </p>
                <button
                  onClick={handleCopyAll}
                  className={`text-xs px-2.5 py-1 rounded border transition-all flex items-center gap-1 ${
                    copiedSection === '__all__'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <Copy className="h-3 w-3" />
                  {copiedSection === '__all__' ? '복사됨!' : '전체 복사'}
                </button>
              </div>

              {textOutput.sections.map((section, idx) => (
                <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">
                        {section.label === '감리 일정' ? '📅' :
                         section.label === '감리원' ? '👤' : '🔧'} {section.label}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{section.format}</p>
                    </div>
                    <button
                      onClick={() => handleCopy(section.label, section.content)}
                      className={`text-[10px] px-2 py-1 rounded border transition-all flex items-center gap-1 ${
                        copiedSection === section.label
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <Copy className="h-3 w-3" />
                      {copiedSection === section.label ? '복사됨!' : '복사'}
                    </button>
                  </div>
                  <div className="p-3">
                    {section.content ? (
                      <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {section.content}
                      </pre>
                    ) : (
                      <p className="text-[10px] text-gray-300 italic">
                        {section.label.includes('전문가') ? '해당 분야 배정 인력 없음' : '내용 없음'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 초기 상태 */}
          {!simResult && !textOutput && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-300 gap-3">
              <Play className="h-10 w-10" />
              <p className="text-sm font-medium text-gray-400">인력을 선택하면 자동으로 시뮬레이션됩니다</p>
              <p className="text-xs text-gray-300">또는 [텍스트 출력] 버튼을 클릭하세요</p>
            </div>
          )}
        </div>
      </div>
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

// ── 상세 패널 ─────────────────────────────────────────────────────────────────
function DetailPanel({ project, onBack }: { project: ProposalItem; onBack: () => void }) {
  const [tab, setTab] = useState<'schedule' | 'simulate' | 'risk'>('schedule');
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
          📅 일정 중복
        </button>
        <button
          onClick={() => setTab('simulate')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'simulate'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          🔬 리스크 시뮬레이션
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

      {tab === 'simulate' && (
        <SimulationPanel projectId={project.id} />
      )}

      {tab === 'risk' && (
        loadingDetail ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />분석 중...
          </div>
        ) : detail ? (
          <div className="space-y-4">
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
            {detail.risk_summary.total === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-emerald-600 gap-2">
                <CheckCircle2 className="h-12 w-12" />
                <p className="font-semibold">리스크 없음</p>
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
                <div className="flex-shrink-0">
                  {hasDanger
                    ? <AlertCircle className="h-5 w-5 text-red-500" />
                    : hasWarning
                    ? <AlertTriangle className="h-5 w-5 text-amber-400" />
                    : <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                </div>
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
