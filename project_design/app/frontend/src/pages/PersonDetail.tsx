import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Briefcase, Edit2, Check, X, Save } from 'lucide-react';
import { toast } from 'sonner';

interface Person {
  id: number;
  person_name: string;
  position?: string;
  team?: string;
  grade?: string;
  employment_status?: string;
}

interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
}

interface Phase {
  id: number;
  project_id: number;
  phase_name: string;
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
}

interface ProjectSummary {
  project: Project;
  total: number;
}

const empStatusConfig: Record<string, string> = {
  '재직': 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  '외부': 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  '퇴사': 'bg-red-100 text-red-700 hover:bg-red-100',
};

const gradeOptions = ['특급', '고급', '중급', '초급'];
const statusOptions = ['재직', '외부', '퇴사'];

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const personId = Number(id);

  const [person, setPerson] = useState<Person | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [staffing, setStaffing] = useState<Staffing[]>([]);
  const [loading, setLoading] = useState(true);

  // 인라인 수정 상태
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Person>>({});
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [personRes, projectsRes, staffingRes] = await Promise.all([
        client.entities.people.get({ id: String(personId) }),
        client.entities.projects.query({ query: {}, limit: 200, sort: 'id' }),
        client.entities.staffing.query({ query: { person_id: personId }, limit: 2000 }),
      ]);
      setPerson(personRes?.data || null);
      setProjects(projectsRes?.data?.items || []);
      setStaffing(staffingRes?.data?.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 편집 시작
  const startEdit = () => {
    if (!person) return;
    setEditForm({
      person_name: person.person_name,
      position: person.position || '',
      grade: person.grade || '',
      employment_status: person.employment_status || '재직',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditForm({});
  };

  // 저장
  const handleSave = async () => {
    if (!person) return;
    if (!editForm.person_name?.trim()) {
      toast.error('이름은 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      const res = await client.entities.people.update({
        id: String(person.id),
        data: editForm,
      });
      setPerson(res?.data || person);
      setEditing(false);
      toast.success('인력 정보가 수정되었습니다.');
    } catch (err) {
      console.error(err);
      toast.error('수정에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // 프로젝트별 MD 합산 (간략 표시)
  const projectSummaries = useMemo((): ProjectSummary[] => {
    const projectIds = [...new Set(staffing.map((s) => s.project_id))];
    return projectIds.map((pid) => {
      const project = projects.find((p) => p.id === pid);
      if (!project) return null;
      const total = staffing
        .filter((s) => s.project_id === pid)
        .reduce((sum, s) => sum + (s.md ?? 0), 0);
      return { project, total };
    }).filter(Boolean) as ProjectSummary[];
  }, [staffing, projects]);

  const totalAllMd = useMemo(() => {
    return staffing.reduce((sum, s) => sum + (s.md ?? 0), 0);
  }, [staffing]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">인력 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/?tab=people')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            목록
          </Button>
          <h1 className="text-lg font-bold text-slate-800 flex-1">{person.person_name}</h1>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEdit}>
              <Edit2 className="h-4 w-4 mr-1" />
              정보 수정
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ── 인력 정보 카드 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* 상단 헤더 */}
          <div className="bg-gradient-to-r from-blue-50 to-slate-50 px-6 py-4 flex items-center gap-4 border-b border-slate-100">
            <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <User className="h-7 w-7 text-blue-600" />
            </div>
            <div className="flex-1">
              {editing ? (
                <input
                  className="text-xl font-bold text-slate-800 border-b-2 border-blue-400 bg-transparent outline-none w-full"
                  value={editForm.person_name || ''}
                  onChange={(e) => setEditForm({ ...editForm, person_name: e.target.value })}
                  placeholder="이름"
                />
              ) : (
                <h2 className="text-xl font-bold text-slate-800">{person.person_name}</h2>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">총 투입 MD</p>
              <p className="text-3xl font-bold text-blue-600">{totalAllMd}</p>
            </div>
          </div>

          {/* 상세 필드 */}
          <div className="px-6 py-4">
            {editing ? (
              /* ── 편집 모드 ── */
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 직급 */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">직급</label>
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={editForm.position || ''}
                    onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                    placeholder="예: 수석, 책임, 선임, 주임, 사원"
                  />
                </div>
                {/* 감리원 등급 */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">감리원 등급</label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={editForm.grade || ''}
                    onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}
                  >
                    <option value="">선택</option>
                    {gradeOptions.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                {/* 구분 */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">구분</label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={editForm.employment_status || '재직'}
                    onChange={(e) => setEditForm({ ...editForm, employment_status: e.target.value })}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              /* ── 보기 모드 ── */
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">직급</p>
                  <p className="font-medium text-slate-700">{person.position || <span className="text-slate-300">-</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">감리원 등급</p>
                  {person.grade
                    ? <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium text-xs">{person.grade}</span>
                    : <span className="text-slate-300">-</span>
                  }
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">구분</p>
                  {person.employment_status
                    ? <Badge className={empStatusConfig[person.employment_status] || ''}>{person.employment_status}</Badge>
                    : <span className="text-slate-300">-</span>
                  }
                </div>
              </div>
            )}

            {/* 수정 모드 버튼 */}
            {editing && (
              <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
                  <X className="h-4 w-4 mr-1" />
                  취소
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving
                    ? <><Save className="h-4 w-4 mr-1 animate-pulse" />저장 중...</>
                    : <><Check className="h-4 w-4 mr-1" />저장</>
                  }
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── 참여 프로젝트 (간략) ── */}
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-slate-700 mb-3">
            <Briefcase className="h-4 w-4" />
            참여 프로젝트 ({projectSummaries.length}개)
          </h3>

          {projectSummaries.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              참여 중인 프로젝트가 없습니다.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">사업명</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">구분</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">투입 MD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {projectSummaries.map((ps) => (
                    <tr key={ps.project.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{ps.project.project_name}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          className={
                            ps.project.status === '감리'
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-100 text-xs'
                          }
                        >
                          {ps.project.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-blue-600">
                        {ps.total > 0 ? ps.total : <span className="text-slate-300 font-normal">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={2} className="px-4 py-2.5 text-xs font-medium text-slate-500">합계</td>
                    <td className="px-4 py-2.5 text-right font-bold text-blue-700">{totalAllMd} MD</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
