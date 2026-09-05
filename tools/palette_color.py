"""sRGB <-> OKLab/OKLCH + WCAG contrast. 값은 계산으로 얻는다(눈으로 정하지 않는다)."""
import math

def hex2rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c*2 for c in h)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rgb2hex(rgb):
    return '#' + ''.join('%02x' % max(0, min(255, int(round(c)))) for c in rgb)

def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _unlin(c):
    c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return c * 255

def luminance(h):
    r, g, b = hex2rgb(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

def hex2oklab(h):
    r, g, b = [_lin(v) for v in hex2rgb(h)]
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = l ** (1/3), m ** (1/3), s ** (1/3)
    return (0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_)

def oklab2rgb(L, a, b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(_unlin(v) for v in (r, g, bb))

def hex2lch(h):
    L, a, b = hex2oklab(h)
    return (L * 100, math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360)

def lch2hex(L, C, H):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    return rgb2hex(oklab2rgb(L / 100, a, b))

def in_gamut(L, C, H, tol=0.6):
    """gamut 밖이면 브라우저가 색을 끌어당겨 선언과 렌더가 갈라진다 — 왕복해서 확인한다."""
    h = lch2hex(L, C, H)
    L2, C2, H2 = hex2lch(h)
    return abs(L2 - L) < tol and abs(C2 - C) < 0.01 and (abs((H2 - H + 180) % 360 - 180) < 2 or C < 0.005)

def huedist(h1, h2):
    return abs((h1 - h2 + 180) % 360 - 180)

# ── HSL ────────────────────────────────────────────────────────────────────
# ★규약과 티켓의 색상각·명도는 HSL 이다(검증: together 기준색 #db2777 -> H=333.3 L=50.6,
#   다크 #f472b6 -> H=328.6 L=70.2, 색상차 4.7 — 규약이 적은 값과 일치한다).
def hex2hsl(h):
    r, g, b = [v / 255 for v in hex2rgb(h)]
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    d = mx - mn
    if d == 0:
        return (0.0, 0.0, l * 100)
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        hh = ((g - b) / d) % 6
    elif mx == g:
        hh = (b - r) / d + 2
    else:
        hh = (r - g) / d + 4
    return (hh * 60 % 360, s * 100, l * 100)

def hsl2hex(h, s, l):
    h, s, l = h % 360, s / 100, l / 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    r, g, b = [((c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x))[int(h // 60) % 6][i] for i in range(3)]
    return rgb2hex([(v + m) * 255 for v in (r, g, b)])

def deltaE_ok(a, b):
    """OKLab 유클리드 거리 — 계약(구별된다)을 축이 아니라 색공간 거리로 잰다."""
    la, aa, ba = hex2oklab(a)
    lb, ab, bb = hex2oklab(b)
    return math.sqrt((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2)
