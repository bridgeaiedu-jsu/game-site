#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_meta_i18n_assets.py — 축 ③ko/en · ⑤메타↔실제 · ⑥자산·경로 를 23종 전수로 재는 게이트.

계약(한 문장): **문서가 말하는 것과 게임이 하는 것이 같은가** 를 세 축에서 기계로 대조한다.

- 대상 나무는 **인자로 받은 루트**다(경로를 코드에 박지 않는다 — 남의 워킹트리를 재지 않기 위해서다).
- 종료코드: 0 = 전부 통과 · 1 = 미달 있음 · 2 = 검사를 세울 수 없음(판정 불가).
  ★rc=2 는 통과가 아니다. 못 읽은 입력을 초록으로 세지 않는다.
- 분모를 항상 찍는다. "위반 0" 은 몇 건을 재서 0 인지와 함께여야 뜻이 있다.
- `--inject <스펙>` 으로 고의 결함을 **메모리 사본에만** 주입해 검출력을 잰다(대상 파일은 고치지 않는다).
"""
import argparse
import json
import os
import re
import struct
import sys

SITE = 'https://hanpango.com'

# ── 판정 결과 수집 ────────────────────────────────────────────────────────────
class Report:
    def __init__(self):
        self.rows = []      # (level, check, subject, message)
        self.denoms = {}    # check -> 잰 건수
        self.indet = []     # 판정 불가 사유

    def count(self, check, n):
        self.denoms[check] = self.denoms.get(check, 0) + n

    def fail(self, check, subject, message):
        self.rows.append(('FAIL', check, subject, message))

    def info(self, check, subject, message):
        self.rows.append(('INFO', check, subject, message))

    def cannot(self, why):
        self.indet.append(why)

    @property
    def fails(self):
        return [r for r in self.rows if r[0] == 'FAIL']


# ── 도우미 ────────────────────────────────────────────────────────────────────
def read_text(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


NUM_RE = re.compile(r'\d+(?:\.\d+)?')


# 영어는 작은 수를 낱말로 적는다('Ten-Second Sense' 는 '10초 감각' 과 같은 것을 말한다).
# 낱말을 수로 못 읽으면 ko 의 수가 en 에서 통째로 사라진 것처럼 보인다(2026-09-05 실측: 8건 오탐).
WORD_NUM = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
    'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'fifteen': 15,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'ninety': 90,
}
WORD_NUM_RE = re.compile(r'\b(%s)\b' % '|'.join(sorted(WORD_NUM, key=len, reverse=True)), re.I)


def numbers(s):
    """문자열이 말하는 수들(다중집합 비교용). 아라비아 숫자 + 영어 수사 낱말."""
    out = [float(x) for x in NUM_RE.findall(s)]
    out += [float(WORD_NUM[w.lower()]) for w in WORD_NUM_RE.findall(s)]
    return out


HANGUL_RE = re.compile(r'[가-힣]')


def ko_playtime_max_minutes(s):
    """'한 판 12~20초' -> 0.333 · '한 판 1~3분' -> 3.0 · '한 판 20초~' -> (열린 상한, None)

    반환 (분, 열린상한여부). 단위를 못 읽으면 (None, False).
    """
    nums = numbers(s)
    if not nums:
        return None, False
    open_ended = s.strip().endswith('~')
    if '분' in s or 'min' in s:
        unit = 60.0
    elif '초' in s or 'sec' in s or ' s ' in s or s.strip().endswith('s'):
        unit = 1.0
    else:
        return None, open_ended
    return max(nums) * unit / 60.0, open_ended


def en_playtime_max_minutes(s):
    nums = numbers(s)
    if not nums:
        return None, False
    open_ended = 'and up' in s.lower()
    low = s.lower()
    if 'min' in low:
        unit = 60.0
    elif 'sec' in low or re.search(r'\d\s*s\b', low):
        unit = 1.0
    else:
        return None, open_ended
    return max(nums) * unit / 60.0, open_ended


def webp_size(path):
    """WebP 파일의 (폭, 높이). WebP 가 아니거나 못 읽으면 None 을 준다."""
    with open(path, 'rb') as f:
        head = f.read(32)
    if len(head) < 30 or head[0:4] != b'RIFF' or head[8:12] != b'WEBP':
        return None
    fourcc = head[12:16]
    if fourcc == b'VP8 ':
        # lossy: 프레임 태그 뒤 0x9d012a 동기코드
        if head[23:26] != b'\x9d\x01\x2a':
            return None
        w, h = struct.unpack('<HH', head[26:30])
        return (w & 0x3fff, h & 0x3fff)
    if fourcc == b'VP8L':
        b = head[21:26]
        if len(b) < 5 or b[0] != 0x2f:
            return None
        bits = b[1] | (b[2] << 8) | (b[3] << 16) | (b[4] << 24)
        return ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    if fourcc == b'VP8X':
        w = head[24] | (head[25] << 8) | (head[26] << 16)
        h = head[27] | (head[28] << 8) | (head[29] << 16)
        return (w + 1, h + 1)
    return None


# ── 페이지의 언어 사전 뽑기 ───────────────────────────────────────────────────
# 이 사이트의 관행: `const STR = { ko:{...}, en:{...} }` 또는 `const KO = {...}; const EN = {...}`.
# 표기가 여러 갈래라 **못 읽으면 판정 불가**로 올린다(모르면 초록 금지).
DICT_HEAD_RE = re.compile(r'(?m)^\s*(?:const\s+)?(KO|EN|ko|en)\s*[:=]\s*\{')


def brace_block(src, open_idx):
    """open_idx 의 '{' 부터 짝이 맞는 '}' 까지. 문자열·주석 안의 중괄호는 세지 않는다."""
    i, depth = open_idx, 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in '"\'`':
            q = c
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q:
                    break
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            i = (j + 1) if j != -1 else n
        elif c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            i = (j) if j != -1 else n
            continue
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[open_idx:i + 1]
        i += 1
    return None


IDENT_RE = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')


def dict_keys(block):
    """블록의 **최상위 깊이** 키 이름들.

    ★들여쓰기로 자르지 않는다 — 이 사이트는 한 줄에 키를 여럿 적는다
    (`gameOver:'게임 오버', again:'다시 하기',`). 줄머리 정규식으로 세면 그 줄의 둘째부터가
    통째로 빠져 **있는 키를 없다고** 말한다(2026-09-05 실측: 23종 전부 오탐).
    그래서 문자열·주석·괄호 깊이를 세면서 depth==1 의 `이름:` 만 집는다.
    """
    keys = set()
    i, n = 0, len(block)
    depth = 0
    while i < n:
        c = block[i]
        if c in '"\'`':
            q = c
            i += 1
            while i < n:
                if block[i] == '\\':
                    i += 2
                    continue
                if block[i] == q:
                    break
                i += 1
            i += 1
            continue
        if c == '/' and i + 1 < n and block[i + 1] == '*':
            j = block.find('*/', i + 2)
            i = (j + 2) if j != -1 else n
            continue
        if c == '/' and i + 1 < n and block[i + 1] == '/':
            j = block.find('\n', i)
            i = (j + 1) if j != -1 else n
            continue
        if c in '{[(':
            depth += 1
            i += 1
            continue
        if c in '}])':
            depth -= 1
            i += 1
            continue
        m = IDENT_RE.match(block, i) if depth == 1 else None
        if m is not None:
            j = m.end()
            k = j
            while k < n and block[k] in ' \t':
                k += 1
            # `이름:` 만 키다. `이름 =>` · `이름(` 는 화살표 함수의 인자라 키가 아니다.
            if k < n and block[k] == ':' and not (k + 1 < n and block[k + 1] == ':'):
                keys.add(m.group(0))
            i = j
            continue
        i += 1
    return keys


def extract_lang_dicts(src):
    """(ko키집합, en키집합) 또는 None(못 읽음)."""
    found = {}
    for m in DICT_HEAD_RE.finditer(src):
        name = m.group(1).lower()
        if name in found:
            continue
        blk = brace_block(src, src.index('{', m.end() - 1))
        if blk is None:
            return None
        found[name] = dict_keys(blk)
    if 'ko' in found and 'en' in found:
        return found['ko'], found['en']
    return None


# ── 축 ③ ko ↔ en ─────────────────────────────────────────────────────────────
LOCALIZED = ('title', 'desc', 'playtime')


def axis3(root, games, rep):
    for g in games:
        gid = g.get('id', '?')
        for field in LOCALIZED:
            v = g.get(field)
            rep.count('i18n-both-langs', 1)
            if not isinstance(v, dict) or not v.get('ko') or not v.get('en'):
                rep.fail('i18n-both-langs', gid, '%s 에 ko·en 이 둘 다 비어 있지 않게 있어야 한다: %r' % (field, v))
                continue
            # ★한글이 든 문안만 잰다. '2048' 처럼 두 언어에서 같은 것이 옳은 이름도 있어서,
            #   같음 자체를 미달로 세면 옳은 것을 붉게 만든다(2026-09-05 실측: 2048 오탐).
            #   잡으려는 병은 "ko 산문이 en 자리에 그대로 복사됨" 이다.
            if HANGUL_RE.search(v['ko']):
                rep.count('i18n-not-identical', 1)
                if v['ko'].strip() == v['en'].strip():
                    rep.fail('i18n-not-identical', gid,
                             '%s 의 en 이 한글 ko 문안과 글자까지 같다(한쪽만 고친 자리) — %r' % (field, v['ko']))
            # ★두 갈래로 나눈다. playtime 은 **구조가 정해진 값**(한 판 N분)이라 두 언어가
            #   반드시 같은 수를 말해야 한다 — 어긋나면 미달이다.
            #   title·desc 는 자유 산문이라 관사 'one'·'a' 와 낱말 수사가 섞여
            #   수 다중집합이 원리적으로 안 맞는다. 여기서 미달을 내면 옳은 문장을 붉게 만들고
            #   진짜 신호가 소음에 묻힌다. 그래서 **판정하지 않고 양쪽을 인용해 올린다**(사람 판정).
            nk, ne = sorted(numbers(v['ko'])), sorted(numbers(v['en']))
            if field == 'playtime':
                rep.count('i18n-numbers-agree-playtime', 1)
                if nk != ne:
                    rep.fail('i18n-numbers-agree-playtime', gid,
                             'playtime 의 수가 두 언어에서 다르다 — ko %s / en %s (ko=%r, en=%r)'
                             % (nk, ne, v['ko'], v['en']))
            else:
                rep.count('i18n-prose-number-divergence', 1)
                if nk != ne:
                    rep.info('i18n-prose-number-divergence', gid,
                             '%s 의 수가 두 언어에서 다르다(산문 — 사람 판정) — ko %s / en %s\n        ko: %s\n        en: %s'
                             % (field, nk, ne, v['ko'], v['en']))

    # 페이지 안의 언어 사전 키 짝
    for g in games:
        gid = g.get('id', '?')
        page = os.path.join(root, g['path'].strip('/'), 'index.html')
        if not os.path.isfile(page):
            continue  # ⑥ 에서 미달로 잡는다
        src = read_text(page)
        pair = extract_lang_dicts(src)
        rep.count('i18n-dict-key-parity', 1)
        if pair is None:
            rep.cannot('%s: ko·en 사전을 못 읽었다(표기가 이 도구가 아는 꼴이 아니다)' % gid)
            continue
        ko_keys, en_keys = pair
        only_ko, only_en = sorted(ko_keys - en_keys), sorted(en_keys - ko_keys)
        if only_ko or only_en:
            rep.fail('i18n-dict-key-parity', gid,
                     'ko 에만 %s · en 에만 %s (한쪽 언어에만 있는 문안)' % (only_ko or '없음', only_en or '없음'))

        # data-i18n 이 가리키는 키가 두 사전에 다 있는가
        used = set(re.findall(r'data-i18n="([A-Za-z0-9_$]+)"', src))
        rep.count('i18n-data-i18n-covered', len(used))
        missing = sorted(k for k in used if k not in ko_keys or k not in en_keys)
        if missing:
            rep.fail('i18n-data-i18n-covered', gid,
                     'data-i18n 이 부르는데 두 사전에 다 있지는 않은 키: %s' % missing)


# ── 축 ⑤ 메타 ↔ 실제 ─────────────────────────────────────────────────────────
REQUIRED = ('id', 'path', 'title', 'desc', 'thumb', 'playtime', 'maxMinutes',
            'daily', 'category', 'released', 'tags')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def axis5(root, games, rep, palette_categories):
    ids = set()
    for g in games:
        gid = g.get('id', '?')
        rep.count('meta-required-fields', 1)
        missing = [k for k in REQUIRED if k not in g]
        if missing:
            rep.fail('meta-required-fields', gid, '빠진 필드: %s' % missing)

        rep.count('meta-id-unique', 1)
        if gid in ids:
            rep.fail('meta-id-unique', gid, 'id 가 중복이다')
        ids.add(gid)

        rep.count('meta-path-matches-id', 1)
        if g.get('path') != '/%s/' % gid:
            rep.fail('meta-path-matches-id', gid, 'path 가 /<id>/ 꼴이 아니다: %r' % g.get('path'))

        rep.count('meta-thumb-path', 1)
        if g.get('thumb') != '%sthumb.webp' % g.get('path', ''):
            rep.fail('meta-thumb-path', gid, 'thumb 가 <path>thumb.webp 가 아니다: %r' % g.get('thumb'))

        # maxMinutes 의 계약: /today/ 가 이것으로 "세 판 합 <= 12분" 을 약속한다.
        # 그러니 maxMinutes 는 실제 상한보다 **작으면 안 된다**(약속이 깨진다).
        # 크기만 한 것은 보수적이라 미달이 아니라 INFO 다 — 다만 다수파(20/23)는 정확 환산이다.
        km, k_open = ko_playtime_max_minutes(g.get('playtime', {}).get('ko', ''))
        rep.count('meta-maxminutes-covers-playtime', 1)
        mm = g.get('maxMinutes')
        if km is None:
            rep.cannot('%s: ko playtime 에서 상한을 못 읽었다 — %r' % (gid, g.get('playtime', {}).get('ko')))
        elif not isinstance(mm, (int, float)):
            rep.fail('meta-maxminutes-covers-playtime', gid, 'maxMinutes 가 수가 아니다: %r' % mm)
        elif not k_open and mm + 1e-9 < km:
            rep.fail('meta-maxminutes-covers-playtime', gid,
                     'maxMinutes %s 가 문면 상한 %.3f분(%r)보다 작다 — /today/ 의 합 약속이 깨진다'
                     % (mm, km, g['playtime']['ko']))
        elif not k_open and mm > km + 0.01:
            rep.info('meta-maxminutes-exact', gid,
                     'maxMinutes %s 가 문면 상한 %.3f분(%r)보다 크다(보수적 — 다수파는 정확 환산)'
                     % (mm, km, g['playtime']['ko']))

        em, e_open = en_playtime_max_minutes(g.get('playtime', {}).get('en', ''))
        rep.count('meta-playtime-ko-en-same-length', 1)
        if km is not None and em is not None and abs(km - em) > 1e-6:
            rep.fail('meta-playtime-ko-en-same-length', gid,
                     'ko 와 en 의 상한이 다르다 — ko %.3f분(%r) / en %.3f분(%r)'
                     % (km, g['playtime']['ko'], em, g['playtime']['en']))

        tags = g.get('tags') or []
        rep.count('meta-tags-daily-flag', 1)
        if bool(g.get('daily')) != ('daily' in tags):
            rep.fail('meta-tags-daily-flag', gid,
                     "daily=%r 인데 tags 의 'daily' 유무는 %r 이다 (%s)"
                     % (g.get('daily'), 'daily' in tags, tags))

        rep.count('meta-category-known', 1)
        if palette_categories is not None and g.get('category') not in palette_categories:
            rep.fail('meta-category-known', gid,
                     'category %r 가 팔레트 정본에 없다(있는 것: %s)'
                     % (g.get('category'), sorted(palette_categories)))

        rep.count('meta-solo-vs-category', 1)
        two = g.get('category') == 'two-player'
        solo_false = g.get('solo') is False
        if two != solo_false:
            rep.fail('meta-solo-vs-category', gid,
                     "category=%r 인데 solo=%r 이다 — /today/ 는 solo!==false 로만 후보를 고른다"
                     % (g.get('category'), g.get('solo')))

        rep.count('meta-released-date', 1)
        if not DATE_RE.match(str(g.get('released', ''))):
            rep.fail('meta-released-date', gid, 'released 가 YYYY-MM-DD 가 아니다: %r' % g.get('released'))

    # games.json ↔ index.html 의 FALLBACK 이 같은 메타를 말하는가
    home = os.path.join(root, 'index.html')
    if not os.path.isfile(home):
        rep.cannot('index.html 이 없다 — FALLBACK 대조를 세울 수 없다')
        return
    src = read_text(home)
    for g in games:
        gid = g.get('id', '?')
        m = re.search(r"id:'%s'.*?\n[^\n]*?tags:\[([^\]]*)\]" % re.escape(gid), src, re.S)
        rep.count('meta-fallback-parity', 1)
        if not m:
            rep.cannot('%s: index.html FALLBACK 에서 이 항목을 못 찾았다' % gid)
            continue
        seg = src[m.start():m.end()]
        for key in ('maxMinutes', 'category', 'released'):
            want = g.get(key)
            mk = re.search(r"%s:\s*'?([^,'\n}]+)'?" % key, seg)
            if not mk:
                rep.fail('meta-fallback-parity', gid, 'FALLBACK 에 %s 가 없다' % key)
                continue
            got = mk.group(1).strip().strip("'")
            if str(want) != got:
                rep.fail('meta-fallback-parity', gid,
                         'FALLBACK 의 %s 가 games.json 과 다르다 — json=%r fallback=%r' % (key, want, got))
        fb_tags = [t.strip().strip("'") for t in m.group(1).split(',') if t.strip()]
        if fb_tags != list(g.get('tags') or []):
            rep.fail('meta-fallback-parity', gid,
                     'FALLBACK 의 tags 가 games.json 과 다르다 — json=%s fallback=%s' % (g.get('tags'), fb_tags))
        if bool(g.get('daily')) != ('daily:true' in seg.replace(' ', '')):
            rep.fail('meta-fallback-parity', gid,
                     'FALLBACK 의 daily 가 games.json(%r)과 다르다' % g.get('daily'))


# ── 축 ⑥ 자산 · 경로 ─────────────────────────────────────────────────────────
THUMB_WH = (640, 640)   # index.html 이 카드 img 에 width/height 로 적어 둔 값


def axis6(root, games, rep, pages_extra):
    home = os.path.join(root, 'index.html')
    home_src = read_text(home) if os.path.isfile(home) else ''

    for g in games:
        gid = g.get('id', '?')
        path = g.get('path', '')
        page = os.path.join(root, path.strip('/'), 'index.html')

        rep.count('asset-page-exists', 1)
        if not os.path.isfile(page):
            rep.fail('asset-page-exists', gid, '%s 가 없다' % page)
            continue

        thumb = os.path.join(root, (g.get('thumb') or '').lstrip('/'))
        rep.count('asset-thumb-exists', 1)
        if not os.path.isfile(thumb):
            rep.fail('asset-thumb-exists', gid, '썸네일 파일이 없다: %s' % g.get('thumb'))
        else:
            rep.count('asset-thumb-webp-640', 1)
            size = webp_size(thumb)
            if size is None:
                rep.fail('asset-thumb-webp-640', gid, '%s 가 WebP 가 아니거나 머리를 못 읽는다' % g.get('thumb'))
            elif size != THUMB_WH:
                rep.fail('asset-thumb-webp-640', gid,
                         '썸네일이 %dx%d 다 — 대문 카드는 %dx%d 로 적어 둔다(레이아웃 밀림)'
                         % (size[0], size[1], THUMB_WH[0], THUMB_WH[1]))

        src = read_text(page)
        want = SITE + path

        rep.count('asset-canonical', 1)
        m = re.search(r'<link rel="canonical" href="([^"]+)"', src)
        if not m:
            rep.fail('asset-canonical', gid, 'canonical 이 없다')
        elif m.group(1) != want:
            rep.fail('asset-canonical', gid, 'canonical 이 %r 인데 %r 여야 한다' % (m.group(1), want))

        rep.count('asset-og-url', 1)
        m = re.search(r'property="og:url" content="([^"]+)"', src)
        if not m:
            rep.fail('asset-og-url', gid, 'og:url 이 없다')
        elif m.group(1) != want:
            rep.fail('asset-og-url', gid, 'og:url 이 %r 인데 %r 여야 한다' % (m.group(1), want))

        for prop in ('og:title', 'og:description', 'og:type'):
            rep.count('asset-og-required', 1)
            if not re.search(r'property="%s" content="[^"]+"' % prop, src):
                rep.fail('asset-og-required', gid, '%s 가 없거나 비어 있다' % prop)

        rep.count('asset-title-tag', 1)
        mt = re.search(r'<title>([^<]+)</title>', src)
        if not mt:
            rep.fail('asset-title-tag', gid, '<title> 이 없다')
        else:
            ko_title = (g.get('title') or {}).get('ko', '')
            en_title = (g.get('title') or {}).get('en', '')
            if ko_title and ko_title not in mt.group(1):
                rep.fail('asset-title-tag', gid,
                         '<title> 에 games.json 의 ko 제목(%r)이 없다 — %r' % (ko_title, mt.group(1)))
            elif en_title and en_title.lower() not in mt.group(1).lower():
                rep.info('asset-title-en', gid,
                         '<title> 에 en 제목(%r)이 없다 — %r' % (en_title, mt.group(1)))

        # 대문 카드가 이 게임을 가리키는가
        rep.count('asset-home-card', 1)
        if home_src:
            if ('href="%s"' % path) not in home_src:
                rep.fail('asset-home-card', gid, '대문에 %s 로 가는 링크가 없다' % path)
            elif ('src="%s"' % g.get('thumb')) not in home_src:
                rep.fail('asset-home-card', gid, '대문 카드가 %s 를 쓰지 않는다' % g.get('thumb'))

    # 내부 링크 실재 — 게임 23종 + 사이트 페이지
    targets = [(g.get('id', '?'), os.path.join(root, g['path'].strip('/'), 'index.html')) for g in games]
    targets += [(name, os.path.join(root, rel)) for name, rel in pages_extra]
    for name, page in targets:
        if not os.path.isfile(page):
            continue
        src = read_text(page)
        hrefs = set(re.findall(r'(?:href|src)="(/[^"#?]*)"', src))
        rep.count('asset-internal-links', len(hrefs))
        for h in sorted(hrefs):
            if h.startswith('//'):
                continue
            cand = os.path.join(root, h.lstrip('/'))
            ok = os.path.isfile(cand) or (h.endswith('/') and os.path.isfile(os.path.join(cand, 'index.html')))
            if not ok:
                rep.fail('asset-internal-links', name, '내부 링크가 가리키는 것이 없다: %s' % h)


# ── 뮤테이션(검출력) ─────────────────────────────────────────────────────────
MUTATIONS = {
    'm-en-copy-ko':        ('games.json', 'en 문안을 ko 로 덮는다', 'i18n-not-identical'),
    'm-en-number-drift':   ('games.json', 'en playtime 의 수를 바꾼다', 'i18n-numbers-agree-playtime'),
    'm-maxminutes-under':  ('games.json', 'maxMinutes 를 문면 상한보다 작게 만든다', 'meta-maxminutes-covers-playtime'),
    'm-daily-tag-drop':    ('games.json', "daily=true 인데 tags 의 'daily' 를 뺀다", 'meta-tags-daily-flag'),
    'm-solo-drop':         ('games.json', '2인용의 solo:false 를 지운다', 'meta-solo-vs-category'),
    'm-thumb-missing':     ('games.json', 'thumb 를 없는 파일로 돌린다', 'asset-thumb-exists'),
    'm-canonical-drift':   ('page', 'canonical 을 다른 주소로 바꾼다', 'asset-canonical'),
    'm-dead-link':         ('page', '없는 내부 링크를 넣는다', 'asset-internal-links'),
    'm-i18n-key-drop':     ('page', 'en 사전에서 키 한 줄을 지운다', 'i18n-dict-key-parity'),
    'm-fallback-drift':    ('index', 'FALLBACK 의 maxMinutes 를 흔든다', 'meta-fallback-parity'),
}


def apply_mutation(name, games, texts, root):
    """메모리 위의 사본만 바꾼다. (성공 여부, 설명) 을 준다. 주입 실패는 통과가 아니다."""
    if name == 'm-en-copy-ko':
        games[0]['desc']['en'] = games[0]['desc']['ko']
        return True, games[0]['id']
    if name == 'm-en-number-drift':
        g = games[0]
        g['playtime']['en'] = re.sub(r'\d+', '99', g['playtime']['en'], count=1)
        return True, g['id']
    if name == 'm-maxminutes-under':
        for g in games:
            km, op = ko_playtime_max_minutes(g['playtime']['ko'])
            if km and not op:
                g['maxMinutes'] = km / 2.0
                return True, g['id']
        return False, '적용 대상 없음'
    if name == 'm-daily-tag-drop':
        for g in games:
            if g.get('daily') and 'daily' in g.get('tags', []):
                g['tags'] = [t for t in g['tags'] if t != 'daily']
                return True, g['id']
        return False, '적용 대상 없음'
    if name == 'm-solo-drop':
        for g in games:
            if g.get('solo') is False:
                del g['solo']
                return True, g['id']
        return False, '적용 대상 없음'
    if name == 'm-thumb-missing':
        games[0]['thumb'] = games[0]['path'] + 'no-such-thumb.webp'
        return True, games[0]['id']
    if name == 'm-canonical-drift':
        key = games[0]['path'].strip('/') + '/index.html'
        if key not in texts:
            return False, '대상 페이지 없음'
        texts[key] = re.sub(r'(<link rel="canonical" href=")[^"]+', r'\1https://example.com/nope/', texts[key])
        return True, key
    if name == 'm-dead-link':
        key = games[0]['path'].strip('/') + '/index.html'
        if key not in texts:
            return False, '대상 페이지 없음'
        texts[key] = texts[key].replace('</head>', '<link rel="preload" href="/no-such-file.css"></head>', 1)
        return True, key
    if name == 'm-i18n-key-drop':
        for g in games:
            key = g['path'].strip('/') + '/index.html'
            if key not in texts:
                continue
            pair = extract_lang_dicts(texts[key])
            if not pair:
                continue
            common = sorted(pair[0] & pair[1])
            if not common:
                continue
            victim = common[-1]
            src = texts[key]
            m = DICT_HEAD_RE.search(src)
            # en 사전 쪽에서만 지운다
            for mm in DICT_HEAD_RE.finditer(src):
                if mm.group(1).lower() != 'en':
                    continue
                blk_start = src.index('{', mm.end() - 1)
                blk = brace_block(src, blk_start)
                if blk is None:
                    continue
                new = re.sub(r'(?m)^\s{2,}%s\s*:.*\n' % re.escape(victim), '', blk, count=1)
                if new == blk:
                    continue
                texts[key] = src[:blk_start] + new + src[blk_start + len(blk):]
                return True, '%s:%s' % (g['id'], victim)
        return False, '적용 대상 없음'
    if name == 'm-fallback-drift':
        if 'index.html' not in texts:
            return False, 'index.html 없음'
        texts['index.html'] = texts['index.html'].replace('maxMinutes:3,', 'maxMinutes:333,', 1)
        return True, 'index.html'
    return False, '모르는 뮤테이션'


# ── 실행 ─────────────────────────────────────────────────────────────────────
SITE_PAGES = [('about', 'about/index.html'), ('privacy', 'privacy/index.html'),
              ('today', 'today/index.html'), ('home', 'index.html'), ('404', '404.html')]


def load_palette_categories(root):
    p = os.path.join(root, 'tools', 'palette_by_category.json')
    if not os.path.isfile(p):
        return None
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception:
        return None
    if isinstance(d, dict):
        for key in ('categories', 'byCategory'):
            if key in d and isinstance(d[key], dict):
                return set(d[key].keys())
        return set(d.keys())
    return None


def run(root, mutate=None):
    rep = Report()
    gj = os.path.join(root, 'games.json')
    if not os.path.isfile(gj):
        print('rc=2 판정 불가: games.json 이 없다 — %s' % gj)
        return 2, rep
    games = json.load(open(gj, encoding='utf-8'))
    if not isinstance(games, list) or not games:
        print('rc=2 판정 불가: games.json 이 목록이 아니거나 비었다')
        return 2, rep

    if mutate:
        # 파일을 고치지 않는다 — 사본을 메모리에서 흔들고, 읽기를 그 사본으로 돌린다.
        texts = {}
        for g in games:
            k = g['path'].strip('/') + '/index.html'
            fp = os.path.join(root, k)
            if os.path.isfile(fp):
                texts[k] = read_text(fp)
        for _, rel in SITE_PAGES:
            fp = os.path.join(root, rel)
            if os.path.isfile(fp):
                texts[rel] = read_text(fp)
        ok, where = apply_mutation(mutate, games, texts, root)
        if not ok:
            print('rc=2 주입 실패(%s): %s — 주입 실패는 탐지가 아니다' % (mutate, where))
            return 2, rep
        global read_text_orig
        _orig = read_text

        def patched(path):
            rel = os.path.relpath(path, root).replace(os.sep, '/')
            if rel in texts:
                return texts[rel]
            return _orig(path)
        globals()['read_text'] = patched
        print('주입: %s → %s' % (mutate, where))

    pal = load_palette_categories(root)
    if pal is None:
        rep.cannot('tools/palette_by_category.json 을 못 읽었다 — category 정본 대조를 세울 수 없다')

    axis3(root, games, rep)
    axis5(root, games, rep, pal)
    axis6(root, games, rep, SITE_PAGES)

    if mutate:
        globals()['read_text'] = _orig
    return None, rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default='.')
    ap.add_argument('--json', help='측정값을 이 파일로')
    ap.add_argument('--inject', help='뮤테이션 이름(검출력 확인 · 대상 파일은 고치지 않는다)')
    ap.add_argument('--selftest', action='store_true', help='뮤테이션 전종을 돌려 검출력 표를 찍는다')
    args = ap.parse_args()
    root = os.path.abspath(args.root)

    if args.selftest:
        base_rc, base = run(root)
        if base_rc == 2:
            return 2
        # ★판정 단위는 검사 이름이 아니라 (검사, 대상) 짝이다.
        #   이름으로만 세면, 기준선에서 이미 붉은 검사를 겨냥한 뮤테이션이
        #   "원래 붉었다"는 이유로 공허해진다 — 실제로는 **다른 대상**이 새로 붉어졌는데도.
        #   (2026-09-05 실측: minesweeper 때문에 i18n-dict-key-parity 가 기준선에서 붉어
        #   m-i18n-key-drop 이 공허로 잡혔다. 짝으로 세면 2048 이 새로 붉어진 것이 보인다.)
        base_checks = set((c, s) for _, c, s, _ in base.fails)
        print('기준선: 미달 %d건 · 판정불가 %d건' % (len(base.fails), len(base.indet)))
        print('%-22s %-38s %-10s %s' % ('뮤테이션', '무엇을 흔드는가', '겨냥한 검사', '결과'))
        bad = 0
        for name, (_, what, aimed) in MUTATIONS.items():
            rc, rep = run(root, mutate=name)
            if rc == 2:
                print('%-22s %-38s %-10s 주입실패(탐지 아님)' % (name, what, aimed))
                bad += 1
                continue
            got = set((c, s) for _, c, s, _ in rep.fails)
            new = got - base_checks
            aimed_new = sorted(s for c, s in new if c == aimed)
            if aimed_new:
                verdict = '탐지 (%s · 새로 붉어진 대상 %s)' % (aimed, aimed_new)
            elif new:
                verdict = '겨냥 밖에서만 붉음 %s — 무임승차' % sorted(new)
                bad += 1
            else:
                verdict = '미탐지'
                bad += 1
            print('%-22s %-38s %-10s %s' % (name, what, aimed, verdict))
        print('\n어긋남 %d건 (0 이 합격선)' % bad)
        return 0 if bad == 0 else 1

    rc, rep = run(root, mutate=args.inject)
    if rc == 2:
        return 2

    print('# check_meta_i18n_assets — 축 ③ko/en · ⑤메타↔실제 · ⑥자산·경로')
    print('대상 나무: %s' % root)
    print('게임 %d종 · 사이트 페이지 %d종\n' % (
        len(json.load(open(os.path.join(root, 'games.json'), encoding='utf-8'))), len(SITE_PAGES)))

    print('## 잰 것 (검사별 분모)')
    for c in sorted(rep.denoms):
        n_fail = len([1 for _, cc, _, _ in rep.fails if cc == c])
        print('  %-34s 잰 건수 %-5d 미달 %d' % (c, rep.denoms[c], n_fail))

    infos = [r for r in rep.rows if r[0] == 'INFO']
    if infos:
        print('\n## 참고(미달 아님)')
        for _, c, s, m in infos:
            print('  [%s] %s — %s' % (c, s, m))

    if rep.fails:
        print('\n## 미달')
        for _, c, s, m in rep.fails:
            print('  [%s] %s — %s' % (c, s, m))

    if rep.indet:
        print('\n## 판정 불가 (통과로 세지 않는다)')
        for w in rep.indet:
            print('  %s' % w)

    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({'root': root, 'denominators': rep.denoms,
                       'rows': [{'level': l, 'check': c, 'subject': s, 'message': m} for l, c, s, m in rep.rows],
                       'indeterminate': rep.indet}, f, ensure_ascii=False, indent=1)

    if rep.indet:
        print('\nrc=2 (판정 불가 %d건)' % len(rep.indet))
        return 2
    if rep.fails:
        print('\nrc=1 (미달 %d건)' % len(rep.fails))
        return 1
    print('\nrc=0 (미달 0 · 판정 불가 0)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
