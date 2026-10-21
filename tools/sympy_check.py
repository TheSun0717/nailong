# 符号验算：python tools/sympy_check.py '{"checks":[{"expr":"3**2+4**2","equals":"25","vars":{}}]}'
import sys
import json
import re

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SAFE = re.compile(r'^[0-9a-zA-Z_+\-*/^()., =]+$')
BANNED = ('__', 'import', 'lambda', 'open(', 'exec', 'eval', 'system')


def bad(expr):
    s = str(expr or '')
    return (not SAFE.match(s)) or any(b in s for b in BANNED)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'no input'}, ensure_ascii=False))
        return
    try:
        payload = json.loads(sys.argv[1])
        checks = payload.get('checks') or []
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
        return

    from sympy import sympify, simplify, N

    results = []
    for c in checks:
        expr = str(c.get('expr', '')).replace('^', '**')
        equals = str(c.get('equals', '0')).replace('^', '**')
        variables = c.get('vars') or {}
        item = {'expr': expr, 'equals': equals, 'ok': False}
        try:
            if bad(expr) or bad(equals):
                raise ValueError('unsafe expression')
            subs = {}
            for k, v in variables.items():
                subs[str(k)] = sympify(str(v).replace('^', '**'))
            left = sympify(expr).subs(subs)
            right = sympify(equals).subs(subs)
            diff = simplify(left - right)
            if diff == 0:
                item['ok'] = True
                item['value'] = str(N(left))
            else:
                try:
                    item['ok'] = abs(complex(N(diff))) < 1e-9
                except Exception:
                    item['ok'] = False
                item['diff'] = str(diff)
        except Exception as e:
            item['error'] = str(e)
        results.append(item)

    print(json.dumps({'ok': all(r['ok'] for r in results), 'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
