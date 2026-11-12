import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { settings, watchSettings } from '../settings';
import { isPartialHistory, parseHistory, readFormulaBar, type CellChange } from '../sheets/history';
import HistoryDiff from '../ui/HistoryDiff.svelte';
import ResizeGrip from '../ui/ResizeGrip.svelte';
import { RowHighlighterCompatibility } from './row-highlighter';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
const POPUPS = '.docos-anchoreddocoview, .waffle-blameview';
const VALUE = '.docs-blameview-value-content';
const NAVIGATION_TIMEOUT = 250;
const RENDER_TIMEOUT = 1500;
const SHEET_SCROLL_SETTLE = 200;

import { clampPopup, setStyle, restoreProperty, syncGripPosition } from './popup-layout';
import type { Ui, PopupState } from './popup-state';
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
  private rowHighlighter = new RowHighlighterCompatibility();
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
      this.hideChangedNativeValue(target);
    }
    this.handleReopenedHistory(mutation, target);
    if (formulaBarChanged(mutation, target)) {
      for (const popup of this.popups.keys()) if (this.isHistory(popup)) this.schedule(popup);
    }
    this.collectMutationNodes(mutation, target);
  }

  private hideChangedNativeValue(target: Element | null) {
    const value = target?.closest<HTMLElement>(VALUE);
    if (!value?.hasAttribute('data-spe-native-visible')) return;
    const popup = value.closest<HTMLElement>('.waffle-blameview');
    const job = popup && this.popups.get(popup)?.renders.get(value);
    if (popup && job?.timedOut && job.signature === this.historyContext(value, popup).signature)
      return;
    delete value.dataset.speNativeVisible;
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
      this.rowHighlighter.setEnabled(value.rowHighlighterCompatibility);
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
    this.rowHighlighter.stop();
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
  private finishNavigation(popup: HTMLElement, state: PopupState, shownValue?: HTMLElement) {
    if (state.navigationTimer !== undefined) clearTimeout(state.navigationTimer);
    state.navigationTimer = undefined;
    state.pendingNavigation = undefined;
    const outgoing = state.outgoingValue;
    state.outgoingValue = undefined;
    if (outgoing && outgoing !== shownValue) this.deleteValue(outgoing, state);
    delete popup.dataset.speHistoryLoading;
  }
  private resetHistoryScroll(element: HTMLElement) {
    if (!this.isHistory(element)) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
    syncGripPosition(element, this.popups.get(element));
  }
  private deleteValue(element: HTMLElement, state: PopupState) {
    const value = state.values.get(element);
    if (!value) return;
    value.ui.remove();
    restoreProperty(element, 'display', value.display, value.priority);
    state.values.delete(element);
  }
  private historyContentVisible(element: HTMLElement) {
    const content = element.closest<HTMLElement>('.docs-blameview-content');
    return !content || (!content.hidden && getComputedStyle(content).display !== 'none');
  }

  private historyEndShown(popup: HTMLElement) {
    const message = popup.querySelector<HTMLElement>('.docs-blameview-message');
    return (
      !!message?.textContent?.trim() &&
      message.getClientRects().length > 0 &&
      getComputedStyle(message).visibility === 'visible' &&
      !!popup.querySelector('.docs-blameview-previous-edit-button[aria-disabled="true"]') &&
      !!popup.querySelector('.docs-blameview-next-edit-button[aria-disabled="false"]')
    );
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
  private showNativeValue(element: HTMLElement, popup: HTMLElement, state: PopupState) {
    this.deleteValue(element, state);
    element.dataset.speNativeVisible = '';
    this.finishNavigation(popup, state);
  }

  private mountValue(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    signature: string,
    ui: Ui,
  ) {
    // Mount first so the old diff remains visible until its replacement is ready.
    ui.mount();
    const previous = state.values.get(element);
    const display = previous?.display ?? element.style.display;
    const priority = previous?.priority ?? element.style.getPropertyPriority('display');
    previous?.ui.remove();
    state.values.set(element, { signature, display, priority, ui });
    if (popup.hasAttribute('data-spe-sheet-scrolling')) setSheetScrolling(popup, true);
    state.contentWasHidden = false;
    // Preserve original nodes for Sheets navigation and unsupported-history fallback.
    setStyle(element, 'display', 'none');
    delete element.dataset.speNativeVisible;
    this.finishNavigation(popup, state, element);
    this.clamp(popup);
  }

  private async enhanceValue(element: HTMLElement, popup: HTMLElement, state: PopupState) {
    const context = this.historyContext(element, popup);
    const { signature } = context;
    const previous = state.values.get(element);
    if (previous?.signature === signature && popup.contains(previous.ui.shadowHost)) {
      state.renders.delete(element);
      if (state.outgoingValue === element) {
        if (element.nextElementSibling !== previous.ui.shadowHost)
          element.after(previous.ui.shadowHost);
        state.contentWasHidden = false;
        this.finishNavigation(popup, state, element);
      }
      return;
    }
    const pending = state.renders.get(element);
    if (pending?.signature === signature) {
      if (pending.timedOut) this.showNativeValue(element, popup, state);
      return;
    }
    const parsed = parseHistory(element, context);
    if (!parsed.ok) {
      state.renders.delete(element);
      this.showNativeValue(element, popup, state);
      return;
    }
    delete element.dataset.speNativeVisible;
    await this.renderValue(element, popup, state, signature, parsed.change);
  }

  private async renderValue(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    signature: string,
    change: CellChange,
  ) {
    const job = { signature, timedOut: false };
    state.renders.set(element, job);
    const isCurrent = () => state.renders.get(element) === job;
    const timeout = setTimeout(() => {
      // Keep the job so showing the native value cannot trigger a second render.
      job.timedOut = true;
      if (isCurrent()) this.schedule(popup);
    }, RENDER_TIMEOUT);
    let ui: Ui | undefined;
    try {
      ui = await createShadowRootUi(this.ctx, {
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
      if (isCurrent() && this.canMountValue(element, popup, state, signature)) {
        this.mountValue(element, popup, state, signature, ui);
      } else {
        ui.remove();
        this.schedule(popup);
      }
    } catch (error) {
      ui?.remove();
      if (isCurrent() && this.canMountValue(element, popup, state, signature))
        this.showNativeValue(element, popup, state);
      console.warn('[Sheets Popup Enhancer] diff UIを設置できませんでした', error);
    } finally {
      clearTimeout(timeout);
      if (isCurrent()) state.renders.delete(element);
    }
  }

  private canMountValue(
    element: HTMLElement,
    popup: HTMLElement,
    state: PopupState,
    signature: string,
  ): boolean {
    return (
      this.running &&
      !state.disposed &&
      popup.isConnected &&
      popup.contains(element) &&
      get(settings).diffEnabled &&
      state.pendingNavigation === undefined &&
      this.historyContentVisible(element) &&
      this.historyContext(element, popup).signature === signature
    );
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
      renders: new Map(),
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

  private onNavigation(element: HTMLElement, event: Event) {
    const button = this.navigationButton(element, event);
    if (!button || button.getAttribute('aria-disabled') !== 'false') return;
    const state = this.popups.get(element);
    if (!state) return;
    if (event instanceof KeyboardEvent) this.resetHistoryScroll(element);
    if (!get(settings).diffEnabled) return;
    const current = element.querySelector<HTMLElement>(VALUE);
    const outgoing = state.outgoingValue ?? this.renderedValue(state, current);
    if (!outgoing) return;

    state.renders.clear();
    state.outgoingValue = outgoing;
    element.dataset.speHistoryLoading = '';
    // A hidden or replaced native value can be ready even when its HTML is unchanged.
    state.pendingNavigation =
      current === outgoing && !state.contentWasHidden && this.historyContentVisible(current)
        ? current.innerHTML
        : undefined;
    if (state.navigationTimer !== undefined) clearTimeout(state.navigationTimer);
    state.navigationTimer = setTimeout(() => {
      state.navigationTimer = undefined;
      state.pendingNavigation = undefined;
      this.schedule(element);
    }, NAVIGATION_TIMEOUT);
    this.schedule(element);
  }

  private renderedValue(state: PopupState, current: HTMLElement | null) {
    if (current && state.values.has(current)) return current;
    if (state.values.size === 1) return state.values.keys().next().value;
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

  private discardStaleValues(popup: HTMLElement, state: PopupState, visible: HTMLElement[]) {
    for (const value of state.renders.keys()) {
      if (!popup.contains(value)) state.renders.delete(value);
    }
    for (const value of state.values.keys()) {
      if (value !== state.outgoingValue && !visible.includes(value)) this.deleteValue(value, state);
    }
  }

  private keepOutgoingVisible(popup: HTMLElement, state: PopupState) {
    const outgoing = state.outgoingValue;
    if (!outgoing) return;
    const host = state.values.get(outgoing)?.ui.shadowHost;
    if (!host || (popup.contains(host) && this.historyContentVisible(host))) return;
    // Sheets can temporarily hide or replace the container that held the old diff.
    const content = outgoing.closest('.docs-blameview-content');
    if (content && popup.contains(content)) content.after(host);
    else (popup.querySelector('.docs-blameview') ?? popup).append(host);
  }

  private syncHistory(element: HTMLElement, state: PopupState) {
    if (!get(settings).diffEnabled) {
      this.finishNavigation(element, state);
      state.renders.clear();
      this.discardStaleValues(element, state, []);
      return;
    }
    const values = [...element.querySelectorAll<HTMLElement>(VALUE)];
    const visible = values.filter((value) => this.historyContentVisible(value));
    this.discardStaleValues(element, state, visible);
    const current = visible[0];
    if (!current) {
      state.contentWasHidden = true;
      if (state.outgoingValue && this.historyEndShown(element))
        this.finishNavigation(element, state);
      return;
    }
    if (state.pendingNavigation !== undefined) {
      if (current === state.outgoingValue && current.innerHTML === state.pendingNavigation) return;
      state.pendingNavigation = undefined;
    }
    for (const value of visible) void this.enhanceValue(value, element, state);
  }

  private sync(element: HTMLElement) {
    if (!element.isConnected || !this.running) return;
    const state = this.popups.get(element) ?? this.registerPopup(element);
    // The popup can have zero height while Sheets replaces all of its content.
    this.keepOutgoingVisible(element, state);
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
    state.renders.clear();
    for (const value of state.values.keys()) this.deleteValue(value, state);
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
