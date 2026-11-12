# Sheets Popup Enhancer

English | [日本語](README.md)

Sheets Popup Enhancer is a browser extension that widens comments and cell edit history in Google Sheets and displays cell edit history as a GitHub-style diff.

![Cell edit history showing a split diff](docs/images/edit-history-en.png)

![Cell edit history showing a unified diff](docs/images/edit-history-unified-en.png)

![A widened comment popup](docs/images/comments-en.png)

![Extension settings](docs/images/settings-en.png)

<a href="https://chromewebstore.google.com/detail/oanlemabfmlfpoecknphldpdmiefnljg">
  <picture>
    <source srcset="https://i.imgur.com/XBIE9pk.png" media="(prefers-color-scheme: dark)">
    <img height="58" src="https://i.imgur.com/oGxig2F.png" alt="Chrome Web Store"></picture></a>
<a href="https://addons.mozilla.org/en-US/firefox/addon/sheets-popup-enhancer/">
  <picture>
    <source srcset="https://i.imgur.com/ZluoP7T.png" media="(prefers-color-scheme: dark)">
    <img height="58" src="https://i.imgur.com/4PobQqE.png" alt="Firefox add-ons"></picture></a>
<br/><br/>

Built with WXT, Svelte 5, and TypeScript.

## Load in Chrome

```sh
cd sheets-popup-enhancer
pnpm install
pnpm build
```

1. Open `chrome://extensions` in Chrome and enable Developer mode.
2. Select **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.
3. Reload the Google Sheets tab.

## Load in Firefox

```sh
cd sheets-popup-enhancer
pnpm install
pnpm build:firefox
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Select **Load Temporary Add-on** and choose `apps/extension/.output/firefox-mv3/manifest.json`.
3. Reload the Google Sheets tab.

The temporary add-on is removed when Firefox exits.

For development, run `pnpm dev` for Chrome or `pnpm dev:firefox` for Firefox.

## Features

- Resize comments and cell edit history.
- View GitHub-style diffs.
- Choose between Unified and Split layouts.
- Copy the before or after value from the “…” menu.
- Customize the extension in the settings panel.

## Project structure

```text
apps/
  extension/             WXT browser extension
    entrypoints/         Content script and settings popup
    src/sheets/          Sheets-specific history parsing
    src/ui/              Svelte components inserted into Sheets
packages/
  diff-ui/               Sheets-independent Svelte diff view
  resizable/             Framework-independent resize behavior
tests/browser/           Browser tests
```

## Scripts

```sh
pnpm format           # Format code with Oxfmt
pnpm lint             # Check code with Oxlint
pnpm check            # Lint, format checks, and TypeScript / Svelte type checks
pnpm test             # Unit tests for history parsing, diffs, and resizing
pnpm test:e2e         # Build the extension and run Chrome browser tests
pnpm test:e2e:firefox # Build the Firefox extension and run Firefox browser tests
pnpm zip              # Package the extension as a ZIP
pnpm zip:firefox      # Create Firefox extension and source ZIPs
```

Note: Oxlint does not check Svelte templates.

Chrome browser tests use the installed Google Chrome. Firefox tests require `pnpm exec playwright install firefox` beforehand.

## Limitations

The extension relies on Google Sheets' DOM structure and localized text. It may not work with some locales (browser or device language settings), and changes to Google Sheets may cause it to stop working.

## Data handling

See the [privacy policy](PRIVACY.md#english).

## License

This project is released under the [MIT License](LICENSE). Licenses for dependencies and other third parties are collected in [THIRD_PARTY_LICENSES.txt](apps/extension/public/THIRD_PARTY_LICENSES.txt), which is also included in the extension.

## Credits

The extension's name and settings popup UI were inspired by [Sheets Row Highlighter](https://github.com/matsu7089/sheets-row-highlighter).
