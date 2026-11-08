export function mutationElement(mutation: MutationRecord): Element | null {
  return mutation.target.nodeType === 1
    ? (mutation.target as Element)
    : mutation.target.parentElement;
}

export function popupReopened(mutation: MutationRecord, element: HTMLElement): boolean {
  if (mutation.type !== 'attributes') return false;
  let wasHidden = false;
  if (mutation.attributeName === 'style') {
    wasHidden =
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/i.test(
        mutation.oldValue ?? '',
      );
  } else if (mutation.attributeName === 'hidden') {
    wasHidden = mutation.oldValue !== null;
  }
  if (!wasHidden || element.hidden) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function historyContentReopened(mutation: MutationRecord, element: Element | null): boolean {
  return (
    mutation.type === 'attributes' &&
    mutation.attributeName === 'style' &&
    !!element?.matches('.docs-blameview-content') &&
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test(mutation.oldValue ?? '') &&
    getComputedStyle(element).display !== 'none'
  );
}

function containsFormulaBar(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches('#t-formula-bar-input') || !!node.querySelector('#t-formula-bar-input');
}

export function formulaBarChanged(mutation: MutationRecord, element: Element | null): boolean {
  if (element?.closest('#t-formula-bar-input')) return true;
  if (mutation.type !== 'childList') return false;
  return [...mutation.addedNodes, ...mutation.removedNodes].some(containsFormulaBar);
}
