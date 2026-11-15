"""가상 사내 교육자료(eval/company-deck.json)를 PowerPoint 나 한쇼에서 열 수 있는 .pptx 로 만든다.

    python eval/build_company_deck.py

문장은 company-deck.json 의 것을 한 글자도 바꾸지 않고 넣는다. 검사기가 읽는 글자가 측정 때와 같아야 하기 때문이다.
python-pptx 가 필요하다(pip install python-pptx).
"""

import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

HERE = Path(__file__).resolve().parent
DECK = json.loads((HERE / "company-deck.json").read_text(encoding="utf-8"))
OUT = HERE.parent / "tests" / "fixtures" / "company-training-sample.pptx"

DARK = RGBColor(0x0F, 0x3D, 0x3E)
MINT = RGBColor(0x2F, 0xB5, 0xA0)
TINT = RGBColor(0xEA, 0xF5, 0xF2)
LINE = RGBColor(0xCF, 0xE3, 0xDE)
INK = RGBColor(0x1B, 0x2B, 0x2B)
MUTED = RGBColor(0x5B, 0x6B, 0x6B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
PALE = RGBColor(0xBF, 0xE6, 0xDD)
FONT = "맑은 고딕"

prs = Presentation()
prs.slide_width = Inches(10)
prs.slide_height = Inches(5.625)
BLANK = prs.slide_layouts[6]


def set_font(run, size, color, bold=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = FONT
    # 한글 글꼴은 동아시아 글꼴 자리에도 적어야 한쇼와 PowerPoint 양쪽에서 같은 글꼴로 보인다.
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = rpr.makeelement(qn(tag), {})
            rpr.append(el)
        el.set("typeface", FONT)


def text_box(slide, value, x, y, w, h, size, color=INK, bold=False, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(frame, side, 0)
    para = frame.paragraphs[0]
    para.alignment = align
    set_font(para.add_run(), size, color, bold)
    para.runs[0].text = value
    return box


def shape(slide, kind, x, y, w, h, fill, line=None):
    s = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(0.75)
    s.shadow.inherit = False
    return s


def badge(slide, number, x, y, size, fill, color):
    """번호 동그라미. 숫자는 도형 안의 글자로 넣는다."""
    s = shape(slide, MSO_SHAPE.OVAL, x, y, size, size, fill)
    frame = s.text_frame
    for side in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(frame, side, 0)
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    para = frame.paragraphs[0]
    para.alignment = PP_ALIGN.CENTER
    set_font(para.add_run(), 14, color, True)
    para.runs[0].text = str(number)


def card(slide, number, sentence, x, y, w, h, size):
    """번호가 붙은 카드. 카드 안의 문장은 자료의 문장 그대로다."""
    s = shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, TINT, LINE)
    s.adjustments[0] = 0.06
    badge(slide, number, x + 0.25, y + 0.25, 0.5, MINT, WHITE)
    text_box(slide, sentence, x + 0.25, y + 0.95, w - 0.5, h - 1.15, size)


def content_slide(index):
    slide = prs.slides.add_slide(BLANK)
    data = DECK["slides"][index]
    text_box(slide, data["text"][0], 0.6, 0.45, 8.8, 0.8, 30, DARK, True, MSO_ANCHOR.MIDDLE)
    text_box(slide, "한빛물산 인재개발팀 · 2026 하반기 신입사원 교육(가상의 회사)", 0.6, 5.18, 8.8, 0.3, 10, MUTED)
    slide.notes_slide.notes_text_frame.text = "\n".join(data.get("notes", []))
    return slide, data["text"]


S = DECK["slides"]

# 1. 표지
slide = prs.slides.add_slide(BLANK)
bg = shape(slide, MSO_SHAPE.RECTANGLE, 0, 0, 10, 5.625, DARK)
# 장식 동그라미는 슬라이드 안쪽에 둔다. 밖으로 걸치면 편집 화면에서 삐져나와 보인다.
shape(slide, MSO_SHAPE.OVAL, 7.5, 0.35, 2.1, 2.1, RGBColor(0x1C, 0x5A, 0x57))
shape(slide, MSO_SHAPE.OVAL, 8.3, 3.2, 1.3, 1.3, RGBColor(0x17, 0x4E, 0x4D))
text_box(slide, S[0]["text"][0], 0.7, 1.3, 7, 0.4, 16, PALE)
text_box(slide, S[0]["text"][1], 0.7, 1.85, 8, 1.0, 38, WHITE, True, MSO_ANCHOR.MIDDLE)
text_box(slide, S[0]["text"][2], 0.7, 3.0, 8, 0.5, 20, WHITE)
text_box(slide, S[0]["text"][3], 0.7, 4.5, 4, 0.4, 14, PALE)
slide.notes_slide.notes_text_frame.text = "\n".join(S[0]["notes"])

# 2. 설치: 카드 세 장
slide, lines = content_slide(1)
for i in range(3):
    card(slide, i + 1, lines[i + 1], 0.6 + i * 3.0, 1.5, 2.8, 3.3, 15)

# 3. 요금제와 사용량: 넓은 카드 두 장
slide, lines = content_slide(2)
card(slide, 1, lines[1], 0.6, 1.5, 4.3, 3.3, 18)
card(slide, 2, lines[2], 5.1, 1.5, 4.3, 3.3, 18)

# 4. 노트북 한도: 위아래 두 줄
slide, lines = content_slide(3)
for i in range(2):
    y = 1.5 + i * 1.7
    row = shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.6, y, 8.8, 1.5, TINT, LINE)
    row.adjustments[0] = 0.12
    badge(slide, i + 1, 0.9, y + 0.45, 0.6, DARK, WHITE)
    text_box(slide, lines[i + 1], 1.8, y + 0.2, 7.3, 1.1, 20, INK, True, MSO_ANCHOR.MIDDLE)

# 5. 플러그인: 큰 카드와 작은 카드
slide, lines = content_slide(4)
card(slide, 1, lines[1], 0.6, 1.5, 5.0, 3.3, 18)
card(slide, 2, lines[2], 5.8, 1.5, 3.6, 3.3, 16)

# 6. 지켜 주세요: 어두운 바탕에 세 줄
slide = prs.slides.add_slide(BLANK)
shape(slide, MSO_SHAPE.RECTANGLE, 0, 0, 10, 5.625, DARK)
text_box(slide, S[5]["text"][0], 0.7, 0.5, 8.6, 0.8, 30, WHITE, True, MSO_ANCHOR.MIDDLE)
for i, line in enumerate(S[5]["text"][1:]):
    y = 1.6 + i * 1.1
    badge(slide, i + 1, 0.7, y + 0.1, 0.6, MINT, DARK)
    text_box(slide, line, 1.6, y, 7.7, 0.8, 20, WHITE, False, MSO_ANCHOR.MIDDLE)
slide.notes_slide.notes_text_frame.text = "\n".join(S[5]["notes"])

OUT.parent.mkdir(parents=True, exist_ok=True)
prs.save(OUT)
print("만듦:", OUT.relative_to(HERE.parent))
