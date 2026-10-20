"""Independent reference answers for the first ten frozen LeetCode fixtures.

These functions run trusted repository code only. They never execute a model's
generated source. ``args`` uses JSON values; TreeNode input is LeetCode's compact
level-order sequence (null children do not themselves consume child slots).
All ten return a unique integer or boolean, so validation is type-strict exact
comparison. This oracle establishes fixture correctness, not model complexity.
"""

from collections import Counter, deque
from math import isqrt


def _min_taps(n, ranges):
    # Cover the continuous interval, allowing two closed ranges to touch.
    intervals = sorted((max(0, i - radius), min(n, i + radius))
                       for i, radius in enumerate(ranges))
    covered = 0
    count = 0
    cursor = 0
    while covered < n:
        next_end = covered
        while cursor < len(intervals) and intervals[cursor][0] <= covered:
            next_end = max(next_end, intervals[cursor][1])
            cursor += 1
        if next_end == covered:
            return -1
        covered = next_end
        count += 1
    return count


def _pass_pillow(n, time):
    # Deliberate per-second simulation, independent of the cycle formula.
    holder, direction = 1, 1
    for _ in range(time):
        holder += direction
        if holder == 1 or holder == n:
            direction *= -1
    return holder


def _reducing_dishes(satisfaction):
    # A sorted subset has an optimal order by the exchange argument. DP retains
    # the best coefficient sum for every number of chosen dishes, including 0.
    impossible = -10**30
    dp = [0] + [impossible] * len(satisfaction)
    for processed, value in enumerate(sorted(satisfaction), 1):
        for count in range(processed, 0, -1):
            dp[count] = max(dp[count], dp[count - 1] + count * value)
    return max(dp)


def _chess_colors(coordinate1, coordinate2):
    # Materialize checkerboard colors rather than rely on a coordinate sum.
    board = []
    for row in range(8):
        board.append([bool((column + row) % 2) for column in range(8)])
    def lookup(coordinate):
        return board[int(coordinate[1]) - 1][ord(coordinate[0]) - ord('a')]
    return lookup(coordinate1) == lookup(coordinate2)


def _maximum_jumps(nums, target):
    dp = [-1] * len(nums)
    dp[0] = 0
    for end in range(1, len(nums)):
        for start in range(end):
            if dp[start] >= 0 and abs(nums[end] - nums[start]) <= target:
                dp[end] = max(dp[end], dp[start] + 1)
    return dp[-1]


def _delete_earn(nums):
    counts = Counter(nums)
    skipped = taken = 0
    previous = None
    for value in sorted(counts):
        best_before = max(skipped, taken)
        next_taken = value * counts[value] + (skipped if previous == value - 1 else best_before)
        skipped, taken = best_before, next_taken
        previous = value
    return max(skipped, taken)


def _balanced_split(s):
    # Prefix DP maximizes the number of balanced contiguous pieces. It is
    # independent of the usual count-every-zero-balance greedy implementation.
    balances = [0]
    for char in s:
        balances.append(balances[-1] + (1 if char == 'L' else -1))
    dp = [-1] * (len(s) + 1)
    dp[0] = 0
    for end in range(1, len(s) + 1):
        for start in range(end):
            if dp[start] >= 0 and balances[start] == balances[end]:
                dp[end] = max(dp[end], dp[start] + 1)
    return dp[-1]


def _square_triples(n):
    count = 0
    for a in range(1, n + 1):
        for b in range(1, n + 1):
            square = a * a + b * b
            c = isqrt(square)
            count += c <= n and c * c == square
    return count


def _tree_children(values):
    """Decode compact BFS values into child indices, without recursive depth."""
    if not values:
        return []
    if values[0] is None:
        if any(value is not None for value in values[1:]):
            raise ValueError('a null root cannot have non-null descendants')
        return []
    children = [[None, None]]
    parents = deque([0])
    cursor = 1
    while parents and cursor < len(values):
        parent = parents.popleft()
        for side in (0, 1):
            if cursor == len(values):
                break
            value = values[cursor]
            cursor += 1
            if value is not None:
                child = len(children)
                children.append([None, None])
                children[parent][side] = child
                parents.append(child)
    if any(value is not None for value in values[cursor:]):
        raise ValueError('unreachable non-null values in tree input')
    return children


def _longest_zigzag(root):
    children = _tree_children(root)
    left_lengths, right_lengths = [0] * len(children), [0] * len(children)
    best = 0
    # BFS construction numbers every child after its parent, so reversed order
    # provides a postorder dependency traversal even for a 50,000-node chain.
    for node in range(len(children) - 1, -1, -1):
        left, right = children[node]
        if left is not None:
            left_lengths[node] = 1 + right_lengths[left]
        if right is not None:
            right_lengths[node] = 1 + left_lengths[right]
        best = max(best, left_lengths[node], right_lengths[node])
    return best


def _max_palindromes(s, k):
    length = len(s)
    palindrome = [bytearray(length) for _ in range(length)]
    for start in range(length - 1, -1, -1):
        for end in range(start, length):
            palindrome[start][end] = (s[start] == s[end] and
                                      (end - start < 2 or palindrome[start + 1][end - 1]))
    dp = [0] * (length + 1)
    for end in range(1, length + 1):
        dp[end] = dp[end - 1]
        for start in range(end - k + 1):
            if palindrome[start][end - 1]:
                dp[end] = max(dp[end], dp[start] + 1)
    return dp[-1]


_SOLVERS = {
    'minimum-number-of-taps-to-open-to-water-a-garden': _min_taps,
    'pass-the-pillow': _pass_pillow,
    'reducing-dishes': _reducing_dishes,
    'check-if-two-chessboard-squares-have-the-same-color': _chess_colors,
    'maximum-number-of-jumps-to-reach-the-last-index': _maximum_jumps,
    'delete-and-earn': _delete_earn,
    'split-a-string-in-balanced-strings': _balanced_split,
    'count-square-sum-triples': _square_triples,
    'longest-zigzag-path-in-a-binary-tree': _longest_zigzag,
    'maximum-number-of-non-overlapping-palindrome-substrings': _max_palindromes,
}


def solve(slug, args):
    """Compute the expected JSON result for a known fixture slug."""
    return _SOLVERS[slug](*args)


def _same_json(actual, expected):
    # Python's True == 1 is not an exact JSON-type match.
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(_same_json(a, e) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(_same_json(actual[key], value) for key, value in expected.items())
    return actual == expected


def validate(slug, args, actual, expected):
    """All supported tasks have a unique scalar result; reject unknown slugs."""
    if slug not in _SOLVERS:
        raise KeyError(slug)
    return _same_json(actual, expected)
