# Codex Log Share

Create a single password-protected HTML page for sharing selected Codex chat logs through GitHub Pages.

The generated page contains only encrypted data. The raw Codex JSONL file is not copied into `docs/`, and the password is not stored in the repository.

## Workflow

1. Pick a Codex session JSONL file under `~/.codex/sessions/YYYY/MM/DD/`.
2. Build an encrypted page:

   ```bash
   cd /Users/hiroaki/.pyenv/python_files/Study/codex-log-share
   npm run build -- --session /Users/hiroaki/.codex/sessions/2026/05/21/rollout-example.jsonl --title "Shared Codex Log"
   ```

3. Enter a strong passphrase when prompted.
4. Commit and publish `docs/index.html` with GitHub Pages.
5. Put the GitHub Pages URL into a QR code.

## Password handling

Prefer typing the password at the prompt. For automation, you can set `CODEX_LOG_PASSWORD`, but avoid leaving it in shell history:

```bash
CODEX_LOG_PASSWORD='long random passphrase here' npm run build -- --session /path/to/rollout.jsonl
```

## What gets included

Only `user` and `assistant` message items are exported from the Codex JSONL. Developer messages, tool calls, tool output, reasoning records, and app event records are excluded.

Still review the generated page before sharing. User and assistant messages may contain private paths, names, documents, or other sensitive content.

## Local preview

```bash
npm run serve
```

Then open `http://localhost:8000`. Web Crypto works reliably on HTTPS origins such as GitHub Pages and on localhost.
