import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProjects, getPeople, getPhases, getStaffing, getMonthEntries, getRangeEntries,
  toggleCalendarEntry, bulkCreateEntries,
  type Project, type Person, type Phase, type Staffing, type CalendarEntry
} from '../api'
import { authStore } from '@/lib/api'
import { KOREAN_HOLIDAYS, isNonWorkdayStr as isNonWorkdayStrHoliday } from '../lib/holidays'

function isBusinessDay(dateS: string): boolean { return !isNonWorkdayStrHoliday(dateS) }

// ── 뷰 모드 타입 ─────────────────────────────────────────────
type ViewMode = 'month' | 'quarter' | 'half' | 'year'

interface ViewModeOption {
  value: ViewMode
  label: string
  months: number   // 해당 뷰가 포함하는 개월 수
}

const VIEW_MODE_OPTIONS: ViewModeOption[] = [
  { value: 'month',   label: '월',   months: 1  },
  { value: 'quarter', label: '분기', months: 3  },
  { value: 'half',    label: '반기', months: 6  },
  { value: 'year',    label: '연',   months: 12 },
]

// ── 8색 팔레트 ─────────────────────────────────────────────
const PROJECT_COLORS = [
  { bg: 'bg-blue-100',   border: 'border-blue-400',   text: 'text-blue-800',   dot: 'bg-blue-500'   },
  { bg: 'bg-green-100',  border: 'border-green-400',  text: 'text-green-800',  dot: 'bg-green-500'  },
  { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-purple-100', border: 'border-purple-400', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-pink-100',   border: 'border-pink-400',   text: 'text-pink-800',   dot: 'bg-pink-500'   },
  { bg: 'bg-teal-100',   border: 'border-teal-400',   text: 'text-teal-800',   dot: 'bg-teal-500'   },
  { bg: 'bg-red-100',    border: 'border-red-400',    text: 'text-red-800',    dot: 'bg-red-500'    },
  { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800', dot: 'bg-yellow-500' },
]

function getColor(projectId: number, projectIds: number[]) {
  const idx = projectIds.indexOf(projectId)
  return PROJECT_COLORS[idx % PROJECT_COLORS.length]
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function dateStr(y: number, m: number, d: number) { return `${y}-${pad2(m)}-${pad2(d)}` }
function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate() }
function getDayOfWeek(dateS: string) { return new Date(dateS).getDay() }
function isWeekend(dateS: string) { const d = getDayOfWeek(dateS); return d === 0 || d === 6 }
function isHoliday(dateS: string) { return KOREAN_HOLIDAYS.has(dateS) }
function isToday(dateS: string) { return dateS === new Date().toISOString().slice(0, 10) }

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토']

// ── 뷰 범위 계산 ────────────────────────────────────────────
function getViewRange(year: number, month: number, mode: ViewMode): { start: string; end: string; months: { year: number; month: number }[] } {
  let startMonth = month
  let numMonths = 1

  if (mode === 'quarter') {
    startMonth = Math.floor((month - 1) / 3) * 3 + 1
    numMonths = 3
  } else if (mode === 'half') {
    startMonth = Math.floor((month - 1) / 6) * 6 + 1
    numMonths = 6
  } else if (mode === 'year') {
    startMonth = 1
    numMonths = 12
  }

  const months: { year: number; month: number }[] = []
  for (let i = 0; i < numMonths; i++) {
    const d = new Date(year, startMonth - 1 + i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }

  const first = months[0]
  const last = months[months.length - 1]
  const start = `${first.year}-${pad2(first.month)}-01`
  const lastDay = getDaysInMonth(last.year, last.month)
  const end = `${last.year}-${pad2(last.month)}-${pad2(lastDay)}`

  return { start, end, months }
}

function getViewLabel(year: number, month: number, mode: ViewMode): string {
  if (mode === 'month') return `${year}년 ${month}월`
  if (mode === 'quarter') {
    const q = Math.floor((month - 1) / 3) + 1
    return `${year}년 ${q}분기`
  }
  if (mode === 'half') {
    const h = Math.floor((month - 1) / 6) + 1
    return `${year}년 ${h}반기`
  }
  return `${year}년`
}

function navigatePeriod(year: number, month: number, mode: ViewMode, direction: -1 | 1): { year: number; month: number } {
  const step = VIEW_MODE_OPTIONS.find(o => o.value === mode)?.months ?? 1
  const d = new Date(year, month - 1 + direction * step, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export default function ScheduleTab() {
  const navigate = useNavigate()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  // leader 이상만 달력 셀 토글 가능 (user 역할은 읽기 전용)
  const currentRole = authStore.getUser()?.role ?? 'user'
  const canToggleCalendar = currentRole === 'admin' || currentRole === 'leader'
  const [viewMode, setViewMode] = useState<ViewMode>('month')

  const [projects, setProjects] = useState<Project[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [staffings, setStaffings] = useState<Staffing[]>([])
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)

  // 데이터 로드 (기본 데이터 - 한 번만)
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [p, pe, ph, st] = await Promise.all([
        getProjects(), getPeople(), getPhases(), getStaffing()
      ])
      setProjects(p)
      setPeople(pe)
      setPhases(ph)
      setStaffings(st)
      // 수주완료 프로젝트 디버그 로그 (임시)
      console.warn('[is_won check]', p.map(x => `${x.id}:${x.project_name}=${x.is_won}`))
    } finally {
      setLoading(false)
    }
  }, [])

  // 기간별 엔트리 로드
  const loadEntries = useCallback(async (y: number, m: number, mode: ViewMode) => {
    setLoadingEntries(true)
    try {
      if (mode === 'month') {
        const ents = await getMonthEntries(y, m)
        setEntries(ents)
      } else {
        const { start, end } = getViewRange(y, m, mode)
        const ents = await getRangeEntries(start, end)
        setEntries(ents)
      }
    } catch {
      setEntries([])
    } finally {
      setLoadingEntries(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadEntries(year, month, viewMode) }, [loadEntries, year, month, viewMode])

  // ── 뷰 범위 계산 ────────────────────────────────────────────
  const viewRange = useMemo(() => getViewRange(year, month, viewMode), [year, month, viewMode])
  const { start: rangeStart, end: rangeEnd } = viewRange

  // 범위 내 날짜 목록
  const dateList = useMemo(() => {
    const dates: string[] = []
    const cur = new Date(rangeStart)
    const endDate = new Date(rangeEnd)
    while (cur <= endDate) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }, [rangeStart, rangeEnd])

  const rangeStartDate = useMemo(() => new Date(rangeStart), [rangeStart])
  const rangeEndDate = useMemo(() => new Date(rangeEnd), [rangeEnd])

  // ── 활성 인원/단계 계산 ─────────────────────────────────────
  const activePersonIds = useMemo(() => {
    const set = new Set<number>()
    for (const s of staffings) {
      if (!s.person_id) continue
      const ph = phases.find(p => p.id === s.phase_id)
      if (!ph?.start_date || !ph?.end_date) continue
      const phStart = new Date(ph.start_date)
      const phEnd = new Date(ph.end_date)
      if (phStart <= rangeEndDate && phEnd >= rangeStartDate) {
        set.add(s.person_id)
      }
    }
    return set
  }, [staffings, phases, rangeStartDate, rangeEndDate])

  const activePeople = useMemo(() =>
    people
      .filter(p => activePersonIds.has(p.id))
      .sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.person_name.localeCompare(b.person_name)),
    [people, activePersonIds]
  )

  const activePhases = useMemo(() =>
    phases.filter(ph => {
      if (!ph.start_date || !ph.end_date) return false
      const s = new Date(ph.start_date), e = new Date(ph.end_date)
      return s <= rangeEndDate && e >= rangeStartDate
    }),
    [phases, rangeStartDate, rangeEndDate]
  )

  const projectIds = useMemo(() =>
    [...new Set(activePhases.map(ph => ph.project_id))],
    [activePhases]
  )

  // entry lookup
  const entryMap = useMemo(() => {
    const m = new Map<string, CalendarEntry>()
    for (const e of entries) {
      m.set(`${e.staffing_id}_${e.entry_date}`, e)
    }
    return m
  }, [entries])

  function getPersonDayStaffings(personId: number, dateS: string): Staffing[] {
    const result: Staffing[] = []
    for (const s of staffings) {
      if (s.person_id !== personId) continue
      const ph = phases.find(p => p.id === s.phase_id)
      if (!ph?.start_date || !ph?.end_date) continue
      if (dateS < ph.start_date || dateS > ph.end_date) continue
      result.push(s)
      if (result.length >= 3) break
    }
    return result
  }

  // ── Cell 클릭 (월 단위 + leader/admin만 편집 가능) ──────────
  const [toggling, setToggling] = useState<string | null>(null)
  async function handleCellClick(staffingId: number, dateS: string, status?: string) {
    if (viewMode !== 'month') return  // 월 단위 외에는 읽기 전용
    if (!canToggleCalendar) return    // user 역할은 달력 셀 수정 불가
    const key = `${staffingId}_${dateS}`
    if (toggling === key) return
    setToggling(key)
    try {
      await toggleCalendarEntry(staffingId, dateS, status)
      await loadEntries(year, month, viewMode)
    } finally {
      setToggling(null)
    }
  }

  // ── 자동채우기 (월 단위만) ─────────────────────────────────
  const autoFillLock = useRef(false)
  async function handleAutoFill() {
    if (autoFillLock.current || viewMode !== 'month') return
    autoFillLock.current = true
    setAutoFilling(true)
    try {
      const toCreate: { staffing_id: number; entry_date: string; status?: string }[] = []
      for (const s of staffings) {
        if (!s.person_id || !s.md || s.md <= 0) continue
        const ph = phases.find(p => p.id === s.phase_id)
        if (!ph?.start_date || !ph?.end_date) continue
        const hasEntry = entries.some(e => e.staffing_id === s.id)
        if (hasEntry) continue
        const bizDays: string[] = []
        const cur = new Date(ph.start_date)
        const endD = new Date(ph.end_date)
        while (cur <= endD) {
          const ds = cur.toISOString().slice(0, 10)
          if (isBusinessDay(ds)) bizDays.push(ds)
          cur.setDate(cur.getDate() + 1)
        }
        let remaining = s.md
        for (const ds of bizDays) {
          if (remaining <= 0) break
          if (!ds.startsWith(`${year}-${pad2(month)}`)) continue
          const key = `${s.id}_${ds}`
          if (!entryMap.has(key)) {
            const project = projects.find(p => p.id === s.project_id)
            const status = project?.status === '감리' ? 'A' : 'P'
            toCreate.push({ staffing_id: s.id, entry_date: ds, status })
            remaining--
          }
        }
      }
      if (toCreate.length > 0) {
        await bulkCreateEntries(toCreate)
        await loadEntries(year, month, viewMode)
      }
    } finally {
      autoFillLock.current = false
      setAutoFilling(false)
    }
  }

  // ── 요약 통계 ───────────────────────────────────────────────
  const totalMd = entries.length

  // ── 단계 뱃지 ───────────────────────────────────────────────
  const phaseBadges = useMemo(() =>
    activePhases.map(ph => {
      const proj = projects.find(p => p.id === ph.project_id)
      const color = getColor(ph.project_id, projectIds)
      return { ph, proj, color }
    }),
    [activePhases, projects, projectIds]
  )

  // ── 월 구분선 계산 (월/분기/반기/연 뷰에서 월 경계 강조) ────
  const monthBoundaries = useMemo(() => {
    const set = new Set<string>()
    if (viewMode === 'month') return set
    for (const { year: y, month: m } of viewRange.months) {
      set.add(`${y}-${pad2(m)}-01`)
    }
    return set
  }, [viewMode, viewRange])

  // 날짜에 해당하는 월 레이블 (비월 뷰에서 첫날에 표시)
  function getMonthLabel(dateS: string): string | null {
    if (viewMode === 'month') return null
    if (dateS.slice(8) === '01') {
      const [y, m] = dateS.split('-')
      return `${parseInt(m)}월`
    }
    return null
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">
      <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      데이터 로딩 중...
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 상단 컨트롤 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {/* 이전 */}
          <button
            onClick={() => {
              const { year: ny, month: nm } = navigatePeriod(year, month, viewMode, -1)
              setYear(ny); setMonth(nm)
            }}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
          </button>

          {/* 기간 레이블 */}
          <span className="text-lg font-bold text-gray-900 min-w-[160px] text-center">
            {getViewLabel(year, month, viewMode)}
          </span>

          {/* 다음 */}
          <button
            onClick={() => {
              const { year: ny, month: nm } = navigatePeriod(year, month, viewMode, 1)
              setYear(ny); setMonth(nm)
            }}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
            </svg>
          </button>

          {/* 오늘 */}
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1) }}
            className="ml-1 px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition font-medium border border-blue-200"
          >오늘</button>
        </div>

        <div className="flex items-center gap-2">
          {/* 뷰 모드 선택 */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden bg-white">
            {VIEW_MODE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setViewMode(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition border-r border-gray-200 last:border-r-0
                  ${viewMode === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 자동채우기 (월 단위만) */}
          {viewMode === 'month' && (
            <button
              onClick={handleAutoFill}
              disabled={autoFilling}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition font-medium"
            >
              {autoFilling ? (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
              )}
              자동채우기
            </button>
          )}

          {/* 로딩 인디케이터 */}
          {loadingEntries && (
            <svg className="animate-spin w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
        </div>
      </div>

      {/* 읽기 전용 안내 (월 외 뷰) */}
      {viewMode !== 'month' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          {getViewLabel(year, month, viewMode)} 조회 중 — 편집(셀 클릭·자동채우기)은 <strong className="mx-1">월 단위</strong>에서만 가능합니다
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-xs text-gray-500 mb-1">투입 MD</div>
          <div className="text-2xl font-bold text-gray-900">{totalMd}</div>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-xs text-gray-500 mb-1">투입 인원</div>
          <div className="text-2xl font-bold text-gray-900">{activePeople.length}</div>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-xs text-gray-500 mb-1">진행 단계</div>
          <div className="text-2xl font-bold text-gray-900">{activePhases.length}</div>
        </div>
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-xs text-gray-500 mb-1">진행 프로젝트</div>
          <div className="text-2xl font-bold text-gray-900">{projectIds.length}</div>
        </div>
      </div>

      {/* 단계 뱃지 패널 */}
      {phaseBadges.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">진행 단계</div>
          <div className="flex flex-wrap gap-2">
            {phaseBadges.map(({ ph, proj, color }) => (
              <button
                key={ph.id}
                onClick={() => navigate(`/project/${ph.project_id}`)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color.bg} ${color.border} ${color.text} hover:opacity-80 transition`}
              >
                <span className={`w-2 h-2 rounded-full ${color.dot}`}/>
                <span>{proj?.project_name}</span>
                <span className="opacity-70">/ {ph.phase_name}</span>
                {ph.start_date && ph.end_date && (
                  <span className="opacity-60 ml-0.5">{ph.start_date.slice(5)} ~ {ph.end_date.slice(5)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 캘린더 그리드 */}
      {activePeople.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400 shadow-sm border border-gray-100">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p className="font-medium">해당 기간 활동 인원이 없습니다</p>
          <p className="text-sm mt-1">프로젝트 단계와 staffing을 먼저 설정해주세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="border-collapse text-xs" style={{ minWidth: `${180 + activePeople.length * 120}px` }}>
              <thead className="sticky top-0 z-20 bg-white">
                <tr>
                  <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-gray-500 font-semibold w-[120px] min-w-[80px]">
                    날짜
                  </th>
                  {activePeople.map(person => {
                    const personStaffings = staffings.filter(s => s.person_id === person.id)
                    const personProjectIds = [...new Set(
                      personStaffings.filter(s => {
                        const ph = phases.find(p => p.id === s.phase_id)
                        if (!ph?.start_date || !ph?.end_date) return false
                        return new Date(ph.start_date) <= rangeEndDate && new Date(ph.end_date) >= rangeStartDate
                      }).map(s => s.project_id)
                    )]
                    const personMd = entries.filter(e => personStaffings.some(s => s.id === e.staffing_id)).length

                    return (
                      <th
                        key={person.id}
                        className="border-b border-r border-gray-200 px-2 py-2 text-center bg-white font-medium min-w-[100px]"
                      >
                        <button
                          onClick={() => navigate(`/person/${person.id}`)}
                          className="flex flex-col items-center gap-0.5 hover:text-blue-600 transition w-full"
                        >
                          <span className="font-semibold text-gray-800">{person.person_name}</span>
                          <span className="text-gray-400 text-[10px]">{person.team || '-'}</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            {personProjectIds.map(pid => {
                              const c = getColor(pid, projectIds)
                              return <span key={pid} className={`w-2 h-2 rounded-full ${c.dot}`}/>
                            })}
                            {personMd > 0 && (
                              <span className="text-[10px] text-blue-600 font-bold">{personMd}d</span>
                            )}
                          </div>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {dateList.map((dateS, idx) => {
                  const dow = getDayOfWeek(dateS)
                  const weekend = isWeekend(dateS)
                  const holiday = isHoliday(dateS)
                  const todayRow = isToday(dateS)
                  const isMonday = dow === 1
                  const dayNum = parseInt(dateS.slice(8))
                  const monthLabel = getMonthLabel(dateS)
                  const isMonthStart = monthBoundaries.has(dateS)

                  const rowBg = todayRow
                    ? 'bg-blue-50'
                    : weekend || holiday
                    ? 'bg-gray-50'
                    : 'bg-white'

                  return (
                    <tr
                      key={dateS}
                      className={`${rowBg} ${isMonthStart && idx > 0 ? 'border-t-2 border-blue-300' : isMonday && idx > 0 ? 'border-t border-gray-200' : ''}`}
                    >
                      {/* 날짜 셀 */}
                      <td className={`sticky left-0 z-10 border-b border-r border-gray-200 px-3 py-1 ${rowBg}`}>
                        <div className="flex items-center gap-1.5">
                          {/* 월 레이블 (비월 뷰의 매월 1일에) */}
                          {monthLabel ? (
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1 rounded mr-0.5">{monthLabel}</span>
                          ) : null}
                          <span className={`font-bold text-sm ${
                            todayRow ? 'text-blue-600' :
                            weekend || holiday ? 'text-red-400' : 'text-gray-700'
                          }`}>{dayNum}</span>
                          <span className={`text-[10px] ${
                            weekend || holiday ? 'text-red-400' : 'text-gray-400'
                          }`}>{DOW_KR[dow]}</span>
                          {holiday && <span className="text-[9px] text-red-400">공휴</span>}
                        </div>
                      </td>

                      {/* 인원별 셀 */}
                      {activePeople.map(person => {
                        const dayStaffings = getPersonDayStaffings(person.id, dateS)
                        const isSelectable = dayStaffings.length > 0 && !weekend && !holiday

                        if (!isSelectable) {
                          return (
                            <td key={person.id} className="border-b border-r border-gray-100 p-0.5">
                              <div className={`h-7 rounded mx-0.5 ${weekend || holiday ? 'bg-gray-100' : ''}`}/>
                            </td>
                          )
                        }

                        return (
                          <td key={person.id} className="border-b border-r border-gray-100 p-0.5">
                            <div className="flex gap-0.5">
                              {dayStaffings.map(s => {
                                const entry = entryMap.get(`${s.id}_${dateS}`)
                                const color = getColor(s.project_id, projectIds)
                                const isSelected = !!entry
                                const status = entry?.status
                                const isTogglingThis = toggling === `${s.id}_${dateS}`
                                const isReadOnly = viewMode !== 'month' || !canToggleCalendar
                                const proj = projects.find(p => p.id === s.project_id)
                                // is_won: API에서 true/false/undefined 모두 올 수 있으므로 명시적으로 === true 비교
                                // status 대신 proj.status로 판단 (entry.status 불일치 방어)
                                const isWonProposal = isSelected && proj?.status !== '감리' && proj?.is_won === true

                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => {
                                      if (isReadOnly) return
                                      const st = proj?.status === '감리' ? 'A' : 'P'
                                      handleCellClick(s.id, dateS, st)
                                    }}
                                    disabled={isTogglingThis || isReadOnly}
                                    title={`${proj?.project_name} / ${phases.find(p => p.id === s.phase_id)?.phase_name}\n${s.field} - ${s.sub_field}${proj?.is_won ? '\n👑 수주 완료' : ''}${viewMode !== 'month' ? '\n(월 단위에서 편집 가능)' : !canToggleCalendar ? '\n(리더 이상 권한 필요)' : ''}`}
                                    className={`h-7 rounded transition flex items-center justify-center font-bold text-[11px]
                                      ${isTogglingThis ? 'opacity-50' : ''}
                                      ${isReadOnly ? 'cursor-default' : ''}
                                      ${isSelected
                                        ? isWonProposal
                                          ? `bg-amber-100 text-amber-700 border border-amber-400`
                                          : `${color.bg} ${color.text} border ${color.border}`
                                        : isReadOnly
                                          ? 'bg-gray-50 text-gray-300 border border-gray-200'
                                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200 border border-dashed border-gray-300'
                                      }`}
                                    style={{ width: `${Math.floor(88 / dayStaffings.length)}px` }}
                                  >
                                    {isSelected && (
                                      isWonProposal
                                        ? <span className="flex items-center gap-px leading-none">P<span className="text-[9px]">👑</span></span>
                                        : status
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 px-1">
        <div className="flex items-center gap-1">
          <div className="w-5 h-4 rounded bg-blue-100 border border-blue-300 flex items-center justify-center text-blue-700 font-bold text-[10px]">A</div>
          <span>감리 (Audit)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-4 rounded bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-700 font-bold text-[10px]">P</div>
          <span>제안 (Proposal)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-4 rounded bg-amber-100 border border-amber-400 flex items-center justify-center text-amber-700 font-bold text-[10px] gap-px">P<span className="text-[8px]">👑</span></div>
          <span>수주 완료</span>
        </div>
        {viewMode === 'month' && (
          <div className="flex items-center gap-1">
            <div className="w-5 h-4 rounded bg-gray-100 border border-dashed border-gray-300"></div>
            <span>선택 가능</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="w-5 h-4 rounded bg-gray-100"></div>
          <span>주말/공휴일</span>
        </div>
        {viewMode !== 'month' && (
          <div className="flex items-center gap-1">
            <div className="w-5 h-4 border-t-2 border-blue-300"></div>
            <span>월 경계</span>
          </div>
        )}
      </div>
    </div>
  )
}
