import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, CalendarDays, X, Loader2, Lock, HardHat, ArrowLeftRight } from 'lucide-react';
import { client, StaffingChangeRecord } from '@/lib/api';
import { toast } from 'sonner';
import { isNonWorkday, getHolidayName, countBusinessDays as calcBizDaysHoliday } from '@/lib/holidays';
import { usePresence } from '@/hooks/usePresence';
import { PresenceBadges, PresenceWarningBanner } from '@/components/PresenceBadges';
import { useUserRole } from '@/hooks/useUserRole';



/* ───────── Types ───────── */
interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  updated_at?: string;
  color_hue?: number | null;
}

interface Phase {
  id: number;
  project_id: number;
  phase_name: string;
  sort_order: number;
  start_date?: string;
  end_date?: string;
}

interface StaffingRow {
  id: number;
  project_id: number;
  phase_id: number;
  category: string;
  field: string;
  sub_field: string;
  person_id?: number;
  person_name_text?: string;
  md?: number | null;
}

interface People {
  id: number;
  person_name: string;
  team?: string;
  grade?: string;
}

interface CalendarEntry {
  id: number | null;
  staffing_id: number;
  entry_date: string;
  status: string | null;
}

interface ScheduleTabProps {
  projects: Project[];
  phases: Phase[];
  staffing: StaffingRow[];
  people: People[];
  onRefresh?: () => void;
}

/* ───────── Color Palette ───────── */
const PROJECT_COLORS = [
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', cell: '#bfdbfe', available: '#eff6ff' },
  { bg: '#d1fae5', border: '#10b981', text: '#065f46', cell: '#a7f3d0', available: '#ecfdf5' },
  { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', cell: '#fde68a', available: '#fffbeb' },
  { bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6', cell: '#c4b5fd', available: '#f5f3ff' },
  { bg: '#ffe4e6', border: '#f43f5e', text: '#9f1239', cell: '#fecdd3', available: '#fff1f2' },
  { bg: '#cffafe', border: '#06b6d4', text: '#155e75', cell: '#a5f3fc', available: '#ecfeff' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412', cell: '#fed7aa', available: '#fff7ed' },
  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', cell: '#c7d2fe', available: '#eef2ff' },
];

/**
 * 셀 구분을 위한 CSS background-image 무늬 패턴 (8종)
 * 색상은 rgba로 반투명하게 처리해 배경색과 자연스럽게 어울림
 */
const PROJECT_PATTERNS: string[] = [
  'none',                                                                                          // 0: 패턴 없음 (단색)
  'repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 4px)',   // 1: 대각선 (/)
  'repeating-linear-gradient(-45deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 4px)',  // 2: 대각선 (\)
  'repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 5px)',    // 3: 가로줄
  'repeating-linear-gradient(90deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 5px)',   // 4: 세로줄
  // 5: 격자 (가로+세로)
  'repeating-linear-gradient(0deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 5px), repeating-linear-gradient(90deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 5px)',
  // 6: 크로스해치 (대각선 양방향)
  'repeating-linear-gradient(45deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 5px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 5px)',
  // 7: 점선 (도트)
  'radial-gradient(circle, rgba(0,0,0,0.15) 1px, transparent 1px)',
];

/** 점선(도트) 패턴의 경우 background-size도 필요 */
const PATTERN_SIZES: string[] = [
  'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '5px 5px',
];

/** HSL hue값으로 PROJECT_COLORS 형태의 색상 객체 생성 */
function hueToProjectColor(hue: number): typeof PROJECT_COLORS[0] {
  const h = hue;
  const hsl = (s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;
  return {
    bg:        hsl(70, 90),
    border:    hsl(70, 48),
    text:      hsl(70, 25),
    cell:      hsl(70, 80),
    available: hsl(70, 96),
  };
}

const MIN_SUB_COLS = 3;
const DEFAULT_COL_WIDTH = 23;
const DEFAULT_ROW_HEIGHT = 23;
const SCHEDULE_COL_WIDTH_KEY = 'schedule_col_width';
const SCHEDULE_ROW_HEIGHT_KEY = 'schedule_row_height';

function getSavedColWidth(): number {
  try {
    const v = sessionStorage.getItem(SCHEDULE_COL_WIDTH_KEY);
    if (v) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 16 && n <= 200) return n; }
  } catch { /* ignore */ }
  return DEFAULT_COL_WIDTH;
}

function getSavedRowHeight(): number {
  try {
    const v = sessionStorage.getItem(SCHEDULE_ROW_HEIGHT_KEY);
    if (v) { const n = parseInt(v, 10); if (!isNaN(n) && n >= 16 && n <= 100) return n; }
  } catch { /* ignore */ }
  return DEFAULT_ROW_HEIGHT;
}

/* ───────── Team classification ───────── */
const TEAM_FIELD_ORDER: { pattern: RegExp; order: number }[] = [
  { pattern: /사업관리/, order: 0 },
  { pattern: /응용시스템/, order: 1 },
  { pattern: /데이터베이스/, order: 2 },
  { pattern: /시스템\s*구조.*보안|시스템구조/, order: 3 },
];

function getTeamInfo(field: string): { group: string; sortGroup: number; sortOrder: number } {
  for (const item of TEAM_FIELD_ORDER) {
    if (item.pattern.test(field)) {
      return { group: '단계감리팀', sortGroup: 0, sortOrder: item.order };
    }
  }
  return { group: '전문가팀', sortGroup: 1, sortOrder: 999 };
}

/* ───────── Helpers ───────── */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDayOfWeek(year: number, month: number, day: number): string {
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  return names[new Date(year, month - 1, day).getDay()];
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 || dow === 6;
}

// 주말 + 공휴일 통합 비영업일 판단
function isNonWork(year: number, month: number, day: number): boolean {
  return isNonWorkday(year, month, day);
}

function phaseOverlapsMonth(ph: Phase, year: number, month: number): boolean {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const start = ph.start_date ? new Date(ph.start_date) : new Date(2000, 0, 1);
  const end = ph.end_date ? new Date(ph.end_date) : new Date(2099, 11, 31);
  return start <= monthEnd && end >= monthStart;
}

function dayInRange(dateStr: string, startDate?: string, endDate?: string): boolean {
  const s = startDate || '2000-01-01';
  const e = endDate || '2099-12-31';
  return dateStr >= s && dateStr <= e;
}

function phaseOverlapsWeek(ph: Phase, weekStart: string, weekEnd: string): boolean {
  const start = ph.start_date || '2000-01-01';
  const end = ph.end_date || '2099-12-31';
  return start <= weekEnd && end >= weekStart;
}

function getWeekNumber(year: number, month: number, day: number): number {
  const d = new Date(year, month - 1, day);
  const dayNum = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/* ───────── Phase badge info ───────── */
interface PhaseBadgeInfo {
  phaseId: number;
  projectId: number;
  projectName: string;
  phaseName: string;
  label: string;
  color: typeof PROJECT_COLORS[0];
  pattern: string;        // CSS background-image 무늬
  patternSize: string;    // CSS background-size
  status: string;
  is_won?: boolean;
  startDate?: string;
  endDate?: string;
}

interface StaffingWithBadge {
  staffing: StaffingRow;
  badge: PhaseBadgeInfo;
}

interface WeekInfo {
  weekNum: number;
  weekLabel: string;
  startDay: number;
  endDay: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  badges: PhaseBadgeInfo[];
}

/* ───────── Unified person (DB + external) ───────── */
interface UnifiedPerson {
  id: number | string;
  name: string;
  grade?: string;
  isExternal: boolean;
}

/* ───────── MD Expand Dialog ───────── */
interface MdExpandDialogProps {
  open: boolean;
  oldBizDays: number;
  newBizDays: number;
  staffingList: Array<{ person_name: string; current_md: number }>;
  onExpandAll: () => void;   // MD를 새 영업일수로 자동 확장
  onKeep: () => void;        // 기존 MD 유지
  onCancel: () => void;      // 취소
}

function MdExpandDialog({ open, oldBizDays, newBizDays, staffingList, onExpandAll, onKeep, onCancel }: MdExpandDialogProps) {
  const addedDays = newBizDays - oldBizDays;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📅 기간 확장 - MD 처리 선택
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
            <div className="flex justify-between text-blue-700 font-medium mb-1">
              <span>기존 영업일</span><span>{oldBizDays}일</span>
            </div>
            <div className="flex justify-between text-blue-800 font-bold">
              <span>변경 영업일</span><span>{newBizDays}일 <span className="text-green-600">(+{addedDays}일 증가)</span></span>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            단계에 배정된 <strong>{staffingList.length}명</strong>의 MD를 어떻게 처리할까요?
          </p>
          <div className="rounded border border-gray-100 bg-gray-50 max-h-36 overflow-y-auto divide-y divide-gray-100">
            {staffingList.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="font-medium text-gray-700">{s.person_name}</span>
                <span className="text-gray-500">
                  현재 <span className="font-semibold text-blue-600">{s.current_md}MD</span>
                  {' → '}
                  <span className="font-semibold text-green-600">{newBizDays}MD</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" onClick={onCancel} className="w-full sm:w-auto">
            취소
          </Button>
          <Button variant="outline" size="sm" onClick={onKeep} className="w-full sm:w-auto border-amber-300 text-amber-700 hover:bg-amber-50">
            기존 MD 유지
          </Button>
          <Button size="sm" onClick={onExpandAll} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white">
            MD 자동 확장 (+{addedDays}일)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── Edit Modal ───────── */
interface StaffingPersonChange {
  staffingId: number;
  newPersonId: number | null;
  newPersonNameText: string;
  newMd?: number | null;
  deleteStaffing?: boolean;
}

/* ── helper: 두 날짜 범위 겹침 여부 ── */
function datesOverlap(s1?: string, e1?: string, s2?: string, e2?: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return false;
  return s1 <= e2 && s2 <= e1;
}
/* ── helper: 영업일 수 계산 (주말+공휴일 제외) ── */
function calcBizDays(startStr: string, endStr: string): number {
  return calcBizDaysHoliday(startStr, endStr);
}

interface HatRecord { id: number; staffing_id: number; actual_person_id: number | null; actual_person_name: string; }

/* ── HatPersonCombobox: 대체인력 선택 드롭다운 ── */
function HatPersonCombobox({
  currentName,
  allPeople,
  onChange,
  onClear,
  onCancel,
}: {
  currentName: string;
  allPeople: People[];
  onChange: (personId: number | null, personName: string) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = allPeople.filter((p) =>
    p.person_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.team || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.grade || '').toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => a.person_name.localeCompare(b.person_name, 'ko'));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  const handleSelect = (personId: number | null, personName: string) => {
    onChange(personId, personName);
  };

  return (
    <div className="relative flex-1 min-w-[160px]" ref={dropdownRef}>
      <div className="w-full bg-white border border-orange-300 rounded-lg shadow-lg z-[100] max-h-[280px] flex flex-col">
        <div className="p-1.5 border-b">
          <input
            type="text"
            placeholder="이름/팀/등급 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            className="w-full h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-orange-400"
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {currentName && (
            <div className="px-2 py-0.5 text-[10px] font-semibold text-orange-700 bg-orange-50 border-b">
              🎩 현재: {currentName}
            </div>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${currentName === p.person_name ? 'bg-orange-50 font-semibold' : ''}`}
              onClick={() => handleSelect(p.id, p.person_name)}
            >
              {p.person_name}
              {p.grade && <span className="text-muted-foreground text-[9px]">({p.grade})</span>}
              {p.team && <span className="text-muted-foreground text-[9px]">· {p.team}</span>}
              {currentName === p.person_name && <span className="ml-auto text-orange-500">✓</span>}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">검색 결과 없음</div>
          )}
          <div className="border-t">
            {!showCustomInput ? (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-50"
                onClick={() => { setShowCustomInput(true); setCustomName(search); }}
              >
                + 직접 입력 (외부 인력){search ? ` "${search}"` : ''}
              </button>
            ) : (
              <div className="p-1.5 flex gap-1">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customName.trim()) handleSelect(null, customName.trim());
                    if (e.key === 'Escape') setShowCustomInput(false);
                  }}
                  placeholder="이름 직접 입력"
                  className="flex-1 h-7 px-2 text-xs border border-amber-300 rounded focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  className="px-2 h-7 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                  disabled={!customName.trim()}
                  onClick={() => { if (customName.trim()) handleSelect(null, customName.trim()); }}
                >확인</button>
              </div>
            )}
          </div>
          {currentName && (
            <div className="border-t">
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                onClick={onClear}
              >
                ✕ 모자 해제
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface EditModalProps {
  project: Project;
  phase: Phase;
  phaseStaffing: StaffingRow[];
  allPeople: People[];
  allStaffing: StaffingRow[];
  allPhases: Phase[];
  // person_id별 날짜 Set (프로젝트별): 실제 엔트리 기반 중복 체크용
  personDatesByProject: Map<number, Map<number, Set<string>>>;
  hatMap: Map<number, HatRecord>; // key: staffing_id
  onHatSave: (staffingId: number, actualName: string, actualPersonId: number | null) => Promise<void>;
  onHatDelete: (staffingId: number) => Promise<void>;
  onClose: () => void;
  onSave: (projectUpdates: Partial<Project>, phaseUpdates: Partial<Phase>, staffingChanges?: StaffingPersonChange[]) => void;
  readOnly?: boolean; // 뷰어 계정: 조회 전용
  phaseId?: number;   // 공식변경 이력 로드용
  projectId?: number;
}

/* ── Searchable Person Combobox ── */
function PersonCombobox({
  value,
  displayText,
  isExternal,
  externalName,
  allPeople,
  partialAvailMap,
  onChange,
}: {
  value: string;
  displayText: string;
  isExternal: boolean;
  externalName?: string;
  allPeople: People[];
  partialAvailMap?: Map<number, number>; // personId → 투입가능일수 (map에 없으면 전체 가능)
  onChange: (personId: number | null, personNameText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const baseFiltered = allPeople.filter((p) =>
    p.person_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.team || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.grade || '').toLowerCase().includes(search.toLowerCase())
  );
  // 완전가능 상단, 일부가능 중간, 불가 하단 정렬
  const filtered = [...baseFiltered].sort((a, b) => {
    const aAvail = partialAvailMap?.get(a.id);  // undefined=전체가능, N=N일가능, 0=불가
    const bAvail = partialAvailMap?.get(b.id);
    const aRank = aAvail === undefined ? 0 : aAvail > 0 ? 1 : 2;
    const bRank = bAvail === undefined ? 0 : bAvail > 0 ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return a.person_name.localeCompare(b.person_name, 'ko');
  });
  const fullAvailList = filtered.filter(p => partialAvailMap === undefined || !partialAvailMap.has(p.id));
  const partialList   = filtered.filter(p => partialAvailMap?.has(p.id) && (partialAvailMap.get(p.id) ?? 0) > 0);
  const unavailList   = filtered.filter(p => partialAvailMap?.has(p.id) && partialAvailMap.get(p.id) === 0);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
        setShowCustomInput(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative flex-1 min-w-[140px]" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); setShowCustomInput(false); }}
        className="flex items-center justify-between w-full h-7 px-2 text-xs border rounded bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="truncate">
          {displayText}
          {isExternal && <span className="text-amber-500 ml-1 text-[9px]">(외부)</span>}
        </span>
        <ChevronLeft className="h-3 w-3 rotate-[-90deg] text-muted-foreground flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-[240px] bg-white border rounded-lg shadow-lg z-[60] max-h-[300px] flex flex-col">
          <div className="p-1.5 border-b">
            <input
              type="text"
              placeholder="이름/팀/등급 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {externalName && (
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${value === '__external__' ? 'bg-blue-50 font-semibold' : ''}`}
                onClick={() => { onChange(null, externalName); setOpen(false); }}
              >
                {externalName} <span className="text-amber-500 text-[9px]">(외부)</span>
              </button>
            )}
            {/* ✅ 전체 투입 가능 섹션 */}
            {partialAvailMap && fullAvailList.length > 0 && (
              <div className="px-2 py-0.5 text-[10px] font-semibold text-green-700 bg-green-50 border-b">✅ 투입 가능 ({fullAvailList.length}명)</div>
            )}
            {fullAvailList.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${value === String(p.id) ? 'bg-blue-50 font-semibold' : ''}`}
                onClick={() => { onChange(p.id, p.person_name); setOpen(false); }}
              >
                {p.person_name}
                {p.grade && <span className="text-muted-foreground text-[9px]">({p.grade})</span>}
                {p.team && <span className="text-muted-foreground text-[9px]">· {p.team}</span>}
                {value === String(p.id) && <span className="ml-auto text-blue-500">✓</span>}
              </button>
            ))}
            {/* ⚠️ 일부 투입 가능 섹션 */}
            {partialAvailMap && partialList.length > 0 && (
              <div className="px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border-t border-b">⚠️ 일정 겹침 ({partialList.length}명)</div>
            )}
            {partialList.map((p) => {
              const avail = partialAvailMap?.get(p.id) ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 flex items-center gap-1 ${value === String(p.id) ? 'bg-amber-50 font-semibold' : ''}`}
                  onClick={() => { onChange(p.id, p.person_name); setOpen(false); }}
                >
                  <span className="text-amber-700 font-medium">{p.person_name}</span>
                  {p.grade && <span className="text-amber-500 text-[9px]">({p.grade})</span>}
                  <span className="text-amber-600 text-[9px] ml-auto">({avail}일 가능)</span>
                  {value === String(p.id) && <span className="text-amber-600 text-[9px]">✓</span>}
                </button>
              );
            })}
            {/* 🚫 투입 불가 섹션 */}
            {partialAvailMap && unavailList.length > 0 && (
              <div className="px-2 py-0.5 text-[10px] font-semibold text-red-600 bg-red-50 border-t border-b">🚫 투입 불가 ({unavailList.length}명)</div>
            )}
            {unavailList.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 flex items-center gap-1 ${value === String(p.id) ? 'bg-red-50 font-semibold' : ''}`}
                onClick={() => { onChange(p.id, p.person_name); setOpen(false); }}
              >
                <span className="text-red-500 font-medium">{p.person_name}</span>
                {p.grade && <span className="text-red-400 text-[9px]">({p.grade})</span>}
                <span className="text-red-400 text-[9px] ml-auto">(투입 불가)</span>
                {value === String(p.id) && <span className="text-red-500 text-[9px]">✓</span>}
              </button>
            ))}
            {/* partialAvailMap 없을 때 기존 방식 */}
            {!partialAvailMap && filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${value === String(p.id) ? 'bg-blue-50 font-semibold' : ''}`}
                onClick={() => { onChange(p.id, p.person_name); setOpen(false); }}
              >
                {p.person_name}
                {p.grade && <span className="text-muted-foreground text-[9px]">({p.grade})</span>}
                {p.team && <span className="text-muted-foreground text-[9px]">· {p.team}</span>}
              </button>
            ))}
            {filtered.length === 0 && !showCustomInput && (
              <div className="px-3 py-2 text-xs text-muted-foreground">검색 결과 없음</div>
            )}
          </div>
          <div className="border-t p-1.5">
            {!showCustomInput ? (
              <button
                type="button"
                className="w-full text-left px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                onClick={() => setShowCustomInput(true)}
              >
                + 직접 입력 (외부 인력)
              </button>
            ) : (
              <div className="flex gap-1">
                <input
                  type="text"
                  placeholder="이름 입력..."
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="flex-1 h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customName.trim()) {
                      onChange(null, customName.trim());
                      setOpen(false);
                      setCustomName('');
                      setShowCustomInput(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="px-2 h-7 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  disabled={!customName.trim()}
                  onClick={() => {
                    if (customName.trim()) {
                      onChange(null, customName.trim());
                      setOpen(false);
                      setCustomName('');
                      setShowCustomInput(false);
                    }
                  }}
                >
                  확인
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({ project, phase, phaseStaffing, allPeople, allStaffing, allPhases, personDatesByProject, hatMap, onHatSave, onHatDelete, onClose, onSave, readOnly = false }: EditModalProps) {
  // 🎩 모자 인라인 편집 state
  const [hatEditId, setHatEditId] = useState<number | null>(null); // staffing_id

  // 🔁 저장 전 인력변경 사유 입력 다이얼로그
  // pendingChanges: 인력이 바뀐 staffing 목록 (originalName → newName)
  const [reasonDialog, setReasonDialog] = useState<{
    open: boolean;
    reason: string;
    pendingPersonChanges: { staffingId: number; originalPersonId: number | null; originalPersonName: string; newPersonId: number | null; newPersonName: string }[];
    pendingStaffingChanges: StaffingPersonChange[];
    pendingProjectUpdates: Partial<Project>;
    pendingPhaseUpdates: Partial<Phase>;
  } | null>(null);

  // 공식 변경 이력 (이 단계)
  const [changeHistory, setChangeHistory] = useState<StaffingChangeRecord[]>([]);
  const [changeHistoryLoaded, setChangeHistoryLoaded] = useState(false);

  // 단계 변경 이력 로드
  useEffect(() => {
    if (!phase.id) return;
    client.staffingChange.getByPhase(phase.id).then((list) => {
      setChangeHistory(list);
      setChangeHistoryLoaded(true);
    }).catch(() => setChangeHistoryLoaded(true));
  }, [phase.id]);

  const openHatInline = (staffingId: number) => {
    setHatEditId(staffingId);
  };

  const saveHatInline = async (staffingId: number, name: string, personId: number | null) => {
    try {
      if (name.trim()) {
        await onHatSave(staffingId, name.trim(), personId);
      } else {
        await onHatDelete(staffingId);
      }
    } finally {
      setHatEditId(null);
    }
  };
  const [projectName, setProjectName] = useState(project.project_name);
  const [organization, setOrganization] = useState(project.organization);
  const [projectStatus, setProjectStatus] = useState(project.status);
  const [phaseName, setPhaseName] = useState(phase.phase_name);
  const [startDate, setStartDate] = useState(phase.start_date || '');
  const [endDate, setEndDate] = useState(phase.end_date || '');

  // Track person changes for each staffing row
  const [personEdits, setPersonEdits] = useState<Map<number, { personId: number | null; personNameText: string }>>(new Map());
  // Track MD edits
  const [mdEdits, setMdEdits] = useState<Map<number, number | null>>(new Map());
  // Track deletions
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  // Compute business days for the phase (주말 + 공휴일 제외)
  const businessDays = useMemo(() => {
    if (!startDate || !endDate) return null;
    return calcBizDays(startDate, endDate);
  }, [startDate, endDate]);

  const getDisplayPerson = (s: StaffingRow) => {
    const edit = personEdits.get(s.id);
    if (edit) {
      if (edit.personId) {
        const p = allPeople.find((pp) => pp.id === edit.personId);
        return p?.person_name || edit.personNameText || '?';
      }
      return edit.personNameText || '미배정';
    }
    if (s.person_id) {
      const p = allPeople.find((pp) => pp.id === s.person_id);
      return p?.person_name || s.person_name_text || '?';
    }
    return s.person_name_text || '미배정';
  };

  const getCurrentPersonId = (s: StaffingRow): string => {
    const edit = personEdits.get(s.id);
    if (edit) return edit.personId ? String(edit.personId) : '__external__';
    return s.person_id ? String(s.person_id) : '__external__';
  };

  const getCurrentMd = (s: StaffingRow): number | null => {
    if (mdEdits.has(s.id)) return mdEdits.get(s.id) ?? null;
    return s.md ?? null;
  };

  const handlePersonComboChange = (staffingId: number, personId: number | null, personNameText: string) => {
    setPersonEdits((prev) => {
      const next = new Map(prev);
      next.set(staffingId, { personId, personNameText });
      return next;
    });
  };

  // ── 인력별 투입가능일수 계산 (phase 영업일 중 타사업 미투입 날짜 수) ──
  // partialAvailMap: Map<personId, 투입가능일수>
  //   - map에 없음 → 전체 투입 가능 (표기 안 함)
  //   - map에 있고 값 > 0 → 일부 가능 → "(N일 가능)" 표기
  //   - map에 있고 값 = 0 → 완전 불가 → "(투입 불가)" 표기
  const partialAvailMap = useMemo(() => {
    const phaseStart = startDate || phase.start_date;
    const phaseEnd = endDate || phase.end_date;
    if (!phaseStart || !phaseEnd) return new Map<number, number>();

    // phase 기간 내 전체 영업일 날짜 Set 생성 (주말+공휴일 제외)
    const phaseBizDates = new Set<string>();
    let cur = new Date(phaseStart + 'T00:00:00');
    const endD = new Date(phaseEnd + 'T00:00:00');
    while (cur <= endD) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      const d = cur.getDate();
      if (!isNonWorkday(y, m, d)) {
        const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        phaseBizDates.add(ds);
      }
      cur.setDate(cur.getDate() + 1);
    }
    const totalBizDays = phaseBizDates.size;
    if (totalBizDays === 0) return new Map<number, number>();

    // 각 person별로 타사업 투입 날짜와 phase 영업일의 교집합(겹치는 날) 계산
    const overlapMap = new Map<number, Set<string>>(); // personId → 겹치는 날짜들
    for (const [projId, personMap] of personDatesByProject.entries()) {
      if (projId === project.id) continue;
      for (const [personId, otherDates] of personMap.entries()) {
        if (otherDates.size === 0) continue;
        for (const d of otherDates) {
          if (phaseBizDates.has(d)) {
            if (!overlapMap.has(personId)) overlapMap.set(personId, new Set());
            overlapMap.get(personId)!.add(d);
          }
        }
      }
    }

    // 겹치는 날이 있는 person만 map에 등록 (값 = 투입 가능 일수 = totalBizDays - 겹치는 날)
    const result = new Map<number, number>();
    for (const [personId, overlapDates] of overlapMap.entries()) {
      const availDays = totalBizDays - overlapDates.size;
      result.set(personId, Math.max(0, availDays));
    }
    return result;
  }, [personDatesByProject, project.id, phase.start_date, phase.end_date, startDate, endDate]);

  const handleMdChange = (staffingId: number, value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setMdEdits((prev) => { const n = new Map(prev); n.set(staffingId, null); return n; });
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 0) {
        // Clamp to business days if available
        const clamped = businessDays !== null ? Math.min(num, businessDays) : num;
        setMdEdits((prev) => { const n = new Map(prev); n.set(staffingId, clamped); return n; });
      }
    }
  };

  const handleDeleteStaffing = (staffingId: number) => {
    setDeletedIds((prev) => { const n = new Set(prev); n.add(staffingId); return n; });
  };

  const handleUndoDelete = (staffingId: number) => {
    setDeletedIds((prev) => { const n = new Set(prev); n.delete(staffingId); return n; });
  };

  const handleSave = () => {
    const staffingChanges: StaffingPersonChange[] = [];

    // Collect deletions
    deletedIds.forEach((sid) => {
      staffingChanges.push({
        staffingId: sid,
        newPersonId: null,
        newPersonNameText: '',
        deleteStaffing: true,
      });
    });

    // Collect person + MD edits (skip deleted)
    const allEditedIds = new Set([...personEdits.keys(), ...mdEdits.keys()]);
    allEditedIds.forEach((sid) => {
      if (deletedIds.has(sid)) return;
      const s = phaseStaffing.find((ss) => ss.id === sid);
      if (!s) return;
      const pEdit = personEdits.get(sid);
      const mEdit = mdEdits.has(sid) ? mdEdits.get(sid) : undefined;
      staffingChanges.push({
        staffingId: sid,
        newPersonId: pEdit ? pEdit.personId : (s.person_id ?? null),
        newPersonNameText: pEdit ? pEdit.personNameText : (s.person_name_text || ''),
        newMd: mEdit !== undefined ? (mEdit ?? null) : undefined,
      });
    });

    const projectUpdates = { project_name: projectName, organization, status: projectStatus };
    const phaseUpdates = { phase_name: phaseName, start_date: startDate || undefined, end_date: endDate || undefined };

    // 인력이 실제로 바뀐 항목 감지
    const personChangedItems = staffingChanges
      .filter((c) => !c.deleteStaffing)
      .map((c) => {
        const s = phaseStaffing.find((ss) => ss.id === c.staffingId);
        if (!s) return null;
        const origName = s.person_id
          ? (allPeople.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || '')
          : (s.person_name_text || '');
        const newName = c.newPersonId
          ? (allPeople.find((p) => p.id === c.newPersonId)?.person_name || c.newPersonNameText || '')
          : c.newPersonNameText;
        // 이름이 실제로 바뀌었을 때만
        if (origName !== newName && newName.trim()) {
          return {
            staffingId: c.staffingId,
            originalPersonId: s.person_id ?? null,
            originalPersonName: origName,
            newPersonId: c.newPersonId,
            newPersonName: newName,
          };
        }
        return null;
      })
      .filter(Boolean) as { staffingId: number; originalPersonId: number | null; originalPersonName: string; newPersonId: number | null; newPersonName: string }[];

    if (personChangedItems.length > 0) {
      // 인력 변경 있음 → 사유 입력 다이얼로그 표시
      setReasonDialog({
        open: true,
        reason: '',
        pendingPersonChanges: personChangedItems,
        pendingStaffingChanges: staffingChanges,
        pendingProjectUpdates: projectUpdates,
        pendingPhaseUpdates: phaseUpdates,
      });
    } else {
      // 인력 변경 없음 → 바로 저장
      onSave(projectUpdates, phaseUpdates, staffingChanges.length > 0 ? staffingChanges : undefined);
    }
  };

  // 사유 입력 후 최종 저장
  const confirmSaveWithReason = async () => {
    if (!reasonDialog) return;
    const { reason, pendingPersonChanges, pendingStaffingChanges, pendingProjectUpdates, pendingPhaseUpdates } = reasonDialog;
    setReasonDialog(null);
    // staffing_change 이력 기록
    try {
      await Promise.all(pendingPersonChanges.map((ch) =>
        client.staffingChange.create({
          staffing_id:          ch.staffingId,
          project_id:           project.id,
          phase_id:             phase.id,
          original_person_id:   ch.originalPersonId,
          original_person_name: ch.originalPersonName,
          new_person_id:        ch.newPersonId,
          new_person_name:      ch.newPersonName,
          reason:               reason.trim() || undefined,
        })
      ));
    } catch {
      toast.error('변경 이력 저장에 실패했습니다.');
    }
    onSave(pendingProjectUpdates, pendingPhaseUpdates, pendingStaffingChanges.length > 0 ? pendingStaffingChanges : undefined);
  };

  // Group staffing by team (excluding deleted)
  const groupedStaffing = useMemo(() => {
    const groups: { label: string; items: StaffingRow[] }[] = [
      { label: '📋 단계감리팀', items: [] },
      { label: '🔧 전문가팀', items: [] },
    ];
    for (const s of phaseStaffing) {
      const info = getTeamInfo(s.field);
      if (info.sortGroup === 0) groups[0].items.push(s);
      else groups[1].items.push(s);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [phaseStaffing]);

  const activeCount = phaseStaffing.filter((s) => !deletedIds.has(s.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative bg-white rounded-lg shadow-xl w-[680px] max-w-[95vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{readOnly ? '프로젝트/단계/투입인력 조회' : '프로젝트/단계/투입인력 수정'}</h3>
            {readOnly && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border">읽기 전용</span>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Project Info */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">프로젝트 정보</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">사업명</Label>
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-8 text-sm" readOnly={readOnly} disabled={readOnly} />
              </div>
              <div>
                <Label className="text-xs">발주기관</Label>
                <Input value={organization} onChange={(e) => setOrganization(e.target.value)} className="h-8 text-sm" readOnly={readOnly} disabled={readOnly} />
              </div>
            </div>
            <div>
              <Label className="text-xs">상태</Label>
              <Select value={projectStatus} onValueChange={setProjectStatus} disabled={readOnly}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="감리">감리 (A)</SelectItem>
                  <SelectItem value="제안">제안 (P)</SelectItem>
                  <SelectItem value="완료">완료</SelectItem>
                  <SelectItem value="대기">대기</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Phase Info */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">단계 정보</h4>
            <div>
              <Label className="text-xs">단계명</Label>
              <Input value={phaseName} onChange={(e) => setPhaseName(e.target.value)} className="h-8 text-sm" readOnly={readOnly} disabled={readOnly} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">시작일</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-sm" readOnly={readOnly} disabled={readOnly} />
              </div>
              <div>
                <Label className="text-xs">종료일</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-sm" readOnly={readOnly} disabled={readOnly} />
              </div>
            </div>
            {businessDays !== null && (
              <p className="text-[10px] text-muted-foreground">영업일: {businessDays}일</p>
            )}
          </div>

          {/* Staffing Info */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">
              투입인력 ({activeCount}명)
              {!readOnly && deletedIds.size > 0 && (
                <span className="text-red-500 text-[10px] ml-2">({deletedIds.size}명 삭제 예정)</span>
              )}
              {!readOnly && <span className="text-[10px] font-normal text-muted-foreground ml-2">검색/직접입력 가능 · MD 편집 가능</span>}
            </h4>
            {phaseStaffing.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">배정된 인력이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {groupedStaffing.map((group) => (
                  <div key={group.label}>
                    <div className="text-[11px] font-semibold text-slate-500 mb-1">{group.label}</div>
                    <div className="space-y-1.5">
                      {group.items.map((s) => {
                        const isDeleted = deletedIds.has(s.id);
                        const isExternal = getCurrentPersonId(s) === '__external__';
                        const currentMd = getCurrentMd(s);
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-2 rounded px-3 py-1.5 border transition-colors ${
                              isDeleted
                                ? 'bg-red-50 border-red-200 opacity-60'
                                : 'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <span className="text-[10px] text-muted-foreground w-[70px] truncate flex-shrink-0" title={s.field}>
                              {s.field}
                            </span>
                            {isDeleted ? (
                              <span className="flex-1 text-xs text-red-500 line-through">{getDisplayPerson(s)}</span>
                            ) : readOnly ? (
                              <span className="flex-1 text-xs text-gray-700 px-1">{getDisplayPerson(s)}</span>
                            ) : (
                              <PersonCombobox
                                value={getCurrentPersonId(s)}
                                displayText={getDisplayPerson(s)}
                                isExternal={isExternal}
                                externalName={s.person_name_text && !s.person_id ? s.person_name_text : undefined}
                                allPeople={allPeople}
                                partialAvailMap={partialAvailMap}
                                onChange={(pid, pname) => handlePersonComboChange(s.id, pid, pname)}
                              />
                            )}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {isDeleted ? (
                                <span className="text-[10px] text-red-400 w-[50px] text-right">{currentMd != null ? `${currentMd}MD` : '-'}</span>
                              ) : readOnly ? (
                                <span className="text-xs text-gray-700 w-[52px] text-right">{currentMd != null ? currentMd : '-'}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={businessDays ?? 999}
                                  value={currentMd ?? ''}
                                  onChange={(e) => handleMdChange(s.id, e.target.value)}
                                  className="w-[52px] h-7 px-1.5 text-xs text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  placeholder="-"
                                  title={businessDays !== null ? `최대 ${businessDays}일` : 'MD 입력'}
                                />
                              )}
                              <span className="text-[9px] text-muted-foreground">MD</span>
                            </div>
                            {readOnly ? (
                              /* 읽기전용: 모자 씌워진 경우만 표시 */
                              hatMap.has(s.id) ? (
                                <span
                                  className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 flex-shrink-0"
                                  title={`🎩 ${hatMap.get(s.id)?.actual_person_name} 대신 투입 중`}
                                >
                                  <HardHat className="h-3 w-3" />
                                  {hatMap.get(s.id)?.actual_person_name}
                                </span>
                              ) : null
                            ) : (isDeleted ? (
                              <button
                                type="button"
                                onClick={() => handleUndoDelete(s.id)}
                                className="p-1 text-blue-500 hover:bg-blue-50 rounded flex-shrink-0"
                                title="삭제 취소"
                              >
                                <span className="text-[10px]">↩</span>
                              </button>
                            ) : (
                              <>
                                {/* 🎩 모자 버튼 */}
                                {hatEditId === s.id ? (
                                  <HatPersonCombobox
                                    currentName={hatMap.get(s.id)?.actual_person_name || ''}
                                    allPeople={allPeople}
                                    onChange={(personId, personName) => saveHatInline(s.id, personName, personId)}
                                    onClear={() => saveHatInline(s.id, '', null)}
                                    onCancel={() => setHatEditId(null)}
                                  />
                                ) : (
                                  hatMap.has(s.id) ? (
                                    /* 모자 씌워진 상태: 이름 + 아이콘 함께 표시, 클릭하면 수정 */
                                    <button
                                      type="button"
                                      onClick={() => openHatInline(s.id)}
                                      title={`🎩 ${hatMap.get(s.id)?.actual_person_name} 대체 중 — 클릭하여 수정`}
                                      className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 flex-shrink-0 hover:bg-orange-100 transition-colors"
                                    >
                                      <HardHat className="h-3 w-3 flex-shrink-0" />
                                      <span className="max-w-[60px] truncate">{hatMap.get(s.id)?.actual_person_name}</span>
                                    </button>
                                  ) : (
                                    /* 모자 없는 상태: 아이콘만 */
                                    <button
                                      type="button"
                                      onClick={() => openHatInline(s.id)}
                                      title="모자(대체인력) 씌우기"
                                      className="p-1 rounded flex-shrink-0 transition-colors text-slate-300 hover:text-slate-500 hover:bg-slate-50"
                                    >
                                      <HardHat className="h-3.5 w-3.5" />
                                    </button>
                                  )
                                )}
                                {/* 🔁 공식 인력 변경 버튼 */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteStaffing(s.id)}
                                  className="p-1 text-red-400 hover:bg-red-50 hover:text-red-600 rounded flex-shrink-0"
                                  title="투입인력 삭제"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 🔁 공식 인력 변경 이력 섹션 (뷰어도 볼 수 있음) */}
        {changeHistoryLoaded && changeHistory.length > 0 && (
          <div className="px-5 pb-3">
            <h4 className="text-[11px] font-semibold text-blue-600 flex items-center gap-1 mb-2">
              <ArrowLeftRight className="h-3 w-3" />
              공식 인력 변경 이력 ({changeHistory.length}건)
              <span className="text-[10px] font-normal text-gray-400 ml-1">· {phase.phase_name}</span>
            </h4>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {changeHistory.map((ch) => (
                <div key={ch.id} className="flex items-center gap-2 text-[10px] bg-blue-50 rounded px-2 py-1 border border-blue-100">
                  <span className="text-blue-700 font-medium truncate max-w-[80px]">{ch.original_person_name}</span>
                  <ArrowLeftRight className="h-2.5 w-2.5 text-blue-400 flex-shrink-0" />
                  <span className="text-blue-800 font-semibold truncate max-w-[80px]">{ch.new_person_name}</span>
                  <span className="text-gray-400 ml-auto flex-shrink-0">{ch.changed_at.slice(0, 10)}</span>
                  {ch.reason && <span className="text-gray-500 truncate max-w-[80px]" title={ch.reason}>({ch.reason})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          {readOnly ? (
            <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
              <Button size="sm" onClick={handleSave}>저장</Button>
            </>
          )}
        </div>

        {/* 🔁 저장 전 인력 변경 사유 입력 다이얼로그 — white box 안에서 렌더링해야 onClose 버블링 차단 */}
        {reasonDialog?.open && (
          <div className="absolute inset-0 z-[10] flex items-center justify-center bg-black/40 rounded-lg" onClick={() => setReasonDialog(null)}>
            <div className="bg-white rounded-lg shadow-2xl w-[440px] max-w-[90%]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold">인력 변경 사유 입력</h3>
                </div>
                <button onClick={() => setReasonDialog(null)} className="p-1 hover:bg-gray-100 rounded">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-gray-500">변경 인력 목록</Label>
                  {reasonDialog.pendingPersonChanges.map((ch) => (
                    <div key={ch.staffingId} className="flex items-center gap-2 text-xs bg-blue-50 rounded px-2 py-1.5 border border-blue-100">
                      <span className="text-gray-600 truncate max-w-[110px]">{ch.originalPersonName}</span>
                      <ArrowLeftRight className="h-3 w-3 text-blue-400 flex-shrink-0" />
                      <span className="text-blue-700 font-semibold truncate max-w-[110px]">{ch.newPersonName}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <Label className="text-xs">변경 사유 <span className="text-gray-400 font-normal">(선택)</span></Label>
                  <Input
                    value={reasonDialog.reason}
                    onChange={(e) => setReasonDialog((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
                    placeholder="예: 퇴사, 담당자 변경, 역할 조정 등"
                    className="h-8 text-sm mt-1"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmSaveWithReason(); }}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
                <Button variant="outline" size="sm" onClick={() => setReasonDialog(null)}>취소</Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={confirmSaveWithReason}>
                  저장
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Persist month in sessionStorage ───────── */
const SCHEDULE_MONTH_KEY = 'schedule_view_month';

function getSavedMonth(): { year: number; month: number } | null {
  try {
    const raw = sessionStorage.getItem(SCHEDULE_MONTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.year && parsed.month) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveMonth(year: number, month: number) {
  try {
    sessionStorage.setItem(SCHEDULE_MONTH_KEY, JSON.stringify({ year, month }));
  } catch { /* ignore */ }
}

/* ───────── DayRow (React.memo로 변경된 행만 재렌더) ───────── */
interface DayRowProps {
  d: number;
  year: number;
  month: number;
  todayStr: string;
  weekInfo: WeekInfo | undefined;
  isFirstDayOfWeek: boolean;
  isWeekStart: boolean;
  allPeople: UnifiedPerson[];
  personSubCols: Map<number | string, number>;
  cellDataCache: Map<string, {
    staffingId: number; badge: PhaseBadgeInfo; isSelected: boolean;
    isAvailable: boolean; isHoliday: boolean; md: number;
    dateStr: string; entryKey: string; isHatItem: boolean; hatForPersonName?: string;
  } | null>;
  togglingCell: string | null;
  focusedPersonId: number | string | null;
  checkedProjectPeople: Set<number | string>;
  hoveredStaffingIds: Set<number>;
  hoveredBadgePhaseId: number | null;
  hatMap: Map<number, HatRecord>;
  changeMap: Map<number, StaffingChangeRecord[]>;
  staffingTooltipInfo: Map<number, { label: string; team: string; field: string }>;
  colWidth: number;
  rowHeight: number;
  badgeColW: number;
  stickyLeftForDate: number;
  stickyLeftForDow: number;
  dateColW: number;
  dowColW: number;
  checkedProjectIds: Set<number>;
  handleCellClick: (staffingId: number, dateStr: string, currentlySelected: boolean, badge: PhaseBadgeInfo) => void;
  handlePersonHeaderClick: (personId: number | string) => void;
  handleSubColContextMenu: (e: React.MouseEvent, personId: number | string, subColIdx: number) => void;
  toggleProjectCheck: (projectId: number) => void;
  handleBadgeClick: (badge: PhaseBadgeInfo) => void;
  handleBadgeContextMenu: (e: React.MouseEvent, badge: PhaseBadgeInfo) => void;
  setHoveredBadgePhaseId: (id: number | null) => void;
  handleWeekLabelClick: (weekInfo: WeekInfo) => void;
}

const DayRow = React.memo(function DayRow({
  d, year, month, todayStr, weekInfo, isFirstDayOfWeek, isWeekStart,
  allPeople, personSubCols, cellDataCache, togglingCell, focusedPersonId,
  checkedProjectPeople, hoveredStaffingIds, hoveredBadgePhaseId, hatMap, changeMap,
  staffingTooltipInfo, colWidth, rowHeight, badgeColW, stickyLeftForDate,
  stickyLeftForDow, dateColW, dowColW, checkedProjectIds,
  handleCellClick, handleSubColContextMenu, toggleProjectCheck,
  handleBadgeClick, handleBadgeContextMenu, setHoveredBadgePhaseId,
  handleWeekLabelClick,
}: DayRowProps) {
  const ds = formatDateStr(year, month, d);
  const dow = getDayOfWeek(year, month, d);
  const isWe = isWeekend(year, month, d);
  const holidayName = !isWe ? getHolidayName(ds) : null;
  const isHol = holidayName !== null;
  const isNonW = isWe || isHol;
  const isTd = ds === todayStr;
  const isSun = new Date(year, month - 1, d).getDay() === 0;
  const isSat = new Date(year, month - 1, d).getDay() === 6;

  return (
    <tr
      key={d}
      className=""
      style={isWeekStart ? { borderTop: '3px solid #475569' } : undefined}
    >
      {/* Badge column */}
      {isFirstDayOfWeek && weekInfo ? (
        <td
          className={`sticky left-0 border border-gray-300 border-r-2 border-r-slate-400 align-top ${
            isTd ? 'bg-blue-50' : 'bg-slate-50'
          }`}
          style={{
            width: badgeColW,
            maxWidth: badgeColW,
            overflow: 'hidden',
            padding: '2px 3px',
            verticalAlign: 'top',
            zIndex: 25,
          }}
          rowSpan={weekInfo.dayCount}
        >
          <div className="flex flex-col gap-0.5">
            <button
              className="text-[8px] font-bold text-slate-500 mb-0.5 hover:text-blue-600 hover:underline cursor-pointer text-left transition-colors"
              title={`${weekInfo.weekLabel} (${weekInfo.startDate} ~ ${weekInfo.endDate})\n클릭: 이 주차 투입 가능 인력 보기`}
              onClick={() => weekInfo && handleWeekLabelClick(weekInfo)}
            >
              🗓 {weekInfo.weekLabel}
            </button>
            {(() => {
              const aBadges = weekInfo.badges.filter((b) => b.status === 'A');
              const pBadges = weekInfo.badges.filter((b) => b.status === 'P');
              return (
                <>
                  {aBadges.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[7px] font-bold text-blue-600 border-b border-blue-200 pb-0.5 mb-0.5">
                        사업 (A)
                      </div>
                      {aBadges.map((badge) => {
                        const isChecked = checkedProjectIds.has(badge.projectId);
                        return (
                          <div key={badge.phaseId} className="flex items-center gap-1">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleProjectCheck(badge.projectId)}
                              className="h-3 w-3 flex-shrink-0"
                            />
                            <button
                              className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-bold cursor-pointer hover:brightness-90 transition-all whitespace-nowrap flex-1 text-left min-w-0"
                              style={{
                                backgroundColor: hoveredBadgePhaseId === badge.phaseId ? badge.color.cell : badge.color.bg,
                                backgroundImage: badge.pattern,
                                backgroundSize: badge.patternSize,
                                color: badge.color.text,
                                borderLeft: `3px solid ${badge.color.border}`,
                                boxShadow: hoveredBadgePhaseId === badge.phaseId ? `0 0 0 2px ${badge.color.border}` : undefined,
                              }}
                              onClick={() => handleBadgeClick(badge)}
                              onContextMenu={(e) => handleBadgeContextMenu(e, badge)}
                              onMouseEnter={() => setHoveredBadgePhaseId(badge.phaseId)}
                              onMouseLeave={() => setHoveredBadgePhaseId(null)}
                              title={`${badge.label} (${badge.status})\n기간: ${badge.startDate || '?'} ~ ${badge.endDate || '?'}\n좌클릭: 수정 | 우클릭: 단계별 일정`}
                            >
                              <span className="truncate flex-1">{badge.label}</span>
                              <span className="text-[7px] font-bold rounded px-0.5 flex-shrink-0" style={{ backgroundColor: badge.color.border, color: '#fff' }}>
                                {badge.status}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {aBadges.length > 0 && pBadges.length > 0 && (
                    <div className="border-t border-dashed border-slate-300 my-0.5" />
                  )}
                  {pBadges.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[7px] font-bold text-amber-600 border-b border-amber-200 pb-0.5 mb-0.5">
                        제안 (P)
                      </div>
                      {pBadges.map((badge) => {
                        const isChecked = checkedProjectIds.has(badge.projectId);
                        return (
                          <div key={badge.phaseId} className="flex items-center gap-1">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleProjectCheck(badge.projectId)}
                              className="h-3 w-3 flex-shrink-0"
                            />
                            <button
                              className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-bold cursor-pointer hover:brightness-90 transition-all whitespace-nowrap flex-1 text-left min-w-0"
                              style={{
                                backgroundColor: hoveredBadgePhaseId === badge.phaseId ? badge.color.cell : badge.color.bg,
                                backgroundImage: badge.pattern,
                                backgroundSize: badge.patternSize,
                                color: badge.color.text,
                                borderLeft: `3px solid ${badge.color.border}`,
                                boxShadow: hoveredBadgePhaseId === badge.phaseId ? `0 0 0 2px ${badge.color.border}` : undefined,
                              }}
                              onClick={() => handleBadgeClick(badge)}
                              onContextMenu={(e) => handleBadgeContextMenu(e, badge)}
                              onMouseEnter={() => setHoveredBadgePhaseId(badge.phaseId)}
                              onMouseLeave={() => setHoveredBadgePhaseId(null)}
                              title={`${badge.label} (${badge.status})\n기간: ${badge.startDate || '?'} ~ ${badge.endDate || '?'}\n좌클릭: 수정 | 우클릭: 단계별 일정`}
                            >
                              <span className="truncate flex-1">{badge.label}</span>
                              <span className="text-[7px] font-bold rounded px-0.5 flex-shrink-0" style={{ backgroundColor: badge.color.border, color: '#fff' }}>
                                {badge.status}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </td>
      ) : !isFirstDayOfWeek ? null : (
        <td
          className="sticky left-0 border border-gray-300 border-r-2 border-r-slate-400 bg-slate-50"
          style={{ width: badgeColW, maxWidth: badgeColW, overflow: 'hidden', padding: '2px 3px', zIndex: 25 }}
        >
          <span className="text-[8px] text-gray-400 italic">-</span>
        </td>
      )}
      {/* Date */}
      <td
        className={`sticky border border-gray-300 text-center font-semibold text-[11px] ${
          isTd ? 'bg-blue-100 text-blue-800' : isHol ? 'bg-red-50 text-red-600' : isWe ? 'bg-gray-100' : 'bg-white'
        }`}
        style={{ left: stickyLeftForDate, width: dateColW, padding: '3px 0', height: rowHeight, zIndex: 20 }}
        title={holidayName ?? undefined}
      >
        {d}
        {isHol && <span className="block text-[7px] leading-none text-red-400 truncate px-0.5">{holidayName}</span>}
      </td>
      {/* Day of week */}
      <td
        className={`sticky border border-gray-300 border-r-2 border-r-slate-400 text-center text-[10px] font-medium ${
          isHol ? 'text-red-500' : isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-gray-600'
        } ${isTd ? 'bg-blue-100' : isHol ? 'bg-red-50' : isWe ? 'bg-gray-100' : 'bg-white'}`}
        style={{ left: stickyLeftForDow, width: dowColW, padding: '3px 0', zIndex: 20 }}
      >
        {dow}
      </td>
      {/* Person sub-columns */}
      {allPeople.map((p, pi) => {
        const cols = personSubCols.get(p.id) || MIN_SUB_COLS;
        return Array.from({ length: cols }).map((_, si) => {
          const cellData = cellDataCache.get(`${p.id}_${d}_${si}`) ?? null;
          const cellKey = cellData ? `${cellData.staffingId}_${cellData.dateStr}` : '';
          const isToggling = togglingCell === cellKey;
          const isFocused = focusedPersonId === p.id;
          const isInChecked = checkedProjectPeople.has(p.id);
          const isFirstSub = si === 0;
          const isLastPerson = pi === allPeople.length - 1;
          const isLastSub = si === cols - 1;
          const isLastCheckedPerson = isInChecked && (pi === allPeople.length - 1 || !checkedProjectPeople.has(allPeople[pi + 1]?.id));

          const tooltipInfo = cellData ? staffingTooltipInfo.get(cellData.staffingId) : null;
          const hatRecord = cellData ? hatMap.get(cellData.staffingId) : undefined;
          const changeRecords = cellData ? (changeMap.get(cellData.staffingId) ?? []) : [];
          const changeRecord = changeRecords.length > 0 ? changeRecords[changeRecords.length - 1] : undefined;
          const isHatCell = !!hatRecord && !cellData?.isHatItem;
          const isHatActualCell = !!cellData?.isHatItem;

          const changeTooltipSuffix = changeRecords.length > 0
            ? '\n' + changeRecords.map((cr, idx) =>
                `🔁 변경${idx + 1}: ${cr.original_person_name} → ${cr.new_person_name}${cr.reason ? ` (${cr.reason})` : ''} [${cr.changed_at.slice(0, 10)}]`
              ).join('\n')
            : '';

          const cellTooltip = tooltipInfo
            ? isHatCell
              ? `${tooltipInfo.label}\n팀: ${tooltipInfo.team}\n분야: ${tooltipInfo.field}\n🎩 ${hatRecord!.actual_person_name}이(가) 대신 투입 중\n(모자 해제 후 수정 가능)${changeTooltipSuffix}`
              : isHatActualCell
                ? `${tooltipInfo.label}\n팀: ${tooltipInfo.team}\n분야: ${tooltipInfo.field}\n🎩 ${cellData!.hatForPersonName || '공식인력'} 대신 투입 중\n(일정 수정 불가)${changeTooltipSuffix}`
                : `${tooltipInfo.label}\n팀: ${tooltipInfo.team}\n분야: ${tooltipInfo.field}${changeTooltipSuffix}${cellData?.isSelected ? '\n✅ 선택됨 - 클릭하여 해제' : '\n클릭하여 선택'}`
            : undefined;

          const isHoveredBadgeCell = cellData ? hoveredStaffingIds.has(cellData.staffingId) : false;
          const focusBg = isHoveredBadgeCell
            ? (cellData?.badge.color.available || 'rgba(253,230,138,0.5)')
            : isFocused ? 'rgba(254,249,195,0.4)' : isInChecked ? 'rgba(224,231,255,0.35)' : undefined;

          const borderStyle: React.CSSProperties = {
            borderLeft: isFirstSub ? '2px solid #64748b' : '1px solid #e5e7eb',
            borderRight: isLastSub && isLastCheckedPerson && !isLastPerson
              ? '3px solid #6366f1'
              : isLastSub && isLastPerson
                ? '1px solid #d1d5db'
                : isLastSub
                  ? '1px solid #cbd5e1'
                  : '1px solid #e5e7eb',
            borderTop: isTd ? '1px solid #60a5fa' : '1px solid #e5e7eb',
            borderBottom: isTd ? '1px solid #60a5fa' : '1px solid #e5e7eb',
          };

          if (cellData && cellData.isSelected) {
            const isNonWorkSelected = !cellData.isAvailable;
            const isLockedCell = isHatCell || isHatActualCell;
            const cellPattern = isNonWorkSelected ? 'none' : cellData.badge.pattern;
            const cellPatternSize = isNonWorkSelected ? 'auto' : cellData.badge.patternSize;
            return (
              <td
                key={`${p.id}-${d}-${si}`}
                className={`text-center select-none transition-all ${isToggling ? 'opacity-50' : ''} ${isLockedCell ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-90'}`}
                style={{
                  position: 'relative', zIndex: 0,
                  backgroundColor: isNonWorkSelected
                    ? (cellData.isHoliday ? '#fee2e2' : '#f3f4f6')
                    : cellData.badge.color.cell,
                  backgroundImage: cellPattern,
                  backgroundSize: cellPatternSize,
                  color: isNonWorkSelected
                    ? (cellData.isHoliday ? '#ef4444' : '#6b7280')
                    : cellData.badge.color.text,
                  width: colWidth, height: rowHeight, padding: 0, fontSize: 10, fontWeight: 700,
                  ...borderStyle,
                  ...(isHatCell
                    ? { opacity: 0.75 }
                    : isNonWorkSelected
                      ? { boxShadow: 'inset 0 0 0 2px #fca5a5', outline: '1px solid #f87171' }
                      : isHoveredBadgeCell
                        ? { boxShadow: `inset 0 0 0 2px ${cellData.badge.color.border}`, filter: 'brightness(0.92)' }
                        : isFocused ? { boxShadow: 'inset 0 0 0 1px rgba(234,179,8,0.5)' } : {}),
                }}
                title={isNonWorkSelected ? `⚠️ ${cellData.isHoliday ? '공휴일' : '주말'} 투입 (클릭하여 해제)` : cellTooltip}
                onClick={() => handleCellClick(cellData.staffingId, cellData.dateStr, true, cellData.badge)}
              >
                {isToggling ? '…' : isHatCell ? '' : isHatActualCell ? cellData.badge.status : (isNonWorkSelected ? '✕' : (
                  changeRecords.length > 0
                    ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, fontSize: 8 }}>
                        <span style={{ color: '#3b82f6', fontWeight: 700 }}>🔁</span>
                        <span style={{ fontWeight: 700 }}>{cellData.badge.is_won ? 'P👑' : cellData.badge.status}</span>
                      </span>
                    : (cellData.badge.is_won ? 'P👑' : cellData.badge.status)
                ))}
              </td>
            );
          }

          if (cellData && cellData.isAvailable && !cellData.isSelected) {
            const dashedBorder = isHoveredBadgeCell ? 'solid' : 'dashed';
            return (
              <td
                key={`${p.id}-${d}-${si}`}
                className={`text-center select-none transition-all ${isToggling ? 'opacity-50' : ''} ${(isHatCell || isHatActualCell) ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-95'}`}
                style={{
                  position: 'relative', zIndex: 0,
                  backgroundColor: isHatCell
                    ? (cellData.badge.color.available || '#f9fafb')
                    : isHoveredBadgeCell ? cellData.badge.color.bg : (focusBg || cellData.badge.color.available),
                  backgroundImage: cellData.badge.pattern,
                  backgroundSize: cellData.badge.patternSize,
                  width: colWidth, height: rowHeight, padding: 0,
                  borderTop: borderStyle.borderTop,
                  borderBottom: borderStyle.borderBottom,
                  borderLeft: isFirstSub ? '2px solid #64748b' : `1px ${dashedBorder} ${cellData.badge.color.border}`,
                  borderRight: (() => {
                    const baseRight = borderStyle.borderRight as string;
                    if (isLastSub && (isLastCheckedPerson || isLastPerson)) return baseRight;
                    if (isLastSub) return baseRight;
                    return `1px ${dashedBorder} ${cellData.badge.color.border}`;
                  })(),
                  ...(isHatCell ? { opacity: 0.6 } : {}),
                }}
                title={cellTooltip}
                onClick={() => handleCellClick(cellData.staffingId, cellData.dateStr, false, cellData.badge)}
              >
                {isToggling ? '…' : ''}
              </td>
            );
          }

          if (cellData && !cellData.isAvailable) {
            return (
              <td
                key={`${p.id}-${d}-${si}`}
                style={{
                  position: 'relative', zIndex: 0,
                  backgroundColor: focusBg || (cellData.isHoliday ? '#fef2f2' : '#f1f5f9'),
                  width: colWidth, height: rowHeight, padding: 0, ...borderStyle,
                }}
                title={cellData.isHoliday ? (holidayName || '공휴일') : '주말'}
              />
            );
          }

          return (
            <td
              key={`${p.id}-${d}-${si}`}
              style={{
                position: 'relative', zIndex: 0,
                backgroundColor: focusBg || (isHol ? '#fef2f2' : isWe ? '#f1f5f9' : '#ffffff'),
                width: colWidth, height: rowHeight, padding: 0, ...borderStyle,
              }}
            />
          );
        });
      })}
    </tr>
  );
}, (prev, next) => {
  // 이 행에 영향을 주는 props만 비교 — 변화 없으면 재렌더 스킵
  if (prev.d !== next.d || prev.year !== next.year || prev.month !== next.month) return false;
  if (prev.togglingCell !== next.togglingCell) return false;
  if (prev.colWidth !== next.colWidth || prev.rowHeight !== next.rowHeight) return false;
  if (prev.focusedPersonId !== next.focusedPersonId) return false;
  if (prev.hoveredBadgePhaseId !== next.hoveredBadgePhaseId) return false;
  if (prev.allPeople !== next.allPeople) return false;
  if (prev.checkedProjectPeople !== next.checkedProjectPeople) return false;
  if (prev.checkedProjectIds !== next.checkedProjectIds) return false;
  if (prev.cellDataCache !== next.cellDataCache) return false;
  if (prev.hatMap !== next.hatMap) return false;
  if (prev.changeMap !== next.changeMap) return false;
  if (prev.badgeColW !== next.badgeColW || prev.stickyLeftForDate !== next.stickyLeftForDate) return false;
  return true;
});

/* ───────── Main Component ───────── */
export default function ScheduleTab({ projects, phases, staffing, people, onRefresh }: ScheduleTabProps) {
  const now = new Date();
  const saved = getSavedMonth();
  const { canWrite, isViewer } = useUserRole();
  const [year, setYear] = useState(saved?.year ?? now.getFullYear());
  const [month, setMonth] = useState(saved?.month ?? (now.getMonth() + 1));
  const [autoNavigated, setAutoNavigated] = useState(!!saved);
  const [editTarget, setEditTarget] = useState<{ project: Project; phase: Phase } | null>(null);
  const [mdExpandDialog, setMdExpandDialog] = useState<{
    open: boolean;
    resolve: ((expandMd: boolean | null) => void) | null;
    oldBizDays: number;
    newBizDays: number;
    staffingList: Array<{ person_name: string; current_md: number }>;
  }>({ open: false, resolve: null, oldBizDays: 0, newBizDays: 0, staffingList: [] });
  const [localProjects, setLocalProjects] = useState<Project[]>(projects);
  const [localPhases, setLocalPhases] = useState<Phase[]>(phases);
  const [localStaffing, setLocalStaffing] = useState<StaffingRow[]>(staffing);

  // ── 모자(Hat) state ─────────────────────────────────────────
  const [hatMap, setHatMap] = useState<Map<number, HatRecord>>(new Map()); // key: staffing_id

  // ── 공식 인력 변경 이력 (staffingId → 전체 이력 배열) ─────────
  const [changeMap, setChangeMap] = useState<Map<number, StaffingChangeRecord[]>>(new Map());

  // staffing 변경 시 hat + changeMap 로드
  useEffect(() => {
    const ids = staffing.map((s) => s.id);
    if (ids.length === 0) { setHatMap(new Map()); setChangeMap(new Map()); return; }
    const projectIds = [...new Set(staffing.map((s) => s.project_id))];
    Promise.all([
      // hat 로드
      Promise.all(
        projectIds.map((pid) =>
          client.apiCall.invoke({ url: `/api/v1/staffing-hat/by-project/${pid}`, method: 'GET' })
            .catch(() => [])
        )
      ),
      // 공식 변경 이력 로드
      Promise.all(
        projectIds.map((pid) =>
          client.staffingChange.getByProject(pid).catch(() => [] as StaffingChangeRecord[])
        )
      ),
    ]).then(([hatResults, changeResults]) => {
      const hMap = new Map<number, HatRecord>();
      hatResults.flat().forEach((h: HatRecord) => hMap.set(h.staffing_id, h));
      setHatMap(hMap);

      // staffingId별 전체 이력 배열 (changed_at 오름차순)
      const cMap = new Map<number, StaffingChangeRecord[]>();
      changeResults.flat().forEach((c: StaffingChangeRecord) => {
        const arr = cMap.get(c.staffing_id) ?? [];
        arr.push(c);
        cMap.set(c.staffing_id, arr);
      });
      // 각 배열을 changed_at 오름차순 정렬
      cMap.forEach((arr) => arr.sort((a, b) => a.changed_at.localeCompare(b.changed_at)));
      setChangeMap(cMap);
    });
  }, [staffing]);

  const handleHatSave = useCallback(async (staffingId: number, actualName: string, actualPersonId: number | null) => {
    const res = await client.apiCall.invoke({
      url: '/api/v1/staffing-hat/batch',
      method: 'POST',
      data: [{ staffing_id: staffingId, actual_person_name: actualName, actual_person_id: actualPersonId }],
    });
    const hats: HatRecord[] = res || [];
    setHatMap((prev) => {
      const next = new Map(prev);
      hats.forEach((h) => next.set(h.staffing_id, h));
      return next;
    });
  }, []);

  const handleHatDelete = useCallback(async (staffingId: number) => {
    await client.apiCall.invoke({
      url: `/api/v1/staffing-hat/by-staffing/${staffingId}`,
      method: 'DELETE',
    });
    setHatMap((prev) => {
      const next = new Map(prev);
      next.delete(staffingId);
      return next;
    });
  }, []);

  // Map<"staffing_id_date", CalendarEntry> — 셀 클릭 시 해당 key만 갱신, 전체 배열 교체 없음
  const [entryMap, setEntryMap] = useState<Map<string, CalendarEntry>>(new Map());
  const [loadingEntries, setLoadingEntries] = useState(false);
  // 전체 기간 staffing별 투입 MD 카운트 (월 무관)
  const [totalMdCount, setTotalMdCount] = useState<Map<number, number>>(new Map());
  const [togglingCell, setTogglingCell] = useState<string | null>(null);
  const [bulkFilling, setBulkFilling] = useState(false);

  // ── Presence (주간별 사업 일정 동접자 표시) ──
  // page_id=0 고정: 전체 일정 화면은 단일 공유 공간
  const { users: presenceUsers, others: presenceOthers, currentUserId: presenceCurrentUserId } = usePresence({
    pageType: 'schedule',
    pageId: 0,
    mode: bulkFilling ? 'editing' : 'viewing',
  });
  const scheduleIsLocked = presenceOthers.length > 0;

  // Dynamic column width & row height
  // input 표시용 (즉시 업데이트) vs 실제 렌더링용 (debounce 300ms)
  const [colWidth, setColWidth] = useState(getSavedColWidth);
  const [rowHeight, setRowHeight] = useState(getSavedRowHeight);
  const [colWidthInput, setColWidthInput] = useState(getSavedColWidth);
  const [rowHeightInput, setRowHeightInput] = useState(getSavedRowHeight);
  const colWidthDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowHeightDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Person column focus
  const [focusedPersonId, setFocusedPersonId] = useState<number | string | null>(null);

  // Badge checkbox filter: checked project IDs -> sort those people first
  const [checkedProjectIds, setCheckedProjectIds] = useState<Set<number>>(new Set());
  // 체크박스 변경 시점의 인력 순서를 고정 (셀 클릭으로 일정 변경 시 소팅 불변)
  const [frozenPeopleOrder, setFrozenPeopleOrder] = useState<Array<number | string> | null>(null);
  // 인력 표시 범위: false = 해당 월 투입인력만(디폴트), true = 전체인력
  const [showAllPeople, setShowAllPeople] = useState(false);

  // Badge hover highlight
  const [hoveredBadgePhaseId, setHoveredBadgePhaseId] = useState<number | null>(null);

  // Badge context menu: right-click to show project phases
  const [badgeContextMenu, setBadgeContextMenu] = useState<{
    x: number;
    y: number;
    projectId: number;
    projectName: string;
    color: typeof PROJECT_COLORS[0];
  } | null>(null);
  const badgeContextMenuRef = useRef<HTMLDivElement>(null);

  // Close badge context menu on outside click
  useEffect(() => {
    if (!badgeContextMenu) return;
    const handler = (e: MouseEvent) => {
      if (badgeContextMenuRef.current && !badgeContextMenuRef.current.contains(e.target as Node)) {
        setBadgeContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [badgeContextMenu]);

  // Persist month changes to sessionStorage
  useEffect(() => { saveMonth(year, month); }, [year, month]);

  // Persist col width & row height
  useEffect(() => { try { sessionStorage.setItem(SCHEDULE_COL_WIDTH_KEY, String(colWidth)); } catch { /* ignore */ } }, [colWidth]);
  useEffect(() => { try { sessionStorage.setItem(SCHEDULE_ROW_HEIGHT_KEY, String(rowHeight)); } catch { /* ignore */ } }, [rowHeight]);

  useEffect(() => { setLocalProjects(projects); }, [projects]);
  useEffect(() => { setLocalPhases(phases); }, [phases]);
  useEffect(() => { setLocalStaffing(staffing); }, [staffing]);

  const daysInMonth = getDaysInMonth(year, month);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (autoNavigated || localPhases.length === 0) return;
    const hasCurrentMonth = localPhases.some((ph) => phaseOverlapsMonth(ph, year, month));
    if (!hasCurrentMonth) {
      let earliest: Date | null = null;
      localPhases.forEach((ph) => {
        if (ph.start_date) {
          const d = new Date(ph.start_date);
          if (!earliest || d < earliest) earliest = d;
        }
      });
      if (earliest) {
        setYear(earliest.getFullYear());
        setMonth(earliest.getMonth() + 1);
      }
    }
    setAutoNavigated(true);
  }, [localPhases, year, month, autoNavigated]);

  const staffingMap = useMemo(() => {
    const map = new Map<number, StaffingRow>();
    localStaffing.forEach((s) => map.set(s.id, s));
    return map;
  }, [localStaffing]);

  const fetchCalendarEntries = useCallback(async () => {
    // person 미배정 staffing도 포함 — DB에 entry가 있을 수 있음
    const relevantStaffingIds = localStaffing.map((s) => s.id);

    if (relevantStaffingIds.length === 0) {
      setEntryMap(new Map());
      setTotalMdCount(new Map());
      return;
    }

    setLoadingEntries(true);
    try {
      // 월별 entry + 전체 기간 카운트를 병렬 조회
      const [monthRes, totalRes] = await Promise.all([
        client.apiCall.invoke({
          url: '/api/v1/calendar/month',
          method: 'POST',
          data: { year, month, staffing_ids: relevantStaffingIds },
        }),
        client.apiCall.invoke({
          url: '/api/v1/calendar/staffing-total-count',
          method: 'POST',
          data: { staffing_ids: relevantStaffingIds },
        }),
      ]);

      const entries: CalendarEntry[] = monthRes?.entries || [];
      const newMap = new Map<string, CalendarEntry>();
      entries.forEach((e) => newMap.set(`${e.staffing_id}_${e.entry_date}`, e));
      setEntryMap(newMap);

      // 전체 기간 카운트 Map<staffingId, count>
      const counts: Record<string, number> = totalRes?.counts || {};
      const countMap = new Map<number, number>();
      Object.entries(counts).forEach(([sid, cnt]) => countMap.set(Number(sid), cnt as number));
      setTotalMdCount(countMap);
    } catch (err) {
      console.error('Failed to fetch calendar entries:', err);
      setEntryMap(new Map());
      setTotalMdCount(new Map());
    } finally {
      setLoadingEntries(false);
    }
  }, [year, month, localStaffing]);

  useEffect(() => {
    fetchCalendarEntries();
  }, [fetchCalendarEntries]);



  // entryLookup = entryMap 그 자체 (alias, 하위 호환)
  const entryLookup = entryMap;

  const staffingDayCount = useMemo(() => {
    const map = new Map<number, number>();
    entryMap.forEach((e) => {
      if (e.status) {
        map.set(e.staffing_id, (map.get(e.staffing_id) || 0) + 1);
      }
    });
    return map;
  }, [entryMap]);

  // ── staffing_id → phase_id → project_id 역매핑 (중복 체크용) ──
  const staffingProjectMap = useMemo(() => {
    const map = new Map<number, number>(); // staffing_id → project_id
    for (const s of localStaffing) {
      const ph = localPhases.find((p) => p.id === s.phase_id);
      if (ph) map.set(s.id, ph.project_id);
    }
    return map;
  }, [localStaffing, localPhases]);

  // ── person_id별 날짜 Set (전체 calendarEntries 기반, staffing→person 매핑 사용) ──
  // EditModal의 중복 체크에 사용: 특정 phase의 프로젝트를 제외한 날짜 집합
  const personDatesByProject = useMemo(() => {
    // staffing_id → person_id 매핑
    const staffingPersonMap = new Map<number, number>();
    for (const s of localStaffing) {
      if (s.person_id) staffingPersonMap.set(s.id, s.person_id);
    }
    // project_id별 person_id별 날짜 Set
    // 구조: Map<projectId, Map<personId, Set<dateStr>>>
    const byProject = new Map<number, Map<number, Set<string>>>();
    entryMap.forEach((e) => {
      if (!e.status) return;
      const personId = staffingPersonMap.get(e.staffing_id);
      if (!personId) return;
      const projectId = staffingProjectMap.get(e.staffing_id);
      if (!projectId) return;
      if (!byProject.has(projectId)) byProject.set(projectId, new Map());
      const projMap = byProject.get(projectId)!;
      if (!projMap.has(personId)) projMap.set(personId, new Set());
      projMap.get(personId)!.add(e.entry_date);
    });
    return byProject;
  }, [entryMap, localStaffing, staffingProjectMap]);

  // ── person별 전체 일정 날짜 Set (중복 제거) ──────────────────
  // key: person_id (number) 또는 'ext_이름' (외부) → Set<dateStr>
  // 같은 날 여러 staffing에 배정되어 있어도 날짜는 1개만 카운트
  const personAllDates = useMemo(() => {
    const map = new Map<number | string, Set<string>>();
    const staffingPersonKey = new Map<number, number | string>();
    for (const s of localStaffing) {
      if (s.person_id) {
        staffingPersonKey.set(s.id, s.person_id);
      } else if (s.person_name_text) {
        staffingPersonKey.set(s.id, `ext_${s.person_name_text.trim()}`);
      }
    }
    entryMap.forEach((e) => {
      if (!e.status) return;
      const personKey = staffingPersonKey.get(e.staffing_id);
      if (personKey === undefined) return;
      if (!map.has(personKey)) map.set(personKey, new Set());
      map.get(personKey)!.add(e.entry_date);
    });
    return map;
  }, [entryMap, localStaffing]);

  const projectColorMap = useMemo(() => {
    const map = new Map<number, typeof PROJECT_COLORS[0]>();
    const uniqueIds = [...new Set(localProjects.map((p) => p.id))];
    uniqueIds.forEach((pid, idx) => {
      const project = localProjects.find((p) => p.id === pid);
      if (project?.color_hue != null) {
        map.set(pid, hueToProjectColor(project.color_hue));
      } else {
        // color_hue 없는 경우 기존 팔레트 폴백
        map.set(pid, PROJECT_COLORS[idx % PROJECT_COLORS.length]);
      }
    });
    return map;
  }, [localProjects]);

  /**
   * 프로젝트별 무늬 패턴 매핑
   * - 같은 색상 팔레트(0~7)에서 8개 프로젝트마다 패턴을 순환 할당
   * - colorPalette 인덱스가 같은 프로젝트끼리도 패턴으로 구분 가능
   */
  const projectPatternMap = useMemo(() => {
    const map = new Map<number, { pattern: string; patternSize: string }>();
    const uniqueIds = [...new Set(localProjects.map((p) => p.id))];
    uniqueIds.forEach((pid, idx) => {
      // 색상 팔레트 8개 * 패턴 8개 = 64개 고유 조합
      // 패턴 인덱스: 전체 순서를 8로 나눈 몫 (색상 한 바퀴 돌 때마다 다음 패턴)
      const patternIdx = Math.floor(idx / PROJECT_COLORS.length) % PROJECT_PATTERNS.length;
      map.set(pid, {
        pattern: PROJECT_PATTERNS[patternIdx],
        patternSize: PATTERN_SIZES[patternIdx],
      });
    });
    return map;
  }, [localProjects]);

  const projectMap = useMemo(() => {
    const map = new Map<number, Project>();
    localProjects.forEach((p) => map.set(p.id, p));
    return map;
  }, [localProjects]);

  const phaseMapLocal = useMemo(() => {
    const map = new Map<number, Phase>();
    localPhases.forEach((p) => map.set(p.id, p));
    return map;
  }, [localPhases]);

  // Map project_id -> index in localProjects array (for consistent ordering)
  const projectIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    localProjects.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [localProjects]);

  const visiblePhases = useMemo(() => {
    // 1) 기본: 현재 월과 날짜가 겹치는 phase
    const overlapping = new Set<number>();
    for (const ph of localPhases) {
      if (phaseOverlapsMonth(ph, year, month)) overlapping.add(ph.id);
    }

    // 2) 보완: 현재 월에 선택된 calendar entry(status 있음)가 있는 staffing의 phase도 포함
    //    → phase 기간이 이미 지났어도 entries가 남아있으면 셀 표시 보장
    const phaseIdsWithEntries = new Set<number>();
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    entryMap.forEach((entry) => {
      if (!entry.status) return;
      if (!entry.entry_date.startsWith(yearMonth)) return;
      const s = localStaffing.find((st) => st.id === entry.staffing_id);
      if (s) phaseIdsWithEntries.add(s.phase_id);
    });

    return localPhases
      .filter((ph) => overlapping.has(ph.id) || phaseIdsWithEntries.has(ph.id))
      .sort((a, b) => {
        const aIdx = projectIndexMap.get(a.project_id) ?? 999999;
        const bIdx = projectIndexMap.get(b.project_id) ?? 999999;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return a.sort_order - b.sort_order;
      });
  }, [localPhases, year, month, projectIndexMap, entryMap, localStaffing]);

  const phaseBadges: PhaseBadgeInfo[] = useMemo(() => {
    return visiblePhases.map((ph) => {
      const proj = projectMap.get(ph.project_id);
      const projName = proj?.project_name || '미정';
      const status = proj?.status === '제안' ? 'P' : 'A';
      const is_won = proj?.status === '제안' && proj?.is_won === true;
      const patternInfo = projectPatternMap.get(ph.project_id) ?? { pattern: 'none', patternSize: 'auto' };
      return {
        phaseId: ph.id,
        projectId: ph.project_id,
        projectName: projName,
        phaseName: ph.phase_name,
        label: `${projName}_${ph.phase_name}`,
        color: projectColorMap.get(ph.project_id) || PROJECT_COLORS[0],
        pattern: patternInfo.pattern,
        patternSize: patternInfo.patternSize,
        status,
        is_won,
        startDate: ph.start_date,
        endDate: ph.end_date,
      };
    });
  }, [visiblePhases, projectMap, projectColorMap, projectPatternMap]);

  // Unique project IDs from badges (for checkbox list)
  const badgeProjectIds = useMemo(() => {
    const ids = new Set<number>();
    phaseBadges.forEach((b) => ids.add(b.projectId));
    return Array.from(ids);
  }, [phaseBadges]);

  // Build unified person list: DB people + external (text-only) people
  // ── 해당 월 투입인력: phase 기간이 이번 달에 걸치는 staffing 인력 + hat 실제 투입자
  // ── 전체인력: people DB 전체 + staffing 외부 인력
  const allPeopleBase: UnifiedPerson[] = useMemo(() => {
    const koSort = (a: UnifiedPerson, b: UnifiedPerson) =>
      a.name.localeCompare(b.name, 'ko');

    if (showAllPeople) {
      // ── 전체인력 모드: 모든 DB 인력 + 외부인력, 가나다순 ──
      const result: UnifiedPerson[] = [];
      const seenDbIds = new Set<number>();
      const seenExtNames = new Set<string>();

      for (const p of people) {
        if (!seenDbIds.has(p.id)) {
          seenDbIds.add(p.id);
          result.push({ id: p.id, name: p.person_name, grade: p.grade, isExternal: false });
        }
      }
      for (const s of localStaffing) {
        if (!s.person_id && s.person_name_text) {
          const extName = s.person_name_text.trim();
          if (extName && !seenExtNames.has(extName)) {
            seenExtNames.add(extName);
            result.push({ id: `ext_${extName}`, name: extName, isExternal: true });
          }
        }
      }
      return result.sort(koSort);
    }

    // ── 해당 월 투입인력 모드(디폴트): phase 기간이 이번 달에 걸치는 인력 + hat 실제 투입자 ──
    const result: UnifiedPerson[] = [];
    const seenDbIds = new Set<number>();
    const seenExtNames = new Set<string>();

    for (const s of localStaffing) {
      const ph = phaseMapLocal.get(s.phase_id);
      if (!ph || !phaseOverlapsMonth(ph, year, month)) continue;

      if (s.person_id && !seenDbIds.has(s.person_id)) {
        seenDbIds.add(s.person_id);
        const p = people.find((pp) => pp.id === s.person_id);
        if (p) result.push({ id: p.id, name: p.person_name, grade: p.grade, isExternal: false });
      }
      if (!s.person_id && s.person_name_text) {
        const extName = s.person_name_text.trim();
        if (extName && !seenExtNames.has(extName)) {
          seenExtNames.add(extName);
          result.push({ id: `ext_${extName}`, name: extName, isExternal: true });
        }
      }

      // 🎩 hat 실제 투입자도 포함
      const hatRecord = hatMap.get(s.id);
      if (hatRecord?.actual_person_id && !seenDbIds.has(hatRecord.actual_person_id)) {
        seenDbIds.add(hatRecord.actual_person_id);
        const ap = people.find((pp) => pp.id === hatRecord.actual_person_id);
        if (ap) result.push({ id: ap.id, name: ap.person_name, grade: ap.grade, isExternal: false });
      }
    }

    return result.sort(koSort);
  }, [localStaffing, people, phaseMapLocal, year, month, showAllPeople, hatMap]);

  // People participating in checked projects (staffing 배정 기반 — calendarEntries 미의존)
  // 🎩 hat 실제 투입자도 포함
  const checkedProjectPeople = useMemo(() => {
    if (checkedProjectIds.size === 0) return new Set<number | string>();

    const personIds = new Set<number | string>();
    for (const s of localStaffing) {
      if (!checkedProjectIds.has(s.project_id)) continue;
      const ph = phaseMapLocal.get(s.phase_id);
      if (!ph || !phaseOverlapsMonth(ph, year, month)) continue;
      const personKey = s.person_id ? s.person_id : (s.person_name_text ? `ext_${s.person_name_text.trim()}` : null);
      if (personKey) personIds.add(personKey);
      // hat 실제 투입자도 포함
      const hatRecord = hatMap.get(s.id);
      if (hatRecord?.actual_person_id) personIds.add(hatRecord.actual_person_id);
    }
    return personIds;
  }, [checkedProjectIds, localStaffing, phaseMapLocal, year, month, hatMap]);

  // Sort: checked project people first (by phase sort_order), then others
  // 결과를 frozenPeopleOrder 기준으로 안정 정렬 — 셀 클릭 시 순서 불변
  const allPeople: UnifiedPerson[] = useMemo(() => {
    if (checkedProjectIds.size === 0) return allPeopleBase;

    // frozenPeopleOrder가 있으면 그 순서 그대로 사용 (셀 클릭 후 재정렬 방지)
    if (frozenPeopleOrder !== null) {
      const orderMap = new Map<number | string, number>();
      frozenPeopleOrder.forEach((id, idx) => orderMap.set(id, idx));
      // allPeopleBase에 없는 checkedProjectPeople(hat 실제투입자 포함)도 반영
      const baseIds = new Set(allPeopleBase.map((p) => p.id));
      const extra: UnifiedPerson[] = [];
      for (const pid of checkedProjectPeople) {
        if (!baseIds.has(pid) && typeof pid === 'number') {
          const p = people.find((pp) => pp.id === pid);
          if (p) extra.push({ id: p.id, name: p.person_name, grade: p.grade, isExternal: false });
        }
      }
      return [...allPeopleBase, ...extra].sort((a, b) => {
        const ia = orderMap.get(a.id) ?? 99999;
        const ib = orderMap.get(b.id) ?? 99999;
        return ia - ib;
      });
    }

    // 체크박스 변경 직후 최초 소팅 계산
    const personSortKey = new Map<number | string, number>();
    for (const s of localStaffing) {
      if (!checkedProjectIds.has(s.project_id)) continue;
      const ph = phaseMapLocal.get(s.phase_id);
      if (!ph) continue;
      const teamInfo = getTeamInfo(s.field);
      const key = teamInfo.sortGroup * 1000 + teamInfo.sortOrder * 100 + ph.sort_order;
      const personKey = s.person_id ? s.person_id : `ext_${(s.person_name_text || '').trim()}`;
      const existing = personSortKey.get(personKey);
      if (existing === undefined || key < existing) {
        personSortKey.set(personKey, key);
      }
      // 🎩 hat 실제 투입자도 동일 sort key 부여 (공식 인력 바로 뒤에 오도록 +0.5 처리)
      const hatRecord = hatMap.get(s.id);
      if (hatRecord?.actual_person_id) {
        const hatKey = key + 1; // 공식 인력 바로 다음
        const existing2 = personSortKey.get(hatRecord.actual_person_id);
        if (existing2 === undefined || hatKey < existing2) {
          personSortKey.set(hatRecord.actual_person_id, hatKey);
        }
      }
    }

    // allPeopleBase에 없는 hat 실제 투입자 보완 추가
    const baseIds = new Set(allPeopleBase.map((p) => p.id));
    const extraPeople: UnifiedPerson[] = [];
    for (const pid of checkedProjectPeople) {
      if (!baseIds.has(pid) && typeof pid === 'number') {
        const p = people.find((pp) => pp.id === pid);
        if (p) extraPeople.push({ id: p.id, name: p.person_name, grade: p.grade, isExternal: false });
      }
    }
    const base = [...allPeopleBase, ...extraPeople];

    const checked = base.filter((p) => checkedProjectPeople.has(p.id));
    const unchecked = base.filter((p) => !checkedProjectPeople.has(p.id));

    checked.sort((a, b) => {
      const ka = personSortKey.get(a.id) ?? 9999;
      const kb = personSortKey.get(b.id) ?? 9999;
      return ka - kb;
    });

    return [...checked, ...unchecked];
  }, [allPeopleBase, checkedProjectIds, checkedProjectPeople, localStaffing, phaseMapLocal, frozenPeopleOrder, hatMap, people]);

  // 체크박스 변경 직후 (frozenPeopleOrder === null) allPeople 순서를 고정
  // 이후 셀 클릭으로 calendarEntries가 바뀌어도 순서가 유지됨
  useEffect(() => {
    if (checkedProjectIds.size > 0 && frozenPeopleOrder === null) {
      setFrozenPeopleOrder(allPeople.map((p) => p.id));
    }
    if (checkedProjectIds.size === 0) {
      setFrozenPeopleOrder(null);
    }
  }, [allPeople, checkedProjectIds, frozenPeopleOrder]);

  // Person staffings with badge (unified), sorted by project index ascending
  // Also assigns a fixed slotIndex to each item via interval graph coloring:
  //   - overlapping items get different slots
  //   - non-overlapping items reuse the same slot
  //   → total slots = max simultaneous overlaps (minimum columns needed)
  const personStaffings = useMemo(() => {
    const map = new Map<number | string, StaffingWithBadge[]>();
    const badgeByPhase = new Map<number, PhaseBadgeInfo>();
    phaseBadges.forEach((b) => badgeByPhase.set(b.phaseId, b));

    // phase가 visiblePhases에 없어도 이 월에 entry가 있으면 badge를 직접 생성해 셀 표시
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const staffingHasEntryThisMonth = new Set<number>();
    entryMap.forEach((entry) => {
      if (entry.status && entry.entry_date.startsWith(yearMonth)) {
        staffingHasEntryThisMonth.add(entry.staffing_id);
      }
    });

    for (const person of allPeople) {
      const items: StaffingWithBadge[] = [];
      for (const s of localStaffing) {
        const matches = person.isExternal
          ? (!s.person_id && s.person_name_text?.trim() === person.name)
          : (s.person_id === person.id);
        if (!matches) continue;
        let badge = badgeByPhase.get(s.phase_id);
        // Phantom badge: phase가 visiblePhases에 없어도 이 월에 선택된 entry가 있으면 표시
        if (!badge && staffingHasEntryThisMonth.has(s.id)) {
          const ph = phaseMapLocal.get(s.phase_id);
          const proj = projectMap.get(s.project_id);
          const projName = proj?.project_name || '미정';
          const status = proj?.status === '제안' ? 'P' : 'A';
          badge = {
            phaseId: s.phase_id,
            projectId: s.project_id,
            projectName: projName,
            phaseName: ph?.phase_name || '',
            label: `${projName}_${ph?.phase_name || ''}`,
            color: projectColorMap.get(s.project_id) || PROJECT_COLORS[0],
            status,
            startDate: ph?.start_date,
            endDate: ph?.end_date,
          } as PhaseBadgeInfo;
        }
        if (badge) {
          items.push({ staffing: s, badge });
        }
      }
      // Sort by project index (ascending) so sub-columns match badge order
      items.sort((a, b) => {
        const aIdx = projectIndexMap.get(a.staffing.project_id) ?? 999999;
        const bIdx = projectIndexMap.get(b.staffing.project_id) ?? 999999;
        if (aIdx !== bIdx) return aIdx - bIdx;
        // Same project: sort by phase sort_order
        const aPh = phaseMapLocal.get(a.staffing.phase_id);
        const bPh = phaseMapLocal.get(b.staffing.phase_id);
        return (aPh?.sort_order ?? 0) - (bPh?.sort_order ?? 0);
      });

      // ── Interval graph coloring: assign fixed slotIndex to each item ──
      // Two items "overlap" if their date ranges intersect.
      function rangesOverlap(a: StaffingWithBadge, b: StaffingWithBadge): boolean {
        const aS = a.badge.startDate || '2000-01-01';
        const aE = a.badge.endDate   || '2099-12-31';
        const bS = b.badge.startDate || '2000-01-01';
        const bE = b.badge.endDate   || '2099-12-31';
        return aS <= bE && bS <= aE;
      }
      // slotEndDate tracks the latest endDate occupying each slot
      const slotEnd: (string | undefined)[] = [];
      for (const item of items) {
        const itemStart = item.badge.startDate || '2000-01-01';
        // Find the lowest slot where the previous occupant has ended before this item starts
        let assigned = -1;
        for (let s = 0; s < slotEnd.length; s++) {
          const se = slotEnd[s] || '2099-12-31';
          if (se < itemStart) {
            assigned = s;
            break;
          }
        }
        if (assigned === -1) {
          // Need a new slot — but first check if any existing slot has no range overlap
          // (handles cases where startDate is missing / open-ended)
          let foundFree = false;
          for (let s = 0; s < slotEnd.length; s++) {
            // Check against all items already in this slot
            const slotItems = items.filter(it => (it as StaffingWithBadge & { slotIndex?: number }).slotIndex === s);
            const conflicts = slotItems.some(si => rangesOverlap(si, item));
            if (!conflicts) {
              assigned = s;
              foundFree = true;
              break;
            }
          }
          if (!foundFree) assigned = slotEnd.length;
        }
        (item as StaffingWithBadge & { slotIndex: number }).slotIndex = assigned;
        // Update slotEnd to the max endDate for this slot
        const itemEnd = item.badge.endDate || '2099-12-31';
        slotEnd[assigned] = slotEnd[assigned]
          ? (slotEnd[assigned]! > itemEnd ? slotEnd[assigned] : itemEnd)
          : itemEnd;
      }

      map.set(person.id, items);
    }

    // 🎩 Hat 실제 투입자의 sub-column 추가
    // hatMap: staffing_id → HatRecord(actual_person_id, actual_person_name)
    // 실제 투입자가 allPeople에 있으면 해당 인력의 items에 hat 가상 badge 항목 추가
    for (const [staffingId, hatRecord] of hatMap) {
      if (!hatRecord.actual_person_id) continue;
      const officialStaffing = localStaffing.find((s) => s.id === staffingId);
      if (!officialStaffing) continue;
      const badge = (() => {
        const b = new Map<number, PhaseBadgeInfo>();
        phaseBadges.forEach((pb) => b.set(pb.phaseId, pb));
        return b.get(officialStaffing.phase_id);
      })();
      if (!badge) continue;
      const actualPerson = allPeople.find((p) => p.id === hatRecord.actual_person_id);
      if (!actualPerson) continue;
      const existingItems = map.get(actualPerson.id) || [];
      // hat 배지 – status에 '🎩' 접두어 추가, staffing ID는 공식 인력의 staffing ID 사용
      const hatBadge: PhaseBadgeInfo = {
        ...badge,
        status: `🎩${badge.status}`,
      };
      const hatItem: StaffingWithBadge & { slotIndex?: number; isHatItem?: boolean; hatForPersonName?: string } = {
        staffing: officialStaffing,
        badge: hatBadge,
        isHatItem: true,
        hatForPersonName: officialStaffing.person_name_text || '공식인력',
      };
      // slotIndex 배정: 기존 items와 겹치지 않는 슬롯 찾기
      const usedSlots = existingItems.map((it) => (it as StaffingWithBadge & { slotIndex?: number }).slotIndex ?? 0);
      let slot = 0;
      while (usedSlots.includes(slot)) slot++;
      hatItem.slotIndex = slot;
      existingItems.push(hatItem);
      map.set(actualPerson.id, existingItems);
    }

    return map;
  }, [allPeople, localStaffing, phaseBadges, projectIndexMap, phaseMapLocal, entryMap, year, month, projectMap, projectColorMap, hatMap]);

  // Compute sub-columns per person: = number of slots used (max simultaneous overlap)
  // Since each item has a fixed slotIndex, subCols = max(slotIndex)+1
  const personSubCols = useMemo(() => {
    const map = new Map<number | string, number>();
    for (const person of allPeople) {
      const items = personStaffings.get(person.id) || [];
      let maxSlot = MIN_SUB_COLS - 1;
      for (const item of items) {
        const si = (item as StaffingWithBadge & { slotIndex?: number }).slotIndex ?? 0;
        if (si > maxSlot) maxSlot = si;
      }
      map.set(person.id, Math.max(maxSlot + 1, MIN_SUB_COLS));
    }
    return map;
  }, [allPeople, personStaffings]);

  // Build tooltip info for each staffing
  const staffingTooltipInfo = useMemo(() => {
    const map = new Map<number, { label: string; team: string; field: string }>();
    for (const s of localStaffing) {
      const proj = projectMap.get(s.project_id);
      const ph = phaseMapLocal.get(s.phase_id);
      const projName = proj?.project_name || '미정';
      const phaseName = ph?.phase_name || '미정';
      const teamInfo = getTeamInfo(s.field);
      map.set(s.id, {
        label: `${projName}_${phaseName}`,
        team: teamInfo.group,
        field: s.field,
      });
    }
    return map;
  }, [localStaffing, projectMap, phaseMapLocal]);

  // Weekly badge grouping
  const weekInfos: WeekInfo[] = useMemo(() => {
    const weeks: WeekInfo[] = [];
    let currentWeekStart = 1;

    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      const isLastDay = d === daysInMonth;
      const isWeekEnd = dow === 6 || isLastDay;

      if (isWeekEnd || isLastDay) {
        const weekStartDate = formatDateStr(year, month, currentWeekStart);
        const weekEndDate = formatDateStr(year, month, d);
        const weekNum = getWeekNumber(year, month, currentWeekStart);

        const weekBadges = phaseBadges.filter((badge) => {
          const ph = phaseMapLocal.get(badge.phaseId);
          if (!ph) return false;
          return phaseOverlapsWeek(ph, weekStartDate, weekEndDate);
        });

        weeks.push({
          weekNum,
          weekLabel: `W${weekNum}`,
          startDay: currentWeekStart,
          endDay: d,
          startDate: weekStartDate,
          endDate: weekEndDate,
          dayCount: d - currentWeekStart + 1,
          badges: weekBadges,
        });

        currentWeekStart = d + 1;
      }
    }
    return weeks;
  }, [year, month, daysInMonth, phaseBadges, phaseMapLocal]);

  const dayToWeek = useMemo(() => {
    const map = new Map<number, WeekInfo>();
    for (const w of weekInfos) {
      for (let d = w.startDay; d <= w.endDay; d++) {
        map.set(d, w);
      }
    }
    return map;
  }, [weekInfos]);

  // 렌더 중 함수 호출 대신 useMemo로 전체 셀 데이터를 미리 계산 (Map 조회만 남음)
  const cellDataCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calcCell> | null>();

    function calcCell(personId: number | string, day: number, subColIdx: number) {
      const items = personStaffings.get(personId) || [];
      const dateStr = formatDateStr(year, month, day);
      const isWe = isWeekend(year, month, day);
      const isHol = !isWe && getHolidayName(dateStr) !== null;
      const isNonW = isWe || isHol;

      const item = (() => {
        const inRange = items.find(
          (it) =>
            (it as StaffingWithBadge & { slotIndex?: number }).slotIndex === subColIdx &&
            dayInRange(dateStr, it.badge.startDate, it.badge.endDate)
        );
        if (inRange) return inRange;
        const candidate = items.find(
          (it) => (it as StaffingWithBadge & { slotIndex?: number }).slotIndex === subColIdx
        );
        if (candidate) {
          const key = `${candidate.staffing.id}_${dateStr}`;
          if (entryMap.get(key)?.status) return candidate;
        }
        return undefined;
      })();

      if (!item) return null;

      const isHatItem = !!(item as StaffingWithBadge & { isHatItem?: boolean }).isHatItem;
      const hatForPersonName = (item as StaffingWithBadge & { hatForPersonName?: string }).hatForPersonName;
      const entryKey = `${item.staffing.id}_${dateStr}`;
      const entry = entryMap.get(entryKey);
      const isSelected = !!entry?.status;

      return {
        staffingId: item.staffing.id,
        badge: item.badge,
        isSelected,
        isAvailable: !isNonW,
        isHoliday: isHol,
        md: item.staffing.md || 0,
        dateStr,
        entryKey,
        isHatItem,
        hatForPersonName,
      };
    }

    for (const person of allPeople) {
      const cols = personSubCols.get(person.id) || MIN_SUB_COLS;
      for (let d = 1; d <= daysInMonth; d++) {
        for (let si = 0; si < cols; si++) {
          cache.set(`${person.id}_${d}_${si}`, calcCell(person.id, d, si));
        }
      }
    }
    return cache;
  }, [allPeople, personStaffings, personSubCols, daysInMonth, year, month, entryMap]);

  const getPersonDayCellData = useCallback(
    (personId: number | string, day: number, subColIdx: number) =>
      cellDataCache.get(`${personId}_${day}_${subColIdx}`) ?? null,
    [cellDataCache]
  );

  const handleCellClick = async (staffingId: number, dateStr: string, currentlySelected: boolean, badge: PhaseBadgeInfo) => {
    if (isViewer) {
      // 뷰어: 셀 클릭 시 해당 단계 투입인력 읽기전용 모달 열기
      const proj = projectMap.get(badge.projectId);
      const ph = phaseMapLocal.get(badge.phaseId);
      if (proj && ph) {
        setEditTarget({ project: { ...proj }, phase: { ...ph } });
      }
      return;
    }
    if (scheduleIsLocked) {
      toast.error('다른 사용자가 열람 중입니다. 잠시 후 다시 시도하세요.');
      return;
    }
    // 🎩 모자가 씌워진 셀은 직접 수정 불가 (투입공수 원장에서 모자 해제 후 수정 가능)
    if (hatMap.has(staffingId)) {
      const hatRecord = hatMap.get(staffingId)!;
      toast.warning(`🎩 이 일정은 "${hatRecord.actual_person_name}"이(가) 대신 투입 중입니다. 투입공수 원장에서 모자를 해제하면 수정할 수 있습니다.`);
      return;
    }
    // 🎩 hat 실제 투입자 셀 (badge.status에 🎩 포함) 클릭 잠금
    if (badge.status.includes('🎩')) {
      toast.warning('🎩 이 일정은 모자(대체인력)에 의해 생성된 일정입니다. 투입공수 원장에서 모자를 해제하면 수정할 수 있습니다.');
      return;
    }
    const cellKey = `${staffingId}_${dateStr}`;
    if (togglingCell === cellKey) return;

    // 공휴일/주말에는 새로 투입 불가 (삭제는 허용)
    if (!currentlySelected) {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (isNonWork(y, m, d)) {
        const holName = getHolidayName(dateStr);
        toast.error(`${holName ? `공휴일(${holName})` : '주말'}에는 일정을 추가할 수 없습니다.`);
        return;
      }
    }

    if (!currentlySelected) {
      const s = staffingMap.get(staffingId);
      if (s && s.md !== null && s.md !== undefined) {
        const currentCount = totalMdCount.get(staffingId) || 0;
        if (currentCount >= s.md) {
          toast.error(`투입공수 한도 초과: 전체 기간 ${s.md}MD 중 ${currentCount}MD 이미 투입됨`);
          return;
        }
      }
    }

    setTogglingCell(cellKey);
    const newStatus = currentlySelected ? null : badge.status;

    // ── 낙관적 UI 업데이트: API 호출 전에 먼저 화면에 반영 ──
    const prevEntryMap = entryMap; // 롤백용 스냅샷
    const prevTotalMdCount = totalMdCount; // 롤백용 스냅샷
    if (currentlySelected) {
      setEntryMap((prev) => { const next = new Map(prev); next.delete(cellKey); return next; });
      setTotalMdCount((prev) => { const next = new Map(prev); next.set(staffingId, Math.max(0, (prev.get(staffingId) || 0) - 1)); return next; });
    } else {
      setEntryMap((prev) => { const next = new Map(prev); next.set(cellKey, { id: null, staffing_id: staffingId, entry_date: dateStr, status: newStatus }); return next; });
      setTotalMdCount((prev) => { const next = new Map(prev); next.set(staffingId, (prev.get(staffingId) || 0) + 1); return next; });
    }

    try {
      await client.apiCall.invoke({
        url: '/api/v1/calendar/toggle',
        method: 'POST',
        data: {
          cells: [{ staffing_id: staffingId, entry_date: dateStr, status: newStatus }],
        },
      });
      // 성공 시 낙관적 업데이트를 그대로 유지
    } catch (err: any) {
      // 실패 시 이전 상태로 롤백
      setEntryMap(prevEntryMap);
      setTotalMdCount(prevTotalMdCount);
      if (err?.response?.status === 401) {
        toast.error('세션이 만료되었습니다. 다시 로그인해 주세요.');
      } else {
        toast.error('일정 변경에 실패했습니다');
      }
    } finally {
      setTogglingCell(null);
    }
  };

  // Bulk fill: fill all available business days for a specific staffing in the current month
  const handleBulkFill = async (staffingId: number, badge: PhaseBadgeInfo, mode: 'fill' | 'clear') => {
    if (bulkFilling) return;
    setBulkFilling(true);

    const s = staffingMap.get(staffingId);
    const md = s?.md ?? 0;

    try {
      const cells: { staffing_id: number; entry_date: string; status: string | null }[] = [];

      if (mode === 'fill') {
        // Collect all available (non-weekend, in-range, not-yet-selected) business days
        const currentCount = totalMdCount.get(staffingId) || 0;
        let remaining = md > 0 ? md - currentCount : daysInMonth; // if no MD limit, fill all

        for (let d = 1; d <= daysInMonth && remaining > 0; d++) {
          if (isNonWork(year, month, d)) continue;
          const dateStr = formatDateStr(year, month, d);
          if (!dayInRange(dateStr, badge.startDate, badge.endDate)) continue;
          const entryKey = `${staffingId}_${dateStr}`;
          if (entryLookup.has(entryKey)) continue; // already selected
          cells.push({ staffing_id: staffingId, entry_date: dateStr, status: badge.status });
          remaining--;
        }

        if (cells.length === 0) {
          toast.info('채울 수 있는 빈 영업일이 없습니다.');
          setBulkFilling(false);
          return;
        }
      } else {
        // Clear: remove all selected entries for this staffing in the current month
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = formatDateStr(year, month, d);
          const entryKey = `${staffingId}_${dateStr}`;
          if (entryLookup.has(entryKey)) {
            cells.push({ staffing_id: staffingId, entry_date: dateStr, status: null });
          }
        }

        if (cells.length === 0) {
          toast.info('해제할 일정이 없습니다.');
          setBulkFilling(false);
          return;
        }
      }

      // ── 낙관적 UI 업데이트: API 호출 전에 먼저 화면에 반영 ──
      const prevEntryMap = entryMap; // 롤백용 스냅샷
      const prevTotalMdCount = totalMdCount; // 롤백용 스냅샷
      if (mode === 'fill') {
        setEntryMap((prev) => {
          const next = new Map(prev);
          cells.forEach((c) => next.set(`${c.staffing_id}_${c.entry_date}`, { id: null, staffing_id: c.staffing_id, entry_date: c.entry_date, status: c.status }));
          return next;
        });
        setTotalMdCount((prev) => { const next = new Map(prev); next.set(staffingId, (prev.get(staffingId) || 0) + cells.length); return next; });
      } else {
        setEntryMap((prev) => {
          const next = new Map(prev);
          cells.forEach((c) => next.delete(`${c.staffing_id}_${c.entry_date}`));
          return next;
        });
        setTotalMdCount((prev) => { const next = new Map(prev); next.set(staffingId, Math.max(0, (prev.get(staffingId) || 0) - cells.length)); return next; });
      }

      // Send batch request
      try {
        await client.apiCall.invoke({
          url: '/api/v1/calendar/toggle',
          method: 'POST',
          data: { cells },
        });
        if (mode === 'fill') {
          toast.success(`${cells.length}일 일괄 선택 완료`);
        } else {
          toast.success(`${cells.length}일 일괄 해제 완료`);
        }
      } catch (err: any) {
        // 실패 시 이전 상태로 롤백
        setEntryMap(prevEntryMap);
        setTotalMdCount(prevTotalMdCount);
        console.error('Bulk fill failed:', err);
        if (err?.response?.status === 401) {
          toast.error('세션이 만료되었습니다. 다시 로그인해 주세요.');
        } else {
          toast.error('일괄 처리에 실패했습니다');
        }
      }
    } finally {
      setBulkFilling(false);
    }
  };

  // Context menu for bulk operations on sub-column headers
  const handleSubColContextMenu = (e: React.MouseEvent, personId: number | string, subColIdx: number) => {
    e.preventDefault();
    const items = personStaffings.get(personId) || [];
    // Fixed slot: find the item whose slotIndex === subColIdx
    const targetItem: StaffingWithBadge | null =
      items.find(it => (it as StaffingWithBadge & { slotIndex?: number }).slotIndex === subColIdx) || null;

    if (!targetItem) return;

    const staffingId = targetItem.staffing.id;
    const badge = targetItem.badge;
    const currentCount = staffingDayCount.get(staffingId) || 0;
    const tooltipInfo = staffingTooltipInfo.get(staffingId);
    const label = tooltipInfo?.label || badge.label;

    // Simple confirm dialog for bulk fill/clear
    const action = window.confirm(
      `📋 ${label}\n현재 ${currentCount}일 선택됨${targetItem.staffing.md ? ` / ${targetItem.staffing.md}MD` : ''}\n\n` +
      `확인 → 이번 달 영업일 일괄 채우기\n취소 → 이번 달 일정 일괄 해제`
    );

    if (action) {
      handleBulkFill(staffingId, badge, 'fill');
    } else {
      handleBulkFill(staffingId, badge, 'clear');
    }
  };

  const [rebuildingCalendar, setRebuildingCalendar] = useState(false);

  const handleRebuildCalendar = async () => {
    if (!confirm('모든 투입일정을 공휴일/주말 제외 영업일 기준으로 재생성합니다.\n기존 수동 수정 내역이 모두 초기화됩니다. 계속하시겠습니까?')) return;
    setRebuildingCalendar(true);
    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/calendar/rebuild_all_calendars',
        method: 'POST',
        data: {},
      });
      const data = res as { total_deleted: number; total_created: number; message: string };
      toast.success(`재생성 완료: ${data.total_deleted}개 삭제 → ${data.total_created}개 생성`);
      // 현재 월 데이터 새로고침
      await fetchCalendarEntries();
    } catch (e) {
      toast.error('캘린더 재생성 실패');
    } finally {
      setRebuildingCalendar(false);
    }
  };

  const prevMonth = () => {
    setFrozenPeopleOrder(null);
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    setFrozenPeopleOrder(null);
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  const weekBoundaries = useMemo(() => {
    const boundaries = new Set<number>();
    for (let d = 2; d <= daysInMonth; d++) {
      const prevDow = new Date(year, month - 1, d - 1).getDay();
      if (prevDow === 6) boundaries.add(d);
    }
    return boundaries;
  }, [year, month, daysInMonth]);

  const handleBadgeClick = (badge: PhaseBadgeInfo) => {
    if (isViewer) {
      // 뷰어: 읽기전용 모달로 투입인력 조회 허용
      const proj = projectMap.get(badge.projectId);
      const ph = phaseMapLocal.get(badge.phaseId);
      if (proj && ph) {
        setEditTarget({ project: { ...proj }, phase: { ...ph } });
      }
      return;
    }
    if (scheduleIsLocked) {
      toast.error('다른 사용자가 열람 중입니다. 잠시 후 다시 시도하세요.');
      return;
    }
    const proj = projectMap.get(badge.projectId);
    const ph = phaseMapLocal.get(badge.phaseId);
    if (proj && ph) {
      setEditTarget({ project: { ...proj }, phase: { ...ph } });
    }
  };

  // Right-click badge to show project's all phases
  const handleBadgeContextMenu = (e: React.MouseEvent, badge: PhaseBadgeInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setBadgeContextMenu({
      x: e.clientX,
      y: e.clientY,
      projectId: badge.projectId,
      projectName: badge.projectName,
      color: badge.color,
    });
  };

  // Get all phases for a project (sorted by sort_order)
  const getProjectPhases = useCallback((projectId: number): Phase[] => {
    return localPhases
      .filter((ph) => ph.project_id === projectId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [localPhases]);

  // Navigate to a specific phase's start month
  const navigateToPhaseMonth = (ph: Phase) => {
    if (ph.start_date) {
      const d = new Date(ph.start_date);
      setYear(d.getFullYear());
      setMonth(d.getMonth() + 1);
    }
    setBadgeContextMenu(null);
  };

  const handleSave = async (projectUpdates: Partial<Project>, phaseUpdates: Partial<Phase>, staffingChanges?: StaffingPersonChange[]) => {
    if (!editTarget) return;
    const { project, phase } = editTarget;
    try {
      // Update project info
      await client.entities.projects.update({ id: String(project.id), data: projectUpdates });

      // Check if phase dates changed
      const datesChanged =
        (phaseUpdates.start_date || '') !== (phase.start_date || '') ||
        (phaseUpdates.end_date || '') !== (phase.end_date || '');

      const hasStaffing = localStaffing.some((s) => s.phase_id === phase.id);

      if (datesChanged && hasStaffing && phaseUpdates.start_date && phaseUpdates.end_date) {
        // Preview impact of date change
        try {
          const previewRes = await client.apiCall.invoke({
            url: '/api/v1/phase_date_sync/preview',
            method: 'POST',
            data: {
              phase_id: phase.id,
              new_start_date: phaseUpdates.start_date,
              new_end_date: phaseUpdates.end_date,
            },
          });
          const preview = previewRes;

          // ── Case 1: 기간 축소 → 초과 인력 경고 ──
          if (preview?.exceeding_staffing?.length > 0) {
            const exceedingNames = preview.exceeding_staffing
              .map((s: { person_name: string; current_md: number }) => `${s.person_name}(${s.current_md}일)`)
              .join(', ');
            const confirmed = window.confirm(
              `⚠️ 아래 인력의 투입공수가 새 영업일(${preview.new_business_days}일)을 초과합니다:\n\n` +
              `${exceedingNames}\n\n` +
              `확인을 누르면 초과 인력의 공수가 축소되고 모든 투입일정이 재생성됩니다.\n계속하시겠습니까?`
            );
            if (!confirmed) {
              setEditTarget(null);
              return;
            }
            // Apply with force (truncate exceeding MD)
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: true, expand_md: false },
            });
          }
          // ── Case 2: 기간 확장 → MD 자동 확장 여부 선택 ──
          else if (preview?.new_business_days > preview?.old_business_days && preview?.safe_staffing?.length > 0) {
            // Show custom dialog to ask about MD expansion
            const expandMd = await new Promise<boolean | null>((resolve) => {
              setMdExpandDialog({
                open: true,
                resolve,
                oldBizDays: preview.old_business_days,
                newBizDays: preview.new_business_days,
                staffingList: preview.safe_staffing.map((s: { person_name: string; current_md: number }) => ({
                  person_name: s.person_name,
                  current_md: s.current_md,
                })),
              });
            });
            setMdExpandDialog(prev => ({ ...prev, open: false, resolve: null }));
            if (expandMd === null) {
              // User cancelled
              setEditTarget(null);
              return;
            }
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: false, expand_md: expandMd },
            });
          }
          // ── Case 3: 기간 변경이지만 staffing 없거나 동일 일수 → 그냥 apply ──
          else {
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: true, expand_md: false },
            });
          }

          // Update phase_name separately (apply already updates dates)
          if (phaseUpdates.phase_name && phaseUpdates.phase_name !== phase.phase_name) {
            await client.entities.phases.update({
              id: String(phase.id),
              data: { phase_name: phaseUpdates.phase_name },
            });
          }

          toast.success('단계 날짜가 변경되고 투입일정이 재생성되었습니다.');
        } catch (err) {
          console.error('Date sync failed:', err);
          toast.error('날짜 변경 적용 중 오류가 발생했습니다.');
          setEditTarget(null);
          return;
        }
      } else {
        // No date change or no staffing - just update phase normally
        await client.entities.phases.update({ id: String(phase.id), data: phaseUpdates });
        toast.success('수정이 완료되었습니다');
      }

      // Apply staffing changes (person, MD, delete) — batch with Promise.all
      if (staffingChanges && staffingChanges.length > 0) {
        const deletes = staffingChanges.filter((c) => c.deleteStaffing);
        const updates = staffingChanges.filter((c) => !c.deleteStaffing);

        // Batch delete: delete all at once
        if (deletes.length > 0) {
          const deleteIds = deletes.map((c) => c.staffingId);
          await Promise.all(deleteIds.map((sid) =>
            client.entities.staffing.delete({ id: String(sid) }).catch(() => {})
          ));
        }

        // Batch update: update all at once
        const mdSyncIds: { staffingId: number; newMd: number }[] = [];
        if (updates.length > 0) {
          await Promise.all(updates.map((change) => {
            const updateData: Record<string, unknown> = {};
            if (change.newPersonId) {
              updateData.person_id = change.newPersonId;
              updateData.person_name_text = change.newPersonNameText;
            } else {
              updateData.person_id = null;
              updateData.person_name_text = change.newPersonNameText;
            }
            if (change.newMd !== undefined) {
              updateData.md = change.newMd;
              mdSyncIds.push({ staffingId: change.staffingId, newMd: change.newMd ?? 0 });
            }
            updateData.updated_at = new Date().toISOString();
            return client.entities.staffing.update({
              id: String(change.staffingId),
              data: updateData,
            });
          }));
        }

        // Batch MD sync
        if (mdSyncIds.length > 0) {
          await Promise.all(mdSyncIds.map((item) =>
            client.apiCall.invoke({
              url: '/api/v1/staffing_sync/sync_md',
              method: 'POST',
              data: { staffing_id: item.staffingId, new_md: item.newMd },
            }).catch((err) => console.error('MD sync failed', item.staffingId, err))
          ));
        }

        const msgs: string[] = [];
        if (updates.length > 0) msgs.push(`${updates.length}건 수정`);
        if (deletes.length > 0) msgs.push(`${deletes.length}건 삭제`);
        if (mdSyncIds.length > 0) msgs.push(`${mdSyncIds.length}건 일정 재생성`);
        toast.success(`투입인력: ${msgs.join(', ')} 완료`);
      }

      // Update local state
      setLocalProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, ...projectUpdates } as Project : p))
      );
      setLocalPhases((prev) =>
        prev.map((p) => (p.id === phase.id ? { ...p, ...phaseUpdates } as Phase : p))
      );
      // Remove deleted staffing from local state & update changed ones
      if (staffingChanges && staffingChanges.length > 0) {
        const deletedSids = new Set(staffingChanges.filter((c) => c.deleteStaffing).map((c) => c.staffingId));
        if (deletedSids.size > 0) {
          setLocalStaffing((prev) => prev.filter((s) => !deletedSids.has(s.id)));
          setEntryMap((prev) => { const next = new Map(prev); next.forEach((_, k) => { const sid = parseInt(k.split('_')[0]); if (deletedSids.has(sid)) next.delete(k); }); return next; });
        }
        // Update person/MD for non-deleted
        const updateMap = new Map(
          staffingChanges.filter((c) => !c.deleteStaffing).map((c) => [c.staffingId, c])
        );
        if (updateMap.size > 0) {
          setLocalStaffing((prev) =>
            prev.map((s) => {
              const u = updateMap.get(s.id);
              if (!u) return s;
              return {
                ...s,
                person_id: u.newPersonId ?? undefined,
                person_name_text: u.newPersonNameText,
                md: u.newMd !== undefined ? u.newMd : s.md,
              } as StaffingRow;
            })
          );
        }
      }
      setEditTarget(null);
      fetchCalendarEntries();
      // 공식 변경 이력 갱신
      const projectIds = [...new Set(localStaffing.map((s) => s.project_id))];
      Promise.all(
        projectIds.map((pid) => client.staffingChange.getByProject(pid).catch(() => [] as StaffingChangeRecord[]))
      ).then((results) => {
        const cMap = new Map<number, StaffingChangeRecord>();
        results.flat().forEach((c: StaffingChangeRecord) => {
          const existing = cMap.get(c.staffing_id);
          if (!existing || c.changed_at > existing.changed_at) cMap.set(c.staffing_id, c);
        });
        setChangeMap(cMap);
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to save:', err);
      toast.error('저장에 실패했습니다');
    }
  };

  const { personTotals, projectTotals } = useMemo(() => {
    const pMap = new Map<string, number>();
    const prMap = new Map<string, number>();
    entryMap.forEach((entry) => {
      if (!entry.status) return;
      const s = staffingMap.get(entry.staffing_id);
      if (!s) return;
      const personName = s.person_id
        ? people.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || '?'
        : s.person_name_text || '?';
      const proj = projectMap.get(s.project_id);
      const projName = proj?.project_name || '미정';
      pMap.set(personName, (pMap.get(personName) || 0) + 1);
      prMap.set(projName, (prMap.get(projName) || 0) + 1);
    });
    return { personTotals: pMap, projectTotals: prMap };
  }, [entryMap, staffingMap, people, projectMap]);

  // ── 유휴 인력 계산 (월 기준) ───────────────────────────────
  // 이달 영업일 목록
  const monthBizDates = useMemo(() => {
    const dates: string[] = [];
    const dim = new Date(year, month, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      if (!isNonWorkday(year, month, d)) {
        dates.push(formatDateStr(year, month, d));
      }
    }
    return dates;
  }, [year, month]);

  // DB 등록 인력(people) 전체 기준: 이달 영업일 중 빈 날 계산 (외부인력 제외, 중복 무관)
  const availablePeopleInfo = useMemo(() => {
    return people
      .map((p) => {
        const busyDates = personAllDates.get(p.id) || new Set<string>();
        const freeDays = monthBizDates.filter(d => !busyDates.has(d)).length;
        const busyDays = monthBizDates.filter(d => busyDates.has(d)).length;
        return { name: p.person_name, personKey: p.id as number | string, freeDays, busyDays, totalBizDays: monthBizDates.length, isExternal: false };
      })
      .filter(v => v.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays);
  }, [people, personAllDates, monthBizDates]);

  // 일정이 아예 없는 사람 (busyDays === 0)
  const noSchedulePeople = useMemo(
    () => availablePeopleInfo.filter(p => p.busyDays === 0),
    [availablePeopleInfo]
  );
  // 일정은 있지만 빈 날이 있는 사람
  const partialSchedulePeople = useMemo(
    () => availablePeopleInfo.filter(p => p.busyDays > 0),
    [availablePeopleInfo]
  );

  // ── 주차별 투입 가능 인력 계산 ──────────────────────────────
  // 해당 주차 영업일 중 person에게 일정이 없는 날 = 투입 가능일 (중복 무관)
  const [weekAvailPopup, setWeekAvailPopup] = useState<{
    weekInfo: WeekInfo;
    people: Array<{ name: string; isExternal: boolean; freeDays: number; busyDays: number; totalBizDays: number }>;
  } | null>(null);

  const handleWeekLabelClick = useCallback((weekInfo: WeekInfo) => {
    // 해당 주차 영업일 목록
    const weekBizDates: string[] = [];
    const start = new Date(weekInfo.startDate);
    const end = new Date(weekInfo.endDate);
    let cur = new Date(start);
    while (cur <= end) {
      const wy = cur.getFullYear();
      const wm = cur.getMonth() + 1;
      const wd = cur.getDate();
      if (!isNonWorkday(wy, wm, wd)) {
        weekBizDates.push(formatDateStr(wy, wm, wd));
      }
      cur.setDate(cur.getDate() + 1);
    }
    const weekBizCount = weekBizDates.length;

    // DB 등록 인력(people) 전체 기준: 이 주차 영업일 중 빈 날 카운트 (외부인력 제외, 해당 사업 투입 여부 무관)
    const availPeople = people
      .map((p) => {
        const busyDates = personAllDates.get(p.id) || new Set<string>();
        const freeDays = weekBizDates.filter(d => !busyDates.has(d)).length;
        const busyDays = weekBizDates.filter(d => busyDates.has(d)).length;
        return { name: p.person_name, isExternal: false, freeDays, busyDays, totalBizDays: weekBizCount };
      })
      .filter(v => v.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays);

    setWeekAvailPopup({ weekInfo, people: availPeople });
  }, [people, personAllDates, weekInfos]);

  const maxBadgesInWeek = useMemo(() => {
    let max = 0;
    for (const w of weekInfos) {
      if (w.badges.length > max) max = w.badges.length;
    }
    return Math.max(max, 1);
  }, [weekInfos]);

  const badgeColW = Math.max(160, maxBadgesInWeek * 26);
  const dateColW = 32;
  const dowColW = 26;
  const stickyLeftForDate = badgeColW;
  const stickyLeftForDow = badgeColW + dateColW;

  // Compute explicit table min-width to prevent column compression
  const totalPersonCols = allPeople.reduce((sum, p) => sum + (personSubCols.get(p.id) || MIN_SUB_COLS), 0);
  const tableMinWidth = badgeColW + dateColW + dowColW + totalPersonCols * colWidth;

  // Staffing IDs belonging to the hovered badge phase
  const hoveredStaffingIds = useMemo(() => {
    if (!hoveredBadgePhaseId) return new Set<number>();
    const ids = new Set<number>();
    for (const s of localStaffing) {
      if (s.phase_id === hoveredBadgePhaseId) ids.add(s.id);
    }
    return ids;
  }, [hoveredBadgePhaseId, localStaffing]);

  const handlePersonHeaderClick = (personId: number | string) => {
    setFocusedPersonId((prev) => (prev === personId ? null : personId));
  };

  const toggleProjectCheck = (projectId: number) => {
    // 체크박스 변경 시 frozenPeopleOrder 초기화 → 다음 렌더에서 새로 소팅 계산
    setFrozenPeopleOrder(null);
    setCheckedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* viewer 읽기 전용 배너 */}
      {isViewer && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span>조회 전용 계정입니다. 일정 수정·추가는 불가합니다.</span>
        </div>
      )}
      {/* 동접자 잠금 배너 */}
      <PresenceWarningBanner users={presenceUsers} currentUserId={presenceCurrentUserId} />

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-[90px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-[70px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m} value={String(m)}>{m}월</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setYear(now.getFullYear());
              setMonth(now.getMonth() + 1);
            }}
            className="text-xs font-semibold"
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            오늘
          </Button>
          <span className="text-xs text-muted-foreground ml-2">({daysInMonth}일)</span>
          {(loadingEntries || bulkFilling) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {bulkFilling && <span className="text-[10px] text-blue-600 font-medium">일괄 처리중...</span>}
          {scheduleIsLocked && <Lock className="h-4 w-4 text-amber-500" title="다른 사용자가 열람 중 — 잠금" />}
          <PresenceBadges users={presenceUsers} currentUserId={presenceCurrentUserId} />
          <div className="flex items-center gap-1 ml-3 border-l pl-3 border-gray-300">
            <label className="text-[10px] text-muted-foreground whitespace-nowrap">열폭</label>
            <input
              type="number"
              min={16}
              max={200}
              value={colWidthInput}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 16 && v <= 200) {
                  setColWidthInput(v);
                  if (colWidthDebounceRef.current) clearTimeout(colWidthDebounceRef.current);
                  colWidthDebounceRef.current = setTimeout(() => setColWidth(v), 300);
                }
              }}
              className="w-[48px] h-6 px-1 text-[10px] text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="열 너비 (16~200px)"
            />
            <label className="text-[10px] text-muted-foreground whitespace-nowrap ml-1">행높이</label>
            <input
              type="number"
              min={16}
              max={100}
              value={rowHeightInput}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 16 && v <= 100) {
                  setRowHeightInput(v);
                  if (rowHeightDebounceRef.current) clearTimeout(rowHeightDebounceRef.current);
                  rowHeightDebounceRef.current = setTimeout(() => setRowHeight(v), 300);
                }
              }}
              className="w-[48px] h-6 px-1 text-[10px] text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="행 높이 (16~100px)"
            />
            <span className="text-[9px] text-muted-foreground">px</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[10px] text-muted-foreground">
            💡 셀 클릭 → 선택/해제 | 인력명 클릭 → 열 포커싱 | 번호 우클릭 → 일괄 채우기/해제 | 배지 우클릭 → 단계별 이동 | 체크박스 → 사업별 정렬
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRebuildCalendar}
            disabled={rebuildingCalendar || bulkFilling}
            className="text-[10px] h-6 px-2 border-orange-300 text-orange-700 hover:bg-orange-50 whitespace-nowrap"
            title="공휴일/주말에 잘못 생성된 일정을 삭제하고 영업일 기준으로 재생성합니다"
          >
            {rebuildingCalendar ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : '🗓️'}
            공휴일 일정 재생성
          </Button>
        </div>
      </div>

      {/* Aggregation */}
      <div className="hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 왼쪽: 일정 없는 인력 */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <span className="text-red-500">⚠️</span> 일정 없는 인력 ({year}년 {month}월 기준)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {noSchedulePeople.length === 0 ? (
              <span className="text-xs text-muted-foreground">이달 모든 배정 인력에 일정이 입력되었습니다 ✅</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {noSchedulePeople.map((p) => (
                  <span
                    key={p.name}
                    className="text-xs px-2 py-1 rounded flex items-center gap-1 border bg-red-50 border-red-200 text-red-800"
                    title={`투입 가능: ${p.freeDays}일 / 영업일: ${p.totalBizDays}일 (이달 일정 없음)`}
                  >
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-[10px] font-bold">{p.freeDays}/{p.totalBizDays}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 오른쪽: 투입 가능 공수 (일정은 있지만 빈 영업일 있음) */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <span className="text-green-600">✅</span> 투입 가능 공수 ({year}년 {month}월 기준)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {partialSchedulePeople.length === 0 ? (
              <span className="text-xs text-muted-foreground">여유 일정이 있는 인력이 없습니다</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {partialSchedulePeople.map((p) => (
                  <span
                    key={p.name}
                    className="text-xs px-2 py-1 rounded flex items-center gap-1 bg-green-50 border border-green-200"
                    title={`투입 가능: ${p.freeDays}일 / 영업일: ${p.totalBizDays}일 (일정 있는 날: ${p.busyDays}일)`}
                  >
                    <span className="font-medium text-gray-800">{p.name}</span>
                    <span className="text-green-700 font-bold">{p.freeDays}</span>
                    <span className="text-gray-400 text-[10px]">/{p.totalBizDays}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Grid - use full width */}
      <Card className="overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            인력별 일정 ({year}년 {month}월)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {allPeople.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-30" />
              배정된 인력이 없습니다.
            </div>
          ) : (
            <div className="overflow-auto max-h-[75vh] relative" style={{ WebkitOverflowScrolling: 'touch' }} onScroll={() => setBadgeContextMenu(null)}>
              <table className="text-xs" style={{ tableLayout: 'fixed', minWidth: tableMinWidth, borderCollapse: 'separate', borderSpacing: 0 }}>
                <colgroup>
                  <col style={{ width: badgeColW }} />
                  <col style={{ width: dateColW }} />
                  <col style={{ width: dowColW }} />
                  {allPeople.map((p, pi) => {
                    const cols = personSubCols.get(p.id) || MIN_SUB_COLS;
                    return Array.from({ length: cols }).map((_, si) => (
                      <col
                        key={`${p.id}-${si}`}
                        style={{ width: colWidth }}
                      />
                    ));
                  })}
                </colgroup>
                <thead className="sticky top-0" style={{ zIndex: 40 }}>
                  <tr className="bg-slate-100">
                    <th
                      className="sticky left-0 bg-slate-100 border-r-2 border-r-slate-400 border border-gray-300 text-center text-[10px] font-semibold py-1.5" 
                      rowSpan={2}
                      style={{ width: badgeColW, maxWidth: badgeColW, overflow: 'hidden', zIndex: 60 }}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>📌 주간별 사업</span>
                        {/* 인력 표시 범위 토글 */}
                        <div className="flex items-center rounded overflow-hidden border border-slate-300 text-[8px]">
                          <button
                            type="button"
                            onClick={() => { setShowAllPeople(false); setFrozenPeopleOrder(null); }}
                            className={`px-1.5 py-0.5 transition-colors ${!showAllPeople ? 'bg-blue-500 text-white font-bold' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            title="이번 달 배정 인력만 표시 (빠름)"
                          >
                            이번달
                          </button>
                          <button
                            type="button"
                            onClick={() => { setShowAllPeople(true); setFrozenPeopleOrder(null); }}
                            className={`px-1.5 py-0.5 transition-colors ${showAllPeople ? 'bg-slate-600 text-white font-bold' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                            title="전체 인력 표시 (느림)"
                          >
                            전체
                          </button>
                        </div>
                      </div>
                    </th>
                    <th
                      className="sticky bg-slate-100 border border-gray-300 text-center text-[10px] font-semibold py-1.5"
                      rowSpan={2}
                      style={{ left: stickyLeftForDate, width: dateColW, zIndex: 60 }}
                    >
                      일
                    </th>
                    <th
                      className="sticky bg-slate-100 border-r-2 border-r-slate-400 border border-gray-300 text-center text-[10px] font-semibold py-1.5"
                      rowSpan={2}
                      style={{ left: stickyLeftForDow, width: dowColW, zIndex: 60 }}
                    >
                      요일
                    </th>
                    {allPeople.map((p, pi) => {
                      const pStaffings = personStaffings.get(p.id) || [];
                      const totalMd = pStaffings.reduce((sum, ps) => sum + (ps.staffing.md || 0), 0);
                      const usedMd = pStaffings.reduce((sum, ps) => sum + (staffingDayCount.get(ps.staffing.id) || 0), 0);
                      const isFocused = focusedPersonId === p.id;
                      const isInChecked = checkedProjectPeople.has(p.id);
                      const isLastPerson = pi === allPeople.length - 1;
                      const cols = personSubCols.get(p.id) || MIN_SUB_COLS;
                      // Find boundary between checked and unchecked people
                      const isLastCheckedPerson = isInChecked && (pi === allPeople.length - 1 || !checkedProjectPeople.has(allPeople[pi + 1]?.id));
                      return (
                        <th
                          key={String(p.id)}
                          colSpan={cols}
                          className={`text-center font-semibold text-[10px] py-1 cursor-pointer select-none transition-colors ${
                            isFocused
                              ? 'bg-yellow-100 ring-2 ring-yellow-400 ring-inset'
                              : isInChecked
                              ? 'bg-indigo-100'
                              : p.isExternal
                              ? 'bg-amber-50'
                              : 'bg-slate-100'
                          }`}
                          style={{
                            width: cols * colWidth,
                            borderLeft: '2px solid #64748b',
                            borderRight: isLastCheckedPerson && !isLastPerson ? '3px solid #6366f1' : isLastPerson ? '1px solid #d1d5db' : '1px solid #cbd5e1',
                            borderTop: '1px solid #d1d5db',
                            borderBottom: isInChecked ? '2px solid #818cf8' : '1px solid #d1d5db',
                          }}
                          title={`${p.name} ${p.isExternal ? '(외부)' : `(${p.grade || '-'})`}\n이번달 투입: ${usedMd}MD\n전체기간 투입: ${pStaffings.reduce((sum, ps) => sum + (totalMdCount.get(ps.staffing.id) || 0), 0)}/${totalMd}MD\n클릭하여 열 포커싱${isInChecked ? '\n🔵 체크된 사업 인력' : ''}`}
                          onClick={() => handlePersonHeaderClick(p.id)}
                        >
                          <div className="leading-tight">
                            {isInChecked && <span className="text-indigo-500 text-[7px] mr-0.5">●</span>}
                            {p.name}
                            {p.isExternal && <span className="text-amber-500 text-[7px] ml-0.5">(외)</span>}
                          </div>
                          <div className="font-normal text-[8px] text-muted-foreground">
                            {p.isExternal ? '외부' : (p.grade || '')} {totalMd > 0 ? `(${usedMd}/${totalMd})` : ''}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                  <tr className="bg-slate-50">
                    {allPeople.map((p, pi) => {
                      const cols = personSubCols.get(p.id) || MIN_SUB_COLS;
                      return Array.from({ length: cols }).map((_, si) => {
                        const isFocused = focusedPersonId === p.id;
                        const isInChecked = checkedProjectPeople.has(p.id);
                        const isFirstSub = si === 0;
                        const isLastPerson = pi === allPeople.length - 1;
                        const isLastSub = si === cols - 1;
                        const isLastCheckedPerson = isInChecked && (pi === allPeople.length - 1 || !checkedProjectPeople.has(allPeople[pi + 1]?.id));
                        return (
                          <th
                            key={`${p.id}-sub-${si}`}
                            className={`text-center text-[7px] text-gray-400 font-normal py-0.5 cursor-context-menu ${
                              isFocused ? 'bg-yellow-50' : isInChecked ? 'bg-indigo-50' : 'bg-slate-50'
                            }`}
                            style={{
                              width: colWidth,
                              borderLeft: isFirstSub ? '2px solid #64748b' : '1px solid #e5e7eb',
                              borderRight: isLastSub && isLastCheckedPerson && !isLastPerson ? '3px solid #6366f1' : isLastSub && isLastPerson ? '1px solid #d1d5db' : isLastSub ? '1px solid #cbd5e1' : '1px solid #e5e7eb',
                              borderBottom: '1px solid #d1d5db',
                            }}
                            title="우클릭: 일괄 채우기/해제"
                            onContextMenu={(e) => handleSubColContextMenu(e, p.id, si)}
                          >
                            {si + 1}
                          </th>
                        );
                      });
                    })}
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const weekInfo = dayToWeek.get(d);
                    const isFirstDayOfWeek = weekInfo ? d === weekInfo.startDay : false;
                    const isWeekStart = weekBoundaries.has(d);
                    return (
                      <DayRow
                        key={d}
                        d={d}
                        year={year}
                        month={month}
                        todayStr={todayStr}
                        weekInfo={weekInfo}
                        isFirstDayOfWeek={isFirstDayOfWeek}
                        isWeekStart={isWeekStart}
                        allPeople={allPeople}
                        personSubCols={personSubCols}
                        cellDataCache={cellDataCache}
                        togglingCell={togglingCell}
                        focusedPersonId={focusedPersonId}
                        checkedProjectPeople={checkedProjectPeople}
                        hoveredStaffingIds={hoveredStaffingIds}
                        hoveredBadgePhaseId={hoveredBadgePhaseId}
                        hatMap={hatMap}
                        changeMap={changeMap}
                        staffingTooltipInfo={staffingTooltipInfo}
                        colWidth={colWidth}
                        rowHeight={rowHeight}
                        badgeColW={badgeColW}
                        stickyLeftForDate={stickyLeftForDate}
                        stickyLeftForDow={stickyLeftForDow}
                        dateColW={dateColW}
                        dowColW={dowColW}
                        checkedProjectIds={checkedProjectIds}
                        handleCellClick={handleCellClick}
                        handleSubColContextMenu={handleSubColContextMenu}
                        toggleProjectCheck={toggleProjectCheck}
                        handleBadgeClick={handleBadgeClick}
                        handleBadgeContextMenu={handleBadgeContextMenu}
                        setHoveredBadgePhaseId={setHoveredBadgePhaseId}
                        handleWeekLabelClick={handleWeekLabelClick}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 주차별 투입 가능 인력 팝업 */}
      {weekAvailPopup && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30"
          onClick={() => setWeekAvailPopup(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[420px] max-w-[95vw] max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50 rounded-t-xl">
              <div>
                <h3 className="text-sm font-bold text-gray-800">
                  🗓 {weekAvailPopup.weekInfo.weekLabel} 투입 가능 인력
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {weekAvailPopup.weekInfo.startDate} ~ {weekAvailPopup.weekInfo.endDate}
                </p>
              </div>
              <button
                onClick={() => setWeekAvailPopup(null)}
                className="p-1.5 hover:bg-gray-200 rounded-lg transition"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <div className="px-5 py-4">
              {weekAvailPopup.people.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="text-2xl mb-2">✅</div>
                  <p className="text-sm font-medium">이 주차에 투입 가능한 인력이 없습니다</p>
                  <p className="text-xs mt-1">모든 배정 인력의 일정이 채워졌습니다</p>
                </div>
              ) : (() => {
                const noSched = weekAvailPopup.people.filter(p => p.busyDays === 0);
                const partSched = weekAvailPopup.people.filter(p => p.busyDays > 0);
                const biz = weekAvailPopup.people[0]?.totalBizDays ?? 0;
                return (
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted-foreground">
                      이 주차 영업일 <strong>{biz}일</strong> 기준 &middot; 투입가능(중복무관) / 영업일
                    </p>
                    {/* 이 주차 일정 아예 없는 인력 */}
                    {noSched.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-red-500 text-sm">⚠️</span>
                          <p className="text-[11px] font-semibold text-red-700">
                            이 주차 일정 없음 ({noSched.length}명)
                          </p>
                        </div>
                        <div className="divide-y divide-red-50 rounded-lg border border-red-100 overflow-hidden">
                          {noSched.map((p, idx) => (
                            <div
                              key={p.name}
                              className="flex items-center justify-between px-4 py-2.5 bg-red-50/40 hover:bg-red-50 transition"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground w-5">{idx + 1}</span>
                                <span className="text-sm font-semibold text-red-800">{p.name}</span>
                              </div>
                              <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full border border-red-200">
                                {p.freeDays}/{p.totalBizDays}일 가능
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 이 주차 일정 일부만 있는 인력 */}
                    {partSched.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-green-600 text-sm">✅</span>
                          <p className="text-[11px] font-semibold text-green-700">
                            일부 투입 가능 ({partSched.length}명)
                          </p>
                        </div>
                        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 overflow-hidden">
                          {partSched.map((p, idx) => (
                            <div
                              key={p.name}
                              className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground w-5">{idx + 1}</span>
                                <span className="text-sm font-medium text-gray-800">{p.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground">
                                  일정 있는 날: <strong className="text-blue-600">{p.busyDays}일</strong>
                                </span>
                                <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                                  {p.freeDays}/{p.totalBizDays}일 가능
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <EditModal
          project={editTarget.project}
          phase={editTarget.phase}
          phaseStaffing={localStaffing.filter((s) => s.phase_id === editTarget.phase.id)}
          allPeople={people}
          allStaffing={localStaffing}
          allPhases={localPhases}
          personDatesByProject={personDatesByProject}
          hatMap={hatMap}
          onHatSave={handleHatSave}
          onHatDelete={handleHatDelete}
          readOnly={isViewer}
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
        />
      )}

      {/* MD Expand Dialog */}
      <MdExpandDialog
        open={mdExpandDialog.open}
        oldBizDays={mdExpandDialog.oldBizDays}
        newBizDays={mdExpandDialog.newBizDays}
        staffingList={mdExpandDialog.staffingList}
        onExpandAll={() => mdExpandDialog.resolve?.(true)}
        onKeep={() => mdExpandDialog.resolve?.(false)}
        onCancel={() => mdExpandDialog.resolve?.(null)}
      />

      {/* Badge Context Menu: Project Phase Navigation */}
      {badgeContextMenu && (() => {
        const projectPhases = getProjectPhases(badgeContextMenu.projectId);
        const color = badgeContextMenu.color;
        return (
          <div
            ref={badgeContextMenuRef}
            className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[240px] max-w-[340px]"
            style={{
              left: Math.min(badgeContextMenu.x, window.innerWidth - 360),
              top: Math.min(badgeContextMenu.y, window.innerHeight - 300),
            }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 border-b flex items-center gap-2"
              style={{ backgroundColor: color.bg }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: color.border }}
              />
              <span className="text-[11px] font-bold break-words leading-snug" style={{ color: color.text }}>
                📋 {badgeContextMenu.projectName}
              </span>
              <span className="text-[9px] text-muted-foreground ml-auto">
                {projectPhases.length}개 단계
              </span>
            </div>
            {/* Phase list */}
            <div className="max-h-[250px] overflow-y-auto">
              {projectPhases.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground italic">단계 없음</div>
              ) : (
                projectPhases.map((ph) => {
                  const isCurrentPhase = phaseOverlapsMonth(ph, year, month);
                  const startMonth = ph.start_date ? `${ph.start_date.slice(0, 7)}` : '?';
                  const endMonth = ph.end_date ? `${ph.end_date.slice(0, 7)}` : '?';
                  return (
                    <button
                      key={ph.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 transition-colors ${
                        isCurrentPhase ? 'bg-blue-50/50' : ''
                      }`}
                      onClick={() => navigateToPhaseMonth(ph)}
                      title={`${ph.phase_name}\n${ph.start_date || '?'} ~ ${ph.end_date || '?'}\n클릭하여 해당 월로 이동`}
                    >
                      <div
                        className="w-1.5 h-8 rounded-full flex-shrink-0"
                        style={{ backgroundColor: isCurrentPhase ? color.border : color.bg }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`font-semibold truncate ${isCurrentPhase ? 'text-blue-700' : 'text-gray-800'}`}>
                            {ph.phase_name}
                          </span>
                          {isCurrentPhase && (
                            <span className="text-[7px] bg-blue-500 text-white px-1 rounded flex-shrink-0">현재</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          📅 {startMonth} ~ {endMonth}
                          {ph.start_date && ph.end_date && (
                            <span className="ml-1 text-[9px]">
                              ({ph.start_date} ~ {ph.end_date})
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
            {/* Footer */}
            <div className="border-t px-3 py-1.5">
              <span className="text-[9px] text-muted-foreground">클릭하여 해당 월로 이동</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}