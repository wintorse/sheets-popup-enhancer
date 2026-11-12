interface Placement {
  element: HTMLElement;
  grid: HTMLElement | undefined;
  anchor: Comment;
}

function activeGrid(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[id$="-grid-container"]')].find(
    (grid) =>
      /^\d+-grid-container$/.test(grid.id) &&
      grid.getClientRects().length > 0 &&
      getComputedStyle(grid).visibility !== 'hidden',
  );
}

function moveElement(parent: HTMLElement, element: HTMLElement, before: Node | null) {
  // Atomic moves preserve state on newer browsers; detached nodes need insertion.
  if (typeof parent.moveBefore === 'function' && parent.isConnected === element.isConnected)
    parent.moveBefore(element, before);
  else parent.insertBefore(element, before);
}

/** Optional compatibility with the DOM added by Sheets Row Highlighter. */
export class RowHighlighterCompatibility {
  private enabled = false;
  private frame = 0;
  private placement: Placement | undefined;
  // Watch visibility too: Sheets can cache grids and hide them when switching tabs.
  private observer = new MutationObserver(() => this.schedule());

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      return;
    }
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'style', 'class', 'hidden'],
    });
    this.schedule();
  }

  stop() {
    this.enabled = false;
    this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.restore();
  }

  private schedule() {
    if (!this.enabled || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  private sync() {
    const element = this.findElement();
    if (!(element instanceof HTMLElement)) return;
    const grid = activeGrid();
    if (!grid) {
      this.park();
      return;
    }
    if (element.contains(grid)) return;
    if (!this.placement) {
      const anchor = document.createComment('spe-row-highlighter-position');
      element.before(anchor);
      this.placement = { element, grid, anchor };
    }
    this.placement.grid = grid;
    element.setAttribute('data-spe-row-highlighter', '');
    if (grid.lastChild !== element) moveElement(grid, element, null);
  }

  private findElement(): HTMLElement | null {
    const element = document.getElementById('rh-app-container');
    const placement = this.placement;
    if (!placement || placement.element === element) return element;
    // Keep the same app when Sheets removes its grid or clears that grid's children.
    // Prefer a replacement app if the other extension creates one.
    if (
      !element &&
      placement.grid &&
      (placement.element.parentElement === placement.grid || !placement.element.parentNode)
    )
      return placement.element;
    this.restore();
    return element;
  }

  private park() {
    if (!this.placement) return;
    const { element, grid, anchor } = this.placement;
    const parent = anchor.parentElement;
    if (!parent?.isConnected || element.parentElement !== grid) return;
    element.removeAttribute('data-spe-row-highlighter');
    moveElement(parent, element, anchor);
    this.placement.grid = undefined;
  }

  private restore() {
    if (!this.placement) return;
    const { element, grid, anchor } = this.placement;
    element.removeAttribute('data-spe-row-highlighter');
    // Restore from a detached grid too, without moving an app already replaced elsewhere.
    const parent = anchor.parentElement;
    if (element.parentElement === grid && parent?.isConnected) moveElement(parent, element, anchor);
    anchor.remove();
    this.placement = undefined;
  }
}
