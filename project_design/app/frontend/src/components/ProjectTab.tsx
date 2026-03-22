import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Search, FolderOpen, Building2, Trash2 } from 'lucide-react';
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
}

interface ProjectTabProps {
  projects: Project[];
  loading: boolean;
  onSelectProject: (id: number) => void;
  onRefresh?: () => void;
}

const statusConfig: Record<string, { label: string; className: string; sectionLabel: string }> = {
  '감리': { label: '감리', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100', sectionLabel: '📋 감리 사업' },
  '제안': { label: '제안', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100', sectionLabel: '📝 제안 사업' },
};

export default function ProjectTab({ projects, loading, onSelectProject, onRefresh }: ProjectTabProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { canWrite, isViewer } = useUserRole();

  const filtered = projects.filter(
    (p) =>
      p.project_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.organization?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by status
  const gamriProjects = filtered.filter((p) => p.status === '감리');
  const jeanProjects = filtered.filter((p) => p.status === '제안');

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

      // 각 프로젝트를 개별 삭제 (soft-delete → 감사 로그 자동 기록)
      for (const pid of idsToDelete) {
        try {
          // 관련 단계/투입공수 먼저 소프트 삭제
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
        // 프로젝트 소프트 삭제 — 감사 로그에 기록됨
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

  const renderProjectList = (projectList: Project[], sectionLabel: string, borderColor: string) => {
    if (projectList.length === 0) return null;
    const allSelected = projectList.every((p) => selectedIds.has(p.id));
    const someSelected = projectList.some((p) => selectedIds.has(p.id));

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-1">
          <Checkbox
            checked={allSelected}
            ref={(el) => {
              if (el) {
                const input = el as unknown as HTMLButtonElement;
                input.dataset.indeterminate = String(someSelected && !allSelected);
              }
            }}
            onCheckedChange={() => toggleSelectAll(projectList)}
            className="h-4 w-4"
          />
          <h3 className="text-sm font-bold text-slate-700">{sectionLabel}</h3>
          <Badge variant="outline" className="text-[10px]">{projectList.length}건</Badge>
        </div>
        {projectList.map((project) => {
          const sc = statusConfig[project.status] || statusConfig['감리'];
          const isSelected = selectedIds.has(project.id);
          return (
            <Card
              key={project.id}
              className={`hover:shadow-md transition-shadow border-l-4 ${isSelected ? 'ring-2 ring-blue-300 bg-blue-50/30' : ''}`}
              style={{ borderLeftColor: borderColor }}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(project.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 flex-shrink-0"
                  />
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onSelectProject(project.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <h3 className="font-semibold text-sm truncate">{project.project_name}</h3>
                      <Badge className={sc.className}>{sc.label}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {project.organization}
                      </span>
                      {project.notes && (
                        <span className="truncate max-w-[200px]">{project.notes}</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="프로젝트명 또는 기관명으로 검색..."
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

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">프로젝트가 없습니다.</div>
      ) : (
        <div className="space-y-6">
          {renderProjectList(gamriProjects, '📋 감리 사업', '#2563EB')}
          {renderProjectList(jeanProjects, '📝 제안 사업', '#D97706')}
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