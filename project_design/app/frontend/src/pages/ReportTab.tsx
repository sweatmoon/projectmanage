import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getProjects, getPhases, getStaffing, getCalendarEntries,
  type Project, type Phase, type Staffing, type CalendarEntry
} from '../api'

export default function ReportTab() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [staffings, setStaffings] = useState<Staffing[]>([])
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [p, ph, st] = await Promise.all([getProjects(), getPhases(), getStaffing()])
        setProjects(p)
        setPhases(ph)
        setStaffings(st)
        if (p.length > 0) setSelectedProjectId(p[0].id)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // 선택 프로젝트의 entry 로드
  useEffect(() => {
    if (!selectedProjectId) { setEntries([]); return }
    const projStaffings = staffings.filter(s => s.project_id === selectedProjectId)
    if (projStaffings.length === 0) { setEntries([]); return }

    let cancelled = false
    async function loadEntries() {
      const allEntries: CalendarEntry[] = []
      for (const s of projStaffings) {
        const ents = await getCalendarEntries(s.id)
        allEntries.push(...ents)
      }
      if (!cancelled) setEntries(allEntries)
    }
    loadEntries()
    return () => { cancelled = true }
  }, [selectedProjectId, staffings])

  const project = projects.find(p => p.id === selectedProjectId)
  const projectPhases = phases.filter(p => p.project_id === selectedProjectId).sort((a, b) => a.sort_order - b.sort_order)
  const projectStaffings = staffings.filter(s => s.project_id === selectedProjectId)
  const projectEntries = entries

  // 요약 카드
  const totalMdPlanned = projectStaffings.reduce((s, st) => s + (st.md || 0), 0)
  const totalMdActual = projectEntries.length
  const staffedPersonIds = new Set(projectStaffings.filter(s => s.person_id).map(s => s.person_id!))
  const unassignedRows = projectStaffings.filter(s => !s.person_id).length

  // Phase별 MD
  const phaseMdRows = projectPhases.map(ph => {
    const phSts = projectStaffings.filter(s => s.phase_id === ph.id)
    const planned = phSts.reduce((s, st) => s + (st.md || 0), 0)
    const actual = projectEntries.filter(e => phSts.some(s => s.id === e.staffing_id)).length
    return { phase: ph, planned, actual }
  })

  // Category별 MD
  const categoryMap = new Map<string, { planned: number; actual: number }>()
  for (const s of projectStaffings) {
    const key = s.category || '기타'
    const actual = projectEntries.filter(e => e.staffing_id === s.id).length
    const cur = categoryMap.get(key) || { planned: 0, actual: 0 }
    categoryMap.set(key, { planned: cur.planned + (s.md || 0), actual: cur.actual + actual })
  }

  // 인원별 상위 10 MD
  const personMdMap = new Map<string, { planned: number; actual: number }>()
  for (const s of projectStaffings) {
    const key = s.person_name_text || (s.person_id ? `ID:${s.person_id}` : '미배정')
    const actual = projectEntries.filter(e => e.staffing_id === s.id).length
    const cur = personMdMap.get(key) || { planned: 0, actual: 0 }
    personMdMap.set(key, { planned: cur.planned + (s.md || 0), actual: cur.actual + actual })
  }
  const top10Persons = [...personMdMap.entries()]
    .sort((a, b) => b[1].planned - a[1].planned)
    .slice(0, 10)

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">
      <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      로딩 중...
    </div>
  )

  return (
    <div className="space-y-6">
      {/* 프로젝트 선택 */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">프로젝트</label>
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          value={selectedProjectId || ''}
          onChange={e => setSelectedProjectId(Number(e.target.value))}
        >
          <option value="">선택하세요</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.project_name}</option>
          ))}
        </select>
        {project && (
          <button
            onClick={() => navigate(`/project/${project.id}`)}
            className="text-xs text-blue-600 hover:underline"
          >프로젝트 상세 →</button>
        )}
      </div>

      {!selectedProjectId || !project ? (
        <div className="bg-white rounded-xl p-16 text-center text-gray-400 shadow-sm border border-gray-100">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
          <p className="font-medium">프로젝트를 선택하면 리포트가 표시됩니다</p>
        </div>
      ) : (
        <>
          {/* 요약 카드 4개 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">총 계획 MD</div>
              <div className="text-3xl font-bold text-gray-900">{totalMdPlanned}</div>
              <div className="text-xs text-gray-400 mt-1">실제: {totalMdActual}일</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">단계 수</div>
              <div className="text-3xl font-bold text-gray-900">{projectPhases.length}</div>
              <div className="text-xs text-gray-400 mt-1">staffing: {projectStaffings.length}행</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">배정 인원</div>
              <div className="text-3xl font-bold text-gray-900">{staffedPersonIds.size}</div>
              <div className="text-xs text-gray-400 mt-1">person_id 연결 기준</div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="text-xs text-gray-500 mb-1">미배정 행</div>
              <div className={`text-3xl font-bold ${unassignedRows > 0 ? 'text-orange-500' : 'text-gray-900'}`}>
                {unassignedRows}
              </div>
              <div className="text-xs text-gray-400 mt-1">인원 미연결</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 단계별 MD */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">단계별 MD</h3>
              </div>
              {phaseMdRows.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">단계 없음</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                      <th className="px-4 py-2 text-left">단계</th>
                      <th className="px-4 py-2 text-right">기간</th>
                      <th className="px-4 py-2 text-right">계획</th>
                      <th className="px-4 py-2 text-right">실제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phaseMdRows.map(({ phase, planned, actual }) => (
                      <tr key={phase.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{phase.phase_name}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                          {phase.start_date?.slice(5)} ~ {phase.end_date?.slice(5)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">{planned}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{actual}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-gray-500">합계</td>
                      <td className="px-4 py-2 text-right font-bold">{totalMdPlanned}</td>
                      <td className="px-4 py-2 text-right font-bold text-gray-600">{totalMdActual}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* 구분별 MD */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">구분별 MD</h3>
              </div>
              {categoryMap.size === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">데이터 없음</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                      <th className="px-4 py-2 text-left">구분</th>
                      <th className="px-4 py-2 text-right">계획 MD</th>
                      <th className="px-4 py-2 text-right">실제 일수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...categoryMap.entries()].sort((a, b) => b[1].planned - a[1].planned).map(([cat, { planned, actual }]) => (
                      <tr key={cat} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{cat}</td>
                        <td className="px-4 py-2.5 text-right">{planned}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500">{actual}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 인원별 Top 10 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">인원별 MD (Top 10)</h3>
            </div>
            {top10Persons.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm">데이터 없음</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                      <th className="px-4 py-2 text-left w-8">#</th>
                      <th className="px-4 py-2 text-left">인원</th>
                      <th className="px-4 py-2 text-right">계획 MD</th>
                      <th className="px-4 py-2 text-right">실제 일수</th>
                      <th className="px-4 py-2 text-right">달성률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10Persons.map(([name, { planned, actual }], idx) => {
                      const rate = planned > 0 ? Math.round(actual / planned * 100) : 0
                      return (
                        <tr key={name} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{name}</td>
                          <td className="px-4 py-2.5 text-right">{planned}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{actual}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${rate >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                                  style={{ width: `${Math.min(rate, 100)}%` }}
                                />
                              </div>
                              <span className={`text-xs ${rate >= 100 ? 'text-green-600' : 'text-gray-500'}`}>{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
