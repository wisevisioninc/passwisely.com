"""Expand compact, trusted boundary descriptors without executing model code.

``generate_case(spec)`` returns {name, args, expected, kind} for one descriptor.
``load_cases(path=None)`` returns those cases augmented with their fixture slugs.
Binary trees use LeetCode's compact level-order null encoding, not heap indices.
"""

from copy import deepcopy
import json
from pathlib import Path


def generate_case(spec):
    generator = spec['generator']
    kind = generator['type']
    if kind == 'literal':
        args = deepcopy(generator['args'])
    elif kind == 'alternating-binary-chain':
        nodes = generator['nodes']
        value = generator.get('value', 1)
        if type(nodes) is not int or not 1 <= nodes <= 50000:
            raise ValueError('binary chain nodes must be an integer in [1,50000]')
        if type(value) is not int or not 1 <= value <= 100:
            raise ValueError('binary chain values must be an integer in [1,100]')
        first = generator.get('firstDirection', 'left')
        if first not in ('left', 'right'):
            raise ValueError('firstDirection must be left or right')
        values = [value]
        for parent in range(nodes - 1):
            goes_left = (parent % 2 == 0) == (first == 'left')
            values.extend([value, None] if goes_left else [None, value])
        while values and values[-1] is None:
            values.pop()
        args = [values]
    elif kind == 'apple-chain':
        nodes = generator['nodes']
        if type(nodes) is not int or not 1 <= nodes <= 100000:
            raise ValueError('apple chain nodes must be an integer in [1,100000]')
        if generator.get('appleAt') != 'last':
            raise ValueError('apple-chain supports appleAt=last only')
        edges = [[node, node + 1] for node in range(nodes - 1)]
        has_apple = [False] * nodes
        has_apple[-1] = True
        args = [nodes, edges, has_apple]
    else:
        raise ValueError('unknown boundary generator: ' + str(kind))
    return {'name': spec['name'], 'args': args,
            'expected': deepcopy(spec['expected']), 'kind': spec['kind']}


def load_cases(path=None):
    path = Path(path) if path is not None else Path(__file__).resolve().parents[1] / 'boundary-regressions.json'
    manifest = json.loads(path.read_text())
    if manifest.get('schemaVersion') != 1:
        raise ValueError('unsupported boundary manifest schema')
    names = set()
    cases = []
    for spec in manifest['cases']:
        identity = (spec['slug'], spec['name'])
        if identity in names:
            raise ValueError('duplicate boundary case')
        names.add(identity)
        cases.append({'slug': spec['slug'], **generate_case(spec)})
    return cases
