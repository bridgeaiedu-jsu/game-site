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

종료코드: 0 = 전종이 지목한 검사에 잡혔다 · 1 = 못 잡은 것이 있다(rc=3)
          · 2 = 판정 불가가 하나라도 있다(rc=2) 또는 하네스를 세울 수 없다
"""
import argparse
import hashlib
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(ROOT, 'tools', 'verify_bomb.js')


def run(args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')


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
    digest = hashlib.sha256(io.open(VERIFY, 'rb').read()).hexdigest()[:16]
    return checks, targets, digest, None


def list_mutations():
    p = run(['node', VERIFY, '--list-mutations'])
    if p.returncode != 0:
        return None, '뮤테이션 목록을 못 얻었다(rc=%d): %s' % (p.returncode, (p.stderr or '').strip()[:400])
    names = [ln.split()[0] for ln in (p.stdout or '').splitlines() if ln.strip()]
    return names, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=os.path.join(ROOT, 'bomb', 'index.html'))
    ap.add_argument('--only', help='이 뮤테이션 하나만 돌린다')
    a = ap.parse_args()

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

    print('검사기 sha256(앞 16) = %s   ★대상과 함께 이 해시도 고정해 적어라' % vhash)
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
    print('%-24s %-34s %-4s %s' % ('뮤테이션', '지목한 검사', 'rc', '판정'))
    print('-' * 96)

    caught = indet = vacuous = 0
    rows = []
    for n in names:
        p = run(['node', VERIFY, '--html', a.html, '--mutate', n])
        target = ''
        for ln in (p.stdout or '').splitlines():
            if ln.startswith('※ 지목한 검사: '):
                target = ln.replace('※ 지목한 검사: ', '').strip()
        if p.returncode == 0:
            quiet = 'quiet-control' in target
            verdict = '조용했다(대조군 · 기대대로)' if quiet else '잡았다'
            caught += 1
        elif p.returncode == 3:
            verdict = '★못 잡았다(검사가 공허하다)'; vacuous += 1
        elif p.returncode == 2:
            verdict = '★판정 불가(주입·하네스 실패) — 통과로 세지 않는다'; indet += 1
        else:
            verdict = '★알 수 없는 rc'; indet += 1
        rows.append((n, target, p.returncode, verdict, (p.stderr or '').strip()[:200]))
        print('%-24s %-34s %-4d %s' % (n, target or '(quiet-control · 조용해야 한다)', p.returncode, verdict))

    print('')
    print('==== 뮤테이션: 잰 것 %d · 잡았다 %d · 못 잡았다 %d · 판정 불가 %d ====' %
          (len(names), caught, vacuous, indet))
    print('==== 검사: 전체 %d · 겨냥 %d · ★미측정 %d (미측정은 통과가 아니다) ===='
          % (len(checks), len(checks) - len(untargeted), len(untargeted)))
    for n, t, rc, v, err in rows:
        if rc == 2 and err:
            print('  판정 불가 사유 %s: %s' % (n, err))

    if stale:
        return 2          # 겨냥 이름이 검사에 없다 = 앵커 노후화 = ★판정 불가
    if indet:
        return 2
    return 1 if vacuous else 0


if __name__ == '__main__':
    sys.exit(main())
