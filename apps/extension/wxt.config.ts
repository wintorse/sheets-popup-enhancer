import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

const icons = {
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  zip: {
    sourcesRoot: resolve(import.meta.dirname, '../..'),
    includeSources: [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'apps/extension/**',
      'packages/**',
      'docs/images/**',
      'README.md',
      'README.en.md',
      'PRIVACY.md',
      'LICENSE',
    ],
  },
  manifest: ({ browser }) => ({
    name: 'Sheets Popup Enhancer',
    default_locale: 'en',
    description: '__MSG_description__',
    version: '1.1.0',
    permissions: ['storage'],
    icons,
    action: { default_icon: icons },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'sheets-popup-enhancer@wintorse',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : { minimum_chrome_version: '120' }),
  }),
});
