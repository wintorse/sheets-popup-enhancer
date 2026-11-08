import { describe, expect, it, vi } from 'vitest';
import { clampWidth, resizeHandle } from './index';

describe('resize constraints', () => {
  it('respects minimum, maximum and viewports narrower than the minimum', () => {
    expect(clampWidth(100, 280, 1200)).toBe(280);
    expect(clampWidth(1800, 280, 1200)).toBe(1200);
    expect(clampWidth(400, 280, 200)).toBe(200);
  });

  it('leaves arrow keys available to native history navigation', () => {
    const target = document.createElement('div');
    target.style.width = '400px';
    const parent = document.createElement('div');
    const handle = document.createElement('div');
    parent.append(handle);
    const navigate = vi.fn();
    parent.addEventListener('keydown', navigate);
    const onresize = vi.fn();
    const oncommit = vi.fn();
    const action = resizeHandle(handle, { target, onresize, oncommit });
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      handle.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(target.style.width).toBe('400px');
    expect(onresize).not.toHaveBeenCalled();
    expect(oncommit).not.toHaveBeenCalled();
    action.destroy();
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
    'resizes by dragging and cleans up on %s',
    (endEvent) => {
      const target = document.createElement('div');
      target.style.width = '400px';
      const handle = document.createElement('div');
      vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
        () => ({ width: parseFloat(target.style.width) }) as DOMRect,
      );
      const setPointerCapture = vi.fn();
      const releasePointerCapture = vi.fn();
      handle.setPointerCapture = setPointerCapture;
      handle.hasPointerCapture = vi.fn(() => true);
      handle.releasePointerCapture = releasePointerCapture;
      const oncommit = vi.fn();
      const action = resizeHandle(handle, { target, maxWidth: 450, oncommit });
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 100 }),
      );
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200 }));
      handle.dispatchEvent(new PointerEvent(endEvent, { pointerId: 1 }));
      expect(target.style.width).toBe('450px');
      expect(oncommit).toHaveBeenCalledWith(450);
      expect(releasePointerCapture).toHaveBeenCalledWith(1);
      action.destroy();
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 2, button: 0, clientX: 100 }),
      );
      expect(setPointerCapture).toHaveBeenCalledTimes(1);
    },
  );
});
