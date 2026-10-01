# Repository Guidelines

## Project Structure & Module Organization

This is a Chrome Manifest V3 extension with plain JavaScript, HTML, and CSS at the repository root. `manifest.json` defines permissions, content scripts, shortcuts, and the service worker. `background.js` handles standup requests, reminders, and native messaging. `content.js` implements the Mantis standup/EOD panels; `popup.*` implements the toolbar popup. Header, theme, preview, playground, and MantisAI modules live alongside them. Icons are in `icons/`.

`native-host/` contains the Node.js Claude CLI helper and its installer. Tests are grouped into `tests/unit/`, `tests/ui/`, and `tests/extension/`, with shared helpers and sanitized fixtures. `.claude/skills/standup/` contains the companion Claude Code skill.

## Build, Test, and Development Commands

Use Node.js 22 or newer. There is no build step or npm dependency installation required.

- `npm test`: run all suites.
- `npm run test:unit`: test background logic and the native helper.
- `npm run test:ui`: exercise panels in headless Chrome.
- `npm run test:extension`: test the unpacked extension in Chromium.

For local development, enable Developer mode at `chrome://extensions`, load this folder unpacked, and reload the extension after edits. Refresh Mantis tabs to load updated content scripts. Log in to both Mantis and the standup site for manual workflow checks.

## Coding Style & Naming Conventions

Follow existing conventions: two-space indentation, semicolons, single-quoted JavaScript strings, `camelCase` functions/variables, and `UPPER_SNAKE_CASE` constants. Use descriptive, hyphenated filenames and `.test.mjs` test files. No formatter or linter is configured; keep changes consistent with surrounding code.

## Testing Guidelines

Tests use Node's `node:test` and `node:assert/strict`, plus a custom DevTools browser driver. Add regression coverage for changed behavior, especially saving, failures, concurrency, and permissions. No numeric coverage threshold is configured.

Set `CHROME_PATH` for UI tests or `CHROMIUM_PATH` for extension tests when needed. Browser suites can skip without a suitable browser; report skips explicitly. Keep server fixtures sanitized. See `tests/README.md` for setup details.

## Commit & Pull Request Guidelines

History uses descriptive imperative subjects such as “Add…” or “Fix…”, sometimes with release versions; Conventional Commits are not required. Keep commits focused. PRs should describe the behavior change, relevant issues, validation results, and screenshots for visible UI changes.

## Security & Configuration

Keep host permissions narrow. Preserve CSRF handling, session credentials, native-host tool restrictions, and approval gates for Mantis changes. Never commit credentials, real session tokens, or private ticket data.
