# -*- coding: utf-8 -*-
"""형제 뮤테이션 러너가 ★대조군을 무엇으로 판별하는가 — 정적 전수 스캔(측정만 · 수리 없음).

★분모를 먼저 못박는다: tools/run_mutations_*.py 전수에서 내 것(quickmath)을 뺀 수 == 기대 분모.
★판정은 세 통: (A)검사기 ★출력 문자열로 판별 (B)★목록·정본으로 판별 (C)★판정 불가(패턴 없음).
★(A)라고 해서 수치가 반드시 부풀려진 것은 아니다 — 그 검사기가 그 문자열을 실제로 찍으면
   판별은 맞는다. 그래서 (A)에 대해서는 ★검사기가 대조군 자리에 무엇을 찍는지 함께 잰다.

── 출처 고지 ────────────────────────────────────────────────────────────
이 파일은 2026-09-07 master 가 만든 원본을 저장소로 옮긴 것이다.
  원본: C:\\Users\\USER\\.cys\\pack\\round\\evidence\\hanpango-mental-math\\R2FIX2\\scan_sibling_quiet.py
        sha256 4f17389576f1561cb9fffc9e9f3952f9261fa3f657dcd29861492182b39feff7
  그 스캔 결과: 같은 폴더 SIBLING_QUIET_SCAN.txt
        sha256 079705ec303e7b6ba9b1aa639027ebd14a221288357261bd32bc76045eb50208
        (판정 A 3 · B 3 · C 5 · 합 11)
★원본에서 바꾼 것은 한 곳뿐이다 — ROOT 를 하드코딩 절대경로에서 ★이 파일 위치 파생으로
  돌렸다. 저장소 안에 사는 도구가 절대경로를 쥐고 있으면 ★어느 나무를 재는지가 실행 위치와
  무관하게 굳어, 워크트리를 갈아 놓고도 남의 나무를 재게 된다(재는 대상이 흔들리는 함정).
  이 저장소에서는 두 값이 같다 — 아래 단언이 그것을 매 실행마다 확인한다.
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
MINE = 'run_mutations_quickmath.py'
EXPECT_DENOM = 11        # ★기대 분모 — 형제 11종(내 것 제외). 어긋나면 판정하지 않고 멈춘다.

files = sorted(f for f in os.listdir(TOOLS) if re.match(r'run_mutations_.*\.py$', f))
sib = [f for f in files if f != MINE]
print('열거된 러너 %d종(내 것 포함) · 형제 %d종 · 기대 분모 %d' % (len(files), len(sib), EXPECT_DENOM))
if len(sib) != EXPECT_DENOM:
    print('★판정 불가 — 잰 건수(%d) != 기대 분모(%d). 분모가 어긋난 채로 세지 않는다.' % (len(sib), EXPECT_DENOM))
    sys.exit(2)
print('★잰 건수 == 기대 분모 (%d) — 아래 판정은 이 분모 위에 선다' % EXPECT_DENOM)
print('')

# (A) 출력 문자열 판별: verifier stdout 에서 뽑은 target 문자열에 낱말이 들어 있는지로 가른다
RE_STR = re.compile(r"quiet\s*=\s*['\"][^'\"]*['\"]\s+in\s+target|in\s+target\s*$", re.M)
RE_STR2 = re.compile(r"quiet\s*=\s*['\"]([^'\"]+)['\"]\s+in\s+target")
# (B) 목록·정본 판별: 기대표 json 의 expect / 러너 안에 선언된 QUIET 집합
RE_CANON_JSON = re.compile(r"expect'?\]?\s*\)?\s*==\s*'quiet'|get\('expect'\)\s*==\s*'quiet'")
RE_CANON_LIST = re.compile(r"^QUIET\s*=|QUIET\b\s*=\s*[\[({]", re.M)

rows = []
for f in sib:
    src = io.open(os.path.join(TOOLS, f), encoding='utf-8').read()
    m = RE_STR2.search(src)
    by_string = bool(m)
    by_canon = bool(RE_CANON_JSON.search(src)) or bool(RE_CANON_LIST.search(src))
    if by_string and not by_canon:
        kind, note = 'A 출력 문자열', "낱말 '%s' 가 target 문자열에 있는지로 가른다" % m.group(1)
    elif by_canon and not by_string:
        kind, note = 'B 목록·정본', ('기대표 json 의 expect' if RE_CANON_JSON.search(src) else '러너 안 QUIET 목록 선언')
    elif by_string and by_canon:
        kind, note = 'A+B 혼합', "문자열 판별과 목록 판별이 함께 있다"
    else:
        kind, note = 'C 판정 불가', '두 패턴 모두 없음 — 다른 세대이거나 대조군 개념이 없다'
    rows.append((f, len(src.splitlines()), kind, note))

w = max(len(r[0]) for r in rows)
for f, ln, kind, note in rows:
    print('%-*s %4d행  %-12s %s' % (w, f, ln, kind, note))

print('')
tally = {}
for _, _, k, _ in rows:
    tally[k.split()[0]] = tally.get(k.split()[0], 0) + 1
print('==== 판정(형제 %d 종 · 합 = 분모) ====' % EXPECT_DENOM)
for k in ('A', 'A+B', 'B', 'C'):
    if k in tally:
        print('  %-3s %d' % (k, tally[k]))
print('  합 %d (기대 분모 %d)' % (sum(tally.values()), EXPECT_DENOM))
assert sum(tally.values()) == EXPECT_DENOM
