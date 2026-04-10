"""
공공데이터포털 한국천문연구원 특일 정보 API 동기화 서비스
API: getRestDeInfo (공휴일 정보조회) - isHoliday=Y 인 항목만 저장
주 1회 배치 + 어드민 수동 트리거 지원
"""
import logging
import os
from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# 공공데이터포털 API 설정
_API_BASE = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
_SERVICE_KEY = os.environ.get(
    "HOLIDAY_API_KEY",
    "jtPvPBLgLMJd94PEKMQYuN2ZEW+YQlWHiUxHAuhrYm/Y4GXsVCiM9auENNfp5IoS01FyntIvo4SOyKQySApJYQ==",
)

# 동기화할 연도 범위: 올해 -1 ~ 올해 +3
def _target_years() -> list[int]:
    cur = date.today().year
    return list(range(cur - 1, cur + 4))


async def _fetch_year_holidays(year: int, timeout: int = 15) -> list[dict[str, Any]]:
    """특정 연도의 전체 공휴일을 월별로 조회해 합산 반환"""
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for month in range(1, 13):
            params = {
                "ServiceKey": _SERVICE_KEY,
                "solYear": str(year),
                "solMonth": f"{month:02d}",
                "_type": "json",
                "numOfRows": "50",
                "pageNo": "1",
            }
            try:
                resp = await client.get(_API_BASE, params=params)
                resp.raise_for_status()
                data = resp.json()

                body = data.get("response", {}).get("body", {})
                items_raw = body.get("items", {})

                # items 가 비어있으면 ""  또는 None 으로 오는 경우 있음
                if not items_raw:
                    continue

                raw_items = items_raw.get("item", [])
                # 단건이면 dict, 복수건이면 list
                if isinstance(raw_items, dict):
                    raw_items = [raw_items]

                for item in raw_items:
                    if item.get("isHoliday") == "Y":
                        locdate = str(item.get("locdate", ""))
                        if len(locdate) == 8:
                            date_str = f"{locdate[:4]}-{locdate[4:6]}-{locdate[6:]}"
                            results.append({
                                "date_str": date_str,
                                "date_name": item.get("dateName", ""),
                            })
            except Exception as e:
                logger.warning(f"[HolidaySync] {year}-{month:02d} 조회 실패: {e}")
    return results


async def sync_holidays(db: AsyncSession) -> dict[str, Any]:
    """
    공공데이터포털에서 공휴일을 가져와 DB에 upsert
    반환: { synced_years, inserted, updated, total_holidays, last_sync }
    """
    from models.holiday import Holiday

    years = _target_years()
    inserted = 0
    updated = 0
    errors: list[str] = []

    now = datetime.now(timezone.utc)

    for year in years:
        try:
            holidays = await _fetch_year_holidays(year)
            for h in holidays:
                existing = await db.execute(
                    select(Holiday).where(Holiday.date_str == h["date_str"])
                )
                row = existing.scalar_one_or_none()
                if row is None:
                    db.add(Holiday(
                        date_str=h["date_str"],
                        date_name=h["date_name"],
                        is_holiday=True,
                        source="api",
                        created_at=now,
                        updated_at=now,
                    ))
                    inserted += 1
                else:
                    if row.date_name != h["date_name"]:
                        row.date_name = h["date_name"]
                        row.updated_at = now
                        updated += 1
            await db.commit()
            logger.info(f"[HolidaySync] {year}년 동기화 완료: {len(holidays)}건")
        except Exception as e:
            await db.rollback()
            msg = f"{year}년 오류: {e}"
            errors.append(msg)
            logger.error(f"[HolidaySync] {msg}")

    # 전체 저장 건수
    total_result = await db.execute(text("SELECT COUNT(*) FROM holidays"))
    total = total_result.scalar() or 0

    return {
        "synced_years": years,
        "inserted": inserted,
        "updated": updated,
        "total_holidays": total,
        "last_sync": now.isoformat(),
        "errors": errors,
    }


async def get_holidays_for_years(db: AsyncSession, years: list[int]) -> set[str]:
    """
    DB에서 특정 연도들의 공휴일 date_str set 반환
    DB가 비어있으면 빈 set 반환 (→ 호출측에서 hardcoded 폴백 사용)
    """
    from models.holiday import Holiday

    try:
        year_strs = [str(y) for y in years]
        # date_str 의 앞 4자리(연도)로 필터
        conditions = [Holiday.date_str.like(f"{y}-%") for y in year_strs]
        from sqlalchemy import or_
        result = await db.execute(
            select(Holiday.date_str).where(or_(*conditions))
        )
        rows = result.scalars().all()
        return set(rows)
    except Exception as e:
        logger.warning(f"[HolidaySync] DB 조회 실패, 폴백 사용: {e}")
        return set()


async def get_all_holidays_from_db(db: AsyncSession) -> list[dict[str, str]]:
    """프론트엔드 전달용: 전체 공휴일 목록 반환"""
    from models.holiday import Holiday

    try:
        result = await db.execute(
            select(Holiday.date_str, Holiday.date_name)
            .where(Holiday.is_holiday == True)
            .order_by(Holiday.date_str)
        )
        return [{"date": row.date_str, "name": row.date_name} for row in result.all()]
    except Exception as e:
        logger.warning(f"[HolidaySync] 전체 조회 실패: {e}")
        return []
