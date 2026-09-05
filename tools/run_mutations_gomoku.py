#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_gomoku.js 의 검출력 검산 · worker(244) · 2026-09-05 · 티켓 T0906-gomoku

`verify_gomoku.js` 가 **고의 결함을 정말로 잡는지** 를 뮤테이션 전수 주입으로 검산한다.
검사기의 유일한 실패 양식은 '규칙은 있는데 판정을 짊어지지 않는 것(공허)' 이라, 계약을
하나씩 깨뜨린 사본으로 검증기를 돌려 **지목한 검사가 붉어지는지** 를 본다.

이 게임의 계약은 하나다 — **이겼다고 말할 때만 이겼고, 이겼으면 반드시 이겼다고 말한다.**
그래서 붉은 표본에 ★거짓 양성 쪽(안 이겼는데 이겼다고 하는 결함)을 반드시 넣는다:
넷을 다섯으로 세기(m-four-wins) · 판을 넘어가는 줄(m-wrap-edge) · 상대 돌을 섞어 세기
(m-mixed-stone). 거짓 양성은 게임을 그 자리에서 끝내므로 거짓 음성보다 무겁다.

'탐지' 의 정의가 엄격하다 · 다음 셋을 모두 만족해야 탐지로 센다:
  · 종료코드가 1 이고(0 = 못 잡음 · 3 = 지목 검사가 못 잡음 · 2 = 검사를 세우지 못함 → 탐지 아님)
  · 뮤테이션이 **지목한 검사**(catcher)가 실제로 ✗ 목록에 있고
  · 최종 요약행(`결과: 통과 n · 미달 n · 판정 불가 n`)에 도달했다(예외로 죽은 것은 탐지가 아니다)

'무임승차' 차단: 다른 검사가 우연히 깨져서 rc=1 이 된 것은 탐지로 인정하지 않는다.
'주입 실패'(앵커 노후화)는 검출력 저하와 **별개로 세어** 표에 그대로 남긴다 —
둘을 뭉뚱그리면 '검출력이 떨어졌다' 는 오독을 부른다.

★음성 대조군(quiet)은 반대로 센다 — **rc=0 이어야 통과**다. 붉어야 할 것만 시험하면
'무엇을 건드려도 붉는' 검사기가 만점을 받는다.

사용법:
  python3 tools/run_mutations_gomoku.py
  python3 tools/run_mutations_gomoku.py --html gomoku/index.html
종료코드:
  0 = 붉은 표본 전부 지목 검사로 탐지 + 음성 대조군 전부 조용 + 원본 정상(rc=0)
  1 = 검출력 실패(미탐지·엉뚱탐지·음성 대조군이 붉음)
  2 = 하네스 비정상(주입 실패·예외 중단·요약행 미도달·원본이 이미 미달·CLI 오류)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFIER = os.path.join(ROOT, 'tools', 'verify_gomoku.js')

argv = sys.argv[1:]


def arg_of(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


HTML = arg_of('--html', os.path.join(ROOT, 'gomoku', 'index.html'))

SUMMARY_RE = re.compile(r'^결과: 통과 (\d+) · 미달 (\d+) · 판정 불가 (\d+)$', re.M)
FAIL_RE = re.compile(r'^  ✗ \[(.+?)\] ', re.M)

# ══ ★러너가 쥐는 기대 목록 ══════════════════════════════════════════
# 이 목록을 ★대상에게 물어보지 않는다. 물어보면 문제도 정답도 채점 기준도 피검사자가 낸다 —
# 대상에서 뮤테이션이 사라지면 목록도 함께 줄어 '17→16' 이 초록으로 지나간다.
# 아래는 이 러너가 **독립 리터럴로** 쥔 (뮤테이션 이름, 이 결함을 잡아야 하는 검사) 쌍이고,
# 대상이 내놓는 --list-mutations 는 근거가 아니라 ★대조 상대다.
RED = [
    # ── 거짓 양성 쪽(계약의 앞 절반: '이겼다고 말할 때만 이겼다')
    ('m-four-wins', '넷은 승리가 아니다(거짓 양성 0)'),
    ('m-wrap-edge', '판을 넘어가는 줄은 이어진 것이 아니다(가장자리 거짓 양성 0)'),
    ('m-mixed-stone', '상대 돌이 낀 줄은 이어진 것이 아니다(거짓 양성 0)'),
    # ── 거짓 음성 쪽(계약의 뒤 절반: '이겼으면 반드시 이겼다고 말한다')
    ('m-exact-five', '여섯 이상(장목)도 승리다'),
    ('m-one-way', '가운데에 끼워 넣은 다섯도 잡는다'),
    ('m-draw-never', '판이 다 차면 무승부로 끝난다'),
    # ── 규칙 불변식
    ('m-turn-parity', '차례가 흑·백으로 번갈아 간다'),
    ('m-occupied', '이미 돌이 있는 자리에는 못 둔다'),
    ('m-play-after-end', '판이 끝난 뒤에는 못 둔다'),
    ('m-undo-unlimited', '무르기는 한 판에 한 번뿐이다'),
    ('m-undo-two', '무르기는 직전 한 수만 되돌린다'),
    ('m-no-swap', '다시 하기는 선공을 교대한다'),
    # ── 화면이 판정을 그대로 옮기는가
    ('m-stale-mark', '마지막 수 표식은 방금 둔 자리 하나뿐이다'),
    ('m-win-line-paint', '이긴 줄 표시는 판정의 줄과 같은 자리다'),
]
QUIET = ['n-beep-freq', 'n-star-points', 'n-toast-ms']


def run(args):
    p = subprocess.run([os.environ.get('NODE', 'node'), VERIFIER, '--html', HTML] + args,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def classify_red(rc, out, catcher):
    """붉어야 하는 표본 하나의 판정 — 탐지 / 미탐지 / 판정 불가 셋 중 하나."""
    if rc == 2:
        return 'indet', '주입 실패·검사 미실행(하네스가 판정을 세우지 못했다)'
    if not SUMMARY_RE.search(out):
        return 'indet', '요약행에 도달하지 못했다(예외로 죽었을 수 있다)'
    fails = set(FAIL_RE.findall(out))
    if rc == 3:
        return 'miss', '지목 검사가 잡지 못했다(그 검사가 공허하다)'
    if rc == 0:
        return 'miss', '검사기가 통째로 초록이다'
    if rc == 1 and catcher in fails:
        return 'hit', '지목 검사가 잡았다'
    if rc == 1:
        return 'miss', '붉기는 한데 지목 검사가 아니다(무임승차) — 붉은 검사: ' + (', '.join(sorted(fails)) or '없음')
    return 'indet', '알 수 없는 종료코드 %d' % rc


def main():
    bad = ind = 0
    rows = []

    # ── 원본(대조군) — 이미 미달이면 아래 표는 아무것도 증명하지 못한다
    rc, out = run([])
    m = SUMMARY_RE.search(out)
    if rc != 0 or not m:
        print('STOP: 원본이 이미 초록이 아니다(rc=%d) — 검출력을 재는 전제가 깨졌다' % rc)
        print(out[-1500:])
        return 2
    print('원본 대조군: rc=0 · 통과 %s · 미달 %s · 판정 불가 %s' % m.groups())
    print('')

    # ── 붉어야 하는 표본
    print('■ 붉어야 하는 표본 %d종 (기대 rc=1 · 지목 검사가 ✗)' % len(RED))
    for name, catcher in RED:
        rc, out = run(['--mutate', name])
        verdict, why = classify_red(rc, out, catcher)
        rows.append((name, 'red', 1, rc, verdict))
        mark = {'hit': '✓', 'miss': '✗', 'indet': '?'}[verdict]
        if verdict == 'miss':
            bad += 1
        elif verdict == 'indet':
            ind += 1
        print('  %s %-18s 기대 rc=1 · 실제 rc=%d · %s — [%s]' % (mark, name, rc, why, catcher))

    # ── 조용해야 하는 표본(음성 대조군)
    print('')
    print('■ 조용해야 하는 표본 %d종 (기대 rc=0 · 계약이 아닌 자리)' % len(QUIET))
    for name in QUIET:
        rc, out = run(['--mutate', name])
        okq = (rc == 0 and SUMMARY_RE.search(out) is not None)
        rows.append((name, 'quiet', 0, rc, 'hit' if okq else ('indet' if rc == 2 else 'miss')))
        if rc == 2:
            ind += 1
            print('  ? %-18s 기대 rc=0 · 실제 rc=2 — 주입 실패(판정 불가)' % name)
        elif not okq:
            bad += 1
            fails = ', '.join(sorted(set(FAIL_RE.findall(out)))) or '없음'
            print('  ✗ %-18s 기대 rc=0 · 실제 rc=%d — 계약이 아닌 자리를 건드렸는데 붉었다(오탐): %s' % (name, rc, fails))
        else:
            print('  ✓ %-18s 기대 rc=0 · 실제 rc=0 — 조용하다' % name)

    # ── ★판정행렬 2x3 — 기대(붉음·조용) × 결과(탐지·미탐지·판정불가)
    print('')
    print('■ 판정행렬 (기대 2 × 결과 3)')
    print('  %-10s %10s %10s %12s' % ('기대\\결과', '기대대로', '어긋남', '판정 불가'))
    for kind, label in (('red', '붉어야 함'), ('quiet', '조용해야 함')):
        sel = [r for r in rows if r[1] == kind]
        h = sum(1 for r in sel if r[4] == 'hit')
        mi = sum(1 for r in sel if r[4] == 'miss')
        ii = sum(1 for r in sel if r[4] == 'indet')
        print('  %-10s %10d %10d %12d' % (label, h, mi, ii))
    print('  ★대각선(기대대로 %d + %d) 밖의 칸이 0 이어야 통과다.'
          % (sum(1 for r in rows if r[1] == 'red' and r[4] == 'hit'),
             sum(1 for r in rows if r[1] == 'quiet' and r[4] == 'hit')))

    print('')
    if bad:
        print('결과: 검출력 실패 %d건 (판정 불가 %d건) — rc=1' % (bad, ind))
        return 1
    if ind:
        print('결과: 판정 불가 %d건 — rc=2 (통과로 세지 않는다)' % ind)
        return 2
    print('결과: 붉은 표본 %d종 전부 지목 검사로 탐지 · 음성 대조군 %d종 전부 조용 — rc=0' % (len(RED), len(QUIET)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
