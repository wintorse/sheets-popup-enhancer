export interface ResizeOptions {
  target: HTMLElement;
  minWidth?: number;
  maxWidth?: number | (() => number);
  onresize?: (width: number) => void;
  oncommit?: (width: number) => void;
}

export function clampWidth(width: number, min: number, max: number) {
  return Math.min(Math.max(0, max), Math.max(Math.min(min, max), width));
}

// Svelte action, also usable directly against a handle in an existing page.
export function resizeHandle(handle: HTMLElement, initial: ResizeOptions) {
  let options = initial;
  let active: { id: number; x: number; width: number } | undefined;
  let frame = 0;
  let pending: number | undefined;
  const view = handle.ownerDocument.defaultView!;
  function bounds() {
    return {
      min: options.minWidth ?? 260,
      max:
        typeof options.maxWidth === 'function'
          ? options.maxWidth()
          : (options.maxWidth ?? view.innerWidth - 24),
    };
  }
  function write(width: number) {
    const { min, max } = bounds();
    const value = Math.round(clampWidth(width, min, max));
    options.target.style.setProperty('width', `${value}px`, 'important');
    options.onresize?.(value);
    return value;
  }
  function flush() {
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    if (pending !== undefined) {
      write(pending);
      pending = undefined;
    }
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || active) return;
    event.preventDefault();
    event.stopPropagation();
    active = {
      id: event.pointerId,
      x: event.clientX,
      width: options.target.getBoundingClientRect().width,
    };
    handle.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!active || event.pointerId !== active.id) return;
    pending = active.width + event.clientX - active.x;
    if (!frame)
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        flush();
      });
  }
  function finish(event: PointerEvent) {
    if (!active || event.pointerId !== active.id) return;
    flush();
    const id = active.id;
    active = undefined;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    options.oncommit?.(options.target.getBoundingClientRect().width);
  }
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  return {
    update(next: ResizeOptions) {
      options = next;
    },
    destroy() {
      if (frame) view.cancelAnimationFrame(frame);
      const id = active?.id;
      active = undefined;
      if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      handle.removeEventListener('lostpointercapture', finish);
    },
  };
}
