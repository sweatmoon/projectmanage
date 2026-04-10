import { useState, useEffect, useCallback } from 'react';
import { client } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle, AlertCircle, CheckCircle2, ChevronRight,
  ArrowLeft, RefreshCw, Loader2, Users, Calendar, Building2, Crown
} from 'lucide-react';

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface RiskSummary { danger: number; warning: number; total: number }

interface ProposalItem {
  id: number;
  project_name: string;
  organization: string;
  status: string;
  is_won: boolean;
  start_date: string | null;
  end_date: string | null;
  risk_summary: RiskSummary;
  risk_types: string[];
}

interface RiskDetail {
  type: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  count: number;
  reasons: string[];
  suggestions: string[];
  items: Record<string, any>[];
}

interface ProjectDetail {
  id: number;
  project_name: string;
  organization: string;
  start_date: string | null;
  end_date: string | null;
  is_won: boolean;
  assigned_people: {
    person_id: number;
    person_name: string;
    is_chief: boolean;
    grade: string;
    can_travel: boolean | null;
    region: string;
  }[];
  risks: RiskDetail[];
  risk_summary: RiskSummary;
}

// ── 리스크 설정 ────────────────────────────────────────────────────────────────
const RISK_CONFIG: Record<string, { icon: typeof AlertTriangle; label: string; color: string }> = {
  schedule_conflict:  { icon: Calendar,       label: '인력 일정 중복',       color: 'text-orange-500' },
  chief_overload:     { icon: Users,          label: '총괄감리원 과다 투입',  color: 'text-yellow-600' },
  chief_role_conflict:{ icon: Crown,          label: '총괄감리원 역할 중복',  color: 'text-red-500'    },
  org_duplicate:      { icon: Building2,      label: '동일 기관 일정 중복',   color: 'text-purple-500' },
};

const SEVERITY_CONFIG = {
  danger:  { bg: 'bg-red-50',    border: 'border-red-200',    badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500',    label: '위험' },
  warning: { bg: 'bg-amber-50',  border: 'border-amber-200',  badge: 'bg-amber-100 text-amber-700',dot: 'bg-amber-400',  label: '주의' },
  info:    { bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',  dot: 'bg-blue-400',   label: '참고' },
};

// ── 요약 뱃지 ─────────────────────────────────────────────────────────────────
function RiskBadges({ summary }: { summary: RiskSummary }) {
  if (summary.total === 0)
    return <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />정상</span>;
  return (
    <div className="flex items-center gap-1.5">
      {summary.danger > 0 && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
          <AlertCircle className="h-3 w-3" />위험 {summary.danger}
        </span>
      )}
      {summary.warning > 0 && (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
          <AlertTriangle className="h-3 w-3" />주의 {summary.warning}
        </span>
      )}
    </div>
  );
}

// ── 리스크 카드 (상세) ────────────────────────────────────────────────────────
function RiskCard({ risk }: { risk: RiskDetail }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[risk.severity] ?? SEVERITY_CONFIG.info;
  const cfg = RISK_CONFIG[risk.type];
  const Icon = cfg?.icon ?? AlertTriangle;

  return (
    <div className={`rounded-xl border ${sev.border} ${sev.bg} overflow-hidden`}>
      {/* 헤더 */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:brightness-95 transition"
        onClick={() => setExpanded(v => !v)}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${cfg?.color ?? 'text-gray-500'}`} />
        <span className="font-semibold text-sm flex-1">{risk.title}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${sev.badge}`}>{sev.label}</span>
        <span className="text-xs text-gray-400 ml-1">{risk.count}건</span>
        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {/* 상세 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {/* 이유 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">🔍 원인</p>
            <ul className="space-y-1">
              {risk.reasons.map((r, i) => (
                <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          {/* 제안 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">💡 해결 제안</p>
            <ul className="space-y-1">
              {risk.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-emerald-700 bg-emerald-50 rounded px-2 py-1 flex gap-1.5">
                  <span>→</span>{s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 상세 패널 ─────────────────────────────────────────────────────────────────
function DetailPanel({
  projectId,
  onBack,
}: {
  projectId: number;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/proposal-risk/${projectId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-gray-400">
      <Loader2 className="h-6 w-6 animate-spin mr-2" />분석 중...
    </div>
  );
  if (!detail) return null;

  const allClear = detail.risk_summary.total === 0;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-gray-500">
          <ArrowLeft className="h-4 w-4 mr-1" />목록
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-800 truncate">{detail.project_name}</h2>
          <p className="text-xs text-gray-500">{detail.organization}
            {detail.start_date && ` · ${detail.start_date} ~ ${detail.end_date ?? '?'}`}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} title="새로고침">
          <RefreshCw className="h-4 w-4 text-gray-400" />
        </Button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <Card className={`text-center py-3 ${detail.risk_summary.danger > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
          <CardContent className="p-0">
            <p className="text-2xl font-bold text-red-600">{detail.risk_summary.danger}</p>
            <p className="text-xs text-gray-500 mt-0.5">위험</p>
          </CardContent>
        </Card>
        <Card className={`text-center py-3 ${detail.risk_summary.warning > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50'}`}>
          <CardContent className="p-0">
            <p className="text-2xl font-bold text-amber-600">{detail.risk_summary.warning}</p>
            <p className="text-xs text-gray-500 mt-0.5">주의</p>
          </CardContent>
        </Card>
        <Card className="text-center py-3 bg-gray-50">
          <CardContent className="p-0">
            <p className="text-2xl font-bold text-gray-700">{detail.assigned_people.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">배정 인력</p>
          </CardContent>
        </Card>
      </div>

      {/* 배정 인력 */}
      {detail.assigned_people.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">배정 인력</p>
          <div className="flex flex-wrap gap-1.5">
            {detail.assigned_people.map(p => (
              <span
                key={p.person_id}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                  p.is_chief
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'
                }`}
              >
                {p.is_chief && <Crown className="h-2.5 w-2.5" />}
                {p.person_name}
                {p.grade && <span className="opacity-60">·{p.grade}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 리스크 없음 */}
      {allClear ? (
        <div className="flex flex-col items-center justify-center py-12 text-emerald-600 gap-2">
          <CheckCircle2 className="h-12 w-12" />
          <p className="font-semibold">리스크 없음</p>
          <p className="text-xs text-gray-400">현재 감지된 리스크가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500">리스크 상세</p>
          {detail.risks.map((risk, i) => (
            <RiskCard key={i} risk={risk} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 목록 뷰 ───────────────────────────────────────────────────────────────────
export default function ProposalRiskTab() {
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'danger' | 'warning' | 'safe'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/proposal-risk/list');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = proposals.filter(p => {
    if (filter === 'danger')  return p.risk_summary.danger > 0;
    if (filter === 'warning') return p.risk_summary.warning > 0 && p.risk_summary.danger === 0;
    if (filter === 'safe')    return p.risk_summary.total === 0;
    return true;
  });

  if (selectedId !== null)
    return <DetailPanel projectId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="space-y-4">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">제안일정 리스크 관리</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            제안 상태 사업의 인력·일정 리스크를 자동 분석합니다
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          새로고침
        </Button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { key: 'all',     label: `전체 (${proposals.length})` },
          { key: 'danger',  label: `위험 (${proposals.filter(p => p.risk_summary.danger > 0).length})` },
          { key: 'warning', label: `주의 (${proposals.filter(p => p.risk_summary.warning > 0 && p.risk_summary.danger === 0).length})` },
          { key: 'safe',    label: `정상 (${proposals.filter(p => p.risk_summary.total === 0).length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              filter === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />분석 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-emerald-400" />
          <p className="font-medium">해당하는 제안사업이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(proj => {
            const hasDanger = proj.risk_summary.danger > 0;
            const hasWarning = proj.risk_summary.warning > 0;
            const borderColor = hasDanger
              ? 'border-l-red-500'
              : hasWarning ? 'border-l-amber-400' : 'border-l-emerald-400';

            return (
              <button
                key={proj.id}
                className={`w-full text-left rounded-xl border border-gray-200 border-l-4 ${borderColor}
                  bg-white hover:shadow-md transition-shadow px-4 py-3 flex items-center gap-3`}
                onClick={() => setSelectedId(proj.id)}
              >
                {/* 리스크 아이콘 */}
                <div className="flex-shrink-0">
                  {hasDanger
                    ? <AlertCircle className="h-5 w-5 text-red-500" />
                    : hasWarning
                    ? <AlertTriangle className="h-5 w-5 text-amber-400" />
                    : <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
                </div>

                {/* 사업 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-800 truncate">{proj.project_name}</span>
                    {proj.is_won && (
                      <span className="px-1.5 py-0 rounded text-[10px] font-bold bg-blue-100 text-blue-700">수주</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
                    <span>{proj.organization}</span>
                    {proj.start_date && (
                      <span className="text-gray-400">
                        {proj.start_date} ~ {proj.end_date ?? '?'}
                      </span>
                    )}
                    {/* 리스크 유형 아이콘 */}
                    <div className="flex gap-1">
                      {proj.risk_types.map(type => {
                        const cfg = RISK_CONFIG[type];
                        if (!cfg) return null;
                        const Icon = cfg.icon;
                        return <Icon key={type} className={`h-3 w-3 ${cfg.color}`} title={cfg.label} />;
                      })}
                    </div>
                  </div>
                </div>

                {/* 리스크 요약 뱃지 */}
                <div className="flex-shrink-0">
                  <RiskBadges summary={proj.risk_summary} />
                </div>

                <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
