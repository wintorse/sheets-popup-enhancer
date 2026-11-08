# Development

- Package manager: pnpm. Keep the lockfile in the repository.
- Use WXT + Svelte 5 runes + TypeScript. Runtime dependencies must be bundled.
- Keep Sheets selectors and localized history parsing in apps/extension. Shared packages must not depend on Sheets or chrome APIs.
- Preserve the original Sheets DOM. Unknown or ambiguous history must remain in the native view.
- Do not send or persist cell/comment contents. Store preferences in chrome.storage.local.
- Update the synthetic locale fixtures when changing the parser. Clearly distinguish synthetic fixtures from live captured DOM.
- Keep functions focused on one responsibility. Oxlint enforces cyclomatic complexity <= 12 and forbids nested ternaries in scripts; also avoid nested ternaries in Svelte templates.
- Oxlint checks for floating promises in TypeScript files. Type-aware rules do not cover Svelte files, and `void` does not handle rejected promises.
- After making code changes, run `pnpm lint:fix`, then run `pnpm format`.
- Run `pnpm check`, `pnpm test` and `pnpm test:e2e` after relevant changes.
- Chrome browser tests use the installed Google Chrome; Firefox browser tests use Playwright's Firefox. Neither tests an authenticated Sheets session.
- Resize handles are pointer-only. Leave arrow keys to native Sheets history navigation and keep resize grips out of the tab order.
- Popup bounds must reserve 36px for the Sheets tab bar plus a 14px bottom margin. Keep resize handles out of native flex/grid flow and do not force a stable scrollbar gutter.
