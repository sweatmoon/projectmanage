import { useState, useEffect } from 'react'
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
const EMPTY = { person_name:'', team:'감리1팀', grade:'고급', employment_status:'재직' }

interface Props { headerBtnId?: string }

export default function PeopleTab({ headerBtnId }: Props) {
  const navigate = useNavigate()
  const [people, setPeople] = useState<Person[]>([])
  const [search, setSearch] = useState('')
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

  const filtered = people.filter(p =>
    p.person_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.team||'').toLowerCase().includes(search.toLowerCase())
  )

  const save = async () => {
    if (!form.person_name.trim()) return
    setSaving(true)
    try { await createPerson(form); setShowModal(false); fetch() }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div className="mb-4 relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="인력명으로 검색..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">로딩 중...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p, idx) => (
            <div key={p.id} onClick={() => navigate(`/person/${p.id}`)}
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow">
              <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 text-sm">{p.person_name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.employment_status||'재직']||STATUS_BADGE['재직']}`}>{p.employment_status||'재직'}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{p.team||'-'} · {p.grade||'-'}</div>
              </div>
            </div>
          ))}
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
              {[['이름 *','person_name','text'],['팀','team','select-team'],['직급','grade','select-grade'],['재직상태','employment_status','select-status']].map(([label, key, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  {type === 'text' ? (
                    <input value={(form as any)[key]} onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                  ) : (
                    <select value={(form as any)[key]} onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {(type==='select-team'?TEAM_OPTS:type==='select-grade'?GRADE_OPTS:STATUS_OPTS).map(o=><option key={o}>{o}</option>)}
                    </select>
                  )}
                </div>
              ))}
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
