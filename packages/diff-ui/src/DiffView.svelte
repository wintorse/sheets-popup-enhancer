<script lang="ts">
  import './theme.css';
  import { buildDiff, buildSplitRows, buildUnifiedRows, type DiffLayout, type Token, type UnifiedRow } from './model';
  let {
    oldText, newText, labels = { cellDiff: 'セル値の差分', menu: '差分メニュー', splitDiff: 'Split差分', unifiedDiff: 'Unified差分', caption: 'セル値の変更前と変更後', deleted: '削除: ', added: '追加: ', simplified: '差分の計算を省略しました。', copyBefore: '変更前をコピー', copyAfter: '変更後をコピー', copyError: 'コピーできませんでした', before: '変更前', after: '変更後' }, layout = $bindable<DiffLayout>('split'), onchange,
  }: {
    oldText: string; newText: string; labels?: { cellDiff: string; menu: string; splitDiff: string; unifiedDiff: string; caption: string; deleted: string; added: string; simplified: string; copyBefore: string; copyAfter: string; copyError: string; before: string; after: string }; layout?: DiffLayout;
    onchange?: (layout: DiffLayout) => void;
  } = $props();
  function rowMarker(kind: UnifiedRow['kind']): string {
    if (kind === 'deletion') return '−';
    if (kind === 'addition') return '+';
    return ' ';
  }
  function rowLabel(kind: UnifiedRow['kind']): string {
    if (kind === 'deletion') return labels.deleted;
    if (kind === 'addition') return labels.added;
    return '';
  }
  function exceedsLimit(value: string) {
    if (value.length <= 10_000) return false;
    let count = 0;
    for (const _character of value) if (++count > 10_000) return true;
    return false;
  }
  const plain = $derived(exceedsLimit(oldText) || exceedsLimit(newText));
  const model = $derived(plain ? undefined : buildDiff(oldText, newText));
  const splitRows = $derived(model ? buildSplitRows(model) : []);
  const singleSidedChange = $derived((oldText === '') !== (newText === ''));
  const effectiveLayout = $derived(singleSidedChange ? 'unified' : layout);
  const unifiedRows = $derived(effectiveLayout === 'unified' ? buildUnifiedRows(splitRows) : []);
  const id = $props.id();
  const menuId = `${id}-layout`;
  const anchorName = `--diff-layout-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let menuOpen = $state(false);
  let copyStatus = $state('');
  let copyRequest = 0;
  $effect(() => {
    // Track both values so a change clears any previous copy error.
    void oldText;
    void newText;
    copyRequest++;
    copyStatus = '';
  });
  function positionMenu() {
    // Chrome 120 supports Popover, but predates CSS anchor positioning.
    if (!menu?.matches(':popover-open') || CSS.supports('position-area: block-end')) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
    const top = rect.bottom + 4 + menu.offsetHeight <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - menu.offsetHeight - 4);
    menu.style.setProperty('--menu-left', `${left}px`);
    menu.style.setProperty('--menu-top', `${top}px`);
  }
  function syncMenu(event: ToggleEvent) { menuOpen = event.newState === 'open'; if (menuOpen) positionMenu(); }
  function setLayout(value: DiffLayout) {
    if (!singleSidedChange) { layout = value; onchange?.(value); }
    trigger.focus({ preventScroll: true });
    menu.hidePopover();
  }
  async function copy(value: string) {
    const request = ++copyRequest;
    copyStatus = '';
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      if (request === copyRequest) copyStatus = labels.copyError;
    }
    trigger.focus({ preventScroll: true });
    menu.hidePopover();
  }
</script>

<svelte:window onresize={positionMenu} onscrollcapture={positionMenu}/>

{#snippet value(tokens: Token[])}
  <span class="value" dir="auto">{#each tokens as token}<span class:highlight={token.changed}>{token.text}</span>{/each}</span>
{/snippet}

<section class="diff-view" aria-label={labels.cellDiff}>
  <header class="toolbar">
    <button bind:this={trigger} class="menu-trigger" type="button" aria-label={labels.menu} aria-expanded={menuOpen} popovertarget={menuId} style:anchor-name={anchorName}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="19" cy="12" r="1.75"/></svg>
    </button>
    <div bind:this={menu} id={menuId} popover="auto" class="layout-popover" style:position-anchor={anchorName} ontoggle={syncMenu}>
      <div>
        <button type="button" aria-label="Unified" aria-pressed={effectiveLayout === 'unified'} onclick={() => setLayout('unified')}>Unified</button>
        <button type="button" aria-label="Split" aria-pressed={effectiveLayout === 'split'} disabled={singleSidedChange} onclick={() => setLayout('split')}>Split</button>
      </div>
      <div class="copy-actions">
        <button type="button" onclick={() => copy(oldText)}>{labels.copyBefore}</button>
        <button type="button" onclick={() => copy(newText)}>{labels.copyAfter}</button>
      </div>
    </div>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need access to the scrollable diff region.) -->
  <div class="code" role="region" aria-label={effectiveLayout === 'split' ? labels.splitDiff : labels.unifiedDiff} tabindex="0">
    {#if plain}
    <div class="plain" class:split={effectiveLayout === 'split'}>
      <div class="plain-value" role="group" aria-label={labels.before} dir="auto">{oldText}</div>
      <div class="plain-value" role="group" aria-label={labels.after} dir="auto">{newText}</div>
    </div>
    {:else}
    <table class:split={effectiveLayout === 'split'} class:unified={effectiveLayout === 'unified'}>
      <caption class="sr-only">{labels.caption}</caption>
      {#if effectiveLayout === 'split'}
        <colgroup><col class="number-column"/><col/></colgroup><colgroup><col class="number-column"/><col/></colgroup>
        <tbody>
          {#each splitRows as row}
            <tr>
              {#each [{ key: 'before', line: row.before, symbol: '−' }, { key: 'after', line: row.after, symbol: '+' }] as side (side.key)}
                <td class="number {side.key}" class:changed={side.line?.changed} class:spacer={!side.line}>{side.line?.number ?? ''}</td>
                <td class="content {side.key}" class:changed={side.line?.changed} class:spacer={!side.line}>
                  {#if side.line}<span class="marker" aria-hidden="true">{side.line.changed ? side.symbol : ' '}</span>{@render value(side.line.tokens)}{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      {:else}
        <colgroup><col class="number-column"/><col class="number-column"/><col/></colgroup>
        <tbody>
          {#each unifiedRows as row}
            <tr class:before={row.kind === 'deletion'} class:after={row.kind === 'addition'} class:changed={row.kind !== 'context'}>
              <td class="number">{row.oldNumber ?? ''}</td><td class="number">{row.newNumber ?? ''}</td>
              <td class="content"><span class="sr-only">{rowLabel(row.kind)}</span><span class="marker" aria-hidden="true">{rowMarker(row.kind)}</span>{@render value(row.tokens)}</td>
            </tr>
          {/each}
        </tbody>
      {/if}
    </table>
    {/if}
  </div>
  {#if model?.simplified}<p class="note" dir="auto">{labels.simplified}</p>{/if}
  <p class="note" role="status" dir="auto">{copyStatus}</p>
</section>

<style>
  .diff-view { direction: ltr; color: var(--spe-text); font: 13px/1.65 var(--spe-font-family, system-ui, sans-serif); text-align: left; min-width: 0; padding-inline: 18px; }
  * { box-sizing: border-box; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 4px 6px 4px 10px; border: 1px solid var(--spe-outline); border-block-end: 0; border-radius: 7px 7px 0 0; background: var(--spe-surface-subtle); }
  button { min-height: 28px; border: 0; border-radius: 4px; background: transparent; padding: 3px 10px; color: var(--spe-text-secondary); font: 11px var(--spe-font-family, system-ui, sans-serif); cursor: pointer; }
  .menu-trigger { display: grid; place-items: center; width: 30px; margin-left: auto; padding: 0; }
  .menu-trigger[aria-expanded='true'] { background: var(--spe-selected); color: var(--spe-selected-text); }
  .layout-popover { position: fixed; inset: auto; margin: 4px 0; padding: 4px; min-width: 128px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border: 1px solid var(--spe-outline); border-radius: 7px; background: var(--spe-surface); color: var(--spe-text); box-shadow: 0 4px 14px var(--spe-shadow-soft); }
  .layout-popover button { display: flex; align-items: center; width: 100%; gap: 8px; text-align: left; padding: 6px 8px; }
  .layout-popover button::before { content: ''; width: 14px; flex: none; }
  .layout-popover button[aria-pressed='true'] { background: var(--spe-selected); color: var(--spe-selected-text); }
  .layout-popover button[aria-pressed='true']::before { content: '✓'; }
  .copy-actions { border-top: 1px solid var(--spe-outline); margin-top: 4px; padding-top: 4px; }
  @supports (position-area: block-end) {
    .layout-popover { position-area: block-end span-inline-start; justify-self: end; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; }
  }
  @supports not (position-area: block-end) {
    .layout-popover { left: var(--menu-left); top: var(--menu-top); margin: 0; }
  }
  button:hover:not(:disabled) { background: var(--spe-selected); }
  button:disabled { opacity: .45; cursor: default; }
  button:focus-visible, .code:focus-visible { outline: 2px solid var(--spe-primary); outline-offset: 2px; }
  .code { overflow-x: auto; border: 1px solid var(--spe-outline); border-radius: 0 0 7px 7px; background: var(--spe-surface); font: calc(12em / 13 * var(--spe-font-scale, 1))/1.8 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
  .plain.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .plain-value { min-width: 0; padding: 4px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .plain-value + .plain-value { border-top: 1px solid var(--spe-outline); }
  .plain.split .plain-value + .plain-value { border-top: 0; border-left: 1px solid var(--spe-outline); }
  table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
  .number-column { width: 2.5em; }
  td { vertical-align: top; padding-block: 0; }
  .number { padding-inline: 3px; text-align: right; color: var(--spe-text-secondary); user-select: none; }
  .number { background: var(--spe-surface-subtle); }
  .content { position: relative; padding-inline: 2em 10px; }
  .content:has(.value:dir(rtl)) { text-align: right; }
  .marker { position: absolute; left: .6em; user-select: none; }
  .value { white-space: pre-wrap; overflow-wrap: anywhere; }
  .value::after { content: '\200b'; }
  .split .after.number { border-left: 1px solid var(--spe-outline); }
  .before.changed, .before.changed td { background: var(--spe-deleted-surface); }
  .after.changed, .after.changed td { background: var(--spe-added-surface); }
  .before .highlight { background: var(--spe-deleted-highlight); color: var(--spe-deleted-text); border-radius: 2px; }
  .after .highlight { background: var(--spe-added-highlight); color: var(--spe-added-text); border-radius: 2px; }
  .spacer { background: var(--spe-surface-muted); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .note { font-size: 10px; color: var(--spe-text-secondary); margin: 8px 0 0; }
  .note:empty { display: none; }
  @media (forced-colors: active) {
    .highlight { color: HighlightText !important; }
  }
</style>
