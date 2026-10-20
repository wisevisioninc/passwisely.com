"""Independent, deterministic oracles for the second ten benchmark tasks.

All references accept JSON-compatible arguments and do not mutate them.
Graph-edge and parenthesis answers use property validation; account output allows
an arbitrary outer order while requiring each account's emails to be sorted.
These are correctness oracles, not performance benchmarks of optimal solutions.
"""

from collections import Counter, defaultdict, deque
from heapq import heappop, heappush
from math import inf


def _distance(n, edges, source, destination):
    graph = [[] for _ in range(n)]
    for a, b, w in edges:
        if w < 0:
            continue
        graph[a].append((b, w))
        graph[b].append((a, w))
    distance = [inf] * n
    distance[source] = 0
    pending = [(0, source)]
    while pending:
        current, a = heappop(pending)
        if current != distance[a]:
            continue
        if a == destination:
            return current
        for b, w in graph[a]:
            candidate = current + w
            if candidate < distance[b]:
                distance[b] = candidate
                heappush(pending, (candidate, b))
    return distance[destination]


def _modified_edges(n, original, source, destination, target):
    edges = [edge[:] for edge in original]
    current = _distance(n, edges, source, destination)
    if current < target:
        return []
    finished = current == target
    for edge in edges:
        if edge[2] != -1:
            continue
        if finished:
            edge[2] = 2_000_000_000
            continue
        edge[2] = 1
        current = _distance(n, edges, source, destination)
        if current <= target:
            edge[2] += target - current
            finished = True
    return edges if finished else []


def _sort_permutation(nums):
    misplaced = [value for index, value in enumerate(nums) if index != value]
    if not misplaced:
        return 0
    result = misplaced[0]
    for value in misplaced[1:]:
        result &= value
    return result


def _min_apple_time(n, edges, has_apple):
    graph = [[] for _ in range(n)]
    for a, b in edges:
        graph[a].append(b)
        graph[b].append(a)
    parent = [-1] * n
    parent[0] = 0
    queue = deque([0])
    while queue:
        a = queue.popleft()
        for b in graph[a]:
            if parent[b] == -1:
                parent[b] = a
                queue.append(b)
    used = set()
    for a, apple in enumerate(has_apple):
        if apple:
            while a != 0 and a not in used:
                used.add(a)
                a = parent[a]
    return 2 * len(used)


def _remove_parentheses(s):
    opening = []
    remove = set()
    for index, char in enumerate(s):
        if char == '(':
            opening.append(index)
        elif char == ')':
            if opening:
                opening.pop()
            else:
                remove.add(index)
    remove.update(opening)
    return ''.join(char for index, char in enumerate(s) if index not in remove)


def _merge_accounts(accounts):
    graph = defaultdict(set)
    names = {}
    for name, *emails in accounts:
        for email in emails:
            names[email] = name
            graph[email].add(emails[0])
            graph[emails[0]].add(email)
    seen = set()
    result = []
    for email in sorted(graph):
        if email in seen:
            continue
        component = []
        pending = [email]
        seen.add(email)
        while pending:
            current = pending.pop()
            component.append(current)
            for neighbor in graph[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    pending.append(neighbor)
        result.append([names[email], *sorted(component)])
    return sorted(result)


def _even_odd(n):
    result = [0, 0]
    index = 0
    while n:
        result[index % 2] += n & 1
        n >>= 1
        index += 1
    return result


def _most_frequent(nums, freq):
    counts = Counter()
    answer = []
    for value, change in zip(nums, freq):
        counts[value] += change
        answer.append(max(counts.values(), default=0))
    return answer


def _matrix(matrix):
    maxima = [max(column) for column in zip(*matrix)]
    return [[maxima[j] if value == -1 else value
             for j, value in enumerate(row)] for row in matrix]


_SOLVERS = {
    'modify-graph-edge-weights': _modified_edges,
    'maximum-k-to-sort-a-permutation': _sort_permutation,
    'minimum-time-to-collect-all-apples-in-a-tree': _min_apple_time,
    'minimum-remove-to-make-valid-parentheses': _remove_parentheses,
    'accounts-merge': _merge_accounts,
    'number-of-even-and-odd-bits': _even_odd,
    'check-if-all-as-appears-before-all-bs': lambda s: 'ba' not in s,
    'most-frequent-ids': _most_frequent,
    'majority-element': lambda nums: Counter(nums).most_common(1)[0][0],
    'modify-the-matrix': _matrix,
}


def solve(slug, args):
    return _SOLVERS[slug](*args)


def validate(slug, args, actual, expected):
    """Return bool, accepting valid alternate answers without running model code."""
    if slug == 'modify-graph-edge-weights':
        if actual == []:
            return expected == []
        n, original, source, destination, target = args
        if not isinstance(actual, list) or len(actual) != len(original):
            return False
        remaining = {tuple(sorted((a, b))): w for a, b, w in original}
        for edge in actual:
            if (not isinstance(edge, list) or len(edge) != 3
                    or any(type(value) is not int for value in edge)):
                return False
            a, b, w = edge
            key = tuple(sorted((a, b)))
            if key not in remaining or not 1 <= w <= 2_000_000_000:
                return False
            original_weight = remaining.pop(key)
            if original_weight != -1 and w != original_weight:
                return False
        return not remaining and _distance(n, actual, source, destination) == target
    if slug == 'minimum-remove-to-make-valid-parentheses':
        if not isinstance(actual, str):
            return False
        original = args[0]
        if len(actual) != len(expected):
            return False
        if ''.join(c for c in actual if c not in '()') != ''.join(c for c in original if c not in '()'):
            return False
        balance = 0
        for char in actual:
            balance += (char == '(') - (char == ')')
            if balance < 0:
                return False
        if balance:
            return False
        source = iter(original)
        return all(any(char == candidate for candidate in source) for char in actual)
    if slug == 'accounts-merge':
        if not isinstance(actual, list):
            return False
        for row in actual:
            if (not isinstance(row, list) or len(row) < 2
                    or not all(isinstance(value, str) for value in row)
                    or row[1:] != sorted(set(row[1:]))):
                return False
        return sorted(actual) == sorted(expected)
    if isinstance(expected, bool):
        return type(actual) is bool and actual == expected
    if isinstance(expected, int):
        return type(actual) is int and actual == expected
    return actual == expected
