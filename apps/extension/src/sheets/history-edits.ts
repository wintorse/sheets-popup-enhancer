import type { Edit } from './history-types';

function isSingleAddition(edits: Edit[]): boolean {
  return edits.length === 1 && !edits[0]!.before && !!edits[0]!.after;
}

// Sheets may collapse repeated spaces in the displayed "within" value.
// Verify that the reported addition can explain the current value, allowing
// repeated spaces in the history summary to have been collapsed by Sheets.
export function matchesAddedSummary(summary: string, current: string, edits: Edit[]): boolean {
  if (summary.length + current.length > 50_000 || !isSingleAddition(edits)) return false;
  const fragment = edits[0]!.after;
  const normalize = (value: string) => value.replace(/ +/gu, ' ');
  const expected = normalize(summary);
  let count = 0;
  for (let at = current.indexOf(fragment); at !== -1; at = current.indexOf(fragment, at + 1)) {
    let start = at;
    do {
      let end = at + fragment.length;
      do {
        if (++count > 1000) return false;
        const candidate = current.slice(0, start) + current.slice(end);
        if (normalize(candidate) === expected) return true;
      } while (current[end++] === ' ');
    } while (start > 0 && current[--start] === ' ');
  }
  return false;
}

// Sheets may display line breaks in an added fragment as spaces. Preserve the
// exact unchanged text and normalize whitespace only inside the insertion.
export function matchesAddedWithFlattenedWhitespace(
  before: string,
  after: string,
  edits: Edit[],
): boolean {
  if (
    before.length + after.length > 50_000 ||
    !isSingleAddition(edits) ||
    after.length <= before.length
  )
    return false;
  const addedLength = after.length - before.length;
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const start = Math.max(0, before.length - suffix);
  if (prefix - start > 1000) return false;
  const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ');
  const expected = normalize(edits[0]!.after);
  for (let i = start; i <= prefix; i++) {
    if (normalize(after.slice(i, i + addedLength)) === expected) return true;
  }
  return false;
}

class EditMatcher {
  private memo = new Map<string, boolean>();
  private budget = 100_000;

  constructor(
    private before: string,
    private after: string,
    private edits: Edit[],
  ) {}

  private matchInsertionOrDeletion(i: number, j: number, edit: number): boolean {
    const { before: left, after: right } = this.edits[edit]!;
    const source = left ? this.before : this.after;
    const at = left ? i : j;
    const fragment = left || right;
    let start = at;
    while (start <= source.length) {
      if (
        source.startsWith(fragment, start) &&
        this.matchFragmentEnd(i, j, edit, start + fragment.length)
      )
        return true;
      if (start >= source.length || !/\s/u.test(source[start]!)) break;
      start++;
    }
    return false;
  }

  private matchFragmentEnd(i: number, j: number, edit: number, end: number): boolean {
    const { before: left, after: right } = this.edits[edit]!;
    const source = left ? this.before : this.after;
    while (true) {
      if (this.check(left ? end : i, right ? end : j, edit + 1)) return true;
      if (end >= source.length || !/\s/u.test(source[end]!)) return false;
      end++;
    }
  }

  private matchEdit(i: number, j: number, edit: number): boolean {
    const { before: left, after: right } = this.edits[edit]!;
    if (left && right) {
      return (
        this.before.startsWith(left, i) &&
        this.after.startsWith(right, j) &&
        this.check(i + left.length, j + right.length, edit + 1)
      );
    }
    return this.matchInsertionOrDeletion(i, j, edit);
  }

  check(i: number, j: number, edit: number): boolean {
    const key = `${i},${j},${edit}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    if (--this.budget < 0) return false;
    if (edit === this.edits.length) return this.before.slice(i) === this.after.slice(j);
    // Iterate the unchanged prefix instead of recursing once per character.
    while (true) {
      if (this.matchEdit(i, j, edit)) {
        this.memo.set(key, true);
        return true;
      }
      if (i >= this.before.length || j >= this.after.length || this.before[i] !== this.after[j])
        break;
      i++;
      j++;
    }
    this.memo.set(key, false);
    return false;
  }
}

// Sheets can omit surrounding whitespace from Added/Deleted fragments.
export function matchesEdits(before: string, after: string, edits: Edit[]): boolean {
  if (before.length + after.length > 50_000 || edits.length > 20) return false;
  if (!edits.length || before === after) return false;
  return new EditMatcher(before, after, edits).check(0, 0, 0);
}
