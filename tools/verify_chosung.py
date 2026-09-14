# -*- coding: utf-8 -*-
"""초성 맞히기 — 풀·불변식 검증기 겸 빌드 리포트 (2026-09-14 · T30-chosung)

무엇을 재는가
  [pool]        wordchain DICT 에서 2·3글자 초성 패턴을 산출해 적격 풀과 티어 분포를 찍는다.
  [exhaust]     티어별·쉬움상용어 소진일을 ★분리 출력한다(합계만 보면 마르는 티어가 가려진다).
  [invariant]   재출제 간격 < min(티어별 소진일) — 깨지면 ★실패다(경고가 아니다).
  [schedule]    sim_days 일 스케줄을 실제로 구성해 하드 제약 위반을 센다
                (하루 10문제 · 쉬움 3 중 상용어 2 · 쿨다운 · 곡선 이탈 · 미사용 잔량).
  [embed]       chosung/index.html 이 있으면 게임에 박힌 상수를 정본과 ★양방향 대조한다.

왜 상수를 이 파일에 두지 않나
  도구가 자기 상수를 증명하면 계약이 아니라 자기 자신을 재게 된다. 상수 정본은
  tools/chosung_contract.json 이고 게임도 같은 값을 쓴다
  (tools/check_today_pool.mjs 의 설계 원칙 1과 같은 이유다).

사용법: python3 tools/verify_chosung.py <저장소 경로>
종료코드: 0 통과 · 1 미달 · 2 판정 불가(정본·사전을 못 읽음)
"""
import json
import os
import re
import sys
from collections import defaultdict

CHO = list('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')


def indet(msg):
    print('‽ 판정 불가 — ' + msg)
    sys.exit(2)


def chosung(word):
    out = []
    for ch in word:
        c = ord(ch) - 0xAC00
        if c < 0 or c > 11171:
            return None
        out.append(CHO[c // 588])
    return ''.join(out)


def load_dict(path, lengths):
    try:
        s = open(path, encoding='utf-8').read()
    except OSError as e:
        indet('사전을 못 읽었다: %s (%s)' % (path, e))
    i, j = s.find('const DICT'), s.find('DICT_N')
    if i < 0 or j < 0:
        indet('사전에서 DICT 블록을 찾지 못했다: %s' % path)
    answers, common, found = defaultdict(list), defaultdict(bool), 0
    pat = r"\{L:(\d+),\s*ne:(\d+),\s*na:(\d+),\s*n:(\d+),\s*s:'([^']*)'\}"
    for L, ne, _na, n, ss in re.findall(pat, s[i:j]):
        L, ne, n = int(L), int(ne), int(n)
        if L not in lengths:
            continue
        words = [ss[k * L:(k + 1) * L] for k in range(len(ss) // L)]
        if len(words) != n:
            indet('사전 그룹 L=%d 의 선언 수(%d)와 실제 수(%d)가 다르다' % (L, n, len(words)))
        found += 1
        for idx, w in enumerate(words):
            p = chosung(w)
            if p is None:
                continue
            answers[p].append(w)
            if idx < ne:
                common[p] = True
    if found != len(lengths):
        indet('요구한 길이 그룹 %r 중 %d 개만 찾았다' % (list(lengths), found))
    return answers, common


def main(argv):
    root = os.path.abspath(argv[1] if len(argv) > 1 else '.')
    try:
        C = json.load(open(os.path.join(root, 'tools', 'chosung_contract.json'), encoding='utf-8'))
    except Exception as e:
        indet('정본을 못 읽었다: tools/chosung_contract.json (%s)' % e)

    tiers_def, per_day = C['tiers'], C['per_day']
    cooldown, easy_min = C['cooldown_days'], C['easy_common_min']

    cho_ix = {c: i for i, c in enumerate(CHO)}

    def key(p):
        # v9 §11-9(3): 동률은 ★CHO 인덱스 수열 정수 비교로 깬다.
        # locale 사전순(문자열 비교)은 구현·환경마다 갈리므로 쓰지 않는다.
        return (tuple(cho_ix[c] for c in p), len(p))

    answers, common = load_dict(os.path.join(root, C['dict_source']), tuple(C['word_lengths']))

    def tier_of(n):
        for name, bounds in tiers_def.items():
            if bounds[0] <= n <= bounds[1]:
                return name
        return None

    pool = {}
    for p, ws in answers.items():
        t = tier_of(len(ws))
        if t:
            pool[p] = {'tier': t, 'common': common[p]}
    by_tier = defaultdict(list)
    for p, m in pool.items():
        by_tier[m['tier']].append(p)
    for t in by_tier:
        by_tier[t].sort(key=key)
    easy_common = [p for p in by_tier['easy'] if pool[p]['common']]
    commons = [p for p, m in pool.items() if m['common']]

    say = []
    fail = 0

    def note(ok, tag, msg):
        say.append('  %s [%s] %s' % ('OK' if ok else 'X ', tag, msg))
        return 0 if ok else 1

    exhaust = {t: len(v) / per_day[t] for t, v in by_tier.items()}
    binding = min(exhaust.values())
    ec_days = len(easy_common) / easy_min

    print('[pool] 적격 전체 %d · 상용어 포함 %d · 쉬움 상용어 %d'
          % (len(pool), len(commons), len(easy_common)))
    print('[exhaust] 티어별 분리 출력')
    for t in ('easy', 'normal', 'hard'):
        mark = ' <= 구속' if exhaust[t] == binding else ''
        print('  %-6s %4d패턴 · 하루 %d문제 -> %.1f일%s'
              % (t, len(by_tier[t]), per_day[t], exhaust[t], mark))
    print('  %-6s %4d패턴 · 하루 %d문제 -> %.1f일'
          % ('easyC', len(easy_common), easy_min, ec_days))

    fail += note(cooldown < binding, 'invariant',
                 '재출제 간격 %d일 < 최소 소진일 %.1f일' % (cooldown, binding))
    fail += note(ec_days > binding, 'common-not-binding',
                 '쉬움상용어 소진 %.1f일 > 티어 구속 %.1f일' % (ec_days, binding))

    last, ever = {}, set()
    first_repeat = min_gap = fail_day = first_off = None
    offcurve = short_common = 0
    target = tuple(sorted([t for t in per_day for _ in range(per_day[t])]))

    def take(cands, need, day, chosen):
        if need <= 0:
            return []
        unused = [p for p in cands if p not in last and p not in chosen]
        reuse = sorted([p for p in cands
                        if p in last and p not in chosen and day - last[p] >= cooldown],
                       key=lambda p: (last[p], key(p)))
        return (unused + reuse)[:need]

    for day in range(1, C['sim_days'] + 1):
        chosen = []
        got = take(easy_common, easy_min, day, chosen)
        chosen += got
        if len(got) < easy_min:
            short_common += 1
        chosen += take(by_tier['easy'], per_day['easy'] - len(chosen), day, chosen)
        for t in ('normal', 'hard'):
            got = take(by_tier[t], per_day[t], day, chosen)
            chosen += got
            if len(got) < per_day[t]:
                for alt in ('easy', 'normal', 'hard'):
                    if alt != t:
                        chosen += take(by_tier[alt], per_day[t] - len(got), day, chosen)
        if len(chosen) != sum(per_day.values()) and fail_day is None:
            fail_day = day
        if tuple(sorted(pool[p]['tier'] for p in chosen)) != target:
            offcurve += 1
            first_off = first_off or day
        for p in chosen:
            if p in ever:
                gap = day - last[p]
                first_repeat = first_repeat or day
                min_gap = gap if min_gap is None else min(min_gap, gap)
            ever.add(p)
            last[p] = day

    # v9 §11-9: 세는 기준을 분리 표기한다(113 대 112 는 값 충돌이 아니라 기준 차이였다)
    fr_batch = first_repeat                      # 1-based 회차(첫날이 1회차)
    fr_offset = None if first_repeat is None else first_repeat - 1   # 출시일로부터의 경과일
    print('[schedule] %d일 구성 · first_repeat_batch_1_based %s · first_repeat_date_offset_days %s'
          ' · 최소 관측 간격 %s일 · 미사용 잔량 %d'
          % (C['sim_days'], fr_batch, fr_offset, min_gap, len(pool) - len(ever)))

    fail += note(fail_day is None, 'schedule',
                 '하루 %d문제를 못 채운 날 없음' % sum(per_day.values())
                 if fail_day is None else '%d일째 구성 실패' % fail_day)
    fail += note(short_common == 0, 'easy-common',
                 '쉬움 상용어 %d문제 미달 0일' % easy_min
                 if short_common == 0 else '%d일 미달' % short_common)
    fail += note(offcurve == 0, 'curve',
                 '난이도 곡선 이탈 0일'
                 if offcurve == 0 else '%d일 이탈(첫 %s일째)' % (offcurve, first_off))
    fail += note(min_gap is None or min_gap >= cooldown, 'cooldown',
                 '재출제가 쿨다운 %d일을 지켰다(최소 %s일)' % (cooldown, min_gap))
    fail += note(first_repeat is None or first_repeat >= C['expected']['first_repeat_day_min'],
                 'first-repeat', 'first_repeat_batch_1_based %s >= 기대 %d (offset %s일)'
                 % (fr_batch, C['expected']['first_repeat_day_min'], fr_offset))

    exp = C['expected']
    fail += note(len(pool) == exp['eligible_total'], 'expect-pool',
                 '적격 %d = 정본 %d' % (len(pool), exp['eligible_total']))
    fail += note(len(commons) == exp['common_total'], 'expect-common',
                 '상용어 %d = 정본 %d' % (len(commons), exp['common_total']))
    fail += note(len(easy_common) == exp['easy_common'], 'expect-easy-common',
                 '쉬움상용어 %d = 정본 %d' % (len(easy_common), exp['easy_common']))
    for t in ('easy', 'normal', 'hard'):
        fail += note(len(by_tier[t]) == exp['tiers'][t], 'expect-tier-' + t,
                     '%s %d = 정본 %d' % (t, len(by_tier[t]), exp['tiers'][t]))

    game = os.path.join(root, 'chosung', 'index.html')
    if os.path.exists(game):
        src = open(game, encoding='utf-8').read()
        m = re.search(r'CHOSUNG_CONTRACT\s*=\s*(\{.*?\})\s*;', src, re.S)
        if not m:
            indet('게임에 CHOSUNG_CONTRACT 가 없다: chosung/index.html')
        try:
            embed = json.loads(m.group(1))
        except Exception as e:
            indet('게임의 CHOSUNG_CONTRACT 를 JSON 으로 못 읽었다 (%s)' % e)
        for k in ('tiers', 'per_day', 'easy_common_min', 'cooldown_days'):
            fail += note(embed.get(k) == C[k], 'embed-' + k,
                         '게임의 %s 가 정본과 같다' % k)
    else:
        say.append('  ·  [embed] 게임 미구현 — 교차 대조 축 비활성'
                   '(chosung/index.html 이 생기면 자동 활성)')

    print('[판정]')
    print('\n'.join(say))
    print('통과' if fail == 0 else '미달 %d건' % fail)
    return 0 if fail == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
