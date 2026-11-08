<script lang="ts">
  import { DiffView } from '@spe/diff-ui';
  import { t, localeFor } from '../i18n';
  import { settings, saveSettings } from '../settings';
  import type { CellChange } from '../sheets/history';
  let { change }: { change: CellChange } = $props();
  let error = $state('');
</script>

<div class="history-diff" style:--spe-font-scale={$settings.fontScale / 100} lang={localeFor(navigator.language).replace('_', '-')}>
  <DiffView labels={t} oldText={change.oldText} newText={change.newText} layout={$settings.layout} onchange={async (layout) => {
    try { await saveSettings({ ...$settings, layout }); error = ''; }
    catch { error = t.layoutError; }
  }}/>
  {#if error}<p role="status" dir="auto">{error}</p>{/if}
</div>

<style>
  .history-diff { --spe-font-family: "Google Sans", Roboto, RobotoDraft, Helvetica, Arial, sans-serif; padding: 12px 0; width: 100%; min-width: 0; font-family: var(--spe-font-family); }
  p { color: var(--spe-error); font-size: 11px; }
</style>
