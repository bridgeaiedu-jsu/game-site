#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_tensec.js 의 검출력 검산 — worker · 2026-08-31 · 티켓 G-tensec

`verify_tensec.js` 가 **고의 결함을 정말로 잡는지** 를 뮤테이션 전수 주입으로 검산한다.
이 설계의 유일한 실패 양식은 '규칙은 있는데 판정을 짊어지지 않는 것(공허)' 이라, 방어를
하나씩 지운 사본으로 검증기를 돌려 **반드시 붉어지는지** 를 본다.

'탐지' 의 정의가 엄격하다 — 다음 셋을 모두 만족해야 탐지로 센다:
  · 종료코드가 1 이고(0 = 못 잡음 · 2 = 하네스가 검사를 세우지 못함 → 탐지 아님)
  · 뮤테이션이 **지목한 검사**(catcher)가 실제로 FAIL 목록에 있고
  · 최종 요약행(`PASS n · FAIL n`)에 도달했다(예외로 죽은 것은 탐지가 아니다)

'무임승차' 차단: 다른 검사가 우연히 깨져서 rc=1 이 된 것은 탐지로 인정하지 않는다.
'주입 실패'(앵커 노후화)는 검출력 저하와 별개로 세어 표에 그대로 남긴다 —
둘을 뭉뚱그리면 오독을 부른다.

사용법:
  python3 tools/run_mutations_tensec.py
  python3 tools/run_mutations_tensec.py --html tensec/index.html
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
VERIFIER = os.path.join(ROOT, 'tools', 'verify_tensec.js')

argv = sys.argv[1:]


def arg_of(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


HTML = arg_of('--html', os.path.join(ROOT, 'tensec', 'index.html'))

SUMMARY_RE = re.compile(r'^PASS (\d+) · FAIL (\d+)$', re.M)
FAIL_RE = re.compile(r'^  FAIL  (.+?)(?: — |$)', re.M)

# ══ ★러너가 쥐는 기대 목록 (T0901-08) ════════════════════════════
# 이 목록을 ★대상에게 물어보지 않는다. 물어보면 문제도 정답도 채점 기준도 피검사자가 낸다 —
# 대상에서 뮤테이션이 사라지면 목록도 함께 줄어 ★19→18 이 초록으로 통과했다(결함A).
# 같은 저장소의 run_mutations.py 가 MUTS 를 독립 리터럴로 쥐는 것이 정답 형태고 그 형태에 맞추었다.
# ★정직 고지: 이 목록은 2026-09-01 f9bdc7c 시점의 정본에서 ★한 번 옮겨 적어 얄렸다.
#   진리를 독립으로 유도한 것이 아니라 ★이후의 어긋남을 드러내는 것이 목적이다.
# (뮤테이션 이름, ★이 결함을 잡아야 하는 검사 = 채점 기준)
MUTS = [
    ('m-frame-clock', '기기 사정이 달라도 잰 값이 같다'),
    ('m-show-time', '화면이 시계의 함수가 아니다'),
    ('m-poll-time', '재는 동안 걸린 타이머가 없다'),
    ('m-read-clock', '재는 동안 시계를 읽지 않는다'),
    ('m-no-anim-guard', '재는 동안 움직임을 끄는 규칙이 있다'),
    ('m-interval', 'setInterval 을 쓰지 않는다'),
    ('m-raf', 'requestAnimationFrame 을 쓰지 않는다'),
    ('m-click-listener', '판은 click 을 듣지 않는다'),
    ('m-repeat', '키 반복 입력은 세지 않는다'),
    ('m-epoch-mix', '잰 값은 두 도장의 차와 정확히 같다'),
    ('m-acc-formula', '정확도 산식이 기획안의 예와 일치한다'),
    ('m-seed-random', '같은 seed 는 같은 목표를 낸다'),
    ('m-seed-repeat', '오늘의 목표 세 개는 서로 다르다'),
    ('m-best-any', '최고 기록은 오차가 줄었을 때만 바뀐다'),
    ('m-best-shared', '기록은 목표마다 따로 남는다'),
    ('m-streak-always', '스트릭은 하루를 건너뛰면 끊긴다'),
    ('m-daily-twice', '오늘의 도전은 하루 한 번만 기록된다'),
    ('m-motion-uncovered', '움직이는 규칙이 모두 동작 줄이기에 덮여 있다'),
    ('m-overlay-press', '창이 떠 있으면 판은 눌리지 않는다'),
]

EXPECTED_COUNT = 19          # ★tools/README.md 의 '사본 19종' 과 같은 수여야 한다(아래에서 대조한다)
README_COUNT_RE = re.compile(r'방어를 하나씩 지운 사본 (\d+)종')


def readme_declared_count():
    """★문서가 선언한 종수를 읽어 코드와 대조한다 — 숫자가 문서에만 있고 대조가 없던 것이 결함이었다."""
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
    p = subprocess.run([node_bin(), VERIFIER, '--html', HTML] + extra,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or ''), (p.stderr or '')


def node_bin():
    return 'node'


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
        print('원본이 이미 FAIL 이다 (rc=%d · PASS %s · FAIL %s) — 검산을 세울 수 없다'
              % (rc0, s0[0][0], s0[0][1]))
        for f in FAIL_RE.findall(out0):
            print('  · ' + f)
        sys.exit(2)
    print('원본 정상 — PASS %s · FAIL %s (rc=0)\n' % (s0[0][0], s0[0][1]))

    # ★기대 목록은 러너가 쥐다. 대상이 내놓는 목록은 ★대조 상대이지 근거가 아니다.
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
        print('판정 불가 — 기대 목록과 대상이 어긋난다(이 대조가 없으면 19→18 이 초록으로 지나간다)')
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
            rows.append((name, 'rc=2', '판정 불가(지목 검사 미실행 등)', catcher))
            continue
        if len(summ) != 1:
            harness.append(name)
            rows.append((name, 'rc=%d' % rc, '요약행 %d줄 — 판정 불가' % len(summ), catcher))
            continue
        if rc == 0:
            missed.append(name)
            rows.append((name, 'rc=0', '★미탐지 — 방어를 지웠는데 초록이다', catcher))
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
