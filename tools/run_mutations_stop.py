#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_stop.js 의 검출력 검산 — worker · 2026-09-02 · 티켓 T0901-stop

`verify_stop.js` 가 **고의 결함을 정말로 잡는지** 를 뮤테이션 전수 주입으로 검산한다.
검사기의 유일한 실패 양식은 '규칙은 있는데 판정을 짊어지지 않는 것(공허)' 이라, 계약을
하나씩 깨뜨린 사본으로 검증기를 돌려 **지목한 검사가 붉어지는지** 를 본다.

'탐지' 의 정의가 엄격하다 — 다음 셋을 모두 만족해야 탐지로 센다:
  · 종료코드가 1 이고(0 = 못 잡음 · 2 = 검사를 세우지 못함 → 탐지 아님)
  · 뮤테이션이 **지목한 검사**(catcher)가 실제로 FAIL 목록에 있고
  · 최종 요약행(`PASS n · FAIL n · INDET n`)에 도달했다(예외로 죽은 것은 탐지가 아니다)

'무임승차' 차단: 다른 검사가 우연히 깨져서 rc=1 이 된 것은 탐지로 인정하지 않는다.
'주입 실패'(앵커 노후화)는 검출력 저하와 **별개로 세어** 표에 그대로 남긴다 —
둘을 뭉뚱그리면 '검출력이 떨어졌다' 는 오독을 부른다.

사용법:
  python3 tools/run_mutations_stop.py
  python3 tools/run_mutations_stop.py --html stop/index.html
종료코드:
  0 = 전부 지목 검사로 탐지 + 원본 정상(rc=0)
  1 = 검출력 실패(미탐지·엉뚱탐지)
  2 = 하네스 비정상(주입 실패·예외 중단·요약행 미도달·원본이 이미 FAIL·CLI 오류)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFIER = os.path.join(ROOT, 'tools', 'verify_stop.js')

argv = sys.argv[1:]


def arg_of(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


HTML = arg_of('--html', os.path.join(ROOT, 'stop', 'index.html'))

SUMMARY_RE = re.compile(r'^==== 멈춰! 검증: PASS (\d+) · FAIL (\d+) · INDET (\d+) ====$', re.M)
FAIL_RE = re.compile(r'^  FAIL  (.+?)(?: — |$)', re.M)

# ══ ★러너가 쥐는 기대 목록 ══════════════════════════════════════════
# 이 목록을 ★대상에게 물어보지 않는다. 물어보면 문제도 정답도 채점 기준도 피검사자가 낸다 —
# 대상에서 뮤테이션이 사라지면 목록도 함께 줄어 '18→17' 이 초록으로 지나간다.
# 아래는 이 러너가 **독립 리터럴로** 쥔 (뮤테이션 이름, 이 결함을 잡아야 하는 검사) 쌍이고,
# 대상이 내놓는 --list-mutations 는 근거가 아니라 ★대조 상대다.
MUTS = [
    ('m-frame-clock', '기기 사정이 달라도 같은 도장이면 같은 판정이다'),
    ('m-interval', 'setInterval 을 쓰지 않는다'),
    ('m-play-consumes-rng', '플레이 중 Math.random 도 부르지 않았다'),
    ('m-tol-drift', '허용폭은 판을 짤 때 확정되고 플레이로 바뀌지 않는다'),
    ('m-board-drift', '판 자체가 처음 그대로다(허용폭 포함)'),
    ('m-tol-narrow', '기획안 예시대로 지점 3px 차이가 97점 언저리다(≥95점)'),
    ('m-kind-runtime', '한 판의 구성이 지점2·크기2·각도1 이다'),
    ('m-order-fixed', '종류의 차례도 seed 가 정한다'),
    ('m-score-not-normalized', '환산 점수가 허용폭 대비 정규화다(독립 재계산과 일치)'),
    ('m-avg-not-mean', '최종 점수가 다섯 라운드의 평균이다'),
    ('m-no-raw-value', '결과에 환산 점수와 원값이 함께 나온다'),
    ('m-double-press', '라운드가 끝난 뒤의 연타는 아무 일도 하지 않는다'),
    ('m-no-limit', '10초가 지나면 0점으로 넘어간다'),
    ('m-reduce-changes-speed', '동작 줄이기가 판정·허용폭·점수에 닿지 않는다'),
    ('m-fast-blink', '초당 3회를 넘는 깜빡임이 없다'),
    ('m-slider', '슬라이더·수치 입력이 없다'),
    ('m-no-again', '결과 화면에서 한 번의 조작으로 다음 판이 시작된다'),
    ('m-field-scale', '판 크기가 300 으로 고정이다'),
]

EXPECTED_COUNT = 18          # ★tools/README.md 의 '사본 N종' 과 같은 수여야 한다(아래에서 대조한다)
README_COUNT_RE = re.compile(r'멈춰! 의 계약을 하나씩 깨뜨린 사본 (\d+)종')


def readme_declared_count():
    """★문서가 선언한 종수를 읽어 코드와 대조한다 — 숫자가 문서에만 있으면 조용히 낡는다."""
    p = os.path.join(ROOT, 'tools', 'README.md')
    try:
        txt = open(p, encoding='utf-8', errors='replace').read()
    except OSError as exc:
        return None, 'README 를 읽지 못했다(%s)' % exc
    m = README_COUNT_RE.search(txt)
    if not m:
        return None, 'README 에서 종수 선언 문장을 찾지 못했다'
    return int(m.group(1)), None


def run(extra):
    p = subprocess.run(['node', VERIFIER, '--html', HTML] + extra,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or ''), (p.stderr or '')


def summary_lines(out):
    return SUMMARY_RE.findall(out)


def list_mutations():
    rc, out, err = run(['--list-mutations'])
    if rc != 0:
        print('뮤테이션 목록을 얻지 못했다 (rc=%d)\n%s' % (rc, err))
        sys.exit(2)
    items = []
    for line in out.splitlines():
        m = re.match(r'^(\S+)\s+— (.*?)\s+\[잡아야 하는 검사: (.*)\]$', line)
        if m:
            items.append((m.group(1), m.group(2), m.group(3)))
    return items


def main():
    print('검증기: %s' % VERIFIER)
    print('대상  : %s' % HTML)

    rc0, out0, err0 = run([])
    s0 = summary_lines(out0)
    if len(s0) != 1:
        print('원본 실행의 최종 요약행이 정확히 1줄이 아니다(%d줄) — 판정을 고를 수 없다' % len(s0))
        print(err0[-2000:])
        sys.exit(2)
    if rc0 != 0:
        print('원본이 이미 FAIL 이다 (rc=%d · PASS %s · FAIL %s · INDET %s) — 검산을 세울 수 없다'
              % (rc0, s0[0][0], s0[0][1], s0[0][2]))
        for f in FAIL_RE.findall(out0):
            print('  · ' + f)
        sys.exit(2)
    print('원본 정상 — PASS %s · FAIL %s · INDET %s (rc=0)\n' % (s0[0][0], s0[0][1], s0[0][2]))

    declared = list_mutations()
    mine = dict(MUTS)
    theirs = dict((n, c) for n, _w, c in declared)
    why_of = dict((n, w) for n, w, _c in declared)

    problems = []
    n_readme, rerr = readme_declared_count()
    if rerr:
        problems.append('★' + rerr)
    elif n_readme != EXPECTED_COUNT:
        problems.append('★문서와 코드의 종수가 다르다 — README %d종 · 러너 %d종'
                        % (n_readme, EXPECTED_COUNT))
    if len(MUTS) != EXPECTED_COUNT:
        problems.append('★러너 목록이 %d종인데 선언은 %d종이다' % (len(MUTS), EXPECTED_COUNT))
    gone = sorted(set(mine) - set(theirs))
    unknown = sorted(set(theirs) - set(mine))
    bad_catcher = sorted(n for n in (set(mine) & set(theirs)) if mine[n] != theirs[n])
    if gone:
        problems.append('★대상에서 사라진 뮤테이션 %d종: %s' % (len(gone), ', '.join(gone)))
    if unknown:
        problems.append('★러너가 모르는 뮤테이션 %d종: %s' % (len(unknown), ', '.join(unknown)))
    if bad_catcher:
        problems.append('★잡아야 하는 검사가 어긋난다 %d종: %s'
                        % (len(bad_catcher), ', '.join(bad_catcher)))
    if problems:
        print('판정 불가 — 기대 목록과 대상이 어긋난다(이 대조가 없으면 종수가 줄어도 초록으로 지나간다)')
        for p_ in problems:
            print('  · ' + p_)
        sys.exit(2)

    muts = [(n, why_of.get(n, ''), mine[n]) for n, _c in MUTS]

    detected, missed, stray, inject_fail, harness = [], [], [], [], []
    rows = []
    for name, why, catcher in muts:
        rc, out, err = run(['--mutate', name])
        fails = FAIL_RE.findall(out)
        summ = summary_lines(out)
        if rc == 2 and '주입 실패' in (err + out):
            inject_fail.append(name)
            rows.append((name, 'rc=2', '주입실패(앵커 노후화)', catcher))
            continue
        if rc == 2:
            harness.append(name)
            rows.append((name, 'rc=2', '판정 불가(지목 검사 미실행·구동 실패 등)', catcher))
            continue
        if len(summ) != 1:
            harness.append(name)
            rows.append((name, 'rc=%d' % rc, '요약행 %d줄 — 판정 불가' % len(summ), catcher))
            continue
        if rc == 0:
            missed.append(name)
            rows.append((name, 'rc=0', '★미탐지 — 계약을 깼는데 초록이다', catcher))
            continue
        if catcher in fails:
            others = [f for f in fails if f != catcher]
            detected.append(name)
            rows.append((name, 'rc=1', '탐지' + (' (같이 붉어짐 %d건)' % len(others) if others else ''), catcher))
        else:
            stray.append(name)
            rows.append((name, 'rc=1', '★엉뚱탐지 — 지목 검사는 통과했다: ' + ' / '.join(fails)[:80], catcher))

    w = max(len(r[0]) for r in rows)
    print('%-*s  %-5s  %s' % (w, '뮤테이션', 'rc', '결과  [지목한 검사]'))
    print('-' * (w + 60))
    for name, rc, verdict, catcher in rows:
        print('%-*s  %-5s  %s  [%s]' % (w, name, rc, verdict, catcher))

    print('')
    print('원본 정상=True · 뮤테이션 %d종 · 탐지 %d · 미탐지 %d · 엉뚱탐지 %d · 주입실패 %d · 하네스이상 %d'
          % (len(muts), len(detected), len(missed), len(stray), len(inject_fail), len(harness)))
    if inject_fail or harness:
        sys.exit(2)
    if missed or stray:
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
