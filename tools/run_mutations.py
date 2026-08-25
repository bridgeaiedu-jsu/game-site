# -*- coding: utf-8 -*-
# 오늘의 낱말 뮤테이션 러너 — 검증기가 고의 결함을 실제로 잡는지 본다.
#
# ── 검증기(verify_word.js) 한 번 실행의 종료코드 ───────────────────────────────
#     exit 0 = 검증기가 못 잡음(미탐지 — 결함)
#     exit 1 = 검증기가 FAIL 을 냈다
#     exit 2 = 주입 실패(앵커 불일치 — 하네스 설정 오류, 탐지 아님)
#
# ── ★정상 탐지의 정의(R3 · codex R2 issue#1) ──────────────────────────────────
#   세 가지를 **모두** 만족해야 '탐지'다:
#     ① exit 1        ② 지목한 검사가 FAIL 목록에 있다     ③ stderr 예외 0 · 판정 요약 줄 도달
#   지목 FAIL 이 먼저 찍힌 뒤 검증기가 예외로 중단된 경우는 **탐지가 아니라 러너 오류**다.
#   (R2 까지는 그것을 crashed 로 세면서도 detected 에 합산하고 최종 종료조건에서 빠뜨렸다 = fail-open.
#    "결함을 잡아서 죽은 것"과 "죽어서 결함을 잡은 것처럼 보인 것"은 구별할 수 없으므로 성공으로 치지 않는다.)
#
# ── ★이 러너 자신의 종료코드 계약(R3) ─────────────────────────────────────────
#     exit 0 = 주입 전부가 지목한 검사로 탐지 · 예외 0 · 주입실패 0 · 원본 PASS
#     exit 1 = 검출력 실패(미탐지·엉뚱탐지) — 검증기에 구멍이 있다
#     exit 2 = 하네스 비정상(예외중단·판정요약 미도달/형식 이상·주입실패·러너오류·원본이 이미 FAIL·
#              CLI 사용 오류) → 이 경우 검출력 수치 자체를 신뢰할 수 없다.
#   ★원본 정상의 정의(R4 · codex R3 issue#1): 종료코드 0 **그리고** 요약에서 파싱한 FAIL 이 0
#     **그리고** 예외 0. 종료코드만 믿으면 'FAIL 을 내면서 exit 0' 인 검증기를 원본 정상으로 오인한다.
#
# 사용법: python3 run_mutations.py [--html <index.html>] [--verifier <verify_word.js>]
#   --verifier 는 이 러너의 자기검사용이다(고의로 망가뜨린 검증기 사본을 물려
#   fail-open 이 정말 닫혔는지 증명할 때 쓴다). 기본값은 이 폴더의 verify_word.js.
import io
import os
import re
import tempfile
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
USAGE = ("사용법: python3 run_mutations.py [--html <index.html>] [--verifier <verify_word.js>]\n"
         "  --html      검사 대상 페이지(생략하면 검증기 기본값)\n"
         "  --verifier  검증기 경로(생략하면 이 폴더의 verify_word.js) — 러너 자기검사용\n")


def die_cli(msg):
    """CLI 사용 오류는 **하네스 비정상(exit 2)** 이다 — exit 1(검출력 실패)과 섞으면
    자동 호출자가 원인을 오분류한다(codex R3 issue#2)."""
    sys.stderr.write("run_mutations: " + msg + "\n" + USAGE)
    print("뮤테이션 검산: 실행하지 않았다 — " + msg + " (exit 2)")
    sys.exit(2)


def argof(name, default=None):
    if name not in sys.argv:
        return default
    i = sys.argv.index(name) + 1
    if i >= len(sys.argv) or sys.argv[i].startswith("--"):
        die_cli("%s 뒤에 값이 없다" % name)
    return sys.argv[i]


V = os.path.abspath(argof("--verifier", os.path.join(HERE, "verify_word.js")))

# ── 앵커 표(러너 소관 · 2026-08-23 T0823-theme-light) ─────────────────────────
# 대상 페이지가 정상적으로 개정되면(예: 색 값을 토큰으로 옮김) 검증기 안에 적힌 뮤테이션
# 앵커가 그 페이지에서 사라진다 → 주입 실패(exit 2). 이건 검출력 실패가 아니라 ★앵커가 낡은
# 것이다. 정본 검증기(verify_word.js)는 건드리지 않고, 여기서 앵커만 갈아 끼운 ★임시 사본을
# 만들어 그 사본으로 돌린다. 무엇을 왜 바꿨는지는 아래 표에 함께 적는다.
ANCHOR_OVERRIDES = {
    "w-kb-miss-low-contrast": {
        "왜": "라이트 테마 전환에서 화면 자판 miss 글자색이 리터럴 #cfe0d6 에서 토큰 var(--miss-ink) 로 바뀌었다",
        "old_find": ".kb button.miss{background:var(--miss);border-color:var(--miss);color:#cfe0d6}",
        "new_find": ".kb button.miss{background:var(--miss);border-color:var(--miss);color:var(--miss-ink)}",
        "old_repl": ".kb button.miss{background:var(--miss);border-color:var(--miss);color:#8fa79a}",
        "new_repl": ".kb button.miss{background:var(--miss);border-color:var(--miss);color:#a8b0bb}",
        "설명": "라이트 miss 배경 #d1d5db 위에서 #a8b0bb 는 1.486:1 — 4.5:1 하한을 깬다(탐지되어야 정상)",
    },
}


def verifier_with_fresh_anchors(path):
    """앵커가 낡은 항목만 갈아 끼운 검증기 임시 사본 경로를 돌려준다.
    바꿀 것이 없으면 원본 경로를 그대로 돌려준다(사본을 만들지 않는다)."""
    src = io.open(path, encoding="utf-8", newline="").read()
    applied, skipped = [], []
    for name, ov in ANCHOR_OVERRIDES.items():
        if ov["old_find"] in src:
            src = src.replace(ov["old_find"], ov["new_find"]).replace(ov["old_repl"], ov["new_repl"])
            applied.append(name)
        elif ov["new_find"] in src:
            skipped.append(name + "(정본이 이미 새 앵커)")
        else:
            skipped.append(name + "(★정본에서 옛 앵커도 새 앵커도 못 찾음)")
    if not applied:
        return path, applied, skipped
    fd, tmp = tempfile.mkstemp(prefix="verify_word_anchored_", suffix=".js")
    os.close(fd)
    io.open(tmp, "w", encoding="utf-8", newline="").write(src)
    return tmp, applied, skipped

# (뮤테이션 이름, 이 결함을 잡아야 하는 검사 이름의 일부)
MUTS = [
    ("w-score-no-pool", "200케이스 오라클 불일치 0"),
    ("w-score-no-empty-rule", "빈칸은 다른 자리로 옮겨 붙지 않는다"),
    ("w-answer-modulo-hash", "동안 중복 0"),
    ("w-no-cas", "늦게 쓴 탭은 만료된다"),
    ("w-rev-not-monotonic", "최초 커밋 리비전 1"),
    ("w-no-list-check", "목록 밖 낱말은 시도로 세지 않는다"),
    ("w-share-leaks-answer", "공유 문자열에 정답이 들어 있지 않다"),
    ("w-buttons-not-disabled", "준비 중에는 두 버튼이 잠긴다"),
    ("w-jong-split-3syllable", "두 글자를 넘겨 세 글자가 되지 않는다"),
    # ── R2 추가 ──────────────────────────────────────────────────────────────
    ("w-nested-no-parent-inert", "겹친 동안 부모(start)가 inert 다"),
    ("w-nested-no-focus-restore", "초점이 통계를 연 버튼(btnStats2)으로 정확히 되돌아왔다"),
    ("w-nested-parent-stays-modal", "활성 aria-modal dialog 는 하나(stats)"),
    ("w-profanity-in-guesses", "금칙 표면형은 유효 추측으로도 받아들이지 않는다"),
    ("w-profanity-in-answers", "런타임이 고르는 일일 정답 전수"),
    ("w-kb-miss-low-contrast", "화면 자판 miss 대비 4.5:1 이상"),
    ("w-source-href-ko-dropped", "ko 출처에 A 자료 원문 링크가 있다"),
    ("w-license-href-en-dropped", "en 출처에 공공누리 제1유형 조건 링크가 있다"),
]

HTML_ARG = []
if "--html" in sys.argv:
    HTML_ARG = ["--html", os.path.abspath(argof("--html"))]


def run(mut=None):
    cmd = ["node", V] + HTML_ARG + (["--mutate", mut] if mut else [])
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


SUMMARY_RE = re.compile(r"PASS\s+(\d+)\s*·\s*FAIL\s+(\d+)")


def summary_of(out):
    """검증기 판정 줄을 **고정 형식으로 파싱**한다 → (요약문, PASS 수, FAIL 수).
    파싱하지 못하면 None — 판정에 도달하지 못했거나 형식이 어긋난 것이므로 하네스 비정상이다.
    ★수치를 읽지 않고 '요약 줄이 있다' 로만 통과시키면, 검증기가 FAIL 을 내면서 exit 0 을 내는
      경우를 원본 정상으로 인정하게 된다(codex R3 issue#1)."""
    for line in out.splitlines():
        t = line.strip()
        m = SUMMARY_RE.search(t)
        if m:
            return (t.lstrip("= ").strip(), int(m.group(1)), int(m.group(2)))
    return None


def summary_line(out):
    r = summary_of(out)
    return r[0] if r else None


def fail_lines(out):
    return [l.strip()[4:].strip() for l in out.splitlines() if l.strip().startswith("FAIL")]


def exceptions(err):
    """검증기가 예외로 죽었는지 — node 는 스택 첫 줄에 'Error' 를 찍는다."""
    return [l for l in err.splitlines() if "Error" in l]


V_GIVEN = "--verifier" in sys.argv
ANCHOR_NOTE = []
if not V_GIVEN:
    V2, _applied, _skipped = verifier_with_fresh_anchors(V)
    if _applied:
        ANCHOR_NOTE.append("앵커 갱신 적용: " + ", ".join(_applied) + " (정본 무변경 · 임시 사본으로 실행)")
    for m in _skipped:
        ANCHOR_NOTE.append("앵커 갱신 생략: " + m)
    V = V2

print("# 오늘의 낱말 뮤테이션 검산")
print("# 검증기: " + V)
for _n in ANCHOR_NOTE:
    print("# " + _n)
print("# 대상: " + (HTML_ARG[1] if HTML_ARG else "검증기 기본값(작업 트리의 word/index.html)"))
print()

rc, out, err = run()
base = summary_of(out)
base_exc = exceptions(err)
print("[원본] exit %d — %s" % (rc, base[0] if base else "(판정 요약 줄 없음/형식 이상 — 검증기가 판정에 도달하지 못함)"))
# ★원본 정상 = 종료코드 0 **그리고** 요약 파싱 성공 **그리고** FAIL 0 **그리고** 예외 0.
#   종료코드만 믿지 않는다 — 검증기가 FAIL 을 내면서 exit 0 을 내는 경우를 걸러야 한다.
baseline_ok = (rc == 0 and base is not None and base[2] == 0 and not base_exc)
if not baseline_ok:
    why = []
    if rc != 0:
        why.append("종료코드 %d" % rc)
    if base is None:
        why.append("요약 파싱 실패")
    elif base[2] != 0:
        why.append("원본 FAIL %d건(종료코드는 %d)" % (base[2], rc))
    if base_exc:
        why.append("예외 %d건" % len(base_exc))
    print("  !! 원본이 정상 PASS 로 끝나지 않았다(%s) — 뮤테이션 집계는 의미가 없다" % " · ".join(why))

detected = notdet = injfail = runerr = crashed = wrongtest = 0
stale, misaimed, crashes = [], [], []
for m, expect in MUTS:
    rc, out, err = run(m)
    parsed = summary_of(out)
    s = parsed[0] if parsed else None
    exc = exceptions(err)
    fl = fail_lines(out)
    hit = any(expect in l for l in fl)
    if rc == 2:
        injfail += 1
        verdict = "★주입실패(앵커 없음 — 탐지 아님)"
        stale.append((m, (err.strip().splitlines() or ["(사유 없음)"])[0]))
    elif exc or s is None:
        # ★fail-open 차단 지점: 지목 FAIL 이 먼저 찍혔더라도 예외로 중단됐으면 탐지가 아니다.
        crashed += 1
        verdict = "★예외중단·요약이상(러너 오류 — 탐지 아님)"
        crashes.append((m, hit, (exc or ["(예외 줄 없음 · 판정 요약 미도달/형식 이상)"])[0].strip()[:120]))
    elif rc == 1 and hit:
        detected += 1
        verdict = "탐지(FAIL %d건)" % len(fl)
    elif rc == 1:
        wrongtest += 1
        verdict = "★엉뚱탐지(지목 검사가 못 잡음)"
        misaimed.append((m, expect, fl[:3]))
    elif rc == 0:
        notdet += 1
        verdict = "★미탐지(결함)"
    else:
        runerr += 1
        verdict = "★러너오류(예상 밖 종료코드)"
    print("  %-28s exit %d  %-34s %s" % (m, rc, verdict, s or "(판정 요약 줄 없음)"))

print("-" * 78)
print("  원본 정상=%s · 탐지 %d · 엉뚱탐지 %d · 미탐지 %d · 예외중단 %d · 주입실패 %d · 러너오류 %d  (총 %d종)"
      % (baseline_ok, detected, wrongtest, notdet, crashed, injfail, runerr, len(MUTS)))
if stale:
    print("  주입실패 사유:")
    for m, why in stale:
        print("    - %-26s %s" % (m, why))
if misaimed:
    print("  엉뚱탐지 상세(지목 검사가 침묵했다 — 그 검사에 구멍이 있다):")
    for m, expect, fl in misaimed:
        print("    - %-26s 기대 검사='%s' · 실제 FAIL=%s" % (m, expect, fl))
if crashes:
    print("  예외중단 상세(★탐지로 세지 않는다 — 죽어서 FAIL 이 난 것과 구별할 수 없다):")
    for m, hit, why in crashes:
        print("    - %-26s 지목 FAIL 출력됨=%s · %s" % (m, hit, why))

harness_bad = bool(crashed or injfail or runerr or not baseline_ok)
power_bad = bool(notdet or wrongtest)
print()
print("  판정 기준: 주입 %d종 전부 **지목한 검사로** 탐지(exit 1 + 지목 FAIL + 예외 0) ·"
      % len(MUTS))
print("            엉뚱탐지 0 · 미탐지 0 · 예외중단 0 · 주입실패 0 ·")
print("            원본 정상(exit 0 + 요약 파싱 성공 + FAIL 0 + 예외 0) 이어야 한다.")
if harness_bad:
    print("  → 하네스 비정상(exit 2): 검출력 수치를 신뢰할 수 없다.")
elif power_bad:
    print("  → 검출력 실패(exit 1): 검증기에 구멍이 있다.")
else:
    print("  → 전부 충족(exit 0).")
sys.exit(2 if harness_bad else (1 if power_bad else 0))
