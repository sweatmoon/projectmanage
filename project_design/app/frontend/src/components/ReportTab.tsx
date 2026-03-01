import { useState, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { BarChart3, AlertTriangle, Users, Layers } from 'lucide-react';

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

interface People {
  id: number;
  person_name: string;
}

interface ReportTabProps {
  projects: Project[];
  phases: Phase[];
  staffing: Staffing[];
  people: People[];
}

export default function ReportTab({ projects, phases, staffing, people }: ReportTabProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const projectPhases = useMemo(() => {
    if (!selectedProjectId) return [];
    return phases
      .filter((p) => p.project_id === Number(selectedProjectId))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [selectedProjectId, phases]);

  const projectStaffing = useMemo(() => {
    if (!selectedProjectId) return [];
    return staffing.filter((s) => s.project_id === Number(selectedProjectId));
  }, [selectedProjectId, staffing]);

  const phaseSummary = useMemo(() => {
    return projectPhases.map((phase) => {
      const phaseStaffing = projectStaffing.filter((s) => s.phase_id === phase.id);
      const totalMd = phaseStaffing.reduce((sum, s) => sum + (s.md ?? 0), 0);
      const nullCount = phaseStaffing.filter((s) => s.md === null || s.md === undefined).length;
      return { ...phase, totalMd, nullCount, recordCount: phaseStaffing.length };
    });
  }, [projectPhases, projectStaffing]);

  const categorySummary = useMemo(() => {
    const map = new Map<string, number>();
    projectStaffing.forEach((s) => {
      const current = map.get(s.category) || 0;
      map.set(s.category, current + (s.md ?? 0));
    });
    return Array.from(map.entries()).map(([category, totalMd]) => ({ category, totalMd }));
  }, [projectStaffing]);

  const personSummary = useMemo(() => {
    const map = new Map<string, { name: string; totalMd: number }>();
    projectStaffing.forEach((s) => {
      const personName = s.person_id
        ? people.find((p) => p.id === s.person_id)?.person_name || s.person_name_text || '미지정'
        : s.person_name_text || '미지정';
      const key = personName;
      const current = map.get(key) || { name: personName, totalMd: 0 };
      current.totalMd += s.md ?? 0;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.totalMd - a.totalMd);
  }, [projectStaffing, people]);

  const totalNullCount = useMemo(() => {
    return projectStaffing.filter((s) => s.md === null || s.md === undefined).length;
  }, [projectStaffing]);

  const totalMd = useMemo(() => {
    return projectStaffing.reduce((sum, s) => sum + (s.md ?? 0), 0);
  }, [projectStaffing]);

  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <label className="text-sm font-medium mb-2 block">프로젝트 선택</label>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="프로젝트를 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.project_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedProjectId ? (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>프로젝트를 선택하면 리포트가 표시됩니다.</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">총 MD</p>
                <p className="text-2xl font-bold text-blue-600">{totalMd}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">단계 수</p>
                <p className="text-2xl font-bold">{projectPhases.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">투입 인력</p>
                <p className="text-2xl font-bold">{personSummary.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                  미배정(NULL)
                </p>
                <p className={`text-2xl font-bold ${totalNullCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {totalNullCount}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Phase Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" />
                단계별 총 MD
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>단계명</TableHead>
                    <TableHead className="text-right">총 MD</TableHead>
                    <TableHead className="text-right">레코드 수</TableHead>
                    <TableHead className="text-right">미배정(NULL)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {phaseSummary.map((ps) => (
                    <TableRow key={ps.id}>
                      <TableCell className="font-medium">{ps.phase_name}</TableCell>
                      <TableCell className="text-right font-semibold">{ps.totalMd}</TableCell>
                      <TableCell className="text-right">{ps.recordCount}</TableCell>
                      <TableCell className="text-right">
                        {ps.nullCount > 0 ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{ps.nullCount}</Badge>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Category Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                구분별 총 MD
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>구분</TableHead>
                    <TableHead className="text-right">총 MD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categorySummary.map((cs) => (
                    <TableRow key={cs.category}>
                      <TableCell className="font-medium">{cs.category}</TableCell>
                      <TableCell className="text-right font-semibold">{cs.totalMd}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Person Top List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                인력별 총 MD (Top)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>순위</TableHead>
                    <TableHead>인력명</TableHead>
                    <TableHead className="text-right">총 MD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {personSummary.slice(0, 10).map((ps, idx) => (
                    <TableRow key={ps.name}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-medium">{ps.name}</TableCell>
                      <TableCell className="text-right font-semibold">{ps.totalMd}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}