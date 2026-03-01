import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { ArrowLeft, User, Users, Briefcase } from 'lucide-react';

interface Person {
  id: number;
  person_name: string;
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
  phases: Phase[];
  staffingRecords: Staffing[];
  phaseTotals: Record<number, number>;
  total: number;
}

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const personId = Number(id);

  const [person, setPerson] = useState<Person | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [staffing, setStaffing] = useState<Staffing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [personRes, projectsRes, phasesRes, staffingRes] = await Promise.all([
        client.entities.people.get({ id: String(personId) }),
        client.entities.projects.query({ query: {}, limit: 200, sort: 'id' }),
        client.entities.phases.query({ query: {}, limit: 500 }),
        client.entities.staffing.query({ query: { person_id: personId }, limit: 2000 }),
      ]);
      setPerson(personRes?.data || null);
      setProjects(projectsRes?.data?.items || []);
      setPhases(phasesRes?.data?.items || []);
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

  const projectSummaries = useMemo((): ProjectSummary[] => {
    const projectIds = [...new Set(staffing.map((s) => s.project_id))];
    return projectIds.map((pid) => {
      const project = projects.find((p) => p.id === pid);
      if (!project) return null;
      const projectPhases = phases.filter((p) => p.project_id === pid).sort((a, b) => a.sort_order - b.sort_order);
      const projectStaffing = staffing.filter((s) => s.project_id === pid);
      const phaseTotals: Record<number, number> = {};
      let total = 0;
      projectStaffing.forEach((s) => {
        if (s.md != null) {
          phaseTotals[s.phase_id] = (phaseTotals[s.phase_id] || 0) + s.md;
          total += s.md;
        }
      });
      return { project, phases: projectPhases, staffingRecords: projectStaffing, phaseTotals, total };
    }).filter(Boolean) as ProjectSummary[];
  }, [staffing, projects, phases]);

  const totalAllMd = useMemo(() => {
    return staffing.reduce((sum, s) => sum + (s.md ?? 0), 0);
  }, [staffing]);

  const empStatusConfig: Record<string, string> = {
    '재직': 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
    '외부': 'bg-amber-100 text-amber-700 hover:bg-amber-100',
    '퇴사': 'bg-red-100 text-red-700 hover:bg-red-100',
  };

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
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/?tab=people')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            목록
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-800">{person.person_name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Person Info */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
                <User className="h-8 w-8 text-blue-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold">{person.person_name}</h2>
                <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                  {person.team && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {person.team}
                    </span>
                  )}
                  {person.grade && <span>등급: {person.grade}</span>}
                  {person.employment_status && (
                    <Badge className={empStatusConfig[person.employment_status] || ''}>
                      {person.employment_status}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <Label className="text-xs text-muted-foreground">총 투입 MD</Label>
                <p className="text-3xl font-bold text-blue-600">{totalAllMd}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Project Summaries */}
        <div className="space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            참여 프로젝트 ({projectSummaries.length}개)
          </h3>

          {projectSummaries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                참여 중인 프로젝트가 없습니다.
              </CardContent>
            </Card>
          ) : (
            projectSummaries.map((ps) => (
              <Card key={ps.project.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{ps.project.project_name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-blue-600">{ps.total} MD</span>
                      <Badge
                        className={
                          ps.project.status === '감리'
                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-100'
                        }
                      >
                        {ps.project.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>단계</TableHead>
                        <TableHead className="text-right">MD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ps.phases.map((phase) => (
                        <TableRow key={phase.id}>
                          <TableCell>{phase.phase_name}</TableCell>
                          <TableCell className="text-right font-medium">
                            {ps.phaseTotals[phase.id] != null ? ps.phaseTotals[phase.id] : (
                              <span className="text-amber-400 italic">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}