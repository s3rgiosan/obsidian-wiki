# Brain

A zero-build Chrome extension connecting your browser to your Obsidian vault in
both directions:

- **Capture** — save the current page or a selection into the vault's `_raw/`.
- **Fill form** — answer this page's form from what the vault knows, using the
  Claude Code or Codex CLI you already pay for.

## Quickstart

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
   this folder. Capture works now.
2. For form filling, run `host/install.sh`, then fully quit Chrome (⌘Q) and
   reopen it.

Test the native host without Chrome:

```bash
python3 host/test_host.py claude    # or: codex
```

Logs: `~/.obsidian-wiki/brain-fill.log`.

## Full documentation

**[docs/browser-extension.md](../../docs/browser-extension.md)** covers the
architecture, the security model, how to structure vault pages so they actually
fill, why the native host is staged outside the repo, and troubleshooting.

## Layout

| Path | What it is |
|---|---|
| `manifest.json` | MV3 manifest; fixed `key` gives a stable extension ID |
| `popup.{html,css,js}` | Two-tab popup, plus the functions injected into the page |
| `background.js` | Context-menu capture |
| `host/brain_fill_host.py` | Native messaging host: retrieve → reason → validate |
| `host/install.sh` | Stages the host and registers it with Chrome |
