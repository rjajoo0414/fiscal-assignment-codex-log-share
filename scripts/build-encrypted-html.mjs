#!/usr/bin/env node
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const DEFAULT_ITERATIONS = 600000;

function parseArgs(argv) {
  const args = {
    sessions: [],
    links: [],
    out: "docs/index.html",
    title: "財政 課題ログ",
    iterations: DEFAULT_ITERATIONS,
    note: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--session") args.sessions.push(argv[++i]);
    else if (arg === "--link") args.links.push(argv[++i]);
    else if (arg === "--note") args.note = argv[++i];
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
  npm run build -- --session /path/to/rollout.jsonl [--title "財政 課題ログ"] [--out docs/index.html]

Options:
  --session      Codex rollout JSONL file to export. Repeat to include multiple logs.
  --link         External link shown after unlock, in label=url format. Repeatable.
  --note         Short note shown after unlock
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

function isAgentsInstructionMessage(text) {
  return text.startsWith("# AGENTS.md instructions for ");
}

function extractMessages(sessionPath) {
  const text = readFileSync(sessionPath, "utf8");
  const messages = [];
  let skippedInvalid = 0;
  let skippedAgentsInstructions = 0;

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
    if (isAgentsInstructionMessage(textContent)) {
      skippedAgentsInstructions += 1;
      continue;
    }

    messages.push({
      role: payload.role,
      timestamp: row.timestamp || null,
      text: textContent,
      sourceLine: index + 1
    });
  }

  return { messages, skippedInvalid, skippedAgentsInstructions };
}

function parseLink(value) {
  const index = value.indexOf("=");
  if (index <= 0) throw new Error(`--link must be in label=url format: ${value}`);
  return {
    label: value.slice(0, index),
    url: value.slice(index + 1)
  };
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
  .log-toolbar {
    display: flex;
    justify-content: flex-end;
    margin: -8px 0 20px;
  }
  .secondary {
    height: 34px;
    border: 1px solid var(--border);
    padding: 0 12px;
    color: var(--text);
    background: transparent;
    font-size: 13px;
  }
  .meta {
    margin-bottom: 24px;
    color: var(--muted);
    font-size: 14px;
  }
  .note,
  .links,
  .add-log {
    margin: 14px 0 22px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    line-height: 1.65;
  }
  .links a {
    color: var(--accent);
    overflow-wrap: anywhere;
  }
  .session {
    margin-top: 28px;
  }
  .session h2 {
    margin: 0 0 8px;
    font-size: 20px;
    line-height: 1.35;
    letter-spacing: 0;
  }
  code {
    overflow-wrap: anywhere;
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
    <div class="log-toolbar">
      <button id="forget-cache" class="secondary" type="button">Forget saved unlock</button>
    </div>
    <div id="note" class="note hidden"></div>
    <div id="links" class="links hidden"></div>
    <div id="add-log" class="add-log hidden"></div>
    <div id="messages"></div>
  </section>
</main>
<script>
const PAGE_TITLE = ${pageTitle};
const ENCRYPTED_LOG = ${payloadJson};
const CACHE_PREFIX = "fiscal-assignment-codex-log-share:";

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

async function encryptedLogFingerprint() {
  const fingerprintSource = [
    ENCRYPTED_LOG.version,
    ENCRYPTED_LOG.kdf,
    ENCRYPTED_LOG.cipher,
    ENCRYPTED_LOG.iterations,
    ENCRYPTED_LOG.salt,
    ENCRYPTED_LOG.iv,
    ENCRYPTED_LOG.ciphertext
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintSource));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function cacheKey() {
  return CACHE_PREFIX + await encryptedLogFingerprint();
}

async function loadCachedLog() {
  try {
    const raw = localStorage.getItem(await cacheKey());
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return cached && cached.data ? cached.data : null;
  } catch {
    return null;
  }
}

async function saveCachedLog(data) {
  try {
    localStorage.setItem(await cacheKey(), JSON.stringify({
      savedAt: new Date().toISOString(),
      data
    }));
  } catch {
  }
}

async function clearCachedLog() {
  try {
    localStorage.removeItem(await cacheKey());
  } catch {
  }
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
  const sessions = Array.isArray(data.sessions)
    ? data.sessions
    : [{
        title: data.sourceName || data.title || "Codex log",
        sourceName: data.sourceName || "",
        messages: Array.isArray(data.messages) ? data.messages : []
      }];
  const messageCount = sessions.reduce((sum, session) => sum + (session.messages || []).length, 0);
  document.getElementById("meta").textContent = [
    data.exportedAt ? "Exported: " + formatDate(data.exportedAt) : "",
    sessions.length + " log(s)",
    messageCount + " messages"
  ].filter(Boolean).join(" | ");

  const note = document.getElementById("note");
  note.classList.add("hidden");
  if (data.note) {
    note.textContent = data.note;
    note.classList.remove("hidden");
  }

  const links = document.getElementById("links");
  links.replaceChildren();
  links.classList.add("hidden");
  if (Array.isArray(data.links) && data.links.length > 0) {
    const heading = document.createElement("strong");
    heading.textContent = "Related links";
    links.append(heading);
    for (const link of data.links) {
      const paragraph = document.createElement("p");
      const anchor = document.createElement("a");
      anchor.href = link.url || "#";
      anchor.rel = "noreferrer";
      anchor.target = "_blank";
      anchor.textContent = link.label ? link.label + ": " + link.url : link.url;
      paragraph.append(anchor);
      links.append(paragraph);
    }
    links.classList.remove("hidden");
  }

  const addLog = document.getElementById("add-log");
  addLog.classList.add("hidden");
  if (data.addLogHelp) {
    addLog.textContent = data.addLogHelp;
    addLog.classList.remove("hidden");
  }

  const container = document.getElementById("messages");
  container.replaceChildren();

  for (const session of sessions) {
    const section = document.createElement("section");
    section.className = "session";

    const heading = document.createElement("h2");
    heading.textContent = session.title || session.sourceName || "Codex log";
    section.append(heading);

    const sessionMeta = document.createElement("div");
    sessionMeta.className = "meta";
    sessionMeta.textContent = [
      session.sourceName ? "Source: " + session.sourceName : "",
      Array.isArray(session.messages) ? session.messages.length + " messages" : ""
    ].filter(Boolean).join(" | ");
    section.append(sessionMeta);

    for (const message of session.messages || []) {
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
      section.append(article);
    }

    container.append(section);
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
    const data = await decryptLog(password);
    await saveCachedLog(data);
    render(data);
    status.textContent = "";
  } catch {
    status.textContent = "Could not decrypt. Check the passphrase.";
    button.disabled = false;
  }
});

document.getElementById("forget-cache").addEventListener("click", async () => {
  await clearCachedLog();
  location.reload();
});

loadCachedLog().then((cached) => {
  if (cached) render(cached);
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
  if (args.sessions.length === 0) throw new Error("--session is required");

  const outPath = resolve(args.out);
  const sessions = args.sessions.map((sessionArg) => {
    const sessionPath = resolve(sessionArg);
    const { messages, skippedInvalid, skippedAgentsInstructions } = extractMessages(sessionPath);
    if (messages.length === 0) {
      throw new Error(`No user or assistant messages were found in ${sessionPath}`);
    }
    return {
      title: basename(sessionPath).replace(/\.jsonl$/, ""),
      sourceName: basename(sessionPath),
      skippedInvalid,
      skippedAgentsInstructions,
      messages
    };
  });

  const password = await getPassword();
  const publicData = {
    schema: "fiscal-assignment-codex-log-share:v2",
    title: args.title,
    exportedAt: new Date().toISOString(),
    note: args.note,
    links: args.links.map(parseLink),
    addLogHelp: "To add another Codex session later: identify the new JSONL under ~/.codex/sessions/YYYY/MM/DD/, then rerun npm run build with the same CODEX_LOG_PASSWORD and add another --session /path/to/rollout.jsonl. The generated docs/index.html can then be committed and pushed again.",
    sessions
  };

  const encrypted = encryptJson(publicData, password, args.iterations);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, htmlFor(encrypted, args.title), "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`Included ${sessions.length} log(s) and ${sessions.reduce((sum, session) => sum + session.messages.length, 0)} user/assistant messages`);
  const skippedInvalid = sessions.reduce((sum, session) => sum + session.skippedInvalid, 0);
  if (skippedInvalid > 0) console.log(`Skipped ${skippedInvalid} invalid JSONL lines`);
  const skippedAgentsInstructions = sessions.reduce((sum, session) => sum + session.skippedAgentsInstructions, 0);
  if (skippedAgentsInstructions > 0) console.log(`Skipped ${skippedAgentsInstructions} AGENTS.md instruction message(s)`);
  console.log("Review the decrypted page before sharing the URL.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
