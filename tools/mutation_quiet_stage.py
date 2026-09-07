# -*- coding: utf-8 -*-
"""음성 대조군(quiet control)을 ★러너측 스테이징으로 세운다 — 검사기 무접촉.

■ 왜 러너가 직접 넣는가
  형제 러너의 대조군은 원래 ★검사기가 선언한 뮤테이션(`--mutate m-quiet-control` 등)을 쓴다.
  그런데 fake-one·higher-lower·reverse·stop·tensec 의 검사기 5종에는 그런 선언이 ★0건이다
  (2026-09-08 실측 — verify_*.js 에서 quiet-control 선언 0). 검사기를 고치지 않고 대조군을
  세우는 길은 하나뿐이다: ★제품 사본에 무해한 변이를 넣고 `--html` 로 먹인다.
  제품 파일도 검사기도 건드리지 않는다.

■ 대조군이 왜 필요한가
  붉어야 할 것만 시험하면 ★검출력의 절반만 증명한다. 멀쩡한 사본에도 검사가 반응하는 것
  (거짓 실패)은 '검사가 계약이 아니라 ★대리물을 본다'는 신호이고, 대조군이 없으면 그것을
  ★구조적으로 볼 수 없다.

■ 무해 변이를 무엇으로 고르는가 — 그리고 그것이 계약 밖임을 어떻게 아는가
  `<head ...>` 바로 뒤에 ★HTML 주석 한 줄을 끼운다. 근거는 셋이고 전부 실측이다:
    ① C군 검사기 5종 중 `<!--` 를 읽는 것이 ★0종이다(주석은 어느 계약도 짊어지지 않는다).
    ② 전체 길이·해시 단언이 ★0종이다(RAW.length·createHash·Buffer.byteLength 전부 0).
    ③ 넣는 문자열은 ★새 토큰이라 기존 앵커의 매치를 뺏지도 채우지도 않는다.
  ★그리고 '안 붉으니 무해' 로 끝내지 않는다 — 주석을 head 뒤에 넣으면 그 아래 문서 전체의
  ★바이트 오프셋과 행번호가 밀린다. 계약이 아니라 위치·오프셋 같은 ★대리물에 걸린 검사가
  있으면 이 대조군이 붉는다. 즉 이 변이는 무해하면서도 ★공허하지 않다.

■ 두 관문을 먼저 통과해야 대조군 판정이 성립한다
  ⓐ 전제검사 — 무변이 스테이지 사본이 ★원본과 같은 rc·같은 요약행을 내는가.
     (같은 입력을 받았다는 것을 먼저 세운다. 이게 깨지면 무엇을 재도 뜻이 없다.)
  ⓑ 적발력 — 그 스테이지 경로로 ★검사기 자신의 뮤테이션을 하나 넣으면 붉는가.
     (붉을 수 없는 경로에서 '조용했다' 는 관측이 아니라 관측의 부재다.)

■ 사본 위치
  스테이지는 `tools/.mutstage/<러너키>/` 다 — ★제품 트리 밖이라 배포에 섞이지 않는다.
  ★단 검사기가 HTML 기준 상대경로를 읽으면 그 구조를 함께 옮겨야 한다
  (실측: verify_tensec.js:860 이 `dirname(HTML)/../privacy/index.html` 을 읽는다.
   나머지 4종은 HTML 한 파일만 읽는다 — readFileSync 전수 확인).
  러너마다 `extra_dirs` 로 그 형제를 선언한다.

■ 바이트
  사본은 ★바이트 그대로 복사한다(텍스트 모드·줄끝 변환 금지). 이 저장소의 워킹트리는
  CRLF 이고 커밋본은 LF 다(git 정규화) — 러너는 워킹트리를 재므로 사본도 워킹트리 바이트다.
  텍스트 모드로 복사하면 stop·tensec 검사기(CRLF 를 정규화하지 않는다)가 다른 것을 보게 된다.
"""
import os
import re
import shutil
import subprocess

MARKER = 'quiet-control (mutation runner staging · 제품 아님)'
HEAD_RE = re.compile(rb'<head[^>]*>')


def _stage_root(tools_dir):
    return os.path.join(tools_dir, '.mutstage')


def build_stage(root, tools_dir, key, html_path, extra_dirs=()):
    """★러너가 실제로 재는 그 HTML 을 스테이지로 복사한다. (staged_html, err).

    ★`--html` 로 대상을 바꿔 돌려도 대조군이 ★같은 파일을 재게 하려고 기본 경로가 아니라
    인자로 받은 실제 경로를 쓴다. 부모 폴더 이름을 그대로 보존해야 검사기의 상대 참조
    (`dirname(HTML)/../<형제>`)가 원본과 같은 모양으로 풀린다.
    """
    src = os.path.abspath(html_path)
    game_dir = os.path.basename(os.path.dirname(src))
    base = os.path.join(_stage_root(tools_dir), key)
    try:
        if os.path.isdir(base):
            shutil.rmtree(base)
        os.makedirs(os.path.join(base, game_dir))
        dst = os.path.join(base, game_dir, os.path.basename(src))
        shutil.copyfile(src, dst)                     # ★바이트 그대로
        for e in extra_dirs:
            os.makedirs(os.path.join(base, e), exist_ok=True)
            shutil.copyfile(os.path.join(root, e, 'index.html'),
                            os.path.join(base, e, 'index.html'))
    except OSError as exc:
        return None, '스테이지를 만들지 못했다: %s' % exc
    if os.path.getsize(dst) != os.path.getsize(src):
        return None, '사본 크기가 원본과 다르다 — 바이트 복사가 아니다'
    return dst, None


def clear_stage(tools_dir, key):
    """★치우는 것까지가 집행이다 — 자기 칸을 지우고, 부모가 비면 부모도 지운다.

    부모를 남겨 두면 빈 `.mutstage/` 가 저장소에 계속 앉아 있다(git 은 빈 폴더를 안 보여
    주므로 status 로는 안 보이고, 다음 사람이 무엇인지 몰라 건드리지도 못한다).
    ★다른 러너가 동시에 자기 칸을 쓰고 있으면 부모는 비어 있지 않으므로 그대로 둔다.
    """
    root = _stage_root(tools_dir)
    try:
        base = os.path.join(root, key)
        if os.path.isdir(base):
            shutil.rmtree(base)
        if os.path.isdir(root) and not os.listdir(root):
            os.rmdir(root)
    except OSError:
        pass


def inject_marker(staged_html):
    """head 바로 뒤에 주석 한 줄을 끼운다. (err,) — 넣지 못하면 사유."""
    raw = open(staged_html, 'rb').read()
    m = HEAD_RE.search(raw)
    if not m:
        return '<head> 앵커를 찾지 못했다 — 대조군을 세울 수 없다'
    if MARKER.encode('utf-8') in raw:
        return '표식이 이미 제품에 있다 — 대조군이 무변이가 되어 공허하다'
    out = raw[:m.end()] + ('<!-- ' + MARKER + ' -->').encode('utf-8') + raw[m.end():]
    if out == raw:
        return '주입 후 바이트가 그대로다 — 변이가 일어나지 않았다'
    open(staged_html, 'wb').write(out)
    return None


def run_checker(verifier, html, extra=()):
    p = subprocess.run(['node', verifier, '--html', html] + list(extra),
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def quiet_control(root, tools_dir, key, html_path, verifier, summary_re,
                  red_mutation, extra_dirs=()):
    """대조군 한 종을 세우고 판정한다.

    돌려주는 dict:
      ok        판정이 성립하고 대조군이 조용했다
      status    'quiet' | 'noisy' | 'indet'
      detail    사람이 읽는 한 줄
      premise   전제검사 결과 문자열
      red       적발력 검사 결과 문자열
    """
    src = os.path.abspath(html_path)
    staged, err = build_stage(root, tools_dir, key, src, extra_dirs)
    if err:
        return {'ok': False, 'status': 'indet', 'detail': err, 'premise': '-', 'red': '-'}
    try:
        # ⓐ 전제검사 — 원본과 스테이지 무변이 사본이 같은 판정을 내는가
        rc_o, out_o = run_checker(verifier, src)
        rc_s, out_s = run_checker(verifier, staged)
        so, ss = summary_re.search(out_o), summary_re.search(out_s)
        if not so or not ss:
            return {'ok': False, 'status': 'indet',
                    'detail': '요약행을 읽지 못했다 — 전제를 세울 수 없다',
                    'premise': '요약행 없음', 'red': '-'}
        if rc_o != rc_s or so.group(0) != ss.group(0):
            return {'ok': False, 'status': 'indet',
                    'detail': '★전제 깨짐 — 사본이 원본과 다른 판정을 낸다',
                    'premise': '원본 rc=%d %s ≠ 사본 rc=%d %s' % (rc_o, so.group(0), rc_s, ss.group(0)),
                    'red': '-'}
        premise = '원본 = 사본 (rc=%d · %s)' % (rc_o, so.group(0))

        # ⓑ 적발력 — 이 스테이지 경로로 검사기 자신의 뮤테이션을 넣으면 붉는가
        rc_r, _out_r = run_checker(verifier, staged, ['--mutate', red_mutation])
        if rc_r == 0:
            return {'ok': False, 'status': 'indet',
                    'detail': '★적발력 없음 — 스테이지 경로에서 붉어야 할 변이(%s)가 조용하다'
                              % red_mutation,
                    'premise': premise, 'red': 'rc=0 (붉지 않았다)'}
        red = '%s → rc=%d (붉었다)' % (red_mutation, rc_r)

        # 본 판정 — 무해 변이를 넣고 조용한지 본다
        ierr = inject_marker(staged)
        if ierr:
            return {'ok': False, 'status': 'indet', 'detail': ierr, 'premise': premise, 'red': red}
        rc_q, out_q = run_checker(verifier, staged)
        sq = summary_re.search(out_q)
        if not sq:
            return {'ok': False, 'status': 'indet',
                    'detail': '대조군 실행의 요약행이 없다 — 통과로 세지 않는다',
                    'premise': premise, 'red': red}
        if rc_q == 0:
            return {'ok': True, 'status': 'quiet',
                    'detail': '조용했다 (%s)' % sq.group(0), 'premise': premise, 'red': red}
        return {'ok': False, 'status': 'noisy',
                'detail': '★거짓 실패 — 계약 밖 주석 한 줄에 검사가 반응했다 (rc=%d · %s)'
                          % (rc_q, sq.group(0)),
                'premise': premise, 'red': red}
    finally:
        clear_stage(tools_dir, key)
