#!/usr/bin/env python3
"""분류 색 계약 검사기 — 계약 두 문장을 잰다(그 대리물을 재지 않는다).

  ① 대문 카드의 색을 보면 그 게임이 어떤 종류인지 알 수 있다.
  ② 같은 종류 안에서도 카드끼리 구별된다.

★값을 이 파일에 베껴 적지 않는다. 기준색·대비 하한은 `tools/palette_by_category.json` 에서,
게임의 실제 색과 배경 토큰은 각 페이지 소스에서 **읽어서 계산**한다. 베끼는 순간 검사는
계약이 아니라 사본을 잰다.

검사 5종
  1 분류 일치   — 각 게임의 라이트 --sig 가 자기 분류의 기준색인가(대표는 기준색 그대로,
                  변주를 받는 나머지는 색상각 차 2도 이내). 대문 카드의 색도 그 게임과 같은가.
  2 대비비      — palette_by_category.json 의 contrastRules 짝을 그 페이지의 실제 배경 토큰에 대고
                  라이트·다크 양쪽에서 잰다.
  3 다크 변형   — 다크 --sig 가 기준색과 색상차 20도 이내이고 더 밝은가.
  4 분류 안 구별 — 같은 분류 안 임의의 두 게임의 --sig 가 갈리는가(계약 둘째 문장 · ΔEok).
  5 id 집합     — games.json · FALLBACK · noscript · functions/_games.js 가 같은가.

종료코드: 0 통과 · 3 미달 · 2 판정 불가(검사를 세울 수 없음).
★2 와 3 을 가른 이유: 자동 호출자가 '깨졌다' 와 '못 쟀다' 를 구별해야 한다.
★1 은 쓰지 않는다 — 파이썬 예외 종료가 그 코드로 나와 판정으로 위장하기 때문이다.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from palette_color import contrast, deltaE_ok, hex2hsl, huedist  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HUE_TOL_VARIANT = 2.0    # 검사1 — 변주는 색상을 바꾸지 않는다(티켓 3-1)
HUE_TOL_DARK = 20.0      # 검사3 — 다크 변형의 색상 허용치(티켓 3-3)


class Indeterminate(Exception):
    """검사를 세울 수 없다 — 통과도 미달도 아니다."""


def read_text(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        raise Indeterminate(f"파일이 없다: {rel}")
    return open(p, encoding='utf-8').read()


def root_blocks(src, what):
    """페이지의 라이트/다크 :root 토큰."""
    try:
        i = src.index(':root{')
        j = src.index('}', i)
        m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', src)
        if m is None:
            raise ValueError('dark media 없음')
        k = src.index(':root{', m.end())
        l = src.index('}', k)
    except ValueError as e:
        raise Indeterminate(f"{what}: :root 를 못 찾았다 ({e})")
    parse = lambda t: dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})', t))
    return parse(src[i:j]), parse(src[k:l])


def load_spec():
    spec = json.loads(read_text('tools/palette_by_category.json'))
    for key in ('categories', 'contrastRules'):
        if key not in spec:
            raise Indeterminate(f"palette_by_category.json 에 {key} 가 없다")
    return spec


def load_games():
    games = json.loads(read_text('games.json'))
    missing = [g['id'] for g in games if not g.get('category')]
    if missing:
        raise Indeterminate(f"games.json 에 category 가 없는 게임: {missing}")
    return games


def page_tokens(games):
    out = {}
    for g in games:
        out[g['id']] = root_blocks(read_text(f"{g['id']}/index.html"), g['id'])
    out['@index'] = root_blocks(read_text('index.html'), 'index.html')
    return out


def index_card_colors():
    """대문에서 카드마다 갈아 끼우는 색. 라이트 영역과 다크 @media 영역을 나눠 읽는다."""
    src = read_text('index.html')
    m = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)', src)
    if m is None:
        raise Indeterminate('index.html 에 다크 @media 가 없다')
    # 다크 @media 블록의 끝 — 중괄호 균형으로 찾는다
    start = src.index('{', m.end())
    depth, end = 0, None
    for i in range(start, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        raise Indeterminate('index.html 다크 @media 블록이 안 닫힌다')
    dark_txt = src[start:end]
    light_txt = src[:m.start()] + src[end:]
    pat = re.compile(r'\.card\[href="/([^"]*)/"\]\s*\{([^}]*)\}')
    def grab(txt):
        out = {}
        for gid, body in pat.findall(txt):
            toks = dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})', body))
            if toks:
                out[gid] = toks
        return out
    return grab(light_txt), grab(dark_txt)


# ── 검사 1 ────────────────────────────────────────────────────────────────
def check_category_match(spec, games, pages):
    bad = []
    cats = {}
    for g in games:
        cats.setdefault(g['category'], []).append(g['id'])
    idx_light, idx_dark = index_card_colors()
    for cat, ids in cats.items():
        if cat not in spec['categories']:
            raise Indeterminate(f"분류 {cat} 가 정본에 없다 — 대조할 것이 없다")
        base = spec['categories'][cat]['sig']
        bh = hex2hsl(base)[0]
        exact = [i for i in ids if pages[i][0]['--sig'].lower() == base.lower()]
        if not exact:
            bad.append(f"분류 {cat}: 기준색 {base} 를 그대로 쓰는 대표가 없다")
        for gid in ids:
            sig = pages[gid][0]['--sig']
            d = huedist(hex2hsl(sig)[0], bh)
            if d > HUE_TOL_VARIANT:
                bad.append(f"{gid}: 라이트 --sig {sig} 색상각이 분류 {cat}({base}) 와 {d:.1f}도 — 허용 {HUE_TOL_VARIANT}도")
            # 대문 카드가 그 게임과 같은 색을 싣는가 — 계약이 눈에 보이는 자리가 대문이다
            for name, table, theme in (('라이트', idx_light, 0), ('다크', idx_dark, 1)):
                if gid not in table:
                    bad.append(f"{gid}: 대문 {name} 카드 색 배선이 없다")
                    continue
                want = pages[gid][theme]['--sig'].lower()
                got = (table[gid].get('--sig') or '').lower()
                if got != want:
                    bad.append(f"{gid}: 대문 {name} 카드 --sig {got or 'NONE'} != 게임 페이지 {want}")
    return bad


# ── 검사 2 ────────────────────────────────────────────────────────────────
def check_contrast(spec, games, pages):
    pairs = spec['contrastRules'].get('pairs')
    if not pairs:
        raise Indeterminate('contrastRules.pairs 가 비어 있다')
    bad = []
    targets = [(g['id'], g['id']) for g in games] + [('@index', 'index.html')]
    for key, label in targets:
        for theme, tname in ((0, '라이트'), (1, '다크')):
            toks = pages[key][theme]
            for p in pairs:
                fg, bg = toks.get(p['fg']), toks.get(p['bg'])
                if fg is None or bg is None:
                    bad.append(f"{label} {tname}: {p['id']} 의 토큰이 없다({p['fg']}={fg} {p['bg']}={bg})")
                    continue
                c = contrast(fg, bg)
                if c + 1e-9 < p['min']:
                    bad.append(f"{label} {tname}: {p['id']} {fg} on {bg} = {c:.2f} < {p['min']}")
    return bad


# ── 검사 3 ────────────────────────────────────────────────────────────────
def check_dark_variant(spec, games, pages):
    bad = []
    for g in games:
        base = spec['categories'][g['category']]['sig']
        bh, _, bl = hex2hsl(base)
        dsig = pages[g['id']][1]['--sig']
        dh, _, dl = hex2hsl(dsig)
        d = huedist(dh, bh)
        if d > HUE_TOL_DARK:
            bad.append(f"{g['id']}: 다크 --sig {dsig} 색상차 {d:.1f}도 > {HUE_TOL_DARK}도 (기준 {base})")
        if dl <= bl:
            bad.append(f"{g['id']}: 다크 --sig {dsig} L={dl:.1f} 이 기준색 {base} L={bl:.1f} 보다 밝지 않다")
    return bad


# ── 검사 4 ────────────────────────────────────────────────────────────────
def check_within_category(spec, games, pages):
    """계약 둘째 문장을 **축이 아니라 색공간 거리로** 잰다(정본 distinctness).

    ★L 이나 S 같은 축은 대리물이다 — L 만 재면 채도로 갈린 짝을 못 보고, 두 축을 OR 로 묶으면
    합집합이라 각각보다 헐거워진다. 하한은 정본에서 읽는다(여기 베끼지 않는다).
    """
    d = spec.get('distinctness')
    if not d:
        raise Indeterminate('정본에 distinctness 가 없다 — 가르는 기준을 세울 수 없다')
    if d.get('metric') != 'deltaE-oklab':
        raise Indeterminate(f"모르는 척도다: {d.get('metric')} — 임의로 해석하지 않는다")
    if 'min' not in d:
        raise Indeterminate('distinctness.min 이 없다')
    floor = float(d['min'])
    cats = {}
    for g in games:
        cats.setdefault(g['category'], []).append(g['id'])
    bad = []
    for cat, ids in cats.items():
        for theme, tname in ((0, '라이트'), (1, '다크')):
            for a in range(len(ids)):
                for b in range(a + 1, len(ids)):
                    ga, gb = ids[a], ids[b]
                    sa, sb = pages[ga][theme]['--sig'], pages[gb][theme]['--sig']
                    de = deltaE_ok(sa, sb)
                    if de + 1e-9 < floor:
                        bad.append(f"분류 {cat} {tname}: {ga}({sa}) 와 {gb}({sb}) 가 안 갈린다 "
                                   f"— ΔEok {de:.4f} < {floor}")
    return bad


# ── 검사 5 ────────────────────────────────────────────────────────────────
def check_id_sets(spec, games, pages):
    src = read_text('index.html')
    try:
        fb_txt = src[src.index('const FALLBACK'):src.index('let games = FALLBACK')]
        ns_txt = src[src.index('<noscript>'):src.index('</noscript>')]
    except ValueError as e:
        raise Indeterminate(f"index.html 에서 FALLBACK/noscript 를 못 잘랐다 ({e})")
    fn_src = read_text('functions/_games.js')
    if 'export const GAMES' not in fn_src:
        raise Indeterminate('functions/_games.js 에 GAMES 가 없다')
    sets = {
        'games.json': [g['id'] for g in games],
        'FALLBACK': re.findall(r"id:'([^']+)'", fb_txt),
        'noscript': re.findall(r'class="card" href="/([^"]*)/"', ns_txt),
        '_games.js': re.findall(r"'([^']+)'", fn_src.split('export const GAMES')[1]),
    }
    base = sets['games.json']
    bad = []
    for name, v in sets.items():
        if set(v) != set(base):
            miss = sorted(set(base) - set(v))
            extra = sorted(set(v) - set(base))
            bad.append(f"{name}: id 집합이 games.json 과 다르다 — 빠짐 {miss} · 남음 {extra}")
        elif v != base:
            bad.append(f"{name}: id 순서가 games.json 과 다르다")
    return bad


CHECKS = [
    ('1 분류 일치', check_category_match),
    ('2 대비비 하한', check_contrast),
    ('3 다크 변형 정합', check_dark_variant),
    ('4 분류 안 구별', check_within_category),
    ('5 id 집합 동일', check_id_sets),
]


def main(argv):
    only = None
    if len(argv) > 1 and argv[1].startswith('--only'):
        only = argv[2] if argv[1] == '--only' else argv[1].split('=', 1)[1]
    try:
        spec = load_spec()
        games = load_games()
        pages = page_tokens(games)
    except Indeterminate as e:
        print(f"INDET: {e}")
        return 2

    failed = indet = 0
    for name, fn in CHECKS:
        if only and not name.startswith(only):
            continue
        try:
            bad = fn(spec, games, pages)
        except Indeterminate as e:
            print(f"[INDET] 검사 {name}: {e}")
            indet += 1
            continue
        if bad:
            failed += 1
            print(f"[FAIL] 검사 {name} — {len(bad)}건")
            for b in bad:
                print(f"    - {b}")
        else:
            print(f"[PASS] 검사 {name}")
    if indet:
        print(f"판정 불가 {indet}종 — 통과로 세지 않는다")
        return 2
    if failed:
        print(f"미달 {failed}종")
        return 3
    print('전 검사 통과')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
