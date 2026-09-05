#!/usr/bin/env python3
"""산출한 분류 색을 소스에 적는다. `--dry` 로 먼저 보고 `--write` 로 쓴다.

건드리는 것
  - 게임 22종 페이지의 라이트/다크 :root 중 `--sig` `--sig-ink` `--sig-soft` `--on-sig`
  - 그 페이지의 **판 계열 토큰 중 옛 시그니처 색조로 물든 것**만 새 색조로 돌린다.
    ★판을 안 옮기면 카드가 여전히 옛 색으로 보인다(규약). 회색 판은 색조가 없으니 그대로 둔다.
  - 대문 `index.html` 의 카드별 색 배선(22종 · 라이트/다크)

건드리지 않는 것
  - 사이트 공통 크롬(`--bg` `--panel` `--panel2` `--line` `--text` `--muted*` 등)
  - 게임 로직·판 크기·글자
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette_gen as G  # noqa: E402
from palette_color import hex2hsl, hex2lch, hsl2hex, huedist  # noqa: E402

ROOT = G.ROOT
SIG_TOKENS = ('--sig', '--sig-ink', '--sig-soft', '--on-sig')

# 판을 물들인 색인지 가르는 기준 — 회색은 색조가 없다
TINT_MIN_CHROMA = 0.012
TINT_HUE_TOL = 30.0

# ★'판' 은 게임이 놓이는 바닥이지 그 위의 말·타일·의미색이 아니다.
# 이름으로 판만 고른다 — 이 울타리가 없으면 블록 퍼즐의 무지개 조각, 2048 의 타일 등급색,
# 오늘의 낱말의 정답·오답 색까지 색조가 끌려간다(실측으로 확인하고 좁혔다).
BOARD_NAMES = re.compile(r'^--(pad|board|track|grid|frame)(-[a-z0-9-]+)?$')


def read(path):
    return io.open(path, encoding='utf-8', newline='').read()


def write(path, s):
    io.open(path, 'w', encoding='utf-8', newline='').write(s)


def block_span(src, which):
    """라이트/다크 :root 블록의 (시작, 끝) 오프셋."""
    i = src.index(':root{')
    j = src.index('}', i)
    if which == 'light':
        return i, j
    m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', src)
    k = src.index(':root{', m.end())
    return k, src.index('}', k)


def set_token(block, name, value):
    pat = re.compile(r'(' + re.escape(name) + r'\s*:\s*)#[0-9a-fA-F]{3,8}')
    if not pat.search(block):
        raise SystemExit(f"STOP: {name} 를 못 찾았다 — 앵커가 유일한지 먼저 확인하라")
    if len(pat.findall(block)) > 1:
        raise SystemExit(f"STOP: {name} 앵커가 여러 개다 — 첫 매치가 원한 자리가 아닐 수 있다")
    return pat.sub(lambda m: m.group(1) + value, block, count=1)


def retint_board(block, old_hue, new_hue):
    """판 계열 토큰 중 옛 색조로 물든 것만 새 색조로 돌린다(명도·채도는 그대로)."""
    moved = []
    def repl(m):
        name, hexv = m.group(1), m.group(2)
        if not BOARD_NAMES.match(name):
            return m.group(0)
        h, s, l = hex2hsl(hexv)
        if hex2lch(hexv)[1] < TINT_MIN_CHROMA:
            return m.group(0)
        if huedist(h, old_hue) > TINT_HUE_TOL:
            return m.group(0)
        if huedist(old_hue, new_hue) < 1.0:
            return m.group(0)          # 색조가 사실상 그대로다 — 반올림 잡음을 남기지 않는다
        new = hsl2hex(new_hue, s, l)
        moved.append((name, hexv, new))
        return f"{name}:{new}"
    out = re.sub(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})', repl, block)
    return out, moved


def apply_game(gid, vals, dry):
    path = os.path.join(ROOT, gid, 'index.html')
    src = read(path)
    notes = []
    # ★색조 이동의 기준은 **라이트 기준선 하나**다. 테마마다 따로 재면 다크 변형의 색상 오차
    #   (핑크 333.3 -> 328.6 처럼)가 판을 몇 도씩 흔들어 뜻 없는 변경만 남는다.
    a0, b0 = block_span(src, 'light')
    anchor_old = hex2hsl(re.search(r'--sig\s*:\s*(#[0-9a-fA-F]{6})', src[a0:b0]).group(1))[0]
    anchor_new = hex2hsl(vals['light']['--sig'])[0]
    for theme, key in (('light', 'light'), ('dark', 'dark')):
        a, b = block_span(src, theme)
        block = src[a:b]
        old_sig = re.search(r'--sig\s*:\s*(#[0-9a-fA-F]{6})', block).group(1)
        new_sig = vals[key]['--sig']
        block, moved = retint_board(block, anchor_old, anchor_new)
        for t in SIG_TOKENS:
            block = set_token(block, t, vals[key][t])
        notes.append((theme, old_sig, new_sig, moved))
        src = src[:a] + block + src[b:]
    if not dry:
        write(path, src)
    return notes


CARD_RULE = '  .card[href="/%s/"]{--sig:%s;--sig-ink:%s}'


def apply_index(order, values, dry):
    path = os.path.join(ROOT, 'index.html')
    src = read(path)
    nl = '\r\n' if '\r\n' in src else '\n'

    # 1) 옛 per-game 토큰 정의 줄을 지운다(이제 카드 규칙이 직접 색을 든다)
    for pat in (r'[ \t]*--sig-block:[^\n]*\n', r'[ \t]*--ink-block:[^\n]*\n'):
        src = re.sub(pat, '', src)

    # 2) 옛 카드 규칙 4줄을 22줄로 갈아 끼운다(라이트)
    old = re.compile(r'([ \t]*\.card\[href="/[^"]*/"\]\{--sig:var\(--sig-[a-z0-9]+\);--sig-ink:var\(--ink-[a-z0-9]+\)\}\r?\n)+')
    light_rules = nl.join(CARD_RULE % (g, values[g]['light']['--sig'], values[g]['light']['--sig-ink'])
                          for g in order) + nl
    if not old.search(src):
        raise SystemExit('STOP: 대문의 옛 카드 규칙 덩어리를 못 찾았다')
    src = old.sub(light_rules.replace('\\', '\\\\'), src, count=1)

    # 3) 다크 @media 안에 카드 규칙을 넣는다 — :root 블록 바로 뒤
    m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', src)
    k = src.index(':root{', m.end())
    end = src.index('}', k) + 1
    dark_rules = (nl + '    /* 다크 — 카드마다 그 게임의 다크 시그니처로 갈아 끼운다 */' + nl
                  + nl.join('    ' + (CARD_RULE % (g, values[g]['dark']['--sig'], values[g]['dark']['--sig-ink'])).strip()
                            for g in order))
    if '.card[href=' in src[k:end + 400] and '다크 — 카드마다' in src:
        raise SystemExit('STOP: 다크 카드 규칙이 이미 있다 — 두 번 넣지 않는다')
    src = src[:end] + dark_rules + src[end:]

    if not dry:
        write(path, src)
    return len(order)


def main(argv):
    dry = '--write' not in argv
    spec, games = G.load()
    pages = {g['id']: G.read_root_blocks(os.path.join(ROOT, g['id'], 'index.html')) for g in games}
    pages['@index'] = G.read_root_blocks(os.path.join(ROOT, 'index.html'))
    by_cat = {}
    for g in games:
        by_cat.setdefault(g['category'], []).append(g['id'])
    values = {}
    for cat, ids in by_cat.items():
        base = spec['categories'][cat]['sig']
        hue, sat, baseL = hex2hsl(base)
        same = [i for i in ids if pages[i][0]['--sig'].lower() == base.lower()]
        rep = (same or ids)[0]
        light = G.light_ladder(hue, sat, baseL, rep, ids, pages, spec)
        dark = G.dark_ladder(hue, sat, baseL, light, pages, spec)
        for gid in ids:
            values[gid] = {'light': light[gid], 'dark': dark[gid]}

    order = [g['id'] for g in games]
    for gid in order:
        for theme, old_sig, new_sig, moved in apply_game(gid, values[gid], dry):
            tail = ''.join(f"\n      판 {n}: {o} -> {x}" for n, o, x in moved)
            print(f"{gid:14} {theme:5} --sig {old_sig} -> {new_sig}{tail}")
    n = apply_index(order, values, dry)
    print(f"대문 카드 배선 {n}종 (라이트+다크)")
    print('DRY RUN — 쓰지 않았다. --write 로 적용한다.' if dry else '적용했다.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
