import type { PopupState } from './popup-state';
const POPUP_MARGIN = 12;
const POPUP_TOP_MARGIN = 145;
const POPUP_BOTTOM_MARGIN = 14;
const SHEET_TAB_BAR_HEIGHT = 36;

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

export function clampPopup(element: HTMLElement, desiredWidth: number | undefined) {
  let rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const width = Math.min(desiredWidth ?? rect.width, window.innerWidth - POPUP_MARGIN * 2);
  setStyle(element, 'width', `${Math.max(0, width)}px`);
  // Constrain the outer popup, including headers and borders, not only its body.
  // Match CSSOM serialization so our style observer settles after layout.
  setStyle(
    element,
    'max-height',
    `max(0px, 100dvh - ${POPUP_TOP_MARGIN + POPUP_BOTTOM_MARGIN + SHEET_TAB_BAR_HEIGHT}px)`,
  );
  setStyle(element, 'min-height', '0px');
  rect = element.getBoundingClientRect();
  const bottom = window.innerHeight - SHEET_TAB_BAR_HEIGHT - POPUP_BOTTOM_MARGIN;
  const dx =
    Math.max(POPUP_MARGIN, Math.min(rect.left, window.innerWidth - POPUP_MARGIN - rect.width)) -
    rect.left;
  const dy = Math.max(POPUP_TOP_MARGIN, Math.min(rect.top, bottom - rect.height)) - rect.top;
  const computed = getComputedStyle(element);
  const left = parseFloat(computed.left);
  const top = parseFloat(computed.top);
  if (dx)
    setStyle(element, 'left', `${(Number.isFinite(left) ? left : element.offsetLeft) + dx}px`);
  if (dy) setStyle(element, 'top', `${(Number.isFinite(top) ? top : element.offsetTop) + dy}px`);
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
    rect.width &&
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
  const height = Math.min(24, Math.max(0, rect.height - 2));
  // The sibling grip must share the popup's stacking level to stay above it.
  const popupZIndex = Number.parseInt(getComputedStyle(element).zIndex, 10);
  setStyle(
    host,
    '--spe-grip-z-index',
    `${Number.isFinite(popupZIndex) ? Math.max(10, popupZIndex) : 10}`,
  );
  setStyle(host, '--spe-grip-left', `${rect.right - 26 - origin.x}px`);
  setStyle(host, '--spe-grip-top', `${rect.bottom - height - 2 - origin.y}px`);
  setStyle(host, '--spe-grip-height', `${height}px`);
  const visible = gripVisible(element, rect);
  host.toggleAttribute('data-spe-grip-hidden', !visible);
  setStyle(host, '--spe-grip-visibility', visible ? 'visible' : 'hidden');
  setStyle(host, '--spe-grip-opacity', visible ? '1' : '0');
}
