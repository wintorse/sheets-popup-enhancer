<script lang="ts">
  import { onMount } from 'svelte';
  import { t, localeFor } from '../../src/i18n';
  import type { DiffLayout } from '@spe/diff-ui';
  import { defaults, loadSettings, saveSettings, settings, type Settings } from '../../src/settings';
  let commentWidth = $state(defaults.commentWidth);
  let historyWidth = $state(defaults.historyWidth);
  let fontScale = $state(defaults.fontScale);
  let layout = $state<DiffLayout>(defaults.layout);
  let diffEnabled = $state(true);
  let rowHighlighterCompatibility = $state(defaults.rowHighlighterCompatibility);
  let status = $state('');
  let ready = $state(false);
  let saving = false;
  let pending: Settings | undefined;
  function fill(value: typeof defaults) {
    commentWidth = value.commentWidth; historyWidth = value.historyWidth; fontScale = value.fontScale; layout = value.layout; diffEnabled = value.diffEnabled; rowHighlighterCompatibility = value.rowHighlighterCompatibility;
  }
  onMount(() => {
    let alive = true;
    async function initialize() {
      try { await loadSettings(); if (alive) { const stop = settings.subscribe(fill); stop(); ready = true; } }
      catch { if (alive) status = t.loadError; }
    }
    void initialize();
    return () => { alive = false; };
  });
  async function save(value: Settings) {
    pending = value;
    if (saving) return;
    saving = true;
    while (pending) {
      const next = pending;
      pending = undefined;
      try { await saveSettings(next); status = ''; }
      catch { status = t.saveError; }
    }
    saving = false;
  }
  function saveChange(change: Partial<Settings>) {
    void save({ commentWidth, historyWidth, fontScale, layout, diffEnabled, rowHighlighterCompatibility, ...change });
  }
</script>

<main lang={localeFor(navigator.language).replace('_', '-')}>
  <form onsubmit={(event) => event.preventDefault()}>
    <fieldset disabled={!ready}>
      <legend class="sr-only">{t.settings}</legend>
      <div class="sheet">
        <div class="sheet-row column-headings" aria-hidden="true"><span></span><span>A</span><span>B</span><span>C</span></div>
        <div class="sheet-row section-row"><span class="row-number" aria-hidden="true">1</span><span class="section-title" dir="auto">{t.width}</span></div>
        <div class="sheet-row setting-row">
          <span class="row-number" aria-hidden="true">2</span><label for="comment" dir="auto">{t.comment}</label>
          <div class="range-cell"><input id="comment" type="range" min="280" max="1200" step="10" bind:value={commentWidth} oninput={(event) => saveChange({ commentWidth: Number(event.currentTarget.value) })} aria-valuetext={`${commentWidth} ${t.pixels}`} style={`--fill: ${(commentWidth - 280) / 920 * 100}%`}/></div><span class="value" aria-hidden="true">{commentWidth} <small>px</small></span>
        </div>
        <div class="sheet-row setting-row">
          <span class="row-number" aria-hidden="true">3</span><label for="history" dir="auto">{t.history}</label>
          <div class="range-cell"><input id="history" type="range" min="280" max="1200" step="10" bind:value={historyWidth} oninput={(event) => saveChange({ historyWidth: Number(event.currentTarget.value) })} aria-valuetext={`${historyWidth} ${t.pixels}`} style={`--fill: ${(historyWidth - 280) / 920 * 100}%`}/></div><span class="value" aria-hidden="true">{historyWidth} <small>px</small></span>
        </div>
        <div class="sheet-row section-row"><span class="row-number" aria-hidden="true">4</span><span class="section-title" dir="auto">{t.diff}</span></div>
        <div class="sheet-row setting-row"><span class="row-number" aria-hidden="true">5</span><label for="diff-enabled" dir="auto">{t.enabled}</label><label class="checkbox-cell"><input id="diff-enabled" type="checkbox" bind:checked={diffEnabled} onchange={(event) => saveChange({ diffEnabled: event.currentTarget.checked })}/></label><span aria-hidden="true"></span></div>
        <div class="sheet-row setting-row"><span class="row-number" aria-hidden="true">6</span><label for="layout" dir="auto">{t.initial}</label><span class="select-cell"><select id="layout" bind:value={layout} onchange={(event) => saveChange({ layout: event.currentTarget.value as DiffLayout })}><option value="split">{t.split}</option><option value="unified">{t.unified}</option></select></span><span aria-hidden="true"></span></div>
        <div class="sheet-row section-row"><span class="row-number" aria-hidden="true">7</span><span class="section-title" dir="auto">{t.fontSize}</span></div>
        <div class="sheet-row setting-row">
          <span class="row-number" aria-hidden="true">8</span><label for="font-scale" dir="auto">{t.scale}</label>
          <div class="range-cell"><input id="font-scale" aria-label={`${t.fontSize} ${t.scale}`} type="range" min="80" max="120" step="10" bind:value={fontScale} oninput={(event) => saveChange({ fontScale: Number(event.currentTarget.value) })} aria-valuetext={`${fontScale}%`} style={`--fill: ${(fontScale - 80) / 40 * 100}%`}/></div><span class="value" aria-hidden="true">{fontScale} <small>%</small></span>
        </div>
        <div class="sheet-row section-row"><span class="row-number" aria-hidden="true">9</span><span class="section-title" dir="auto">{t.rowHighlighterOrder}</span></div>
        <div class="sheet-row setting-row"><span class="row-number" aria-hidden="true">10</span><label for="row-highlighter" dir="auto">{t.rowHighlighterCompatibility}</label><label class="checkbox-cell"><input id="row-highlighter" type="checkbox" bind:checked={rowHighlighterCompatibility} onchange={(event) => saveChange({ rowHighlighterCompatibility: event.currentTarget.checked })}/></label><span aria-hidden="true"></span></div>
        <div class="sheet-row setting-row"><span class="row-number" aria-hidden="true">11</span><span class="reset-cell"><button type="button" class="reset" onclick={() => { fill(defaults); void save({ ...defaults }); }}>{t.reset}</button></span></div>
      </div>
    </fieldset>
  </form>
  <p class="status" role="status" dir="auto">{status}</p>
</main>

<style>
  :global(body) { margin: 0; width: 410px; background: #fff; color: #202124; font: 13px/1.5 system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  main { padding: 16px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .sheet { border-top: 1px solid #bdc1c6; border-left: 1px solid #bdc1c6; }
  .sheet-row { display: grid; grid-template-columns: 27px 120px minmax(0, 1fr) 58px; }
  .sheet-row > * { min-width: 0; border-right: 1px solid #dadce0; border-bottom: 1px solid #dadce0; }
  .column-headings { height: 24px; text-align: center; color: #5f6368; background: #fff; font-size: 11px; }
  .column-headings > span { display: grid; place-items: center; border-color: #bdc1c6; }
  .row-number { display: grid; place-items: center; border-color: #bdc1c6; color: #5f6368; background: #fff; font-size: 11px; }
  .section-title { grid-column: 2 / -1; padding: 5px 9px; background: #e6f4ea; color: #137333; font-size: 11px; font-weight: 650; }
  .setting-row { min-height: 36px; }
  .setting-row > label { display: flex; align-items: center; padding: 0 8px; font-size: 12px; }
  .range-cell { display: flex; align-items: center; padding: 3px 4px; }
  input[type='range'] { appearance: none; width: 100%; height: 26px; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
  input[type='range']::-webkit-slider-runnable-track { height: 24px; background: linear-gradient(to right, #1a73e8 var(--fill), #f1f3f4 var(--fill)); }
  input[type='range']::-webkit-slider-thumb { appearance: none; width: 1px; height: 24px; margin-top: 0; border: 0; background: transparent; }
  input[type='range']::-moz-range-track { height: 24px; background: linear-gradient(to right, #1a73e8 var(--fill), #f1f3f4 var(--fill)); }
  input[type='range']::-moz-range-thumb { width: 1px; height: 24px; border: 0; background: transparent; }
  .value { display: flex; justify-content: flex-end; align-items: center; gap: 3px; padding: 0 5px; font-variant-numeric: tabular-nums; font-size: 11px; }
  .value small { color: #5f6368; font-size: 10px; }
  .setting-row > .checkbox-cell { justify-content: center; cursor: pointer; }
  input[type='checkbox'] { width: 17px; height: 17px; margin: 0; accent-color: #1a73e8; }
  .select-cell { position: relative; display: flex; align-items: center; padding: 3px 5px; }
  .select-cell::after { content: ''; position: absolute; right: 18px; top: 50%; transform: translateY(-50%); border: 4px solid transparent; border-top-color: #434343; border-bottom: 0; pointer-events: none; }
  select { appearance: none; width: 100%; padding: 5px 30px 5px 12px; border: 0; border-radius: 999px; color: #3d3d3d; background: #e8eaed; font: inherit; font-size: 12px; }
  select:hover { background: #d0d2d5; }
  .reset-cell { grid-column: 2 / -1; display: flex; align-items: center; justify-content: center; padding: 3px 5px; }
  .reset { padding: 4px 10px; border: 1px solid #dadce0; border-radius: 4px; color: #1a73e8; background: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  :global(:focus-visible) { outline: 2px solid var(--spe-primary); outline-offset: 3px; }
  .status { color: var(--spe-text-secondary); font-size: 11px; margin: 8px 0 0; }
  .status:empty { display: none; }
</style>
