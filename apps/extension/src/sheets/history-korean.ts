import { bold, formula, isAsciiQuoted } from './history-dom';
import { matchesEdits } from './history-edits';
import { koreanLabels } from './history-labels';
import {
  replacement,
  unsupported,
  type CellChange,
  type Edit,
  type ParseResult,
} from './history-types';

function quoted(text: string): string | undefined {
  const raw = text.trim();
  return isAsciiQuoted(raw) ? raw.slice(1, -1) : undefined;
}

function koreanReplacement(text: string): Edit | undefined {
  const suffix = '"(으)로';
  if (!text.startsWith('"') || !text.endsWith(suffix)) return undefined;
  const body = text.slice(1, -suffix.length);
  const separators = Array.from(body.matchAll(/"이\(가\)\s+"/gu));
  if (separators.length !== 1) return undefined;
  const separator = separators[0]!;
  return {
    before: body.slice(0, separator.index),
    after: body.slice(separator.index + separator[0].length),
  };
}

function isDescriptionNode(node: Node): boolean {
  return node.nodeType === 3 || (formula(node) && !!node.textContent?.startsWith('='));
}

function isWhitespace(node: Node): boolean {
  return node.nodeType === 3 && !node.textContent?.trim();
}

// Korean descriptions put each label after its values. Commas and quotes may occur inside a value.
class KoreanHistoryReader {
  private index = 0;
  private edits: Edit[] = [];
  private kind: CellChange['kind'] | undefined;
  private oldText: string | undefined;

  constructor(private nodes: Node[]) {}

  private readContext(text: string): ParseResult | undefined {
    this.oldText = quoted(text);
    if (
      !this.edits.length ||
      this.oldText === undefined ||
      !this.nodes.slice(this.index).every(isWhitespace)
    ) {
      return unsupported('変更前の値を特定できませんでした');
    }
    this.index = this.nodes.length;
  }

  private readReplacement(text: string): ParseResult | undefined {
    const edit = koreanReplacement(text);
    if (!edit) return unsupported('韓国語の置換を特定できませんでした');
    this.edits.push(edit);
    this.kind = 'replace';
    // Sheets sometimes appends exactly one empty bold span to a replacement.
    const empty = this.nodes[this.index];
    if (empty && bold(empty) && empty.childNodes.length === 0) this.index++;
  }

  private readSingleAction(action: string, text: string): ParseResult | undefined {
    const suffix = '이(가)';
    const value = text.endsWith(suffix) ? quoted(text.slice(0, -suffix.length)) : undefined;
    if (value === undefined || value === '')
      return unsupported('韓国語の追加または削除を特定できませんでした');
    this.kind = action === koreanLabels.add ? 'add' : 'delete';
    if (this.kind === 'add') this.edits.push({ before: '', after: value });
    else this.edits.push({ before: value, after: '' });
  }

  private readAction(action: string | undefined, text: string): ParseResult | undefined {
    if (action === koreanLabels.context) return this.readContext(text);
    if (action === koreanLabels.replace) return this.readReplacement(text);
    if (action === koreanLabels.add || action === koreanLabels.delete)
      return this.readSingleAction(action, text);
    return unsupported('未対応の韓国語の操作です');
  }

  private readStep(): ParseResult | undefined {
    const description: Node[] = [];
    while (this.index < this.nodes.length && !bold(this.nodes[this.index]!))
      description.push(this.nodes[this.index++]!);
    const label = this.nodes[this.index++];
    if (
      !label ||
      !bold(label) ||
      Array.from(label.childNodes).some((node) => node.nodeType !== 3)
    ) {
      return unsupported('未対応の韓国語の履歴構造です');
    }
    if (!description.length || !description.every(isDescriptionNode))
      return unsupported('韓国語の操作の値を特定できませんでした');
    let text = description
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (this.edits.length) {
      if (!text.startsWith(',')) return unsupported('韓国語の操作の区切りを特定できませんでした');
      text = text.slice(1).trimStart();
    }
    return this.readAction(label.textContent?.trim(), text);
  }

  read(currentValue: string | undefined, hasContext: boolean): ParseResult {
    while (this.index < this.nodes.length) {
      const failure = this.readStep();
      if (failure) return failure;
      if (this.nodes.slice(this.index).every(isWhitespace)) break;
    }
    if (hasContext) {
      if (
        this.oldText === undefined ||
        currentValue === undefined ||
        !matchesEdits(this.oldText, currentValue, this.edits)
      ) {
        return unsupported('履歴と現在のセル値が一致しません');
      }
      return replacement(this.oldText, currentValue);
    }
    const edit = this.edits[0];
    if (this.edits.length !== 1 || !edit)
      return unsupported('変更前後の値を一意に特定できませんでした');
    if (this.kind === 'add')
      return { ok: true, change: { kind: 'add', oldText: '', newText: edit.after } };
    if (this.kind === 'delete')
      return { ok: true, change: { kind: 'delete', oldText: edit.before, newText: '' } };
    return replacement(edit.before, edit.after);
  }
}

export function parseKoreanHistory(
  root: Element,
  currentValue: string | undefined,
  latest: boolean,
): ParseResult | undefined {
  const nodes = Array.from(root.childNodes);
  const labels = nodes.filter(bold);
  if (
    !labels.some((node) =>
      Object.values(koreanLabels).some((label) => node.textContent?.trim() === label),
    )
  )
    return undefined;
  const contexts = labels.filter((node) => node.textContent?.trim() === koreanLabels.context);
  if (contexts.length > 1) return unsupported('部分差分の文脈を一意に特定できませんでした');
  if (contexts.length && (!latest || currentValue === undefined))
    return unsupported('最新履歴または現在のセル値を確認できませんでした');
  return new KoreanHistoryReader(nodes).read(currentValue, contexts.length > 0);
}
