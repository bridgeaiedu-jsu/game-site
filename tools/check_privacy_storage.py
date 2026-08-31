# -*- coding: utf-8 -*-
"""개인정보처리방침의 저장 항목 목록 ↔ 제품이 실제로 쓰는 브라우저 저장소 키 정적 대조.

왜 필요한가 — 방침은 "현재 저장되는 항목은 다음이 전부입니다 / The complete list is" 라고 **닫아 놓은
목록**이다. 게임이 하나 늘 때마다 키가 늘어나는데 목록을 같이 고치지 않으면 그 문장은 그 순간 거짓이 된다
(2026-08-31 실측: 제품 61키 · 방침 19키 · 누락 42키). 사람 눈으로는 매번 놓친다 — 기계가 잡게 한다.

판정 규칙(각 지적에는 아래 id 가 대괄호로 붙는다 — 자기시험이 이 id 로 귀속을 대조한다)
  missing-exact     제품이 쓰는 정확 키가 그 언어 목록에 없다
  missing-prefix    제품이 쓰는 동적 접두가 그 언어 목록에 접두 패턴으로 없다
  stale-entry       방침에만 있고 제품이 쓰지 않는 항목이 남아 있다
  lang-mismatch     ko 목록과 en 목록의 항목 집합이 다르다(한쪽 언어 사용자에게만 거짓말이 된다)
  bad-placeholder   동적 항목의 자리표 문법이 어긋난다(접두 없음·안 닫힘·자리표 뒤 군더더기)
  unresolved-call   제품의 저장소 호출 인자를 정적으로 풀지 못했다 → 조용히 넘기지 않고 판정 불가로 멈춘다
  no-list           방침에서 해당 저장소의 목록(<h3>…(store)</h3> 다음 <ul>)을 읽지 못했다 → 판정 불가
  uncertain-code    그 호출이 '실행되는 코드'인지 아닌지 단정할 수 없다 → 판정 불가로 멈춘다

★설계 원칙(2026-08-31 오너 결정) — **틀릴 바에 멈춘다(fail-closed)**
자바스크립트를 손으로 완전히 해석하는 것은 도달 불가능한 목표다(정규식과 나눗셈의 구분은 문맥
의존이고, HTML 인라인·이벤트 핸들러·엔티티까지 겹친다). 그래서 이 검사기는 '정확히 파싱하는 도구'가
아니라 '확신할 수 없으면 멈추는 도구'다. 애매한 자리를 한쪽으로 단정해 넘기면 실행되는 호출을
조용히 놓치고(=거짓 통과) 방침이 거짓인 채로 배포된다. 놓치고 통과시키느니 멈춘다:
멈춘 자리는 파일:라인과 사유로 남기니 사람이 그 줄만 보면 된다.
구체적으로 — 애매한 '/' 는 두 해석(정규식/나눗셈)으로 각각 훑어 **결론이 갈리면 멈추고**,
읽다 막힌 자리(닫히지 않은 주석·문자열·태그) 뒤의 호출도 멈추며, 코드인지 아닌지 가릴 수 없는
자리의 호출도 멈춘다. '코드가 아니다'라고 뺄 수 있는 것은 근거가 확실한 것뿐이다.

★허용 목록을 이 파일 안에 상수로 두지 않는다 — 목록은 방침(privacy/index.html)이, 사실은 제품 코드가
말한다. 이 스크립트는 둘을 읽어 **대조만** 한다. 어느 쪽이 맞는지 판단하지 않는다: 어긋나면 미달이다.

제품의 경계(무엇을 제품으로 보는가)
  · 브라우저에 실려 **실행되는** .html/.js 만 제품이다. 실행되지 않는 글자는 제품 사용이 아니다:
    주석(줄·블록·HTML)·문자열·정규식 리터럴 안의 호출 모양 텍스트, 그리고 HTML 본문 산문은 세지 않는다.
    거꾸로 **놓치면 안 되는 자리**도 있다 — <script> 안쪽과 이벤트 핸들러 속성(onclick="…")은 코드다.
    (한쪽만 고치면 false-fail 이 false-pass 로 뒤집힌다. 배제한 건수는 결과에 한 줄로 남긴다.)
  · `tools/` 는 제품이 아니다 — node 로 돌리는 개발·검증 스크립트이며, 그 안의 localStorage 는
    검증기가 만든 모의 객체다. 제품으로 세면 검사기 자신의 키가 "방침 누락"으로 잡히는 거짓 미달이 난다.
  · `.git`·`node_modules`·`_` 로 시작하는 폴더, 그리고 방침 파일 자신도 스캔 대상이 아니다.

키를 찾는 방법(제품 쪽) — 따옴표 세 표기(' " `)를 모두 인정한다
  · 리터럴 인자           localStorage.setItem('bp.best', …) / setItem("bp.best", …) / setItem(`bp.best`, …)
  · 상수 경유             const STORE_KEY = 'ld.p';  … sessionStorage.setItem(STORE_KEY, …)
  · 접두 이어붙이기       localStorage.setItem('ms.best.' + level, …)  → 접두 'ms.best.' 로 기록
  · 그 밖의 표기(변수 미정의·템플릿 치환·계산식)는 **모른 척하지 않는다** — unresolved-call 로 rc=2.
접두는 방침에 개별 키가 아니라 **접두 패턴**으로 적혀야 한다 — `ms.best.<난이도>` 처럼 꺾쇠 자리표를 쓴다.
자리표 문법은 `비어 있지 않은 접두 + <비어 있지 않은 이름> + 뒤에 아무것도 없음` 이어야 한다.
★자리표는 **제품이 실제로 접두 이어붙이기를 쓰는 접두에만** 유효하다. 아무 접두나 인정하면
`bp.<anything>` 한 줄이 구체 키 고지를 통째로 대신해 목록을 숨기는 통로가 된다.

사용법: python3 tools/check_privacy_storage.py [저장소 루트] [--selftest]
종료코드: 0 = 미달 0 · 1 = 미달 발견 · 2 = 판정 불가(구조·호출을 읽지 못해 판정 자체가 성립 안 함)
★읽기 전용이다(--selftest 는 임시 사본만 만들고 지운다).
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '.')
POLICY = os.path.join(ROOT, 'privacy', 'index.html')

# 제품이 아닌 경로 — 근거는 위 '제품의 경계' 절.
SKIP_DIRS = {'.git', 'node_modules', 'tools'}

CALL_HEAD = re.compile(r"(localStorage|sessionStorage)\s*\.\s*(?:set|get|remove)Item\s*\(")
CONST_DEF = re.compile(r"""(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]*)\2\s*;""")
STR_LIT = re.compile(r"""^(['"`])(.*)\1$""", re.S)
IDENT = re.compile(r'^[A-Za-z_$][\w$]*$')
# 자리표 문법: 접두(꺾쇠 없음, 비어 있지 않음) + <이름(꺾쇠 없음, 비어 있지 않음)> + 뒤에 아무것도 없음
PLACEHOLDER = re.compile(r'^([^<>]+)<([^<>]+)>$')


def first_arg(src, i):
    """src[i:] 에서 인자 하나를 끝까지 읽는다(문자열·괄호 중첩을 존중). (표현식, 다음위치)."""
    j, depth, quote, esc = i, 0, None, False
    while j < len(src):
        c = src[j]
        if quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == quote:
                quote = None
        elif c in '\'"`':
            quote = c
        elif c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                return src[i:j], j
            depth -= 1
        elif c == ',' and depth == 0:
            return src[i:j], j
        j += 1
    return None, j


def classify_arg(expr, consts):
    """인자 표현식을 (종류, 값) 으로 푼다 — ('exact'|'prefix'|'unresolved', 값)."""
    if expr is None:
        return 'unresolved', ''
    e = expr.strip()
    if not e:
        return 'unresolved', expr
    m = STR_LIT.match(e)
    if m:                                   # 통짜 문자열 하나 → 정확 키
        if m.group(1) == '`' and '${' in m.group(2):
            return 'unresolved', e          # 템플릿 치환은 정적으로 못 푼다
        return 'exact', m.group(2)
    # '접두' + 무엇  →  접두 이어붙이기
    head = re.match(r"""^(['"`])((?:[^'"`\\]|\\.)*)\1\s*\+""", e)
    if head:
        if head.group(1) == '`' and '${' in head.group(2):
            return 'unresolved', e
        return 'prefix', head.group(2)
    if IDENT.match(e):                      # 상수 경유
        if e in consts:
            return 'exact', consts[e]
        return 'unresolved', e
    return 'unresolved', e


# 본문이 실행되는 script type (HTML 표준 — 그 밖의 type 은 데이터 블록이라 실행되지 않는다)
JS_MIME = {'text/javascript', 'application/javascript', 'module',
           'text/ecmascript', 'application/ecmascript'}
# 이름 있는 엔티티 — 핸들러 속성값은 이걸 풀어야 진짜 코드가 보인다(&lpar; 같은 것으로 괄호를 숨길 수 있다).
ENTITY = {'quot': '"', 'apos': "'", 'amp': '&', 'lt': '<', 'gt': '>', 'nbsp': ' ',
          'lpar': '(', 'rpar': ')', 'lbrack': '[', 'rbrack': ']', 'lbrace': '{', 'rbrace': '}',
          'comma': ',', 'period': '.', 'semi': ';', 'colon': ':', 'equals': '=', 'sol': '/',
          'bsol': '\\', 'plus': '+', 'excl': '!', 'quest': '?', 'ast': '*', 'percnt': '%',
          'commat': '@', 'grave': '`', 'dollar': '$', 'num': '#', 'lowbar': '_', 'minus': '-',
          'verbar': '|'}
# '/' 앞에 이 낱말이 오면 나눗셈이 문법 오류다 → 정규식이 확실하다.
KW_BEFORE_REGEX = {'return', 'typeof', 'instanceof', 'new', 'delete', 'void', 'in', 'of',
                   'case', 'do', 'else', 'yield', 'await', 'throw'}


def html_unescape(t):
    def one(m):
        name = m.group(1)
        if name.startswith('#'):
            try:
                return chr(int(name[2:], 16) if name[1:2].lower() == 'x' else int(name[1:]))
            except ValueError:
                return m.group(0)
        return ENTITY.get(name.lower(), m.group(0))
    return re.sub(r'&([#\w]+);', one, t)


def _lex(text, i, end, ambiguous_is_regex, spans, bad, stop_at_brace=False):
    """[i,end) 를 훑어 '실행되지 않는 글자'(주석·문자열·정규식) 구간을 spans 에 모은다.

    ambiguous_is_regex — ')' · '}' 뒤의 '/' 처럼 문맥 없이는 정규식인지 나눗셈인지 가릴 수 없는 자리를
    어느 쪽으로 볼지. 이 함수를 두 값으로 각각 돌려 **결론이 갈리면 그 자리는 '모른다'** 로 처리한다
    (fail-closed — 한쪽 해석만 믿고 넘어가면 실행되는 호출을 조용히 놓친다).
    stop_at_brace — 템플릿 치환 ${…} 안을 훑을 때, 짝 맞는 '}' 위치를 돌려주고 멈춘다(-1=못 찾음).
    """
    prev, depth = 'none', 0
    while i < end:
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c == '/' and i + 1 < end and text[i + 1] == '/':
            j = text.find('\n', i, end)
            j = end if j < 0 else j
            spans.append((i, j)); i = j; continue
        if c == '/' and i + 1 < end and text[i + 1] == '*':
            j = text.find('*/', i + 2, end)
            if j < 0:
                bad.append((i, '닫히지 않은 블록 주석')); spans.append((i, end)); return -1 if stop_at_brace else end
            spans.append((i, j + 2)); i = j + 2; continue
        if c == '/':
            if prev in ('ident', 'num', 'str', 'regex', 'inc', 'close_bracket'):
                is_regex = False                       # 값 뒤의 '/' 는 나눗셈이 확실하다
            elif prev in ('none', 'op', 'keyword'):
                is_regex = True                        # 연산자·예약어 뒤의 '/' 는 정규식이 확실하다
            else:
                is_regex = ambiguous_is_regex          # ')' '}' 뒤 — 문맥 없이는 못 가린다
            if not is_regex:
                prev = 'op'; i += 1; continue
            j, esc, cls = i + 1, False, False
            while j < end:
                d = text[j]
                if esc:
                    esc = False
                elif d == '\\':
                    esc = True
                elif d == '[':
                    cls = True
                elif d == ']':
                    cls = False
                elif d == '/' and not cls:
                    j += 1
                    break
                elif d == '\n':
                    bad.append((i, '닫히지 않은 정규식 리터럴'))
                    break
                j += 1
            spans.append((i, j)); prev = 'regex'; i = j; continue
        if c in '\'"`':
            q, j, esc, seg = c, i + 1, False, i
            closed = False
            while j < end:
                d = text[j]
                if esc:
                    esc = False
                elif d == '\\':
                    esc = True
                elif q == '`' and d == '$' and j + 1 < end and text[j + 1] == '{':
                    spans.append((seg, j))             # 여기까지가 문자열
                    k = _lex(text, j + 2, end, ambiguous_is_regex, spans, bad, stop_at_brace=True)
                    if k < 0:
                        bad.append((j, '템플릿 치환 ${…} 의 짝 중괄호를 찾지 못했다'))
                        spans.append((j, end)); return -1 if stop_at_brace else end
                    j = seg = k + 1                    # 치환부는 실행되는 코드 — 가리지 않는다
                    continue
                elif d == q:
                    j += 1; closed = True
                    break
                elif q != '`' and d == '\n':
                    break
                j += 1
            if not closed:
                bad.append((i, '닫히지 않은 문자열'))
            spans.append((seg, j)); prev = 'str'; i = j; continue
        if c.isalpha() or c in '_$':
            j = i
            while j < end and (text[j].isalnum() or text[j] in '_$'):
                j += 1
            prev = 'keyword' if text[i:j] in KW_BEFORE_REGEX else 'ident'
            i = j; continue
        if c.isdigit():
            j = i
            while j < end and (text[j].isalnum() or text[j] == '.'):
                j += 1
            prev = 'num'; i = j; continue
        if text.startswith('++', i) or text.startswith('--', i):
            prev = 'inc'; i += 2; continue            # 후위 증감 뒤의 '/' 는 나눗셈이다
        if c == '{':
            depth += 1; prev = 'op'; i += 1; continue
        if c == '}':
            if stop_at_brace and depth == 0:
                return i
            depth -= 1; prev = 'close_brace'; i += 1; continue
        if c == ')':
            prev = 'close_paren'; i += 1; continue
        if c == ']':
            prev = 'close_bracket'; i += 1; continue
        prev = 'op'; i += 1
    return -1 if stop_at_brace else end


def js_verdicts(text):
    """두 해석으로 각각 훑어 (해석A 가린 구간, 해석B 가린 구간, 진짜로 못 읽은 지점) 을 돌려준다.

    ★'못 읽었다'는 **두 해석이 모두 막혔을 때만** 참이다. 한쪽만 막힌 것은 그 해석이 잘못 고른
    탓이지 원문의 결함이 아니다(예: 나눗셈을 정규식으로 본 해석은 줄 끝에서 막힌다). 한쪽만 막힌
    구간의 위험은 아래 '두 해석이 갈리면 멈춘다' 규칙이 이미 덮는다.
    """
    a, b, bad_a, bad_b = [], [], [], []
    _lex(text, 0, len(text), True, a, bad_a)
    _lex(text, 0, len(text), False, b, bad_b)
    if bad_a and bad_b:
        pa, pb = min(bad_a)[0], min(bad_b)[0]
        both = max(min(bad_a), min(bad_b), key=lambda x: x[0]) if pa != pb else min(bad_a)
        return a, b, both
    return a, b, None


def html_scan(src):
    """HTML 을 훑어 (실행되는 코드 단위, 확실히 코드가 아닌 구간, 못 읽은 지점) 을 돌려준다.

    코드 단위는 둘뿐이다 — 실행되는 <script> 본문과 이벤트 핸들러 속성값(따옴표 유무·엔티티 모두).
    확실히 코드가 아닌 것: 본문 산문 · HTML 주석 · 핸들러가 아닌 속성값(data-onclick 등) ·
    type 이 자바스크립트가 아닌 script · src 가 있어 본문이 무시되는 script · style/textarea/title 본문.
    그 밖에 읽다 막힌 자리는 '모른다'로 남겨 호출이 걸리면 멈춘다.
    """
    units, noncode, bad = [], [], []
    i, n = 0, len(src)
    while i < n:
        lt = src.find('<', i)
        if lt < 0:
            noncode.append((i, n)); break
        if lt > i:
            noncode.append((i, lt))
        if src.startswith('<!--', lt):
            end = src.find('-->', lt + 4)
            if end < 0:
                bad.append((lt, '닫히지 않은 HTML 주석')); break   # 그 뒤를 '코드 아님'으로 접지 않는다
            noncode.append((lt, end + 3)); i = end + 3; continue
        m = re.match(r'</?([A-Za-z][\w:-]*)', src[lt:])
        if not m:
            noncode.append((lt, lt + 1)); i = lt + 1; continue
        name, closing = m.group(1).lower(), src.startswith('</', lt)
        j, attrs, broke = lt + m.end(), {}, False
        while True:
            while j < n and src[j].isspace():
                j += 1
            if j >= n:
                bad.append((lt, '닫히지 않은 태그')); broke = True; break
            if src[j] == '>':
                j += 1; break
            if src[j] == '/' and j + 1 < n and src[j + 1] == '>':
                j += 2; break
            am = re.match(r'[^\s=/>]+', src[j:])
            if not am:
                j += 1
                continue
            aname = am.group(0).lower(); j += am.end()
            while j < n and src[j].isspace():
                j += 1
            if j < n and src[j] == '=':
                j += 1
                while j < n and src[j].isspace():
                    j += 1
                if j < n and src[j] in '"\'':
                    q = src[j]; k = src.find(q, j + 1)
                    if k < 0:
                        bad.append((j, '닫히지 않은 속성값')); broke = True; break
                    vs, ve, j = j + 1, k, k + 1
                else:
                    k = j
                    while k < n and (not src[k].isspace()) and src[k] != '>':
                        k += 1
                    vs, ve, j = j, k, k
                attrs[aname] = (vs, ve)
                if re.match(r'^on[a-z]+$', aname):     # 진짜 이벤트 핸들러만 코드다(data-onclick 은 아니다)
                    decoded = html_unescape(src[vs:ve])
                    units.append({'kind': 'handler', 's': vs, 'e': ve, 'text': decoded,
                                  'exact_offsets': False,
                                  # 못 푼 엔티티가 남았으면 이 값이 진짜 무슨 코드인지 단정할 수 없다.
                                  'undecoded': bool(re.search(r'&[#\w]+;', decoded))})
                else:
                    noncode.append((vs, ve))
            else:
                attrs[aname] = None
        if broke:
            break   # 읽다 막혔으면 나머지를 모른다로 남긴다(비코드로 단정하지 않는다)
        if name in ('script', 'style', 'textarea', 'title') and not closing:
            cm = re.search(r'</%s[\s/>]' % name, src[j:], re.I)
            if not cm:
                bad.append((j, '닫히지 않은 <%s>' % name)); break
            body_s, body_e = j, j + cm.start()
            if name == 'script':
                t = attrs.get('type')
                tv = src[t[0]:t[1]].strip().lower() if t else None
                if tv is not None:
                    tv = html_unescape(tv).split(';')[0].strip()   # MIME 매개변수(; charset=…)는 떼고 본다
                # type 이 없거나 비었거나 자바스크립트 계열이고 src 가 없을 때만 본문이 실행된다(HTML 표준 —
                # 빈 type 과 매개변수 붙은 MIME 도 실행된다. 여기를 좁게 보면 실행되는 코드를 놓친다).
                if (tv is None or tv == '' or tv in JS_MIME) and 'src' not in attrs:
                    units.append({'kind': 'js', 's': body_s, 'e': body_e,
                                  'text': src[body_s:body_e], 'exact_offsets': True})
                else:
                    noncode.append((body_s, body_e))
            else:
                noncode.append((body_s, body_e))
            close = src.find('>', body_e)
            i = (close + 1) if close >= 0 else n
            continue
        i = j
    return units, noncode, bad


def _in(spans, pos):
    return any(a <= pos < b for a, b in spans)


def _line(src, pos):
    return src.count('\n', 0, pos) + 1


# ★후보 수집의 그물 — 저장소 객체 이름이 나오는 자리를 전부 본다(R5).
OBJ_RE = re.compile(r'(?<![\w$])(localStorage|sessionStorage)(?![\w$])')
# 이름을 가리는 표기 — 보이면 이름을 단정할 수 없으니 멈춘다.
ESCAPED_IDENT = re.compile(r'\\u\{?[0-9a-fA-F]')
DYNAMIC_EXEC = re.compile(r'(?<![\w$.])(eval\s*\(|new\s+Function\s*\()')
KEY_METHODS = {'setItem', 'getItem', 'removeItem'}
# 키를 만들지도 읽지도 않는 멤버 — 이것만 '안전하게 무시'한다(그 밖의 멤버는 모른다=정지).
SAFE_MEMBERS = {'length', 'clear', 'key'}


def _skip_gap(text, i, end):
    """공백과 주석을 건너뛴다 — 객체와 '.' 사이에 주석이 끼어도 같은 호출이다."""
    while i < end:
        if text[i].isspace():
            i += 1; continue
        if text.startswith('//', i):
            j = text.find('\n', i, end)
            i = end if j < 0 else j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2, end)
            if j < 0:
                return -1
            i = j + 2; continue
        break
    return i


def classify_access(text, i, end):
    """저장소 객체 이름 **바로 뒤**를 보고 무엇으로 쓰였는지 가른다.

    ('call', 메서드, 인자시작) — 우리가 아는 호출: .setItem( · ?.setItem( · ["setItem"]( · ?.["setItem"](
    ('safe', 이름)            — 키와 무관한 멤버(length·clear·key)
    ('unknown', 사유)         — 그 밖의 모든 것. 별칭 대입·인자 전달·낯선 멤버·동적 이름은 여기로 오며
                                호출자는 이것을 **정지**로 다룬다(모르면 멈춘다).
    """
    j = _skip_gap(text, i, end)
    if j < 0:
        return ('unknown', '주석이 닫히지 않아 이 자리를 읽지 못했다')
    if text.startswith('?.', j):
        j = _skip_gap(text, j + 2, end)
    elif text[j:j + 1] == '.':
        j = _skip_gap(text, j + 1, end)
    elif text[j:j + 1] != '[':
        return ('unknown', '저장소 객체가 호출이 아닌 자리로 흘러간다(별칭 대입·인자 전달 등) — 뒤를 따라갈 수 없다')
    if j < 0:
        return ('unknown', '주석이 닫히지 않아 이 자리를 읽지 못했다')
    if text[j:j + 1] == '[':
        k = _skip_gap(text, j + 1, end)
        if k < 0:
            return ('unknown', '주석이 닫히지 않아 이 자리를 읽지 못했다')
        m = re.match(r"""(['"`])([A-Za-z_$][\w$]*)\1""", text[k:end])
        if not m:
            return ('unknown', '대괄호 접근의 이름이 문자열 상수가 아니라 무엇을 부르는지 알 수 없다')
        name = m.group(2)
        k = _skip_gap(text, k + m.end(), end)
        if k < 0 or text[k:k + 1] != ']':
            return ('unknown', '대괄호 접근을 끝까지 읽지 못했다')
        k = _skip_gap(text, k + 1, end)
    else:
        m = re.match(r'[A-Za-z_$][\w$]*', text[j:end])
        if not m:
            return ('unknown', '멤버 이름을 읽지 못했다')
        name = m.group(0)
        k = _skip_gap(text, j + m.end(), end)
    if k < 0:
        return ('unknown', '주석이 닫히지 않아 이 자리를 읽지 못했다')
    if name in KEY_METHODS:
        if text[k:k + 1] != '(':
            return ('unknown', '%s 가 호출되지 않고 값으로 넘어간다 — 어디서 불릴지 알 수 없다' % name)
        return ('call', name, k + 1)
    if name in SAFE_MEMBERS:
        return ('safe', name)
    return ('unknown', '알 수 없는 멤버 접근(.%s) — 무엇을 하는지 단정할 수 없다' % name)


def scan_file(src, is_html, rel):
    """한 파일에서 (호출 판정 목록, 코드 아님으로 뺀 것, 멈춰야 할 자리) 를 돌려준다.

    ★후보 수집부터 fail-closed 다(R5). 예전에는 `localStorage.setItem(` 이라는 **한 문법**만 후보로
    모아서, 그 밖의 표기(대괄호 `localStorage["setItem"]` · 옵셔널 체이닝 `localStorage?.setItem` ·
    별칭 `const LS = localStorage`)는 애초에 보이지도 않았다 — 안 보이는 것은 멈출 수도 없다.
    이제는 **저장소 객체 이름이 나오는 자리를 전부** 후보로 모으고, 그 뒤가 우리가 아는 호출 모양이
    아니면(객체가 값으로 흘러가면) 그 자리에서 멈춘다.
    """
    calls, ignored, stops = [], [], []
    if is_html:
        units, noncode, bad = html_scan(src)
    else:
        units, noncode, bad = [{'kind': 'js', 's': 0, 'e': len(src), 'text': src,
                                'exact_offsets': True}], [], []
    # ★못 읽은 자리가 있다는 사실만으로는 멈추지 않는다 — 그 뒤에 **저장소 언급이 실제로 있을 때만**
    #   멈춘다(아래 규칙들). 언급이 없으면 판정에 영향이 없고, 영향 없는 정지는 소음일 뿐이다.
    html_bad = bad[0] if bad else None

    covered = [(u['s'], u['e']) for u in units]
    for m in OBJ_RE.finditer(src):                     # 원문에서 후보를 먼저 전수로 모은다
        if _in(covered, m.start()):
            continue                                   # 코드 단위 안 — 아래에서 따로 본다
        if _in(noncode, m.start()):
            ignored.append('%s:%d' % (rel, _line(src, m.start())))
            continue
        stops.append('%s:%d — 코드인지 아닌지 가릴 수 없는 자리의 저장소 언급%s'
                     % (rel, _line(src, m.start()),
                        ('(앞 %d행에서 %s)' % (_line(src, html_bad[0]), html_bad[1]))
                        if html_bad and m.start() >= html_bad[0] else ''))

    for u in units:
        text = u['text']
        if u.get('undecoded'):
            stops.append('%s:%d — 이벤트 핸들러 속성에 풀지 못한 엔티티가 남아 무슨 코드인지 단정할 수 없다'
                         % (rel, _line(src, u['s'])))
        a, b, first_bad = js_verdicts(text)

        def at(off):
            """유닛 안 위치를 파일 행 번호로."""
            return _line(src, u['s']) + (text.count('\n', 0, off) if u['exact_offsets'] else 0)

        def certainly_code(off):
            ca, cb = not _in(a, off), not _in(b, off)
            return (ca, cb)

        # ── 이름을 가릴 수 없게 만드는 표기들 — 보이면 멈춘다 ──────────────
        for m in ESCAPED_IDENT.finditer(text):
            ca, cb = certainly_code(m.start())
            if ca and cb:
                stops.append('%s:%d — 유니코드 이스케이프가 섞인 식별자라 이름을 단정할 수 없다(%s)'
                             % (rel, at(m.start()), m.group(0)))
        for m in DYNAMIC_EXEC.finditer(text):
            ca, cb = certainly_code(m.start())
            if ca and cb:
                stops.append('%s:%d — %s 로 만들어 실행하는 코드가 있어 무엇이 실행될지 단정할 수 없다'
                             % (rel, at(m.start()), m.group(0).strip()))

        consts = {}
        for m in CONST_DEF.finditer(text):
            if not _in(a, m.start()) and not _in(b, m.start()):
                consts[m.group(1)] = m.group(3)

        for m in OBJ_RE.finditer(text):
            off, line = m.start(), at(m.start())
            code_a, code_b = certainly_code(off)
            if code_a != code_b:
                stops.append('%s:%d — 정규식인지 나눗셈인지에 따라 코드 여부가 갈린다(둘 중 하나로 단정하지 않는다)'
                             % (rel, line))
                continue
            if first_bad and off >= first_bad[0]:
                stops.append('%s:%d — 앞에서 %s 라 이 자리가 코드인지 단정할 수 없다' % (rel, line, first_bad[1]))
                continue
            if not code_a:
                ignored.append('%s:%d' % (rel, line))
                continue
            kind = classify_access(text, m.end(), len(text))
            if kind[0] == 'unknown':
                stops.append('%s:%d — %s' % (rel, line, kind[1]))
                continue
            if kind[0] == 'safe':
                ignored.append('%s:%d' % (rel, line))
                continue
            expr, _end = first_arg(text, kind[2])
            calls.append((m.group(1), '%s:%d' % (rel, line), expr, consts))
    return calls, ignored, stops


def product_keys(root):
    """(exact, prefix, unresolved, 스캔파일수, 코드아님으로 뺀 호출들, 판정을 멈춰야 할 자리들)."""
    exact = {'localStorage': {}, 'sessionStorage': {}}
    prefix = {'localStorage': {}, 'sessionStorage': {}}
    unresolved, ignored, stops = [], [], []
    scanned = 0
    for d, subs, fs in os.walk(root):
        subs[:] = [s for s in subs if s not in SKIP_DIRS and not s.startswith('_')]
        for f in sorted(fs):
            if not (f.endswith('.html') or f.endswith('.js')):
                continue
            p = os.path.join(d, f)
            if os.path.normpath(p) == os.path.normpath(POLICY):
                continue
            try:
                src = io.open(p, encoding='utf-8', newline='').read()
            except Exception:
                continue
            scanned += 1
            rel = os.path.relpath(p, root).replace('\\', '/')
            calls, ign, stp = scan_file(src, f.endswith('.html'), rel)
            ignored.extend(ign); stops.extend(stp)
            for store, where, expr, consts in calls:
                kind, val = classify_arg(expr, consts)
                if kind == 'unresolved':
                    unresolved.append('%s — %s.…Item(%s' % (where, store, (val or '?').strip()[:60]))
                else:
                    (prefix if kind == 'prefix' else exact)[store].setdefault(val, set()).add(
                        where.rsplit(':', 1)[0])
    return exact, prefix, unresolved, scanned, ignored, stops


def policy_sections(src):
    """방침에서 (언어, 저장소) → [항목 코드]. ko/en 은 id="en" 을 경계로 가른다."""
    half = src.find('id="en"')
    if half < 0:
        return None, 'en 절 경계(id="en")를 찾지 못했다'
    parts = {'ko': src[:half], 'en': src[half:]}
    out = {}
    for lang, chunk in parts.items():
        for store in ('localStorage', 'sessionStorage'):
            m = re.search(r'<h3>[^<]*\(%s\)</h3>(.*?)</ul>' % store, chunk, re.S)
            if not m:
                out[(lang, store)] = None
                continue
            out[(lang, store)] = re.findall(r'<li><code>([^<]+)</code>', m.group(1))
    return out, None


def unescape(t):
    """방침은 자리표를 HTML 실체 참조로 적는다(&lt;난이도&gt;) — 풀어야 꺾쇠를 알아본다."""
    return t.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')


def parse_entry(entry):
    """방침 항목 하나를 (종류, 값) 으로 푼다 — ('exact'|'prefix'|'bad', 값/사유)."""
    e = unescape(entry)
    if '<' not in e and '>' not in e:
        return ('exact', e) if e else ('bad', '빈 항목')
    m = PLACEHOLDER.match(e)
    if not m:
        if '<' in e and '>' not in e:
            return 'bad', '자리표가 닫히지 않았다'
        if e.startswith('<'):
            return 'bad', '자리표 앞 접두가 없다'
        if not e.endswith('>'):
            return 'bad', '자리표 뒤에 군더더기가 붙었다'
        return 'bad', '자리표 문법이 어긋난다'
    return 'prefix', m.group(1)


def run(root):
    fails, indet, notes = [], [], []

    if not os.path.exists(POLICY):
        print('  ‽ [no-list] 방침 파일(privacy/index.html)이 없다')
        print('결과: rc=2 (판정 불가)')
        return 2
    src = io.open(POLICY, encoding='utf-8', newline='').read()
    lists, err = policy_sections(src)
    if err:
        print('  ‽ [no-list] %s' % err)
        print('결과: rc=2 (판정 불가)')
        return 2

    exact, prefix, unresolved, scanned, ignored, stops = product_keys(root)
    for s in stops:
        # ★fail-closed — 코드인지 아닌지 확신할 수 없으면 배제하지도 인정하지도 않고 여기서 멈춘다.
        indet.append('[uncertain-code] %s' % s)
    for u in unresolved:
        indet.append('[unresolved-call] 저장소 호출 인자를 정적으로 풀지 못했다 — %s' % u)

    for store in ('localStorage', 'sessionStorage'):
        used = sorted(exact[store])
        pref = sorted(prefix[store])
        parsed = {}
        for lang in ('ko', 'en'):
            entries = lists.get((lang, store))
            if entries is None:
                indet.append('[no-list] %s 절에서 %s 목록(<h3>…(%s)</h3> 다음 <ul>)을 읽지 못했다'
                             % (lang, store, store))
                continue
            kinds = [(e, ) + tuple(parse_entry(e)) for e in entries]
            parsed[lang] = kinds
            for raw, kind, val in kinds:
                if kind == 'bad':
                    fails.append('[bad-placeholder] %s 목록(%s)의 항목 문법이 어긋난다: %s — %s'
                                 % (store, lang, raw, val))
            ok_exact = [v for _r, k, v in kinds if k == 'exact']
            ok_prefix = [v for _r, k, v in kinds if k == 'prefix']
            for k in used:
                # ★접두 자리표는 **제품이 실제로 접두 이어붙이기를 쓰는 접두**일 때만 정확 키를 덮는다.
                #   아무 접두나 덮게 두면 `bp.<anything>` 같은 뭉뚱그린 한 줄이 구체 키 고지를 통째로
                #   무력화한다(고지 의무 회피 경로). 제품 동적 접두 목록(pref)에 있는 것만 인정한다.
                if k in ok_exact or any(p in pref and k.startswith(p) for p in ok_prefix):
                    continue
                fails.append('[missing-exact] %s 목록(%s)에 제품 사용 키가 빠졌다: %s  (%s)'
                             % (store, lang, k, ', '.join(sorted(exact[store][k]))))
            for pk in pref:
                if pk not in ok_prefix:
                    fails.append('[missing-prefix] %s 목록(%s)에 접두 패턴이 없다: %s<…>  (%s)'
                                 % (store, lang, pk, ', '.join(sorted(prefix[store][pk]))))
            for raw, kind, val in kinds:
                if kind == 'exact' and val not in used:
                    fails.append('[stale-entry] %s 목록(%s)에 제품이 쓰지 않는 항목이 남아 있다: %s'
                                 % (store, lang, raw))
                elif kind == 'prefix' and val not in pref:
                    # 제품 동적 접두가 아닌 자리표는 '그 접두로 시작하는 정확 키가 있다'는 이유로
                    # 봐주지 않는다 — 그 봐주기가 I3(임의 접두 false-pass)의 통로였다.
                    fails.append('[stale-entry] %s 목록(%s)에 제품이 동적으로 쓰지 않는 접두 패턴이 남아 있다: %s'
                                 % (store, lang, raw))

        if 'ko' in parsed and 'en' in parsed:
            def ident(kinds):
                out = set()
                for raw, kind, val in kinds:
                    out.add(val if kind == 'exact' else
                            (val + '<…>' if kind == 'prefix' else '깨진항목:' + raw))
                return out
            kset, eset = ident(parsed['ko']), ident(parsed['en'])
            if kset != eset:
                fails.append('[lang-mismatch] %s 목록의 ko·en 항목 집합이 다르다 — ko 에만 %s · en 에만 %s'
                             % (store, sorted(kset - eset) or '없음', sorted(eset - kset) or '없음'))

        notes.append('%s — 제품 %d키 + 접두 %d종 · 방침 ko %s항목 · en %s항목'
                     % (store, len(used), len(pref),
                        'X' if lists.get(('ko', store)) is None else len(lists[('ko', store)]),
                        'X' if lists.get(('en', store)) is None else len(lists[('en', store)])))

    print('저장 항목 대조 — 대상 %s' % root.replace('\\', '/'))
    print('  · 제품으로 센 파일 %d개 (제외: %s · _로 시작하는 폴더 · 방침 자신)'
          % (scanned, ', '.join(sorted(SKIP_DIRS))))
    if ignored:
        print('  · 코드가 아닌 자리(주석·문자열·본문)의 호출 모양 텍스트 %d건은 실사용으로 세지 않았다 — %s'
              % (len(ignored), ', '.join(ignored[:6]) + (' …' if len(ignored) > 6 else '')))
    for n in notes:
        print('  · ' + n)
    for f in fails:
        print('  ✗ ' + f)
    for i in indet:
        print('  ‽ ' + i)
    if indet:
        print('결과: rc=2 (판정 불가 %d건 · 미달 %d건) — 판정 불가가 하나라도 있으면 통과로 세지 않는다'
              % (len(indet), len(fails)))
        return 2
    print('결과: rc=%d (미달 %d건)' % (1 if fails else 0, len(fails)))
    return 1 if fails else 0


# ─────────────────────────── 검출력 자기시험 ───────────────────────────
# 케이스마다 **어느 규칙이 잡아야 하는가**를 못박는다. rc 만 보면 규칙을 통째로 지운 변이체에서도
# 다른 규칙이 우연히 걸려 초록으로 뜬다(무임승차) — 그래서 기대 규칙 id 의 출현까지 대조한다.

def _read(p):
    return io.open(p, encoding='utf-8', newline='').read()


def _write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


def _append_stats(work, line):
    p = os.path.join(work, 'js', 'hp-stats.js')
    _write(p, _read(p) + '\n' + line + '\n')


def _inject_single(work):
    _append_stats(work, "try { localStorage.setItem('zz.single', '1'); } catch (e) {}")


def _inject_double(work):
    _append_stats(work, 'try { localStorage.setItem("zz.double", "1"); } catch (e) {}')


def _inject_backtick(work):
    _append_stats(work, 'try { localStorage.setItem(`zz.backtick`, "1"); } catch (e) {}')


def _inject_unresolved(work):
    _append_stats(work, 'try { localStorage.setItem(zzWhoKnows, "1"); } catch (e) {}')


def _tools_only_key(work):
    _write(os.path.join(work, 'tools', 'zz_fixture.js'),
           "localStorage.setItem('zz.tool-only', '1');\n")


def _drop_entry(work, lang):
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p)
    half = s.find('id="en"')
    head, tail = (s[:half], s[half:]) if lang == 'ko' else (s[half:], s[:half])
    m = re.search(r'\s*<li><code>[^<]+</code>[^\n]*\n', head)
    if not m:
        return
    head = head[:m.start()] + head[m.end():]
    _write(p, head + tail if lang == 'ko' else tail + head)


def _add_stale(work):
    """ko·en 양쪽에 하나씩 넣는다 — 한쪽에만 넣으면 lang-mismatch 가 섞여 귀속이 흐려진다."""
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p)
    half = s.find('id="en"')
    ghost = '<li><code>zz.ghost</code> — 유령 항목</li>\n      <li><code>'
    _write(p, s[:half].replace('<li><code>', ghost, 1) + s[half:].replace('<li><code>', ghost, 1))


def _drop_prefix_entry(work):
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p)
    s = re.sub(r'\s*<li><code>ms\.best\.&lt;[^<]*</code>[^\n]*\n', '\n', s)
    _write(p, s)


def _unclosed_placeholder(work):
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p).replace('ms.best.&lt;난이도&gt;', 'ms.best.&lt;난이도') \
                .replace('ms.best.&lt;difficulty&gt;', 'ms.best.&lt;difficulty')
    _write(p, s)


def _trailing_garbage(work):
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p).replace('ms.best.&lt;난이도&gt;', 'ms.best.&lt;난이도&gt;.wrong') \
                .replace('ms.best.&lt;difficulty&gt;', 'ms.best.&lt;difficulty&gt;.wrong')
    _write(p, s)


def _fake_prefix(work):
    """제품이 동적으로 쓰지 않는 접두(bp.)로 정확 키 bp.lang 을 뭉갠다 — 고지 의무 회피 경로."""
    p = os.path.join(work, 'privacy', 'index.html')
    _write(p, _read(p).replace('<code>bp.lang</code>', '<code>bp.&lt;anything&gt;</code>'))


def _comment_call(work):
    _append_stats(work, '// localStorage.setItem("zz.comment-only", "1");')


def _block_comment_call(work):
    _append_stats(work, '/* 예시:\n   localStorage.setItem("zz.block-comment-only", "1");\n*/')


def _string_call(work):
    _append_stats(work, 'var zzDoc = "localStorage.setItem(\'zz.string-only\', \'1\')";')


def _prose_call(work):
    p = os.path.join(work, 'index.html')
    _write(p, _read(p).replace(
        '</body>', '<p>예시 설명: localStorage.setItem("zz.prose-only", "1") 처럼 씁니다.</p>\n</body>', 1))


def _handler_call(work):
    """이벤트 핸들러 속성 안은 **진짜 실행되는 코드**다 — 놓치면 과소 인식(false-pass) 회귀."""
    p = os.path.join(work, 'index.html')
    _write(p, _read(p).replace(
        '</body>', '<button onclick="localStorage.setItem(\'zz.handler\', \'1\')">x</button>\n</body>', 1))


def _before_body(work, html):
    p = os.path.join(work, 'index.html')
    _write(p, _read(p).replace('</body>', html + '\n</body>', 1))


def _postfix_division(work):
    _append_stats(work, 'let zzN=2; const zzR=zzN++ / localStorage.getItem("zz.postfix-division");')


def _template_brace(work):
    _append_stats(work, 'const zzT = `${"}" + localStorage.getItem("zz.template-string-brace")}`;')


def _entity_handler(work):
    _before_body(work, '<button onclick=localStorage.setItem(&quot;zz.handler-unquoted&quot;,&quot;1&quot;)>x</button>')


def _regex_return(work):
    _append_stats(work, 'function zzRe(){ return /localStorage.setItem("zz.regex-return", "1")/; }')


def _data_attr(work):
    _before_body(work, '<div data-onclick="localStorage.setItem(\'zz.data-attribute\',\'1\')">x</div>')


def _commented_script(work):
    _before_body(work, '<!-- <script>localStorage.setItem("zz.commented-script","1");</script> -->')


def _plain_script(work):
    _before_body(work, '<script type="text/plain">localStorage.setItem("zz.plain-script","1");</script>')


def _src_script(work):
    _before_body(work, '<script src="/js/hp-stats.js">localStorage.setItem("zz.src-script","1");</script>')


def _ambiguous_slash(work):
    _append_stats(work, 'const zzA = Math.max(1,2) / localStorage.getItem("zz.ambiguous");')


def _unterminated_comment(work):
    _append_stats(work, '/* 열고 닫지 않는다\nlocalStorage.setItem("zz.after-unterminated", "1");')


def _call_shaped_in_tag(work):
    """태그 안(속성값이 아닌 자리)의 호출 모양 텍스트 — 우리 토크나이저가 뜻을 단정할 수 없는 자리다."""
    _before_body(work, '<div localStorage.setItem("zz.in-tag","1")>x</div>')


def _open_html_comment(work):
    _before_body(work, '<!-- 닫지 않는 주석\n<script>localStorage.setItem("zz.after-open-comment","1");</script>')


def _bracket_call(work):
    _append_stats(work, 'localStorage["setItem"]("zz.bracket", "1");')


def _comment_gap_call(work):
    _append_stats(work, 'localStorage/* 사이 주석 */.setItem("zz.comment-gap", "1");')


def _optional_chain_call(work):
    _append_stats(work, 'localStorage?.setItem("zz.optional", "1");')


def _alias_object(work):
    """저장소 객체를 별칭에 담아 간다 — 뒤를 따라갈 수 없으니 멈춰야 한다."""
    _append_stats(work, 'const zzLS = localStorage; zzLS.setItem("zz.alias", "1");')


def _reflect_apply(work):
    _append_stats(work, 'Reflect.apply(localStorage.setItem, localStorage, ["zz.reflect", "1"]);')


def _escaped_identifier(work):
    _append_stats(work, 'local' + chr(92) + 'u0053torage.setItem("zz.unicode", "1");')


def _eval_string(work):
    _append_stats(work, 'eval(' + chr(39) + 'localStorage.setItem("zz.eval", "1")' + chr(39) + ');')


def _entity_paren_handler(work):
    _before_body(work, '<button onclick=localStorage.setItem&lpar;&quot;zz.entity-lpar&quot;,'
                       '&quot;1&quot;&rpar;>x</button>')


def _unknown_entity_handler(work):
    """풀 수 없는 엔티티가 남은 핸들러 — 무슨 코드인지 단정할 수 없으니 멈춰야 한다."""
    _before_body(work, '<button onclick="localStorage.setItem(&zzunknown;)">x</button>')


def _empty_type_script(work):
    _before_body(work, '<script type="">localStorage.setItem("zz.empty-type","1");</script>')


def _mime_param_script(work):
    _before_body(work, '<script type="text/javascript; charset=utf-8">'
                       'localStorage.setItem("zz.mime-param","1");</script>')


def _hide_list(work):
    p = os.path.join(work, 'privacy', 'index.html')
    s = _read(p)
    _write(p, s.replace('(localStorage)</h3>', '(localStorage-치워둠)</h3>', 1))


CASES = [
    ('대조군 · 주입 없음',            lambda d: None,        0, []),
    ('홑따옴표 미등재 키',            _inject_single,        1, ['missing-exact']),
    ('큰따옴표 미등재 키',            _inject_double,        1, ['missing-exact']),
    ('백틱 미등재 키',                _inject_backtick,      1, ['missing-exact']),
    ('tools/ 전용 키(비제품)',        _tools_only_key,       0, []),
    ('방침 ko 항목 1개 제거',         lambda d: _drop_entry(d, 'ko'), 1, ['missing-exact', 'lang-mismatch']),
    ('방침 en 항목 1개 제거',         lambda d: _drop_entry(d, 'en'), 1, ['missing-exact', 'lang-mismatch']),
    ('방침에 유령 항목 추가',         _add_stale,            1, ['stale-entry']),
    ('접두 패턴 항목 제거',           _drop_prefix_entry,    1, ['missing-prefix']),
    ('닫히지 않은 자리표',            _unclosed_placeholder, 1, ['bad-placeholder']),
    ('자리표 뒤 군더더기',            _trailing_garbage,     1, ['bad-placeholder']),
    ('해석 불가 storage 호출',        _inject_unresolved,    2, ['unresolved-call']),
    ('방침 목록 소제목 소실',         _hide_list,            2, ['no-list']),
    ('허구 접두로 정확 키 대체',       _fake_prefix,          1, ['missing-exact', 'stale-entry']),
    ('줄 주석 속 호출 예시',          _comment_call,         0, []),
    ('블록 주석 속 호출 예시',        _block_comment_call,   0, []),
    ('문자열 속 호출 예시',           _string_call,          0, []),
    ('HTML 본문 속 호출 예시',        _prose_call,           0, []),
    ('핸들러 속성 속 실호출',         _handler_call,         1, ['missing-exact']),
    # ── R4 · 실행되는데 놓치기 쉬운 자리(놓치면 거짓 통과) ──
    ('후위증가 뒤 나눗셈 실호출',      _postfix_division,     1, ['missing-exact']),
    ('템플릿 치환 속 문자열 }',       _template_brace,       1, ['missing-exact']),
    ('따옴표 없는 엔티티 핸들러',      _entity_handler,       1, ['missing-exact']),
    # ── R4 · 실행되지 않는 자리(세면 거짓 미달) ──
    ('return 뒤 정규식 리터럴',       _regex_return,         0, []),
    ('data-onclick 속성',           _data_attr,            0, []),
    ('주석 처리된 script',           _commented_script,     0, []),
    ('type=text/plain script',     _plain_script,         0, []),
    ('src 있는 script 의 본문',      _src_script,           0, []),
    # ── R4 · fail-closed · 확신할 수 없으면 멈춘다(이 셋이 이 설계의 심장이다) ──
    ('모호한 / 뒤의 실호출',          _ambiguous_slash,      2, ['uncertain-code']),
    ('안 닫힌 블록 주석 뒤 실호출',    _unterminated_comment, 2, ['uncertain-code']),
    ('안 닫힌 HTML 주석 뒤 실호출',   _open_html_comment,    2, ['uncertain-code']),
    ('태그 안 호출 모양 텍스트',       _call_shaped_in_tag,   2, ['uncertain-code']),
    # ── R5 · 후보 수집까지 fail-closed(다른 표기의 실행 호출을 보기라도 한다) ──
    ('대괄호 메서드 호출',            _bracket_call,         1, ['missing-exact']),
    ('객체와 점 사이 주석',           _comment_gap_call,     1, ['missing-exact']),
    ('옵셔널 체이닝 호출',            _optional_chain_call,  1, ['missing-exact']),
    ('빈 type script',             _empty_type_script,    1, ['missing-exact']),
    ('MIME 매개변수 script',        _mime_param_script,    1, ['missing-exact']),
    ('엔티티 괄호 핸들러',            _entity_paren_handler, 1, ['missing-exact']),
    # ── R5 · 따라갈 수 없으면 멈춘다 ──
    ('별칭 객체 경유',               _alias_object,         2, ['uncertain-code']),
    ('Reflect.apply 로 넘김',       _reflect_apply,        2, ['uncertain-code']),
    ('유니코드 이스케이프 식별자',      _escaped_identifier,   2, ['uncertain-code']),
    ('eval 로 만든 코드',            _eval_string,          2, ['uncertain-code']),
    ('풀 수 없는 엔티티 핸들러',       _unknown_entity_handler, 2, ['uncertain-code']),
]


def selftest():
    stage = tempfile.mkdtemp(prefix='privstore-')
    rows, bad = [], 0
    try:
        for name, mutate, want_rc, want_rules in CASES:
            work = os.path.join(stage, re.sub(r'\W+', '_', name))
            shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('.git', 'node_modules', '_*'))
            if mutate:
                mutate(work)
            r = subprocess.run([sys.executable, os.path.abspath(__file__), work],
                               capture_output=True, text=True, encoding='utf-8')
            seen = set(re.findall(r'[✗‽]\s*\[([a-z-]+)\]', r.stdout or ''))
            miss = [x for x in want_rules if x not in seen]
            noise = seen if not want_rules else set()
            ok = (r.returncode == want_rc) and not miss and not noise
            bad += 0 if ok else 1
            rows.append((name, want_rc, r.returncode, want_rules, sorted(seen), miss, sorted(noise), ok))
    finally:
        shutil.rmtree(stage, ignore_errors=True)

    print('# 검출력 자기시험 — 케이스마다 "어느 검사가 잡아야 하는가"를 못박고 그 귀속까지 대조한다')
    for name, want_rc, rc, want, seen, miss, noise, ok in rows:
        print('  %s %-24s 기대rc=%d 실제rc=%d · 잡아야 할 규칙 %s · 실제 %s%s%s'
              % ('PASS' if ok else '★FAIL', name, want_rc, rc,
                 want or '없음', seen or '없음',
                 ('  ← 안 잡힌 규칙 %s' % miss) if miss else '',
                 ('  ← 나오면 안 되는 지적 %s' % noise) if noise else ''))
    print('자기시험 결과: rc=%d (항목 %d · 어긋남 %d)' % (1 if bad else 0, len(rows), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else run(ROOT))
