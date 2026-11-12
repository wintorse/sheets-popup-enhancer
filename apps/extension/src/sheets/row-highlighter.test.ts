import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowHighlighterCompatibility } from './row-highlighter';

const compatibility = new RowHighlighterCompatibility();

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mockGridVisibility(grid: HTMLElement) {
  // jsdom has no layout. Browser tests exercise real grid visibility and CSS.
  vi.spyOn(grid, 'getClientRects').mockImplementation(
    () => ({ length: grid.hidden ? 0 : 1 }) as DOMRectList,
  );
}

function fixture() {
  // Synthetic structure, not captured Sheets or Row Highlighter DOM.
  document.body.innerHTML =
    '<div id="original"><span></span><div id="rh-app-container"></div><button></button></div><div id="0-grid-container"></div>';
  mockGridVisibility(document.getElementById('0-grid-container')!);
  return {
    element: document.getElementById('rh-app-container')!,
    original: document.getElementById('original')!,
    grid: document.getElementById('0-grid-container')!,
  };
}

afterEach(() => {
  compatibility.stop();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('Row Highlighter compatibility', () => {
  it('preserves node identity, listeners, and the original sibling position on disable', async () => {
    const { element, original, grid } = fixture();
    let clicks = 0;
    element.addEventListener('click', () => clicks++);
    compatibility.setEnabled(true);
    await settle();
    expect(grid.lastChild).toBe(element);
    element.dispatchEvent(new MouseEvent('click'));
    expect(clicks).toBe(1);
    compatibility.setEnabled(false);
    expect(original.children[1]).toBe(element);
    expect(element.hasAttribute('data-spe-row-highlighter')).toBe(false);
    expect(original.childNodes).toHaveLength(3);
  });

  it('handles a late grid and replacement highlighter without restoring removed nodes', async () => {
    const { element, original, grid } = fixture();
    grid.remove();
    compatibility.setEnabled(true);
    await settle();
    expect(element.parentElement).toBe(original);
    document.body.append(grid);
    await settle();
    expect(grid.lastChild).toBe(element);
    element.remove();
    const replacement = document.createElement('div');
    replacement.id = 'rh-app-container';
    original.append(replacement);
    await settle();
    expect(grid.lastChild).toBe(replacement);
    compatibility.stop();
    expect(replacement.parentElement).toBe(original);
    expect(element.isConnected).toBe(false);
    expect(element.hasAttribute('data-spe-row-highlighter')).toBe(false);
  });

  it('does not move the highlighter into a detached original parent on stop', async () => {
    const { element, original, grid } = fixture();
    compatibility.setEnabled(true);
    await settle();
    original.remove();
    compatibility.stop();
    expect(element.parentElement).toBe(grid);
    expect(element.hasAttribute('data-spe-row-highlighter')).toBe(false);
    expect(original.childNodes).toHaveLength(2);
  });

  it('moves the same app between cached sheets and restores the original position', async () => {
    const { element, original, grid } = fixture();
    const second = document.createElement('div');
    second.id = '123-grid-container';
    second.hidden = true;
    mockGridVisibility(second);
    document.body.append(second);
    compatibility.setEnabled(true);
    await settle();
    expect(grid.lastChild).toBe(element);
    grid.hidden = true;
    second.hidden = false;
    await settle();
    expect(second.lastChild).toBe(element);
    second.hidden = true;
    grid.hidden = false;
    await settle();
    expect(grid.lastChild).toBe(element);
    compatibility.stop();
    expect(original.children[1]).toBe(element);
    expect(original.childNodes).toHaveLength(3);
  });

  it('rescues the app when its grid is removed before a replacement arrives', async () => {
    const { element, original, grid } = fixture();
    let clicks = 0;
    element.addEventListener('click', () => clicks++);
    compatibility.setEnabled(true);
    await settle();
    grid.remove();
    await settle();
    expect(element.parentElement).toBe(original);
    expect(element.hasAttribute('data-spe-row-highlighter')).toBe(false);
    const replacement = document.createElement('div');
    replacement.id = '456-grid-container';
    mockGridVisibility(replacement);
    document.body.append(replacement);
    await settle();
    expect(replacement.lastChild).toBe(element);
    element.dispatchEvent(new MouseEvent('click'));
    expect(clicks).toBe(1);
    compatibility.stop();
    expect(original.children[1]).toBe(element);
  });

  it('retains the app when Sheets clears the children of a reused grid', async () => {
    const { element, original, grid } = fixture();
    compatibility.setEnabled(true);
    await settle();
    grid.replaceChildren(document.createElement('canvas'));
    await settle();
    expect(grid.lastChild).toBe(element);
    expect(document.querySelectorAll('#rh-app-container')).toHaveLength(1);
    compatibility.stop();
    expect(original.children[1]).toBe(element);
  });

  it('restores an app from a detached grid if disabled before the next frame', async () => {
    const { element, original, grid } = fixture();
    compatibility.setEnabled(true);
    await settle();
    grid.remove();
    compatibility.setEnabled(false);
    expect(original.children[1]).toBe(element);
    expect(element.hasAttribute('data-spe-row-highlighter')).toBe(false);
  });

  it('cancels pending moves and leaves later additions alone after stop', async () => {
    const { element, original, grid } = fixture();
    compatibility.setEnabled(true);
    compatibility.stop();
    await settle();
    expect(element.parentElement).toBe(original);
    grid.append(document.createElement('span'));
    await settle();
    expect(element.parentElement).toBe(original);
  });
});
