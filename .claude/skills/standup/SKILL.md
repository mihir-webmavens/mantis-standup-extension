---
name: standup
description: Add a Standup or fill in an EOD for the user by controlling their desktop like a human (mouse/keyboard via xdotool, screenshots via scrot) using the "Mantis Quick Standup" Chrome extension (standup.webmavens.dev from Mantis at projects.webmavens.dev). Use when the user asks to add/create a standup, fill/add/edit an EOD, or asks what the Ctrl+Shift+S / Ctrl+Shift+E shortcuts or the bottom-right Mantis button do.
---

# Standup & EOD with Mantis Quick Standup

The **Mantis Quick Standup** Chrome extension adds Standups and EODs to
`standup.webmavens.dev` straight from Mantis (`projects.webmavens.dev`), so the
user never has to open the standup site.

When this skill is used, **do it for the user like a human would**: control their
screen with the mouse and keyboard (see "Controlling the GUI" below) and use the
same shortcuts, buttons and panels described here. Only fall back to explaining
the steps if GUI control is not possible.

## Quick reference

| Where the user is | Add Standup | Add / edit EOD |
|---|---|---|
| Mantis **ticket details page** | `Ctrl + Shift + S` or the bottom-right button | `Ctrl + Shift + E` or the bottom-right button |
| Any other Mantis page | Toolbar popup → **Add Standup** tab | `Ctrl + Shift + E` or the bottom-right **EOD** button |
| Any other website / tab | `Ctrl + Shift + S` (opens the popup on Add Standup) | `Ctrl + Shift + E` (opens the popup on EOD) |

## 1. Add a Standup — `Ctrl + Shift + S`

**On a Mantis ticket details page** (best way): press `Ctrl + Shift + S`.
The **Add Standup** panel opens bottom-right, already filled from the ticket:

- **Ticket** — `#number title` of the open ticket
- **Link** — the ticket URL
- **Priority** — detected from the ticket (High / Medium / Low, can be changed)
- **Est Time** — defaults to `-`
- **Planned Action** — cursor is already here; type what you will work on

Press `Ctrl + Enter` (or click **Add Standup**) to send. If a standup for that
ticket already exists today, the panel shows a note.

**Anywhere else**: `Ctrl + Shift + S` opens the extension's toolbar popup on the
**Add Standup** tab. Fill in Ticket #, Planned Action, Repo / Issue Link,
Priority, Est Time, and optionally Support needed / Blockers, then submit.

## 2. Add or edit an EOD — `Ctrl + Shift + E`

Works **everywhere**:

- On a Mantis page it opens the **EOD** panel bottom-right.
- On any other tab it opens the toolbar popup on the **EOD** tab.

The list shows today's standups. Each one without an EOD says
*"EOD not filled yet"* with an **Add EOD** button; filled ones have **Edit**.
Click it, type what was completed, then press `Enter` to save (`Esc` cancels).
The EOD field is single-line. Use **Refresh** to reload the list.

## 3. The bottom-right button on Mantis

Every Mantis page shows a floating button at the **bottom-right** corner.

- On a **ticket details page** it holds two buttons — **+ Standup** and
  **EOD (n)** — but shows one at a time. **Scroll (mouse wheel) over the button**
  to switch between them (the ↕ hint shows this), then click to open that panel.
- On other Mantis pages only the **EOD** button is shown (Standup needs a ticket).
- `EOD (n)` = how many of today's EODs are still to fill in.
  `(…)` = loading, `(!)` = error (hover it to see why).

## Tips

- Shortcuts can be changed at `chrome://extensions/shortcuts` (also listed in
  the popup under **Settings → Keyboard shortcuts**). If a key does nothing, another
  extension may already use it — check there.
- Reminders for Standup and EOD can be turned on in the popup's **Settings** tab.
- To see or edit everything on the standup site itself:
  https://standup.webmavens.dev/admin/standups/edit-standups
- If the user asks you to write the text, keep a Planned Action to one short
  line about the ticket's work, and an EOD update to one line on what was done.

## Controlling the GUI

GUI control needs Linux **X11** with `xdotool` (mouse/keyboard) and `scrot`
(screenshots). Check first:

```bash
echo "$XDG_SESSION_TYPE"; which xdotool scrot; xdotool getdisplaygeometry
```

If the session is not `x11` or a tool is missing, tell the user
(`sudo apt install xdotool scrot` on Ubuntu) and fall back to explaining the
steps. Do **not** use the Claude in Chrome tools. Drive the real Chrome window
instead, like a human. With several monitors the screenshot covers all of them
(e.g. two stacked 1366×768 screens give 1366×1536), so find Chrome in it.

### The loop: look → act → look

1. **Look**: take a screenshot and read it with the Read tool:
   ```bash
   scrot -o "$SCRATCH/screen.png"   # $SCRATCH = your scratchpad directory
   ```
   Screenshot pixels equal screen coordinates, so a spot at (x, y) in the image
   is clicked with `xdotool mousemove x y click 1`.
2. **Act**: one small step (a key, a click, some typing).
3. **Look again** to confirm it worked before the next step. Never chain many
   blind actions; panels take a moment to open, so `sleep 1` before looking.

### Useful commands

```bash
# Bring Chrome to the front (start it if there is no window)
W=$(xdotool search --onlyvisible --name "Google Chrome" 2>/dev/null | tail -1)  # --class search can throw BadWindow
[ -n "$W" ] && xdotool windowactivate --sync "$W" || (google-chrome >/dev/null 2>&1 &)

# Open a Mantis ticket in the current tab
xdotool key --clearmodifiers ctrl+l
xdotool type --delay 15 -- "https://projects.webmavens.dev/tickets/8263"
xdotool key Return

xdotool key --clearmodifiers ctrl+shift+s    # Add Standup
xdotool key --clearmodifiers ctrl+shift+e    # EOD panel / popup
xdotool type --delay 15 -- "Working on the notification issue"
xdotool key --clearmodifiers ctrl+Return     # send the standup
xdotool key Return                           # save an EOD
xdotool key Escape                           # cancel / close
xdotool mousemove 1300 720 click 1           # click (coordinates from the screenshot)
xdotool mousemove 1300 720 click 4           # wheel up over the bottom-right button
xdotool mousemove 1300 720 click 5           # wheel down (switch + Standup / EOD)
```

Before any key press, check `xdotool getactivewindow getwindowname` ends in
"Google Chrome"; otherwise typing lands in the terminal. Clicking an empty spot
of the page (e.g. beside the ticket title) is a safe way to focus it.

### Add a Standup (GUI)

1. Ask for anything missing: ticket number and Planned Action (Est Time and
   Priority are optional).
2. Activate Chrome, open `https://projects.webmavens.dev/tickets/<id>`, wait
   until the page is loaded (screenshot).
3. Press `ctrl+shift+s` and screenshot. The Add Standup panel should be open
   bottom-right with the ticket filled in and the cursor in Planned Action. If
   not, scroll over the bottom-right button until it shows **+ Standup** and
   click it, then click in Planned Action.
4. If Priority or Est Time need changing, click those fields and set them.
5. Type the Planned Action, screenshot, and check the panel (right ticket,
   text, and no "already added" note the user did not expect).
6. Press `ctrl+Return` and screenshot to confirm the success message.

### Fill in an EOD (GUI)

1. Ask for the EOD text if the user did not give it (per ticket if several).
2. Activate Chrome and press `ctrl+shift+e`; screenshot.
3. Find the right ticket in the list and click its **Add EOD** (or **Edit**).
4. Type the update (one line) and press `Return`; screenshot to see
   "✓ EOD saved." Repeat for the next ticket.

### Rules while controlling the GUI

- Sending a standup or saving an EOD posts to the standup site. Show the user
  the exact ticket(s) and text and get an OK before the final send, unless they
  already gave the exact text in their request.
- Tell the user not to use the mouse/keyboard while you work.
- Use `--clearmodifiers` with key combos so a held key does not mix in.
- If a screenshot shows something unexpected (login page, wrong tab, a dialog,
  a shortcut that did nothing), stop and tell the user rather than guessing.
- Delete the screenshots from the scratchpad when done.
