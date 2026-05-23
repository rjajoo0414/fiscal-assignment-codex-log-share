# Fiscal Assignment Codex Log Share

Create a single password-protected HTML page for sharing selected Codex chat logs through GitHub Pages.

The generated page contains only encrypted data. The raw Codex JSONL file is not copied into `docs/`, and the password is not stored in the repository.

## Workflow

1. Pick Codex session JSONL files under `~/.codex/sessions/YYYY/MM/DD/`.
2. Build an encrypted page:

   ```bash
   cd /Users/hiroaki/.pyenv/python_files/Study/fiscal-assignment-codex-log-share
   CODEX_LOG_PASSWORD='same passphrase as before' npm run build -- \
     --session /Users/hiroaki/.codex/sessions/2026/05/21/rollout-example.jsonl \
     --session /Users/hiroaki/.codex/sessions/2026/05/24/rollout-later-session.jsonl \
     --link 'ChatGPT共有ログ=https://chatgpt.com/share/...' \
     --title "財政I こども医療費助成 調査ログ"
   ```

3. Enter a strong passphrase when prompted, or set `CODEX_LOG_PASSWORD` non-interactively.
4. Commit and publish `docs/index.html` with GitHub Pages.
5. Put the GitHub Pages URL into a QR code.

## Password handling

Prefer typing the password at the prompt. For automation, you can set `CODEX_LOG_PASSWORD`, but avoid leaving it in shell history:

```bash
CODEX_LOG_PASSWORD='long random passphrase here' npm run build -- --session /path/to/rollout.jsonl
```

After a successful browser unlock, the decrypted log is cached in that browser's `localStorage` for this exact encrypted payload, so the same browser can reopen it without retyping the passphrase. Use the "Forget saved unlock" button on the page to remove that local cache.

## What gets included

Only `user` and `assistant` message items are exported from the Codex JSONL. The injected `# AGENTS.md instructions for ...` message, developer messages, tool calls, tool output, reasoning records, and app event records are excluded.

To add this report-compilation session later, find the newest matching JSONL under `~/.codex/sessions/2026/05/24/`, rerun the same `npm run build` command with the same password and an additional `--session`, then commit and push the regenerated `docs/index.html`.

Still review the generated page before sharing. User and assistant messages may contain private paths, names, documents, or other sensitive content.

## Local preview

```bash
npm run serve
```

Then open `http://localhost:8000`. Web Crypto works reliably on HTTPS origins such as GitHub Pages and on localhost.
