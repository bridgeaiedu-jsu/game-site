#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""소스에 눈에 보이지 않는 금지 바이트가 섞였는지 정적 전수 스캔한다 — T0901-02.

왜 있나: tools/verify_tensec.js 870·871 행에 원시 0x08(백스페이스)이 2개 있었다.
의도는 정규식 낱말경계였는데 백슬래시가 셸 heredoc·파이썬 리터럴 같은 층에서 먹혀
제어문자가 들어갔다. 0x08 은 정규식 안에서 합법이라 **문법오류가 나지 않고**,
형제 단언이 초록을 대신 내 주어 실행 검사로는 영원히 안 잡혔다. 눈으로만(cat -A) 찾을 수
있었고 그것은 재현 가능한 검사가 아니다. 그래서 바이트를 세는 검사를 따로 세운다.

★이 도구를 고칠 때 새겨 둘 두 문장(2026-09-01 T0901-02 에서 실측으로 얻었다):
  ① **검사의 기대 목록을 피검사 대상에서 가져오면 그 검사는 규칙 소실을 영원히 못 잡는다.**
     자기참조는 검사를 공허하게 만든다 — 무결성 연결을 저장본과 다른 파일에 두는 이유,
     자기시험을 쓴 사람과 코드를 쓴 사람을 가르는 이유가 모두 같은 병의 다른 층이다.
     그래서 EXPECTED_CODES 는 FORBIDDEN 에서 파생시키지 않고 독립으로 쥐며 **양방향**으로
     대조한다(한 방향만 보면 반대편이 조용히 샌다).
  ② **종료코드는 파이프 없이 잰다.** 파이프는 마지막 명령의 rc 를 준다 — 이 검사의 rc=2 가
     파이프 뒤에서 rc=0 으로 둔갑한 적이 있다(실측).

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

자기시험(--selftest): 임시 **Git 저장소**에 규칙 8종(금지 바이트 6종 + BOM + lone CR)을 각각
  주입한 표본을 만들고, 이 파일을 **자식 프로세스로 다시 불러 CLI 경로 전체**(tracked_files →
  scan_tree → main)를 밟게 해 rc=2 와 그 규칙 이름이 지적문에 나오는지 본다.
  ★내부 함수(scan_bytes)를 직접 부르지 않는다 — 그렇게 하면 집계 반복문이 죽어도 자기시험이
  전부 초록이었다(실측: 그 변이에서 게이트 자신은 오염 저장소를 rc=0 으로 통과시켰다).
  0 = 검출력 확인(8종 전부를 CLI 경로로 잡았고 깨끗한 대조군은 rc=0)
  1 = ★검출 실패(주입했는데 못 잡았다 — 이 검사가 공허하다)
  2 = 주입 실패·하네스 이상(통과로 세지 않는다)

사용법:
  python3 tools/check_source_bytes.py .
  python3 tools/check_source_bytes.py . --selftest
"""
import os
import shutil
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
    # ★-z 로 받아 **바이너리**로 읽는다. 개행·따옴표 모드로 읽으면 core.quotePath 가 인용한
    #   비ASCII 경로가 "\355\225\234.js" 처럼 와서 확장자 판정이 빗나가고, 그 파일이
    #   **검사 대상에서 조용히 빠진다**(정상 JS 가 하나라도 있으면 '대상 0건' 방어도 발화하지
    #   않아 오염 파일을 빼고 rc=0 으로 통과한다 — codex R1 이슈1 실측).
    p = subprocess.run(['git', '-C', root, 'ls-files', '-z'], capture_output=True)
    if p.returncode != 0:
        print('git ls-files 실패 — 대상을 셀 수 없다(rc=2)')
        print((p.stderr or b'').decode('utf-8', 'replace')[-500:])
        sys.exit(2)
    out = []
    for raw in (p.stdout or b'').split(b'\x00'):
        if not raw:
            continue
        # 경로 바이트를 손실 없이 문자열로 — 디코드할 수 없는 바이트도 버리지 않는다.
        rel = raw.decode('utf-8', 'surrogateescape')
        if not rel.strip():
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


def _git(repo, *a):
    return subprocess.run(["git", "-C", repo] + list(a), capture_output=True)


def _fixture(tmp, name, payload):
    """추적 파일이 있는 임시 Git 저장소를 만든다 — 깨끗한 ASCII 한 개 + 오염 표본 한 개.

    ★깨끗한 파일을 함께 두는 이유: 오염 파일만 두면 그것이 검사에서 빠져도 "대상 0건"
      방어가 대신 붉어져, 빠진 것을 못 본 채 초록이 아닌 결과에 속는다(무임승차 방지).
    """
    repo = os.path.join(tmp, "repo-" + name.replace(" ", "-").replace("/", "-"))
    os.makedirs(os.path.join(repo, "tools"))
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "selftest@example.com")
    _git(repo, "config", "user.name", "selftest")
    # ★quotePath 를 켠 채로 만든다 — 비ASCII 경로가 인용되는 실제 조건을 재현한다.
    _git(repo, "config", "core.quotePath", "true")
    with open(os.path.join(repo, "tools", "clean.js"), "wb") as f:
        f.write(b"export const ok = 1;\n")
    # 비ASCII 이름 — 경로가 인용돼도 확장자 판정이 살아 있는지 함께 잰다.
    victim = os.path.join(repo, "\ud55c\uae00\uc774\ub984.js")
    with open(victim, "wb") as f:
        f.write(payload)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "fixture")
    return repo


def selftest(root):
    """이 검사가 공허하지 않은지 잰다 — 규칙마다 오염 표본을 만들어 **CLI 를 그대로 밟는다**.

    ★예전 판본은 scan_bytes 를 직접 불러 tracked_files·scan_tree·main 을 하나도 지나지
      않았다. 그래서 **집계 반복문을 지워도 자기시험 8종이 전부 초록**이었다(codex 실측:
      그 변이에서 게이트 자신은 오염 저장소를 rc=0 으로 통과시켰다). 검사가 계약이 아니라
      그 대리물을 보면, 통과하는 검사와 살아 있는 결함이 나란히 존재한다.

    ★기대 목록은 여기서 **독립 리터럴로** 쥔다. 피검사 대상(FORBIDDEN·cases)에서 파생시키면
      규칙을 지울 때 그 시험도 함께 사라져 자기시험이 조용히 줄고 통과한다.
    """
    # ── 규칙 이름을 독립으로 적는다(8종) ──
    EXPECTED_RULES = ["0x00", "0x07", "0x08", "0x0b", "0x0c", "0x1b", "BOM", "lone CR"]
    implemented = ["0x%02x" % c for c in sorted(FORBIDDEN)] + ["BOM", "lone CR"]
    missing = [r for r in EXPECTED_RULES if r not in implemented]
    extra = [r for r in implemented if r not in EXPECTED_RULES]
    if missing:
        print("★규칙 소실 — 기대 목록에 있는데 구현에 없다: %s (rc=1)" % " ".join(missing))
        sys.exit(1)
    if extra:
        print("★시험 미작성 — 구현에만 있는 규칙: %s. 규칙을 넓혔으면 기대 목록도 넓혀라 (rc=1)"
              % " ".join(extra))
        sys.exit(1)

    base = b"const ok = 1;\n"
    payloads = {}
    for c in sorted(FORBIDDEN):
        payloads["0x%02x" % c] = b"const re = /" + bytes([c]) + b"x/;\n"
    payloads["BOM"] = BOM + base
    payloads["lone CR"] = b"const ok = 1;" + CR + b"const two = 2;\n"

    me = os.path.abspath(__file__)
    tmp = tempfile.mkdtemp(prefix="srcbytes-selftest-")
    print("자기시험: 임시 Git 저장소에 오염 표본을 넣고 **CLI 를 자식 프로세스로** 밟는다 → %s" % tmp)
    failed = []
    try:
        # ── 대조군: 깨끗한 저장소는 rc=0 이어야 한다(붉기만 하면 되는 검사가 아니다) ──
        clean_repo = _fixture(tmp, "clean", base)
        p = subprocess.run([sys.executable, me, clean_repo], capture_output=True)
        out = (p.stdout or b"").decode("utf-8", "replace")
        print("  대조군(깨끗): rc=%d" % p.returncode)
        if p.returncode != 0:
            print("  ★대조군이 붉다 — 기준선을 세울 수 없다(rc=2)")
            print(out[-400:])
            sys.exit(2)

        for rule in EXPECTED_RULES:
            repo = _fixture(tmp, rule, payloads[rule])
            # 주입이 실제로 파일에 들어갔는지 바이트로 먼저 확인한다(주입 실패를 통과로 세지 않는다).
            victim = os.path.join(repo, "\ud55c\uae00\uc774\ub984.js")
            got = open(victim, "rb").read()
            if got != payloads[rule]:
                print("  %s: 표본이 쓰인 대로가 아니다 — 주입 실패(rc=2)" % rule)
                sys.exit(2)
            p = subprocess.run([sys.executable, me, repo], capture_output=True)
            out = (p.stdout or b"").decode("utf-8", "replace")
            named = any(("적발" in ln and rule in ln) for ln in out.splitlines())
            ok = (p.returncode == 2) and named
            print("  %-8s rc=%d · 그 규칙 이름이 지적문에 %s" %
                  (rule, p.returncode, "있다" if named else "★없다"))
            if not ok:
                failed.append(rule)
                print(out[-400:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if failed:
        print("★검출 실패 — 오염을 넣었는데 CLI 가 잡지 못한 규칙: %s (rc=1)" % " / ".join(failed))
        sys.exit(1)
    print("검출력 확인 — 규칙 %d종 전부를 **CLI 경로**로 잡았고 대조군은 rc=0 이다 (rc=0)"
          % len(EXPECTED_RULES))
    sys.exit(0)

def main():
    argv = sys.argv[1:]
    # ★모르는 옵션과 남는 위치인자를 거부한다 — 예전에는 '--selftes' 오타가 그냥 무시돼
    #   본검사가 돌고 rc=0 이 나왔다. 오타 하나로 검출력 검사가 통과로 둔갑한다
    #   (codex R1 이슈3 실측). 검사 못 한 것은 통과가 아니다.
    ALLOWED = ('--selftest',)
    unknown = [a for a in argv if a.startswith('--') and a not in ALLOWED]
    if unknown:
        print('모르는 옵션이다: %s — 허용 옵션은 %s 뿐이다(rc=2)'
              % (' '.join(unknown), ' '.join(ALLOWED)))
        sys.exit(2)
    positional = [a for a in argv if not a.startswith('--')]
    if len(positional) > 1:
        print('대상 경로는 0개나 1개여야 한다 — %d개를 받았다: %s (rc=2)'
              % (len(positional), ' '.join(positional)))
        sys.exit(2)
    # ★빈 문자열·공백만인 대상을 조용히 '현재 폴더' 로 바꾸지 않는다.
    #   abspath('') 는 현재 폴더가 되어, 대상을 주지 않은 호출이 rc=0 초록을 받는다(실측).
    #   빈 대상은 통과가 아니라 판정 불가다.
    if positional and not positional[0].strip():
        print('대상 경로가 비어 있다(공백뿐) — 통과가 아니라 판정 불가다(rc=2)')
        sys.exit(2)
    root = positional[0] if positional else '.'
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        print('대상 폴더가 없다: %s — 판정 불가(rc=2)' % root)
        sys.exit(2)
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
