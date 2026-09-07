#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit_term_denominator.py — 「단언이 둘 이상인 검사」의 ★각 항이 실제로 분모를 갖는가.

■ 무엇을 재나 (계약 한 문장)
  판정식에서 ★항 하나만 지운 검사기 사본을 만들고 그 검사를 겨냥한 뮤테이션을 다시 돌린다.
    · 지웠는데도 겨냥이 여전히 잡힌다  → 그 항은 ★아무 변이도 기대지 않는다(분모 0)
    · 지우니 겨냥이 rc=3(공허)로 바뀐다 → 그 항이 판정을 ★짊어진다(측정됨)
    · 무변이 기준선이 깨지거나 rc=2     → ★판정 불가(항을 지운 것이 문법·전제를 깼다)

■ ★rc 로 판정한다 (2026-09-08 R6 B1)
  앞서는 세어 보이기만 하고 늘 rc=0 이었다 — 46 이 46 으로 남아도 아무도 안 멈췄다.
  이제 ★분모 0 인 항은 전부 정본(`tools/quickmath_term_denominator_canon.json`)에
  ★{check, term, why} 로 선언돼 있어야 한다. 선언 없이 새로 생기면 ★rc=1 이다.
  선언은 해 두고 그 항이 이제 판정을 짊어지거나(측정됨) 항 자체가 사라지면 ★rc=2(정본 노후화)다.
  ★why 를 요구하는 이유: 분모 0 자체는 대개 ★중복 관측(같은 결함이 형제 항을 함께 무너뜨림)이라
  결함이 아니다. 그러나 ★사유를 적게 만들면 '결함인데 그냥 둔 것' 이 조용히 섞일 수 없다.

■ 종료코드: 0 = 선언과 실측이 맞는다 · 1 = ★선언 없는 분모 0 항이 있다 ·
  2 = ★판정 불가(정본을 못 읽음 · 선언 노후화 · 항을 지운 사본이 안 선다 · 잘못된 호출)

■ 사용법: python3 tools/audit_term_denominator.py <저장소 루트> [--only <검사 이름 조각>]
  (느리다 — 항마다 검사기를 다시 돌린다)
"""
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


def top_split(expr):
    """최상위 && 로 가른다(괄호 안은 안 가른다)."""
    parts, depth, buf, j = [], 0, [], 0
    while j < len(expr):
        c = expr[j]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        if depth == 0 and expr[j:j + 2] == '&&':
            parts.append(''.join(buf).strip())
            buf = []
            j += 2
            continue
        buf.append(c)
        j += 1
    parts.append(''.join(buf).strip())
    return [p for p in parts if p]


def judgement_expr(body):
    """그 검사의 ★판정식(항이 가장 많은 ok: 표현식) 원문."""
    best = None
    for m in re.finditer(r'\bok:\s*', body):
        j, depth, buf = m.end(), 0, []
        while j < len(body):
            c = body[j]
            if c in '([{':
                depth += 1
            elif c in ')]}':
                if depth == 0:
                    break
                depth -= 1
            elif c == ',' and depth == 0:
                break
            buf.append(c)
            j += 1
        e = ''.join(buf)
        if e.strip() in ('false', 'true'):
            continue
        if best is None or len(top_split(e)) > len(top_split(best)):
            best = e
    return best


def measure_rows(root, only=None):
    """(rows, sweep, err) — rows 는 (검사, 항번호, 항 원문, 판정문)."""
    verify = os.path.join(root, 'tools', 'verify_quickmath.js')
    expect = os.path.join(root, 'tools', 'quickmath_mutation_expectations.json')
    spec = importlib.util.spec_from_file_location('runner', os.path.join(root, 'tools', 'run_mutations_quickmath.py'))
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    src = io.open(verify, encoding='utf-8', newline='').read().replace('\r\n', '\n')
    exp = json.load(io.open(expect, encoding='utf-8'))
    by_check = {}
    for name, m in exp['mutations'].items():
        if m.get('target'):
            by_check.setdefault(m['target'], []).append(name)
    sweep, err = runner.assertion_sweep(verify)
    if err:
        return None, None, err
    starts = [(m.start(), m.group(1)) for m in re.finditer(r"^check\('([^']+)'", src, re.M)]
    stage = tempfile.mkdtemp(prefix='term-denom-')
    rows = []
    try:
        for i, (pos, name) in enumerate(starts):
            if sweep.get(name, 0) < 2:
                continue
            if only and only not in name:
                continue
            end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
            body = src[pos:end]
            expr = judgement_expr(body)
            if expr is None:
                rows.append((name, -1, '(판정식을 못 찾았다)', '★판정 불가'))
                continue
            terms = top_split(expr)
            muts = by_check.get(name, [])
            if not muts:
                rows.append((name, -1, '(겨냥 뮤테이션 없음)', '★판정 불가'))
                continue
            for k in range(len(terms)):
                rest = [t for j2, t in enumerate(terms) if j2 != k]
                v = src.replace(expr, ' ' + ' && '.join(rest) + ' ', 1)
                if v == src:
                    rows.append((name, k, terms[k], '★판정 불가(치환 실패)'))
                    continue
                path_ = os.path.join(stage, 'v_%d_%d.js' % (i, k))
                io.open(path_, 'w', encoding='utf-8', newline='').write(v)
                base = subprocess.run(['node', path_, '--repo', root], cwd=root,
                                      capture_output=True, text=True, encoding='utf-8', errors='replace')
                if base.returncode != 0:
                    rows.append((name, k, terms[k], '★판정 불가(항을 지우니 무변이 기준선이 rc=%d)' % base.returncode))
                    continue
                verdicts = []
                for mu in muts:
                    r = subprocess.run(['node', path_, '--repo', root, '--mutate', mu], cwd=root,
                                       capture_output=True, text=True, encoding='utf-8', errors='replace')
                    verdicts.append((mu, r.returncode))
                detail = ', '.join('%s rc=%d' % x for x in verdicts)
                if all(rc == 0 for _, rc in verdicts):
                    v_txt = '★분모 0 — 지워도 겨냥이 전부 잡힌다(%s)' % detail
                elif any(rc == 3 for _, rc in verdicts):
                    v_txt = '측정됨 — 지우니 공허가 난다(%s)' % detail
                else:
                    v_txt = '★판정 불가(%s)' % detail
                rows.append((name, k, terms[k], v_txt))
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return rows, sweep, None


def load_canon(root):
    p = os.path.join(root, 'tools', 'quickmath_term_denominator_canon.json')
    try:
        with io.open(p, encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        return None, '정본을 못 읽었다(%s): %s' % (p, e)
    items = d.get('accepted_zero_terms')
    if not isinstance(items, list):
        return None, '정본에 accepted_zero_terms 배열이 없다 — 대조할 것이 없다'
    for it in items:
        if not isinstance(it, dict) or not it.get('check') or not it.get('term') or not it.get('why'):
            return None, 'accepted_zero_terms 항목은 {check, term, why} 여야 한다 — 사유 없는 수용을 막는다: %r' % (it,)
    return d, None


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    only = None
    if '--only' in argv:
        i = argv.index('--only')
        only = argv[i + 1] if i + 1 < len(argv) else None
        args = [a for a in args if a != only]
    unknown = [a for a in argv if a.startswith('--') and a != '--only']
    if unknown or len(args) != 1:
        print('★판정 불가 — 잘못된 호출: %r' % (argv,))
        print('사용법: python3 tools/audit_term_denominator.py <저장소 루트> [--only <검사 이름 조각>]')
        return 2
    root = os.path.abspath(args[0])
    canon, cerr = load_canon(root)
    if cerr:
        print('★판정 불가 — ' + cerr)
        return 2
    rows, sweep, err = measure_rows(root, only)
    if err:
        print('★판정 불가 — ' + err)
        return 2

    multi = [n for n, t in sweep.items() if t >= 2]
    judged = [r for r in rows if r[1] >= 0]
    zero = [r for r in judged if r[3].startswith('★분모 0')]
    indet = [r for r in rows if r[3].startswith('★판정 불가')]
    borne = [r for r in judged if r[3].startswith('측정됨')]

    print('검사 %d종 · 단언2+ %d종 · 이번에 판 항 %d개 (분모를 먼저 찍는다)'
          % (len(sweep), len(multi), len(judged)))
    print('★판정을 짊어지는 단언 %d / %d — 겉수치(검사 %d종)와 함께 이 수를 적어라'
          % (len(borne), len(judged), len(sweep)))
    print('')
    for name, k, term, verdict in rows:
        print('%s\t항%s\t%s\t%s' % (name, k if k >= 0 else '-', ' '.join(term.split())[:70], verdict))
    print('')

    declared = {(it['check'], ' '.join(it['term'].split())): it['why'] for it in canon['accepted_zero_terms']}
    seen_zero = {(r[0], ' '.join(r[2].split())) for r in zero}
    undeclared = sorted(k for k in seen_zero if k not in declared)
    stale = sorted(k for k in declared if k not in seen_zero)

    print('★분모 0 항 %d개 · 정본 선언 %d개' % (len(seen_zero), len(declared)))
    print('  ① 선언 없는 분모 0 항        %d' % len(undeclared))
    for c, t in undeclared:
        print('      %s / %s   ★정본에 {check, term, why} 로 선언하든지, 그 항을 겨냥하는 변이를 세워라' % (c, t))
    if not undeclared:
        print('      없음 (★이 줄이 부재의 증거다)')
    print('  ② 선언인데 지금은 분모 0 이 아니다(노후화)  %d' % len(stale))
    for c, t in stale:
        print('      %s / %s   ★정본에서 빼라(측정됨으로 바뀌었거나 항이 사라졌다)' % (c, t))
    if not stale:
        print('      없음 (★이 줄이 부재의 증거다)')
    print('')

    if indet:
        print('★판정 불가 %d항 — 못 쟀으면 통과로 세지 않는다' % len(indet))
        return 2
    if stale:
        print('★판정 불가 — 정본 선언이 실측과 갈렸다(노후화)')
        return 2
    if undeclared:
        print('★미달 — 선언 없는 분모 0 항 %d개' % len(undeclared))
        return 1
    print('통과 · 분모 0 항 %d개가 전부 사유와 함께 선언돼 있고, 판정을 짊어지는 단언은 %d / %d 다'
          % (len(seen_zero), len(borne), len(judged)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
