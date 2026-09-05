# -*- coding: utf-8 -*-
"""sitemap lastmod 정합 게이트 — 적힌 수정일이 실제 수정일과 같은가.

■ 왜 만들었나 — 게이트가 없어서 태어난 결함(2026-09-05 · T0905-palette)
  팔레트 라운드가 게임 22종의 index.html 을 전부 바꿨는데 sitemap 의 lastmod 는
  출시일 그대로였다(최대 14일 낡음). 그리고 그 앞 together 라운드가 about·privacy 를
  바꿨을 때도 안 고쳐져 하루를 넘겨 살아남았다. ★두 라운드 연속으로 같은 자리가
  빠졌고 아무 검사도 울지 않았다.
  lastmod 는 검색엔진이 ★바뀐 글을 알아보는 단서다. 22개 카드 색이 전부 바뀐 대문이
  '안 바뀌었다' 고 적혀 있으면 그 단서가 거짓말을 한다.

■ 규약 변경(오너 승인 2026-09-05)
  DEPLOY.md §5 는 게임 주소의 lastmod 를 games.json 의 released 로 적으라고 했다.
  그 규칙은 ★게임 페이지가 출시 때만 바뀐다고 가정했고 이 라운드에서 그 가정이 깨졌다.
  ⇒ 게임 주소도 ★마지막 커밋일로 바꾼다. 규약의 글자보다 규약이 스스로 적은 이유
    ('바뀐 글을 알아보는 단서')를 따른다.

■ 무엇을 정본으로 재는가
  ★git 커밋일(`git log -1 --format=%cs -- <경로>`)이다. 워크트리 mtime 은 쓰지 않는다 —
  체크아웃·리베이스·클론으로 흔들린다(CSO 243 설계).

■ 판정 3상 (이 저장소의 계약)
  0 = 전부 일치 · 3 = 하나라도 불일치 · 2 = 판정 불가(경로 매핑 실패·파일 없음·git 없음)
  ★판정 불가를 통과로 세지 않는다.

■ ★양방향으로 본다
  lastmod 가 커밋일보다 이르면 '바뀐 것을 안 바뀌었다고' 말하는 것이고,
  늦으면 '없던 수정을 주장하는' 것이다. 둘 다 FAIL 이다.

사용법: python3 check_sitemap_lastmod.py <저장소 경로>
       python3 check_sitemap_lastmod.py <저장소> --inject <loc>=<날짜>   # 검출력 확인
"""
import io, os, re, subprocess, sys

BASE = 'https://hanpango.com'


def git_commit_date(root, rel):
    try:
        p = subprocess.run(['git', 'log', '-1', '--format=%cs', '--', rel],
                           cwd=root, capture_output=True, text=True)
    except FileNotFoundError:
        return None, 'git 을 실행할 수 없다'
    if p.returncode != 0:
        return None, f'git log 실패: {(p.stderr or "").strip()[:120]}'
    d = (p.stdout or '').strip()
    return (d, None) if d else (None, f'커밋 이력이 없다: {rel}')


def loc_to_path(loc):
    """URL 을 저장소 상대 경로로 푼다. 루트는 index.html, 하위는 x/index.html."""
    if not loc.startswith(BASE):
        return None
    tail = loc[len(BASE):]
    if tail in ('', '/'):
        return 'index.html'
    if not tail.startswith('/') or not tail.endswith('/'):
        return None
    return tail.strip('/') + '/index.html'


def main(argv):
    root = argv[1] if len(argv) > 1 else '.'
    inject = None
    if '--inject' in argv:
        inject = argv[argv.index('--inject') + 1]

    sm = os.path.join(root, 'sitemap.xml')
    if not os.path.exists(sm):
        print('INDET: sitemap.xml 이 없다')
        return 2
    src = io.open(sm, encoding='utf-8').read()

    if inject:
        loc, date = inject.split('=', 1)
        pat = re.compile(r'(<loc>' + re.escape(loc) + r'</loc><lastmod>)[0-9-]+(</lastmod>)')
        src, n = pat.subn(r'\g<1>' + date + r'\g<2>', src)
        if n != 1:
            print(f'INDET: 주입 대상 {loc} 을 {n}개 찾았다 — 유일해야 한다')
            return 2
        print(f'[주입] {loc} lastmod -> {date}')

    entries = re.findall(r'<loc>([^<]+)</loc><lastmod>([0-9-]+)</lastmod>', src)
    if not entries:
        print('INDET: loc/lastmod 쌍을 하나도 못 읽었다')
        return 2

    bad, indet = [], []
    for loc, said in entries:
        rel = loc_to_path(loc)
        if rel is None:
            indet.append(f'{loc}: 경로로 풀 수 없다')
            continue
        if not os.path.exists(os.path.join(root, rel)):
            indet.append(f'{loc}: 파일이 없다 ({rel})')
            continue
        real, err = git_commit_date(root, rel)
        if real is None:
            indet.append(f'{loc}: {err}')
            continue
        if said != real:
            way = '이르다(바뀐 것을 안 바뀌었다고 말한다)' if said < real \
                  else '늦다(없던 수정을 주장한다)'
            bad.append(f'{loc}: 적힌 {said} != 실제 {real} — {way}')

    print(f'대상 {len(entries)}건 · 불일치 {len(bad)} · 판정불가 {len(indet)}')
    for b in bad:
        print(f'  [FAIL] {b}')
    for i in indet:
        print(f'  [INDET] {i}')
    if indet:
        print('판정 불가가 있다 — 통과로 세지 않는다')
        return 2
    if bad:
        return 3
    print('전부 일치')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
