// tab state managed via localStorage + URL param

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/api';
import ProjectTab from '@/components/ProjectTab';
import PeopleTab from '@/components/PeopleTab';
import ReportTab from '@/components/ReportTab';
import ScheduleTab from '@/components/ScheduleTab';
import ProjectGanttTab from '@/components/ProjectGanttTab';
import LandingPage from '@/components/LandingPage';
import Header from '@/components/Header';
import { FolderOpen, Users, BarChart3, CalendarDays, GanttChart, Plus, Home, Maximize2, Minimize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Project {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  deadline?: string;
  notes?: string;
  updated_at?: string;
}

interface Person {
  id: number;
  person_name: string;
  position?: string;        // 직급
  team?: string;            // 팀 (레거시)
  grade?: string;           // 감리원 등급
  employment_status?: string; // 구분
}

interface Phase {
  id: number;
  project_id: number;
  phase_name: string;
  sort_order: number;
  start_date?: string;
  end_date?: string;
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

const WIDE_MODE_KEY = 'schedule_wide_mode';

export default function IndexPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<string>(() => {
    // URL 파라미터가 있으면 우선, 없으면 localStorage
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      return p || localStorage.getItem('activeTab') || 'home';
    } catch { return 'home'; }
  });

  // URL ?tab= 파라미터 변화 감지 (로고 클릭 시 홈 이동 등)
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab) {
      setActiveTab(tab);
      try { localStorage.setItem('activeTab', tab); } catch { /* ignore */ }
    }
  }, [location.search]);

  // 너비 확장 상태 - localStorage에 저장/복원
  const [wideMode, setWideMode] = useState<boolean>(() => {
    try { return localStorage.getItem(WIDE_MODE_KEY) === 'true'; } catch { return false; }
  });

  const toggleWideMode = () => {
    setWideMode(prev => {
      const next = !prev;
      try { localStorage.setItem(WIDE_MODE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try { localStorage.setItem('activeTab', tab); } catch { /* ignore */ }
  };
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [staffing, setStaffing] = useState<Staffing[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingPeople, setLoadingPeople] = useState(true);

  // New project dialog
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProject, setNewProject] = useState({ project_name: '', organization: '', status: '감리', notes: '' });
  const [phaseText, setPhaseText] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // New person dialog
  const [showNewPerson, setShowNewPerson] = useState(false);
  const [newPerson, setNewPerson] = useState({ person_name: '', position: '', grade: '', employment_status: '' });
  const [creatingPerson, setCreatingPerson] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await client.entities.projects.query({ query: {}, limit: 200, sort: 'id' });
      setProjects(res?.data?.items || []);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const fetchPeople = useCallback(async () => {
    setLoadingPeople(true);
    try {
      const res = await client.entities.people.query({ query: {}, limit: 200 });
      setPeople(res?.data?.items || []);
    } catch (err) {
      console.error('Failed to fetch people:', err);
    } finally {
      setLoadingPeople(false);
    }
  }, []);

  const fetchPhases = useCallback(async () => {
    try {
      const res = await client.entities.phases.query({ query: {}, limit: 500 });
      setPhases(res?.data?.items || []);
    } catch (err) {
      console.error('Failed to fetch phases:', err);
    }
  }, []);

  const fetchStaffing = useCallback(async () => {
    try {
      const res = await client.entities.staffing.query({ query: {}, limit: 2000 });
      setStaffing(res?.data?.items || []);
    } catch (err) {
      console.error('Failed to fetch staffing:', err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchPeople();
    fetchPhases();
    fetchStaffing();
  }, []);

  // Stats for landing page
  const landingStats = useMemo(() => {
    const now = new Date();
    const activePhaseCount = phases.filter(ph => {
      if (!ph.start_date || !ph.end_date) return false;
      return new Date(ph.start_date) <= now && new Date(ph.end_date) >= now;
    }).length;
    const totalMd = staffing.reduce((sum, s) => sum + (s.md || 0), 0);
    return {
      projectCount: projects.length,
      peopleCount: people.length,
      activePhaseCount,
      totalMd,
    };
  }, [projects, people, phases, staffing]);

  const handleCreateProject = async () => {
    if (!newProject.project_name.trim() || !newProject.organization.trim()) {
      toast.error('프로젝트명과 기관명은 필수입니다.');
      return;
    }
    setCreatingProject(true);
    try {
      // Step 1: Create the project
      const projRes = await client.entities.projects.create({
        data: {
          project_name: newProject.project_name,
          organization: newProject.organization,
          status: newProject.status,
          notes: newProject.notes || '',
          updated_at: new Date().toISOString(),
        },
      });

      const createdProject = projRes?.data;
      if (!createdProject?.id) {
        toast.error('프로젝트 생성에 실패했습니다.');
        return;
      }

      // Step 2: If phase text is provided, import phases via backend API
      if (phaseText.trim()) {
        try {
          const importRes = await client.apiCall.invoke({
            url: '/api/v1/project_import/import_phases',
            method: 'POST',
            data: {
              project_id: createdProject.id,
              text: phaseText.trim(),
            },
          });
          const importData = importRes;
          toast.success(
            `프로젝트 생성 완료! ${importData?.phases_created || 0}개 단계, ${importData?.staffing_created || 0}개 투입공수, ${importData?.calendar_entries_created || 0}개 일정 생성됨`
          );
        } catch (importErr) {
          console.error('Phase import error:', importErr);
          toast.warning('프로젝트는 생성되었으나 단계 가져오기 중 오류가 발생했습니다.');
        }
      } else {
        toast.success('프로젝트가 생성되었습니다.');
      }

      setShowNewProject(false);
      setNewProject({ project_name: '', organization: '', status: '감리', notes: '' });
      setPhaseText('');
      fetchProjects();
      fetchPhases();
      fetchStaffing();
    } catch (err) {
      console.error(err);
      toast.error('프로젝트 생성 중 오류가 발생했습니다.');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCreatePerson = async () => {
    if (!newPerson.person_name.trim()) {
      toast.error('인력명은 필수입니다.');
      return;
    }
    setCreatingPerson(true);
    try {
      await client.entities.people.create({
        data: { ...newPerson, team: '' },
      });
      toast.success('인력이 등록되었습니다.');
      setShowNewPerson(false);
      setNewPerson({ person_name: '', position: '', grade: '', employment_status: '' });
      fetchPeople();
    } catch (err) {
      console.error(err);
      toast.error('인력 등록 중 오류가 발생했습니다.');
    } finally {
      setCreatingPerson(false);
    }
  };

  const refreshAll = useCallback(() => {
    fetchProjects();
    fetchPhases();
    fetchStaffing();
    fetchPeople();
  }, [fetchProjects, fetchPhases, fetchStaffing, fetchPeople]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      {/* Landing Page */}
      {activeTab === 'home' && (
        <LandingPage onNavigate={handleTabChange} stats={landingStats} />
      )}

      {/* Main Content */}
      {activeTab !== 'home' && (
      <main className={`mx-auto px-4 py-6 ${
        (activeTab === 'schedule' || activeTab === 'gantt') && wideMode
          ? 'max-w-full'
          : 'max-w-7xl'
      }`}>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="home" className="flex items-center gap-1.5">
                <Home className="h-4 w-4" />
                홈
              </TabsTrigger>
              <TabsTrigger value="projects" className="flex items-center gap-1.5">
                <FolderOpen className="h-4 w-4" />
                프로젝트
              </TabsTrigger>
              <TabsTrigger value="people" className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                인력
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" />
                인력별 일정
              </TabsTrigger>
              <TabsTrigger value="gantt" className="flex items-center gap-1.5">
                <GanttChart className="h-4 w-4" />
                사업별 일정
              </TabsTrigger>
              <TabsTrigger value="reports" className="flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4" />
                리포트
              </TabsTrigger>
            </TabsList>

            <div className="flex gap-2 items-center">
              {/* 너비 확장 버튼 - 인력별/사업별 일정에서만 표시 */}
              {(activeTab === 'schedule' || activeTab === 'gantt') && (
                <button
                  onClick={toggleWideMode}
                  title={wideMode ? '기본 너비로 줄이기' : '전체 너비로 확장'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    wideMode
                      ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {wideMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  {wideMode ? '기본 너비' : '전체 너비'}
                </button>
              )}
              {activeTab === 'projects' && (
                <Button size="sm" onClick={() => setShowNewProject(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  프로젝트 추가
                </Button>
              )}
              {activeTab === 'people' && (
                <Button size="sm" onClick={() => setShowNewPerson(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  인력 추가
                </Button>
              )}
            </div>
          </div>

          <TabsContent value="projects">
            <ProjectTab
              projects={projects}
              loading={loadingProjects}
              onSelectProject={(id) => navigate(`/project/${id}`)}
              onRefresh={refreshAll}
            />
          </TabsContent>

          <TabsContent value="people">
            <PeopleTab
              people={people}
              loading={loadingPeople}
              onSelectPerson={(id) => navigate(`/person/${id}`)}
              onRefresh={fetchPeople}
            />
          </TabsContent>

          <TabsContent value="schedule">
            <ScheduleTab
              projects={projects}
              phases={phases}
              staffing={staffing}
              people={people}
              onRefresh={refreshAll}
            />
          </TabsContent>

          <TabsContent value="gantt">
            <ProjectGanttTab
              projects={projects}
              phases={phases}
              staffing={staffing}
              people={people}
              onRefresh={refreshAll}
            />
          </TabsContent>

          <TabsContent value="reports">
            <ReportTab
              projects={projects}
              phases={phases}
              staffing={staffing}
              people={people}
            />
          </TabsContent>
        </Tabs>
      </main>
      )} {/* end activeTab !== 'home' */}

      {/* New Project Dialog */}
      <Dialog open={showNewProject} onOpenChange={setShowNewProject}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>새 프로젝트 생성</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>프로젝트명 *</Label>
                <Input
                  value={newProject.project_name}
                  onChange={(e) => setNewProject({ ...newProject, project_name: e.target.value })}
                  placeholder="프로젝트명 입력"
                />
              </div>
              <div>
                <Label>기관명 *</Label>
                <Input
                  value={newProject.organization}
                  onChange={(e) => setNewProject({ ...newProject, organization: e.target.value })}
                  placeholder="기관명 입력"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>상태</Label>
                <Select
                  value={newProject.status}
                  onValueChange={(v) => setNewProject({ ...newProject, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="감리">감리</SelectItem>
                    <SelectItem value="제안">제안</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>비고</Label>
                <Input
                  value={newProject.notes}
                  onChange={(e) => setNewProject({ ...newProject, notes: e.target.value })}
                  placeholder="비고"
                />
              </div>
            </div>

            {/* Phase Text Import */}
            <div className="border-t pt-4">
              <Label className="text-sm font-semibold">단계/투입공수 일괄 입력 (선택사항)</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                아래 형식으로 단계 정보를 입력하면 프로젝트 생성 시 자동으로 단계, 투입공수, 기본 일정이 생성됩니다.
              </p>
              <div className="bg-slate-50 rounded-md p-3 mb-2">
                <p className="text-[11px] text-slate-600 font-mono leading-relaxed">
                  <strong>형식:</strong> 단계명, 시작일(YYYYMMDD), 종료일(YYYYMMDD), 인력1:분야[:MD], 인력2:분야[:MD], ...
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  • <strong>이현우:사업관리 및 품질보증</strong> → MD 미지정 시 해당 단계 전체 영업일 투입
                </p>
                <p className="text-[10px] text-slate-500">
                  • <strong>강진욱:SW개발보안:4</strong> → 해당 단계 중 4일만 투입
                </p>
              </div>
              <Textarea
                value={phaseText}
                onChange={(e) => setPhaseText(e.target.value)}
                placeholder={`요구정의, 20250224, 20250228, 이현우:사업관리 및 품질보증, 차판용:응용시스템\n개략설계, 20250421, 20250430, 이현우:사업관리 및 품질보증, 강진욱:SW개발보안:4`}
                rows={8}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewProject(false)}>취소</Button>
            <Button onClick={handleCreateProject} disabled={creatingProject}>
              {creatingProject ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Person Dialog */}
      <Dialog open={showNewPerson} onOpenChange={setShowNewPerson}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 인력 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>이름 *</Label>
              <Input
                value={newPerson.person_name}
                onChange={(e) => setNewPerson({ ...newPerson, person_name: e.target.value })}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && document.getElementById('btn-create-person')?.click()}
              />
            </div>
            <div>
              <Label>직급</Label>
              <Input
                value={newPerson.position}
                onChange={(e) => setNewPerson({ ...newPerson, position: e.target.value })}

              />
            </div>
            <div>
              <Label>감리원 등급</Label>
              <Input
                value={newPerson.grade}
                onChange={(e) => setNewPerson({ ...newPerson, grade: e.target.value })}
              />
            </div>
            <div>
              <Label>구분</Label>
              <Input
                value={newPerson.employment_status}
                onChange={(e) => setNewPerson({ ...newPerson, employment_status: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPerson(false)}>취소</Button>
            <Button id="btn-create-person" onClick={handleCreatePerson} disabled={creatingPerson}>
              {creatingPerson ? '등록 중...' : '등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
