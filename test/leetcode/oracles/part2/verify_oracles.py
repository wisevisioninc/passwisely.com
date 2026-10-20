"""Cross-check references against independent small-input exhaustive oracles."""

from collections import Counter, deque
import itertools
import json
from math import inf
from pathlib import Path
import random

from references import solve, validate, _SOLVERS


rng = random.Random(20261020)
totals = Counter()


def floyd(n, edges, source, destination):
    dist = [[inf] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    for a, b, weight in edges:
        dist[a][b] = dist[b][a] = weight
    for middle in range(n):
        for a in range(n):
            for b in range(n):
                dist[a][b] = min(dist[a][b], dist[a][middle] + dist[middle][b])
    return dist[source][destination]


def feasible_brute(args):
    n, edges, source, destination, target = args
    unknown = [i for i, edge in enumerate(edges) if edge[2] == -1]
    trial = [edge[:] for edge in edges]
    # An unused edge can always be blocked with target+1. Any edge on a
    # target-length path has weight <= target, making this range complete.
    for weights in itertools.product(range(1, target + 2), repeat=len(unknown)):
        for i, weight in zip(unknown, weights):
            trial[i][2] = weight
        if floyd(n, trial, source, destination) == target:
            return True
    return False


for trial in range(100):
    n = rng.randint(2, 5)
    edges = [[i, rng.randrange(i), rng.randint(1, 6)] for i in range(1, n)]
    existing = {tuple(sorted(edge[:2])) for edge in edges}
    for a in range(n):
        for b in range(a + 1, n):
            if (a, b) not in existing and rng.random() < .3:
                edges.append([a, b, rng.randint(1, 6)])
    for index in rng.sample(range(len(edges)), rng.randint(0, min(3, len(edges)))):
        edges[index][2] = -1
    source, destination = rng.sample(range(n), 2)
    args = [n, edges, source, destination, rng.randint(1, 6)]
    answer = solve('modify-graph-edge-weights', args)
    assert bool(answer) == feasible_brute(args), args
    assert validate('modify-graph-edge-weights', args, answer, answer)
    totals['graph_random_exhaustive_assignments'] += 1


for n in range(1, 8):
    components = {}
    for k in range(n):
        parent = list(range(n))

        def find(a):
            while parent[a] != a:
                a = parent[a]
            return a

        for a in range(n):
            for b in range(a + 1, n):
                if a & b == k:
                    parent[find(a)] = find(b)
        components[k] = [find(a) for a in range(n)]
    for permutation in itertools.permutations(range(n)):
        if list(permutation) == list(range(n)):
            brute = 0
        else:
            brute = max(k for k, groups in components.items()
                        if all(groups[value] == groups[index] for index, value in enumerate(permutation)))
        assert solve('maximum-k-to-sort-a-permutation', [permutation]) == brute, permutation
        totals['permutations_exhaustive_through_n7'] += 1


def apple_brute(n, edges, apples):
    graph = [[] for _ in range(n)]
    for a, b in edges:
        graph[a].append(b)
        graph[b].append(a)
    target = sum(1 << i for i, value in enumerate(apples) if value)
    start = (0, (1 if apples[0] else 0))
    visited = {start}
    queue = deque([(start, 0)])
    while queue:
        (a, mask), steps = queue.popleft()
        if a == 0 and mask == target:
            return steps
        for b in graph[a]:
            state = (b, mask | ((1 << b) if apples[b] else 0))
            if state not in visited:
                visited.add(state)
                queue.append((state, steps + 1))


for _ in range(200):
    n = rng.randint(1, 9)
    edges = [[rng.randrange(i), i] for i in range(1, n)]
    apples = [bool(rng.getrandbits(1)) for _ in range(n)]
    assert solve('minimum-time-to-collect-all-apples-in-a-tree', [n, edges, apples]) == apple_brute(n, edges, apples)
    totals['apple_random_state_space_walks'] += 1


def balanced(s):
    balance = 0
    for char in s:
        balance += (char == '(') - (char == ')')
        if balance < 0:
            return False
    return balance == 0


for length in range(1, 8):
    for chars in itertools.product('()a', repeat=length):
        s = ''.join(chars)
        positions = [i for i, char in enumerate(s) if char in '()']
        possible = []
        for mask in range(1 << len(positions)):
            removed = {position for i, position in enumerate(positions) if mask & (1 << i)}
            candidate = ''.join(char for i, char in enumerate(s) if i not in removed)
            if balanced(candidate):
                possible.append(candidate)
        longest = max(map(len, possible))
        answer = solve('minimum-remove-to-make-valid-parentheses', [s])
        assert len(answer) == longest
        assert all(validate('minimum-remove-to-make-valid-parentheses', [s], candidate, answer)
                   == (len(candidate) == longest) for candidate in possible)
        totals['parentheses_exhaustive_through_length7'] += 1


def account_brute(accounts):
    pending = [(row[0], set(row[1:])) for row in accounts]
    result = []
    while pending:
        name, emails = pending.pop()
        changed = True
        while changed:
            changed = False
            for i in range(len(pending) - 1, -1, -1):
                if emails & pending[i][1]:
                    emails.update(pending.pop(i)[1])
                    changed = True
        result.append([name, *sorted(emails)])
    return sorted(result)


for _ in range(200):
    accounts = [['Test', *[f'{x}@a.co' for x in rng.choices(range(8), k=rng.randint(1, 5))]]
                for _ in range(rng.randint(1, 8))]
    assert solve('accounts-merge', [accounts]) == account_brute(accounts)
    totals['accounts_random_set_merging'] += 1


for n in range(1, 1001):
    bits = bin(n)[2:][::-1]
    assert solve('number-of-even-and-odd-bits', [n]) == [bits[::2].count('1'), bits[1::2].count('1')]
    totals['bit_count_all_valid_inputs'] += 1


for length in range(1, 11):
    for chars in itertools.product('ab', repeat=length):
        s = ''.join(chars)
        expected = all(i < j for i, a in enumerate(s) for j, b in enumerate(s) if a == 'a' and b == 'b')
        assert solve('check-if-all-as-appears-before-all-bs', [s]) == expected
        totals['ab_strings_exhaustive_through_length10'] += 1


for _ in range(300):
    bag = []
    nums, freq, expected = [], [], []
    for _ in range(rng.randint(1, 30)):
        value = rng.randint(1, 7)
        available = bag.count(value)
        change = -rng.randint(1, available) if available and rng.random() < .5 else rng.randint(1, 6)
        nums.append(value)
        freq.append(change)
        if change > 0:
            bag.extend([value] * change)
        else:
            for _ in range(-change):
                bag.remove(value)
        expected.append(max((bag.count(x) for x in set(bag)), default=0))
    assert solve('most-frequent-ids', [nums, freq]) == expected
    totals['frequencies_random_materialized_multiset'] += 1

nums = [1] * 21475
freq = [100000] * 21475
assert solve('most-frequent-ids', [nums, freq])[-1] == 2_147_500_000
totals['frequencies_64bit_stress'] += 1


for _ in range(300):
    n = rng.randint(1, 100)
    majority = rng.randint(-20, 20)
    nums = [majority] * (n // 2 + 1) + [rng.randint(-20, 20) for _ in range(n - n // 2 - 1)]
    rng.shuffle(nums)
    assert solve('majority-element', [nums]) == sorted(nums)[n // 2]
    totals['majority_random_median'] += 1


for _ in range(300):
    rows, columns = rng.randint(2, 6), rng.randint(2, 6)
    matrix = [[rng.randint(-1, 5) for _ in range(columns)] for _ in range(rows)]
    for column in range(columns):
        matrix[rng.randrange(rows)][column] = rng.randint(0, 5)
    result = [row[:] for row in matrix]
    for row in range(rows):
        for column in range(columns):
            if matrix[row][column] == -1:
                result[row][column] = sorted(matrix[i][column] for i in range(rows))[-1]
    assert solve('modify-the-matrix', [matrix]) == result
    totals['matrices_random_sorted_column_oracle'] += 1


# Validate that alternate solutions and malformed/incorrect outputs are handled.
slug = 'modify-graph-edge-weights'
args = [3, [[0, 1, -1], [1, 2, -1]], 0, 2, 6]
answer = solve(slug, args)
assert validate(slug, args, [[2, 1, 2], [1, 0, 4]], answer)
for invalid in ([], [[0, 1, 6]], [[0, 1, 0], [1, 2, 6]], [[0, 1, 2], [1, 2, 2]], [[0, 1, True], [1, 2, 5]]):
    assert not validate(slug, args, invalid, answer)
slug = 'minimum-remove-to-make-valid-parentheses'
args = ['(a(b)']
answer = solve(slug, args)
assert validate(slug, args, '(ab)', answer)
assert validate(slug, args, 'a(b)', answer)
for invalid in ('(ba)', 'ab', '(a)b)', '()()'):
    assert not validate(slug, args, invalid, answer)
slug = 'accounts-merge'
args = [[['A', 'a@a.co', 'z@a.co'], ['B', 'b@b.co']]]
answer = solve(slug, args)
assert validate(slug, args, answer[::-1], answer)
assert not validate(slug, args, [['A', 'z@a.co', 'a@a.co'], ['B', 'b@b.co']], answer)
assert not validate(slug, args, [['A', 'a@a.co', 'a@a.co', 'z@a.co'], ['B', 'b@b.co']], answer)
totals['validator_property_checks'] += 15


for path in (Path(__file__).resolve().parents[2] / 'cases').glob('*.json'):
    fixture = json.loads(path.read_text())
    if fixture['slug'] not in _SOLVERS: continue
    for case in fixture['cases']:
        expected = solve(fixture['slug'], case['args'])
        assert validate(fixture['slug'], case['args'], expected, case['expected'])
        totals['authored_fixture_cases'] += 1

print(json.dumps(dict(totals), indent=2))
assert totals['authored_fixture_cases'] == 80, 'all owned fixed cases must run'
