import { parseKoreanHistory } from './history-korean';
import { parseChinesePartial } from './history-chinese';
import { parsePartialHistory } from './history-partial';
import { parseFullHistory } from './history-full';
import type { HistoryContext, ParseResult } from './history-types';

export type { CellChange, ParseResult } from './history-types';
export { readFormulaBar, unwrapValue } from './history-dom';
export { isPartialHistory } from './history-partial';

// Parsing is deliberately conservative. Unknown locales/structures retain Sheets' own UI.
export function parseHistory(root: Element, context: HistoryContext = {}): ParseResult {
  const { currentValue } = context;
  const latest = context.latest === true;
  return (
    parseKoreanHistory(root, currentValue, latest) ??
    parseChinesePartial(root, currentValue, latest) ??
    parsePartialHistory(root, currentValue, latest) ??
    parseFullHistory(root, context)
  );
}
