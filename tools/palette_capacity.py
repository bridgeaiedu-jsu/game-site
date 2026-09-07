#!/usr/bin/env python3
"""분류 색 ★수용 능력 측정기 — 값을 고르지 않는다. ★잰다.

master 판정(2026-09-06)이 물은 셋에만 답한다.
  (가) 분류마다 ★기준 L 과 ★지금 놓인 칸 수
  (나) 그 기준색으로 ★놓을 수 있는 최대 칸 수(개수가 한계인가)
  (다) 색상·채도를 고정하고 ★L 만 움직이면 목표 칸 수가 놓이는 L 구간이 있는가

★이 파일은 산출자(palette_gen.py)의 배치 함수를 ★그대로 빌려 쓴다 — 여기서 배치 규칙을
다시 적으면 그때부터 두 곳이 갈리고, 잰 값이 실제 산출과 달라진다.
★값을 정본에 쓰지 않는다. 출력만 낸다(고르는 것은 master·오너다).

사용법: python3 tools/palette_capacity.py [--cat=<분류>|<분류>]   (기본: puzzle)
        (정본에 없는 분류·배정 0종이면 rc=2 판정 불가)
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import palette_gen as PG                                    # noqa: E402
from palette_color import hex2hsl                           # noqa: E402

ROOT = os.path.dirname(HERE)
# ★형제(palette_prototype_margin.py)와 ★같은 표기를 받는다 — 한쪽만 --cat= 를 알면
#   다음 사람이 형제에서 밟는다. 여기서는 추락이 아니라 ★더 나쁜 침묵이었다:
#   --cat=hands 를 주면 옵션이라 걸러지고 ★기본 puzzle 을 잰 뒤 rc=0 으로 끝났다
#   (2026-09-07 R1 실측 · 잰 대상이 물은 대상과 다른데 아무도 모른다).
TARGET = (next((a[len('--cat='):] for a in sys.argv if a.startswith('--cat=')), None)
          or next((a for a in sys.argv[1:] if not a.startswith('--')), 'puzzle'))


def require_cat(spec, by_cat=None):
    """정본에 그 분류가 있는가 · 잴 게임이 있는가 — 아니면 ★판정 불가(rc=2).

    rc=2 인 이유는 형제와 같다 — 1 은 '미달' 자리이고 추락도 1 이라 셋이 접힌다.
    """
    if TARGET not in spec['categories']:
        print('rc=2 판정 불가 — 정본에 분류 %s 가 없다(있는 것: %s)'
              % (TARGET, ', '.join(spec['categories'])))
        raise SystemExit(2)
    if by_cat is not None and not by_cat.get(TARGET):
        print('rc=2 판정 불가 — 분류 %s 에 배정된 게임이 0종이다(잴 것이 없다)' % TARGET)
        raise SystemExit(2)


def load_pages(games):
    pages = {g['id']: PG.read_root_blocks(os.path.join(ROOT, g['id'], 'index.html')) for g in games}
    pages['@index'] = PG.read_root_blocks(os.path.join(ROOT, 'index.html'))
    return pages


def try_place(hue, sat, baseL, ids, pages, spec, rep):
    """라이트·다크 사다리를 놓아 본다 — 놓이면 True, 못 놓으면 False(★예외를 삼키지 않는다)."""
    try:
        light = PG.light_ladder(hue, sat, baseL, rep, ids, pages, spec)
    except SystemExit:
        return False, '라이트'
    try:
        PG.dark_ladder(hue, sat, baseL, light, pages, spec)
    except SystemExit:
        return False, '다크'
    return True, ''


def why_rejected(hue, s, L, bgs, spec, baseL, cells, floor, theme):
    """후보 칸 하나가 ★어느 제약에 걸렸는지 이름을 준다.

    ★판정 규칙을 여기서 새로 적지 않는다 — palette_gen 과 palette_color 의 ★같은 함수·같은
    정본 값을 부른다. 다만 build_variant 는 None 하나로만 답하므로, 그 안의 세 관문을
    ★같은 함수로 다시 물어 어느 관문이었는지 이름을 붙인다(값은 정본에서 읽는다).
    """
    from palette_color import contrast, hex2lch, hex2hsl, hsl2hex, huedist
    f_sig = PG.pair_min(spec, 'sig-on-bg')
    f_on = PG.pair_min(spec, 'on-sig-on-sig')
    sig = hsl2hex(hue, s, L)
    if min(contrast(sig, b) for b in bgs) < f_sig:
        return 'sig 대비 미달'
    if PG.pick_on_sig(sig, hue, f_on)[0] is None:
        return 'on-sig 없음'
    v = PG.build_variant(hue, s, L, bgs, spec)
    if v is None:
        return 'ink·soft 실패'
    if theme == 1:                       # 다크에만 걸리는 세 가지
        if hex2hsl(v['--sig'])[2] <= baseL:
            return '다크: L <= 기준 L'
        if huedist(hex2hsl(v['--sig'])[0], hue) > 20:
            return '다크: 색상거리 > 20'
        if hex2lch(v['--sig'])[1] < PG.DARK_CHROMA_FLOOR:
            return '다크: 채도 < %.2f' % PG.DARK_CHROMA_FLOOR
    else:
        if hex2lch(v['--sig'])[1] < PG.LIGHT_CHROMA_FLOOR:
            return '라이트: 채도 < %.2f' % PG.LIGHT_CHROMA_FLOOR
    if not PG.all_apart(cells + [v['--sig']], floor):
        return 'dE 미달(앞 칸과 안 갈린다)'
    return None                          # 여기까지 오면 놓을 수 있는 칸이다


def diagnose_dark(hue, sat, baseL, light, pages, spec):
    """다크 사다리를 ★palette_gen 과 같은 순서로 다시 돌면서 ★기각 사유를 센다.

    ★이 함수는 배치를 ★재현할 뿐 판정을 새로 만들지 않는다 — 끝에서 palette_gen 의 실제
    결과와 ★같은 결론(놓였다/못 놓았다)이 나오는지 스스로 대조한다(다르면 그 사실을 찍는다).
    """
    floor = PG.min_dE(spec)
    ranked = sorted(light, key=lambda g: light[g]['_L'])
    center = baseL + PG.DARK_LIFT
    best = None                          # 가장 멀리 간 시도(가장 많은 칸을 놓은 것)
    for sat_levels in ([sat], [min(100.0, sat * 1.2)], [100.0],
                       [sat, sat * 0.62], [100.0, 60.0], [100.0, 55.0]):
        step = PG.STEP
        while step <= 20.0:
            cands = PG.cell_order(sat, center, step, sat_levels, baseL + PG.DARK_GAP, 97.0)
            cells, placed, reasons = [], 0, {}
            stuck_gid = None
            for gid in ranked:
                bgs = [pages[gid][1]['--bg'], pages['@index'][1]['--bg']]
                picked = None
                local = {}
                for s, L in cands:
                    r = why_rejected(hue, s, L, bgs, spec, baseL, cells, floor, 1)
                    if r is None:
                        picked = PG.build_variant(hue, s, L, bgs, spec)
                        break
                    local[r] = local.get(r, 0) + 1
                if picked is None:
                    stuck_gid = gid
                    reasons = local
                    break
                cells.append(picked['--sig'])
                placed += 1
            row = {'sat_levels': [round(x, 1) for x in sat_levels], 'step': round(step, 1),
                   'placed': placed, 'need': len(ranked), 'stuck': stuck_gid,
                   'reasons': reasons, 'cands': len(cands)}
            if best is None or row['placed'] > best['placed']:
                best = row
            if placed == len(ranked):
                return row, True
            step += 0.5
    return best, False


def curve(spec, games, pages, by_cat, target):
    """RULING-PUSH-COLOR-1 이 요구한 두 표 — ★값을 고르지 않는다. 잰다.

    (A) 수용 능력 곡선: L 을 옮기며 ★그 L 에서 놓이는 최대 칸 수.
        ★같은 페이지를 두 번 세지 않는다. 실재 7종을 넘어서는 칸은 ★가상 페이지로 재고,
        그 배경 토큰의 ★출처를 함께 적는다(대문 index.html 의 --bg 를 그대로 쓴다).
    (B) 후보 L 마다: 라이트 대비 · OKLab 채도 · ★다른 분류와의 최소 dE · 현행 색과의 dE.
    """
    from palette_color import contrast, hex2lch, hsl2hex                      # noqa: E402
    from check_rainbow import ciede2000                                       # noqa: E402

    ids = by_cat[target]
    base = spec['categories'][target]['sig']
    hue, sat, baseL = hex2hsl(base)
    same = [i for i in ids if pages[i][0]['--sig'].lower() == base.lower()]
    rep = (same or ids)[0]
    others = {c: spec['categories'][c]['sig'] for c in spec['categories'] if c != target}

    # 가상 페이지 — 실재 게임이 모자랄 때만 쓴다. 배경 토큰은 ★대문(index.html)의 것을 복사한다.
    spare_ids = []
    for k in (1, 2, 3):
        gid = '@spare%d' % k
        pages[gid] = pages['@index']
        spare_ids.append(gid)

    print('==== (A) 수용 능력 곡선 — L 30.0~53.0 · 0.5 단위 · 그 L 에서 놓이는 ★최대 칸 수 ====')
    print('  ※ 실재 %s 페이지 %d종(%s)을 먼저 쓰고, %d칸 이상은 ★가상 페이지(@spare*)로 잰다.'
          % (target, len(ids), ', '.join(ids), len(ids) + 1))
    print('  ※ 가상 페이지의 배경 토큰 출처 = ★대문 index.html 의 --bg(라이트·다크) 를 그대로 복사했다.')
    print('  ※ ★같은 실재 페이지를 두 번 세지 않는다.')
    print('  %-7s %-9s %-6s' % ('L', '최대 칸', '막힌 지점'))
    curve_rows = {}
    L = 30.0
    while L <= 53.0 + 1e-9:
        best, where = 0, ''
        for n in range(1, len(ids) + len(spare_ids) + 1):
            sub = (ids + spare_ids)[:n]
            sub_rep = rep if rep in sub else sub[0]
            ok, w = try_place(hue, sat, L, sub, pages, spec, sub_rep)
            if ok:
                best = n
            else:
                where = w + ' 사다리'
                break
        curve_rows[round(L, 1)] = best
        ceiling = len(ids) + len(spare_ids)
        tag = ''
        if best > len(ids):
            tag = '   ※%d칸 이상은 가상 페이지 포함' % (len(ids) + 1)
        if best == ceiling:
            tag += '   ★측정 상한(가상 %d칸까지만 넣었다 — 실제 최대는 이보다 클 수 있다)' % len(spare_ids)
        print('  %-7.1f %-9d %s%s' % (L, best, where, tag))
        L += 0.5

    print('')
    print('==== (B) 후보 L 의 색 성질 ====')
    print('  ※ 라이트 대비 = sig 를 ★대문 라이트 --bg(%s) 에 댄 값 · 채도 = OKLab C'
          % pages['@index'][0]['--bg'])
    print('  ※ 분류 간 최소 dE = 다른 5개 분류 기준색(%s)과의 CIEDE2000 최소값'
          % ', '.join('%s %s' % (c, h) for c, h in others.items()))
    print('  %-7s %-9s %-7s %-8s %-9s %-11s %s'
          % ('L', 'hex', '대비', '채도C', '분류간dE', '현행과dE', '수용 칸'))
    cur_lch = hex2lch(base)[1]
    cur_min = min(ciede2000(base, h) for h in others.values())
    cur_con = contrast(base, pages['@index'][0]['--bg'])
    print('  %-7s %-9s %-7.2f %-8.3f %-9.2f %-11s %s   ★현행'
          % ('%.1f' % baseL, base, cur_con, cur_lch, cur_min, '0.00', '7칸에서 막힘'))
    L = 30.0
    while L <= 53.0 + 1e-9:
        hexv = hsl2hex(hue, sat, L)
        con = contrast(hexv, pages['@index'][0]['--bg'])
        ch = hex2lch(hexv)[1]
        dmin = min(ciede2000(hexv, h) for h in others.values())
        dcur = ciede2000(hexv, base)
        cap = curve_rows.get(round(L, 1), 0)
        flag = ''
        if cap >= 8 and con >= 3.0 and ch >= 0.10 and dmin >= cur_min:
            flag = '   ★규칙 ①③ 통과'
        print('  %-7.1f %-9s %-7.2f %-8.3f %-9.2f %-11.2f %d칸%s'
              % (L, hexv, con, ch, dmin, dcur, cap, flag))
        L += 0.5
    print('')
    print('  ※ ★값을 정본에 쓰지 않았다 — 고르는 것은 master 다(RULING-PUSH-COLOR-1).')


def main():
    spec, games = PG.load()
    pages = load_pages(games)
    by_cat = {}
    for g in games:
        by_cat.setdefault(g['category'], []).append(g['id'])
    require_cat(spec, by_cat)      # ★어느 갈래로 가기 전에 먼저 멈춘다

    if '--curve' in sys.argv:
        curve(spec, games, pages, by_cat, TARGET)
        return

    print('==== (가) 분류마다 기준 L 과 놓인 칸 수 ====')
    print('  %-11s %-9s %6s %7s %6s  %s' % ('분류', '기준색', 'H', 'S', 'L', '지금 칸 수'))
    rows = []
    for cat, ids in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        base = spec['categories'][cat]['sig']
        h, s, l = hex2hsl(base)
        rows.append((cat, base, h, s, l, len(ids)))
        print('  %-11s %-9s %6.1f %6.1f%% %6.1f  %d' % (cat, base, h, s, l, len(ids)))

    ids = by_cat[TARGET]
    base = spec['categories'][TARGET]['sig']
    hue, sat, baseL = hex2hsl(base)
    same = [i for i in ids if pages[i][0]['--sig'].lower() == base.lower()]
    rep = (same or ids)[0]

    print('')
    print('==== (나) %s 기준색(%s)으로 놓을 수 있는 ★최대 칸 수 ====' % (TARGET, base))
    print('  ※ 칸 수를 1부터 늘리며 ★실제 배치를 돌린다. 게임 목록은 앞에서부터 잘라 쓴다.')
    best = 0
    for n in range(1, len(ids) + 3):
        sub = (ids + ids)[:n]
        sub_rep = rep if rep in sub else sub[0]
        ok, where = try_place(hue, sat, baseL, sub, pages, spec, sub_rep)
        note = ''
        if n > len(ids):
            note = '   ※★참고치 — 실재 게임이 모자라 같은 페이지를 두 번 센 구간이다(배경 토큰이 중복된다)'
        print('    %d칸 → %s%s%s' % (n, '놓인다' if ok else '★못 놓는다',
                                     '' if ok else '(' + where + ' 사다리)', note))
        if ok:
            best = n
        else:
            break
    print('  ⇒ 지금 기준색으로 놓을 수 있는 최대 = ★%d칸 (지금 필요한 칸 = %d)' % (best, len(ids)))

    print('')
    print('==== (다) 색상·채도 고정 · ★L 만 움직이면 %d칸이 놓이는 구간이 있는가 ====' % len(ids))
    print('  ※ H=%.1f · S=%.1f%% 고정. L 을 30.0~75.0 까지 ★0.5 씩 옮기며 배치를 돌린다.' % (hue, sat))
    good = []
    L = 30.0
    while L <= 75.0 + 1e-9:
        ok, _ = try_place(hue, sat, L, ids, pages, spec, rep)
        if ok:
            good.append(round(L, 1))
        L += 0.5
    if not good:
        print('  ⇒ ★없다 — L 만으로는 %d칸이 안 놓인다(분류 개편이나 다른 축이 필요하다)' % len(ids))
    else:
        runs, start, prev = [], good[0], good[0]
        for v in good[1:]:
            if abs(v - prev - 0.5) < 1e-9:
                prev = v
                continue
            runs.append((start, prev)); start = prev = v
        runs.append((start, prev))
        print('  ⇒ ★있다 — 놓이는 L 구간:')
        for a, b in runs:
            print('      L %.1f ~ %.1f  (폭 %.1f%%p · 지금 기준 L=%.1f 에서 %+.1f%%p)'
                  % (a, b, b - a, baseL, (a if abs(a - baseL) < abs(b - baseL) else b) - baseL))
        print('  ※ ★이 값을 정본에 쓰지 않았다 — 대문 색이 바뀌는 결정이라 master 판정 자리다.')

    print('')
    print('==== (라) 막힌 자리에서 ★어느 제약이 마지막까지 막았나 (%s · %d칸) ====' % (TARGET, len(ids)))
    print('  ※ palette_gen 의 다크 배치를 ★같은 순서로 다시 돌며 후보 칸의 기각 사유를 센다.')
    try:
        light = PG.light_ladder(hue, sat, baseL, rep, ids, pages, spec)
        light_ok = True
    except SystemExit:
        light = None
        light_ok = False
    if not light_ok:
        print('  ★라이트 사다리부터 못 놓았다 — 다크 진단을 돌릴 수 없다(판정 불가).')
    else:
        row, placed_all = diagnose_dark(hue, sat, baseL, light, pages, spec)
        real_ok, where = try_place(hue, sat, baseL, ids, pages, spec, rep)
        print('  ★자기 대조: 진단이 본 결론 = %s · palette_gen 실제 결론 = %s%s'
              % ('놓인다' if placed_all else '못 놓는다',
                 '놓인다' if real_ok else '못 놓는다(' + where + ')',
                 '' if placed_all == real_ok else '   ★두 결론이 다르다 — 진단을 믿지 마라'))
        print('  가장 멀리 간 시도: 채도단 %s · 단차 %.1f · 후보 칸 %d개 · ★%d/%d 칸 놓음 · 막힌 게임 %s'
              % (row['sat_levels'], row['step'], row['cands'], row['placed'], row['need'], row['stuck']))
        print('  ★그 자리에서 후보 칸이 기각된 사유(많은 순):')
        tot = sum(row['reasons'].values()) or 1
        for why, n in sorted(row['reasons'].items(), key=lambda kv: -kv[1]):
            print('      %-26s %5d회  (%.1f%%)' % (why, n, n / tot * 100))
        print('  ⇒ 최다 사유 = ★%s' % (sorted(row['reasons'].items(), key=lambda kv: -kv[1])[0][0]
                                       if row['reasons'] else '(없다)'))


if __name__ == '__main__':
    main()
