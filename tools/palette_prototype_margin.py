#!/usr/bin/env python3
"""분류 ★원형 여유 측정기 — 계약 "색을 보면 종류를 안다" 를 ★원형 거리로 잰다.

★왜 최근접 이웃(1-NN)이 아니라 원형인가(2026-09-06 gemini R1 재반박 · master 채택):
  이웃 카드와 갈리는 것과, ★그 카드가 자기 종류로 읽히는 것은 다른 말이다. 앞의 것은
  옆에 무엇이 있느냐에 따라 답이 바뀌고, 뒤의 것은 ★분류의 원형에 얼마나 가까운가로 정해진다.

정의(★master 가 고정 · 여기서 새로 만들지 않는다):
  · 라이트 원형 = 정본 tools/palette_by_category.json 의 그 분류 기준색
  · 다크  원형 = 그 분류 ★대표 게임의 다크 --sig
  · 대표      = 라이트 --sig 가 정본 기준색과 같은 게임(없으면 games.json 첫 게임)
  · 색차      = CIEDE2000 · 지각 임계 = 1.0
  · 여유(margin) = (자기 아닌 원형 중 가장 가까운 것까지의 dE) - (자기 원형까지의 dE)
                   ⇒ 음수면 ★다른 분류로 읽힌다 · 1.0 미만이면 ★사람 눈이 못 가른다

★이 파일은 ★재기만 한다. 정본에도 소스에도 쓰지 않는다 — 후보 L 마다 ★저장소 사본을 떠서
그 사본에만 적고, 사본에서 palette_gen 과 check_palette 를 돌린다(값 확정은 master).

사용법: python3 tools/palette_prototype_margin.py 47.0 47.5 48.0 48.5
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

from palette_color import hex2hsl, hsl2hex          # noqa: E402
from check_rainbow import ciede2000                 # noqa: E402

THRESHOLD = 1.0
TOKENS = ('--sig', '--sig-ink', '--sig-soft', '--on-sig')
NL = chr(10)


def sh(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def copy_repo(dst):
    """저장소를 사본으로 뜬다 — .git 은 빼고(우리는 파일만 잰다)."""
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))


def set_canon(root, sig):
    p = os.path.join(root, 'tools', 'palette_by_category.json')
    d = json.load(io.open(p, encoding='utf-8'))
    d['categories']['puzzle']['sig'] = sig
    io.open(p, 'w', encoding='utf-8', newline=NL).write(json.dumps(d, ensure_ascii=False, indent=2) + NL)


def gen_values(root):
    rc, out = sh(['python3', os.path.join('tools', 'palette_gen.py')], root)
    if rc != 0:
        return None, out.strip().splitlines()[-1] if out.strip() else ('rc=%d' % rc)
    return json.loads(out[out.index('{'):]), None


def apply_puzzle(root, values):
    """puzzle 7종의 :root 4토큰만 사본에 적는다(실제 변경과 같은 범위)."""
    line = lambda v: '--sig:%s; --sig-ink:%s; --sig-soft:%s; --on-sig:%s;' % tuple(v[t] for t in TOKENS)
    for gid, vals in values['values']['puzzle'].items():
        p = os.path.join(root, gid, 'index.html')
        src = io.open(p, encoding='utf-8').read().split(NL)
        hits = [i for i, t in enumerate(src) if '--sig:' in t and '--sig-ink:' in t]
        if len(hits) != 2:
            return '토큰 줄이 2개가 아니다: %s(%d)' % (gid, len(hits))
        for idx, theme in zip(hits, ('light', 'dark')):
            indent = re.match(r'\s*', src[idx]).group(0)
            src[idx] = indent + line(vals[theme])
        io.open(p, 'w', encoding='utf-8', newline=NL).write(NL.join(src))
    # ★대문 카드 배선도 함께 적는다 — 안 적으면 check_palette 검사1 이 '카드 색이 다르다' 로
    #   붉어지고, 그것은 ★후보의 결함이 아니라 ★내 측정의 결함이다(2026-09-07 실측으로 잡았다).
    ip = os.path.join(root, 'index.html')
    html = io.open(ip, encoding='utf-8').read()
    for gid, vals in values['values']['puzzle'].items():
        pat = re.compile(r'(\.card\[href="/%s/"\]\{--sig:)#[0-9a-fA-F]{6}(;--sig-ink:)#[0-9a-fA-F]{6}(\})' % re.escape(gid))
        found = list(pat.finditer(html))
        if len(found) != 2:
            return '대문 카드 배선이 2줄이 아니다: %s(%d)' % (gid, len(found))
        for tag, theme in ((1, 'dark'), (0, 'light')):     # 뒤에서부터 갈아 끼운다(자리 밀림 방지)
            m = list(pat.finditer(html))[tag]
            html = (html[:m.start()] + m.group(1) + vals[theme]['--sig'] + m.group(2)
                    + vals[theme]['--sig-ink'] + m.group(3) + html[m.end():])
    io.open(ip, 'w', encoding='utf-8', newline=NL).write(html)
    return None


def read_sources(root):
    """사본의 실제 소스에서 25종의 라이트·다크 --sig 를 읽는다(생성값이 아니라 ★적힌 값)."""
    import palette_gen as G
    games = json.load(io.open(os.path.join(root, 'games.json'), encoding='utf-8'))
    spec = json.load(io.open(os.path.join(root, 'tools', 'palette_by_category.json'), encoding='utf-8'))
    out = {}
    for g in games:
        blocks = G.read_root_blocks(os.path.join(root, g['id'], 'index.html'))
        out[g['id']] = {'cat': g['category'], 'light': blocks[0]['--sig'], 'dark': blocks[1]['--sig']}
    return spec, games, out


def prototypes(spec, games, sigs):
    """라이트 원형 = 정본 기준색 · 다크 원형 = 대표 게임의 다크 --sig."""
    light, dark, reps = {}, {}, {}
    for cat, meta in spec['categories'].items():
        base = meta['sig']
        ids = [g['id'] for g in games if g['category'] == cat]
        same = [i for i in ids if sigs[i]['light'].lower() == base.lower()]
        rep = (same or ids)[0]
        reps[cat] = rep
        light[cat] = base
        dark[cat] = sigs[rep]['dark']
    return light, dark, reps


def margins(sigs, protos, theme):
    rows = []
    for gid, v in sigs.items():
        own = v['cat']
        d = {c: ciede2000(v[theme], p) for c, p in protos.items()}
        nearest = min(d, key=d.get)
        others = min((x for c, x in d.items() if c != own), default=0.0)
        rows.append({'gid': gid, 'cat': own, 'sig': v[theme], 'own_dE': d[own],
                     'margin': others - d[own], 'nearest': nearest, 'ok_nearest': nearest == own})
    rows.sort(key=lambda r: r['margin'])
    return rows


def one(cand_L, hue, sat, cur_sig, keep=False):
    sig = hsl2hex(hue, sat, cand_L)
    tmp = tempfile.mkdtemp(prefix='pm_%s_' % str(cand_L).replace('.', 'p'))
    dst = os.path.join(tmp, 'repo')
    copy_repo(dst)
    set_canon(dst, sig)
    values, err = gen_values(dst)
    res = {'L': cand_L, 'sig': sig, 'dE_vs_current': ciede2000(sig, cur_sig)}
    if values is None:
        res['error'] = 'palette_gen STOP: ' + err
        return res, tmp
    err2 = apply_puzzle(dst, values)
    if err2:
        res['error'] = err2
        return res, tmp
    rc, out = sh(['python3', os.path.join('tools', 'check_palette.py'), '.'], dst)
    res['check_palette_rc'] = rc
    res['check_palette_tail'] = out.strip().splitlines()[-1] if out.strip() else ''
    spec, games, sigs = read_sources(dst)
    pl, pd, reps = prototypes(spec, games, sigs)
    res['reps'] = reps
    for theme, protos in (('light', pl), ('dark', pd)):
        rows = margins(sigs, protos, theme)
        res[theme] = {
            'min_margin': rows[0]['margin'], 'min_card': rows[0]['gid'],
            'under_threshold': [(r['gid'], round(r['margin'], 2)) for r in rows if r['margin'] < THRESHOLD],
            'not_nearest': [(r['gid'], r['nearest']) for r in rows if not r['ok_nearest']],
            'worst5': [(r['gid'], round(r['margin'], 2)) for r in rows[:5]],
        }
    if not keep:
        shutil.rmtree(tmp, ignore_errors=True)
        return res, None
    return res, tmp          # ★keep 이면 사본 경로를 준다(호출자가 그 안에서 더 잰다)


def main():
    cands = [float(a) for a in sys.argv[1:]] or [47.0, 47.5, 48.0, 48.5]
    spec = json.load(io.open(os.path.join(ROOT, 'tools', 'palette_by_category.json'), encoding='utf-8'))
    cur_sig = spec['categories']['puzzle']['sig']
    hue, sat, _ = hex2hsl(cur_sig)
    print('원형 정의: 라이트=정본 기준색 · 다크=대표 게임 다크 --sig · 색차 CIEDE2000 · 임계 %.1f' % THRESHOLD)
    print('여유 = (자기 아닌 원형 중 최소 dE) - (자기 원형 dE) · 음수면 다른 분류로 읽힌다')
    print('고정: H=%.1f · S=%.1f%% · 지금 정본 puzzle=%s' % (hue, sat, cur_sig))
    print('')
    for L in cands:
        res, _ = one(L, hue, sat, cur_sig)
        print('==== 후보 L=%.1f · %s · 지금 정본과 dE %.2f ====' % (res['L'], res['sig'], res['dE_vs_current']))
        if 'error' in res:
            print('  ★못 잰다 — %s' % res['error'])
            print('')
            continue
        print('  check_palette rc=%d · %s' % (res['check_palette_rc'], res['check_palette_tail']))
        for theme, name in (('light', '라이트'), ('dark', '다크')):
            t = res[theme]
            print('  [%s] 최소 여유 ★%.2f (%s) · 여유<%.1f 인 카드 ★%d개%s · 자기 원형이 최근접 아닌 카드 ★%d개%s'
                  % (name, t['min_margin'], t['min_card'], THRESHOLD, len(t['under_threshold']),
                     (' ' + str(t['under_threshold']) if t['under_threshold'] else ''),
                     len(t['not_nearest']),
                     (' ' + str(t['not_nearest']) if t['not_nearest'] else '')))
            print('        여유가 작은 다섯: %s' % t['worst5'])
        print('')


if __name__ == '__main__':
    main()
