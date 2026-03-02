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
    // React Router navigate로 URL 업데이트 → location.search 변화 정상 감지
    navigate(`/?tab=${tab}`, { replace: true });
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

  // 제안 모드 인력 섹션 상태
  const [proposalScheduleText, setProposalScheduleText] = useState('');
  const [proposalSections, setProposalSections] = useState([
    { label: '감리원', text: '' },
    { label: '핵심기술', text: '' },
    { label: '필수기술', text: '' },
    { label: '보안진단', text: '' },
    { label: '테스트', text: '' },
  ]);
  const updateProposalSection = (idx: number, text: string) => {
    setProposalSections(prev => prev.map((s, i) => i === idx ? { ...s, text } : s));
  };

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
    fetchHomeStats();
  }, []);

  // Stats for landing page (API 기반)
  const [homeStats, setHomeStats] = useState<{
    active_project_count: number;
    proposal_count: number;
    people_count: number;
    utilization_rate: number;
    utilization_numerator: number;
    utilization_denominator: number;
    auditor_count: number;
    biz_days_ytd: number;
  } | null>(null);

  const fetchHomeStats = useCallback(async () => {
    try {
      const s = await client.home.getStats();
      setHomeStats(s);
    } catch (err) {
      console.error('Failed to fetch home stats:', err);
    }
  }, []);

  const landingStats = useMemo(() => {
    if (homeStats) {
      return {
        activeProjectCount: homeStats.active_project_count,
        proposalCount: homeStats.proposal_count,
        peopleCount: homeStats.people_count,
        utilizationRate: homeStats.utilization_rate,
        utilizationNumerator: homeStats.utilization_numerator,
        utilizationDenominator: homeStats.utilization_denominator,
        auditorCount: homeStats.auditor_count,
        bizDaysYtd: homeStats.biz_days_ytd,
      };
    }
    // 로딩 중 기본값
    return {
      activeProjectCount: 0,
      proposalCount: 0,
      peopleCount: people.length,
      utilizationRate: 0,
      utilizationNumerator: 0,
      utilizationDenominator: 0,
      auditorCount: 0,
      bizDaysYtd: 0,
    };
  }, [homeStats, people.length]);

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

      // Step 2: 단계/인력 일괄 입력
      const isProposal = newProject.status === '제안';

      // buildProposalPhaseData:
      // - 감리 일정: "단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:3, 이름C"
      // - 섹션: 이름 → 분야 + category 매핑용
      // → "단계명, YYYYMMDD, YYYYMMDD, 이름A:분야, 이름B:분야:3, 이름C:분야"
      const buildProposalPhaseData = () => {
        const sectionDefaultField: Record<string, string> = {
          '감리원': '',
          '핵심기술': '핵심기술',
          '필수기술': '필수기술',
          '보안진단': '보안진단',
          '테스트': '기능테스트',
        };

        // 섹션에서 이름 → { field, category } 맵 구성
        const nameInfo: Record<string, { field: string; category: string }> = {};
        for (const section of proposalSections) {
          if (!section.text.trim()) continue;
          const defaultField = sectionDefaultField[section.label] ?? section.label;
          const category = section.label === '감리원' ? '단계감리팀' : section.label; // 세부 섹션명 보존
          for (const line of section.text.split('\n')) {
            const l = line.trim();
            if (!l) continue;
            let name = '', field = '';
            if (l.includes(',')) {
              [name, field] = l.split(',', 2).map(s => s.trim());
            } else if (l.includes(':')) {
              [name, field] = l.split(':', 2).map(s => s.trim());
            } else {
              name = l.trim();
            }
            if (!field) field = defaultField;
            if (name) nameInfo[name] = { field, category };
          }
        }

        // 감리 일정 텍스트: 이름 뒤에 분야 삽입, MD 유지
        const sectionMap: Record<string, string> = {};
        const text = proposalScheduleText.trim().split('\n').map(line => {
          const l = line.trim();
          if (!l) return '';
          const parts = l.split(',').map(s => s.trim());
          if (parts.length < 3) return l;
          const header = parts.slice(0, 3);
          const people = parts.slice(3).map(entry => {
            if (!entry) return '';
            const colonParts = entry.split(':');
            const name = colonParts[0].trim();
            const secondPart = colonParts[1]?.trim();
            const isMd = secondPart !== undefined && /^\d+$/.test(secondPart);
            const mdStr = isMd ? secondPart : (colonParts[2]?.trim() && /^\d+$/.test(colonParts[2].trim()) ? colonParts[2].trim() : '');
            const info = nameInfo[name];
            if (info) sectionMap[name] = info.category;
            const field = info?.field || (!isMd && secondPart ? secondPart : '');
            if (field && mdStr) return `${name}:${field}:${mdStr}`;
            if (field) return `${name}:${field}`;
            if (mdStr) return `${name}:${mdStr}`;
            return name;
          }).filter(Boolean);
          return [...header, ...people].join(', ');
        }).filter(Boolean).join('\n');
        return { text, sectionMap };
      };

      const proposalData = isProposal ? buildProposalPhaseData() : null;
      const finalPhaseText = isProposal
        ? (proposalData?.text ?? '')
        : phaseText.trim();

      if (finalPhaseText) {
        try {
          const importRes = await client.apiCall.invoke({
            url: '/api/v1/project_import/import_phases',
            method: 'POST',
            data: {
              project_id: createdProject.id,
              text: finalPhaseText,
              ...(isProposal && proposalData?.sectionMap ? { section_map: proposalData.sectionMap } : {}),
            },
          });
          toast.success(
            `프로젝트 생성 완료! ${importRes?.phases_created || 0}개 단계, ${importRes?.staffing_created || 0}개 투입공수, ${importRes?.calendar_entries_created || 0}개 일정 생성됨`
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
      setProposalScheduleText('');
      setProposalSections([
        { label: '감리원', text: '' },
        { label: '핵심기술', text: '' },
        { label: '필수기술', text: '' },
        { label: '보안진단', text: '' },
        { label: '테스트', text: '' },
      ]);
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

            {/* Phase Text Import - 감리/제안 모드 분기 */}
            <div className="border-t pt-4">
              {newProject.status === '제안' ? (
                /* ── 제안 모드 ── */
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">제안서 일정/인력 입력 (선택사항)</Label>
                  <p className="text-xs text-muted-foreground">
                    감리 일정과 인력 영역을 입력하면 단계·투입공수·기본 일정이 자동 생성됩니다.
                  </p>

                  {/* 감리 일정 */}
                  <div>
                    <Label className="text-xs font-medium text-slate-700">📅 감리 일정</Label>
                    <p className="text-[10px] text-slate-500 mb-1">
                      형식: 단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:3  (이름만=전체기간, 이름:숫자=MD지정)
                    </p>
                    <Textarea
                      value={proposalScheduleText}
                      onChange={(e) => setProposalScheduleText(e.target.value)}
                      placeholder={`설계-정밀진단, 20260323, 20260327, 강혁, 김현선, 최규택:3\n설계-재검증, 20260427, 20260501, 강혁, 김현선, 최규택, 양권묵:2`}
                      rows={3}
                      className="font-mono text-xs"
                    />
                  </div>

                  {/* 인력 섹션들 */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* 감리원 - 전체 너비 */}
                    <div className="col-span-2">
                      <Label className="text-xs font-medium text-slate-700">👤 감리원</Label>
                      <p className="text-[10px] text-slate-500 mb-1">형식: 이름, 분야  (한 줄에 한 명)</p>
                      <Textarea
                        value={proposalSections[0].text}
                        onChange={(e) => updateProposalSection(0, e.target.value)}
                        placeholder={`강혁, 사업관리 및 품질보증\n김현선, 응용시스템`}
                        rows={4}
                        className="font-mono text-xs"
                      />
                    </div>

                    {/* 전문가 영역별 */}
                    {proposalSections.slice(1).map((section, i) => (
                      <div key={section.label}>
                        <Label className="text-xs font-medium text-slate-700">🔹 전문가 - {section.label}</Label>
                        <Textarea
                          value={section.text}
                          onChange={(e) => updateProposalSection(i + 1, e.target.value)}
                          placeholder={`이름, 분야`}
                          rows={3}
                          className="font-mono text-xs mt-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── 감리 모드 (기존) ── */
                <div>
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
              )}
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
