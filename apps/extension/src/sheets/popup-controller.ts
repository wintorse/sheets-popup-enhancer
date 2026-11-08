import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { settings, watchSettings } from '../settings';
import { isPartialHistory, parseHistory, readFormulaBar } from '../sheets/history';
import HistoryDiff from '../ui/HistoryDiff.svelte';
import ResizeGrip from '../ui/ResizeGrip.svelte';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
const POPUPS = '.docos-anchoreddocoview, .waffle-blameview';
const VALUE = '.docs-blameview-value-content';
const NAVIGATION_TIMEOUT = 250;
const RENDER_TIMEOUT = 1500;
const SHEET_SCROLL_SETTLE = 200;

import { clampPopup, setStyle, restoreProperty, syncGripPosition } from './popup-layout';
import type { Ui, ValueState, PopupState } from './popup-state';
import {
  mutationElement,
  popupReopened,
  historyContentReopened,
  formulaBarChanged,
} from './popup-mutations';

function setSheetScrolling(popup: HTMLElement, scrolling: boolean) {
  popup.toggleAttribute('data-spe-sheet-scrolling', scrolling);
  for (const host of popup.querySelectorAll('spe-history-diff'))
    host.toggleAttribute('data-spe-sheet-scrolling', scrolling);
}

export class PopupController {
  private style = document.createElement('style');
  private popups = new Map<HTMLElement, PopupState>();
  private sheetScrollTimer: ReturnType<typeof setTimeout> | undefined;
  private sheetScrollFrame = 0;
  private running = true;
  private frame = 0;
  private queue = new Set<HTMLElement>();
  private diffWasEnabled = false;
  private unsubscribe = () => {};
  private stopWatching = () => {};
  // Catch intrinsic size changes after Svelte renders, images load or fonts change.
  private sizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) this.schedule(entry.target as HTMLElement);
  });
  private observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) this.handleMutation(mutation);
  });

  private resetScrollWithin(root: Node, connectedOnly = false) {
    for (const popup of this.popups.keys()) {
      if (!this.isHistory(popup)) continue;
      if (connectedOnly && !popup.isConnected) continue;
      if (root === popup || root.contains(popup)) this.resetHistoryScroll(popup);
    }
  }

  private handleReopenedHistory(mutation: MutationRecord, target: Element | null) {
    if (!historyContentReopened(mutation, target)) return;
    const popup = target!.closest<HTMLElement>('.waffle-blameview');
    const state = popup && this.popups.get(popup);
    if (state) {
      state.pendingNavigation = undefined;
      state.contentWasHidden = true;
    }
  }

  private collectMutationNodes(mutation: MutationRecord, target: Element | null) {
    if (mutation.type !== 'childList') {
      this.collect(mutation.target);
      return;
    }
    if (mutation.removedNodes.length) {
      // A popup may be detached and reinserted before the next animation frame.
      for (const removed of mutation.removedNodes) this.resetScrollWithin(removed, true);
      this.schedule();
      this.collect(mutation.target);
    }
    for (const node of mutation.addedNodes) this.collect(node);
    if (target?.closest(VALUE)) this.collect(target);
  }

  private handleMutation(mutation: MutationRecord) {
    const target = mutationElement(mutation);
    if (target instanceof HTMLElement && popupReopened(mutation, target))
      this.resetScrollWithin(target);
    if (mutation.type === 'childList' || mutation.type === 'characterData') {
      const value = target?.closest<HTMLElement>(VALUE);
      if (value) delete value.dataset.speNativeVisible;
    }
    this.handleReopenedHistory(mutation, target);
    if (formulaBarChanged(mutation, target)) {
      for (const popup of this.popups.keys()) if (this.isHistory(popup)) this.schedule(popup);
    }
    this.collectMutationNodes(mutation, target);
  }

  constructor(
    private ctx: ContentScriptContext,
    private pageCss: string,
  ) {}
  start() {
    this.stopWatching = watchSettings();
    this.style.textContent = this.pageCss;
    document.documentElement.append(this.style);
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-disabled'],
    });
    document.addEventListener('wheel', this.onSheetWheel, { capture: true, passive: true });
    document.addEventListener('scroll', this.onSheetScroll, true);
    for (const popup of document.querySelectorAll<HTMLElement>(POPUPS)) this.schedule(popup);
    this.unsubscribe = settings.subscribe((value) => {
      this.style.textContent = `${this.pageCss}\n[data-spe-popup] { --spe-font-scale: ${value.fontScale / 100}; }`;
      document.documentElement.toggleAttribute('data-spe-diff-enabled', value.diffEnabled);
      if (value.diffEnabled && !this.diffWasEnabled) {
        for (const element of document.querySelectorAll<HTMLElement>('[data-spe-native-visible]'))
          delete element.dataset.speNativeVisible;
      }
      this.diffWasEnabled = value.diffEnabled;
      for (const [popup, state] of this.popups) {
        state.desiredWidth = this.defaultWidth(popup);
        this.schedule(popup);
      }
    });
    this.ctx.addEventListener(window, 'resize', () => {
      for (const popup of this.popups.keys()) this.schedule(popup);
    });
  }
  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.sheetScrollFrame) cancelAnimationFrame(this.sheetScrollFrame);
    if (this.sheetScrollTimer !== undefined) clearTimeout(this.sheetScrollTimer);
    document.removeEventListener('wheel', this.onSheetWheel, true);
    document.removeEventListener('scroll', this.onSheetScroll, true);
    this.observer.disconnect();
    this.sizeObserver.disconnect();
    this.unsubscribe();
    this.stopWatching();
    for (const [popup, state] of this.popups) this.disposePopup(popup, state);
    this.popups.clear();
    this.queue.clear();
    this.style.remove();
    delete document.documentElement.dataset.speDiffEnabled;
  }
  private clamp(element: HTMLElement) {
    clampPopup(element, this.popups.get(element)?.desiredWidth);
    syncGripPosition(element, this.popups.get(element));
  }
  private isHistory(element: HTMLElement) {
    return element.matches('.waffle-blameview');
  }
  private defaultWidth(element: HTMLElement) {
    return this.isHistory(element) ? get(settings).historyWidth : get(settings).commentWidth;
  }
  private sheetScrolling() {
    if (!this.running) return;
    if (this.sheetScrollTimer !== undefined) clearTimeout(this.sheetScrollTimer);
    if (this.sheetScrollFrame) cancelAnimationFrame(this.sheetScrollFrame);
    for (const [popup, state] of this.popups) {
      setSheetScrolling(popup, true);
      syncGripPosition(popup, state);
    }
    this.sheetScrollTimer = setTimeout(() => {
      this.sheetScrollTimer = undefined;
      // Apply our viewport bounds while hidden, then reveal on the next paint.
      for (const popup of this.popups.keys()) if (popup.isConnected) this.clamp(popup);
      this.sheetScrollFrame = requestAnimationFrame(() => {
        this.sheetScrollFrame = 0;
        for (const [popup, state] of this.popups) {
          setSheetScrolling(popup, false);
          syncGripPosition(popup, state);
        }
      });
    }, SHEET_SCROLL_SETTLE);
  }
  private onSheetWheel = (event: WheelEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!event.ctrlKey && target?.closest('#waffle-grid-container') && !target.closest(POPUPS))
      this.sheetScrolling();
  };
  private onSheetScroll = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.matches('#waffle-grid-container .native-scrollbar')) this.sheetScrolling();
  };
  private finishNavigation(
    popup: HTMLElement,
    state: PopupState,
    sequence = state.navigationSequence,
  ) {
    if (sequence !== state.navigationSequence) return;
    if (state.navigationTimer !== undefined) clearTimeout(state.navigationTimer);
    state.navigationTimer = undefined;
    delete popup.dataset.speHistoryLoading;
  }
  private resetHistoryScroll(element: HTMLElement) {
    if (!this.isHistory(element)) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
    syncGripPosition(element, this.popups.get(element));
  }
  private disposeValue(element: HTMLElement, state: ValueState) {
    state.disposed = true;
    state.ui?.remove();
    restoreProperty(element, 'display', state.display, state.priority);
  }
  private historyContentVisible(element: HTMLElement) {
    const content = element.closest<HTMLElement>('.docs-blameview-content');
    return !content || (!content.hidden && getComputedStyle(content).display !== 'none');
  }
  private historyContext(element: HTMLElement, popup: HTMLElement) {
    const partial = isPartialHistory(element);
    if (!partial && !element.querySelector('.waffle-blameview-formula-text'))
      return { signature: element.innerHTML, latest: false, currentValue: undefined };
    const buttons = popup.querySelectorAll('.docs-blameview-next-edit-button');
    const formulaNodes = document.querySelectorAll('#t-formula-bar-input > .cell-input');
    const formula = formulaNodes.length === 1 ? formulaNodes[0]! : null;
    const latest = buttons.length === 1 && buttons[0]?.getAttribute('aria-disabled') === 'true';
    const currentValue = readFormulaBar(formula);
    return {
      signature: JSON.stringify([element.innerHTML, latest, currentValue]),
      latest,
      currentValue,
    };
  }
  private valueAlreadyRendered(previous: ValueState | undefined, signature: string): boolean {
    return (
      previous?.signature === signature &&
      !!(previous.pending || previous.ui?.shadowHost.isConnected)
    );
  }

  private prepareValue(element: HTMLElement, popup: HTMLElement, state: PopupState) {
    const previous = state.values.get(element);
    const context = this.historyContext(element, popup);
    if (this.valueAlreadyRendered(previous, context.signature)) return;
    if (previous) {
      this.disposeValue(element, previous);
      state.values.delete(element);
    }
    const sequence = state.navigationSequence;
    if (!get(settings).diffEnabled) {
      this.finishNavigation(popup, state, sequence);
      return;
    }
    const parsed = parseHistory(element, context);
    if (!parsed.ok) {
      element.dataset.speNativeVisible = '';
      this.finishNavigation(popup, state, sequence);
      return;
    }
    delete element.dataset.speNativeVisible;
    const valueState: ValueState = {
      signature: context.signature,
      display: element.style.display,
      priority: element.style.getPropertyPriority('display'),
      pending: true,
      disposed: false,
    };
    state.values.set(element, valueState);
    return { valueState, change: parsed.change, sequence };
  }

  private deleteValue(element: HTMLElement, state: PopupState, valueState: ValueState) {
    this.disposeValue(element, valueState);
    if (state.values.get(element) === valueState) state.values.delete(element);
  }

  private renderTimeout(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    valueState: ValueState,
    sequence: number,
  ) {
    return setTimeout(() => {
      if (!valueState.pending || state.values.get(element) !== valueState || state.disposed) return;
      this.deleteValue(element, state, valueState);
      if (element.isConnected) element.dataset.speNativeVisible = '';
      this.finishNavigation(popup, state, sequence);
    }, RENDER_TIMEOUT);
  }

  private canMountValue(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    valueState: ValueState,
  ): boolean {
    return (
      this.running &&
      !state.disposed &&
      !valueState.disposed &&
      element.isConnected &&
      this.historyContext(element, popup).signature === valueState.signature &&
      state.pendingNavigation === undefined &&
      this.historyContentVisible(element)
    );
  }

  private mountValue(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    valueState: ValueState,
    ui: Ui,
    sequence: number,
  ) {
    if (!this.canMountValue(element, popup, state, valueState)) {
      ui.remove();
      if (state.values.get(element) === valueState) state.values.delete(element);
      this.schedule(popup);
      return;
    }
    valueState.ui = ui;
    ui.mount();
    if (popup.hasAttribute('data-spe-sheet-scrolling')) setSheetScrolling(popup, true);
    state.contentWasHidden = false;
    // Preserve original nodes for Sheets navigation and unsupported-history fallback.
    setStyle(element, 'display', 'none');
    this.finishNavigation(popup, state, sequence);
    this.clamp(popup);
  }

  private async enhanceValue(element: HTMLElement, popup: HTMLElement, state: PopupState) {
    const job = this.prepareValue(element, popup, state);
    if (!job) return;
    const { valueState, change, sequence } = job;
    const timeout = this.renderTimeout(element, popup, state, valueState, sequence);
    try {
      const ui = await createShadowRootUi(this.ctx, {
        name: 'spe-history-diff',
        position: 'inline',
        anchor: element,
        append: 'after',
        css: ':host { display: block !important; width: 100% !important; } :host([data-spe-sheet-scrolling]) * { visibility: hidden !important; }',
        onMount: (container) => mount(HistoryDiff, { target: container, props: { change } }),
        onRemove(app) {
          if (app) void unmount(app);
        },
      });
      this.mountValue(element, popup, state, valueState, ui, sequence);
    } catch (error) {
      this.deleteValue(element, state, valueState);
      if (sequence === state.navigationSequence && element.isConnected)
        element.dataset.speNativeVisible = '';
      this.finishNavigation(popup, state, sequence);
      console.warn('[Sheets Popup Enhancer] diff UIを設置できませんでした', error);
    } finally {
      clearTimeout(timeout);
      valueState.pending = false;
    }
  }

  private async addGrip(element: HTMLElement, state: PopupState) {
    if (state.grip && !state.grip.shadowHost.isConnected) {
      state.grip.remove();
      state.grip = undefined;
    }
    if (state.grip || state.pending) return;
    state.pending = true;
    try {
      const ui = await createShadowRootUi(this.ctx, {
        name: 'spe-resize-grip',
        position: 'inline',
        anchor: element,
        append: 'after',
        css: ':host { position: absolute !important; display: block !important; width: 24px !important; height: var(--spe-grip-height, 24px) !important; left: var(--spe-grip-left, 0px) !important; top: var(--spe-grip-top, 0px) !important; visibility: var(--spe-grip-visibility, hidden) !important; opacity: var(--spe-grip-opacity, 0) !important; z-index: var(--spe-grip-z-index, 10) !important; } :host([data-spe-grip-hidden]) * { visibility: hidden !important; }',
        onMount: (container) => {
          container.style.height = '100%';
          return mount(ResizeGrip, {
            target: container,
            props: {
              target: element,
              onresize: () => {
                state.desiredWidth = element.getBoundingClientRect().width;
                this.clamp(element);
              },
            },
          });
        },
        onRemove(app) {
          if (app) void unmount(app);
        },
      });
      if (!this.running || state.disposed || !element.isConnected) {
        ui.remove();
        return;
      }
      state.grip = ui;
      ui.mount();
      syncGripPosition(element, state);
    } catch (error) {
      console.warn('[Sheets Popup Enhancer] リサイズUIを設置できませんでした', error);
    } finally {
      state.pending = false;
    }
  }
  private registerPopup(element: HTMLElement): PopupState {
    const state: PopupState = {
      width: element.style.width,
      priority: element.style.getPropertyPriority('width'),
      left: element.style.left,
      leftPriority: element.style.getPropertyPriority('left'),
      top: element.style.top,
      topPriority: element.style.getPropertyPriority('top'),
      maxHeight: element.style.maxHeight,
      maxHeightPriority: element.style.getPropertyPriority('max-height'),
      minHeight: element.style.minHeight,
      minHeightPriority: element.style.getPropertyPriority('min-height'),
      desiredWidth: this.defaultWidth(element),
      pending: false,
      visible: false,
      disposed: false,
      contentWasHidden: false,
      values: new Map(),
      navigationSequence: 0,
      onNavigation: (event) => this.onNavigation(element, event),
    };
    this.popups.set(element, state);
    element.addEventListener('click', state.onNavigation, true);
    element.addEventListener('keydown', state.onNavigation, true);
    this.sizeObserver.observe(element);
    element.dataset.spePopup = this.isHistory(element) ? 'history' : 'comment';
    if (this.sheetScrollTimer !== undefined) element.dataset.speSheetScrolling = '';
    return state;
  }

  private navigationButton(element: HTMLElement, event: Event): Element | null {
    if (event instanceof KeyboardEvent) {
      if (event.key === 'ArrowLeft')
        return element.querySelector('.docs-blameview-previous-edit-button');
      if (event.key === 'ArrowRight')
        return element.querySelector('.docs-blameview-next-edit-button');
      return null;
    }
    const target = event.target instanceof Element ? event.target : null;
    return (
      target?.closest('.docs-blameview-previous-edit-button, .docs-blameview-next-edit-button') ??
      null
    );
  }

  private beginNavigation(element: HTMLElement, state: PopupState) {
    const enhanced = [...state.values.values()].some((value) => value.ui?.shadowHost.isConnected);
    if (!enhanced || !get(settings).diffEnabled) return;
    this.finishNavigation(element, state);
    const sequence = ++state.navigationSequence;
    element.dataset.speHistoryLoading = '';
    state.navigationTimer = setTimeout(() => {
      if (sequence !== state.navigationSequence || state.disposed) return;
      state.pendingNavigation = undefined;
      this.finishNavigation(element, state, sequence);
      this.schedule(element);
    }, NAVIGATION_TIMEOUT);
  }

  private clearValues(state: PopupState) {
    for (const [value, valueState] of state.values) this.disposeValue(value, valueState);
    state.values.clear();
  }

  private onNavigation(element: HTMLElement, event: Event) {
    const button = this.navigationButton(element, event);
    if (!button || button.getAttribute('aria-disabled') !== 'false') return;
    const current = element.querySelector<HTMLElement>(VALUE);
    const state = this.popups.get(element);
    if (!current || !state) return;
    if (event instanceof KeyboardEvent) this.resetHistoryScroll(element);
    delete current.dataset.speNativeVisible;
    this.beginNavigation(element, state);
    // At the end of history, Sheets hides content but retains its value DOM.
    state.pendingNavigation = undefined;
    if (!state.contentWasHidden && this.historyContentVisible(current))
      state.pendingNavigation = current.innerHTML;
    this.clearValues(state);
  }

  private updateVisibility(element: HTMLElement, state: PopupState) {
    const rect = element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    if (visible && !state.visible) {
      state.desiredWidth = this.defaultWidth(element);
      this.resetHistoryScroll(element);
    }
    state.visible = visible;
    if (!visible) {
      state.pendingNavigation = undefined;
      this.finishNavigation(element, state);
    }
    if (visible) this.clamp(element);
    else syncGripPosition(element, state);
  }

  private discardStaleValues(element: HTMLElement, state: PopupState) {
    for (const [value, valueState] of state.values) {
      if (element.contains(value) && get(settings).diffEnabled && this.historyContentVisible(value))
        continue;
      this.disposeValue(value, valueState);
      state.values.delete(value);
    }
  }

  private updatePendingNavigation(element: HTMLElement, state: PopupState) {
    const current = element.querySelector<HTMLElement>(VALUE);
    if (!current) return;
    if (!this.historyContentVisible(current)) state.contentWasHidden = true;
    if (state.pendingNavigation === undefined) return;
    // Complete values can render immediately. Partial histories wait for a value change.
    if (
      current.innerHTML !== state.pendingNavigation ||
      (this.historyContentVisible(current) && !isPartialHistory(current))
    ) {
      state.pendingNavigation = undefined;
    }
  }

  private syncHistory(element: HTMLElement, state: PopupState) {
    this.discardStaleValues(element, state);
    if (!get(settings).diffEnabled) this.finishNavigation(element, state);
    this.updatePendingNavigation(element, state);
    if (state.pendingNavigation !== undefined) return;
    for (const value of element.querySelectorAll<HTMLElement>(VALUE)) {
      if (this.historyContentVisible(value)) void this.enhanceValue(value, element, state);
    }
  }

  private sync(element: HTMLElement) {
    if (!element.isConnected || !this.running) return;
    const state = this.popups.get(element) ?? this.registerPopup(element);
    this.updateVisibility(element, state);
    void this.addGrip(element, state);
    if (this.isHistory(element)) this.syncHistory(element, state);
  }

  private disposePopup(element: HTMLElement, state: PopupState) {
    state.disposed = true;
    this.finishNavigation(element, state);
    this.sizeObserver.unobserve(element);
    element.removeEventListener('click', state.onNavigation, true);
    element.removeEventListener('keydown', state.onNavigation, true);
    state.grip?.remove();
    for (const [value, valueState] of state.values) this.disposeValue(value, valueState);
    for (const value of element.querySelectorAll<HTMLElement>('[data-spe-native-visible]'))
      delete value.dataset.speNativeVisible;
    restoreProperty(element, 'width', state.width, state.priority);
    restoreProperty(element, 'left', state.left, state.leftPriority);
    restoreProperty(element, 'top', state.top, state.topPriority);
    restoreProperty(element, 'max-height', state.maxHeight, state.maxHeightPriority);
    restoreProperty(element, 'min-height', state.minHeight, state.minHeightPriority);
    delete element.dataset.spePopup;
    delete element.dataset.speSheetScrolling;
  }
  private schedule(element?: HTMLElement) {
    if (!this.running) return;
    if (element) this.queue.add(element);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.running || this.ctx.isInvalid) return;
      for (const [popup, state] of this.popups)
        if (!popup.isConnected) {
          this.disposePopup(popup, state);
          this.popups.delete(popup);
        }
      const batch = Array.from(this.queue).slice(0, 20);
      for (const popup of batch) {
        this.queue.delete(popup);
        this.sync(popup);
      }
      if (this.queue.size) this.schedule();
    });
  }
  private collect(node: Node) {
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!element || element.closest('spe-history-diff, spe-resize-grip')) return;
    const popup = element.closest<HTMLElement>(POPUPS);
    if (popup) this.schedule(popup);
    for (const child of element.querySelectorAll<HTMLElement>(POPUPS)) this.schedule(child);
  }
}
