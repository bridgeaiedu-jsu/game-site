#!/usr/bin/env python3
"""검사기의 검출력을 증명한다 — 통과 개수는 증거가 아니다.

검사 5종마다 **그 검사가 잡아야 할 결함**을 하나씩 실제 소스에 넣고, ★지목한 검사가 붉는지를
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
    return '1', f"sudoku 라이트 --sig {cur} -> 옆 분류(스트레스) 색 {other}"


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
    return '2', f"word 라이트 --sig-soft {cur_soft} -> {best[1]} (ink 대비 {best[2]:.2f})"


def mut_dark_hue(spec):
    """(3) 다크 --sig 를 색상 60도 틀어서."""
    victim = 'memory/index.html'
    cur = tok(dark_block(victim), '--sig')
    h, s, l = hex2hsl(cur)
    new = hsl2hex(h + 60, s, l)
    sub_once(victim, f'--sig:{cur};', f'--sig:{new};')
    return '3', f"memory 다크 --sig {cur} -> {new} (색상 +60도)"


def mut_within(spec):
    """(4) 같은 분류 두 게임을 구별되지 않게."""
    a, b = 'nonogram/index.html', 'sudoku/index.html'
    twin = tok(light_block(b), '--sig')
    cur = tok(light_block(a), '--sig')
    sub_once(a, f'--sig:{cur};', f'--sig:{twin};')
    return '4', f"nonogram 라이트 --sig {cur} -> sudoku 와 같은 {twin} (ΔEok 0)"


def mut_id_set(spec):
    """(5) FALLBACK 에서 id 하나 빼서."""
    rel = 'index.html'
    s = io.open(os.path.join(ROOT, rel), encoding='utf-8', newline='').read()
    a = s.index('const FALLBACK')
    b = s.index('let games = FALLBACK')
    body = s[a:b]
    parts = body.split('},{')
    keep = [p for p in parts if "id:'ladder'" not in p]
    if len(keep) != len(parts) - 1:
        raise SystemExit('STOP: FALLBACK 에서 ladder 한 덩어리를 못 골랐다')
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='').write(
        s[:a] + '},{'.join(keep) + s[b:])
    return '5', 'index.html FALLBACK 에서 ladder 한 덩어리 제거'


MUTATIONS = [mut_category, mut_contrast, mut_dark_hue, mut_within, mut_id_set]
TOUCHED = ['sudoku/index.html', 'word/index.html', 'memory/index.html',
           'nonogram/index.html', 'index.html']


def run_checker(only=None):
    cmd = [sys.executable, CHECKER] + (['--only', only] if only else [])
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def main():
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
        for fn in MUTATIONS:
            for rel, b in backup.items():
                wr(rel, b)
            which, what = fn(spec)
            rc_only, out_only = run_checker(which)
            rc_all, _ = run_checker()
            ok = rc_only == 3
            verdicts.append((which, what, rc_only, rc_all, ok, out_only.strip()))
    finally:
        for rel, b in backup.items():
            wr(rel, b)
        bad = [rel for rel, d in digest.items()
               if hashlib.sha256(rd(rel)).hexdigest() != d]
        print('\n[원상 복구] ' + ('전 파일 해시 일치' if not bad else f'★복구 실패: {bad}'))
        if bad:
            raise SystemExit(2)

    print('\n[검출력 증명]')
    allok = True
    for which, what, rc_only, rc_all, ok, out in verdicts:
        mark = '붉음' if ok else '★안 붉음'
        print(f"  검사{which}만 실행 → rc={rc_only} ({mark}) · 전체 실행 rc={rc_all}")
        print(f"     넣은 결함: {what}")
        for line in out.splitlines():
            print(f"     | {line}")
        allok &= ok

    rc1, out1 = run_checker()
    print(f"\n[복구 후 재검사] rc={rc1}")
    if not allok or rc1 != 0:
        print('★붉지 않은 검사가 있다 — 그 검사는 없는 것이다. 고치고 다시 증명하라.')
        return 3
    print('5종 전부 자기 결함에서 붉었고, 결함을 빼면 다시 초록이다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
