#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_higherlower.js 의 검출력 검산 · worker(238) · 2026-09-04 · 티켓 T0904-higher-lower

`verify_higherlower.js` 가 **고의 결함을 정말로 잡는지** 를 뮤테이션 전수 주입으로 검산한다.
검사기의 유일한 실패 양식은 '규칙은 있는데 판정을 짊어지지 않는 것(공허)' 이라, 계약을
하나씩 깨뜨린 사본으로 검증기를 돌려 **지목한 검사가 붉어지는지** 를 본다.

'탐지' 의 정의가 엄격하다 · 다음 셋을 모두 만족해야 탐지로 센다:
  · 종료코드가 1 이고(0 = 못 잡음 · 2 = 검사를 세우지 못함 → 탐지 아님)
  · 뮤테이션이 **지목한 검사**(catcher)가 실제로 FAIL 목록에 있고
  · 최종 요약행(`PASS n · FAIL n`)에 도달했다(예외로 죽은 것은 탐지가 아니다)

'무임승차' 차단: 다른 검사가 우연히 깨져서 rc=1 이 된 것은 탐지로 인정하지 않는다.
'주입 실패'(앵커 노후화)는 검출력 저하와 **별개로 세어** 표에 그대로 남긴다 ·
둘을 뭉뚱그리면 '검출력이 떨어졌다' 는 오독을 부른다.

사용법:
  python3 tools/run_mutations_higherlower.py
  python3 tools/run_mutations_higherlower.py --html higher-lower/index.html
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
VERIFIER = os.path.join(ROOT, 'tools', 'verify_higherlower.js')

argv = sys.argv[1:]


def arg_of(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


HTML = arg_of('--html', os.path.join(ROOT, 'higher-lower', 'index.html'))

SUMMARY_RE = re.compile(r'^PASS (\d+) · FAIL (\d+)$', re.M)
FAIL_RE = re.compile(r'^  FAIL  (.+?)(?: — |$)', re.M)

# ══ ★러너가 쥐는 기대 목록 ══════════════════════════════════════════
# 이 목록을 ★대상에게 물어보지 않는다. 물어보면 문제도 정답도 채점 기준도 피검사자가 낸다 ·
# 대상에서 뮤테이션이 사라지면 목록도 함께 줄어 '29→28' 가 초록으로 지나간다.
# 아래는 이 러너가 **독립 리터럴로** 쥔 (뮤테이션 이름, 이 결함을 잡아야 하는 검사) 쌍이고,
# 대상이 내놓는 --list-mutations 는 근거가 아니라 ★대조 상대다.
MUTS = [
    ('correct-inverted', '다음 값이 크면 위 칸이 정답이고 작으면 아래 칸이 정답이다'),
    ('higher-uses-lt', 'higherAt 은 다음 값이 지금 값보다 클 때만 참이다'),
    ('wrong-continues', '틀리면 그 자리에서 판이 끝난다'),
    ('reveal-hidden', '틀리면 다음 값이 드러난다'),
    ('right-not-scored', '맞히면 연속 정답이 하나 오른다'),
    ('no-advance', '맞히면 그 값이 새 기준이 되어 연쇄가 이어진다'),
    ('gap-not-shrinking', '라운드가 오를수록 두 값의 차이가 좁아진다'),
    ('gap-no-floor', '이웃한 두 값은 절대 같지 않다(무승부 0)'),
    ('range-escape', '값은 종류마다 정해진 범위 안에 있다'),
    ('kind-varies-in-run', '한 판 안에서 값의 종류가 바뀌지 않는다'),
    ('rng-on-play', '플레이 행동은 난수를 한 번도 소비하지 않는다(오늘의 도전)'),
    ('daily-seed-uses-clock', '같은 씨앗은 시각이 달라져도 같은 판을 준다(가짜 시계로 크게 벌려 확인)'),
    ('seed-drift', '같은 씨앗은 같은 판을 준다(값 100개 전체)'),
    ('plan-too-short', '판을 짤 때 값을 100개 전부 뽑아 둔다'),
    ('best-worse-wins', '자유 모드 최고 기록은 더 길게 이었을 때만 바뀐다'),
    ('best-updates-in-daily', '오늘의 도전은 최고 기록을 건드리지 않는다'),
    ('daily-overwrite', '오늘의 도전은 하루 한 번이다(두 번째 완주가 기록을 덮지 않는다)'),
    ('streak-never-resets', '날짜가 끊기면 스트릭이 1 로 리셋된다'),
    ('clock-frame-accumulate', '그린 시간이 매 프레임 흐른 시간과 같다(프레임 간격이 불규칙해도)'),
    ('judge-ignores-stamp', '허용오차 안쪽의 도장은 그대로 쓴다'),
    ('stamp-no-tolerance', '허용오차를 벗어난 도장은 믿지 않고 지금 시각으로 물러선다'),
    ('icons-identical', '두 답 칸은 색이 아니라 모양으로 서로 다르다'),
    ('labels-identical', '두 답 칸의 글자가 서로 다르다'),
    ('en-prose-missing', '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다'),
    ('repeat-guard-gone', '누르고 있어서 반복 발화된 화살표 입력은 무시된다'),
    ('key-no-preventdefault', 'Enter 로 눌렀을 때 preventDefault 가 호출된다'),
    ('inert-gone', '창이 열리면 창 밖 요소에 inert 가 붙는다'),
    ('touch-target-shrunk', '답 칸은 360px 에서 짧은 변이 50px 하한을 지킨다'),
    ('answers-gap-widened', '이 셈이 실브라우저 실측(답 칸 폭)을 재현한다'),
]

EXPECTED_COUNT = 29          # ★tools/README.md 의 '사본 N종' 과 같은 수여야 한다(아래에서 대조한다)
README_COUNT_RE = re.compile(r'위냐 아래냐 의 계약을 하나씩 깨뜨린 사본 (\d+)종')


def readme_declared_count():
    """★문서가 선언한 종수를 읽어 코드와 대조한다 · 숫자가 문서에만 있으면 조용히 낡는다."""
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
        if '\t' not in line:
            continue
        name, catcher = line.split('\t', 1)
        items.append((name.strip(), catcher.strip()))
    return items


def main():
    print('검증기: %s' % VERIFIER)
    print('대상  : %s' % HTML)

    rc0, out0, err0 = run([])
    s0 = summary_lines(out0)
    if len(s0) != 1:
        print('원본 실행의 최종 요약행이 정확히 1줄이 아니다(%d줄) · 판정을 고를 수 없다' % len(s0))
        print(err0[-2000:])
        sys.exit(2)
    if rc0 != 0:
        print('원본이 이미 FAIL 이다 (rc=%d · PASS %s · FAIL %s) · 검산을 세울 수 없다'
              % (rc0, s0[0][0], s0[0][1]))
        for f in FAIL_RE.findall(out0):
            print('  · ' + f)
        sys.exit(2)
    print('원본 정상 · PASS %s · FAIL %s (rc=0)\n' % (s0[0][0], s0[0][1]))

    declared = dict(list_mutations())
    mine = dict(MUTS)

    problems = []
    n_readme, rerr = readme_declared_count()
    if rerr:
        problems.append('★' + rerr)
    elif n_readme != EXPECTED_COUNT:
        problems.append('★문서와 코드의 종수가 다르다 · README %d종 · 러너 %d종'
                        % (n_readme, EXPECTED_COUNT))
    if len(MUTS) != EXPECTED_COUNT:
        problems.append('★러너 목록이 %d종인데 선언은 %d종이다' % (len(MUTS), EXPECTED_COUNT))
    gone = sorted(set(mine) - set(declared))
    unknown = sorted(set(declared) - set(mine))
    bad_catcher = sorted(n for n in (set(mine) & set(declared)) if mine[n] != declared[n])
    if gone:
        problems.append('★대상에서 사라진 뮤테이션 %d종: %s' % (len(gone), ', '.join(gone)))
    if unknown:
        problems.append('★러너가 모르는 뮤테이션 %d종: %s' % (len(unknown), ', '.join(unknown)))
    if bad_catcher:
        problems.append('★잡아야 하는 검사가 어긋난다 %d종: %s'
                        % (len(bad_catcher), ', '.join(bad_catcher)))
    # ★검사 이름에 ' — ' 가 들어가면 상세 구분자와 같아져 FAIL_RE 가 이름을 잘라 읽는다.
    #   그러면 실제로 붉은 검사를 '통과했다'로 오독해 ★엉뚱탐지로 찍힌다(2026-09-04 실측).
    #   조용한 오독 대신 여기서 판정 불가로 멈춘다 · 이름을 고치라는 뜻이다.
    sep_bad = sorted(n for n, c in MUTS if ' — ' in c)
    if sep_bad:
        problems.append('★검사 이름에 상세 구분자(공백 엠대시 공백)가 들어 있다 %d종: %s'
                        % (len(sep_bad), ', '.join(sep_bad)))
    if problems:
        print('판정 불가 · 기대 목록과 대상이 어긋난다(이 대조가 없으면 종수가 줄어도 초록으로 지나간다)')
        for p_ in problems:
            print('  · ' + p_)
        sys.exit(2)

    detected, missed, stray, inject_fail, harness = [], [], [], [], []
    rows = []
    for name, catcher in MUTS:
        rc, out, err = run(['--mutate', name])
        fails = FAIL_RE.findall(out)
        summ = summary_lines(out)
        if rc == 2 and '주입 실패' in (err + out):
            inject_fail.append(name)
            rows.append((name, 'rc=2', '주입실패(앵커 노후화)', catcher))
            continue
        if rc == 2:
            harness.append(name)
            rows.append((name, 'rc=2', '판정 불가(구동 실패·하네스 추락 등)', catcher))
            continue
        if len(summ) != 1:
            harness.append(name)
            rows.append((name, 'rc=%d' % rc, '요약행 %d줄 · 판정 불가' % len(summ), catcher))
            continue
        if rc == 0:
            missed.append(name)
            rows.append((name, 'rc=0', '★미탐지 · 계약을 깼는데 초록이다', catcher))
            continue
        if catcher in fails:
            others = [f for f in fails if f != catcher]
            detected.append(name)
            rows.append((name, 'rc=1', '탐지' + (' (같이 붉어짐 %d건)' % len(others) if others else ''), catcher))
        else:
            stray.append(name)
            rows.append((name, 'rc=1', '★엉뚱탐지 · 지목 검사는 통과했다: ' + ' / '.join(fails)[:80], catcher))

    w = max(len(r[0]) for r in rows)
    print('%-*s  %-5s  %s' % (w, '뮤테이션', 'rc', '결과  [지목한 검사]'))
    print('-' * (w + 60))
    for name, rc, verdict, catcher in rows:
        print('%-*s  %-5s  %s  [%s]' % (w, name, rc, verdict, catcher))

    print('')
    print('원본 정상=True · 뮤테이션 %d종 · 탐지 %d · 미탐지 %d · 엉뚱탐지 %d · 주입실패 %d · 하네스이상 %d'
          % (len(MUTS), len(detected), len(missed), len(stray), len(inject_fail), len(harness)))
    if inject_fail or harness:
        sys.exit(2)
    if missed or stray:
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
