import { describe, expect, it } from 'vitest';
import { buildDiff, buildSplitRows, buildUnifiedRows } from './model';

const text = (rows: ReturnType<typeof buildDiff>['before']) =>
  rows
    .filter((r) => r.number !== null)
    .map((r) => r.tokens.map((t) => t.text).join(''))
    .join('\n');
describe('diff model', () => {
  it.each([
    ['今日は晴れです。', '今日は雨です。'],
    ['one\nunchanged\nlast', 'two\nunchanged\nadded\nlast'],
    ['=IF(A1="", "", 1)', '=IF(A1="", "", 2)'],
    ['', '追加された値'],
    ['削除された値', ''],
    ['', ''],
    ['  a\t b\n\n c', ' a\t  b\n\n d'],
    ['a', 'a\n'],
    ['a\n', 'a'],
    ['a\n', 'a\n\n'],
    ['', '\n'],
    ['a\n', 'b\n'],
    ['家族 👨‍👩‍👧‍👦 café', '家族 👨‍👩‍👦 café'],
    ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'],
  ])('preserves both texts: %s → %s', (before, after) => {
    const result = buildDiff(before, after);
    expect(text(result.before)).toBe(before);
    expect(text(result.after)).toBe(after);
    expect(result.before.length).toBe(result.after.length);
  });
  it('marks only differing tokens within a changed line', () => {
    const result = buildDiff('Hello old world', 'Hello new world');
    expect(
      result.before[0].tokens
        .filter((t) => t.changed)
        .map((t) => t.text)
        .join(''),
    ).toContain('old');
    expect(
      result.after[0].tokens
        .filter((t) => t.changed)
        .map((t) => t.text)
        .join(''),
    ).toContain('new');
    expect(result.after[0].tokens.some((t) => !t.changed && t.text.includes('Hello'))).toBe(true);
  });
  it('marks changed whitespace as well as added text', () => {
    const result = buildDiff('apple orange cirtus', 'apple  orange citrusapple orange cirtus');
    expect(result.after[0].tokens.some((token) => token.changed && token.text.includes('  '))).toBe(
      true,
    );
    expect(
      result.after[0].tokens.some((token) => token.changed && token.text.includes('citrusapple')),
    ).toBe(true);
  });
  it.each(['追加された値', 'first\nsecond\n', ' ', '\n', 'a'.repeat(50_001)])(
    'treats an empty cell as absent when adding or deleting content (%#)',
    (value) => {
      for (const [oldText, newText, missingSide, kind] of [
        ['', value, 'before', 'addition'],
        [value, '', 'after', 'deletion'],
      ] as const) {
        const result = buildDiff(oldText, newText);
        const split = buildSplitRows(result);
        expect(split).toHaveLength(value.split('\n').length);
        expect(split.every((row) => row[missingSide] === null)).toBe(true);
        const unified = buildUnifiedRows(split);
        expect(unified.every((row) => row.kind === kind)).toBe(true);
        expect(
          unified.map((row) => row.tokens.map((token) => token.text).join('')).join('\n'),
        ).toBe(value);
      }
    },
  );
  it('has no added or deleted lines when both cells are empty', () => {
    expect(buildSplitRows(buildDiff('', ''))).toEqual([]);
    expect(buildUnifiedRows(buildSplitRows(buildDiff('', '')))).toEqual([]);
  });
  it('marks the final empty line as added or removed and aligns the opposite side', () => {
    for (const [oldText, newText, side] of [
      ['a', 'a\n', 'after'],
      ['a\n', 'a', 'before'],
    ] as const) {
      const result = buildDiff(oldText, newText);
      expect(result.before[0]?.changed).toBe(false);
      expect(result.after[0]?.changed).toBe(false);
      expect(result[side].at(-1)).toMatchObject({ number: 2, changed: true });
      expect(
        result[side]
          .at(-1)
          ?.tokens.map((token) => token.text)
          .join(''),
      ).toBe('');
      expect(result[side === 'before' ? 'after' : 'before'].at(-1)?.number).toBeNull();
    }
    expect(buildDiff('a\n', 'a\n').after.at(-1)).toMatchObject({ number: 2, changed: false });
  });
  it('aligns a filled trailing empty line with the corresponding old empty line', () => {
    const result = buildDiff('abc def\n\n\n', 'abc def\n\n\nzzz');
    expect(result.before.map((line) => line.number)).toEqual([1, 2, 3, 4]);
    expect(result.after.map((line) => line.number)).toEqual([1, 2, 3, 4]);
    expect(result.before[3]).toMatchObject({ number: 4, changed: true });
    expect(result.after[3]).toMatchObject({ number: 4, changed: true });
    expect(result.after[3].tokens.map((token) => token.text).join('')).toBe('zzz');
  });
  it('limits expensive diffing for very long values', () => {
    expect(buildDiff('a'.repeat(30_000), 'b'.repeat(30_000)).simplified).toBe(true);
  });
  it('pairs replacements and keeps insertion/deletion gaps aligned with context', () => {
    const rows = buildSplitRows(
      buildDiff('start\nold\nkeep\nremoved\nend', 'start\nnew\nextra\nkeep\nend'),
    );
    expect(
      rows.map(({ before, after }) => [before?.number ?? null, after?.number ?? null]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [null, 3],
      [3, 4],
      [4, null],
      [5, 5],
    ]);
  });
  it('groups deletions before additions in each unified change block, showing context once', () => {
    const rows = buildUnifiedRows(
      buildSplitRows(
        buildDiff(
          'start\nold one\nold two\nkeep\nremoved\nend',
          'start\nnew one\nnew two\nextra\nkeep\nend',
        ),
      ),
    );
    expect(
      rows.map((row) => [
        row.kind,
        row.oldNumber,
        row.newNumber,
        row.tokens.map((token) => token.text).join(''),
      ]),
    ).toEqual([
      ['context', 1, 1, 'start'],
      ['deletion', 2, null, 'old one'],
      ['deletion', 3, null, 'old two'],
      ['addition', null, 2, 'new one'],
      ['addition', null, 3, 'new two'],
      ['addition', null, 4, 'extra'],
      ['context', 4, 5, 'keep'],
      ['deletion', 5, null, 'removed'],
      ['context', 6, 6, 'end'],
    ]);
  });
  it('pads unequal simplified values without losing their final lines', () => {
    const rows = buildSplitRows(buildDiff('a'.repeat(50_001), 'b\nc\n'));
    expect(
      rows.map(({ before, after }) => [before?.number ?? null, after?.number ?? null]),
    ).toEqual([
      [1, 1],
      [null, 2],
      [null, 3],
    ]);
    expect(buildUnifiedRows(rows).map((row) => row.kind)).toEqual([
      'deletion',
      'addition',
      'addition',
      'addition',
    ]);
  });
  it('renders identical long values as context in unified mode', () => {
    const value = 'a'.repeat(30_000);
    expect(buildUnifiedRows(buildSplitRows(buildDiff(value, value)))).toMatchObject([
      { kind: 'context', oldNumber: 1, newNumber: 1 },
    ]);
  });
});
