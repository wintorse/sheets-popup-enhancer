import { defineContentScript } from 'wxt/utils/define-content-script';
import { loadSettings } from '../../src/settings';
import { PopupController } from '../../src/sheets/popup-controller';
import pageCss from './page.css?inline';
import './shadow.css';

export default defineContentScript({
  matches: ['https://docs.google.com/spreadsheets/*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    try {
      await loadSettings();
    } catch {
      /* Defaults keep the UI usable if storage is unavailable. */
    }
    if (ctx.isInvalid) return;
    const controller = new PopupController(ctx, pageCss);
    controller.start();
    ctx.onInvalidated(() => controller.stop());
  },
});
