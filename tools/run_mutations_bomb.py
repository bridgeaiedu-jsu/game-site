#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_mutations_bomb.py — verify_bomb.js 의 검출력 검산.

무엇을 하나: `tools/verify_bomb.js --list-mutations` 로 뮤테이션 ★분모를 기계로 뽑고,
하나씩 주입해 돌린 뒤 ★지목한 검사가 실제로 잡았는지를 표로 낸다.

★왜 따로 있나: 검사기가 초록이라는 것은 "검사가 살아 있다" 를 뜻하지 않는다. 잡아야 할 것을
주입했을 때 ★그 검사가 붉어지는지를 보여야 초록에 뜻이 생긴다. 그리고 여기서 세는 단위는
'붉었다' 가 아니라 ★(검사, 대상) 짝이다 — 아무 검사나 붉어진 것으로 검출을 인정하면
그 뮤테이션이 겨냥한 계약은 여전히 무방비다.

★주입 실패는 통과가 아니다. verify_bomb.js 는 셋을 가른다:
    rc=0  지목한 검사가 잡았다
    rc=2  검사를 세울 수 없었다(앵커 노후화·문법 파손 등) — ★판정 불가
    rc=3  주입은 됐는데 지목한 검사가 ★못 잡았다(검사가 공허하다)
이 스크립트는 셋을 각각 세고, 2 와 3 을 ★한 칸에 섞지 않는다.

종료코드: 0 = 겨냥은 전부 잡혔고 대조군은 전부 조용했다
          · 1 = ★공허(겨냥인데 못 잡았다) 또는 ★거짓 실패(대조군이 붉다)가 있다
          · 2 = 판정 불가가 하나라도 있다(rc=2) 또는 하네스를 세울 수 없다
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(ROOT, 'tools', 'verify_bomb.js')
LOCKED = os.path.join(ROOT, 'tools', 'bomb_locked_contracts.json')


def run(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')


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
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    oid = run(['git', 'rev-parse', 'HEAD:' + rel])
    blob = subprocess.run(['git', 'cat-file', 'blob', 'HEAD:' + rel],
                          cwd=ROOT, capture_output=True)
    return {
        'wt': wt,
        'blob_sha256': (hashlib.sha256(blob.stdout).hexdigest()[:16]
                        if blob.returncode == 0 else '커밋에 없다'),
        'oid': (oid.stdout or '').strip()[:16] if oid.returncode == 0 else '커밋에 없다',
    }


def fingerprint_line(label, path, fp):
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    return chr(10).join([
        label,
        '    sha256(★작업트리 파일)   = %s   ← 지금 돌린 바이트(줄끝 변환을 탄다)' % fp['wt'],
        '    sha256(★커밋된 바이트)   = %s   ← ★재현에 쓸 값' % fp['blob_sha256'],
        '    git 객체 id (HEAD:%s) = %s' % (rel, fp['oid']),
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


def list_mutations():
    p = run(['node', VERIFY, '--list-mutations'])
    if p.returncode != 0:
        return None, '뮤테이션 목록을 못 얻었다(rc=%d): %s' % (p.returncode, (p.stderr or '').strip()[:400])
    # ★탭으로 가른다 — 공백 분해는 이름이 칸 너비를 넘는 순간 다음 칸을 함께 집는다
    names = [ln.split('	')[0].strip() for ln in (p.stdout or '').splitlines() if ln.strip()]
    return names, None


def main():
    global VERIFY, LOCKED
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=os.path.join(ROOT, 'bomb', 'index.html'))
    ap.add_argument('--only', help='이 뮤테이션 하나만 돌린다')
    ap.add_argument('--locked', help='잠근 항 정본 경로(★자를 고정할 때 정본도 함께 고정한다 — '
                                     '검사기만 고정하면 정본은 현재 나무 것을 읽어 두 시점이 섞인다)')
    ap.add_argument('--verify', help='검사기 경로(★리비전을 고정해 재고 싶을 때 사본을 가리킨다)')
    a = ap.parse_args()
    if a.verify:
        VERIFY = os.path.abspath(a.verify)
    if a.locked:
        LOCKED = os.path.abspath(a.locked)

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
    untargeted = [c for c in checks if c not in targets]
    stale = sorted(t for t in targets if t not in checks)

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
    print('뮤테이션 분모(기계 열거) = %d 종' % len(names))
    print('검사 분모(기계 열거)     = %d 종 · 겨냥된 검사 %d · ★미겨냥(미측정) %d'
          % (len(checks), len(checks) - len(untargeted), len(untargeted)))
    if untargeted:
        print('  ★미측정 검사(통과로 세지 않는다):')
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
    base = run(['node', VERIFY, '--html', a.html])
    if base.returncode == 2:
        print('판정 불가 — ★무변이 기준선이 rc=2 다(검사를 세울 수 없다). 뮤테이션 표는 돌리지 않는다.')
        print('  ' + ((base.stderr or base.stdout or '').strip().splitlines() or [''])[-1][:300])
        return 2
    if base.returncode != 0:
        print('★미달 — 무변이 기준선이 붉다(rc=%d). 안 건드린 제품이 이미 계약을 깬다.' % base.returncode)
        return 1
    print('무변이 기준선 rc=0 — ★표를 돌리기 전에 세웠다(대조군 존재와 무관한 안전망)')
    print('')
    print('%-24s %-34s %-4s %s' % ('뮤테이션', '지목한 검사', 'rc', '판정'))
    print('-' * 96)

    # ★네 통으로 가른다. 앞서는 '겨냥 검출' 과 '대조군 조용' 이 한 통(caught)이었고,
    # 대조군의 붉음이 '공허' 통에 들어갔다 — ★틀린 이름은 틀린 수리를 부른다.
    # '검사가 공허하다' 는 검사를 ★강화하라고 말하지만, 대조군이 붉을 때 필요한 것은
    # 판정을 ★대리물에서 행동으로 되돌리는 것이다(2026-09-06 실측: 철자 판정 복원 사본).
    caught = quiet_ok = vacuous = false_fail = indet = 0
    rows = []
    for n in names:
        p = run(['node', VERIFY, '--html', a.html, '--mutate', n])
        target = ''
        for ln in (p.stdout or '').splitlines():
            if ln.startswith('※ 지목한 검사: '):
                target = ln.replace('※ 지목한 검사: ', '').strip()
        quiet = 'quiet-control' in target
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
        print('%-24s %-34s %-4d %s' % (n, target or '(quiet-control · 조용해야 한다)', p.returncode, verdict))

    print('')
    print('==== 뮤테이션 %d종 — ★네 통으로 가른다(합산하지 않는다) ====' % len(names))
    print('  ① 겨냥 검출(잡았다)          %d' % caught)
    print('  ② 대조군 조용(기대대로)      %d' % quiet_ok)
    print('  ③ ★공허(겨냥인데 못 잡았다)  %d' % vacuous)
    print('  ④ ★거짓 실패(대조군이 붉다)  %d' % false_fail)
    print('  ⑤ ★판정 불가(못 세웠다)      %d' % indet)
    print('  ★겨냥 뮤테이션만의 검출 수 = ① = %d (대조군 %d 은 여기 안 들어간다)' % (caught, quiet_ok))
    print('==== 검사: 전체 %d · 겨냥 %d · ★미측정 %d (미측정은 통과가 아니다) ===='
          % (len(checks), len(checks) - len(untargeted), len(untargeted)))
    for n, t, rc, v, err in rows:
        if rc == 2 and err:
            print('  판정 불가 사유 %s: %s' % (n, err))

    # ★판정 불가를 ★먼저 돌린다 — 못 쟀으면 틀렸다고 말할 수 없다.
    if stale or aux_stale:
        return 2          # 이름이 검사 목록에 없다 = 정본·앵커 노후화 = ★판정 불가
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
    # ★공허(③)와 거짓 실패(④)는 둘 다 미달이지만 ★고칠 곳이 다르다 —
    #   공허는 검사를 강화해야 하고, 거짓 실패는 판정을 대리물에서 행동으로 되돌려야 한다.
    return 1 if (vacuous or false_fail) else 0


if __name__ == '__main__':
    sys.exit(main())
