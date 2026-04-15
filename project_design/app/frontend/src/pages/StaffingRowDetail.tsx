import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { client } from '@/lib/api';
import { countBusinessDaysDynamic as countBusinessDaysHoliday } from '@/lib/holidays';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Save, Lock, Link2, AlertTriangle } from 'lucide-react';

interface Project {
  id: number;
  project_name: string;
  status: string;
}

interface Phase {
  id: number;
  project_id: number;
  phase_name: string;
  start_date?: string;
  end_date?: string;
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

/**
 * 두 날짜 사이의 영업일 수 계산 (주말+공휴일 제외, lib/holidays.ts 기반)
 * 날짜 미설정 시 -1 반환 (제한 없음)
 */
function countBusinessDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return -1;
  const result = countBusinessDaysHoliday(startDate, endDate);
  return result;
}

export default function StaffingRowDetail() {
  const { id: projectIdStr } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectId = Number(projectIdStr);

  const category = searchParams.get('category') || '';
  const field = searchParams.get('field') || '';
  const subField = searchParams.get('sub_field') || '';
  const personName = searchParams.get('person_name') || '';

  const [project, setProject] = useState<Project | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [staffingRecords, setStaffingRecords] = useState<Staffing[]>([]);
  const [people, setPeople] = useState<People[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // MD values: phaseId -> md value string
  const [mdValues, setMdValues] = useState<Record<number, string>>({});

  // Person linking
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');

  const isLocked = project?.status === '확정' || project?.status === '제출완료';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, phaseRes, staffRes, peopleRes] = await Promise.all([
        client.entities.projects.get({ id: String(projectId) }),
        client.entities.phases.query({ query: { project_id: projectId }, limit: 100, sort: 'sort_order' }),
        client.entities.staffing.query({ query: { project_id: projectId }, limit: 2000 }),
        client.entities.people.query({ query: {}, limit: 500 }),
      ]);

      setProject(projRes?.data || null);
      setPhases(phaseRes?.data?.items || []);
      setPeople(peopleRes?.data?.items || []);

      const allStaffing: Staffing[] = staffRes?.data?.items || [];
      const filtered = allStaffing.filter((s) => {
        const sPersonName = s.person_id
          ? (peopleRes?.data?.items || []).find((p: People) => p.id === s.person_id)?.person_name || s.person_name_text || ''
          : s.person_name_text || '';
        return (
          s.category === category &&
          s.field === field &&
          s.sub_field === subField &&
          sPersonName === personName
        );
      });
      setStaffingRecords(filtered);

      const mdMap: Record<number, string> = {};
      filtered.forEach((s) => {
        mdMap[s.phase_id] = s.md != null ? String(s.md) : '';
      });
      setMdValues(mdMap);

      if (filtered.length > 0 && filtered[0].person_id) {
        setSelectedPersonId(String(filtered[0].person_id));
      }
    } catch (err) {
      console.error(err);
      toast.error('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [projectId, category, field, subField, personName]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const sortedPhases = useMemo(() => {
    return [...phases].sort((a, b) => a.sort_order - b.sort_order);
  }, [phases]);

  /** 각 단계별 영업일 수 계산 */
  const phaseBusinessDays = useMemo(() => {
    const map: Record<number, number> = {};
    sortedPhases.forEach((phase) => {
      map[phase.id] = countBusinessDays(phase.start_date || '', phase.end_date || '');
    });
    return map;
  }, [sortedPhases]);

  const handleMdChange = (phaseId: number, value: string) => {
    if (value === '') {
      setMdValues({ ...mdValues, [phaseId]: '' });
      return;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0) {
      setMdValues({ ...mdValues, [phaseId]: String(num) });
    }
  };

  /** MD 값이 영업일 수를 초과하는지 검증 */
  const getValidationErrors = useCallback(() => {
    const errors: { phaseId: number; phaseName: string; md: number; maxDays: number }[] = [];
    for (const phase of sortedPhases) {
      const mdStr = mdValues[phase.id];
      if (!mdStr) continue;
      const mdVal = parseInt(mdStr, 10);
      if (isNaN(mdVal)) continue;
      const maxDays = phaseBusinessDays[phase.id];
      if (maxDays >= 0 && mdVal > maxDays) {
        errors.push({
          phaseId: phase.id,
          phaseName: phase.phase_name,
          md: mdVal,
          maxDays,
        });
      }
    }
    return errors;
  }, [sortedPhases, mdValues, phaseBusinessDays]);

  const handleSave = async () => {
    if (isLocked) return;

    // 영업일 초과 검증
    const validationErrors = getValidationErrors();
    if (validationErrors.length > 0) {
      const messages = validationErrors.map(
        (e) => `"${e.phaseName}": ${e.md}MD 입력 → 영업일 ${e.maxDays}일 초과`
      );
      toast.error(`영업일을 초과하는 MD가 있습니다:\n${messages.join('\n')}`);
      return;
    }

    setSaving(true);
    try {
      for (const phase of sortedPhases) {
        const record = staffingRecords.find((s) => s.phase_id === phase.id);
        const mdStr = mdValues[phase.id];
        const mdVal = mdStr === '' || mdStr === undefined ? null : parseInt(mdStr, 10);

        const personIdVal = selectedPersonId && selectedPersonId !== '0' ? Number(selectedPersonId) : null;

        if (record) {
          await client.entities.staffing.update({
            id: String(record.id),
            data: {
              md: mdVal,
              person_id: personIdVal,
              updated_at: new Date().toISOString(),
            },
          });
        } else {
          await client.entities.staffing.create({
            data: {
              project_id: projectId,
              phase_id: phase.id,
              category,
              field,
              sub_field: subField,
              person_name_text: personName,
              person_id: personIdVal,
              md: mdVal,
              updated_at: new Date().toISOString(),
            },
          });
        }
      }
      toast.success('투입공수가 저장되었습니다.');
      fetchAll();
    } catch (err) {
      console.error(err);
      toast.error('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const totalMd = useMemo(() => {
    return Object.values(mdValues).reduce((sum, v) => {
      const num = parseInt(v, 10);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [mdValues]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            프로젝트
          </Button>
          <div className="flex-1">
            <h1 className="text-sm font-bold text-slate-800">투입공수 상세</h1>
          </div>
          {isLocked && <Lock className="h-4 w-4 text-amber-500" />}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Row Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">행 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">구분</Label>
                <p className="font-medium text-sm">{category}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">담당분야</Label>
                <p className="font-medium text-sm">{field}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">세부분야</Label>
                <p className="font-medium text-sm">{subField}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">인력명</Label>
                <p className="font-medium text-sm">{personName}</p>
              </div>
            </div>

            {/* Person Linking */}
            <div className="mt-4 p-3 bg-slate-50 rounded-lg">
              <Label className="text-xs flex items-center gap-1 mb-2">
                <Link2 className="h-3 w-3" />
                사내 인력 연결
              </Label>
              <div className="flex gap-2 items-center">
                <Select
                  value={selectedPersonId}
                  onValueChange={setSelectedPersonId}
                  disabled={isLocked}
                >
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="인력 선택 (미연결)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">미연결 (텍스트만)</SelectItem>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.person_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPersonId && selectedPersonId !== '0' && (
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">연결됨</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phase MD Inputs */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">단계별 MD 입력</CardTitle>
              <div className="text-sm">
                <span className="text-muted-foreground">합계: </span>
                <span className="font-bold text-blue-600">{totalMd} MD</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sortedPhases.map((phase) => {
                const val = mdValues[phase.id] ?? '';
                const isEmpty = val === '';
                const mdNum = parseInt(val, 10);
                const maxDays = phaseBusinessDays[phase.id];
                const isOverLimit = !isNaN(mdNum) && maxDays >= 0 && mdNum > maxDays;

                return (
                  <div
                    key={phase.id}
                    className={`flex items-center gap-4 p-3 rounded-lg border ${
                      isOverLimit
                        ? 'bg-red-50 border-red-300'
                        : isEmpty
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-white'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{phase.phase_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {phase.start_date || '?'} ~ {phase.end_date || '?'}
                      </p>
                      {maxDays >= 0 && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          영업일: <span className="font-semibold">{maxDays}일</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={maxDays >= 0 ? maxDays : undefined}
                          step={1}
                          value={val}
                          onChange={(e) => handleMdChange(phase.id, e.target.value)}
                          disabled={isLocked}
                          placeholder="NULL"
                          className={`w-24 text-center ${
                            isOverLimit
                              ? 'border-red-400 text-red-600 font-bold'
                              : isEmpty
                                ? 'border-amber-300'
                                : ''
                          }`}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-6">MD</span>
                      {isOverLimit && (
                        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Validation Warning */}
            {getValidationErrors().length > 0 && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-700 font-medium flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  영업일을 초과하는 MD가 있습니다. 수정 후 저장해주세요.
                </p>
                <ul className="mt-1 text-xs text-red-600 list-disc list-inside">
                  {getValidationErrors().map((e) => (
                    <li key={e.phaseId}>
                      {e.phaseName}: {e.md}MD 입력 (최대 {e.maxDays}일)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!isLocked && (
              <div className="mt-4">
                <Button onClick={handleSave} disabled={saving || getValidationErrors().length > 0}>
                  <Save className="h-4 w-4 mr-1" />
                  {saving ? '저장 중...' : '저장'}
                </Button>
              </div>
            )}

            {isLocked && (
              <p className="mt-3 text-xs text-amber-600 flex items-center gap-1">
                <Lock className="h-3 w-3" />
                프로젝트가 잠금 상태이므로 편집이 제한됩니다.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}