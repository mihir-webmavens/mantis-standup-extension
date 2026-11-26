# Mantis Quick Standup

A Chrome extension for adding Standups and EODs to
[standup.webmavens.dev](https://standup.webmavens.dev) straight from Mantis
([projects.webmavens.dev](https://projects.webmavens.dev)).

## Install

1. Clone this repo:
   ```bash
   git clone https://github.com/mihir-webmavens/mantis-standup-extension.git
   ```
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
   and pick the cloned folder.
3. Log in to Mantis and the standup site in Chrome. The extension uses your own
   session.

### Shortcuts

- `Ctrl + Shift + S`: Add Standup (on a Mantis ticket page it is filled in from the ticket)
- `Ctrl + Shift + E`: Add or edit today's EODs

You can change them at `chrome://extensions/shortcuts`.

## Ticket digest and time tracker

Both are switched on in the toolbar popup → **Settings**, and shown on the
**Insights** page (the *Open Insights* button there).

- **Ticket digest:** your active tickets (new, assigned or in progress, without
  the "Completed - Needs Testing" / "[Testing done]" label), with the ones that
  have had no update for a set number of days (3 by default) flagged as stale.
  A daily notification at the time you pick. It uses the MantisAI helper
  (Settings → MantisAI) for read-only lookups, so set that up first. After
  updating the extension, click **Reinstall helper** there once.
- **Time tracker:** counts the time Chrome is focused on each Mantis ticket and
  on other sites, paused while you are idle or in another app. Shows a weekly
  breakdown per day, ticket and site. Other sites are kept by host name only,
  stored on this computer for 90 days. Chrome asks to let the extension see your
  tabs when you turn it on.

## MantisAI and PDF attachments

MantisAI (the chat panel on Mantis pages) can read PDF attachments, such as client
feedback with screenshots, drawn notes and sticky-note comments. Ask it something
like *"read the PDF on this ticket"*. Its `read_pdf` tool returns:

- **Page images:** 150 DPI JPEGs at most 1600px wide, at most 10 pages per call
  (`page_from` / `page_to`, then `next_page_from` while `has_more_pages`).
- **Text** (`text_content`) of those pages, capped at 50,000 characters
  (`text_truncated`).
- **Annotations:** sticky notes, comments, highlights and free text, with page,
  type, author and date.

How it works: the Mantis server only returns a link for PDFs, so the Mantis tab
downloads the file from `/attachments/{id}/download` with your own session.
Mantis therefore decides whether you may read it, the same as in the web UI. The
MantisAI helper then converts it on this computer. Nothing is sent anywhere else.
PDFs over 50 MB or 200 pages, password-protected ones and damaged ones come back
with a `preview_error` instead.

**Needs poppler-utils** (`pdfinfo`, `pdftoppm`, `pdftotext`) on the computer
running the helper:

```bash
sudo apt install poppler-utils   # Debian/Ubuntu
brew install poppler             # macOS
```

After updating the extension, click **Reinstall helper** in the toolbar popup →
Settings → MantisAI once (helper 1.4.0 or newer). Converted pages are cached in
the helper's folder (`~/.local/share/mantis-ai/pdf-cache`) by file content and
removed after 7 days unused.

## Using with Claude Code

The repo includes a `/standup` skill for [Claude Code](https://claude.com/claude-code)
(`.claude/skills/standup/SKILL.md`). With it, Claude adds Standups and fills in
EODs for you through the extension.

### Get the skill

Pick one:

- **Only in this folder:** run Claude Code inside the cloned repo. It finds the
  skill automatically.
  ```bash
  cd mantis-standup-extension
  claude
  ```
- **From any folder:** copy the skill into your personal skills.
  ```bash
  mkdir -p ~/.claude/skills/standup
  cp mantis-standup-extension/.claude/skills/standup/SKILL.md ~/.claude/skills/standup/
  ```

### Use it

```
/standup add standup for #1234
/standup fill today's EOD
```

Claude asks for anything missing, such as the Planned Action or the EOD text.
It shows you the text and waits for your OK before it saves.

### Requirements for screen control

To click and type for you, Claude drives your real Chrome window. That needs:

- Linux with an **X11** session (check with `echo $XDG_SESSION_TYPE`)
- `xdotool` and `scrot`:
  ```bash
  sudo apt install xdotool scrot
  ```

On Windows, macOS or Wayland, the skill can't control the screen, so Claude
explains the steps and shortcuts instead. Don't use the mouse or keyboard while
Claude is working.
