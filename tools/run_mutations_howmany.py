#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_howmany.js 의 검출력 검산 · worker(238) · 2026-09-04 · 티켓 T0904-howmany

`verify_howmany.js` 가 **고의 결함을 정말로 잡는지** 를 뮤테이션 전수 주입으로 검산한다.
검사기의 유일한 실패 양식은 '규칙은 있는데 판정을 짊어지지 않는 것(공허)' 이라, 계약을
하나씩 깨뜨린 사본으로 검증기를 돌려 **지목한 검사가 붉어지는지** 를 본다.

'탐지' 의 정의가 엄격하다 · 다음 셋을 모두 만족해야 탐지로 센다:
  · 종료코드가 1 이고(0 = 못 잡음 · 2 = 검사를 세우지 못함 → 탐지 아님)
  · 뮤테이션이 **지목한 검사**(catcher)가 실제로 FAIL 목록에 있고
  · 최종 요약행(`PASS n · FAIL n`)에 도달했다(예외로 죽은 것은 탐지가 아니다)

'무임승차' 차단: 다른 검사가 우연히 깨져서 rc=1 이 된 것은 탐지로 인정하지 않는다.
'주입 실패'(앵커 노후화)는 검출력 저하와 **별개로 세어** 표에 그대로 남긴다 ·
둘을 뭉뚱그리면 '검출력이 떨어졌다' 는 오독을 부른다.

★음성 대조군(expect quiet)은 반대로 센다 — **rc=0 이어야 통과**다. 붉어야 할 것만
시험하면 오탐 방향이 열린 채로 초록이 된다(연출 시간·도형 색은 계약이 아니다).

사용법:
  python3 tools/run_mutations_howmany.py
  python3 tools/run_mutations_howmany.py --html how-many/index.html
종료코드:
  0 = 전부 지목 검사로 탐지(음성 대조군은 조용) + 원본 정상(rc=0)
  1 = 검출력 실패(미탐지·엉뚱탐지·음성 대조군이 붉음)
  2 = 하네스 비정상(주입 실패·예외 중단·요약행 미도달·원본이 이미 FAIL·CLI 오류)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFIER = os.path.join(ROOT, 'tools', 'verify_howmany.js')

argv = sys.argv[1:]


def arg_of(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


HTML = arg_of('--html', os.path.join(ROOT, 'how-many', 'index.html'))

SUMMARY_RE = re.compile(r'^PASS (\d+) · FAIL (\d+)$', re.M)
FAIL_RE = re.compile(r'^  FAIL  (.+?)(?: — |$)', re.M)

# ══ ★러너가 쥐는 기대 목록 ══════════════════════════════════════════
# 이 목록을 ★대상에게 물어보지 않는다. 물어보면 문제도 정답도 채점 기준도 피검사자가 낸다 ·
# 대상에서 뮤테이션이 사라지면 목록도 함께 줄어 '35→34' 가 초록으로 지나간다.
# 아래는 이 러너가 **독립 리터럴로** 쥔 (뮤테이션 이름, 이 결함을 잡아야 하는 검사) 쌍이고,
# 대상이 내놓는 --list-mutations 는 근거가 아니라 ★대조 상대다.
MUTS = [
    ('gap-uses-round', '정답과 최근접 오답의 비율이 하한을 지킨다'),
    ('gap-uses-tenth', '정답과 최근접 오답의 비율이 하한을 지킨다'),
    ('options-drop-answer', '보기 넷은 정답을 둘째로 하는 등차 넷이다'),
    ('exposure-not-shrinking', '개수당 노출이 라운드마다 줄어든다'),
    ('ranges-detached', '개수 구간이 서로 맞닿는다'),
    ('exposure-floor-lowered', '노출의 바닥이 선언된 값과 같다'),
    ('slots-fixed-two-each', '자리 예측 불가(관측 상한 기준)'),
    ('slot-cap-four', '정답 자리 쏠림이 상한 안이다'),
    ('slot-cap-gone', '정답 자리 쏠림이 상한 안이다'),
    ('others-sorted', '나머지 세 보기의 자리가 늘 크기순은 아니다'),
    ('jitter-too-wide', '도형이 서로 겹치지 않는다'),
    ('dot-too-big', '도형이 서로 겹치지 않는다'),
    ('cells-reused', '도형은 서로 다른 칸에 하나씩 놓인다'),
    ('hide-before-due', '마감 전에 깬 타이머는 사라지게 하지 않는다'),
    ('hide-stamp-uses-now', '사라짐은 마감 시각으로 확정한다'),
    ('rt-from-show', '반응 시간은 마감부터 잰다'),
    ('right-not-scored', '맞히면 그 자리에서 점수가 오른다'),
    ('commit-deferred', '논리는 누른 순간 확정된다'),
    ('answers-open-during-show', '보는 중에는 보기가 잠긴다'),
    ('rng-on-play', '플레이 행동은 난수를 한 번도 소비하지 않는다'),
    ('daily-seed-uses-clock', '같은 날이면 시각이 달라도 같은 판이다'),
    ('best-updates-in-daily', '오늘의 도전은 최고 기록을 건드리지 않는다'),
    ('tie-ignores-avg', '같은 점수면 평균 반응이 빠른 쪽이 최고 기록이다'),
    ('daily-overwrite', '오늘의 도전은 하루 한 번이다'),
    ('marks-color-only', '맞고 틀림이 색만이 아니라 글자로도 말한다'),
    ('answer-not-revealed', '틀리면 정답 자리에도 표가 붙는다'),
    ('repeat-guard-gone', '누르고 있어서 반복 발화된 숫자 입력은 무시된다'),
    ('key-no-preventdefault', 'Enter 로 눌렀을 때 preventDefault 가 호출된다'),
    ('inert-gone', '시작 창이 열려 있으면 창 밖 요소에 inert 가 붙는다'),
    ('en-prose-missing', '마크업의 data-i18n 키가 ko·en 두 표에 모두 있다'),
    ('lang-switch-redraws-plan', '언어를 바꿔도 진행 중인 판이 바뀌지 않는다'),
    ('touch-target-shrunk', '보기 칸은 360px 에서 짧은 변이 50px 하한을 지킨다'),
    ('answers-gap-widened', '이 셈이 실브라우저 실측(보기 칸 폭)을 재현한다'),
]

# ★음성 대조군 — 붉으면 안 된다(계약이 아닌 것을 계약으로 굳혔다는 뜻이다)
QUIET = [
    ('feedback-longer', '연출(정답을 보여 주는) 시간은 계약이 아니다'),
    ('dot-color-changed', '도형 색은 계약이 아니다(지름·자리는 계약이고 위에서 붉게 잡힌다)'),
]

EXPECTED_COUNT = 35          # ★tools/README.md 의 '사본 N종' 과 같은 수여야 한다(아래에서 대조한다)
README_COUNT_RE = re.compile(r'몇 개였지 의 계약을 하나씩 깨뜨린 사본 (\d+)종')


def readme_declared_count():
    """README 가 선언한 종수를 읽는다 · 못 읽으면 None(판정 불가로 올린다)."""
    path = os.path.join(ROOT, 'tools', 'README.md')
    try:
        with open(path, encoding='utf-8') as f:
            m = README_COUNT_RE.search(f.read())
    except OSError:
        return None
    return int(m.group(1)) if m else None


def run(args):
    p = subprocess.run([node_bin()] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def node_bin():
    return 'node'


def main():
    names = [m[0] for m in MUTS] + [q[0] for q in QUIET]
    if len(set(names)) != len(names):
        print('러너 오류: 뮤테이션 이름이 중복이다', file=sys.stderr)
        return 2
    if len(names) != EXPECTED_COUNT:
        print('러너 오류: 기대 목록 %d개 != 선언 %d개' % (len(names), EXPECTED_COUNT), file=sys.stderr)
        return 2

    declared = readme_declared_count()
    if declared is None:
        print('판정 불가: tools/README.md 에서 종수 선언을 못 읽었다', file=sys.stderr)
        return 2
    if declared != EXPECTED_COUNT:
        print('판정 불가: README 선언 %d종 != 러너 기대 %d종' % (declared, EXPECTED_COUNT), file=sys.stderr)
        return 2

    # ★대상이 내놓는 목록과 양방향 차집합을 본다 — 한 방향만 보면 한쪽이 조용히 는다/준다
    rc, out = run([VERIFIER, '--list-mutations'])
    if rc != 0:
        print('판정 불가: --list-mutations 실패(rc=%d)' % rc, file=sys.stderr)
        return 2
    theirs = set(line.split('\t')[0] for line in out.strip().splitlines() if line.strip())
    mine = set(names)
    only_theirs, only_mine = sorted(theirs - mine), sorted(mine - theirs)
    if only_theirs or only_mine:
        print('판정 불가: 뮤테이션 목록 불일치 · 대상에만 %s · 러너에만 %s' % (only_theirs, only_mine), file=sys.stderr)
        return 2

    # ★원본이 이미 붉으면 검출력을 잴 수 없다(기준선이 없다)
    rc, out = run([VERIFIER, '--html', HTML])
    if rc != 0:
        print('판정 불가: 원본이 이미 FAIL(rc=%d)' % rc, file=sys.stderr)
        print(out[-2000:], file=sys.stderr)
        return 2
    base = SUMMARY_RE.search(out)
    if not base:
        print('판정 불가: 원본 실행이 요약행에 도달하지 못했다', file=sys.stderr)
        return 2
    print('원본: PASS %s · FAIL %s' % (base.group(1), base.group(2)))
    print('')

    detected, missed, wrong, inject_fail, quiet_ok, quiet_bad = [], [], [], [], [], []
    for name, catcher in MUTS:
        rc, out = run([VERIFIER, '--html', HTML, '--mutate', name])
        summary = SUMMARY_RE.search(out)
        fails = FAIL_RE.findall(out)
        if rc == 2:
            inject_fail.append(name)
            mark = 'INJECT-FAIL'
        elif rc == 0:
            missed.append(name)
            mark = 'MISSED'
        elif not summary:
            inject_fail.append(name)
            mark = 'NO-SUMMARY'
        elif catcher in fails:
            detected.append(name)
            mark = 'detected'
        else:
            wrong.append((name, fails[:2]))
            mark = 'WRONG-CATCHER'
        print('  %-26s %-13s %s' % (name, mark, catcher))

    for name, why in QUIET:
        rc, out = run([VERIFIER, '--html', HTML, '--mutate', name])
        summary = SUMMARY_RE.search(out)
        if rc == 2 or not summary:
            inject_fail.append(name)
            mark = 'INJECT-FAIL'
        elif rc == 0:
            quiet_ok.append(name)
            mark = 'quiet(OK)'
        else:
            quiet_bad.append((name, FAIL_RE.findall(out)[:2]))
            mark = 'NOISY'
        print('  %-26s %-13s (음성 대조군) %s' % (name, mark, why))

    print('')
    print('탐지 %d · 미탐지 %d · 엉뚱탐지 %d · 주입실패 %d · 음성대조군 조용 %d/%d'
          % (len(detected), len(missed), len(wrong), len(inject_fail), len(quiet_ok), len(QUIET)))
    if missed:
        print('  미탐지: ' + ', '.join(missed))
    if wrong:
        for name, fails in wrong:
            print('  엉뚱탐지: %s (붉은 검사: %s)' % (name, fails))
    if quiet_bad:
        for name, fails in quiet_bad:
            print('  음성 대조군이 붉었다: %s (붉은 검사: %s)' % (name, fails))
    if inject_fail:
        print('  주입실패·요약미도달: ' + ', '.join(inject_fail))
        return 2
    return 1 if (missed or wrong or quiet_bad) else 0


if __name__ == '__main__':
    sys.exit(main())
