#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""게임별 '읽을 글' 고유성 게이트 — 2026-09-12 · 애드센스 재신청 라운드

계약 (한 문장이 판정의 단일 기준이다)
  **`.read-ko` / `.read-en` 으로 실린 게임별 글은 서로 ★복제가 아니다** —
  같은 문장을 게임 이름만 바꿔 돌려 쓴 글은 중복 콘텐츠라서, 추가하면 지금보다 나빠진다.

왜 이 게이트가 ★제품보다 먼저 만들어졌나
  분량은 손으로도 세어지지만 '고유한가' 는 눈으로 못 센다. 글을 다 쓰고 나서 재면
  이미 쓴 글을 감싸고 도는 판정이 된다. 그래서 ★붉은 것을 먼저 보고 글을 쓴다.

무엇을 재는가 — 두 축을 ★함께 본다(한 축만 보면 우회가 쉽다)
  ①[article-sentence-disjoint]  쌍마다 ★완전히 같은 문장의 교집합이 0이다.
       말끝만 바꾸면 빠져나가므로 이 축 하나로는 부족하다.
  ②[article-ngram-similarity]   쌍마다 ★문자 5-그램 자카드 유사도가 임계 미만이다.
       '이름만 바꾼 복제' 는 문장이 달라 보여도 이 축에서 즉시 드러난다.
  ③[article-length]             글 길이가 브리프 범위(ko 800~1,500자) 안이다.
  ④[article-both-langs]         ko·en 두 벌이 다 있다(한쪽만 있으면 반쪽이다).
  ⑤[article-detector-armed]     ★검출력 자기시험 — 이름만 바꾼 복제본을 만들어 넣으면
       위 두 축이 ★실제로 붉어진다. 서지 않으면 통과가 아니라 ★판정 불가(rc=2)다.

임계를 어디서 얻었나 (감으로 박지 않는다)
  임계는 상수로 박되, 그 상수가 ★의미 있는 값임을 자기시험이 매 실행 증명한다:
  진짜 복제본(이름만 치환)의 유사도는 임계를 ★넘고, 실제 글들의 최대 쌍은 임계 ★아래여야 한다.
  둘 사이가 벌어져 있지 않으면 이 게이트는 아무것도 가르지 못하므로 rc=2 로 멈춘다.

exit 0=통과 · 1=미달 · 2=판정 불가
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
NGRAM = 5
SIM_MAX = 0.30          # 실제 글 쌍의 상한
SIM_CLONE_MIN = 0.50    # 복제본은 이 위여야 자기시험이 성립한다
KO_MIN, KO_MAX = 800, 1500

SEC_RE = re.compile(r'<div class="read-(ko|en)"[^>]*>(.*?)</div>\s*<!-- /read-\1 -->', re.S)


def strip_tags(html):
    s = re.sub(r'(?is)<script.*?</script>', ' ', html)
    s = re.sub(r'(?is)<style.*?</style>', ' ', s)
    s = re.sub(r'(?is)<!--.*?-->', ' ', s)
    s = re.sub(r'(?s)<[^>]+>', ' ', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return re.sub(r'\s+', ' ', s).strip()


def sentences(text):
    parts = re.split(r'(?<=[.!?。])\s+|(?<=다\.)\s*|\n+', text)
    return [p.strip() for p in parts if len(p.strip()) >= 12]


def grams(text, n=NGRAM):
    t = re.sub(r'\s+', '', text)
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def collect():
    """대상은 하드코딩 목록이 아니라 ★트리에서 파생한다 — read 블록을 실은 페이지 전수."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', 'tools')]
        for fn in filenames:
            if fn != 'index.html':
                continue
            p = os.path.join(dirpath, fn)
            src = open(p, encoding='utf-8').read()
            found = {m.group(1): strip_tags(m.group(2)) for m in SEC_RE.finditer(src)}
            if found:
                rel = os.path.relpath(dirpath, ROOT).replace(os.sep, '/')
                out[rel if rel != '.' else '(home)'] = found
    return out


def judge(arts, label):
    """미달 목록과 관측 수치를 돌려준다. 판정은 부르는 쪽에서 한다."""
    fails = []
    ids = sorted(arts)
    for gid in ids:
        a = arts[gid]
        for lg in ('ko', 'en'):
            if lg not in a or len(a[lg]) < 50:
                fails.append('[article-both-langs] %s — %s 글이 없다' % (gid, lg))
        ko = a.get('ko', '')
        if ko and not (KO_MIN <= len(ko) <= KO_MAX):
            fails.append('[article-length] %s — ko %d자 (허용 %d~%d)' % (gid, len(ko), KO_MIN, KO_MAX))

    pairs = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            x, y = ids[i], ids[j]
            for lg in ('ko', 'en'):
                tx, ty = arts[x].get(lg, ''), arts[y].get(lg, '')
                if not tx or not ty:
                    continue
                inter = set(sentences(tx)) & set(sentences(ty))
                sim = jaccard(grams(tx), grams(ty))
                pairs.append((x, y, lg, len(inter), sim))
                if inter:
                    fails.append('[article-sentence-disjoint] %s↔%s (%s) — 같은 문장 %d개: %s'
                                 % (x, y, lg, len(inter), list(inter)[0][:40]))
                if sim >= SIM_MAX:
                    fails.append('[article-ngram-similarity] %s↔%s (%s) — 유사도 %.3f ≥ 임계 %.2f'
                                 % (x, y, lg, sim, SIM_MAX))
    return fails, pairs


def main():
    arts = collect()
    if not arts:
        print('판정 불가 — read 블록을 실은 페이지가 0장이다(잴 대상이 아직 없다). rc=2')
        return 2

    fails, pairs = judge(arts, 'real')
    max_sim = max((p[4] for p in pairs), default=0.0)
    max_pair = max(pairs, key=lambda p: p[4], default=None)

    # ★검출력 자기시험 — 첫 글을 이름만 바꿔 복제해 넣으면 두 축이 붉어져야 한다
    ids = sorted(arts)
    base = ids[0]
    clone = {lg: txt.replace(base, '__CLONE__') for lg, txt in arts[base].items()}
    probe = dict(arts)
    probe['__clone_of_' + base] = clone
    cfails, cpairs = judge(probe, 'clone')
    clone_pairs = [p for p in cpairs if '__clone_of_' in p[0] or '__clone_of_' in p[1]]
    clone_sim = max((p[4] for p in clone_pairs), default=0.0)
    clone_sent = max((p[3] for p in clone_pairs), default=0)
    armed = clone_sim >= SIM_CLONE_MIN and clone_sent > 0

    print('=== 게임별 읽을 글 고유성 게이트 ===')
    print('대상 페이지 %d장(트리 파생) · 비교한 쌍 %d (= 페이지쌍 × 언어 2벌)' % (len(arts), len(pairs)))
    for gid in ids:
        a = arts[gid]
        print('  %-18s ko %5d자 · en %5d자 · ko 문장 %d개'
              % (gid, len(a.get('ko', '')), len(a.get('en', '')), len(sentences(a.get('ko', '')))))
    if max_pair:
        print('가장 닮은 쌍: %s↔%s (%s) 유사도 %.3f · 같은 문장 %d개 — 임계 %.2f'
              % (max_pair[0], max_pair[1], max_pair[2], max_pair[4], max_pair[3], SIM_MAX))
    print('검출력 자기시험: 이름만 바꾼 복제본의 최대 유사도 %.3f · 같은 문장 %d개 — %s'
          % (clone_sim, clone_sent, '★이 검사기는 복제를 실제로 잡는다' if armed else '★못 잡는다(공허)'))
    print('벌어진 폭: 실제 최대 %.3f · 임계 %.2f · 복제 %.3f'
          ' (실제<임계 %s · 복제≥임계 %s — 부등호를 문구에 박지 않고 재서 적는다)'
          % (max_sim, SIM_MAX, clone_sim, max_sim < SIM_MAX, clone_sim >= SIM_MAX))

    if not armed:
        print('★판정 불가 — 검출력이 서지 않았다(복제본조차 임계를 못 넘는다). rc=2')
        return 2
    if fails:
        print('★미달 %d건' % len(fails))
        for f in fails:
            print('  ' + f)
        return 1
    print('★미달 0건 — 어떤 쌍도 같은 문장을 쓰지 않고, 유사도도 전부 임계 아래다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
