# Mantis Quick Standup: setup

## Kya chahiye

1. Linux ya Mac (Windows nahi chalega)
2. Google Chrome
3. Node.js (version 18 ya naya)
4. Claude Code, login kiya hua
5. poppler-utils (PDF padhne ke liye)
6. Mantis connector `webmavens-projects`, Claude me connected
7. Chrome me Mantis aur standup site par login

## Setup (4 steps)

**1. Extension load karo**
`chrome://extensions` kholo → Developer mode on → Load unpacked → ye folder chuno.

**2. Claude se baaki sab install karwao**
Is folder me terminal kholo, `claude` chalao aur ye paste karo:

```text
Set up the Mantis Quick Standup extension on this computer.
Check these, install what is missing, and tell me before any sudo command:
- Node.js 18 or newer
- poppler-utils (pdfinfo, pdftoppm, pdftotext)
- git
- MCP server "webmavens-projects" (type http, https://projects.webmavens.dev/mcp).
  If missing: claude mcp add --transport http -s user webmavens-projects https://projects.webmavens.dev/mcp
  If it is not Connected, tell me to run /mcp and Authenticate, and wait for me.
Do not change any code files. At the end, show a short table of what is ready.
```

**3. Helper install karo**
Extension popup → Settings → MantisAI → **Allow** → **Download** → popup me dikh rahi command terminal me chalao → **Check**.
Status **Ready** dikhna chahiye.

**4. Mantis tab refresh karo.** Ho gaya.

## Problem aaye to

| Dikkat | Kya karo |
|---|---|
| "connector authorize nahi hua" / "attachment ID chahiye" | `claude` → `/mcp` → webmavens-projects → Authenticate |
| PDF nahi khul raha | `sudo apt install poppler-utils` (Mac: `brew install poppler`) |
| Status Ready nahi hai | Popup → MantisAI → Reinstall helper → command chalao → Check |
| Folder badla ya extension dobara load kiya | Step 3 dobara karo |
