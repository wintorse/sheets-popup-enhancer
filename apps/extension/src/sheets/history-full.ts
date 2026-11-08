import { bold, formula, readValue } from './history-dom';
import { chineseReplacement } from './history-chinese';
import { partialLabels } from './history-labels';
import { replacement, unsupported, type HistoryContext, type ParseResult } from './history-types';

// For an otherwise unknown locale, a latest two-formula replacement can be
// oriented without translating labels when exactly one value matches the bar.
function inferLatestFormulaReplacement(
  root: Element,
  context: { latest?: boolean; currentValue?: string },
): ParseResult | undefined {
  if (!context.latest || context.currentValue === undefined) return undefined;
  const nodes = Array.from(root.childNodes);
  const labels = nodes.filter(bold);
  if (
    labels.length !== 2 ||
    nodes.some((node) => node.nodeType !== 3 && !bold(node) && !formula(node))
  )
    return undefined;
  const firstLabel = nodes.indexOf(labels[0]!);
  const separator = nodes.indexOf(labels[1]!);
  if (firstLabel !== 0 || nodes.filter(formula).length !== 2) return undefined;
  const first = readValue(nodes.slice(firstLabel + 1, separator));
  const second = readValue(nodes.slice(separator + 1));
  if (first === undefined || second === undefined || first === second) return undefined;
  if ((first === context.currentValue) === (second === context.currentValue)) return undefined;
  return {
    ok: true,
    change: {
      kind: 'replace',
      oldText: first === context.currentValue ? second : first,
      newText: context.currentValue,
    },
  };
}

function parseTraditionalReplacement(
  nodes: Node[],
  labels: HTMLElement[],
): ParseResult | undefined {
  const traditional = partialLabels.zhTW;
  if (
    !labels.some(
      (label) =>
        label.textContent?.trim() === traditional.replace ||
        label.textContent?.trim() === traditional.separator,
    )
  )
    return undefined;
  if (
    labels.length !== 2 ||
    nodes[0] !== labels[0] ||
    labels[0]!.textContent?.trim() !== traditional.replace ||
    labels[1]!.textContent?.trim() !== traditional.separator
  ) {
    return unsupported('繁体字中国語の置換を特定できませんでした');
  }
  const index = nodes.indexOf(labels[1]!);
  const before = readValue(nodes.slice(1, index), true);
  const after = readValue(nodes.slice(index + 1), true);
  if (before === undefined || after === undefined)
    return unsupported('変更前後の値を一意に特定できませんでした');
  return replacement(before, after);
}

function parseChineseReplacement(labels: HTMLElement[]): ParseResult | undefined {
  if (labels.length !== 1) return undefined;
  const label = labels[0]!;
  if (!label.textContent?.trim().startsWith('已用')) return undefined;
  const edit = chineseReplacement(label);
  if (!edit) return unsupported('中国語の入れ子構造を特定できませんでした');
  return replacement(edit.before, edit.after);
}

const separators = [
  'から',
  'with',
  '替换',
  'por',
  'remplacée par',
  'dengan',
  'на',
  'durch',
  'بالقيمة',
];
const strictReplacementLocales = [
  partialLabels.es,
  partialLabels.ptBR,
  partialLabels.fr,
  partialLabels.id,
  partialLabels.ru,
  partialLabels.de,
  partialLabels.ar,
];

function validReplacementLabels(separator: HTMLElement, labels: HTMLElement[]): boolean {
  const locales = strictReplacementLocales.filter(
    (locale) => locale.separator === separator.textContent?.trim(),
  );
  if (!locales.length) return true;
  return (
    labels.length === 2 &&
    labels[1] === separator &&
    locales.some((locale) => locale.replace === labels[0]?.textContent?.trim())
  );
}

function parseReplacement(nodes: Node[], labels: HTMLElement[]): ParseResult | undefined {
  const separator = labels.find((label) => separators.includes(label.textContent?.trim() ?? ''));
  if (!separator) return undefined;
  if (!validReplacementLabels(separator, labels))
    return unsupported('置換の操作を特定できませんでした');
  const index = nodes.indexOf(separator);
  const first = readValue(nodes.slice(0, index).filter((node) => !bold(node)));
  const second = readValue(nodes.slice(index + 1).filter((node) => !bold(node)));
  if (first === undefined || second === undefined)
    return unsupported('変更前後の値を一意に特定できませんでした');
  if (separator.textContent?.trim() === '替换') return replacement(second, first);
  return replacement(first, second);
}

function singleActionValueNodes(nodes: Node[], label: HTMLElement): Node[] | undefined {
  const action = label.textContent?.trim();
  const valueNodes = nodes.slice(nodes.indexOf(label) + 1);
  if (action !== partialLabels.fr.add && action !== partialLabels.fr.delete) return valueNodes;
  const first = valueNodes[0];
  if (!first || first.nodeType !== 3 || !/^\s*:\s*/u.test(first.textContent ?? ''))
    return undefined;
  return [
    document.createTextNode((first.textContent ?? '').replace(/^\s*:\s*/u, '')),
    ...valueNodes.slice(1),
  ];
}

function parseSingleAction(nodes: Node[], labels: HTMLElement[]): ParseResult | undefined {
  if (labels.length !== 1) return undefined;
  const label = labels[0]!;
  const action = label.textContent?.trim() ?? '';
  const valueNodes = singleActionValueNodes(nodes, label);
  if (!valueNodes) return unsupported('フランス語の値を特定できませんでした');
  const text = readValue(valueNodes);
  if (text === undefined) return unsupported('セル値が見つかりませんでした');
  const locales = Object.values(partialLabels);
  if (
    /^(追加|Added\b|Inserted\b|已添加|添加)/iu.test(action) ||
    locales.some((locale) => locale.add === action)
  ) {
    return { ok: true, change: { kind: 'add', oldText: '', newText: text } };
  }
  if (
    /^(削除|Deleted\b|Removed\b|已删除|删除)/iu.test(action) ||
    locales.some((locale) => locale.delete === action)
  ) {
    return { ok: true, change: { kind: 'delete', oldText: text, newText: '' } };
  }
}

export function parseFullHistory(root: Element, context: HistoryContext): ParseResult {
  const nodes = Array.from(root.childNodes);
  const labels = nodes.filter(bold);
  return (
    parseTraditionalReplacement(nodes, labels) ??
    parseChineseReplacement(labels) ??
    parseReplacement(nodes, labels) ??
    inferLatestFormulaReplacement(root, context) ??
    parseSingleAction(nodes, labels) ??
    unsupported('未対応の言語またはDOM構造です')
  );
}
