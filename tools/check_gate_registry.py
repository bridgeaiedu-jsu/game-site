#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_gate_registry.py — 게이트 목록이 ★기계에서 파생되는가 (양방향 차집합).

■ 왜 만들었나 — 손으로 센 목록은 게이트가 되지 못한다 (2026-09-07 R3 F4)
  R2FIX-2 커밋 메시지는 *"게이트 정본 23종 전종 rc=0"* 이라 적었는데, 그 23 을 내는 셈법이
  트리 어디에도 없었다(문자열 `게이트 정본` 0건 · 게이트를 도는 러너/CI 0건). 같은 커밋의
  X 항은 *"집계는 목록에서 파생한다(전사 금지)"* 라고 적어 두고 ★그 집계만 전사였다.
  그리고 반대 방향이 더 크게 샜다 — 실재하는 검사기 6종 중 ★5종이 DEPLOY.md 에 등재조차
  없었다(check_meta_i18n_assets.py · check_card_render.js · check_palette.py ·
  check_rainbow.py · check_render_parity.mjs). ★한 방향만 보면 "목록에 있는데 파일이 없다" 는
  보지만 ★"파일은 있는데 목록에 없다" 는 원리적으로 못 본다.

■ 무엇을 재나 (계약 세 문장)
  ① tools/ 의 ★모든 파일은 `tools/gates.json` 에 정확히 한 번 선언돼 있다
     (gates · per_game · non_gate_tools 중 하나 — 비게이트는 ★사유와 함께).
  ② `gates[]` 의 모든 항목은 DEPLOY.md 의 ★체크리스트 줄에 파일 경로가 적혀 있다.
  ③ DEPLOY.md 체크리스트가 부르는 `tools/…` 는 전부 gates.json 에 선언돼 있다.
  집계는 ★이 파일이 세지 않는다 — gates.json 의 길이에서 파생시켜 찍는다.

■ 종료코드: 0 = 전부 성립 · 1 = 미달(등재 누락·미선언 파일) · 2 = ★판정 불가
  (정본을 못 읽음 · 선언된 파일이 실재하지 않음 = 목록 노후화 · 잘못된 호출).
  ★rc=2 는 통과가 아니다.

■ 검출력: `--selftest` 로 잰다(임시 사본에만 결함을 심는다 · 대상 나무는 안 건드린다).
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

USAGE = '사용법: python3 tools/check_gate_registry.py <저장소 루트> [--selftest]'


def fail_indeterminate(msg):
    print('★판정 불가 — ' + msg)
    return 2


def load_gates(root):
    p = os.path.join(root, 'tools', 'gates.json')
    try:
        with io.open(p, encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        return None, '게이트 정본을 못 읽었다(%s): %s' % (p, e)
    for key in ('gates', 'per_game', 'non_gate_tools'):
        if not isinstance(d.get(key), list):
            return None, '게이트 정본에 %s 배열이 없다 — 대조할 것이 없다' % key
    for g in d['gates']:
        if not g.get('file') or not g.get('cmd') or not g.get('when') or not g.get('why'):
            return None, 'gates 항목은 {file, cmd, when, why} 여야 한다: %r' % (g,)
    for g in d['per_game']:
        if not g.get('file') or not g.get('game'):
            return None, 'per_game 항목은 {file, game} 여야 한다: %r' % (g,)
    for g in d['non_gate_tools']:
        # ★비게이트도 ★사유를 남긴다 — 사유 없는 강등은 목록에서 조용히 빼는 것과 같다
        if not g.get('file') or not g.get('why'):
            return None, 'non_gate_tools 항목은 {file, why} 여야 한다 — 사유 없는 강등을 막는다: %r' % (g,)
    # optional_data 는 ★없어도 되는 조건부 데이터다(있으면 선언으로 센다). 없으면 빈 목록으로 본다.
    opt = d.get('optional_data')
    if opt is None:
        d['optional_data'] = opt = []
    if not isinstance(opt, list):
        return None, 'optional_data 는 배열이어야 한다'
    for g in opt:
        if not isinstance(g, dict) or not g.get('file') or not g.get('why'):
            return None, 'optional_data 항목은 {file, why} 여야 한다 — ★조건을 적지 않은 면제를 막는다: %r' % (g,)
    return d, None


def actual_tool_files(root):
    out = set()
    base = os.path.join(root, 'tools')
    if not os.path.isdir(base):
        return None
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, '/')
            out.add(rel)
    return out


CHECKBOX = re.compile(r'^\s*-\s\[[ x]\]\s')
TOOLREF = re.compile(r'tools/[A-Za-z0-9_./-]+')


def deploy_checklist_refs(root):
    """DEPLOY.md 의 ★체크리스트 항목(줄과 그 이어지는 들여쓴 줄)에서 tools/… 을 모은다."""
    p = os.path.join(root, 'DEPLOY.md')
    try:
        text = io.open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
    except OSError as e:
        return None, 'DEPLOY.md 를 못 읽었다: %s' % e
    refs = set()
    in_item = False
    for ln in text.split('\n'):
        if CHECKBOX.match(ln):
            in_item = True
        elif in_item and ln.strip() and not ln.startswith((' ', '\t')):
            in_item = False           # 들여쓰기가 끝나면 그 항목도 끝이다
        if in_item:
            for m in TOOLREF.findall(ln):
                # ★중괄호·꺾쇠가 든 표기는 ★파일 이름이 아니라 묶음 표기다(run_mutations_{a,b}.py)
                if '{' in ln[max(0, ln.find(m) - 1):ln.find(m) + len(m) + 1]:
                    continue
                refs.add(m)
    cleaned = set()
    for r in refs:
        r = r.rstrip('.·,)')
        if '{' in r or '<' in r:
            continue
        cleaned.add(r)
    return cleaned, None


def check(root):
    d, err = load_gates(root)
    if err:
        return fail_indeterminate(err)
    actual = actual_tool_files(root)
    if actual is None:
        return fail_indeterminate('tools/ 를 찾지 못했다: %s' % root)
    refs, err = deploy_checklist_refs(root)
    if err:
        return fail_indeterminate(err)

    gate_files = [g['file'] for g in d['gates']]
    game_files = [g['file'] for g in d['per_game']]
    non_files = [g['file'] for g in d['non_gate_tools']]
    opt_files = [g['file'] for g in d['optional_data']]
    declared = gate_files + game_files + non_files + opt_files

    # ★집계는 ★목록의 길이에서 파생한다 — 이 줄이 F4 의 수리다
    print('게이트 정본 tools/gates.json — ★집계는 이 목록의 길이에서 파생한다(전사 금지)')
    print('  항상 도는 게이트      %d' % len([g for g in d['gates'] if g['when'] == 'always']))
    print('  조건부 게이트         %d  (%s)'
          % (len([g for g in d['gates'] if g['when'] != 'always']),
             ' · '.join(g['when'] for g in d['gates'] if g['when'] != 'always') or '없음'))
    print('  게이트 합계           %d' % len(gate_files))
    print('  게임별(손댄 게임만)   %d' % len(game_files))
    print('  비게이트(사유 있음)   %d' % len(non_files))
    print('  조건부 데이터(없어도 됨) %d:' % len(opt_files))
    for g in d['optional_data']:
        print('      %s   ← 조건: %s' % (g['file'], g['why']))
    if not opt_files:
        print('      없음')
    print('  선언 합계 %d · tools/ 실재 파일 %d' % (len(declared), len(actual)))
    print('')

    rc1 = []
    rc2 = []

    dup = sorted({f for f in declared if declared.count(f) > 1})
    if dup:
        rc2.append('한 파일이 두 번 이상 선언됐다(어느 칸이 참인지 알 수 없다): %s' % ', '.join(dup))

    # ── 방향 ① tools/ 실재 → 선언 (★F4 가 숨어 있던 방향)
    undeclared = sorted(actual - set(declared))
    print('① tools/ 실재인데 ★정본에 선언이 없다        %d' % len(undeclared))
    for f in undeclared:
        print('      %s   ★게이트면 gates 에, 아니면 non_gate_tools 에 ★사유와 함께 적어라' % f)
    if not undeclared:
        print('      없음 (★이 줄이 부재의 증거다)')
    if undeclared:
        rc1.append('미선언 파일 %d건' % len(undeclared))

    # ── 방향 ② 선언 → 실재 (목록 노후화 = 판정 불가)
    # ★조건부 데이터는 ② 에서 뺀다 — 지금 없는 것이 정상이다(빼는 이유를 정본이 적고 있다)
    missing = sorted((set(declared) - set(opt_files)) - actual)
    print('② 정본에 선언됐는데 ★파일이 없다             %d' % len(missing))
    for f in missing:
        print('      %s   ★목록 노후화 — 지웠으면 정본에서도 지워라' % f)
    if not missing:
        print('      없음 (★이 줄이 부재의 증거다)')
    if missing:
        rc2.append('선언됐는데 실재하지 않는 파일 %d건' % len(missing))

    # ── 방향 ③ gates[] → DEPLOY.md 체크리스트
    unlisted = sorted(f for f in gate_files if f not in refs)
    print('③ 게이트인데 ★DEPLOY.md 체크리스트에 없다     %d' % len(unlisted))
    for f in unlisted:
        print('      %s   ★만들어 놓고 안 도는 검사는 없는 것과 같다' % f)
    if not unlisted:
        print('      없음 (★이 줄이 부재의 증거다)')
    if unlisted:
        rc1.append('DEPLOY 미등재 게이트 %d건' % len(unlisted))

    # ── 방향 ④ DEPLOY.md 체크리스트 → 정본
    stray = sorted(r for r in refs if r not in set(declared))
    print('④ DEPLOY 체크리스트가 부르는데 ★정본에 없다   %d' % len(stray))
    for f in stray:
        print('      %s   ★정본에 없는 것을 출고 절차가 부르고 있다' % f)
    if not stray:
        print('      없음 (★이 줄이 부재의 증거다)')
    if stray:
        rc1.append('정본 밖 호출 %d건' % len(stray))

    print('')
    if rc2:
        return fail_indeterminate(' · '.join(rc2))
    if rc1:
        print('★미달 — ' + ' · '.join(rc1))
        return 1
    print('통과 · 게이트 %d종이 정본에서 파생되고 DEPLOY 체크리스트와 ★양방향으로 맞는다 '
          '(게임별 %d · 비게이트 %d 는 사유와 함께 선언돼 있다)'
          % (len(gate_files), len(game_files), len(non_files)))
    return 0


# ────────────────────────────────────────────────────────── 검출력 자기시험
def selftest(root):
    """★임시 사본에만 결함을 심는다. 붉어야 할 자리가 붉고, 조용해야 할 자리가 조용한가."""
    stage = tempfile.mkdtemp(prefix='gatereg-selftest-')
    try:
        d, err = load_gates(root)
        if err:
            return fail_indeterminate(err)
        # 사본 나무 — 선언된 파일은 ★빈 파일로 흉내낸다(이 검사기는 이름과 실재만 본다)
        os.makedirs(os.path.join(stage, 'tools'))
        shutil.copyfile(os.path.join(root, 'tools', 'gates.json'), os.path.join(stage, 'tools', 'gates.json'))
        shutil.copyfile(os.path.join(root, 'DEPLOY.md'), os.path.join(stage, 'DEPLOY.md'))
        for g in d['gates'] + d['per_game'] + d['non_gate_tools']:
            p = os.path.join(stage, g['file'].replace('/', os.sep))
            if not os.path.isdir(os.path.dirname(p)):
                os.makedirs(os.path.dirname(p))
            if not os.path.exists(p):
                io.open(p, 'w', encoding='utf-8').write('')
        me = os.path.abspath(__file__)

        def run_case(name, mutate, want):
            work = os.path.join(stage, name)
            shutil.copytree(stage, work, ignore=shutil.ignore_patterns('case-*'))
            note = mutate(work)
            p = subprocess.run([sys.executable, me, work], capture_output=True, text=True,
                               encoding='utf-8', errors='replace')
            ok = p.returncode == want
            print('  [%s] %s — %s (rc=%d · 기대 %d)%s'
                  % ('OK ' if ok else '★어긋남', name, note, p.returncode, want,
                     '' if ok else '\n' + (p.stdout or '')[-500:]))
            return ok

        def m_none(w):
            return '대조군 — 아무것도 안 심는다(★조용해야 한다)'

        def m_ghost(w):
            io.open(os.path.join(w, 'tools', 'check_ghost.py'), 'w', encoding='utf-8').write('')
            return '파일은 있는데 정본에 없다(★F4 가 숨어 있던 방향)'

        def m_del_file(w):
            victim = d['gates'][0]['file']
            os.remove(os.path.join(w, victim.replace('/', os.sep)))
            return '정본이 선언한 %s 가 사라졌다(목록 노후화 → 판정 불가)' % victim

        def m_del_deploy(w):
            victim = d['gates'][0]['file']
            p = os.path.join(w, 'DEPLOY.md')
            t = io.open(p, encoding='utf-8', newline='').read()
            out = [ln for ln in t.split('\n') if victim not in ln]
            io.open(p, 'w', encoding='utf-8', newline='').write('\n'.join(out))
            return '%s 가 DEPLOY 체크리스트에서 지워졌다' % victim

        def m_no_why(w):
            p = os.path.join(w, 'tools', 'gates.json')
            g = json.load(io.open(p, encoding='utf-8'))
            g['non_gate_tools'][0].pop('why', None)
            io.open(p, 'w', encoding='utf-8', newline='').write(json.dumps(g, ensure_ascii=False, indent=2))
            return '비게이트에서 ★사유가 사라졌다(사유 없는 강등)'

        print('검출력 자기시험 — 사례 5건(대조군 1 포함 · 임시 사본에만 심는다)')
        results = [
            run_case('case-quiet', m_none, 0),
            run_case('case-ghost-file', m_ghost, 1),
            run_case('case-missing-file', m_del_file, 2),
            run_case('case-deploy-unlisted', m_del_deploy, 1),
            run_case('case-nonwhy', m_no_why, 2),
        ]
        bad = results.count(False)
        print('')
        print('==== 자기시험 사례 %d건 · 어긋남 %d건 ====' % (len(results), bad))
        return 0 if bad == 0 else 1
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    flags = [a for a in argv if a.startswith('--')]
    unknown = [f for f in flags if f != '--selftest']
    if unknown or len(args) != 1:
        # ★잘못된 호출은 ★거부한다 — 검사 못 한 것을 통과로 세지 않는다
        print('★판정 불가 — 잘못된 호출: %r' % (argv,))
        print(USAGE)
        return 2
    root = os.path.abspath(args[0])
    if '--selftest' in flags:
        return selftest(root)
    return check(root)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
