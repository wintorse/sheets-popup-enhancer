import { bold, formula } from './history-dom';
import { matchesEdits } from './history-edits';
import { replacement, unsupported, type Edit, type ParseResult } from './history-types';

// Sheets can put a replacement's new value inside a nested bold label and
// wrap the displayed value in both Chinese and ASCII presentation quotes.
function readChineseQuoted(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('“') && trimmed.endsWith('”')) {
    const inner = trimmed.slice(1, -1);
    return inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2
      ? inner.slice(1, -1)
      : inner;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
    return trimmed.slice(1, -1);
  return undefined;
}

export function chineseReplacement(node: HTMLElement): Edit | undefined {
  const children = Array.from(node.childNodes);
  const nested = children.filter(bold);
  if (
    nested.length !== 1 ||
    children.some((child) => child.nodeType !== 3 && !bold(child) && !formula(child))
  )
    return undefined;
  const index = children.indexOf(nested[0]!);
  const prefix = children
    .slice(0, index)
    .map((child) => child.textContent ?? '')
    .join('')
    .trim();
  const tail = children
    .slice(index + 1)
    .map((child) => child.textContent ?? '')
    .join('');
  if (prefix !== '已用') return undefined;
  const match = tail.match(/^\s*替换\s*([\s\S]+)$/u);
  if (!match) return undefined;
  const after = readChineseQuoted(nested[0]!.textContent ?? '');
  const before = readChineseQuoted(match[1]!);
  if (!before || !after) return undefined;
  return { before, after };
}

class ChineseHistoryReader {
  private index = 0;
  private edits: Edit[] = [];
  private oldText: string | undefined;

  constructor(private nodes: Node[]) {}

  private readContext(): ParseResult | undefined {
    const value = this.nodes[this.index++];
    if (!value || value.nodeType !== 3 || this.index !== this.nodes.length)
      return unsupported('変更前の値を特定できませんでした');
    this.oldText = (value.textContent ?? '').match(/^\s*[:：]\s*"([\s\S]*)"\s*$/u)?.[1];
  }

  private readReplacement(node: HTMLElement): ParseResult | undefined {
    const edit = chineseReplacement(node);
    if (!edit) return unsupported('中国語の置換を特定できませんでした');
    this.edits.push(edit);
    const comma = this.nodes[this.index++];
    if (!comma || comma.nodeType !== 3 || !/^\s*[,，]\s*$/u.test(comma.textContent ?? '')) {
      return unsupported('中国語の操作の区切りを特定できませんでした');
    }
  }

  private readSingleAction(label: string): ParseResult | undefined {
    const value = this.nodes[this.index++];
    if (!value || value.nodeType !== 3)
      return unsupported('中国語の操作の値を特定できませんでした');
    const match = (value.textContent ?? '').match(/^\s*"([\s\S]*)"\s*[,，]\s*$/u);
    const fragment = match?.[1]?.trim();
    if (!fragment) return unsupported('中国語の操作の値を特定できませんでした');
    if (label.startsWith('已添加')) this.edits.push({ before: '', after: fragment });
    else this.edits.push({ before: fragment, after: '' });
  }

  private readStep(): ParseResult | undefined {
    const node = this.nodes[this.index++];
    if (!node || !bold(node)) return unsupported('未対応の中国語の履歴構造です');
    const label = node.textContent?.trim() ?? '';
    if (label === '范围') return this.readContext();
    if (label.startsWith('已用')) return this.readReplacement(node);
    if (/^已(?:添加|删除)[:：]$/u.test(label)) return this.readSingleAction(label);
    return unsupported('未対応の中国語の操作です');
  }

  read(currentValue: string): ParseResult {
    while (this.index < this.nodes.length) {
      const failure = this.readStep();
      if (failure) return failure;
    }
    if (this.oldText === undefined || !matchesEdits(this.oldText, currentValue, this.edits)) {
      return unsupported('履歴と現在のセル値が一致しません');
    }
    return replacement(this.oldText, currentValue);
  }
}

export function parseChinesePartial(
  root: Element,
  currentValue: string | undefined,
  latest: boolean,
): ParseResult | undefined {
  const nodes = Array.from(root.childNodes);
  const ranges = nodes.filter((node) => bold(node) && node.textContent?.trim() === '范围');
  if (!ranges.length) return undefined;
  if (ranges.length !== 1) return unsupported('部分差分の文脈を一意に特定できませんでした');
  if (!latest || currentValue === undefined)
    return unsupported('最新履歴または現在のセル値を確認できませんでした');
  return new ChineseHistoryReader(nodes).read(currentValue);
}
