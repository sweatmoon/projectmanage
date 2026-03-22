import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { ArrowLeft, Save, Plus, Trash2, Lock, Pencil, FileText, Copy, Download, RefreshCw, CalendarDays, ChevronDown, ChevronRight, ChevronLeft, AlertTriangle, UserCheck, HardHat } from 'lucide-react';
import { countBusinessDays as countBizDaysHoliday, isNonWorkday } from '@/lib/holidays';
import { usePresence } from '@/hooks/usePresence';
import { PresenceBadges, PresenceWarningBanner } from '@/components/PresenceBadges';
import { useUserRole } from '@/hooks/useUserRole';

interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  deadline?: string;
  notes?: string;
  updated_at?: string;
}

interface Phase {
  id: number;
  project_id: number;
  phase_name: string;
  start_date?: string;
  end_date?: string;
  sort_order: number;
}

interface Staffing {
  id: number;
  project_id: number;
  phase_id: number;
  category: string;
  field: string;
  sub_field: string;
  person_id?: number;
  person_name_text?: string;
  md?: number | null;
  updated_at?: string;
}

interface People {
  id: number;
  person_name: string;
}

interface CalendarEntry {
  id: number | null;
  staffing_id: number;
  entry_date: string;
  status: string | null;
}

interface StaffingRowData {
  rowKey: string;
  category: string;
  field: string;
  sub_field: string;
  personName: string;
  personId?: number;
  phaseMds: Record<number, { staffingId: number; md: number | null }>;
  totalMd: number;
  sortGroup: number;
  sortOrder: number;
}

/* ── Helper: count business days between two dates (주말+공휴일 제외, inclusive) ── */
function countBusinessDays(startStr?: string, endStr?: string): number {
  if (!startStr || !endStr) return 999;
  const result = countBizDaysHoliday(startStr, endStr);
  return result > 0 ? result : 0;
}

/* ── Format date for display: "3/5" ── */
function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ─────────────────────────────────────────────────────────────
   PersonComboboxInline – ScheduleTab의 PersonCombobox와 동일한
   드롭다운 방식의 인력 선택 컴포넌트 (투입공수 원장용)
───────────────────────────────────────────────────────────── */
function PersonComboboxInline({
  currentPersonId,
  currentPersonName,
  isExternal,
  allPeople,
  partialAvailMap,
  disabled,
  onChange,
  onCancel,
}: {
  currentPersonId?: number;
  currentPersonName: string;
  isExternal: boolean;
  allPeople: People[];
  partialAvailMap?: Map<number, number>; // personId → 투입가능일수 (없으면 전체가능)
  disabled?: boolean;
  onChange: (personId: number | null, personName: string) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
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

  const handleSelect = (personId: number | null, personName: string) => {
    onChange(personId, personName);
    setOpen(false);
    setSearch('');
    setShowCustomInput(false);
  };

  return (
    <div className="relative" ref={dropdownRef} data-person-editor>
      <button
        type="button"
        onClick={() => { if (!disabled) { setOpen(!open); setSearch(''); setShowCustomInput(false); } }}
        className="flex items-center justify-between w-full h-7 px-2 text-xs border rounded bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={disabled}
      >
        <span className="truncate">
          {currentPersonName || '─'}
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
              onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); onCancel(); } }}
              className="w-full h-7 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {/* 현재 외부 인력이면 상단에 표시 */}
            {isExternal && currentPersonName && (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 bg-blue-50 font-semibold"
                onClick={() => handleSelect(null, currentPersonName)}
              >
                {currentPersonName} <span className="text-amber-500 text-[9px]">(현재·외부)</span>
              </button>
            )}
            {/* ✅ 전체 투입 가능 섹션 */}
            {partialAvailMap && fullAvailList.length > 0 && (
              <div className="px-2 py-0.5 text-[10px] font-semibold text-green-700 bg-green-50 border-b">
                ✅ 투입 가능 ({fullAvailList.length}명)
              </div>
            )}
            {fullAvailList.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${currentPersonId === p.id ? 'bg-blue-50 font-semibold' : ''}`}
                onClick={() => handleSelect(p.id, p.person_name)}
              >
                {p.person_name}
                {p.grade && <span className="text-muted-foreground text-[9px]">({p.grade})</span>}
                {p.team && <span className="text-muted-foreground text-[9px]">· {p.team}</span>}
                {currentPersonId === p.id && <span className="ml-auto text-blue-500">✓</span>}
              </button>
            ))}
            {/* ⚠️ 일부 투입 가능 섹션 */}
            {partialAvailMap && partialList.length > 0 && (
              <div className="px-2 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border-t border-b">
                ⚠️ 일정 겹침 ({partialList.length}명)
              </div>
            )}
            {partialList.map((p) => {
              const avail = partialAvailMap?.get(p.id) ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 flex items-center gap-1 ${currentPersonId === p.id ? 'bg-amber-50 font-semibold' : ''}`}
                  onClick={() => handleSelect(p.id, p.person_name)}
                >
                  <span className="text-amber-700 font-medium">{p.person_name}</span>
                  {p.grade && <span className="text-amber-500 text-[9px]">({p.grade})</span>}
                  <span className="text-amber-600 text-[9px] ml-auto">({avail}일 가능)</span>
                  {currentPersonId === p.id && <span className="text-amber-600 text-[9px]">✓</span>}
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
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 flex items-center gap-1 ${currentPersonId === p.id ? 'bg-red-50 font-semibold' : ''}`}
                onClick={() => handleSelect(p.id, p.person_name)}
              >
                <span className="text-red-500 font-medium">{p.person_name}</span>
                {p.grade && <span className="text-red-400 text-[9px]">({p.grade})</span>}
                <span className="text-red-400 text-[9px] ml-auto">(투입 불가)</span>
                {currentPersonId === p.id && <span className="text-red-500 text-[9px]">✓</span>}
              </button>
            ))}
            {/* partialAvailMap 없을 때 기존 방식 */}
            {!partialAvailMap && filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-1 ${currentPersonId === p.id ? 'bg-blue-50 font-semibold' : ''}`}
                onClick={() => handleSelect(p.id, p.person_name)}
              >
                {p.person_name}
                {p.grade && <span className="text-muted-foreground text-[9px]">({p.grade})</span>}
                {p.team && <span className="text-muted-foreground text-[9px]">· {p.team}</span>}
                {currentPersonId === p.id && <span className="ml-auto text-blue-500">✓</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">검색 결과 없음</div>
            )}
            {/* 외부 인력 직접 입력 */}
            <div className="border-t">
              {!showCustomInput ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-50"
                  onClick={() => { setShowCustomInput(true); setCustomName(search); }}
                >
                  + 외부 인력으로 설정{search ? ` "${search}"` : ''}
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
                    placeholder="외부 인력 이름"
                    className="flex-1 h-6 px-2 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { if (customName.trim()) handleSelect(null, customName.trim()); }}
                    className="px-2 h-6 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
                  >확인</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Classify field into 단계감리팀 or 전문가팀 ── */
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

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);
  const { canWrite, isViewer } = useUserRole();

  const [project, setProject] = useState<Project | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [staffingList, setStaffingList] = useState<Staffing[]>([]);
  const [people, setPeople] = useState<People[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 모자(대체인력) 관련 state ──────────────────────────────────
  interface HatRecord { id: number; staffing_id: number; actual_person_id: number | null; actual_person_name: string; }
  const [hatMap, setHatMap] = useState<Map<number, HatRecord>>(new Map()); // key: staffing_id
  const [hatModalOpen, setHatModalOpen] = useState(false);
  // hatModalTarget: 원장에서 열 때 rowKey 기준, 단계모달에서 열 때 phase_id 기준으로 staffingId 배열 전달
  const [hatModalStaffingIds, setHatModalStaffingIds] = useState<number[]>([]);
  const [hatDraft, setHatDraft] = useState<Map<number, string>>(new Map()); // key: staffing_id, value: 입력중인 이름
  const [savingHat, setSavingHat] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form
  const [editProject, setEditProject] = useState<Partial<Project>>({});

  // Phase dialog
  const [showPhaseDialog, setShowPhaseDialog] = useState(false);
  const [editingPhase, setEditingPhase] = useState<Partial<Phase> | null>(null);
  const [savingPhase, setSavingPhase] = useState(false);

  // Text export dialog
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportText, setExportText] = useState('');
  const [exportActualText, setExportActualText] = useState('');
  const [exportHasHat, setExportHasHat] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // Text edit dialog (overwrite phases)
  const [showTextEdit, setShowTextEdit] = useState(false);
  const [textEditContent, setTextEditContent] = useState('');
  const [textEditLoading, setTextEditLoading] = useState(false);
  const [textEditSaving, setTextEditSaving] = useState(false);

  // ── 입력 유효성 검증 ──────────────────────────────────────
  const fmt8pd = (d: string) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

  const validateAuditLine = (line: string): string | null => {
    const l = line.trim();
    if (!l) return null;
    const parts = l.split(',').map(s => s.trim());
    if (parts.length < 3) return '쉼표로 구분된 항목이 3개 미만입니다 (단계명, 시작일, 종료일 필수)';
    const [, start, end] = parts;
    if (!/^\d{8}$/.test(start)) return `시작일 형식 오류: "${start}" → YYYYMMDD 8자리`;
    if (!/^\d{8}$/.test(end))   return `종료일 형식 오류: "${end}" → YYYYMMDD 8자리`;
    if (start > end)            return `날짜 오류: 시작일(${start})이 종료일(${end})보다 늦습니다`;
    const maxMd = countBizDaysHoliday(fmt8pd(start), fmt8pd(end));
    for (const p of parts.slice(3)) {
      if (!p) continue;
      const cp = p.split(':');
      if (!cp[0].trim()) return `인력 이름이 비어있습니다: "${p}"`;
      const field = cp[1]?.trim();
      if (!field) return `분야 누락: "${p}" → 이름:분야[:MD] 형식이어야 합니다`;
      if (/^\d+$/.test(field)) return `분야 오류: "${p}" → 분야 자리에 숫자가 왔습니다`;
      const mdStr = cp[2]?.trim();
      if (mdStr) {
        if (!/^\d+$/.test(mdStr)) return `MD 오류: "${p}" → MD는 숫자여야 합니다`;
        const md = parseInt(mdStr, 10);
        if (md > maxMd) return `MD 초과: "${p}" → ${md}일은 영업일(${maxMd}일)을 초과합니다`;
      }
    }
    return null;
  };

  const validateProposalScheduleLine = (line: string): string | null => {
    const l = line.trim();
    if (!l) return null;
    const parts = l.split(',').map(s => s.trim());
    if (parts.length < 3) return '쉼표로 구분된 항목이 3개 미만입니다 (단계명, 시작일, 종료일 필수)';
    const [, start, end] = parts;
    if (!/^\d{8}$/.test(start)) return `시작일 형식 오류: "${start}" → YYYYMMDD 8자리`;
    if (!/^\d{8}$/.test(end))   return `종료일 형식 오류: "${end}" → YYYYMMDD 8자리`;
    if (start > end)            return `날짜 오류: 시작일(${start})이 종료일(${end})보다 늦습니다`;
    const maxMd = countBizDaysHoliday(fmt8pd(start), fmt8pd(end));
    for (const p of parts.slice(3)) {
      if (!p) continue;
      const cp = p.split(':');
      if (!cp[0].trim()) return `인력 이름이 비어있습니다: "${p}"`;
      for (let i = 1; i < cp.length; i++) {
        if (cp[i].trim() && !/^\d+$/.test(cp[i].trim()))
          return `MD 값 오류: "${p}" → 콜론 뒤는 숫자만 입력 가능합니다`;
      }
      // 감리일수 추출: 콜론1개→cp[1], 콜론2~3개→cp[2]
      let mdVal: number | null = null;
      if (cp.length === 2) mdVal = parseInt(cp[1], 10);
      else if (cp.length >= 3) mdVal = parseInt(cp[2], 10);
      if (mdVal !== null && !isNaN(mdVal) && mdVal > maxMd)
        return `MD 초과: "${p}" → ${mdVal}일은 영업일(${maxMd}일)을 초과합니다`;
    }
    return null;
  };

  // allowNameOnly: 전문가팀 섹션처럼 이름만 입력해도 되는 경우 true
  const validatePersonLine = (line: string, allowNameOnly = false): string | null => {
    const l = line.trim();
    if (!l) return null;
    // 구분자 없이 이름만 있는 경우
    if (!l.includes(',') && !l.includes(':')) {
      if (allowNameOnly) return null; // 이름만 허용
      return `형식 오류: "${l}" → 이름, 분야 형식이어야 합니다`;
    }
    const sep = l.includes(',') ? ',' : ':';
    const [name, field] = l.split(sep, 2).map(s => s.trim());
    if (!name)  return `이름이 비어있습니다`;
    if (!field) return `분야가 비어있습니다: "${l}"`;
    return null;
  };

  const getInvalidLines = (text: string, validator: (line: string) => string | null): { line: number; msg: string }[] => {
    return text.split('\n').map((line, idx) => {
      const err = validator(line);
      return err ? { line: idx + 1, msg: err } : null;
    }).filter(Boolean) as { line: number; msg: string }[];
  };

  // 제안 모드 텍스트 편집 섹션 상태
  const [proposalScheduleText, setProposalScheduleText] = useState('');
  const [proposalSections, setProposalSections] = useState([
    { label: '감리원', text: '' },
    { label: '핵심기술', text: '' },
    { label: '필수기술', text: '' },
    { label: '보안진단', text: '' },
    { label: '테스트', text: '' },
  ]);
  const updateProposalSection = (idx: number, text: string) => {
    setProposalSections(prev => prev.map((s, i) => i === idx ? { ...s, text } : s));
  };

  // 제안 입력을 기존 형식으로 변환
  // buildProposalPhaseData:
  // - 감리 일정 텍스트: "단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:3, 이름C"
  //   (이름만 있으면 전체 기간, 이름:숫자 면 MD 지정)
  // - 섹션(감리원/전문가): 이름 → 분야 + category 매핑용
  // → 출력: "단계명, YYYYMMDD, YYYYMMDD, 이름A:분야, 이름B:분야:3, 이름C:분야"
  const buildProposalPhaseData = (scheduleText: string, sections: typeof proposalSections) => {
    const sectionDefaultField: Record<string, string> = {
      '감리원': '',
      '핵심기술': '핵심기술',
      '필수기술': '필수기술',
      '보안진단': '보안진단',
      '테스트': '기능테스트',
    };

    // 섹션에서 이름 → { field, category } 맵 구성
    const nameInfo: Record<string, { field: string; category: string }> = {};
    for (const section of sections) {
      if (!section.text.trim()) continue;
      const defaultField = sectionDefaultField[section.label] ?? section.label;
      const category = section.label === '감리원' ? '단계감리팀' : section.label; // 세부 섹션명 보존
      for (const line of section.text.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        let name = '', field = '';
        if (l.includes(',')) {
          [name, field] = l.split(',', 2).map(s => s.trim());
        } else if (l.includes(':')) {
          [name, field] = l.split(':', 2).map(s => s.trim());
        } else {
          name = l.trim();
        }
        if (!field) field = defaultField;
        if (name) nameInfo[name] = { field, category };
      }
    }

    // nameInfo에 있는 모든 인력을 sectionMap에 미리 등록 (일정 텍스트 미등장 인력 포함)
    const sectionMap: Record<string, string> = {};
    for (const [name, info] of Object.entries(nameInfo)) {
      sectionMap[name] = info.category;
    }

    // 감리 일정 텍스트 파싱: 이름 뒤에 분야 삽입, MD 유지
    // MD 파싱 규칙 (예비조사:감리:시정조치확인 형식 지원):
    //   이름          → MD 없음 (전체기간)
    //   이름:5        → 감리일수 5일
    //   이름:2:5      → 감리일수 5일 (두번째값)
    //   이름:2:5:3    → 감리일수 5일 (세번째값 중 두번째=감리)
    const extractMd = (colonParts: string[]): string => {
      const nums = colonParts.slice(1).map(s => s.trim());
      if (nums.length === 0) return '';
      if (nums.length === 1) return /^\d+$/.test(nums[0]) ? nums[0] : ''; // 이름:5
      if (nums.length === 2) return /^\d+$/.test(nums[1]) ? nums[1] : ''; // 이름:예비:감리
      return /^\d+$/.test(nums[1]) ? nums[1] : ''; // 이름:예비:감리:시정 → 감리(두번째)
    };

    const text = scheduleText.trim().split('\n').map(line => {
      const l = line.trim();
      if (!l) return '';
      const parts = l.split(',').map(s => s.trim());
      if (parts.length < 3) return l;
      const header = parts.slice(0, 3);
      const people = parts.slice(3).map(entry => {
        if (!entry) return '';
        const colonParts = entry.split(':');
        const name = colonParts[0].trim();
        const mdStr = extractMd(colonParts);
        const info = nameInfo[name];
        const field = info?.field || '';
        if (field && mdStr) return `${name}:${field}:${mdStr}`;
        if (field) return `${name}:${field}`;
        if (mdStr) return `${name}:${mdStr}`;
        return name;
      }).filter(Boolean);
      return [...header, ...people].join(', ');
    }).filter(Boolean).join('\n');
    return { text, sectionMap };
  };

  // parseTextToProposalForm:
  // - 역파싱: "단계명, YYYYMMDD, YYYYMMDD, 이름A:분야, 이름B:분야:3" →
  //   scheduleText: "단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:3" (분야 제거, MD 유지)
  //   sections: 이름, 분야 (category 기반 섹션 배치)
  const parseTextToProposalForm = (text: string, categoryMap?: Record<string, string>) => {
    const defaultFieldToSection: Record<string, string> = {
      '핵심기술': '핵심기술',
      '필수기술': '필수기술',
      '보안진단': '보안진단',
      '기능테스트': '테스트',
    };

    const sectionPeople: Record<string, Set<string>> = {
      '감리원': new Set(),
      '핵심기술': new Set(),
      '필수기술': new Set(),
      '보안진단': new Set(),
      '테스트': new Set(),
    };
    const nameToField: Record<string, string> = {};
    const scheduleLines: string[] = [];

    for (const line of text.trim().split('\n')) {
      const l = line.trim();
      if (!l) continue;
      const parts = l.split(',').map(s => s.trim());
      if (parts.length < 3) continue;

      const linePeople: string[] = [];
      for (const entry of parts.slice(3)) {
        const ep = entry.split(':');
        const name = ep[0]?.trim();
        if (!name) continue;
        const second = ep[1]?.trim() || '';
        const third = ep[2]?.trim() || '';
        let field = '', mdStr = '';
        if (/^\d+$/.test(second)) {
          mdStr = second; // "이름:숫자"
        } else if (second) {
          field = second; // "이름:분야" or "이름:분야:숫자"
          if (/^\d+$/.test(third)) mdStr = third;
        }
        if (field) nameToField[name] = field;

        // 섹션 배정 (중복 방지: 전체 라인 걸쳐 한 번만)
        if (!Object.values(sectionPeople).some(s => s.has(name))) {
          let targetSection: string;
          if (categoryMap && categoryMap[name]) {
            const cat = categoryMap[name];
            if (cat === '단계감리팀' || cat === '감리팀') {
              targetSection = '감리원';
            } else if (sectionPeople[cat] !== undefined) {
              // category가 세부 섹션명과 일치하면 그대로 사용 (핵심기술, 필수기술, 보안진단, 테스트)
              targetSection = cat;
            } else {
              // fallback: field 패턴 또는 핵심기술
              targetSection = defaultFieldToSection[field] || '핵심기술';
            }
          } else {
            targetSection = defaultFieldToSection[field] || '감리원';
          }
          sectionPeople[targetSection].add(name);
        }

        // scheduleText용: 이름만 or 이름:MD (분야 제거)
        linePeople.push(mdStr ? `${name}:${mdStr}` : name);
      }
      scheduleLines.push([parts[0], parts[1], parts[2], ...linePeople].join(', '));
    }

    // 섹션 텍스트: "이름, 분야" (분야 있으면)
    const makeSectionText = (names: Set<string>, defaultField: string) =>
      [...names].map(name => {
        const field = nameToField[name] || defaultField;
        return field ? `${name}, ${field}` : name;
      }).join('\n');

    return {
      scheduleText: scheduleLines.join('\n'),
      sections: [
        { label: '감리원', text: makeSectionText(sectionPeople['감리원'], '') },
        { label: '핵심기술', text: makeSectionText(sectionPeople['핵심기술'], '핵심기술') },
        { label: '필수기술', text: makeSectionText(sectionPeople['필수기술'], '필수기술') },
        { label: '보안진단', text: makeSectionText(sectionPeople['보안진단'], '보안진단') },
        { label: '테스트', text: makeSectionText(sectionPeople['테스트'], '기능테스트') },
      ],
    };
  };

  // Inline MD editing
  const [editingMd, setEditingMd] = useState<{ staffingId: number; value: string } | null>(null);
  const [savingMd, setSavingMd] = useState(false);

  // Inline person editing
  const [editingPerson, setEditingPerson] = useState<{ staffingId: number; search: string } | null>(null);
  const [savingPerson, setSavingPerson] = useState(false);
  // 인력별 선택된 일정 날짜 (중복 체크용): { person_id → Set<dateStr> }
  // 현재 프로젝트 일정은 제외 (동일 사업 내 중복 허용)
  const [globalPersonDates, setGlobalPersonDates] = useState<Map<number, Set<string>>>(new Map());

  // Close person dropdown on outside click
  useEffect(() => {
    if (!editingPerson) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-person-editor]')) {
        setEditingPerson(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingPerson]);

  // editingPerson 활성화 시 인력별 선택 날짜 로드 (실제 엔트리 기반 중복 체크)
  useEffect(() => {
    if (!editingPerson) return;
    (async () => {
      try {
        // 현재 프로젝트에 배정된 모든 person_id 목록
        const personIds = people.map((p) => p.id).filter(Boolean);
        if (personIds.length === 0) return;
        const res = await client.apiCall.invoke({
          url: '/api/v1/calendar/entries_by_person_ids',
          method: 'POST',
          data: { person_ids: personIds, exclude_project_id: project?.id ?? null },
        }) as { person_dates: Record<string, string[]> };
        const newMap = new Map<number, Set<string>>();
        for (const [pidStr, dates] of Object.entries(res.person_dates || {})) {
          newMap.set(Number(pidStr), new Set(dates));
        }
        setGlobalPersonDates(newMap);
      } catch { /* ignore */ }
    })();
  }, [editingPerson?.staffingId, project?.id]);

  // Collapsible schedule per phase (default: all collapsed)
  const [expandedPhaseSchedules, setExpandedPhaseSchedules] = useState<Set<number>>(new Set());

  // Date sync confirmation dialog
  interface DateSyncPreview {
    phaseId: number;
    phaseName: string;
    newStartDate: string;
    newEndDate: string;
    oldBusinessDays: number;
    newBusinessDays: number;
    exceeding: Array<{ staffing_id: number; person_name: string; field: string; current_md: number; new_business_days: number }>;
    safe: Array<{ staffing_id: number; person_name: string; field: string; current_md: number; new_business_days: number }>;
    pendingPhaseUpdate: Partial<Phase>;
  }
  const [dateSyncPreview, setDateSyncPreview] = useState<DateSyncPreview | null>(null);
  const [applyingDateSync, setApplyingDateSync] = useState(false);

  // ── Presence (동접자 표시) ──
  // showPhaseDialog / showTextEdit / saving 중 하나라도 열리면 'editing' 모드
  const presenceMode = useMemo<'viewing' | 'editing'>(
    () => (showPhaseDialog || showTextEdit || saving ? 'editing' : 'viewing'),
    [showPhaseDialog, showTextEdit, saving],
  );
  const { users: presenceUsers, others: presenceOthers, hasEditor, currentUserId: presenceCurrentUserId } = usePresence({
    pageType: 'project',
    pageId: projectId || null,
    mode: presenceMode,
  });
  // 다른 사람이 열람/수정 중이면 잠금 (점유 방식 — 먼저 연 사람이 우선권)
  // 보는 것은 누구나 가능, 저장/편집 액션만 차단
  // viewer 역할도 읽기 전용 → isLocked와 같은 동작
  const isLocked = presenceOthers.length > 0 || isViewer;

  const togglePhaseSchedule = (phaseId: number) => {
    setExpandedPhaseSchedules((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, phaseRes, staffRes, peopleRes] = await Promise.all([
        client.entities.projects.get({ id: String(projectId) }),
        client.entities.phases.query({ query: { project_id: projectId }, limit: 100, sort: 'sort_order' }),
        client.entities.staffing.query({ query: { project_id: projectId }, limit: 2000 }),
        client.entities.people.query({ query: {}, limit: 500 }),
      ]);
      const proj = projRes?.data;
      setProject(proj || null);
      setEditProject(proj || {});
      setPhases(phaseRes?.data?.items || []);
      const staffItems: Staffing[] = staffRes?.data?.items || [];
      setStaffingList(staffItems);
      setPeople(peopleRes?.data?.items || []);

      const staffingIds = staffItems.map((s) => s.id);
      if (staffingIds.length > 0) {
        try {
          const calRes = await client.apiCall.invoke({
            url: '/api/v1/calendar/by_staffing_ids',
            method: 'POST',
            data: { staffing_ids: staffingIds },
          });
          // client.apiCall.invoke는 이미 res.data를 반환
          setCalendarEntries(calRes?.entries || []);
        } catch {
          setCalendarEntries([]);
        }
      } else {
        setCalendarEntries([]);
      }

      // hat(모자) 데이터 로드
      try {
        const hatRes = await client.apiCall.invoke({
          url: `/api/v1/staffing-hat/by-project/${projectId}`,
          method: 'GET',
        });
        const hats: HatRecord[] = hatRes || [];
        const map = new Map<number, HatRecord>();
        hats.forEach((h) => map.set(h.staffing_id, h));
        setHatMap(map);
      } catch {
        setHatMap(new Map());
      }
    } catch (err) {
      console.error(err);
      toast.error('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const sortedPhases = useMemo(() => {
    return [...phases].sort((a, b) => a.sort_order - b.sort_order);
  }, [phases]);

  const phaseBusinessDays = useMemo(() => {
    const map = new Map<number, number>();
    for (const ph of phases) {
      map.set(ph.id, countBusinessDays(ph.start_date, ph.end_date));
    }
    return map;
  }, [phases]);

  const entriesByStaffing = useMemo(() => {
    const map = new Map<number, CalendarEntry[]>();
    for (const e of calendarEntries) {
      if (!e.status) continue;
      if (!map.has(e.staffing_id)) map.set(e.staffing_id, []);
      map.get(e.staffing_id)!.push(e);
    }
    for (const [, entries] of map) {
      entries.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    }
    return map;
  }, [calendarEntries]);

  const staffingSelectedDays = useMemo(() => {
    const map = new Map<number, number>();
    for (const [sid, entries] of entriesByStaffing) {
      map.set(sid, entries.length);
    }
    return map;
  }, [entriesByStaffing]);

  const expertFirstMention = useMemo(() => {
    const orderMap = new Map<string, number>();
    let idx = 0;
    for (const s of staffingList) {
      const personName = s.person_id
        ? people.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || ''
        : s.person_name_text || '';
      const teamInfo = getTeamInfo(s.field);
      if (teamInfo.sortGroup === 1) {
        const key = `${personName}||${s.field}`;
        if (!orderMap.has(key)) {
          orderMap.set(key, idx++);
        }
      }
    }
    return orderMap;
  }, [staffingList, people]);

  const staffingRows = useMemo(() => {
    const rowMap = new Map<string, StaffingRowData>();
    staffingList.forEach((s) => {
      const personName = s.person_id
        ? people.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || ''
        : s.person_name_text || '';
      const teamInfo = getTeamInfo(s.field);
      // DB category 우선 사용: 단계감리팀/전문가팀/감리팀 → 정규화
      const dbCat = s.category;
      const category =
        dbCat === '단계감리팀' || dbCat === '감리팀' ? '단계감리팀'
        : (dbCat === '전문가팀' || dbCat === '핵심기술' || dbCat === '필수기술' || dbCat === '보안진단' || dbCat === '테스트')
          ? dbCat
          : teamInfo.group;
      const sortGroup = category === '단계감리팀' ? 0 : 1;
      const rowKey = `${category}||${s.field}||${s.sub_field}||${personName}`;

      if (!rowMap.has(rowKey)) {
        const expertOrder = expertFirstMention.get(`${personName}||${s.field}`) ?? 999;
        rowMap.set(rowKey, {
          rowKey,
          category,
          field: s.field,
          sub_field: s.sub_field,
          personName,
          personId: s.person_id,
          phaseMds: {},
          totalMd: 0,
          sortGroup,
          sortOrder: sortGroup === 0 ? teamInfo.sortOrder : expertOrder,
        });
      }
      const row = rowMap.get(rowKey)!;
      row.phaseMds[s.phase_id] = { staffingId: s.id, md: s.md ?? null };
      if (s.md != null) {
        row.totalMd += s.md;
      }
    });

    const rows = Array.from(rowMap.values());
    rows.sort((a, b) => {
      if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
      return a.sortOrder - b.sortOrder;
    });
    return rows;
  }, [staffingList, people, expertFirstMention]);

  const totalProjectMd = staffingList.reduce((sum, s) => sum + (s.md ?? 0), 0);

  const handleSaveProject = async () => {
    if (isLocked) return;
    setSaving(true);
    try {
      await client.entities.projects.update({
        id: String(projectId),
        data: {
          project_name: editProject.project_name,
          organization: editProject.organization,
          status: editProject.status,
          notes: editProject.notes || '',
          updated_at: new Date().toISOString(),
        },
      });
      toast.success('프로젝트 정보가 저장되었습니다.');
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePhase = async () => {
    if (!editingPhase?.phase_name?.trim()) {
      toast.error('단계명을 입력해주세요.');
      return;
    }
    setSavingPhase(true);
    try {
      if (editingPhase.id) {
        // Check if dates changed for an existing phase
        const existingPhase = phases.find((p) => p.id === editingPhase.id);
        const datesChanged = existingPhase && (
          (editingPhase.start_date || '') !== (existingPhase.start_date || '') ||
          (editingPhase.end_date || '') !== (existingPhase.end_date || '')
        );

        const hasStaffing = staffingList.some((s) => s.phase_id === editingPhase.id);

        if (datesChanged && hasStaffing && editingPhase.start_date && editingPhase.end_date) {
          // Preview the impact of date change
          try {
            const previewRes = await client.apiCall.invoke({
              url: '/api/v1/phase_date_sync/preview',
              method: 'POST',
              data: {
                phase_id: editingPhase.id,
                new_start_date: editingPhase.start_date,
                new_end_date: editingPhase.end_date,
              },
            });
            const preview = previewRes;

            if (preview?.exceeding_staffing?.length > 0) {
              // Show confirmation dialog for exceeding staffing
              setDateSyncPreview({
                phaseId: editingPhase.id,
                phaseName: preview.phase_name,
                newStartDate: editingPhase.start_date,
                newEndDate: editingPhase.end_date,
                oldBusinessDays: preview.old_business_days,
                newBusinessDays: preview.new_business_days,
                exceeding: preview.exceeding_staffing,
                safe: preview.safe_staffing,
                pendingPhaseUpdate: {
                  phase_name: editingPhase.phase_name,
                  sort_order: editingPhase.sort_order ?? 0,
                },
              });
              setSavingPhase(false);
              setShowPhaseDialog(false);
              return;
            } else {
              // No exceeding - apply directly
              await client.apiCall.invoke({
                url: '/api/v1/phase_date_sync/apply',
                method: 'POST',
                data: {
                  phase_id: editingPhase.id,
                  new_start_date: editingPhase.start_date,
                  new_end_date: editingPhase.end_date,
                  force: false,
                },
              });
              // Also update phase_name and sort_order
              await client.entities.phases.update({
                id: String(editingPhase.id),
                data: {
                  phase_name: editingPhase.phase_name,
                  sort_order: editingPhase.sort_order ?? 0,
                },
              });
              toast.success('단계 날짜가 변경되고 투입일정이 재생성되었습니다.');
            }
          } catch (err) {
            console.error(err);
            toast.error('날짜 변경 미리보기 중 오류가 발생했습니다.');
            setSavingPhase(false);
            return;
          }
        } else {
          // No date change or no staffing - just update normally
          await client.entities.phases.update({
            id: String(editingPhase.id),
            data: {
              phase_name: editingPhase.phase_name,
              start_date: editingPhase.start_date || null,
              end_date: editingPhase.end_date || null,
              sort_order: editingPhase.sort_order ?? 0,
            },
          });
          toast.success('단계가 수정되었습니다.');
        }
      } else {
        await client.entities.phases.create({
          data: {
            project_id: projectId,
            phase_name: editingPhase.phase_name,
            start_date: editingPhase.start_date || null,
            end_date: editingPhase.end_date || null,
            sort_order: editingPhase.sort_order ?? phases.length + 1,
          },
        });
        toast.success('단계가 추가되었습니다.');
      }
      setShowPhaseDialog(false);
      setEditingPhase(null);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('단계 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingPhase(false);
    }
  };

  const handleDateSyncConfirm = async () => {
    if (!dateSyncPreview) return;
    setApplyingDateSync(true);
    try {
      await client.apiCall.invoke({
        url: '/api/v1/phase_date_sync/apply',
        method: 'POST',
        data: {
          phase_id: dateSyncPreview.phaseId,
          new_start_date: dateSyncPreview.newStartDate,
          new_end_date: dateSyncPreview.newEndDate,
          force: true,
        },
      });
      // Also update phase_name and sort_order
      if (dateSyncPreview.pendingPhaseUpdate) {
        await client.entities.phases.update({
          id: String(dateSyncPreview.phaseId),
          data: dateSyncPreview.pendingPhaseUpdate,
        });
      }
      toast.success('단계 날짜가 변경되고 초과 인력의 공수가 조정되었습니다.');
      setDateSyncPreview(null);
      setEditingPhase(null);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('날짜 변경 적용 중 오류가 발생했습니다.');
    } finally {
      setApplyingDateSync(false);
    }
  };

  const handleDeletePhase = async (phaseId: number) => {
    if (isLocked) return;
    if (!confirm('이 단계를 삭제하시겠습니까? 관련 투입공수 데이터도 삭제됩니다.')) return;
    try {
      const relatedStaffing = staffingList.filter((s) => s.phase_id === phaseId);
      for (const s of relatedStaffing) {
        await client.entities.staffing.delete({ id: String(s.id) });
      }
      await client.entities.phases.delete({ id: String(phaseId) });
      toast.success('단계가 삭제되었습니다.');
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('삭제 중 오류가 발생했습니다.');
    }
  };

  const handleMdCellClick = (staffingId: number, currentMd: number | null) => {
    if (isLocked) return;
    setEditingMd({ staffingId, value: currentMd != null ? String(currentMd) : '' });
  };

  const handleMdSave = async () => {
    if (!editingMd) return;
    const { staffingId, value } = editingMd;
    const newMd = value.trim() === '' ? null : parseInt(value, 10);

    if (newMd !== null && isNaN(newMd)) {
      toast.error('숫자를 입력해주세요.');
      return;
    }
    if (newMd !== null && newMd < 0) {
      toast.error('0 이상의 숫자를 입력해주세요.');
      return;
    }

    if (newMd !== null) {
      const staffItem = staffingList.find((s) => s.id === staffingId);
      if (staffItem) {
        const maxDays = phaseBusinessDays.get(staffItem.phase_id) ?? 999;
        if (newMd > maxDays) {
          toast.error(`해당 단계의 영업일(${maxDays}일)을 초과할 수 없습니다.`);
          return;
        }
      }
    }

    setSavingMd(true);
    try {
      // Use staffing_sync API to update MD and regenerate calendar entries
      const effectiveMd = newMd ?? 0;
      await client.apiCall.invoke({
        url: '/api/v1/staffing_sync/sync_md',
        method: 'POST',
        data: {
          staffing_id: staffingId,
          new_md: effectiveMd,
        },
      });
      // Also update the entity md value (for null case)
      if (newMd === null) {
        await client.entities.staffing.update({
          id: String(staffingId),
          data: { md: null, updated_at: new Date().toISOString() },
        });
      }
      setStaffingList((prev) =>
        prev.map((s) => (s.id === staffingId ? { ...s, md: newMd } : s))
      );
      setEditingMd(null);
      toast.success('공수가 저장되고 일정이 재생성되었습니다.');
      // Refresh calendar entries
      fetchAll();
    } catch (err: unknown) {
      console.error(err);
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      toast.error(detail || '공수 저장에 실패했습니다.');
    } finally {
      setSavingMd(false);
    }
  };

  const handleMdCancel = () => {
    setEditingMd(null);
  };

  const handleMdKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMdSave();
    } else if (e.key === 'Escape') {
      handleMdCancel();
    }
  };

  const handlePersonChange = async (staffingId: number, newPersonId: number | null, newPersonName: string) => {
    setSavingPerson(true);
    try {
      const updateData: Record<string, unknown> = {
        person_id: newPersonId,
        person_name_text: newPersonName,
        updated_at: new Date().toISOString(),
      };
      await client.entities.staffing.update({
        id: String(staffingId),
        data: updateData,
      });
      setStaffingList((prev) =>
        prev.map((s) =>
          s.id === staffingId
            ? { ...s, person_id: newPersonId ?? undefined, person_name_text: newPersonName }
            : s
        )
      );
      setEditingPerson(null);
      toast.success('담당자가 변경되었습니다.');
    } catch (err) {
      console.error(err);
      toast.error('담당자 변경에 실패했습니다.');
    } finally {
      setSavingPerson(false);
    }
  };

  // ── 모자(Hat) 모달 열기 ─────────────────────────────────────
  const openHatModal = (staffingIds: number[]) => {
    const draft = new Map<number, string>();
    staffingIds.forEach((sid) => {
      draft.set(sid, hatMap.get(sid)?.actual_person_name || '');
    });
    setHatDraft(draft);
    setHatModalStaffingIds(staffingIds);
    setHatModalOpen(true);
  };

  // ── 모자 저장 ────────────────────────────────────────────────
  const handleSaveHat = async () => {
    setSavingHat(true);
    try {
      const toUpsert: { staffing_id: number; actual_person_name: string; actual_person_id: number | null }[] = [];
      const toDelete: number[] = [];

      hatModalStaffingIds.forEach((sid) => {
        const name = (hatDraft.get(sid) || '').trim();
        if (name) {
          // 이름이 있으면 upsert
          const matchedPerson = people.find((p) => p.person_name === name);
          toUpsert.push({
            staffing_id: sid,
            actual_person_name: name,
            actual_person_id: matchedPerson?.id ?? null,
          });
        } else if (hatMap.has(sid)) {
          // 비워두면 해제
          toDelete.push(sid);
        }
      });

      // upsert
      if (toUpsert.length > 0) {
        const res = await client.apiCall.invoke({
          url: '/api/v1/staffing-hat/batch',
          method: 'POST',
          data: toUpsert,
        });
        const newHats: HatRecord[] = res || [];
        setHatMap((prev) => {
          const next = new Map(prev);
          newHats.forEach((h) => next.set(h.staffing_id, h));
          return next;
        });
      }

      // delete
      for (const sid of toDelete) {
        await client.apiCall.invoke({
          url: `/api/v1/staffing-hat/by-staffing/${sid}`,
          method: 'DELETE',
        });
        setHatMap((prev) => {
          const next = new Map(prev);
          next.delete(sid);
          return next;
        });
      }

      setHatModalOpen(false);
      toast.success('모자(대체인력) 정보가 저장되었습니다.');
    } catch (err) {
      console.error(err);
      toast.error('저장에 실패했습니다.');
    } finally {
      setSavingHat(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/project_import/export/${projectId}`,
        method: 'GET',
      });
      // client.apiCall.invoke는 이미 res.data를 반환하므로 .data 중복 접근 불필요
      setExportText(res?.text || '');
      setExportActualText(res?.actual_text || '');
      setExportHasHat(res?.has_hat || false);
      setShowExportDialog(true);
    } catch (err) {
      console.error(err);
      toast.error('텍스트 내보내기 중 오류가 발생했습니다.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleCopyExport = () => {
    navigator.clipboard.writeText(exportText).then(() => {
      toast.success('클립보드에 복사되었습니다.');
    }).catch(() => {
      toast.error('복사에 실패했습니다.');
    });
  };

  const handleDownloadExport = () => {
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.project_name || 'project'}_export.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('파일이 다운로드되었습니다.');
  };

  const [cleaningUp, setCleaningUp] = useState(false);

  const handleCleanupStaffing = async () => {
    if (!confirm('인력 매핑을 재정리합니다.\n- 내부 인력 이름과 일치하는 외부 인력을 내부로 재매핑\n- 중복 투입공수 항목 제거\n\n계속하시겠습니까?')) return;
    setCleaningUp(true);
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/staffing_cleanup/remap_and_dedup/${projectId}`,
        method: 'POST',
      });
      toast.success(res?.message || '정리가 완료되었습니다.');
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('인력 정리 중 오류가 발생했습니다.');
    } finally {
      setCleaningUp(false);
    }
  };

  const handleOpenTextEdit = async () => {
    setTextEditLoading(true);
    setShowTextEdit(true);
    try {
      const res = await client.apiCall.invoke({
        url: `/api/v1/project_import/export/${projectId}`,
        method: 'GET',
      });
      const text = res?.text || '';
      setTextEditContent(text);
      // 제안 모드이면 폼으로 역파싱 (section_map 활용으로 정확한 섹션 복원)
      if (project?.status === '제안' && text) {
        const categoryMap: Record<string, string> = res?.section_map || {};
        const parsed = parseTextToProposalForm(text, categoryMap);
        setProposalScheduleText(parsed.scheduleText);
        setProposalSections(parsed.sections);
      }
    } catch (err) {
      console.error(err);
      setTextEditContent('');
      toast.error('현재 단계 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setTextEditLoading(false);
    }
  };

  const handleTextEditSave = async () => {
    // 제안 모드: proposalScheduleText + sections → 변환
    const isProposal = project?.status === '제안';
    const proposalData = isProposal
      ? buildProposalPhaseData(proposalScheduleText, proposalSections)
      : null;
    const finalText = isProposal
      ? (proposalData?.text ?? '')
      : textEditContent.trim();

    if (!finalText) {
      toast.error('텍스트를 입력해주세요.');
      return;
    }
    if (!confirm('기존 모든 단계, 투입공수, 일정 데이터가 삭제되고 새로 생성됩니다. 계속하시겠습니까?')) {
      return;
    }
    setTextEditSaving(true);
    try {
      const res = await client.apiCall.invoke({
        url: '/api/v1/project_import/overwrite_phases',
        method: 'POST',
        data: {
          project_id: projectId,
          text: finalText,
          ...(isProposal && proposalData?.sectionMap ? { section_map: proposalData.sectionMap } : {}),
        },
      });
      toast.success(res?.message || '단계가 덮어쓰기되었습니다.');
      setShowTextEdit(false);
      setTextEditContent('');
      setProposalScheduleText('');
      setProposalSections([
        { label: '감리원', text: '' },
        { label: '핵심기술', text: '' },
        { label: '필수기술', text: '' },
        { label: '보안진단', text: '' },
        { label: '테스트', text: '' },
      ]);
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('단계 덮어쓰기 중 오류가 발생했습니다.');
    } finally {
      setTextEditSaving(false);
    }
  };

  const statusBadge = (status: string) => {
    const config: Record<string, string> = {
      '감리': 'bg-blue-100 text-blue-700 hover:bg-blue-100',
      '제안': 'bg-amber-100 text-amber-700 hover:bg-amber-100',
    };
    return <Badge className={config[status] || ''}>{status}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">프로젝트를 찾을 수 없습니다.</p>
      </div>
    );
  }

  let prevGroup = -1;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <header className="bg-white border-b shadow-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/?tab=projects')}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              목록
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-slate-800 truncate">{project.project_name}</h1>
              {/* 동접자 배지 */}
              <PresenceBadges users={presenceUsers} currentUserId={presenceCurrentUserId} className="mt-0.5" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCleanupStaffing} disabled={cleaningUp}>
                <UserCheck className="h-4 w-4 mr-1" />
                {cleaningUp ? '정리 중...' : '인력 재매핑'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exportLoading}>
                <FileText className="h-4 w-4 mr-1" />
                {exportLoading ? '내보내는 중...' : '텍스트 내보내기'}
              </Button>
              {statusBadge(project.status)}
              {isViewer && <Lock className="h-4 w-4 text-blue-500" title="조회 전용 계정 (뷰어)" />}
              {!isViewer && presenceOthers.length > 0 && <Lock className="h-4 w-4 text-amber-500" title="다른 사용자가 수정 중" />}
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* 수정 중인 사람 경고 배너 */}
          <PresenceWarningBanner users={presenceUsers} currentUserId={presenceCurrentUserId} />

          {/* Project Info Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">프로젝트 기본정보</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <Label>프로젝트명</Label>
                  <Input
                    value={editProject.project_name || ''}
                    onChange={(e) => setEditProject({ ...editProject, project_name: e.target.value })}
                    disabled={isLocked}
                  />
                </div>
                <div>
                  <Label>기관명</Label>
                  <Input
                    value={editProject.organization || ''}
                    onChange={(e) => setEditProject({ ...editProject, organization: e.target.value })}
                    disabled={isLocked}
                  />
                </div>
                <div>
                  <Label>상태</Label>
                  <Select
                    value={editProject.status || '감리'}
                    onValueChange={(v) => setEditProject({ ...editProject, status: v })}
                    disabled={isLocked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="감리">감리</SelectItem>
                      <SelectItem value="제안">제안</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>비고</Label>
                  <Input
                    value={editProject.notes || ''}
                    onChange={(e) => setEditProject({ ...editProject, notes: e.target.value })}
                    disabled={isLocked}
                  />
                </div>
                <div className="flex items-end">
                  <div className="text-sm">
                    <span className="text-muted-foreground">프로젝트 총 MD: </span>
                    <span className="font-bold text-lg text-blue-600">{totalProjectMd}</span>
                  </div>
                </div>
              </div>
              {!isLocked && (
                <div className="mt-4">
                  <Button onClick={handleSaveProject} disabled={saving} size="sm">
                    <Save className="h-4 w-4 mr-1" />
                    {saving ? '저장 중...' : '저장'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phases Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">단계 (Phases)</CardTitle>
                {!isLocked && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleOpenTextEdit}>
                      <FileText className="h-4 w-4 mr-1" />
                      텍스트로 단계 편집
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingPhase({ phase_name: '', start_date: '', end_date: '', sort_order: phases.length + 1 });
                        setShowPhaseDialog(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      단계 추가
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">순서</TableHead>
                    <TableHead>단계명</TableHead>
                    <TableHead>시작일</TableHead>
                    <TableHead>종료일</TableHead>
                    <TableHead className="text-center">영업일</TableHead>
                    <TableHead className="text-center">투입인력</TableHead>
                    <TableHead>선택된 일정</TableHead>
                    {!isLocked && <TableHead className="w-20">작업</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPhases.map((phase) => {
                    const phaseStaffing = staffingList.filter((s) => s.phase_id === phase.id);
                    const staffCount = phaseStaffing.length;
                    const totalPhaseMd = phaseStaffing.reduce((sum, s) => sum + (s.md ?? 0), 0);
                    const bizDays = phaseBusinessDays.get(phase.id) ?? 0;

                    const personDateMap = new Map<string, string[]>();
                    for (const s of phaseStaffing) {
                      const entries = entriesByStaffing.get(s.id) || [];
                      if (entries.length === 0) continue;
                      const personName = s.person_id
                        ? people.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || '?'
                        : s.person_name_text || '?';
                      personDateMap.set(personName, entries.map((e) => e.entry_date));
                    }

                    const isExpanded = expandedPhaseSchedules.has(phase.id);
                    const hasScheduleData = personDateMap.size > 0;
                    const totalSelectedDays = Array.from(personDateMap.values()).reduce((sum, dates) => sum + dates.length, 0);

                    return (
                      <TableRow key={phase.id}>
                        <TableCell className="text-center">{phase.sort_order}</TableCell>
                        <TableCell className="font-medium">{phase.phase_name}</TableCell>
                        <TableCell>{phase.start_date || '-'}</TableCell>
                        <TableCell>{phase.end_date || '-'}</TableCell>
                        <TableCell className="text-center text-xs font-semibold text-slate-600">
                          {bizDays < 999 ? `${bizDays}일` : '-'}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          <span className="text-muted-foreground">{staffCount}명</span>
                          <span className="mx-1">·</span>
                          <span className="font-semibold text-blue-600">{totalPhaseMd}MD</span>
                        </TableCell>
                        <TableCell className="text-xs max-w-[300px]">
                          {hasScheduleData ? (
                            <div>
                              {/* Collapsed summary - clickable to expand */}
                              <button
                                onClick={() => togglePhaseSchedule(phase.id)}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                )}
                                <CalendarDays className="h-3 w-3 flex-shrink-0" />
                                <span className="font-medium">
                                  {personDateMap.size}명 · {totalSelectedDays}일 선택됨
                                </span>
                              </button>
                              {/* Expanded detail */}
                              {isExpanded && (
                                <div className="mt-1 space-y-0.5 pl-4 border-l-2 border-blue-200">
                                  {Array.from(personDateMap.entries()).map(([name, dates]) => (
                                    <Tooltip key={name}>
                                      <TooltipTrigger asChild>
                                        <div className="flex items-center gap-1 cursor-default">
                                          <span className="font-medium text-slate-700">{name}</span>
                                          <span className="text-blue-600 font-semibold">({dates.length}일)</span>
                                          <span className="text-muted-foreground truncate">
                                            {dates.map(shortDate).join(', ')}
                                          </span>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" className="max-w-sm">
                                        <p className="font-semibold mb-1">{name} - 선택된 투입일</p>
                                        <p className="text-xs">{dates.join(', ')}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">일정 미선택</span>
                          )}
                        </TableCell>
                        {!isLocked && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingPhase({ ...phase });
                                  setShowPhaseDialog(true);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDeletePhase(phase.id)}>
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {sortedPhases.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isLocked ? 7 : 8} className="text-center text-muted-foreground py-8">
                        등록된 단계가 없습니다.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Staffing Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">투입공수 원장 (Staffing)</CardTitle>
                <p className="text-[10px] text-muted-foreground">
                  💡 공수(MD) 셀 클릭 → 수정 | 영업일 초과 불가 | 실제 투입일은 일정 탭에서 선택
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-white z-10 min-w-[90px]">구분</TableHead>
                      <TableHead className="min-w-[120px]">담당분야</TableHead>
                      <TableHead className="min-w-[80px]">인력명</TableHead>
                      {sortedPhases.map((phase) => {
                        const bizDays = phaseBusinessDays.get(phase.id) ?? 0;
                        return (
                          <TableHead key={phase.id} className="text-center min-w-[90px]">
                            <div className="leading-tight text-xs">{phase.phase_name}</div>
                            <div className="text-[9px] text-muted-foreground font-normal">
                              ({bizDays < 999 ? `${bizDays}일` : '-'})
                            </div>
                          </TableHead>
                        );
                      })}
                      <TableHead className="text-center min-w-[60px] font-bold">합계</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffingRows.map((row) => {
                      const showGroupHeader = row.sortGroup !== prevGroup;
                      prevGroup = row.sortGroup;

                      return (
                        <>
                          {showGroupHeader && (
                            <TableRow key={`group-${row.sortGroup}`} className="bg-slate-100">
                              <TableCell
                                colSpan={3 + sortedPhases.length + 1}
                                className="text-xs font-bold text-slate-600 py-1.5 sticky left-0 bg-slate-100 z-10"
                              >
                                {row.sortGroup === 0 ? '📋 단계감리팀' : '🔧 전문가팀'}
                              </TableCell>
                            </TableRow>
                          )}
                          <TableRow key={row.rowKey}>
                            <TableCell className="sticky left-0 bg-white z-10 text-xs font-medium">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                row.sortGroup === 0
                                  ? 'border-blue-300 text-blue-700 bg-blue-50'
                                  : 'border-green-300 text-green-700 bg-green-50'
                              }`}>
                                {row.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{row.field}</TableCell>
                            <TableCell className="text-xs font-medium relative">
                              {/* 🎩 모자 버튼 — 해당 row의 모든 staffingId 전달 */}
                              {!isLocked && (() => {
                                const rowStaffingIds = Object.values(row.phaseMds).map((v) => v.staffingId);
                                const hasHat = rowStaffingIds.some((sid) => hatMap.has(sid));
                                return (
                                  <button
                                    onClick={() => openHatModal(rowStaffingIds)}
                                    title={hasHat ? '모자(대체인력) 있음 — 클릭하여 수정' : '모자(대체인력) 씌우기'}
                                    className={`absolute right-0 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 transition-colors ${
                                      hasHat ? 'text-orange-500' : 'text-slate-300 hover:text-slate-500'
                                    }`}
                                  >
                                    <HardHat className="h-3.5 w-3.5" />
                                  </button>
                                );
                              })()}
                              {(() => {
                                // Find any staffing ID for this row to use for editing
                                const firstStaffingId = Object.values(row.phaseMds)[0]?.staffingId;
                                const isEditingThisRow = editingPerson?.staffingId === firstStaffingId;

                                if (firstStaffingId && !isLocked) {
                                  // ── row가 속한 phase들의 전체 영업일 합집합 계산 ──
                                  const rowPhaseIds = Object.keys(row.phaseMds).map(Number);
                                  const phaseBizDates = new Set<string>();
                                  for (const phId of rowPhaseIds) {
                                    const ph = phases.find((p) => p.id === phId);
                                    if (!ph?.start_date || !ph?.end_date) continue;
                                    let cur = new Date(ph.start_date + 'T00:00:00');
                                    const endD = new Date(ph.end_date + 'T00:00:00');
                                    while (cur <= endD) {
                                      const y = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
                                      if (!isNonWorkday(y, m, d)) {
                                        phaseBizDates.add(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
                                      }
                                      cur.setDate(cur.getDate() + 1);
                                    }
                                  }
                                  const totalPhaseDays = phaseBizDates.size;

                                  // ── 투입가능일수 계산: phase 영업일 중 타사업에 이미 투입된 날짜를 제외 ──
                                  // partialAvailMap: personId → 투입가능일수
                                  //   - map에 없음 → 전체 가능 (표기 없음)
                                  //   - map에 있고 값>0 → 일부 가능 → "(N일 가능)" 표기
                                  //   - map에 있고 값=0 → 완전 불가 → "(투입 불가)" 표기
                                  const partialAvailMap = new Map<number, number>();
                                  if (totalPhaseDays > 0 && globalPersonDates.size > 0) {
                                    for (const [personId, otherDates] of globalPersonDates.entries()) {
                                      if (otherDates.size === 0) continue;
                                      let overlapCount = 0;
                                      for (const d of phaseBizDates) {
                                        if (otherDates.has(d)) overlapCount++;
                                      }
                                      if (overlapCount > 0) {
                                        const availDays = Math.max(0, totalPhaseDays - overlapCount);
                                        partialAvailMap.set(personId, availDays);
                                      }
                                    }
                                  }

                                  return (
                                    <PersonComboboxInline
                                      currentPersonId={row.personId}
                                      currentPersonName={row.personName}
                                      isExternal={!row.personId && !!row.personName}
                                      allPeople={people}
                                      partialAvailMap={totalPhaseDays > 0 ? partialAvailMap : undefined}
                                      disabled={savingPerson}
                                      onChange={(pid, pname) => {
                                        const staffingIds = Object.values(row.phaseMds).map((v) => v.staffingId);
                                        staffingIds.forEach((sid) => handlePersonChange(sid, pid, pname));
                                      }}
                                      onCancel={() => setEditingPerson(null)}
                                    />
                                  );
                                }

                                return (
                                  <span
                                    className="text-left text-gray-500 cursor-not-allowed"
                                    title="클릭하여 담당자 변경 (잠금 해제 필요)"
                                  >
                                    {row.personName}
                                    {!row.personId && row.personName && (
                                      <span className="text-amber-500 ml-1" title="미연결 인력">(외부)</span>
                                    )}
                                  </span>
                                );
                              })()}
                            </TableCell>
                            {sortedPhases.map((phase) => {
                              const cell = row.phaseMds[phase.id];
                              const mdVal = cell?.md;
                              const staffingId = cell?.staffingId;
                              const isEditing = editingMd?.staffingId === staffingId;
                              const bizDays = phaseBusinessDays.get(phase.id) ?? 999;
                              const selectedDays = staffingId ? (staffingSelectedDays.get(staffingId) || 0) : 0;
                              const entries = staffingId ? (entriesByStaffing.get(staffingId) || []) : [];

                              if (!cell) {
                                return (
                                  <TableCell key={phase.id} className="text-center text-xs bg-gray-50 text-gray-300">
                                    -
                                  </TableCell>
                                );
                              }

                              if (isEditing && staffingId) {
                                return (
                                  <TableCell key={phase.id} className="text-center p-0">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={bizDays < 999 ? bizDays : undefined}
                                      value={editingMd.value}
                                      onChange={(e) => setEditingMd({ staffingId, value: e.target.value })}
                                      onKeyDown={handleMdKeyDown}
                                      autoFocus
                                      disabled={savingMd}
                                      className="h-7 w-16 text-center text-xs border-blue-400 focus:ring-blue-400"
                                    />
                                    <div className="flex justify-center gap-0.5 mt-0.5">
                                      <button
                                        onMouseDown={(e) => { e.preventDefault(); handleMdSave(); }}
                                        disabled={savingMd}
                                        className="text-[10px] px-1.5 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 leading-none"
                                      >
                                        {savingMd ? '…' : '저장'}
                                      </button>
                                      <button
                                        onMouseDown={(e) => { e.preventDefault(); handleMdCancel(); }}
                                        className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 leading-none"
                                      >
                                        취소
                                      </button>
                                    </div>
                                  </TableCell>
                                );
                              }

                              return (
                                <TableCell
                                  key={phase.id}
                                  className={`text-center text-xs cursor-pointer hover:bg-blue-50 transition-colors ${
                                    mdVal === null || mdVal === undefined
                                      ? 'bg-amber-50 text-amber-400 italic'
                                      : mdVal > 0
                                      ? 'font-semibold'
                                      : ''
                                  }`}
                                  onClick={() => staffingId && handleMdCellClick(staffingId, mdVal ?? null)}
                                  title={`클릭하여 공수 수정 (최대 ${bizDays < 999 ? bizDays : '∞'}일)\n선택된 일정: ${selectedDays}일${entries.length > 0 ? '\n' + entries.map((e) => e.entry_date).join(', ') : ''}`}
                                >
                                  <div>
                                    {mdVal != null ? mdVal : '-'}
                                    {selectedDays > 0 && (
                                      <div className="text-[9px] text-green-600 font-normal">
                                        📅{selectedDays}일
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center text-xs font-bold text-blue-600">{row.totalMd}</TableCell>
                          </TableRow>
                        </>
                      );
                    })}
                    {staffingRows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3 + sortedPhases.length + 1}
                          className="text-center text-muted-foreground py-8"
                        >
                          투입공수 데이터가 없습니다. 텍스트로 단계를 편집하면 자동 생성됩니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </main>

        {/* Phase Dialog */}
        <Dialog open={showPhaseDialog} onOpenChange={setShowPhaseDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingPhase?.id ? '단계 수정' : '단계 추가'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>단계명 *</Label>
                <Input
                  value={editingPhase?.phase_name || ''}
                  onChange={(e) => setEditingPhase({ ...editingPhase, phase_name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>시작일</Label>
                  <Input
                    type="date"
                    value={editingPhase?.start_date || ''}
                    onChange={(e) => setEditingPhase({ ...editingPhase, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>종료일</Label>
                  <Input
                    type="date"
                    value={editingPhase?.end_date || ''}
                    onChange={(e) => setEditingPhase({ ...editingPhase, end_date: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>정렬순서</Label>
                <Input
                  type="number"
                  value={editingPhase?.sort_order ?? ''}
                  onChange={(e) => setEditingPhase({ ...editingPhase, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPhaseDialog(false)}>취소</Button>
              <Button onClick={handleSavePhase} disabled={savingPhase}>
                {savingPhase ? '저장 중...' : '저장'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Text Export Dialog */}
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
          <DialogContent className={`max-h-[90vh] overflow-y-auto ${exportHasHat ? 'max-w-5xl' : 'max-w-2xl'}`}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                텍스트 내보내기
              </DialogTitle>
            </DialogHeader>

            {exportHasHat ? (
              /* ── 모자 있는 경우: 좌우 분할 ── */
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  🎩 대체인력이 있습니다. 공식 버전과 실제 버전을 확인하세요. 주황색 줄은 대체인력이 적용된 라인입니다.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {/* 공식 버전 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">📄 공식 버전 (기관 제출용)</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                          onClick={() => { navigator.clipboard.writeText(exportText); toast.success('공식 버전 복사됨'); }}>
                          <Copy className="h-3 w-3 mr-1" />복사
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                          onClick={() => { const b = new Blob([exportText], { type: 'text/plain;charset=utf-8' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${project?.project_name || 'project'}_공식.txt`; a.click(); URL.revokeObjectURL(u); }}>
                          <Download className="h-3 w-3 mr-1" />저장
                        </Button>
                      </div>
                    </div>
                    <div className="border rounded-md overflow-hidden font-mono text-xs bg-white">
                      {exportText.split('\n').map((line, i) => (
                        <div key={i} className="px-3 py-0.5 border-b border-slate-50 last:border-b-0 whitespace-pre-wrap break-all leading-5">
                          {line || <span className="text-slate-200">—</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 실제 버전 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-orange-600">🎩 실제 버전 (내부 관리용)</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-orange-300 text-orange-700 hover:bg-orange-50"
                          onClick={() => { navigator.clipboard.writeText(exportActualText); toast.success('실제 버전 복사됨'); }}>
                          <Copy className="h-3 w-3 mr-1" />복사
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-orange-300 text-orange-700 hover:bg-orange-50"
                          onClick={() => { const b = new Blob([exportActualText], { type: 'text/plain;charset=utf-8' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${project?.project_name || 'project'}_실제.txt`; a.click(); URL.revokeObjectURL(u); }}>
                          <Download className="h-3 w-3 mr-1" />저장
                        </Button>
                      </div>
                    </div>
                    <div className="border border-orange-100 rounded-md overflow-hidden font-mono text-xs bg-white">
                      {(() => {
                        const officialLines = exportText.split('\n');
                        const actualLines = exportActualText.split('\n');
                        return actualLines.map((line, i) => {
                          const changed = line !== officialLines[i];
                          return (
                            <div
                              key={i}
                              className={`px-3 py-0.5 border-b border-slate-50 last:border-b-0 whitespace-pre-wrap break-all leading-5 ${
                                changed ? 'bg-orange-50 text-orange-800 font-semibold' : ''
                              }`}
                            >
                              {line || <span className="text-slate-200">—</span>}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* ── 모자 없는 경우: 기존 단일 뷰 ── */
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  아래 텍스트를 복사하여 다른 프로젝트에 붙여넣거나 백업할 수 있습니다.
                </p>
                <Textarea
                  value={exportText}
                  readOnly
                  rows={12}
                  className="font-mono text-xs"
                />
              </div>
            )}

            <DialogFooter>
              {!exportHasHat && (
                <>
                  <Button variant="outline" onClick={handleDownloadExport}>
                    <Download className="h-4 w-4 mr-1" />
                    파일 다운로드
                  </Button>
                  <Button onClick={handleCopyExport}>
                    <Copy className="h-4 w-4 mr-1" />
                    클립보드 복사
                  </Button>
                </>
              )}
              {exportHasHat && (
                <Button variant="outline" onClick={() => setShowExportDialog(false)}>
                  닫기
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Text Edit Dialog (overwrite phases) */}
        <Dialog open={showTextEdit} onOpenChange={setShowTextEdit}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                텍스트로 단계 편집
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                <p className="text-xs text-amber-800 font-semibold">
                  ⚠️ 저장 시 기존 모든 단계, 투입공수, 일정 데이터가 삭제되고 아래 텍스트 기준으로 새로 생성됩니다.
                </p>
              </div>

              {textEditLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  현재 단계 정보를 불러오는 중...
                </div>
              ) : project?.status === '제안' ? (
                /* ── 제안 모드 ── */
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">제안서 일정과 인력을 수정하세요.</p>
                  {/* 감리 일정 */}
                  {(() => {
                    const errs = proposalScheduleText.trim() ? getInvalidLines(proposalScheduleText, validateProposalScheduleLine) : [];
                    return (
                      <div>
                        <label className="text-xs font-medium text-slate-700">📅 감리 일정</label>
                        <p className="text-[10px] text-slate-500 mb-1">
                          형식: 단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:5, 이름C:0:5:0<br/>
                          • 이름만 → 전체기간 &nbsp;• 이름:5 → 감리 5일 &nbsp;• 이름:예비:감리:시정 → 감리일수만 사용
                        </p>
                        <Textarea
                          value={proposalScheduleText}
                          onChange={(e) => setProposalScheduleText(e.target.value)}
                          placeholder={`설계-정밀진단, 20260323, 20260327, 강혁, 김현선, 최규택:3\n설계-재검증, 20260427, 20260501, 강혁, 김현선, 최규택, 양권묵:2`}
                          rows={3}
                          className={`font-mono text-xs ${errs.length > 0 ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                        {errs.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {errs.map(e => (
                              <p key={e.line} className="text-[10px] text-red-600">⚠ {e.line}행: {e.msg}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* 인력 섹션 */}
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      const errs = proposalSections[0].text.trim() ? getInvalidLines(proposalSections[0].text, validatePersonLine) : [];
                      return (
                        <div className="col-span-2">
                          <label className="text-xs font-medium text-slate-700">👤 감리원</label>
                          <p className="text-[10px] text-slate-500 mb-1">형식: 이름, 분야</p>
                          <Textarea
                            value={proposalSections[0].text}
                            onChange={(e) => updateProposalSection(0, e.target.value)}
                            placeholder={`강혁, 사업관리 및 품질보증\n김현선, 응용시스템`}
                            rows={4}
                            className={`font-mono text-xs ${errs.length > 0 ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                          {errs.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {errs.map(e => (
                                <p key={e.line} className="text-[10px] text-red-600">⚠ {e.line}행: {e.msg}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {proposalSections.slice(1).map((section, i) => {
                      const errs = section.text.trim() ? getInvalidLines(section.text, (line) => validatePersonLine(line, true)) : [];
                      return (
                        <div key={section.label}>
                          <label className="text-xs font-medium text-slate-700">🔹 전문가 - {section.label}</label>
                          <Textarea
                            value={section.text}
                            onChange={(e) => updateProposalSection(i + 1, e.target.value)}
                            placeholder="이름, 분야"
                            rows={3}
                            className={`font-mono text-xs mt-1 ${errs.length > 0 ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                          {errs.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {errs.map(e => (
                                <p key={e.line} className="text-[10px] text-red-600">⚠ {e.line}행: {e.msg}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* ── 감리 모드 ── */
                <>
                  <div className="bg-slate-50 rounded-md p-3">
                    <p className="text-[11px] text-slate-600 font-mono leading-relaxed">
                      <strong>형식:</strong> 단계명, 시작일(YYYYMMDD), 종료일(YYYYMMDD), 인력1:분야[:MD], 인력2:분야[:MD], ...
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      • <strong>이현우:사업관리</strong> → MD 미지정 시 해당 단계 전체 영업일 투입
                    </p>
                    <p className="text-[10px] text-slate-500">
                      • <strong>강진욱:SW개발보안:4</strong> → 해당 단계 중 4일만 투입
                    </p>
                  </div>
                  {(() => {
                    const errs = textEditContent.trim() ? getInvalidLines(textEditContent, validateAuditLine) : [];
                    return (
                      <>
                        <Textarea
                          value={textEditContent}
                          onChange={(e) => setTextEditContent(e.target.value)}
                          placeholder={`요구정의, 20250224, 20250228, 이현우:사업관리 및 품질보증, 차판용:응용시스템\n개략설계, 20250421, 20250430, 이현우:사업관리 및 품질보증, 강진욱:SW개발보안:4`}
                          rows={14}
                          className={`font-mono text-xs ${errs.length > 0 ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                        {errs.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {errs.map(e => (
                              <p key={e.line} className="text-[10px] text-red-600">⚠ {e.line}행: {e.msg}</p>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTextEdit(false)} disabled={textEditSaving}>
                취소
              </Button>
              <Button
                onClick={handleTextEditSave}
                disabled={textEditSaving || textEditLoading || (() => {
                  if (project?.status === '제안') {
                    const schedErrs = proposalScheduleText.trim() ? getInvalidLines(proposalScheduleText, validateProposalScheduleLine) : [];
                    const secErrs = proposalSections.flatMap((s, si) => s.text.trim() ? getInvalidLines(s.text, (line) => validatePersonLine(line, si > 0)) : []);
                    return schedErrs.length > 0 || secErrs.length > 0;
                  } else {
                    return textEditContent.trim() ? getInvalidLines(textEditContent, validateAuditLine).length > 0 : false;
                  }
                })()}
                variant="destructive"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${textEditSaving ? 'animate-spin' : ''}`} />
                {textEditSaving ? '덮어쓰는 중...' : '전체 덮어쓰기'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Date Sync Confirmation Dialog */}
        <Dialog open={!!dateSyncPreview} onOpenChange={(open) => { if (!open) setDateSyncPreview(null); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                투입공수 초과 경고
              </DialogTitle>
            </DialogHeader>
            {dateSyncPreview && (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                  <p className="text-sm font-semibold text-amber-800">
                    단계 &quot;{dateSyncPreview.phaseName}&quot;의 날짜가 변경됩니다.
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    새 기간: {dateSyncPreview.newStartDate} ~ {dateSyncPreview.newEndDate}
                    (영업일: {dateSyncPreview.oldBusinessDays}일 → <strong>{dateSyncPreview.newBusinessDays}일</strong>)
                  </p>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-xs font-bold text-red-700 mb-2">
                    ⚠️ 아래 인력의 투입공수가 새 영업일({dateSyncPreview.newBusinessDays}일)을 초과합니다:
                  </p>
                  <div className="space-y-1">
                    {dateSyncPreview.exceeding.map((s) => (
                      <div key={s.staffing_id} className="flex items-center justify-between text-xs">
                        <span className="font-medium text-red-800">
                          {s.person_name} ({s.field})
                        </span>
                        <span className="text-red-600">
                          현재 <strong>{s.current_md}일</strong> → <strong>{dateSyncPreview.newBusinessDays}일</strong>로 축소
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {dateSyncPreview.safe.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-md p-3">
                    <p className="text-xs font-bold text-green-700 mb-2">
                      ✅ 아래 인력은 정상 범위 내입니다 (시작일부터 연속 배치):
                    </p>
                    <div className="space-y-1">
                      {dateSyncPreview.safe.map((s) => (
                        <div key={s.staffing_id} className="flex items-center justify-between text-xs">
                          <span className="font-medium text-green-800">
                            {s.person_name} ({s.field})
                          </span>
                          <span className="text-green-600">
                            {s.current_md}일 유지
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-slate-50 border rounded-md p-3">
                  <p className="text-[11px] text-slate-600">
                    <strong>확인을 누르면:</strong>
                  </p>
                  <ul className="text-[11px] text-slate-600 mt-1 space-y-0.5 list-disc list-inside">
                    <li>초과 인력의 투입공수(MD)가 새 영업일({dateSyncPreview.newBusinessDays}일)로 축소됩니다.</li>
                    <li>모든 인력의 기존 투입일정이 초기화되고, 시작일부터 연속으로 재배치됩니다.</li>
                    <li>비연속적으로 선택된 기존 일정은 초기화됩니다.</li>
                  </ul>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDateSyncPreview(null)} disabled={applyingDateSync}>
                취소
              </Button>
              <Button
                onClick={handleDateSyncConfirm}
                disabled={applyingDateSync}
                variant="destructive"
              >
                <AlertTriangle className={`h-4 w-4 mr-1 ${applyingDateSync ? 'animate-pulse' : ''}`} />
                {applyingDateSync ? '적용 중...' : '확인 (공수 축소 및 일정 재생성)'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── 🎩 모자(대체인력) 모달 ────────────────────────────────── */}
        <Dialog open={hatModalOpen} onOpenChange={(o) => { if (!savingHat) setHatModalOpen(o); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <HardHat className="h-5 w-5 text-orange-500" />
                대체인력(모자) 관리
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
              {hatModalStaffingIds.map((sid) => {
                const staffing = staffingList.find((s) => s.id === sid);
                if (!staffing) return null;
                const phase = phases.find((p) => p.id === staffing.phase_id);
                const phaseName = phase?.phase_name || `단계 ${staffing.phase_id}`;
                const currentName = hatDraft.get(sid) || '';
                const hasHat = !!currentName.trim();
                return (
                  <div key={sid} className="flex items-center gap-3">
                    <div className="w-20 text-xs font-medium text-slate-600 shrink-0 truncate" title={phaseName}>
                      {phaseName}
                    </div>
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={currentName}
                        onChange={(e) => setHatDraft((prev) => new Map(prev).set(sid, e.target.value))}
                        placeholder="대체 투입자 이름 (비우면 해제)"
                        className={`w-full border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                          hasHat ? 'border-orange-300 bg-orange-50' : 'border-slate-200'
                        }`}
                        list={`hat-datalist-${sid}`}
                      />
                      <datalist id={`hat-datalist-${sid}`}>
                        {people.map((p) => (
                          <option key={p.id} value={p.person_name} />
                        ))}
                      </datalist>
                    </div>
                    {hasHat && (
                      <button
                        onClick={() => setHatDraft((prev) => new Map(prev).set(sid, ''))}
                        className="text-slate-400 hover:text-red-500 shrink-0"
                        title="해제"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-slate-400 pt-1">
                💡 이름을 비워두면 해당 단계의 모자가 해제됩니다. 시스템 등록 인력 외 외부인력도 직접 입력 가능합니다.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHatModalOpen(false)} disabled={savingHat}>
                취소
              </Button>
              <Button onClick={handleSaveHat} disabled={savingHat} className="bg-orange-500 hover:bg-orange-600 text-white">
                {savingHat ? '저장 중...' : '저장'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </TooltipProvider>
  );
}