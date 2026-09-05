#!/usr/bin/env python3
"""분류 색 변주 산출기 — 값을 눈으로 정하지 않는다(규약 '분류 안에서도 갈라야 한다').

기준색과 대비 짝은 `tools/palette_by_category.json` 에서, 페이지의 실제 배경 토큰은 각 게임
소스에서 읽는다. 이 파일은 값을 *만드는* 쪽이고, 만든 값이 계약을 지키는지 *판정하는* 쪽은
`tools/check_palette.py` 다 — 산출자와 판정자를 나눈다(자기채점 금지).

색 공간은 HSL 이다. 규약이 적은 수치가 HSL 이라는 것을 왕복으로 확인했다:
together 기준 #db2777 -> H=333.3 L=50.6 · 다크 #f472b6 -> H=328.6 L=70.2 · 색상차 4.7.
(OKLCH 로 재면 각각 H=0.6/349.8 · 색상차 10.8 로 규약의 숫자와 맞지 않는다.)

사다리 규칙
  - 분류마다 **대표 1종**이 기준색을 그대로 쓴다(티켓 2-3). 대표는 '지금 이미 기준색을 쓰는
    게임', 없으면 games.json 순서의 첫 게임 — 손으로 고르지 않는다.
  - 나머지는 대표의 위아래로 **명도 4%p 단계**로 갈린다.
  - 다크 --sig 는 기준색보다 **더 밝은** 변형이어야 하므로(검사3) 라이트 사다리를 그대로
    더해 쓰지 못한다. 라이트 명도 순위를 지킨 채 **기준색 위쪽에서 따로 사다리를 놓는다.**
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from palette_color import contrast, hex2hsl, hex2lch, hsl2hex, huedist  # noqa: E402
from check_rainbow import ciede2000  # noqa: E402  ★저장소에 이미 있는 색차 언어를 쓴다

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STEP = 4.0            # 분류 안 명도 단계 간격(%p) — 규약이 정한 출발값
INK_DROP = 14.0       # --sig-ink 는 주색보다 어두운(다크에선 밝은) 쪽에서 출발한다
DARKEST_INK_MAX = 12  # --on-sig 를 어두운 쪽으로 잡을 때 시도하는 명도 상한
DARKEST_INK_MIN = 4   # 그 하한 — 더 내려가면 검정과 구별되지 않는다
DARK_GAP = 2.0        # 다크 사다리의 첫 칸을 기준색보다 얼마나 위에서 시작해 보는가
DARK_LIFT = 18.0      # 다크 사다리의 중심 — 현행 관례(기준색 +18%p 남짓)
LIGHT_CHROMA_FLOOR = 0.10  # 라이트 --sig 도 색조가 살아 있어야 한다
DARK_CHROMA_FLOOR = 0.10  # 다크 --sig 가 아직 '그 색' 으로 보이는 하한(현행 시그니처 0.139~0.175 · master 존재증명 0.103)


def read_root_blocks(path):
    """페이지의 라이트/다크 :root 토큰을 읽는다. 값을 베끼지 않고 소스에서 읽는 통로."""
    src = open(path, encoding='utf-8').read()
    i = src.index(':root{')
    j = src.index('}', i)
    m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', src)
    k = src.index(':root{', m.end())
    l = src.index('}', k)
    parse = lambda t: dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})', t))
    return parse(src[i:j]), parse(src[k:l])


def load():
    spec = json.load(open(os.path.join(ROOT, 'tools/palette_by_category.json'), encoding='utf-8'))
    games = json.load(open(os.path.join(ROOT, 'games.json'), encoding='utf-8'))
    return spec, games


def pair_min(spec, pid):
    for p in spec['contrastRules']['pairs']:
        if p['id'] == pid:
            return p['min']
    raise KeyError(pid)


def pick_on_sig(sig, hue, floor):
    """sig 위에 놓을 글자색. 후보 순서는 이 저장소의 현행 관례를 따른다(실측).

    흰 글자(#ffffff) · 사이트 중립 잉크(#111827) · 같은 색상의 아주 어두운 톤(#2e1065·#03210e 계열).
    ★기준색 자체가 앞의 둘로 4.5 를 못 넘는 자리가 있다 — 말 한판 #059669 는 흰 3.77 · 중립 4.43.
    그래서 세 번째 축이 필요하고, 그것은 억지가 아니라 다크 테마가 이미 쓰는 관례다.
    """
    cands = ['#ffffff', '#111827']
    for l in range(DARKEST_INK_MAX, DARKEST_INK_MIN - 1, -1):
        cands.append(hsl2hex(hue, 70, float(l)))
    for cand in cands:
        c = contrast(cand, sig)
        if c >= floor:
            return cand, c
    return None, 0.0


def build_variant(hue, sat, L, bgs, spec):
    """한 게임의 한 테마 토큰 한 벌. 계약을 못 맞추면 None — 억지로 밀지 않는다."""
    f_sig = pair_min(spec, 'sig-on-bg')
    f_ink = pair_min(spec, 'ink-on-bg')
    f_soft = pair_min(spec, 'ink-on-soft')
    f_on = pair_min(spec, 'on-sig-on-sig')

    if isinstance(bgs, str):
        bgs = [bgs]
    sig = hsl2hex(hue, sat, L)
    if min(contrast(sig, b) for b in bgs) < f_sig:
        return None
    on_sig, _ = pick_on_sig(sig, hue, f_on)
    if on_sig is None:
        return None

    dark_bg = contrast('#ffffff', bgs[0]) > contrast('#000000', bgs[0])

    ink = ink_L = None
    for d in range(0, 60):
        if dark_bg:
            # 다크의 ink 는 주색보다 밝은 쪽이다. 천장(97)에 닿으면 명도로는 더 못 가르므로
            # 채도를 낮춰 갈라 준다 — 천장에서 그냥 포기하면 아주 밝은 칸이 통째로 막힌다.
            cand_L = min(97.0, L + INK_DROP + d)
            over = (L + INK_DROP + d) - cand_L
            cand_S = max(12.0, sat - over * 4.0)
        else:
            cand_L, cand_S = L - INK_DROP - d, sat
        if not 0 <= cand_L <= 100:
            break
        cand = hsl2hex(hue, cand_S, cand_L)
        if min(contrast(cand, b) for b in bgs) >= f_ink and cand.lower() != sig.lower():
            ink, ink_L = cand, cand_L
            break
    if ink is None:
        return None

    soft = None
    for d in range(0, 120):
        cand_L = max(6.0, 22.0 - d * 0.5) if dark_bg else min(97.5, 92.0 + d * 0.2)
        cand = hsl2hex(hue, min(sat, 60.0 if dark_bg else 90.0), cand_L)
        if contrast(ink, cand) >= f_soft:
            soft = cand
            break
    if soft is None:
        return None

    return {'--sig': sig, '--sig-ink': ink, '--sig-soft': soft, '--on-sig': on_sig,
            '_L': L, '_ink_L': ink_L}


def min_dE(spec):
    d = spec.get('distinctness')
    if not d or d.get('metric') != 'ciede2000' or 'min' not in d:
        raise SystemExit('STOP: 정본에 distinctness(ciede2000) 하한이 없다 — 하한을 코드에 베끼지 않는다')
    return float(d['min'])


def all_apart(cells, floor):
    """계약을 직접 잰다 — 축(L·S)이 아니라 색공간 거리로."""
    for i in range(len(cells)):
        for j in range(i + 1, len(cells)):
            if ciede2000(cells[i], cells[j]) < floor:
                return False
    return True


def cell_order(sat, baseL, step, sat_levels, lo, hi):
    """후보 칸을 기준색 가까운 순서로 늘어놓는다 — 멀리 갈수록 색이 그 색 같지 않아진다.

    ΔEok 하나로 판정하므로 명도든 채도든 어느 축으로 갈려도 된다. 그래서 명도를 멀리 밀기 전에
    **같은 명도의 다른 채도**를 먼저 써서 사다리가 옆으로 벌어지지 않게 한다.
    """
    out = []
    for k in range(0, 60):
        offs = [0.0] if k == 0 else [-step * k, step * k]
        for off in offs:
            L = baseL + off
            if not lo < L < hi:
                continue
            for s in sat_levels:
                out.append((s, L))
    return out


def greedy_place(order, cands, pages, theme, hue, spec, floor, extra=None, pinned=None):
    """게임마다 계약을 지키는 첫 칸을 잡는다. 못 잡으면 None(호출자가 단차를 넓힌다)."""
    out, cells = {}, []
    for gid in order:
        bgs = [pages[gid][theme]['--bg'], pages['@index'][theme]['--bg']]
        picked = None
        for s, L in ([pinned] if (pinned and gid == order[0]) else cands):
            v = build_variant(hue, s, L, bgs, spec)
            if v is None:
                continue
            if extra and not extra(v):
                continue
            if not all_apart(cells + [v['--sig']], floor):
                continue
            picked = v
            break
        if picked is None:
            return None
        out[gid] = picked
        cells.append(picked['--sig'])
    return out


def pick_compact(sols):
    """여러 해가 있으면 **명도 폭이 가장 좁은** 것을 고른다.

    ΔEok 만 넘기면 어느 해든 계약은 지킨다. 그러나 폭이 넓을수록 양 끝이 거의 검정·거의 흰색이 되어
    '색을 보면 종류를 안다' 는 첫 문장이 그 칸에서만 약해진다 — 그래서 좁은 쪽을 고른다.
    """
    def span(sol):
        ls = [v['_L'] for v in sol.values()]
        return max(ls) - min(ls)
    return min(sols, key=span)


def light_ladder(hue, sat, baseL, rep, ids, pages, spec):
    """대표는 기준색 그대로, 나머지는 그 둘레로 갈린다.

    단차는 4%p 에서 출발하되 **ΔEok 하한을 넘길 때까지 넓힌다** — 숫자(4%p)가 아니라
    계약(구별된다)이 기준이다(보라는 4%p 단차의 ΔEok 가 0.0406 이라 그대로는 못 쓴다).
    """
    floor = min_dE(spec)
    order = [rep] + [i for i in ids if i != rep]
    extra = lambda v: hex2lch(v['--sig'])[1] >= LIGHT_CHROMA_FLOOR
    sols = []
    for sat_levels in ([sat], [sat, sat * 0.62], [sat, sat * 0.62, min(100.0, sat * 1.15)]):
        step = STEP
        while step <= 20.0:
            cands = cell_order(sat, baseL, step, sat_levels, 0.0, 100.0)
            got = greedy_place(order, cands, pages, 0, hue, spec, floor, extra=extra,
                               pinned=(sat, baseL))
            if got:
                sols.append(got)
                break
            step += 0.5
    if not sols:
        raise SystemExit(f"STOP: 라이트 사다리를 못 놓았다({len(ids)}칸) — 억지로 밀지 않는다(티켓 2-3).")
    return pick_compact(sols)


def dark_ladder(hue, sat, baseL, light, pages, spec):
    """다크는 기준색 위에서 따로 놓는다(검사3). 명도 한 축으로 안 들어가면 채도를 두 번째 축으로 쓴다.

    ★어느 축을 쓰든 판정은 ΔEok 하나다(정본 distinctness) — 축을 늘려도 검사는 느슨해지지 않는다.
    """
    floor = min_dE(spec)
    ranked = sorted(light, key=lambda g: light[g]['_L'])
    n = len(ranked)
    # 다크의 자리는 기준색 위쪽이다(검사3). 그 안에서 기준색에 가까운 칸부터 쓴다.
    center = baseL + DARK_LIFT
    extra = lambda v: (hex2hsl(v['--sig'])[2] > baseL
                       and huedist(hex2hsl(v['--sig'])[0], hue) <= 20
                       and hex2lch(v['--sig'])[1] >= DARK_CHROMA_FLOOR)
    # ★채도를 올리면 같은 명도에서 색이 더 오래 '그 색' 으로 남는다. 원래 채도로 되는지 먼저 보고,
    #   안 되면 올리고, 그래도 안 되면 채도를 두 번째 단으로 쓴다(티켓 2-3 이 지정한 순서).
    sols = []
    for sat_levels in ([sat], [min(100.0, sat * 1.2)], [100.0],
                       [sat, sat * 0.62], [100.0, 60.0], [100.0, 55.0]):
        step = STEP
        while step <= 20.0:
            cands = cell_order(sat, center, step, sat_levels, baseL + DARK_GAP, 97.0)
            got = greedy_place(ranked, cands, pages, 1, hue, spec, floor, extra=extra)
            if got:
                sols.append(got)
                break
            step += 0.5
    if sols:
        return pick_compact(sols)
    raise SystemExit(f"STOP: 다크 사다리를 못 놓았다(기준 L={baseL:.1f} · {n}칸) — 멈추고 보고한다(티켓 2-3).")


def main():
    spec, games = load()
    pages = {g['id']: read_root_blocks(os.path.join(ROOT, g['id'], 'index.html')) for g in games}
    pages['@index'] = read_root_blocks(os.path.join(ROOT, 'index.html'))
    by_cat = {}
    for g in games:
        by_cat.setdefault(g['category'], []).append(g['id'])

    reps, values = {}, {}
    for cat, ids in by_cat.items():
        base = spec['categories'][cat]['sig']
        hue, sat, baseL = hex2hsl(base)
        same = [i for i in ids if pages[i][0]['--sig'].lower() == base.lower()]
        rep = (same or ids)[0]
        reps[cat] = rep
        light = light_ladder(hue, sat, baseL, rep, ids, pages, spec)
        dark = dark_ladder(hue, sat, baseL, light, pages, spec)
        values[cat] = {g: {'light': light[g], 'dark': dark[g]} for g in ids}

    print(json.dumps({'reps': reps, 'values': values}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
