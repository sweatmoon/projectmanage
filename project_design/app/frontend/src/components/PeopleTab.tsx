import { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, User, Download, Upload, Trash2, Loader2, ChevronLeft, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { client } from '@/lib/api';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';


interface Person {
  id: number;
  person_name: string;
  position?: string;        // 직급
  team?: string;            // 팀 (레거시)
  grade?: string;           // 감리원 등급
  employment_status?: string; // 구분
  company?: string;         // 소속 회사
}

interface PeopleTabProps {
  people: Person[];
  loading: boolean;
  onSelectPerson: (id: number) => void;
  onRefresh?: () => void;
}

const PAGE_SIZE = 40; // 4 columns × 10 rows

const empStatusConfig: Record<string, { className: string }> = {
  '재직': { className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
  '외부': { className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
  '퇴사': { className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};
const DEFAULT_BADGE = 'bg-gray-100 text-gray-600 hover:bg-gray-100';

// ── 엑셀(xlsx) 양식 다운로드 ─────────────────────────────────
function downloadImportTemplate() {
  const headers = ['이름', '회사', '직급', '감리원등급', '구분'];
  const exampleRows = [
    ['홍길동', 'ABC주식회사', '수석', '수석감리원', '재직'],
    ['김철수', 'DEF컴퍼니', '책임', '감리원', '재직'],
    ['이영희', '', '선임', '', '외부'],
  ];
  const wsData = [headers, ...exampleRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '인력등록');
  XLSX.writeFile(wb, '인력_일괄등록_양식.xlsx');
}

// ── 전체 인력 현황 엑셀 다운로드 ────────────────────────────
function downloadPeopleExcel(people: Person[]) {
  const headers = ['이름', '회사', '직급', '감리원등급', '구분'];
  const sorted = [...people].sort((a, b) => {
    const ca = a.company?.trim() || '\uFFFF';
    const cb = b.company?.trim() || '\uFFFF';
    const cd = ca.localeCompare(cb, 'ko');
    if (cd !== 0) return cd;
    return (a.person_name || '').localeCompare(b.person_name || '', 'ko');
  });
  const rows = sorted.map((p) => [
    p.person_name || '',
    p.company || '',
    p.position || '',
    p.grade || '',
    p.employment_status || '',
  ]);
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '인력현황');
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  XLSX.writeFile(wb, `인력현황_${today}.xlsx`);
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

// xlsx/xls 파일을 string[][] 로 변환
async function parseExcel(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
        // 셀 값을 모두 string으로 변환
        resolve(rows.map(row => row.map(cell => String(cell ?? '').trim())));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

export default function PeopleTab({ people, loading, onSelectPerson, onRefresh }: PeopleTabProps) {
  const [search, setSearch] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('전체');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { canWrite, isViewer } = useUserRole();

  // 동적 회사 목록
  const companyList = useMemo(() => {
    const companies = Array.from(
      new Set(people.map(p => p.company?.trim()).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, 'ko'));
    return ['전체', ...companies, '미지정'];
  }, [people]);

  // 필터: 이름·직급·등급·회사로 검색 + 회사 탭 필터 + 회사별 소팅
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const result = people.filter((p) => {
      const matchSearch =
        (p.person_name || '').toLowerCase().includes(q) ||
        (p.position || '').toLowerCase().includes(q) ||
        (p.grade || '').toLowerCase().includes(q) ||
        (p.employment_status || '').toLowerCase().includes(q) ||
        (p.company || '').toLowerCase().includes(q);
      const personCompany = p.company?.trim() || '';
      const matchCompany =
        selectedCompany === '전체' ||
        (selectedCompany === '미지정' ? !personCompany : personCompany === selectedCompany);
      return matchSearch && matchCompany;
    });
    result.sort((a, b) => {
      const ca = a.company?.trim() || '\uFFFF';
      const cb = b.company?.trim() || '\uFFFF';
      const cd = ca.localeCompare(cb, 'ko');
      if (cd !== 0) return cd;
      return (a.person_name || '').localeCompare(b.person_name || '', 'ko');
    });
    return result;
  }, [people, search, selectedCompany]);

  // 회사 선택 시 페이지 리셋
  useEffect(() => { setCurrentPage(1); }, [selectedCompany]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedPeople = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleCompanyChange = (company: string) => {
    setSelectedCompany(company);
    setCurrentPage(1);
  };

  // ── CSV/Excel 업로드: 이름, 회사, 직급, 감리원등급, 구분 ──────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      let rows: string[][];
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      if (isExcel) {
        rows = await parseExcel(file);
      } else {
        const text = await file.text();
        rows = parseCSV(text);
      }

      // 헤더 행 찾기
      const headerIdx = rows.findIndex((r) =>
        r.some((c) => c.includes('이름') || c.includes('인력명') || c.toLowerCase().includes('name'))
      );

      const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

      if (dataRows.length === 0) {
        toast.error('업로드할 데이터가 없습니다.');
        return;
      }

      // 헤더 컬럼 자동 감지
      const header = headerIdx >= 0 ? rows[headerIdx].map(c => c.trim()) : [];
      const colIdx = {
        name:      Math.max(0, header.findIndex(c => c.includes('이름') || c.toLowerCase().includes('name'))),
        company:   header.findIndex(c => c.includes('회사')),
        position:  header.findIndex(c => c.includes('직급')),
        grade:     header.findIndex(c => c.includes('등급') || c.includes('감리원')),
        empStatus: header.findIndex(c => c.includes('구분') || c.includes('재직') || c.includes('상태')),
      };

      // 유효한 행만 items로 변환 (이름 없는 행 제외)
      const items = dataRows
        .map((row) => ({
          person_name:       row[colIdx.name >= 0 ? colIdx.name : 0]?.trim() || '',
          company:           colIdx.company >= 0 ? (row[colIdx.company]?.trim() || '') : '',
          position:          colIdx.position >= 0 ? (row[colIdx.position]?.trim() || '') : (row[1]?.trim() || ''),
          grade:             colIdx.grade >= 0 ? (row[colIdx.grade]?.trim() || '') : (row[2]?.trim() || ''),
          employment_status: colIdx.empStatus >= 0 ? (row[colIdx.empStatus]?.trim() || '') : (row[3]?.trim() || ''),
        }))
        .filter((item) => item.person_name.length > 0);

      if (items.length === 0) {
        toast.error('유효한 데이터가 없습니다. 이름 컬럼을 확인해주세요.');
        return;
      }

      // 서버 단에서 upsert (중복 체크 서버에서 처리)
      const result = await client.people.batchUpsert(items);

      const createdCount = result.created.length;
      const updatedCount = result.updated.length;
      const skippedCount = result.skipped.length;

      let msg = '';
      if (createdCount > 0) msg += `신규 ${createdCount}명 등록`;
      if (updatedCount > 0) msg += (msg ? ', ' : '') + `기존 ${updatedCount}명 정보 업데이트`;
      if (skippedCount > 0) msg += (msg ? ', ' : '') + `${skippedCount}건 오류`;

      if (createdCount > 0 || updatedCount > 0) {
        toast.success(msg || '처리 완료');
      } else if (skippedCount > 0) {
        toast.error(`처리 실패: ${skippedCount}건`);
      } else {
        toast.info('업로드할 데이터가 없습니다.');
      }

      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('File upload error:', err);
      toast.error('파일 처리 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePerson = async (person: Person) => {
    const confirmed = window.confirm(`"${person.person_name}" 인력을 삭제하시겠습니까?\n\n⚠️ 해당 인력이 배정된 투입공수 정보는 유지되지만, 인력 연결이 해제됩니다.`);
    if (!confirmed) return;

    setDeletingId(person.id);
    try {
      await client.entities.people.delete({ id: String(person.id) });
      toast.success(`"${person.person_name}" 인력이 삭제되었습니다.`);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to delete person:', err);
      toast.error('인력 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(`선택한 ${selectedIds.size}명의 인력을 삭제하시겠습니까?`);
    if (!confirmed) return;

    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selectedIds) {
      try {
        await client.entities.people.delete({ id: String(id) });
        deleted++;
      } catch (err) {
        console.error(`Failed to delete person ${id}:`, err);
      }
    }
    toast.success(`${deleted}명 삭제 완료`);
    setSelectedIds(new Set());
    setBulkDeleting(false);
    if (onRefresh) onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Search + Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="이름/회사/직급/등급/구분으로 검색..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        {/* 전체 인력 현황 다운로드 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadPeopleExcel(filtered)}
          title="현재 목록을 CSV로 다운로드"
        >
          <FileSpreadsheet className="h-4 w-4 mr-1" />
          현황 다운로드
        </Button>
        <Button variant="outline" size="sm" onClick={downloadImportTemplate}>
          <Download className="h-4 w-4 mr-1" />
          양식 다운로드
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !canWrite}
          title={isViewer ? '조회 전용 계정입니다' : undefined}
        >
          {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
          일괄 업로드
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,.xlsx,.xls"
          className="hidden"
          onChange={handleFileUpload}
        />
        {selectedIds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || !canWrite}
            title={isViewer ? '조회 전용 계정입니다' : undefined}
          >
            {bulkDeleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            선택 삭제 ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* 회사 필터 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {companyList.map(company => (
          <button
            key={company}
            onClick={() => handleCompanyChange(company)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              selectedCompany === company
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {company}
            {company !== '전체' && (
              <span className="ml-1 opacity-70">
                ({company === '미지정'
                  ? people.filter(p => !p.company?.trim()).length
                  : people.filter(p => p.company?.trim() === company).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Select all */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            className="underline hover:text-blue-600"
            onClick={toggleSelectAll}
          >
            {selectedIds.size === filtered.length ? '전체 해제' : '전체 선택'}
          </button>
          <span>({filtered.length}명)</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">인력이 없습니다.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {paginatedPeople.map((person) => {
              const escClass = (empStatusConfig[person.employment_status || '']?.className) ?? DEFAULT_BADGE;
              const isSelected = selectedIds.has(person.id);
              const isDeleting = deletingId === person.id;
              return (
                <Card
                  key={person.id}
                  className={`cursor-pointer hover:shadow-md transition-shadow ${isSelected ? 'ring-2 ring-blue-400 bg-blue-50/30' : ''}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(person.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                      />
                      <div
                        className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0"
                        onClick={() => onSelectPerson(person.id)}
                      >
                        <User className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => onSelectPerson(person.id)}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm truncate">{person.person_name}</span>
                          {person.employment_status && (
                            <Badge className={`text-[10px] px-1.5 py-0 ${escClass}`}>{person.employment_status}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                          {person.company && <span className="text-blue-600 font-medium truncate max-w-[80px]">{person.company}</span>}
                          {person.position && <span>{person.company ? ' · ' : ''}{person.position}</span>}
                          {person.grade && <span className="text-blue-500">· {person.grade}</span>}
                        </div>
                      </div>
                      {/* Delete button */}
                      {canWrite && (
                      <button
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); handleDeletePerson(person); }}
                        disabled={isDeleting}
                        title="인력 삭제"
                      >
                        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  const show =
                    page === 1 ||
                    page === totalPages ||
                    Math.abs(page - safePage) <= 1;
                  const showEllipsis =
                    !show &&
                    ((page === 2 && safePage > 3) ||
                    (page === totalPages - 1 && safePage < totalPages - 2));

                  if (!show && !showEllipsis) return null;
                  if (showEllipsis) {
                    return <span key={page} className="text-xs text-muted-foreground px-1">…</span>;
                  }
                  return (
                    <Button
                      key={page}
                      variant={page === safePage ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
