import { FolderOpen, Users, CalendarDays, GanttChart, BarChart3, ArrowRight, TrendingUp, Activity, Clock, FileText } from 'lucide-react';

interface LandingPageProps {
  onNavigate: (tab: string) => void;
  stats: {
    activeProjectCount: number;   // 진행중인 사업 (감리, 올해 일정 포함)
    proposalCount: number;        // 제안중인 사업
    peopleCount: number;          // 등록 인력
    utilizationRate: number;      // 가동률 (0~1)
    utilizationNumerator: number;
    utilizationDenominator: number;
    auditorCount: number;
    bizDaysYtd: number;
  };
}

const menus = [
  {
    key: 'projects',
    label: '프로젝트',
    desc: '사업 등록 및 단계·투입공수 관리',
    icon: FolderOpen,
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    textColor: 'text-blue-600',
    adminOnly: false,
    illustration: (
      <svg viewBox="0 0 120 90" className="w-full h-full" fill="none">
        <rect x="10" y="28" width="100" height="55" rx="6" fill="#DBEAFE" />
        <path d="M10 34 Q10 28 16 28 H44 L52 20 H104 Q110 20 110 26 V34 Z" fill="#BFDBFE" />
        <rect x="22" y="42" width="50" height="4" rx="2" fill="#93C5FD" />
        <rect x="22" y="52" width="38" height="4" rx="2" fill="#BFDBFE" />
        <rect x="22" y="62" width="44" height="4" rx="2" fill="#BFDBFE" />
        <rect x="76" y="40" width="24" height="12" rx="6" fill="#2563EB" />
        <text x="88" y="50" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">A</text>
        <rect x="76" y="58" width="24" height="12" rx="6" fill="#7C3AED" />
        <text x="88" y="68" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">P</text>
        <circle cx="94" cy="76" r="3" fill="#93C5FD" />
        <circle cx="102" cy="76" r="3" fill="#BFDBFE" />
      </svg>
    ),
  },
  {
    key: 'people',
    label: '인력',
    desc: '팀원 등록 및 투입 이력 조회',
    icon: Users,
    color: 'from-emerald-500 to-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    textColor: 'text-emerald-600',
    adminOnly: false,
    illustration: (
      <svg viewBox="0 0 120 90" className="w-full h-full" fill="none">
        <circle cx="35" cy="32" r="12" fill="#A7F3D0" />
        <circle cx="35" cy="29" r="7" fill="#6EE7B7" />
        <path d="M18 52 Q18 42 35 42 Q52 42 52 52 V58 H18 Z" fill="#A7F3D0" />
        <circle cx="65" cy="28" r="14" fill="#D1FAE5" />
        <circle cx="65" cy="25" r="8" fill="#A7F3D0" />
        <path d="M46 52 Q46 40 65 40 Q84 40 84 52 V58 H46 Z" fill="#D1FAE5" />
        <circle cx="93" cy="32" r="12" fill="#A7F3D0" />
        <circle cx="93" cy="29" r="7" fill="#6EE7B7" />
        <path d="M76 52 Q76 42 93 42 Q110 42 110 52 V58 H76 Z" fill="#A7F3D0" />
        <rect x="25" y="62" width="20" height="10" rx="5" fill="#059669" />
        <text x="35" y="70" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">특급</text>
        <rect x="55" y="62" width="20" height="10" rx="5" fill="#10B981" />
        <text x="65" y="70" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">고급</text>
        <rect x="83" y="62" width="20" height="10" rx="5" fill="#34D399" />
        <text x="93" y="70" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold">중급</text>
        <line x1="45" y1="58" x2="55" y2="58" stroke="#6EE7B7" strokeWidth="1.5" strokeDasharray="3,2" />
        <line x1="75" y1="58" x2="85" y2="58" stroke="#6EE7B7" strokeWidth="1.5" strokeDasharray="3,2" />
      </svg>
    ),
  },
  {
    key: 'schedule',
    label: '인력별 일정',
    desc: '월별 투입공수 캘린더 및 셀 편집',
    icon: CalendarDays,
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    textColor: 'text-violet-600',
    adminOnly: false,
    illustration: (
      <svg viewBox="0 0 120 90" className="w-full h-full" fill="none">
        <rect x="8" y="16" width="104" height="68" rx="6" fill="#EDE9FE" />
        <rect x="8" y="16" width="104" height="18" rx="6" fill="#8B5CF6" />
        <circle cx="20" cy="25" r="4" fill="#C4B5FD" />
        <circle cx="100" cy="25" r="4" fill="#C4B5FD" />
        <text x="60" y="28" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">2026. 03</text>
        {['월','화','수','목','금','토','일'].map((d, i) => (
          <text key={d} x={18 + i * 14} y={46} textAnchor="middle" fill="#7C3AED" fontSize="6" fontWeight="600">{d}</text>
        ))}
        <rect x="12" y="50" width="12" height="10" rx="2" fill="#DDD6FE" />
        <rect x="26" y="50" width="12" height="10" rx="2" fill="#8B5CF6" opacity="0.7" />
        <rect x="40" y="50" width="12" height="10" rx="2" fill="#8B5CF6" opacity="0.9" />
        <rect x="54" y="50" width="12" height="10" rx="2" fill="#8B5CF6" />
        <rect x="68" y="50" width="12" height="10" rx="2" fill="#DDD6FE" />
        <rect x="82" y="50" width="12" height="10" rx="2" fill="#F3F4F6" />
        <rect x="96" y="50" width="12" height="10" rx="2" fill="#F3F4F6" />
        <rect x="12" y="63" width="12" height="10" rx="2" fill="#8B5CF6" opacity="0.5" />
        <rect x="26" y="63" width="12" height="10" rx="2" fill="#8B5CF6" />
        <rect x="40" y="63" width="12" height="10" rx="2" fill="#8B5CF6" />
        <rect x="54" y="63" width="12" height="10" rx="2" fill="#DDD6FE" />
        <rect x="68" y="63" width="12" height="10" rx="2" fill="#8B5CF6" opacity="0.7" />
        <rect x="82" y="63" width="12" height="10" rx="2" fill="#F3F4F6" />
        <rect x="96" y="63" width="12" height="10" rx="2" fill="#F3F4F6" />
        <rect x="40" y="50" width="12" height="10" rx="2" fill="none" stroke="#7C3AED" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    key: 'gantt',
    label: '사업별 일정',
    desc: '간트차트로 사업 전체 기간 한눈에',
    icon: GanttChart,
    color: 'from-amber-500 to-orange-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    textColor: 'text-amber-600',
    adminOnly: false,
    illustration: (
      <svg viewBox="0 0 120 90" className="w-full h-full" fill="none">
        <rect x="8" y="10" width="104" height="70" rx="5" fill="#FFFBEB" />
        <rect x="8" y="10" width="104" height="14" rx="5" fill="#FDE68A" />
        <text x="40" y="20" textAnchor="middle" fill="#92400E" fontSize="6" fontWeight="bold">2026.01</text>
        <text x="80" y="20" textAnchor="middle" fill="#92400E" fontSize="6" fontWeight="bold">2026.06</text>
        <text x="14" y="36" fill="#78350F" fontSize="6">관세청1</text>
        <rect x="36" y="29" width="60" height="8" rx="3" fill="#F59E0B" opacity="0.8" />
        <text x="66" y="35" textAnchor="middle" fill="#fff" fontSize="5" fontWeight="bold">착수 ── 중간 ── 종료</text>
        <text x="14" y="51" fill="#78350F" fontSize="6">관세청2</text>
        <rect x="44" y="44" width="50" height="8" rx="3" fill="#FBBF24" opacity="0.8" />
        <text x="69" y="50" textAnchor="middle" fill="#fff" fontSize="5" fontWeight="bold">착수 ──── 종료</text>
        <text x="14" y="66" fill="#78350F" fontSize="6">관세청3</text>
        <rect x="30" y="59" width="70" height="8" rx="3" fill="#F59E0B" opacity="0.6" />
        <text x="65" y="65" textAnchor="middle" fill="#fff" fontSize="5" fontWeight="bold">착수 ───── 중간 ── 종료</text>
        <line x1="60" y1="24" x2="60" y2="80" stroke="#FDE68A" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1="85" y1="24" x2="85" y2="80" stroke="#FDE68A" strokeWidth="0.5" strokeDasharray="2,2" />
      </svg>
    ),
  },
  {
    key: 'reports',
    label: '리포트',
    desc: '팀별·등급별 공수 통계 분석',
    icon: BarChart3,
    color: 'from-rose-500 to-pink-500',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    textColor: 'text-rose-600',
    adminOnly: false,
    illustration: (
      <svg viewBox="0 0 120 90" className="w-full h-full" fill="none">
        <rect x="8" y="8" width="104" height="74" rx="6" fill="#FFF1F2" />
        <line x1="22" y1="15" x2="22" y2="70" stroke="#FECDD3" strokeWidth="1.5" />
        <line x1="22" y1="70" x2="112" y2="70" stroke="#FECDD3" strokeWidth="1.5" />
        <rect x="30" y="38" width="14" height="32" rx="3" fill="#FB7185" />
        <rect x="50" y="28" width="14" height="42" rx="3" fill="#F43F5E" />
        <rect x="70" y="45" width="14" height="25" rx="3" fill="#FB7185" opacity="0.8" />
        <rect x="90" y="33" width="14" height="37" rx="3" fill="#F43F5E" opacity="0.9" />
        <text x="37" y="78" textAnchor="middle" fill="#9F1239" fontSize="5">감리1팀</text>
        <text x="57" y="78" textAnchor="middle" fill="#9F1239" fontSize="5">감리2팀</text>
        <text x="77" y="78" textAnchor="middle" fill="#9F1239" fontSize="5">전문가팀</text>
        <text x="97" y="78" textAnchor="middle" fill="#9F1239" fontSize="5">외부</text>
        <polyline points="37,38 57,28 77,45 97,33" stroke="#FB7185" strokeWidth="1.5" strokeDasharray="3,2" fill="none" />
        <circle cx="37" cy="38" r="2.5" fill="#F43F5E" />
        <circle cx="57" cy="28" r="2.5" fill="#F43F5E" />
        <circle cx="77" cy="45" r="2.5" fill="#F43F5E" />
        <circle cx="97" cy="33" r="2.5" fill="#F43F5E" />
      </svg>
    ),
  },
];

export default function LandingPage({ onNavigate, stats }: LandingPageProps) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  const visibleMenus = menus;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-100 opacity-40 blur-3xl" />
          <div className="absolute top-32 -left-16 w-72 h-72 rounded-full bg-indigo-100 opacity-30 blur-3xl" />
          <div className="absolute bottom-0 right-1/3 w-64 h-64 rounded-full bg-violet-100 opacity-30 blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-8">
          {/* 상단 배지 */}
          <div className="flex items-center mb-6">
            <div className="inline-flex items-center gap-2 bg-white border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              악티보 일정관리 시스템
            </div>
          </div>

          {/* Title */}
          <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 leading-tight mb-4">
            악티보<br />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              일정관리 시스템
            </span>
          </h1>
          <p className="text-slate-500 text-lg max-w-xl mb-6">
            프로젝트 단계별 투입공수를 등록하고,<br />
            인력별 월간 일정을 한눈에 관리하세요.
          </p>

          {/* Date */}
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Clock className="h-4 w-4" />
            {dateStr} 기준
          </div>
        </div>

        {/* Stats Bar */}
        <div className="relative max-w-6xl mx-auto px-6 pb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 진행중인 사업 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-white/80 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">진행중인 사업</p>
                <p className="text-2xl font-extrabold text-slate-800 leading-tight">
                  {stats.activeProjectCount}<span className="text-sm font-normal text-slate-400 ml-1">건</span>
                </p>
              </div>
            </div>
            {/* 제안중인 사업 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-white/80 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">제안중인 사업</p>
                <p className="text-2xl font-extrabold text-slate-800 leading-tight">
                  {stats.proposalCount}<span className="text-sm font-normal text-slate-400 ml-1">건</span>
                </p>
              </div>
            </div>
            {/* 등록 인력 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-white/80 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-slate-400 font-medium">등록 인력</p>
                <p className="text-2xl font-extrabold text-slate-800 leading-tight">
                  {stats.peopleCount}<span className="text-sm font-normal text-slate-400 ml-1">명</span>
                </p>
              </div>
            </div>
            {/* 가동률 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-white/80 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Activity className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 font-medium">감리원 가동률</p>
                <p className="text-2xl font-extrabold text-slate-800 leading-tight">
                  {(stats.utilizationRate != null ? stats.utilizationRate * 100 : 0).toFixed(1)}<span className="text-sm font-normal text-slate-400 ml-0.5">%</span>
                </p>
                {stats.auditorCount > 0 && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {stats.utilizationNumerator}일 / ({stats.bizDaysYtd}일×{stats.auditorCount}명)
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Menu Cards */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">메뉴</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleMenus.map((menu) => {
            const Icon = menu.icon;
            return (
              <button
                key={menu.key}
                onClick={() => onNavigate(menu.key)}
                className={`group relative bg-white rounded-2xl border ${menu.border} shadow-sm hover:shadow-lg transition-all duration-200 hover:-translate-y-1 text-left overflow-hidden`}
              >
                {/* Gradient top bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${menu.color}`} />

                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-11 h-11 rounded-xl ${menu.bg} flex items-center justify-center`}>
                      <Icon className={`h-5 w-5 ${menu.textColor}`} />
                    </div>
                    <div className={`w-8 h-8 rounded-full ${menu.bg} flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0`}>
                      <ArrowRight className={`h-4 w-4 ${menu.textColor}`} />
                    </div>
                  </div>

                  {/* Illustration */}
                  <div className="w-full h-24 mb-4 rounded-xl overflow-hidden bg-white">
                    {menu.illustration}
                  </div>

                  {/* Text */}
                  <h3 className="text-base font-bold text-slate-800 mb-1">{menu.label}</h3>
                  <p className="text-sm text-slate-400">{menu.desc}</p>

                  {/* Button */}
                  <div className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold ${menu.textColor} ${menu.bg} px-3 py-1.5 rounded-full`}>
                    바로가기
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 bg-white/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-slate-400">© 2026 악티보 일정관리 시스템</span>
          <span className="text-xs text-slate-300">v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
