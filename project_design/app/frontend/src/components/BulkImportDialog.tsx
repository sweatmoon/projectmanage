import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { client } from '@/lib/api';
import { Upload } from 'lucide-react';

interface Phase {
  id: number;
  phase_name: string;
  sort_order: number;
}

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  phases: Phase[];
  onImportComplete: () => void;
}

type OverwriteMode = 'overwrite_row' | 'add_only' | 'reset_all';

export default function BulkImportDialog({
  open,
  onOpenChange,
  projectId,
  phases,
  onImportComplete,
}: BulkImportDialogProps) {
  const [category, setCategory] = useState('');
  const [field, setField] = useState('');
  const [subField, setSubField] = useState('');
  const [tsvText, setTsvText] = useState('');
  const [overwriteMode, setOverwriteMode] = useState<OverwriteMode>('overwrite_row');
  const [importing, setImporting] = useState(false);

  const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order);

  const handleImport = async () => {
    if (!category.trim() || !field.trim() || !subField.trim()) {
      toast.error('구분, 담당분야, 세부분야를 모두 입력해주세요.');
      return;
    }
    if (!tsvText.trim()) {
      toast.error('데이터를 입력해주세요.');
      return;
    }

    setImporting(true);
    try {
      const lines = tsvText.trim().split('\n');

      if (overwriteMode === 'reset_all') {
        const existingRes = await client.entities.staffing.query({
          query: { project_id: projectId },
          limit: 1000,
        });
        const existingItems = existingRes?.data?.items || [];
        for (const item of existingItems) {
          await client.entities.staffing.delete({ id: String(item.id) });
        }
      }

      let importedCount = 0;

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length < 1) continue;

        const personName = parts[0]?.trim();
        if (!personName) continue;

        const mdValues: (number | null)[] = [];
        for (let i = 1; i < parts.length && i <= sortedPhases.length; i++) {
          const val = parts[i]?.trim();
          if (!val || val === '' || val === 'NULL' || val === 'null') {
            mdValues.push(null);
          } else {
            const num = parseInt(val, 10);
            if (isNaN(num) || num < 0) {
              mdValues.push(null);
            } else {
              mdValues.push(num);
            }
          }
        }

        for (let phaseIdx = 0; phaseIdx < sortedPhases.length; phaseIdx++) {
          const phase = sortedPhases[phaseIdx];
          const mdVal = phaseIdx < mdValues.length ? mdValues[phaseIdx] : null;

          if (overwriteMode === 'overwrite_row') {
            const existingRes = await client.entities.staffing.query({
              query: {
                project_id: projectId,
                phase_id: phase.id,
                category: category.trim(),
                field: field.trim(),
                sub_field: subField.trim(),
                person_name_text: personName,
              },
              limit: 1,
            });
            const existing = existingRes?.data?.items?.[0];
            if (existing) {
              await client.entities.staffing.update({
                id: String(existing.id),
                data: {
                  md: mdVal,
                  updated_at: new Date().toISOString(),
                },
              });
              importedCount++;
              continue;
            }
          }

          if (overwriteMode === 'add_only') {
            const existingRes = await client.entities.staffing.query({
              query: {
                project_id: projectId,
                phase_id: phase.id,
                category: category.trim(),
                field: field.trim(),
                sub_field: subField.trim(),
                person_name_text: personName,
              },
              limit: 1,
            });
            const existing = existingRes?.data?.items?.[0];
            if (existing) {
              continue;
            }
          }

          await client.entities.staffing.create({
            data: {
              project_id: projectId,
              phase_id: phase.id,
              category: category.trim(),
              field: field.trim(),
              sub_field: subField.trim(),
              person_name_text: personName,
              md: mdVal,
              updated_at: new Date().toISOString(),
            },
          });
          importedCount++;
        }
      }

      toast.success(`${importedCount}건의 데이터가 처리되었습니다.`);
      onImportComplete();
      onOpenChange(false);
      setTsvText('');
    } catch (err) {
      console.error(err);
      toast.error('가져오기 중 오류가 발생했습니다.');
    } finally {
      setImporting(false);
    }
  };

  const phaseHeaders = sortedPhases.map((p) => p.phase_name).join('\t');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            엑셀 붙여넣기 (대량 입력)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>구분 *</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 감리팀" />
            </div>
            <div>
              <Label>담당분야 *</Label>
              <Input value={field} onChange={(e) => setField(e.target.value)} placeholder="예: 사업관리" />
            </div>
            <div>
              <Label>세부분야 *</Label>
              <Input value={subField} onChange={(e) => setSubField(e.target.value)} placeholder="예: PMO" />
            </div>
          </div>

          <div>
            <Label>덮어쓰기 모드</Label>
            <Select value={overwriteMode} onValueChange={(v) => setOverwriteMode(v as OverwriteMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overwrite_row">같은 행만 덮어쓰기 (기본)</SelectItem>
                <SelectItem value="add_only">추가만 (기존 유지)</SelectItem>
                <SelectItem value="reset_all">전체 덮어쓰기 (프로젝트 초기화 후 입력)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>TSV 데이터 입력</Label>
            <p className="text-xs text-muted-foreground mb-2">
              엑셀에서 복사한 데이터를 붙여넣으세요. 형식: 인력명{'\t'}{phaseHeaders || '단계1\t단계2\t...'}
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              빈칸 또는 NULL은 미배정으로 처리됩니다. 음수는 허용되지 않습니다.
            </p>
            <Textarea
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              placeholder={`김철수\t10\t15\t20\t5\t8\n이영희\t8\t12\t\t\t\n외부전문가A\t\t\t15\t10\t`}
              rows={8}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            취소
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? '처리 중...' : '가져오기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}