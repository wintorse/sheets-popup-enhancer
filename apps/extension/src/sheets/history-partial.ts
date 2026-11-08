import { bold } from './history-dom';
import {
  matchesEdits,
  matchesAddedSummary,
  matchesAddedWithFlattenedWhitespace,
} from './history-edits';
import { partialLabels, koreanLabels, type PartialLabels } from './history-labels';
import { replacement, unsupported, type Edit, type ParseResult } from './history-types';

function contextLabels(node: Node): PartialLabels | undefined {
  if (!bold(node)) return undefined;
  return Object.values(partialLabels).find((locale) => node.textContent?.trim() === locale.context);
}

export function isPartialHistory(root: Element): boolean {
  return Array.from(root.childNodes).some((node) => {
    if (!bold(node)) return false;
    const label = node.textContent?.trim();
    return label === koreanLabels.context || label === '范围' || !!contextLabels(node);
  });
}

function quoted(node: Node | undefined, suffix: ',' | '', colon = false): string | undefined {
  if (!node || node.nodeType !== 3) return undefined;
  let text = node.textContent ?? '';
  if (colon) text = text.match(/^\s*[:：]([\s\S]*)$/u)?.[1] ?? '';
  const pattern = suffix === ',' ? /^\s*"([\s\S]*)",\s*$/u : /^\s*"([\s\S]*)"\s*$/u;
  return text.match(pattern)?.[1];
}

function matchesPartialEdits(
  before: string,
  after: string,
  edits: Edit[],
  labels: PartialLabels,
): boolean {
  if (matchesEdits(before, after, edits)) return true;
  if (labels.context === partialLabels.ja.context)
    return matchesAddedWithFlattenedWhitespace(before, after, edits);
  if (labels.context === partialLabels.en.context) return matchesAddedSummary(before, after, edits);
  return false;
}

class PartialHistoryReader {
  private index = 0;
  private edits: Edit[] = [];
  private oldText: string | undefined;

  constructor(
    private nodes: Node[],
    private labels: PartialLabels,
  ) {}

  private readContext(): ParseResult | undefined {
    this.oldText = quoted(
      this.nodes[this.index++],
      '',
      this.labels.context === partialLabels.zhTW.context,
    );
    if (this.oldText === undefined || this.index !== this.nodes.length)
      return unsupported('変更前の値を特定できませんでした');
  }

  private readReplacement(): ParseResult | undefined {
    const left = quoted(this.nodes[this.index++], '');
    const separator = this.nodes[this.index++];
    const right = quoted(this.nodes[this.index++], ',');
    if (
      !left ||
      !right ||
      !separator ||
      !bold(separator) ||
      separator.textContent?.trim() !== this.labels.separator
    ) {
      return unsupported('置換の内容を特定できませんでした');
    }
    this.edits.push({ before: left, after: right });
  }

  private readSingleAction(label: string): ParseResult | undefined {
    const value = quoted(
      this.nodes[this.index++],
      ',',
      this.labels.context === partialLabels.fr.context,
    );
    if (!value || !value.trim()) return unsupported('追加または削除の内容を特定できませんでした');
    if (label === this.labels.add) this.edits.push({ before: '', after: value.trim() });
    else this.edits.push({ before: value.trim(), after: '' });
  }

  private readStep(): ParseResult | undefined {
    const node = this.nodes[this.index++];
    if (!node || !bold(node)) return unsupported('未対応の部分差分の履歴構造です');
    const label = node.textContent?.trim();
    if (label === this.labels.context) return this.readContext();
    if (label === this.labels.replace) return this.readReplacement();
    if (label === this.labels.add || label === this.labels.delete)
      return this.readSingleAction(label);
    return unsupported('未対応の部分差分の操作です');
  }

  read(currentValue: string): ParseResult {
    while (this.index < this.nodes.length) {
      const failure = this.readStep();
      if (failure) return failure;
    }
    if (
      this.oldText === undefined ||
      !matchesPartialEdits(this.oldText, currentValue, this.edits, this.labels)
    ) {
      return unsupported('履歴と現在のセル値が一致しません');
    }
    return replacement(this.oldText, currentValue);
  }
}

export function parsePartialHistory(
  root: Element,
  currentValue: string | undefined,
  latest: boolean,
): ParseResult | undefined {
  const nodes = Array.from(root.childNodes);
  const contexts = nodes.filter((node) => !!contextLabels(node));
  if (!contexts.length) return undefined;
  if (contexts.length !== 1) return unsupported('部分差分の文脈を一意に特定できませんでした');
  if (!latest || currentValue === undefined)
    return unsupported('最新履歴または現在のセル値を確認できませんでした');
  return new PartialHistoryReader(nodes, contextLabels(contexts[0]!)!).read(currentValue);
}
