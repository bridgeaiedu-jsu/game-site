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

★허용 목록을 이 파일 안에 상수로 두지 않는다 — 목록은 방침(privacy/index.html)이, 사실은 제품 코드가
말한다. 이 스크립트는 둘을 읽어 **대조만** 한다. 어느 쪽이 맞는지 판단하지 않는다: 어긋나면 미달이다.

제품의 경계(무엇을 제품으로 보는가)
  · 브라우저에 실려 실행되는 .html/.js 만 제품이다.
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


def product_keys(root):
    """(exact, prefix, unresolved, 스캔파일수) — exact/prefix 는 store → {값: {나온 파일}}."""
    exact = {'localStorage': {}, 'sessionStorage': {}}
    prefix = {'localStorage': {}, 'sessionStorage': {}}
    unresolved = []
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
            consts = {m.group(1): m.group(3) for m in CONST_DEF.finditer(src)}
            for m in CALL_HEAD.finditer(src):
                store = m.group(1)
                expr, _end = first_arg(src, m.end())
                kind, val = classify_arg(expr, consts)
                if kind == 'unresolved':
                    line = src.count('\n', 0, m.start()) + 1
                    unresolved.append('%s:%d — %s.…Item(%s'
                                      % (rel, line, store, (val or '?').strip()[:60]))
                else:
                    (prefix if kind == 'prefix' else exact)[store].setdefault(val, set()).add(rel)
    return exact, prefix, unresolved, scanned


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

    exact, prefix, unresolved, scanned = product_keys(root)
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
                if k in ok_exact or any(k.startswith(p) for p in ok_prefix):
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
                elif kind == 'prefix' and val not in pref and not any(k.startswith(val) for k in used):
                    fails.append('[stale-entry] %s 목록(%s)에 제품이 쓰지 않는 접두 패턴이 남아 있다: %s'
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
