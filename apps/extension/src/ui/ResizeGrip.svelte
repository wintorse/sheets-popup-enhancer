<script lang="ts">
  import { resizeHandle } from '@spe/resizable';
  import { MIN_POPUP_WIDTH, MAX_POPUP_WIDTH } from '../settings';
  let { target, setWidth, direction, oncommit }: { target: HTMLElement; setWidth: (width: number) => void; direction: () => 1 | -1; oncommit: () => void } = $props();
</script>

<div data-resize-handle aria-hidden="true" use:resizeHandle={{ target, minWidth: MIN_POPUP_WIDTH, maxWidth: () => Math.min(MAX_POPUP_WIDTH, target.ownerDocument.defaultView!.innerWidth), setWidth, direction, oncommit }}>
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m3 11 8-8M7 11l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</div>

<style>
  div { display: grid; place-items: center; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; border-radius: 4px; color: var(--spe-text-secondary); cursor: ew-resize; touch-action: none; -webkit-user-select: none; user-select: none; }
  div:hover { color: var(--spe-primary); background: var(--spe-selected); }
</style>
