import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, Briefcase, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Person {
  id: number;
  person_name: string;
  position?: string;
  team?: string;
  grade?: string;
  employment_status?: string;
  company?: string;
  is_chief?: boolean;       // 총괄감리원 여부
  region?: string;          // 거주지역
  can_travel?: boolean;     // 지방 출장 가능 여부
}

interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
}

interface Staffing {
  id: number;
  project_id: number;
  phase_id: number;
  person_id?: number;
  md?: number | null;
}

interface ProjectSummary {
  project: Project;
  total: number;
}

// ── 클릭 시 인라인 편집되는 필드 컴포넌트 ──────────────────
interface InlineFieldProps {
  label: string;
  value: string;
  onSave: (val: string) => Promise<void>;
}

function InlineField({ label, value, onSave }: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 외부 value 동기화
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const open = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commit = async () => {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  };

  return (
    <div className="group">
      <p className="text-xs text-slate-400 mb-1">{label}</p>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            className="flex-1 border border-blue-400 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {saving
            ? <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin flex-shrink-0" />
            : <Check className="h-3.5 w-3.5 text-blue-500 cursor-pointer flex-shrink-0" onClick={commit} />
          }
        </div>
      ) : (
        <div
          onClick={open}
          title="클릭하여 편집"
          className="min-h-[28px] flex items-center cursor-pointer rounded-md px-2 py-1 -mx-2 hover:bg-blue-50 transition-colors group-hover:ring-1 group-hover:ring-blue-200"
        >
          {value
            ? <span className="text-sm font-medium text-slate-700">{value}</span>
            : <span className="text-sm text-slate-400">-</span>
          }
          <span className="ml-auto text-[10px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pl-2">편집</span>
        </div>
      )}
    </div>
  );
}

// ── 이름 인라인 편집 ─────────────────────────────────────────
interface InlineNameProps {
  value: string;
  onSave: (val: string) => Promise<void>;
}
function InlineName({ value, onSave }: InlineNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const open = () => { setDraft(value); setEditing(true); setTimeout(() => ref.current?.focus(), 30); };

  const commit = async () => {
    if (!draft.trim()) { toast.error('이름은 필수입니다.'); ref.current?.focus(); return; }
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); setEditing(false); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          className="text-xl font-bold text-slate-800 border-b-2 border-blue-400 bg-transparent outline-none flex-1"
        />
        {saving && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
      </div>
    );
  }

  return (
    <h2
      onClick={open}
      title="클릭하여 이름 편집"
      className="text-xl font-bold text-slate-800 cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-1.5 group"
    >
      {value}
      <span className="text-xs font-normal text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">✏︎</span>
    </h2>
  );
}


// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const personId = Number(id);

  const [person, setPerson] = useState<Person | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [staffing, setStaffing] = useState<Staffing[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 단일 필드 저장 헬퍼 (string 및 boolean 모두 지원)
  const saveField = useCallback(async (field: keyof Person, val: string | boolean) => {
    if (!person) return;
    try {
      const res = await client.entities.people.update({
        id: String(person.id),
        data: { [field]: val },
      });
      setPerson(res?.data || { ...person, [field]: val });
      toast.success('저장되었습니다.');
    } catch (err) {
      console.error(err);
      toast.error('저장에 실패했습니다.');
      throw err;
    }
  }, [person]);

  const projectSummaries = useMemo((): ProjectSummary[] => {
    const projectIds = [...new Set(staffing.map((s) => s.project_id))];
    return projectIds.map((pid) => {
      const project = projects.find((p) => p.id === pid);
      if (!project) return null;
      const total = staffing.filter((s) => s.project_id === pid).reduce((sum, s) => sum + (s.md ?? 0), 0);
      return { project, total };
    }).filter(Boolean) as ProjectSummary[];
  }, [staffing, projects]);

  const totalAllMd = useMemo(() => staffing.reduce((sum, s) => sum + (s.md ?? 0), 0), [staffing]);

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
          <span className="text-xs text-slate-400 hidden sm:inline">항목을 클릭하면 바로 수정됩니다</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ── 인력 정보 카드 ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* 상단: 아이콘 + 이름 + MD */}
          <div className="bg-gradient-to-r from-blue-50 to-slate-50 px-6 py-4 flex items-center gap-4 border-b border-slate-100">
            <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <User className="h-7 w-7 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <InlineName
                value={person.person_name}
                onSave={(val) => saveField('person_name', val)}
              />
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-slate-400">총 투입 MD</p>
              <p className="text-3xl font-bold text-blue-600">{totalAllMd}</p>
            </div>
          </div>

          {/* 하단: 기본 필드 4개 */}
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-6">
            <InlineField
              label="회사"
              value={person.company || ''}
              onSave={(val) => saveField('company', val)}
            />
            <InlineField
              label="직급"
              value={person.position || ''}
              onSave={(val) => saveField('position', val)}
            />
            <InlineField
              label="감리원 등급"
              value={person.grade || ''}
              onSave={(val) => saveField('grade', val)}
            />
            <InlineField
              label="구분"
              value={person.employment_status || ''}
              onSave={(val) => saveField('employment_status', val)}
            />
          </div>

          {/* 추가 필드: 거주지역, 총괄감리원, 지방가능 */}
          <div className="px-6 pb-4 border-t border-slate-100 pt-4 grid grid-cols-2 sm:grid-cols-3 gap-6">
            <InlineField
              label="거주지역"
              value={person.region || ''}
              onSave={(val) => saveField('region', val)}
            />
            {/* 총괄감리원 토글 */}
            <div>
              <p className="text-xs text-slate-400 mb-1">총괄감리원</p>
              <button
                onClick={() => saveField('is_chief', !person.is_chief)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  person.is_chief
                    ? 'bg-purple-100 text-purple-700 border-purple-300 hover:bg-purple-200'
                    : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                }`}
              >
                <span>{person.is_chief ? '✓ 총괄감리원' : '일반'}</span>
              </button>
            </div>
            {/* 지방 출장 가능 토글 */}
            <div>
              <p className="text-xs text-slate-400 mb-1">지방 출장</p>
              <button
                onClick={() => saveField('can_travel', !(person.can_travel !== false))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  person.can_travel !== false
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200'
                    : 'bg-red-100 text-red-600 border-red-200 hover:bg-red-200'
                }`}
              >
                <span>{person.can_travel !== false ? '✓ 가능' : '✗ 불가'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── 참여 프로젝트 ── */}
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
