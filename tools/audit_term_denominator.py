# -*- coding: utf-8 -*-
"""F8 후속 — 「단언 2개 이상」 검사의 ★각 항이 실제로 분모를 갖는가를 기계로 잰다.

방법(F3-b 에서 통한 것과 같다): 판정식에서 ★항 하나만 지운 검사기 사본을 만들고,
그 검사를 겨냥한 뮤테이션을 다시 돌린다.
  · 지웠는데도 그 뮤테이션이 여전히 잡힌다  → 그 항은 ★아무 변이도 기대지 않는다(분모 0 후보)
  · 지우니 그 뮤테이션이 rc=3(공허)로 바뀐다 → 그 항이 판정을 ★짊어지고 있다(측정됨)
  · 무변이 기준선이 깨지거나 rc=2            → ★판정 불가(항을 지운 것이 문법·전제를 깼다)

★대상 나무는 안 건드린다 — 사본은 임시 폴더에만 만든다.
사용: python3 audit_term_denominator.py <저장소 루트> [--only <검사 이름 조각>]
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

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
ONLY = None
if '--only' in sys.argv:
    ONLY = sys.argv[sys.argv.index('--only') + 1]

VERIFY = os.path.join(ROOT, 'tools', 'verify_quickmath.js')
EXPECT = os.path.join(ROOT, 'tools', 'quickmath_mutation_expectations.json')

spec = importlib.util.spec_from_file_location('runner', os.path.join(ROOT, 'tools', 'run_mutations_quickmath.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

src = io.open(VERIFY, encoding='utf-8', newline='').read().replace('\r\n', '\n')
exp = json.load(io.open(EXPECT, encoding='utf-8'))
by_check = {}
for name, m in exp['mutations'].items():
    if m.get('target'):
        by_check.setdefault(m['target'], []).append(name)

sweep, err = runner.assertion_sweep(VERIFY)
if err:
    sys.exit('판정 불가 — ' + err)


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
    """그 검사의 ★판정식(항이 가장 많은 ok: 표현식) 원문을 돌려준다."""
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


starts = [(m.start(), m.group(1)) for m in re.finditer(r"^check\('([^']+)'", src, re.M)]
stage = tempfile.mkdtemp(prefix='term-denom-')
rows = []
try:
    for i, (pos, name) in enumerate(starts):
        if sweep.get(name, 0) < 2:
            continue
        if ONLY and ONLY not in name:
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
            variant_expr = ' && '.join(rest)
            v = src.replace(expr, ' ' + variant_expr + ' ', 1)
            if v == src:
                rows.append((name, k, terms[k], '★판정 불가(치환 실패)'))
                continue
            path_ = os.path.join(stage, 'v_%d_%d.js' % (i, k))
            io.open(path_, 'w', encoding='utf-8', newline='').write(v)
            base = subprocess.run(['node', path_, '--repo', ROOT], cwd=ROOT,
                                  capture_output=True, text=True, encoding='utf-8', errors='replace')
            if base.returncode != 0:
                rows.append((name, k, terms[k], '★판정 불가(항을 지우니 무변이 기준선이 rc=%d)' % base.returncode))
                continue
            verdicts = []
            for mu in muts:
                r = subprocess.run(['node', path_, '--repo', ROOT, '--mutate', mu], cwd=ROOT,
                                   capture_output=True, text=True, encoding='utf-8', errors='replace')
                verdicts.append((mu, r.returncode))
            if all(rc == 0 for _, rc in verdicts):
                v_txt = '★분모 0 후보 — 지워도 겨냥이 전부 잡힌다(%s)' % ', '.join('%s rc=%d' % x for x in verdicts)
            elif any(rc == 3 for _, rc in verdicts):
                v_txt = '측정됨 — 지우니 공허가 난다(%s)' % ', '.join('%s rc=%d' % x for x in verdicts)
            else:
                v_txt = '★판정 불가(%s)' % ', '.join('%s rc=%d' % x for x in verdicts)
            rows.append((name, k, terms[k], v_txt))
finally:
    shutil.rmtree(stage, ignore_errors=True)

multi = [n for n, t in sweep.items() if t >= 2]
print('검사 %d종 · 단언2+ %d종 · 이번에 판 항 %d개 (분모를 먼저 찍는다)'
      % (len(sweep), len(multi), len([r for r in rows if r[1] >= 0])))
print('')
zero = [r for r in rows if r[3].startswith('★분모 0')]
indet = [r for r in rows if r[3].startswith('★판정 불가')]
for name, k, term, verdict in rows:
    print('%s\t항%s\t%s\t%s' % (name, k if k >= 0 else '-', ' '.join(term.split())[:70], verdict))
print('')
print('==== 판 항 %d개 · ★분모 0 후보 %d · 판정 불가 %d · 측정됨 %d ===='
      % (len([r for r in rows if r[1] >= 0]), len(zero), len(indet),
         len(rows) - len(zero) - len(indet)))
for r in zero:
    print('  ★분모 0 후보: %s 항%d — %s' % (r[0], r[1], ' '.join(r[2].split())[:80]))
if not zero:
    print('  ★분모 0 후보 없음(이 줄이 부재의 증거다)')
