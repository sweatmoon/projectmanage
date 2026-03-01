import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProjects, createProject, type Project } from '../api'

const STATUS_STYLE: Record<string, { badge: string; border: string }> = {
  '감리': { badge: 'bg-blue-100 text-blue-700', border: 'border-l-[4px] border-l-blue-500' },
  '제안': { badge: 'bg-amber-100 text-amber-700', border: 'border-l-[4px] border-l-amber-500' },
}
function getStyle(status: string) {
  return STATUS_STYLE[status] ?? { badge: 'bg-gray-100 text-gray-500', border: 'border-l-[4px] border-l-gray-300' }
}
function fmtDate(d?: string) {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getFullYear()}. ${dt.getMonth()+1}. ${dt.getDate()}.`
}

const EMPTY = { project_name:'', organization:'', status:'감리', deadline:'', notes:'' }

interface Props { headerBtnId?: string }

export default function ProjectsTab({ headerBtnId }: Props) {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const fetch = () => {
    setLoading(true)
    getProjects().then(d => { setProjects(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { fetch() }, [])

  // 헤더 버튼 클릭 연동
  useEffect(() => {
    if (!headerBtnId) return
    const btn = document.getElementById(headerBtnId)
    if (!btn) return
    const h = () => { setForm({ ...EMPTY }); setShowModal(true) }
    btn.addEventListener('click', h)
    return () => btn.removeEventListener('click', h)
  }, [headerBtnId])

  const filtered = projects.filter(p =>
    p.project_name.toLowerCase().includes(search.toLowerCase()) ||
    p.organization.toLowerCase().includes(search.toLowerCase())
  )

  const save = async () => {
    if (!form.project_name.trim() || !form.organization.trim()) return
    setSaving(true)
    try {
      await createProject(form)
      setShowModal(false)
      fetch()
    } finally { setSaving(false) }
  }

  return (
    <div>
      {/* 검색 */}
      <div className="mb-4 relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="프로젝트명 또는 기관명으로 검색..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">프로젝트가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const s = getStyle(p.status)
            return (
              <div key={p.id} onClick={() => navigate(`/project/${p.id}`)}
                className={`bg-white rounded-lg p-4 shadow-sm ${s.border} cursor-pointer hover:shadow-md transition-shadow`}>
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h3l2 2h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="font-semibold text-gray-900 text-sm">{p.project_name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{p.status}</span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 ml-6.5 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                    {p.organization}
                  </span>
                  {p.deadline && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      마감: {fmtDate(p.deadline)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 추가 모달 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold">프로젝트 추가</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">프로젝트명 *</label>
                <input value={form.project_name} onChange={e => setForm(f=>({...f,project_name:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="프로젝트명" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">발주기관 *</label>
                <input value={form.organization} onChange={e => setForm(f=>({...f,organization:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="기관명" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">상태</label>
                <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>감리</option><option>제안</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">마감일</label>
                <input type="date" value={form.deadline} onChange={e => setForm(f=>({...f,deadline:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">비고</label>
                <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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
