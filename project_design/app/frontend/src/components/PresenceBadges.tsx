import { PresenceUser } from '@/hooks/usePresence';

interface PresenceBadgesProps {
  users: PresenceUser[];
  currentUserId: string;
  className?: string;
}

const MODE_LABEL: Record<string, string> = {
  viewing: '열람 중',
  editing: '수정 중',
};

const MODE_COLOR: Record<string, string> = {
  viewing: 'bg-blue-100 text-blue-700 border-blue-200',
  editing: 'bg-amber-100 text-amber-700 border-amber-200',
};

const AVATAR_COLOR = [
  'bg-violet-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-lime-600',
  'bg-indigo-500',
];

function getAvatarColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) & 0xffff;
  return AVATAR_COLOR[hash % AVATAR_COLOR.length];
}

export function PresenceBadges({ users, currentUserId, className = '' }: PresenceBadgesProps) {
  const others = users.filter(u => u.user_id !== currentUserId);
  if (others.length === 0) return null;

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-[11px] text-slate-400 mr-0.5">접속 중:</span>
      {others.map(user => (
        <div
          key={user.user_id}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${MODE_COLOR[user.mode] || MODE_COLOR.viewing}`}
          title={`${user.user_name} — ${MODE_LABEL[user.mode] || user.mode}`}
        >
          {/* 아바타 원 */}
          <span
            className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px] font-bold ${getAvatarColor(user.user_id)}`}
          >
            {user.user_name.charAt(0).toUpperCase()}
          </span>
          <span>{user.user_name}</span>
          <span className="opacity-70">· {MODE_LABEL[user.mode] || user.mode}</span>
        </div>
      ))}
    </div>
  );
}

/** 수정 중인 사람이 있을 때 상단 경고 배너 */
export function PresenceWarningBanner({ users, currentUserId }: { users: PresenceUser[]; currentUserId: string }) {
  const editors = users.filter(u => u.user_id !== currentUserId && u.mode === 'editing');
  if (editors.length === 0) return null;
  const names = editors.map(u => u.user_name).join(', ');
  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-md px-3 py-2 text-xs text-amber-800 font-medium">
      <span>⚠️</span>
      <span><strong>{names}</strong> 님이 현재 수정 중입니다. 동시에 저장하면 데이터가 덮어씌워질 수 있습니다.</span>
    </div>
  );
}
