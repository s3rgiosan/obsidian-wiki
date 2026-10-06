// Unchanged across the rename to Brain: this keys the saved _raw directory
// handle, so renaming it would orphan every existing install's folder pick.
const DB_NAME = "brain-vault-capture";
const STORE_NAME = "handles";
const RAW_HANDLE_KEY = "raw-folder";
const HOST_NAME = "com.obsidian_wiki.brain_fill";

const tabCapture = document.querySelector("#tabCapture");
const tabFill = document.querySelector("#tabFill");
const paneCapture = document.querySelector("#paneCapture");
const paneFill = document.querySelector("#paneFill");
const lede = document.querySelector("#lede");
const fillButton = document.querySelector("#fill");
const engineSelect = document.querySelector("#engine");
const vaultSelect = document.querySelector("#vault");
const vaultStatus = document.querySelector("#vaultStatus");
const resultsList = document.querySelector("#results");

const folderStatus = document.querySelector("#folderStatus");
const chooseFolder = document.querySelector("#chooseFolder");
const captureButton = document.querySelector("#capture");
const pathHelpButton = document.querySelector("#pathHelp");
const pathPanel = document.querySelector("#pathPanel");
const pathCommand = document.querySelector("#pathCommand");
const copyStatus = document.querySelector("#copyStatus");
const noteField = document.querySelector("#note");
const statusLine = document.querySelector("#status");
const rawPathCommand = "awk -F= '/^OBSIDIAN_VAULT_PATH=/{print $2 \"/_raw\"; exit}' \"$(git rev-parse --show-toplevel)/.env\"";

let rawDirectoryHandle;

pathCommand.textContent = rawPathCommand;
init();

chooseFolder.addEventListener("click", async () => {
  setBusy(true);
  try {
    if (!("showDirectoryPicker" in window)) {
      throw new Error("This Chrome build does not expose the File System Access API to extension popups.");
    }

    rawDirectoryHandle = await window.showDirectoryPicker({
      id: "obsidian-wiki-raw",
      mode: "readwrite",
      startIn: "documents"
    });

    await saveRawHandle(rawDirectoryHandle);
    await ensureWritable(rawDirectoryHandle);
    setFolderStatus(rawDirectoryHandle.name);
    setStatus("Selected. Captures will now write markdown files into this folder.", "success");
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(error.message, "error");
    }
  } finally {
    setBusy(false);
  }
});

pathHelpButton.addEventListener("click", async () => {
  pathPanel.hidden = !pathPanel.hidden;
  if (pathPanel.hidden) {
    return;
  }

  try {
    await navigator.clipboard.writeText(rawPathCommand);
    copyStatus.textContent = "Copied";
  } catch {
    copyStatus.textContent = "Copy manually";
  }
});

captureButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    rawDirectoryHandle = rawDirectoryHandle || await loadRawHandle();
    if (!rawDirectoryHandle) {
      setStatus("Choose vault/_raw first.", "error");
      return;
    }

    await ensureWritable(rawDirectoryHandle);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
      throw new Error("Chrome blocks content capture on internal browser pages.");
    }

    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage
    });

    const filename = buildFilename(page.title || tab.title || "web-capture");
    const markdown = buildMarkdown(page, noteField.value);
    const savedFilename = await writeMarkdown(rawDirectoryHandle, filename, markdown);

    noteField.value = "";
    setStatus(`Captured ${savedFilename}`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

async function init() {
  try {
    rawDirectoryHandle = await loadRawHandle();
    if (rawDirectoryHandle) {
      setFolderStatus(rawDirectoryHandle.name);
      return;
    }
  } catch {
    rawDirectoryHandle = undefined;
  }

  setFolderStatus("No _raw folder selected");
}

async function ensureWritable(directoryHandle) {
  const options = { mode: "readwrite" };
  if (await directoryHandle.queryPermission(options) === "granted") {
    return;
  }

  if (await directoryHandle.requestPermission(options) !== "granted") {
    throw new Error("Write permission was not granted for the selected folder.");
  }
}

async function writeMarkdown(directoryHandle, filename, markdown) {
  const fileHandle = await getUniqueFileHandle(directoryHandle, filename);
  const writable = await fileHandle.createWritable();
  await writable.write(markdown);
  await writable.close();
  return fileHandle.name;
}

async function getUniqueFileHandle(directoryHandle, filename) {
  const extension = ".md";
  const basename = filename.endsWith(extension) ? filename.slice(0, -extension.length) : filename;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? filename : `${basename}-${attempt + 1}${extension}`;
    try {
      await directoryHandle.getFileHandle(candidate);
    } catch (error) {
      if (error.name === "NotFoundError") {
        return directoryHandle.getFileHandle(candidate, { create: true });
      }

      throw error;
    }
  }

  return directoryHandle.getFileHandle(`${basename}-${Date.now()}${extension}`, { create: true });
}

function buildFilename(title) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "web-capture";

  return `${date}-${slug}.md`;
}

function buildMarkdown(page, note) {
  const now = new Date().toISOString();
  const safeTitle = escapeYaml(page.title || "Untitled page");
  const cleanNote = note.trim();
  const selectedText = page.selection ? `\n## Selection\n\n${page.selection}\n` : "";
  const noteText = cleanNote ? `\n## Capture Note\n\n${cleanNote}\n` : "";
  const description = page.description ? `\n> ${page.description}\n` : "";

  return `---\ntitle: ${safeTitle}\ntags: [web-capture, raw-ingest]\nsources:\n  - ${page.url}\ncreated: ${now}\ncaptured: chrome-extension\n---\n\n# ${page.title || "Untitled page"}\n\n${description}\n- Source: ${page.url}\n- Captured: ${now}\n${noteText}${selectedText}\n## Page Content\n\n${page.text || "_No readable text was found on this page._"}\n`;
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
}

function setFolderStatus(text) {
  folderStatus.textContent = text;
}

function setStatus(message, tone) {
  statusLine.textContent = message;
  if (tone) {
    statusLine.dataset.tone = tone;
  } else {
    delete statusLine.dataset.tone;
  }
}

function setBusy(isBusy) {
  chooseFolder.disabled = isBusy;
  captureButton.disabled = isBusy;
  fillButton.disabled = isBusy;
}

// ── Tabs ─────────────────────────────────────────────────────────────────

const LEDES = {
  capture: "Turn this page into raw memory.",
  fill: "Answer this page's form from memory.",
};

function selectTab(mode) {
  const capturing = mode === "capture";
  tabCapture.classList.toggle("is-active", capturing);
  tabFill.classList.toggle("is-active", !capturing);
  tabCapture.setAttribute("aria-selected", String(capturing));
  tabFill.setAttribute("aria-selected", String(!capturing));
  paneCapture.hidden = !capturing;
  paneFill.hidden = capturing;
  lede.textContent = LEDES[mode];
  setStatus("");
  chrome.storage?.local.set({ mode });
}

tabCapture.addEventListener("click", () => selectTab("capture"));
tabFill.addEventListener("click", () => selectTab("fill"));

chrome.storage?.local.get(["mode", "engine", "vault"]).then(({ mode, engine, vault }) => {
  if (engine) engineSelect.value = engine;
  if (mode === "fill") selectTab("fill");
  loadVaults(vault);
});

engineSelect.addEventListener("change", () => {
  chrome.storage?.local.set({ engine: engineSelect.value });
});

// ── Vault picker ─────────────────────────────────────────────────────────

vaultSelect.addEventListener("change", () => {
  chrome.storage?.local.set({ vault: vaultSelect.value });
  describeVault();
});

/**
 * Ask the host which vaults exist and offer them as targets.
 *
 * A host that is missing entirely stays silent — it may simply not be
 * installed, and pressing Fill surfaces that with its install instructions.
 * A host that answers but rejects the request is different: it is a staged
 * copy older than this popup, which otherwise looks identical to "you only
 * have one vault" and hides the picker for no visible reason.
 */
async function loadVaults(preferred) {
  let vaults;
  try {
    const response = await chrome.runtime.sendNativeMessage(HOST_NAME, { type: "vaults" });
    vaults = response?.ok ? response.vaults : undefined;
    if (!response?.ok) {
      setStatus("Vault list unavailable — re-run host/install.sh, then ⌘Q and reopen Chrome.", "error");
    }
  } catch {
    vaults = undefined;
  }

  if (!vaults?.length) {
    describeVault();
    return;
  }

  vaultSelect.replaceChildren();
  vaults.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.name || "";
    option.textContent = entry.exists ? entry.label : `${entry.label} (missing)`;
    option.dataset.path = entry.path || "";
    option.disabled = !entry.exists;
    vaultSelect.append(option);
  });

  // A remembered vault that has since been deleted must not silently redirect
  // the answer to whatever vault happens to be first in the list.
  const match = Array.from(vaultSelect.options).find(
    (option) => option.value === (preferred || "") && !option.disabled,
  );
  vaultSelect.value = match ? match.value : "";
  if (preferred && !match) {
    setStatus(`Vault "${preferred}" is gone — using the default.`, "error");
    chrome.storage?.local.set({ vault: "" });
  }
  describeVault();
}

function describeVault() {
  const option = vaultSelect.selectedOptions[0];
  vaultStatus.textContent = option?.dataset.path || "Whatever ~/.obsidian-wiki/config points at.";
}

// ── Fill ─────────────────────────────────────────────────────────────────

fillButton.addEventListener("click", async () => {
  setBusy(true);
  resultsList.replaceChildren();

  try {
    const tab = await activeTab();

    setStatus("Reading the form…");
    const [{ result: form }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFormSchema,
    });

    if (!form?.fields?.length) {
      throw new Error("No fillable fields found on this page.");
    }

    const vaultLabel = vaultSelect.value ? `the ${vaultSelect.value} vault` : "your vault";
    setStatus(`Found ${form.fields.length} fields. Asking ${vaultLabel}…`);
    const response = await chrome.runtime.sendNativeMessage(HOST_NAME, {
      type: "fill",
      engine: engineSelect.value,
      vault: vaultSelect.value,
      form,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The native host returned no answer.");
    }

    const fills = response.fills || [];
    if (!fills.length) {
      // "Found nothing" and "found plenty, none of it answered these fields"
      // call for completely different responses, so never merge the two.
      const pages = response.meta?.pages_included ?? 0;
      setStatus(
        pages
          ? `Read ${pages} pages, but none of them answer these fields.`
          : response.note || "Nothing in your vault matched this form.",
        "error",
      );
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyFills,
      args: [fills],
    });

    renderResults(fills, form);
    setStatus(
      `Filled ${fills.length} of ${form.fields.length}. Review before submitting.`,
      "success",
    );
  } catch (error) {
    setStatus(describeFillError(error), "error");
  } finally {
    setBusy(false);
  }
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("Chrome blocks scripting on internal browser pages.");
  }
  return tab;
}

function describeFillError(error) {
  // Chrome's two native-messaging failures need opposite fixes and its wording
  // does not make that obvious: "not found" means the host was never
  // registered, while "exited" means it launched and then died.
  const message = error.message || String(error);
  if (/not found|forbidden/i.test(message)) {
    return `${message}\n\nRun host/install.sh, then fully quit and reopen Chrome.`;
  }
  if (/exited|disconnected|native/i.test(message)) {
    return `${message}\n\nCheck ~/.obsidian-wiki/brain-fill.log`;
  }
  return message;
}

function renderResults(fills, form) {
  const labels = new Map(form.fields.map((field) => [field.id, field.label || field.id]));

  fills.forEach((fill) => {
    const item = document.createElement("li");
    item.dataset.confident = String((fill.confidence ?? 0) >= 0.7);

    const label = document.createElement("p");
    label.className = "result-label";
    label.textContent = labels.get(fill.id) || fill.id;

    const value = document.createElement("p");
    value.className = "result-value";
    value.textContent = String(fill.value).slice(0, 200);

    const meta = document.createElement("p");
    meta.className = "result-meta";
    meta.textContent = `${Math.round((fill.confidence ?? 0) * 100)}% · ${fill.source || "vault"}`;

    item.append(label, value, meta);
    resultsList.append(item);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadRawHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(RAW_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function saveRawHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, RAW_HANDLE_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function extractPage() {
  const selectorsToRemove = "script, style, noscript, svg, canvas, iframe, nav, footer, aside, form";
  const clone = document.body ? document.body.cloneNode(true) : document.documentElement.cloneNode(true);
  clone.querySelectorAll(selectorsToRemove).forEach((node) => node.remove());

  const article = clone.querySelector("article, main, [role='main']") || clone;
  const rawText = article.innerText || clone.innerText || document.body?.innerText || "";
  const text = rawText
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 140000);

  const selection = String(window.getSelection?.() || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 30000);

  const description = document.querySelector("meta[name='description'], meta[property='og:description']")
    ?.getAttribute("content")
    ?.trim() || "";

  return {
    title: document.title,
    url: location.href,
    description,
    selection,
    text
  };
}

// ── Injected into the page by chrome.scripting (see extractPage above) ──
// Functions injected into the page by popup.js via chrome.scripting.
// They are self-contained on purpose: executeScript serialises the function
// body, so nothing outside these bodies is in scope at run time.

/**
 * Build a stable schema of the page's fillable fields.
 *
 * Field identity is the whole game here — ids must survive between the read
 * and the write, and real forms routinely ship inputs with no id, no name, and
 * a label that is only a sibling <div>. So identity is positional (the index
 * into this same query) and the label is resolved through a fallback chain.
 */
function extractFormSchema() {
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // Generic control text that tells you nothing about what is being asked.
  // Google Forms puts aria-label="Your answer" on every paragraph field while
  // the real question lives behind aria-labelledby, so an aria-label has to
  // earn its place rather than win by being checked first.
  const GENERIC = /^(your answer|answer|response|text|input|value|field|untitled)$/i;
  const meaningful = (text) => (text && !GENERIC.test(text.trim()) ? text.trim() : "");

  const labelFor = (element) => {
    // Ordered most to least reliable.
    if (element.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      const text = meaningful(explicit?.innerText);
      if (text) return text;
    }

    // Before aria-label: it points at real page text, so it survives generic
    // placeholder labels on the control itself.
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText.trim() || "")
        .filter(Boolean)
        .join(" ");
      if (meaningful(text)) return text.replace(/\s*\*\s*$/, "").trim();
    }

    const aria = meaningful(element.getAttribute("aria-label"));
    if (aria) return aria;

    const wrapping = element.closest("label");
    if (wrapping?.innerText.trim()) return wrapping.innerText.trim();

    // Walk up looking for a container that holds exactly this control, and
    // take its text minus the control's own — that is nearly always the label
    // in div-soup forms.
    let node = element.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll("input, select, textarea, [contenteditable='true']").length !== 1) {
        break;
      }
      const text = (node.innerText || "").trim();
      if (text) return text.split("\n")[0].slice(0, 200);
    }

    return meaningful(element.getAttribute("placeholder"))
      || element.getAttribute("name")
      || "";
  };

  const selector = "input, select, textarea, [contenteditable='true']";
  const skipTypes = new Set([
    "hidden", "submit", "button", "reset", "image", "file", "range", "color",
    "password",
  ]);

  const fields = [];
  document.querySelectorAll(selector).forEach((element, index) => {
    const tag = element.tagName.toLowerCase();
    let type = tag === "input" ? (element.type || "text").toLowerCase() : tag;
    if (element.isContentEditable) type = "textarea";

    if (skipTypes.has(type)) return;
    if (element.disabled || element.readOnly) return;
    if (!isVisible(element)) return;

    const field = {
      id: `f${index}`,
      label: labelFor(element),
      type: type === "select-one" || type === "select" ? "select" : type,
      name: element.getAttribute("name") || "",
      placeholder: element.getAttribute("placeholder") || "",
      required: element.required === true,
    };

    if (tag === "select") {
      field.options = Array.from(element.options)
        .map((option) => option.text.trim())
        .filter((text) => text && !/^(select|choose|--)/i.test(text));
    }

    if (type === "radio") {
      const group = document.querySelectorAll(
        `input[type="radio"][name="${CSS.escape(element.name || "")}"]`
      );
      field.options = Array.from(group).map((radio) => labelFor(radio)).filter(Boolean);
    }

    const maxLength = Number(element.getAttribute("maxlength"));
    if (Number.isFinite(maxLength) && maxLength > 0) field.maxLength = maxLength;

    fields.push(field);
  });

  const heading = document.querySelector("h1, h2")?.innerText.trim() || "";

  return { url: location.href, title: document.title, heading, fields };
}

/**
 * Write values back, then outline what changed.
 *
 * Assigning `.value` directly is invisible to React/Vue, which track state in
 * their own store and only observe events. Going through the prototype's
 * native setter and then dispatching input+change makes the framework see a
 * genuine user edit.
 */
function applyFills(fills) {
  const selector = "input, select, textarea, [contenteditable='true']";
  const elements = Array.from(document.querySelectorAll(selector));
  const applied = [];

  const setNativeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  };

  fills.forEach((fill) => {
    const index = Number(String(fill.id).replace(/^f/, ""));
    const element = elements[index];
    if (!element) return;

    const tag = element.tagName.toLowerCase();
    const type = tag === "input" ? (element.type || "text").toLowerCase() : tag;

    if (element.isContentEditable) {
      element.focus();
      element.textContent = String(fill.value);
    } else if (type === "checkbox") {
      if (element.checked !== Boolean(fill.value)) element.click();
    } else if (tag === "select") {
      const target = String(fill.value).trim().toLowerCase();
      const option = Array.from(element.options).find(
        (candidate) => candidate.text.trim().toLowerCase() === target
          || candidate.value.trim().toLowerCase() === target
      );
      if (!option) return;
      setNativeValue(element, option.value);
    } else {
      setNativeValue(element, String(fill.value));
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    // Low confidence gets a warmer outline so it is obvious what to re-read
    // before submitting. Nothing is ever submitted by this extension.
    const confident = (fill.confidence ?? 0) >= 0.7;
    element.style.outline = `2px solid ${confident ? "#3b8f5a" : "#c08a2e"}`;
    element.style.outlineOffset = "1px";
    if (fill.source) element.title = `From ${fill.source} (confidence ${fill.confidence})`;

    applied.push(fill.id);
  });

  const first = elements[Number(String(fills[0]?.id ?? "f0").replace(/^f/, ""))];
  first?.scrollIntoView({ behavior: "smooth", block: "center" });

  return applied;
}
