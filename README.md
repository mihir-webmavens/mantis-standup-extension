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
