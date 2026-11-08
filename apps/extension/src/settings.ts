import { writable } from 'svelte/store';
import { browser } from 'wxt/browser';
import type { DiffLayout } from '@spe/diff-ui';

export interface Settings {
  commentWidth: number;
  historyWidth: number;
  fontScale: number;
  layout: DiffLayout;
  diffEnabled: boolean;
}
export const defaults: Settings = {
  commentWidth: 440,
  historyWidth: 620,
  fontScale: 100,
  layout: 'split',
  diffEnabled: true,
};
export const settings = writable<Settings>({ ...defaults });
const KEY = 'spe.settings.v1';

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step = 1,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value / step) * step));
}

export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    commentWidth: normalizeNumber(raw.commentWidth, defaults.commentWidth, 280, 1600),
    historyWidth: normalizeNumber(raw.historyWidth, defaults.historyWidth, 280, 1600),
    fontScale: normalizeNumber(raw.fontScale, defaults.fontScale, 80, 120, 10),
    layout: raw.layout === 'unified' || raw.layout === 'vertical' ? 'unified' : defaults.layout,
    diffEnabled: typeof raw.diffEnabled === 'boolean' ? raw.diffEnabled : defaults.diffEnabled,
  };
}

export async function loadSettings() {
  const stored = await browser.storage.local.get(KEY);
  settings.set(normalizeSettings(stored[KEY]));
}
export async function saveSettings(value: Settings) {
  const normalized = normalizeSettings(value);
  await browser.storage.local.set({ [KEY]: normalized });
  settings.set(normalized);
}
export function watchSettings() {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEY]) settings.set(normalizeSettings(changes[KEY].newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
