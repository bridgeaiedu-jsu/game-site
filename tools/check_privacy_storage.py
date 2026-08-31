# -*- coding: utf-8 -*-
"""개인정보처리방침의 저장 항목 목록 ↔ 제품이 실제로 쓰는 브라우저 저장소 키 정적 대조.

왜 필요한가 — 방침은 "현재 저장되는 항목은 다음이 전부입니다 / The complete list is" 라고 **닫아 놓은
목록**이다. 게임이 하나 늘 때마다 키가 늘어나는데 목록을 같이 고치지 않으면 그 문장은 그 순간 거짓이 된다
(2026-08-31 실측: 제품 61키 · 방침 19키 · 누락 42키). 사람 눈으로는 매번 놓친다 — 기계가 잡게 한다.

무엇을 보는가
  ① 제품이 localStorage 에 쓰는 키가 방침의 localStorage 목록에 **ko·en 양쪽 다** 있는가
  ② 제품이 sessionStorage 에 쓰는 키가 방침의 sessionStorage 목록에 **ko·en 양쪽 다** 있는가
  ③ 방침에만 있고 제품에는 없는 항목(썩은 항목)이 있는가
  ④ ko 목록과 en 목록의 항목 집합이 같은가(한쪽 언어 사용자에게만 거짓말이 되는 것을 막는다)

★허용 목록을 이 파일 안에 상수로 두지 않는다 — 목록은 방침(privacy/index.html)이, 사실은 제품 코드가
말한다. 이 스크립트는 둘을 읽어 **대조만** 한다. 어느 쪽이 맞는지 판단하지 않는다: 어긋나면 미달이다.

키를 찾는 방법(제품 쪽)
  · 리터럴 인자           localStorage.setItem('bp.best', …)
  · 상수 경유             const STORE_KEY = 'ld.p';  … sessionStorage.setItem(STORE_KEY, …)
  · 접두 이어붙이기       localStorage.setItem('ms.best.' + level, …)  → 접두 'ms.best.' 로 기록
접두는 방침에 개별 키가 아니라 **접두 패턴**으로 적혀야 한다 — `ms.best.<난이도>` 처럼 꺾쇠 자리표를 쓴다.
방침 항목의 꺾쇠 앞부분이 접두이고, 그 접두로 시작하는 제품 키는 그 항목이 덮는 것으로 본다.

사용법: python3 tools/check_privacy_storage.py [저장소 루트] [--selftest]
종료코드: 0 = 미달 0 · 1 = 미달 발견 · 2 = 판정 불가(파일·목록 구조를 읽지 못함)
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

SKIP_DIRS = {'.git', 'node_modules'}
LITERAL = re.compile(r"(localStorage|sessionStorage)\.(?:set|get|remove)Item\(\s*'([^']*)'\s*(\+?)")
VIA_CONST = re.compile(r"(localStorage|sessionStorage)\.(?:set|get|remove)Item\(\s*([A-Za-z_$][\w$]*)")
CONST_DEF = re.compile(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'\s*;")


def product_keys(root):
    """(store → {키: {나온 파일}}, store → {접두: {나온 파일}}) 을 돌려준다."""
    exact = {'localStorage': {}, 'sessionStorage': {}}
    prefix = {'localStorage': {}, 'sessionStorage': {}}
    for d, subs, fs in os.walk(root):
        subs[:] = [s for s in subs if s not in SKIP_DIRS and not s.startswith('_')]
        for f in fs:
            if not (f.endswith('.html') or f.endswith('.js')):
                continue
            p = os.path.join(d, f)
            if os.path.normpath(p) == os.path.normpath(POLICY):
                continue
            try:
                src = io.open(p, encoding='utf-8', newline='').read()
            except Exception:
                continue
            rel = os.path.relpath(p, root).replace('\\', '/')
            consts = {m.group(1): m.group(2) for m in CONST_DEF.finditer(src)}
            for m in LITERAL.finditer(src):
                store, key, plus = m.group(1), m.group(2), m.group(3)
                bucket = prefix if plus == '+' else exact
                bucket[store].setdefault(key, set()).add(rel)
            for m in VIA_CONST.finditer(src):
                store, name = m.group(1), m.group(2)
                if name in consts:
                    exact[store].setdefault(consts[name], set()).add(rel)
    return exact, prefix


def policy_sections(src):
    """방침에서 (언어, 저장소) → [항목 코드] 를 뽑는다.
       ko 절과 en 절은 id="en" 을 경계로 가르고, 각 절 안에서 localStorage/sessionStorage
       소제목(h3) 다음의 <ul> 하나를 그 저장소의 목록으로 읽는다."""
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


def covers(entry, key):
    """방침 항목이 제품 키를 덮는가 — 꺾쇠 자리표가 있으면 접두 매칭."""
    e = unescape(entry)
    if '<' in e:
        return key.startswith(e.split('<', 1)[0])
    return e == key


def identity(entry):
    """ko·en 대조용 신원 — 자리표 이름은 언어마다 다르므로(난이도/difficulty) 접두만 남긴다."""
    e = unescape(entry)
    return e.split('<', 1)[0] + '<…>' if '<' in e else e


def prefix_of(entry):
    e = unescape(entry)
    return e.split('<', 1)[0] if '<' in e else None


def run(root):
    if not os.path.exists(POLICY):
        print('판정 불가 — privacy/index.html 없음'); return 2
    src = io.open(POLICY, encoding='utf-8', newline='').read()
    lists, err = policy_sections(src)
    if err:
        print('판정 불가 — %s' % err); return 2
    exact, prefix = product_keys(root)

    fails, notes = [], []
    for store in ('localStorage', 'sessionStorage'):
        used = sorted(exact[store])
        pref = sorted(prefix[store])
        for lang in ('ko', 'en'):
            entries = lists.get((lang, store))
            if entries is None:
                fails.append('%s 절에 %s 목록(<h3>…(%s)</h3> 다음 <ul>)이 없다' % (lang, store, store))
                continue
            for k in used:
                if not any(covers(e, k) for e in entries):
                    fails.append('%s 목록(%s)에 제품 사용 키가 빠졌다: %s  (%s)'
                                 % (store, lang, k, ', '.join(sorted(exact[store][k]))))
            for pk in pref:
                if not any(prefix_of(e) == pk for e in entries):
                    fails.append('%s 목록(%s)에 접두 패턴이 없다: %s<…>  (%s)'
                                 % (store, lang, pk, ', '.join(sorted(prefix[store][pk]))))
            for e in entries:
                if any(covers(e, k) for k in used) or any(prefix_of(e) == pk for pk in pref):
                    continue
                fails.append('%s 목록(%s)에 제품이 쓰지 않는 항목이 남아 있다: %s' % (store, lang, e))
        ko, en = lists.get(('ko', store)), lists.get(('en', store))
        if ko is not None and en is not None and set(map(identity, ko)) != set(map(identity, en)):
            kset, eset = set(map(identity, ko)), set(map(identity, en))
            only_ko, only_en = sorted(kset - eset), sorted(eset - kset)
            fails.append('%s 목록의 ko·en 항목 집합이 다르다 — ko 에만 %s · en 에만 %s'
                         % (store, only_ko or '없음', only_en or '없음'))
        notes.append('%s — 제품 %d키 + 접두 %d종 · 방침 ko %s항목 · en %s항목'
                     % (store, len(used), len(pref),
                        'X' if lists.get(('ko', store)) is None else len(lists[('ko', store)]),
                        'X' if lists.get(('en', store)) is None else len(lists[('en', store)])))

    print('저장 항목 대조 — 대상 %s' % root.replace('\\', '/'))
    for n in notes:
        print('  · ' + n)
    for f in fails:
        print('  ✗ ' + f)
    print('결과: rc=%d (미달 %d건)' % (1 if fails else 0, len(fails)))
    return 1 if fails else 0


def selftest():
    """검출력 자기시험 — 고장 입력 3종을 사본에 심어 rc=1 이 나오는지 본다(원본은 읽기만)."""
    stage = tempfile.mkdtemp(prefix='privstore-')
    cases, bad = [], 0
    try:
        for name, mutate in (
            ('제품에 새 키 추가(방침 미등재)', lambda d: _inject_key(d)),
            ('방침 ko 목록에서 한 항목 제거', lambda d: _drop_entry(d, 'ko')),
            ('방침 en 목록에서 한 항목 제거', lambda d: _drop_entry(d, 'en')),
        ):
            work = os.path.join(stage, re.sub(r'\W+', '_', name))
            shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('.git', 'node_modules', '_*'))
            mutate(work)
            r = subprocess.run([sys.executable, os.path.abspath(__file__), work],
                               capture_output=True, text=True, encoding='utf-8')
            hit = [l.strip() for l in (r.stdout or '').splitlines() if l.strip().startswith('✗')]
            ok = r.returncode == 1 and bool(hit)
            bad += 0 if ok else 1
            cases.append((name, r.returncode, hit[:1], ok))
        r0 = subprocess.run([sys.executable, os.path.abspath(__file__), ROOT],
                            capture_output=True, text=True, encoding='utf-8')
        cases.append(('대조군 · 원본 트리(주입 없음)', r0.returncode, [], r0.returncode == 0))
        bad += 0 if r0.returncode == 0 else 1
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    print('# 검출력 자기시험 — 고장 입력을 넣으면 이 검사가 미달을 말해야 한다')
    for name, rc, hit, ok in cases:
        print('  %s %-34s rc=%d %s' % ('PASS' if ok else '★FAIL', name, rc, hit[0] if hit else ''))
    print('자기시험 결과: rc=%d (항목 %d · 어긋남 %d)' % (1 if bad else 0, len(cases), bad))
    return 1 if bad else 0


def _inject_key(work):
    p = os.path.join(work, 'js', 'hp-stats.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    io.open(p, 'w', encoding='utf-8', newline='').write(
        s + "\ntry { localStorage.setItem('zz.selftest', '1'); } catch (e) {}\n")


def _drop_entry(work, lang):
    p = os.path.join(work, 'privacy', 'index.html')
    s = io.open(p, encoding='utf-8', newline='').read()
    half = s.find('id="en"')
    head, tail = (s[:half], s[half:]) if lang == 'ko' else (s[half:], s[:half])
    m = re.search(r'\s*<li><code>[^<]+</code>[^\n]*\n', head)
    if not m:
        return
    head = head[:m.start()] + head[m.end():]
    s = head + tail if lang == 'ko' else tail + head
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else run(ROOT))
