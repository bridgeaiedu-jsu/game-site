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

■ ★축이 넷이다 — ①선언 없는 분모 0 ②정본 노후화 ③부류 라벨 어긋남 ④★죽은 항(상수).
  ④가 없으면 ★옳게 라벨된 무의미한 항이 통과한다(2026-09-08 R8 · reviewer-claude-2 E1·E2 실증).

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


def group_proof(root, checks):
    """★군(群) 증명 — 판정식을 ★통째로 true 로 바꾸고 겨냥 변이를 다시 돌린다.

    한 항씩 지우는 방법은 ★상호 은폐(둘 다 무너져야 붉는 자리)를 원리적으로 못 본다.
    판정식 전체를 무르게 했을 때 겨냥이 rc=3(공허)로 바뀌면 ★그 항들이 함께 판정을 짊어진다 —
    수용해도 되는 상호 은폐다. 그래도 전부 rc=0 이면 판정을 짊어지는 것은 판정식이 아니라
    ★전제·예외 경로다 — 그 자리는 수용이 아니라 ★음성 대조군으로 박제해야 한다.

    반환: {검사이름: (verdict, detail)} · verdict ∈ {'jointly-bearing', 'vacuous', 'indeterminate'}
    """
    verify = os.path.join(root, 'tools', 'verify_quickmath.js')
    expect = os.path.join(root, 'tools', 'quickmath_mutation_expectations.json')
    src = io.open(verify, encoding='utf-8', newline='').read().replace(chr(13) + chr(10), chr(10))
    exp = json.load(io.open(expect, encoding='utf-8'))
    by_check = {}
    for name, m in exp['mutations'].items():
        if m.get('target'):
            by_check.setdefault(m['target'], []).append(name)
    starts = [(m.start(), m.group(1)) for m in re.finditer(r"^check\('([^']+)'", src, re.M)]
    stage = tempfile.mkdtemp(prefix='term-group-')
    out = {}
    try:
        for i, (pos, name) in enumerate(starts):
            if name not in checks:
                continue
            end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
            body = src[pos:end]
            expr = judgement_expr(body)
            muts = by_check.get(name, [])
            if expr is None or not muts:
                out[name] = ('indeterminate', '판정식 또는 겨냥 변이가 없다')
                continue
            # ★치환은 ★그 검사의 body 안에서만 한다 — 파일 전체 replace 는 같은 문구가 앞에
            #   있으면 ★남의 검사를 친다(첫 매치만 바꾸기 때문이다).
            if body.count(expr) != 1:
                out[name] = ('indeterminate', '판정식이 body 안에서 %d회 — 앵커가 유일하지 않다' % body.count(expr))
                continue
            v = src[:pos] + body.replace(expr, ' true ', 1) + src[end:]
            path_ = os.path.join(stage, 'g_%d.js' % i)
            io.open(path_, 'w', encoding='utf-8', newline='').write(v)
            base = subprocess.run(['node', path_, '--repo', root], cwd=root,
                                  capture_output=True, text=True, encoding='utf-8', errors='replace')
            if base.returncode != 0:
                out[name] = ('indeterminate', '판정식을 true 로 바꾸니 무변이 기준선이 rc=%d' % base.returncode)
                continue
            verdicts = []
            for mu in muts:
                r = subprocess.run(['node', path_, '--repo', root, '--mutate', mu], cwd=root,
                                   capture_output=True, text=True, encoding='utf-8', errors='replace')
                verdicts.append((mu, r.returncode))
            detail = ', '.join('%s rc=%d' % x for x in verdicts)
            if any(rc == 3 for _, rc in verdicts):
                out[name] = ('jointly-bearing', detail)
            elif all(rc == 0 for _, rc in verdicts):
                out[name] = ('vacuous', detail)
            else:
                out[name] = ('indeterminate', detail)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return out


def constant_terms(terms):
    """★비공허 관문 — 항을 ★빈 스코프에서 평가해 본다(2026-09-08 R8 Q4 · reviewer-claude-2).

    · 값이 나온다 = 그 항은 ★제품·세계의 무엇도 안 본다 = ★아무것도 주장하지 않는 죽은 항.
    · ReferenceError 가 난다 = 무엇인가를 본다 = 통과.

    ★왜 이 형태인가(처방 문면을 그대로 안 쓴 이유를 여기 남긴다):
      master·264 가 준 문면은 "그 항을 false 로 뒤집으면 무변이 기준선이 붉어야 한다" 였다.
      ★실측하니 그 시험은 죽은 항을 ★못 잡는다 — 판정식은 && 사슬이라 ★어느 항을 false 로
      바꿔도 전체가 거짓이 되어 기준선이 붉는다(죽은 항 (1===1)·(2>1) 둘 다 rc=1 로 '통과').
      증거: evidence/hanpango-mental-math/R8FIX/probe_prescription_literal.txt
      그래서 ★같은 의도("이 항이 무언가에 기여하는가")를 ★가르는 힘이 있는 형태로 세운다.

    ★이 관문의 사정거리(정직하게): ★상수 항만 잡는다. 상태를 참조하면서도 늘 참인 항
    (k.score === k.score 같은 것)은 ★못 본다 — 그 축은 여전히 열려 있다.
    """
    js = ('const T=' + json.dumps(list(terms), ensure_ascii=False) + ';' + chr(10) +
          'for (const t of T){ let v; try { const r = Function(\'"use strict"; return (\' + t + \');\')();'
          ' v = "CONST:" + String(r); } catch (e) { v = "STATEFUL"; }'
          ' console.log(v + "\\t" + t); }')
    p = subprocess.run(['node', '-e', js], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        return None, '상수 항 판별기를 못 돌렸다(rc=%d): %s' % (p.returncode, (p.stderr or '')[:200])
    out = {}
    for ln in (p.stdout or '').splitlines():
        if '\t' not in ln:
            continue
        v, t = ln.split('\t', 1)
        out[t] = v
    missing = [t for t in terms if t not in out]
    if missing:
        return None, '판별기가 항 %d개를 안 돌려줬다 — 못 잰 것은 통과가 아니다' % len(missing)
    return out, None


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
    CLASSES = ('sibling', 'mutually-masked', 'negative-control')
    for it in items:
        if not isinstance(it, dict) or not it.get('check') or not it.get('term') or not it.get('why'):
            return None, 'accepted_zero_terms 항목은 {check, term, why} 여야 한다 — 사유 없는 수용을 막는다: %r' % (it,)
        # ★class 를 요구하는 이유(2026-09-08 R7 · reviewer-claude-2 B1): 한 낱말('분모 0')이
        #   ★두 병을 덮으면 읽는 사람이 상호 은폐를 '중복 관측' 으로 읽고 안심한다.
        #   그리고 이 라벨은 ★실측이 벌어야 한다 — 아래에서 부류마다 다른 증명을 요구한다.
        if it.get('class') not in CLASSES:
            return None, ("accepted_zero_terms 항목에 class 가 없거나 모른다(%r) — %s 중 하나여야 한다: %r"
                          % (it.get('class'), ' · '.join(CLASSES), (it.get('check'), it.get('term'))))
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

    # ── ★부류 대조 (R7 B1) — class 를 실측이 벌게 한다 ─────────────────────
    borne_checks = {r[0] for r in borne}
    zero_checks = {r[0] for r in zero}
    masked_checks = sorted(zero_checks - borne_checks)   # 짊어지는 항이 ★하나도 없는 검사
    gproof = group_proof(root, set(masked_checks)) if masked_checks else {}
    cls = {(it['check'], ' '.join(it['term'].split())): it.get('class') for it in canon['accepted_zero_terms']}
    mislabeled = []
    for (c, t), k in sorted(cls.items()):
        if (c, t) not in seen_zero:
            continue                      # 노후화는 아래 ②가 잡는다
        masked = c in masked_checks
        g = gproof.get(c, ('n/a', ''))[0]
        if k == 'sibling' and masked:
            mislabeled.append((c, t, k, '★형제라 적었는데 이 검사에는 짊어지는 항이 하나도 없다(상호 은폐다)'))
        elif k == 'mutually-masked' and not masked:
            mislabeled.append((c, t, k, '★상호 은폐라 적었는데 이 검사에는 짊어지는 항이 있다(형제다)'))
        elif k == 'mutually-masked' and g != 'jointly-bearing':
            mislabeled.append((c, t, k, '★군 증명이 %s — 함께 짊어진다는 증거가 없다(%s)' % (g, gproof.get(c, ('', ''))[1])))
        elif k == 'negative-control' and g != 'vacuous':
            mislabeled.append((c, t, k, '★음성 대조군이라 적었는데 군 증명이 %s 다 — 박제할 자리가 아니다' % g))

    print('★상호 은폐 검사 %d종(짊어지는 항이 하나도 없는 검사) — 군 증명 결과:' % len(masked_checks))
    if not masked_checks:
        print('      없음 (★이 줄이 부재의 증거다)')
    for c in masked_checks:
        g, detail = gproof.get(c, ('n/a', ''))
        mark = {'jointly-bearing': '함께 짊어진다(수용 가능)',
                'vacuous': '★판정식이 공허하다 — 음성 대조군으로 박제하라',
                'indeterminate': '★판정 불가'}.get(g, g)
        print('      %s\t%s\t%s' % (c, mark, detail))
    print('')

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

    # ── ★④ 비공허 관문 (R8 Q4) — 라벨 축은 '이야기와 실측이 맞는가'만 묻는다.
    #    '이 항이 무언가에 기여하는가' 는 어느 라벨도 안 묻는다(264 의 E1·E2 실증).
    zterms = sorted({' '.join(r[2].split()) for r in zero})
    consts, cerr2 = constant_terms(zterms) if zterms else ({}, None)
    if cerr2:
        print('★판정 불가 — ' + cerr2)
        return 2
    dead = sorted([(c, t) for c, t in seen_zero if consts.get(t, '').startswith('CONST')])

    print('  ③ ★부류 라벨이 실측과 어긋난 항        %d' % len(mislabeled))
    for c, t, k, why in mislabeled:
        print('      %s / %s  class=%s  %s' % (c, t, k, why))
    if not mislabeled:
        print('      없음 (★이 줄이 부재의 증거다)')
    print('  ④ ★아무것도 주장하지 않는 죽은 항      %d  (빈 스코프에서 값이 나오는 항 — 상수)' % len(dead))
    for c, t in dead:
        print('      %s / %s   ★%s — 제품을 하나도 안 본다. 분모를 늘려 비율만 좋아 보이게 한다'
              % (c, t, consts.get(t)))
    if not dead:
        print('      없음 (★이 줄이 부재의 증거다 — 잰 항 %d개 전부 제품·세계를 참조한다)' % len(zterms))
    n_masked = len([1 for (c, t), k in cls.items() if k == 'mutually-masked' and (c, t) in seen_zero])
    n_neg = len([1 for (c, t), k in cls.items() if k == 'negative-control' and (c, t) in seen_zero])
    n_sib = len([1 for (c, t), k in cls.items() if k == 'sibling' and (c, t) in seen_zero])
    print('')
    print('★부류 내역 — 형제 %d항 · 상호 은폐 %d항(군 증명으로 함께 짊어짐 확인) · 음성 대조군 %d항'
          % (n_sib, n_masked, n_neg))
    print('  ★상호 은폐는 ★수용이 아니라 ★미결로 센다 — 한 항씩으로는 못 재는 자리다')
    print('')

    if indet:
        print('★판정 불가 %d항 — 못 쟀으면 통과로 세지 않는다' % len(indet))
        return 2
    bad_g = [c for c in masked_checks if gproof.get(c, ('indeterminate', ''))[0] == 'indeterminate']
    if bad_g:
        print('★판정 불가 — 군 증명을 못 세운 검사 %d종: %s' % (len(bad_g), ', '.join(bad_g)))
        return 2
    if dead:
        print('★미달 — 죽은 항 %d개(라벨이 맞아도 통과시키지 않는다 — 분모에 뜻 없는 항을 더하면 아무도 모른다)'
              % len(dead))
        return 1
    if mislabeled:
        print('★미달 — 부류 라벨이 실측과 어긋난 항 %d개(이름이 틀리면 다음 사람이 안심한다)' % len(mislabeled))
        return 1
    if stale:
        print('★판정 불가 — 정본 선언이 실측과 갈렸다(노후화)')
        return 2
    if undeclared:
        print('★미달 — 선언 없는 분모 0 항 %d개' % len(undeclared))
        return 1
    print('통과 · 분모 0 항 %d개가 전부 사유·부류와 함께 선언돼 있고, 판정을 짊어지는 단언은 %d / %d 다'
          % (len(seen_zero), len(borne), len(judged)))
    print('       (그 중 상호 은폐 %d항은 ★군 증명으로만 비공허성이 서 있다 — 미결로 센다)' % n_masked)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
