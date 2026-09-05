#!/usr/bin/env python3
"""검사기의 검출력을 증명한다 — 통과 개수는 증거가 아니다.

결함 7종마다 **그 검사가 잡아야 할 결함**을 하나씩 실제 소스에 넣고, ★지목한 검사가 붉는지를
본다. 다른 검사가 대신 붉어서 종료코드가 바뀌는 것은 무임승차라 인정하지 않으므로
`--only` 로 **그 검사만** 돌려 판정한다.

원본은 바이트로 떠 두었다가 반드시 되돌리고, 되돌린 뒤 **해시로 원상 복구를 확인**한다.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from palette_color import contrast, hex2hsl, hsl2hex  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKER = os.path.join(ROOT, 'tools', 'check_palette.py')


def rd(rel):
    return io.open(os.path.join(ROOT, rel), 'rb').read()


def wr(rel, b):
    io.open(os.path.join(ROOT, rel), 'wb').write(b)


def sub_once(rel, old, new):
    b = rd(rel)
    o, n = old.encode('utf-8'), new.encode('utf-8')
    if b.count(o) != 1:
        raise SystemExit(f"STOP: {rel} 의 앵커가 {b.count(o)}개다 — 유일해야 한다: {old!r}")
    wr(rel, b.replace(o, n, 1))


def light_block(rel):
    s = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
    i = s.index(':root{')
    return s[i:s.index('}', i)]


def dark_block(rel):
    s = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
    m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', s)
    k = s.index(':root{', m.end())
    return s[k:s.index('}', k)]


def tok(block, name):
    return re.search(re.escape(name) + r'\s*:\s*(#[0-9a-fA-F]{6})', block).group(1)


# ── 결함 5종 ────────────────────────────────────────────────────────────────
def mut_category(spec):
    """(1) 한 게임의 --sig 를 옆 분류 색으로."""
    victim, other = 'sudoku/index.html', spec['categories']['stress']['sig']
    cur = tok(light_block(victim), '--sig')
    sub_once(victim, f'--sig:{cur};', f'--sig:{other};')
    return ('1', 3), f"sudoku 라이트 --sig {cur} -> 옆 분류(스트레스) 색 {other}"


def mut_contrast(spec):
    """(2) --sig-soft 를 ink 대비 2.9 로."""
    victim = 'word/index.html'
    blk = light_block(victim)
    cur_soft, ink = tok(blk, '--sig-soft'), tok(blk, '--sig-ink')
    h, s, _ = hex2hsl(cur_soft)
    best = None
    for i in range(0, 1001):
        L = i / 10.0
        cand = hsl2hex(h, s, L)
        d = abs(contrast(ink, cand) - 2.9)
        if best is None or d < best[0]:
            best = (d, cand, contrast(ink, cand))
    sub_once(victim, f'--sig-soft:{cur_soft};', f'--sig-soft:{best[1]};')
    return ('2', 3), f"word 라이트 --sig-soft {cur_soft} -> {best[1]} (ink 대비 {best[2]:.2f})"


def mut_dark_hue(spec):
    """(3) 다크 --sig 를 색상 60도 틀어서."""
    victim = 'memory/index.html'
    cur = tok(dark_block(victim), '--sig')
    h, s, l = hex2hsl(cur)
    new = hsl2hex(h + 60, s, l)
    sub_once(victim, f'--sig:{cur};', f'--sig:{new};')
    return ('3', 3), f"memory 다크 --sig {cur} -> {new} (색상 +60도)"


def mut_within(spec):
    """(4) 같은 분류 두 게임을 구별되지 않게(ΔE2000 0)."""
    a, b = 'nonogram/index.html', 'sudoku/index.html'
    twin = tok(light_block(b), '--sig')
    cur = tok(light_block(a), '--sig')
    sub_once(a, f'--sig:{cur};', f'--sig:{twin};')
    return ('4', 3), f"nonogram 라이트 --sig {cur} -> sudoku 와 같은 {twin} (ΔE2000 0)"


def mut_on_sig(spec):
    """(5) --on-sig 를 --sig 위에서 4.5 를 못 넘는 값으로.

    ★이 축은 이번 교체가 실제로 위험에 빠뜨리는 자리다 — 주색의 명도가 바뀌면 그 위 글자가
    먼저 무너진다(2048 을 amber 에서 blue 로 옮기면 검은 글자가 5.57 에서 3.43 으로 떨어진다).
    """
    victim = '2048/index.html'
    blk = light_block(victim)
    cur_on, sig = tok(blk, '--on-sig'), tok(blk, '--sig')
    h, s_, _ = hex2hsl(sig)
    best = None
    for i in range(0, 1001):
        L = i / 10.0
        cand = hsl2hex(h, s_, L)
        c = contrast(cand, sig)
        # 하한 바로 아래 한 톨(4.4999)로 놓으면 부동소수 가장자리에서 판정이 흔들린다.
        # 명백히 미달인 4.0 근처를 고른다 — 잡히는지가 문제이지 아슬아슬한지가 문제가 아니다.
        if best is None or abs(c - 4.0) < abs(best[1] - 4.0):
            best = (cand, c)
    sub_once(victim, f'--on-sig:{cur_on};', f'--on-sig:{best[0]};')
    return ('2', 3), f"2048 라이트 --on-sig {cur_on} -> {best[0]} (sig 위 대비 {best[1]:.2f})"


def mut_missing_category(spec):
    """(6) games.json 에서 한 게임의 category 를 뺀다 → 판정 불가(rc=2 · 반환 경로 A).

    ★로더가 던지므로 검사를 하나도 못 돌린 채 즉시 2 로 끝난다. 이 자리는 '분류가 없으면
    분모가 0 이 되어 아무 쌍도 못 재는데 조용히 통과한다' 는 구멍을 막는 방벽인데, 지금까지
    한 번도 시험을 안 받았다. 그래서 검사 이름을 대지 않고 전체 실행으로 잰다.
    """
    rel = 'games.json'
    s = io.open(os.path.join(ROOT, rel), encoding='utf-8', newline='').read()
    old = '"category": "group",'
    if s.count(old) != 1:
        raise SystemExit(f"STOP: {rel} 의 앵커가 유일하지 않다: {old}")
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='').write(s.replace(old, '', 1))
    return (None, 2), 'games.json 에서 ladder 의 category 제거 (반환 경로 A · 로더가 던진다)'


def mut_unknown_metric(spec):
    """(7) 정본의 색차 척도를 모르는 값으로 → 판정 불가(rc=2 · 반환 경로 B).

    ★개별 검사가 던지는 경로다. 경로 A 와 배선이 달라 한쪽만 시험하면 다른 쪽이 무력해도 모른다.
    """
    rel = 'tools/palette_by_category.json'
    s = io.open(os.path.join(ROOT, rel), encoding='utf-8', newline='').read()
    old = '"metric": "ciede2000"'
    if s.count(old) != 1:
        raise SystemExit(f"STOP: {rel} 의 앵커가 유일하지 않다: {old}")
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='').write(
        s.replace(old, '"metric": "made-up-metric"', 1))
    return ('4', 2), '정본 distinctness.metric 을 모르는 값으로 (반환 경로 B · 검사4 가 던진다)'


MUTATIONS = [mut_category, mut_contrast, mut_dark_hue, mut_within, mut_on_sig,
             mut_missing_category, mut_unknown_metric]
TOUCHED = ['sudoku/index.html', 'word/index.html', 'memory/index.html',
           'nonogram/index.html', '2048/index.html', 'games.json',
           'tools/palette_by_category.json']


# ★기대와 실제를 한 칸에 접지 않는다. 기대별로 뜻이 다른 2x3 여섯 칸이다 —
#   접으면 '가드가 사라졌다' 와 '검사가 없다' 와 '하네스가 고장났다' 가 같은 말이 된다.
CELLS = {
    (3, 3): ('정상', '붉어야 할 것이 붉었다'),
    (3, 0): ('검출 실패', '그 검사는 없는 것이다 — 검사기/제품 결함'),
    (3, 2): ('측정 오염', '시험이 성립하지 않았다 — ★하네스 결함이지 제품 결함이 아니다'),
    (2, 2): ('정상', '판정 불가가 판정 불가로 나왔다'),
    (2, 0): ('★가드 무력', 'INDET 이 삼켜져 통과로 접혔다 — 이 표본이 존재하는 이유 그 자체'),
    (2, 3): ('오분류', '판정 불가가 미달로 샜다'),
}


def classify(expect, actual):
    return CELLS.get((expect, actual), ('미정의', f'기대 {expect} · 실제 {actual} 는 표에 없는 칸이다'))


def run_checker(only=None):
    cmd = [sys.executable, CHECKER] + (['--only', only] if only else [])
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def main():
    stage1 = '--stage1' in sys.argv     # 1단계 — 새 TOUCHED 두 파일의 복구·해시대조부터 보인다
    spec = json.load(open(os.path.join(ROOT, 'tools/palette_by_category.json'), encoding='utf-8'))
    backup = {rel: rd(rel) for rel in TOUCHED}
    digest = {rel: hashlib.sha256(b).hexdigest() for rel, b in backup.items()}

    rc0, out0 = run_checker()
    print(f"[기준선] 결함 없는 상태: rc={rc0}")
    print('   ' + out0.strip().replace('\n', '\n   '))
    if rc0 != 0:
        raise SystemExit('STOP: 결함을 넣기 전부터 붉다 — 검출력을 증명할 수 없다')

    verdicts = []
    try:
        for fn in (MUTATIONS[:5] if stage1 else MUTATIONS):
            for rel, b in backup.items():
                wr(rel, b)
            (which, expect), what = fn(spec)
            rc_only, out_only = run_checker(which)
            rc_all, _ = run_checker()
            verdicts.append((which, expect, what, rc_only, rc_all, out_only.strip()))
    finally:
        for rel, b in backup.items():
            wr(rel, b)
        bad = [rel for rel, d in digest.items()
               if hashlib.sha256(rd(rel)).hexdigest() != d]
        # ★어느 파일을 대조했는지 적는다 — 목록이 없으면 '해시 일치' 가 무엇을 덮는지 알 수 없다.
        print(f"\n[원상 복구] 대조 대상 {len(digest)}개: {chr(32).join(sorted(digest))}")
        print('   ' + ('전 파일 해시 일치' if not bad else f'★복구 실패: {bad}'))
        if bad:
            raise SystemExit(2)

    print('\n[검출력 증명]' + (' — 1단계(기존 5종만 · 새 TOUCHED 두 파일의 복구·해시대조 확인)' if stage1 else ''))
    tally = {}
    for which, expect, what, rc_only, rc_all, out in verdicts:
        label, why = classify(expect, rc_only)
        tally[(expect, rc_only)] = tally.get((expect, rc_only), 0) + 1
        scope = f"검사{which}만" if which else '전체'
        print(f"  {scope} 실행 → 기대 rc={expect} · 실제 rc={rc_only} → [{label}] {why} · 전체 실행 rc={rc_all}")
        print(f"     넣은 결함: {what}")
        for line in out.splitlines():
            print(f"     | {line}")

    print('\n[판정 행렬] 기대 x 실제 — 대각선(정상) 밖이 하나라도 있으면 미달이다')
    off = 0
    for key in sorted(CELLS):
        n = tally.get(key, 0)
        label = CELLS[key][0]
        if n and label != '정상':
            off += n
        print(f"  기대 {key[0]} · 실제 {key[1]} · {label:<9} : {n}건")
    unknown = sum(v for k, v in tally.items() if k not in CELLS)
    if unknown:
        off += unknown
        print(f"  표에 없는 칸                : {unknown}건")
    allok = off == 0

    rc1, out1 = run_checker()
    print(f"\n[복구 후 재검사] rc={rc1}")
    if not allok or rc1 != 0:
        print('★기대한 rc 가 안 나온 표본이 있다 — 그 축은 증명되지 않았다. 고치고 다시 증명하라.')
        return 3
    fails = tally.get((3, 3), 0)
    indets = tally.get((2, 2), 0)
    print(f'{len(verdicts)}종 전부 기대한 칸에 떨어졌다(미달 {fails}건 · 판정불가 {indets}건). 결함을 빼면 다시 초록이다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
