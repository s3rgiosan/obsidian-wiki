const DB_NAME = "brain-vault-capture";
const STORE_NAME = "handles";
const RAW_HANDLE_KEY = "raw-folder";

const MENU_PAGE = "brain-capture-page";
const MENU_SELECTION = "brain-capture-selection";

chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.runtime.onStartup.addListener(createContextMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab?.id || isBlockedUrl(tab.url)) {
      await showNeedsPopup("This page cannot be captured from the context menu.");
      return;
    }

    const rawDirectoryHandle = await loadRawHandle();
    if (!rawDirectoryHandle || !(await hasWritePermission(rawDirectoryHandle))) {
      await showNeedsPopup("Open Brain Vault Capture and choose vault/_raw first.");
      return;
    }

    const page = info.menuItemId === MENU_SELECTION
      ? buildSelectionPage(info, tab)
      : await extractPageFromTab(tab.id);

    const filename = buildFilename(page.title || tab.title || "web-capture");
    const markdown = buildMarkdown(page, "");
    const savedFilename = await writeMarkdown(rawDirectoryHandle, filename, markdown);
    await flashBadge("ok", "#9be2b5", savedFilename);
  } catch (error) {
    await flashBadge("!", "#e58f85", error.message);
  }
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: "Capture page to brain raw",
      contexts: ["page"]
    });

    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: "Capture selection to brain raw",
      contexts: ["selection"]
    });
  });
}

function isBlockedUrl(url = "") {
  return url.startsWith("chrome://") || url.startsWith("chrome-extension://");
}

async function showNeedsPopup(title) {
  await chrome.action.setTitle({ title });
  await flashBadge("set", "#8ee7d2", title);

  if (chrome.action.openPopup) {
    await chrome.action.openPopup();
  }
}

async function flashBadge(text, color, title) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (title) {
    await chrome.action.setTitle({ title });
  }

  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 2400);
}

async function hasWritePermission(directoryHandle) {
  const options = { mode: "readwrite" };
  return directoryHandle.queryPermission
    && await directoryHandle.queryPermission(options) === "granted";
}

async function extractPageFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPage
  });

  return result;
}

function buildSelectionPage(info, tab) {
  const selectedText = (info.selectionText || "").trim();

  return {
    title: tab.title || "Selected web text",
    url: tab.url || info.pageUrl || info.frameUrl || "",
    description: "",
    selection: selectedText,
    text: ""
  };
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
  const pageContent = page.text ? `\n## Page Content\n\n${page.text}\n` : "";

  return `---\ntitle: ${safeTitle}\ntags: [web-capture, raw-ingest]\nsources:\n  - ${page.url}\ncreated: ${now}\ncaptured: chrome-extension\n---\n\n# ${page.title || "Untitled page"}\n\n${description}\n- Source: ${page.url}\n- Captured: ${now}\n${noteText}${selectedText}${pageContent}`;
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
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
