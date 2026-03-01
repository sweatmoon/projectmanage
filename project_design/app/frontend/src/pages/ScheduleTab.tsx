import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProjects, getPeople, getPhases, getStaffing, getMonthEntries, toggleCalendarEntry, bulkCreateEntries,
  type Project, type Person, type Phase, type Staffing, type CalendarEntry
} from '../api'
import { KOREAN_HOLIDAYS, isNonWorkdayStr as isNonWorkdayStrHoliday } from '../lib/holidays'
// isBusinessDay: 공휴일+주말 제외 영업일 (holidays.ts 기반)
function isBusinessDay(dateS: string): boolean { return !isNonWorkdayStrHoliday(dateS); }

// 8색 팔레트 (프로젝트별)
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
function getDayOfWeek(dateS: string) { return new Date(dateS).getDay() } // 0=Sun,6=Sat
function isWeekend(dateS: string) { const d = getDayOfWeek(dateS); return d === 0 || d === 6 }
function isHoliday(dateS: string) { return KOREAN_HOLIDAYS.has(dateS) }
function isToday(dateS: string) { return dateS === new Date().toISOString().slice(0, 10) }

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토']

export default function ScheduleTab() {
  const navigate = useNavigate()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [projects, setProjects] = useState<Project[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [staffings, setStaffings] = useState<Staffing[]>([])
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [autoFilling, setAutoFilling] = useState(false)

  // 데이터 로드
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
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEntries = useCallback(async (y: number, m: number) => {
    try {
      const ents = await getMonthEntries(y, m)
      setEntries(ents)
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadEntries(year, month) }, [loadEntries, year, month])

  const days = getDaysInMonth(year, month)
  const dateList = Array.from({ length: days }, (_, i) => dateStr(year, month, i + 1))

  // 이달에 활동 중인 인원 (staffing + phase 기간 내)
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0)

  const activePersonIds = new Set<number>()
  for (const s of staffings) {
    if (!s.person_id) continue
    const ph = phases.find(p => p.id === s.phase_id)
    if (!ph?.start_date || !ph?.end_date) continue
    const phStart = new Date(ph.start_date)
    const phEnd = new Date(ph.end_date)
    if (phStart <= monthEnd && phEnd >= monthStart) {
      activePersonIds.add(s.person_id)
    }
  }

  const activePeople = people
    .filter(p => activePersonIds.has(p.id))
    .sort((a, b) => (a.team || '').localeCompare(b.team || '') || a.person_name.localeCompare(b.person_name))

  // 이달에 활동 중인 phase들
  const activePhases = phases.filter(ph => {
    if (!ph.start_date || !ph.end_date) return false
    const s = new Date(ph.start_date), e = new Date(ph.end_date)
    return s <= monthEnd && e >= monthStart
  })

  // 프로젝트 색상 맵
  const projectIds = [...new Set(activePhases.map(ph => ph.project_id))]

  // entry lookup: `${staffing_id}_${entry_date}` → entry
  const entryMap = new Map<string, CalendarEntry>()
  for (const e of entries) {
    entryMap.set(`${e.staffing_id}_${e.entry_date}`, e)
  }

  // 특정 인원, 특정 날짜의 staffing 목록 (최대 3개, 활성 phase만)
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

  // cell 클릭 → toggle
  const [toggling, setToggling] = useState<string | null>(null)
  async function handleCellClick(staffingId: number, dateS: string, status?: string) {
    const key = `${staffingId}_${dateS}`
    if (toggling === key) return
    setToggling(key)
    try {
      await toggleCalendarEntry(staffingId, dateS, status)
      await loadEntries(year, month)
    } finally {
      setToggling(null)
    }
  }

  // 자동채우기 (MD > 0인 staffing row에 대해 phase 시작일부터 영업일 선택)
  const autoFillLock = useRef(false)
  async function handleAutoFill() {
    if (autoFillLock.current) return
    autoFillLock.current = true
    setAutoFilling(true)
    try {
      const toCreate: { staffing_id: number; entry_date: string; status?: string }[] = []

      for (const s of staffings) {
        if (!s.person_id || !s.md || s.md <= 0) continue
        const ph = phases.find(p => p.id === s.phase_id)
        if (!ph?.start_date || !ph?.end_date) continue

        // 이미 이달에 entry가 있으면 skip
        const hasEntry = entries.some(e => e.staffing_id === s.id)
        if (hasEntry) continue

        // phase 내 영업일 목록
        const bizDays: string[] = []
        const cur = new Date(ph.start_date)
        const endD = new Date(ph.end_date)
        while (cur <= endD) {
          const ds = cur.toISOString().slice(0, 10)
          if (isBusinessDay(ds)) bizDays.push(ds)
          cur.setDate(cur.getDate() + 1)
        }

        // MD만큼 앞에서 선택 (이달 내 날짜만)
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
        await loadEntries(year, month)
      }
    } finally {
      autoFillLock.current = false
      setAutoFilling(false)
    }
  }

  // 이달 phase 뱃지 계산 (활성 phase 목록)
  const phaseBadges = activePhases.map(ph => {
    const proj = projects.find(p => p.id === ph.project_id)
    const color = getColor(ph.project_id, projectIds)
    return { ph, proj, color }
  })

  // 이달 MD 집계
  const totalMd = entries.length
  const projectMdMap = new Map<number, number>()
  for (const e of entries) {
    const s = staffings.find(st => st.id === e.staffing_id)
    if (!s) continue
    projectMdMap.set(s.project_id, (projectMdMap.get(s.project_id) || 0) + 1)
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
          <button
            onClick={() => { const d = new Date(year, month - 2, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1) }}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          </button>
          <span className="text-lg font-bold text-gray-900 min-w-[120px] text-center">{year}년 {month}월</span>
          <button
            onClick={() => { const d = new Date(year, month, 1); setYear(d.getFullYear()); setMonth(d.getMonth() + 1) }}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
          </button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1) }}
            className="ml-1 px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition font-medium border border-blue-200"
          >오늘</button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoFill}
            disabled={autoFilling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition font-medium"
          >
            {autoFilling ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            )}
            자동채우기
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
          <div className="text-xs text-gray-500 mb-1">이달 투입 MD</div>
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
          <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">이달 진행 단계</div>
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
          <p className="font-medium">이달 활동 인원이 없습니다</p>
          <p className="text-sm mt-1">프로젝트 단계와 staffing을 먼저 설정해주세요</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="border-collapse text-xs" style={{ minWidth: `${180 + activePeople.length * 120}px` }}>
              <thead className="sticky top-0 z-20 bg-white">
                {/* 팀/인원 헤더 */}
                <tr>
                  <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-gray-500 font-semibold w-[120px] min-w-[80px]">
                    날짜
                  </th>
                  {activePeople.map(person => {
                    // 이달 이 인원의 프로젝트/MD 정보
                    const personStaffings = staffings.filter(s => s.person_id === person.id)
                    const personProjectIds = [...new Set(
                      personStaffings.filter(s => {
                        const ph = phases.find(p => p.id === s.phase_id)
                        if (!ph?.start_date || !ph?.end_date) return false
                        return new Date(ph.start_date) <= monthEnd && new Date(ph.end_date) >= monthStart
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
                  const dayNum = idx + 1

                  const rowBg = todayRow
                    ? 'bg-blue-50'
                    : weekend || holiday
                    ? 'bg-gray-50'
                    : 'bg-white'

                  return (
                    <tr
                      key={dateS}
                      className={`${rowBg} ${isMonday && idx > 0 ? 'border-t-2 border-gray-300' : ''}`}
                    >
                      {/* 날짜 셀 */}
                      <td className={`sticky left-0 z-10 border-b border-r border-gray-200 px-3 py-1.5 ${rowBg}`}>
                        <div className="flex items-center gap-1.5">
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

                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => {
                                      const proj = projects.find(p => p.id === s.project_id)
                                      const st = proj?.status === '감리' ? 'A' : 'P'
                                      handleCellClick(s.id, dateS, st)
                                    }}
                                    disabled={isTogglingThis}
                                    title={`${projects.find(p => p.id === s.project_id)?.project_name} / ${phases.find(p => p.id === s.phase_id)?.phase_name}\n${s.field} - ${s.sub_field}`}
                                    className={`h-7 rounded transition flex items-center justify-center font-bold text-[11px]
                                      ${isTogglingThis ? 'opacity-50' : ''}
                                      ${isSelected
                                        ? `${color.bg} ${color.text} border ${color.border}`
                                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200 border border-dashed border-gray-300'
                                      }`}
                                    style={{ width: `${Math.floor(88 / dayStaffings.length)}px` }}
                                  >
                                    {isSelected && status}
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
          <div className="w-5 h-4 rounded bg-gray-100 border border-dashed border-gray-300"></div>
          <span>선택 가능</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-4 rounded bg-gray-100"></div>
          <span>주말/공휴일</span>
        </div>
      </div>
    </div>
  )
}
