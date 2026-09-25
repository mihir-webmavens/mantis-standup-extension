# Tests

```sh
npm test                 # everything (~20 s)
npm run test:unit        # background.js only, no browser needed (< 1 s)
npm run test:ui          # Mantis panels (content.js) in headless Chrome
npm run test:extension   # the real extension loaded in Chromium
```

Node 22+ and no npm packages: the tests use `node:test` and drive the browser
over the DevTools protocol (`helpers/browser.mjs`).

| Folder | What it covers | How |
| --- | --- | --- |
| `unit/` | Reading/saving the standup site's pages, badge, EOD reminder, shortcut routing | `background.js` runs in a Node `vm` with a fake `chrome` API and a fake standup server (`helpers/background.mjs`) |
| `ui/` | Standup/EOD panels: Esc and focus, saving, Est Time, priority, duplicate notice, EOD-only pages | `content.js` on a stand-in Mantis page (`ui/harness.html`) with a fake background |
| `extension/` | Toolbar popup (EOD tab, style picker, reminder, shortcuts list), shortcuts opening panels | The unpacked extension in Chromium; the service worker's requests are answered by the same fake standup server |

`fixtures/edit-standups.html` is a sanitized copy of the real EOD page
(`/admin/standups/edit-standups`). If the standup site changes its markup,
update the fixture from the real page (keeping made-up values) and rerun.

## Browsers

- `ui/` uses `CHROME_PATH`, else any Chrome/Chromium it finds.
- `extension/` needs a Chromium that still accepts `--load-extension`
  (Google Chrome 137+ does not): `CHROMIUM_PATH`, else Playwright's Chromium
  (`npx playwright install chromium`) or a distro `chromium`.

Without a suitable browser those suites are skipped, not failed.
