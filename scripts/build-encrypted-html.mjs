#!/usr/bin/env node
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const DEFAULT_ITERATIONS = 600000;

function parseArgs(argv) {
  const args = {
    out: "docs/index.html",
    title: "Shared Codex Log",
    iterations: DEFAULT_ITERATIONS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session") args.session = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--iterations") args.iterations = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.iterations) || args.iterations < 100000) {
    throw new Error("--iterations must be an integer >= 100000");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run build -- --session /path/to/rollout.jsonl [--title "Shared Codex Log"] [--out docs/index.html]

Options:
  --session      Codex rollout JSONL file to export
  --title        Title shown after decryption
  --out          Output HTML file, default docs/index.html
  --iterations   PBKDF2-SHA256 iterations, default ${DEFAULT_ITERATIONS}

Environment:
  CODEX_LOG_PASSWORD can provide the passphrase non-interactively.
`);
}

function promptHidden(question) {
  return new Promise((resolvePrompt) => {
    const input = process.stdin;
    const output = process.stdout;
    const rl = readline.createInterface({ input, output, terminal: true });

    const originalWrite = output.write.bind(output);
    output.write = (chunk, encoding, callback) => {
      const text = String(chunk);
      if (text.includes(question) || text === "\n" || text === "\r\n") {
        return originalWrite(chunk, encoding, callback);
      }
      return true;
    };

    rl.question(question, (answer) => {
      output.write = originalWrite;
      rl.close();
      originalWrite("\n");
      resolvePrompt(answer);
    });
  });
}

async function getPassword() {
  if (process.env.CODEX_LOG_PASSWORD) {
    if (process.env.CODEX_LOG_PASSWORD.length < 16) {
      throw new Error("CODEX_LOG_PASSWORD must be at least 16 characters");
    }
    return process.env.CODEX_LOG_PASSWORD;
  }

  const first = await promptHidden("Passphrase: ");
  const second = await promptHidden("Repeat passphrase: ");

  if (first !== second) throw new Error("Passphrases did not match");
  if (first.length < 16) throw new Error("Passphrase must be at least 16 characters");
  return first;
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractMessages(sessionPath) {
  const text = readFileSync(sessionPath, "utf8");
  const messages = [];
  let skippedInvalid = 0;

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;

    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skippedInvalid += 1;
      continue;
    }

    if (row.type !== "response_item") continue;
    const payload = row.payload;
    if (!payload || payload.type !== "message") continue;
    if (payload.role !== "user" && payload.role !== "assistant") continue;

    const textContent = contentText(payload.content).trim();
    if (!textContent) continue;

    messages.push({
      role: payload.role,
      timestamp: row.timestamp || null,
      text: textContent,
      sourceLine: index + 1
    });
  }

  return { messages, skippedInvalid };
}

function encryptJson(data, password, iterations) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-256-GCM",
    iterations,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([ciphertext, tag]).toString("base64")
  };
}

function htmlFor(encrypted, title) {
  const payloadJson = JSON.stringify(encrypted);
  const pageTitle = JSON.stringify(title);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f4ef;
    --surface: #ffffff;
    --text: #20201d;
    --muted: #68685f;
    --border: #d9d6cc;
    --accent: #1d6f5f;
    --danger: #9d2f2f;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  * {
    box-sizing: border-box;
  }
  body {
    margin: 0;
  }
  main {
    max-width: 920px;
    margin: 0 auto;
    padding: 32px 18px 56px;
  }
  .unlock {
    max-width: 520px;
    margin: 12vh auto 0;
    padding: 28px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }
  h1 {
    margin: 0 0 10px;
    font-size: 26px;
    line-height: 1.2;
    letter-spacing: 0;
  }
  p {
    margin: 0 0 18px;
    color: var(--muted);
    line-height: 1.6;
  }
  label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 650;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  input {
    min-width: 0;
    flex: 1;
    height: 42px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 12px;
    font: inherit;
    background: transparent;
    color: inherit;
  }
  button {
    height: 42px;
    border: 0;
    border-radius: 6px;
    padding: 0 16px;
    font: inherit;
    font-weight: 700;
    color: #ffffff;
    background: var(--accent);
    cursor: pointer;
  }
  button:disabled {
    cursor: wait;
    opacity: 0.65;
  }
  .status {
    min-height: 22px;
    margin-top: 12px;
    color: var(--danger);
    font-size: 14px;
  }
  .meta {
    margin-bottom: 24px;
    color: var(--muted);
    font-size: 14px;
  }
  .message {
    margin: 14px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .message header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 13px;
  }
  .role {
    color: var(--text);
    font-weight: 750;
    text-transform: capitalize;
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding: 14px;
    line-height: 1.65;
  }
  .hidden {
    display: none;
  }
  @media (max-width: 560px) {
    .unlock {
      margin-top: 6vh;
      padding: 20px;
    }
    .row {
      flex-direction: column;
    }
    button {
      width: 100%;
    }
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171713;
      --surface: #22221d;
      --text: #f0f0eb;
      --muted: #aaa79d;
      --border: #3d3b33;
      --accent: #27806f;
      --danger: #ff8a8a;
    }
  }
</style>
</head>
<body>
<main>
  <section id="unlock" class="unlock">
    <h1 id="locked-title"></h1>
    <p>This Codex log is encrypted in this HTML file. Enter the shared passphrase to decrypt it in your browser.</p>
    <form id="form">
      <label for="password">Passphrase</label>
      <div class="row">
        <input id="password" type="password" autocomplete="current-password" required autofocus>
        <button id="button" type="submit">Unlock</button>
      </div>
      <div id="status" class="status" role="status"></div>
    </form>
  </section>
  <section id="log" class="hidden">
    <h1 id="title"></h1>
    <div id="meta" class="meta"></div>
    <div id="messages"></div>
  </section>
</main>
<script>
const PAGE_TITLE = ${pageTitle};
const ENCRYPTED_LOG = ${payloadJson};

document.getElementById("locked-title").textContent = PAGE_TITLE;

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bytesFromBase64(ENCRYPTED_LOG.salt),
      iterations: ENCRYPTED_LOG.iterations,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptLog(password) {
  const key = await deriveKey(password);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(ENCRYPTED_LOG.iv) },
    key,
    bytesFromBase64(ENCRYPTED_LOG.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function render(data) {
  document.title = data.title || PAGE_TITLE;
  document.getElementById("title").textContent = data.title || PAGE_TITLE;
  document.getElementById("meta").textContent = [
    data.sourceName ? "Source: " + data.sourceName : "",
    data.exportedAt ? "Exported: " + formatDate(data.exportedAt) : "",
    Array.isArray(data.messages) ? data.messages.length + " messages" : ""
  ].filter(Boolean).join(" | ");

  const container = document.getElementById("messages");
  container.replaceChildren();

  for (const message of data.messages || []) {
    const article = document.createElement("article");
    article.className = "message";

    const header = document.createElement("header");
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = message.role || "message";
    const time = document.createElement("span");
    time.textContent = formatDate(message.timestamp);
    header.append(role, time);

    const body = document.createElement("div");
    body.className = "body";
    body.textContent = message.text || "";

    article.append(header, body);
    container.append(article);
  }

  document.getElementById("unlock").classList.add("hidden");
  document.getElementById("log").classList.remove("hidden");
}

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("button");
  const status = document.getElementById("status");
  const password = document.getElementById("password").value;

  button.disabled = true;
  status.textContent = "Decrypting...";

  try {
    render(await decryptLog(password));
    status.textContent = "";
  } catch {
    status.textContent = "Could not decrypt. Check the passphrase.";
    button.disabled = false;
  }
});
</script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.session) throw new Error("--session is required");

  const sessionPath = resolve(args.session);
  const outPath = resolve(args.out);
  const { messages, skippedInvalid } = extractMessages(sessionPath);
  if (messages.length === 0) {
    throw new Error("No user or assistant messages were found in the session");
  }

  const password = await getPassword();
  const publicData = {
    schema: "codex-log-share:v1",
    title: args.title,
    sourceName: basename(sessionPath),
    exportedAt: new Date().toISOString(),
    messages
  };

  const encrypted = encryptJson(publicData, password, args.iterations);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, htmlFor(encrypted, args.title), "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`Included ${messages.length} user/assistant messages`);
  if (skippedInvalid > 0) console.log(`Skipped ${skippedInvalid} invalid JSONL lines`);
  console.log("Review the decrypted page before sharing the URL.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
