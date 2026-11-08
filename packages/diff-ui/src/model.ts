import { diffArrays, type ArrayChange } from 'diff';

export type DiffLayout = 'unified' | 'split';
export interface Token {
  text: string;
  changed: boolean;
}
export interface DiffLine {
  number: number | null;
  tokens: Token[];
  changed: boolean;
}
export interface DiffModel {
  before: DiffLine[];
  after: DiffLine[];
  simplified: boolean;
}
export interface SplitRow {
  before: DiffLine | null;
  after: DiffLine | null;
}
export interface UnifiedRow {
  kind: 'context' | 'deletion' | 'addition';
  oldNumber: number | null;
  newNumber: number | null;
  tokens: Token[];
}

// Keep each aligned pair in one table row, including in the simplified fallback.
export function buildSplitRows(model: DiffModel): SplitRow[] {
  return Array.from({ length: Math.max(model.before.length, model.after.length) }, (_, i) => ({
    before: model.before[i]?.number != null ? model.before[i]! : null,
    after: model.after[i]?.number != null ? model.after[i]! : null,
  }));
}

export function buildUnifiedRows(rows: SplitRow[]): UnifiedRow[] {
  const result: UnifiedRow[] = [];
  let deletions: UnifiedRow[] = [];
  let additions: UnifiedRow[] = [];
  const flush = () => {
    for (const line of deletions) result.push(line);
    for (const line of additions) result.push(line);
    deletions = [];
    additions = [];
  };
  for (const { before, after } of rows) {
    if (before && after && !before.changed && !after.changed) {
      flush();
      result.push({
        kind: 'context',
        oldNumber: before.number,
        newNumber: after.number,
        tokens: before.tokens,
      });
    } else {
      if (before)
        deletions.push({
          kind: 'deletion',
          oldNumber: before.number,
          newNumber: null,
          tokens: before.tokens,
        });
      if (after)
        additions.push({
          kind: 'addition',
          oldNumber: null,
          newNumber: after.number,
          tokens: after.tokens,
        });
    }
  }
  flush();
  return result;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const tokenize = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);
// An empty cell has no lines; blank lines within a non-empty value still count.
const lines = (value: string) => (value === '' ? [] : value.split('\n'));

function blankLine(): DiffLine {
  return { number: null, tokens: [], changed: false };
}

function wholeLine(text: string, number: number, changed: boolean): DiffLine {
  return { number, tokens: [{ text, changed }], changed };
}

function simplifiedDiff(oldText: string, newText: string): DiffModel {
  const changed = oldText !== newText;
  return {
    before: lines(oldText).map((text, i) => wholeLine(text, i + 1, changed)),
    after: lines(newText).map((text, i) => wholeLine(text, i + 1, changed)),
    simplified: true,
  };
}

function tokensForSide(
  parts: ArrayChange<string>[] | undefined,
  text: string,
  side: 'before' | 'after',
): Token[] {
  if (!parts) return [{ text, changed: true }];
  const tokens: Token[] = [];
  for (const part of parts) {
    if (side === 'before' && part.added) continue;
    if (side === 'after' && part.removed) continue;
    const changed = side === 'before' ? !!part.removed : !!part.added;
    tokens.push({ text: part.value.join(''), changed });
  }
  return tokens;
}

class DiffBuilder {
  private before: DiffLine[] = [];
  private after: DiffLine[] = [];
  private oldNumber = 1;
  private newNumber = 1;

  private addContext(values: string[]) {
    for (const text of values) {
      this.before.push(wholeLine(text, this.oldNumber++, false));
      this.after.push(wholeLine(text, this.newNumber++, false));
    }
  }

  private addChangedPair(left: string | undefined, right: string | undefined) {
    let parts: ArrayChange<string>[] | undefined;
    if (left !== undefined && right !== undefined) {
      parts = diffArrays(tokenize(left), tokenize(right), { timeout: 15 });
    }
    if (left === undefined) {
      this.before.push(blankLine());
    } else {
      this.before.push({
        number: this.oldNumber++,
        changed: true,
        tokens: tokensForSide(parts, left, 'before'),
      });
    }
    if (right === undefined) {
      this.after.push(blankLine());
    } else {
      this.after.push({
        number: this.newNumber++,
        changed: true,
        tokens: tokensForSide(parts, right, 'after'),
      });
    }
  }

  private addChanges(removed: string[], added: string[]) {
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      this.addChangedPair(removed[row], added[row]);
    }
  }

  build(changes: ArrayChange<string>[]): DiffModel {
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i]!;
      if (!change.added && !change.removed) {
        this.addContext(change.value);
        continue;
      }
      const removed = change.removed ? change.value : [];
      let added = change.added ? change.value : [];
      if (change.removed && changes[i + 1]?.added) added = changes[++i]!.value;
      this.addChanges(removed, added);
    }
    return { before: this.before, after: this.after, simplified: false };
  }
}

// Keep the original text, including whitespace and line endings, out of HTML strings.
export function buildDiff(oldText: string, newText: string): DiffModel {
  if (oldText.length + newText.length > 50_000) return simplifiedDiff(oldText, newText);
  const changes = diffArrays(lines(oldText), lines(newText), { timeout: 40 });
  if (!changes) return simplifiedDiff(oldText, newText);
  return new DiffBuilder().build(changes);
}
