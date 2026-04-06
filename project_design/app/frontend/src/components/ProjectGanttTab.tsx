import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, GanttChart, X, Loader2, HardHat, ArrowLeftRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { client, StaffingChangeRecord } from '@/lib/api';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { isNonWorkday, getHolidayName, countBusinessDays as calcBizDaysHoliday } from '@/lib/holidays';


/* ───────── Rainbow animation CSS (won projects) ───────── */
const wonGanttStyle = `
@keyframes ganttRainbow {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes ganttShimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
.won-gantt-bar {
  background: linear-gradient(90deg,
    #ff6b6b, #ff9f43, #feca57,
    #48dbfb, #ff6b81, #a29bfe, #6c5ce7,
    #fd79a8, #ff6b6b) !important;
  background-size: 300% 300% !important;
  animation: ganttRainbow 3s ease infinite !important;
  position: relative;
  overflow: hidden;
}
.won-gantt-bar::after {
  content: '';
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
  animation: ganttShimmer 2s ease-in-out infinite;
  pointer-events: none;
}
`;

/* ───────── Types ───────── */
interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  is_won?: boolean;
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

interface ProjectGanttTabProps {
  projects: Project[];
  phases: Phase[];
  staffing: StaffingRow[];
  people: People[];
  onRefresh?: () => void;
}

/* ───────── Color Palette ───────── */
const PROJECT_COLORS = [
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', cell: '#bfdbfe' },
  { bg: '#d1fae5', border: '#10b981', text: '#065f46', cell: '#a7f3d0' },
  { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', cell: '#fde68a' },
  { bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6', cell: '#c4b5fd' },
  { bg: '#ffe4e6', border: '#f43f5e', text: '#9f1239', cell: '#fecdd3' },
  { bg: '#cffafe', border: '#06b6d4', text: '#155e75', cell: '#a5f3fc' },
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412', cell: '#fed7aa' },
  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', cell: '#c7d2fe' },
];

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
function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addMonths(year: number, month: number, count: number): { year: number; month: number } {
  let y = year;
  let m = month + count;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return { year: y, month: m };
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay();
  return dow === 0 || dow === 6;
}

function isNonWork(year: number, month: number, day: number): boolean {
  return isNonWorkday(year, month, day);
}

/* ───────── Column types ───────── */
type ScaleMode = 'day' | 'week';

interface DayColumn {
  type: 'day';
  year: number;
  month: number;
  day: number;
  dateStr: string;
  label: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isToday: boolean;
  monthLabel?: string;
}

interface WeekColumn {
  type: 'week';
  year: number;
  month: number;
  weekIdx: number;
  startDate: string;
  endDate: string;
  label: string;
  isCurrentWeek: boolean;
  monthLabel?: string;
}

type GanttColumn = DayColumn | WeekColumn;

/* ───────── MD Expand Dialog ───────── */
interface MdExpandDialogProps {
  open: boolean;
  oldBizDays: number;
  newBizDays: number;
  staffingList: Array<{ person_name: string; current_md: number }>;
  onExpandAll: () => void;
  onKeep: () => void;
  onCancel: () => void;
}

function MdExpandDialog({ open, oldBizDays, newBizDays, staffingList, onExpandAll, onKeep, onCancel }: MdExpandDialogProps) {
  const addedDays = newBizDays - oldBizDays;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">📅 기간 확장 - MD 처리 선택</DialogTitle>
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
          <p className="text-sm text-gray-600">단계에 배정된 <strong>{staffingList.length}명</strong>의 MD를 어떻게 처리할까요?</p>
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
          <Button variant="outline" size="sm" onClick={onCancel} className="w-full sm:w-auto">취소</Button>
          <Button variant="outline" size="sm" onClick={onKeep} className="w-full sm:w-auto border-amber-300 text-amber-700 hover:bg-amber-50">기존 MD 유지</Button>
          <Button size="sm" onClick={onExpandAll} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white">MD 자동 확장 (+{addedDays}일)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────── StaffingPersonChange (for EditModal) ───────── */
interface StaffingPersonChange {
  staffingId: number;
  newPersonId: number | null;
  newPersonNameText: string;
  newMd?: number | null;
  deleteStaffing?: boolean;
}

/* ── helper: 두 날짜 범위 겹침 ── */
function datesOverlap(s1?: string, e1?: string, s2?: string, e2?: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return false;
  return s1 <= e2 && s2 <= e1;
}
function calcBizDays(startStr: string, endStr: string): number {
  return calcBizDaysHoliday(startStr, endStr);
}

/* ───────── PersonCombobox ───────── */
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
  partialAvailMap?: Map<number, number>; // personId → 투입가능일수 (없으면 전체가능)
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
    const aAvail = partialAvailMap?.get(a.id); // undefined=전체가능, N>0=일부가능, 0=불가
    const bAvail = partialAvailMap?.get(b.id);
    const aRank = aAvail === undefined ? 0 : aAvail > 0 ? 1 : 2;
    const bRank = bAvail === undefined ? 0 : bAvail > 0 ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return a.person_name.localeCompare(b.person_name, 'ko');
  });
  const fullAvailList = filtered.filter(p => partialAvailMap === undefined || !partialAvailMap.has(p.id));
  const partialList   = filtered.filter(p => partialAvailMap?.has(p.id) && (partialAvailMap.get(p.id) ?? 0) > 0);
  const unavailList   = filtered.filter(p => partialAvailMap?.has(p.id) && partialAvailMap.get(p.id) === 0);

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
            {/* ⚠️ 일부 투입 가능 섹셔 */}
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

/* ───────── EditModal ───────── */
function EditModal({
  project,
  phase,
  phaseStaffing,
  allPeople,
  allStaffing,
  allPhases,
  personDatesByProject,
  hatMap,
  onHatSave,
  onHatDelete,
  onClose,
  onSave,
  readOnly = false,
}: {
  project: Project;
  phase: Phase;
  phaseStaffing: StaffingRow[];
  allPeople: People[];
  allStaffing: StaffingRow[];
  allPhases: Phase[];
  personDatesByProject: Map<number, Map<number, Set<string>>>;
  hatMap: Map<number, HatRecord>;
  onHatSave: (staffingId: number, actualName: string, actualPersonId: number | null) => Promise<void>;
  onHatDelete: (staffingId: number) => Promise<void>;
  onClose: () => void;
  onSave: (projectUpdates: Partial<Project>, phaseUpdates: Partial<Phase>, staffingChanges?: StaffingPersonChange[]) => void;
  readOnly?: boolean;
}) {
  // 🎩 모자 인라인 편집 state
  const [hatEditId, setHatEditId] = useState<number | null>(null);

  // 🔁 저장 전 인력변경 사유 입력 다이얼로그
  const [reasonDialog, setReasonDialog] = useState<{
    open: boolean;
    reason: string;
    pendingPersonChanges: { staffingId: number; originalPersonId: number | null; originalPersonName: string; newPersonId: number | null; newPersonName: string }[];
    pendingStaffingChanges: StaffingPersonChange[];
    pendingProjectUpdates: Partial<Project>;
    pendingPhaseUpdates: Partial<Phase>;
  } | null>(null);

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
  const [personEdits, setPersonEdits] = useState<Map<number, { personId: number | null; personNameText: string }>>(new Map());
  const [mdEdits, setMdEdits] = useState<Map<number, number | null>>(new Map());
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

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
    setPersonEdits((prev) => { const n = new Map(prev); n.set(staffingId, { personId, personNameText }); return n; });
  };

  // ── 인력별 투입가능일수 계산 (phase 영업일 중 타사업 미투입 날짜 수) ──
  const partialAvailMap = useMemo(() => {
    const phaseStart = startDate || phase.start_date;
    const phaseEnd = endDate || phase.end_date;
    if (!phaseStart || !phaseEnd) return new Map<number, number>();

    // phase 기간 내 영업일 날짜 Set 생성 (주말+공휴일 제외)
    const phaseBizDates = new Set<string>();
    let cur = new Date(phaseStart + 'T00:00:00');
    const endD = new Date(phaseEnd + 'T00:00:00');
    while (cur <= endD) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      const d = cur.getDate();
      if (!isNonWorkday(y, m, d)) {
        phaseBizDates.add(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
      }
      cur.setDate(cur.getDate() + 1);
    }
    const totalBizDays = phaseBizDates.size;
    if (totalBizDays === 0) return new Map<number, number>();

    // 각 person별로 타사업 투입 날짜와 phase 영업일의 교집합(겹치는 날) 계산
    const overlapMap = new Map<number, Set<string>>();
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
        const clamped = businessDays !== null ? Math.min(num, businessDays) : num;
        setMdEdits((prev) => { const n = new Map(prev); n.set(staffingId, clamped); return n; });
      }
    }
  };

  const handleSave = () => {
    const staffingChanges: StaffingPersonChange[] = [];
    deletedIds.forEach((sid) => {
      staffingChanges.push({ staffingId: sid, newPersonId: null, newPersonNameText: '', deleteStaffing: true });
    });
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
    // status는 프로젝트 상세에서만 변경 — 여기서는 제외
    const projectUpdates = { project_name: projectName, organization };
    const phaseUpdates = { phase_name: phaseName, start_date: startDate || undefined, end_date: endDate || undefined };

    // 제안 사업은 인력변경 사유 다이얼로그 스킵 — 바로 저장
    if (projectStatus === '제안') {
      onSave(projectUpdates, phaseUpdates, staffingChanges.length > 0 ? staffingChanges : undefined);
      return;
    }

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
        if (origName !== newName && newName.trim()) {
          return { staffingId: c.staffingId, originalPersonId: s.person_id ?? null, originalPersonName: origName, newPersonId: c.newPersonId, newPersonName: newName };
        }
        return null;
      })
      .filter(Boolean) as { staffingId: number; originalPersonId: number | null; originalPersonName: string; newPersonId: number | null; newPersonName: string }[];

    if (personChangedItems.length > 0) {
      setReasonDialog({ open: true, reason: '', pendingPersonChanges: personChangedItems, pendingStaffingChanges: staffingChanges, pendingProjectUpdates: projectUpdates, pendingPhaseUpdates: phaseUpdates });
    } else {
      onSave(projectUpdates, phaseUpdates, staffingChanges.length > 0 ? staffingChanges : undefined);
    }
  };

  const confirmSaveWithReason = async () => {
    if (!reasonDialog) return;
    const { reason, pendingPersonChanges, pendingStaffingChanges, pendingProjectUpdates, pendingPhaseUpdates } = reasonDialog;
    setReasonDialog(null);
    try {
      await Promise.all(pendingPersonChanges.map((ch) =>
        client.staffingChange.create({
          staffing_id: ch.staffingId, project_id: project.id, phase_id: phase.id,
          original_person_id: ch.originalPersonId, original_person_name: ch.originalPersonName,
          new_person_id: ch.newPersonId, new_person_name: ch.newPersonName,
          reason: reason.trim() || undefined,
        })
      ));
    } catch {
      toast.error('변경 이력 저장에 실패했습니다.');
    }
    onSave(pendingProjectUpdates, pendingPhaseUpdates, pendingStaffingChanges.length > 0 ? pendingStaffingChanges : undefined);
  };

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
      <div className="relative bg-white rounded-lg shadow-xl w-[680px] max-w-[95vw] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{readOnly ? '프로젝트/단계/투입인력 조회' : '프로젝트/단계/투입인력 수정'}</h3>
            {readOnly && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border">읽기 전용</span>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">프로젝트 정보</h4>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">사업명</Label><Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-8 text-sm" disabled={readOnly} /></div>
              <div><Label className="text-xs">발주기관</Label><Input value={organization} onChange={(e) => setOrganization(e.target.value)} className="h-8 text-sm" disabled={readOnly} /></div>
            </div>
            <div>
              <Label className="text-xs">상태</Label>
              {/* 상태는 표시만 — 프로젝트 상세에서만 변경 */}
              <div className="flex items-center gap-2 h-8 px-3 rounded-md border bg-gray-50 text-sm">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  projectStatus === '감리' ? 'bg-blue-100 text-blue-700' :
                  projectStatus === '제안' ? 'bg-amber-100 text-amber-700' :
                  projectStatus === '완료' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {projectStatus === '감리' ? '감리 (A)' :
                   projectStatus === '제안' ? '제안 (P)' :
                   projectStatus}
                </span>
                <span className="text-[10px] text-gray-400">· 상태 변경은 프로젝트 상세에서</span>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">단계 정보</h4>
            <div><Label className="text-xs">단계명</Label><Input value={phaseName} onChange={(e) => setPhaseName(e.target.value)} className="h-8 text-sm" disabled={readOnly} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">시작일</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-sm" disabled={readOnly} /></div>
              <div><Label className="text-xs">종료일</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-sm" disabled={readOnly} /></div>
            </div>
            {businessDays !== null && <p className="text-[10px] text-muted-foreground">영업일: {businessDays}일</p>}
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">
              투입인력 ({activeCount}명)
              {!readOnly && deletedIds.size > 0 && <span className="text-red-500 text-[10px] ml-2">({deletedIds.size}명 삭제 예정)</span>}
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
                        const isExt = getCurrentPersonId(s) === '__external__';
                        const currentMd = getCurrentMd(s);
                        return (
                          <div key={s.id} className={`flex items-center gap-2 rounded px-3 py-1.5 border transition-colors ${isDeleted ? 'bg-red-50 border-red-200 opacity-60' : 'bg-gray-50 border-gray-200'}`}>
                            <span className="text-[10px] text-muted-foreground w-[70px] truncate flex-shrink-0" title={s.field}>{s.field}</span>
                            {isDeleted ? (
                              <span className="flex-1 text-xs text-red-500 line-through">{getDisplayPerson(s)}</span>
                            ) : readOnly ? (
                              <span className="flex-1 text-xs text-gray-700 px-1">{getDisplayPerson(s)}</span>
                            ) : (
                              <PersonCombobox
                                value={getCurrentPersonId(s)}
                                displayText={getDisplayPerson(s)}
                                isExternal={isExt}
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
                                <input type="number" min={0} max={businessDays ?? 999} value={currentMd ?? ''} onChange={(e) => handleMdChange(s.id, e.target.value)} className="w-[52px] h-7 px-1.5 text-xs text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="-" />
                              )}
                              <span className="text-[9px] text-muted-foreground">MD</span>
                            </div>
                            {readOnly ? (
                              hatMap.has(s.id) && projectStatus !== '제안' ? (
                                <span className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 flex-shrink-0" title={`🎩 ${hatMap.get(s.id)?.actual_person_name} 대신 투입 중`}>
                                  <HardHat className="h-3 w-3" />
                                  <span className="max-w-[60px] truncate">{hatMap.get(s.id)?.actual_person_name}</span>
                                </span>
                              ) : null
                            ) : isDeleted ? (
                              <button type="button" onClick={() => setDeletedIds((prev) => { const n = new Set(prev); n.delete(s.id); return n; })} className="p-1 text-blue-500 hover:bg-blue-50 rounded flex-shrink-0" title="삭제 취소"><span className="text-[10px]">↩</span></button>
                            ) : (
                              <>
                                {/* 🎩 모자 버튼 — 제안 사업에서는 숨김 */}
                                {projectStatus !== '제안' && (
                                  hatEditId === s.id ? (
                                    <HatPersonCombobox
                                      currentName={hatMap.get(s.id)?.actual_person_name || ''}
                                      allPeople={allPeople}
                                      onChange={(personId, personName) => saveHatInline(s.id, personName, personId)}
                                      onClear={() => saveHatInline(s.id, '', null)}
                                      onCancel={() => setHatEditId(null)}
                                    />
                                  ) : hatMap.has(s.id) ? (
                                    <button type="button" onClick={() => openHatInline(s.id)}
                                      title={`🎩 ${hatMap.get(s.id)?.actual_person_name} 대체 중 — 클릭하여 수정`}
                                      className="flex items-center gap-1 text-[10px] text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 flex-shrink-0 hover:bg-orange-100 transition-colors">
                                      <HardHat className="h-3 w-3 flex-shrink-0" />
                                      <span className="max-w-[60px] truncate">{hatMap.get(s.id)?.actual_person_name}</span>
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => openHatInline(s.id)}
                                      title="모자(대체인력) 씌우기"
                                      className="p-1 rounded flex-shrink-0 transition-colors text-slate-300 hover:text-slate-500 hover:bg-slate-50">
                                      <HardHat className="h-3.5 w-3.5" />
                                    </button>
                                  )
                                )}
                                <button type="button" onClick={() => setDeletedIds((prev) => { const n = new Set(prev); n.add(s.id); return n; })} className="p-1 text-red-400 hover:bg-red-50 hover:text-red-600 rounded flex-shrink-0" title="투입인력 삭제"><X className="h-3 w-3" /></button>
                              </>
                            )}
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
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={confirmSaveWithReason}>저장</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Main Component ───────── */
export default function ProjectGanttTab({ projects, phases, staffing, people, onRefresh }: ProjectGanttTabProps) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [periodMonths, setPeriodMonths] = useState(3); // 3, 6, 12
  const [scale, setScale] = useState<ScaleMode>('week');
  const { isViewer } = useUserRole();
  const [editTarget, setEditTarget] = useState<{ project: Project; phase: Phase } | null>(null);
  const [projectInfoTarget, setProjectInfoTarget] = useState<Project | null>(null);
  const [mdExpandDialog, setMdExpandDialog] = useState<{
    open: boolean;
    resolve: ((expandMd: boolean | null) => void) | null;
    oldBizDays: number;
    newBizDays: number;
    staffingList: Array<{ person_name: string; current_md: number }>;
  }>({ open: false, resolve: null, oldBizDays: 0, newBizDays: 0, staffingList: [] });
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [showA, setShowA] = useState(true);  // 감리(A) 표시
  const [showP, setShowP] = useState(true);  // 제안(P) 표시
  const [localProjects, setLocalProjects] = useState<Project[]>(projects);
  const [localPhases, setLocalPhases] = useState<Phase[]>(phases);
  const [localStaffing, setLocalStaffing] = useState<StaffingRow[]>(staffing);

  // ── 모자(Hat) state ───────────────────────────────────
  const [hatMap, setHatMap] = useState<Map<number, HatRecord>>(new Map());

  useEffect(() => {
    const projectIds = [...new Set(staffing.map((s) => s.project_id))];
    if (projectIds.length === 0) { setHatMap(new Map()); return; }
    Promise.all(
      projectIds.map((pid) =>
        client.apiCall.invoke({ url: `/api/v1/staffing-hat/by-project/${pid}`, method: 'GET' }).catch(() => [])
      )
    ).then((results) => {
      const map = new Map<number, HatRecord>();
      results.flat().forEach((h: HatRecord) => map.set(h.staffing_id, h));
      setHatMap(map);
    });
  }, [staffing]);

  const handleHatSave = useCallback(async (staffingId: number, actualName: string, actualPersonId: number | null) => {
    const res = await client.apiCall.invoke({
      url: '/api/v1/staffing-hat/batch',
      method: 'POST',
      data: [{ staffing_id: staffingId, actual_person_name: actualName, actual_person_id: actualPersonId }],
    });
    const hats: HatRecord[] = res || [];
    setHatMap((prev) => { const next = new Map(prev); hats.forEach((h) => next.set(h.staffing_id, h)); return next; });
  }, []);

  const handleHatDelete = useCallback(async (staffingId: number) => {
    await client.apiCall.invoke({ url: `/api/v1/staffing-hat/by-staffing/${staffingId}`, method: 'DELETE' });
    setHatMap((prev) => { const next = new Map(prev); next.delete(staffingId); return next; });
  }, []);

  useEffect(() => { setLocalProjects(projects); }, [projects]);
  useEffect(() => { setLocalPhases(phases); }, [phases]);
  useEffect(() => { setLocalStaffing(staffing); }, [staffing]);

  // Auto-navigate to earliest phase month
  useEffect(() => {
    if (localPhases.length === 0) return;
    let earliest: Date | null = null;
    localPhases.forEach((ph) => {
      if (ph.start_date) {
        const d = new Date(ph.start_date);
        if (!earliest || d < earliest) earliest = d;
      }
    });
    if (earliest) {
      setViewYear(earliest.getFullYear());
      setViewMonth(earliest.getMonth() + 1);
    }
  }, []);

  const projectColorMap = useMemo(() => {
    const map = new Map<number, typeof PROJECT_COLORS[0]>();
    const uniqueIds = [...new Set(localProjects.map((p) => p.id))];
    uniqueIds.forEach((pid, idx) => {
      map.set(pid, PROJECT_COLORS[idx % PROJECT_COLORS.length]);
    });
    return map;
  }, [localProjects]);

  // ── 인력별 날짜 Set 로드 (실제 엔트리 기반 중복 체크용) ──
  const [personDatesByProject, setPersonDatesByProject] = useState<Map<number, Map<number, Set<string>>>>(new Map());

  useEffect(() => {
    const personIds = people.map((p) => p.id).filter(Boolean);
    if (personIds.length === 0) return;
    (async () => {
      try {
        // 모든 프로젝트의 person 일정 로드 (exclude_project_id 없이 전체)
        const res = await client.apiCall.invoke({
          url: '/api/v1/calendar/entries_by_person_ids',
          method: 'POST',
          data: { person_ids: personIds },
        }) as { person_dates: Record<string, string[]> };
        // staffing → project_id 매핑
        const staffingToProject = new Map<number, number>();
        for (const s of localStaffing) {
          const ph = localPhases.find((p) => p.id === s.phase_id);
          if (ph && s.person_id) staffingToProject.set(s.person_id, ph.project_id);
        }
        // person별 날짜를 project별로 그룹핑
        // 백엔드에서 person_id → [dates] 로 오므로, 여기선 staffing→phase→project 매핑 필요
        // 간단히: 각 person이 배정된 모든 staffing에 대해 project별로 묶기
        const byProject = new Map<number, Map<number, Set<string>>>();
        // staffing 전체에서 person_id → project_id 매핑 구축
        const personProjectDates = new Map<string, { personId: number; projectId: number; dates: string[] }>();
        for (const s of localStaffing) {
          if (!s.person_id) continue;
          const ph = localPhases.find((p) => p.id === s.phase_id);
          if (!ph) continue;
          const key = `${s.person_id}_${ph.project_id}`;
          if (!personProjectDates.has(key)) {
            personProjectDates.set(key, { personId: s.person_id, projectId: ph.project_id, dates: [] });
          }
        }
        // person_dates에서 날짜를 해당 personId의 모든 project에 배분
        for (const [pidStr, dates] of Object.entries(res.person_dates || {})) {
          const personId = Number(pidStr);
          // 이 person이 속한 모든 project에 날짜 배분
          for (const [key, entry] of personProjectDates.entries()) {
            if (entry.personId !== personId) continue;
            if (!byProject.has(entry.projectId)) byProject.set(entry.projectId, new Map());
            const projMap = byProject.get(entry.projectId)!;
            if (!projMap.has(personId)) projMap.set(personId, new Set());
            dates.forEach((d) => projMap.get(personId)!.add(d));
          }
        }
        setPersonDatesByProject(byProject);
      } catch { /* ignore */ }
    })();
  }, [people, localStaffing, localPhases]);

  /* ───────── Generate columns ───────── */
  const columns: GanttColumn[] = useMemo(() => {
    const cols: GanttColumn[] = [];
    let curYear = viewYear;
    let curMonth = viewMonth;

    for (let m = 0; m < periodMonths; m++) {
      const daysInM = getDaysInMonth(curYear, curMonth);

      if (scale === 'day') {
        for (let d = 1; d <= daysInM; d++) {
          const dateStr = formatDateStr(curYear, curMonth, d);
          const we = isWeekend(curYear, curMonth, d);
          const holName = !we ? getHolidayName(dateStr) : null;
          cols.push({
            type: 'day',
            year: curYear,
            month: curMonth,
            day: d,
            dateStr,
            label: String(d),
            isWeekend: we,
            isHoliday: holName !== null,
            holidayName: holName,
            isToday: dateStr === todayStr,
            monthLabel: d === 1 ? `${curYear}.${String(curMonth).padStart(2, '0')}` : undefined,
          });
        }
      } else {
        // Week scale
        let weekStartDay = 1;
        for (let d = 1; d <= daysInM; d++) {
          const dow = new Date(curYear, curMonth - 1, d).getDay();
          const isSat = dow === 6;
          const isLastDay = d === daysInM;

          if (isSat || isLastDay) {
            const startDateStr = formatDateStr(curYear, curMonth, weekStartDay);
            const endDateStr = formatDateStr(curYear, curMonth, d);
            const isCurrent = todayStr >= startDateStr && todayStr <= endDateStr;
            const weekLabel = `${weekStartDay}~${d}`;

            cols.push({
              type: 'week',
              year: curYear,
              month: curMonth,
              weekIdx: cols.filter((c) => c.type === 'week' && c.year === curYear && c.month === curMonth).length,
              startDate: startDateStr,
              endDate: endDateStr,
              label: weekLabel,
              isCurrentWeek: isCurrent,
              monthLabel: weekStartDay === 1 ? `${curYear}.${String(curMonth).padStart(2, '0')}` : undefined,
            });

            weekStartDay = d + 1;
          }
        }
      }

      // Next month
      if (curMonth === 12) { curYear++; curMonth = 1; }
      else { curMonth++; }
    }

    return cols;
  }, [viewYear, viewMonth, periodMonths, scale, todayStr]);

  /* ───────── Month groups for header ───────── */
  const monthGroups = useMemo(() => {
    const groups: { label: string; count: number }[] = [];
    let currentLabel = '';
    for (const col of columns) {
      const label = `${col.year}.${String(col.month).padStart(2, '0')}`;
      if (label !== currentLabel) {
        groups.push({ label, count: 1 });
        currentLabel = label;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [columns]);

  /* ───────── Project rows ───────── */
  const projectRows = useMemo(() => {
    const rows: { project: Project; phases: Phase[] }[] = [];
    const projectMap = new Map<number, Project>();
    localProjects.forEach((p) => projectMap.set(p.id, p));

    const projectIdsWithPhases = new Set<number>();
    localPhases.forEach((ph) => projectIdsWithPhases.add(ph.project_id));
    const allProjectIds = new Set([...projectIdsWithPhases, ...localProjects.map((p) => p.id)]);

    for (const pid of allProjectIds) {
      const proj = projectMap.get(pid);
      if (!proj) continue;
      // 체크박스 필터: 감리(A) / 제안(P)
      const isA = proj.status !== '제안';
      const isP = proj.status === '제안';
      if (isA && !showA) continue;
      if (isP && !showP) continue;
      const projPhases = localPhases
        .filter((ph) => ph.project_id === pid)
        .sort((a, b) => a.sort_order - b.sort_order);
      rows.push({ project: proj, phases: projPhases });
    }

    // 감리(A) 먼저, 그 다음 제안(P) — 각 그룹 내부는 이름 오름차순
    rows.sort((a, b) => {
      const aIsP = a.project.status === '제안' ? 1 : 0;
      const bIsP = b.project.status === '제안' ? 1 : 0;
      if (aIsP !== bIsP) return aIsP - bIsP;
      return a.project.project_name.localeCompare(b.project.project_name);
    });
    return rows;
  }, [localProjects, localPhases, showA, showP]);

  /* ───────── Overlap check ───────── */
  const phaseOverlapsColumn = (ph: Phase, col: GanttColumn): boolean => {
    const start = ph.start_date || '2000-01-01';
    const end = ph.end_date || '2099-12-31';
    if (col.type === 'day') {
      return start <= col.dateStr && end >= col.dateStr;
    } else {
      return start <= col.endDate && end >= col.startDate;
    }
  };

  /* ───────── Staffing summary ───────── */
  const getPhaseStaffingSummary = (phaseId: number): string => {
    const phaseStaff = localStaffing.filter((s) => s.phase_id === phaseId);
    if (phaseStaff.length === 0) return '';
    const names = phaseStaff.map((s) => {
      if (s.person_id) {
        const p = people.find((pp) => pp.id === s.person_id);
        return p?.person_name || s.person_name_text || '미배정';
      }
      return s.person_name_text || '미배정';
    });
    return names.join(', ');
  };

  /* ───────── Idle person popup state ───────── */
  const [idlePopover, setIdlePopover] = useState<{
    colIdx: number;
    people: People[];
    availDays: number;      // 해당 일/주의 영업일 수
    colLabel: string;       // ex) "4/7" or "10/1주"
    anchorRect: DOMRect | null;
    search: string;
  } | null>(null);

  /* ───────── Idle row data: per-column { people, availDays } ───────── */
  const idleRowData = useMemo(() => {
    return columns.map((col) => {
      // 일 뷰: 공휴일/주말이면 빈 배열 반환
      if (col.type === 'day') {
        const dayC = col as DayColumn;
        if (dayC.isWeekend || dayC.isHoliday) return { people: [] as People[], availDays: 0 };
      }
      const busyPersonIds = new Set<number>();
      for (const s of localStaffing) {
        if (!s.person_id) continue;
        const ph = localPhases.find((p) => p.id === s.phase_id);
        if (!ph) continue;
        const phStart = ph.start_date || '2000-01-01';
        const phEnd = ph.end_date || '2099-12-31';
        let overlaps = false;
        if (col.type === 'day') {
          overlaps = phStart <= col.dateStr && phEnd >= col.dateStr;
        } else {
          overlaps = phStart <= (col as WeekColumn).endDate && phEnd >= (col as WeekColumn).startDate;
        }
        if (overlaps) busyPersonIds.add(s.person_id);
      }
      // 가나다 정렬
      const idle = people
        .filter((p) => !busyPersonIds.has(p.id))
        .sort((a, b) => a.person_name.localeCompare(b.person_name, 'ko'));
      // 영업일 수 계산
      let availDays = 1;
      if (col.type === 'week') {
        const wc = col as WeekColumn;
        availDays = calcBizDaysHoliday(wc.startDate, wc.endDate);
      }
      return { people: idle, availDays };
    });
  }, [columns, localStaffing, localPhases, people]);

  /* ───────── Overlap person popup state ───────── */
  interface OverlapDetail {
    personId: number;
    personName: string;
    grade?: string;
    team?: string;
    overlapDays: number;        // 해당 기간 내 중복 영업일 수
    assignments: {              // 배정된 단계 목록
      projectId: number;
      projectName: string;
      phaseId: number;
      phaseName: string;
      field: string;
      phaseStart: string;
      phaseEnd: string;
    }[];
  }

  const [overlapPopover, setOverlapPopover] = useState<{
    colIdx: number;
    items: OverlapDetail[];
    colLabel: string;
    periodDays: number;
    anchorRect: DOMRect | null;
    search: string;
    expanded: number | null;   // 펼친 personId
  } | null>(null);

  /* ───────── Overlap row data: per-column list of people assigned to 2+ phases ───────── */
  const overlapRowData = useMemo(() => {
    return columns.map((col) => {
      if (col.type === 'day') {
        const dc = col as DayColumn;
        if (dc.isWeekend || dc.isHoliday) return { items: [] as OverlapDetail[], periodDays: 0 };
      }

      // 컬럼 기간 정의
      const colStart = col.type === 'day' ? col.dateStr : (col as WeekColumn).startDate;
      const colEnd   = col.type === 'day' ? col.dateStr : (col as WeekColumn).endDate;
      const periodDays = col.type === 'week' ? calcBizDaysHoliday(colStart, colEnd) : 1;

      // person_id → 겹치는 staffing 목록 수집
      const personAssignments = new Map<number, {
        projectId: number; projectName: string;
        phaseId: number; phaseName: string;
        field: string; phaseStart: string; phaseEnd: string;
      }[]>();

      for (const s of localStaffing) {
        if (!s.person_id) continue;
        const ph = localPhases.find((p) => p.id === s.phase_id);
        if (!ph) continue;
        const phStart = ph.start_date || '2000-01-01';
        const phEnd   = ph.end_date   || '2099-12-31';
        const overlaps = phStart <= colEnd && phEnd >= colStart;
        if (!overlaps) continue;

        const proj = localProjects.find((p) => p.id === s.project_id);
        if (!personAssignments.has(s.person_id)) personAssignments.set(s.person_id, []);
        personAssignments.get(s.person_id)!.push({
          projectId:   proj?.id ?? s.project_id,
          projectName: proj?.project_name ?? '(미정)',
          phaseId:     ph.id,
          phaseName:   ph.phase_name,
          field:       s.field || '',
          phaseStart:  ph.start_date || '',
          phaseEnd:    ph.end_date   || '',
        });
      }

      // 2개 이상 배정된 인력만 추출 → 가나다 정렬
      const items: OverlapDetail[] = [];
      for (const [personId, assignments] of personAssignments.entries()) {
        if (assignments.length < 2) continue;
        const person = people.find((p) => p.id === personId);
        // 중복 영업일: 해당 기간에서 실제로 겹치는 일 수
        const overlapDays = col.type === 'week'
          ? calcBizDaysHoliday(
              assignments.reduce((a, b) => a.phaseStart > b.phaseStart ? b : a).phaseStart > colStart
                ? assignments.reduce((a, b) => a.phaseStart > b.phaseStart ? b : a).phaseStart
                : colStart,
              assignments.reduce((a, b) => a.phaseEnd < b.phaseEnd ? b : a).phaseEnd < colEnd
                ? assignments.reduce((a, b) => a.phaseEnd < b.phaseEnd ? b : a).phaseEnd
                : colEnd
            )
          : 1;
        items.push({
          personId,
          personName: person?.person_name ?? '(미상)',
          grade: person?.grade,
          team:  person?.team,
          overlapDays,
          assignments,
        });
      }
      items.sort((a, b) => a.personName.localeCompare(b.personName, 'ko'));
      return { items, periodDays };
    });
  }, [columns, localStaffing, localPhases, localProjects, people]);

  const toggleProjectExpand = (projectId: number) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleBadgeClick = (project: Project, phase: Phase) => {
    // 뷰어도 투입인력 조회를 위해 readOnly 모달 허용
    setEditTarget({ project: { ...project }, phase: { ...phase } });
  };

  // 접혀있는 프로젝트 바 클릭 → 프로젝트 기본정보 팝업
  const handleCollapsedProjectClick = (project: Project) => {
    setProjectInfoTarget({ ...project });
  };

  const handleSave = async (projectUpdates: Partial<Project>, phaseUpdates: Partial<Phase>, staffingChanges?: StaffingPersonChange[]) => {
    if (!editTarget) return;
    const { project, phase } = editTarget;
    try {
      await client.entities.projects.update({ id: String(project.id), data: projectUpdates });

      const datesChanged =
        (phaseUpdates.start_date || '') !== (phase.start_date || '') ||
        (phaseUpdates.end_date || '') !== (phase.end_date || '');
      const hasStaff = localStaffing.some((s) => s.phase_id === phase.id);

      if (datesChanged && hasStaff && phaseUpdates.start_date && phaseUpdates.end_date) {
        try {
          const previewRes = await client.apiCall.invoke({
            url: '/api/v1/phase_date_sync/preview',
            method: 'POST',
            data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date },
          });
          const preview = previewRes;

          // ── Case 1: 기간 축소 → 초과 인력 경고 ──
          if (preview?.exceeding_staffing?.length > 0) {
            const exceedingNames = preview.exceeding_staffing
              .map((s: { person_name: string; current_md: number }) => `${s.person_name}(${s.current_md}일)`)
              .join(', ');
            const confirmed = window.confirm(
              `⚠️ 아래 인력의 투입공수가 새 영업일(${preview.new_business_days}일)을 초과합니다:\n\n${exceedingNames}\n\n확인을 누르면 초과 인력의 공수가 축소되고 모든 투입일정이 재생성됩니다.\n계속하시겠습니까?`
            );
            if (!confirmed) { setEditTarget(null); return; }
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: true, expand_md: false },
            });
          }
          // ── Case 2: 기간 확장 → MD 자동 확장 여부 선택 ──
          else if (preview?.new_business_days > preview?.old_business_days && preview?.safe_staffing?.length > 0) {
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
            if (expandMd === null) { setEditTarget(null); return; }
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: false, expand_md: expandMd },
            });
          }
          // ── Case 3: 그 외 (동일 일수 등) → 그냥 apply ──
          else {
            await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/apply',
              method: 'POST',
              data: { phase_id: phase.id, new_start_date: phaseUpdates.start_date, new_end_date: phaseUpdates.end_date, force: true, expand_md: false },
            });
          }
          if (phaseUpdates.phase_name && phaseUpdates.phase_name !== phase.phase_name) {
            await client.entities.phases.update({ id: String(phase.id), data: { phase_name: phaseUpdates.phase_name } });
          }
          toast.success('단계 날짜가 변경되고 투입일정이 재생성되었습니다.');
        } catch (err) {
          console.error('Date sync failed:', err);
          toast.error('날짜 변경 적용 중 오류가 발생했습니다.');
          setEditTarget(null);
          return;
        }
      } else {
        await client.entities.phases.update({ id: String(phase.id), data: phaseUpdates });
        toast.success('수정이 완료되었습니다');
      }

      // Apply staffing changes
      if (staffingChanges && staffingChanges.length > 0) {
        let deletedCount = 0;
        let updatedCount = 0;
        for (const change of staffingChanges) {
          if (change.deleteStaffing) {
            await client.entities.staffing.delete({ id: String(change.staffingId) });
            deletedCount++;
          } else {
            const updateData: Record<string, unknown> = {};
            if (change.newPersonId) { updateData.person_id = change.newPersonId; updateData.person_name_text = change.newPersonNameText; }
            else { updateData.person_id = null; updateData.person_name_text = change.newPersonNameText; }
            if (change.newMd !== undefined) updateData.md = change.newMd;
            updateData.updated_at = new Date().toISOString();
            await client.entities.staffing.update({ id: String(change.staffingId), data: updateData });
            updatedCount++;
          }
        }
        const msgs: string[] = [];
        if (updatedCount > 0) msgs.push(`${updatedCount}건 수정`);
        if (deletedCount > 0) msgs.push(`${deletedCount}건 삭제`);
        toast.success(`투입인력: ${msgs.join(', ')} 완료`);
      }

      // Update local state
      setLocalProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, ...projectUpdates } as Project : p)));
      setLocalPhases((prev) => prev.map((p) => (p.id === phase.id ? { ...p, ...phaseUpdates } as Phase : p)));

      // Update local staffing
      if (staffingChanges && staffingChanges.length > 0) {
        const deletedSids = new Set(staffingChanges.filter((c) => c.deleteStaffing).map((c) => c.staffingId));
        if (deletedSids.size > 0) {
          setLocalStaffing((prev) => prev.filter((s) => !deletedSids.has(s.id)));
        }
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
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to save:', err);
      toast.error('저장에 실패했습니다');
    }
  };

  const prevPeriod = () => {
    const r = addMonths(viewYear, viewMonth, -periodMonths);
    setViewYear(r.year);
    setViewMonth(r.month);
  };

  const nextPeriod = () => {
    const r = addMonths(viewYear, viewMonth, periodMonths);
    setViewYear(r.year);
    setViewMonth(r.month);
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  // ── 간트차트 레이아웃 상수 ──
  const COL_WIDTH = scale === 'day' ? 28 : 70;   // 기존 table 용 (편집 팝업에서 참조)
  const LABEL_WIDTH = 320;   // 왼쪽 레이블 패널 너비
  const ROW_H = 36;          // 행 높이
  const HEADER_H = 52;       // 헤더 높이 (월 24 + 일/주 28)
  const BAR_H = 20;          // bar 높이
  const BAR_TOP = (ROW_H - BAR_H) / 2; // bar 수직 중앙 정렬

  // ── 타임라인 전체 너비 계산 ──
  const timelineWidth = columns.length * COL_WIDTH;

  // ── 날짜 → x 좌표 변환 ──
  const dateToX = useMemo(() => {
    const map = new Map<string, number>();
    columns.forEach((col, i) => {
      if (col.type === 'day') {
        map.set((col as DayColumn).dateStr, i * COL_WIDTH);
      } else {
        const wc = col as WeekColumn;
        // 주 안의 모든 날짜 매핑 (연속된 날짜)
        let d = new Date(wc.startDate + 'T00:00:00');
        const end = new Date(wc.endDate + 'T00:00:00');
        const dayCount = Math.round((end.getTime() - d.getTime()) / 86400000) + 1;
        for (let k = 0; k <= dayCount; k++) {
          const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          map.set(ds, i * COL_WIDTH + (k / dayCount) * COL_WIDTH);
          d.setDate(d.getDate() + 1);
        }
      }
    });
    return map;
  }, [columns, COL_WIDTH]);

  // bar의 x, width 계산 (phase의 start/end → 픽셀)
  const getBarGeometry = (startDate?: string, endDate?: string): { x: number; w: number } | null => {
    if (!startDate || !endDate) return null;
    const rangeStart = columns[0]?.type === 'day' ? (columns[0] as DayColumn).dateStr : (columns[0] as WeekColumn).startDate;
    const rangeEnd = columns[columns.length - 1]?.type === 'day' ? (columns[columns.length - 1] as DayColumn).dateStr : (columns[columns.length - 1] as WeekColumn).endDate;
    if (!rangeStart || !rangeEnd) return null;
    // 완전히 범위 밖이면 null
    if (endDate < rangeStart || startDate > rangeEnd) return null;

    // 클램프
    const clampedStart = startDate < rangeStart ? rangeStart : startDate;
    const clampedEnd = endDate > rangeEnd ? rangeEnd : endDate;

    let x = dateToX.get(clampedStart);
    let xEnd = dateToX.get(clampedEnd);

    // 정확히 없으면 가장 가까운 값 interpolate
    if (x === undefined) {
      // 컬럼 시작보다 이전이면 0
      x = 0;
    }
    if (xEnd === undefined) {
      xEnd = timelineWidth;
    } else {
      xEnd += COL_WIDTH; // end 날짜의 오른쪽 끝
    }
    const w = Math.max(xEnd - x, 4);
    return { x, w };
  };

  // 오늘 x 좌표
  const todayX = useMemo(() => dateToX.get(todayStr), [dateToX, todayStr]);

  return (
    <div className="space-y-4">
      {/* won-gantt rainbow CSS */}
      <style>{wonGanttStyle}</style>
      {/* ── 컨트롤 바 ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={prevPeriod}><ChevronLeft className="h-4 w-4" /></Button>
          <Select value={String(viewYear)} onValueChange={(v) => setViewYear(parseInt(v))}>
            <SelectTrigger className="w-[90px] h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(viewMonth)} onValueChange={(v) => setViewMonth(parseInt(v))}>
            <SelectTrigger className="w-[70px] h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{monthOptions.map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={nextPeriod}><ChevronRight className="h-4 w-4" /></Button>

          {/* Scale toggle */}
          <div className="flex items-center border rounded-md overflow-hidden ml-1">
            {(['day','week'] as ScaleMode[]).map((s) => (
              <button key={s} type="button"
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${scale === s ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                onClick={() => setScale(s)}
              >{s === 'day' ? '일' : '주'}</button>
            ))}
          </div>

          <Select value={String(periodMonths)} onValueChange={(v) => setPeriodMonths(parseInt(v))}>
            <SelectTrigger className="w-[85px] h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3개월</SelectItem>
              <SelectItem value="6">6개월</SelectItem>
              <SelectItem value="12">1년</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth() + 1); }} className="text-xs font-semibold">오늘</Button>

          <div className="flex items-center gap-3 ml-2 pl-3 border-l border-gray-200">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Checkbox checked={showA} onCheckedChange={(v) => setShowA(!!v)} className="h-4 w-4 border-blue-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
              <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">A 감리</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <Checkbox checked={showP} onCheckedChange={(v) => setShowP(!!v)} className="h-4 w-4 border-purple-400 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600" />
              <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">P 제안</span>
            </label>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">💡 바 클릭 → 수정 | ▶ 클릭 → 단계 펼치기</div>
      </div>

      {/* ── 간트차트 본체 ── */}
      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="p-0">
          {projectRows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <GanttChart className="h-8 w-8 mx-auto mb-2 opacity-30" />
              프로젝트가 없습니다.
            </div>
          ) : (
            <div className="flex" style={{ maxHeight: '78vh', overflow: 'hidden' }}>

              {/* ── 왼쪽: 레이블 패널 ── */}
              <div
                className="flex-shrink-0 border-r border-gray-300 bg-white z-20"
                style={{ width: LABEL_WIDTH, overflowY: 'hidden' }}
              >
                {/* 헤더 자리 */}
                <div className="border-b border-gray-300 bg-slate-100 flex items-end px-3 pb-1"
                  style={{ height: HEADER_H }}>
                  <span className="text-[11px] font-semibold text-gray-600">사업 / 단계</span>
                </div>

                {/* 레이블 스크롤 영역 */}
                <div className="overflow-y-auto" style={{ maxHeight: `calc(78vh - ${HEADER_H}px)` }} id="gantt-label-scroll">
                  {projectRows.map(({ project, phases: projPhases }) => {
                    const color = projectColorMap.get(project.id) || PROJECT_COLORS[0];
                    const isExpanded = expandedProjectIds.has(project.id);
                    const statusLabel = project.status === '제안' ? 'P' : project.status === '완료' ? '완' : project.status === '대기' ? '대' : 'A';
                    const statusColors: Record<string,string> = { '감리':'#3b82f6','제안':'#f59e0b','완료':'#10b981','대기':'#6b7280' };

                    if (projPhases.length === 0) {
                      return (
                        <div key={project.id} className="flex items-center px-3 border-b border-gray-100 bg-white"
                          style={{ height: ROW_H }}>
                          <span className="text-xs font-semibold truncate flex-1">{project.project_name}</span>
                          <span className="text-[9px] text-gray-400 ml-1">단계없음</span>
                        </div>
                      );
                    }

                    if (!isExpanded) {
                      // 접힌 상태: 프로젝트 한 행
                      return (
                        <div key={project.id}
                          className="flex items-center px-2 border-b border-gray-200 bg-slate-50 hover:bg-slate-100 cursor-pointer group"
                          style={{ height: ROW_H }}
                          onClick={() => handleCollapsedProjectClick(project)}
                        >
                          <button type="button"
                            className="p-0.5 mr-1 hover:bg-gray-200 rounded flex-shrink-0"
                            onClick={(e) => { e.stopPropagation(); toggleProjectExpand(project.id); }}
                            title="단계 펼치기"
                          >
                            <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                          </button>
                          <div className="w-2 h-2 rounded-sm flex-shrink-0 mr-1.5" style={{ backgroundColor: color.border }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate">{project.project_name}</div>
                            <div className="text-[9px] text-gray-400 truncate">{project.organization}</div>
                          </div>
                          <span className="text-[9px] font-bold rounded px-1 py-0.5 text-white flex-shrink-0 ml-1"
                            style={{ backgroundColor: statusColors[project.status] || '#6b7280' }}>{statusLabel}</span>
                        </div>
                      );
                    }

                    // 펼친 상태: 프로젝트 헤더 행 + 각 phase 행
                    return (
                      <React.Fragment key={project.id}>
                        {/* 프로젝트 헤더 */}
                        <div className="flex items-center px-2 border-b border-gray-300 bg-slate-100 sticky"
                          style={{ height: ROW_H }}>
                          <button type="button"
                            className="p-0.5 mr-1 hover:bg-gray-200 rounded flex-shrink-0"
                            onClick={() => toggleProjectExpand(project.id)}
                            title="단계 접기"
                          >
                            <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                          </button>
                          <div className="w-2 h-2 rounded-sm flex-shrink-0 mr-1.5" style={{ backgroundColor: color.border }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold truncate">{project.project_name}</div>
                            <div className="text-[9px] text-gray-500 truncate">{project.organization}</div>
                          </div>
                          <span className="text-[9px] font-bold rounded px-1 py-0.5 text-white flex-shrink-0 ml-1"
                            style={{ backgroundColor: statusColors[project.status] || '#6b7280' }}>{statusLabel}</span>
                        </div>
                        {/* 각 단계 */}
                        {projPhases.map((phase) => {
                          const staffCount = localStaffing.filter((s) => s.phase_id === phase.id).length;
                          return (
                            <div key={phase.id}
                              className="flex items-center pl-8 pr-2 border-b border-gray-100 bg-white hover:bg-blue-50/30 cursor-pointer group"
                              style={{ height: ROW_H }}
                              onClick={() => handleBadgeClick(project, phase)}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium truncate text-gray-700">{phase.phase_name}</div>
                                <div className="text-[9px] text-gray-400">
                                  {phase.start_date?.slice(5)} ~ {phase.end_date?.slice(5)}
                                  {staffCount > 0 && <span className="ml-1 text-blue-400">{staffCount}명</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}

                  {/* 유휴 인력 행 */}
                  <div className="flex items-center px-3 border-t-2 border-slate-300 bg-slate-50"
                    style={{ height: ROW_H }}>
                    <span className="text-[11px] font-semibold text-slate-500">유휴 인력</span>
                  </div>
                  {/* 중복 인력 행 */}
                  <div className="flex items-center px-3 border-t border-slate-200 bg-orange-50"
                    style={{ height: ROW_H }}>
                    <span className="text-[11px] font-semibold text-orange-600">중복 인력</span>
                  </div>
                </div>
              </div>

              {/* ── 오른쪽: 타임라인 패널 ── */}
              <div className="flex-1 overflow-auto" id="gantt-timeline-scroll"
                onScroll={(e) => {
                  const labelEl = document.getElementById('gantt-label-scroll');
                  if (labelEl) labelEl.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
                }}
              >
                <div style={{ width: timelineWidth, position: 'relative' }}>

                  {/* ── 헤더 (sticky top) ── */}
                  <div className="sticky top-0 z-30 bg-white border-b border-gray-300" style={{ height: HEADER_H }}>
                    {/* 월 행 */}
                    <div className="flex border-b border-gray-200 bg-slate-200" style={{ height: 24 }}>
                      {monthGroups.map((mg) => (
                        <div key={mg.label}
                          className="text-[10px] font-bold text-gray-700 flex items-center justify-center border-r border-gray-300 flex-shrink-0"
                          style={{ width: mg.count * COL_WIDTH }}
                        >
                          {mg.label}
                        </div>
                      ))}
                    </div>
                    {/* 일/주 행 */}
                    <div className="flex bg-slate-50" style={{ height: 28 }}>
                      {columns.map((col, i) => {
                        if (col.type === 'day') {
                          const dc = col as DayColumn;
                          return (
                            <div key={i}
                              className={`flex-shrink-0 flex items-center justify-center border-r border-gray-200 text-[9px] font-medium
                                ${dc.isToday ? 'bg-blue-200 text-blue-800 font-bold'
                                : dc.isHoliday ? 'bg-red-100 text-red-500'
                                : dc.isWeekend ? 'bg-gray-200 text-gray-400'
                                : 'text-gray-600'}`}
                              style={{ width: COL_WIDTH }}
                              title={dc.isHoliday ? `${dc.dateStr} (${dc.holidayName})` : dc.dateStr}
                            >
                              {dc.label}
                            </div>
                          );
                        } else {
                          const wc = col as WeekColumn;
                          return (
                            <div key={i}
                              className={`flex-shrink-0 flex items-center justify-center border-r border-gray-200 text-[9px] font-medium
                                ${wc.isCurrentWeek ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-600'}`}
                              style={{ width: COL_WIDTH }}
                              title={`${wc.startDate} ~ ${wc.endDate}`}
                            >
                              {wc.label}
                            </div>
                          );
                        }
                      })}
                    </div>
                  </div>

                  {/* ── 바디 (행들) ── */}
                  <div style={{ position: 'relative' }}>

                    {/* 배경 격자선 + 주말/공휴일 음영 */}
                    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
                      {columns.map((col, i) => {
                        if (col.type !== 'day') return null;
                        const dc = col as DayColumn;
                        if (!dc.isWeekend && !dc.isHoliday && !dc.isToday) return null;
                        return (
                          <div key={i} className="absolute top-0 bottom-0"
                            style={{
                              left: i * COL_WIDTH,
                              width: COL_WIDTH,
                              backgroundColor: dc.isToday ? 'rgba(59,130,246,0.08)'
                                : dc.isHoliday ? 'rgba(239,68,68,0.07)'
                                : 'rgba(0,0,0,0.04)',
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* 오늘 세로선 */}
                    {todayX !== undefined && (
                      <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: todayX + COL_WIDTH / 2, width: 2, backgroundColor: '#ef4444', zIndex: 10, opacity: 0.8 }} />
                    )}

                    {/* 프로젝트/단계 행 */}
                    {projectRows.map(({ project, phases: projPhases }) => {
                      const color = projectColorMap.get(project.id) || PROJECT_COLORS[0];
                      const isExpanded = expandedProjectIds.has(project.id);

                      if (projPhases.length === 0) {
                        return (
                          <div key={project.id} className="border-b border-gray-100 relative"
                            style={{ height: ROW_H }}>
                            {/* 빈 행 */}
                          </div>
                        );
                      }

                      const isWon = project.is_won === true;

                      if (!isExpanded) {
                        // 접힌 상태: 모든 phase bar를 한 행에 표시
                        return (
                          <div key={project.id} className="border-b border-gray-200 relative bg-slate-50/50"
                            style={{ height: ROW_H }}>
                            {projPhases.map((phase) => {
                              const geo = getBarGeometry(phase.start_date, phase.end_date);
                              if (!geo) return null;
                              const staffCount = localStaffing.filter((s) => s.phase_id === phase.id).length;
                              return (
                                <button
                                  key={phase.id}
                                  type="button"
                                  className={`absolute cursor-pointer hover:brightness-90 transition-all hover:shadow-md${isWon ? ' won-gantt-bar' : ''}`}
                                  style={{
                                    left: geo.x,
                                    width: geo.w,
                                    top: BAR_TOP,
                                    height: BAR_H,
                                    ...(!isWon ? { backgroundColor: color.cell } : {}),
                                    border: isWon ? '1.5px solid rgba(255,255,255,0.6)' : `1.5px solid ${color.border}`,
                                    borderRadius: 4,
                                    zIndex: 5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    paddingLeft: 6,
                                    overflow: 'hidden',
                                  }}
                                  onClick={() => handleCollapsedProjectClick(project)}
                                  title={`${project.project_name} - ${phase.phase_name}\n${phase.start_date} ~ ${phase.end_date}\n인력: ${staffCount}명${isWon ? '\n👑 수주 완료' : ''}`}
                                >
                                  <span className="text-[9px] font-semibold truncate" style={{ color: isWon ? '#fff' : color.text }}>
                                    {isWon ? '👑 ' : ''}{phase.phase_name}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      }

                      // 펼친 상태: 프로젝트 헤더 행 + 각 phase 행
                      return (
                        <React.Fragment key={project.id}>
                          {/* 프로젝트 헤더 행: 전체 span bar */}
                          <div className="border-b border-gray-300 relative bg-slate-100/70"
                            style={{ height: ROW_H }}>
                            {(() => {
                              const projStart = projPhases.map(p => p.start_date || '').filter(Boolean).sort()[0];
                              const projEnd = projPhases.map(p => p.end_date || '').filter(Boolean).sort().reverse()[0];
                              const geo = getBarGeometry(projStart, projEnd);
                              if (!geo) return null;
                              return (
                                <div className="absolute"
                                  style={{
                                    left: geo.x,
                                    width: geo.w,
                                    top: ROW_H / 2 - 2,
                                    height: 4,
                                    backgroundColor: color.border,
                                    borderRadius: 2,
                                    opacity: 0.5,
                                    zIndex: 3,
                                  }}
                                />
                              );
                            })()}
                            {/* 다이아몬드 마일스톤 표시 */}
                            {projPhases.map((ph) => {
                              const geo = getBarGeometry(ph.start_date, ph.start_date);
                              if (!geo) return null;
                              return (
                                <div key={ph.id} className="absolute"
                                  style={{
                                    left: geo.x + COL_WIDTH / 2 - 5,
                                    top: ROW_H / 2 - 5,
                                    width: 10, height: 10,
                                    backgroundColor: color.border,
                                    transform: 'rotate(45deg)',
                                    borderRadius: 1,
                                    zIndex: 4,
                                    opacity: 0.8,
                                  }}
                                />
                              );
                            })}
                          </div>

                          {/* 각 단계 행 */}
                          {projPhases.map((phase) => {
                            const geo = getBarGeometry(phase.start_date, phase.end_date);
                            const staffCount = localStaffing.filter((s) => s.phase_id === phase.id).length;
                            const bizDays = phase.start_date && phase.end_date ? calcBizDaysHoliday(phase.start_date, phase.end_date) : null;
                            return (
                              <div key={phase.id} className="border-b border-gray-100 relative bg-white"
                                style={{ height: ROW_H }}>
                                {geo && (
                                  <button
                                    type="button"
                                    className={`absolute cursor-pointer transition-all group${isWon ? ' won-gantt-bar' : ''}`}
                                    style={{
                                      left: geo.x,
                                      width: geo.w,
                                      top: BAR_TOP,
                                      height: BAR_H,
                                      zIndex: 5,
                                      borderRadius: 6,
                                      border: isWon ? '2px solid rgba(255,255,255,0.6)' : undefined,
                                    }}
                                    onClick={() => handleBadgeClick(project, phase)}
                                    title={`${phase.phase_name}\n${phase.start_date} ~ ${phase.end_date}\n영업일: ${bizDays}일 | 인력: ${staffCount}명\n클릭하여 수정${isWon ? '\n👑 수주 완료' : ''}`}
                                  >
                                    {/* 공휴일/주말 패턴 렌더 (won이 아닐 때만) */}
                                    {!isWon && (
                                      <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 6 }}>
                                        {/* 전체 배경 bar */}
                                        <div className="absolute inset-0"
                                          style={{ backgroundColor: color.cell, border: `2px solid ${color.border}`, borderRadius: 6 }}
                                        />
                                        {/* 공휴일/주말 줄무늬 */}
                                        {scale === 'day' && columns.map((col, ci) => {
                                          if (col.type !== 'day') return null;
                                          const dc = col as DayColumn;
                                          if (!dc.isWeekend && !dc.isHoliday) return null;
                                          const colX = ci * COL_WIDTH;
                                          if (colX < geo.x || colX >= geo.x + geo.w) return null;
                                          const relX = colX - geo.x;
                                          return (
                                            <div key={ci} className="absolute top-0 bottom-0"
                                              style={{
                                                left: relX,
                                                width: COL_WIDTH,
                                                backgroundColor: dc.isHoliday ? 'rgba(239,68,68,0.25)' : 'rgba(0,0,0,0.15)',
                                              }}
                                            />
                                          );
                                        })}
                                      </div>
                                    )}
                                    {/* 레이블 */}
                                    <div className="absolute inset-0 flex items-center px-2 overflow-hidden" style={{ zIndex: 2 }}>
                                      <span className="text-[9px] font-semibold truncate select-none" style={{ color: isWon ? '#fff' : color.text }}>
                                        {isWon ? '👑 ' : ''}{phase.phase_name}
                                        {bizDays && geo.w > 60 && <span className="ml-1 opacity-70">({bizDays}일)</span>}
                                      </span>
                                    </div>
                                    {/* hover 오버레이 */}
                                    <div className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                                      style={{ backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 6 }}
                                    />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}

                    {/* ── 유휴 인력 행 ── */}
                    <div className="border-t-2 border-slate-300 relative bg-slate-50/70"
                      style={{ height: ROW_H }}>
                      {columns.map((col, ci) => {
                        const rowData = idleRowData[ci];
                        if (!rowData) return null;
                        const { people: idlePeople, availDays } = rowData;
                        const count = idlePeople.length;

                        // ── 일 뷰: 공휴일/주말 제외 ──
                        if (col.type === 'day') {
                          const dc = col as DayColumn;
                          if (dc.isWeekend || dc.isHoliday) return null;
                          if (count === 0) return null;
                          const colLabel = `${dc.month}/${dc.day}`;
                          return (
                            <button
                              key={ci}
                              type="button"
                              className="absolute flex items-center justify-center cursor-pointer text-[9px] font-bold text-green-700 hover:bg-green-200 rounded transition-colors"
                              style={{ left: ci * COL_WIDTH + 1, width: COL_WIDTH - 2, top: 4, height: ROW_H - 8, backgroundColor: 'rgba(209,250,229,0.8)', zIndex: 5 }}
                              title={`유휴 인력 ${count}명 (1일 투입 가능)`}
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setIdlePopover((prev) => prev?.colIdx === ci ? null : { colIdx: ci, people: idlePeople, availDays: 1, colLabel, anchorRect: rect, search: '' });
                              }}
                            >
                              {count}
                            </button>
                          );
                        }
                        // ── 주 뷰 ──
                        if (col.type === 'week') {
                          const wc = col as WeekColumn;
                          if (count === 0) return null;
                          const colLabel = wc.label;
                          return (
                            <button
                              key={ci}
                              type="button"
                              className="absolute flex items-center justify-center cursor-pointer text-[9px] font-bold text-green-700 hover:bg-green-200 rounded transition-colors"
                              style={{ left: ci * COL_WIDTH + 1, width: COL_WIDTH - 2, top: 4, height: ROW_H - 8, backgroundColor: 'rgba(209,250,229,0.8)', zIndex: 5 }}
                              title={`유휴 인력 ${count}명 (이 주 영업일 ${availDays}일 투입 가능)`}
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setIdlePopover((prev) => prev?.colIdx === ci ? null : { colIdx: ci, people: idlePeople, availDays, colLabel, anchorRect: rect, search: '' });
                              }}
                            >
                              {count}
                            </button>
                          );
                        }
                        return null;
                      })}
                    </div>

                    {/* ── 중복 인력 행 ── */}
                    <div className="border-t border-slate-200 relative bg-orange-50/40"
                      style={{ height: ROW_H }}>
                      {columns.map((col, ci) => {
                        const rowData = overlapRowData[ci];
                        if (!rowData) return null;
                        const { items, periodDays } = rowData;
                        const count = items.length;

                        if (col.type === 'day') {
                          const dc = col as DayColumn;
                          if (dc.isWeekend || dc.isHoliday) return null;
                          if (count === 0) return null;
                          const colLabel = `${dc.month}/${dc.day}`;
                          return (
                            <button
                              key={ci}
                              type="button"
                              className="absolute flex items-center justify-center cursor-pointer text-[9px] font-bold text-orange-700 hover:bg-orange-200 rounded transition-colors"
                              style={{ left: ci * COL_WIDTH + 1, width: COL_WIDTH - 2, top: 4, height: ROW_H - 8, backgroundColor: 'rgba(254,215,170,0.85)', zIndex: 5 }}
                              title={`중복 인력 ${count}명`}
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setOverlapPopover((prev) => prev?.colIdx === ci ? null : { colIdx: ci, items, colLabel, periodDays: 1, anchorRect: rect, search: '', expanded: null });
                              }}
                            >
                              {count}
                            </button>
                          );
                        }
                        if (col.type === 'week') {
                          const wc = col as WeekColumn;
                          if (count === 0) return null;
                          const colLabel = wc.label;
                          return (
                            <button
                              key={ci}
                              type="button"
                              className="absolute flex items-center justify-center cursor-pointer text-[9px] font-bold text-orange-700 hover:bg-orange-200 rounded transition-colors"
                              style={{ left: ci * COL_WIDTH + 1, width: COL_WIDTH - 2, top: 4, height: ROW_H - 8, backgroundColor: 'rgba(254,215,170,0.85)', zIndex: 5 }}
                              title={`중복 인력 ${count}명`}
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setOverlapPopover((prev) => prev?.colIdx === ci ? null : { colIdx: ci, items, colLabel, periodDays, anchorRect: rect, search: '', expanded: null });
                              }}
                            >
                              {count}
                            </button>
                          );
                        }
                        return null;
                      })}
                    </div>

                  </div>{/* 바디 끝 */}
                </div>{/* 타임라인 너비 끝 */}
              </div>{/* 오른쪽 패널 끝 */}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 유휴 인력 팝오버 — 검색·가나다 정렬·투입 가능 일수 */}
      {idlePopover && (() => {
        const filtered = idlePopover.people.filter((p) =>
          p.person_name.includes(idlePopover.search) ||
          (p.team || '').includes(idlePopover.search) ||
          (p.grade || '').includes(idlePopover.search)
        );
        return (
          <div
            className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-gray-200 w-[260px]"
            style={{
              top: Math.min(idlePopover.anchorRect?.bottom ?? 0, window.innerHeight - 380) + 4,
              left: Math.min(idlePopover.anchorRect?.left ?? 0, window.innerWidth - 270),
            }}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-green-50 rounded-t-lg">
              <div>
                <span className="text-xs font-semibold text-green-800">
                  유휴 인력 ({idlePopover.people.length}명)
                </span>
                <span className="ml-1.5 text-[10px] text-green-600 font-medium">
                  · {idlePopover.colLabel} ({idlePopover.availDays}일 투입 가능)
                </span>
              </div>
              <button className="text-gray-400 hover:text-gray-700 ml-2 flex-shrink-0" onClick={() => setIdlePopover(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* 검색 */}
            <div className="px-2 py-1.5 border-b border-gray-100">
              <input
                type="text"
                placeholder="이름/팀/등급 검색..."
                value={idlePopover.search}
                onChange={(e) => setIdlePopover((prev) => prev ? { ...prev, search: e.target.value } : prev)}
                className="w-full h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                autoFocus
              />
            </div>
            {/* 목록 (가나다 정렬은 idleRowData에서 이미 처리) */}
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">검색 결과 없음</div>
              ) : filtered.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                  <span className="text-xs text-gray-800 font-medium flex-1">{p.person_name}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {p.grade && <span className="text-[10px] text-gray-400">{p.grade}</span>}
                    <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1 py-0.5 rounded">
                      {idlePopover.availDays}일
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 중복 인력 팝오버 */}
      {overlapPopover && (() => {
        const filtered = overlapPopover.items.filter((item) =>
          item.personName.includes(overlapPopover.search) ||
          (item.team || '').includes(overlapPopover.search) ||
          (item.grade || '').includes(overlapPopover.search)
        );
        return (
          <div
            className="fixed z-[9999] bg-white rounded-lg shadow-xl border border-orange-200 w-[320px]"
            style={{
              top: Math.min(overlapPopover.anchorRect?.bottom ?? 0, window.innerHeight - 420) + 4,
              left: Math.min(overlapPopover.anchorRect?.left ?? 0, window.innerWidth - 330),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-orange-100 bg-orange-50 rounded-t-lg">
              <div>
                <span className="text-xs font-semibold text-orange-800">
                  중복 인력 ({overlapPopover.items.length}명)
                </span>
                <span className="ml-1.5 text-[10px] text-orange-600 font-medium">
                  · {overlapPopover.colLabel} ({overlapPopover.periodDays}일 기준)
                </span>
              </div>
              <button className="text-gray-400 hover:text-gray-700 ml-2 flex-shrink-0"
                onClick={() => setOverlapPopover(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* 검색 */}
            <div className="px-2 py-1.5 border-b border-orange-100">
              <input
                type="text"
                placeholder="이름/팀/등급 검색..."
                value={overlapPopover.search}
                onChange={(e) => setOverlapPopover((prev) => prev ? { ...prev, search: e.target.value } : prev)}
                className="w-full h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-orange-400"
                autoFocus
              />
            </div>
            {/* 목록 */}
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-400 text-center">검색 결과 없음</div>
              ) : filtered.map((item) => {
                const isExpanded = overlapPopover.expanded === item.personId;
                return (
                  <div key={item.personId} className="border-b border-gray-50 last:border-0">
                    {/* 인력 행 — 클릭 시 상세 토글 */}
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-orange-50 transition-colors text-left"
                      onClick={() => setOverlapPopover((prev) => prev
                        ? { ...prev, expanded: isExpanded ? null : item.personId }
                        : prev
                      )}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                      <span className="text-xs text-gray-800 font-medium flex-1">{item.personName}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.grade && <span className="text-[10px] text-gray-400">{item.grade}</span>}
                        <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1 py-0.5 rounded">
                          {item.assignments.length}개 사업
                        </span>
                        <span className="text-[10px] text-orange-500">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>
                    {/* 상세 — 사업/단계/역할 목록 */}
                    {isExpanded && (
                      <div className="mx-3 mb-2 rounded-md border border-orange-100 bg-orange-50/60 overflow-hidden">
                        {item.assignments.map((a, ai) => {
                          const projColor = projectColorMap.get(a.projectId) || PROJECT_COLORS[0];
                          // 이 단계에서 해당 컬럼 기간과 겹치는 영업일 수
                          const colStart = overlapPopover.colLabel; // 표시용
                          return (
                            <div key={ai} className="flex items-start gap-2 px-2 py-1.5 border-b border-orange-100 last:border-0">
                              <div className="w-2 h-2 rounded-sm flex-shrink-0 mt-0.5"
                                style={{ backgroundColor: projColor.border }} />
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-semibold text-gray-700 truncate" title={a.projectName}>
                                  {a.projectName}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate">
                                  {a.phaseName} · <span className="text-blue-600">{a.field}</span>
                                </div>
                                <div className="text-[9px] text-gray-400">
                                  {a.phaseStart} ~ {a.phaseEnd}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div className="px-2 py-1 bg-orange-100/60 text-[10px] text-orange-700 font-semibold">
                          ⚠️ {item.assignments.length}개 사업에 동시 배정 — {item.overlapDays}일 중복
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 프로젝트 기본정보 팝업 (접혀있는 프로젝트 클릭) */}
      {projectInfoTarget && (() => {
        const proj = projectInfoTarget;
        const projColor = projectColorMap.get(proj.id) || PROJECT_COLORS[0];
        const projPhaseList = localPhases.filter((ph) => ph.project_id === proj.id).sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
        const projStart = projPhaseList.map(p => p.start_date || '').filter(Boolean).sort()[0] || '-';
        const projEnd = projPhaseList.map(p => p.end_date || '').filter(Boolean).sort().reverse()[0] || '-';
        const totalBizDays = projPhaseList.reduce((sum, ph) => {
          if (!ph.start_date || !ph.end_date) return sum;
          return sum + calcBizDaysHoliday(ph.start_date, ph.end_date);
        }, 0);
        const statusColors: Record<string, string> = { '감리':'#3b82f6','제안':'#f59e0b','완료':'#10b981','대기':'#6b7280' };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setProjectInfoTarget(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between px-5 py-4 border-b gap-2" style={{ borderLeft: `4px solid ${projColor.border}` }}>
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-bold text-sm break-words">{proj.project_name}</span>
                  <span className="text-[10px] font-bold rounded px-1.5 py-0.5 text-white flex-shrink-0"
                    style={{ backgroundColor: statusColors[proj.status] || '#6b7280' }}>{proj.status}</span>
                </div>
                <button type="button" onClick={() => setProjectInfoTarget(null)} className="p-1 hover:bg-gray-100 rounded flex-shrink-0 mt-0.5"><X className="h-4 w-4" /></button>
              </div>
              <div className="px-5 py-4 border-b grid grid-cols-2 gap-3 text-xs">
                <div><div className="text-muted-foreground mb-0.5">발주기관</div><div className="font-medium">{proj.organization || '-'}</div></div>
                <div><div className="text-muted-foreground mb-0.5">전체 기간</div><div className="font-medium">{projStart.slice(0,7)} ~ {projEnd.slice(0,7)}</div></div>
                <div><div className="text-muted-foreground mb-0.5">단계 수</div><div className="font-medium">{projPhaseList.length}개 단계</div></div>
                <div><div className="text-muted-foreground mb-0.5">총 영업일</div><div className="font-medium">{totalBizDays}일</div></div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                <div className="text-[11px] font-semibold text-gray-500 mb-2">단계별 기간</div>
                <div className="space-y-1.5">
                  {projPhaseList.map((ph) => {
                    const bizDays = ph.start_date && ph.end_date ? calcBizDaysHoliday(ph.start_date, ph.end_date) : null;
                    const staffCount = localStaffing.filter((s) => s.phase_id === ph.id).length;
                    return (
                      <div key={ph.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded px-3 py-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: projColor.border }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{ph.phase_name}</div>
                          <div className="text-muted-foreground text-[10px]">{ph.start_date?.slice(5)} ~ {ph.end_date?.slice(5)}{bizDays ? ` (${bizDays}일)` : ''}</div>
                        </div>
                        <div className="text-[10px] text-gray-500 flex-shrink-0">{staffCount}명</div>
                      </div>
                    );
                  })}
                  {projPhaseList.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">등록된 단계가 없습니다.</div>}
                </div>
              </div>
              <div className="px-5 py-3 border-t flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => { setProjectInfoTarget(null); toggleProjectExpand(proj.id); }}>단계 펼치기</Button>
                {!isViewer && (
                  <Button size="sm" onClick={() => { if (projPhaseList.length > 0) { setProjectInfoTarget(null); setEditTarget({ project: { ...proj }, phase: { ...projPhaseList[0] } }); } }} disabled={projPhaseList.length === 0}>단계 수정</Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
          readOnly={isViewer}
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
    </div>
  );
}
