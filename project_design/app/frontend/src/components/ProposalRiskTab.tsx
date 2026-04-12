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
  ArrowRightLeft, CalendarRange, Zap, TrendingDown, RotateCcw, Info,
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

// ── 전체 인력 풀 타입 (all-people API) ───────────────────────────────────────
interface AllPerson {
  person_id: number;
  person_key: string;
  person_name: string;
  grade: string;
  position: string;
  company: string;
  is_chief: boolean;
  is_assigned: boolean;
  is_available: boolean;
  conflict_days: number;
  my_field?: string;       // 분야 매칭용 (옵션)
  field_match?: boolean;   // 해당 인력의 분야 일치 여부
}

interface AllPeopleResult {
  project_id: number;
  assigned: PersonSchedule[];
  all_people: AllPerson[];
  project_start: string | null;
  project_end: string | null;
}

// ── 최적화 추천 결과 타입 ────────────────────────────────────────────────────────
interface AlternateCandidate {
  person_id: number;
  person_name: string;
  person_key: string;
  is_chief: boolean;
  grade: string;
  position: string;
  company: string;
  is_available: boolean;
  conflict_days: number;
}

interface PersonReplaceOption {
  person_key: string;
  person_name: string;
  is_chief: boolean;
  grade: string;
  my_field: string;
  my_category: string;
  conflict_days: number;
  conflict_md: number;
  conflicts_count: number;
  expected_danger_delta: number;
  expected_warning_delta: number;
  expected_overlap_delta: number;
  alternates: AlternateCandidate[];
}

interface PhaseShiftPhase {
  phase_id: number;
  phase_name: string;
  orig_start: string;
  orig_end: string;
  new_start: string;
  new_end: string;
  shift_days: number;
}

interface PhaseShiftOption {
  option_id: string;
  risk_level: 'high' | 'medium' | 'low';  // high=리스크큼, medium=중간, low=리스크0
  label: string;
  description: string;
  new_start: string;
  new_end: string;
  shift_days: number;
  phases: PhaseShiftPhase[];
  estimated_conflict_reduction?: number;
  simulated: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
}

interface OptimizeResult {
  project_id: number;
  project_name: string;
  current: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  person_replace_options: PersonReplaceOption[];
  phase_shift_options: PhaseShiftOption[];
  best_combo: {
    label: string;
    description: string;
    replace: PersonReplaceOption | null;
    shift: PhaseShiftOption | null;
    expected_danger: number;
    expected_warning: number;
  };
  phases: { phase_id: number; phase_name: string; start_date: string; end_date: string; sort_order: number }[];
}

// simulate-v2 결과 타입
interface SimulateV2Result {
  project_id: number;
  original: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  simulated: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  delta: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  replacement_summary: { old_key: string; old_name: string; old_conflict_days: number; new_person_id: number | null; new_name: string; new_is_chief: boolean; new_grade: string }[];
  shift_summary: { phase_id: number; phase_name: string; orig_start: string; orig_end: string; new_start: string; new_end: string; shift_days: number }[];
  suggestions: string[];
  risks: RiskDetailItem[];
  people: PersonSchedule[];
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

// ── 인력 교체 드롭다운 ────────────────────────────────────────────────────────
function PersonReplacePicker({
  person,
  allPeople,
  currentValue,  // null=제외, number=교체 인력 id, undefined=미설정
  onChange,
}: {
  person: PersonSchedule;
  allPeople: AllPerson[];
  currentValue: number | null | undefined;
  onChange: (key: string, newPersonId: number | null | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 검색 필터 (자기 자신 제외) + 정렬: 즉시투입 우선 → 분야매칭 우선 → 중복일 오름차순
  const filtered = allPeople
    .filter(p =>
      p.person_key !== person.person_key &&
      (search === '' ||
        p.person_name.includes(search) ||
        p.grade.includes(search) ||
        p.company.includes(search) ||
        (p.my_field ?? '').includes(search))
    )
    .sort((a, b) => {
      // 1순위: 즉시투입 가능 여부
      if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
      // 2순위: 분야 매칭 여부 (있으면 우선)
      const aMatch = a.field_match ?? false;
      const bMatch = b.field_match ?? false;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
      // 3순위: 중복 일수 오름차순 (적을수록 리스크 낮음)
      if (a.conflict_days !== b.conflict_days) return a.conflict_days - b.conflict_days;
      // 4순위: 이름 가나다순
      return a.person_name.localeCompare(b.person_name, 'ko');
    });

  // 현재 선택된 인력 표시명
  const selectedPerson = currentValue != null
    ? allPeople.find(p => p.person_id === currentValue)
    : null;

  const label = selectedPerson
    ? selectedPerson.person_name
    : '원본 유지';

  const labelColor = currentValue === undefined
    ? 'text-gray-400'
    : 'text-emerald-700';

  return (
    <div ref={ref} className="relative inline-block w-full">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] transition-all ${
          currentValue !== undefined
            ? 'border-violet-300 bg-violet-50'
            : 'border-gray-200 bg-white hover:border-violet-300'
        }`}
      >
        <ArrowRightLeft className="h-3 w-3 text-gray-400 flex-shrink-0" />
        <span className={`flex-1 text-left truncate font-medium ${labelColor}`}>{label}</span>
        <ChevronDown className={`h-3 w-3 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* 검색창 */}
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="이름·등급·회사 검색..."
              className="w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* 원본 유지 */}
            <button
              onClick={() => { onChange(person.person_key, undefined); setOpen(false); setSearch(''); }}
              className={`w-full text-left px-3 py-2 text-[11px] hover:bg-gray-50 flex items-center gap-2 ${currentValue === undefined ? 'bg-gray-50 font-semibold' : ''}`}
            >
              <RotateCcw className="h-3 w-3 text-gray-400" />
              <span className="text-gray-600">원본 유지</span>
            </button>

            {/* 즉시투입 가능 / 중복 있음 구분 */}
            {(() => {
              const available = filtered.filter(p => p.is_available);
              const unavailable = filtered.filter(p => !p.is_available);
              return (
                <>
                  {available.length > 0 && (
                    <div className="px-3 py-1 text-[10px] bg-emerald-50 border-b border-emerald-100 font-semibold text-emerald-700 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      즉시 투입 가능 ({available.length}명) — 리스크 최소
                    </div>
                  )}
                  {available.map(p => (
                    <PersonPickerItem key={p.person_key} p={p} currentValue={currentValue}
                      onClick={() => { onChange(person.person_key, p.person_id); setOpen(false); setSearch(''); }} />
                  ))}
                  {unavailable.length > 0 && (
                    <div className="px-3 py-1 text-[10px] bg-orange-50 border-b border-orange-100 font-semibold text-orange-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
                      중복 있음 ({unavailable.length}명) — 중복 적은 순
                    </div>
                  )}
                  {unavailable.map(p => (
                    <PersonPickerItem key={p.person_key} p={p} currentValue={currentValue}
                      onClick={() => { onChange(person.person_key, p.person_id); setOpen(false); setSearch(''); }} />
                  ))}
                  {filtered.length === 0 && (
                    <div className="px-3 py-3 text-[11px] text-gray-400 text-center">검색 결과 없음</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonPickerItem({ p, currentValue, onClick }: {
  p: AllPerson;
  currentValue: number | null | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-[11px] hover:bg-violet-50 flex items-center gap-2 border-b border-gray-50 ${
        currentValue === p.person_id ? 'bg-violet-50 font-semibold' : ''
      }`}
    >
      {/* 가용 여부 표시 */}
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${p.is_available ? 'bg-emerald-500' : 'bg-orange-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          {p.is_chief && <Crown className="h-2.5 w-2.5 text-purple-500" />}
          <span className={`font-medium truncate ${p.is_available ? 'text-emerald-700' : 'text-gray-700'}`}>
            {p.person_name}
          </span>
          {p.grade && <span className="text-gray-400 flex-shrink-0">{p.grade}</span>}
          {p.field_match && (
            <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-600 flex-shrink-0">분야일치</span>
          )}
          {p.is_assigned && (
            <span className="text-[9px] px-1 rounded bg-blue-100 text-blue-600 flex-shrink-0">배정중</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {p.company && <span className="text-gray-400 truncate">{p.company}</span>}
          {p.my_field && <span className="text-gray-400 truncate">· {p.my_field}</span>}
          {!p.is_available && (
            <span className="text-orange-500 flex-shrink-0">{p.conflict_days}일 중복</span>
          )}
          {p.is_available && (
            <span className="text-emerald-500 flex-shrink-0">즉시 투입 가능</span>
          )}
        </div>
      </div>
      {currentValue === p.person_id && (
        <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
      )}
    </button>
  );
}



// ── 통합 시뮬레이션 패널 (일정중복 + 인력교체 + 일정이동 + 실시간 리스크) ─────
function IntegratedSimPanel({ projectId }: { projectId: number }) {
  // ── 데이터 상태 ────────────────────────────────────────────────────────────
  const [allPeopleData, setAllPeopleData] = useState<AllPeopleResult | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // ── 시뮬레이션 설정 상태 ──────────────────────────────────────────────────
  // {person_key: number(교체id) | undefined(원본)}
  const [personReplacements, setPersonReplacements] = useState<Record<string, number | null | undefined>>({});
  // {phase_id: {start_date, end_date}}
  const [phaseShifts, setPhaseShifts] = useState<Record<string, { start_date: string; end_date: string }>>({});

  // ── 시뮬레이션 결과 ────────────────────────────────────────────────────────
  const [simResult, setSimResult] = useState<SimulateV2Result | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  // ── UI 상태 ────────────────────────────────────────────────────────────────
  const [showOnlyConflict, setShowOnlyConflict] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState(true);  // 기본 펼침
  const [activeView, setActiveView] = useState<'table' | 'text'>('table');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 데이터 로드 ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [peopleRes, optRes] = await Promise.all([
        axios.get(`/api/v1/proposal-risk/${projectId}/all-people`, { headers: getAuthHeaders() }),
        axios.post(`/api/v1/proposal-risk/${projectId}/optimize`, {}, { headers: getAuthHeaders() }),
      ]);
      setAllPeopleData(peopleRes.data);
      setOptimizeResult(optRes.data);
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }, [projectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── 실시간 시뮬레이션 (debounce 400ms) ────────────────────────────────────
  const hasChanges = Object.values(personReplacements).some(v => v !== undefined)
    || Object.keys(phaseShifts).length > 0;

  useEffect(() => {
    if (!hasChanges) {
      setSimResult(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSimLoading(true);
      try {
        // undefined는 "원본 유지"이므로 제외, null/number만 전달
        const cleanReplacements: Record<string, number | null> = {};
        Object.entries(personReplacements).forEach(([k, v]) => {
          if (v !== undefined) cleanReplacements[k] = v as number | null;
        });

        const phaseShiftsInt: Record<number, { start_date: string; end_date: string }> = {};
        Object.entries(phaseShifts).forEach(([k, v]) => { phaseShiftsInt[parseInt(k)] = v; });

        const res = await axios.post(
          `/api/v1/proposal-risk/${projectId}/simulate-v2`,
          { person_replacements: cleanReplacements, phase_shifts: phaseShiftsInt },
          { headers: getAuthHeaders() }
        );
        setSimResult(res.data);
      } catch (e) { console.error(e); }
      finally { setSimLoading(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [personReplacements, phaseShifts, projectId, hasChanges]);

  // ── 핸들러 ────────────────────────────────────────────────────────────────
  const handlePersonChange = useCallback((key: string, newId: number | null | undefined) => {
    setPersonReplacements(prev => ({ ...prev, [key]: newId }));
  }, []);

  const handlePhaseShift = useCallback((phaseId: string, start: string, end: string) => {
    setPhaseShifts(prev => ({ ...prev, [phaseId]: { start_date: start, end_date: end } }));
  }, []);

  const handlePhaseReset = useCallback((phaseId: string) => {
    setPhaseShifts(prev => {
      const n = { ...prev }; delete n[phaseId]; return n;
    });
  }, []);

  const resetAll = useCallback(() => {
    setPersonReplacements({});
    setPhaseShifts({});
    setSimResult(null);
  }, []);

  // 최적 조합 자동 적용
  const applyBestCombo = useCallback(() => {
    if (!optimizeResult?.best_combo) return;
    const combo = optimizeResult.best_combo;
    const newR: Record<string, number | null | undefined> = {};
    const newS: Record<string, { start_date: string; end_date: string }> = {};
    if (combo.replace) {
      const firstAvail = combo.replace.alternates.find(a => a.is_available);
      newR[combo.replace.person_key] = firstAvail?.person_id ?? null;
    }
    if (combo.shift) {
      combo.shift.phases.forEach(ph => {
        newS[String(ph.phase_id)] = { start_date: ph.new_start, end_date: ph.new_end };
      });
    }
    setPersonReplacements(newR);
    setPhaseShifts(newS);
  }, [optimizeResult]);

  if (loadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
        <Loader2 className="h-7 w-7 animate-spin" />
        <p className="text-sm">인력·일정 데이터 분석 중...</p>
      </div>
    );
  }

  const assigned = allPeopleData?.assigned ?? [];
  const allPeople = allPeopleData?.all_people ?? [];
  const phases = optimizeResult?.phases ?? [];

  // 시뮬레이션 결과가 있으면 시뮬레이션된 인력 목록 사용 (일정이동/교체 반영)
  const displayPeople: PersonSchedule[] = simResult?.people?.length
    ? simResult.people
    : assigned;

  const conflictPeople = displayPeople.filter(p => p.has_conflict);
  const visiblePeople = showOnlyConflict ? conflictPeople : displayPeople;

  // 현재 vs 시뮬레이션 수치
  const orig = simResult?.original ?? optimizeResult?.current;
  const sim  = simResult?.simulated;
  const delta = simResult?.delta;

  function dColor(v: number) {
    return v > 0 ? 'text-emerald-600 font-bold' : v < 0 ? 'text-red-500 font-bold' : 'text-gray-400';
  }
  function dLabel(v: number) {
    return v > 0 ? `▼${v}` : v < 0 ? `▲${Math.abs(v)}` : '–';
  }

  // 추천안 적용 핸들러
  const applyShiftOption = useCallback((opt: PhaseShiftOption) => {
    const ns: Record<string, { start_date: string; end_date: string }> = {};
    opt.phases.forEach(ph => {
      ns[String(ph.phase_id)] = { start_date: ph.new_start, end_date: ph.new_end };
    });
    setPhaseShifts(ns);
  }, []);

  return (
    <div className="space-y-3">

      {/* ── 1. 요약 수치 카드 ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-1.5">
        {[
          { label: '위험',     cur: orig?.danger,          sim: sim?.danger,          d: delta?.danger,          cls: 'text-red-600',    bg: 'bg-red-50 border-red-200' },
          { label: '주의',     cur: orig?.warning,         sim: sim?.warning,         d: delta?.warning,         cls: 'text-amber-500',  bg: 'bg-amber-50 border-amber-200' },
          { label: '중복 인력', cur: orig?.conflict_people, sim: sim?.conflict_people, d: delta?.conflict_people, cls: 'text-orange-500', bg: 'bg-orange-50 border-orange-200' },
          { label: '중복 일수', cur: orig?.overlap_days,    sim: sim?.overlap_days,    d: delta?.overlap_days,    cls: 'text-slate-600',  bg: 'bg-gray-50 border-gray-200' },
          { label: '중복 MD',  cur: orig?.overlap_md,      sim: sim?.overlap_md,      d: delta?.overlap_md,      cls: 'text-slate-600',  bg: 'bg-gray-50 border-gray-200' },
        ].map(item => (
          <div key={item.label}
            className={`rounded-xl border px-2 py-2.5 text-center ${
              item.d !== undefined && item.d > 0 ? 'border-emerald-300 bg-emerald-50' : item.bg
            }`}
          >
            <p className="text-[10px] text-gray-400 mb-1">{item.label}</p>
            <p className={`text-base font-bold ${item.cls}`}>{item.cur ?? 0}</p>
            {item.d !== undefined && item.d !== 0 && (
              <div className="mt-0.5 flex items-center justify-center gap-1">
                <span className={`text-xs ${dColor(item.d)}`}>{dLabel(item.d)}</span>
                <span className={`text-[10px] font-bold ${item.d > 0 ? 'text-emerald-600' : 'text-red-500'}`}>→ {item.sim}</span>
              </div>
            )}
            {simLoading && item.d === undefined && (
              <Loader2 className="h-3 w-3 animate-spin text-violet-400 mx-auto mt-0.5" />
            )}
          </div>
        ))}
      </div>

      {/* ── 2. 시뮬레이션 상태 배너 ────────────────────────────────────────── */}
      {hasChanges && (
        <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 ${
          simResult?.simulated.conflict_people === 0
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-violet-200 bg-violet-50/60'
        }`}>
          {simLoading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 flex-shrink-0" />
            : simResult?.simulated.conflict_people === 0
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
            : <Zap className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
          }
          <span className={`text-xs flex-1 ${simResult?.simulated.conflict_people === 0 ? 'text-emerald-700 font-semibold' : 'text-violet-700'}`}>
            {simLoading ? '실시간 리스크 계산 중 — 인력 중복 현황이 자동 업데이트됩니다...' :
             simResult?.simulated.conflict_people === 0
               ? '✅ 이 조합으로 모든 일정 중복이 해소됩니다!'
               : `시뮬레이션 적용 중 — ${[
                   Object.values(personReplacements).filter(v => v !== undefined && v !== null).length > 0
                     && `인력 ${Object.values(personReplacements).filter(v => v !== undefined && v !== null).length}명 교체`,
                   Object.keys(phaseShifts).length > 0
                     && `일정 ${Object.keys(phaseShifts).length}건 이동`,
                 ].filter(Boolean).join(' · ')}`
            }
          </span>
          <button onClick={resetAll} className="text-[10px] text-gray-400 hover:text-red-500 flex items-center gap-1 flex-shrink-0">
            <RotateCcw className="h-3 w-3" />초기화
          </button>
        </div>
      )}

      {/* ── 3. 일정 조정 추천안 + 단계별 일정 조정 ────────────────────────── */}
      {phases.length > 0 && (
        <div className="space-y-2">

          {/* 추천안 3개 카드 — 인력 테이블보다 위 */}
          {optimizeResult?.phase_shift_options && optimizeResult.phase_shift_options.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-500 px-0.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-violet-400" />
                일정 조정 추천안
                <span className="text-gray-400 font-normal">— 클릭하면 즉시 적용됩니다</span>
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {(() => {
                  // high(최소변경) → medium(중간) → low(중복제로) 순서로 정렬해 항상 3안 순서 유지
                  const ordered = [...optimizeResult.phase_shift_options].sort((a, b) => {
                    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
                    return (order[a.risk_level ?? 'high'] ?? 0) - (order[b.risk_level ?? 'high'] ?? 0);
                  });
                  return ordered.map(opt => {
                    const isApplied = Object.keys(phaseShifts).length > 0 &&
                      opt.phases.every(ph => {
                        const cur = phaseShifts[String(ph.phase_id)];
                        return cur?.start_date === ph.new_start && cur?.end_date === ph.new_end;
                      });
                    // risk_level: high=리스크큼(일정변경 최소), medium=리스크중간, low=리스크최소(중복제로)
                    const riskCfg = opt.risk_level === 'low'
                      ? { border: 'border-emerald-300', bg: isApplied ? 'bg-emerald-100' : 'bg-emerald-50 hover:bg-emerald-100', badge: 'bg-emerald-500', badgeText: '리스크 최소 · 중복 제로', icon: '✅', titleCls: 'text-emerald-700', valCls: 'text-emerald-600', subtitle: '일정 중복 완전 해소' }
                      : opt.risk_level === 'medium'
                      ? { border: 'border-amber-300',   bg: isApplied ? 'bg-amber-100'   : 'bg-amber-50 hover:bg-amber-100',   badge: 'bg-amber-500',   badgeText: '리스크 중간',         icon: '⚖️', titleCls: 'text-amber-700',   valCls: 'text-amber-600', subtitle: '주요 인력 중복 해소' }
                      : { border: 'border-red-200',     bg: isApplied ? 'bg-red-100'     : 'bg-red-50 hover:bg-red-100',       badge: 'bg-red-400',     badgeText: '일정변경 최소',       icon: '⚠️', titleCls: 'text-red-700',     valCls: 'text-red-500',   subtitle: '일부 중복 잔존' };
                    const s = opt.simulated;
                    return (
                      <button
                        key={opt.option_id}
                        onClick={() => applyShiftOption(opt)}
                        className={`rounded-xl border ${riskCfg.border} ${riskCfg.bg} p-2.5 text-left transition-all relative ${isApplied ? 'ring-2 ring-offset-1 ring-violet-400' : ''}`}
                      >
                        {isApplied && (
                          <span className="absolute top-1.5 right-1.5 text-[9px] bg-violet-500 text-white px-1 rounded-full">적용중</span>
                        )}
                        {/* 리스크 뱃지 */}
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className={`inline-block text-[9px] text-white px-1.5 py-0.5 rounded-full font-semibold ${riskCfg.badge}`}>
                            {riskCfg.icon} {riskCfg.badgeText}
                          </span>
                        </div>
                        {/* 제목 + 부제 */}
                        <p className={`text-[11px] font-bold leading-tight mb-0.5 ${riskCfg.titleCls}`}>{opt.label}</p>
                        <p className={`text-[9px] mb-1 font-medium ${riskCfg.valCls}`}>{riskCfg.subtitle}</p>
                        <p className="text-[9px] text-gray-500 leading-snug mb-2">{opt.description}</p>
                        {/* 예상 수치 */}
                        <div className="grid grid-cols-3 gap-1 border-t border-current/10 pt-1.5 mt-1">
                          <div className="text-center">
                            <p className="text-[8px] text-gray-400">위험</p>
                            <p className={`text-xs font-bold ${s.danger > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{s.danger}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[8px] text-gray-400">중복인력</p>
                            <p className={`text-xs font-bold ${s.conflict_people > 0 ? riskCfg.valCls : 'text-emerald-600'}`}>{s.conflict_people}명</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[8px] text-gray-400">중복일수</p>
                            <p className={`text-xs font-bold ${s.overlap_days > 0 ? riskCfg.valCls : 'text-emerald-600'}`}>{s.overlap_days}일</p>
                          </div>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* 단계별 일정 조정 테이블 — 추천안 아래 */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <CalendarRange className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-700 flex-1">단계별 일정 직접 조정</span>
              {Object.keys(phaseShifts).length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                  {Object.keys(phaseShifts).length}건 변경 중
                </span>
              )}
              <button onClick={() => setExpandedPhases(v => !v)} className="text-gray-400 hover:text-gray-600">
                {expandedPhases ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
            {expandedPhases && (
              <div className="divide-y divide-gray-100">
                {phases.map(ph => {
                  const shifted = phaseShifts[String(ph.phase_id)];
                  const curStart = shifted?.start_date ?? ph.start_date;
                  const curEnd   = shifted?.end_date   ?? ph.end_date;
                  const isChanged = !!shifted;
                  const shiftDays = isChanged
                    ? Math.round((new Date(phaseShifts[String(ph.phase_id)].start_date).getTime() - new Date(ph.start_date).getTime()) / 86400000)
                    : 0;
                  return (
                    <div key={ph.phase_id}
                      className={`flex items-center gap-2 px-3 py-2 transition-colors ${isChanged ? 'bg-orange-50 border-l-2 border-l-orange-400' : 'hover:bg-gray-50/50'}`}>
                      <span className={`text-[10px] font-medium w-24 flex-shrink-0 truncate ${isChanged ? 'text-orange-700' : 'text-gray-700'}`} title={ph.phase_name}>
                        {ph.phase_name}
                      </span>
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input type="date" value={curStart}
                          onChange={e => handlePhaseShift(String(ph.phase_id), e.target.value, curEnd)}
                          className={`text-[10px] border rounded px-1.5 py-1 flex-1 min-w-0 ${isChanged ? 'border-orange-300 bg-orange-50 text-orange-800 font-medium' : 'border-gray-200 text-gray-600'}`}
                        />
                        <span className="text-[10px] text-gray-300 flex-shrink-0">~</span>
                        <input type="date" value={curEnd}
                          onChange={e => handlePhaseShift(String(ph.phase_id), curStart, e.target.value)}
                          className={`text-[10px] border rounded px-1.5 py-1 flex-1 min-w-0 ${isChanged ? 'border-orange-300 bg-orange-50 text-orange-800 font-medium' : 'border-gray-200 text-gray-600'}`}
                        />
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isChanged && (
                          <span className={`text-[10px] font-bold ${shiftDays >= 0 ? 'text-orange-600' : 'text-blue-500'}`}>
                            {shiftDays >= 0 ? `+${shiftDays}일` : `${shiftDays}일`}
                          </span>
                        )}
                        {isChanged
                          ? <button onClick={() => handlePhaseReset(String(ph.phase_id))} className="text-gray-400 hover:text-red-500 p-0.5" title="원복"><RotateCcw className="h-3 w-3" /></button>
                          : <span className="w-4" />
                        }
                      </div>
                    </div>
                  );
                })}
                {Object.keys(phaseShifts).length > 0 && (
                  <div className="px-3 py-1.5 bg-orange-50/50 text-[9px] text-orange-500 flex items-center gap-1">
                    <Info className="h-3 w-3 flex-shrink-0" />
                    날짜 변경 시 실시간으로 인력 중복 현황이 자동 재계산됩니다
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 4. 메인: 좌우 레이아웃 ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">

        {/* ── 좌측 2/3: 인력 중복 현황 테이블 ──────────────────────────── */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">
              인력별 일정 중복 현황
              {simResult && <span className="ml-1.5 text-[10px] text-violet-500 font-normal">(시뮬레이션 반영)</span>}
              <span className="ml-1.5 text-gray-400 font-normal text-[10px]">
                ({conflictPeople.length}/{displayPeople.length}명 중복)
              </span>
            </p>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400">
                <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />중복 없음</span>
                <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />중복 있음</span>
              </div>
              <button
                onClick={() => setShowOnlyConflict(v => !v)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                  showOnlyConflict ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                }`}
              >
                중복만
              </button>
            </div>
          </div>

          {assigned.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-xs">배정된 인력이 없거나 감리 단계 일정이 미입력</div>
          ) : (
            <div className={`rounded-xl border overflow-hidden transition-all ${simLoading ? 'opacity-60' : ''} ${simResult ? 'border-violet-200' : 'border-gray-200'}`}>
              {simLoading && (
                <div className="bg-violet-50 border-b border-violet-100 px-3 py-1 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
                  <span className="text-[10px] text-violet-600">일정 변경 적용 중 — 인력 중복 재계산...</span>
                </div>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr className={`border-b text-gray-500 text-[11px] ${simResult ? 'bg-violet-50 border-violet-100' : 'bg-gray-50 border-gray-200'}`}>
                    <th className="text-left px-3 py-2 font-semibold">인력</th>
                    <th className="text-left px-3 py-2 font-semibold">분야</th>
                    <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">중복일</th>
                    <th className="text-center px-2 py-2 font-semibold whitespace-nowrap">MD</th>
                    <th className="text-left px-2 py-2 font-semibold">교체 인력</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePeople.map(person => (
                    <IntegratedPersonRow
                      key={person.person_key}
                      person={person}
                      allPeople={allPeople}
                      replaceValue={personReplacements[person.person_key]}
                      onReplaceChange={handlePersonChange}
                    />
                  ))}
                  {visiblePeople.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-emerald-500 text-xs">
                        <CheckCircle2 className="h-6 w-6 mx-auto mb-1" />
                        {simResult ? '시뮬레이션 결과 — 중복 인력 없음 ✅' : '중복 인력 없음'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 우측 1/3: 실시간 결과 ────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex gap-0 border-b border-gray-200">
            <button onClick={() => setActiveView('table')}
              className={`flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeView === 'table' ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500'}`}>
              📊 분석 결과
            </button>
            <button onClick={() => setActiveView('text')}
              className={`flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeView === 'text' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500'}`}>
              📝 텍스트 출력
            </button>
          </div>

          {activeView === 'table' && (
            <div className="space-y-3">
              {!hasChanges ? (
                <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-4 text-center space-y-2">
                  <ArrowRightLeft className="h-6 w-6 text-violet-300 mx-auto" />
                  <p className="text-xs text-gray-500">
                    위 추천안을 클릭하거나<br />인력 교체 / 일정 직접 변경 시<br />실시간으로 리스크가 계산됩니다
                  </p>
                </div>
              ) : simLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-violet-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p className="text-xs">리스크 계산 중...</p>
                </div>
              ) : simResult ? (
                <div className="space-y-3">
                  <RiskCompareTable original={simResult.original} simulated={simResult.simulated} delta={simResult.delta} />
                  {simResult.replacement_summary.length > 0 && (
                    <div className="space-y-1">
                      {simResult.replacement_summary.map((r, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] bg-blue-50 rounded-lg px-2 py-1.5">
                          <ArrowRightLeft className="h-3 w-3 text-blue-400 flex-shrink-0" />
                          <span className="text-red-600 font-semibold">{r.old_name}</span>
                          <span className="text-gray-300">→</span>
                          <span className="text-emerald-600 font-semibold">{r.new_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {simResult.shift_summary.length > 0 && (
                    <div className="space-y-1">
                      {simResult.shift_summary.map((s, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] bg-orange-50 rounded-lg px-2 py-1.5">
                          <CalendarRange className="h-3 w-3 text-orange-400 flex-shrink-0" />
                          <span className="font-semibold text-gray-700">{s.phase_name}</span>
                          <span className="text-gray-400">{s.orig_start}</span>
                          <span className="text-gray-300">→</span>
                          <span className="text-orange-600 font-semibold">{s.new_start}</span>
                          <span className="text-[9px] text-orange-400">+{s.shift_days}일</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {simResult.suggestions.length > 0 && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 space-y-1">
                      {simResult.suggestions.map((s, i) => (
                        <p key={i} className="text-[11px] text-emerald-700 flex gap-1.5">
                          <span className="text-emerald-400">→</span>{s}
                        </p>
                      ))}
                    </div>
                  )}
                  <RemainingRisks risks={simResult.risks} />
                </div>
              ) : null}
            </div>
          )}

          {activeView === 'text' && (
            <TextOutputPanel
              projectId={projectId}
              excludedPersonKeys={[]}
              personReplacements={
                Object.fromEntries(
                  Object.entries(personReplacements)
                    .filter(([, v]) => v !== undefined && v !== null)
                    .map(([k, v]) => [k, v as number])
                )
              }
              phaseShifts={phaseShifts}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 통합 패널의 인력 행 ───────────────────────────────────────────────────────
function IntegratedPersonRow({
  person,
  allPeople,
  replaceValue,
  onReplaceChange,
}: {
  person: PersonSchedule;
  allPeople: AllPerson[];
  replaceValue: number | null | undefined;
  onReplaceChange: (key: string, v: number | null | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isReplaced = typeof replaceValue === 'number';

  return (
    <>
      <tr
        className={`border-b border-gray-100 transition-colors ${
          isReplaced ? 'bg-violet-50/50'
          : person.has_conflict ? (person.is_chief ? 'bg-purple-50/30' : 'bg-white')
          : 'bg-white'
        }`}
      >
        {/* 인력명 */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {person.is_chief && <Crown className="h-3 w-3 text-purple-500 flex-shrink-0" />}
            <span className={`text-[11px] font-semibold truncate max-w-[80px] ${
              person.is_chief ? 'text-purple-700'
              : 'text-slate-700'
            }`}>
              {person.person_name}
            </span>
          </div>
          {person.grade && <div className="text-[9px] text-gray-400 mt-0.5 pl-3">{person.grade}</div>}
        </td>

        {/* 분야 */}
        <td className="px-2 py-2">
          <MyFieldCell field={person.my_field} subField={person.my_sub_field} />
        </td>

        {/* 중복일 */}
        <td className="px-2 py-2 text-center">
          {person.has_conflict ? (
            <span className="text-[11px] font-bold text-red-600">{person.total_overlap_days}일</span>
          ) : (
            <span className="text-[10px] text-emerald-500">없음</span>
          )}
        </td>

        {/* MD */}
        <td className="px-2 py-2 text-center">
          {person.has_conflict ? (
            <span className="text-[10px] text-orange-600">{person.total_overlap_md}MD</span>
          ) : (
            <span className="text-[10px] text-gray-300">–</span>
          )}
        </td>

        {/* 교체 드롭다운 */}
        <td className="px-2 py-2">
          <PersonReplacePicker
            person={person}
            allPeople={allPeople}
            currentValue={replaceValue}
            onChange={onReplaceChange}
          />
        </td>

        {/* 충돌 확장 버튼 */}
        <td className="px-1 py-2">
          {person.has_conflict && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-gray-400 hover:text-gray-600 p-0.5"
              title="충돌 상세 보기"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </td>
      </tr>

      {/* 충돌 상세 행 */}
      {expanded && person.conflicts.map((c, idx) => (
        <tr
          key={idx}
          className={`border-b border-gray-50 ${c.other_field_highlight ? 'bg-rose-50/60' : 'bg-slate-50/50'}`}
        >
          <td colSpan={2} className="pl-10 pr-3 py-1.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <TypeBadge type={c.type_label} />
              <span className="text-[10px] text-slate-700 font-medium" title={c.other_project_name}
                style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                {c.other_project_name}
              </span>
              {c.other_field_highlight && (
                <span className="text-[9px] bg-rose-100 text-rose-600 px-1 rounded font-bold">⚠ 동일분야</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[9px] text-gray-400 mt-0.5 pl-1">
              <span className="truncate">{c.other_phase_name}</span>
              <span className="text-gray-300">|</span>
              <span className="text-blue-400 whitespace-nowrap">{c.overlap_start} ~ {c.overlap_end}</span>
              {c.other_field && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className={c.other_field_highlight ? 'text-rose-500 font-semibold' : 'text-gray-400'}>
                    {c.other_field}
                  </span>
                </>
              )}
            </div>
          </td>
          <td className="px-2 py-1.5 text-center">
            <span className="text-[10px] font-semibold text-red-600">{c.overlap_days}일</span>
          </td>
          <td className="px-2 py-1.5 text-center">
            <span className="text-[10px] text-orange-600">{c.overlap_md}MD</span>
          </td>
          <td colSpan={2} />
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

// ── 리스크 수치 비교 테이블 (공통) ───────────────────────────────────────────
function RiskCompareTable({
  original,
  simulated,
  delta,
  loading,
}: {
  original: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  simulated: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  delta: { danger: number; warning: number; conflict_people: number; overlap_days: number; overlap_md: number };
  loading?: boolean;
}) {
  function deltaColor(val: number) {
    if (val > 0) return 'text-emerald-600 font-bold';
    if (val < 0) return 'text-red-500 font-bold';
    return 'text-gray-400';
  }
  function deltaLabel(val: number) {
    if (val > 0) return `▼ ${val}`;
    if (val < 0) return `▲ ${Math.abs(val)}`;
    return '–';
  }

  const rows = [
    { label: '위험 건수',  o: original.danger,          s: simulated.danger,          d: delta.danger,          unit: '' },
    { label: '주의 건수',  o: original.warning,         s: simulated.warning,         d: delta.warning,         unit: '' },
    { label: '중복 인력',  o: original.conflict_people, s: simulated.conflict_people, d: delta.conflict_people, unit: '명' },
    { label: '중복 일수',  o: original.overlap_days,    s: simulated.overlap_days,    d: delta.overlap_days,    unit: '일' },
    { label: '중복 공수',  o: original.overlap_md,      s: simulated.overlap_md,      d: delta.overlap_md,      unit: 'MD' },
  ];

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">리스크 수치 비교</p>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
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
          {rows.map(row => (
            <tr key={row.label} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-3 py-1.5 text-gray-600">{row.label}</td>
              <td className="px-3 py-1.5 text-center font-semibold text-gray-700">
                {row.o}{row.unit}
              </td>
              <td className={`px-3 py-1.5 text-center font-semibold ${row.d > 0 ? 'text-emerald-600' : row.d < 0 ? 'text-red-500' : 'text-blue-600'}`}>
                {row.s}{row.unit}
              </td>
              <td className={`px-3 py-1.5 text-center ${deltaColor(row.d)}`}>
                {deltaLabel(row.d)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 잔여 리스크 목록 ─────────────────────────────────────────────────────────
function RemainingRisks({ risks }: { risks: RiskDetailItem[] }) {
  if (risks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-emerald-600 gap-2">
        <CheckCircle2 className="h-7 w-7" />
        <p className="text-xs font-semibold">모든 리스크 해소!</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-500">잔여 리스크 ({risks.length}건)</p>
      {risks.map((risk, i) => {
        const sev = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.info;
        return (
          <div key={i} className={`rounded-lg border ${sev.border} ${sev.bg} px-3 py-2 flex items-center gap-2`}>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sev.badge}`}>{sev.label}</span>
            <span className="text-xs text-gray-700">{risk.title}</span>
            <span className="text-xs text-gray-400 ml-auto">{risk.count}건</span>
          </div>
        );
      })}
    </div>
  );
}

// ── 텍스트 출력 패널 ─────────────────────────────────────────────────────────
// TextOutputResult 타입 확장 (replacements_count, phase_shifts_count)
interface TextOutputResultV2 extends TextOutputResult {
  replacements_count?: number;
  phase_shifts_count?: number;
}

function TextOutputPanel({
  projectId,
  excludedPersonKeys,
  personReplacements,
  phaseShifts,
  simApplied,
}: {
  projectId: number;
  excludedPersonKeys?: string[];
  personReplacements?: Record<string, number | null>;
  phaseShifts?: Record<string, { start_date: string; end_date: string }>;
  simApplied?: boolean;   // 직접 시뮬레이션 결과가 적용된 상태인지
}) {
  const [textOutput, setTextOutput] = useState<TextOutputResultV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // 시뮬레이션 설정 변경 시 이전 결과 초기화
  const prevSimKey = useRef<string>('');
  const simKey = JSON.stringify({ excludedPersonKeys, personReplacements, phaseShifts });
  if (prevSimKey.current !== simKey) {
    prevSimKey.current = simKey;
    if (textOutput) setTextOutput(null);
  }

  const hasSimulation = (
    (excludedPersonKeys?.length ?? 0) > 0 ||
    Object.keys(personReplacements ?? {}).length > 0 ||
    Object.keys(phaseShifts ?? {}).length > 0
  );

  const runTextOutput = async () => {
    setLoading(true);
    try {
      // phase_shifts 키를 숫자 형태로 변환하여 전송
      const phaseShiftsInt: Record<number, { start_date: string; end_date: string }> = {};
      Object.entries(phaseShifts ?? {}).forEach(([k, v]) => {
        phaseShiftsInt[parseInt(k)] = v;
      });

      const res = await axios.post(
        `/api/v1/proposal-risk/${projectId}/text-output`,
        {
          excluded_person_keys: excludedPersonKeys ?? [],
          person_replacements:  personReplacements ?? {},
          phase_shifts:         phaseShiftsInt,
        },
        { headers: getAuthHeaders() }
      );
      setTextOutput(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
    const all = textOutput.sections.map(s => `[${s.label}]\n${s.content}`).join('\n\n');
    await handleCopy('__all__', all);
  };

  // 적용된 시뮬레이션 요약 문구
  const simSummaryParts: string[] = [];
  const replaceCount = Object.keys(personReplacements ?? {}).filter(k => (personReplacements ?? {})[k] !== null).length;
  const excludeCount = Object.keys(personReplacements ?? {}).filter(k => (personReplacements ?? {})[k] === null).length
    + (excludedPersonKeys?.length ?? 0);
  const shiftCount = Object.keys(phaseShifts ?? {}).length;
  if (replaceCount > 0)  simSummaryParts.push(`인력 ${replaceCount}명 교체`);
  if (excludeCount > 0)  simSummaryParts.push(`${excludeCount}명 제외`);
  if (shiftCount > 0)    simSummaryParts.push(`일정 ${shiftCount}건 이동`);

  return (
    <div className="space-y-3">
      {/* 시뮬레이션 적용 안내 */}
      {hasSimulation ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 flex items-start gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-violet-700 flex-1">
            <p className="font-semibold">시뮬레이션 결과 반영</p>
            <p className="text-violet-500 mt-0.5">{simSummaryParts.join(' · ')} 적용 후 인력·일정 기준으로 출력됩니다</p>
          </div>
          <Button size="sm" onClick={runTextOutput} disabled={loading}
            className="bg-violet-600 hover:bg-violet-700 text-white flex-shrink-0">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
            시뮬레이션 결과 출력
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">현재 배정 인력·일정 기준으로 출력합니다</p>
          <Button size="sm" onClick={runTextOutput} disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileText className="h-3.5 w-3.5 mr-1" />}
            텍스트 생성
          </Button>
        </div>
      )}

      {/* 직접 시뮬레이션 설정 없을 때 안내 */}
      {!hasSimulation && !textOutput && !loading && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center space-y-2">
          <FileText className="h-7 w-7 mx-auto text-gray-300" />
          <p className="text-xs text-gray-400">
            위 [텍스트 생성] 버튼을 눌러 현재 배정 인력 기준 텍스트를 출력하세요
          </p>
          <p className="text-[10px] text-gray-300">
            💡 [직접 시뮬레이션] 탭에서 인력 교체·일정 이동 후 이 탭으로 오면<br/>시뮬레이션 결과가 반영된 텍스트를 출력할 수 있습니다
          </p>
        </div>
      )}

      {/* 결과 출력 */}
      {textOutput && (
        <>
          {/* 결과 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-600 font-semibold">✓ 텍스트 생성 완료</span>
              {(textOutput.replacements_count ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px]">
                  인력교체 {textOutput.replacements_count}명 반영
                </span>
              )}
              {(textOutput.phase_shifts_count ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px]">
                  일정이동 {textOutput.phase_shifts_count}건 반영
                </span>
              )}
              {textOutput.excluded_count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px]">
                  {textOutput.excluded_count}명 제외
                </span>
              )}
            </div>
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
                    {section.label === '감리 일정' ? '📅' : section.label === '감리원' ? '👤' : '🔧'} {section.label}
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

          {/* 재생성 버튼 */}
          <div className="flex justify-center pt-1">
            <button
              onClick={runTextOutput}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              다시 생성
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 시뮬레이션 패널 (V2: 인력교체 + 일정이동 + 최적화 추천) ───────────────────
function SimulationPanel({ projectId }: { projectId: number }) {
  const [activeTab, setActiveTab] = useState<'optimize' | 'custom' | 'text'>('optimize');

  // ── 최적화 추천 상태 ─────────────────────────────────────────────────────────
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [optimizeLoading, setOptimizeLoading] = useState(false);

  // ── 직접 시뮬레이션 상태 ─────────────────────────────────────────────────────
  // 인력 교체: {old_person_key → new_person_id | null}
  const [personReplacements, setPersonReplacements] = useState<Record<string, number | null>>({});
  // 일정 이동: {phase_id → {start_date, end_date}}
  const [phaseShifts, setPhaseShifts] = useState<Record<string, { start_date: string; end_date: string }>>({});
  const [simV2Result, setSimV2Result] = useState<SimulateV2Result | null>(null);
  const [simV2Loading, setSimV2Loading] = useState(false);

  // ── 스케줄/인력 데이터 ────────────────────────────────────────────────────────
  const [scheduleData, setScheduleData] = useState<ScheduleDetail | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  // ── 초기 로드 ────────────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const res = await axios.get(`/api/v1/proposal-risk/${projectId}/schedule`, { headers: getAuthHeaders() });
      setScheduleData(res.data);
    } catch (e) { console.error(e); }
    finally { setScheduleLoading(false); }
  }, [projectId]);

  const loadOptimize = useCallback(async () => {
    setOptimizeLoading(true);
    try {
      const res = await axios.post(`/api/v1/proposal-risk/${projectId}/optimize`, {}, { headers: getAuthHeaders() });
      setOptimizeResult(res.data);
    } catch (e) { console.error(e); }
    finally { setOptimizeLoading(false); }
  }, [projectId]);

  useEffect(() => {
    loadSchedule();
    loadOptimize();
  }, [loadSchedule, loadOptimize]);

  // ── 직접 시뮬레이션 실행 ─────────────────────────────────────────────────────
  const runSimulateV2 = useCallback(async () => {
    setSimV2Loading(true);
    try {
      const res = await axios.post(
        `/api/v1/proposal-risk/${projectId}/simulate-v2`,
        { person_replacements: personReplacements, phase_shifts: phaseShifts },
        { headers: getAuthHeaders() }
      );
      setSimV2Result(res.data);
    } catch (e) { console.error(e); }
    finally { setSimV2Loading(false); }
  }, [projectId, personReplacements, phaseShifts]);

  // ── 최적 조합 즉시 적용 ──────────────────────────────────────────────────────
  const applyBestCombo = useCallback(() => {
    if (!optimizeResult?.best_combo) return;
    const combo = optimizeResult.best_combo;
    const newReplacements: Record<string, number | null> = {};
    const newShifts: Record<string, { start_date: string; end_date: string }> = {};

    if (combo.replace) {
      // 대체 후보 중 첫 번째 가용 인력으로 교체
      const firstAvail = combo.replace.alternates.find(a => a.is_available);
      newReplacements[combo.replace.person_key] = firstAvail?.person_id ?? null;
    }
    if (combo.shift) {
      combo.shift.phases.forEach(ph => {
        newShifts[String(ph.phase_id)] = { start_date: ph.new_start, end_date: ph.new_end };
      });
    }
    setPersonReplacements(newReplacements);
    setPhaseShifts(newShifts);
    setActiveTab('custom');
  }, [optimizeResult]);

  const resetCustom = () => {
    setPersonReplacements({});
    setPhaseShifts({});
    setSimV2Result(null);
  };

  const conflictPeople = scheduleData?.people.filter(p => p.has_conflict) ?? [];
  const phases = optimizeResult?.phases ?? [];

  // ── 탭 헤더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 안내 배너 */}
      <div className="rounded-xl bg-violet-50 border border-violet-200 px-4 py-3 flex items-start gap-3">
        <Zap className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-violet-700 space-y-0.5">
          <p className="font-semibold">인력·일정 최적화 시뮬레이션</p>
          <p>AI가 추천하는 최적 인력 교체 및 일정 이동 조합으로 리스크를 최소화할 수 있습니다.</p>
          <p className="text-violet-500">※ DB에 저장되지 않으며 시뮬레이션 결과만 표시됩니다.</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-0 border-b border-gray-200">
        {([
          { key: 'optimize', icon: Sparkles,       label: '최적화 추천' },
          { key: 'custom',   icon: ArrowRightLeft,  label: '직접 시뮬레이션' },
          { key: 'text',     icon: FileText,         label: '텍스트 출력' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.key
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 최적화 추천 탭 ─────────────────────────────────────────────────── */}
      {activeTab === 'optimize' && (
        <div className="space-y-4">
          {optimizeLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">최적 조합 분석 중...</p>
            </div>
          ) : !optimizeResult ? (
            <div className="text-center py-12 text-gray-400 text-sm">분석 결과가 없습니다.</div>
          ) : (
            <>
              {/* 현재 리스크 요약 */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: '위험', val: optimizeResult.current.danger, cls: 'text-red-600' },
                  { label: '주의', val: optimizeResult.current.warning, cls: 'text-amber-500' },
                  { label: '중복 인력', val: `${optimizeResult.current.conflict_people}명`, cls: 'text-orange-500' },
                  { label: '중복 일수', val: `${optimizeResult.current.overlap_days}일`, cls: 'text-slate-600' },
                  { label: '중복 MD', val: `${optimizeResult.current.overlap_md}MD`, cls: 'text-slate-600' },
                ].map(item => (
                  <div key={item.label} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-center">
                    <p className="text-[10px] text-gray-400">{item.label}</p>
                    <p className={`text-sm font-bold mt-0.5 ${item.cls}`}>{item.val}</p>
                  </div>
                ))}
              </div>

              {/* 최적 조합 추천 카드 */}
              {optimizeResult.best_combo?.label && (
                <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-bold text-violet-700">{optimizeResult.best_combo.label}</p>
                  </div>
                  <p className="text-xs text-violet-600">{optimizeResult.best_combo.description}</p>

                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-500">적용 후 예상:</span>
                    {optimizeResult.best_combo.expected_danger < optimizeResult.current.danger && (
                      <span className="text-emerald-600 font-semibold">
                        위험 {optimizeResult.current.danger} → {optimizeResult.best_combo.expected_danger}
                      </span>
                    )}
                    {optimizeResult.best_combo.expected_warning < optimizeResult.current.warning && (
                      <span className="text-emerald-600 font-semibold">
                        주의 {optimizeResult.current.warning} → {optimizeResult.best_combo.expected_warning}
                      </span>
                    )}
                    {optimizeResult.best_combo.expected_danger === 0 && optimizeResult.best_combo.expected_warning === 0 && (
                      <span className="text-emerald-600 font-bold">✅ 모든 리스크 해소 예상</span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    onClick={applyBestCombo}
                    className="bg-violet-600 hover:bg-violet-700 text-white w-full"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                    이 조합으로 직접 시뮬레이션 해보기
                  </Button>
                </div>
              )}

              {/* 인력 교체 추천 목록 */}
              {optimizeResult.person_replace_options.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500" />
                    <p className="text-xs font-semibold text-gray-700">인력 교체 추천</p>
                    <span className="text-[10px] text-gray-400">효과 큰 순</span>
                  </div>
                  {optimizeResult.person_replace_options.map((opt, idx) => (
                    <div key={opt.person_key}
                      className={`rounded-xl border p-3 space-y-2 ${idx === 0 ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {idx === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white font-bold">1순위</span>}
                        {opt.is_chief && <Crown className="h-3.5 w-3.5 text-purple-500" />}
                        <span className="text-xs font-semibold text-slate-700">{opt.person_name}</span>
                        {opt.grade && <span className="text-[10px] text-gray-400">{opt.grade}</span>}
                        {opt.my_field && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{opt.my_field}</span>
                        )}
                        <span className="ml-auto text-xs text-red-600 font-bold">{opt.conflict_days}일 중복</span>
                      </div>

                      {/* 교체 시 기대 효과 */}
                      <div className="flex gap-3 flex-wrap">
                        {opt.expected_danger_delta > 0 && (
                          <span className="text-[10px] text-emerald-600 font-semibold">
                            <TrendingDown className="h-3 w-3 inline mr-0.5" />위험 -{opt.expected_danger_delta}
                          </span>
                        )}
                        {opt.expected_warning_delta > 0 && (
                          <span className="text-[10px] text-emerald-600 font-semibold">
                            주의 -{opt.expected_warning_delta}
                          </span>
                        )}
                        {opt.expected_overlap_delta > 0 && (
                          <span className="text-[10px] text-blue-600">
                            중복 {opt.expected_overlap_delta}일 감소
                          </span>
                        )}
                        {opt.expected_danger_delta === 0 && opt.expected_warning_delta === 0 && (
                          <span className="text-[10px] text-gray-400">리스크 레벨 변화 없음 (중복일 감소)</span>
                        )}
                      </div>

                      {/* 대체 후보 */}
                      {opt.alternates.length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-gray-100">
                          <p className="text-[10px] text-gray-500 font-semibold">대체 후보</p>
                          {opt.alternates.map(alt => (
                            <div key={alt.person_id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border ${
                              alt.is_available ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
                            }`}>
                              {alt.is_chief && <Crown className="h-3 w-3 text-purple-500" />}
                              <span className={`text-[10px] font-semibold ${alt.is_available ? 'text-emerald-700' : 'text-gray-500'}`}>
                                {alt.person_name}
                              </span>
                              {alt.grade && <span className="text-[10px] text-gray-400">{alt.grade}</span>}
                              {alt.company && <span className="text-[10px] text-gray-300 truncate">· {alt.company}</span>}
                              <span className={`ml-auto text-[10px] font-bold flex-shrink-0 ${alt.is_available ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {alt.is_available ? '✓ 즉시 투입 가능' : `${alt.conflict_days}일 중복`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {opt.alternates.length === 0 && (
                        <p className="text-[10px] text-gray-400 italic">동일 분야 대체 인력 없음</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {optimizeResult.person_replace_options.length === 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1" />
                  <p className="text-xs text-emerald-700 font-semibold">인력 중복 없음</p>
                </div>
              )}

              {/* 일정 이동 추천 */}
              {optimizeResult.phase_shift_options.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="h-3.5 w-3.5 text-orange-500" />
                    <p className="text-xs font-semibold text-gray-700">일정 이동 추천</p>
                  </div>
                  {optimizeResult.phase_shift_options.map((opt, idx) => (
                    <div key={opt.option_id}
                      className={`rounded-xl border p-3 space-y-2 ${idx === 0 ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200 bg-white'}`}>
                      <div className="flex items-center gap-2">
                        {idx === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500 text-white font-bold">1순위</span>}
                        <p className="text-xs font-semibold text-slate-700">{opt.label}</p>
                        <span className="ml-auto text-[10px] text-emerald-600">약 {opt.estimated_conflict_reduction}명 중복 해소</span>
                      </div>
                      <p className="text-[10px] text-gray-500">{opt.description}</p>

                      {/* 단계별 변경 내용 */}
                      <div className="space-y-1 pt-1 border-t border-gray-100">
                        {opt.phases.slice(0, 3).map(ph => (
                          <div key={ph.phase_id} className="flex items-center gap-2 text-[10px] text-gray-600">
                            <span className="font-medium truncate max-w-[80px]">{ph.phase_name}</span>
                            <span className="text-gray-400">{ph.orig_start}</span>
                            <span className="text-gray-300">→</span>
                            <span className="text-orange-600 font-semibold">{ph.new_start}</span>
                            <span className="ml-auto text-orange-500">+{ph.shift_days}일</span>
                          </div>
                        ))}
                        {opt.phases.length > 3 && (
                          <p className="text-[10px] text-gray-400">외 {opt.phases.length - 3}개 단계 동일 이동</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={loadOptimize}
                disabled={optimizeLoading}
                className="w-full"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                추천 새로고침
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── 직접 시뮬레이션 탭 ────────────────────────────────────────────── */}
      {activeTab === 'custom' && (
        <div className="space-y-4">
          {scheduleLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />데이터 로드 중...
            </div>
          ) : (
            <>
              {/* 설정 영역 */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

                {/* 좌측: 인력 교체 설정 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500" />
                    <p className="text-xs font-semibold text-gray-700">인력 교체 설정</p>
                    <span className="text-[10px] text-gray-400">중복 인력 기준</span>
                  </div>

                  {conflictPeople.length === 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
                      <p className="text-xs text-emerald-700">중복 인력 없음</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {conflictPeople.map(person => {
                        const currentReplace = personReplacements[person.person_key];
                        const optInfo = optimizeResult?.person_replace_options.find(o => o.person_key === person.person_key);
                        return (
                          <div key={person.person_key}
                            className={`rounded-xl border p-3 space-y-2 ${
                              currentReplace !== undefined ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {person.is_chief && <Crown className="h-3.5 w-3.5 text-purple-500" />}
                              <span className="text-xs font-semibold text-slate-700">{person.person_name}</span>
                              {person.grade && <span className="text-[10px] text-gray-400">{person.grade}</span>}
                              <span className="ml-auto text-[10px] text-red-600 font-bold">{person.total_overlap_days}일 중복</span>
                            </div>

                            <div className="flex gap-1 flex-wrap">
                              {/* 제외(교체 없음) */}
                              <button
                                onClick={() => {
                                  if (personReplacements[person.person_key] === null) {
                                    const r = { ...personReplacements };
                                    delete r[person.person_key];
                                    setPersonReplacements(r);
                                  } else {
                                    setPersonReplacements(prev => ({ ...prev, [person.person_key]: null }));
                                  }
                                }}
                                className={`text-[10px] px-2 py-1 rounded border transition-all ${
                                  personReplacements[person.person_key] === null
                                    ? 'bg-red-100 border-red-300 text-red-700 font-bold'
                                    : 'bg-white border-gray-200 text-gray-500 hover:border-red-300'
                                }`}
                              >
                                {personReplacements[person.person_key] === null ? '✓ ' : ''}제외(대체 없음)
                              </button>

                              {/* 대체 후보 버튼 */}
                              {(optInfo?.alternates ?? []).map(alt => (
                                <button
                                  key={alt.person_id}
                                  onClick={() => {
                                    if (personReplacements[person.person_key] === alt.person_id) {
                                      const r = { ...personReplacements };
                                      delete r[person.person_key];
                                      setPersonReplacements(r);
                                    } else {
                                      setPersonReplacements(prev => ({ ...prev, [person.person_key]: alt.person_id }));
                                    }
                                  }}
                                  className={`text-[10px] px-2 py-1 rounded border transition-all ${
                                    personReplacements[person.person_key] === alt.person_id
                                      ? 'bg-emerald-100 border-emerald-400 text-emerald-700 font-bold'
                                      : alt.is_available
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:border-emerald-400'
                                      : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'
                                  }`}
                                >
                                  {personReplacements[person.person_key] === alt.person_id ? '✓ ' : ''}
                                  {alt.person_name}
                                  {alt.is_available ? '' : ` (${alt.conflict_days}일↑)`}
                                </button>
                              ))}
                            </div>

                            {currentReplace !== undefined && (
                              <p className="text-[10px] text-blue-600 font-medium">
                                {currentReplace === null
                                  ? `→ ${person.person_name} 제외 (대체 없음)`
                                  : `→ ${person.person_name}을 ID:${currentReplace}로 교체`
                                }
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 우측: 일정 이동 설정 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="h-3.5 w-3.5 text-orange-500" />
                    <p className="text-xs font-semibold text-gray-700">일정 이동 설정</p>
                    <span className="text-[10px] text-gray-400">단계별 날짜 조정</span>
                  </div>

                  {/* 추천 일정 이동 빠른 적용 */}
                  {optimizeResult?.phase_shift_options && optimizeResult.phase_shift_options.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-gray-500 font-medium">추천 일정 이동 빠른 적용</p>
                      {optimizeResult.phase_shift_options.map(opt => (
                        <button
                          key={opt.option_id}
                          onClick={() => {
                            const newShifts: Record<string, { start_date: string; end_date: string }> = {};
                            opt.phases.forEach(ph => {
                              newShifts[String(ph.phase_id)] = { start_date: ph.new_start, end_date: ph.new_end };
                            });
                            setPhaseShifts(newShifts);
                          }}
                          className="w-full text-left text-[10px] px-2.5 py-1.5 rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-400 transition-all"
                        >
                          📅 {opt.label} 적용
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 단계별 날짜 직접 수정 */}
                  <div className="space-y-2">
                    {phases.length === 0 && (
                      <p className="text-[10px] text-gray-400 text-center py-4">단계 정보 없음</p>
                    )}
                    {phases.map(ph => {
                      const shifted = phaseShifts[String(ph.phase_id)];
                      const curStart = shifted?.start_date ?? ph.start_date;
                      const curEnd = shifted?.end_date ?? ph.end_date;
                      const isChanged = !!shifted;
                      return (
                        <div key={ph.phase_id}
                          className={`rounded-xl border p-2.5 space-y-1.5 ${isChanged ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-semibold text-gray-700 flex-1">{ph.phase_name}</p>
                            {isChanged && (
                              <button
                                onClick={() => {
                                  const s = { ...phaseShifts };
                                  delete s[String(ph.phase_id)];
                                  setPhaseShifts(s);
                                }}
                                className="text-[10px] text-gray-400 hover:text-red-500"
                                title="원복"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 mb-0.5">시작일</p>
                              <input
                                type="date"
                                value={curStart}
                                onChange={e => setPhaseShifts(prev => ({
                                  ...prev,
                                  [String(ph.phase_id)]: { start_date: e.target.value, end_date: curEnd }
                                }))}
                                className={`w-full text-[10px] border rounded px-1.5 py-1 ${isChanged ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}
                              />
                            </div>
                            <div className="flex-1">
                              <p className="text-[9px] text-gray-400 mb-0.5">종료일</p>
                              <input
                                type="date"
                                value={curEnd}
                                onChange={e => setPhaseShifts(prev => ({
                                  ...prev,
                                  [String(ph.phase_id)]: { start_date: curStart, end_date: e.target.value }
                                }))}
                                className={`w-full text-[10px] border rounded px-1.5 py-1 ${isChanged ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}
                              />
                            </div>
                          </div>
                          {isChanged && (
                            <p className="text-[9px] text-orange-600">
                              원래: {ph.start_date} ~ {ph.end_date}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 시뮬레이션 실행 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <Button
                  onClick={runSimulateV2}
                  disabled={simV2Loading || (Object.keys(personReplacements).length === 0 && Object.keys(phaseShifts).length === 0)}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {simV2Loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                  시뮬레이션 실행
                  {Object.keys(personReplacements).length + Object.keys(phaseShifts).length > 0 && (
                    <span className="ml-1.5 text-[10px] bg-white/30 rounded-full px-1.5">
                      {Object.keys(personReplacements).length > 0 && `인력 ${Object.keys(personReplacements).length}명`}
                      {Object.keys(personReplacements).length > 0 && Object.keys(phaseShifts).length > 0 && ' · '}
                      {Object.keys(phaseShifts).length > 0 && `일정 ${Object.keys(phaseShifts).length}건`}
                    </span>
                  )}
                </Button>
                {(Object.keys(personReplacements).length > 0 || Object.keys(phaseShifts).length > 0) && (
                  <Button variant="outline" size="sm" onClick={resetCustom}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />초기화
                  </Button>
                )}
              </div>

              {/* 시뮬레이션 결과 */}
              {simV2Result && (
                <div className="space-y-4 pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                    <TrendingDown className="h-3.5 w-3.5 text-violet-500" />
                    시뮬레이션 결과
                  </p>

                  <RiskCompareTable
                    original={simV2Result.original}
                    simulated={simV2Result.simulated}
                    delta={simV2Result.delta}
                    loading={simV2Loading}
                  />

                  {/* 교체/이동 요약 */}
                  {simV2Result.replacement_summary.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-gray-500">인력 교체 내역</p>
                      {simV2Result.replacement_summary.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] text-gray-600 bg-blue-50 rounded-lg px-3 py-1.5">
                          <UserMinus className="h-3 w-3 text-red-400" />
                          <span className="font-semibold text-red-600">{r.old_name}</span>
                          <span className="text-gray-400">({r.old_conflict_days}일↓)</span>
                          <ArrowRightLeft className="h-3 w-3 text-gray-400" />
                          <span className={`font-semibold ${r.new_name !== '(제외만)' ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {r.new_name}
                          </span>
                          {r.new_grade && <span className="text-gray-400">{r.new_grade}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {simV2Result.shift_summary.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-gray-500">일정 이동 내역</p>
                      {simV2Result.shift_summary.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] text-gray-600 bg-orange-50 rounded-lg px-3 py-1.5">
                          <CalendarRange className="h-3 w-3 text-orange-400" />
                          <span className="font-semibold">{s.phase_name}</span>
                          <span className="text-gray-400">{s.orig_start}</span>
                          <span>→</span>
                          <span className="text-orange-600 font-semibold">{s.new_start}</span>
                          <span className="ml-auto text-orange-500">+{s.shift_days}일</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 제안 메시지 */}
                  {simV2Result.suggestions.length > 0 && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-emerald-700">💡 시뮬레이션 기반 제안</p>
                      {simV2Result.suggestions.map((s, i) => (
                        <p key={i} className="text-xs text-emerald-700 flex gap-1.5">
                          <span className="text-emerald-400 flex-shrink-0">→</span>{s}
                        </p>
                      ))}
                    </div>
                  )}

                  <RemainingRisks risks={simV2Result.risks} />

                  {/* 텍스트 출력 바로가기 */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-3">
                    <FileText className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 flex-1">
                      이 시뮬레이션 결과(인력 교체·일정 이동)를 그대로 텍스트로 출력할 수 있습니다
                    </p>
                    <Button
                      size="sm"
                      onClick={() => setActiveTab('text')}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0"
                    >
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      텍스트 출력 →
                    </Button>
                  </div>
                </div>
              )}

              {/* 초기 상태 */}
              {!simV2Result && Object.keys(personReplacements).length === 0 && Object.keys(phaseShifts).length === 0 && (
                <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-4 text-center space-y-2">
                  <Info className="h-6 w-6 text-violet-400 mx-auto" />
                  <p className="text-xs text-gray-500">
                    위에서 인력 교체 또는 일정 이동을 설정하고<br />
                    [시뮬레이션 실행]을 누르세요
                  </p>
                  {optimizeResult?.best_combo?.label && (
                    <button
                      onClick={applyBestCombo}
                      className="text-xs text-violet-600 hover:text-violet-700 underline"
                    >
                      최적화 추천 조합 바로 적용 →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 텍스트 출력 탭 ────────────────────────────────────────────────── */}
      {activeTab === 'text' && (
        <TextOutputPanel
          projectId={projectId}
          excludedPersonKeys={Object.keys(personReplacements).filter(k => personReplacements[k] === null)}
          personReplacements={personReplacements}
          phaseShifts={phaseShifts}
          simApplied={simV2Result !== null}
        />
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

// ── 상세 패널 (일정중복·시뮬레이션 통합) ────────────────────────────────────────
function DetailPanel({ project, onBack }: { project: ProposalItem; onBack: () => void }) {
  // '일정중복+시뮬레이션 통합' 탭과 '리스크 분석' 탭
  const [tab, setTab] = useState<'sim' | 'risk'>('sim');
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
    <div className="space-y-3">
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

      {/* 탭 — 2개로 통합 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('sim')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'sim'
              ? 'border-violet-600 text-violet-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📊 일정중복 · 시뮬레이션
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
      {tab === 'sim' && (
        <IntegratedSimPanel projectId={project.id} />
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
