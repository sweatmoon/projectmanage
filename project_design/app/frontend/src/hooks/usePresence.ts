import { useEffect, useRef, useState, useCallback } from 'react';
import { authStore } from '@/lib/api';

export interface PresenceUser {
  user_id: string;
  user_name: string;
  mode: 'viewing' | 'editing';
  last_seen: string;
}

interface UsePresenceOptions {
  pageType: 'project' | 'schedule';
  pageId: number | null;
  mode?: 'viewing' | 'editing';
  intervalMs?: number;  // heartbeat 주기 (기본 30초)
}

const HEARTBEAT_INTERVAL = 30_000;

export function usePresence({
  pageType,
  pageId,
  mode = 'viewing',
  intervalMs = HEARTBEAT_INTERVAL,
}: UsePresenceOptions) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const modeRef = useRef(mode);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  // mode가 바뀌면 ref 갱신 (다음 heartbeat에 반영)
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const sendHeartbeat = useCallback(async () => {
    if (!pageId) return;
    const token = authStore.getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/presence/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          page_type: pageType,
          page_id: pageId,
          mode: modeRef.current,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      // 네트워크 오류 무시 (heartbeat 실패해도 UX에 영향 없음)
    }
  }, [pageType, pageId]);

  const sendLeave = useCallback(() => {
    if (!pageId) return;
    const token = authStore.getToken();
    if (!token) return;
    // sendBeacon: 페이지 언로드 시에도 전송 보장
    const body = JSON.stringify({
      page_type: pageType,
      page_id: pageId,
      mode: modeRef.current,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      // sendBeacon은 Authorization 헤더 미지원 → fetch keepalive 사용
    }
    fetch('/api/v1/presence/leave', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [pageType, pageId]);

  useEffect(() => {
    if (!pageId) return;
    activeRef.current = true;

    // 즉시 첫 heartbeat
    sendHeartbeat();

    // 주기적 heartbeat
    timerRef.current = setInterval(sendHeartbeat, intervalMs);

    // 페이지 숨김/언로드 시 이탈 처리
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendLeave();
        if (timerRef.current) clearInterval(timerRef.current);
      } else if (document.visibilityState === 'visible' && activeRef.current) {
        sendHeartbeat();
        timerRef.current = setInterval(sendHeartbeat, intervalMs);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      activeRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sendLeave();
    };
  }, [pageId, pageType, intervalMs, sendHeartbeat, sendLeave]);

  // 현재 로그인 유저 ID (자신 표시 구분용)
  const currentUserId = authStore.getUser()?.user_id ?? '';

  const others = users.filter(u => u.user_id !== currentUserId);
  const hasEditor = others.some(u => u.mode === 'editing');

  return { users, others, hasEditor, currentUserId };
}
