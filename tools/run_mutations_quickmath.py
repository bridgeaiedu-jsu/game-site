#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_mutations_quickmath.py — verify_quickmath.js(「빠른 셈」)의 검출력 검산.

무엇을 하나: `tools/verify_quickmath.js --list-mutations` 로 뮤테이션 ★분모를 기계로 뽑고,
하나씩 주입해 돌린 뒤 ★지목한 검사가 실제로 잡았는지를 표로 낸다.

★왜 따로 있나: 검사기가 초록이라는 것은 "검사가 살아 있다" 를 뜻하지 않는다. 잡아야 할 것을
주입했을 때 ★그 검사가 붉어지는지를 보여야 초록에 뜻이 생긴다. 그리고 여기서 세는 단위는
'붉었다' 가 아니라 ★(검사, 대상) 짝이다 — 아무 검사나 붉어진 것으로 검출을 인정하면
그 뮤테이션이 겨냥한 계약은 여전히 무방비다.

★주입 실패는 통과가 아니다. verify_quickmath.js 는 셋을 가른다:
    rc=0  지목한 검사가 잡았다
    rc=2  검사를 세울 수 없었다(앵커 노후화·문법 파손 등) — ★판정 불가
    rc=3  주입은 됐는데 지목한 검사가 ★못 잡았다(검사가 공허하다)
이 스크립트는 셋을 각각 세고, 2 와 3 을 ★한 칸에 섞지 않는다.

종료코드: 0 = 겨냥은 전부 잡혔고 대조군은 전부 조용했다
          · 1 = ★공허(겨냥인데 못 잡았다) 또는 ★거짓 실패(대조군이 붉다)가 있다
          · 2 = 판정 불가가 하나라도 있다(rc=2) 또는 하네스를 세울 수 없다
"""
import argparse
import atexit
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(ROOT, 'tools', 'verify_quickmath.js')
LOCKED = os.path.join(ROOT, 'tools', 'quickmath_locked_contracts.json')
EXPECT = os.path.join(ROOT, 'tools', 'quickmath_mutation_expectations.json')


def run(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')


REV = None            # ★--from-commit 으로 고정한 리비전(지문·검사기·정본이 모두 이 값을 본다)
REV_FILES = {}        # 그 리비전에서 꺼내 둔 사본 → ★저장소 상대경로(지문이 정본 자리를 말하게)


def fingerprint(path):
    """★지문은 ★기준을 낱말로 달고 다닌다 — 값만 적으면 남의 재현과 어긋난다.

    작업트리 sha256 은 체크아웃 줄끝(CRLF/LF)을 타서 같은 커밋에서도 사람마다 다르다.
    그래서 ★셋을 함께 찍는다: 작업트리 바이트 · ★커밋된 바이트 · git 객체 id.
    뒤의 둘은 줄끝 변환과 무관해서 ★재현에 쓸 값이고, 앞의 하나는 ★지금 돌린 바이트다.
    (2026-09-06 R2: 같은 증거 폴더에서 한 파일은 작업트리 값, 다른 파일은 블롭 값을 써서
     같은 대상이 두 값으로 적혔다 — 기준을 안 적었기 때문이다.)
    """
    try:
        wt = hashlib.sha256(io.open(path, 'rb').read()).hexdigest()[:16]
    except OSError as e:
        return {'wt': '읽지 못함(%s)' % e, 'blob_sha256': '-', 'oid': '-'}
    rel = REV_FILES.get(os.path.abspath(path)) or os.path.relpath(path, ROOT).replace(os.sep, '/')
    # ★기준 리비전은 ★대상과 같은 것이어야 한다(2026-09-07 R3 D1).
    #   앞서는 대상만 --from-commit 으로 고정하고 지문은 HEAD 에서 뽑았다. HEAD 가 앞서
    #   나간 날 그 줄은 ★다른 리비전의 바이트를 '재현에 쓸 값' 으로 적는다 — 오늘 안 터진 것은
    #   HEAD == 대상이라 가려졌을 뿐이다.
    ref = (REV or 'HEAD') + ':' + rel
    oid = run(['git', 'rev-parse', ref])
    blob = subprocess.run(['git', 'cat-file', 'blob', ref],
                          cwd=ROOT, capture_output=True)
    return {
        'wt': wt,
        'blob_sha256': (hashlib.sha256(blob.stdout).hexdigest()[:16]
                        if blob.returncode == 0 else '커밋에 없다'),
        'oid': (oid.stdout or '').strip()[:16] if oid.returncode == 0 else '커밋에 없다',
        'ref': ref,
    }


def fingerprint_line(label, path, fp):
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    return chr(10).join([
        label,
        '    sha256(★작업트리 파일)   = %s   ← 지금 돌린 바이트(줄끝 변환을 탄다)' % fp['wt'],
        '    sha256(★커밋된 바이트)   = %s   ← ★재현에 쓸 값' % fp['blob_sha256'],
        '    git 객체 id (%s) = %s' % (fp.get('ref', 'HEAD:' + rel), fp['oid']),
    ])

def source_denominators():
    """★검사 분모와 겨냥 분모를 ★소스에서 뽑는다(손으로 적은 목록은 게이트가 못 된다).

    러너가 뮤테이션 분모만 보면, 겨냥 뮤테이션이 없는 검사가 늘어도 표는 계속 초록이다.
    그래서 여기서 ★차집합(미겨냥 검사)을 함께 찍는다 — 미측정을 숨기지 않고 세어서 보인다.
    """
    try:
        src = io.open(VERIFY, encoding='utf-8').read()
    except OSError as e:
        return None, None, None, '검사기를 읽지 못했다: %s' % e
    checks = re.findall(r"check\(\s*'([^']+)'", src)
    targets = set(re.findall(r"target:\s*'([^']+)'", src))
    digest = fingerprint(VERIFY)
    return checks, targets, digest, None


def locked_items():
    """잠근 항 정본을 ★검사기 밖 파일에서 읽는다.

    검사기 안에 두면 검사기가 자기 자신을 채점하게 되고, ★항을 지우는 것과 검사를 지우는 것이
    한 손에서 일어난다. 밖에 두면 둘이 갈라지고, 갈라진 것을 러너가 ★양방향으로 대조한다.
    """
    try:
        with io.open(LOCKED, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return None, None, None, '잠근 항 정본을 읽지 못했다(%s): %s' % (LOCKED, e)
    items = data.get('items')
    if not isinstance(items, list) or not items:
        return None, None, None, '잠근 항 정본에 items 가 없다 — 대조할 것이 없다'
    aux_raw = data.get('auxiliary')
    if not isinstance(aux_raw, list):
        return None, None, None, ('잠근 항 정본에 auxiliary 선언이 없다 — 보조 검사를 ★명시하지 않으면 '
                                  '주인 없는 검사와 구별할 수 없다')
    # ★보조는 {name, why} 다 — 이름만 적히면 진짜 계약을 ★조용히 보조로 강등할 수 있다.
    #   옮겨 담는 행위가 ★사유를 남기게 만든다(2026-09-06 R2).
    aux = []
    for a in aux_raw:
        if not isinstance(a, dict) or not a.get('name') or not a.get('why'):
            return None, None, None, ('auxiliary 항목은 {name, why} 여야 한다 — 사유 없는 강등을 막는다: %r' % (a,))
        aux.append(a)
    digest = fingerprint(LOCKED)
    return items, aux, digest, None


def expectations():
    """뮤테이션 ★기대표 정본을 읽는다 — 검사기 안이 아니라 밖에서.

    ★없거나 못 읽으면 rc=2 다(통과로 세지 않는다). 이 파일이 '어느 뮤테이션을 어느 검사가
    잡아야 하는가' 를 정하고, 러너는 그것과 실제 검사 목록을 ★양방향으로 대조한다.
    """
    path_ = EXPECT
    try:
        with io.open(path_, encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return None, '기대표 정본을 못 읽었다(%s): %s' % (path_, e)
    if not isinstance(data.get('mutations'), dict) or not data['mutations']:
        return None, '기대표 정본에 mutations 가 없다'
    if 'requires_targeted' not in data:
        return None, '기대표 정본에 requires_targeted 가 없다 — 미겨냥을 어떻게 셀지 정해지지 않았다'
    # ★면제도 {name, why} 다 — 형제 auxiliary 와 같은 규율이다(2026-09-07 R2 reviewer-claude-1).
    #   이름만 적히면 잠근 항의 ★검출 증명을 한 줄로 면제하고도 정본에 ★사유가 남지 않는다.
    #   면제는 흔적을 남긴다(_exempt_why) — 그 문장을 ★코드가 참으로 만든다.
    ex_raw = data.get('exempt_from_targeting')
    if not isinstance(ex_raw, list):
        return None, ('기대표 정본에 exempt_from_targeting 이 배열로 없다 — 면제를 '
                      '★명시하지 않으면 미겨냥과 구별할 수 없다')
    for e in ex_raw:
        if not isinstance(e, dict) or not e.get('name') or not e.get('why'):
            return None, ('exempt_from_targeting 항목은 {name, why} 여야 한다 — '
                          '사유 없는 면제를 막는다: %r' % (e,))
    return data, None


TARGET_ARGS = []          # ★검사기에 넘길 '무엇을 재는가' 인자(--html 또는 --from-commit)


def materialize_from_rev(rev, want):
    """★검사기·정본도 그 리비전에서 꺼낸다(2026-09-07 R3 D2).

    앞서는 --from-commit 이 ★대상 HTML 만 고정했다. 검사기와 정본은 워킹트리에서 읽혀서,
    '커밋본으로 쟀다' 는 말이 ★절반만 참이었다(오늘 일치한 것은 트리가 clean 이라서다).
    사본은 저장소 ★밖에 두고, 검사기에는 --repo 로 정본 자리를 알려 준다 — 사본이 제 위치를
    기준으로 경로를 풀면 남의 폴더를 본다.
    꺼내지 못하면 ★판정 불가다(워킹트리로 조용히 물러나지 않는다).
    """
    stage = tempfile.mkdtemp(prefix='qm-rev-')
    atexit.register(shutil.rmtree, stage, True)
    out = {}
    for key, rel in want.items():
        r = subprocess.run(['git', 'show', '%s:%s' % (rev, rel)], cwd=ROOT, capture_output=True)
        if r.returncode != 0:
            return None, '리비전에서 %s 를 꺼내지 못했다: git show %s:%s — %s' % (
                rel, rev, rel, (r.stderr or b'').decode('utf-8', 'replace').strip()[:200])
        dst = os.path.join(stage, os.path.basename(rel))
        with io.open(dst, 'wb') as f:
            f.write(r.stdout)
        REV_FILES[os.path.abspath(dst)] = rel
        out[key] = dst
    return out, None


def payload_gate(exp, names):
    """★뮤테이션 payload(앵커+대체문) 지문을 정본과 대조한다(2026-09-07 R3 F2).

    정본이 이름·짝짓기만 보면, 검사 본문과 그 검사를 겨냥한 뮤테이션을 ★한 손으로 함께
    무르게 만들었을 때 ★정본 바이트가 하나도 안 바뀐 채 초록이 난다(리뷰어 실측).
    지문이 갈리거나 정본에 없으면 ★판정 불가다 — 통과로 세지 않는다.
    """
    pr = run(['node', VERIFY, '--repo', ROOT, '--payload-hashes'])
    if pr.returncode != 0:
        return 'payload 지문을 못 얻었다(rc=%d): %s' % (pr.returncode, (pr.stderr or '').strip()[:300])
    got = {}
    for ln in (pr.stdout or '').splitlines():
        if '\t' in ln:
            k, v = ln.split('\t', 1)
            got[k.strip()] = v.strip()
    missing = [n for n in names if not (exp['mutations'].get(n) or {}).get('payload_sha256')]
    if missing:
        return ('정본에 payload_sha256 이 없는 뮤테이션 %d종: %s — '
                '`node tools/verify_quickmath.js --payload-hashes` 로 채워라' % (len(missing), ', '.join(missing)))
    nogot = [n for n in names if n not in got]
    if nogot:
        return '검사기가 payload 지문을 안 준 뮤테이션: %s' % ', '.join(nogot)
    bad = [n for n in names if got[n] != exp['mutations'][n]['payload_sha256']]
    if bad:
        lines = ['payload 지문이 정본과 갈렸다 %d종(검사와 뮤테이션을 ★한 손으로 무르게 만든 자리다):' % len(bad)]
        for n in bad:
            lines.append('    %s  정본 %s… ≠ 검사기 %s…'
                         % (n, exp['mutations'][n]['payload_sha256'][:16], got[n][:16]))
        return chr(10).join(lines)
    print('payload 지문 대조 %d/%d 일치 — 검사와 그 겨냥 뮤테이션을 함께 무르게 하면 여기서 갈린다'
          % (len(names), len(names)))
    return None


def list_mutations():
    p = run(['node', VERIFY, '--list-mutations'])
    if p.returncode != 0:
        return None, '뮤테이션 목록을 못 얻었다(rc=%d): %s' % (p.returncode, (p.stderr or '').strip()[:400])
    # ★탭으로 가른다 — 공백 분해는 이름이 칸 너비를 넘는 순간 다음 칸을 함께 집는다
    names = [ln.split('	')[0].strip() for ln in (p.stdout or '').splitlines() if ln.strip()]
    return names, None


def main():
    global VERIFY, LOCKED, EXPECT, TARGET_ARGS, REV
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=os.path.join(ROOT, 'quick-math', 'index.html'))
    ap.add_argument('--only', help='이 뮤테이션 하나만 돌린다')
    ap.add_argument('--locked', help='잠근 항 정본 경로(★자를 고정할 때 정본도 함께 고정한다 — '
                                     '검사기만 고정하면 정본은 현재 나무 것을 읽어 두 시점이 섞인다)')
    ap.add_argument('--verify', help='검사기 경로(★리비전을 고정해 재고 싶을 때 사본을 가리킨다)')
    ap.add_argument('--expectations', help='기대표 정본 경로(정본 3종을 함께 고정할 때)')
    ap.add_argument('--from-commit', dest='from_commit',
                    help='★대상을 ★커밋본 바이트로 고정한다(git show <rev>:<경로>). '
                         '워킹트리는 체크아웃 줄끝을 타므로 ★"내 트리에서 통과" 는 계약의 증거가 아니다 '
                         '(2026-09-07 R2: CRLF 앵커가 LF 커밋본에서 3건 주입 실패했다).')
    a = ap.parse_args()
    if a.verify:
        VERIFY = os.path.abspath(a.verify)
    if a.locked:
        LOCKED = os.path.abspath(a.locked)
    if a.expectations:
        EXPECT = os.path.abspath(a.expectations)
    # ★무엇을 재는가를 ★맨 먼저 못박는다 — 이 줄이 없으면 아래 모든 수치가 '어느 바이트에서
    #   나왔는가' 를 잃는다. 검사기도 자기 첫 줄에 같은 사실을 적는다(두 층이 같은 말을 한다).
    if a.from_commit:
        REV = a.from_commit
        TARGET_ARGS = ['--from-commit', a.from_commit]
        print('잰 대상 = ★커밋본 바이트  git show %s:quick-math/index.html' % a.from_commit)
        # ★대상만 고정하면 절반이다 — ★재는 도구(검사기)와 ★자(정본)도 같은 리비전에서 꺼낸다.
        want = {}
        if not a.verify:
            want['verify'] = 'tools/verify_quickmath.js'
        if not a.locked:
            want['locked'] = 'tools/quickmath_locked_contracts.json'
        if not a.expectations:
            want['expect'] = 'tools/quickmath_mutation_expectations.json'
        if want:
            got, err = materialize_from_rev(a.from_commit, want)
            if err:
                print('판정 불가 — ' + err)
                return 2
            if 'verify' in got:
                VERIFY = got['verify']
            if 'locked' in got:
                LOCKED = got['locked']
            if 'expect' in got:
                EXPECT = got['expect']
            TARGET_ARGS = TARGET_ARGS + ['--repo', ROOT]
            print('  ★검사기·정본도 같은 리비전에서 꺼냈다: %s (사본은 저장소 밖 · --repo 로 정본 자리를 알려 준다)'
                  % ', '.join(sorted(want.values())))
        for k, flag in (('verify', '--verify'), ('locked', '--locked'), ('expect', '--expectations')):
            if (k == 'verify' and a.verify) or (k == 'locked' and a.locked) or (k == 'expect' and a.expectations):
                print('  · %s 는 ★사용자가 준 경로를 쓴다(리비전에서 꺼내지 않았다)' % flag)
    else:
        TARGET_ARGS = ['--html', a.html]
        print('잰 대상 = 작업트리 %s  (★체크아웃 줄끝을 탄다 — 계약의 증거는 커밋본이다: --from-commit <해시>)'
              % os.path.relpath(a.html, ROOT).replace(os.sep, '/'))
    probe = run(['node', VERIFY] + TARGET_ARGS + ['--only', '__none__'])
    for ln in (probe.stdout or '').splitlines():
        if ln.startswith('※ 잰 바이트 = '):
            print('  ' + ln)       # ★검사기가 직접 잰 바이트 지문을 그대로 옮긴다

    names, err = list_mutations()
    if names is None:
        print('판정 불가 — ' + err)
        return 2
    if a.only:
        if a.only not in names:
            print('판정 불가 — 모르는 뮤테이션: %s' % a.only)
            return 2
        names = [a.only]

    checks, targets, vhash, cerr = source_denominators()
    if cerr:
        print('판정 불가 — ' + cerr)
        return 2
    exp, eerr = expectations()
    if eerr:
        print('판정 불가 — ' + eerr)
        return 2
    exempt_why = {e['name']: e['why'] for e in (exp.get('exempt_from_targeting') or [])}
    exempt = set(exempt_why)
    # ★겨냥 집합은 ★정본에서 온다 — 검사기 소스에서 뽑으면 '기대표를 밖으로 뺐다' 가 말뿐이 된다
    #   (2026-09-07 실측: 정본에서 겨냥을 옮겨도 소스 정규식이 옛 값을 읽어 미겨냥이 0 으로 나왔다).
    targets = set(v.get('target') for v in exp['mutations'].values() if v.get('target'))
    canon_names = set(exp['mutations'].keys())
    canon_targets = set(v.get('target') for v in exp['mutations'].values() if v.get('target'))
    # ★양방향 — 정본에만 있는 뮤테이션 / 검사기에만 있는 뮤테이션
    only_canon = sorted(canon_names - set(names))
    only_code = sorted(set(names) - canon_names)
    targeted_checks = [c for c in checks if c in targets]
    exempt_checks = [c for c in checks if c not in targets and c in exempt]
    untargeted = [c for c in checks if c not in targets and c not in exempt]
    # ★면제 이름이 검사 목록에 없다 = 정본 노후화 = 판정 불가. 형제 aux_stale 과 같은 규칙이다.
    exempt_stale = sorted(n for n in exempt_why if n not in set(checks))
    stale = sorted(t for t in targets if t not in checks)
    stale_canon = sorted(t for t in canon_targets if t not in checks)

    perr = payload_gate(exp, names)
    if perr:
        print('판정 불가 — ' + perr)
        if REV:
            print('  · 힌트: 그 리비전의 검사기가 이 러너의 규약(--payload-hashes·--repo)을 모를 수 있다 '
                  '— 러너와 검사기의 리비전이 갈리면 ★판정 불가다(통과가 아니다).')
        return 2

    items, aux, lhash, lerr = locked_items()
    if lerr:
        print('판정 불가 — ' + lerr)
        return 2
    checkset = set(checks)
    borne = {}
    for it in items:
        for bc in (it.get('bearing_checks') or []):
            borne.setdefault(bc, []).append(it)
    # ★방향 1 — 항인데 그것을 짊어지는 검사가 ★하나도 없다(구멍)
    item_no_check = [it for it in items
                     if not [bc for bc in (it.get('bearing_checks') or []) if bc in checkset]]
    # ★방향 2 — 검사인데 어느 항도 안 짊어지고 ★보조로도 선언되지 않았다(미선언).
    #   이 방향이 ★판정을 짊어져야 한다. 표시만 하면 ★정본에서 항을 지워 구멍을 없앨 수 있다 —
    #   지우는 순간 그 검사가 미선언이 되어 ★즉시 붉어지게 만든다(흔적 없이 못 지운다).
    aux_names = {a['name']: a['why'] for a in aux}
    check_no_item = [c for c in checks if c not in borne and c not in aux_names]
    aux_declared = [c for c in checks if c in aux_names]
    aux_stale = [n for n in aux_names if n not in checkset]

    print(fingerprint_line('검사기 지문 ★대상과 함께 고정해 적어라', VERIFY, vhash))
    print(fingerprint_line('잠근 항 정본 지문', LOCKED, lhash))
    print(fingerprint_line('기대표 정본 지문', EXPECT, fingerprint(EXPECT)))
    print('뮤테이션 분모(기계 열거) = %d 종 · 기대표 정본 %d 종 · ★정본에만 %d · ★검사기에만 %d'
          % (len(names), len(canon_names), len(only_canon), len(only_code)))
    if only_canon or only_code:
        print('  ★갈렸다 — 정본에만: %s · 검사기에만: %s' % (only_canon or '없음', only_code or '없음'))
    print('검사 분모(기계 열거)     = %d 종 · 겨냥된 검사 %d · ★면제 %d · ★미겨냥(미측정) %d'
          % (len(checks), len(targeted_checks), len(exempt_checks), len(untargeted)))
    # ★면제 절은 ★언제나 찍는다 — 0건이어도 '없음' 을 남긴다(형제 auxiliary 와 같은 모양).
    #   R2 결함의 본질은 ★안 보이는 것이었다. 있을 때만 찍으면 ★조용한 요약(미측정 0) 뒤에
    #   면제가 숨는다 — ★빈 목록의 명시가 곧 부재의 증거다(2026-09-07 R3 reviewer-claude-1).
    print('  ★겨냥 면제된 검사(★통과가 아니라 면제다 — 사유와 함께 남긴다) %d:' % len(exempt_checks))
    for c in exempt_checks:
        print('    - %s   ← 사유: %s' % (c, exempt_why[c]))
    if not exempt_checks:
        print('    없음')
    if exempt_stale:
        print('  ★면제 이름이 검사 목록에 없다(정본 노후화): %s' % ', '.join(exempt_stale))
    if untargeted:
        # ★2026-09-07(T0913): 미겨냥은 이제 ★rc 가 말한다 — 사람이 이 줄을 눈으로 읽어
        #   증거에 붙이던 임시 조치는 여기서 끝난다(목적을 다한 임시 게이트를 남기면
        #   다음 사람이 rc 대신 눈을 믿는다 · reviewer-claude-1).
        print('  ★미측정 검사(★rc 로 판정한다 — 면제는 정본 exempt_from_targeting 에 ★{name, why} 로 적어야 한다 — 이름만이면 rc=2):')
        for c in untargeted:
            print('    - %s' % c)
    if stale:
        print('  ★겨냥 이름이 검사 목록에 없다(앵커 노후화): %s' % ', '.join(stale))
    print('')
    print('잠근 항 정본(기계 열거) = %d 항  ★양방향 차집합:' % len(items))
    print('  ← 항인데 ★짊어지는 검사가 없다     %d' % len(item_no_check))
    for it in item_no_check:
        # ★배열을 읽는다 — 단수 필드를 읽어 'None' 을 찍으면 ★무엇을 만들어야 하는지 알려주는
        #   바로 그 문장이 비어 버린다(2026-09-06 R2).
        want = ', '.join(it.get('bearing_checks') or []) or '(정본에 이름조차 없다)'
        print('      #%s %s   (짊어져야 할 검사: %s ← ★검사 목록에 없다)'
              % (it.get('id'), it.get('name'), want))
    print('  → 검사인데 ★어느 항도 안 짊어지고 보조 선언도 없다(미선언)   %d' % len(check_no_item))
    for c in check_no_item:
        print('      %s   ★미선언 — 항을 짊어지든지 auxiliary 에 선언하든지 해야 한다' % c)
    print('  · 보조로 ★선언된 검사 %d:' % len(aux_declared))
    for c in aux_declared:
        print('      %s   ← 사유: %s' % (c, aux_names[c]))
    if not aux_declared:
        print('      없음')
    if aux_stale:
        print('  · ★auxiliary 에 있는데 검사 목록에 없는 이름: %s (정본 노후화)' % ', '.join(aux_stale))
    print('  ★두 방향 모두 판정을 짊어진다 — 항을 지우면 그것을 짊어지던 검사가 ★미선언이 되어')
    print('    즉시 붉어진다. 구멍을 없애려면 ★정본에 흔적이 남는다.')
    print('')
    # ★무변이 기준선 1회 — 표를 돌리기 ★전에 세운다.
    #   앞서는 판정 불가를 잡는 것이 ★대조군 실행뿐이었다. 그러면 안전망이 계약이 아니라
    #   ★목록 구성에 얹힌다 — 대조군을 목록에서 빼는 것만으로 rc=0 이 된다(2026-09-06 R2 실측).
    #   무변이 실행은 ★어떤 목록으로 돌리든 늘 있으므로 여기서 끊으면 대조군 존재와 무관해진다.
    base = run(['node', VERIFY] + TARGET_ARGS)
    if base.returncode == 2:
        print('판정 불가 — ★무변이 기준선이 rc=2 다(검사를 세울 수 없다). 뮤테이션 표는 돌리지 않는다.')
        print('  ' + ((base.stderr or base.stdout or '').strip().splitlines() or [''])[-1][:300])
        return 2
    if base.returncode != 0:
        print('★미달 — 무변이 기준선이 붉다(rc=%d). 안 건드린 제품이 이미 계약을 깬다.' % base.returncode)
        return 1
    print('무변이 기준선 rc=0 — ★표를 돌리기 전에 세웠다(대조군 존재와 무관한 안전망)')
    print('')
    # ★표도 ★탭으로 낸다 — 이름이 칸을 넘으면 눈 정렬에 기댄 파서가 옆 칸을 함께 집는다
    print('뮤테이션\t지목한 검사\trc\t판정')
    print('-' * 96)

    # ★네 통으로 가른다. 앞서는 '겨냥 검출' 과 '대조군 조용' 이 한 통(caught)이었고,
    # 대조군의 붉음이 '공허' 통에 들어갔다 — ★틀린 이름은 틀린 수리를 부른다.
    # '검사가 공허하다' 는 검사를 ★강화하라고 말하지만, 대조군이 붉을 때 필요한 것은
    # 판정을 ★대리물에서 행동으로 되돌리는 것이다(2026-09-06 실측: 철자 판정 복원 사본).
    caught = quiet_ok = vacuous = false_fail = indet = 0
    rows = []
    for n in names:
        p = run(['node', VERIFY] + TARGET_ARGS + ['--mutate', n])
        target = ''
        for ln in (p.stdout or '').splitlines():
            if ln.startswith('※ 지목한 검사: '):
                target = ln.replace('※ 지목한 검사: ', '').strip()
        # ★대조군 판별은 ★정본(expect)에 건다 — 검사기가 찍는 문구에 걸면, 그 문구를 바꾼 날
        #   대조군이 조용히 '겨냥 검출' 통으로 넘어간다(2026-09-07 실측: 그 자리에서 34종이
        #   전부 ①로 세어졌다). 필터는 메시지가 아니라 ★출처를 봐야 한다.
        canon = exp['mutations'].get(n, {})
        quiet = (canon.get('expect') == 'quiet')
        canon_target = canon.get('target') or ''
        # ★두 층이 갈리면 판정 불가 — 정본이 겨냥한 검사와 검사기가 겨냥한 검사가 달라도 마찬가지다
        if quiet and target and not target.startswith('(대조군'):
            print('  ★판정 불가: %s — 정본은 대조군인데 검사기는 겨냥(%s)을 찍는다' % (n, target))
            indet += 1
            rows.append((n, target, 2, '★판정 불가(정본과 검사기가 갈렸다)', ''))
            continue
        if (not quiet) and canon_target and target and canon_target != target:
            print('  ★판정 불가: %s — 겨냥이 갈렸다(정본 "%s" ≠ 검사기 "%s")' % (n, canon_target, target))
            indet += 1
            rows.append((n, target, 2, '★판정 불가(겨냥이 갈렸다)', ''))
            continue
        if p.returncode == 0:
            if quiet:
                verdict = '조용했다(대조군 · 기대대로)'; quiet_ok += 1
            else:
                verdict = '잡았다(겨냥 검출)'; caught += 1
        elif p.returncode == 3:
            if quiet:
                # ★대조군이 붉었다 = 행동을 안 바꾼 사본에 검사가 반응했다 = ★거짓 실패다.
                verdict = '★거짓 실패(대조군이 붉다 — 검사가 계약이 아니라 대리물을 본다)'
                false_fail += 1
            else:
                verdict = '★못 잡았다(검사가 공허하다)'; vacuous += 1
        elif p.returncode == 2:
            verdict = '★판정 불가(주입·하네스 실패) — 통과로 세지 않는다'; indet += 1
        else:
            verdict = '★알 수 없는 rc'; indet += 1
        rows.append((n, target, p.returncode, verdict, (p.stderr or '').strip()[:200]))
        print('%s\t%s\t%d\t%s' % (n, target or '(대조군 · 조용해야 한다)', p.returncode, verdict))

    print('')
    print('==== 뮤테이션 %d종 — ★네 통으로 가른다(합산하지 않는다) ====' % len(names))
    print('  ① 겨냥 검출(잡았다)          %d' % caught)
    print('  ② 대조군 조용(기대대로)      %d' % quiet_ok)
    print('  ③ ★공허(겨냥인데 못 잡았다)  %d' % vacuous)
    print('  ④ ★거짓 실패(대조군이 붉다)  %d' % false_fail)
    print('  ⑤ ★판정 불가(못 세웠다)      %d' % indet)
    print('  ★겨냥 뮤테이션만의 검출 수 = ① = %d (대조군 %d 은 여기 안 들어간다)' % (caught, quiet_ok))
    print('==== 검사: 전체 %d · 겨냥 %d · ★면제 %d · ★미측정 %d (면제도 미측정도 통과가 아니다) ===='
          % (len(checks), len(targeted_checks), len(exempt_checks), len(untargeted)))
    # ★꼬리 요약에서도 면제 절을 ★언제나 찍는다(0건이면 '면제 없음').
    if exempt_checks:
        for c in exempt_checks:
            print('  ★면제 %s ← 사유: %s' % (c, exempt_why[c]))
    else:
        print('  ★면제 없음(면제 목록이 비어 있다 — ★이 줄이 부재의 증거다)')
    for n, t, rc, v, err in rows:
        if rc == 2 and err:
            print('  판정 불가 사유 %s: %s' % (n, err))

    # ★판정 불가를 ★먼저 돌린다 — 못 쟀으면 틀렸다고 말할 수 없다.
    if stale or aux_stale or exempt_stale or stale_canon:
        if stale_canon:
            print('  ★기대표 정본이 없는 검사를 겨냥한다(노후화): %s' % ', '.join(stale_canon))
        return 2          # 이름이 검사 목록에 없다 = 정본·앵커 노후화 = ★판정 불가
    if only_canon or only_code:
        print('  ★판정 불가: 기대표와 검사기가 갈렸다 — 어느 쪽이 계약인지 알 수 없다')
        return 2
    if indet:
        return 2
    if item_no_check:
        # ★항인데 짊어지는 검사가 없다 = 그 계약은 ★아무도 안 재고 있다 = 미달이다.
        print('  ★미달: 잠근 항 %d개를 짊어지는 검사가 없다(위 목록) — 통과로 세지 않는다'
              % len(item_no_check))
        return 1
    if check_no_item:
        print('  ★미달: 미선언 검사 %d개(위 목록) — 항을 짊어지든 보조로 선언하든 해야 한다'
              % len(check_no_item))
        return 1
    if exp.get('requires_targeted') and untargeted:
        # ★미겨냥 0 을 ★rc 가 말한다(T0913). 겨냥이 없는 검사는 ★그 검사가 살아 있는지
        #   아무도 모른다 — 지워도 표가 초록이다.
        print('  ★미달: 겨냥 뮤테이션이 없는 검사 %d개 — %s' % (len(untargeted), ', '.join(untargeted)))
        return 1
    # ★공허(③)와 거짓 실패(④)는 둘 다 미달이지만 ★고칠 곳이 다르다 —
    #   공허는 검사를 강화해야 하고, 거짓 실패는 판정을 대리물에서 행동으로 되돌려야 한다.
    return 1 if (vacuous or false_fail) else 0


if __name__ == '__main__':
    sys.exit(main())
