import { useEffect, useRef, useCallback } from 'react';
import { authStore } from '@/lib/api';

export interface CellUpdateMessage {
  type: 'cell_update';
  staffing_id: number;
  date: string;        // "YYYY-MM-DD"
  status: string | null;
}

type WsMessage = CellUpdateMessage | { type: 'ping' } | { type: 'pong' };

interface UseScheduleSocketOptions {
  onCellUpdate: (msg: CellUpdateMessage) => void;
  enabled?: boolean;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]; // exponential backoff

export function useScheduleSocket({ onCellUpdate, enabled = true }: UseScheduleSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const onCellUpdateRef = useRef(onCellUpdate);

  // 콜백 ref 갱신 (stale closure 방지)
  useEffect(() => {
    onCellUpdateRef.current = onCellUpdate;
  }, [onCellUpdate]);

  const connect = useCallback(() => {
    if (!activeRef.current) return;
    const token = authStore.getToken();

    // ws:// 또는 wss:// — 현재 호스트 기반으로 자동 결정
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/schedule${token ? `?token=${token}` : ''}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0; // 재연결 성공 → 카운터 초기화
      // 30초마다 ping 전송 (서버 타임아웃 방지)
      const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30_000);
      (ws as any)._pingTimer = pingTimer;
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        if (msg.type === 'cell_update') {
          onCellUpdateRef.current(msg as CellUpdateMessage);
        }
        // ping/pong은 무시 (서버가 처리)
      } catch {
        // JSON 파싱 실패 무시
      }
    };

    ws.onclose = () => {
      clearInterval((ws as any)._pingTimer);
      if (!activeRef.current) return;
      // 자동 재연결 (exponential backoff)
      const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    connect();

    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        clearInterval((wsRef.current as any)._pingTimer);
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);
}
