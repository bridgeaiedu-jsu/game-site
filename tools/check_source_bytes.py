#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""소스에 눈에 보이지 않는 금지 바이트가 섞였는지 정적 전수 스캔한다 — T0901-02.

왜 있나: tools/verify_tensec.js 870·871 행에 원시 0x08(백스페이스)이 2개 있었다.
의도는 정규식 낱말경계였는데 백슬래시가 셸 heredoc·파이썬 리터럴 같은 층에서 먹혀
제어문자가 들어갔다. 0x08 은 정규식 안에서 합법이라 **문법오류가 나지 않고**,
형제 단언이 초록을 대신 내 주어 실행 검사로는 영원히 안 잡혔다. 눈으로만(cat -A) 찾을 수
있었고 그것은 재현 가능한 검사가 아니다. 그래서 바이트를 세는 검사를 따로 세운다.

무엇을 보나(범위를 여기서 닫는다 — 이번 사고가 실제로 지나온 경로만 막는다):
  · 금지 제어 바이트 6종: 0x00 0x07 0x08 0x0b 0x0c 0x1b
  · BOM(파일 첫머리 EF BB BF)
  · lone CR(뒤에 LF 가 오지 않는 CR)
  ※ 제로폭 문자·혼동 글자(homoglyph)는 **일부러 넣지 않았다**. 넓히면 오탐이 늘고,
    이번 사고는 그 경로로 오지 않았다. 넓히려면 별도 근거와 표본을 들고 오라.

대상: git 이 추적하는 tools/ 아래 .py/.js/.mjs 와 저장소 전체의 .js/.mjs(제품 JS).
  git ls-files 로 열거하므로 대상 집합이 결정론이다(작업 부산물·node_modules 제외).

종료코드:
  0 = 금지 바이트 없음
  2 = **적발**(통과가 아니라 판정 불가) 또는 스캔 불가(git 미가용·파일 읽기 실패)
  ※ 1 은 쓰지 않는다 — 이 검사에 '미달' 이라는 중간 상태가 없다. 있으면 배포하지 않는다.

자기시험(--selftest): 임시 사본에 0x08 을 일부러 주입해 이 검사가 붉어지는지 잰다.
  0 = 검출력 확인(주입본을 잡았고 원본은 통과)
  1 = ★검출 실패(주입했는데 못 잡았다 — 이 검사가 공허하다)
  2 = 주입 실패·하네스 이상(통과로 세지 않는다)

사용법:
  python3 tools/check_source_bytes.py .
  python3 tools/check_source_bytes.py . --selftest
"""
import os
import subprocess
import sys
import tempfile

FORBIDDEN = {
    0x00: 'NUL',
    0x07: 'BEL',
    0x08: 'BS(백스페이스) — 정규식 낱말경계를 쓰려다 백슬래시가 먹힌 자리',
    0x0b: 'VT',
    0x0c: 'FF',
    0x1b: 'ESC',
}
BOM = b'\xef\xbb\xbf'
CR = b'\r'
LF = b'\n'


def tracked_files(root):
    """git 이 추적하는 파일만 본다 — 대상 집합을 결정론으로 고정한다."""
    p = subprocess.run(['git', '-C', root, 'ls-files'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        print('git ls-files 실패 — 대상을 셀 수 없다(rc=2)')
        print((p.stderr or '')[-500:])
        sys.exit(2)
    out = []
    for rel in (p.stdout or '').splitlines():
        rel = rel.strip()
        if not rel:
            continue
        ext = os.path.splitext(rel)[1].lower()
        in_tools = rel.startswith('tools/')
        if (in_tools and ext in ('.py', '.js', '.mjs')) or ext in ('.js', '.mjs'):
            out.append(rel)
    return sorted(set(out))


def scan_bytes(data):
    """한 파일의 바이트에서 적발 항목을 찾는다. 반환: [(사유, 위치설명)]"""
    hits = []
    if data.startswith(BOM):
        hits.append(('BOM', '파일 첫머리'))
    for i, b in enumerate(data):
        if b in FORBIDDEN:
            line = data.count(LF, 0, i) + 1
            hits.append(('0x%02x %s' % (b, FORBIDDEN[b]), '%d행 · %d번째 바이트' % (line, i)))
    start = 0
    while True:
        i = data.find(CR, start)
        if i < 0:
            break
        if data[i + 1:i + 2] != LF:
            line = data.count(LF, 0, i) + 1
            hits.append(('lone CR', '%d행 · %d번째 바이트' % (line, i)))
        start = i + 1
    return hits


def scan_tree(root, quiet=False):
    files = tracked_files(root)
    if not files:
        print('대상 파일이 0건이다 — 검사를 세울 수 없다(rc=2)')
        sys.exit(2)
    total = 0
    for rel in files:
        path = os.path.join(root, rel)
        try:
            data = open(path, 'rb').read()
        except OSError as e:
            print('읽지 못했다: %s (%s) — 판정 불가(rc=2)' % (rel, e))
            sys.exit(2)
        for why, where in scan_bytes(data):
            total += 1
            if not quiet:
                print('  적발  %s — %s (%s)' % (rel, why, where))
    if not quiet:
        print('대상 %d파일 · 적발 %d건' % (len(files), total))
    return len(files), total


def selftest(root):
    """이 검사가 공허하지 않은지 잰다 — 규칙 3종을 각각 일부러 주입해 붉어지는지 본다.

    규칙을 셋 넣고 하나만 재면 나머지 둘은 '어떤 입력에도 발화하지 않는 규칙' 으로 남는다.
    그것이 이 티켓이 잡은 공허한 단언과 같은 모양이라, 세 규칙을 전수로 잰다.
    """
    files = tracked_files(root)
    if not files:
        print('자기시험: 대상 0건 — 주입할 자리가 없다(rc=2)')
        sys.exit(2)
    victim = 'tools/verify_tensec.js' if 'tools/verify_tensec.js' in files else files[0]
    src = os.path.join(root, victim)
    try:
        clean = open(src, 'rb').read()
    except OSError as e:
        print('자기시험: 표본을 읽지 못했다 (%s) — rc=2' % e)
        sys.exit(2)
    if scan_bytes(clean):
        print('자기시험: 표본 %s 가 이미 적발 상태다 — 깨끗한 기준선을 세울 수 없다(rc=2)' % victim)
        sys.exit(2)

    anchor = b'const MUTATIONS = {'
    if clean.count(anchor) < 1:
        print('자기시험: 주입 앵커를 찾지 못했다 — 주입 실패(rc=2)')
        sys.exit(2)

    cases = [
        ('0x08(백스페이스)', lambda d: d.replace(anchor, bytes([8]) + anchor, 1), bytes([8]), '0x08'),
        ('BOM(파일 첫머리)', lambda d: BOM + d, BOM, 'BOM'),
        ('lone CR', lambda d: d.replace(anchor, CR + anchor, 1), None, 'lone CR'),
    ]
    tmpdir = tempfile.mkdtemp(prefix='srcbytes-')
    print('자기시험 표본: %s (%d바이트) → %s' % (victim, len(clean), tmpdir))
    failed = []
    for name, inject, token, expect in cases:
        tainted = inject(clean)
        path = os.path.join(tmpdir, 'tainted-%s.bin' % expect.replace(' ', '-'))
        open(path, 'wb').write(tainted)
        got = open(path, 'rb').read()
        # 주입이 실제로 됐는지 먼저 확인한다 — 주입 실패를 통과로 세지 않는다
        if token is not None:
            delta = got.count(token) - clean.count(token)
        else:
            delta = (got.count(CR) - got.count(CR + LF)) - (clean.count(CR) - clean.count(CR + LF))
        if delta != 1:
            print('  %s: 주입이 실제로 되지 않았다(증가 %d) — 주입 실패(rc=2)' % (name, delta))
            sys.exit(2)
        hits = [w for w, _ in scan_bytes(got)]
        caught = any(expect in w for w in hits)
        print('  %s: 주입 1건 · 적발 %d건 · 해당 규칙 발화 %s' % (name, len(hits), '예' if caught else '★아니오'))
        if not caught:
            failed.append(name)

    if failed:
        print('★검출 실패 — 주입했는데 잡지 못한 규칙: %s (rc=1)' % ' / '.join(failed))
        sys.exit(1)
    print('검출력 확인 — 규칙 3종 모두 주입본을 잡았고 원본은 깨끗하다 (rc=0)')
    sys.exit(0)


def main():
    argv = sys.argv[1:]
    root = argv[0] if argv and not argv[0].startswith('--') else '.'
    root = os.path.abspath(root)
    if '--selftest' in argv:
        selftest(root)
    print('대상 루트: %s' % root)
    files, total = scan_tree(root)
    if total:
        print('★금지 바이트가 있다 — 통과가 아니라 판정 불가다(rc=2).')
        print('  눈에 보이지 않으므로 문법오류도 나지 않는다. 바이트로 고쳐라')
        print('  (백슬래시를 리터럴로 타이핑하지 말고 문자코드로 조립하거나 바이트 치환).')
        sys.exit(2)
    print('금지 바이트 없음 (rc=0)')
    sys.exit(0)


if __name__ == '__main__':
    main()
