"""Verify trusted fixture expectations against independent small-input checks.

Run: python3 selfcheck.py
No network, credentials, audio, model requests, or generated-code execution.
"""

from collections import deque
from functools import lru_cache
from itertools import permutations, product
import json
from pathlib import Path
import random

from references import solve, validate


BASE = Path(__file__).resolve().parent
RNG = random.Random(20261020)
COUNTS = {}


def check(slug, args, expected):
    actual = solve(slug, args)
    assert validate(slug, args, actual, expected), (slug, args, actual, expected)
    COUNTS[slug] = COUNTS.get(slug, 0) + 1


def tap_subsets(n, ranges):
    best = len(ranges) + 1
    for mask in range(1 << len(ranges)):
        selected_count = bin(mask).count('1')
        if selected_count >= best:
            continue
        intervals = sorted((i - radius, i + radius) for i, radius in enumerate(ranges)
                           if mask & (1 << i))
        end = 0
        for left, right in intervals:
            if left > end:
                break
            end = max(end, right)
        if end >= n:
            best = selected_count
    return -1 if best > len(ranges) else best


def dish_permutations(values):
    # Enumerate raw orders of each length, with no sorting/exchange assumption.
    best = 0
    for length in range(1, len(values) + 1):
        for order in permutations(values, length):
            best = max(best, sum(time * value for time, value in enumerate(order, 1)))
    return best


def jump_paths(values, target):
    def visit(start):
        if start == len(values) - 1:
            return 0
        result = -1
        for end in range(start + 1, len(values)):
            if abs(values[start] - values[end]) <= target:
                suffix = visit(end)
                if suffix >= 0:
                    result = max(result, suffix + 1)
        return result
    return visit(0)


@lru_cache(None)
def delete_actions(state):
    # Simulate the exact deletion operation, including only one copy of x.
    if not state:
        return 0
    best = 0
    for value in set(state):
        remaining = list(state)
        remaining.remove(value)
        remaining = tuple(x for x in remaining if abs(x - value) != 1)
        best = max(best, value + delete_actions(remaining))
    return best


def balanced_partitions(s):
    best = 0
    for mask in range(1 << (len(s) - 1)):
        pieces = []
        start = 0
        for end in range(1, len(s)):
            if mask & (1 << (end - 1)):
                pieces.append(s[start:end])
                start = end
        pieces.append(s[start:])
        if all(piece.count('L') == piece.count('R') for piece in pieces):
            best = max(best, len(pieces))
    return best


def palindrome_subsets(s, k):
    # Pick/skip recursive interval search, using direct substring reversal,
    # rather than the reference's palindrome table and prefix DP.
    @lru_cache(None)
    def visit(start):
        if start == len(s):
            return 0
        best = visit(start + 1)
        for end in range(start + k, len(s) + 1):
            word = s[start:end]
            if word == word[::-1]:
                best = max(best, 1 + visit(end))
        return best
    return visit(0)


def serialize_tree(children):
    values = []
    queue = deque([0])
    while queue:
        node = queue.popleft()
        if node is None:
            values.append(None)
        else:
            values.append(node % 100 + 1)
            queue.extend(children[node])
    while values and values[-1] is None:
        values.pop()
    return values


def enumerate_tree_paths(children):
    best = 0
    for start in range(len(children)):
        for initial_side in (0, 1):
            node, side, count = start, initial_side, 0
            while children[node][side] is not None:
                node = children[node][side]
                count += 1
                side = 1 - side
            best = max(best, count)
    return best


def main():
    fixtures = [json.loads(path.read_text()) for path in (BASE.parents[1] / 'cases').glob('*.json')
                if json.loads(path.read_text()).get('slug') in {'minimum-number-of-taps-to-open-to-water-a-garden','pass-the-pillow','reducing-dishes','check-if-two-chessboard-squares-have-the-same-color','maximum-number-of-jumps-to-reach-the-last-index','delete-and-earn','split-a-string-in-balanced-strings','count-square-sum-triples','longest-zigzag-path-in-a-binary-tree','maximum-number-of-non-overlapping-palindrome-substrings'}]
    assert len(fixtures) == 10, "all owned fixtures must be present"
    fixture_count = 0
    for fixture in fixtures:
        assert len(fixture['statement']) <= 300
        assert len(fixture['cases']) >= 6
        names = set()
        for case in fixture['cases']:
            assert case['name'] not in names
            names.add(case['name'])
            assert len(case['args']) == len(fixture['python']['params'])
            check(fixture['slug'], case['args'], case['expected'])
            # Make sure type-confused booleans/integers fail exact validation.
            expected = case['expected']
            confused = int(expected) if isinstance(expected, bool) else bool(expected)
            assert not validate(fixture['slug'], case['args'], confused, expected)
            fixture_count += 1

    for _ in range(250):
        n = RNG.randint(1, 8)
        ranges = [RNG.randint(0, 4) for _ in range(n + 1)]
        check('minimum-number-of-taps-to-open-to-water-a-garden', [n, ranges], tap_subsets(n, ranges))

    for n in range(2, 13):
        for time in range(1, 101):
            phase = time % (2 * (n - 1))
            expected = 1 + min(phase, 2 * (n - 1) - phase)
            check('pass-the-pillow', [n, time], expected)

    for _ in range(150):
        values = [RNG.randint(-5, 5) for _ in range(RNG.randint(1, 7))]
        check('reducing-dishes', [values], dish_permutations(values))

    squares = [column + row for column, row in product('abcdefgh', '12345678')]
    for one, two in product(squares, repeat=2):
        delta = abs(ord(one[0]) - ord(two[0])) + abs(int(one[1]) - int(two[1]))
        check('check-if-two-chessboard-squares-have-the-same-color', [one, two], delta % 2 == 0)

    for _ in range(250):
        values = [RNG.randint(-7, 7) for _ in range(RNG.randint(2, 10))]
        target = RNG.randint(0, 14)
        check('maximum-number-of-jumps-to-reach-the-last-index', [values, target], jump_paths(values, target))

    for _ in range(250):
        values = [RNG.randint(1, 8) for _ in range(RNG.randint(1, 9))]
        check('delete-and-earn', [values], delete_actions(tuple(sorted(values))))

    for _ in range(150):
        half = RNG.randint(1, 6)
        chars = list('L' * half + 'R' * half)
        RNG.shuffle(chars)
        value = ''.join(chars)
        check('split-a-string-in-balanced-strings', [value], balanced_partitions(value))

    for n in range(1, 36):
        expected = sum(a * a + b * b == c * c
                       for a, b, c in product(range(1, n + 1), repeat=3))
        check('count-square-sum-triples', [n], expected)

    for _ in range(250):
        count = RNG.randint(1, 50)
        children = [[None, None] for _ in range(count)]
        slots = [(0, 0), (0, 1)]
        for node in range(1, count):
            slot_index = RNG.randrange(len(slots))
            parent, side = slots.pop(slot_index)
            children[parent][side] = node
            slots.extend([(node, 0), (node, 1)])
        check('longest-zigzag-path-in-a-binary-tree', [serialize_tree(children)], enumerate_tree_paths(children))

    for _ in range(350):
        value = ''.join(RNG.choice('abc') for _ in range(RNG.randint(1, 12)))
        k = RNG.randint(1, len(value))
        check('maximum-number-of-non-overlapping-palindrome-substrings', [value, k], palindrome_subsets(value, k))

    # Targeted upper-bound smoke checks, not model performance measurements.
    check('minimum-number-of-taps-to-open-to-water-a-garden', [10000, [1] * 10001], 5000)
    check('reducing-dishes', [[1000] * 500], 1000 * 500 * 501 // 2)
    check('maximum-number-of-jumps-to-reach-the-last-index', [[0] * 1000, 0], 999)
    check('delete-and-earn', [[10000] * 20000], 200000000)
    check('split-a-string-in-balanced-strings', ['LR' * 500], 500)
    count = 50000
    children = [[None, None] for _ in range(count)]
    for node in range(count - 1):
        children[node][node % 2] = node + 1
    check('longest-zigzag-path-in-a-binary-tree', [serialize_tree(children)], count - 1)
    check('maximum-number-of-non-overlapping-palindrome-substrings', ['a' * 2000, 2], 1000)

    report = {'seed': 20261020, 'fixtures': len(fixtures), 'authoredCases': fixture_count,
              'checksIncludingCases': sum(COUNTS.values()), 'perSlug': COUNTS,
              'limitations': ['No generated/model code executed.',
                              'Small-input exhaustive/random comparisons do not prove all inputs.',
                              'No ASR, screenshot OCR, transport, or model quality is exercised.']}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
