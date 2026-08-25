# -*- coding: utf-8 -*-
"""무지개 팔레트 결정론 검사기 — 게임 3종(블록 낙하·블록 퍼즐·2048)의 색을 계산으로 판정한다.

■ 판정 기준이 R2 에서 바뀌었다(2026-08-23 master 판정)
  R1 은 "채움색 자체가 바탕과 3:1" 을 요구했다. 그러면 흰 바탕에서는 채움을 어둡게 낮출 수밖에
  없어 무지개가 벽돌·황토색으로 죽는다. R2 부터는 **채움은 선명하게 두고, 바탕과 구별되게 하는
  일은 같은 색상의 어두운 테두리가 맡는다.** 그래서 판정도 다음 셋으로 바뀐다.

    ① 테두리 대 바탕     3:1 이상  (블록·타일이 판에서 떨어져 보이게 하는 것은 이제 테두리다)
    ② 타일 위 글자 대 채움 4.5:1 이상 (2048 은 타일에 숫자가 얹힌다)
    ③ 이웃한 색끼리 색차  CIEDE2000 10 이상 (빨강과 주황이 서로 구별되는가)

  채움 대 바탕 대비와 테두리 대 채움 대비는 **참고로 재서 표에 남기되 합격·불합격을 가르지 않는다**
  — 선명한 채움을 허용하는 것이 R2 설계의 핵심이라 그 값으로 떨어뜨리면 설계와 싸우게 된다.

■ 그 밖에 늘 보는 것
  · 무지개 토큰(--r1~--r7 과 --r1-edge~--r7-edge)이 세 파일에 다 있고 값이 서로 같은가.
  · 2048 을 넘어선 타일은 바탕이 검정이라 테두리(금테)만으로는 라이트에서 3:1 이 안 나온다.
    이 타일만은 '검정 채움' 과 '금테' 중 **큰 쪽**으로 판정한다(둘 중 하나면 눈에 띈다).
  · 색 값이 토큰 밖(스타일 규칙·자바스크립트)에 박혀 있지 않은가.

사용법:
  python3 check_rainbow.py <저장소 경로> [--json <출력파일>]
  python3 check_rainbow.py <저장소 경로> --inject <파일>:<토큰>=<값>   # 고의 결함 주입(검출력 확인)
     예) --inject 2048/index.html:--r3-edge=#fef08a → 테두리가 밝아져 FAIL 이 나와야 정상이다.

종료코드: 0 = 전부 통과 · 1 = 하나라도 미달 · 2 = 검사를 세울 수 없음(파일·토큰 부재)
"""
import io, json, os, re, sys

NONTEXT_FLOOR = 3.0      # 테두리(글자가 아닌 요소)의 대비 하한
TEXT_FLOOR = 4.5         # 글자의 대비 하한
DE_FLOOR = 10.0          # 이웃한 색의 색차 하한(CIEDE2000)

RAINBOW = ['--r%d' % i for i in range(1, 8)]
RAINBOW_EDGE = ['--r%d-edge' % i for i in range(1, 8)]
RAINBOW_KO = ['빨', '주', '노', '초', '파', '남', '보']

PAGES = {
    'block-drop/index.html':   ['--cell', '--board', '--bg'],
    'block-puzzle/index.html': ['--cell', '--panel', '--bg'],
    '2048/index.html':         ['--cell', '--board', '--bg'],
}
TILE_VALUES = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]


# ─────────────────────────────────────────────────────────── 색 계산
def _lin(c):
    cs = c / 255.0
    return cs / 12.92 if cs <= 0.03928 else ((cs + 0.055) / 1.055) ** 2.4


def _rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(h):
    r, g, b = _rgb(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def lab(h):
    """sRGB → CIELAB (D65). 색차를 재려면 밝기만이 아니라 색 자체의 좌표가 필요하다."""
    r, g, b = (_lin(v) for v in _rgb(h))
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1.0 / 3) if t > 216.0 / 24389 else (841.0 / 108) * t + 4.0 / 29
    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def ciede2000(h1, h2):
    """CIEDE2000 색차. 사람 눈이 느끼는 '다름'에 가장 가깝다고 알려진 표준 식이다."""
    import math
    l1, a1, b1 = lab(h1)
    l2, a2, b2 = lab(h2)
    kl = kc = kh = 1.0
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    cbar = (c1 + c2) / 2.0
    g = 0.5 * (1 - math.sqrt(cbar ** 7 / (cbar ** 7 + 25.0 ** 7))) if cbar > 0 else 0.0
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0
    dlp = l2 - l1
    dcp = c2p - c1p
    if c1p * c2p == 0:
        dhp = 0.0
    else:
        d = h2p - h1p
        if d > 180:
            d -= 360
        elif d < -180:
            d += 360
        dhp = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(d / 2.0))
    lbarp = (l1 + l2) / 2.0
    cbarp = (c1p + c2p) / 2.0
    if c1p * c2p == 0:
        hbarp = h1p + h2p
    else:
        d = abs(h1p - h2p)
        s = h1p + h2p
        hbarp = (s + 360) / 2.0 if d > 180 and s < 360 else ((s - 360) / 2.0 if d > 180 else s / 2.0)
    t = (1 - 0.17 * math.cos(math.radians(hbarp - 30))
         + 0.24 * math.cos(math.radians(2 * hbarp))
         + 0.32 * math.cos(math.radians(3 * hbarp + 6))
         - 0.20 * math.cos(math.radians(4 * hbarp - 63)))
    dtheta = 30 * math.exp(-(((hbarp - 275) / 25.0) ** 2))
    rc = 2 * math.sqrt(cbarp ** 7 / (cbarp ** 7 + 25.0 ** 7)) if cbarp > 0 else 0.0
    sl = 1 + (0.015 * (lbarp - 50) ** 2) / math.sqrt(20 + (lbarp - 50) ** 2)
    sc = 1 + 0.045 * cbarp
    sh = 1 + 0.015 * cbarp * t
    rt = -math.sin(math.radians(2 * dtheta)) * rc
    return math.sqrt((dlp / (kl * sl)) ** 2 + (dcp / (kc * sc)) ** 2 + (dhp / (kh * sh)) ** 2
                     + rt * (dcp / (kc * sc)) * (dhp / (kh * sh)))


# ─────────────────────────────────────────────────────────── CSS 토큰 읽기
HEX = re.compile(r'^#[0-9A-Fa-f]{3,6}$')
TOKEN_DECL = re.compile(r'(--[a-z0-9-]+)\s*:\s*([^;]+);')
ROOT_BLOCK = re.compile(r':root\{(.*?)\}', re.S)
COMMENT = re.compile(r'/\*.*?\*/', re.S)
DARK_AT = '@media (prefers-color-scheme: dark)'


def _kv(block):
    return {m.group(1): m.group(2).strip() for m in TOKEN_DECL.finditer(block)}


def _matching_brace(text, start):
    depth = 0
    for k in range(start, len(text)):
        if text[k] == '{':
            depth += 1
        elif text[k] == '}':
            depth -= 1
            if depth == 0:
                return k
    return len(text)


def parse_tokens(css):
    roots = ROOT_BLOCK.findall(css)
    if not roots:
        return {}, {}
    light = _kv(roots[0])
    dark = dict(light)
    i = css.find(DARK_AT)
    if i >= 0:
        j = css.find('{', i)
        k = _matching_brace(css, j)
        inner = ROOT_BLOCK.findall(css[j:k])
        if inner:
            dark.update(_kv(inner[0]))
    return light, dark


def resolve(val, tokens, depth=0):
    if depth > 8 or not val:
        return ''
    v = COMMENT.sub('', val).strip()
    m = re.match(r'^var\((--[a-z0-9-]+)\)$', v)
    if m:
        return resolve(tokens.get(m.group(1), ''), tokens, depth + 1)
    return v


def token_hex(name, tokens):
    v = resolve(tokens.get(name, ''), tokens)
    return v if HEX.match(v or '') else None


def read_css(path):
    html = io.open(path, encoding='utf-8', newline='').read()
    return html, ''.join(re.findall(r'<style>(.*?)</style>', html, re.S))


class Report(object):
    def __init__(self):
        self.rows = []
        self.bad = []

    def add(self, page, theme, kind, what, on, fg, bg, val, floor, gate=True, ok=None):
        """gate=False 면 표에는 남기되 합격·불합격을 가르지 않는다(참고 측정)."""
        ok = (val >= floor) if ok is None else ok
        row = dict(page=page, theme=theme, kind=kind, what=what, on=on, fg=fg, bg=bg,
                   value=round(val, 3), floor=floor if gate else None, gate=gate, ok=bool(ok))
        self.rows.append(row)
        if gate and not ok:
            self.bad.append(row)
        return row


def main():
    if len(sys.argv) < 2:
        print('사용법: python3 check_rainbow.py <저장소 경로> [--json out] [--inject 파일:토큰=값]')
        return 2
    root = sys.argv[1]
    outjson = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
    injects = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--inject']

    rep = Report()
    tokens_by_page = {}
    hardcoded = []

    print('=== 무지개 팔레트 실측 (테두리 %.1f:1 · 글자 %.1f:1 · 이웃 색차 CIEDE2000 %.0f) ==='
          % (NONTEXT_FLOOR, TEXT_FLOOR, DE_FLOOR))
    print('    채움 대 바탕·테두리 대 채움은 참고로만 잰다(R2 설계: 채움은 선명하게 · 경계는 테두리가)')
    if injects:
        print('    ★고의 결함 주입: %s' % ', '.join(injects))
    print()

    for page in PAGES:
        full = os.path.join(root, page.replace('/', os.sep))
        if not os.path.exists(full):
            print('  (파일 없음) ' + page)
            return 2
        html, css = read_css(full)
        light, dark = parse_tokens(css)
        if not light:
            print('  (토큰 블록을 찾지 못함) ' + page)
            return 2
        for spec in injects:
            f, rest = spec.split(':', 1)
            name, val = rest.split('=', 1)
            if f == page:
                light[name] = val
                dark[name] = val
        tokens_by_page[page] = (light, dark)

        body = css
        for blk in ROOT_BLOCK.findall(css):
            body = body.replace(blk, '')
        body = COMMENT.sub('', body)
        scripts = ''.join(re.findall(r'<script[^>]*>(.*?)</script>', html, re.S))
        scripts = re.sub(r'/\*.*?\*/', '', scripts, flags=re.S)
        scripts = re.sub(r'(?m)^\s*//.*$', '', scripts)
        for chunk, where in ((body, 'style'), (scripts, 'script')):
            for m in re.finditer(r'#[0-9A-Fa-f]{3,8}\b', chunk):
                ctx = chunk[max(0, m.start() - 40):m.start() + 20].replace('\n', ' ').replace('\r', '')
                hardcoded.append({'page': page, 'where': where, 'hex': m.group(0), 'ctx': ctx.strip()})

    # A) 세 파일의 무지개 채움·테두리 값이 같은지
    print('■ A) 무지개 토큰 일치 — 세 파일이 같은 무지개(채움+테두리)를 쓰는가')
    ref = None
    consistent = True
    for page, (light, dark) in tokens_by_page.items():
        vals = {}
        for th, tk in (('라이트', light), ('다크', dark)):
            row = []
            for name in RAINBOW + RAINBOW_EDGE:
                h = token_hex(name, tk)
                if not h:
                    print('   ★없음 %s [%s] %s' % (page, th, name))
                    return 2
                row.append(h)
            vals[th] = row
        if ref is None:
            ref = vals
            for th in ('라이트', '다크'):
                print('   기준 [%s] 채움 %s' % (th, ' '.join(
                    '%s=%s' % (RAINBOW_KO[i], vals[th][i]) for i in range(7))))
                print('        [%s] 테두리 %s' % (th, ' '.join(
                    '%s=%s' % (RAINBOW_KO[i], vals[th][7 + i]) for i in range(7))))
        else:
            for th in ('라이트', '다크'):
                same = vals[th] == ref[th]
                consistent = consistent and same
                print('   %-24s [%s] %s' % (page, th, 'OK 기준과 동일' if same else '★불일치 %s' % vals[th]))
    if not consistent:
        rep.bad.append({'page': '(전체)', 'kind': '토큰일치', 'ok': False, 'gate': True,
                        'what': '세 파일의 무지개 값이 서로 다르다'})
    print()

    # B) 테두리 대 바탕 3:1  (+ 참고: 채움 대 바탕 · 테두리 대 채움)
    print('■ B) 테두리 대 바탕 대비 (하한 %.1f:1) — 괄호는 참고값' % NONTEXT_FLOOR)
    for page, surfs in PAGES.items():
        light, dark = tokens_by_page[page]
        for th, tk in (('라이트', light), ('다크', dark)):
            for i in range(7):
                fill = token_hex(RAINBOW[i], tk)
                edge = token_hex(RAINBOW_EDGE[i], tk)
                for s in surfs:
                    bg = token_hex(s, tk)
                    if not bg:
                        continue
                    r = rep.add(page, th, '테두리대바탕', '%s %s' % (RAINBOW_KO[i], RAINBOW_EDGE[i]),
                                s, edge, bg, ratio(edge, bg), NONTEXT_FLOOR)
                    rf = rep.add(page, th, '채움대바탕(참고)', '%s %s' % (RAINBOW_KO[i], RAINBOW[i]),
                                 s, fill, bg, ratio(fill, bg), NONTEXT_FLOOR, gate=False)
                    print('   %s [%s] %-22s %s 테두리 %s on %s(%s) = %6.3f:1   (채움 %s = %5.3f:1)'
                          % ('OK  ' if r['ok'] else '★미달', th, page, RAINBOW_KO[i], edge, s, bg,
                             r['value'], fill, rf['value']))
                rr_ = rep.add(page, th, '테두리대채움(참고)', '%s' % RAINBOW_KO[i], RAINBOW[i],
                              edge, fill, ratio(edge, fill), 0, gate=False)
                print('        [%s] %-22s %s 테두리 대 채움 = %6.3f:1 (참고 · 테두리가 채움과 구별되는 정도)'
                      % (th, page, RAINBOW_KO[i], rr_['value']))
    print()

    # B-2) 2048 타일 테두리 · C) 타일 위 글자
    page = '2048/index.html'
    light, dark = tokens_by_page[page]
    print('■ B-2) 2048 타일 테두리 대 판 (하한 %.1f:1) · C) 타일 위 숫자 대 채움 (하한 %.1f:1)'
          % (NONTEXT_FLOOR, TEXT_FLOOR))
    for th, tk in (('라이트', light), ('다크', dark)):
        for v in TILE_VALUES:
            fill = token_hex('--t%s' % v, tk)
            edge = token_hex('--t%s-edge' % v, tk)
            ink = token_hex('--t%s-ink' % v, tk)
            if not fill or not edge or not ink:
                print('   ★토큰 없음 [%s] %s 타일' % (th, v))
                return 2
            for s in ('--cell', '--board'):
                sb = token_hex(s, tk)
                r = rep.add(page, th, '타일테두리대판', '%s 타일' % v, s, edge, sb,
                            ratio(edge, sb), NONTEXT_FLOOR)
                print('   %s [%s] %-10s 테두리 %s on %-8s(%s) = %6.3f:1'
                      % ('OK  ' if r['ok'] else '★미달', th, r['what'], edge, s, sb, r['value']))
            r = rep.add(page, th, '숫자대채움', '%s 숫자' % v, '--t%s' % v, ink, fill,
                        ratio(ink, fill), TEXT_FLOOR)
            print('   %s [%s] %-10s 글자 %s on 채움 %s = %6.3f:1'
                  % ('OK  ' if r['ok'] else '★미달', th, r['what'], ink, fill, r['value']))
        # 넘어선 타일 — 검정 채움과 금테 중 큰 쪽으로 판정한다
        ring = token_hex('--t-more-ring', tk)
        more = token_hex('--t-more', tk)
        ink = token_hex('--t-more-ink', tk)
        for s in ('--cell', '--board'):
            sb = token_hex(s, tk)
            rf, rr2 = ratio(more, sb), ratio(ring, sb)
            r = rep.add(page, th, '넘어선타일대판', 'more 타일(채움 또는 금테)', s, more, sb,
                        max(rf, rr2), NONTEXT_FLOOR)
            print('   %s [%s] %-22s on %-8s 채움 %s=%6.3f · 금테 %s=%6.3f → %6.3f:1'
                  % ('OK  ' if r['ok'] else '★미달', th, 'more 타일', s, more, rf, ring, rr2, r['value']))
        r = rep.add(page, th, '숫자대채움', 'more 숫자', '--t-more', ink, more,
                    ratio(ink, more), TEXT_FLOOR)
        print('   %s [%s] %-10s 글자 %s on 채움 %s = %6.3f:1'
              % ('OK  ' if r['ok'] else '★미달', th, 'more 숫자', ink, more, r['value']))
        r = rep.add(page, th, '금테대채움(참고)', '금테', '--t-more', ring, more,
                    ratio(ring, more), 0, gate=False)
        print('        [%s] 금테가 검정 타일 안에서 보이는 정도 = %6.3f:1 (참고)' % (th, r['value']))
    print()

    # D) 이웃 채움 색차
    print('■ D) 이웃한 무지개 채움의 색차 (CIEDE2000 · 하한 %.0f)' % DE_FLOOR)
    light, dark = tokens_by_page['block-drop/index.html']
    for th, tk in (('라이트', light), ('다크', dark)):
        vals = [token_hex(n, tk) for n in RAINBOW]
        for i in range(6):
            de = ciede2000(vals[i], vals[i + 1])
            r = rep.add('(팔레트)', th, '색차', '%s↔%s' % (RAINBOW_KO[i], RAINBOW_KO[i + 1]), '',
                        vals[i], vals[i + 1], de, DE_FLOOR)
            print('   %s [%s] %s  %s ↔ %s  ΔE00 = %6.2f'
                  % ('OK  ' if r['ok'] else '★미달', th, r['what'], vals[i], vals[i + 1], de))
        worst = min(ciede2000(vals[i], vals[j]) for i in range(7) for j in range(i + 1, 7))
        print('   · 모든 쌍(21개) 중 가장 비슷한 두 색의 색차 = %.2f' % worst)
    print()

    # D-2) 2048 값 사다리 색차
    print('■ D-2) 2048 값 사다리의 이웃 색차 (CIEDE2000 · 하한 %.0f)' % DE_FLOOR)
    light, dark = tokens_by_page['2048/index.html']
    ladder = ['--t%s' % v for v in TILE_VALUES] + ['--t-more']
    names = [str(v) for v in TILE_VALUES] + ['more']
    for th, tk in (('라이트', light), ('다크', dark)):
        for i in range(len(ladder) - 1):
            a, b = token_hex(ladder[i], tk), token_hex(ladder[i + 1], tk)
            de = ciede2000(a, b)
            r = rep.add('2048/index.html', th, '사다리색차', '%s→%s' % (names[i], names[i + 1]), '',
                        a, b, de, DE_FLOOR)
            print('   %s [%s] %-12s %s → %s  ΔE00 = %6.2f'
                  % ('OK  ' if r['ok'] else '★미달', th, r['what'], a, b, de))
    print()

    # E) 토큰 밖 hex
    print('■ E) 토큰 밖에 박힌 색 값')
    if hardcoded:
        for h in hardcoded:
            print('   ★박힘 %s [%s] %s   … %s' % (h['page'], h['where'], h['hex'], h['ctx']))
        rep.bad.append({'page': '(전체)', 'kind': '토큰밖hex', 'ok': False, 'gate': True,
                        'what': '%d곳' % len(hardcoded)})
    else:
        print('   OK   3개 파일 모두 0곳(색 값은 :root 토큰에만 있다)')
    print()

    gated = [r for r in rep.rows if r.get('gate')]
    print('합격·불합격을 가르는 검사 %d건 · 미달 %d건 (참고 측정 %d건은 판정에서 뺐다)'
          % (len(gated), len(rep.bad), len(rep.rows) - len(gated)))
    if rep.bad:
        print('미달 목록:')
        for r in rep.bad:
            print('  %s [%s] %s = %s (하한 %s)'
                  % (r.get('page'), r.get('theme', '-'), r.get('what'), r.get('value'), r.get('floor')))
    if outjson:
        io.open(outjson, 'w', encoding='utf-8', newline='\n').write(
            json.dumps({'rows': rep.rows, 'bad': rep.bad, 'hardcoded': hardcoded},
                       ensure_ascii=False, indent=1))
    return 1 if rep.bad else 0


if __name__ == '__main__':
    sys.exit(main())
