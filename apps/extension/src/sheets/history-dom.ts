export const bold = (node: Node): node is HTMLElement =>
  node.nodeType === 1 && (node as Element).classList.contains('docs-blame-bold-text');
export const formula = (node: Node) =>
  node.nodeType === 1 && (node as Element).classList.contains('waffle-blameview-formula-text');
const quotePairs: Record<string, string> = { '"': '"', '「': '」', '“': '”', '‘': '’' };

export function isAsciiQuoted(text: string): boolean {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"');
}

// Remove exactly one pair of presentation quotes. Never strip the quotes inside a formula.
export function unwrapValue(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && quotePairs[trimmed.charAt(0)] === trimmed.at(-1)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readFormulaValue(
  nodes: Node[],
  formulas: Node[],
  asciiQuoted: boolean,
): string | undefined {
  if (formulas.length !== 1 || nodes.some((node) => node.nodeType !== 3 && !formula(node)))
    return undefined;
  const index = nodes.indexOf(formulas[0]!);
  const prefix = nodes
    .slice(0, index)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  const suffix = nodes
    .slice(index + 1)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
  if (asciiQuoted && (prefix !== '"' || suffix !== '"')) return undefined;
  if ((prefix || suffix) && (!prefix || quotePairs[prefix] !== suffix)) return undefined;
  const value = formulas[0]!.textContent ?? '';
  return value.startsWith('=') ? value : undefined;
}

function readTextValue(nodes: Node[], asciiQuoted: boolean): string | undefined {
  if (nodes.some((node) => node.nodeType !== 3)) return undefined;
  const candidates = nodes.filter((node) => !!node.textContent?.trim());
  if (candidates.length !== 1) return undefined;
  const text = candidates[0]!.textContent?.trim() ?? '';
  if (asciiQuoted && !isAsciiQuoted(text)) return undefined;
  return text ? unwrapValue(text) : undefined;
}

export function readValue(nodes: Node[], asciiQuoted = false): string | undefined {
  const formulas = nodes.filter(formula);
  if (formulas.length) return readFormulaValue(nodes, formulas, asciiQuoted);
  return readTextValue(nodes, asciiQuoted);
}

function readFormulaNode(node: Node): string | undefined {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (!(node instanceof Element)) return undefined;
  if (node.tagName === 'BR') return '\n';
  if (node.tagName !== 'SPAN') return undefined;
  let result = '';
  for (const child of node.childNodes) {
    const part = readFormulaNode(child);
    if (part === undefined) return undefined;
    result += part;
  }
  return result;
}

function readHighlightedFormula(wrapper: Element): string | undefined {
  if (wrapper.children.length !== 1 || !wrapper.firstElementChild?.matches('span.formula-content'))
    return undefined;
  const value = readFormulaNode(wrapper.firstElementChild);
  return value?.startsWith('=') ? value : undefined;
}

function readPlainFormulaBar(nodes: Node[]): string | undefined {
  let value = '';
  for (const node of nodes) {
    if (node.nodeType === 3) value += node.textContent ?? '';
    else if (node.nodeType === 1 && (node as Element).tagName === 'BR') value += '\n';
    else return undefined;
  }
  return value;
}

// The final BR is Sheets' editing sentinel, not part of the cell value.
export function readFormulaBar(root: Element | null): string | undefined {
  if (!root || !root.matches('.cell-input')) return undefined;
  const nodes = Array.from(root.childNodes);
  const last = nodes.at(-1);
  if (!last || last.nodeType !== 1 || (last as Element).tagName !== 'BR') return undefined;
  if (nodes.length === 2 && nodes[0] instanceof Element && nodes[0].tagName === 'BDO') {
    return readHighlightedFormula(nodes[0]);
  }
  return readPlainFormulaBar(nodes.slice(0, -1));
}
