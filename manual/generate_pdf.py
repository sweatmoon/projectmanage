#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
악티보 일정관리 시스템 — 사용자 매뉴얼 PDF 생성기
reportlab 사용, NanumGothic 한글 폰트
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

import os

# ── 폰트 등록 ──────────────────────────────────────────────
FONT_DIR = "/usr/share/fonts/truetype/nanum"
pdfmetrics.registerFont(TTFont("Nanum",     f"{FONT_DIR}/NanumGothic.ttf"))
pdfmetrics.registerFont(TTFont("NanumB",    f"{FONT_DIR}/NanumGothicBold.ttf"))
pdfmetrics.registerFont(TTFont("NanumXB",   f"{FONT_DIR}/NanumGothicExtraBold.ttf"))
pdfmetrics.registerFont(TTFont("NanumL",    f"{FONT_DIR}/NanumGothicLight.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Nanum", normal="Nanum", bold="NanumB", italic="Nanum", boldItalic="NanumB")

# ── 색상 팔레트 ──────────────────────────────────────────────
C_BLUE       = colors.HexColor("#2563eb")
C_BLUE_LIGHT = colors.HexColor("#eff6ff")
C_BLUE_DARK  = colors.HexColor("#1e3a8a")
C_AMBER      = colors.HexColor("#d97706")
C_AMBER_LIGHT= colors.HexColor("#fffbeb")
C_GREEN      = colors.HexColor("#16a34a")
C_GREEN_LIGHT= colors.HexColor("#f0fdf4")
C_RED        = colors.HexColor("#dc2626")
C_RED_LIGHT  = colors.HexColor("#fef2f2")
C_VIOLET     = colors.HexColor("#7c3aed")
C_SLATE      = colors.HexColor("#475569")
C_SLATE_DARK = colors.HexColor("#1e293b")
C_SLATE_MID  = colors.HexColor("#334155")
C_SLATE_LIGHT= colors.HexColor("#f8fafc")
C_BORDER     = colors.HexColor("#e2e8f0")
C_WHITE      = colors.white
C_CODE_BG    = colors.HexColor("#0f172a")
C_CODE_FG    = colors.HexColor("#e2e8f0")
C_CODE_GREEN = colors.HexColor("#86efac")
C_CODE_BLUE  = colors.HexColor("#93c5fd")
C_CODE_RED   = colors.HexColor("#fca5a5")
C_CODE_YELLOW= colors.HexColor("#fbbf24")
C_CODE_GRAY  = colors.HexColor("#475569")

# ── 스타일 정의 ──────────────────────────────────────────────
def S(name, **kw):
    base = dict(fontName="Nanum", fontSize=9, leading=14,
                textColor=C_SLATE, spaceAfter=4)
    base.update(kw)
    return ParagraphStyle(name, **base)

ST = {
    # 커버
    "cover_title":  S("cover_title",  fontName="NanumXB", fontSize=28, leading=36,
                       textColor=C_WHITE, alignment=TA_CENTER),
    "cover_sub":    S("cover_sub",    fontName="NanumB",  fontSize=14, leading=20,
                       textColor=colors.HexColor("#93c5fd"), alignment=TA_CENTER),
    "cover_ver":    S("cover_ver",    fontName="Nanum",   fontSize=10,
                       textColor=colors.HexColor("#64748b"), alignment=TA_CENTER),
    # 챕터 제목 (h2)
    "h2":           S("h2", fontName="NanumXB", fontSize=15, leading=20,
                       textColor=C_SLATE_DARK, spaceBefore=8, spaceAfter=6),
    # 소제목 (h3)
    "h3":           S("h3", fontName="NanumB",  fontSize=11, leading=16,
                       textColor=C_SLATE_DARK, spaceBefore=10, spaceAfter=4),
    # 소소제목 (h4)
    "h4":           S("h4", fontName="NanumB",  fontSize=10, leading=14,
                       textColor=C_SLATE_MID,  spaceBefore=6, spaceAfter=3),
    # 본문
    "body":         S("body", fontSize=9, leading=15, spaceAfter=5),
    # 작은 본문
    "small":        S("small", fontSize=8, leading=13, textColor=C_SLATE),
    # 목록 항목
    "li":           S("li", fontSize=9, leading=15, leftIndent=12,
                       bulletIndent=4, spaceAfter=2),
    # 코드/형식 (다크 배경)
    "code":         S("code", fontName="Nanum", fontSize=8, leading=14,
                       textColor=C_CODE_FG, backColor=C_CODE_BG,
                       leftIndent=8, rightIndent=8),
    # 알림 박스
    "alert_info":   S("alert_info",   fontSize=9, leading=14,
                       textColor=colors.HexColor("#1e40af"),
                       backColor=C_BLUE_LIGHT, leftIndent=8),
    "alert_warn":   S("alert_warn",   fontSize=9, leading=14,
                       textColor=colors.HexColor("#92400e"),
                       backColor=C_AMBER_LIGHT, leftIndent=8),
    "alert_ok":     S("alert_ok",     fontSize=9, leading=14,
                       textColor=colors.HexColor("#166534"),
                       backColor=C_GREEN_LIGHT, leftIndent=8),
    "alert_danger": S("alert_danger", fontSize=9, leading=14,
                       textColor=colors.HexColor("#991b1b"),
                       backColor=C_RED_LIGHT,  leftIndent=8),
    # 표 헤더
    "th":           S("th", fontName="NanumB", fontSize=8.5, leading=13,
                       textColor=C_SLATE_DARK, alignment=TA_LEFT),
    # 표 셀
    "td":           S("td", fontSize=8.5, leading=13, textColor=C_SLATE),
    "td_code":      S("td_code", fontName="Nanum", fontSize=8, leading=13,
                       textColor=colors.HexColor("#1d4ed8")),
    "td_bold":      S("td_bold", fontName="NanumB", fontSize=8.5, leading=13,
                       textColor=C_SLATE_DARK),
    # 페이지 번호
    "page_num":     S("page_num", fontSize=8, textColor=colors.HexColor("#94a3b8"),
                       alignment=TA_CENTER),
}

# ── 헬퍼 함수 ──────────────────────────────────────────────
def p(text, style="body"):
    return Paragraph(text, ST[style])

def sp(h=4):
    return Spacer(1, h * mm)

def hr(color=C_BORDER, thickness=0.5):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceAfter=4)

def h2(num, title):
    return [
        sp(4),
        HRFlowable(width="100%", thickness=2, color=C_BLUE, spaceAfter=2),
        Paragraph(f"{num}. {title}", ST["h2"]),
        HRFlowable(width="100%", thickness=0.5, color=C_BORDER, spaceAfter=6),
    ]

def h3(title):
    return Paragraph(f"▶ {title}", ST["h3"])

def h4(title):
    return Paragraph(title, ST["h4"])

def li(items):
    return [Paragraph(f"• {i}", ST["li"]) for i in items]

def alert(text, kind="info"):
    icons = {"info": "ℹ️ ", "warn": "⚠️ ", "ok": "✅ ", "danger": "🔴 "}
    style_map = {"info": "alert_info", "warn": "alert_warn",
                 "ok": "alert_ok", "danger": "alert_danger"}
    return Paragraph(icons.get(kind,"") + text, ST[style_map[kind]])

def code_block(lines):
    """다크 배경 코드 블록"""
    items = []
    for line in lines:
        items.append(Paragraph(line, ST["code"]))
    return items

def simple_table(headers, rows, col_widths=None):
    """기본 테이블 생성"""
    data = [[Paragraph(h, ST["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), ST["td"]) for c in row])

    style = TableStyle([
        ("BACKGROUND",  (0,0), (-1,0),  colors.HexColor("#f1f5f9")),
        ("TEXTCOLOR",   (0,0), (-1,0),  C_SLATE_DARK),
        ("FONTNAME",    (0,0), (-1,0),  "NanumB"),
        ("FONTSIZE",    (0,0), (-1,-1), 8.5),
        ("BOTTOMPADDING",(0,0),(-1,0),  6),
        ("TOPPADDING",  (0,0), (-1,-1), 5),
        ("BOTTOMPADDING",(0,1),(-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING",(0,0), (-1,-1), 7),
        ("GRID",        (0,0), (-1,-1), 0.4, C_BORDER),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[C_WHITE, colors.HexColor("#f8fafc")]),
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
    ])
    tbl = Table(data, colWidths=col_widths, style=style,
                hAlign="LEFT", repeatRows=1)
    return tbl

def badge(text, color_hex="#dbeafe", text_hex="#1d4ed8"):
    return (f'<font color="{text_hex}"><b>[{text}]</b></font>')

# ── 페이지 템플릿 (헤더/푸터) ──────────────────────────────
PAGE_W, PAGE_H = A4
MARGIN_L, MARGIN_R = 20*mm, 20*mm
MARGIN_T, MARGIN_B = 22*mm, 22*mm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

def on_page(canvas, doc):
    canvas.saveState()
    # 헤더 라인
    canvas.setStrokeColor(C_BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN_L, PAGE_H - 14*mm, PAGE_W - MARGIN_R, PAGE_H - 14*mm)
    # 헤더 텍스트
    canvas.setFont("Nanum", 7.5)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawString(MARGIN_L, PAGE_H - 11*mm, "악티보 일정관리 시스템 — 사용자 매뉴얼")
    canvas.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 11*mm, "v2 · 2026-03")
    # 푸터 라인
    canvas.line(MARGIN_L, 14*mm, PAGE_W - MARGIN_R, 14*mm)
    # 페이지 번호
    canvas.setFont("Nanum", 8)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawCentredString(PAGE_W/2, 9*mm, f"— {doc.page} —")
    canvas.restoreState()

def on_first_page(canvas, doc):
    # 커버는 헤더/푸터 없음
    pass

# ── 커버 페이지 ──────────────────────────────────────────────
def make_cover():
    items = []
    # 배경 색 블록 (Table로 구현)
    cover_data = [[Paragraph(
        "<br/><br/><br/><br/>악티보 일정관리 시스템<br/>",
        ST["cover_title"]
    )]]
    cover_tbl = Table(cover_data,
                      colWidths=[CONTENT_W],
                      style=TableStyle([
                          ("BACKGROUND", (0,0), (-1,-1), C_SLATE_DARK),
                          ("TOPPADDING", (0,0), (-1,-1), 30),
                          ("BOTTOMPADDING",(0,0),(-1,-1),10),
                          ("LEFTPADDING",(0,0),(-1,-1),20),
                          ("RIGHTPADDING",(0,0),(-1,-1),20),
                      ]))
    items.append(cover_tbl)

    sub_data = [[
        Paragraph("사용자 매뉴얼", ST["cover_sub"])
    ]]
    sub_tbl = Table(sub_data, colWidths=[CONTENT_W],
                    style=TableStyle([
                        ("BACKGROUND", (0,0),(-1,-1), colors.HexColor("#1e293b")),
                        ("TOPPADDING", (0,0),(-1,-1), 12),
                        ("BOTTOMPADDING",(0,0),(-1,-1),12),
                    ]))
    items.append(sub_tbl)

    ver_data = [[
        Paragraph("v2 · 2026년 3월 · 내부 배포용", ST["cover_ver"])
    ]]
    ver_tbl = Table(ver_data, colWidths=[CONTENT_W],
                    style=TableStyle([
                        ("BACKGROUND",(0,0),(-1,-1), colors.HexColor("#0f172a")),
                        ("TOPPADDING",(0,0),(-1,-1),10),
                        ("BOTTOMPADDING",(0,0),(-1,-1),10),
                    ]))
    items.append(ver_tbl)
    items.append(sp(10))

    # 목차 미리보기
    toc_items = [
        ("1", "시스템 개요"),
        ("2", "로그인"),
        ("3", "홈 화면"),
        ("4", "프로젝트 관리 (생성·상세·단계·투입인력)"),
        ("5", "인력 관리"),
        ("6", "인력별 일정"),
        ("7", "주간별 사업 일정"),
        ("8", "리포트"),
        ("9", "텍스트로 단계 편집 (일괄 입력)"),
        ("10","제안 모드"),
        ("11","동시 접속 잠금 (Presence)"),
        ("12","관리자 기능"),
        ("13","입력 규칙 요약"),
    ]
    toc_data = [[Paragraph(f"{n}.  {t}", S("_toc", fontName="Nanum", fontSize=9,
                           leading=15, textColor=C_SLATE))] for n,t in toc_items]
    toc_tbl = Table(toc_data, colWidths=[CONTENT_W],
                    style=TableStyle([
                        ("BACKGROUND",(0,0),(-1,-1), C_SLATE_LIGHT),
                        ("TOPPADDING",(0,0),(-1,-1),4),
                        ("BOTTOMPADDING",(0,0),(-1,-1),4),
                        ("LEFTPADDING",(0,0),(-1,-1),16),
                        ("GRID",(0,0),(-1,-1),0.3, C_BORDER),
                    ]))
    items.append(p("<b>목 차</b>", "h3"))
    items.append(sp(2))
    items.append(toc_tbl)
    items.append(PageBreak())
    return items

# ── 섹션별 내용 ──────────────────────────────────────────────

def sec_overview():
    W = CONTENT_W
    c1 = W*0.22
    items = []
    items += h2("1", "시스템 개요")
    items.append(p("악티보 일정관리 시스템은 <b>감리/제안 프로젝트의 단계·투입인력·일정</b>을 통합 관리하는 웹 애플리케이션입니다. 여러 사용자가 동시에 접속하여 작업할 수 있으며, 동시 수정 충돌을 방지하는 <b>점유 잠금</b> 기능을 제공합니다."))
    items.append(sp(3))
    items.append(h3("주요 화면 구성"))
    items.append(simple_table(
        ["탭", "URL / 경로", "설명"],
        [
            ["🏠 홈",        "/?tab=home",      "대시보드 — 현황 지표 요약"],
            ["📁 프로젝트",  "/?tab=projects",   "프로젝트 목록 · 생성"],
            ["👥 인력",      "/?tab=people",     "인력 등록 · 조회"],
            ["📅 인력별 일정","/?tab=schedule",  "인력 × 날짜 셀 기반 일정 입력"],
            ["📊 사업별 일정","/?tab=gantt",     "사업별 주간 일정 뷰"],
            ["📈 리포트",    "/?tab=report",     "투입공수 집계 리포트"],
            ["프로젝트 상세","/project/:id",      "단계 · 투입인력 상세 관리"],
            ["인력 상세",    "/person/:id",       "개인 일정 및 정보 관리"],
        ],
        col_widths=[c1*1.1, c1*1.3, W - c1*1.1 - c1*1.3]
    ))
    return items

def sec_login():
    items = []
    items += h2("2", "로그인")
    items.append(p("시스템은 <b>OIDC(OpenID Connect)</b> 기반 SSO 로그인을 사용합니다. 별도 비밀번호 없이 조직 계정으로 로그인합니다."))
    items.append(sp(2))
    items.append(h3("로그인 절차"))
    steps = [
        ("1", "로그인 페이지 접속 → 「로그인」 버튼 클릭"),
        ("2", "OIDC 인증 화면으로 이동 → 조직 계정으로 인증"),
        ("3", "인증 완료 후 홈 화면으로 자동 이동"),
        ("4", "관리자가 허용 사용자 목록에 등록해야 접근 가능 (미등록 시 접근 거부)"),
    ]
    step_data = [[Paragraph(n, ST["td_bold"]),
                  Paragraph(t, ST["td"])] for n, t in steps]
    tbl = Table(step_data, colWidths=[12*mm, CONTENT_W-12*mm],
                style=TableStyle([
                    ("BACKGROUND",(0,0),(-1,-1), C_SLATE_LIGHT),
                    ("GRID",(0,0),(-1,-1),0.3, C_BORDER),
                    ("LEFTPADDING",(0,0),(-1,-1),8),
                    ("TOPPADDING",(0,0),(-1,-1),5),
                    ("BOTTOMPADDING",(0,0),(-1,-1),5),
                ]))
    items.append(tbl)
    items.append(sp(2))
    items.append(alert("<b>접근 불가 시:</b> 관리자에게 계정 등록을 요청하세요. 관리자 페이지(/admin)에서 이메일 또는 표시 이름으로 허용 사용자를 등록합니다.", "warn"))
    return items

def sec_home():
    W = CONTENT_W
    items = []
    items += h2("3", "홈 화면")
    items.append(p("로그인 직후 표시되는 대시보드로, 현재 시스템 운영 현황을 한눈에 보여줍니다."))
    items.append(sp(2))
    items.append(h3("대시보드 지표 설명"))
    items.append(simple_table(
        ["지표", "설명"],
        [
            ["진행 중 사업", "상태가 [감리]인 프로젝트 수"],
            ["제안 중 사업", "상태가 [제안]인 프로젝트 수"],
            ["등록 인력",    "전체 등록된 인력 수"],
            ["투입률",       "연초 기준 영업일 중 실제 투입 비율 (A 상태 달력 기준)"],
        ],
        col_widths=[W*0.3, W*0.7]
    ))
    items.append(sp(2))
    items.append(alert("<b>탭 새로고침 유지:</b> 탭 이동 후 브라우저를 새로고침해도 현재 탭이 유지됩니다 (URL 파라미터 ?tab=xxx 저장).", "info"))
    items.append(sp(1))
    items.append(p("홈 화면의 메뉴 카드를 클릭하면 해당 탭으로 이동합니다. 상단 탭 메뉴에서도 직접 이동할 수 있습니다."))
    return items

def sec_projects():
    W = CONTENT_W
    items = []
    items += h2("4", "프로젝트 관리")
    items.append(p("감리·제안 프로젝트를 목록으로 관리합니다. 상단 탭의 <b>📁 프로젝트</b>를 클릭하여 접근합니다."))
    items.append(sp(2))
    items.append(h3("프로젝트 목록 기능"))
    items.append(simple_table(
        ["기능", "설명"],
        [
            ["+ 새 프로젝트",  "프로젝트 생성 다이얼로그 열기"],
            ["사업명 클릭",    "해당 프로젝트 상세 페이지(/project/:id)로 이동"],
            ["상태 배지",      "[감리] 또는 [제안]으로 구분하여 표시"],
        ],
        col_widths=[W*0.3, W*0.7]
    ))
    return items

def sec_project_create():
    W = CONTENT_W
    items = []
    items += h2("4-1", "프로젝트 생성")
    items.append(p("「+ 새 프로젝트」 버튼 클릭 시 생성 다이얼로그가 열립니다. 상태에 따라 입력 방식이 다릅니다."))
    items.append(sp(2))
    items.append(h3("기본 입력 필드"))
    items.append(simple_table(
        ["필드", "필수", "설명"],
        [
            ["프로젝트명", "필수 *", "사업 이름. 공백 불가."],
            ["기관명",     "필수 *", "발주 기관명. 공백 불가."],
            ["상태",       "—",      "[감리] (기본값) 또는 [제안] 선택"],
            ["비고",       "—",      "자유 메모. 입력 선택사항."],
        ],
        col_widths=[W*0.22, W*0.13, W*0.65]
    ))
    items.append(sp(4))
    items.append(h3("감리 모드 — 단계/투입공수 일괄 입력"))
    items.append(p("단계, 날짜, 인력을 한 번에 텍스트로 입력하면 <b>단계·투입공수·기본 일정</b>이 자동 생성됩니다 (선택사항)."))
    items.append(sp(2))
    items += code_block([
        "# 형식: 단계명, 시작일(YYYYMMDD), 종료일(YYYYMMDD), 인력1:분야[:MD], 인력2:분야[:MD], ...",
        "",
        "요구정의, 20250224, 20250228, 이현우:사업관리 및 품질보증, 차판용:응용시스템",
        "개략설계, 20250421, 20250430, 이현우:사업관리 및 품질보증, 강진욱:SW개발보안:4",
        "상세설계, 20250526, 20250530, 이현우:사업관리 및 품질보증",
    ])
    items.append(sp(2))
    items.append(simple_table(
        ["요소", "형식", "설명"],
        [
            ["단계명",          "자유 텍스트",          "쉼표(,) 제외. 예: 요구정의"],
            ["시작일 / 종료일", "YYYYMMDD",             "8자리 날짜. 예: 20250224"],
            ["인력:분야",       "이름:분야",             "MD 미지정 시 단계 전체 영업일 자동 계산"],
            ["인력:분야:MD",    "이름:분야:숫자",        "MD 직접 지정. 예: 강진욱:SW개발보안:4"],
        ],
        col_widths=[W*0.22, W*0.22, W*0.56]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>분야 → 팀 자동 분류 규칙:</b>  "
        "사업관리 포함 → 단계감리팀(0),  응용시스템 → 단계감리팀(1),  "
        "데이터베이스 → 단계감리팀(2),  시스템구조 → 단계감리팀(3),  "
        "그 외 모두 → 전문가팀", "info"))
    items.append(sp(4))
    items.append(h3("제안 모드 — 제안서 일정/인력 입력"))
    items.append(p("상태를 [제안]으로 선택하면 입력 화면이 <b>감리 일정 + 섹션별 인력</b>으로 분리됩니다."))
    items.append(sp(1))
    items.append(h4("📅 감리 일정 입력 형식"))
    items += code_block([
        "# 형식: 단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:3",
        "# 이름만 = 전체 기간,  이름:숫자 = MD 지정",
        "",
        "설계-정밀진단, 20260323, 20260327, 강혁, 김현선, 최규택:3",
        "설계-재검증,   20260427, 20260501, 강혁, 김현선, 최규택, 양권묵:2",
    ])
    items.append(sp(1))
    items.append(h4("👤 인력 섹션 입력 형식"))
    items += code_block([
        "# 형식: 이름, 분야  (한 줄에 한 명)",
        "",
        "[ 감리원 섹션 → category = 단계감리팀 ]",
        "강혁,   사업관리 및 품질보증",
        "김현선, 응용시스템",
        "",
        "[ 핵심기술 섹션 → category = 핵심기술 ]",
        "최규택, 핵심기술",
        "",
        "[ 필수기술 섹션 → category = 필수기술 ]",
        "양권묵, 필수기술",
        "",
        "[ 보안진단 섹션 → category = 보안진단 ]",
        "박민수, 보안진단",
    ])
    items.append(sp(2))
    items.append(simple_table(
        ["섹션", "category 저장값", "설명"],
        [
            ["👤 감리원",          "단계감리팀", "단계감리 인력. 이름, 분야 형식"],
            ["🔹 전문가 - 핵심기술","핵심기술",  "핵심기술 전문가"],
            ["🔹 전문가 - 필수기술","필수기술",  "필수기술 전문가"],
            ["🔹 전문가 - 보안진단","보안진단",  "보안진단 전문가"],
            ["🔹 전문가 - 테스트",  "테스트",    "기능테스트 전문가"],
        ],
        col_widths=[W*0.33, W*0.22, W*0.45]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>섹션 독립 저장 (v2 수정):</b> 각 섹션에 입력한 인력은 감리 일정 텍스트 "
        "등장 여부와 무관하게 해당 섹션 category로 정확히 저장됩니다. "
        "핵심기술 섹션 → category=핵심기술, 필수기술 섹션 → category=필수기술.", "ok"))
    items.append(sp(2))
    items.append(alert(
        "<b>주의사항:</b>  ① 프로젝트명·기관명이 비어 있으면 생성 불가  "
        "② 날짜는 YYYYMMDD 8자리 형식만 허용  "
        "③ 단계/인력 입력은 선택사항 (생략 시 빈 프로젝트 생성)", "warn"))
    return items

def sec_project_detail():
    W = CONTENT_W
    items = []
    items += h2("4-2", "프로젝트 상세")
    items.append(p("프로젝트 목록에서 사업명을 클릭하면 상세 페이지(/project/:id)로 이동합니다."))
    items.append(sp(2))
    items.append(h3("상단 버튼 기능"))
    items.append(simple_table(
        ["버튼", "기능", "비고"],
        [
            ["← 목록",      "프로젝트 목록으로 돌아가기", ""],
            ["저장",         "기본정보(사업명·기관명·상태·비고) 저장", "잠금 시 비활성화"],
            ["인력 재매핑",  "person_name_text 기반으로 person_id 재연결", "인력 DB 변경 후 사용"],
            ["텍스트 내보내기", "단계/인력 데이터를 텍스트 형식으로 내보내기·편집 다이얼로그", "제안 모드는 섹션 폼으로 표시"],
        ],
        col_widths=[W*0.22, W*0.48, W*0.3]
    ))
    items.append(sp(4))
    items.append(h3("기본정보 수정"))
    items.append(simple_table(
        ["필드", "설명"],
        [
            ["사업명",   "프로젝트명 수정. 공백 불가."],
            ["기관명",   "발주기관명 수정. 공백 불가."],
            ["상태",     "[감리] 또는 [제안] 변경 가능"],
            ["비고",     "자유 메모"],
        ],
        col_widths=[W*0.25, W*0.75]
    ))
    return items

def sec_phase():
    W = CONTENT_W
    items = []
    items += h2("4-3", "단계 관리")
    items.append(p("프로젝트 상세 페이지에서 단계를 추가·수정·삭제합니다."))
    items.append(sp(2))
    items.append(h3("단계 추가/수정 다이얼로그 — 입력 필드"))
    items.append(simple_table(
        ["필드", "필수", "형식", "설명"],
        [
            ["단계명", "필수 *", "자유 텍스트",   "비어 있으면 저장 불가. 예: 개략설계"],
            ["시작일", "필수 *", "YYYY-MM-DD",    "달력 위젯 또는 직접 입력"],
            ["종료일", "필수 *", "YYYY-MM-DD",    "시작일 이후여야 함"],
        ],
        col_widths=[W*0.18, W*0.12, W*0.2, W*0.5]
    ))
    items.append(sp(2))
    items.append(alert("<b>단계 순서:</b> 추가 순서(sort_order)로 정렬됩니다. 순서 변경이 필요하면 삭제 후 재추가하세요.", "info"))
    return items

def sec_staffing():
    W = CONTENT_W
    items = []
    items += h2("4-4", "투입인력 관리")
    items.append(p("각 단계에 투입될 인력과 투입공수(MD)를 관리합니다."))
    items.append(sp(2))
    items.append(h3("투입인력 추가 절차"))
    steps = [
        ("1", "단계 행에서 「인력 추가」 버튼 클릭"),
        ("2", "인력 검색 드롭다운에서 이름/팀/등급으로 검색 후 선택\n    (또는 「외부 인력」 선택 후 이름 직접 입력)"),
        ("3", "분야(field), 투입공수(MD) 입력 후 저장"),
    ]
    step_data = [[Paragraph(n, ST["td_bold"]),
                  Paragraph(t, ST["td"])] for n, t in steps]
    tbl = Table(step_data, colWidths=[10*mm, CONTENT_W-10*mm],
                style=TableStyle([
                    ("BACKGROUND",(0,0),(-1,-1), C_SLATE_LIGHT),
                    ("GRID",(0,0),(-1,-1),0.3, C_BORDER),
                    ("LEFTPADDING",(0,0),(-1,-1),8),
                    ("TOPPADDING",(0,0),(-1,-1),5),
                    ("BOTTOMPADDING",(0,0),(-1,-1),5),
                ]))
    items.append(tbl)
    items.append(sp(3))
    items.append(h3("투입인력 입력 규칙"))
    items.append(simple_table(
        ["필드", "필수", "조건"],
        [
            ["인력",           "필수 *", "DB 등록 인력 선택 또는 외부 인력 이름 직접 입력"],
            ["분야 (field)",   "필수 *", "자유 텍스트. 팀 분류에 사용됨"],
            ["투입공수 (MD)",  "필수 *", "숫자. 단계 영업일 수 초과 시 경고 표시"],
            ["category",       "—",      "자동 설정 (감리: 분야 패턴 기반 / 제안: 섹션 기반)"],
        ],
        col_widths=[W*0.22, W*0.12, W*0.66]
    ))
    items.append(sp(2))
    items.append(alert("<b>MD 초과 입력 주의:</b> 투입공수(MD)가 단계 영업일 수를 초과하면 경고가 표시됩니다. 저장은 가능하나 일정 표에서 표시 불일치가 발생할 수 있습니다.", "warn"))
    return items

def sec_people():
    W = CONTENT_W
    items = []
    items += h2("5", "인력 관리")
    items.append(p("상단 탭 <b>👥 인력</b>에서 인력을 등록·조회합니다. 「+ 새 인력 등록」 버튼 클릭 후 다이얼로그에서 입력합니다."))
    items.append(sp(2))
    items.append(h3("인력 등록 필드"))
    items.append(simple_table(
        ["필드", "필수", "설명"],
        [
            ["이름",       "필수 *", "한글 이름. 공백 불가."],
            ["직급",       "—",      "예: 수석, 책임, 선임 등"],
            ["감리원 등급","—",      "감리 자격 등급. 예: 특급, 고급, 중급"],
            ["구분",       "—",      "재직 상태 또는 소속 구분. 자유 입력."],
        ],
        col_widths=[W*0.22, W*0.13, W*0.65]
    ))
    items.append(sp(2))
    items.append(h3("인력 상세 페이지 (/person/:id)"))
    items.append(p("인력 이름을 클릭하면 해당 인력의 상세 페이지로 이동합니다. 이름·직급·등급·구분 수정과 개인 일정을 확인할 수 있습니다."))
    return items

def sec_schedule():
    W = CONTENT_W
    items = []
    items += h2("6", "인력별 일정")
    items.append(p("상단 탭 <b>📅 인력별 일정</b>에서 각 인력의 날짜별 투입 현황을 셀 단위로 관리합니다."))
    items.append(sp(2))
    items.append(h3("셀 색상 의미"))
    items.append(simple_table(
        ["상태", "색상", "의미"],
        [
            ["A  (실투입)",    "파란색 (진한)",  "감리 프로젝트 실제 투입일. 감리 모드 프로젝트 기본값."],
            ["P  (예정)",      "초록색",          "제안 프로젝트 예정 투입일. 제안 모드 프로젝트 기본값."],
            ["공휴일/주말",    "연분홍 (비활성)", "클릭 불가. 자동으로 비활성화."],
            ["✕  (비작업일 투입)", "빨간 테두리 경고", "주말/공휴일에 투입된 셀. 클릭 시 해제."],
            ["빈 영업일 셀",   "흰색 (점선 테두리)", "투입 미입력. 클릭 시 A 또는 P 투입 추가."],
        ],
        col_widths=[W*0.22, W*0.22, W*0.56]
    ))
    items.append(sp(3))
    items.append(h3("셀 조작 방법"))
    items.append(simple_table(
        ["동작", "결과"],
        [
            ["영업일 빈 셀 클릭",        "투입 추가 (A 또는 P 상태)"],
            ["투입된 셀(A/P) 클릭",      "투입 삭제"],
            ["공휴일/주말 셀",            "클릭 불가 (자동 비활성)"],
            ["비작업일 투입 셀(✕) 클릭", "해당 투입 삭제"],
        ],
        col_widths=[W*0.4, W*0.6]
    ))
    items.append(sp(3))
    items.append(h3("화면 좌측 필터"))
    items.append(simple_table(
        ["필터", "설명"],
        [
            ["인력 검색",            "이름/팀/등급으로 필터링"],
            ["프로젝트 체크박스",    "특정 프로젝트만 표시"],
            ["열 너비 / 행 높이",    "슬라이더로 셀 크기 조정 (브라우저 세션에 저장)"],
        ],
        col_widths=[W*0.3, W*0.7]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>다른 사용자의 셀 수정 반영:</b> 다른 사용자가 셀을 수정하면 "
        "약 15초 이내에 내 화면에 자동 반영됩니다 (15초 폴링 동기화). "
        "즉시 반영이 필요하면 브라우저를 새로고침하세요.", "info"))
    return items

def sec_weekly():
    W = CONTENT_W
    items = []
    items += h2("7", "주간별 사업 일정 (사업별 일정)")
    items.append(p("상단 탭 <b>📊 사업별 일정</b>에서 사업별 주간 단위 일정 현황을 확인하고 배지(badge)를 관리합니다."))
    items.append(sp(2))
    items.append(h3("주요 기능"))
    items.append(simple_table(
        ["기능", "설명"],
        [
            ["월 탐색",         "◀ / ▶ 버튼 또는 연/월 셀렉터로 이동. Today 버튼으로 현재 월 이동."],
            ["사업 배지",       "프로젝트별 색상 배지가 해당 단계 기간에 표시. 클릭 시 편집 다이얼로그."],
            ["배지 우클릭",     "배지 색상 변경 메뉴 표시"],
            ["셀 클릭",         "해당 인력 × 날짜의 투입 추가/삭제 (A 또는 P)"],
            ["넓게 보기",       "우측 상단 버튼으로 전체 너비 모드 전환"],
        ],
        col_widths=[W*0.25, W*0.75]
    ))
    items.append(sp(3))
    items.append(h3("편집 다이얼로그 — 프로젝트/단계/투입인력 수정"))
    items.append(p("배지를 클릭하면 해당 프로젝트의 단계·투입인력을 수정할 수 있는 다이얼로그가 열립니다."))
    items.append(simple_table(
        ["섹션", "수정 가능 항목"],
        [
            ["프로젝트 정보", "사업명, 발주기관, 상태"],
            ["단계 정보",     "단계명, 시작일, 종료일"],
            ["투입인력",      "인력 교체·분야·MD 수정 / 인력 추가 및 삭제 (단계감리팀 / 전문가팀 그룹 구분)"],
        ],
        col_widths=[W*0.25, W*0.75]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>MD 변경 시 달력 확장 안내:</b> 투입공수(MD)를 늘리면 선택 팝업이 표시됩니다.\n"
        "  • 기존 MD로 유지 → 달력 변경 없이 MD 수만 변경\n"
        "  • 전체 확장 → 늘어난 영업일만큼 달력에 자동 추가", "info"))
    items.append(sp(3))
    items.append(h3("동시 접속 잠금 — 주간별 사업 일정"))
    items.append(p("다른 사용자가 이 탭을 <b>열람 중</b>이면 내 셀 클릭이 차단되고 토스트 메시지가 표시됩니다."))
    items.append(alert("다른 사용자가 열람 중일 때: 「다른 사용자가 열람 중입니다. 잠시 후 다시 시도하세요.」 메시지가 표시됩니다. 잠금은 상대방이 탭을 닫으면 즉시 해제됩니다.", "warn"))
    return items

def sec_report():
    W = CONTENT_W
    items = []
    items += h2("8", "리포트")
    items.append(p("상단 탭 <b>📈 리포트</b>에서 프로젝트별·인력별 투입공수 집계를 확인합니다."))
    items.append(sp(2))
    items.append(h3("리포트 내용"))
    items.append(simple_table(
        ["리포트", "내용"],
        [
            ["프로젝트별 투입공수", "프로젝트 선택 후 단계·인력별 MD 집계"],
            ["인력별 현황",         "전체 인력의 투입 프로젝트·공수 요약"],
        ],
        col_widths=[W*0.35, W*0.65]
    ))
    items.append(sp(2))
    items.append(alert("<b>데이터 기준:</b> 리포트는 실제 달력 엔트리(A/P 상태 셀 수)를 기준으로 집계합니다. 투입공수(MD) 입력값과 다를 수 있습니다.", "info"))
    return items

def sec_text_edit():
    W = CONTENT_W
    items = []
    items += h2("9", "텍스트로 단계 편집 (일괄 입력)")
    items.append(p("프로젝트 상세의 <b>「텍스트 내보내기」</b> 버튼으로 현재 단계 데이터를 텍스트로 불러와 수정 후 저장합니다."))
    items.append(sp(2))
    items.append(alert(
        "<b>전체 덮어쓰기 주의:</b> 「전체 덮어쓰기」 저장 시 기존 모든 단계·투입공수·일정 데이터가 "
        "삭제되고 입력한 텍스트 기반으로 재생성됩니다. 실행 전 확인 팝업이 표시됩니다.", "danger"))
    items.append(sp(3))
    items.append(h3("감리 모드 텍스트 형식"))
    items += code_block([
        "# 단계명, 시작일, 종료일, 인력1:분야[:MD], 인력2:분야[:MD], ...",
        "",
        "요구정의, 20250224, 20250228, 이현우:사업관리 및 품질보증, 차판용:응용시스템",
        "개략설계, 20250421, 20250430, 이현우:사업관리 및 품질보증, 강진욱:SW개발보안:4",
        "상세설계, 20250526, 20250530, 이현우:사업관리 및 품질보증",
    ])
    items.append(sp(3))
    items.append(h3("규칙 요약"))
    items.append(simple_table(
        ["규칙", "내용"],
        [
            ["구분자",      "쉼표(,)로 각 항목 구분"],
            ["날짜 형식",   "YYYYMMDD 8자리만 허용"],
            ["인력 항목",   "이름:분야  또는  이름:분야:MD"],
            ["MD 미지정",   "단계 전체 영업일 수로 자동 계산"],
            ["공백 줄",     "무시됨"],
            ["3개 미만 항목","해당 줄 무시됨"],
        ],
        col_widths=[W*0.3, W*0.7]
    ))
    items.append(sp(3))
    items.append(h3("제안 모드 텍스트 편집 다이얼로그"))
    items.append(p("프로젝트 상태가 [제안]이면 텍스트 편집 다이얼로그가 <b>섹션별 폼 형태</b>로 표시됩니다 (텍스트 직접 편집 대신)."))
    items.append(p("현재 저장된 단계·인력 데이터를 읽어와 감리원/핵심기술/필수기술/보안진단/테스트 섹션에 자동으로 배분하여 표시합니다. 수정 후 「전체 덮어쓰기」로 저장합니다."))
    return items

def sec_proposal():
    W = CONTENT_W
    items = []
    items += h2("10", "제안 모드")
    items.append(p("상태가 [제안]인 프로젝트는 입력 UI와 저장 방식이 다릅니다. 제안 준비 단계의 인력·일정 정보를 구조화하여 관리합니다."))
    items.append(sp(2))
    items.append(h3("감리 모드 vs 제안 모드 차이"))
    items.append(simple_table(
        ["항목", "감리 모드", "제안 모드"],
        [
            ["달력 셀 상태", "A (실투입, 파란색)", "P (예정, 초록색)"],
            ["인력 섹션 구분", "분야(field) 패턴으로 자동 분류", "감리원/핵심기술/필수기술/보안진단/테스트 명시 구분"],
            ["텍스트 편집", "텍스트 직접 편집", "섹션별 폼 분리 표시"],
            ["리포트 집계", "A 상태 포함", "P 상태 포함"],
        ],
        col_widths=[W*0.27, W*0.36, W*0.37]
    ))
    items.append(sp(3))
    items.append(h3("역파싱 — 기존 데이터 → 폼 복원"))
    items.append(p("텍스트 편집 다이얼로그를 열면 저장된 데이터를 읽어 각 섹션에 자동 배분합니다."))
    items.append(simple_table(
        ["저장된 category 값", "표시되는 섹션"],
        [
            ["단계감리팀 / 감리팀", "👤 감리원 섹션"],
            ["핵심기술",            "🔹 핵심기술 전문가 섹션"],
            ["필수기술",            "🔹 필수기술 전문가 섹션"],
            ["보안진단",            "🔹 보안진단 전문가 섹션"],
            ["테스트",              "🔹 테스트 전문가 섹션"],
        ],
        col_widths=[W*0.4, W*0.6]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>섹션 독립 저장 (v2 수정):</b> 각 섹션에 입력한 인력은 감리 일정 텍스트에 "
        "등장하지 않아도 해당 섹션 category로 정확히 저장됩니다. "
        "Index.tsx 생성 시와 ProjectDetail.tsx 덮어쓰기 시 모두 동일하게 동작합니다.", "ok"))
    return items

def sec_presence():
    W = CONTENT_W
    items = []
    items += h2("11", "동시 접속 잠금 (Presence)")
    items.append(p("여러 사용자가 동시에 같은 화면을 사용할 때 <b>데이터 충돌을 방지</b>하는 점유 잠금 기능입니다."))
    items.append(sp(2))
    items.append(h3("잠금 동작 방식"))
    items.append(p("다른 사용자가 화면을 <b>열람만 해도</b> 잠금이 걸립니다 (점유 방식)."))
    items.append(simple_table(
        ["상황", "내 화면", "가능한 작업"],
        [
            ["혼자 접속",            "잠금 없음. 모든 기능 정상 사용.",                    "열람 + 수정"],
            ["다른 사용자 열람 중",  "잠금 아이콘 🔒 + 경고 배너 표시",                  "열람만 가능 (수정 차단)"],
            ["다른 사용자 수정 중",  "잠금 아이콘 🔒 + 수정 중 배너 표시",               "열람만 가능 (수정 차단)"],
        ],
        col_widths=[W*0.3, W*0.45, W*0.25]
    ))
    items.append(sp(3))
    items.append(h3("동접자 배지"))
    items.append(p("잠금 시 상단에 다른 사용자의 이름과 현재 모드(열람 중 / 수정 중)가 배지로 표시됩니다."))
    items.append(simple_table(
        ["배지 표시 예", "의미"],
        [
            ["[김철수 · 열람 중]",  "김철수가 현재 해당 페이지를 보고 있음 → 수정 잠금"],
            ["[박영희 · 수정 중]",  "박영희가 현재 데이터를 수정 중 → 수정 잠금"],
        ],
        col_widths=[W*0.4, W*0.6]
    ))
    items.append(sp(3))
    items.append(h3("잠금 적용 범위"))
    items.append(simple_table(
        ["화면", "잠금 트리거", "차단 동작"],
        [
            ["프로젝트 상세\n/project/:id",  "다른 사용자가 같은 프로젝트 열람",  "저장, 단계 추가/수정, 텍스트 편집 버튼 비활성화"],
            ["주간별 사업 일정\n?tab=gantt", "다른 사용자가 해당 탭 열람",         "셀 클릭 차단 (토스트 메시지 표시)"],
        ],
        col_widths=[W*0.27, W*0.33, W*0.4]
    ))
    items.append(sp(3))
    items.append(h3("잠금 해제 타이밍"))
    items.append(simple_table(
        ["상황", "해제 시점"],
        [
            ["다른 페이지로 이동",      "즉시 해제"],
            ["브라우저 탭 닫기",        "즉시 해제 (keepalive 요청)"],
            ["브라우저 종료 / 네트워크 끊김", "약 60초 후 자동 만료"],
        ],
        col_widths=[W*0.45, W*0.55]
    ))
    items.append(sp(2))
    items.append(alert(
        "<b>열람만 해도 잠금이 걸리는 이유:</b> 동시 수정으로 인한 데이터 덮어쓰기를 방지하기 위해, "
        "열람 중에도 점유 잠금을 적용합니다. 다른 사용자가 탭을 닫으면 즉시 잠금이 해제됩니다.", "info"))
    return items

def sec_admin():
    W = CONTENT_W
    items = []
    items += h2("12", "관리자 기능")
    items.append(p("관리자 계정으로 로그인하면 헤더에 [관리자] 배지와 「관리자 페이지」 버튼이 표시됩니다. (/admin)"))
    items.append(sp(2))
    items.append(h3("허용 사용자 관리"))
    items.append(simple_table(
        ["기능", "설명"],
        [
            ["사용자 등록", "이메일 또는 표시 이름으로 접근 허용 사용자 추가"],
            ["활성/비활성", "계정 비활성화 (삭제 없이 접근 차단)"],
            ["역할 부여",   "일반 사용자 / 관리자 역할 부여"],
            ["접근 로그",   "사용자별 접속 기록 조회"],
        ],
        col_widths=[W*0.25, W*0.75]
    ))
    items.append(sp(2))
    items.append(alert("<b>사용자 미등록 시:</b> 허용 목록에 없는 이메일로 로그인하면 접근 거부 화면이 표시됩니다. 관리자에게 등록 요청이 필요합니다.", "warn"))
    return items

def sec_rules():
    W = CONTENT_W
    items = []
    items += h2("13", "입력 규칙 요약")
    items.append(sp(2))
    items.append(h3("날짜 형식"))
    items.append(simple_table(
        ["사용 위치", "형식", "예시"],
        [
            ["텍스트 일괄 입력 (감리/제안 일정)", "YYYYMMDD (8자리)", "20260323"],
            ["단계 추가/수정 다이얼로그",          "YYYY-MM-DD (달력 위젯)", "2026-03-23"],
        ],
        col_widths=[W*0.45, W*0.3, W*0.25]
    ))
    items.append(sp(3))
    items.append(h3("인력 입력 형식 (텍스트)"))
    items.append(simple_table(
        ["형식", "의미", "예시"],
        [
            ["이름:분야",       "MD = 단계 전체 영업일",             "이현우:사업관리 및 품질보증"],
            ["이름:분야:MD",    "MD 직접 지정",                       "강진욱:SW개발보안:4"],
            ["이름",            "제안 일정만. MD=전체, 분야는 섹션에서 결정", "강혁"],
            ["이름:숫자",       "제안 일정만. MD=지정, 분야는 섹션에서 결정", "최규택:3"],
        ],
        col_widths=[W*0.25, W*0.4, W*0.35]
    ))
    items.append(sp(3))
    items.append(h3("공통 제약사항"))
    items.append(simple_table(
        ["항목", "제약"],
        [
            ["프로젝트명",      "공백(빈 값) 불가"],
            ["기관명",          "공백(빈 값) 불가"],
            ["인력 이름",       "공백(빈 값) 불가"],
            ["날짜(텍스트)",    "YYYYMMDD 8자리 숫자만 허용. 형식 오류 시 해당 줄 무시."],
            ["MD",              "양의 정수. 단계 영업일 초과 시 경고 (저장은 가능)"],
            ["쉼표 사용",       "텍스트 형식 항목 구분자로 사용. 단계명에 쉼표 포함 불가."],
        ],
        col_widths=[W*0.25, W*0.75]
    ))
    items.append(sp(3))
    items.append(h3("분야(field) → 팀 분류 규칙"))
    items.append(simple_table(
        ["분야 패턴", "팀 분류", "정렬 순서"],
        [
            ["사업관리 포함",          "단계감리팀", "0 (최상위)"],
            ["응용시스템 포함",        "단계감리팀", "1"],
            ["데이터베이스 포함",      "단계감리팀", "2"],
            ["시스템구조 포함",        "단계감리팀", "3"],
            ["위 패턴 외 모두",        "전문가팀",   "999 (하위)"],
        ],
        col_widths=[W*0.4, W*0.3, W*0.3]
    ))
    items.append(sp(8))
    # 푸터 노트
    footer_data = [[Paragraph(
        "악티보 일정관리 시스템 사용자 매뉴얼  ·  v2  ·  2026년 3월  ·  내부 배포용",
        S("_footer", fontName="Nanum", fontSize=8, textColor=colors.HexColor("#94a3b8"),
          alignment=TA_CENTER)
    )]]
    footer_tbl = Table(footer_data, colWidths=[CONTENT_W],
                       style=TableStyle([
                           ("TOPPADDING",(0,0),(-1,-1),8),
                           ("BOTTOMPADDING",(0,0),(-1,-1),8),
                           ("LINEABOVE",(0,0),(-1,0),0.5, C_BORDER),
                       ]))
    items.append(footer_tbl)
    return items

# ── 문서 조립 ──────────────────────────────────────────────
def build():
    out_path = "/home/user/webapp/manual/악티보_일정관리_사용자매뉴얼_v2.pdf"
    doc = SimpleDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=MARGIN_L,
        rightMargin=MARGIN_R,
        topMargin=MARGIN_T,
        bottomMargin=MARGIN_B,
        title="악티보 일정관리 시스템 — 사용자 매뉴얼 v2",
        author="악티보",
    )

    story = []
    story += make_cover()
    story += sec_overview()
    story += sec_login()
    story += sec_home()
    story += sec_projects()
    story.append(PageBreak())
    story += sec_project_create()
    story.append(PageBreak())
    story += sec_project_detail()
    story += sec_phase()
    story += sec_staffing()
    story.append(PageBreak())
    story += sec_people()
    story += sec_schedule()
    story.append(PageBreak())
    story += sec_weekly()
    story += sec_report()
    story.append(PageBreak())
    story += sec_text_edit()
    story += sec_proposal()
    story.append(PageBreak())
    story += sec_presence()
    story += sec_admin()
    story.append(PageBreak())
    story += sec_rules()

    # 첫 페이지(커버)는 헤더/푸터 없음, 나머지는 on_page
    doc.build(story,
              onFirstPage=on_first_page,
              onLaterPages=on_page)
    print(f"✅ PDF 생성 완료: {out_path}")
    import os
    size = os.path.getsize(out_path)
    print(f"   파일 크기: {size/1024:.1f} KB")

if __name__ == "__main__":
    build()
