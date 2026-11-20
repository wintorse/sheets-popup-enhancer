import type { PopupState } from './popup-state';
const POPUP_TOP_MARGIN = 145;
const POPUP_BOTTOM_MARGIN = 14;
const SHEET_TAB_BAR_HEIGHT = 36;
export const GRIP_SIZE = 24;
const GRIP_INSET = 2;
const MIN_GRIP_Z_INDEX = 10;

export function setStyle(element: HTMLElement, name: string, value: string) {
  if (
    element.style.getPropertyValue(name) !== value ||
    element.style.getPropertyPriority(name) !== 'important'
  )
    element.style.setProperty(name, value, 'important');
}
export function restoreProperty(
  element: HTMLElement,
  name: string,
  value: string,
  priority: string,
) {
  if (value) element.style.setProperty(name, value, priority);
  else element.style.removeProperty(name);
}

export function layoutPopup(element: HTMLElement, state: PopupState) {
  // Measure Sheets' current placement without our width or position overrides.
  delete element.dataset.speLayout;
  const native = element.getBoundingClientRect();
  if (!native.width || !native.height) return;
  const width = Math.max(0, Math.min(state.desiredWidth, window.innerWidth));
  const rightLimit = window.innerWidth - width;
  // A native move starts a new placement. A completed left-grip resize keeps the
  // popup at the viewport edge while Sheets keeps it at the same native position.
  if (state.pinnedRightAt !== native.left) state.pinnedRightAt = undefined;
  state.leftGrip = state.pinnedRightAt !== undefined || native.left >= rightLimit;
  let left = state.leftGrip ? rightLimit : Math.max(0, native.left);
  if (state.resizeEdge) {
    const edge = state.resizeEdge;
    edge.nativeLeft = native.left;
    left = Math.max(0, Math.min(edge.position - (edge.leftGrip ? width : 0), rightLimit));
    state.leftGrip = edge.leftGrip;
  }
  setStyle(element, '--spe-width', `${width}px`);
  setStyle(
    element,
    'max-height',
    `max(0px, 100dvh - ${POPUP_TOP_MARGIN + POPUP_BOTTOM_MARGIN + SHEET_TAB_BAR_HEIGHT}px)`,
  );
  setStyle(element, 'min-height', '0px');
  element.dataset.speLayout = 'sizing';
  const resized = element.getBoundingClientRect();
  const bottom = window.innerHeight - SHEET_TAB_BAR_HEIGHT - POPUP_BOTTOM_MARGIN;
  const top = Math.max(POPUP_TOP_MARGIN, Math.min(native.top, bottom - resized.height));
  const dx = left - resized.left;
  const dy = top - resized.top;
  const computed = getComputedStyle(element);
  const nativeLeft = parseFloat(computed.left);
  const nativeTop = parseFloat(computed.top);
  setStyle(
    element,
    '--spe-left',
    `${(Number.isFinite(nativeLeft) ? nativeLeft : element.offsetLeft) + dx}px`,
  );
  setStyle(
    element,
    '--spe-top',
    `${(Number.isFinite(nativeTop) ? nativeTop : element.offsetTop) + dy}px`,
  );
  element.dataset.speLayout = 'positioned';
}

function gripOffsetParent(host: HTMLElement): HTMLElement | null {
  const parent = host.offsetParent;
  if (!(parent instanceof HTMLElement)) return null;
  // A static body is reported as offsetParent even though the containing block is the viewport.
  const style = getComputedStyle(parent);
  if (parent === document.body && style.position === 'static' && style.transform === 'none')
    return null;
  return parent;
}

function gripOrigin(host: HTMLElement): { x: number; y: number } {
  const parent = gripOffsetParent(host);
  if (!parent) return { x: -window.scrollX, y: -window.scrollY };
  const rect = parent.getBoundingClientRect();
  return {
    x: rect.left + parent.clientLeft - parent.scrollLeft,
    y: rect.top + parent.clientTop - parent.scrollTop,
  };
}

function gripVisible(element: HTMLElement, rect: DOMRect): boolean {
  return !!(
    rect.width >= GRIP_SIZE + GRIP_INSET &&
    rect.height &&
    !element.hasAttribute('data-spe-sheet-scrolling') &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}

export function syncGripPosition(element: HTMLElement, state: PopupState | undefined) {
  if (!state?.grip) return;
  const host = state.grip.shadowHost;
  const rect = element.getBoundingClientRect();
  const origin = gripOrigin(host);
  const height = Math.min(GRIP_SIZE, Math.max(0, rect.height - GRIP_INSET));
  // The sibling grip must share the popup's stacking level to stay above it.
  const popupZIndex = Number.parseInt(getComputedStyle(element).zIndex, 10);
  setStyle(
    host,
    '--spe-grip-z-index',
    `${Number.isFinite(popupZIndex) ? Math.max(MIN_GRIP_Z_INDEX, popupZIndex) : MIN_GRIP_Z_INDEX}`,
  );
  const leftGrip = state.leftGrip;
  const left = leftGrip ? rect.left + GRIP_INSET : rect.right - GRIP_SIZE - GRIP_INSET;
  host.toggleAttribute('data-spe-grip-left', leftGrip);
  setStyle(host, '--spe-grip-left', `${left - origin.x}px`);
  setStyle(host, '--spe-grip-top', `${rect.bottom - height - GRIP_INSET - origin.y}px`);
  setStyle(host, '--spe-grip-height', `${height}px`);
  const visible = gripVisible(element, rect);
  host.toggleAttribute('data-spe-grip-hidden', !visible);
  setStyle(host, '--spe-grip-visibility', visible ? 'visible' : 'hidden');
  setStyle(host, '--spe-grip-opacity', visible ? '1' : '0');
}
