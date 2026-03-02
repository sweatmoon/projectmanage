"""
WebSocket 라우터 — 인력별 일정 실시간 셀 동기화
/ws/schedule  에 연결하면 같은 채널의 모든 클라이언트에게 셀 변경 이벤트 브로드캐스트.

메시지 포맷 (JSON):
  수신(서버→클라이언트):
    { "type": "cell_update", "staffing_id": 123, "date": "2026-03-05", "status": "P" }
    { "type": "cell_update", "staffing_id": 123, "date": "2026-03-05", "status": null }  ← 삭제
    { "type": "ping" }  ← 연결 유지용

  송신(클라이언트→서버):
    클라이언트는 읽기 전용 — 셀 변경은 REST API(/api/v1/calendar/toggle)로 처리
    toggle API 완료 후 백엔드에서 broadcast 호출
"""

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# ── Connection Manager ─────────────────────────────────────────────────────────

class ScheduleConnectionManager:
    """연결된 모든 WebSocket 클라이언트를 관리하고 브로드캐스트한다."""

    def __init__(self):
        self._connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.append(ws)
        logger.info(f"[WS] connected. total={len(self._connections)}")

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            try:
                self._connections.remove(ws)
            except ValueError:
                pass
        logger.info(f"[WS] disconnected. total={len(self._connections)}")

    async def broadcast(self, message: dict, exclude: Optional[WebSocket] = None):
        """모든 연결된 클라이언트에게 메시지 전송 (exclude 제외)."""
        async with self._lock:
            targets = [ws for ws in self._connections if ws is not exclude]

        dead = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)

        # 전송 실패한 연결 정리
        if dead:
            async with self._lock:
                for ws in dead:
                    try:
                        self._connections.remove(ws)
                    except ValueError:
                        pass

    @property
    def connection_count(self) -> int:
        return len(self._connections)


# 싱글턴 — 앱 전체에서 공유
schedule_manager = ScheduleConnectionManager()


# ── WebSocket Endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws/schedule")
async def ws_schedule(websocket: WebSocket):
    """
    인력별 일정 실시간 동기화 채널.
    - 인증은 쿼리 파라미터 token으로 전달 (Authorization 헤더는 WS 미지원)
    - 연결 후 ping을 30초마다 수신해 연결 유지
    """
    await schedule_manager.connect(websocket)
    try:
        while True:
            # 클라이언트 메시지 대기 (ping/pong 또는 연결 유지용)
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                # ping 응답
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
            except asyncio.TimeoutError:
                # 60초 무응답 → ping 보내서 연결 상태 확인
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"[WS] unexpected error: {e}")
    finally:
        await schedule_manager.disconnect(websocket)
