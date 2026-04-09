import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPeople, createPerson, type Person } from '../api'

const STATUS_BADGE: Record<string, string> = {
  '재직': 'bg-emerald-100 text-emerald-700',
  '외부': 'bg-amber-100 text-amber-700',
  '퇴사': 'bg-red-100 text-red-700',
  '휴직': 'bg-gray-100 text-gray-500',
}
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-600','bg-purple-100 text-purple-600',
  'bg-emerald-100 text-emerald-600','bg-pink-100 text-pink-600',
  'bg-amber-100 text-amber-600','bg-indigo-100 text-indigo-600',
]
const GRADE_OPTS = ['특급','고급','중급','초급','수석','책임','선임','주임','기타']
const TEAM_OPTS  = ['감리1팀','감리2팀','전문가팀','테스트팀','기타']
const STATUS_OPTS = ['재직','외부','퇴사','휴직']
const EMPTY = { person_name:'', team:'감리1팀', grade:'고급', employment_status:'재직', company:'' }

interface Props { headerBtnId?: string }

export default function PeopleTab({ headerBtnId }: Props) {
  const navigate = useNavigate()
  const [people, setPeople] = useState<Person[]>([])
  const [search, setSearch] = useState('')
  const [selectedCompany, setSelectedCompany] = useState<string>('전체')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({...EMPTY})
  const [saving, setSaving] = useState(false)

  const fetch = () => {
    setLoading(true)
    getPeople().then(d => { setPeople(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { fetch() }, [])

  useEffect(() => {
    if (!headerBtnId) return
    const btn = document.getElementById(headerBtnId)
    if (!btn) return
    const h = () => { setForm({...EMPTY}); setShowModal(true) }
    btn.addEventListener('click', h)
    return () => btn.removeEventListener('click', h)
  }, [headerBtnId])

  // 동적 회사 목록 (company 있는 인력 기준, 가나다 정렬)
  const companyList = useMemo(() => {
    const companies = Array.from(
      new Set(people.map(p => p.company?.trim()).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'ko'))
    return ['전체', ...companies, '미지정']
  }, [people])

  // 필터 + 검색 + 회사별 소팅
  const filteredAndSorted = useMemo(() => {
    let result = people.filter(p => {
      const matchSearch =
        p.person_name.toLowerCase().includes(search.toLowerCase()) ||
        (p.company || '').toLowerCase().includes(search.toLowerCase())

      const personCompany = p.company?.trim() || ''
      const matchCompany =
        selectedCompany === '전체' ||
        (selectedCompany === '미지정' ? !personCompany : personCompany === selectedCompany)

      return matchSearch && matchCompany
    })

    // 회사별 소팅: 회사 가나다순 → 이름 가나다순
    result = [...result].sort((a, b) => {
      const ca = a.company?.trim() || '\uFFFF' // 미지정은 맨 뒤
      const cb = b.company?.trim() || '\uFFFF'
      const companyDiff = ca.localeCompare(cb, 'ko')
      if (companyDiff !== 0) return companyDiff
      return a.person_name.localeCompare(b.person_name, 'ko')
    })

    return result
  }, [people, search, selectedCompany])

  // 회사별 그룹핑 (현재 필터가 '전체'일 때 섹션 헤더 표시용)
  const groupedByCompany = useMemo(() => {
    if (selectedCompany !== '전체') return null
    const groups: { company: string; items: Person[] }[] = []
    const seen = new Map<string, Person[]>()
    for (const p of filteredAndSorted) {
      const key = p.company?.trim() || '미지정'
      if (!seen.has(key)) { seen.set(key, []); groups.push({ company: key, items: seen.get(key)! }) }
      seen.get(key)!.push(p)
    }
    return groups
  }, [filteredAndSorted, selectedCompany])

  const save = async () => {
    if (!form.person_name.trim()) return
    setSaving(true)
    try { await createPerson(form); setShowModal(false); fetch() }
    finally { setSaving(false) }
  }

  return (
    <div>
      {/* 검색창 */}
      <div className="mb-3 relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름 또는 회사로 검색..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>

      {/* 회사 필터 탭 */}
      <div className="mb-4 flex gap-1.5 flex-wrap">
        {companyList.map(company => (
          <button
            key={company}
            onClick={() => setSelectedCompany(company)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              selectedCompany === company
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {company}
            {company !== '전체' && (
              <span className="ml-1 opacity-70">
                ({company === '미지정'
                  ? people.filter(p => !p.company?.trim()).length
                  : people.filter(p => p.company?.trim() === company).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">로딩 중...</div>
      ) : groupedByCompany ? (
        /* 전체 보기: 회사별 섹션으로 그룹핑 */
        <div className="space-y-5">
          {groupedByCompany.map(({ company, items }) => (
            <div key={company}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{company}</span>
                <span className="text-xs text-gray-400">({items.length}명)</span>
                <div className="flex-1 h-px bg-gray-100"/>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((p, idx) => (
                  <PersonCard key={p.id} p={p} idx={idx} onClick={() => navigate(`/person/${p.id}`)} />
                ))}
              </div>
            </div>
          ))}
          {groupedByCompany.length === 0 && (
            <div className="text-center py-16 text-gray-400 text-sm">검색 결과가 없습니다.</div>
          )}
        </div>
      ) : (
        /* 특정 회사 필터: 단순 그리드 */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredAndSorted.map((p, idx) => (
            <PersonCard key={p.id} p={p} idx={idx} onClick={() => navigate(`/person/${p.id}`)} />
          ))}
          {filteredAndSorted.length === 0 && (
            <div className="col-span-3 text-center py-16 text-gray-400 text-sm">검색 결과가 없습니다.</div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold">인력 추가</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="space-y-3">
              {/* 이름 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">이름 *</label>
                <input value={form.person_name} onChange={e => setForm(f=>({...f, person_name: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              {/* 회사 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">회사</label>
                <input value={form.company} onChange={e => setForm(f=>({...f, company: e.target.value}))}
                  placeholder="소속 회사명 입력"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              {/* 팀 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">팀</label>
                <select value={form.team} onChange={e => setForm(f=>({...f, team: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {TEAM_OPTS.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              {/* 직급 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">직급</label>
                <select value={form.grade} onChange={e => setForm(f=>({...f, grade: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {GRADE_OPTS.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
              {/* 재직상태 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">재직상태</label>
                <select value={form.employment_status} onChange={e => setForm(f=>({...f, employment_status: e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {STATUS_OPTS.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">취소</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving?'저장 중...':'저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PersonCard({ p, idx, onClick }: { p: Person; idx: number; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900 text-sm">{p.person_name}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.employment_status||'재직']||STATUS_BADGE['재직']}`}>
            {p.employment_status||'재직'}
          </span>
        </div>
        {p.company && (
          <div className="text-xs text-blue-600 font-medium mt-0.5 truncate">{p.company}</div>
        )}
        <div className="text-xs text-gray-500 mt-0.5">{p.grade||'-'}</div>
      </div>
    </div>
  )
}
