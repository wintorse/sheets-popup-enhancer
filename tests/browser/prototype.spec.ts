import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function extensionOutput(asset: string) {
  const browser = test.info().project.name === 'firefox' ? 'firefox' : 'chrome';
  return resolve(`apps/extension/.output/${browser}-mv3`, asset);
}

function gripHost(popup: Locator) {
  return popup.locator('xpath=following-sibling::spe-resize-grip[1]');
}

async function dragHandle(page: Page, grip: Locator, delta: number) {
  const rect = await grip.boundingBox();
  if (!rect) throw new Error('resize grip missing');
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + 10 + delta, rect.y + 10, { steps: 8 });
  await page.mouse.up();
}

function extensionContentType(asset: string): string {
  if (asset.endsWith('.css')) return 'text/css';
  if (asset.endsWith('.html')) return 'text/html';
  return 'application/javascript';
}

async function mockExtension(page: Page) {
  await page.route('**/__extension__/**', async (route) => {
    const asset = new URL(route.request().url()).pathname.split('/__extension__/')[1];
    if (!asset || asset.includes('..')) return route.abort();
    const file = extensionOutput(asset);
    const body = asset.endsWith('.html')
      ? (await readFile(file, 'utf8')).replaceAll('="/', '="/__extension__/')
      : await readFile(file);
    await route.fulfill({ body, contentType: extensionContentType(asset) });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ja' });
    const listeners = new Set<(changes: unknown, area: string) => void>();
    let data: Record<string, unknown> = {};
    const storage = {
      async get() {
        return data;
      },
      async set(value: Record<string, unknown>) {
        const previous = data;
        data = { ...data, ...value };
        for (const listener of listeners)
          listener(
            Object.fromEntries(
              Object.entries(value).map(([key, newValue]) => [
                key,
                { oldValue: previous[key], newValue },
              ]),
            ),
            'local',
          );
      },
    };
    const extensionApi = {
      runtime: {
        id: 'prototype-test',
        getURL: (path: string) => `${location.origin}/__extension__/${path.replace(/^\//, '')}`,
      },
      storage: {
        local: storage,
        onChanged: {
          addListener: (listener: (changes: unknown, area: string) => void) =>
            listeners.add(listener),
          removeListener: (listener: (changes: unknown, area: string) => void) =>
            listeners.delete(listener),
        },
      },
    };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: extensionApi });
    Object.defineProperty(globalThis, 'browser', { configurable: true, value: extensionApi });
  });
}

// These fixtures emulate Sheets markup and exercise the bundled content script.
async function openDiffFixture(page: Page) {
  await mockExtension(page);
  await page.route('**/fixtures/diff-view', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced</span> "old" <span class="docs-blame-bold-text">with</span> "new"</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/diff-view');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  await expect(page.locator('spe-history-diff table')).toHaveClass(/split/);
}

async function setHistoryValues(page: Page, before: string, after: string) {
  await page.locator('.docs-blameview-value-content').evaluate(
    (node, values) => {
      const label = (text: string) => {
        const span = document.createElement('span');
        span.className = 'docs-blame-bold-text';
        span.textContent = text;
        return span;
      };
      if (!values.before) {
        node.replaceChildren(label('Added:'), document.createTextNode(' "' + values.after + '"'));
      } else if (!values.after) {
        node.replaceChildren(
          label('Deleted:'),
          document.createTextNode(' "' + values.before + '"'),
        );
      } else {
        node.replaceChildren(
          label('Replaced'),
          document.createTextNode(' "' + values.before + '" '),
          label('with'),
          document.createTextNode(' "' + values.after + '"'),
        );
      }
    },
    { before, after },
  );
}

test('content script: diff rows, layout menu, and one-sided changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDiffFixture(page);
  const diff = page.locator('spe-history-diff');
  const menu = diff.getByRole('button', { name: '差分メニュー' });
  await expect(menu).not.toHaveAttribute('title');
  const split = diff.getByRole('button', { name: 'Split', exact: true });
  const unified = diff.getByRole('button', { name: 'Unified', exact: true });

  await setHistoryValues(
    page,
    'old '.repeat(60) + '\nkeep\nremoved\nend\n',
    'new\nextra\nkeep\nend\n',
  );
  const rows = diff.locator('table.split tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.first().locator('td')).toHaveCount(4);
  const first = await rows.first().locator('.before.content').boundingBox();
  const right = await rows.first().locator('.after.content').boundingBox();
  expect(first!.height).toBeGreaterThan(40);
  expect(right!.height).toBe(first!.height);
  expect(right!.y).toBe(first!.y);
  await menu.click();
  await unified.click();
  await expect(diff.locator('table')).toHaveClass(/unified/);
  await expect(menu).toBeFocused();
  await menu.press('Enter');
  await expect(unified).toHaveAttribute('aria-pressed', 'true');
  await menu.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await split.click();

  await setHistoryValues(page, 'old', '<img src=x onerror=alert(1)>');
  await expect(diff.locator('.after .value')).toHaveCount(1);
  await expect(diff.locator('.after .value')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(diff.locator('.after img')).toHaveCount(0);
  for (const [before, after] of [
    ['', 'added'],
    ['deleted', ''],
  ]) {
    await setHistoryValues(page, before, after);
    await expect(diff.locator('table')).toHaveClass(/unified/);
    await expect(diff.locator(before ? '.before .value' : '.after .value')).toHaveText(
      before || after,
    );
    await menu.click();
    await expect(split).toBeDisabled();
    await unified.click();
    await setHistoryValues(page, 'old', 'new');
    await expect(diff.locator('table')).toHaveClass(/split/);
  }
  expect(errors).toEqual([]);
});

test('content script: copies exact values and shows long text without diff styling', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { copiedValues: string[]; rejectCopy: boolean };
    state.copiedValues = [];
    state.rejectCopy = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (state.rejectCopy) throw new Error('denied');
          state.copiedValues.push(text);
        },
      },
    });
  });
  await openDiffFixture(page);
  const diff = page.locator('spe-history-diff');
  const menu = diff.getByRole('button', { name: '差分メニュー' });
  const before = '  old\n text  ';
  const after = '<text>\n変更後  ';
  await setHistoryValues(page, before, after);
  await expect(diff.locator('.before .value')).toHaveCount(2);
  await menu.click();
  await diff.getByRole('button', { name: '変更前をコピー' }).click();
  await menu.click();
  await diff.getByRole('button', { name: '変更後をコピー' }).click();
  const longText = 'x'.repeat(10_001) + '\n  end  ';
  await setHistoryValues(page, '', longText);
  await expect(diff.locator('.plain')).toBeVisible();
  await expect(diff.locator('table, .number, .highlight')).toHaveCount(0);
  await expect(diff.getByRole('group', { name: '変更後' })).toHaveText(longText);
  await menu.click();
  await expect(diff.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
  await diff.getByRole('button', { name: '変更前をコピー' }).click();
  await menu.click();
  await diff.getByRole('button', { name: '変更後をコピー' }).click();
  expect(
    await page.evaluate(() => (window as typeof window & { copiedValues: string[] }).copiedValues),
  ).toEqual([before, after, '', longText]);
  await page.evaluate(() => {
    (window as typeof window & { rejectCopy: boolean }).rejectCopy = true;
  });
  await menu.click();
  await diff.getByRole('button', { name: '変更後をコピー' }).click();
  await expect(diff.locator('[role="status"]')).toHaveText('コピーできませんでした');
});

test('content script: enhance, update, fall back, toggle and reinitialize without duplicates', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockExtension(page);
  await page.route('**/fixtures/sheets', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Sheets fixture</title></head><body>
    <div class="waffle-blameview" tabindex="0" style="display:flex;position:absolute;left:1100px;top:100px;width:320px;border:1px solid gray;background:white"><div class="docs-blameview"><h3>Cell edit history</h3><div class="docs-blameview-valuecontainer"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced</span> "old value" <span class="docs-blame-bold-text">with</span> "new value"</div></div></div></div>
    <div class="docos-anchoreddocoview" tabindex="0" style="display:inline-flex;position:absolute;left:40px;top:400px;width:300px;height:140px;border:1px solid gray"><div class="docos-anchoreddocoview-internal"><p class="docos-replyview-body">Sample comment</p></div></div>
    </body></html>`,
    }),
  );
  await page.goto('/fixtures/sheets');
  const script = extensionOutput('content-scripts/sheets.js');
  await page.addScriptTag({ path: script });
  await expect(page.locator('spe-history-diff')).toHaveCount(1);
  await expect(page.locator('spe-resize-grip')).toHaveCount(2);
  await expect(page.locator('.docs-blameview-value-content')).toBeHidden();
  await expect(page.locator('spe-history-diff .after .value')).toHaveText('new value');
  // Popover invocation and layout selection also work inside the extension's shadow root.
  const layoutTrigger = page
    .locator('spe-history-diff')
    .getByRole('button', { name: '差分メニュー', exact: true });
  await layoutTrigger.click();
  await page.getByRole('button', { name: 'Unified', exact: true }).click();
  await expect(page.locator('spe-history-diff table')).toHaveClass(/unified/);
  await expect(layoutTrigger).toHaveAttribute('aria-expanded', 'false');
  await layoutTrigger.click();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('spe-history-diff table')).toHaveClass(/split/);
  const history = page.locator('.waffle-blameview');
  const rect = await history.boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(1428);
  const comment = page.locator('.docos-anchoreddocoview');
  // A popup that does not overflow must not reserve an empty scrollbar column.
  for (const popup of [history, comment]) {
    await expect(popup).toHaveCSS('scrollbar-gutter', 'auto');
    await expect
      .poll(() =>
        popup.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            (element as HTMLElement).offsetWidth -
            element.clientWidth -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth)
          );
        }),
      )
      .toBe(0);
    await expect
      .poll(() =>
        popup.evaluate((element) => {
          const content = element.querySelector(
            '.docs-blameview, .docos-anchoreddocoview-internal',
          )!;
          return Math.abs(element.clientWidth - content.getBoundingClientRect().width);
        }),
      )
      .toBeLessThan(1);
  }
  // A short comment in a fixed-height native popup still needs a bottom-corner grip.
  await expect
    .poll(async () => {
      const popupRect = await comment.boundingBox();
      const gripRect = await gripHost(comment).locator('[data-resize-handle]').boundingBox();
      return popupRect && gripRect
        ? Math.abs(popupRect.y + popupRect.height - 2 - gripRect.y - gripRect.height)
        : Infinity;
    })
    .toBeLessThan(1);
  await page.locator('.waffle-blameview, .docos-anchoreddocoview').evaluateAll((popups) => {
    for (const popup of popups)
      popup.addEventListener('keydown', (event) => {
        (popup as HTMLElement).dataset.lastKey = (event as KeyboardEvent).key;
      });
  });
  await history.focus();
  await dragHandle(page, gripHost(history).locator('[data-resize-handle]'), 10);
  await expect(history).toHaveCSS('width', '630px');
  await expect(history).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(history).toHaveAttribute('data-last-key', 'ArrowRight');
  await expect(history).toHaveCSS('width', '630px');
  await comment.focus();
  await dragHandle(page, gripHost(comment).locator('[data-resize-handle]'), 20);
  await expect(comment).toHaveCSS('width', '460px');
  await expect(comment).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(comment).toHaveAttribute('data-last-key', 'ArrowLeft');
  await expect(comment).toHaveCSS('width', '460px');

  await page.locator('spe-history-diff').evaluate((element) => element.remove());
  await expect(page.locator('spe-history-diff')).toHaveCount(1);
  await expect(page.locator('spe-history-diff .after .value')).toHaveText('new value');
  await page
    .locator('spe-resize-grip')
    .first()
    .evaluate((element) => element.remove());
  await expect(page.locator('spe-resize-grip')).toHaveCount(2);

  await page.locator('.docs-blameview-value-content').evaluate((element) => {
    element.lastChild!.textContent = ' "updated value"';
  });
  await expect(page.locator('spe-history-diff .after .value')).toHaveText('updated value');
  await page.locator('.docs-blameview-value-content').evaluate((element) => {
    element.innerHTML =
      '<span class="docs-blame-bold-text">Remplacé</span> "ancien" <span class="docs-blame-bold-text">par</span> "nouveau"';
  });
  await expect(page.locator('spe-history-diff')).toHaveCount(0);
  await expect(page.locator('.docs-blameview-value-content')).toBeVisible();
  await page.locator('.docs-blameview-value-content').evaluate((element) => {
    element.innerHTML = '<span class="docs-blame-bold-text">Added:</span> "追加された値"';
  });
  await expect(page.locator('spe-history-diff .after .value')).toHaveText('追加された値');
  await expect(page.locator('spe-history-diff table')).toHaveClass(/unified/);
  await layoutTrigger.click();
  await expect(page.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unified', exact: true }).click();
  const savedLayout = await page.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: {
          storage: { local: { get: (key: string) => Promise<Record<string, { layout: string }>> } };
        };
      }
    ).chrome;
    return (await chrome.storage.local.get('spe.settings.v1'))['spe.settings.v1'].layout;
  });
  expect(savedLayout).toBe('split');
  await page.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (data: unknown) => Promise<void> } } };
      }
    ).chrome;
    await chrome.storage.local.set({
      'spe.settings.v1': {
        diffEnabled: false,
        commentWidth: 500,
        historyWidth: 700,
        layout: 'vertical',
      },
    });
  });
  await expect(page.locator('spe-history-diff')).toHaveCount(0);
  await expect(page.locator('.docs-blameview-value-content')).toBeVisible();
  await expect(history).toHaveCSS('width', '700px');
  // Loading a new content-script instance invalidates the previous instance and restores its styles.
  await page.addScriptTag({ path: script });
  await expect(page.locator('spe-resize-grip')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('content script: text scale updates comments and both history views', async ({ page }) => {
  await mockExtension(page);
  await page.route('**/fixtures/text-scale', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>.docos-replyview-body{font-size:14px}.docs-blameview-value-content{font-size:13px}</style>
    <div class="waffle-blameview" style="position:absolute;top:150px;width:500px"><div class="docs-blameview"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced</span> "old" <span class="docs-blame-bold-text">with</span> "new"</div></div></div>
    <div class="docos-anchoreddocoview" style="position:absolute;top:400px;width:400px"><div class="docos-anchoreddocoview-internal"><p class="docos-replyview-body">Comment</p><div class="docos-input-textarea" contenteditable="true">Reply</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/text-scale');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff .code');
  const comment = page.locator('.docos-replyview-body');
  const editor = page.locator('.docos-input-textarea');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff).toHaveCSS('font-size', '12px');
  await expect(comment).toHaveCSS('zoom', '1');
  await page.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (data: unknown) => Promise<void> } } };
      }
    ).chrome;
    await chrome.storage.local.set({ 'spe.settings.v1': { fontScale: 200 } });
  });
  await expect
    .poll(() => diff.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
    .toBeCloseTo(14.4, 1);
  await expect(comment).toHaveCSS('zoom', '1.2');
  await expect(editor).toHaveCSS('zoom', '1.2');
  await expect(native).toHaveCSS('zoom', '1.2');
  const editorBounds = await editor.boundingBox();
  const popupBounds = await page.locator('.docos-anchoreddocoview').boundingBox();
  expect(editorBounds!.width).toBeLessThanOrEqual(popupBounds!.width);
  await editor.fill('A reply');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.type('with multiple lines');
  expect(await editor.evaluate((element) => (element as HTMLElement).innerText)).toBe(
    'A reply\nwith multiple lines',
  );
  await page.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (data: unknown) => Promise<void> } } };
      }
    ).chrome;
    await chrome.storage.local.set({ 'spe.settings.v1': { fontScale: 80, diffEnabled: false } });
  });
  await expect(native).toBeVisible();
  await expect(native).toHaveCSS('zoom', '0.8');
  await expect(comment).toHaveCSS('zoom', '0.8');
});

test('extension settings: uses English for unsupported languages', async ({ page }) => {
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'it-IT' }),
  );
  await page.goto('/__extension__/popup.html');
  await expect(page.getByRole('button', { name: 'Reset' })).toBeEnabled();
  await expect(page.getByRole('slider', { name: 'Comments' })).toBeVisible();
});

test('extension settings: localizes Arabic labels and preserves the sheet layout', async ({
  page,
}) => {
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ar-SA' }),
  );
  await page.goto('/__extension__/popup.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('button', { name: 'إعادة الضبط' })).toBeEnabled();
  const label = page.locator('label[for="history"]');
  await expect(label).toHaveCSS('direction', 'rtl');
  await expect(label).toBeVisible();
  await expect(page.getByRole('slider', { name: 'سجل تعديلات الخلية' })).toBeVisible();
});

test('extension settings: localizes Spanish labels', async ({ page }) => {
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'es-MX' }),
  );
  await page.goto('/__extension__/popup.html');
  await expect(page.getByRole('button', { name: 'Restablecer' })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Activar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('content script: localizes diff labels in English', async ({ page }) => {
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' }),
  );
  await page.route('**/fixtures/english-labels', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><div class="waffle-blameview"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced</span> "old" <span class="docs-blame-bold-text">with</span> "new"</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/english-labels');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  await expect(page.getByRole('button', { name: 'Diff menu' })).toBeVisible();
});

test('extension settings: save and restore local settings', async ({ page }) => {
  await mockExtension(page);
  await page.goto('/__extension__/popup.html');
  await expect(page.getByRole('button', { name: 'リセット' })).toBeEnabled();
  const fontScale = page.getByRole('slider', { name: '文字サイズ 倍率' });
  await expect(fontScale).toHaveValue('100');
  await expect(fontScale).toHaveAttribute('min', '80');
  await expect(fontScale).toHaveAttribute('max', '120');
  if (test.info().project.name === 'firefox') {
    const styles = await fontScale.evaluate((element) => ({
      track: getComputedStyle(element, '::-moz-range-track').backgroundImage,
      thumb: getComputedStyle(element, '::-moz-range-thumb').backgroundColor,
    }));
    expect(styles.track).toContain('linear-gradient');
    expect(styles.thumb).toBe('rgba(0, 0, 0, 0)');
  }
  await fontScale.fill('120');
  await expect(fontScale).toHaveAttribute('aria-valuetext', '120%');
  await expect(fontScale).toHaveCSS('--fill', '100%');
  const commentWidth = page.getByRole('slider', { name: 'コメント' });
  await commentWidth.focus();
  await page.keyboard.press('ArrowRight');
  await expect(commentWidth).toHaveAttribute('aria-valuetext', /ピクセル/);
  const changedWidth = await commentWidth.inputValue();
  await expect(page.getByRole('option', { name: 'Split（左右分割）' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Unified（統合）' })).toHaveCount(1);
  await page.getByLabel('初期表示').selectOption('unified');
  await page.getByRole('checkbox', { name: '有効にする' }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const chrome = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get: (
                    key: string,
                  ) => Promise<
                    Record<string, { layout: string; commentWidth: number; diffEnabled: boolean }>
                  >;
                };
              };
            };
          }
        ).chrome;
        return (await chrome.storage.local.get('spe.settings.v1'))['spe.settings.v1'];
      }),
    )
    .toMatchObject({
      layout: 'unified',
      commentWidth: Number(changedWidth),
      fontScale: 120,
      diffEnabled: false,
    });
  await page.getByRole('button', { name: 'リセット' }).click();
  await expect(page.getByLabel('初期表示')).toHaveValue('split');
  await expect(fontScale).toHaveValue('100');
  await expect(page.getByRole('checkbox', { name: '有効にする' })).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const chrome = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get: (
                    key: string,
                  ) => Promise<Record<string, { layout: string; commentWidth: number }>>;
                };
              };
            };
          }
        ).chrome;
        return (await chrome.storage.local.get('spe.settings.v1'))['spe.settings.v1'];
      }),
    )
    .toMatchObject({ layout: 'split', commentWidth: 440, fontScale: 100 });
});

for (const [previous, current] of [
  ['vertical', 'unified'],
  ['horizontal', 'split'],
  ['unified', 'unified'],
  ['split', 'split'],
] as const) {
  test(`extension settings: restores ${previous} as ${current}`, async ({ page }) => {
    await mockExtension(page);
    await page.addInitScript((layout) => {
      const chrome = (
        globalThis as unknown as {
          chrome: { storage: { local: { set: (data: unknown) => Promise<void> } } };
        }
      ).chrome;
      void chrome.storage.local.set({ 'spe.settings.v1': { layout } });
    }, previous);
    await page.goto('/__extension__/popup.html');
    await expect(page.getByRole('button', { name: 'リセット' })).toBeEnabled();
    await expect(page.getByLabel('初期表示')).toHaveValue(current);
  });
}

async function expectReachableGrip(page: Page, popup: Locator) {
  const grip = gripHost(popup).locator('[data-resize-handle]');
  await expect(grip).toBeVisible();
  await expect(grip).toBeInViewport({ ratio: 1 });
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const popupRect = await popup.boundingBox();
      const gripRect = await grip.boundingBox();
      return popupRect && gripRect
        ? Math.abs(popupRect.y + popupRect.height - 2 - gripRect.y - gripRect.height)
        : Infinity;
    })
    .toBeLessThan(1);
  await expect
    .poll(async () => {
      const rect = await popup.boundingBox();
      return (
        !!rect &&
        rect.x >= 11.5 &&
        rect.y >= 144.5 &&
        rect.x + rect.width <= viewport.width - 11.5 &&
        rect.y + rect.height <= viewport.height - 36 - 13.5
      );
    })
    .toBe(true);
  // Visibility alone does not prove an element is clickable when an ancestor clips it.
  await expect
    .poll(() =>
      grip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return hit === (element.getRootNode() as ShadowRoot).host;
      }),
    )
    .toBe(true);
}

test('content script: comment grip stays above a popup with its own stacking order', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/comment-stacking', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><div class="frame" style="position:relative; transform:translateZ(0)"><div class="docos-anchoreddocoview" style="position:absolute; z-index:1000; left:40px; top:200px; width:300px; height:160px; background:white"><div class="docos-anchoreddocoview-internal">Comment</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/comment-stacking');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const popup = page.locator('.docos-anchoreddocoview');
  await expectReachableGrip(page, popup);
  const grip = gripHost(popup).locator('[data-resize-handle]');
  await dragHandle(page, grip, 40);
  await expect(popup).toHaveCSS('width', '480px');
  await popup.evaluate((element) => {
    (element as HTMLElement).style.zIndex = '2000';
  });
  await expectReachableGrip(page, popup);
  await dragHandle(page, grip, 20);
  await expect(popup).toHaveCSS('width', '500px');
  // A separate overlay above the popup must still appear above the grip.
  await popup.evaluate((element) => {
    const popup = element as HTMLElement;
    const overlay = document.createElement('div');
    overlay.className = 'higher-overlay';
    overlay.style.cssText = `position:absolute;left:${popup.style.left};top:${popup.style.top};width:${popup.style.width};height:160px;z-index:2001;background:white`;
    popup.parentElement!.append(overlay);
  });
  const overlay = page.locator('.higher-overlay');
  await expect
    .poll(() =>
      grip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.ownerDocument.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        )?.className;
      }),
    )
    .toBe('higher-overlay');
  await expect(overlay).toBeVisible();
});

for (const kind of ['history', 'comment'] as const) {
  test(`content script: ${kind} resize grip stays reachable in small windows and while scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 360 });
    await mockExtension(page);
    const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: long popup content`).join(
      '\n',
    );
    const selector = kind === 'history' ? '.waffle-blameview' : '.docos-anchoreddocoview';
    const content =
      kind === 'history'
        ? `<div class="docs-blameview"><h3>Cell edit history</h3><div class="docs-blameview-valuecontainer"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "${lines}"</div></div></div>`
        : `<div class="docos-anchoreddocoview-internal"><h3>Comment</h3><p class="docos-replyview-body">${lines}</p></div>`;
    await page.route('**/fixtures/overflow', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px Arial;background:#f8fafd}.frame{position:relative;top:40px;left:20px;transform:translateZ(0)}</style></head><body><div class="frame"><div class="${selector.slice(1)}" style="position:absolute;left:420px;top:260px;width:360px;height:900px !important;min-height:900px !important;max-height:900px !important;border:1px solid #dadce0;background:white">${content}</div></div><div class="sheet-tab-bar" style="position:fixed;left:0;right:0;bottom:0;height:36px;z-index:2147483647;box-sizing:border-box;border-top:1px solid #dadce0;background:#f1f3f4;color:#202124;display:flex;align-items:center;padding:0 16px;gap:16px"><span>＋</span><span>Sheet1 ▾</span></div></body></html>`,
      }),
    );
    await page.goto('/fixtures/overflow');
    const script = extensionOutput('content-scripts/sheets.js');
    await page.addScriptTag({ path: script });
    const popup = page.locator(selector);
    await expectReachableGrip(page, popup);
    await expect(page.locator('.sheet-tab-bar')).toHaveCSS('height', '36px');
    expect(await popup.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    const grip = gripHost(popup).locator('[data-resize-handle]');
    const beforeScroll = await grip.boundingBox();
    const immediateMovement = await popup.evaluate((element) => {
      const host = element.nextElementSibling!;
      const before = host.getBoundingClientRect().top;
      element.scrollTop = element.scrollHeight;
      return host.getBoundingClientRect().top - before;
    });
    expect(Math.abs(immediateMovement)).toBeLessThan(1);
    await expectReachableGrip(page, popup);
    expect((await grip.boundingBox())!.y).toBeCloseTo(beforeScroll!.y, 0);
    const oldWidth = (await popup.boundingBox())!.width;
    await dragHandle(page, grip, -60);
    await expect(popup).toHaveCSS('width', `${oldWidth - 60}px`);
    await expectReachableGrip(page, popup);
    await page.setViewportSize({ width: 360, height: 220 });
    await expectReachableGrip(page, popup);
    await page.setViewportSize({ width: 900, height: 650 });
    await expectReachableGrip(page, popup);
    // Stable layout must not keep rewriting equivalent CSS values on every frame.
    const styleChanges = await popup.evaluate(async (element) => {
      let changes = 0;
      const observer = new MutationObserver((records) => {
        changes += records.length;
      });
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
      await new Promise((resolve) => setTimeout(resolve, 150));
      observer.disconnect();
      return changes;
    });
    expect(styleChanges).toBeLessThanOrEqual(1);
    // Invalidating the extension restores native min/max height declarations and priorities.
    await page.evaluate(() => {
      delete (globalThis as unknown as { chrome: { runtime: { id?: string } } }).chrome.runtime.id;
      window.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('spe-resize-grip')).toHaveCount(0);
    expect(
      await popup.evaluate((element) => ({
        min: (element as HTMLElement).style.minHeight,
        max: (element as HTMLElement).style.maxHeight,
        priority: (element as HTMLElement).style.getPropertyPriority('max-height'),
      })),
    ).toEqual({ min: '900px', max: '900px', priority: 'important' });
  });
}

test('content script: hides history while the sheet scrolls but not while history scrolls', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/sheet-scroll', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><div id="waffle-grid-container"><div class="grid-container"><div class="native-scrollbar" style="overflow:scroll;width:20px;height:20px"><div style="height:500px"></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:320px;height:160px"><div class="docs-blameview" style="height:400px"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced</span> "old" <span class="docs-blame-bold-text">with</span> "new"</div></div></div></div></div>`,
    }),
  );
  await page.goto('/fixtures/sheet-scroll');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const history = page.locator('.waffle-blameview');
  await expect(page.locator('spe-history-diff')).toHaveCount(1);
  await history.evaluate((node) =>
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })),
  );
  await expect(history).toBeVisible();
  await page
    .locator('.grid-container')
    .evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })));
  await expect(history).toBeHidden();
  await expect(history).toHaveCSS('opacity', '0');
  await expect(page.locator('spe-history-diff .diff-view')).toBeHidden();
  await expect(history).toBeVisible();
  await expect(history).toHaveCSS('opacity', '1');
  await page.locator('.native-scrollbar').evaluate((node) => {
    node.scrollTop = 30;
  });
  await expect(history).toBeHidden();
  await expect(history).toBeVisible();
});

test('content script: hides comments while the sheet scrolls but not while comments scroll', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/comment-sheet-scroll', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><div id="waffle-grid-container"><div class="grid-container"><div class="native-scrollbar" style="overflow:scroll;width:20px;height:20px"><div style="height:500px"></div></div><div class="docos-anchoreddocoview" style="position:absolute;left:20px;top:100px;width:320px;height:160px"><div class="docos-anchoreddocoview-internal" style="height:400px">Comment</div></div></div></div>`,
    }),
  );
  await page.goto('/fixtures/comment-sheet-scroll');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const comment = page.locator('.docos-anchoreddocoview');
  await expect(gripHost(comment)).toHaveCount(1);
  await comment.evaluate((node) =>
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })),
  );
  await expect(comment).toBeVisible();
  await page
    .locator('.grid-container')
    .evaluate((node) => node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })));
  await expect(comment).toBeHidden();
  await expect(comment).toHaveCSS('opacity', '0');
  await expect(gripHost(comment).locator('[data-resize-handle]')).toBeHidden();
  await expect(comment).toBeVisible();
  await page.locator('.native-scrollbar').evaluate((node) => {
    node.scrollTop = 30;
  });
  await expect(comment).toBeHidden();
  await expect(comment).toBeVisible();
});

test('content script: preserves native comment scrolling while composing multiline replies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 300 });
  await mockExtension(page);
  await page.route('**/fixtures/comment-editor', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>body{margin:0}.docos-anchoreddocoview-internal{max-height:inherit;overflow-y:auto}</style><div class="docos-anchoreddocoview" style="position:absolute;left:20px;top:10px;width:320px;max-height:240px"><div class="docos-anchoreddocoview-internal"><div style="height:200px">Earlier replies</div><div class="docos-docoview-input-pane"><div class="docos-input-textarea" contenteditable="true" role="textbox"></div></div></div></div>`,
    }),
  );
  await page.goto('/fixtures/comment-editor');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const comment = page.locator('.docos-anchoreddocoview');
  const content = comment.locator('.docos-anchoreddocoview-internal');
  await expect(gripHost(comment)).toHaveCount(1);
  await expect(content).toHaveCSS('overflow-y', 'auto');
  const editor = content.getByRole('textbox');
  await editor.focus();
  await page.keyboard.type('First line');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type('New line');
  }
  await expect(editor).toBeFocused();
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(comment).toBeInViewport();
});

test('content script: long history remains scrollable when Sheets clips its inner container', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 300 });
  await mockExtension(page);
  const value = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n');
  await page.route('**/fixtures/history-clipped', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><style>.waffle-blameview{display:flex}.docs-blameview{height:100%;overflow:hidden}.docs-blameview-valuecontainer{display:flex}</style><div class="waffle-blameview" style="position:absolute;left:20px;top:20px;width:400px;height:900px;border:1px solid gray"><div class="docs-blameview"><header>History</header><div class="docs-blameview-content"><div class="docs-blameview-valuecontainer"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "${value}"</div></div></div></div></div>`,
    }),
  );
  await page.goto('/fixtures/history-clipped');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const popup = page.locator('.waffle-blameview');
  const lastLine = popup.locator('spe-history-diff .value').filter({ hasText: 'Line 60' });
  await expect(lastLine).toHaveCount(1);
  await expect
    .poll(() => popup.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(0);
  await popup.hover();
  await page.mouse.wheel(0, 10000);
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await popup.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect
    .poll(async () => {
      const bottom = await lastLine.boundingBox();
      const viewport = await popup.boundingBox();
      return !!bottom && !!viewport && bottom.y + bottom.height <= viewport.y + viewport.height;
    })
    .toBe(true);
  await expectReachableGrip(page, popup);
});

test('content script: resets reused history scroll when reopened', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 500 });
  await mockExtension(page);
  const lines = Array.from({ length: 80 }, (_, i) => `Row ${i + 1}`).join('\n');
  await page.route('**/fixtures/reused-history-scroll', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="history-owner"><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:400px;height:1000px"><div class="docs-blameview"><button class="docs-blameview-previous-edit-button" aria-disabled="false">Previous</button><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "${lines}"</div></div></div></div>`,
    }),
  );
  await page.goto('/fixtures/reused-history-scroll');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const popup = page.locator('.waffle-blameview');
  await expect(popup.locator('spe-history-diff')).toHaveCount(1);
  await popup.evaluate((node) => {
    node.scrollTop = 200;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await popup.evaluate((node) => node.classList.add('native-update'));
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await popup.evaluate((node) => {
    (node as HTMLElement).style.display = 'none';
    (node as HTMLElement).style.display = 'flex';
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(0);
  await popup.evaluate((node) => {
    node.scrollTop = 200;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await popup.evaluate((node) => {
    (node as HTMLElement).hidden = true;
    (node as HTMLElement).hidden = false;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(0);
  await popup.evaluate((node) => {
    node.scrollTop = 200;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await page.locator('#history-owner').evaluate((node) => {
    (node as HTMLElement).style.display = 'none';
    (node as HTMLElement).style.display = 'block';
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(0);
  await popup.evaluate((node) => {
    node.scrollTop = 200;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await popup.evaluate((node) => {
    const parent = node.parentNode!;
    node.remove();
    parent.appendChild(node);
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(0);
});

test('content script: arrow history navigation resets scroll only when available', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 500 });
  await mockExtension(page);
  const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`).join('<br>');
  await page.route('**/fixtures/history-arrow-scroll', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><div class="waffle-blameview" tabindex="0" style="position:absolute;top:150px;left:20px;width:400px;height:1000px"><div class="docs-blameview"><button class="docs-blameview-previous-edit-button" aria-disabled="false">Previous</button><button class="docs-blameview-next-edit-button" aria-disabled="false">Next</button><div class="docs-blameview-value-content">${lines}</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/history-arrow-scroll');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const popup = page.locator('.waffle-blameview');
  await expect(popup).toHaveAttribute('data-spe-popup', 'history');
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    await popup.evaluate((node) => {
      node.scrollTop = 200;
    });
    await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
    const prevented = await popup.evaluate(
      (node, pressed) =>
        !node.dispatchEvent(
          new KeyboardEvent('keydown', { key: pressed, bubbles: true, cancelable: true }),
        ),
      key,
    );
    expect(prevented).toBe(false);
    await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(0);
  }
  await popup
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await popup.evaluate((node) => {
    node.scrollTop = 200;
  });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
  await popup.dispatchEvent('keydown', { key: 'ArrowRight' });
  await expect.poll(() => popup.evaluate((node) => node.scrollTop)).toBe(200);
});

test('content script: repositions a popup when its intrinsic height grows after rendering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 360 });
  await mockExtension(page);
  await page.route('**/fixtures/growing', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px Arial}</style></head><body><div class="docos-anchoreddocoview" style="position:absolute;left:40px;top:250px;width:300px;border:1px solid #dadce0;background:white"><div class="docos-anchoreddocoview-internal">A short comment</div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/growing');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const popup = page.locator('.docos-anchoreddocoview');
  await expectReachableGrip(page, popup);
  // CSSOM changes do not produce MutationObserver records; ResizeObserver must catch this.
  await page.evaluate(() =>
    document.styleSheets[0].insertRule('.docos-anchoreddocoview-internal { min-height: 1000px; }'),
  );
  await expectReachableGrip(page, popup);
  await expect.poll(async () => (await popup.boundingBox())!.y).toBe(145);
});

test('content script: partial history follows latest state and formula bar changes', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/partial', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div id="t-formula-bar-input"><div class="cell-input">apple orange citrus<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:320px;background:white">
      <div class="docs-blameview"><div class="docs-blameview-nav-container"><div class="docs-blameview-previous-edit-button" aria-disabled="false"></div><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced:</span> "banana" <span class="docs-blame-bold-text">with</span> "orange", <span class="docs-blame-bold-text">within</span> "apple banana citrus"</div></div>
    </div></body></html>`,
    }),
  );
  await page.goto('/fixtures/partial');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const native = page.locator('.docs-blameview-value-content');
  const diff = page.locator('spe-history-diff');
  const next = page.locator('.docs-blameview-next-edit-button');
  const formula = page.locator('.cell-input');
  await expect(diff.locator('.before .value')).toHaveText('apple banana citrus');
  await expect(diff.locator('.after .value')).toHaveText('apple orange citrus');
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.innerHTML = 'wrong value<br>';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await formula.evaluate((node) => {
    node.innerHTML = 'apple orange citrus<br>';
  });
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.innerHTML = '<span>apple orange citrus</span><br>';
  });
  await expect(diff).toHaveCount(0);
  await formula.evaluate((node) => {
    node.innerHTML = 'apple orange citrus<br>';
  });
  await expect(diff).toHaveCount(1);
  await page.locator('.docs-blameview-previous-edit-button').dispatchEvent('click');
  await expect(diff.locator('.after .value')).toHaveText('apple orange citrus');
  await expect(diff.locator('.after .value')).toBeVisible();
  await expect(native).toBeHidden();
  await native.evaluate((node) => {
    node.innerHTML = '<span class="docs-blame-bold-text">Added:</span> "old"';
  });
  await expect(diff.locator('.after .value')).toHaveText('old');
});

test('content script: returning from the end of history restores a reused value', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/history-end', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:320px;background:white">
      <div class="docs-blameview"><div class="docs-blameview-nav-container">
        <div class="docs-blameview-previous-edit-button" aria-disabled="false"></div><div class="docs-blameview-next-edit-button" aria-disabled="true"></div>
      </div><div class="docs-blameview-message" style="display:none">No more edit history</div>
      <div class="docs-blameview-content" style="display:block"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "abc"</div></div></div>
    </div></body></html>`,
    }),
  );
  await page.goto('/fixtures/history-end');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const content = page.locator('.docs-blameview-content');
  const previous = page.locator('.docs-blameview-previous-edit-button');
  const next = page.locator('.docs-blameview-next-edit-button');
  await expect(diff.locator('.after .value')).toHaveText('abc');
  await previous.dispatchEvent('click');
  await content.evaluate((node) => {
    (node as HTMLElement).style.display = 'none';
  });
  await previous.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  // Sheets reuses the previous value node without changing its innerHTML.
  // Sheets may reveal the same value before the navigation click reaches the extension.
  await content.evaluate((node) => {
    (node as HTMLElement).style.display = 'block';
  });
  await next.dispatchEvent('click');
  await previous.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff.locator('.after .value')).toHaveText('abc');
  // Another full history can already be visible before Sheets delivers its click.
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await page.locator('.docs-blameview-value-content').evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Replaced:</span> "abc" <span class="docs-blame-bold-text">with</span> "abc "';
  });
  await expect(diff.locator('.before .value')).toHaveText('abc');
  await next.dispatchEvent('click');
  await expect(diff.locator('.before .value')).toHaveText('abc', { timeout: 1000 });
});

test('content script: Japanese addition handles a flattened line break', async ({ page }) => {
  // Synthetic fixture based on the reported Sheets markup, not a live capture.
  await mockExtension(page);
  await page.route('**/fixtures/japanese-added-line-break', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">API の応答がエラー または通信エラー。<br>エラー処理を行う。<br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">追加しました:</span> "または通信エラー。 エラー処理を行う。", <span class="docs-blame-bold-text">期間</span> "API の応答がエラー"</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/japanese-added-line-break');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  await expect(diff.locator('.before .value')).toContainText('API の応答がエラー');
  await expect(
    diff.locator('.after .value').filter({ hasText: 'エラー処理を行う。' }),
  ).toBeVisible();
  await page.locator('.cell-input').evaluate((node) => {
    node.innerHTML = 'API の応答がエラー または通信エラー。<br>別の処理を行う。<br>';
  });
  await expect(diff).toHaveCount(0);
  await expect(page.locator('.docs-blameview-value-content')).toBeVisible();
});

test('content script: Arabic composite history and formula actions', async ({ page }) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ar-SA' }),
  );
  await page.route('**/fixtures/arabic-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><body dir="rtl"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">تمّ استبدال:</span> "brown fox" <span class="docs-blame-bold-text">بالقيمة</span> "fox", <span class="docs-blame-bold-text">تمّت إضافة:</span> "swift", <span class="docs-blame-bold-text">خلال</span> "The brown fox\njumps over logs. "</div></div></div></body>`,
    }),
  );
  await page.goto('/fixtures/arabic-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'قائمة الاختلافات' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await expect(diff.locator('.diff-view')).toHaveCSS('direction', 'ltr');
  const sides = await diff
    .locator('tr')
    .first()
    .locator('td.content')
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().left));
  expect(sides[0]).toBeLessThan(sides[1]!);
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">تمّ حذف:</span> "<span class="waffle-blameview-formula-text">=TRUE</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=TRUE');
  await native.evaluate((node) => {
    node.innerHTML = '<span class="docs-blame-bold-text">تمّت إضافة:</span> "نص عربي"';
  });
  await expect(diff.locator('.after .value')).toHaveText('نص عربي');
  await expect(diff.locator('.after .value')).toHaveCSS('direction', 'rtl');
  await expect(diff.locator('.after .content')).toHaveCSS('text-align', 'right');
});

test('content script: German composite history and formula actions', async ({ page }) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'de-DE' }),
  );
  await page.route('**/fixtures/german-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Ersetzt:</span> "brown fox" <span class="docs-blame-bold-text">durch</span> "fox", <span class="docs-blame-bold-text">Hinzugefügt:</span> "swift", <span class="docs-blame-bold-text">innerhalb von</span> "The brown fox\njumps over logs. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/german-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Vergleichsmenü' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Gelöscht:</span> "<span class="waffle-blameview-formula-text">=WAHR</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=WAHR');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Hinzugefügt:</span> "<span class="waffle-blameview-formula-text">=WAHR</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=WAHR');
});

test('content script: Russian composite history and formula actions', async ({ page }) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ru-RU' }),
  );
  await page.route('**/fixtures/russian-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Заменено:</span> "brown fox" <span class="docs-blame-bold-text">на</span> "fox", <span class="docs-blame-bold-text">Добавлено:</span> "swift", <span class="docs-blame-bold-text">исходный текст:</span> "The brown fox\njumps over logs. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/russian-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Меню сравнения' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Удалено:</span> "<span class="waffle-blameview-formula-text">=ИСТИНА</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=ИСТИНА');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Добавлено:</span> "<span class="waffle-blameview-formula-text">=ИСТИНА</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=ИСТИНА');
});

test('content script: Brazilian Portuguese composite history and formula actions', async ({
  page,
}) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'pt-BR' }),
  );
  await page.route('**/fixtures/portuguese-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Substituído:</span> "brown fox" <span class="docs-blame-bold-text">por</span> "fox", <span class="docs-blame-bold-text">Adicionado:</span> "swift", <span class="docs-blame-bold-text">período:</span> "The brown fox\njumps over logs. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/portuguese-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Menu de diferenças' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Excluído:</span> "<span class="waffle-blameview-formula-text">=VERDADEIRO</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=VERDADEIRO');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Adicionado:</span> "<span class="waffle-blameview-formula-text">=VERDADEIRO</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=VERDADEIRO');
});

test('content script: Indonesian composite history and formula actions', async ({ page }) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'id-ID' }),
  );
  await page.route('**/fixtures/indonesian-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Mengganti:</span> "brown fox" <span class="docs-blame-bold-text">dengan</span> "fox", <span class="docs-blame-bold-text">Menambahkan:</span> "swift", <span class="docs-blame-bold-text">dalam</span> "The brown fox\njumps over logs. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/indonesian-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Menu perbedaan' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Menghapus:</span> "<span class="waffle-blameview-formula-text">=TRUE</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=TRUE');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Menambahkan:</span> "<span class="waffle-blameview-formula-text">=TRUE</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=TRUE');
});

test('content script: French composite history and formula actions', async ({ page }) => {
  // Synthetic fixture modeled on C21 and E21; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'fr-FR' }),
  );
  await page.route('**/fixtures/french-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">The fox<br>jumps over swift logs. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:150px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Valeur</span> "brown fox" <span class="docs-blame-bold-text">remplacée par</span> "fox", <span class="docs-blame-bold-text">Valeur ajoutée</span>&nbsp;: "swift", <span class="docs-blame-bold-text">période</span> "The brown fox\njumps over logs. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/french-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Menu des différences' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'swift' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Valeur supprimée</span>&nbsp;: "<span class="waffle-blameview-formula-text">=VRAI</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=VRAI');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Valeur ajoutée</span>&nbsp;: "<span class="waffle-blameview-formula-text">=VRAI</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=VRAI');
});

test('content script: Spanish composite history and deleted formula', async ({ page }) => {
  // Synthetic fixture modeled on the supplied markup; not a live capture.
  await mockExtension(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'es-ES' }),
  );
  await page.route('**/fixtures/spanish-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><div id="t-formula-bar-input"><div class="cell-input">Lorem ipsum dolor sit amet.<br>Ut enim ad minim veniam, quis exercitation ex consequat. <br></div></div><div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:600px"><div class="docs-blameview"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Sustituido:</span> "amet, consectetur elit." <span class="docs-blame-bold-text">por</span> "amet.", <span class="docs-blame-bold-text">Añadido:</span> "minim", <span class="docs-blame-bold-text">en</span> "Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. "</div></div></div>`,
    }),
  );
  await page.goto('/fixtures/spanish-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.getByRole('button', { name: 'Menú de diferencias' })).toBeVisible();
  await expect(diff.locator('.after .value').filter({ hasText: 'minim' })).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Eliminado:</span> "<span class="waffle-blameview-formula-text">=VERDADERO</span>"';
  });
  await expect(diff.locator('.before .value')).toHaveText('=VERDADERO');
});

test('content script: Japanese partial history tracks latest status and formula bar', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/japanese-partial', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>
    <div id="t-formula-bar-input"><div class="cell-input">apple orange citrus<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:320px;background:white">
      <div class="docs-blameview"><div class="docs-blameview-nav-container"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">置き換えました:</span> "banana" <span class="docs-blame-bold-text">から</span> "orange", <span class="docs-blame-bold-text">期間</span> "apple banana citrus"</div></div>
    </div></body></html>`,
    }),
  );
  await page.goto('/fixtures/japanese-partial');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  const next = page.locator('.docs-blameview-next-edit-button');
  const formula = page.locator('.cell-input');
  await expect(diff.locator('.before .value')).toHaveText('apple banana citrus');
  await expect(diff.locator('.after .value')).toHaveText('apple orange citrus');
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.innerHTML = 'apple sour citrus<br>';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
});

test('content script: formula histories preserve nested quotes and fall back for unknown older locales', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/formula-history', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>
    <div id="t-formula-bar-input"><div class="cell-input"><bdo dir="ltr"><span class="formula-content"><span>=</span><span>IF(A1="", "new", 1)</span></span></bdo><br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:500px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-nav-container"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">置き換えました:</span> "<span class="waffle-blameview-formula-text">=IF(A1="", "old", 1)</span>" <span class="docs-blame-bold-text">から</span> "<span class="waffle-blameview-formula-text">=IF(A1="", "new", 1)</span>"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/formula-history');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  await expect(diff.locator('.before .value')).toHaveText('=IF(A1="", "old", 1)');
  await expect(diff.locator('.after .value')).toHaveText('=IF(A1="", "new", 1)');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Remplacé:</span> "<span class="waffle-blameview-formula-text">=IF(A1=&quot;&quot;, &quot;old&quot;, 1)</span>" <span class="docs-blame-bold-text">par</span> "<span class="waffle-blameview-formula-text">=IF(A1=&quot;&quot;, &quot;new&quot;, 1)</span>"';
  });
  await expect(diff.locator('.after .value')).toHaveText('=IF(A1="", "new", 1)');
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
});

test('content script: Simplified Chinese partial history follows current value and navigation', async ({
  page,
}) => {
  await mockExtension(page);
  await page.route('**/fixtures/chinese-partial', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
    <div id="t-formula-bar-input"><div class="cell-input">apple orange sweet citrus<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-nav-container"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">已用<span class="docs-blame-bold-text">“"orange"”</span>替换“"banana"”</span>, <span class="docs-blame-bold-text">已添加：</span>"sweet", <span class="docs-blame-bold-text">范围</span>："apple banana citrus"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/chinese-partial');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const native = page.locator('.docs-blameview-value-content');
  const next = page.locator('.docs-blameview-next-edit-button');
  const formula = page.locator('.cell-input');
  await expect(diff.locator('.before .value')).toHaveText('apple banana citrus');
  await expect(diff.locator('.after .value')).toHaveText('apple orange sweet citrus');
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.innerHTML = 'apple orange sour citrus<br>';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
});

test('content script: Traditional Chinese range history follows the formula bar and falls back safely', async ({
  page,
}) => {
  // Synthetic fixture modeled on the user's HTML example, not an authenticated live capture.
  const oldText =
    'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ';
  const newText =
    'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ';
  await mockExtension(page);
  await page.route('**/fixtures/traditional-chinese-partial', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"></head><body>
    <div id="t-formula-bar-input"><div class="cell-input">${newText}<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:600px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-nav-container"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">已將「</span>"amet, consectetur elit."<span class="docs-blame-bold-text">」已取代為：</span>"amet.", <span class="docs-blame-bold-text">已新增：</span>"minim", <span class="docs-blame-bold-text">範圍</span>："${oldText}"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/traditional-chinese-partial');
  const native = page.locator('.docs-blameview-value-content');
  const original = await native.innerHTML();
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const next = page.locator('.docs-blameview-next-edit-button');
  const formula = page.locator('.cell-input');
  await expect(diff.locator('.before .value')).toHaveText(oldText.split('\n'));
  await expect(diff.locator('.after .value')).toHaveText(newText.split('\n'));
  expect((await diff.locator('.before .value').allTextContents()).join('\n')).toBe(oldText);
  expect((await diff.locator('.after .value').allTextContents()).join('\n')).toBe(newText);
  await expect(native).toBeHidden();
  expect(await native.innerHTML()).toBe(original);
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.textContent = 'inconsistent current value';
    node.append(document.createElement('br'));
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await formula.evaluate((node, text) => {
    node.textContent = text;
    node.append(document.createElement('br'));
  }, newText);
  await expect(diff).toHaveCount(1);
  await native
    .locator('.docs-blame-bold-text')
    .nth(1)
    .evaluate((node) => {
      node.textContent = '未知的操作：';
    });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();

  // A full replacement has enough context to work on older history without the formula bar.
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">已將「</span>"say &quot;old&quot;"<span class="docs-blame-bold-text">」已取代為：</span>"say &quot;new&quot;"';
  });
  await expect(diff.locator('.before .value')).toHaveText('say "old"');
  await expect(diff.locator('.after .value')).toHaveText('say "new"');
});

test('content script: Korean postfix history handles empty labels and verifies the current value', async ({
  page,
}) => {
  // Synthetic fixture modeled on the user's Korean HTML, not an authenticated live capture.
  const oldText =
    'Lorem ipsum dolor sit amet, consectetur elit.\nUt enim ad veniam, quis exercitation ex consequat. ';
  const newText =
    'Lorem ipsum dolor sit amet.\nUt enim ad minim veniam, quis exercitation ex consequat. ';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockExtension(page);
  await page.route('**/fixtures/korean-partial', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body>
    <div id="t-formula-bar-input"><div class="cell-input">${newText}<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:600px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-nav-container"><div class="docs-blameview-next-edit-button" aria-disabled="true"></div></div>
      <div class="docs-blameview-value-content">"amet, consectetur elit."이(가) "amet."(으)로 <span class="docs-blame-bold-text">교체됨</span><span class="docs-blame-bold-text"></span>, "minim"이(가) <span class="docs-blame-bold-text">추가됨</span>, "${oldText}" <span class="docs-blame-bold-text">이내</span></div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/korean-partial');
  const native = page.locator('.docs-blameview-value-content');
  const original = await native.innerHTML();
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  const next = page.locator('.docs-blameview-next-edit-button');
  const formula = page.locator('.cell-input');
  await expect(diff.locator('.before .value')).toHaveText(oldText.split('\n'));
  await expect(diff.locator('.after .value')).toHaveText(newText.split('\n'));
  expect((await diff.locator('.before .value').allTextContents()).join('\n')).toBe(oldText);
  expect((await diff.locator('.after .value').allTextContents()).join('\n')).toBe(newText);
  await expect(native).toBeHidden();
  expect(await native.innerHTML()).toBe(original);
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await formula.evaluate((node) => {
    node.textContent = 'inconsistent current value';
    node.append(document.createElement('br'));
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await formula.evaluate((node, value) => {
    node.textContent = value;
    node.append(document.createElement('br'));
  }, newText);
  await expect(diff).toHaveCount(1);
  await native
    .locator('.docs-blame-bold-text')
    .nth(1)
    .evaluate((node) => {
      node.textContent = 'unexpected';
    });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();

  // Full descriptions remain usable on older history without formula-bar context.
  await next.evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await native.evaluate((node) => {
    node.innerHTML =
      '"say &quot;old&quot;"이(가) "say &quot;new&quot;"(으)로 <span class="docs-blame-bold-text">교체됨</span><span class="docs-blame-bold-text"></span>';
  });
  await expect(diff.locator('.before .value')).toHaveText('say "old"');
  await expect(diff.locator('.after .value')).toHaveText('say "new"');
  await native.evaluate((node) => {
    node.innerHTML = '"새 값"이(가) <span class="docs-blame-bold-text">추가됨</span>';
  });
  await expect(diff.locator('table')).toHaveClass(/unified/);
  await expect(diff.locator('.after .value')).toHaveText('새 값');
  await native.evaluate((node) => {
    node.innerHTML = '"이전 값"이(가) <span class="docs-blame-bold-text">삭제됨</span>';
  });
  await expect(diff.locator('table')).toHaveClass(/unified/);
  await expect(diff.locator('.before .value')).toHaveText('이전 값');
  await expect(diff.locator('.after .value')).toHaveCount(0);
  await diff.getByRole('button', { name: '差分メニュー' }).click();
  await expect(diff.getByRole('button', { name: 'Split', exact: true })).toBeDisabled();
  await diff.getByRole('button', { name: 'Unified', exact: true }).click();
  await native.evaluate((node) => {
    node.innerHTML = '"old"이(가) "new"(으)로 <span class="docs-blame-bold-text">교체됨</span>';
  });
  await expect(diff.locator('table')).toHaveClass(/split/);
  expect(errors).toEqual([]);
});

test('content script: navigation keeps the old diff until the next history is ready', async ({
  page,
}) => {
  // Synthetic fixture: Sheets can update a reused value node after the navigation click.
  await mockExtension(page);
  await page.route('**/fixtures/navigation-flicker', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div id="t-formula-bar-input"><div class="cell-input">two<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px;background:white"><div class="docs-blameview">
      <button class="docs-blameview-previous-edit-button" aria-disabled="false">previous</button>
      <button class="docs-blameview-next-edit-button" aria-disabled="true">next</button>
      <div class="docs-blameview-content"><div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Replaced:</span> "one" <span class="docs-blame-bold-text">with</span> "two", <span class="docs-blame-bold-text">within</span> "one"</div></div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/navigation-flicker');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const native = page.locator('.docs-blameview-value-content');
  const popup = page.locator('.waffle-blameview');
  const diff = page.locator('spe-history-diff');
  const previous = page.locator('.docs-blameview-previous-edit-button');
  await expect(diff.locator('.after .value')).toHaveText('two');

  await previous.dispatchEvent('click');
  await expect(native).toBeHidden();
  await expect(diff.locator('.after .value')).toBeVisible();
  // Allow multiple paints before Sheets replaces the native value.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(native).toBeHidden();
  const content = page.locator('.docs-blameview-content');
  await content.evaluate((node) => {
    (node as HTMLElement).style.display = 'none';
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(popup).toHaveAttribute('data-spe-history-loading');
  await expect(diff.locator('.after .value')).toBeVisible();
  await expect(diff.locator('.after .value')).toHaveText('two');
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Replaced:</span> "two" <span class="docs-blame-bold-text">with</span> "three"';
    (node.parentElement as HTMLElement).style.display = 'block';
  });
  await expect(diff.locator('.after .value')).toHaveText('three');
  await expect(diff).toHaveCount(1);
  await expect(native).toBeHidden();
  await expect(popup).not.toHaveAttribute('data-spe-history-loading');

  await previous.dispatchEvent('click');
  await expect(native).toBeHidden();
  await native.evaluate((node) => {
    node.innerHTML =
      '<span class="docs-blame-bold-text">Remplacé</span> "ancien" <span class="docs-blame-bold-text">par</span> "nouveau"';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await expect(popup).not.toHaveAttribute('data-spe-history-loading');

  // Complete histories can already be updated before the click reaches us.
  await native.evaluate((node) => {
    node.innerHTML = '<span class="docs-blame-bold-text">Added:</span> "again"';
  });
  await expect(diff.locator('.after .value')).toHaveText('again');
  await previous.dispatchEvent('click');
  await expect(native).toBeHidden();
  await expect(popup).not.toHaveAttribute('data-spe-history-loading', { timeout: 1000 });
  await expect(diff.locator('.after .value')).toHaveText('again', { timeout: 1000 });

  // Hold the next diff's stylesheet request while Sheets replaces the entire value container.
  const cssPath = '**/__extension__/content-scripts/sheets.css';
  let releaseCss = () => {};
  const cssReady = new Promise<void>((resolve) => {
    releaseCss = resolve;
  });
  await page.route(cssPath, async (route) => {
    await cssReady;
    await route.fallback();
  });
  const cssRequested = page.waitForRequest(cssPath);
  try {
    await popup
      .locator('.docs-blameview-next-edit-button')
      .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
    await popup.dispatchEvent('keydown', { key: 'ArrowRight' });
    await content.evaluate((node) => {
      const replacement = node.cloneNode(false) as HTMLElement;
      replacement.innerHTML =
        '<div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "newer"</div>';
      node.replaceWith(replacement);
    });
    await cssRequested;
    await expect(diff.locator('.after .value')).toBeVisible();
    await expect(diff.locator('.after .value')).toHaveText('again');
    await expect(native).toBeHidden();
  } finally {
    releaseCss();
  }
  await expect(diff.locator('.after .value')).toHaveText('newer');
  await expect(diff).toHaveCount(1);
  await expect(native).toBeHidden();
});

test('content script: native values start hidden and unsupported content is restored', async ({
  page,
}) => {
  // Synthetic fixture covering both reused and replaced Sheets value nodes.
  await mockExtension(page);
  await page.route('**/fixtures/native-visibility', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Remplacé</span> "ancien" <span class="docs-blame-bold-text">par</span> "nouveau"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/native-visibility');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const native = page.locator('.docs-blameview-value-content');
  const diff = page.locator('spe-history-diff');
  await expect(native).toBeVisible();
  await expect(diff).toHaveCount(0);

  const immediatelyVisible = await native.evaluate((old) => {
    const replacement = document.createElement('div');
    replacement.className = 'docs-blameview-value-content';
    replacement.innerHTML = '<span class="docs-blame-bold-text">Added:</span> "new value"';
    old.replaceWith(replacement);
    return getComputedStyle(replacement).visibility;
  });
  expect(immediatelyVisible).toBe('hidden');
  await expect(diff.locator('.after .value')).toHaveText('new value');
  await expect(native).toBeHidden();

  await native.evaluate((node) => {
    node.innerHTML = '<span class="docs-blame-bold-text">Inconnu</span> "value"';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  const original = await native.innerHTML();
  expect(original).toContain('Inconnu');
  await native.evaluate((node) => {
    node.innerHTML = '<span class="docs-blame-bold-text">Added:</span> "another value"';
  });
  await expect(diff.locator('.after .value')).toHaveText('another value');
  await expect(native).toBeHidden();

  await page.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: { storage: { local: { set: (data: unknown) => Promise<void> } } };
      }
    ).chrome;
    await chrome.storage.local.set({ 'spe.settings.v1': { diffEnabled: false } });
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
});

test('content script: a stalled diff render restores native history', async ({ page }) => {
  await mockExtension(page);
  let requests = 0;
  await page.route('**/__extension__/content-scripts/sheets.css', async (route) => {
    requests++;
    if (requests <= 2) await new Promise((resolve) => setTimeout(resolve, 2200));
    await route.fulfill({
      body: await readFile(resolve('apps/extension/.output/chrome-mv3/content-scripts/sheets.css')),
      contentType: 'text/css',
    });
  });
  await page.route('**/fixtures/stalled-render', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "value"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/stalled-render');
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const native = page.locator('.docs-blameview-value-content');
  await expect(native).toBeHidden();
  await expect(native).toBeVisible({ timeout: 2100 });
  await expect(native).toContainText('value');
  await expect(page.locator('spe-history-diff .after .value')).toHaveText('value', {
    timeout: 5000,
  });
  await expect(native).toBeHidden();
});

test('content script: Added within displays the history summary when spaces are ambiguous', async ({
  page,
}) => {
  // Synthetic fixture modeled on an English Sheets history, not a live capture.
  await mockExtension(page);
  await page.route('**/fixtures/added-within-spaces', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
    <div id="t-formula-bar-input"><div class="cell-input">red  blueXred blueX<br></div></div>
    <div class="waffle-blameview" style="position:absolute;left:20px;top:100px;width:400px;background:white"><div class="docs-blameview">
      <div class="docs-blameview-next-edit-button" aria-disabled="true"></div>
      <div class="docs-blameview-value-content"><span class="docs-blame-bold-text">Added:</span> "Xred blue", <span class="docs-blame-bold-text">within</span> "red blueX"</div>
    </div></div></body></html>`,
    }),
  );
  await page.goto('/fixtures/added-within-spaces');
  const native = page.locator('.docs-blameview-value-content');
  const original = await native.innerHTML();
  await page.addScriptTag({
    path: extensionOutput('content-scripts/sheets.js'),
  });
  const diff = page.locator('spe-history-diff');
  await expect(diff.locator('.before .value')).toHaveText('red blueX');
  await expect(diff.locator('.after .value')).toHaveText('red  blueXred blueX');
  expect(await diff.locator('.before .value').textContent()).toBe('red blueX');
  expect(await diff.locator('.after .value').textContent()).toBe('red  blueXred blueX');
  await expect(diff).not.toContainText('空白の数が実際と異なる場合があります');
  expect(await native.innerHTML()).toBe(original);
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'false'));
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
  await page
    .locator('.docs-blameview-next-edit-button')
    .evaluate((node) => node.setAttribute('aria-disabled', 'true'));
  await expect(diff).toHaveCount(1);
  await page.locator('.cell-input').evaluate((node) => {
    node.innerHTML = 'red  greenXred blueX<br>';
  });
  await expect(diff).toHaveCount(0);
  await expect(native).toBeVisible();
});
