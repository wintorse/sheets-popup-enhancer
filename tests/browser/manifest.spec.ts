import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('the target browser manifest contains its required settings', async () => {
  const testInfo = test.info();
  const browser = testInfo.project.name;
  const path = resolve(`apps/extension/.output/${browser}-mv3/manifest.json`);
  const manifest = JSON.parse(await readFile(path, 'utf8'));

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toContain('storage');
  expect(manifest.action.default_popup).toBe('popup.html');
  expect(manifest.content_scripts[0].matches).toContain('https://docs.google.com/spreadsheets/*');
  if (browser === 'firefox') {
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: 'sheets-popup-enhancer@wintorse',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    });
  } else {
    expect(manifest.minimum_chrome_version).toBe('120');
    expect(manifest.browser_specific_settings).toBeUndefined();
  }
});
