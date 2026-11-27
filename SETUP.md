# Mantis Quick Standup: setup

Ye file extension ki saari requirements aur ek ready-made prompt rakhti hai.
Zip extract karo, us folder me Claude Code kholo (`claude`), aur neeche wala
prompt paste kar do. Claude saari zaroori cheezein install karke helper set up
kar dega. Sirf kuch browser wale steps tumhe khud karne honge (neeche likhe hain).

## Requirements

| Cheez | Kyun chahiye | Kaise install hoti hai |
|---|---|---|
| Linux ya macOS | Helper installer sirf inhi par chalta hai (Windows support nahi hai) | – |
| Google Chrome (ya Chromium / Brave / Edge) | Extension isi me chalta hai | – |
| Node.js 18+ (22 recommended) | MantisAI helper (`native-host/mantis-ai-host.mjs`) Node par chalta hai | `sudo apt install nodejs` ya nodesource / nvm; macOS: `brew install node` |
| Claude Code (`claude` CLI), logged in | MantisAI chat isi CLI se hota hai | `curl -fsSL https://claude.ai/install.sh \| bash`, phir `claude` chala ke login |
| poppler-utils (`pdfinfo`, `pdftoppm`, `pdftotext`) | **PDF attachments padhne ke liye.** Iske bina chat chalega par PDF nahi khulega | `sudo apt install poppler-utils`; macOS: `brew install poppler` |
| git | Helper ke git wale read-only tools ke liye | `sudo apt install git`; macOS: `xcode-select --install` |
| Mantis MCP connector `webmavens-projects`, authorized | MantisAI isi se tickets aur **attachment IDs** dekhta hai. Iske bina PDF ID nahi milti, to PDF nahi padha jaata | `claude mcp add --transport http -s user webmavens-projects https://projects.webmavens.dev/mcp`, phir `claude` → `/mcp` → Authenticate (transport `http` hi rakhna, `sse` se 405 aata hai) |
| Mantis aur standup site par login (Chrome me) | Extension tumhare apne session se kaam karta hai | – |

Kisi npm package ki zaroorat nahi hai, aur koi build step bhi nahi hai.

## Prompt for Claude Code

Is folder (jahan `manifest.json` hai) me `claude` chalao aur ye poora prompt paste karo:

```text
I want to set up the "Mantis Quick Standup" Chrome extension in this folder,
including its MantisAI helper (native-host/). Read SETUP.md and
native-host/install.sh first, then do the following step by step. Tell me
before each command that uses sudo.

1. Detect my OS (Linux distro or macOS). On Windows, stop and tell me it is not supported.
2. Check what is already installed and print a table: node (needs 18+, 22
   preferred), claude CLI, git, pdfinfo, pdftoppm, pdftotext.
3. Install whatever is missing:
   - Node.js 22: apt/dnf via NodeSource, or brew on macOS. If node exists but
     is older than 18, upgrade it.
   - poppler-utils (Linux: apt/dnf/pacman package "poppler-utils" or "poppler";
     macOS: brew install poppler).
   - git if missing.
   Run each check again afterwards to confirm it worked.
4. Check that the claude CLI is logged in (e.g. `claude --version` and a short
   `claude -p "say ok"`). If it is not, tell me to run `claude` once and log in,
   and wait for me.
4b. Check the Mantis MCP connector with `claude mcp list`. MantisAI needs a
   server named exactly "webmavens-projects" (type http, URL
   https://projects.webmavens.dev/mcp) that shows "Connected". If it is
   missing, run:
     claude mcp add --transport http -s user webmavens-projects https://projects.webmavens.dev/mcp
   (never use sse: it gives HTTP 405). If it needs authentication, tell me to
   run `claude`, type /mcp, pick webmavens-projects, click Authenticate and
   log in to Mantis in the browser. Wait for me, then run `claude mcp list`
   again and check that it says Connected.
5. Ask me for the extension ID. Tell me how to get it: open chrome://extensions,
   turn on Developer mode, click "Load unpacked", pick THIS folder, and copy the
   32-letter ID shown on the extension's card.
6. Run: bash native-host/install.sh <extension-id>
   and show me its output. If it prints a poppler "Note", go back to step 3.
7. Verify: the helper exists in ~/.local/share/mantis-ai/ (macOS:
   ~/Library/Application Support/MantisAI/), and the file
   NativeMessagingHosts/com.webmavens.mantis_ai.json exists in my Chrome profile
   folder with my extension ID in allowed_origins.
8. Finish with a checklist of what I still have to click myself in Chrome
   (see the "Manual steps" section of SETUP.md).

Do not change any of the extension's code files.
```

## Manual steps (Chrome me khud karne hain)

Claude ye nahi kar sakta, ye tumhe khud karna hoga:

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → ye folder select karo.
2. Chrome me **Mantis** (projects.webmavens.dev) aur **standup.webmavens.dev** par login karo.
3. Extension ka toolbar popup → **Settings → MantisAI** → **Allow** dabao aur Chrome ka permission
   prompt Allow karo. Isi ek step me helper aur PDF (downloads) dono ki permission mil jaati hai.
4. Installer chalane ke baad **Check** dabao. Status "Ready · …" dikhna chahiye.
5. Mantis tabs ko ek baar refresh karo.

"Allow PDF reading" button sirf tab dikhta hai jab status Ready ho aur PDF permission abhi tak
na mili ho (jaise purane version se upgrade karne par). Wo na dikhe to sab theek hai: permission
pehle hi mil chuki hai. Pakka karna ho to `chrome://extensions` → extension → **Details** →
Permissions me "Manage your downloads" dikhna chahiye.

## PDF nahi khul raha? Jaldi check karo

- MantisAI bole "connector authorize nahi hua" / "attachment ID chahiye" → `claude mcp list` me
  `webmavens-projects` **Connected** hona chahiye. Nahi hai to `claude` → `/mcp` → webmavens-projects → Authenticate.
- `which pdftoppm pdftotext pdfinfo` → teeno dikhne chahiye.
- Popup → Settings → MantisAI me status "Ready" hai? Nahi to pehle helper theek karo (Reinstall helper → installer → Check).
- "Allow PDF reading" button dikh raha hai? Matlab PDF permission nahi mili, use dabao. Na dikhe to permission mili hui hai.
- "needs the newer helper" message aaye to **Reinstall helper** karo aur installer dobara chalao.
- Mantis me us ticket ka attachment browser me khud khul raha hai? Nahi to login/access ki problem hai.
- 50 MB / 200 pages se badi, password wali ya kharab PDF nahi padhi ja sakti.
