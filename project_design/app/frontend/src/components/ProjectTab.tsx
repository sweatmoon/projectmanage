import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/useUserRole';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, FolderOpen, Building2, Trash2, ChevronDown, ChevronRight, Crown, ClipboardList, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/api';

interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  deadline?: string;
  notes?: string;
  updated_at?: string;
  is_won?: boolean;
}

interface ProjectTabProps {
  projects: Project[];
  loading: boolean;
  onSelectProject: (id: number) => void;
  onRefresh?: () => void;
}

// 가나다순 정렬
function sortKorean(a: Project, b: Project) {
  return a.project_name.localeCompare(b.project_name, 'ko');
}

export default function ProjectTab({ projects, loading, onSelectProject, onRefresh }: ProjectTabProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 섹션 접기/펼치기 상태
  const [gamriOpen, setGamriOpen] = useState(true);
  const [jeanOpen, setJeanOpen] = useState(true);
  const [wonOpen, setWonOpen] = useState(true);

  const { canWrite, isViewer } = useUserRole();

  const filtered = projects.filter(
    (p) =>
      p.project_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.organization?.toLowerCase().includes(search.toLowerCase())
  );

  // 그룹 분류
  const gamriProjects = filtered.filter((p) => p.status === '감리').sort(sortKorean);
  const jeanProjects = filtered.filter((p) => p.status === '제안' && !p.is_won).sort(sortKorean);
  const wonProjects = filtered.filter((p) => p.status === '제안' && p.is_won).sort(sortKorean);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (projectList: Project[]) => {
    const ids = projectList.map((p) => p.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    setDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);

      for (const pid of idsToDelete) {
        try {
          const phasesRes = await client.entities.phases.query({ query: { project_id: pid }, limit: 100 });
          const phaseItems = phasesRes?.data?.items || [];
          const allStaffIds: number[] = [];
          await Promise.all(phaseItems.map(async (phase: { id: number }) => {
            const staffRes = await client.entities.staffing.query({ query: { phase_id: phase.id }, limit: 500 });
            const staffItems = staffRes?.data?.items || [];
            staffItems.forEach((s: { id: number }) => allStaffIds.push(s.id));
          }));
          if (allStaffIds.length > 0) {
            await Promise.all(allStaffIds.map((sid) =>
              client.entities.staffing.delete({ id: String(sid) }).catch(() => {})
            ));
          }
          await Promise.all(phaseItems.map((phase: { id: number }) =>
            client.entities.phases.delete({ id: String(phase.id) }).catch(() => {})
          ));
        } catch { /* continue */ }
        await client.entities.projects.delete({ id: String(pid) });
      }

      toast.success(`${idsToDelete.length}개 프로젝트가 삭제되었습니다.`);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      onRefresh?.();
    } catch (err) {
      console.error(err);
      toast.error('프로젝트 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  // 개별 프로젝트 카드 렌더링
  const renderProjectCard = (project: Project, accentColor: string) => {
    const isSelected = selectedIds.has(project.id);
    const isWon = !!project.is_won;

    return (
      <div
        key={project.id}
        className={`
          flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all cursor-pointer
          ${isSelected ? 'ring-2 ring-blue-300 bg-blue-50/40 border-blue-200' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'}
          ${isWon ? 'bg-gradient-to-r from-amber-50/60 to-yellow-50/40' : ''}
        `}
        style={{ borderLeftWidth: '3px', borderLeftColor: accentColor }}
        onClick={() => onSelectProject(project.id)}
      >
        {/* 체크박스 */}
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleSelect(project.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-3.5 w-3.5 flex-shrink-0"
        />

        {/* 폴더 아이콘 */}
        <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accentColor }} />

        {/* 사업명 */}
        <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">
          {project.project_name}
        </span>

        {/* 기관명 */}
        <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0 max-w-[120px] truncate">
          <Building2 className="h-3 w-3 flex-shrink-0" />
          {project.organization}
        </span>

        {/* 수주 배지 */}
        {isWon && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 flex-shrink-0">
            <Crown className="h-2.5 w-2.5" />
            수주
          </span>
        )}

        {/* 비고 */}
        {project.notes && (
          <span className="text-[10px] text-slate-400 flex-shrink-0 max-w-[100px] truncate hidden sm:block" title={project.notes}>
            {project.notes}
          </span>
        )}
      </div>
    );
  };

  // 섹션 헤더 렌더링
  const renderSectionHeader = (
    label: string,
    icon: React.ReactNode,
    count: number,
    totalCount: number,
    open: boolean,
    onToggle: () => void,
    color: string,
    bgColor: string,
    projectList: Project[],
    showSelectAll = true
  ) => {
    const allSelected = projectList.length > 0 && projectList.every((p) => selectedIds.has(p.id));
    const someSelected = projectList.some((p) => selectedIds.has(p.id));

    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer select-none"
        style={{ backgroundColor: bgColor }}
        onClick={onToggle}
      >
        {/* 체크박스 전체 선택 */}
        {showSelectAll && projectList.length > 0 && (
          <Checkbox
            checked={allSelected}
            data-indeterminate={someSelected && !allSelected ? 'true' : undefined}
            onCheckedChange={() => toggleSelectAll(projectList)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 flex-shrink-0"
          />
        )}
        {/* 접기/펼치기 아이콘 */}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
          : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" style={{ color }} />
        }
        {/* 섹션 아이콘 + 레이블 */}
        {icon}
        <span className="text-sm font-bold" style={{ color }}>{label}</span>
        {/* 건수 배지 */}
        <span
          className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ backgroundColor: color + '22', color }}
        >
          {count}건
        </span>
        {/* 검색 결과가 전체와 다를 때 전체 표시 */}
        {search && count !== totalCount && (
          <span className="text-[10px] text-slate-400">(전체 {totalCount}건)</span>
        )}
      </div>
    );
  };

  const totalGamri = projects.filter(p => p.status === '감리').length;
  const totalJean = projects.filter(p => p.status === '제안' && !p.is_won).length;
  const totalWon = projects.filter(p => p.status === '제안' && p.is_won).length;

  return (
    <div className="space-y-3">
      {/* 검색 + 삭제 버튼 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="사업명 또는 기관명으로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        {selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!canWrite}
            title={isViewer ? '조회 전용 계정입니다' : undefined}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            선택 삭제 ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* 전체 요약 바 */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-500">
          <span>전체 <strong className="text-slate-700">{filtered.length}</strong>건</span>
          <span className="text-slate-300">|</span>
          <span className="text-blue-600">감리 <strong>{gamriProjects.length}</strong></span>
          <span className="text-slate-300">|</span>
          <span className="text-amber-600">제안 <strong>{jeanProjects.length}</strong></span>
          {wonProjects.length > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-yellow-600">👑 수주 <strong>{wonProjects.length}</strong></span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? `"${search}"에 해당하는 프로젝트가 없습니다.` : '프로젝트가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-3">

          {/* ── 감리 사업 섹션 ── */}
          {(gamriProjects.length > 0 || totalGamri > 0) && (
            <div className="rounded-xl border border-blue-100 overflow-hidden">
              {renderSectionHeader(
                '감리 사업',
                <ClipboardList className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />,
                gamriProjects.length,
                totalGamri,
                gamriOpen,
                () => setGamriOpen(v => !v),
                '#2563EB',
                '#EFF6FF',
                gamriProjects
              )}
              {gamriOpen && gamriProjects.length > 0 && (
                <div className="p-2 space-y-1 bg-white">
                  {gamriProjects.map(p => renderProjectCard(p, '#2563EB'))}
                </div>
              )}
              {gamriOpen && gamriProjects.length === 0 && search && (
                <div className="py-3 text-center text-xs text-slate-400 bg-white">검색 결과 없음</div>
              )}
            </div>
          )}

          {/* ── 제안 사업 섹션 ── */}
          {(jeanProjects.length > 0 || wonProjects.length > 0 || totalJean > 0 || totalWon > 0) && (
            <div className="rounded-xl border border-amber-100 overflow-hidden">
              {/* 제안 섹션 헤더 – 제안 + 수주 전체 카운트 */}
              {renderSectionHeader(
                '제안 사업',
                <FileText className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />,
                jeanProjects.length + wonProjects.length,
                totalJean + totalWon,
                jeanOpen,
                () => setJeanOpen(v => !v),
                '#D97706',
                '#FFFBEB',
                [...jeanProjects, ...wonProjects]
              )}

              {jeanOpen && (
                <div className="bg-white">
                  {/* 수주 완료 하위 그룹 */}
                  {(wonProjects.length > 0 || totalWon > 0) && (
                    <div className="mx-2 mt-2 mb-1 rounded-lg border border-yellow-200 overflow-hidden">
                      {/* 수주 소헤더 */}
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
                        style={{ background: 'linear-gradient(90deg, #fef9c3 0%, #fef3c7 100%)' }}
                        onClick={() => setWonOpen(v => !v)}
                      >
                        {wonProjects.length > 0 && (
                          <Checkbox
                            checked={wonProjects.every(p => selectedIds.has(p.id))}
                            data-indeterminate={wonProjects.some(p => selectedIds.has(p.id)) && !wonProjects.every(p => selectedIds.has(p.id)) ? 'true' : undefined}
                            onCheckedChange={() => toggleSelectAll(wonProjects)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 flex-shrink-0"
                          />
                        )}
                        {wonOpen
                          ? <ChevronDown className="h-3 w-3 text-yellow-600 flex-shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-yellow-600 flex-shrink-0" />
                        }
                        <Crown className="h-3.5 w-3.5 text-yellow-600 flex-shrink-0" />
                        <span className="text-xs font-bold text-yellow-700">수주 완료</span>
                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-200 text-yellow-700">
                          {wonProjects.length}건
                        </span>
                        {search && wonProjects.length !== totalWon && (
                          <span className="text-[10px] text-slate-400">(전체 {totalWon}건)</span>
                        )}
                      </div>
                      {wonOpen && wonProjects.length > 0 && (
                        <div className="p-2 space-y-1 bg-white">
                          {wonProjects.map(p => renderProjectCard(p, '#D97706'))}
                        </div>
                      )}
                      {wonOpen && wonProjects.length === 0 && search && (
                        <div className="py-2 text-center text-xs text-slate-400 bg-white">검색 결과 없음</div>
                      )}
                    </div>
                  )}

                  {/* 일반 제안 목록 */}
                  {jeanProjects.length > 0 && (
                    <div className="p-2 space-y-1">
                      {jeanProjects.map(p => renderProjectCard(p, '#D97706'))}
                    </div>
                  )}
                  {jeanProjects.length === 0 && search && wonProjects.length === 0 && (
                    <div className="py-3 text-center text-xs text-slate-400">검색 결과 없음</div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>프로젝트 삭제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 <strong>{selectedIds.size}개</strong> 프로젝트를 삭제하시겠습니까?
              <br />
              관련된 모든 단계, 투입공수, 일정 데이터도 함께 삭제됩니다.
              <br />
              <span className="text-red-600 font-semibold">이 작업은 되돌릴 수 없습니다.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? '삭제 중...' : `${selectedIds.size}개 삭제`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
