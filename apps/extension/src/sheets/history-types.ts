export type CellChange =
  | { kind: 'replace'; oldText: string; newText: string }
  | { kind: 'add'; oldText: ''; newText: string }
  | { kind: 'delete'; oldText: string; newText: '' };

export type ParseResult = { ok: true; change: CellChange } | { ok: false; reason: string };
export const unsupported = (reason: string): ParseResult => ({ ok: false, reason });

export type Edit = { before: string; after: string };
export interface HistoryContext {
  latest?: boolean;
  currentValue?: string;
}

export function replacement(oldText: string, newText: string): ParseResult {
  return { ok: true, change: { kind: 'replace', oldText, newText } };
}
