#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_daily_boundary.mjs 의 ★검출력 검산 (2026-09-09 · T0909-daily-kst)

하루 경계 게이트가 **고의로 되돌린 결함을 정말로 잡는지** 를 뮤테이션 주입으로 검산한다.
게이트가 초록인 것만으로는 그 게이트가 무엇이든 잡는다는 증거가 되지 않는다.

'탐지' 의 정의(엄격):
  · 게이트 종료코드가 1 이고(0 = 못 잡음 · 2 = 판정 불가 → 둘 다 탐지 아님)
  · 뮤테이션이 ★지목한 검사 id(catcher)가 실제로 ✗ 목록에 있어야 한다.
'무임승차' 차단: 다른 검사가 우연히 붉어져 rc=1 이 된 것은 탐지로 세지 않는다.
'주입 실패'(앵커 노후화)는 검출력과 ★별개로 세어 표에 남긴다 — 뭉뚱그리면 오독을 부른다.

각 게임군 ★대표에 넣는다:
  · 정규 22종 대표 = higher-lower      · 못박기 4종 대표 = shooting · 2048
  · 자기 꼴 = quick-math               · 먼저 KST 였던 자리 = push
사용법:  python3 tools/run_mutations_kst.py [--only 이름]
종료코드: 0 = 전부 지목 검사로 탐지 + 원본 rc=0 · 1 = 검출력 실패 · 2 = 하네스 비정상
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GATE = os.path.join('tools', 'check_daily_boundary.mjs')

# (이름, 파일, 앵커, 대체, 지목 검사 id, 왜)
MUTS = [
    ('m-kst-shift-off', 'higher-lower/index.html',
     'const k = new Date((d ? d.getTime() : new Date().getTime()) + 9*3600000);',
     'const k = new Date((d ? d.getTime() : new Date().getTime()) + 0*3600000);',
     'kst-dynamic', 'KST 시프트를 0 으로 되돌린다 — 경계가 UTC 로 미끄러진다'),
    ('m-daykey-local-again', 'wordchain/index.html',
     'function dayKey(d){ const k = kstParts(d); return `${k.y}-${pad2(k.m+1)}-${pad2(k.d)}`; }',
     'function dayKey(d){ const t = d || new Date(); return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`; }',
     'kst-shape', '한 게임만 로컬 달력으로 되돌린다 — 전수 스캔이 그 한 자리를 짚어야 한다'),
    ('m-no-drifts-from-key', 'tensec/index.html',
     'function dailyNo(d){ const k = kstParts(d); return Math.floor((Date.UTC(k.y,k.m,k.d) - DAILY_EPOCH)/86400000) + 1; }',
     'function dailyNo(d){ const t = d || new Date(); return Math.floor((Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()) - DAILY_EPOCH)/86400000) + 1; }',
     'no-derive', '회차만 로컬로 되돌린다 — 키와 #N 이 다른 날을 가리키는 구간이 생긴다'),
    ('m-prev-local-again', 'stop/index.html',
     'const t = new Date(Date.UTC(y, m - 1, d) - 86400000);',
     'const t = new Date(y, m - 1, d); t.setDate(t.getDate() - 1);',
     'prev-utc', 'prevDayKey 를 로컬 Date 경유로 되돌린다 — UTC+9 초과 시간대에서 이틀 전을 준다'),
    ('m-save-at-save-time', 'shooting/index.html',
     "JSON.stringify({ date: runDay || dayKey(), no: runNo || dailyNo(), result })",
     "JSON.stringify({ date: dayKey(), no: dailyNo(), result })",
     'pin-save', '저장 시점에 다시 시계를 읽게 한다 — 경계를 넘긴 판이 다음 날 1회권을 먹는다'),
    ('m-save-at-save-time-2048', '2048/index.html',
     '  const rec = { date: runDay || dayKey(), no: runNo || dailyNo(),\n                run:',
     '  const rec = { date: dayKey(), no: dailyNo(),\n                run:',
     'pin-save', '2048 도 저장 시점 호출로 되돌린다(못박기 4종 대표 둘째 · 앵커는 다음 줄까지 물려 유일하게 만든다)'),
    ('m-migrate-removed', 'higher-lower/index.html',
     "  if (st.last === today || st.last === yest) return;          /* 이미 KST 계열 — 건드리지 않는다 */",
     "  return;",
     'migrate-dynamic', '스트릭 1회 이관을 무력화한다 — 구 로컬 키가 그대로 남아 연속이 끊긴다'),
    ('m-quickmath-local', 'quick-math/index.html',
     'const k = new Date((d ? d.getTime() : new Date().getTime()) + 9*3600000);',
     'const k = new Date((d ? d.getTime() : new Date().getTime()) + 0*3600000);',
     'kst-dynamic', 'quick-math(자기 꼴)에서 시프트를 되돌린다'),
    ('m-push-drops-kst', 'push/index.html',
     'const t = new Date(now.getTime() + 9*3600000); /* KST 고정 */',
     'const t = new Date(now.getTime()); /* KST 고정 */',
     'kst-keepers', '먼저 KST 였던 push 에서 시프트를 뺀다 — 지키던 자리가 깨지는지 본다'),
    ('m-quiet-control', 'higher-lower/index.html',
     '/* ★하루 경계 = KST(UTC+9) 고정 — ★시계를 읽는 곳은 kstParts 하나다',
     '/* (대조군 · 주석 한 글자만 바꾼다) ★하루 경계 = KST(UTC+9) 고정 — ★시계를 읽는 곳은 kstParts 하나다',
     None, '대조군 — 주석만 바꾼다. 어떤 검사도 붉으면 안 된다'),
]

argv = sys.argv[1:]
only = argv[argv.index('--only') + 1] if '--only' in argv else None


def run_gate(root):
    r = subprocess.run(['node', GATE, root], cwd=root, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def failed_ids(out):
    ids = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith('✗ ['):
            ids.append(line.split('[', 1)[1].split(']', 1)[0])
    return ids


def main():
    base_rc, base_out = run_gate(ROOT)
    if base_rc != 0:
        print('하네스 비정상 — 원본이 이미 rc=%d 다(뮤테이션 이전에 초록이어야 한다)\n%s' % (base_rc, base_out[-800:]))
        return 2

    rows = []
    for name, rel, anchor, repl, catcher, why in MUTS:
        if only and name != only:
            continue
        stage = tempfile.mkdtemp(prefix='kstmut-')
        try:
            dst = os.path.join(stage, 'tree')
            shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns('.git', 'node_modules', 'evidence'))
            path = os.path.join(dst, *rel.split('/'))
            with open(path, encoding='utf-8', newline='') as f:
                src = f.read()
            # ★줄끝 비의존 — 체크아웃이 CRLF 면 \n 앵커는 0회가 된다(검출력이 아니라 환경이 게이트를 끄는 자리다)
            a, r2 = anchor, repl
            if src.count(a) != 1 and chr(10) in a:
                a2 = a.replace(chr(10), chr(13) + chr(10))
                if src.count(a2) == 1:
                    a, r2 = a2, repl.replace(chr(10), chr(13) + chr(10))
            n = src.count(a)
            if n != 1:
                rows.append((name, 'rc=2', '주입실패(앵커 %d회)' % n, catcher or '(대조군)'))
                continue
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(src.replace(a, r2))
            rc, out = run_gate(dst)
            bad = failed_ids(out)
            if catcher is None:
                ok = (rc == 0 and not bad)
                rows.append((name, 'rc=%d' % rc, '조용했다(대조군 · 기대대로)' if ok else '★거짓 실패 — 붉은 검사 %s' % (bad or '(rc만 다름)'), '(대조군)'))
            elif rc == 1 and catcher in bad:
                rows.append((name, 'rc=1', '잡았다(겨냥 검출)', catcher))
            elif rc == 1:
                rows.append((name, 'rc=1', '★무임승차 — 붉은 검사 %s 에 겨냥 %s 없음' % (bad, catcher), catcher))
            elif rc == 2:
                rows.append((name, 'rc=2', '★판정 불가(게이트가 판정을 못 세웠다)', catcher))
            else:
                rows.append((name, 'rc=0', '★공허(겨냥인데 못 잡았다)', catcher))
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    print('==== 하루 경계 게이트 뮤테이션 %d종 ====' % len(rows))
    for name, rc, verdict, catcher in rows:
        print('%-26s %-6s %-46s %s' % (name, rc, verdict, catcher))
    caught = sum(1 for r in rows if r[2].startswith('잡았다'))
    quiet = sum(1 for r in rows if r[2].startswith('조용했다'))
    vac = sum(1 for r in rows if '공허' in r[2])
    free = sum(1 for r in rows if '무임승차' in r[2])
    inject = sum(1 for r in rows if '주입실패' in r[2])
    indet = sum(1 for r in rows if '판정 불가' in r[2])
    falsefail = sum(1 for r in rows if '거짓 실패' in r[2])
    print('\n  ① 겨냥 검출(잡았다)          %d' % caught)
    print('  ② 대조군 조용(기대대로)      %d' % quiet)
    print('  ③ ★공허(겨냥인데 못 잡았다)  %d' % vac)
    print('  ④ ★무임승차                  %d' % free)
    print('  ⑤ ★거짓 실패(대조군이 붉다)  %d' % falsefail)
    print('  ⑥ ★주입 실패(앵커 노후화)    %d' % inject)
    print('  ⑦ ★판정 불가                 %d' % indet)
    return 0 if (vac == 0 and free == 0 and inject == 0 and indet == 0 and falsefail == 0) else 1


if __name__ == '__main__':
    sys.exit(main())
