import { brandMark, icon } from "./icons.js";
import {
  EMAIL_THEMES,
  clearImageAllowances,
  inspectEmailForDebug,
  renderEmailBody,
} from "./body.js";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "starred", label: "Starred", icon: "star" },
  { id: "sent", label: "Sent", icon: "send" },
  { id: "drafts", label: "Drafts", icon: "compose" },
  { id: "archive", label: "Archive", icon: "archive" },
  { id: "spam", label: "Spam", icon: "spam" },
  { id: "trash", label: "Trash", icon: "trash" },
];

const THEMES = [
  {
    id: "fog",
    name: "Fog",
    desk: "#d7dde2",
    chrome: "#e1e6e9",
    side: "#e8ecef",
    paper: "#fffdf8",
    ink: "#24282c",
  },
  {
    id: "linen",
    name: "Linen",
    desk: "#d8cfbd",
    chrome: "#e2d8c6",
    side: "#e9e1d2",
    paper: "#fffcf3",
    ink: "#2e2a23",
  },
  {
    id: "sepia",
    name: "Sepia",
    desk: "#cfc0a5",
    chrome: "#d9cbb5",
    side: "#e3d6c1",
    paper: "#fffaf0",
    ink: "#362f24",
  },
  {
    id: "graphite",
    name: "Graphite",
    desk: "#17181a",
    chrome: "#2a2d30",
    side: "#232528",
    paper: "#f8f5ed",
    ink: "#e9e9e7",
  },
  {
    id: "midnight",
    name: "Midnight",
    desk: "#0d131b",
    chrome: "#1b2633",
    side: "#16202b",
    paper: "#f8f5ed",
    ink: "#e4eaf2",
  },
];

const ACCENTS = [
  { value: "#3E6FA8", name: "Blue" },
  { value: "#2F7D74", name: "Teal" },
  { value: "#4F7A3B", name: "Green" },
  { value: "#A46A22", name: "Amber" },
  { value: "#B15245", name: "Red" },
  { value: "#8B4E6A", name: "Rose" },
  { value: "#6659A5", name: "Violet" },
  { value: "#59636F", name: "Slate" },
];

const ACCOUNT_COLORS = [
  { value: "#3E6FA8", name: "Blue" },
  { value: "#5E7F45", name: "Olive" },
  { value: "#A26232", name: "Clay" },
  { value: "#8A4B4B", name: "Maroon" },
  { value: "#44787A", name: "Teal" },
  { value: "#755E8F", name: "Plum" },
  { value: "#8A6B2E", name: "Ochre" },
  { value: "#546E91", name: "Slate" },
];

const DARK_THEMES = new Set(["graphite", "midnight"]);
const SUMMARY_CACHE_LIMIT = 10;
const SUMMARY_CACHE_TTL = 30 * 60 * 1000;
const GOOGLE_SETUP_STEPS = 6;
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
];

const DEFAULT_PREFS = {
  theme: "fog",
  accent: "#3E6FA8",
  hideSignatures: true,
  hideQuotes: true,
  blockImages: true,
  layout: "split",
  composerMode: "tray",
  sidebarCollapsed: false,
  trayHeight: null,
  contentWidth: "wide",
  badgePosition: "before-subject",
  labelPosition: "after-subject",
  sidebarWidth: null,
  listWidth: null,
  emailTheme: "fog",
  closeBehavior: "tray",
  minimizeBehavior: "default",
  loginStartup: "off",
  notifyEnabled: true,
  notifyArchived: false,
  notifySound: "soft-knock",
  notifyVolume: 60,
  notifySoundPath: null,
  notifyShowAccount: true,
  notifyBadgePosition: "before-subject",
  notifyUseAI: false,
  notifyAIMinChars: 400,
  aiEnabled: false,
  googleSetupSeen: false,
  updateAuto: false,
  updateInterval: 5,
};

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

function loadPrefs() {
  return { ...DEFAULT_PREFS };
}

const state = {
  token: "",
  prefs: loadPrefs(),
  accounts: [],
  counts: {},
  sync: {
    syncing: false,
    active: "",
    progress: "",
    errors: {},
    last_finished: 0,
    manual: false,
    revision: 0,
  },
  settings: {},
  version: "",
  signatures: {},
  updateChecking: false,
  updateResult: null,
  updateMode: null,
  updateOperation: null,
  updateTimer: null,
  updatePollTimer: null,
  updatePollErrors: 0,
  updateSessionChecked: false,
  updateNotifiedVersion: "",
  oauthPending: false,
  folder: "inbox",
  labelName: null,
  labels: [],
  views: [],
  viewId: null,
  viewTotal: 0,
  viewEditor: null,
  viewEditorKeyHandler: null,
  expandedAccounts: new Set(["all"]),
  expandedLabelLists: new Set(),
  accountFilter: null,
  query: "",
  searchMode: false,
  remoteSearch: false,
  unreadOnly: false,
  threads: [],
  listLoading: false,
  listError: "",
  listLimit: 80,
  localHasMore: false,
  remoteHasMore: true,
  loadingMore: false,
  listSeq: 0,
  selectedKey: null,
  selected: null,
  readerLoading: false,
  readerError: "",
  openSeq: 0,
  expanded: new Set(),
  settingsOpen: false,
  settingsFocus: null,
  editingAccountId: null,
  accountEditorColor: null,
  accountEditorSignatureEnabled: false,
  accountEditorSignatureHtml: "",
  signatureEditor: null,
  signatureEditorKeyHandler: null,
  styledPaperNotified: false,
  focusEmail: false,
  composer: null,
  summary: null,
  summaryCache: [],
  oauthUrl: "",
  oauthStatus: null,
  aiStatus: null,
  readerScroll: 0,
  readerSettleToken: 0,
  readerSettleSeq: 0,
  readerChromeKey: "",
  threadRefreshing: false,
  markReadKey: "",
  threadDrafts: {},
  syncReloading: false,
  searchTimer: null,
  pollTimer: null,
  oauthTimer: null,
  draftTimer: null,
  prefsTimer: null,
  prefsLoaded: false,
  toastSeq: 0,
  sendStatusTimer: null,
  contactMenu: null,
  contactTimer: null,
  contactSeq: 0,
  menuOpen: false,
  contextPoint: null,
  contextSummary: null,
  summaryOffersDismissed: new Set(),
  lightbox: null,
  modalOpen: false,
  googleSetup: null,
  googleSetupKeyHandler: null,
  initialized: false,
  windowActive: null,
  accountSig: "",
  shownSyncErrors: new Set(),
};

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const TOKEN_HEADER = "X-Courier-Token";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return { r: 65, g: 90, b: 120 };
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbString(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

function mixHex(hex, other, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  const mix = (x, y) => Math.round(x + (y - x) * amount);
  return `#${[mix(a.r, b.r), mix(a.g, b.g), mix(a.b, b.b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function contrastText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#1f1b15" : "#ffffff";
}

function isDarkTheme() {
  return DARK_THEMES.has(document.documentElement.dataset.theme);
}

function applyTheme(theme, accent) {
  const validTheme = THEMES.some((entry) => entry.id === theme) ? theme : "fog";
  document.documentElement.dataset.theme = validTheme;
  const accentValue = /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : "#3E6FA8";
  document.documentElement.style.setProperty("--accent", accentValue);
  document.documentElement.style.setProperty("--accent-rgb", rgbString(accentValue));
  document.documentElement.style.setProperty("--accent-contrast", contrastText(accentValue));
  const ink = isDarkTheme()
    ? mixHex(accentValue, "#ffffff", 0.4)
    : mixHex(accentValue, "#000000", 0.22);
  document.documentElement.style.setProperty("--accent-ink", ink);
}

function savePrefs() {
  if (!state.token) return;
  if (state.prefsTimer) clearTimeout(state.prefsTimer);
  state.prefsTimer = setTimeout(async () => {
    try {
      await api("/api/prefs", {
        method: "POST",
        body: { prefs: state.prefs },
      });
    } catch (error) {
      console.warn("Could not save settings", error);
    }
  }, 150);
}

function applyPanelWidths() {
  const app = $("#app");
  if (!app) return;
  for (const [key, variable] of [
    ["sidebarWidth", "--sidebar-width"],
    ["listWidth", "--list-width"],
  ]) {
    const value = Number(state.prefs[key]);
    if (Number.isFinite(value) && value > 0) {
      app.style.setProperty(variable, `${Math.round(value)}px`);
    } else {
      app.style.removeProperty(variable);
    }
  }
  window.dispatchEvent(new Event("resize"));
}

function panelWidthBounds(kind) {
  if (kind === "sidebar") {
    return [180, Math.min(420, Math.max(240, window.innerWidth - 560))];
  }
  return [280, Math.min(760, Math.max(340, window.innerWidth - 520))];
}

function setPanelWidth(kind, width) {
  const key = kind === "sidebar" ? "sidebarWidth" : "listWidth";
  const variable = kind === "sidebar" ? "--sidebar-width" : "--list-width";
  const [low, high] = panelWidthBounds(kind);
  const value = Math.max(low, Math.min(high, Math.round(width)));
  state.prefs[key] = value;
  $("#app")?.style.setProperty(variable, `${value}px`);
  return value;
}

function applyPrefs(persist = true) {
  applyTheme(state.prefs.theme, state.prefs.accent);
  const width = ["standard", "wide", "full"].includes(state.prefs.contentWidth)
    ? state.prefs.contentWidth
    : "wide";
  document.documentElement.dataset.contentWidth = width;
  applyPanelWidths();
  if (persist) savePrefs();
}

function initials(name, email) {
  const source = String(name || email || "?").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function accountFor(accountId) {
  return state.accounts.find((account) => account.id === accountId) || null;
}

function accountLabel(account) {
  if (!account) return "unknown";
  return account.username || (account.email || "").split("@")[0];
}

function focusSidebarAccount(key) {
  const current = state.accountFilter || "all";
  if (current !== key) state.expandedAccounts.delete(current);
  state.expandedAccounts.add(key);
}

function accountHasLabel(accountId, name) {
  const label = (state.labels || []).find(
    (entry) => entry.name.toLowerCase() === String(name || "").toLowerCase()
  );
  return Boolean(label && label.accounts && label.accounts[accountId]);
}

function labelsForAccount(accountId) {
  return (state.labels || []).filter(
    (label) => label.accounts && label.accounts[accountId]
  );
}

function viewById(viewId) {
  return (
    (state.views || []).find(
      (view) => Number(view.id) === Number(viewId)
    ) || null
  );
}

function viewsForAccount(accountId) {
  return (state.views || [])
    .filter((view) => view.account_id === accountId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function accountViewsHtml(accountId) {
  if (!state.expandedAccounts.has(accountId)) return "";
  const views = viewsForAccount(accountId);
  if (!views.length) return "";
  return `<div class="account-view-list">${views
    .map((view) => {
      const active =
        Number(state.viewId) === Number(view.id) &&
        !state.searchMode &&
        !state.labelName;
      return `<button class="folder-row label-row view-row ${
        active ? "active" : ""
      }" data-action="view" data-view="${view.id}" title="${esc(
        view.name
      )}" ${active ? 'aria-current="page"' : ""}>
        <span class="folder-icon view-icon">${icon("eye", 15)}</span>
        <span class="folder-label">${esc(view.name)}</span>
      </button>`;
    })
    .join("")}</div>`;
}

function accountLabelsHtml(accountId, labels) {
  const key = accountId || "all";
  if (!state.expandedAccounts.has(key)) return "";
  if (!labels.length) {
    return `<div class="account-label-list"><div class="account-label-empty">No labels</div></div>`;
  }
  const expanded = state.expandedLabelLists.has(key);
  const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const rows = visible
    .map((label) => {
      const bucket =
        key === "all"
          ? label
          : label.accounts && label.accounts[accountId];
      if (!bucket) return "";
      const unread = bucket.unread || 0;
      const color = /^#[0-9a-f]{6}$/i.test(bucket.color || label.color || "")
        ? bucket.color || label.color
        : "";
      const active =
        !state.viewId &&
        state.labelName &&
        state.labelName.toLowerCase() === label.name.toLowerCase() &&
        (key === "all"
          ? !state.accountFilter
          : state.accountFilter === accountId);
      return `<button class="folder-row label-row account-label-row ${
        active ? "active" : ""
      }" data-action="label" data-label="${esc(label.name)}" data-label-account="${esc(
        key
      )}" title="${esc(label.name)}${unread ? `, ${unread} unread` : ""}" ${
        active ? 'aria-current="page"' : ""
      }>
        <span class="folder-icon label-icon" style="${color ? `color:${color}` : ""}">${icon(
          "tag",
          15
        )}</span>
        <span class="folder-label">${esc(label.name)}</span>
        ${unread ? `<span class="folder-count">${unread}</span>` : ""}
      </button>`;
    })
    .join("");
  const more =
    sorted.length > 5
      ? `<button class="label-more account-label-more" data-action="account-labels-more" data-account="${esc(
          key
        )}" aria-expanded="${expanded ? "true" : "false"}">
          <span class="label-more-icon">${icon("chevronDown", 13)}</span>
          <span class="label-more-text">${expanded ? "Show less" : "Show more"}</span>
        </button>`
      : "";
  return `<div class="account-label-list">${rows}${more}</div>`;
}

function accountToggleHtml(key, label) {
  const open = state.expandedAccounts.has(key);
  return `<button class="account-toggle" data-action="toggle-account-labels" data-account="${esc(
    key
  )}" aria-expanded="${open ? "true" : "false"}" aria-label="${
    open ? "Hide" : "Show"
  } views and labels for ${esc(label)}" title="${
    open ? "Hide" : "Show"
  } views and labels">${icon("chevronRight", 14)}</button>`;
}

function badgeStyle(color) {
  const { r, g, b } = hexToRgb(color);
  const dark = isDarkTheme();
  const fg = dark ? mixHex(color, "#ffffff", 0.35) : mixHex(color, "#000000", 0.2);
  return `color:${fg};background:rgba(${r}, ${g}, ${b},${
    dark ? "0.2" : "0.1"
  });border-color:rgba(${r}, ${g}, ${b},${dark ? "0.4" : "0.28"})`;
}

function accountBadge(account, extraClass = "") {
  if (!account || state.accountFilter) return "";
  return `<span class="account-badge ${extraClass}" style="${esc(
    badgeStyle(account.color)
  )}" title="${esc(account.email)}">${esc(accountLabel(account))}</span>`;
}

function threadLabelBadges(thread) {
  const accountId = thread.account_id;
  const labelIds = new Set(thread.labels || []);
  const badges = [];
  for (const label of state.labels || []) {
    const id = label.ids && label.ids[accountId];
    if (!id || !labelIds.has(id)) continue;
    const bucket = label.accounts && label.accounts[accountId];
    const color =
      (bucket && bucket.color) || label.color || state.prefs.accent;
    badges.push(
      `<span class="label-badge" style="${esc(badgeStyle(color))}" title="${esc(
        label.name
      )}">${esc(label.name)}</span>`
    );
    if (badges.length >= 2) break;
  }
  return badges.join("");
}

function avatarColor(color) {
  return mixHex(color, "#000000", 0.28);
}

function avatarHtml(account, personName, sizeClass = "") {
  if (!account) {
    return `<div class="account-avatar ${sizeClass}">?</div>`;
  }
  const { r, g, b } = hexToRgb(avatarColor(account.color));
  return `<div class="account-avatar ${sizeClass}" style="background-color:rgb(${r}, ${g}, ${b})">${esc(
    initials(personName, account.email)
  )}</div>`;
}

function folderById(id) {
  return FOLDERS.find((folder) => folder.id === id) || FOLDERS[0];
}

function formatDate(ms, mode = "list") {
  const value = Number(ms) || 0;
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (mode === "list") {
    if (sameDay) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    }
    if (date.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }
  if (mode === "time") {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function htmlToText(html) {
  try {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    return doc.body.textContent || "";
  } catch (error) {
    return "";
  }
}

let entityDecoder = null;
function decodeEntities(value) {
  const text = String(value ?? "");
  if (!text.includes("&")) return text;
  if (!entityDecoder) entityDecoder = document.createElement("textarea");
  entityDecoder.innerHTML = text;
  return entityDecoder.value;
}

function displayText(value) {
  return esc(decodeEntities(value));
}

function threadKey(accountId, id) {
  return `${accountId}:${id}`;
}

function currentThread() {
  return state.selected && state.selected.thread ? state.selected.thread : null;
}

function windowIsActive() {
  if (state.windowActive === false) return false;
  if (document.hidden) return false;
  return document.hasFocus() || state.windowActive === true;
}

function currentMessages() {
  return state.selected && state.selected.messages ? state.selected.messages : [];
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

async function api(path, options = {}) {
  const controller = options.timeout ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeout)
    : null;
  try {
    const headers = { [TOKEN_HEADER]: state.token };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal || (controller ? controller.signal : undefined),
    });
    const type = response.headers.get("content-type") || "";
    let data = null;
    if (type.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    if (!response.ok) {
      const error = new Error((data && data.error) || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller && controller.signal.aborted) {
      const timeout = new Error("The request timed out.");
      timeout.status = 0;
      timeout.timeout = true;
      throw timeout;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function apiXhr(path, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    xhr.open(options.method || "POST", path, true);
    xhr.setRequestHeader(TOKEN_HEADER, state.token);
    if (options.rawBody !== undefined || options.body !== undefined) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    if (options.timeout) xhr.timeout = options.timeout;
    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          options.onProgress(event.loaded / event.total);
        }
      };
    }
    if (options.onUploadComplete) {
      xhr.upload.onload = () => options.onUploadComplete();
    }
    if (options.onStart) options.onStart(xhr);
    xhr.onload = () => {
      let data = null;
      const type = xhr.getResponseHeader("content-type") || "";
      try {
        data = type.includes("application/json")
          ? JSON.parse(xhr.responseText)
          : xhr.responseText;
      } catch (error) {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        settled = true;
        resolve(data);
        return;
      }
      const error = new Error(
        (data && data.error) || `Request failed (${xhr.status})`
      );
      error.status = xhr.status;
      fail(error);
    };
    xhr.onerror = () => fail(new Error("Could not reach Courier."));
    xhr.ontimeout = () => {
      const error = new Error("The request timed out.");
      error.status = 0;
      error.timeout = true;
      fail(error);
    };
    xhr.onabort = () => {
      const error = new Error("The request was cancelled.");
      error.status = 0;
      error.aborted = true;
      fail(error);
    };
    try {
      xhr.send(
        options.rawBody !== undefined
          ? options.rawBody
          : JSON.stringify(options.body || {})
      );
    } catch (error) {
      fail(error);
    }
  });
}

function attachmentUrl(message, index, inline = false) {
  const base = inline ? "/api/inline" : "/api/attachment";
  return `${base}?account=${encodeURIComponent(message.account_id)}&message=${encodeURIComponent(
    message.id
  )}&index=${index}&t=${encodeURIComponent(state.token)}`;
}

/* -------------------------------------------------------------------------- */
/* Icons / initial shell                                                      */
/* -------------------------------------------------------------------------- */

function hydrateIcons(root = document) {
  for (const holder of $$("[data-icon]", root)) {
    holder.innerHTML = icon(holder.dataset.icon, holder.dataset.iconSize || 18);
  }
}

function refreshButtonUi() {
  const button = $("#refresh-btn");
  if (!button) return;
  const svg = $(".icon", button);
  const active = Boolean(state.sync.syncing && state.sync.manual);
  if (svg) svg.classList.toggle("spin", active);
  button.title = active ? "Checking mail" : "Check for mail";
}

/* -------------------------------------------------------------------------- */
/* Rendering: sidebar                                                         */
/* -------------------------------------------------------------------------- */

function renderSidebar() {
  const nav = $("#folder-nav");
  const notes = $("#sync-note");
  const allUnread = state.accounts.reduce(
    (total, account) => total + (account.inbox_unread || 0),
    0
  );

  nav.innerHTML = FOLDERS.map((folder) => {
    const counts = state.counts[folder.id] || { total: 0, unread: 0 };
    const active =
      !state.searchMode &&
      !state.labelName &&
      !state.viewId &&
      state.folder === folder.id;
    const showUnread = ["inbox", "starred", "spam"].includes(folder.id) && counts.unread;
    const title =
      counts.total > 0
        ? `${folder.label}: ${counts.total} threads, ${counts.unread} unread`
        : folder.label;
    return `<button class="folder-row ${
      active ? "active" : ""
    }" data-action="folder" data-folder="${folder.id}" title="${esc(title)}" ${
      active ? 'aria-current="page"' : ""
    }>
      <span class="folder-icon">${icon(folder.icon, 17)}</span>
      <span class="folder-label">${folder.label}</span>
      ${showUnread ? `<span class="folder-count">${counts.unread}</span>` : ""}
    </button>`;
  }).join("");

  const labels = state.labels || [];
  let html = `<div class="account-group">
    <div class="account-row-line">
      <button class="account-row ${
        state.accountFilter ? "" : "active"
      }" data-action="all-accounts" title="All accounts">
        <span class="account-avatar all">${icon("layers", 13)}</span>
        <span class="account-name">All accounts</span>
        ${allUnread ? `<span class="account-unread">${allUnread}</span>` : ""}
      </button>
      ${accountToggleHtml("all", "All accounts")}
    </div>
    ${accountLabelsHtml(null, labels)}
  </div>`;
  html += state.accounts
    .map((account) => {
      const active =
        state.accountFilter === account.id && !state.viewId;
      const color = hexToRgb(avatarColor(account.color));
      const error = state.sync.errors[account.id];
      return `<div class="account-group">
        <div class="account-row-line">
          <button class="account-row ${
            active ? "active" : ""
          }" data-action="account-filter" data-account="${esc(
            account.id
          )}" title="${esc(account.email)}${error ? ` - ${esc(error)}` : ""}">
            <span class="account-avatar" style="background-color:rgb(${color.r}, ${color.g}, ${color.b})">${esc(
              (accountLabel(account)[0] || "?").toUpperCase()
            )}</span>
            <span class="account-name">${esc(accountLabel(account))}</span>
            ${
              account.needs_reauth
                ? `<span class="reauth-dot" title="Sign-in expired"></span>`
                : account.inbox_unread
                ? `<span class="account-unread">${account.inbox_unread}</span>`
                : ""
            }
          </button>
          ${accountToggleHtml(account.id, accountLabel(account))}
        </div>
        ${accountViewsHtml(account.id)}
        ${accountLabelsHtml(account.id, labelsForAccount(account.id))}
      </div>`;
    })
    .join("");
  const accountList = $("#account-list");
  accountList.innerHTML = html;

  const compose = $("#compose-btn");
  if (compose) {
    compose.disabled = state.accounts.length === 0;
    compose.title = state.accounts.length ? "Compose" : "Add an account first";
  }

  const settingsRow = $(".settings-row");
  if (settingsRow) {
    settingsRow.classList.toggle("active", state.settingsOpen);
    if (state.settingsOpen) settingsRow.setAttribute("aria-current", "page");
    else settingsRow.removeAttribute("aria-current");
  }

  const notesText = [];
  if (state.sync.syncing && state.sync.manual) {
    notesText.push(
      state.sync.progress
        ? `${state.sync.progress}${state.sync.active ? ` · ${state.sync.active}` : ""}`
        : "Checking mail"
    );
  } else if (Object.keys(state.sync.errors).length) {
    notesText.push("Sync error");
  } else {
    const finished = state.sync.last_finished || 0;
    if (finished) notesText.push(`Checked ${formatDate(finished, "time")}`);
  }
  notes.textContent = notesText.join(" ");
  notes.classList.toggle("error", Object.keys(state.sync.errors).length > 0);
  const errorText = Object.entries(state.sync.errors)
    .map(([accountId, message]) => {
      const account = accountFor(accountId);
      return `${account ? account.email : accountId}: ${message}`;
    })
    .join("\n");
  notes.title = errorText;
  refreshButtonUi();
}

/* -------------------------------------------------------------------------- */
/* Rendering: list                                                            */
/* -------------------------------------------------------------------------- */

function currentFolderTotal() {
  if (state.searchMode || state.query) return state.threads.length;
  if (state.viewId) return state.viewTotal || state.threads.length;
  if (state.labelName) {
    const label = (state.labels || []).find(
      (entry) => entry.name.toLowerCase() === state.labelName.toLowerCase()
    );
    const scoped =
      state.accountFilter && label && label.accounts
        ? label.accounts[state.accountFilter]
        : null;
    return scoped ? scoped.total : label ? label.total : state.threads.length;
  }
  if (state.accountFilter) {
    const account = accountFor(state.accountFilter);
    return (account && account.folders && account.folders[state.folder]
      ? account.folders[state.folder].total
      : 0);
  }
  return (state.counts[state.folder] && state.counts[state.folder].total) || 0;
}

function renderList() {
  const scroll = $("#thread-scroll");
  const previousScroll = scroll ? scroll.scrollTop : 0;
  const view = state.viewId ? viewById(state.viewId) : null;
  const title =
    state.searchMode || state.query
      ? "Search"
      : view
      ? view.name
      : state.labelName || folderById(state.folder).label;
  $("#list-title").textContent = title;
  const visibleThreads = state.unreadOnly
    ? state.threads.filter(
        (thread) => thread.unread || thread.key === state.selectedKey
      )
    : state.threads;
  const total = state.unreadOnly
    ? visibleThreads.length
    : currentFolderTotal();
  $("#list-count").textContent = total ? String(total) : "";

  const unreadButton = $("#unread-filter");
  unreadButton.setAttribute("aria-pressed", state.unreadOnly ? "true" : "false");
  unreadButton.title = state.unreadOnly ? "Show all" : "Show unread only";

  const list = $("#thread-list");
  list.innerHTML = visibleThreads
    .map((thread) => {
      const account = accountFor(thread.account_id);
      const selected = state.selectedKey === thread.key;
      const date = formatDate(thread.last_date, "list");
      const sender = decodeEntities(thread.sender_name || thread.sender_email || "(No sender)");
      const subject = decodeEntities(thread.subject || "(No subject)");
      const snippet = decodeEntities(thread.snippet || "");
      const badge = accountBadge(account);
      const labels = threadLabelBadges(thread);
      const badgePosition =
        state.prefs.badgePosition || "before-subject";
      const labelPosition =
        state.prefs.labelPosition || "after-subject";
      const slot = (position) =>
        `${
          badgePosition === position ? badge : ""
        }${labelPosition === position ? labels : ""}`;
      const badgesBeforeSender = slot("before-sender");
      const badgesAfterSender = slot("after-sender");
      const badgesBeforeSubject = slot("before-subject");
      const badgesAfterSubject = slot("after-subject");
      return `<div class="thread-row ${thread.unread ? "unread" : ""} ${
        selected ? "selected" : ""
      }" role="option" aria-selected="${selected ? "true" : "false"}" tabindex="0"
        data-account="${esc(thread.account_id)}" data-thread="${esc(thread.id)}"
        title="${esc(`${sender}: ${subject}`)}">
        <button class="row-star ${thread.starred ? "starred" : ""}" data-action="star-row"
          data-account="${esc(thread.account_id)}" data-thread="${esc(thread.id)}"
          aria-label="${thread.starred ? "Unstar" : "Star"}"
          title="${thread.starred ? "Unstar" : "Star"}">${icon("star", 15)}</button>
        <div class="row-body">
          <div class="row-top">
            <span class="unread-dot" aria-hidden="true"></span>
            ${badgesBeforeSender}
            <span class="row-sender">${esc(sender)}</span>
            ${badgesAfterSender}
            <span class="row-date">${esc(date)}</span>
          </div>
          <div class="row-subject-line">
            ${badgesBeforeSubject}
            <span class="row-subject">${esc(subject)}</span>
            ${badgesAfterSubject}
            ${
              thread.message_count > 1
                ? `<span class="thread-count" title="${thread.message_count} messages">${thread.message_count}</span>`
                : ""
            }
          </div>
          <div class="row-bottom">
            <span class="row-snippet">${esc(snippet)}</span>
            <span class="row-markers">${
              thread.has_attachment ? icon("paperclip", 12) : ""
            }</span>
          </div>
        </div>
      </div>`;
    })
    .join("");

  if (state.loadingMore) {
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="list-more-row"><span class="spinner"></span><span>Loading more mail</span></div>`
    );
  }

  const loading = $("#list-loading");
  const empty = $("#list-empty");
  const showLoading = state.listLoading && visibleThreads.length === 0;
  loading.hidden = !showLoading;
  if (showLoading) {
    $("#list-loading-text").textContent = state.sync.syncing ? "Checking mail" : "Loading";
  }

  let emptyHtml = "";
  if (!showLoading && !visibleThreads.length) {
    if (state.listError) {
      emptyHtml = `<div>${esc(state.listError)}</div><button class="btn" data-action="retry-list">Retry</button>`;
    } else if (!state.accounts.length) {
      emptyHtml = `<div>No account connected.</div><button class="btn" data-action="add-account">Add account</button>`;
    } else if (state.searchMode || state.query || state.viewId) {
      emptyHtml = "No matches.";
    } else if (state.unreadOnly) {
      emptyHtml = "No unread messages.";
    } else if (state.sync.syncing) {
      emptyHtml = `<div class="list-loading"><span class="spinner"></span><span>Checking mail</span></div>`;
    } else {
      emptyHtml = "No messages.";
    }
  }
  empty.innerHTML = emptyHtml;
  empty.hidden = !emptyHtml;

  const back = $("#list-back");
  if (back) back.hidden = true;

  if (scroll) scroll.scrollTop = previousScroll;
  const selectedRow = list.querySelector(".thread-row.selected");
  if (selectedRow && state.lastScrolledKey !== state.selectedKey) {
    state.lastScrolledKey = state.selectedKey;
    requestAnimationFrame(() => {
      selectedRow.scrollIntoView({ block: "nearest" });
    });
  }
  refreshButtonUi();
}

/* -------------------------------------------------------------------------- */
/* Rendering: reader                                                          */
/* -------------------------------------------------------------------------- */

function aiSummariesEnabled() {
  return Boolean(state.prefs.aiEnabled && state.settings.ai_configured);
}

function toolbarHtml(thread) {
  if (!thread) return "";
  const labels = new Set(thread.labels || []);
  const isTrash = labels.has("TRASH");
  const isSpam = labels.has("SPAM");
  const back = state.prefs.layout === "reading";
  return `<div class="reader-toolbar">
    ${
      back
        ? `<button class="icon-btn" data-action="back-to-list" aria-label="Back to list" title="Back to list">${icon(
            "back",
            17
          )}</button>`
        : ""
    }
    <div class="toolbar-group">
      <button class="btn" data-action="reply" title="Reply">${icon("reply", 15)}<span class="btn-label">Reply</span></button>
      <button class="btn" data-action="reply-all" title="Reply all">${icon(
        "replyAll",
        15
      )}<span class="btn-label">Reply all</span></button>
      <button class="btn" data-action="forward" title="Forward">${icon(
        "forward",
        15
      )}<span class="btn-label">Forward</span></button>
    </div>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-group">
      ${
        aiSummariesEnabled()
          ? `<button class="btn" data-action="summary-menu" title="Summarize" aria-haspopup="menu">Summary</button>
      <span class="toolbar-divider" aria-hidden="true"></span>`
          : ""
      }
      <button class="icon-btn ${thread.starred ? "starred" : ""}" data-action="star-thread" aria-label="${
        thread.starred ? "Unstar" : "Star"
      }" title="${thread.starred ? "Unstar" : "Star"}">${icon("star", 17)}</button>
      <button class="icon-btn" data-action="mark-unread" aria-label="${
        thread.unread ? "Mark read" : "Mark unread"
      }" title="${thread.unread ? "Mark read" : "Mark unread"}">${icon("mail", 17)}</button>
      ${
        isTrash
          ? `<button class="icon-btn" data-action="thread-inbox" aria-label="Move to inbox" title="Move to inbox">${icon(
              "inbox",
              17
            )}</button>`
          : isSpam
          ? `<button class="icon-btn" data-action="thread-inbox" aria-label="Not spam" title="Not spam">${icon(
              "inbox",
              17
            )}</button>
             <button class="icon-btn" data-action="trash-thread" aria-label="Move to trash" title="Move to trash">${icon(
               "trash",
               17
             )}</button>`
          : `<button class="icon-btn" data-action="archive-thread" aria-label="Archive" title="Archive">${icon(
              "archive",
              17
            )}</button>
             <button class="icon-btn" data-action="trash-thread" aria-label="Move to trash" title="Move to trash">${icon(
               "trash",
               17
             )}</button>`
      }
      <button class="icon-btn" data-action="thread-menu" aria-label="More actions" title="More actions" aria-haspopup="menu">${icon(
        "more",
        17
      )}</button>
      <button class="icon-btn" data-action="toggle-focus" aria-label="${
        state.focusEmail ? "Exit full screen" : "Full screen"
      }" title="${state.focusEmail ? "Exit full screen" : "Full screen"}">${icon(
        state.focusEmail ? "minimize" : "maximize",
        16
      )}</button>
    </div>
  </div>`;
}

function recipientSummary(message, account) {
  const me = (account && account.email ? account.email : "")
    .trim()
    .toLowerCase();
  const label = (person) => {
    const email = (person.email || "").trim().toLowerCase();
    if (email && email === me) return "me";
    return decodeEntities(person.name || person.email || "").trim();
  };
  const toNames = (message.to || []).map(label).filter(Boolean);
  const ccNames = (message.cc || []).map(label).filter(Boolean);
  let summary = toNames.length
    ? `to ${toNames.join(", ")}`
    : "to undisclosed recipients";
  if (ccNames.length) {
    summary += ` / CC: ${ccNames.join(", ")}`;
  }
  return summary;
}

function recipientsHtml(message, account) {
  const people = (list) =>
    (list || [])
      .map(
        (person) =>
          `${esc(decodeEntities(person.name || ""))}${person.name ? " " : ""}&lt;${esc(
            person.email
          )}&gt;`
      )
      .join(", ");
  const parts = [];
  if (message.to && message.to.length) parts.push(`To: ${people(message.to)}`);
  if (message.cc && message.cc.length) parts.push(`Cc: ${people(message.cc)}`);
  if (message.bcc && message.bcc.length) parts.push(`Bcc: ${people(message.bcc)}`);
  const summary = recipientSummary(message, account);
  return `<details class="recipients-details"><summary>${esc(
    summary
  )}</summary><div class="recipients-popover">${parts.join("<br>")}</div></details>`;
}

function messageHtml(message, expanded, account) {
  const sender = decodeEntities(message.from_name || message.from_email || "Unknown");
  const address = message.from_email || "";
  const date = formatDate(message.date, "full");
  const snippet = decodeEntities(message.snippet || "");
  const recipient = recipientsHtml(message, account);
  const attachments = (message.attachments || []).filter((item) => !item.inline);
  const attachmentHtml = attachments.length
    ? `<div class="attachments">${attachments
        .map((item, index) => {
          const originalIndex = (message.attachments || []).indexOf(item);
          const filename = decodeEntities(item.filename || "attachment");
          const url = attachmentUrl(message, originalIndex);
          return `<span class="attachment" title="${esc(filename)}">
            ${icon("paperclip", 13)}
            <span class="attachment-name">${esc(filename)}</span>
            <span class="attachment-size">${formatBytes(item.size)}</span>
            <button type="button" class="attachment-action" data-action="open-attachment" data-attachment-url="${esc(
              url
            )}" data-attachment-name="${esc(
              filename
            )}" aria-label="View ${esc(filename)}" title="View">${icon(
              "eye",
              12
            )}</button>
            <button type="button" class="attachment-action" data-action="download-attachment" data-attachment-url="${esc(
              url
            )}" data-attachment-name="${esc(
              filename
            )}" aria-label="Download ${esc(
              filename
            )}" title="Download">${icon("download", 12)}</button>
          </span>`;
        })
        .join("")}</div>`
    : "";

  if (!expanded) {
    return `<article class="message collapsed-message" data-action="expand-message" data-message-id="${esc(
      message.id
    )}" role="button" tabindex="0" aria-label="Expand message from ${esc(sender)}">
      <div class="message-header">
        ${avatarHtml(account, sender)}
        <div class="message-head-main">
          <div class="message-sender-line">
            <span class="message-sender">${esc(sender)}</span>
            <span class="message-address">${esc(address)}</span>
            <span class="message-date" style="margin-left:auto">${esc(date)}</span>
          </div>
          <div class="collapsed-snippet">${esc(snippet)}</div>
        </div>
        <span class="message-expand">${icon("chevronDown", 14)}</span>
      </div>
    </article>`;
  }

  return `<article class="message" data-message-id="${esc(message.id)}">
    <div class="message-header">
      ${avatarHtml(account, sender)}
      <div class="message-head-main">
        <div class="message-sender-line">
          <span class="message-sender">${esc(sender)}</span>
          <span class="message-address">${esc(address)}</span>
          <span class="message-date" style="margin-left:auto">${esc(date)}</span>
        </div>
        <div class="message-recipients">${recipient}</div>
      </div>
      <div class="message-tools">
        <button class="icon-btn" data-action="collapse-message" data-message-id="${esc(
          message.id
        )}" aria-label="Collapse message" title="Collapse message">${icon("chevronDown", 15)}</button>
      </div>
    </div>
    <div class="message-body-host" data-body-message-id="${esc(message.id)}"></div>
    ${attachmentHtml}
    <div class="message-actions-row">
      <button type="button" class="message-action" data-action="reply-all" data-message-id="${esc(
        message.id
      )}">${icon("replyAll", 13)}<span>Reply all</span></button>
      <button type="button" class="message-action" data-action="reply" data-message-id="${esc(
        message.id
      )}">${icon("reply", 13)}<span>Reply</span></button>
      <button type="button" class="message-action" data-action="forward" data-message-id="${esc(
        message.id
      )}">${icon("forward", 13)}<span>Forward</span></button>
    </div>
  </article>`;
}

function summaryOfferHtml(thread, messages) {
  if (!aiSummariesEnabled()) return "";
  if (!thread || !messages || messages.length < 5) return "";
  const key = threadKey(thread.account_id, thread.id);
  if (state.summary && state.summary.threadKey === key) return "";
  if (state.summaryOffersDismissed.has(key)) return "";
  const count = messages.length;
  return `<div class="summary-offer">
    <span class="summary-offer-text">This thread has ${count} messages.</span>
    <button type="button" class="link-btn" data-action="summary-offer">Summarize</button>
    <button type="button" class="icon-btn summary-offer-dismiss" data-action="summary-offer-dismiss" aria-label="Dismiss summary offer" title="Dismiss">${icon(
      "x",
      13
    )}</button>
  </div>`;
}

function summaryPanelHtml() {
  if (!aiSummariesEnabled()) return "";
  const summary = state.summary;
  if (!summary) return "";
  const thread = currentThread();
  if (!thread || summary.threadKey !== threadKey(thread.account_id, thread.id)) return "";
  const errorClass = summary.error && !summary.text ? "error" : "";
  const text =
    summary.error && summary.text
      ? `${summary.text}\n\n${summary.error}`
      : summary.error || summary.text || "";
  return `<div class="summary-panel" id="summary-panel">
    <div class="summary-head">
      <span class="summary-title">Summary</span>
      <span class="summary-loading" id="summary-spinner" ${summary.loading ? "" : "hidden"}>
        <span class="spinner"></span><span>Summarizing</span>
      </span>
      <button class="icon-btn" data-action="summary-close" aria-label="Close summary" title="Close summary">${icon(
        "x",
        15
      )}</button>
    </div>
    <div class="summary-body ${errorClass}" id="summary-body">${esc(text)}</div>
    <div class="summary-actions" id="summary-actions">
      ${
        summary.loading
          ? `<button class="link-btn" data-action="summary-stop">Stop</button>`
          : `<button class="link-btn" data-action="summary-regenerate">Regenerate</button>`
      }
    </div>
  </div>`;
}

function emptyReaderHtml() {
  return `<div class="reader-empty"><div class="reader-empty-icon">${icon(
    "mail",
    30
  )}</div><p>Select a message</p></div>`;
}

function threadHeadHtml(thread, messageCount) {
  const account = accountFor(thread.account_id);
  const count = Number(messageCount) || 0;
  const meta =
    count > 1
      ? `<span class="thread-count">${esc(`${count} messages`)}</span>`
      : "";
  return `<div class="thread-head">
    <h1 class="thread-subject">${esc(
      decodeEntities(thread.subject || "(No subject)")
    )}</h1>
    <div class="thread-meta">
      ${accountBadge(account)}
      ${meta}
    </div>
  </div>`;
}

function updateThreadHead(thread, messageCount) {
  const reader = $("#reader");
  const subject = $(".thread-subject", reader);
  if (subject) {
    const next = decodeEntities(thread.subject || "(No subject)");
    if (subject.textContent !== next) subject.textContent = next;
  }
  const meta = $(".thread-meta", reader);
  if (!meta) return;
  const badge = accountBadge(accountFor(thread.account_id));
  if (badge && !$(".account-badge", meta)) {
    meta.insertAdjacentHTML("afterbegin", badge);
  }
  const count = Number(messageCount) || 0;
  const label = count > 1 ? `${count} messages` : "";
  let counter = $(".thread-count", meta);
  if (label) {
    if (!counter) {
      counter = document.createElement("span");
      counter.className = "thread-count";
      meta.appendChild(counter);
    }
    if (counter.textContent !== label) counter.textContent = label;
  } else if (counter) {
    counter.remove();
  }
}

function updateThreadToolbarState(thread) {
  const reader = $("#reader");
  const unread = $(
    ".reader-toolbar [data-action='mark-unread']",
    reader
  );
  if (unread) {
    const label = thread.unread ? "Mark read" : "Mark unread";
    unread.setAttribute("aria-label", label);
    unread.title = label;
  }
  const star = $(".reader-toolbar [data-action='star-thread']", reader);
  if (star) {
    const label = thread.starred ? "Unstar" : "Star";
    star.classList.toggle("starred", Boolean(thread.starred));
    star.setAttribute("aria-label", label);
    star.title = label;
  }
}

function threadBodyHtml(thread, messages, account, settling) {
  const messagesHtml = messages
    .map((message) =>
      messageHtml(message, state.expanded.has(message.id), account)
    )
    .join("");
  const draftOnly =
    !messages.length && (thread.labels || []).includes("DRAFT")
      ? `<div class="thread-draft-note">This thread contains only a draft.</div>`
      : "";
  return `${
    settling
      ? `<div class="thread-loading" id="reader-settling"><span class="spinner"></span><span>Loading thread</span></div>`
      : ""
  }<div class="thread-body">
    <div class="messages">${draftOnly}${messagesHtml}</div>
    <div id="summary-slot">${summaryPanelHtml()}</div>
    ${summaryOfferHtml(thread, messages)}
  </div>`;
}

function mountThreadContent(thread, messages, account, options = {}) {
  const reader = $("#reader");
  const content = $(".thread-content", reader);
  const inner = $(".reader-inner", reader);
  if (!content || !inner) return;
  const expandedCount = messages.filter((message) =>
    state.expanded.has(message.id)
  ).length;
  const settling = Boolean(options.settle && expandedCount);
  inner.classList.toggle("is-settling", settling);
  content.innerHTML = threadBodyHtml(thread, messages, account, settling);
  const settleTick = settling
    ? beginReaderSettle(state.selectedKey, expandedCount)
    : null;
  for (const host of $$("[data-body-message-id]", content)) {
    const message = messages.find(
      (item) => item.id === host.dataset.bodyMessageId
    );
    if (!message) continue;
    renderEmailBody(host, message, {
      token: state.token,
      hideSignatures: state.prefs.hideSignatures,
      hideQuotes: state.prefs.hideQuotes,
      blockImages: state.prefs.blockImages,
      contentTheme: state.prefs.emailTheme,
      onImageClick: (images, index) => openLightbox(images, index),
      onSettled: settleTick ? () => settleTick() : undefined,
      onEmailContext: (emails, x, y) =>
        openEmailAddressMenu(emails, x, y),
    });
  }
  reader.scrollTop = options.scrollTop || 0;
  syncSummaryOverflow();
  updateReaderPane();
  if (options.settle && !settleTick) {
    settleReaderAtLastMessage(state.selectedKey);
  }
}

function renderReader(options = {}) {
  const reader = $("#reader");
  clearReaderSettling();
  const previousScroll =
    options.resetScroll || options.settle ? 0 : reader.scrollTop;
  if (!state.selected) {
    state.readerChromeKey = "";
    reader.innerHTML = emptyReaderHtml();
    updateReaderPane();
    return;
  }
  if (state.readerLoading) {
    const thread = state.selected.thread;
    if (thread) {
      state.readerChromeKey = state.selectedKey;
      reader.innerHTML = `${toolbarHtml(thread)}
        <div class="reader-inner">
          ${threadHeadHtml(thread, thread.message_count || 0)}
          <div class="thread-content">
            <div class="thread-loading"><span class="spinner"></span><span>Loading thread</span></div>
          </div>
        </div>`;
    } else {
      state.readerChromeKey = "";
      reader.innerHTML = `<div class="reader-loading"><span class="spinner"></span><span>Loading thread</span></div>`;
    }
    updateReaderPane();
    return;
  }
  if (state.readerError) {
    state.readerChromeKey = "";
    reader.innerHTML = `${toolbarHtml(state.selected.thread || null)}
      <div class="reader-inner"><div class="reader-error">${esc(
        state.readerError
      )} <button class="link-btn" data-action="retry-reader">Retry</button></div></div>`;
    updateReaderPane();
    return;
  }
  const thread = state.selected.thread;
  const messages = state.selected.messages || [];
  const account = accountFor(thread.account_id);
  const preserve =
    options.preserveChrome &&
    state.readerChromeKey === state.selectedKey &&
    $(".reader-inner", reader) &&
    $(".thread-content", reader);
  if (preserve) {
    updateThreadHead(thread, messages.length);
    updateThreadToolbarState(thread);
    mountThreadContent(thread, messages, account, {
      settle: options.settle,
      scrollTop: previousScroll,
    });
    return;
  }
  reader.innerHTML = `${toolbarHtml(thread)}
    <div class="reader-inner">
      ${threadHeadHtml(thread, messages.length)}
      <div class="thread-content"></div>
    </div>`;
  state.readerChromeKey = state.selectedKey;
  mountThreadContent(thread, messages, account, {
    settle: options.settle,
    scrollTop: previousScroll,
  });
}

function toggleMessageExpanded(messageId) {
  if (!messageId) return;
  if (state.expanded.has(messageId)) state.expanded.delete(messageId);
  else state.expanded.add(messageId);
  renderReader();
}

function updateReaderPane() {
  const pane = $("#reader-pane");
  const composer = state.composer;
  const hasThread = Boolean(state.selected && state.selected.thread);
  const panelOpen = Boolean(composer && composer.mode === "panel" && hasThread);
  pane.classList.toggle("composer-tray", Boolean(composer && composer.mode === "tray" && hasThread));
  pane.classList.toggle("composer-panel", panelOpen);
  pane.classList.toggle(
    "compose-only",
    Boolean(composer && composer.kind === "new")
  );
  if (composer && composer.mode === "tray" && state.prefs.trayHeight) {
    pane.style.setProperty("--tray-height", `${state.prefs.trayHeight}px`);
  } else {
    pane.style.removeProperty("--tray-height");
  }
  const app = $("#app");
  app.classList.toggle("has-thread", hasThread);
  app.classList.toggle("composer-panel-open", panelOpen);
  app.classList.toggle("settings-open", state.settingsOpen);
  app.classList.toggle("email-focus", state.focusEmail);
  app.classList.toggle("layout-reading", state.prefs.layout === "reading");
  app.classList.toggle("sidebar-collapsed", Boolean(state.prefs.sidebarCollapsed));
}

function updateReaderToolbar() {
  const thread = currentThread();
  const toolbar = $(".reader-toolbar", $("#reader"));
  if (!thread || !toolbar) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = toolbarHtml(thread).trim();
  toolbar.replaceWith(wrapper.firstElementChild);
}

/* -------------------------------------------------------------------------- */
/* Rendering: summary                                                         */
/* -------------------------------------------------------------------------- */

function isSummaryForCurrentThread() {
  const summary = state.summary;
  const thread = currentThread();
  if (!summary || !thread) return false;
  return summary.threadKey === threadKey(thread.account_id, thread.id);
}

function syncSummaryOverflow() {
  for (const body of $$(".summary-body, .summary-popover-body")) {
    body.classList.toggle(
      "scrollable",
      body.scrollHeight > body.clientHeight + 1
    );
  }
}

function updateSummaryPanel() {
  const slot = $("#summary-slot");
  if (!slot) return;
  if (!isSummaryForCurrentThread()) {
    slot.innerHTML = "";
    return;
  }
  const summary = state.summary;
  const text = summary.error && !summary.text ? summary.error : summary.text;
  let panel = $("#summary-panel");
  if (!panel) {
    slot.innerHTML = summaryPanelHtml();
    panel = $("#summary-panel");
  }
  if (!panel) return;
  const body = $("#summary-body", panel);
  if (body) {
    body.textContent = text;
    body.classList.toggle("error", Boolean(summary.error) && !summary.text);
    if (summary.error && summary.text) {
      body.textContent = `${summary.text}\n\n${summary.error}`;
    }
  }
  const spinner = $("#summary-spinner", panel);
  if (spinner) spinner.hidden = !summary.loading;
  const actions = $("#summary-actions", panel);
  if (actions) {
    actions.innerHTML = summary.loading
      ? `<button class="link-btn" data-action="summary-stop">Stop</button>`
      : `<button class="link-btn" data-action="summary-regenerate">Regenerate</button>`;
  }
  syncSummaryOverflow();
}

async function streamSummaryRequest(payload, signal, onEvent) {
  const response = await fetch("/api/ai/summarize", {
    method: "POST",
    headers: {
      [TOKEN_HEADER]: state.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    let message = `Summarize failed (${response.status})`;
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch (error) {
      /* Ignore. */
    }
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split(/\r?\n/).find((item) => item.startsWith("data:"));
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch (error) {
        continue;
      }
      onEvent(event);
    }
  }
}

function cleanSummaryText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const cleaned = text
    .replace(
      /\s*(?:(?:there\s+is|there's)\s+)?(?:no\s+(?:further\s+)?action\s+(?:is\s+)?(?:needed|required)(?:\s+from\s+you|\s+from\s+your\s+side)?|nothing\s+(?:is\s+)?(?:needed|required)(?:\s+from\s+you)?|you\s+(?:do\s+not|don't)\s+need\s+to\s+do\s+anything(?:\s+else)?)(?:\s+at\s+this\s+time)?[.!]?\s*$/i,
      ""
    )
    .trim();
  return cleaned || text;
}

function summaryCacheKey(thread, scope, messageId = "") {
  return `${threadKey(thread.account_id, thread.id)}|${scope}|${messageId || ""}`;
}

function pruneSummaryCache() {
  const now = Date.now();
  state.summaryCache = state.summaryCache
    .filter((entry) => now - (entry.usedAt || entry.savedAt || 0) < SUMMARY_CACHE_TTL)
    .slice(0, SUMMARY_CACHE_LIMIT);
}

function cachedSummary(thread, scope = null, messageId = "") {
  pruneSummaryCache();
  const key = threadKey(thread.account_id, thread.id);
  const entry = scope
    ? state.summaryCache.find(
        (item) => item.key === summaryCacheKey(thread, scope, messageId)
      )
    : state.summaryCache.find((item) => item.threadKey === key);
  if (!entry) return null;
  entry.usedAt = Date.now();
  return { ...entry, loading: false, controller: null };
}

function rememberSummary(summary) {
  if (!summary || !summary.text) return;
  pruneSummaryCache();
  const key =
    summary.cacheKey ||
    summaryCacheKey(
      { account_id: summary.account, id: summary.id },
      summary.scope,
      summary.messageId
    );
  const entry = {
    key,
    account: summary.account,
    id: summary.id,
    threadKey: summary.threadKey,
    scope: summary.scope,
    messageId: summary.messageId || "",
    text: cleanSummaryText(summary.text),
    error: summary.error || "",
    loading: false,
    savedAt: Date.now(),
    usedAt: Date.now(),
  };
  state.summaryCache = [
    entry,
    ...state.summaryCache.filter((item) => item.key !== key),
  ].slice(0, SUMMARY_CACHE_LIMIT);
}

async function startSummary(scope, messageId = "", options = {}) {
  if (!aiSummariesEnabled()) {
    openSettings("ai");
    return;
  }
  const thread = currentThread();
  if (!thread) return;
  closeMenu();
  if (!options.force) {
    const cached = cachedSummary(thread, scope, messageId);
    if (cached) {
      if (state.summary && state.summary.controller) {
        try {
          state.summary.controller.abort();
        } catch (error) {
          /* Ignore. */
        }
      }
      state.summary = cached;
      const offer = $(".summary-offer");
      if (offer) offer.remove();
      updateSummaryPanel();
      setTimeout(revealSummaryPanel, 0);
      return;
    }
  }
  if (!state.settings.ai_configured) {
    openSettings("ai");
    return;
  }
  if (state.summary && state.summary.controller) {
    try {
      state.summary.controller.abort();
    } catch (error) {
      /* Ignore. */
    }
  }
  const controller = new AbortController();
  const request = {
    account: thread.account_id,
    id: thread.id,
    threadKey: threadKey(thread.account_id, thread.id),
    cacheKey: summaryCacheKey(thread, scope, messageId),
    scope,
    messageId,
    text: "",
    error: "",
    loading: true,
    controller,
  };
  state.summary = request;
  const offer = $(".summary-offer");
  if (offer) offer.remove();
  updateSummaryPanel();
  setTimeout(revealSummaryPanel, 0);
  try {
    await streamSummaryRequest(
      {
        account: thread.account_id,
        id: thread.id,
        scope,
        message_id: messageId,
      },
      controller.signal,
      (event) => {
        if (state.summary !== request) return;
        if (event.delta) {
          request.text += event.delta;
          updateSummaryPanel();
        } else if (event.error) {
          request.error = event.error;
        }
      }
    );
    if (state.summary === request) {
      request.loading = false;
      if (!request.text && !request.error) {
        request.error = "The provider returned an empty summary.";
      }
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    if (state.summary === request) {
      request.error = error.message || "Could not summarize this message.";
    }
  } finally {
    if (state.summary === request) {
      request.loading = false;
      request.text = cleanSummaryText(request.text);
      if (request.text) rememberSummary(request);
      updateSummaryPanel();
    }
  }
}

function closeSummary(options = {}) {
  const summary = state.summary;
  if (summary && summary.controller) {
    try {
      summary.controller.abort();
    } catch (error) {
      /* Ignore. */
    }
  }
  if (options.discard && summary && summary.cacheKey) {
    state.summaryCache = state.summaryCache.filter(
      (entry) => entry.key !== summary.cacheKey
    );
  }
  state.summary = null;
  const slot = $("#summary-slot");
  if (slot) slot.innerHTML = "";
}

function positionSummaryPopover(point) {
  const root = $("#summary-popover");
  if (!root) return;
  root.hidden = false;
  if (
    state.contextSummary &&
    state.contextSummary.dragged &&
    state.contextSummary.position
  ) {
    root.style.left = `${state.contextSummary.position.left}px`;
    root.style.top = `${state.contextSummary.position.top}px`;
    return;
  }
  const rect = root.getBoundingClientRect();
  const x = point && Number.isFinite(point.x) ? point.x : window.innerWidth - rect.width - 24;
  const y = point && Number.isFinite(point.y) ? point.y : 90;
  const left = Math.max(8, Math.min(x + 10, window.innerWidth - rect.width - 8));
  let top = y + 10;
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, y - rect.height - 10);
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - rect.height - 8);
  }
  root.style.left = `${left}px`;
  root.style.top = `${Math.max(8, top)}px`;
  if (state.contextSummary) {
    state.contextSummary.position = {
      left,
      top: Math.max(8, top),
    };
  }
}

function renderContextSummary() {
  const root = $("#summary-popover");
  if (!root) return;
  const summary = state.contextSummary;
  if (!summary) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const body = $(".summary-popover-body", root);
  const actions = $(".summary-popover-actions", root);
  const text = summary.error && !summary.text ? summary.error : summary.text;
  body.textContent = summary.error && summary.text ? `${summary.text}\n\n${summary.error}` : text;
  body.classList.toggle("error", Boolean(summary.error) && !summary.text);
  actions.innerHTML = summary.loading
    ? `<span class="summary-loading"><span class="spinner"></span><span>Summarizing</span></span>
       <button type="button" class="link-btn" data-action="context-summary-stop">Stop</button>`
    : `<button type="button" class="link-btn" data-action="context-summary-regenerate">Regenerate</button>`;
  syncSummaryOverflow();
  positionSummaryPopover(state.contextPoint);
}

async function openContextSummary(thread, scope) {
  if (!aiSummariesEnabled()) {
    openSettings("ai");
    return;
  }
  if (!thread) return;
  const previousPosition =
    state.contextSummary && state.contextSummary.dragged
      ? state.contextSummary.position
      : null;
  closeContextSummary();
  closeMenu();
  if (!state.settings.ai_configured) {
    openSettings("ai");
    return;
  }
  const controller = new AbortController();
  state.contextSummary = {
    account: thread.account_id,
    id: thread.id,
    position: previousPosition || null,
    dragged: Boolean(previousPosition),
    threadKey: threadKey(thread.account_id, thread.id),
    scope,
    text: "",
    error: "",
    loading: true,
    controller,
  };
  const root = $("#summary-popover");
  if (!root) return;
  root.hidden = false;
  renderContextSummary();
  const close = $("[data-action=\"context-summary-close\"]", root);
  if (close) setTimeout(() => close.focus({ preventScroll: true }), 20);
  try {
    await streamSummaryRequest(
      {
        account: thread.account_id,
        id: thread.id,
        scope,
      },
      controller.signal,
      (event) => {
        if (!state.contextSummary) return;
        if (event.delta) {
          state.contextSummary.text += event.delta;
          renderContextSummary();
        } else if (event.error) {
          state.contextSummary.error = event.error;
          renderContextSummary();
        }
      }
    );
    if (state.contextSummary) {
      state.contextSummary.loading = false;
      if (!state.contextSummary.text && !state.contextSummary.error) {
        state.contextSummary.error = "The provider returned an empty summary.";
      }
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    if (state.contextSummary) {
      state.contextSummary.error = error.message || "Could not summarize this thread.";
    }
  } finally {
    if (state.contextSummary) {
      state.contextSummary.loading = false;
      state.contextSummary.text = cleanSummaryText(state.contextSummary.text);
      renderContextSummary();
    }
  }
}

function closeContextSummary() {
  if (state.contextSummary && state.contextSummary.controller) {
    try {
      state.contextSummary.controller.abort();
    } catch (error) {
      /* Ignore. */
    }
  }
  state.contextSummary = null;
  const root = $("#summary-popover");
  if (root) {
    root.hidden = true;
    $(".summary-popover-body", root).textContent = "";
    $(".summary-popover-actions", root).innerHTML = "";
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering: composer                                                       */
/* -------------------------------------------------------------------------- */

function draftHasContent(draft) {
  if (!draft) return false;
  const html = String(draft.html || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return Boolean(
    draft.to ||
      draft.cc ||
      draft.bcc ||
      draft.subject ||
      html ||
      /<img\b/i.test(draft.html || "") ||
      (draft.attachments || []).length
  );
}

function legacyDraftKey(kind, threadId) {
  return `courier.draft:${kind}:${threadId || "new"}`;
}

function readLegacyDraft(kind, threadId) {
  try {
    const draft = JSON.parse(
      localStorage.getItem(legacyDraftKey(kind, threadId)) || "null"
    );
    return draft && typeof draft === "object" ? draft : null;
  } catch (error) {
    return null;
  }
}

function clearLegacyDraft(composer) {
  if (!composer) return;
  const threadIds = new Set(["new"]);
  if (composer.threadId) threadIds.add(composer.threadId);
  if (composer.draftThreadId) threadIds.add(composer.draftThreadId);
  try {
    for (const threadId of threadIds) {
      for (const kind of ["new", "reply", "reply-all", "forward"]) {
        localStorage.removeItem(legacyDraftKey(kind, threadId));
      }
    }
  } catch (error) {
    /* Ignore storage errors. */
  }
}

function draftSignature(draft) {
  if (!draft) return "";
  return JSON.stringify([
    draft.to || "",
    draft.cc || "",
    draft.bcc || "",
    draft.subject || "",
    draft.html || "",
    draft.text || "",
    (draft.attachments || []).map((item) => [
      item.filename || "",
      item.size || 0,
      item.content_id || "",
    ]),
    draft.in_reply_to || "",
    draft.references || "",
  ]);
}

function accountSignatureHtml(accountId) {
  const account = accountFor(accountId);
  if (!account || !account.signature_enabled) return "";
  return String(state.signatures[accountId] || "").trim();
}

function signatureStartBlockHtml() {
  return '<div data-composer-body-start="1"><br></div>';
}

function signatureBlockHtml(accountId, htmlOverride = null) {
  const html =
    htmlOverride === null
      ? accountSignatureHtml(accountId)
      : String(htmlOverride || "").trim();
  if (!html) return "";
  return `<div class="composer-signature" data-courier-signature="${esc(
    accountId
  )}">${html}</div>`;
}

function composerSignatureHtml(composer, accountId) {
  const account = accountFor(accountId);
  if (!account || !account.signature_enabled) return "";
  const overrides = composer?.signatureOverrides || {};
  if (Object.prototype.hasOwnProperty.call(overrides, accountId)) {
    return overrides[accountId];
  }
  return accountSignatureHtml(accountId);
}

function composerSignatureBlockHtml(composer, accountId) {
  return signatureBlockHtml(
    accountId,
    composerSignatureHtml(composer, accountId)
  );
}

function stripComposerSignatureHtml(html) {
  const host = document.createElement("div");
  host.innerHTML = String(html || "");
  for (const node of host.querySelectorAll("[data-courier-signature]")) {
    node.remove();
  }
  return host.innerHTML;
}

function emptySignatureStartBlock(node) {
  return (
    !node.textContent.trim() &&
    !node.querySelector("img, table, hr, video, svg, canvas, iframe, object, embed, picture")
  );
}

function addComposerSignature(html, accountId) {
  const clean = stripComposerSignatureHtml(html);
  const block = signatureBlockHtml(accountId);
  const host = document.createElement("div");
  host.innerHTML = clean;
  if (!block) {
    for (const start of host.querySelectorAll(
      "[data-composer-body-start]"
    )) {
      if (emptySignatureStartBlock(start)) start.remove();
    }
    return host.innerHTML;
  }
  const hasStart = Boolean(
    host.querySelector("[data-composer-body-start]")
  );
  return `${clean}${
    hasStart ? "" : signatureStartBlockHtml()
  }${block}`;
}

function ensureComposerSignature(html, accountId) {
  const block = signatureBlockHtml(accountId);
  const host = document.createElement("div");
  host.innerHTML = String(html || "");
  if (!block) return addComposerSignature(host.innerHTML, accountId);
  const signatures = Array.from(
    host.querySelectorAll("[data-courier-signature]")
  );
  const existing = signatures.find(
    (node) => node.dataset.courierSignature === accountId
  );
  if (existing) {
    for (const node of signatures) {
      if (node !== existing) node.remove();
    }
    if (!host.querySelector("[data-composer-body-start]")) {
      const start = document.createElement("div");
      start.setAttribute("data-composer-body-start", "1");
      start.innerHTML = "<br>";
      existing.parentNode.insertBefore(start, existing);
    }
    return host.innerHTML;
  }
  return addComposerSignature(host.innerHTML, accountId);
}

function composerHasUserContent(editor) {
  if (!editor) return false;
  const clone = editor.cloneNode(true);
  for (const node of clone.querySelectorAll("[data-courier-signature]")) {
    node.remove();
  }
  for (const node of clone.querySelectorAll(
    "[data-composer-body-start]"
  )) {
    for (const br of node.querySelectorAll("br")) br.remove();
  }
  return (
    clone.textContent.trim().length > 0 ||
    Boolean(
      clone.querySelector(
        "img, table, hr, video, svg, canvas, iframe, object, embed, picture"
      )
    )
  );
}

function composerDraftSignatureFromForm(composer) {
  const form = $("#composer .composer-form");
  const editor = $(".composer-editor", form);
  if (!composer || !form || !editor) return "";
  adoptDataImages(editor, composer);
  const outgoing = composerOutgoing(editor, composer);
  composer.html = editor.innerHTML;
  return draftSignature({
    to: $(".composer-to", form)?.value || "",
    cc: $(".composer-cc", form)?.value || "",
    bcc: $(".composer-bcc", form)?.value || "",
    subject:
      $(".composer-subject", form)?.value ?? composer.subject ?? "",
    html: outgoing.html,
    text: outgoing.text,
    attachments: outgoing.attachments,
    in_reply_to: composer.inReplyTo || "",
    references: composer.references || "",
  });
}

function primeComposerDraftBaseline(composer) {
  if (!composer) return;
  composer.initialSignature = composerDraftSignatureFromForm(composer);
  if (composer.draftReady) {
    composer.draftSignature = composer.initialSignature;
  }
  scheduleComposerSize(composer);
}

const COMPOSER_MIME_LIMIT = 34 * 1024 * 1024;
const SIGNATURE_BYTES_LIMIT = 6 * 1024 * 1024;

function formatComposerSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function estimateComposerMime(composer) {
  const form = $("#composer .composer-form");
  const editor = $(".composer-editor", form);
  if (!composer || !form || !editor) {
    return { bytes: 0, tooLarge: false };
  }
  adoptDataImages(editor, composer);
  const usedInline = new Set();
  let cidBytes = 0;
  for (const image of editor.querySelectorAll("img")) {
    const cid = image.dataset.courierCid || "";
    if (cid) {
      usedInline.add(cid);
      cidBytes += `cid:${cid}`.length;
    }
  }
  const attachmentBytes = (composer.attachments || []).reduce(
    (sum, item) => {
      if (item.inline && !usedInline.has(item.content_id)) return sum;
      return sum + Math.floor((String(item.data || "").length * 3) / 4);
    },
    0
  );
  const textBytes = editor.innerText.length;
  const markupBytes =
    editor.querySelectorAll("*").length * 80 + textBytes * 1.05;
  const headerBytes =
    String($(".composer-to", form)?.value || "").length +
    String($(".composer-cc", form)?.value || "").length +
    String($(".composer-bcc", form)?.value || "").length +
    String($(".composer-subject", form)?.value || composer.subject || "")
      .length +
    2048;
  const bytes =
    Math.floor(attachmentBytes * 1.33) +
    Math.floor(markupBytes) +
    cidBytes +
    headerBytes;
  return { bytes, tooLarge: bytes > COMPOSER_MIME_LIMIT };
}

function updateComposerSize(composer = state.composer) {
  if (!composer || composer !== state.composer) return;
  const form = $("#composer .composer-form");
  const editor = $(".composer-editor", form);
  const label = $(".composer-size", form);
  if (!form || !editor || !label) return;
  const estimate = estimateComposerMime(composer);
  composer.mimeEstimate = estimate.bytes;
  composer.tooLarge = estimate.tooLarge;
  const size = formatComposerSize(estimate.bytes);
  label.textContent = estimate.tooLarge
    ? `Too large · ${size}`
    : `~${size}`;
  label.classList.toggle("over", estimate.tooLarge);
  label.title = `Approximate encoded message size. Limit ${formatComposerSize(
    COMPOSER_MIME_LIMIT
  )}.`;
  const button = $(".send-btn", form);
  if (button && !composer.sending) {
    button.disabled = estimate.tooLarge;
    button.title = estimate.tooLarge
      ? "This message is too large to send. Remove attachments or inline images."
      : "";
  }
}

function scheduleComposerSize(composer = state.composer) {
  if (!composer) return;
  if (composer.sizeTimer) clearTimeout(composer.sizeTimer);
  composer.sizeTimer = setTimeout(() => {
    composer.sizeTimer = null;
    updateComposerSize(composer);
  }, 350);
}

function adoptDataImages(editor, composer) {
  for (const image of editor.querySelectorAll("img[src^='data:image/']")) {
    if (image.dataset.courierCid) continue;
    const src = image.getAttribute("src") || "";
    const mime = src.slice(5).split(";")[0] || "image/png";
    registerPastedImage(image, src, mime, composer);
  }
}

function saveComposerDraft(composer) {
  if (!composer || composer.sending || composer.sent) return;
  if (composer.draftPromise) {
    composer.draftQueued = true;
    return;
  }
  const form = $("#composer .composer-form");
  const editor = $(".composer-editor", form);
  if (!form || !editor) return;
  if (estimateComposerMime(composer).tooLarge) {
    composer.draftError = true;
    return;
  }
  const seq = (composer.draftSeq || 0) + 1;
  composer.draftSeq = seq;
  const to = $(".composer-to", form)?.value || "";
  const cc = $(".composer-cc", form)?.value || "";
  const bcc = $(".composer-bcc", form)?.value || "";
  const subject =
    $(".composer-subject", form)?.value ?? composer.subject ?? "";
  adoptDataImages(editor, composer);
  const outgoing = composerOutgoing(editor, composer);
  const draft = {
    to,
    cc,
    bcc,
    subject,
    html: outgoing.html,
    text: outgoing.text,
    attachments: outgoing.attachments,
    in_reply_to: composer.inReplyTo || "",
    references: composer.references || "",
    updatedAt: Date.now(),
  };
  if (!draftHasContent(draft)) {
    deleteComposerDraft(composer);
    composer.draftSignature = "";
    return;
  }
  const signature = draftSignature(draft);
  if (signature === composer.draftSignature) return;
  if (signature === composer.initialSignature) {
    if (composer.createdDraft && composer.draftId) {
      deleteComposerDraft(composer);
    }
    return;
  }
  let draftXhr = null;
  const request = apiXhr("/api/draft", {
    method: "POST",
    body: {
      account: composer.accountId,
      draft_id: composer.draftId || "",
      thread_id: composer.threadId || composer.draftThreadId || "",
      kind: composer.kind,
      payload: draft,
    },
    timeout: 300000,
    onStart: (xhr) => {
      draftXhr = xhr;
      composer.draftXhr = xhr;
    },
  })
    .then((data) => {
      if (seq !== composer.draftSeq) return;
      const first = !composer.draftId;
      if (first) composer.createdDraft = true;
      composer.draftError = false;
      composer.draftSignature = signature;
      composer.draftId = data.draft_id || composer.draftId || "";
      composer.draftThreadId =
        data.thread_id || composer.draftThreadId || "";
      composer.draftReady = true;
      clearLegacyDraft(composer);
      if (first && !composer.sending) refreshState({ quiet: true });
    })
    .catch((error) => {
      if (seq !== composer.draftSeq) return;
      if (error.aborted && composer.draftCancelled) {
        composer.draftCancelled = false;
        return;
      }
      if (composer.sending) return;
      if (!composer.draftError) {
        composer.draftError = true;
        toast("Draft could not be saved to Gmail", true, 5000);
      }
    });
  composer.draftPromise = request;
  request.finally(() => {
    if (composer.draftXhr === draftXhr) composer.draftXhr = null;
    if (composer.draftPromise === request) composer.draftPromise = null;
    if (composer.draftQueued) {
      composer.draftQueued = false;
      window.setTimeout(() => saveComposerDraft(composer), 0);
    }
  });
  return request;
}

function deleteComposerDraft(composer) {
  if (!composer) return;
  const draftId = composer.draftId || "";
  const threadId =
    composer.threadId || composer.draftThreadId || "";
  composer.draftId = "";
  composer.draftThreadId = "";
  clearLegacyDraft(composer);
  if (!draftId && !threadId) return Promise.resolve();
  return api("/api/draft/delete", {
    method: "POST",
    body: {
      account: composer.accountId,
      draft_id: draftId,
      thread: threadId,
      kind: composer.kind,
    },
    timeout: 60000,
  }).catch(() => {
    toast("Draft could not be deleted", true);
  });
}

function applyServerDrafts(_threadId, drafts) {
  state.threadDrafts = {};
  for (const draft of drafts || []) {
    if (!draft.kind || !draft.payload) continue;
    state.threadDrafts[draft.kind] = draft.payload;
  }
}

function restoreThreadDraft(thread, gmailDraft = null) {
  if (!thread || state.composer) return;
  if (gmailDraft && gmailDraft.payload) {
    const draft = gmailDraft.payload;
    const otherMessages = (state.selected?.messages || []).filter(
      (message) => !(message.labels || []).includes("DRAFT")
    );
    const kind = otherMessages.length
      ? draft.cc
        ? "reply-all"
        : "reply"
      : "new";
    openComposer(kind, {
      draft,
      accountId: thread.account_id,
      draftId: gmailDraft.id || "",
      draftThreadId: gmailDraft.thread_id || "",
    });
    if (state.composer) {
      state.composer.minimized = kind !== "new";
      state.composer.draftReady = true;
      renderComposer();
      primeComposerDraftBaseline(state.composer);
    }
    return;
  }
  for (const kind of ["reply", "reply-all", "forward"]) {
    const draft =
      state.threadDrafts[kind] || readLegacyDraft(kind, thread.id);
    if (!draftHasContent(draft)) continue;
    openComposer(kind, { draft });
    if (state.composer) {
      state.composer.minimized = true;
      state.composer.draftReady = true;
      renderComposer();
      primeComposerDraftBaseline(state.composer);
    }
    return;
  }
}

function scheduleDraftSave() {
  if (state.draftTimer) clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(
    () => saveComposerDraft(state.composer),
    1400
  );
}

function formatRecipient(name, email) {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) return "";
  let cleanName = decodeEntities(String(name || "")).trim();
  const local = cleanEmail.split("@")[0] || "";
  const compact = (value) =>
    String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    !cleanName ||
    cleanName.toLowerCase() === cleanEmail.toLowerCase() ||
    (!cleanName.includes(" ") && compact(cleanName) === compact(local))
  ) {
    return cleanEmail;
  }
  if (/[",;<>@]/.test(cleanName)) {
    cleanName = `"${cleanName
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')}"`;
  }
  return `${cleanName} <${cleanEmail}>`;
}

function formatPeople(list) {
  return (list || [])
    .map((person) => formatRecipient(person.name, person.email))
    .filter(Boolean)
    .join(", ");
}

async function enrichRecipientNames(composer) {
  if (!composer) return;
  const fields = [
    ".composer-to",
    ".composer-cc",
    ".composer-bcc",
  ];
  for (const selector of fields) {
    if (state.composer !== composer) return;
    const input = $(selector, $("#composer"));
    if (!input) continue;
    const value = input.value;
    const pattern =
      /(^|[,;]\s*)([^\s,;<>@]+@[^\s,;<>]+)(?=\s*([,;]|$))/g;
    const emails = Array.from(value.matchAll(pattern))
      .map((match) => match[2])
      .filter((email, index, list) => list.indexOf(email) === index);
    if (!emails.length) continue;
    const replacements = new Map();
    for (const email of emails) {
      try {
        const data = await api(
          `/api/contacts?q=${encodeURIComponent(
            email
          )}&account=${encodeURIComponent(
            composer.accountId
          )}&limit=5`
        );
        const contact = (data.contacts || []).find(
          (entry) =>
            entry.email &&
            entry.email.toLowerCase() === email.toLowerCase() &&
            entry.name
        );
        if (contact) {
          const formatted = formatRecipient(
            contact.name,
            contact.email
          );
          if (formatted && formatted !== email) {
            replacements.set(email, formatted);
          }
        }
      } catch (error) {
        /* Leave bare addresses alone. */
      }
      if (state.composer !== composer) return;
    }
    if (!replacements.size) continue;
    if (input.value !== value) continue;
    let next = input.value;
    for (const [email, formatted] of replacements) {
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(
        new RegExp(
          `(^|[,;]\\s*)${escaped}(?=\\s*([,;]|$))`,
          "g"
        ),
        `$1${formatted}`
      );
    }
    if (state.composer === composer && input.value === value) {
      input.value = next;
      captureComposerFields();
      scheduleDraftSave();
    }
  }
}

function replySubject(subject) {
  const value = String(subject || "").trim();
  if (/^re:/i.test(value)) return value;
  return value ? `Re: ${value}` : "Re:";
}

function forwardSubject(subject) {
  const value = String(subject || "").trim();
  if (/^fwd?:/i.test(value)) return value;
  return value ? `Fwd: ${value}` : "Fwd:";
}

function buildReplyTargets(kind, thread, message, account) {
  const me = (account.email || "").toLowerCase();
  const dedupe = (people) => {
    const seen = new Set();
    return people.filter((person) => {
      const email = (person.email || "").toLowerCase();
      if (!email || email === me || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
  };
  const from = message.from_email
    ? [{ name: decodeEntities(message.from_name || ""), email: message.from_email }]
    : [];
  const to = [];
  const cc = [];
  if (kind === "reply") {
    if ((message.from_email || "").toLowerCase() === me) {
      const others = dedupe(message.to || []);
      if (others.length) to.push(others[0]);
    } else {
      to.push(...from);
    }
  } else if (kind === "reply-all") {
    if ((message.from_email || "").toLowerCase() !== me) to.push(...from);
    for (const person of dedupe(message.to || [])) {
      if (!to.some((item) => item.email.toLowerCase() === person.email.toLowerCase())) {
        to.push(person);
      }
    }
    cc.push(...dedupe(message.cc || []));
  } else {
    return { to: [], cc: [], bcc: [] };
  }
  return { to, cc, bcc: [] };
}

function forwardedHtml(message) {
  const body = message.body_text || htmlToText(message.body_html || "");
  const header = [
    "---------- Forwarded message ---------",
    `From: ${decodeEntities(message.from_name || "")} <${message.from_email || ""}>`,
    `Date: ${formatDate(message.date, "full")}`,
    `Subject: ${decodeEntities(message.subject || "")}`,
    `To: ${(message.to || []).map((person) => person.email).join(", ")}`,
  ]
    .map((line) => esc(line))
    .join("<br>");
  return `<p><br></p><p style="color:#666">${header}<br><br>${esc(body).replace(
    /\n/g,
    "<br>"
  )}</p>`;
}

function composerTitle(kind) {
  return (
    { reply: "Reply", "reply-all": "Reply all", forward: "Forward", new: "New message" }[kind] ||
    "New message"
  );
}

function composerHtml(composer) {
  const account = accountFor(composer.accountId);
  const hasThread = Boolean(composer.threadId);
  const isReply = composer.kind === "reply" || composer.kind === "reply-all";
  const subjectVisible = composer.kind === "new" || composer.kind === "forward";
  const ccVisible = Boolean(composer.cc || composer.bcc);
  return `
    <div class="composer-resizer" title="Resize"></div>
    <div class="composer-head" data-action="composer-restore">
      <div class="composer-title">${composer.draftReady ? "Draft · " : ""}${esc(
        composerTitle(composer.kind)
      )} ${accountBadge(account)}</div>
      <div class="composer-head-actions">
        ${
          hasThread
            ? `<button class="icon-btn ${composer.mode === "tray" ? "active" : ""}" data-action="composer-mode" data-mode="tray" aria-label="Dock below message" title="Dock below message">${icon(
                "rows",
                15
              )}</button>
               <button class="icon-btn ${composer.mode === "panel" ? "active" : ""}" data-action="composer-mode" data-mode="panel" aria-label="Open beside message" title="Open beside message">${icon(
                 "columns",
                 15
               )}</button>`
            : ""
        }
        ${
          hasThread
            ? `<button class="icon-btn" data-action="composer-minimize" aria-label="Minimize composer" title="Minimize">${icon(
                "chevronDown",
                15
              )}</button>`
            : ""
        }
        <button class="icon-btn" data-action="composer-delete-draft" aria-label="Delete draft" title="Delete draft">${icon(
          "trash",
          15
        )}</button>
        <button class="icon-btn" data-action="composer-close" aria-label="Close composer" title="Close">${icon(
          "x",
          15
        )}</button>
      </div>
    </div>
    <form class="composer-form" novalidate>
      ${
        composer.kind === "new" && state.accounts.length > 1
          ? `<div class="composer-row"><label for="composer-account">From</label><select id="composer-account" class="composer-account">${state.accounts
              .map(
                (entry) =>
                  `<option value="${esc(entry.id)}" ${
                    entry.id === composer.accountId ? "selected" : ""
                  }>${esc(entry.email)}</option>`
              )
              .join("")}</select></div>`
          : ""
      }
      <div class="composer-row">
        <label for="composer-to">To</label>
        <input id="composer-to" class="composer-to" type="text" autocomplete="off" spellcheck="false" value="${esc(
          composer.to
        )}">
        <button type="button" class="cc-toggle" data-action="composer-cc">Cc/Bcc</button>
      </div>
      <div class="composer-row" ${ccVisible ? "" : "hidden"}>
        <label for="composer-cc">Cc</label>
        <input id="composer-cc" class="composer-cc" type="text" autocomplete="off" spellcheck="false" value="${esc(
          composer.cc
        )}">
      </div>
      <div class="composer-row" ${ccVisible ? "" : "hidden"}>
        <label for="composer-bcc">Bcc</label>
        <input id="composer-bcc" class="composer-bcc" type="text" autocomplete="off" spellcheck="false" value="${esc(
          composer.bcc
        )}">
      </div>
      ${
        subjectVisible
          ? `<div class="composer-row"><label for="composer-subject">Subject</label><input id="composer-subject" class="composer-subject" type="text" autocomplete="off" value="${esc(
              composer.subject
            )}"></div>`
          : ""
      }
      <div class="editor-wrap">
        <div class="composer-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write a message">${composer.html || ""}</div>
      </div>
      <div class="format-bar">
        <button type="button" class="format-btn" data-format="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icon(
          "undo",
          14
        )}</button>
        <button type="button" class="format-btn" data-format="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${icon(
          "redo",
          14
        )}</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button type="button" class="format-btn" data-format="bold" aria-label="Bold" title="Bold">${icon(
          "bold",
          14
        )}</button>
        <button type="button" class="format-btn" data-format="italic" aria-label="Italic" title="Italic">${icon(
          "italic",
          14
        )}</button>
        <button type="button" class="format-btn" data-format="underline" aria-label="Underline" title="Underline">${icon(
          "underline",
          14
        )}</button>
        <button type="button" class="format-btn" data-format="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">${icon(
          "list",
          14
        )}</button>
        <button type="button" class="format-btn" data-format="createLink" aria-label="Insert link" title="Insert link">${icon(
          "link",
          14
        )}</button>
        <button type="button" class="format-btn" data-action="composer-inline-image" aria-label="Insert image" title="Insert image">${icon(
          "image",
          14
        )}</button>
        <span class="format-spacer"></span>
        <button type="button" class="composer-attach-btn" data-action="composer-attach" title="Attach files">${icon(
          "paperclip",
          13
        )}<span>Attach</span></button>
        <input type="file" class="composer-inline-image" accept="image/*" hidden>
      </div>
      <div class="composer-attachment-shelf" hidden>
        <button type="button" class="attachment-shelf-toggle" data-action="toggle-composer-attachments" aria-expanded="true" aria-controls="composer-attachment-items">
          <span class="attachment-shelf-chevron">${icon("chevronDown", 13)}</span>
          <span>Attachments</span>
          <span class="attachment-shelf-count"></span>
        </button>
        <div class="attachment-shelf-items" id="composer-attachment-items"></div>
      </div>
      <div class="composer-error"></div>
      <div class="composer-foot">
        <span class="composer-size" id="composer-size"></span>
        <button class="btn accent send-btn" type="submit">Send</button>
      </div>
    </form>`;
}

function renderComposer() {
  const host = $("#composer");
  const composer = state.composer;
  clearComposerImageSelection();
  closeContactMenu();
  if (!composer) {
    stopComposerPaperObserver();
    host.hidden = true;
    host.innerHTML = "";
    host.className = "composer";
    updateReaderPane();
    return;
  }
  host.hidden = false;
  host.className = "composer";
  host.classList.toggle("minimized", Boolean(composer.minimized));
  host.innerHTML = composerHtml(composer);
  host.dataset.kind = composer.kind;
  observeComposerPaper();
  renderComposerAttachments();
  updateComposerSize(composer);
  updateReaderPane();
  if (!composer.minimized) {
    setTimeout(() => {
      const editor = $(".composer-editor", host);
      if (editor && !composer.initialized) {
        composer.initialized = true;
        editor.focus();
        if (composer.kind === "reply" || composer.kind === "reply-all") {
          placeCaretBeforeSignature(editor);
        }
        if (composer.kind === "forward" || composer.kind === "new") {
          const to = $(".composer-to", host);
          if (to && !to.value) to.focus();
        }
      }
    }, 30);
  }
}

function placeCaretAtEnd(element) {
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (error) {
    /* Ignore. */
  }
}

function placeCaretBeforeSignature(element) {
  const signature = element?.querySelector("[data-courier-signature]");
  if (!signature) {
    placeCaretAtEnd(element);
    return;
  }
  try {
    const range = document.createRange();
    const start = signature.previousElementSibling;
    if (start?.matches("[data-composer-body-start]")) {
      range.selectNodeContents(start);
      range.collapse(true);
    } else {
      range.setStartBefore(signature);
      range.collapse(true);
    }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (error) {
    placeCaretAtEnd(element);
  }
}

function ensureComposerCaretBeforeSignature(editor) {
  const signature = editor?.querySelector("[data-courier-signature]");
  if (!signature) return;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return;
  if (signature.contains(range.startContainer)) return;
  let after = false;
  if (range.startContainer === editor) {
    const index = Array.from(editor.childNodes).indexOf(signature);
    after = index >= 0 && range.startOffset > index;
  } else {
    const position = signature.compareDocumentPosition(range.startContainer);
    after = Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  if (after) placeCaretBeforeSignature(editor);
}

const EDITOR_STYLED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "CANVAS",
  "CENTER",
  "CODE",
  "DEL",
  "EM",
  "EMBED",
  "FONT",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "IFRAME",
  "IMG",
  "INS",
  "LI",
  "LINK",
  "MARK",
  "OBJECT",
  "OL",
  "PICTURE",
  "PRE",
  "S",
  "SMALL",
  "STRIKE",
  "STRONG",
  "STYLE",
  "SUB",
  "SUP",
  "SVG",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL",
  "VIDEO",
]);

const EDITOR_STYLED_ATTRS = new Set([
  "align",
  "background",
  "bgcolor",
  "color",
  "face",
  "size",
  "style",
]);

function contentHasStyledMarkup(root) {
  if (!root) return false;
  const walk = (node) => {
    if (node.nodeType !== 1) return false;
    if (node !== root && !node.hasAttribute("data-courier-signature")) {
      if (EDITOR_STYLED_TAGS.has(node.tagName)) return true;
      for (const attr of node.attributes) {
        const name = attr.name.toLowerCase();
        if (EDITOR_STYLED_ATTRS.has(name)) return true;
        if (name === "class" && attr.value.trim()) return true;
      }
    }
    for (const child of node.children) {
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(root);
}

function selectedContentTheme() {
  return EMAIL_THEMES[state.prefs.emailTheme]
    ? state.prefs.emailTheme
    : "fog";
}

function applyEditorPaperPalette(element, themeName) {
  if (!element) return;
  const palette = EMAIL_THEMES[themeName] || EMAIL_THEMES.fog;
  element.style.setProperty("--editor-paper-bg", palette.bg);
  element.style.setProperty("--editor-paper-ink", palette.ink);
  element.style.setProperty("--editor-paper-muted", palette.muted);
  element.style.setProperty("--editor-paper-line", palette.line);
  element.style.setProperty("--editor-paper-link", palette.link);
  element.style.colorScheme = palette.scheme || "light";
  element.classList.add("editor-paper");
  element.dataset.editorPaperTheme = themeName;
}

function maybeToastStyledPaper(styled) {
  if (!styled || state.styledPaperNotified) return;
  if (selectedContentTheme() === "fog") return;
  state.styledPaperNotified = true;
  toast(
    "Styling detected. Changed background to match what the recipient would see.",
    false,
    6000
  );
}

function updateComposerPaperTheme() {
  const editor = $("#composer .composer-editor");
  const wrap = $("#composer .editor-wrap");
  if (!editor || !wrap) return;
  const styled = contentHasStyledMarkup(editor);
  applyEditorPaperPalette(wrap, styled ? "fog" : selectedContentTheme());
  wrap.classList.toggle(
    "show-composer-placeholder",
    Boolean(editor.querySelector("[data-courier-signature]")) &&
      !composerHasUserContent(editor)
  );
  maybeToastStyledPaper(styled);
}

function updateSignaturePaperTheme() {
  const editor = signatureEditorElement();
  const paper = $("#signature-editor-modal .signature-paper");
  if (!editor || !paper) return;
  const styled = contentHasStyledMarkup(editor);
  applyEditorPaperPalette(paper, styled ? "fog" : selectedContentTheme());
  maybeToastStyledPaper(styled);
}

let composerPaperObserver = null;
let signaturePaperObserver = null;
let composerPaperFrame = 0;
let signaturePaperFrame = 0;

function scheduleComposerPaperTheme() {
  if (composerPaperFrame) return;
  composerPaperFrame = requestAnimationFrame(() => {
    composerPaperFrame = 0;
    updateComposerPaperTheme();
  });
}

function scheduleSignaturePaperTheme() {
  if (signaturePaperFrame) return;
  signaturePaperFrame = requestAnimationFrame(() => {
    signaturePaperFrame = 0;
    updateSignaturePaperTheme();
  });
}

function stopComposerPaperObserver() {
  if (composerPaperObserver) {
    composerPaperObserver.disconnect();
    composerPaperObserver = null;
  }
  if (composerPaperFrame) {
    cancelAnimationFrame(composerPaperFrame);
    composerPaperFrame = 0;
  }
}

function stopSignaturePaperObserver() {
  if (signaturePaperObserver) {
    signaturePaperObserver.disconnect();
    signaturePaperObserver = null;
  }
  if (signaturePaperFrame) {
    cancelAnimationFrame(signaturePaperFrame);
    signaturePaperFrame = 0;
  }
}

function observeComposerPaper() {
  stopComposerPaperObserver();
  const editor = $("#composer .composer-editor");
  if (!editor) return;
  if (typeof MutationObserver !== "undefined") {
    composerPaperObserver = new MutationObserver(scheduleComposerPaperTheme);
    composerPaperObserver.observe(editor, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }
  updateComposerPaperTheme();
}

function observeSignaturePaper() {
  stopSignaturePaperObserver();
  const editor = signatureEditorElement();
  if (!editor) return;
  if (typeof MutationObserver !== "undefined") {
    signaturePaperObserver = new MutationObserver(scheduleSignaturePaperTheme);
    signaturePaperObserver.observe(editor, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }
  updateSignaturePaperTheme();
}

function renderComposerAttachments() {
  const shelf = $(".composer-attachment-shelf", $("#composer"));
  if (!shelf || !state.composer) return;
  const items = (state.composer.attachments || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.inline);
  shelf.hidden = items.length === 0;
  const collapsed = Boolean(state.composer.attachmentShelfCollapsed);
  shelf.classList.toggle("collapsed", collapsed);
  const toggle = $(".attachment-shelf-toggle", shelf);
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const count = $(".attachment-shelf-count", shelf);
  if (count) count.textContent = items.length ? String(items.length) : "";
  const host = $(".attachment-shelf-items", shelf);
  if (!host) return;
  host.innerHTML = items
    .map(({ item, index }) => {
      const filename = decodeEntities(item.filename || "attachment");
      return `<div class="attachment-shelf-item">
        ${icon("paperclip", 12)}
        <span class="attachment-shelf-name" title="${esc(
          filename
        )}">${esc(filename)}</span>
        <span class="attachment-shelf-size">${formatBytes(item.size)}</span>
        <button type="button" class="attachment-action" data-action="view-composer-attachment" data-index="${index}" aria-label="View ${esc(
          filename
        )}" title="View">${icon("eye", 12)}</button>
        <button type="button" class="attachment-action" data-action="composer-remove-attachment" data-index="${index}" aria-label="Delete ${esc(
          filename
        )}" title="Delete">${icon("trash", 12)}</button>
      </div>`;
    })
    .join("");
}

function captureComposerFields() {
  if (!state.composer) return;
  const form = $("#composer .composer-form");
  if (!form) return;
  state.composer.to = $(".composer-to", form)?.value ?? state.composer.to;
  state.composer.cc = $(".composer-cc", form)?.value ?? state.composer.cc;
  state.composer.bcc = $(".composer-bcc", form)?.value ?? state.composer.bcc;
  state.composer.subject =
    $(".composer-subject", form)?.value ?? state.composer.subject;
  const editor = $(".composer-editor", form);
  if (editor) state.composer.html = editor.innerHTML;
  const accountSelect = $(".composer-account", form);
  if (accountSelect) state.composer.accountId = accountSelect.value;
}

function openComposer(kind, options = {}) {
  dismissSettingsPage();
  if (!state.accounts.length) {
    openSettings("accounts");
    return;
  }
  const isNew = kind === "new";
  const thread = isNew ? null : currentThread();
  const accountId = isNew
    ? options.accountId || state.accountFilter || state.accounts[0].id
    : thread.account_id;
  const account = accountFor(accountId);
  if (!account) {
    toast("This account is unavailable. Reconnect it in Settings.", true);
    return;
  }
  let message = null;
  if (thread) {
    const messages = currentMessages();
    message = options.messageId
      ? messages.find((item) => item.id === options.messageId)
      : messages[messages.length - 1];
  }
  if (kind !== "new" && !message) {
    toast(
      state.readerLoading
        ? "Wait for the thread to finish loading."
        : "This thread has no messages to reply to.",
      true
    );
    return;
  }

  if (
    kind !== "new" &&
    state.composer &&
    state.composer.accountId === accountId &&
    state.composer.threadId === (thread ? thread.id : null)
  ) {
    if (state.composer.minimized) {
      state.composer.minimized = false;
      renderComposer();
    }
    $("#composer .composer-editor")?.focus({ preventScroll: true });
    return;
  }

  if (state.composer) {
    saveComposerDraft(state.composer);
  }

  const targets = message
    ? buildReplyTargets(kind, thread, message, account)
    : { to: [], cc: [], bcc: [] };
  const isReply = kind === "reply" || kind === "reply-all";
  const draft =
    options.draft ||
    (thread ? state.threadDrafts[kind] || null : null) ||
    readLegacyDraft(kind, thread ? thread.id : "new");
  let subject = "";
  let html = "";
  if (kind === "new") {
    subject = "";
  } else if (kind === "forward") {
    subject = forwardSubject(decodeEntities(thread.subject || message.subject));
    html = forwardedHtml(message);
  } else {
    subject = replySubject(decodeEntities(thread.subject || message.subject));
  }
  if (draftHasContent(draft)) {
    // Legacy drafts and some Gmail drafts can carry an empty subject. A blank
    // draft subject must not erase the Re:/Fwd: subject derived from the thread.
    const draftSubject = String(draft.subject || "").trim();
    if (draftSubject) subject = draftSubject;
    html = draft.html || html;
  }
  html = ensureComposerSignature(html, accountId);

  const hasThread = Boolean(thread);
  let mode = hasThread ? state.prefs.composerMode : "full";
  if (mode === "full") mode = "panel";
  if (!hasThread) mode = "full";

  const composer = {
    kind,
    accountId,
    threadId: isReply && hasThread ? thread.id : null,
    to: draft && draftHasContent(draft) ? draft.to || "" : formatPeople(targets.to),
    cc: draft && draftHasContent(draft) ? draft.cc || "" : formatPeople(targets.cc),
    bcc: draft && draftHasContent(draft) ? draft.bcc || "" : formatPeople(targets.bcc),
    subject,
    html,
    mode,
    minimized: false,
    draftReady: Boolean(draft && draftHasContent(draft)),
    attachments:
      draft && draftHasContent(draft) && Array.isArray(draft.attachments)
        ? draft.attachments
        : [],
    sending: false,
    sent: false,
    initialized: false,
    targetMessageId: message ? message.id : "",
    inReplyTo:
      draft && draft.in_reply_to
        ? draft.in_reply_to
        : isReply && message
          ? message.message_id || ""
          : "",
    references:
      draft && draft.references
        ? draft.references
        : isReply && message
          ? [message.refs || "", message.message_id || ""]
              .filter(Boolean)
              .join(" ")
              .trim()
          : "",
    draftId: options.draftId || "",
    draftThreadId: options.draftThreadId || "",
    draftSignature:
      draft && draftHasContent(draft) ? draftSignature(draft) : "",
    draftSeq: 0,
    draftError: false,
    draftQueued: false,
    createdDraft: false,
    attachmentShelfCollapsed: false,
    signatureOverrides: {},
    lastSelection: null,
    initialSignature: "",
    error: "",
  };
  state.composer = composer;
  if (!hasThread) mode = "full";
  renderComposer();
  primeComposerDraftBaseline(composer);
  if (state.prefs.layout === "reading" && !hasThread) {
    updateReaderPane();
  }
  scheduleDraftSave();
  void enrichRecipientNames(composer);
}

function closeComposer(options = {}) {
  if (!state.composer) return;
  closeContactMenu();
  let pending = null;
  if (!options.discard) saveComposerDraft(state.composer);
  else if (!options.draftHandled) pending = deleteComposerDraft(state.composer);
  state.composer = null;
  const host = $("#composer");
  host.hidden = true;
  host.innerHTML = "";
  host.className = "composer";
  updateReaderPane();
  return pending;
}

async function deleteComposerDraftAction() {
  const composer = state.composer;
  if (!composer || composer.sending) return;
  const confirmed = await showModal({
    title: "Delete draft?",
    message:
      "This draft will be removed from Gmail. The thread itself is not deleted.",
    confirmLabel: "Delete draft",
    cancelLabel: "Keep editing",
    danger: true,
  });
  if (!confirmed || state.composer !== composer) return;
  composer.sending = true;
  if (composer.draftPromise) {
    try {
      await composer.draftPromise;
    } catch (error) {
      /* A failed save has no draft ID to delete. */
    }
  }
  if (state.composer !== composer) return;
  const selected = state.selected;
  await closeComposer({ discard: true });
  if (
    selected &&
    !(selected.messages || []).length &&
    ((selected.thread && selected.thread.labels) || []).includes("DRAFT")
  ) {
    clearSelection();
    renderReader();
  }
  await refreshState({ quiet: true });
  await loadThreads({ quiet: true });
}

function toggleComposerMinimize() {
  if (!state.composer) return;
  captureComposerFields();
  state.composer.minimized = !state.composer.minimized;
  renderComposer();
}

function addComposerAttachmentPayloads(items) {
  if (!state.composer || !items.length) return;
  const limit = 20 * 1024 * 1024;
  let used = (state.composer.attachments || []).reduce(
    (sum, item) => sum + (Number(item.size) || 0),
    0
  );
  let added = false;
  for (const item of items) {
    const size = Number(item.size) || 0;
    if (used + size > limit) {
      toast("Attachment size limit is 20 MB in total", true);
      continue;
    }
    state.composer.attachments.push({
      filename: item.filename || "attachment",
      mime: item.mime || "application/octet-stream",
      size,
      data: item.data || "",
    });
    used += size;
    added = true;
  }
  if (!added) return;
  state.composer.attachmentShelfCollapsed = false;
  renderComposerAttachments();
  scheduleDraftSave();
  scheduleComposerSize(state.composer);
}

async function viewComposerAttachment(index) {
  const item = state.composer?.attachments?.[index];
  if (!item || item.inline) return;
  try {
    await api("/api/open-composer-attachment", {
      method: "POST",
      body: {
        filename: item.filename,
        mime: item.mime,
        data: item.data,
      },
    });
    toast("Opening attachment");
  } catch (error) {
    toast(error.message || "Could not open the attachment", true);
  }
}

async function chooseComposerAttachments() {
  if (!state.composer) return;
  try {
    const data = await api("/api/choose-attachments", {
      method: "POST",
      body: {},
    });
    addComposerAttachmentPayloads(data.files || []);
  } catch (error) {
    toast(error.message || "Could not choose attachments", true);
  }
}

function saveComposerImageRange() {
  if (!state.composer) return;
  const editor = $("#composer .composer-editor");
  const selection = window.getSelection();
  if (
    editor &&
    selection &&
    selection.rangeCount &&
    editor.contains(selection.anchorNode)
  ) {
    state.composer.imageRange = selection.getRangeAt(0).cloneRange();
  } else {
    state.composer.imageRange = null;
  }
}

async function chooseComposerInlineImage() {
  if (!state.composer) return;
  saveComposerImageRange();
  try {
    const data = await api("/api/choose-inline-image", {
      method: "POST",
      body: {},
    });
    const file = data && data.file;
    if (!file || !file.data) return;
    const binary = atob(file.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    insertComposerInlineImage(
      new File([bytes], file.filename || "inline-image", {
        type: file.mime || "image/png",
      })
    );
  } catch (error) {
    if (error.status === 503) {
      $("#composer .composer-inline-image")?.click();
      return;
    }
    toast(error.message || "Could not choose an image", true);
  }
}

function registerPastedImage(image, src, mime, composer = state.composer) {
  if (!composer || !src || image.dataset.courierCid) return;
  const base64 = src.includes(",") ? src.split(",")[1] || "" : "";
  if (!base64) return;
  const extension = (mime.split("/")[1] || "png")
    .replace("jpeg", "jpg")
    .replace(/[^a-z0-9]/gi, "");
  const contentId = `courier-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  composer.attachments.push({
    filename: `pasted-image.${extension || "png"}`,
    mime: mime || "image/png",
    size: Math.round((base64.length * 3) / 4),
    data: base64,
    inline: true,
    content_id: contentId,
  });
  image.dataset.courierCid = contentId;
}

async function readClipboardImages() {
  if (!navigator.clipboard || !navigator.clipboard.read || !state.composer) {
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items || []) {
      for (const type of item.types || []) {
        if (!type.startsWith("image/")) continue;
        const blob = await item.getType(type);
        const extension = (type.split("/")[1] || "png")
          .replace("jpeg", "jpg")
          .replace(/[^a-z0-9]/gi, "");
        insertComposerInlineImage(
          new File([blob], `pasted-image.${extension || "png"}`, {
            type: type,
          })
        );
      }
    }
  } catch (error) {
    /* Clipboard permission is optional; the normal paste path may have won. */
  }
}

function adoptPastedImages(editor) {
  if (!state.composer || !editor) return;
  for (const image of editor.querySelectorAll("img:not([data-courier-cid])")) {
    const src = image.getAttribute("src") || "";
    if (src.startsWith("data:image/")) {
      const mime = src.slice(5).split(";")[0] || "image/png";
      registerPastedImage(image, src, mime);
      continue;
    }
    if (src.startsWith("blob:") && !image.dataset.pastePending) {
      image.dataset.pastePending = "1";
      prepareComposerImages(editor).catch(() => {
        delete image.dataset.pastePending;
      });
      break;
    }
  }
  if (state.composer) state.composer.html = editor.innerHTML;
  scheduleDraftSave();
  scheduleComposerSize(state.composer);
}

function insertComposerInlineImage(file) {
  if (!state.composer || !file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    toast("Choose an image file", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast("Inline images must be smaller than 10 MB", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const dataUrl = String(reader.result || "");
      const data = dataUrl.split(",")[1] || "";
      const contentId = `courier-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
      state.composer.attachments.push({
        filename: file.name || "inline-image",
        mime: file.type || "image/png",
        size: file.size,
        data,
        inline: true,
        content_id: contentId,
      });
      const editor = $("#composer .composer-editor");
      if (!editor) return;
      editor.focus();
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = file.name || "Inline image";
      image.dataset.courierCid = contentId;
      image.style.maxWidth = "100%";
      const range = state.composer.imageRange;
      if (
        range &&
        editor.contains(range.commonAncestorContainer)
      ) {
        range.deleteContents();
        range.insertNode(image);
        range.setStartAfter(image);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(image);
      }
      state.composer.imageRange = null;
      state.composer.html = editor.innerHTML;
      renderComposerAttachments();
      scheduleDraftSave();
      selectComposerImage(image);
      scheduleComposerSize(state.composer);
    } catch (error) {
      toast("Could not insert the image", true);
    }
  };
  reader.onerror = () => toast("Could not read the image", true);
  reader.readAsDataURL(file);
}

function composerImageWidth(image) {
  return image && image.isConnected
    ? Math.round(image.getBoundingClientRect().width)
    : 0;
}

let composerImageResizeActive = false;
let composerImageClickGuard = 0;

function ensureComposerImageTools() {
  const wrap = $("#composer .editor-wrap");
  if (!wrap) return null;
  let tools = $(".composer-image-tools", wrap);
  if (tools) return tools;
  tools = document.createElement("div");
  tools.className = "composer-image-tools";
  tools.hidden = true;
  tools.innerHTML = `
    <button type="button" class="composer-image-handle" data-corner="nw" aria-label="Resize image from top left" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="ne" aria-label="Resize image from top right" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="sw" aria-label="Resize image from bottom left" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="se" aria-label="Resize image from bottom right" title="Resize"></button>
    <div class="composer-image-actions" role="group" aria-label="Image size">
      <button type="button" class="composer-image-action" data-image-size="small">Small</button>
      <button type="button" class="composer-image-action" data-image-size="original">Original Size</button>
    </div>`;
  wrap.appendChild(tools);
  tools.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest?.(".composer-image-handle");
    if (!handle) return;
    startComposerImageResize(event, handle.dataset.corner || "se");
  });
  tools.addEventListener("click", (event) => {
    const button = event.target.closest?.(".composer-image-action");
    if (!button || !state.composer || !state.composer.selectedImage) return;
    event.preventDefault();
    const image = state.composer.selectedImage;
    const natural = image.naturalWidth || composerImageWidth(image);
    const target =
      button.dataset.imageSize === "original"
        ? natural
        : Math.min(200, natural || 200);
    setComposerImageWidth(image, target);
  });
  wrap.addEventListener(
    "scroll",
    () => {
      if (state.composer && state.composer.selectedImage) {
        positionComposerImageTools();
      }
    },
    { passive: true }
  );
  return tools;
}

function positionComposerImageTools() {
  const composer = state.composer;
  const image = composer && composer.selectedImage;
  const wrap = $("#composer .editor-wrap");
  const tools = $("#composer .composer-image-tools");
  if (!composer || !image || !image.isConnected || !wrap || !tools) {
    if (tools) tools.hidden = true;
    if (composer) composer.selectedImage = null;
    const editor = $("#composer .composer-editor");
    if (editor) editor.classList.remove("has-image-tools");
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  const rect = image.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    tools.hidden = true;
    const editor = $("#composer .composer-editor");
    if (editor) editor.classList.remove("has-image-tools");
    return;
  }
  tools.hidden = false;
  tools.style.left = `${rect.left - wrapRect.left + wrap.scrollLeft}px`;
  tools.style.top = `${rect.top - wrapRect.top + wrap.scrollTop}px`;
  tools.style.width = `${rect.width}px`;
  tools.style.height = `${rect.height}px`;
  const actions = $(".composer-image-actions", tools);
  if (actions) {
    const actionWidth = actions.offsetWidth || 0;
    if (rect.left + actionWidth > wrapRect.right - 6) {
      actions.style.left = "auto";
      actions.style.right = "0";
    } else {
      actions.style.left = "0";
      actions.style.right = "auto";
    }
  }
  const editor = $("#composer .composer-editor");
  if (editor) editor.classList.add("has-image-tools");
}

function revealComposerImageTools() {
  const wrap = $("#composer .editor-wrap");
  const image = state.composer && state.composer.selectedImage;
  const tools = $("#composer .composer-image-tools");
  if (!wrap || !image || !tools || tools.hidden) return;
  const wrapRect = wrap.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const actions = $(".composer-image-actions", tools);
  const actionRect = actions ? actions.getBoundingClientRect() : imageRect;
  const top = Math.min(imageRect.top, actionRect.top);
  const bottom = Math.max(imageRect.bottom, actionRect.bottom);
  if (imageRect.height >= wrapRect.height - 20) {
    wrap.scrollTop += Math.max(0, bottom - wrapRect.bottom + 4);
    return;
  }
  if (bottom > wrapRect.bottom - 4) {
    wrap.scrollTop += bottom - wrapRect.bottom + 4;
  }
  if (top < wrapRect.top + 4) {
    wrap.scrollTop -= wrapRect.top + 4 - top;
  }
}

function selectComposerImage(image) {
  const composer = state.composer;
  const editor = $("#composer .composer-editor");
  if (!composer || !editor || !image || !editor.contains(image)) return;
  composer.selectedImage = image;
  adoptDataImages(editor, composer);
  ensureComposerImageTools();
  positionComposerImageTools();
  window.requestAnimationFrame(() => {
    if (state.composer && state.composer.selectedImage === image) {
      positionComposerImageTools();
      revealComposerImageTools();
    }
  });
  captureComposerFields();
  scheduleDraftSave();
  scheduleComposerSize(composer);
  if (!image.complete) {
    image.addEventListener("load", positionComposerImageTools, { once: true });
  }
}

function clearComposerImageSelection() {
  if (state.composer) state.composer.selectedImage = null;
  const tools = $("#composer .composer-image-tools");
  if (tools) tools.hidden = true;
  const editor = $("#composer .composer-editor");
  if (editor) editor.classList.remove("has-image-tools");
}

function setComposerImageWidth(image, width, reveal = true) {
  if (!image || !image.isConnected) return;
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  const floor = Math.min(24, naturalWidth || 24);
  let target = Math.max(floor, Math.round(Number(width) || 0));
  if (naturalWidth) target = Math.min(target, naturalWidth);
  image.style.width = `${target}px`;
  image.style.height = "auto";
  image.style.maxWidth = "100%";
  image.setAttribute("width", String(target));
  if (naturalWidth && naturalHeight) {
    image.setAttribute(
      "height",
      String(Math.max(1, Math.round((target * naturalHeight) / naturalWidth)))
    );
  } else {
    image.removeAttribute("height");
  }
  positionComposerImageTools();
  if (reveal) {
    window.requestAnimationFrame(() => {
      if (state.composer && state.composer.selectedImage === image) {
        positionComposerImageTools();
        revealComposerImageTools();
      }
    });
  }
  captureComposerFields();
  scheduleDraftSave();
  scheduleComposerSize(state.composer);
}

function composerContextImage() {
  const composer = state.composer;
  const image = composer && composer.contextImage;
  const editor = $("#composer .composer-editor");
  if (!composer || !image || !image.isConnected || !editor) return null;
  return editor.contains(image) ? image : null;
}

function openComposerImageContextMenu(image, x, y) {
  if (!state.composer || !image || !image.isConnected) return;
  selectComposerImage(image);
  state.composer.contextImage = image;
  openMenuAt(x, y, [
    { label: "Small", action: "composer-image-small", icon: "minimize" },
    {
      label: "Original Size",
      action: "composer-image-original",
      icon: "maximize",
    },
    {
      label: "Convert to attachment",
      action: "composer-image-attach",
      icon: "paperclip",
    },
    { label: "Delete image", action: "composer-image-delete", icon: "trash" },
  ]);
}

function resizeComposerContextImage(preset) {
  const image = composerContextImage();
  if (!image) return;
  const natural = image.naturalWidth || composerImageWidth(image);
  const target =
    preset === "original" ? natural : Math.min(200, natural || 200);
  setComposerImageWidth(image, target);
  selectComposerImage(image);
}

function deleteComposerImage(image = composerContextImage()) {
  const composer = state.composer;
  if (!composer || !image) return;
  const cid = image.dataset.courierCid || "";
  if (cid) {
    composer.attachments = (composer.attachments || []).filter(
      (item) => !(item.inline && item.content_id === cid)
    );
  }
  if (composer.selectedImage === image) clearComposerImageSelection();
  image.remove();
  composer.contextImage = null;
  captureComposerFields();
  renderComposerAttachments();
  scheduleDraftSave();
  scheduleComposerSize(composer);
}

function convertComposerImageToAttachment(image = composerContextImage()) {
  const composer = state.composer;
  const editor = $("#composer .composer-editor");
  if (!composer || !image || !editor || !editor.contains(image)) return;
  adoptDataImages(editor, composer);
  const cid = image.dataset.courierCid || "";
  const items = composer.attachments || [];
  const index = items.findIndex(
    (item) => item.inline && item.content_id === cid
  );
  if (index < 0) {
    toast("Could not convert this image", true);
    return;
  }
  const item = items[index];
  items.splice(index, 1);
  items.push({
    filename: item.filename || image.alt || "image",
    mime: item.mime || "image/png",
    size: Number(item.size) || Math.floor((String(item.data || "").length * 3) / 4),
    data: item.data || "",
    inline: false,
    content_id: "",
  });
  if (composer.selectedImage === image) clearComposerImageSelection();
  image.remove();
  composer.contextImage = null;
  composer.attachmentShelfCollapsed = false;
  captureComposerFields();
  renderComposerAttachments();
  scheduleDraftSave();
  scheduleComposerSize(composer);
  toast("Image moved to attachments");
}

function startComposerImageResize(event, corner) {  const image = state.composer && state.composer.selectedImage;
  if (!image || !image.isConnected) return;
  const editor = $("#composer .composer-editor");
  const startX = event.clientX;
  const startWidth = image.getBoundingClientRect().width;
  if (!startWidth) return;
  event.preventDefault();
  event.stopPropagation();
  const naturalWidth = image.naturalWidth || startWidth;
  const available = editor
    ? Math.max(24, editor.clientWidth - 28)
    : naturalWidth;
  const maxWidth = Math.max(
    startWidth,
    Math.min(naturalWidth, available)
  );
  const handleElement =
    event.target.closest?.(".composer-image-handle") || null;
  let hintShown = false;
  let currentWidth = startWidth;
  composerImageResizeActive = true;
  document.body.classList.add("composer-image-resizing");
  const move = (moveEvent) => {
    if (!image.isConnected) return;
    const delta = moveEvent.clientX - startX;
    const signed = corner.endsWith("w") ? -delta : delta;
    const wanted = startWidth + signed;
    if (wanted <= naturalWidth + 0.5) hintShown = false;
    if (
      naturalWidth &&
      wanted > naturalWidth + 0.5 &&
      maxWidth >= naturalWidth - 0.5 &&
      !hintShown
    ) {
      const anchor = handleElement
        ? handleElement.getBoundingClientRect()
        : null;
      showCursorHint(
        "Already at original size",
        anchor ? anchor.right + 10 : moveEvent.clientX + 12,
        anchor ? anchor.top + anchor.height / 2 : moveEvent.clientY
      );
      hintShown = true;
    }
    const next = Math.max(24, Math.min(wanted, maxWidth));
    if (Math.abs(next - currentWidth) < 0.5) return;
    currentWidth = next;
    setComposerImageWidth(image, next, false);
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", finish);
    composerImageResizeActive = false;
    composerImageClickGuard = Date.now() + 300;
    document.body.classList.remove("composer-image-resizing");
    if (image.isConnected) setComposerImageWidth(image, currentWidth);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
  window.addEventListener("blur", finish);
}

function imageToDataUrl(image) {
  return new Promise((resolve, reject) => {
    const convert = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        if (!canvas.width || !canvas.height) {
          reject(new Error("Image has no dimensions"));
          return;
        }
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };
    if (image.complete && image.naturalWidth) {
      convert();
    } else {
      image.addEventListener("load", convert, { once: true });
      image.addEventListener("error", reject, { once: true });
    }
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

async function prepareComposerImages(editor, options = {}) {
  let failed = 0;
  for (const image of Array.from(editor.querySelectorAll("img[src]"))) {
    if (image.dataset.courierCid) continue;
    const src = image.getAttribute("src") || "";
    if (src.startsWith("data:image/")) {
      registerPastedImage(image, src, src.slice(5).split(";")[0] || "image/png");
      continue;
    }
    if (src.startsWith("blob:")) {
      try {
        const blob = await fetch(src).then((response) => response.blob());
        const dataUrl = await blobToDataUrl(blob);
        image.src = dataUrl;
        registerPastedImage(image, dataUrl, blob.type || "image/png");
      } catch (error) {
        try {
          const dataUrl = await imageToDataUrl(image);
          image.src = dataUrl;
          registerPastedImage(image, dataUrl, "image/png");
        } catch (fallbackError) {
          if (options.announce) {
            image.remove();
            failed += 1;
          } else {
            delete image.dataset.pastePending;
          }
        }
      }
    }
  }
  if (state.composer) state.composer.html = editor.innerHTML;
  scheduleComposerSize(state.composer);
  if (failed && options.announce) {
    toast("Could not read a pasted image", true);
  }
}

function composerOutgoing(editor, composer, options = {}) {
  const html = editor.innerHTML.trim();
  const text = editor.innerText.trim();
  const outgoing = document.createElement("div");
  outgoing.innerHTML = html;
  const usedInline = new Set();
  for (const image of outgoing.querySelectorAll("img[data-courier-cid]")) {
    const cid = image.dataset.courierCid;
    if (!cid) continue;
    usedInline.add(cid);
    image.setAttribute("src", `cid:${cid}`);
    image.removeAttribute("data-courier-cid");
  }
  if (options.forSend) {
    for (const start of outgoing.querySelectorAll(
      "[data-composer-body-start]"
    )) {
      start.removeAttribute("data-composer-body-start");
    }
    for (const wrapper of outgoing.querySelectorAll(
      "[data-courier-signature]"
    )) {
      wrapper.replaceWith(...Array.from(wrapper.childNodes));
    }
  }
  const attachments = (composer.attachments || []).filter(
    (item) => !item.inline || usedInline.has(item.content_id)
  );
  return { html: outgoing.innerHTML, text, attachments };
}

async function sendComposer() {
  const composer = state.composer;
  if (!composer || composer.sending) return;
  captureComposerFields();
  const form = $("#composer .composer-form");
  const editor = $(".composer-editor", form);
  if (!form || !editor) return;
  const earlyEstimate = estimateComposerMime(composer);
  if (earlyEstimate.tooLarge) {
    composer.error =
      "This message is too large to send. Remove some attachments or inline images.";
    const earlyError = $(".composer-error", form);
    if (earlyError) earlyError.textContent = composer.error;
    toast(composer.error, true);
    updateComposerSize(composer);
    return;
  }
  await prepareComposerImages(editor, { announce: true });
  adoptDataImages(editor, composer);
  const outgoing = composerOutgoing(editor, composer, { forSend: true });
  const errorHost = $(".composer-error", form);
  const button = $(".send-btn", form);
  const account = accountFor(composer.accountId);
  if (!account) return;
  const toValue = $(".composer-to", form)?.value.trim() || "";
  const ccValue = $(".composer-cc", form)?.value.trim() || "";
  const bccValue = $(".composer-bcc", form)?.value.trim() || "";
  const hasAddress = (value) =>
    /@/.test(value.replace(/[,;\s]+$/, "").trim());
  if (
    !hasAddress(toValue) &&
    !hasAddress(ccValue) &&
    !hasAddress(bccValue)
  ) {
    composer.error = "Add a recipient.";
    if (errorHost) errorHost.textContent = composer.error;
    toast(composer.error, true);
    return;
  }
  const subjectInput = $(".composer-subject", form);
  const subjectValue = subjectInput
    ? subjectInput.value.trim()
    : String(composer.subject || "").trim();
  const hasBody = Boolean(
    outgoing.text || /<img\b/i.test(outgoing.html)
  );
  const missing = [];
  if (!subjectValue) missing.push("subject");
  if (!hasBody) missing.push("message");
  if (missing.length) {
    const description =
      missing.length === 2
        ? "This email has no subject or message."
        : `This email has no ${missing[0]}.`;
    const proceed = await showModal({
      title: "Send anyway?",
      message: description,
      confirmLabel: "Send anyway",
      cancelLabel: "Keep editing",
    });
    if (!proceed) return;
  }
  const hasFileAttachment = (composer.attachments || []).some(
    (item) => !item.inline
  );
  const mentionsAttachment =
    /\b(?:attach(?:ed|ment|ments|ing)?|enclosed)\b/i.test(
      outgoing.text || htmlToText(outgoing.html)
    );
  if (!hasFileAttachment && mentionsAttachment) {
    const proceed = await showModal({
      title: "Send without the attachment?",
      message:
        "This email mentions an attachment, but no files are attached.",
      confirmLabel: "Send anyway",
      cancelLabel: "Keep editing",
    });
    if (!proceed) return;
  }
  const attachmentBytes = (outgoing.attachments || []).reduce(
    (total, item) =>
      total + Math.floor((String(item.data || "").length * 3) / 4),
    0
  );
  if (attachmentBytes > 34 * 1024 * 1024) {
    composer.error =
      "Attachments and inline images are larger than 34 MB.";
    if (errorHost) errorHost.textContent = composer.error;
    const sizeLabel = $(".composer-size", form);
    if (sizeLabel) {
      sizeLabel.textContent = `Too large · ${formatComposerSize(
        attachmentBytes
      )}`;
      sizeLabel.classList.add("over");
    }
    if (button) {
      button.disabled = true;
      button.title = composer.error;
    }
    toast(composer.error, true);
    return;
  }
  const estimatedMimeBytes =
    Math.floor(attachmentBytes * 1.34) +
    String(outgoing.html || "").length +
    String(outgoing.text || "").length;
  if (estimatedMimeBytes > 34 * 1024 * 1024) {
    composer.error =
      "Attachments and inline images are too large to send.";
    if (errorHost) errorHost.textContent = composer.error;
    const sizeLabel = $(".composer-size", form);
    if (sizeLabel) {
      sizeLabel.textContent = `Too large · ${formatComposerSize(
        estimatedMimeBytes
      )}`;
      sizeLabel.classList.add("over");
    }
    if (button) {
      button.disabled = true;
      button.title = composer.error;
    }
    toast(composer.error, true);
    return;
  }
  const draftWasPending = Boolean(composer.draftPromise || composer.draftXhr);
  const sendBody = {
    account: composer.accountId,
    to: toValue,
    cc: ccValue,
    bcc: bccValue,
    subject: subjectValue,
    text: outgoing.text || htmlToText(outgoing.html),
    html: outgoing.html,
    attachments: outgoing.attachments,
    thread_id: composer.threadId || composer.draftThreadId || null,
    draft_id: composer.draftId || "",
    draft_thread_id: composer.draftThreadId || "",
    draft_pending: draftWasPending,
    in_reply_to: composer.inReplyTo,
    references: composer.references,
  };
  let serializedSendBody = "";
  let sendBytes = 0;
  try {
    serializedSendBody = JSON.stringify(sendBody);
    sendBytes = new Blob([serializedSendBody]).size;
  } catch (error) {
    serializedSendBody = JSON.stringify(sendBody);
    sendBytes = serializedSendBody.length;
  }
  if (sendBytes > 48 * 1024 * 1024) {
    composer.error =
      "This message is too large to send. Remove some attachments or inline images.";
    if (errorHost) errorHost.textContent = composer.error;
    const sizeLabel = $(".composer-size", form);
    if (sizeLabel) {
      sizeLabel.textContent = `Too large · ${formatComposerSize(sendBytes)}`;
      sizeLabel.classList.add("over");
    }
    if (button) {
      button.disabled = true;
      button.title = composer.error;
    }
    toast(composer.error, true);
    return;
  }
  if (draftWasPending) {
    composer.draftCancelled = true;
    if (composer.draftXhr) {
      try {
        composer.draftXhr.abort();
      } catch (error) {
        /* The request may have already finished. */
      }
    }
  }
  composer.sending = true;
  if (errorHost) errorHost.textContent = "";
  updateSendStatus("Sending message", { spinner: true, closable: false });
  setSendStatusText("Sending message · 0%");
  const startedSend = Date.now();
  let sendPercent = 0;
  let uploadDone = false;
  let gmailStarted = 0;
  const refreshSendProgress = () => {
    if (!composer.sending) return;
    if (!uploadDone) {
      if (sendPercent > 0) {
        setSendStatusText(`Sending message · ${sendPercent}%`);
      } else {
        const seconds = Math.max(
          0,
          Math.round((Date.now() - startedSend) / 1000)
        );
        setSendStatusText(`Sending message… ${seconds}s`);
      }
      return;
    }
    const seconds = Math.max(
      0,
      Math.round((Date.now() - (gmailStarted || startedSend)) / 1000)
    );
    setSendStatusText(`Uploading to Gmail… ${seconds}s`);
  };
  stopSendProgress();
  state.sendProgressTimer = setInterval(refreshSendProgress, 1000);
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>Sending`;
  }
  try {
    const result = await apiXhr("/api/send", {
      method: "POST",
      rawBody: serializedSendBody,
      timeout: 300000,
      onProgress: (fraction) => {
        sendPercent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
        if (fraction >= 0.999 && !uploadDone) {
          uploadDone = true;
          gmailStarted = Date.now();
        }
        refreshSendProgress();
      },
      onUploadComplete: () => {
        uploadDone = true;
        sendPercent = 100;
        gmailStarted = Date.now();
        refreshSendProgress();
      },
    });
    stopSendProgress();
    composer.sending = false;
    composer.sent = true;
    const threadId = composer.threadId || composer.draftThreadId || "";
    const accountId = composer.accountId;
    clearLegacyDraft(composer);
    closeComposer({ discard: true, draftHandled: true });
    updateSendStatus("Message sent", { duration: 4500 });
    await refreshState({ quiet: true });
    await loadThreads({ quiet: true });
    if (threadId) {
      await openThread(accountId, threadId, { force: true });
    }
    void result;
  } catch (error) {
    stopSendProgress();
    composer.sending = false;
    composer.error = error.timeout
      ? "Sending took too long. Check Gmail before retrying."
      : error.message || "Message could not be sent.";
    if (errorHost) errorHost.textContent = composer.error;
    if (button) {
      button.disabled = false;
      button.textContent = "Send";
    }
    updateComposerSize(composer);
    updateSendStatus(composer.error, { error: true, duration: 8000 });
    toast(composer.error, true);
  }
}

function updateComposerAccount(accountId) {
  if (!state.composer) return;
  const composer = state.composer;
  const editor = $("#composer .composer-editor");
  const previousAccountId = composer.accountId;
  captureComposerFields();
  if (editor) {
    for (const wrapper of editor.querySelectorAll(
      "[data-courier-signature]"
    )) {
      if (wrapper.dataset.courierSignature === previousAccountId) {
        composer.signatureOverrides[previousAccountId] =
          wrapper.innerHTML;
      }
      wrapper.remove();
    }
  }
  composer.accountId = accountId;
  const block = composerSignatureBlockHtml(composer, accountId);
  if (editor) {
    const hasStart = Boolean(
      editor.querySelector("[data-composer-body-start]")
    );
    if (block) {
      editor.insertAdjacentHTML(
        "beforeend",
        `${hasStart ? "" : signatureStartBlockHtml()}${block}`
      );
    } else {
      for (const start of editor.querySelectorAll(
        "[data-composer-body-start]"
      )) {
        if (emptySignatureStartBlock(start)) start.remove();
      }
    }
    composer.html = editor.innerHTML;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    let restored = false;
    if (composer.lastSelection) {
      try {
        selection.removeAllRanges();
        selection.addRange(composer.lastSelection);
        restored = true;
      } catch (error) {
        /* The old caret was inside the removed signature. */
      }
    }
    if (!restored) placeCaretBeforeSignature(editor);
  }
  observeComposerPaper();
  updateComposerSize(composer);
}

/* -------------------------------------------------------------------------- */
/* Recipient suggestions                                                      */
/* -------------------------------------------------------------------------- */

const RECIPIENT_SELECTOR = ".composer-to, .composer-cc, .composer-bcc";

function recipientToken(input) {
  const value = input.value || "";
  const caret =
    input.selectionStart == null ? value.length : input.selectionStart;
  const before = value.slice(0, caret);
  const start =
    Math.max(before.lastIndexOf(","), before.lastIndexOf(";")) + 1;
  const rest = value.slice(start);
  const separator = rest.search(/[,;]/);
  const end = separator === -1 ? value.length : start + separator + 1;
  return { start, end, text: before.slice(start).trim() };
}

function ensureContactMenu() {
  let menu = $("#contact-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "contact-menu";
    menu.className = "contact-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    document.body.appendChild(menu);
  }
  return menu;
}

function closeContactMenu() {
  state.contactSeq += 1;
  if (state.contactTimer) {
    clearTimeout(state.contactTimer);
    state.contactTimer = null;
  }
  if (state.contactMenu && state.contactMenu.input) {
    state.contactMenu.input.setAttribute("aria-expanded", "false");
  }
  state.contactMenu = null;
  const menu = $("#contact-menu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
}

function renderContactMenu(input) {
  const current = state.contactMenu;
  if (!current || !current.items.length) {
    closeContactMenu();
    return;
  }
  const menu = ensureContactMenu();
  menu.innerHTML = current.items
    .map((contact, index) => {
      const name = (contact.name || "").trim();
      const showName =
        name && name.toLowerCase() !== contact.email.toLowerCase();
      return `<button type="button" class="contact-item ${
        index === current.index ? "selected" : ""
      }" data-index="${index}" role="option" aria-selected="${
        index === current.index ? "true" : "false"
      }">${
        showName ? `<span class="contact-name">${esc(name)}</span>` : ""
      }<span class="contact-email">${esc(contact.email)}</span></button>`;
    })
    .join("");
  menu.hidden = false;
  input.setAttribute("aria-expanded", "true");
  const rect = input.getBoundingClientRect();
  const width = Math.min(
    Math.max(rect.width, 300),
    Math.max(180, window.innerWidth - 20)
  );
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(
    8,
    Math.min(rect.left, window.innerWidth - width - 10)
  )}px`;
  const footer = $(".composer-foot");
  const footerTop = footer
    ? footer.getBoundingClientRect().top
    : window.innerHeight;
  let maxHeight = Math.min(264, footerTop - rect.bottom - 10);
  let top = rect.bottom + 4;
  if (maxHeight < 100) {
    maxHeight = Math.min(264, rect.top - 20);
    top = rect.top - Math.max(60, maxHeight) - 4;
  }
  menu.style.maxHeight = `${Math.max(60, maxHeight)}px`;
  const height = menu.offsetHeight;
  if (top + height > window.innerHeight - 10) {
    top = rect.top - height - 4;
  }
  menu.style.top = `${Math.max(8, top)}px`;
}

async function loadContactSuggestions(input) {
  if (!state.composer) return;
  const seq = ++state.contactSeq;
  const token = recipientToken(input);
  const angle = token.text.lastIndexOf("<");
  const query = (
    angle >= 0 ? token.text.slice(angle + 1) : token.text
  )
    .replace(/>$/, "")
    .trim();
  const existing = new Set(
    (input.value.match(/[^\s,;<>"]+@[^\s,;<>"]+/g) || []).map((value) =>
      value.toLowerCase()
    )
  );
  let contacts = [];
  try {
    const data = await api(
      `/api/contacts?q=${encodeURIComponent(query)}&account=${encodeURIComponent(
        state.composer.accountId
      )}&limit=8`
    );
    if (seq !== state.contactSeq) return;
    contacts = (data.contacts || []).filter(
      (entry) => entry.email && !existing.has(entry.email.toLowerCase())
    );
  } catch (error) {
    if (seq !== state.contactSeq) return;
    contacts = [];
  }
  if (document.activeElement !== input) return;
  if (!contacts.length) {
    closeContactMenu();
    return;
  }
  state.contactMenu = { input, items: contacts, index: 0 };
  renderContactMenu(input);
}

function queueContactSuggestions(input, immediate = false) {
  if (!input || !state.composer) return;
  state.contactSeq += 1;
  if (state.contactTimer) clearTimeout(state.contactTimer);
  state.contactTimer = setTimeout(
    () => {
      state.contactTimer = null;
      loadContactSuggestions(input);
    },
    immediate ? 0 : 140
  );
}

function moveContactSelection(delta) {
  const current = state.contactMenu;
  if (!current || !current.items.length) return;
  current.index =
    (current.index + delta + current.items.length) % current.items.length;
  renderContactMenu(current.input);
}

function selectContact(contact) {
  const current = state.contactMenu;
  const input = current && current.input;
  if (!input || !contact) return;
  const value = input.value;
  const caret =
    input.selectionStart == null ? value.length : input.selectionStart;
  let start =
    Math.max(value.lastIndexOf(",", caret - 1), value.lastIndexOf(";", caret - 1)) +
    1;
  while (start < value.length && value[start] === " ") start += 1;
  let end = caret;
  while (end < value.length && value[end] !== "," && value[end] !== ";") end += 1;
  if (end < value.length) end += 1;
  const rawName = (contact.name || "").trim();
  const name = /[,;<>"]/.test(rawName) ? "" : rawName;
  const label =
    name && name.toLowerCase() !== contact.email.toLowerCase()
      ? `${name} <${contact.email}>`
      : contact.email;
  const insert = `${label}, `;
  const tail = value.slice(end).replace(/^[\s,;]+/, "");
  input.value = `${value.slice(0, start)}${insert}${tail}`;
  const position = start + insert.length;
  input.setSelectionRange(position, position);
  closeContactMenu();
  input.focus();
  captureComposerFields();
  scheduleDraftSave();
}

/* -------------------------------------------------------------------------- */
/* Rendering: settings                                                        */
/* -------------------------------------------------------------------------- */

function themeTile(theme) {
  const selected = state.prefs.theme === theme.id;
  return `<button class="theme-tile ${selected ? "selected" : ""}" data-action="theme" data-theme="${
    theme.id
  }" aria-pressed="${selected}">
    <span class="theme-preview" style="background:${theme.chrome}">
      <span class="theme-preview-main" style="background:${theme.desk}">
        <span class="theme-preview-side" style="background:${theme.side}"></span>
        <span class="theme-preview-paper" style="background:${theme.paper};color:${theme.ink}">Aa</span>
      </span>
    </span>
    <span>${theme.name}</span>
  </button>`;
}

function emailThemeTile(id, theme) {
  const selected = state.prefs.emailTheme === id;
  return `<button class="theme-tile email-theme-tile ${selected ? "selected" : ""}" data-action="email-theme" data-email-theme="${id}" aria-pressed="${selected}" title="${esc(
    theme.name
  )} email theme">
    <span class="email-theme-preview" style="background:${theme.bar};border-color:${theme.border}">
      <span class="email-theme-paper" style="background:${theme.bg};border-color:${theme.border};color:${theme.ink}">
        <span class="email-theme-aa">Aa</span>
        <span class="email-theme-rule" style="background:${theme.line}"></span>
        <span class="email-theme-rule short" style="background:${theme.line}"></span>
      </span>
    </span>
    <span>${esc(theme.name)}</span>
  </button>`;
}

function accentSwatch(accent) {
  const selected =
    state.prefs.accent.toLowerCase() === accent.value.toLowerCase();
  return `<button class="accent-swatch ${selected ? "selected" : ""}" style="background:${
    accent.value
  }" data-action="accent" data-accent="${accent.value}" aria-label="${
    accent.name
  } accent" title="${accent.name}" aria-pressed="${selected}"></button>`;
}

function syncThemeSelection() {
  $$(".theme-tile[data-theme]").forEach((tile) => {
    const selected = tile.dataset.theme === state.prefs.theme;
    tile.classList.toggle("selected", selected);
    tile.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  $$(".email-theme-tile[data-email-theme]").forEach((tile) => {
    const selected = tile.dataset.emailTheme === state.prefs.emailTheme;
    tile.classList.toggle("selected", selected);
    tile.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  $$(".accent-swatch[data-accent]").forEach((swatch) => {
    const selected =
      swatch.dataset.accent.toLowerCase() === state.prefs.accent.toLowerCase();
    swatch.classList.toggle("selected", selected);
    swatch.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  const custom = $(".custom-color input");
  if (custom && /^#[0-9a-f]{6}$/i.test(state.prefs.accent)) {
    custom.value = state.prefs.accent;
  }
}

function oauthStatusHtml() {
  if (state.oauthStatus) {
    const cls = state.oauthStatus.error ? "error" : "";
    return `<span class="settings-status ${cls}" id="oauth-status" aria-live="polite">${state.oauthStatus.html}</span>`;
  }
  return `<span class="settings-status" id="oauth-status" aria-live="polite"></span>`;
}

function aiStatusHtml() {
  if (state.aiStatus) {
    const cls = state.aiStatus.error ? "error" : "";
    return `<span class="settings-status ${cls}" id="ai-status" aria-live="polite">${state.aiStatus.html}</span>`;
  }
  return `<span class="settings-status" id="ai-status" aria-live="polite"></span>`;
}

function updateLatestVersion() {
  const result = state.updateResult;
  return String(result && result.latest ? result.latest : "").replace(/^v/i, "");
}

function updateOperationBusy(operation = state.updateOperation) {
  return Boolean(
    operation &&
      (operation.status === "downloading" || operation.status === "installing")
  );
}

function updateOperationVersion(operation = state.updateOperation) {
  return String(
    (operation && operation.version) || updateLatestVersion() || ""
  ).replace(/^v/i, "");
}

function updateProgressText(operation) {
  const total = Number(operation && operation.total) || 0;
  const received = Number(operation && operation.received) || 0;
  if (!total || received <= 0) return "";
  const percent = Math.max(
    0,
    Math.min(100, Math.floor((received / total) * 100))
  );
  return ` ${percent}%`;
}

function updateStatusIsError() {
  const operation = state.updateOperation;
  return Boolean(
    (state.updateResult && state.updateResult.error) ||
      (operation && operation.status === "failed")
  );
}

function updateStatusContent() {
  if (state.updateChecking) return "Checking GitHub…";
  const result = state.updateResult;
  const operation = state.updateOperation;
  const version = updateOperationVersion(operation);
  if (operation && operation.status === "downloading") {
    return `Downloading Courier ${esc(version)}…${updateProgressText(
      operation
    )}`;
  }
  if (operation && operation.status === "installing") {
    return `Installing Courier ${esc(
      version
    )}. Enter your password if prompted.`;
  }
  if (operation && operation.status === "installed") {
    return `Courier ${esc(version)} is installed. Restart Courier to finish.`;
  }
  if (operation && operation.status === "opened") {
    return "The package installer is open. Restart Courier after it finishes.";
  }
  if (operation && operation.status === "restarting") {
    return "Restarting Courier…";
  }
  if (operation && operation.status === "failed") {
    return esc(operation.message || "The update could not be installed.");
  }
  if (!result) return "Not checked yet.";
  if (result.error) return esc(result.error);
  const latest = updateLatestVersion();
  if (result.newer) {
    const link = result.url
      ? ` <button type="button" class="link-btn" data-action="update-open">View release</button>`
      : "";
    if (result.asset_error) {
      return `Courier ${esc(latest)} is available. ${esc(
        result.asset_error
      )}${link}`;
    }
    const installed = String(result.installed_version || "").replace(
      /^v/i,
      ""
    );
    if (installed && installed === latest) {
      return `Courier ${esc(latest)} is installed. Restart Courier to finish.${link}`;
    }
    return `Courier ${esc(latest)} is available.${link}`;
  }
  return `Courier is up to date${latest ? ` (${esc(latest)})` : ""}.`;
}

function updateModeDetails() {
  return (
    state.updateMode ||
    (state.updateResult && state.updateResult.mode) ||
    null
  );
}

function refreshUpdateActions() {
  const row = $("#update-action-row");
  if (!row) return;
  const result = state.updateResult;
  const operation = state.updateOperation;
  const mode = updateModeDetails();
  const latest = updateLatestVersion();
  const installed = String(
    (result && result.installed_version) || ""
  ).replace(/^v/i, "");
  const canRestart = Boolean(mode && mode.can_restart);
  const finished =
    Boolean(operation && operation.status === "installed") ||
    Boolean(operation && operation.status === "opened") ||
    Boolean(latest && installed === latest);
  let html = "";
  if (operation && operation.status === "downloading") {
    html = '<button class="btn" disabled>Downloading…</button>';
  } else if (operation && operation.status === "installing") {
    html = '<button class="btn" disabled>Installing…</button>';
  } else if (operation && operation.status === "restarting") {
    html = '<button class="btn" disabled>Restarting…</button>';
  } else if (finished) {
    if (canRestart) {
      html =
        '<button class="btn accent" data-action="update-restart">Restart Courier</button>';
    }
  } else if (
    result &&
    result.newer &&
    result.asset &&
    mode &&
    mode.can_install
  ) {
    const label =
      operation && operation.status === "failed"
        ? "Try again"
        : "Download and install";
    html = `<button class="btn accent" data-action="update-apply">${label}</button>`;
  }
  row.innerHTML = html;
  row.hidden = !html;
}

function refreshUpdateNote() {
  const note = $("#update-mode-note");
  if (!note) return;
  const mode = updateModeDetails();
  const operation = state.updateOperation;
  let text = (mode && mode.reason) || "";
  if (
    mode &&
    !mode.can_restart &&
    operation &&
    (operation.status === "installed" || operation.status === "opened")
  ) {
    text = "Quit Courier and start it again to load the update.";
  }
  note.textContent = text;
  note.hidden = !text;
}

function updateStatusHtml() {
  const error = updateStatusIsError();
  return `<span class="settings-status ${
    error ? "error" : ""
  }" id="update-status" aria-live="polite">${updateStatusContent()}</span>`;
}

function refreshUpdateStatus() {
  const host = $("#update-status");
  if (host) {
    host.classList.toggle("error", updateStatusIsError());
    host.innerHTML = updateStatusContent();
  }
  const button = $("#update-check-btn");
  if (button) {
    const busy = updateOperationBusy();
    button.disabled = state.updateChecking || busy;
    button.textContent = state.updateChecking
      ? "Checking…"
      : busy
        ? "Update in progress"
        : "Check GitHub for updates";
  }
  refreshUpdateActions();
  refreshUpdateNote();
}

async function loadUpdateOperation(options = {}) {
  let data = null;
  try {
    data = await api("/api/update/status", { timeout: 15000 });
  } catch (error) {
    state.updatePollErrors += 1;
    if (!options.quiet) {
      toast(error.message || "Could not read update status.", true);
    }
    return null;
  }
  state.updatePollErrors = 0;
  const wasBusy = updateOperationBusy();
  state.updateMode = data.mode || state.updateMode;
  state.updateOperation = data.operation || null;
  if (state.updateResult && data.installed_version !== undefined) {
    state.updateResult.installed_version = data.installed_version;
  }
  refreshUpdateStatus();
  const operation = state.updateOperation;
  if (wasBusy && operation) {
    if (operation.status === "installed") {
      toast(
        `Courier ${updateOperationVersion(
          operation
        )} is installed. Restart Courier to finish.`,
        false,
        8000
      );
    } else if (operation.status === "opened") {
      toast(
        "Package installer opened. Restart Courier when it finishes.",
        false,
        8000
      );
    } else if (operation.status === "failed") {
      toast(operation.message || "The update could not be installed.", true);
    }
  }
  return data;
}

function scheduleUpdatePoll() {
  if (state.updatePollTimer) return;
  if (!updateOperationBusy()) return;
  state.updatePollTimer = setTimeout(async () => {
    state.updatePollTimer = null;
    const data = await loadUpdateOperation({ quiet: true });
    if (!data && state.updatePollErrors >= 5) {
      state.updateOperation = {
        ...(state.updateOperation || {}),
        status: "failed",
        message: "Could not read update status. See courier.log.",
      };
      refreshUpdateStatus();
      return;
    }
    scheduleUpdatePoll();
  }, 900);
}

async function applyUpdate() {
  if (updateOperationBusy()) return;
  const latest = updateLatestVersion();
  state.updateOperation = {
    status: "downloading",
    version: latest,
    received: 0,
    total: 0,
    message: "",
  };
  refreshUpdateStatus();
  try {
    const data = await api("/api/update/apply", {
      method: "POST",
      body: {},
      timeout: 30000,
    });
    state.updateMode = data.mode || state.updateMode;
    state.updateOperation = data.operation || null;
    if (state.updateResult && data.installed_version !== undefined) {
      state.updateResult.installed_version = data.installed_version;
    }
    refreshUpdateStatus();
    scheduleUpdatePoll();
  } catch (error) {
    state.updateOperation = {
      status: "failed",
      version: latest,
      message: error.message || "Could not start the update.",
    };
    refreshUpdateStatus();
    toast(state.updateOperation.message, true);
  }
}

async function restartCourier() {
  state.updateOperation = {
    ...(state.updateOperation || {}),
    status: "restarting",
  };
  refreshUpdateStatus();
  try {
    await api("/api/update/restart", {
      method: "POST",
      body: {},
      timeout: 8000,
    });
  } catch (error) {
    state.updateOperation = {
      ...(state.updateOperation || {}),
      status: "installed",
    };
    refreshUpdateStatus();
    toast(error.message || "Could not restart Courier.", true);
  }
}

async function checkForUpdates(options = {}) {
  if (state.updateChecking || updateOperationBusy()) return null;
  state.updateChecking = true;
  refreshUpdateStatus();
  let data = null;
  try {
    data = await api("/api/update/check", {
      method: "POST",
      body: {},
      timeout: 30000,
    });
    state.updateResult = data;
    state.updateMode = data.mode || state.updateMode;
    state.updateOperation = data.operation || state.updateOperation;
    const latest = String(data.latest || "").replace(/^v/i, "");
    if (data.newer) {
      const alreadyNotified = data.notified_version === latest;
      if (
        !options.quiet ||
        (!data.notification_sent &&
          !alreadyNotified &&
          state.updateNotifiedVersion !== latest)
      ) {
        toast(`Courier ${latest} is available`, false, 7000);
      }
      state.updateNotifiedVersion = latest;
    } else if (!options.quiet) {
      toast("Courier is up to date");
    }
  } catch (error) {
    state.updateResult = {
      error: error.message || "Could not check for updates.",
    };
    if (!options.quiet) {
      toast(state.updateResult.error, true);
    }
  } finally {
    state.updateChecking = false;
    refreshUpdateStatus();
  }
  if (updateOperationBusy()) scheduleUpdatePoll();
  if (!options.quiet && state.prefs.updateAuto) {
    state.updateSessionChecked = true;
    scheduleUpdateCheck();
  }
  return data;
}


function scheduleUpdateCheck() {
  if (state.updateTimer) {
    clearTimeout(state.updateTimer);
    state.updateTimer = null;
  }
  if (!state.prefs.updateAuto) return;
  const value = Number(state.prefs.updateInterval);
  const hours = [1, 5, 8].includes(value) ? value : 5;
  const delay = state.updateSessionChecked
    ? hours * 60 * 60 * 1000
    : 15000;
  state.updateTimer = setTimeout(async () => {
    state.updateTimer = null;
    state.updateSessionChecked = true;
    await checkForUpdates({ quiet: true });
    scheduleUpdateCheck();
  }, delay);
}

function updateNotificationSoundUi() {
  const select = $("#notify-sound-select");
  if (select) select.value = state.prefs.notifySound || "soft-knock";
  const custom = state.prefs.notifySound === "custom";
  const upload = $("#notify-upload-btn");
  if (upload) upload.hidden = !custom;
  const name = $("#notify-sound-name");
  if (name) {
    name.textContent =
      custom && state.prefs.notifySoundPath
        ? String(state.prefs.notifySoundPath).split("/").pop()
        : "";
  }
  const volumeRow = $("#notify-volume-row");
  if (volumeRow) {
    volumeRow.hidden =
      state.prefs.notifySound === "none" ||
      state.prefs.notifySound === "system";
  }
}

async function uploadNotificationSound(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    toast("Choose a sound smaller than 4 MB", true);
    return;
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read sound"));
    reader.readAsDataURL(file);
  }).catch((error) => {
    toast(error.message || "Could not read sound", true);
    return "";
  });
  if (!data) return;
  try {
    const result = await api("/api/notification-sound", {
      method: "POST",
      body: { name: file.name, data },
    });
    state.prefs.notifySound = "custom";
    state.prefs.notifySoundPath = result.path;
    savePrefs();
    updateNotificationSoundUi();
    toast("Notification sound saved");
  } catch (error) {
    toast(error.message || "Could not save notification sound", true);
  }
}

function choiceGroup(action, dataName, selected, options) {
  return `<div class="choice-group">${options
    .map(
      (option) =>
        `<button type="button" class="choice-btn" data-action="${action}" data-${dataName}="${
          option.value
        }" aria-pressed="${option.value === selected ? "true" : "false"}">${option.label}</button>`
    )
    .join("")}</div>`;
}

function accountColorSwatch(color, name, selectedColor) {
  const selected = color.toLowerCase() === String(selectedColor).toLowerCase();
  return `<button type="button" class="accent-swatch ${selected ? "selected" : ""}" style="background:${color}" data-action="account-color" data-color="${color}" aria-label="${name}" title="${name}" aria-pressed="${selected}"></button>`;
}

function accountEditorHtml(account) {
  const color = state.accountEditorColor || account.color;
  const views = viewsForAccount(account.id);
  const defaultView = Number(account.default_view_id) || 0;
  return `<div class="account-editor">
    <div class="field-grid">
      <label for="account-name-input">Outgoing name</label>
      <input id="account-name-input" type="text" maxlength="80" autocomplete="off" spellcheck="false" value="${esc(
        account.name || ""
      )}" placeholder="${esc(account.email.split("@")[0])}">
    </div>
    <p class="settings-note">Used for new messages. Already-sent messages keep their original sender name. If Gmail still shows a different name, update the Send mail as display name in Gmail settings.</p>
    <div class="field-grid">
      <label for="account-username-input">Username</label>
      <input id="account-username-input" type="text" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(
        account.username || ""
      )}" placeholder="${esc(account.email.split("@")[0])}">
    </div>
    <div class="field-grid">
      <label>Colour</label>
      <div class="theme-swatches account-colors">
        ${ACCOUNT_COLORS.map((entry) => accountColorSwatch(entry.value, entry.name, color)).join("")}
        <label class="custom-color" style="--swatch:${esc(color)}" title="Custom colour">
          <input class="account-color-input" type="color" value="${esc(color)}" aria-label="Custom account colour">
          <span class="custom-color-ring" aria-hidden="true"></span>
        </label>
      </div>
    </div>
    <div class="field-grid">
      <label for="account-default-view">Default view</label>
      <select id="account-default-view" class="settings-select">
        <option value="">Inbox</option>
        ${views
          .map(
            (view) =>
              `<option value="${view.id}" ${
                Number(view.id) === defaultView ? "selected" : ""
              }>${esc(view.name)}</option>`
          )
          .join("")}
      </select>
    </div>
    <p class="settings-note">Opened when this account is selected. Create views from the account’s right-click menu.</p>
    <div class="settings-actions">
      <button class="btn accent" data-action="account-save" data-account="${esc(account.id)}">Save</button>
      <button class="btn" data-action="account-edit-cancel">Cancel</button>
      <span class="settings-status" id="account-editor-status" aria-live="polite"></span>
    </div>
    <div class="account-signature-divider" aria-hidden="true"></div>
    <div class="pref-row">
      <div class="pref-row-label">Signature</div>
      <label class="switch"><input id="account-signature-toggle" type="checkbox" aria-label="Use a signature for this account" ${
        state.accountEditorSignatureEnabled ? "checked" : ""
      }><span class="switch-track"><span class="switch-knob"></span></span></label>
    </div>
    <p class="settings-note">Added below the message text in new messages and replies from this account. Images are sent inline.</p>
    <div class="settings-actions" id="account-signature-actions" ${
      state.accountEditorSignatureEnabled ? "" : "hidden"
    }>
      <button type="button" class="btn" data-action="account-signature-edit" data-account="${esc(
        account.id
      )}">Signature editor</button>
      <span class="settings-status" id="account-signature-status" aria-live="polite"></span>
    </div>
  </div>`;
}

function settingsAccountHtml(account) {
  const error = state.sync.errors[account.id];
  const editing = state.editingAccountId === account.id;
  const stateLine = account.needs_reauth
    ? `<div class="settings-account-state error">Sign-in expired</div>`
    : error
    ? `<div class="settings-account-state error">${esc(error)}</div>`
    : "";
  return `<div class="settings-account-block">
    <div class="settings-account">
      ${avatarHtml(account, account.username)}
      <div class="settings-account-main">
        <div class="settings-account-email">${esc(account.email)}</div>
        ${stateLine}
      </div>
      <button class="link-btn" data-action="oauth-connect" title="Reconnect to refresh sign-in and account name">Reconnect</button>
      <button class="btn" data-action="account-edit" data-account="${esc(
        account.id
      )}" aria-expanded="${editing ? "true" : "false"}">Edit</button>
      <button class="btn danger" data-action="account-remove" data-account="${esc(
        account.id
      )}">Remove</button>
    </div>
    ${editing ? accountEditorHtml(account) : ""}
  </div>`;
}

function syncChoiceGroup(action, dataName, value) {
  $$(`.choice-btn[data-action="${action}"]`).forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      button.dataset[dataName] === value ? "true" : "false"
    );
  });
}

function updateAccountEditorColors() {
  const color = state.accountEditorColor;
  if (!color) return;
  $$(".account-editor .accent-swatch").forEach((swatch) => {
    const selected = String(swatch.dataset.color).toLowerCase() === color.toLowerCase();
    swatch.classList.toggle("selected", selected);
    swatch.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  const label = $(".account-editor .custom-color");
  if (label) label.style.setProperty("--swatch", color);
  const input = $(".account-editor .account-color-input");
  if (input) input.value = color;
}

async function saveAccountEditor() {
  const accountId = state.editingAccountId;
  if (!accountId) return;
  const input = $("#account-username-input");
  const status = $("#account-editor-status");
  if (!state.accountEditorColor) return;
  try {
    const defaultView = $("#account-default-view");
    const data = await api("/api/accounts/update", {
      method: "POST",
      body: {
        id: accountId,
        name: $("#account-name-input")?.value || "",
        username: input ? input.value : "",
        color: state.accountEditorColor,
        default_view_id: defaultView ? Number(defaultView.value) || null : null,
      },
    });
    state.accounts = data.state.accounts || state.accounts;
    state.counts = data.state.counts || state.counts;
    state.views = data.state.views || state.views;
    if (data.signature_html !== undefined) {
      state.signatures[accountId] = data.signature_html;
    }
    state.editingAccountId = null;
    state.accountEditorColor = null;
    state.accountEditorSignatureEnabled = false;
    state.accountEditorSignatureHtml = "";
    renderSidebar();
    renderSettings();
    renderList();
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Could not save the account.";
      status.classList.add("error");
    }
  }
}

function purifySignatureHtml(html) {
  const value = String(html || "").trim();
  if (!value) return "";
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(value, {
      ADD_ATTR: ["target", "style", "width", "height", "align"],
      ALLOW_DATA_ATTR: true,
      FORBID_TAGS: [
        "script",
        "iframe",
        "object",
        "embed",
        "form",
        "meta",
        "style",
        "link",
      ],
      FORBID_ATTR: ["contenteditable"],
    });
  }
  return `<p>${esc(value.replace(/<[^>]*>/g, " "))}</p>`;
}

function signatureFormatBarHtml() {
  return `
    <button type="button" class="format-btn" data-signature-format="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icon(
      "undo",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-format="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${icon(
      "redo",
      14
    )}</button>
    <span class="toolbar-divider" aria-hidden="true"></span>
    <button type="button" class="format-btn" data-signature-format="bold" aria-label="Bold" title="Bold">${icon(
      "bold",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-format="italic" aria-label="Italic" title="Italic">${icon(
      "italic",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-format="underline" aria-label="Underline" title="Underline">${icon(
      "underline",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-format="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list">${icon(
      "list",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-format="createLink" aria-label="Insert link" title="Insert link">${icon(
      "link",
      14
    )}</button>
    <button type="button" class="format-btn" data-signature-action="inline-image" aria-label="Insert image" title="Insert image">${icon(
      "image",
      14
    )}</button>`;
}

function signatureEditorModalHtml(account) {
  return `<div class="modal-backdrop" data-action="signature-cancel"></div>
    <div class="modal-sheet signature-modal" id="signature-editor-modal" role="dialog" aria-modal="true" aria-labelledby="signature-editor-title">
      <h2 class="modal-title" id="signature-editor-title">Signature editor for ${esc(
        account.email
      )}</h2>
      <p class="modal-text">Automatically added below message content in the composer when this account is chosen.</p>
      <div class="signature-paper">
        <div class="editor-wrap signature-editor-wrap">
          <div class="signature-sample" aria-hidden="true">
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.</p>
            <p>Donec ullamcorper nulla non metus auctor fringilla. Cras mattis consectetur purus sit amet fermentum.</p>
          </div>
          <div class="composer-editor signature-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Signature goes here...">${
            state.accountEditorSignatureHtml || ""
          }</div>
        </div>
      </div>
      <div class="format-bar signature-format-bar">${signatureFormatBarHtml()}</div>
      <input type="file" class="signature-inline-image" accept="image/*" hidden>
      <div class="signature-link-row" hidden>
        <input class="signature-link-input" type="text" autocomplete="off" spellcheck="false" placeholder="https://" aria-label="Link URL">
        <button type="button" class="btn" data-action="signature-link-insert">Insert</button>
        <button type="button" class="btn ghost" data-action="signature-link-cancel">Cancel</button>
      </div>
      <p class="signature-error" id="signature-editor-error" aria-live="polite"></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="signature-cancel">Cancel</button>
        <button type="button" class="btn accent" data-action="signature-save">Save signature</button>
      </div>
    </div>`;
}

function signatureEditorElement() {
  return $("#signature-editor-modal .signature-editor");
}

function signatureEditorWrap() {
  return $("#signature-editor-modal .signature-editor-wrap");
}

function setSignatureEditorStatus(message, error = false) {
  const host = $("#signature-editor-error");
  if (!host) return;
  host.textContent = message || "";
  host.classList.toggle("error", Boolean(error));
}

function openSignatureEditor() {
  const account = accountFor(state.editingAccountId);
  if (!account) return;
  closeSignatureEditor();
  state.signatureEditor = {
    accountId: account.id,
    html: state.accountEditorSignatureHtml || "",
    initialHtml: state.accountEditorSignatureHtml || "",
    selectedImage: null,
    contextImage: null,
    imageRange: null,
    linkRange: null,
    selectionRange: null,
    saving: false,
    confirming: false,
    keyHandler: null,
  };
  const root = $("#modal-root");
  if (!root) return;
  state.modalOpen = true;
  root.hidden = false;
  root.innerHTML = signatureEditorModalHtml(account);
  const modal = $("#signature-editor-modal", root);
  if (!modal) return;
  modal.addEventListener("mousedown", (event) => {
    if (event.target.closest(".format-btn")) {
      event.preventDefault();
      saveSignatureSelection();
    }
  });
  modal.addEventListener("click", handleSignatureModalClick);
  modal.addEventListener(
    "pointerdown",
    (event) => {
      const editor = signatureEditorElement();
      if (!editor || !state.signatureEditor?.selectedImage) return;
      if (event.target.closest(".signature-image-tools")) return;
      if (event.target.closest(".signature-editor img")) return;
      clearSignatureImageSelection();
    },
    true
  );
  modal.addEventListener("keydown", handleSignatureKeydown, true);
  modal.addEventListener("input", handleSignatureInput);
  modal.addEventListener("contextmenu", handleSignatureContextMenu);
  modal.addEventListener("paste", handleSignaturePaste);
  const file = $(".signature-inline-image", modal);
  if (file) {
    file.addEventListener("change", () => {
      insertSignatureInlineImage(file.files && file.files[0]);
      file.value = "";
    });
  }
  observeSignaturePaper();
  const editor = signatureEditorElement();
  if (editor && state.signatureEditor) {
    state.signatureEditor.initialHtml = editor.innerHTML;
    state.signatureEditor.html = editor.innerHTML;
  }
  setTimeout(() => {
    const editor = signatureEditorElement();
    if (!editor) return;
    editor.focus();
    placeCaretAtEnd(editor);
  }, 20);
}

function closeSignatureEditor() {
  clearSignatureImageSelection();
  stopSignaturePaperObserver();
  if (state.signatureEditor) {
    state.signatureEditor = null;
  }
  signatureImageResizeActive = false;
  document.body.classList.remove("composer-image-resizing");
  state.modalOpen = false;
  const root = $("#modal-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
}

function signatureEditorDirty() {
  const editor = signatureEditorElement();
  return Boolean(
    state.signatureEditor &&
      editor &&
      editor.innerHTML !== state.signatureEditor.initialHtml
  );
}

function requestCloseSignatureEditor() {
  if (!state.signatureEditor) return;
  if (state.signatureEditor.confirming) return;
  if (!signatureEditorDirty()) {
    closeSignatureEditor();
    return;
  }
  showSignatureDiscardConfirm();
}

function showSignatureDiscardConfirm() {
  if (!state.signatureEditor || state.signatureEditor.confirming) return;
  const root = $("#modal-root");
  if (!root) return;
  state.signatureEditor.confirming = true;
  const overlay = document.createElement("div");
  overlay.className = "signature-discard-overlay";
  overlay.innerHTML = `<div class="signature-discard-backdrop" data-action="signature-keep-editing"></div>
    <div class="signature-discard-sheet" role="alertdialog" aria-modal="true" aria-labelledby="signature-discard-title">
      <h2 class="modal-title" id="signature-discard-title">Discard signature changes?</h2>
      <p class="modal-text">Your changes will not be saved.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="signature-discard">Discard</button>
        <button type="button" class="btn accent" data-action="signature-keep-editing">Return to editor</button>
      </div>
    </div>`;
  root.appendChild(overlay);
  setTimeout(() => {
    $("[data-action='signature-keep-editing']", overlay)?.focus();
  }, 0);
}

function hideSignatureDiscardConfirm() {
  const overlay = $(".signature-discard-overlay");
  if (overlay) overlay.remove();
  if (state.signatureEditor) state.signatureEditor.confirming = false;
  const editor = signatureEditorElement();
  if (editor) editor.focus();
}

function saveSignatureSelection() {
  const editor = signatureEditorElement();
  if (!editor || !state.signatureEditor) return;
  const selection = window.getSelection();
  if (
    selection &&
    selection.rangeCount &&
    editor.contains(selection.anchorNode)
  ) {
    state.signatureEditor.selectionRange =
      selection.getRangeAt(0).cloneRange();
  } else {
    state.signatureEditor.selectionRange = null;
  }
}

function handleSignatureModalClick(event) {
  const editor = signatureEditorElement();
  if (!editor) return;
  if (Date.now() < signatureImageClickGuard) {
    event.preventDefault();
    return;
  }
  if (event.target.closest(".signature-sample")) {
    event.preventDefault();
    event.stopPropagation();
    toast("This is example text and will not be part of the signature.");
    return;
  }
  const format = event.target.closest("[data-signature-format]");
  if (format) {
    event.preventDefault();
    event.stopPropagation();
    applySignatureFormat(format.dataset.signatureFormat, true);
    return;
  }
  const action = event.target.closest("[data-signature-action]");
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    if (action.dataset.signatureAction === "inline-image") {
      void chooseSignatureInlineImage();
    }
    return;
  }
  const image = event.target.closest(".signature-editor img");
  if (image) {
    event.preventDefault();
    selectSignatureImage(image);
    return;
  }
  if (
    !event.target.closest(".signature-image-tools") &&
    !event.target.closest(".modal-actions") &&
    !event.target.closest(".signature-link-row")
  ) {
    clearSignatureImageSelection();
  }
}

function handleSignatureKeydown(event) {
  if (event.key === "Escape") {
    const discard = $(".signature-discard-overlay");
    if (discard) {
      event.preventDefault();
      event.stopPropagation();
      hideSignatureDiscardConfirm();
      return;
    }
    const linkRow = $(".signature-link-row");
    if (linkRow && !linkRow.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hideSignatureLinkRow();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    requestCloseSignatureEditor();
    return;
  }
  if (
    event.target.closest?.(".signature-editor") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  ) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      event.stopPropagation();
      applySignatureFormat(event.shiftKey ? "redo" : "undo", false);
      return;
    }
    if (key === "y") {
      event.preventDefault();
      event.stopPropagation();
      applySignatureFormat("redo", false);
      return;
    }
  }
  if (
    event.key === "Enter" &&
    event.target.matches?.(".signature-link-input")
  ) {
    event.preventDefault();
    event.stopPropagation();
    insertSignatureLink();
    return;
  }
  if (
    state.signatureEditor?.selectedImage &&
    event.target.closest?.(".signature-editor") &&
    !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)
  ) {
    clearSignatureImageSelection();
  }
}

function handleSignatureInput(event) {
  if (!state.signatureEditor) return;
  if (event.target.closest?.(".signature-editor")) {
    if (state.signatureEditor.selectedImage) clearSignatureImageSelection();
    state.signatureEditor.html =
      event.target.closest(".signature-editor").innerHTML;
  }
}

function handleSignatureContextMenu(event) {
  const image = event.target.closest?.(".signature-editor img");
  if (!image) return;
  event.preventDefault();
  openSignatureImageContextMenu(image, event.clientX, event.clientY);
}

async function handleSignaturePaste(event) {
  const editor = signatureEditorElement();
  if (!editor) return;
  const files = [];
  for (const item of Array.from(event.clipboardData?.items || [])) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) return;
  event.preventDefault();
  saveSignatureImageRange();
  for (const file of files) await insertSignatureInlineImage(file);
}

function applySignatureFormat(command, restoreSelection = false) {
  const editor = signatureEditorElement();
  if (!editor) return;
  if (command === "createLink") {
    openSignatureLinkRow();
    return;
  }
  editor.focus();
  if (restoreSelection && state.signatureEditor?.selectionRange) {
    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(state.signatureEditor.selectionRange);
    } catch (error) {
      /* Ignore a stale selection. */
    }
  }
  document.execCommand(command, false, null);
  if (state.signatureEditor) state.signatureEditor.html = editor.innerHTML;
}

function openSignatureLinkRow() {
  const editor = signatureEditorElement();
  const row = $(".signature-link-row");
  const input = $(".signature-link-input");
  if (!editor || !row || !input) return;
  const selection = window.getSelection();
  if (
    selection &&
    selection.rangeCount &&
    editor.contains(selection.anchorNode)
  ) {
    state.signatureEditor.linkRange = selection.getRangeAt(0).cloneRange();
  } else {
    state.signatureEditor.linkRange = null;
  }
  row.hidden = false;
  input.value = "";
  input.focus();
}

function hideSignatureLinkRow() {
  const row = $(".signature-link-row");
  if (row) row.hidden = true;
  if (state.signatureEditor) state.signatureEditor.linkRange = null;
}

function insertSignatureLink() {
  const input = $(".signature-link-input");
  const editor = signatureEditorElement();
  if (!input || !editor || !state.signatureEditor) return;
  let href = input.value.trim();
  if (!href || /^javascript:/i.test(href)) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;
  editor.focus();
  const range = state.signatureEditor.linkRange;
  if (range) {
    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (error) {
      /* Ignore stale selections. */
    }
  }
  document.execCommand("createLink", false, href);
  state.signatureEditor.html = editor.innerHTML;
  hideSignatureLinkRow();
}

function saveSignatureImageRange() {
  const editor = signatureEditorElement();
  if (!editor || !state.signatureEditor) return;
  const selection = window.getSelection();
  if (
    selection &&
    selection.rangeCount &&
    editor.contains(selection.anchorNode)
  ) {
    state.signatureEditor.imageRange = selection.getRangeAt(0).cloneRange();
  } else {
    state.signatureEditor.imageRange = null;
  }
}

async function chooseSignatureInlineImage() {
  if (!state.signatureEditor) return;
  saveSignatureImageRange();
  try {
    const data = await api("/api/choose-inline-image", {
      method: "POST",
      body: {},
    });
    const file = data && data.file;
    if (!file || !file.data) return;
    const binary = atob(file.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await insertSignatureInlineImage(
      new File([bytes], file.filename || "inline-image", {
        type: file.mime || "image/png",
      })
    );
  } catch (error) {
    if (error.status === 503) {
      $("#signature-editor-modal .signature-inline-image")?.click();
      return;
    }
    setSignatureEditorStatus(
      error.message || "Could not choose an image.",
      true
    );
  }
}

function insertSignatureInlineImage(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    setSignatureEditorStatus("Choose an image file.", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setSignatureEditorStatus(
      "Signature images must be smaller than 10 MB.",
      true
    );
    return;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const editor = signatureEditorElement();
      if (!editor || !state.signatureEditor) {
        resolve();
        return;
      }
      const dataUrl = String(reader.result || "");
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = file.name || "Signature image";
      image.style.maxWidth = "100%";
      const range = state.signatureEditor.imageRange;
      if (range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(image);
        range.setStartAfter(image);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(image);
      }
      state.signatureEditor.imageRange = null;
      state.signatureEditor.html = editor.innerHTML;
      selectSignatureImage(image);
      resolve();
    };
    reader.onerror = () => {
      setSignatureEditorStatus("Could not read the image.", true);
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

let signatureImageResizeActive = false;
let signatureImageClickGuard = 0;

function ensureSignatureImageTools() {
  const wrap = signatureEditorWrap();
  if (!wrap) return null;
  let tools = $(".signature-image-tools", wrap);
  if (tools) return tools;
  tools = document.createElement("div");
  tools.className = "composer-image-tools signature-image-tools";
  tools.hidden = true;
  tools.innerHTML = `
    <button type="button" class="composer-image-handle" data-corner="nw" aria-label="Resize image from top left" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="ne" aria-label="Resize image from top right" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="sw" aria-label="Resize image from bottom left" title="Resize"></button>
    <button type="button" class="composer-image-handle" data-corner="se" aria-label="Resize image from bottom right" title="Resize"></button>
    <div class="composer-image-actions" role="group" aria-label="Image size">
      <button type="button" class="composer-image-action" data-image-size="small">Small</button>
      <button type="button" class="composer-image-action" data-image-size="original">Original Size</button>
    </div>`;
  wrap.appendChild(tools);
  tools.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest?.(".composer-image-handle");
    if (!handle) return;
    startSignatureImageResize(event, handle.dataset.corner || "se");
  });
  tools.addEventListener("click", (event) => {
    const button = event.target.closest?.(".composer-image-action");
    if (!button || !state.signatureEditor?.selectedImage) return;
    event.preventDefault();
    const image = state.signatureEditor.selectedImage;
    const natural = image.naturalWidth || composerImageWidth(image);
    const target =
      button.dataset.imageSize === "original"
        ? natural
        : Math.min(200, natural || 200);
    setSignatureImageWidth(image, target);
  });
  wrap.addEventListener(
    "scroll",
    () => {
      if (state.signatureEditor?.selectedImage) {
        positionSignatureImageTools();
      }
    },
    { passive: true }
  );
  return tools;
}

function positionSignatureImageTools() {
  const image = state.signatureEditor?.selectedImage;
  const wrap = signatureEditorWrap();
  const tools = $("#signature-editor-modal .signature-image-tools");
  const editor = signatureEditorElement();
  if (!state.signatureEditor || !image || !image.isConnected || !wrap || !tools) {
    if (tools) tools.hidden = true;
    if (state.signatureEditor) state.signatureEditor.selectedImage = null;
    if (editor) editor.classList.remove("has-image-tools");
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  const rect = image.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    tools.hidden = true;
    if (editor) editor.classList.remove("has-image-tools");
    return;
  }
  tools.hidden = false;
  tools.style.left = `${rect.left - wrapRect.left + wrap.scrollLeft}px`;
  tools.style.top = `${rect.top - wrapRect.top + wrap.scrollTop}px`;
  tools.style.width = `${rect.width}px`;
  tools.style.height = `${rect.height}px`;
  const actions = $(".composer-image-actions", tools);
  if (actions) {
    const actionWidth = actions.offsetWidth || 0;
    if (rect.left + actionWidth > wrapRect.right - 6) {
      actions.style.left = "auto";
      actions.style.right = "0";
    } else {
      actions.style.left = "0";
      actions.style.right = "auto";
    }
  }
  if (editor) editor.classList.add("has-image-tools");
}

function revealSignatureImageTools() {
  const wrap = signatureEditorWrap();
  const image = state.signatureEditor?.selectedImage;
  const tools = $("#signature-editor-modal .signature-image-tools");
  if (!wrap || !image || !tools || tools.hidden) return;
  const wrapRect = wrap.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const actions = $(".composer-image-actions", tools);
  const actionRect = actions ? actions.getBoundingClientRect() : imageRect;
  const top = Math.min(imageRect.top, actionRect.top);
  const bottom = Math.max(imageRect.bottom, actionRect.bottom);
  if (imageRect.height >= wrapRect.height - 20) {
    wrap.scrollTop += Math.max(0, bottom - wrapRect.bottom + 4);
    return;
  }
  if (bottom > wrapRect.bottom - 4) {
    wrap.scrollTop += bottom - wrapRect.bottom + 4;
  }
  if (top < wrapRect.top + 4) {
    wrap.scrollTop -= wrapRect.top + 4 - top;
  }
}

function selectSignatureImage(image) {
  const editor = signatureEditorElement();
  if (!state.signatureEditor || !editor || !image || !editor.contains(image)) {
    return;
  }
  state.signatureEditor.selectedImage = image;
  ensureSignatureImageTools();
  positionSignatureImageTools();
  window.requestAnimationFrame(() => {
    if (state.signatureEditor?.selectedImage === image) {
      positionSignatureImageTools();
      revealSignatureImageTools();
    }
  });
  if (!image.complete) {
    image.addEventListener("load", positionSignatureImageTools, {
      once: true,
    });
  }
}

function clearSignatureImageSelection() {
  if (state.signatureEditor) state.signatureEditor.selectedImage = null;
  const tools = $("#signature-editor-modal .signature-image-tools");
  if (tools) tools.hidden = true;
  const editor = signatureEditorElement();
  if (editor) editor.classList.remove("has-image-tools");
}

function setSignatureImageWidth(image, width, reveal = true) {
  if (!image || !image.isConnected) return;
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  const floor = Math.min(24, naturalWidth || 24);
  let target = Math.max(floor, Math.round(Number(width) || 0));
  if (naturalWidth) target = Math.min(target, naturalWidth);
  image.style.width = `${target}px`;
  image.style.height = "auto";
  image.style.maxWidth = "100%";
  image.setAttribute("width", String(target));
  if (naturalWidth && naturalHeight) {
    image.setAttribute(
      "height",
      String(Math.max(1, Math.round((target * naturalHeight) / naturalWidth)))
    );
  } else {
    image.removeAttribute("height");
  }
  positionSignatureImageTools();
  if (reveal) {
    window.requestAnimationFrame(() => {
      if (state.signatureEditor?.selectedImage === image) {
        positionSignatureImageTools();
        revealSignatureImageTools();
      }
    });
  }
  const editor = signatureEditorElement();
  if (editor && state.signatureEditor) {
    state.signatureEditor.html = editor.innerHTML;
  }
}

function signatureContextImage() {
  const image = state.signatureEditor?.contextImage;
  const editor = signatureEditorElement();
  if (!state.signatureEditor || !image || !image.isConnected || !editor) {
    return null;
  }
  return editor.contains(image) ? image : null;
}

function openSignatureImageContextMenu(image, x, y) {
  if (!state.signatureEditor || !image || !image.isConnected) return;
  selectSignatureImage(image);
  state.signatureEditor.contextImage = image;
  openMenuAt(x, y, [
    { label: "Small", action: "signature-image-small", icon: "minimize" },
    {
      label: "Original Size",
      action: "signature-image-original",
      icon: "maximize",
    },
    {
      label: "Delete image",
      action: "signature-image-delete",
      icon: "trash",
    },
  ]);
}

function resizeSignatureContextImage(preset) {
  const image = signatureContextImage();
  if (!image) return;
  const natural = image.naturalWidth || composerImageWidth(image);
  const target =
    preset === "original" ? natural : Math.min(200, natural || 200);
  setSignatureImageWidth(image, target);
  selectSignatureImage(image);
}

function deleteSignatureImage(image = signatureContextImage()) {
  if (!state.signatureEditor || !image) return;
  if (state.signatureEditor.selectedImage === image) {
    clearSignatureImageSelection();
  }
  image.remove();
  state.signatureEditor.contextImage = null;
  const editor = signatureEditorElement();
  if (editor) state.signatureEditor.html = editor.innerHTML;
}

function startSignatureImageResize(event, corner) {
  const image = state.signatureEditor?.selectedImage;
  if (!image || !image.isConnected) return;
  const editor = signatureEditorElement();
  const startX = event.clientX;
  const startWidth = image.getBoundingClientRect().width;
  if (!startWidth) return;
  event.preventDefault();
  event.stopPropagation();
  const naturalWidth = image.naturalWidth || startWidth;
  const available = editor
    ? Math.max(24, editor.clientWidth - 28)
    : naturalWidth;
  const maxWidth = Math.max(
    startWidth,
    Math.min(naturalWidth, available)
  );
  const handleElement =
    event.target.closest?.(".composer-image-handle") || null;
  let hintShown = false;
  let currentWidth = startWidth;
  signatureImageResizeActive = true;
  document.body.classList.add("composer-image-resizing");
  const move = (moveEvent) => {
    if (!image.isConnected) return;
    const delta = moveEvent.clientX - startX;
    const signed = corner.endsWith("w") ? -delta : delta;
    const wanted = startWidth + signed;
    if (wanted <= naturalWidth + 0.5) hintShown = false;
    if (
      naturalWidth &&
      wanted > naturalWidth + 0.5 &&
      maxWidth >= naturalWidth - 0.5 &&
      !hintShown
    ) {
      const anchor = handleElement
        ? handleElement.getBoundingClientRect()
        : null;
      showCursorHint(
        "Already at original size",
        anchor ? anchor.right + 10 : moveEvent.clientX + 12,
        anchor ? anchor.top + anchor.height / 2 : moveEvent.clientY
      );
      hintShown = true;
    }
    const next = Math.max(24, Math.min(wanted, maxWidth));
    if (Math.abs(next - currentWidth) < 0.5) return;
    currentWidth = next;
    setSignatureImageWidth(image, next, false);
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", finish);
    signatureImageResizeActive = false;
    signatureImageClickGuard = Date.now() + 300;
    document.body.classList.remove("composer-image-resizing");
    if (image.isConnected) setSignatureImageWidth(image, currentWidth);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
  window.addEventListener("blur", finish);
}

async function saveSignatureEditor() {
  const editor = signatureEditorElement();
  if (!editor || !state.signatureEditor || state.signatureEditor.saving) return;
  const html = purifySignatureHtml(editor.innerHTML);
  const bytes = new Blob([html]).size;
  if (bytes > SIGNATURE_BYTES_LIMIT) {
    setSignatureEditorStatus(
      `Signature is too large (${formatComposerSize(bytes)}). Use smaller images.`,
      true
    );
    return;
  }
  state.signatureEditor.saving = true;
  setSignatureEditorStatus("Saving signature…");
  const accountId = state.signatureEditor.accountId;
  try {
    const data = await api("/api/accounts/update", {
      method: "POST",
      body: {
        id: accountId,
        signature_enabled: true,
        signature_html: html,
      },
    });
    state.accounts = data.state.accounts || state.accounts;
    state.counts = data.state.counts || state.counts;
    state.views = data.state.views || state.views;
    state.signatures[accountId] = String(data.signature_html || "");
    state.accountEditorSignatureHtml = state.signatures[accountId];
    state.accountEditorSignatureEnabled = true;
    const status = $("#account-signature-status");
    if (status) {
      status.textContent = state.signatures[accountId].trim()
        ? "Signature saved"
        : "Signature cleared";
      status.classList.remove("error");
    }
    closeSignatureEditor();
  } catch (error) {
    if (state.signatureEditor) state.signatureEditor.saving = false;
    setSignatureEditorStatus(
      error.message || "Could not save the signature.",
      true
    );
  }
}

function viewLabelsForAccount(accountId) {
  const system = [
    { id: "INBOX", name: "Inbox" },
    { id: "STARRED", name: "Starred" },
    { id: "SENT", name: "Sent" },
    { id: "DRAFT", name: "Drafts" },
    { id: "SPAM", name: "Spam" },
    { id: "TRASH", name: "Trash" },
  ];
  const user = (state.labels || [])
    .filter((label) => label.ids && label.ids[accountId])
    .map((label) => ({
      id: String(label.ids[accountId]),
      name: label.name,
    }));
  const seen = new Set();
  return [...system, ...user].filter((label) => {
    if (seen.has(label.id)) return false;
    seen.add(label.id);
    return true;
  });
}

function viewLabelOptions(kind, selected) {
  return viewLabelsForAccount(state.viewEditor?.accountId)
    .map(
      (label) =>
        `<label class="view-label-option"><input type="checkbox" data-view-label="${kind}" value="${esc(
          label.id
        )}" ${
          selected.has(label.id) ? "checked" : ""
        }><span>${esc(label.name)}</span></label>`
    )
    .join("");
}

function openViewEditor(accountId, view = null) {
  const account = accountFor(accountId);
  if (!account) return;
  closeViewEditor();
  const root = $("#modal-root");
  if (!root) return;
  state.viewEditor = { accountId, view };
  state.modalOpen = true;
  const filters = (view && view.filters) || {};
  const includeLabels = new Set(
    (filters.include_labels || []).map(String)
  );
  const excludeLabels = new Set(
    (filters.exclude_labels || []).map(String)
  );
  root.hidden = false;
  root.innerHTML = `<div class="modal-backdrop" data-action="view-cancel"></div>
    <div class="modal-sheet view-modal" role="dialog" aria-modal="true" aria-labelledby="view-editor-title">
      <h2 class="modal-title" id="view-editor-title">${
        view ? "Edit custom view" : "Create custom view"
      }</h2>
      <p class="modal-text">${esc(
        account.email
      )}. Views filter this account's mail.</p>
      <div class="view-field">
        <label for="view-name">Name</label>
        <input id="view-name" class="view-input" type="text" maxlength="60" autocomplete="off" spellcheck="false" value="${esc(
          view ? view.name : ""
        )}" placeholder="Inbox without support">
      </div>
      <div class="view-columns">
        <section class="view-section">
          <h3>Include labels</h3>
          <div class="view-label-list">${viewLabelOptions(
            "include",
            includeLabels
          )}</div>
          <p class="view-hint">Threads must have every selected label.</p>
        </section>
        <section class="view-section">
          <h3>Exclude labels</h3>
          <div class="view-label-list">${viewLabelOptions(
            "exclude",
            excludeLabels
          )}</div>
        </section>
      </div>
      <div class="view-field">
        <label for="view-include-senders">Include senders</label>
        <input id="view-include-senders" class="view-input" type="text" autocomplete="off" spellcheck="false" value="${esc(
          (filters.include_senders || []).join(", ")
        )}" placeholder="ana@example.com, @northstar.example">
        <p class="view-hint">Comma-separated addresses or name fragments. All must match.</p>
      </div>
      <div class="view-field">
        <label for="view-exclude-senders">Exclude senders</label>
        <input id="view-exclude-senders" class="view-input" type="text" autocomplete="off" spellcheck="false" value="${esc(
          (filters.exclude_senders || []).join(", ")
        )}" placeholder="support@, no-reply@">
      </div>
      <div class="view-columns">
        <div class="view-field">
          <label for="view-include-subject">Include subject regex</label>
          <input id="view-include-subject" class="view-input" type="text" autocomplete="off" spellcheck="false" value="${esc(
            filters.include_subject || ""
          )}" placeholder="invoice|receipt">
        </div>
        <div class="view-field">
          <label for="view-exclude-subject">Exclude subject regex</label>
          <input id="view-exclude-subject" class="view-input" type="text" autocomplete="off" spellcheck="false" value="${esc(
            filters.exclude_subject || ""
          )}" placeholder="out of office">
        </div>
      </div>
      <p class="view-error" id="view-editor-error" aria-live="polite"></p>
      <div class="modal-actions">
        ${
          view
            ? `<button class="btn danger" data-action="view-delete">Delete</button>`
            : ""
        }
        <span class="toolbar-spacer"></span>
        <button class="btn" data-action="view-cancel">Cancel</button>
        <button class="btn accent" data-action="view-save">Save</button>
      </div>
    </div>`;
  const keyHandler = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeViewEditor();
    }
  };
  state.viewEditorKeyHandler = keyHandler;
  document.addEventListener("keydown", keyHandler, true);
  window.setTimeout(() => $("#view-name")?.focus(), 20);
}

function closeViewEditor() {
  if (state.viewEditorKeyHandler) {
    document.removeEventListener(
      "keydown",
      state.viewEditorKeyHandler,
      true
    );
  }
  state.viewEditorKeyHandler = null;
  state.viewEditor = null;
  state.modalOpen = false;
  const root = $("#modal-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
}

function splitViewList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function saveViewEditor() {
  const editor = state.viewEditor;
  if (!editor) return;
  const errorHost = $("#view-editor-error");
  const name = ($("#view-name")?.value || "").trim();
  if (!name) {
    if (errorHost) errorHost.textContent = "Name the view.";
    return;
  }
  const filters = {
    include_labels: $$(
      '#modal-root input[data-view-label="include"]:checked'
    ).map((input) => input.value),
    exclude_labels: $$(
      '#modal-root input[data-view-label="exclude"]:checked'
    ).map((input) => input.value),
    include_senders: splitViewList(
      $("#view-include-senders")?.value
    ),
    exclude_senders: splitViewList(
      $("#view-exclude-senders")?.value
    ),
    include_subject: ($("#view-include-subject")?.value || "").trim(),
    exclude_subject: ($("#view-exclude-subject")?.value || "").trim(),
  };
  for (const key of ["include_subject", "exclude_subject"]) {
    if (!filters[key]) continue;
    try {
      new RegExp(filters[key]);
    } catch (error) {
      if (errorHost) {
        errorHost.textContent = `Invalid regex: ${error.message}`;
      }
      return;
    }
  }
  try {
    const data = await api("/api/views/save", {
      method: "POST",
      body: {
        id: editor.view ? editor.view.id : null,
        account: editor.accountId,
        name,
        filters,
      },
    });
    state.views = data.state.views || state.views;
    state.accounts = data.state.accounts || state.accounts;
    state.counts = data.state.counts || state.counts;
    const saved = data.view;
    closeViewEditor();
    renderSidebar();
    renderSettings();
    if (saved) {
      if (
        Number(state.viewId) === Number(saved.id) ||
        !editor.view
      ) {
        selectView(saved.id);
      }
    }
  } catch (error) {
    if (errorHost) errorHost.textContent = error.message;
  }
}

async function confirmDeleteView(view) {
  if (!view) return;
  const confirmed = await showModal({
    title: "Delete view?",
    message: `Delete "${view.name}"? Mail is not affected.`,
    confirmLabel: "Delete",
    cancelLabel: "Keep view",
    danger: true,
  });
  if (!confirmed) return;
  try {
    const data = await api("/api/views/delete", {
      method: "POST",
      body: { id: view.id },
    });
    state.views = data.state.views || [];
    state.accounts = data.state.accounts || state.accounts;
    state.counts = data.state.counts || state.counts;
    if (Number(state.viewId) === Number(view.id)) {
      state.viewId = null;
      state.viewTotal = 0;
      state.folder = "inbox";
      state.labelName = null;
      state.remoteHasMore = true;
      clearSelection();
      renderSidebar();
      renderList();
      renderReader();
      updateReaderPane();
      loadThreads();
    } else {
      renderSidebar();
      renderSettings();
    }
    toast("View deleted");
  } catch (error) {
    toast(error.message || "Could not delete the view", true);
  }
}

async function deleteViewEditor() {
  const view = state.viewEditor?.view;
  if (!view) return;
  closeViewEditor();
  await confirmDeleteView(view);
}

function openViewContextMenu(view, x, y) {
  if (!view) return;
  openMenuAt(x, y, [
    {
      label: "Edit view",
      action: "view-edit",
      icon: "settings",
      attrs: `data-view="${view.id}"`,
    },
    {
      label: "Delete view",
      action: "view-delete-menu",
      icon: "trash",
      attrs: `data-view="${view.id}"`,
    },
  ]);
}

async function setRefreshMode(mode) {
  if (!["fast", "balanced", "manual"].includes(mode)) return;
  try {
    const settings = await api("/api/settings", {
      method: "POST",
      body: { refresh_mode: mode },
    });
    state.settings = Object.assign({}, state.settings, settings);
    syncChoiceGroup("refresh-mode", "mode", mode);
    if (mode !== "manual") {
      await api("/api/sync", { method: "POST", body: {} });
      schedulePoll(1200);
    }
  } catch (error) {
    toast(error.message || "Could not change refresh mode", true);
  }
}

function renderSettings() {
  const pane = $("#settings-pane");
  pane.hidden = !state.settingsOpen;
  if (!state.settingsOpen) return;
  const scroll = pane.scrollTop;
  const settings = state.settings;
  pane.innerHTML = `<header class="settings-head">
    <div class="settings-head-inner"><h1>Settings</h1></div>
  </header>
  <div class="settings-inner">
    <section class="settings-section" data-section="accounts">
      <h2>Accounts</h2>
      <div class="settings-group">
        ${state.accounts.map(settingsAccountHtml).join("")}
        <div class="settings-actions">
          <button class="btn accent" data-action="oauth-connect">Add Google account</button>
          ${oauthStatusHtml()}
        </div>
        <div class="setup-callout">
          <div class="setup-callout-copy">
            <strong>Google Cloud setup</strong>
            <p>Courier uses your own Google Cloud OAuth client. Import the client JSON once; Courier never ships a client secret.</p>
            <p class="settings-note">${
              settings.oauth_client_configured
                ? `Client configured: ${esc(settings.oauth_client_id)}`
                : "No OAuth client imported yet."
            }</p>
          </div>
          <button class="btn" data-action="google-setup-open">Open setup guide</button>
        </div>
      </div>
    </section>

    <section class="settings-section" data-section="appearance">
      <h2>Appearance</h2>
      <div class="settings-group">
        <div class="field-grid">
          <label>Theme</label>
          <div class="theme-grid">${THEMES.map(themeTile).join("")}</div>
        </div>
        <div class="field-grid">
          <label>Email theme</label>
          <div class="email-theme-field">
            <div class="theme-grid email-theme-grid">${Object.entries(
              EMAIL_THEMES
            )
              .map(([id, theme]) => emailThemeTile(id, theme))
              .join("")}</div>
            <p class="settings-note">Used for plain-text messages. HTML mail keeps its own design.</p>
          </div>
        </div>
        <div class="field-grid">
          <label>Accent</label>
          <div class="theme-swatches">
            ${ACCENTS.map(accentSwatch).join("")}
            <label class="custom-color" title="Custom accent">
              <input type="color" value="${esc(state.prefs.accent)}" aria-label="Custom accent colour">
              <span class="custom-color-ring" aria-hidden="true"></span>
            </label>
          </div>
        </div>
        <div class="field-grid">
          <label>Account badge</label>
          ${choiceGroup("badge-position", "position", state.prefs.badgePosition || "before-subject", [
            { value: "before-sender", label: "Before sender" },
            { value: "after-sender", label: "After sender" },
            { value: "before-subject", label: "Before subject" },
            { value: "after-subject", label: "After subject" },
          ])}
        </div>
        <div class="field-grid">
          <label>Label</label>
          ${choiceGroup("label-position", "position", state.prefs.labelPosition || "after-subject", [
            { value: "before-sender", label: "Before sender" },
            { value: "after-sender", label: "After sender" },
            { value: "before-subject", label: "Before subject" },
            { value: "after-subject", label: "After subject" },
          ])}
        </div>
      </div>
    </section>

    <section class="settings-section" data-section="reading">
      <h2>Reading</h2>
      <div class="settings-group">
        <div class="pref-row">
          <div class="pref-row-label">Hide signatures</div>
          <label class="switch"><input type="checkbox" data-pref="hideSignatures" aria-label="Hide signatures" ${
            state.prefs.hideSignatures ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Hide quoted text</div>
          <label class="switch"><input type="checkbox" data-pref="hideQuotes" aria-label="Hide quoted text" ${
            state.prefs.hideQuotes ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Block remote images</div>
          <label class="switch"><input type="checkbox" data-pref="blockImages" aria-label="Block remote images" ${
            state.prefs.blockImages ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Message width</div>
          ${choiceGroup("content-width", "width", state.prefs.contentWidth || "wide", [
            { value: "standard", label: "Standard" },
            { value: "wide", label: "Wide" },
            { value: "full", label: "Full" },
          ])}
        </div>
      </div>
    </section>

    <section class="settings-section" data-section="window">
      <h2>Window</h2>
      <div class="settings-group">
        <div class="pref-row">
          <div class="pref-row-label">When minimised</div>
          ${choiceGroup("minimize-behavior", "behavior", state.prefs.minimizeBehavior || "default", [
            { value: "default", label: "Normal" },
            { value: "tray", label: "Hide in tray" },
          ])}
        </div>
        <div class="pref-row">
          <div class="pref-row-label">When closed</div>
          ${choiceGroup("close-behavior", "behavior", state.prefs.closeBehavior || "tray", [
            { value: "tray", label: "Keep in tray" },
            { value: "quit", label: "Quit Courier" },
          ])}
        </div>
        <div class="pref-row">
          <div class="pref-row-label">At login</div>
          ${choiceGroup("login-startup", "mode", state.prefs.loginStartup || "off", [
            { value: "off", label: "Do not start" },
            { value: "minimized", label: "Start minimised" },
            { value: "foreground", label: "Start in foreground" },
          ])}
        </div>
        <p class="settings-note">Keeping Courier in the tray lets background mail checks continue after the window is closed.</p>
      </div>
    </section>

    <section class="settings-section" data-section="updates">
      <h2>Updates</h2>
      <div class="settings-group">
        <div class="pref-row">
          <div class="pref-row-label">Check automatically</div>
          <label class="switch"><input type="checkbox" data-pref="updateAuto" aria-label="Check for updates automatically" ${
            state.prefs.updateAuto ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <p class="settings-note">${
          state.prefs.updateAuto
            ? `Courier checks GitHub for new releases every ${
                Number(state.prefs.updateInterval) === 1
                  ? "hour"
                  : `${Number(state.prefs.updateInterval) || 5} hours`
              }.`
            : "Courier will check GitHub for new releases periodically if this is on. Automatic checks are off by default."
        }</p>
        ${
          state.prefs.updateAuto
            ? `<div class="pref-row" id="update-interval-row">
                <div class="pref-row-label">Check every</div>
                ${choiceGroup(
                  "update-interval",
                  "hours",
                  String(state.prefs.updateInterval || 5),
                  [
                    { value: "1", label: "1 hour" },
                    { value: "5", label: "5 hours" },
                    { value: "8", label: "8 hours" },
                  ]
                )}
              </div>`
            : ""
        }
        <div class="settings-actions">
          <button class="btn" id="update-check-btn" data-action="update-check" ${
            state.updateChecking ? "disabled" : ""
          }>${state.updateChecking ? "Checking…" : "Check GitHub for updates"}</button>
          ${updateStatusHtml()}
        </div>
        <div class="settings-actions" id="update-action-row" hidden></div>
        <p class="settings-note" id="update-mode-note" hidden></p>
        <p class="settings-note">${
          state.version ? `Courier ${esc(state.version)}. ` : ""
        }Updates are checked against github.com/joelis10/courier. Installed packages can download and install a new release here; source checkouts are never changed.</p>
      </div>
    </section>

    <section class="settings-section" data-section="notifications">
      <h2>Notifications</h2>
      <div class="settings-group">
        <div class="pref-row">
          <div class="pref-row-label">Show notifications</div>
          <label class="switch"><input type="checkbox" data-pref="notifyEnabled" aria-label="Show notifications" ${
            state.prefs.notifyEnabled ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Archived mail</div>
          <label class="switch"><input type="checkbox" data-pref="notifyArchived" aria-label="Notify for archived mail" ${
            state.prefs.notifyArchived ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <p class="settings-note">Mail without the Inbox label stays quiet unless archived notifications are on.</p>
        <div class="pref-row notify-sound-row">
          <div class="pref-row-label">Sound</div>
          <div class="notify-sound-field">
            <select id="notify-sound-select" class="settings-select" aria-label="Notification sound">
              ${[
                ["soft-knock", "Soft knock"],
                ["bell", "Gentle bell"],
                ["message", "Message"],
                ["complete", "Complete"],
                ["attention", "Attention"],
                ["system", "System notification sound"],
                ["none", "None"],
                ["custom", "Custom sound"],
              ]
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${
                      state.prefs.notifySound === value ? "selected" : ""
                    }>${label}</option>`
                )
                .join("")}
            </select>
            <button id="notify-upload-btn" class="btn" data-action="notify-upload" hidden>Choose file</button>
            <input id="notification-sound-file" type="file" accept="audio/*" hidden>
            <span id="notify-sound-name" class="settings-status"></span>
          </div>
        </div>
        <div class="pref-row" id="notify-volume-row">
          <div class="pref-row-label">Volume</div>
          <div class="notify-volume">
            <input id="notify-volume" type="range" min="0" max="100" step="5" value="${Number(
              state.prefs.notifyVolume
            ) || 0}" aria-label="Notification volume">
            <span id="notify-volume-label">${Number(
              state.prefs.notifyVolume
            ) || 0}%</span>
          </div>
        </div>
        <div class="settings-cluster">
          <div class="pref-row">
            <div class="pref-row-label">Show account</div>
            <label class="switch"><input type="checkbox" data-pref="notifyShowAccount" aria-label="Show account in notifications" ${
              state.prefs.notifyShowAccount ? "checked" : ""
            }><span class="switch-track"><span class="switch-knob"></span></span></label>
          </div>
          <div class="pref-row" id="notify-badge-row" ${state.prefs.notifyShowAccount ? "" : "hidden"}>
            <div class="pref-row-label">Account badge</div>
            ${choiceGroup("notify-badge-position", "position", state.prefs.notifyBadgePosition || "before-subject", [
              { value: "before-sender", label: "Before sender" },
              { value: "after-sender", label: "After sender" },
              { value: "before-subject", label: "Before subject" },
              { value: "after-subject", label: "After subject" },
            ])}
          </div>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Test notification</div>
          <button class="btn" data-action="notify-test">Send test</button>
        </div>
      </div>
    </section>

    <section class="settings-section" data-section="mail">
      <h2>Mail</h2>
      <div class="settings-group">
        <div class="pref-row">
          <div class="pref-row-label">Check for mail</div>
          ${choiceGroup("refresh-mode", "mode", settings.refresh_mode || "fast", [
            { value: "fast", label: "10 seconds" },
            { value: "balanced", label: "1 minute" },
            { value: "manual", label: "Manual" },
          ])}
        </div>
      </div>
    </section>

    <section class="settings-section" data-section="ai">
      <h2>AI summaries</h2>
      <div class="settings-group">
        <div class="settings-warning">
          <strong>Third-party endpoint</strong>
          <p>AI summaries send the selected email text to the endpoint you configure. Courier does not operate or control that service. You are responsible for the endpoint, its privacy and retention terms, and the data you choose to share.</p>
        </div>
        <div class="pref-row">
          <div class="pref-row-label">Enable AI summaries</div>
          <label class="switch"><input id="ai-enabled-toggle" type="checkbox" data-pref="aiEnabled" aria-label="Enable AI summaries" ${
            state.prefs.aiEnabled ? "checked" : ""
          }><span class="switch-track"><span class="switch-knob"></span></span></label>
        </div>
        <p class="settings-note">${
          state.prefs.aiEnabled
            ? "Once the endpoint below is configured, this makes the <strong>Summary</strong> and <strong>Summarize</strong> actions available across Courier."
            : "Turn this on to reveal the endpoint fields. Once configured, the Summary and Summarize actions appear across Courier."
        } Reader summaries are sent only when you choose one.</p>
        ${
          state.prefs.aiEnabled
            ? `
        <div class="field-grid">
          <label for="ai-base-url">Base URL</label>
          <input id="ai-base-url" type="url" autocomplete="off" spellcheck="false" value="${esc(
            settings.ai_base_url || ""
          )}" placeholder="https://api.openai.com/v1">
        </div>
        <div class="field-grid">
          <label for="ai-model">Model</label>
          <input id="ai-model" type="text" autocomplete="off" spellcheck="false" value="${esc(
            settings.ai_model || ""
          )}" placeholder="gpt-4o-mini">
        </div>
        <div class="field-grid">
          <label for="ai-key">API key</label>
          <input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="${
            settings.ai_api_key_set ? "Saved" : "API key"
          }">
        </div>
        <div class="settings-actions">
          <button class="btn accent" data-action="ai-save">Save</button>
          <button class="btn" data-action="ai-test">Test</button>
          ${
            settings.ai_api_key_set
              ? `<button class="link-btn" data-action="ai-clear-key">Forget key</button>`
              : ""
          }
          ${aiStatusHtml()}
        </div>
        ${
          settings.ai_configured
            ? ""
            : `<p class="settings-note">Set the endpoint, model, and API key to use summaries.</p>`
        }
        <div class="settings-cluster">
          <div class="pref-row">
            <div class="pref-row-label">Use AI summary in notifications</div>
            <label class="switch"><input type="checkbox" data-pref="notifyUseAI" aria-label="Use AI summary in notifications" ${
              state.prefs.notifyUseAI ? "checked" : ""
            }><span class="switch-track"><span class="switch-knob"></span></span></label>
          </div>
          <p class="settings-note" id="notify-ai-note" ${state.prefs.notifyUseAI ? "" : "hidden"}>New-message notifications use the same endpoint and run automatically when enabled. If it does not answer within eight seconds, the regular sender, subject, and preview notification is shown.</p>
          <div class="pref-row" id="notify-ai-threshold" ${state.prefs.notifyUseAI ? "" : "hidden"}>
            <div class="pref-row-label">Only when longer than</div>
            <div class="notify-threshold">
              <input id="notify-ai-chars" type="number" min="80" max="5000" step="50" value="${Number(
                state.prefs.notifyAIMinChars
              ) || 400}" aria-label="Minimum characters for AI notification">
              <span>characters</span>
            </div>
          </div>
        </div>
        `
            : ""
        }
      </div>
    </section>
  </div>`;
  updateNotificationSoundUi();
  refreshUpdateStatus();
  pane.scrollTop = scroll;
  if (state.settingsFocus) {
    const target = $(`[data-section="${state.settingsFocus}"]`, pane);
    if (target) {
      if (state.settingsFocus === "accounts") {
        pane.scrollTop = 0;
      } else {
        target.scrollIntoView({ block: "start" });
      }
      const input =
        state.settingsFocus === "ai"
          ? $("#ai-base-url", pane) || $("#ai-enabled-toggle", pane)
          : state.settingsFocus === "updates"
            ? $("#update-check-btn", pane)
            : $('[data-action="google-setup-open"]', pane);
      if (input) setTimeout(() => input.focus({ preventScroll: true }), 20);
    }
    state.settingsFocus = null;
  }
}

function setOAuthStatus(html, error = false) {
  state.oauthStatus = { html, error };
  const host = $("#oauth-status");
  if (host) {
    host.innerHTML = html;
    host.classList.toggle("error", error);
  }
}

function setAIStatus(html, error = false) {
  state.aiStatus = { html, error };
  const host = $("#ai-status");
  if (host) {
    host.innerHTML = html;
    host.classList.toggle("error", error);
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering: shell / modes                                                   */
/* -------------------------------------------------------------------------- */

function renderAll() {
  applyPrefs(false);
  renderSidebar();
  renderList();
  renderReader();
  renderComposer();
  renderSettings();
  updateReaderPane();
}

function dismissSettingsPage() {
  if (!state.settingsOpen) return;
  state.settingsOpen = false;
  const pane = $("#settings-pane");
  if (pane) pane.hidden = true;
  updateReaderPane();
  renderSidebar();
}

function openSettings(focus = null) {
  if (state.settingsOpen && (!focus || focus === state.settingsFocus)) {
    if (focus) {
      state.settingsFocus = focus;
      renderSettings();
    }
    if (focus === "updates") refreshUpdateOperation();
    return;
  }
  if (state.composer) captureComposerFields();
  state.settingsOpen = true;
  state.settingsFocus = focus;
  state.focusEmail = false;
  state.readerScroll = $("#reader")?.scrollTop || 0;
  closeMenu();
  renderSettings();
  updateReaderPane();
  renderSidebar();
  if (focus === "updates") refreshUpdateOperation();
}

async function refreshUpdateOperation() {
  await loadUpdateOperation({ quiet: true });
  scheduleUpdatePoll();
}

function closeSettings() {
  if (!state.accounts.length) return;
  if (state.composer) captureComposerFields();
  state.settingsOpen = false;
  $("#settings-pane").hidden = true;
  renderAll();
  const reader = $("#reader");
  if (reader) reader.scrollTop = state.readerScroll || 0;
  if (!state.threads.length) loadThreads({ quiet: true });
}

function selectFolder(folderId) {
  if (!folderById(folderId)) return;
  dismissSettingsPage();
  if (
    state.folder === folderId &&
    !state.labelName &&
    !state.viewId &&
    !state.searchMode &&
    !state.query &&
    !state.unreadOnly
  ) {
    return;
  }
  if (state.composer) closeComposer();
  closeSummary();
  state.folder = folderId;
  state.labelName = null;
  state.viewId = null;
  state.viewTotal = 0;
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = true;
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  loadThreads();
}

function selectView(viewId) {
  const view = viewById(viewId);
  if (!view) return;
  dismissSettingsPage();
  if (state.composer) closeComposer();
  closeSummary();
  focusSidebarAccount(view.account_id);
  state.accountFilter = view.account_id;
  state.viewId = view.id;
  state.viewTotal = 0;
  state.labelName = null;
  state.folder = "inbox";
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  state.unreadOnly = false;
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = false;
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  loadThreads();
}

function setAccountFilter(accountId) {
  dismissSettingsPage();
  const next =
    state.accountFilter === accountId && !state.viewId
      ? null
      : accountId;
  if (state.accountFilter === next && !state.viewId) {
    renderList();
    return;
  }
  if (state.composer) closeComposer();
  closeSummary();
  focusSidebarAccount(next || "all");
  if (next && state.labelName && !accountHasLabel(next, state.labelName)) {
    state.labelName = null;
  }
  state.accountFilter = next;
  const account = next ? accountFor(next) : null;
  const defaultView =
    account && account.default_view_id
      ? viewById(account.default_view_id)
      : null;
  state.viewId = defaultView ? defaultView.id : null;
  state.viewTotal = 0;
  if (defaultView) {
    state.labelName = null;
    state.folder = "inbox";
  }
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = !state.viewId;
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  loadThreads();
}

function selectLabel(name, accountId = undefined) {
  if (!name) return;
  if (accountId === "all") {
    focusSidebarAccount("all");
    state.accountFilter = null;
  } else if (accountId) {
    const account = accountFor(accountId);
    if (account) {
      focusSidebarAccount(account.id);
      state.accountFilter = account.id;
    }
  } else if (!state.accountFilter) {
    focusSidebarAccount("all");
  }
  dismissSettingsPage();
  if (state.composer) closeComposer();
  closeSummary();
  state.labelName = name;
  state.viewId = null;
  state.viewTotal = 0;
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = true;
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  loadThreads().then(() => {
    if (!state.localHasMore && state.remoteHasMore) {
      fetchOlderThreads(true, { quiet: true });
    }
  });
}

async function fetchOlderThreads(forceRemote = false, options = {}) {
  if (state.loadingMore && !forceRemote) return;
  if (state.searchMode || state.query) return;
  if (!forceRemote && state.localHasMore) {
    state.listLimit += 80;
    await loadThreads({ quiet: true });
    return;
  }
  if (!state.remoteHasMore) {
    state.loadingMore = false;
    renderList();
    return;
  }
  if (!state.loadingMore) {
    state.loadingMore = true;
    renderList();
  }
  const seq = state.listSeq;
  try {
    const data = await api("/api/threads/older", {
      method: "POST",
      body: {
        folder: state.folder,
        account: state.accountFilter || "",
        label_name: state.labelName || "",
      },
    });
    state.remoteHasMore = Boolean(data.has_more);
    if (data.fetched && seq === state.listSeq) {
      state.listLimit = Math.max(
        state.listLimit,
        state.threads.length + data.fetched + 20,
        80
      );
      await loadThreads({ quiet: true });
    }
  } catch (error) {
    if (!options.quiet) {
      toast(error.message || "Could not load older mail", true);
    }
  } finally {
    state.loadingMore = false;
    renderList();
  }
}

function clearSelection() {
  clearReaderSettling();
  state.readerChromeKey = "";
  closeContextSummary();
  if (state.summary && state.summary.controller) {
    try {
      state.summary.controller.abort();
    } catch (error) {
      /* Ignore. */
    }
  }
  state.summary = null;
  state.selected = null;
  state.selectedKey = null;
  state.readerLoading = false;
  state.readerError = "";
  state.focusEmail = false;
  state.expanded = new Set();
  updateReaderPane();
}

/* -------------------------------------------------------------------------- */
/* Data loading                                                               */
/* -------------------------------------------------------------------------- */

async function refreshState(options = {}) {
  const previousRevision = Number(state.sync.revision) || 0;
  const previousErrors = JSON.stringify(state.sync.errors || {});
  let data;
  try {
    data = await api("/api/state");
  } catch (error) {
    if (!options.quiet) toast(error.message || "Could not refresh mail", true);
    return;
  }
  state.accounts = data.accounts || [];
  state.counts = data.counts || {};
  state.labels = Array.isArray(data.labels) ? data.labels : state.labels;
  state.views = Array.isArray(data.views) ? data.views : state.views;
  if (state.viewId && !state.views.some((view) => view.id === state.viewId)) {
    state.viewId = null;
  }
  state.sync = data.sync || state.sync;
  state.settings = data.settings || state.settings;
  state.version = data.version || state.version;
  if (!state.prefsLoaded && data.prefs && typeof data.prefs === "object") {
    state.prefs = Object.assign({}, DEFAULT_PREFS, data.prefs);
    state.prefsLoaded = true;
    applyPrefs(false);
    scheduleUpdateCheck();
  }
  state.oauthPending = Boolean(data.oauth_pending);
  const accountSig = state.accounts
    .map((account) => `${account.id}:${account.email}:${account.color}`)
    .join("|");
  if (accountSig !== state.accountSig) {
    state.accountSig = accountSig;
    if (state.settingsOpen) renderSettings();
  }
  if (state.labelName) {
    const exists = (state.labels || []).some(
      (label) => label.name.toLowerCase() === state.labelName.toLowerCase()
    );
    if (!exists) state.labelName = null;
  }
  renderSidebar();
  if (
    !state.accounts.length &&
    !state.settingsOpen &&
    !state.googleSetup &&
    state.initialized
  ) {
    if (!state.prefs.googleSetupSeen) openGoogleSetup({ firstRun: true });
    else openSettings("accounts");
  }
  refreshButtonUi();

  if (previousErrors !== JSON.stringify(state.sync.errors || {})) {
    for (const [accountId, message] of Object.entries(state.sync.errors || {})) {
      const sig = `${accountId}:${message}`;
      if (!state.shownSyncErrors.has(sig)) {
        state.shownSyncErrors.add(sig);
        const account = accountFor(accountId);
        toast(
          `${account ? account.email : "Mail"}: ${message}`,
          true,
          7000
        );
      }
    }
  }

  const revisionChanged = (Number(state.sync.revision) || 0) !== previousRevision;
  if (
    revisionChanged &&
    !state.searchMode &&
    !state.query &&
    !state.syncReloading &&
    state.initialized
  ) {
    state.syncReloading = true;
    await loadThreads({ quiet: true });
    state.syncReloading = false;
    await refreshSelectedThreadIfNeeded();
  }
  schedulePoll(state.sync.syncing ? 2500 : 5000);
}

async function loadSignatures(options = {}) {
  try {
    const data = await api("/api/signatures");
    state.signatures =
      data && typeof data.signatures === "object" ? data.signatures : {};
    return state.signatures;
  } catch (error) {
    if (!options.quiet) {
      toast(error.message || "Could not load signatures.", true);
    }
    return null;
  }
}

function schedulePoll(delay = 5000) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(async () => {
    if (!document.hidden) {
      await refreshState({ quiet: true });
    } else {
      schedulePoll(20000);
    }
  }, delay);
}

function withPinnedUnreadThread(threads) {
  if (!state.unreadOnly || !state.selectedKey) return threads;
  if (state.searchMode || state.query) return threads;
  if (threads.some((thread) => thread.key === state.selectedKey)) {
    return threads;
  }
  const selected = state.selected && state.selected.thread;
  if (!selected) return threads;
  if (
    threadKey(selected.account_id, selected.id) !== state.selectedKey
  ) {
    return threads;
  }
  return [...threads, selected].sort(
    (a, b) => Number(b.last_date || 0) - Number(a.last_date || 0)
  );
}

async function loadThreads(options = {}) {
  const seq = ++state.listSeq;
  state.listLoading = true;
  if (!options.quiet) renderList();
  try {
    const params = new URLSearchParams();
    if (state.searchMode && state.query) {
      params.set("folder", "all");
      params.set("q", state.query);
    } else if (state.viewId) {
      params.set("view", String(state.viewId));
    } else if (state.labelName) {
      params.set("label_name", state.labelName);
    } else {
      params.set("folder", state.folder);
    }
    if (state.accountFilter) params.set("account", state.accountFilter);
    if (state.unreadOnly) params.set("unread", "1");
    params.set("limit", String(state.listLimit));
    const data = await api(`/api/threads?${params.toString()}`);
    if (seq !== state.listSeq) return;
    state.threads = withPinnedUnreadThread(data.threads || []);
    state.localHasMore = Boolean(data.has_more);
    state.viewTotal =
      state.viewId && data.view_total != null
        ? Number(data.view_total) || 0
        : 0;
    if (state.viewId) state.remoteHasMore = false;
    state.listError = "";
  } catch (error) {
    if (seq !== state.listSeq) return;
    state.threads = [];
    state.listError = error.message || "Could not load mail.";
    if (!options.quiet) toast(state.listError, true);
  } finally {
    if (seq === state.listSeq) {
      state.listLoading = false;
      renderList();
    }
  }
}

async function remoteSearch() {
  const query = state.query.trim();
  if (query.length < 2) return;
  clearTimeout(state.searchTimer);
  const seq = ++state.listSeq;
  state.listLoading = true;
  state.searchMode = true;
  state.remoteSearch = true;
  renderList();
  try {
    const data = await api("/api/search", {
      method: "POST",
      body: { q: query, account: state.accountFilter || "" },
    });
    if (seq !== state.listSeq) return;
    state.threads = data.threads || [];
    state.listError = "";
    if (data.errors && data.errors.length) {
      toast(data.errors[0], true, 6000);
    }
  } catch (error) {
    if (seq !== state.listSeq) return;
    state.threads = [];
    state.listError = error.message || "Search failed.";
  } finally {
    if (seq === state.listSeq) {
      state.listLoading = false;
      renderList();
    }
  }
}

function scrollReaderToLastMessage() {
  const reader = $("#reader");
  if (!reader) return;
  const messages = reader.querySelectorAll(".message, .collapsed-message");
  const last = messages[messages.length - 1];
  if (!last) return;
  const offset =
    last.getBoundingClientRect().top -
    reader.getBoundingClientRect().top +
    reader.scrollTop;
  reader.scrollTop = Math.max(0, offset - 6);
}

function clearReaderSettling() {
  state.readerSettleSeq += 1;
  const spinner = $("#reader-settling");
  if (spinner) spinner.remove();
  const inner = $("#reader .reader-inner");
  if (inner) inner.classList.remove("is-settling");
}

function beginReaderSettle(key, pending) {
  const reader = $("#reader");
  const inner = $(".reader-inner", reader);
  const spinner = $("#reader-settling", reader);
  if (!reader || !inner || !spinner || pending <= 0) return null;
  const token = ++state.readerSettleSeq;
  reader.scrollTop = 0;
  let remaining = pending;
  let done = false;
  let timer = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    if (token !== state.readerSettleSeq || state.selectedKey !== key) {
      spinner.remove();
      inner.classList.remove("is-settling");
      return;
    }
    inner.classList.remove("is-settling");
    spinner.remove();
    const messageCount = reader.querySelectorAll(
      ".message, .collapsed-message"
    ).length;
    if (messageCount > 1) {
      scrollReaderToLastMessage();
      window.setTimeout(() => {
        if (token === state.readerSettleSeq && state.selectedKey === key) {
          scrollReaderToLastMessage();
        }
      }, 80);
    }
  };
  timer = window.setTimeout(finish, 3000);
  return () => {
    if (done) return;
    remaining -= 1;
    if (remaining <= 0) finish();
  };
}

function settleReaderAtLastMessage(key) {
  const reader = $("#reader");
  if (!reader) return;
  if (reader.querySelectorAll(".message, .collapsed-message").length <= 1) {
    return;
  }
  const token = ++state.readerSettleToken;
  for (const delay of [0, 80, 250, 600, 1000]) {
    setTimeout(() => {
      if (
        state.selectedKey === key &&
        state.readerSettleToken === token
      ) {
        scrollReaderToLastMessage();
      }
    }, delay);
  }
}

function revealSummaryPanel() {
  const reader = $("#reader");
  const panel = $("#summary-panel");
  if (!reader || !panel) return;
  state.readerSettleToken += 1;
  const offset =
    panel.getBoundingClientRect().top -
    reader.getBoundingClientRect().top +
    reader.scrollTop;
  reader.scrollTop = Math.max(0, offset - 10);
}

function invalidateThreadSummaries(key) {
  state.summaryCache = state.summaryCache.filter(
    (entry) => entry.threadKey !== key
  );
  if (state.summary && state.summary.threadKey === key) closeSummary();
}

function visibleThreadMessagesUnchanged(before, after) {
  if (before.length !== after.length) return false;
  return before.every(
    (message, index) =>
      message.id === after[index].id &&
      Number(message.date) === Number(after[index].date)
  );
}

async function refreshSelectedThreadIfNeeded(options = {}) {
  if (
    state.threadRefreshing ||
    state.readerLoading ||
    !state.selected ||
    !state.selected.thread
  ) {
    return;
  }
  const key = state.selectedKey;
  const summary = state.threads.find((thread) => thread.key === key);
  if (!summary) return;
  const current = state.selected.thread;
  const knownCount = (state.selected.messages || []).length;
  if (
    (Number(summary.message_count) || 0) <= knownCount &&
    (Number(summary.last_date) || 0) <= (Number(current.last_date) || 0)
  ) {
    return;
  }
  const reader = $("#reader");
  const wasNearBottom = reader
    ? reader.scrollHeight - reader.scrollTop - reader.clientHeight < 140
    : true;
  const seq = state.openSeq;
  const background = !windowIsActive();
  state.threadRefreshing = true;
  try {
    const data = await api(
      `/api/thread?account=${encodeURIComponent(
        current.account_id
      )}&id=${encodeURIComponent(current.id)}&refresh=1${
        background ? "&read=0" : ""
      }`
    );
    if (
      seq !== state.openSeq ||
      state.selectedKey !== key ||
      !state.selected
    ) {
      return;
    }
    const previousMessages = state.selected.messages || [];
    const messages = (data.messages || []).filter(
      (message) => !(message.labels || []).includes("DRAFT")
    );
    const visibleUnchanged = visibleThreadMessagesUnchanged(
      previousMessages,
      messages
    );
    state.selected = { ...data, messages };
    state.readerLoading = false;
    setThreadLocal(current.account_id, current.id, {
      unread: Boolean(data.thread.unread),
      labels: data.thread.labels || [],
      message_count: messages.length,
      last_date: data.thread.last_date,
    });
    if (visibleUnchanged) {
      // Draft saves change thread metadata and can move last_date, but they
      // must not rebuild the open reader or reset its scroll and expansion.
      updateThreadHead(data.thread, messages.length);
      updateThreadToolbarState(data.thread);
      renderList();
      updateReaderPane();
      if (windowIsActive() && data.thread.unread) {
        actOnThread("read", { thread: data.thread });
      }
      return;
    }
    state.expanded = defaultExpanded(messages);
    invalidateThreadSummaries(key);
    const keepBottom = wasNearBottom || options.toBottom;
    renderReader({ settle: keepBottom, preserveChrome: true });
    renderList();
    updateReaderPane();
    if (windowIsActive() && data.thread.unread) {
      actOnThread("read", { thread: data.thread });
    }
  } catch (error) {
    /* A quiet background refresh should not interrupt reading. */
  } finally {
    state.threadRefreshing = false;
  }
}

function defaultExpanded(messages) {
  if (!messages.length) return new Set();
  if (messages.length <= 3) {
    return new Set(messages.map((message) => message.id));
  }
  return new Set([messages[messages.length - 1].id]);
}

async function openThread(accountId, threadId, options = {}) {
  if (!accountId || !threadId) return;
  if (state.settingsOpen) {
    state.settingsOpen = false;
    $("#settings-pane").hidden = true;
  }
  if (state.composer && !options.keepComposer) closeComposer();
  if (state.composer && state.composer.threadId && state.composer.threadId !== threadId) {
    closeComposer();
  }
  const key = threadKey(accountId, threadId);
  if (state.selectedKey === key && state.selected && !options.force) {
    const threadSummary = state.threads.find((thread) => thread.key === key);
    if (
      threadSummary &&
      Number(threadSummary.message_count) >
        (state.selected.messages || []).length
    ) {
      refreshSelectedThreadIfNeeded({ toBottom: true });
    }
    return;
  }
  closeSummary();
  closeContextSummary();
  const summary = state.threads.find((thread) => thread.key === key);
  const previous =
    state.selectedKey === key &&
    state.selected &&
    (state.selected.messages || []).length
      ? state.selected
      : null;
  const previousExpanded = new Set(state.expanded);
  state.selectedKey = key;
  state.selected = summary ? { thread: summary, messages: [] } : null;
  state.readerLoading = true;
  state.readerError = "";
  state.expanded = new Set();
  state.focusEmail = false;
  const seq = ++state.openSeq;
  renderList();
  renderReader({ resetScroll: true });
  updateReaderPane();
  try {
    const data = await api(
      `/api/thread?account=${encodeURIComponent(accountId)}&id=${encodeURIComponent(
        threadId
      )}${options.force ? "&refresh=1" : ""}`
    );
    if (seq !== state.openSeq) return;
    const messages = (data.messages || []).filter(
      (message) => !(message.labels || []).includes("DRAFT")
    );
    state.selected = { ...data, messages };
    state.readerLoading = false;
    state.expanded = defaultExpanded(messages);
    setThreadLocal(accountId, threadId, {
      unread: Boolean(data.thread.unread),
      labels: data.thread.labels || [],
      message_count: messages.length,
    });
    state.summary = aiSummariesEnabled() ? cachedSummary(data.thread) : null;
    renderReader({
      resetScroll: true,
      settle: true,
      preserveChrome: true,
    });
    renderList();
    updateReaderPane();
    applyServerDrafts(threadId, data.drafts || []);
    restoreThreadDraft(data.thread, data.draft || null);
    await refreshState({ quiet: true });
    if (state.unreadOnly) {
      loadThreads({ quiet: true });
    }
  } catch (error) {
    if (seq !== state.openSeq) return;
    state.readerLoading = false;
    if (error.status === 404) {
      state.threads = state.threads.filter((thread) => thread.key !== key);
      if (state.selectedKey === key) clearSelection();
      renderReader();
      renderList();
      toast(error.message || "This thread is no longer available", true);
      void refreshState({ quiet: true });
      void loadThreads({ quiet: true });
      return;
    }
    if (previous) {
      state.selected = previous;
      state.expanded = previousExpanded;
      state.readerError = "";
      renderReader();
      toast(error.message || "Could not refresh this thread", true);
      return;
    }
    state.readerError = error.message || "Could not open this message.";
    renderReader();
  }
}

/* -------------------------------------------------------------------------- */
/* Thread updates                                                             */
/* -------------------------------------------------------------------------- */

function setThreadLocal(accountId, threadId, patch) {
  const key = threadKey(accountId, threadId);
  const thread = state.threads.find((item) => item.key === key);
  if (thread) Object.assign(thread, patch);
  if (state.selected && state.selected.thread && state.selected.thread.key === key) {
    Object.assign(state.selected.thread, patch);
  }
  if (state.selectedKey === key) {
    const source = state.threads.find((item) => item.key === key);
    if (source && state.selected) state.selected.thread = { ...state.selected.thread, ...patch };
  }
}

function toggleStarRow(accountId, threadId) {
  const thread =
    state.threads.find((item) => item.key === threadKey(accountId, threadId)) ||
    (state.selected && state.selected.thread);
  if (!thread) return;
  const star = !thread.starred;
  const labels = new Set(thread.labels || []);
  if (star) labels.add("STARRED");
  else labels.delete("STARRED");
  setThreadLocal(accountId, threadId, { starred: star, labels: Array.from(labels) });
  renderList();
  updateReaderToolbar();
  api("/api/thread/action", {
    method: "POST",
    body: { account: accountId, id: threadId, action: star ? "star" : "unstar" },
  })
    .then((data) => {
      if (data.state) {
        state.accounts = data.state.accounts;
        state.counts = data.state.counts;
        renderSidebar();
      }
      if (state.selected && state.selected.thread) {
        const updated = data.thread;
        if (updated) setThreadLocal(accountId, threadId, updated);
        updateReaderToolbar();
      }
      if (state.folder === "starred") loadThreads({ quiet: true });
    })
    .catch((error) => {
      setThreadLocal(accountId, threadId, {
        starred: !star,
        labels: Array.from(thread.labels || []),
      });
      renderList();
      updateReaderToolbar();
      toast(error.message || "Could not update the star", true);
    });
}

async function markOpenThreadRead() {
  if (!windowIsActive() || state.settingsOpen) return;
  const thread = currentThread();
  if (!thread || !thread.unread) return;
  const key = threadKey(thread.account_id, thread.id);
  if (state.markReadKey === key) return;
  state.markReadKey = key;
  try {
    await actOnThread("read", { thread });
  } finally {
    state.markReadKey = "";
  }
}

async function actOnThread(action, options = {}) {
  const thread = options.thread || currentThread();
  if (!thread) return;
  const wasSelected =
    state.selectedKey === threadKey(thread.account_id, thread.id);
  try {
    const data = await api("/api/thread/action", {
      method: "POST",
      body: { account: thread.account_id, id: thread.id, action },
    });
    if (data.state) {
      state.accounts = data.state.accounts;
      state.counts = data.state.counts;
      renderSidebar();
    }
    const updated = data.thread;
    if (updated) setThreadLocal(thread.account_id, thread.id, updated);
    if (action === "unread") {
      if (wasSelected) {
        clearSelection();
        renderReader();
        updateReaderPane();
      }
      if (state.unreadOnly) await loadThreads({ quiet: true });
      else renderList();
      updateReaderToolbar();
    } else if (action === "read") {
      if (state.unreadOnly) loadThreads({ quiet: true });
      else renderList();
      updateReaderToolbar();
    } else if (action === "star" || action === "unstar") {
      renderList();
      updateReaderToolbar();
    } else {
      clearSelection();
      renderReader();
      updateReaderPane();
      renderList();
      await loadThreads({ quiet: true });
    }
  } catch (error) {
    toast(error.message || "Could not update this thread", true);
    await loadThreads({ quiet: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Menus and toast                                                            */
/* -------------------------------------------------------------------------- */

function closeMenu() {
  const root = $("#menu-root");
  if (!root) return;
  root.hidden = true;
  root.innerHTML = "";
  state.menuOpen = false;
}

function openMenu(anchor, items) {
  const root = $("#menu-root");
  if (!root || !anchor) return;
  root.hidden = false;
  root.innerHTML = `<div class="menu-backdrop" data-action="close-menu"></div><div class="menu-popover" role="menu">${items
    .map(
      (item) =>
        `<button type="button" class="menu-item" role="menuitem" data-action="${esc(
          item.action
        )}" ${item.attrs || ""}>${
          item.icon ? icon(item.icon, 14) : ""
        }<span>${esc(item.label)}</span></button>`
    )
    .join("")}</div>`;
  const popover = $(".menu-popover", root);
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = rect.right - width;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 10) top = rect.top - height - 6;
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(10, top)}px`;
  state.menuOpen = true;
  setTimeout(() => $(".menu-item", root)?.focus({ preventScroll: true }), 0);
}

function openMenuAt(x, y, items) {
  const root = $("#menu-root");
  if (!root) return;
  root.hidden = false;
  root.innerHTML = `<div class="menu-backdrop" data-action="close-menu"></div><div class="menu-popover" role="menu">${items
    .map(
      (item) =>
        `<button type="button" class="menu-item" role="menuitem" data-action="${esc(
          item.action
        )}" ${item.attrs || ""}>${
          item.icon ? icon(item.icon, 14) : ""
        }<span>${esc(item.label)}</span></button>`
    )
    .join("")}</div>`;
  const popover = $(".menu-popover", root);
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  let top = y + 4;
  if (top + height > window.innerHeight - 8) top = y - height - 4;
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(8, top)}px`;
  state.menuOpen = true;
  setTimeout(() => $(".menu-item", root)?.focus({ preventScroll: true }), 0);
}

function threadFromElement(element) {
  const account = element.dataset.account;
  const id = element.dataset.thread;
  return (
    state.threads.find(
      (thread) => thread.account_id === account && thread.id === id
    ) || null
  );
}

function openThreadContextMenu(thread, x, y) {
  if (!thread) return;
  state.contextPoint = { x, y };
  closeContextSummary();
  const labels = new Set(thread.labels || []);
  const attrs = `data-account="${esc(thread.account_id)}" data-thread="${esc(thread.id)}"`;
  const items = [];
  if (aiSummariesEnabled()) {
    if (thread.message_count <= 1) {
      items.push({
        label: "Summarize",
        action: "context-summary-all",
        icon: "summary",
        attrs,
      });
    } else {
      items.push({
        label: "Summarize all",
        action: "context-summary-all",
        icon: "summary",
        attrs,
      });
      if (thread.unread) {
        items.push({
          label: "Summarize unread",
          action: "context-summary-unread",
          icon: "summary",
          attrs,
        });
      }
    }
  }
  items.push({
    label: thread.unread ? "Mark as read" : "Mark as unread",
    action: thread.unread ? "context-read" : "context-unread",
    icon: "mail",
    attrs,
  });
  if (labels.has("SPAM")) {
    items.push({ label: "Not spam", action: "context-inbox", icon: "inbox", attrs });
  } else if (labels.has("TRASH")) {
    items.push({ label: "Move to inbox", action: "context-inbox", icon: "inbox", attrs });
  } else {
    items.push({ label: "Mark as spam", action: "context-spam", icon: "spam", attrs });
    items.push({ label: "Archive", action: "context-archive", icon: "archive", attrs });
    items.push({ label: "Delete", action: "context-trash", icon: "trash", attrs });
  }
  openMenuAt(x, y, items);
}

function openEmailAddressMenu(emails, x, y) {
  const unique = Array.from(
    new Set((emails || []).map((value) => String(value).trim()).filter(Boolean))
  );
  if (!unique.length) return;
  openMenuAt(x, y, [
    {
      label:
        unique.length > 1
          ? "Copy email addresses"
          : "Copy email address",
      action: "copy-email-address",
      icon: "copy",
      attrs: `data-email="${esc(unique.join(", "))}"`,
    },
  ]);
}

function openAccountContextMenu(account, x, y) {
  if (!account) return;
  state.contextPoint = { x, y };
  closeContextSummary();
  const active =
    state.accountFilter === account.id && !state.viewId;
  const items = [
    {
      label: "Customize account",
      action: "account-customize",
      icon: "settings",
      attrs: `data-account="${esc(account.id)}"`,
    },
    {
      label: "Create custom view",
      action: "view-create",
      icon: "plus",
      attrs: `data-account="${esc(account.id)}"`,
    },
    active
      ? { label: "Show all accounts", action: "all-accounts", icon: "layers" }
      : {
          label: "Only this account",
          action: "account-filter",
          icon: "layers",
          attrs: `data-account="${esc(account.id)}"`,
        },
  ];
  items.push({ label: "Reconnect", action: "oauth-connect", icon: "refresh" });
  openMenuAt(x, y, items);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    /* Fall through to the selection-based copy path. */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.left = "-10000px";
  area.style.top = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }
  area.remove();
  return copied;
}

async function copyThreadDebug() {
  const thread = currentThread();
  const messages = currentMessages();
  if (!thread) return;
  const payload = debugPayload(thread, messages, "thread");
  const copied = await copyText(JSON.stringify(payload, null, 2));
  toast(
    copied ? "Copied email debug data" : "Could not copy debug data",
    !copied
  );
}

function messageDebugData(message) {
  return {
    id: message.id,
    thread_id: message.thread_id,
    subject: message.subject,
    from_name: message.from_name,
    from_email: message.from_email,
    to: message.to || [],
    cc: message.cc || [],
    bcc: message.bcc || [],
    date: message.date,
    labels: message.labels || [],
    snippet: message.snippet,
    message_id: message.message_id,
    body_text: message.body_text || "",
    body_html: message.body_html || "",
    attachments: (message.attachments || []).map((item) => ({
      filename: item.filename,
      mime: item.mime,
      size: item.size,
      inline: Boolean(item.inline),
      content_id: item.content_id || "",
    })),
    debug: inspectEmailForDebug(message, {
      contentTheme: state.prefs.emailTheme,
    }),
  };
}

function debugPayload(thread, messages, scope) {
  const account = thread ? accountFor(thread.account_id) : null;
  return {
    courier_debug: 1,
    scope,
    generated_at: new Date().toISOString(),
    client_theme: state.prefs.theme,
    email_theme: state.prefs.emailTheme,
    account: account
      ? {
          email: account.email,
          name: account.name,
          username: accountLabel(account),
          color: account.color,
        }
      : null,
    thread: thread
      ? {
          id: thread.id,
          subject: thread.subject,
          message_count: thread.message_count,
          last_date: thread.last_date,
          labels: thread.labels || [],
        }
      : null,
    messages: (messages || []).map(messageDebugData),
  };
}

async function copyMessageDebug(message) {
  const thread = currentThread();
  if (!thread || !message) return;
  const payload = debugPayload(thread, [message], "message");
  const copied = await copyText(JSON.stringify(payload, null, 2));
  toast(
    copied ? "Copied email debug data" : "Could not copy debug data",
    !copied
  );
}

function openMessageContextMenu(messageId, x, y) {
  const message = currentMessages().find((item) => item.id === messageId);
  if (!message) return;
  openMenuAt(x, y, [
    {
      label: "Copy email debug content",
      action: "message-debug-copy",
      icon: "copy",
      attrs: `data-message-id="${esc(message.id)}"`,
    },
  ]);
}

function threadMenu(anchor) {
  const thread = currentThread();
  if (!thread) return;
  const labels = new Set(thread.labels || []);
  const items = [];
  if (labels.has("SPAM")) {
    items.push({ label: "Not spam", action: "thread-inbox", icon: "inbox" });
  } else if (labels.has("TRASH")) {
    items.push({ label: "Move to inbox", action: "thread-inbox", icon: "inbox" });
  } else {
    items.push({ label: "Mark as spam", action: "thread-spam", icon: "spam" });
    items.push({ label: "Archive", action: "archive-thread", icon: "archive" });
    if (!labels.has("INBOX")) {
      items.push({ label: "Move to inbox", action: "thread-inbox", icon: "inbox" });
    }
  }
  if (!labels.has("TRASH")) {
    items.push({ label: "Delete", action: "trash-thread", icon: "trash" });
  }
  if (aiSummariesEnabled()) {
    items.push({ label: "Summarize thread", action: "summary-thread", icon: "rows" });
  }
  items.push({
    label: "Copy debug content",
    action: "thread-debug-copy",
    icon: "copy",
  });
  openMenu(anchor, items);
}

function summaryMenu(anchor) {
  if (!aiSummariesEnabled()) {
    openSettings("ai");
    return;
  }
  const thread = currentThread();
  if (!thread) return;
  const messages = currentMessages();
  if (messages.length === 1) {
    startSummary("message", messages[0].id);
    return;
  }
  if (!messages.length && thread.message_count <= 1) {
    startSummary("thread");
    return;
  }
  const items = [{ label: "Summarize thread", action: "summary-thread" }];
  if (messages.length) {
    items.push({ label: "Summarize latest message", action: "summary-latest" });
  }
  if (thread.unread) {
    items.push({ label: "Summarize unread", action: "summary-unread" });
  }
  openMenu(anchor, items);
}

function openLightbox(images, index = 0) {
  const urls = (images || []).filter(Boolean);
  if (!urls.length) return;
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, urls.length - 1));
  state.lightbox = { urls, index: safeIndex, zoom: 1 };
  document.body.classList.add("lightbox-open");
  renderLightbox();
  setTimeout(() => $(".lightbox-close")?.focus({ preventScroll: true }), 20);
}

function closeLightbox() {
  state.lightbox = null;
  document.body.classList.remove("lightbox-open");
  const root = $("#lightbox-root");
  if (!root) return;
  root.hidden = true;
  root.innerHTML = "";
}

function renderLightbox() {
  const lightbox = state.lightbox;
  const root = $("#lightbox-root");
  if (!root || !lightbox) return;
  const { urls, index, zoom } = lightbox;
  const multiple = urls.length > 1;
  const url = urls[index];
  root.hidden = false;
  root.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer">
    <div class="lightbox-backdrop" data-action="lightbox-close"></div>
    <div class="lightbox-frame">
      <div class="lightbox-topbar">
        <span class="lightbox-count">${multiple ? `${index + 1} of ${urls.length}` : ""}</span>
        <div class="lightbox-tools">
          <button type="button" class="icon-btn lightbox-tool" data-action="lightbox-zoom-out" aria-label="Zoom out" title="Zoom out">${icon(
            "zoomOut",
            17
          )}</button>
          <button type="button" class="lightbox-zoom-label" data-action="lightbox-zoom-reset" title="Reset zoom">${Math.round(
            zoom * 100
          )}%</button>
          <button type="button" class="icon-btn lightbox-tool" data-action="lightbox-zoom-in" aria-label="Zoom in" title="Zoom in">${icon(
            "zoomIn",
            17
          )}</button>
          <span class="lightbox-tool-divider" aria-hidden="true"></span>
          <button type="button" class="icon-btn lightbox-tool lightbox-close" data-action="lightbox-close" aria-label="Close viewer" title="Close viewer">${icon(
            "x",
            18
          )}</button>
        </div>
      </div>
      <div class="lightbox-stage">
        ${
          multiple
            ? `<button type="button" class="lightbox-nav lightbox-prev" data-action="lightbox-prev" aria-label="Previous image" title="Previous image"><span class="lightbox-chevron">${icon(
                "chevronRight",
                24
              )}</span></button>`
            : ""
        }
        <div class="lightbox-canvas">
          <img class="lightbox-image" src="${esc(url)}" alt="Image ${index + 1}">
        </div>
        ${
          multiple
            ? `<button type="button" class="lightbox-nav lightbox-next" data-action="lightbox-next" aria-label="Next image" title="Next image"><span class="lightbox-chevron">${icon(
                "chevronRight",
                24
              )}</span></button>`
            : ""
        }
      </div>
      ${
        multiple
          ? `<div class="lightbox-strip" aria-label="Images in this message">${urls
              .map(
                (item, itemIndex) =>
                  `<button type="button" class="lightbox-thumb ${
                    itemIndex === index ? "active" : ""
                  }" data-action="lightbox-select" data-index="${itemIndex}" aria-label="Image ${
                    itemIndex + 1
                  }" ${itemIndex === index ? 'aria-current="true"' : ""}><img src="${esc(
                    item
                  )}" alt=""></button>`
              )
              .join("")}</div>`
          : ""
      }
    </div>
  </div>`;
  const stage = $(".lightbox-stage", root);
  if (stage) {
    stage.addEventListener("click", (event) => {
      if (event.target.closest("img, button")) return;
      closeLightbox();
    });
  }
  const image = $(".lightbox-image", root);
  if (image) {
    image.addEventListener("load", applyLightboxZoom);
    image.addEventListener("dblclick", () =>
      setLightboxZoom(state.lightbox && state.lightbox.zoom > 1 ? 1 : 2)
    );
    if (image.complete) applyLightboxZoom();
  }
  const canvas = $(".lightbox-canvas", root);
  if (canvas) {
    canvas.addEventListener("wheel", handleLightboxWheel, { passive: false });
  }
}

function handleLightboxWheel(event) {
  const lightbox = state.lightbox;
  const canvas = $(".lightbox-canvas");
  const image = $(".lightbox-image");
  if (!lightbox || !canvas || !image) return;
  const delta = event.deltaY || event.deltaX || 0;
  if (!delta) return;
  event.preventDefault();
  const before = image.getBoundingClientRect();
  const pointX = before.width ? (event.clientX - before.left) / before.width : 0.5;
  const pointY = before.height ? (event.clientY - before.top) / before.height : 0.5;
  const next = Math.max(1, Math.min(4, lightbox.zoom + (delta < 0 ? 0.25 : -0.25)));
  if (Math.abs(next - lightbox.zoom) < 0.001) return;
  setLightboxZoom(next);
  if (next <= 1) return;
  const canvasRect = canvas.getBoundingClientRect();
  canvas.scrollLeft = 0;
  canvas.scrollTop = 0;
  image.style.transform = "";
  const zoomed = image.getBoundingClientRect();
  const fitsX = zoomed.width <= canvas.clientWidth;
  const fitsY = zoomed.height <= canvas.clientHeight;
  let dx = 0;
  let dy = 0;
  if (fitsX) {
    dx = event.clientX - pointX * zoomed.width - zoomed.left;
    const minDx = canvasRect.left - zoomed.left;
    const maxDx = canvasRect.right - zoomed.right;
    dx = Math.max(minDx, Math.min(dx, maxDx));
  } else {
    canvas.scrollLeft =
      zoomed.left -
      canvasRect.left +
      pointX * zoomed.width -
      (event.clientX - canvasRect.left);
  }
  if (fitsY) {
    dy = event.clientY - pointY * zoomed.height - zoomed.top;
    const minDy = canvasRect.top - zoomed.top;
    const maxDy = canvasRect.bottom - zoomed.bottom;
    dy = Math.max(minDy, Math.min(dy, maxDy));
  } else {
    canvas.scrollTop =
      zoomed.top -
      canvasRect.top +
      pointY * zoomed.height -
      (event.clientY - canvasRect.top);
  }
  if (dx || dy) {
    image.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

function applyLightboxZoom() {
  const lightbox = state.lightbox;
  const image = $(".lightbox-image");
  if (!lightbox || !image) return;
  image.style.transform = "";
  if (lightbox.zoom <= 1) {
    image.style.maxWidth = "";
    image.style.maxHeight = "";
    image.style.width = "";
    image.style.height = "";
    image.style.cursor = "zoom-in";
    return;
  }
  const base = image.naturalWidth || 0;
  if (!base) return;
  image.style.maxWidth = "none";
  image.style.maxHeight = "none";
  image.style.width = `${Math.round(base * lightbox.zoom)}px`;
  image.style.height = "auto";
  image.style.cursor = "zoom-out";
}

function setLightboxZoom(value) {
  if (!state.lightbox) return;
  const zoom = Math.max(1, Math.min(4, Math.round(Number(value) * 20) / 20));
  state.lightbox.zoom = zoom;
  const label = $(".lightbox-zoom-label");
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  const canvas = $(".lightbox-canvas");
  if (canvas) {
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
  }
  applyLightboxZoom();
}

function setLightboxIndex(value) {
  if (!state.lightbox) return;
  const count = state.lightbox.urls.length;
  if (!count) return;
  state.lightbox.index = ((value % count) + count) % count;
  state.lightbox.zoom = 1;
  renderLightbox();
}

function stepLightbox(delta) {
  if (!state.lightbox) return;
  setLightboxIndex(state.lightbox.index + delta);
}

function setSendStatusText(text) {
  const node = $(".send-status-text");
  if (node) node.textContent = text;
}

function stopSendProgress() {
  if (state.sendProgressTimer) {
    clearInterval(state.sendProgressTimer);
    state.sendProgressTimer = null;
  }
}

function updateSendStatus(message, options = {}) {
  stopSendProgress();
  const root = $("#send-status");
  if (!root) return;
  if (state.sendStatusTimer) {
    clearTimeout(state.sendStatusTimer);
    state.sendStatusTimer = null;
  }
  const spinner = Boolean(options.spinner);
  const error = Boolean(options.error);
  root.hidden = false;
  root.className = `send-status${error ? " error" : ""}`;
  const marker = spinner
    ? '<span class="spinner"></span>'
    : error
      ? icon("x", 14)
      : icon("check", 14);
  root.innerHTML = `${marker}<span class="send-status-text"></span>${
    options.closable === false
      ? ""
      : `<button type="button" class="send-status-close" aria-label="Dismiss">${icon(
          "x",
          12
        )}</button>`
  }`;
  $(".send-status-text", root).textContent = message;
  const close = $(".send-status-close", root);
  if (close) close.addEventListener("click", dismissSendStatus);
  if (options.duration) {
    state.sendStatusTimer = setTimeout(dismissSendStatus, options.duration);
  }
}

function dismissSendStatus() {
  stopSendProgress();
  const root = $("#send-status");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
  if (state.sendStatusTimer) {
    clearTimeout(state.sendStatusTimer);
    state.sendStatusTimer = null;
  }
}

let cursorHintTimer = null;

function showCursorHint(message, x, y) {
  let hint = $("#cursor-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "cursor-hint";
    hint.className = "cursor-hint";
    document.body.appendChild(hint);
  }
  hint.textContent = message;
  const width = hint.offsetWidth || 0;
  const height = hint.offsetHeight || 0;
  hint.style.left = `${Math.max(
    6,
    Math.min(x, window.innerWidth - width - 6)
  )}px`;
  hint.style.top = `${Math.max(
    height / 2 + 6,
    Math.min(y, window.innerHeight - height / 2 - 6)
  )}px`;
  hint.classList.add("visible");
  if (cursorHintTimer) clearTimeout(cursorHintTimer);
  cursorHintTimer = setTimeout(() => {
    hint.classList.remove("visible");
    cursorHintTimer = null;
  }, 1400);
}

function toast(message, error = false, duration = 3600) {
  const root = $("#toast-root");
  if (!root) return;
  const item = document.createElement("div");
  item.className = `toast ${error ? "error" : ""}`;
  item.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="Dismiss">${icon(
    "x",
    12
  )}</button>`;
  const close = () => {
    item.remove();
  };
  item.querySelector("button").addEventListener("click", close);
  root.appendChild(item);
  setTimeout(close, duration);
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                    */
/* -------------------------------------------------------------------------- */

function showModal({
  title,
  message = "",
  input = false,
  placeholder = "",
  value = "",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
}) {
  return new Promise((resolve) => {
    if (state.modalOpen) return resolve(false);
    const root = $("#modal-root");
    if (!root) return resolve(false);
    const previousFocus = document.activeElement;
    state.modalOpen = true;
    root.hidden = false;
    root.innerHTML = `<div class="modal-backdrop"></div>
      <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 class="modal-title" id="modal-title"></h2>
        ${message ? '<p class="modal-text"></p>' : ""}
        ${input ? `<input class="modal-input" type="text" autocomplete="off" spellcheck="false">` : ""}
        <div class="modal-actions">
          <button type="button" class="btn modal-cancel"></button>
          <button type="button" class="btn ${danger ? "danger" : "accent"} modal-confirm"></button>
        </div>
      </div>`;
    $(".modal-title", root).textContent = title;
    if (message) $(".modal-text", root).textContent = message;
    const inputEl = $(".modal-input", root);
    if (inputEl) {
      inputEl.value = value;
      inputEl.placeholder = placeholder;
      inputEl.setAttribute("aria-label", title);
    }
    $(".modal-cancel", root).textContent = cancelLabel;
    const confirmEl = $(".modal-confirm", root);
    confirmEl.textContent = confirmLabel;

    const finish = (result) => {
      root.hidden = true;
      root.innerHTML = "";
      state.modalOpen = false;
      document.removeEventListener("keydown", onKey, true);
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(input ? null : false);
      } else if (event.key === "Enter" && input) {
        event.preventDefault();
        event.stopPropagation();
        finish(inputEl.value.trim() || null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    $(".modal-backdrop", root).addEventListener("click", () => finish(input ? null : false));
    $(".modal-cancel", root).addEventListener("click", () => finish(input ? null : false));
    confirmEl.addEventListener("click", () =>
      finish(input ? inputEl.value.trim() || null : true)
    );
    setTimeout(() => {
      if (inputEl) inputEl.focus();
      else confirmEl.focus();
    }, 0);
  });
}

/* -------------------------------------------------------------------------- */
/* Google Cloud setup                                                        */
/* -------------------------------------------------------------------------- */

function shortClientId(value) {
  const text = String(value || "");
  if (text.length <= 48) return text;
  return `${text.slice(0, 22)}…${text.slice(-22)}`;
}

function missingOAuthScopes(account) {
  const granted = new Set(
    String(account && account.scope ? account.scope : "")
      .split(/\s+/)
      .filter(Boolean)
  );
  if (!granted.size) return [];
  return GOOGLE_OAUTH_SCOPES.filter((scope) => !granted.has(scope));
}

function oauthScopeLabel(scope) {
  if (scope === "https://www.googleapis.com/auth/gmail.modify") {
    return "Read and manage Gmail";
  }
  if (scope === "https://www.googleapis.com/auth/gmail.send") {
    return "Send mail";
  }
  if (scope === "openid" || scope === "email" || scope === "profile") {
    return "Basic Google profile";
  }
  return scope;
}

function setGoogleSetupStatus(html, error = false) {
  if (!state.googleSetup) return;
  state.googleSetup.status = { html, error };
  const host = $("#google-setup-status");
  if (host) {
    host.innerHTML = html;
    host.classList.toggle("error", error);
  }
}

function googleSetupVisual(step) {
  const shots = [
    ["/setup/project.png", "Google Cloud New Project form"],
    ["/setup/gmail-api.png", "Gmail API page with the Enable button"],
    ["/setup/auth-branding.png", "Google Auth Platform App Information form"],
    ["/setup/data-access.png", "Data access page with Gmail and profile scopes"],
    ["/setup/create-client.png", "Create OAuth client form with Desktop app selected"],
    ["/setup/client-created.png", "OAuth client created dialog with Download JSON"],
  ];
  const [src, alt] = shots[step] || shots[0];
  return `<figure class="setup-shot"><img src="${src}" alt="${esc(
    alt
  )}" loading="lazy"></figure>`;
}

function googleSetupImportHtml(setup) {
  return `
    <p class="setup-copy">In the <strong>OAuth client created</strong> dialog, select <strong>Download JSON</strong>. Import that file here. Courier reads the client ID and secret and stores them in the local database.</p>
    <div class="setup-import-row">
      <button class="btn" data-action="google-setup-choose-json">Choose JSON file</button>
      <span class="settings-note">or paste the downloaded JSON below</span>
    </div>
    <textarea id="oauth-json-input" class="setup-json" spellcheck="false" autocomplete="off" placeholder='{ "installed": { "client_id": "…", "client_secret": "…" } }'>${esc(
      setup.jsonText || ""
    )}</textarea>
    ${
      setup.startedConfigured && !setup.imported && !setup.confirmReplace
        ? `<p class="settings-note setup-existing-note">A client is already configured. Importing another will replace it, and accounts connected with the old client may need to reconnect.</p>`
        : ""
    }
    ${
      setup.confirmReplace
        ? `<div class="setup-notice warning">
        <strong>Replace the configured client?</strong>
        <p>Accounts connected with the current client may need to reconnect before they can refresh mail.</p>
        <div class="setup-inline-actions">
          <button class="btn danger" data-action="google-setup-import-replace">Replace client</button>
          <button class="btn" data-action="google-setup-import-cancel">Cancel</button>
        </div>
      </div>`
        : `<div class="setup-inline-actions">
        <button class="btn accent" data-action="google-setup-import">Import client</button>
      </div>`
    }
    ${
      setup.importError
        ? `<p class="settings-status error">${esc(setup.importError)}</p>`
        : ""
    }
    ${
      setup.imported
        ? `<div class="setup-status success"><strong>Client imported</strong><span>${esc(
            shortClientId(state.settings.oauth_client_id)
          )}</span></div>`
        : ""
    }
    <div id="google-setup-status" class="settings-status ${
      setup.status && setup.status.error ? "error" : ""
    }" aria-live="polite">${setup.status ? setup.status.html : ""}</div>
    ${
      setup.imported
        ? `<div class="setup-connect">
        <div class="setup-subhead">Connect a Google account</div>
        <p class="settings-note">${
          setup.connected
            ? setup.accountCount > 1
              ? `${setup.accountCount} accounts are connected.`
              : `${esc(
                  setup.accountEmail || "The account"
                )} is connected.`
            : "Connect one Gmail account now. Courier will request Gmail access and the basic profile needed for the From name."
        }</p>
        ${
          setup.connected
            ? setup.missingScopes && setup.missingScopes.length
              ? `<div class="setup-notice warning"><strong>Permissions missing</strong><p>The account did not grant every requested scope:</p><ul>${setup.missingScopes
                  .map((scope) => `<li>${esc(oauthScopeLabel(scope))}</li>`)
                  .join("")}</ul><p>Add the scopes in Google Cloud, then reconnect and grant them.</p></div>`
              : ""
            : setup.connecting
              ? `<p class="settings-note">Waiting for Google sign-in. <a href="${esc(
                  state.oauthUrl || "#"
                )}" target="_blank" rel="noreferrer">Open the Google sign-in page</a></p>`
              : `<p class="settings-note">Use <strong>Connect account</strong> below when you are ready.</p>`
        }
      </div>`
        : ""
    }
    ${
      setup.complete
        ? `<div class="setup-status success setup-complete"><strong>Setup complete</strong><span>Courier can now read and send Gmail for this account.</span></div>`
        : ""
    }
  `;
}

function googleSetupStepContent(step, setup) {
  if (step === 5) {
    return `<h2 class="setup-title">Import the client JSON</h2>
      ${googleSetupImportHtml(setup)}`;
  }
  const steps = [
    {
      title: "Create a Google Cloud project",
      copy: "Courier connects to Gmail through an OAuth client in your own Google Cloud project. Create one project for Courier and keep it selected for the remaining steps.",
      bullets: [
        "Open the project picker.",
        "Choose New project.",
        "Name it Courier Setup Guide and create it.",
      ],
      link: "https://console.cloud.google.com/projectcreate",
      linkLabel: "Open project creation",
    },
    {
      title: "Enable the Gmail API",
      copy: "Open the Gmail API page inside the project you just created and select Enable. Courier cannot read or send mail until this API is enabled.",
      bullets: [
        "Use the same project from the first step.",
        "Select Enable.",
        "Return here when Google says the API is enabled.",
      ],
      link: "https://console.cloud.google.com/apis/enableflow;apiid=gmail.googleapis.com",
      linkLabel: "Open Gmail API",
    },
    {
      title: "Set up the Google Auth platform",
      copy: "Google needs a consent screen before it will issue tokens. Branding names the app; Audience controls who can sign in while the app is in testing.",
      bullets: [
        "Branding: enter an app name and support email, choose External, add a contact email.",
        "Audience: add every Gmail address you will connect as a Test user.",
        "Testing apps issue 7-day refresh tokens. Publishing to production avoids that. Verification is free and optional for personal or limited use under 100 users. Reconnect after publishing.",
      ],
      link: "https://console.cloud.google.com/auth/branding",
      linkLabel: "Open Google Auth platform",
      secondaryLink: "https://console.cloud.google.com/auth/audience",
      secondaryLabel: "Open Audience",
    },
    {
      title: "Add the Gmail scopes",
      copy: "Open Data Access, choose Add or remove scopes, and paste these into Manually add scopes. Save the selection before leaving the page.",
      bullets: [],
      link: "https://console.cloud.google.com/auth/scopes",
      linkLabel: "Open Data Access",
      scopes: true,
    },
    {
      title: "Create a Desktop OAuth client",
      copy: "Open Clients, choose Create client, select Desktop app, name it Courier Desktop, and select Create. Do not choose Web application.",
      bullets: [
        "Application type: Desktop app.",
        "The client ID and secret are generated together.",
        "Download the JSON on the next step.",
      ],
      link: "https://console.cloud.google.com/auth/clients",
      linkLabel: "Open Clients",
    },
  ];
  const item = steps[step];
  if (!item) return "";
  const scopeBlock = item.scopes
    ? `<div class="setup-scope-block">
      <div class="setup-scope-head"><span>Scopes to add</span><button type="button" class="link-btn" data-action="google-setup-copy-scopes">Copy</button></div>
      <code>${GOOGLE_OAUTH_SCOPES.join("<br>")}</code>
    </div>`
    : "";
  return `<h2 class="setup-title">${item.title}</h2>
    <p class="setup-copy">${item.copy}</p>
    ${
      item.bullets && item.bullets.length
        ? `<ul class="setup-bullets">${item.bullets
            .map((bullet) => `<li>${bullet}</li>`)
            .join("")}</ul>`
        : ""
    }
    ${scopeBlock}
    <div class="setup-link-row">
      <a class="btn accent" href="${item.link}" target="_blank" rel="noreferrer">${item.linkLabel}</a>
      ${
        item.secondaryLink
          ? `<a class="btn" href="${item.secondaryLink}" target="_blank" rel="noreferrer">${item.secondaryLabel}</a>`
          : ""
      }
    </div>`;
}

function renderGoogleSetup() {
  const setup = state.googleSetup;
  if (!setup) return;
  const root = $("#modal-root");
  if (!root) return;
  const step = setup.step;
  const nextLabel = step === 4 ? "Continue to import" : "Next";
  const footerPrimary =
    step < 5
      ? `<button class="btn accent" data-action="google-setup-next">${nextLabel}</button>`
      : setup.complete
        ? `<button class="btn accent" data-action="google-setup-done">Done</button>`
        : setup.connected && setup.missingScopes.length
          ? `<button class="btn accent" data-action="google-setup-reconnect">Reconnect</button>`
          : setup.imported && !setup.connected && !setup.confirmReplace
            ? `<button class="btn accent" data-action="google-setup-connect" ${
                setup.connecting ? "disabled" : ""
              }>Connect account</button>`
            : `<button class="btn" data-action="google-setup-close">Close</button>`;
  root.hidden = false;
  root.innerHTML = `<div class="modal-backdrop google-setup-backdrop"></div>
    <div class="modal-sheet google-setup" role="dialog" aria-modal="true" aria-labelledby="google-setup-title">
      <header class="google-setup-head">
        <div>
          <h1 id="google-setup-title">Connect Gmail</h1>
          <p>Use your own Google Cloud OAuth client. Courier keeps the credentials and mail data on this machine.</p>
        </div>
        <button class="icon-btn" data-action="google-setup-close" aria-label="Close setup" title="Close">${icon(
          "x",
          16
        )}</button>
      </header>
      <div class="setup-progress">
        <span>Step ${step + 1} of ${GOOGLE_SETUP_STEPS}</span>
        <div class="setup-dots" aria-hidden="true">${Array.from(
          { length: GOOGLE_SETUP_STEPS },
          (_, index) =>
            `<span class="${index <= step ? "done" : ""} ${
              index === step ? "current" : ""
            }"></span>`
        ).join("")}</div>
      </div>
      <div class="google-setup-body">
        <div class="setup-instructions">${googleSetupStepContent(step, setup)}</div>
        ${googleSetupVisual(step)}
      </div>
      <footer class="google-setup-foot">
        <button class="link-btn" data-action="google-setup-skip" ${
          step === 5 ? "hidden" : ""
        }>Skip to import</button>
        <span class="toolbar-spacer"></span>
        ${
          step > 0
            ? `<button class="btn" data-action="google-setup-back">Back</button>`
            : ""
        }
        ${footerPrimary}
      </footer>
    </div>`;
  const backdrop = $(".google-setup-backdrop", root);
  if (backdrop) backdrop.addEventListener("click", closeGoogleSetup);
  if (state.googleSetupKeyHandler) {
    document.removeEventListener("keydown", state.googleSetupKeyHandler, true);
  }
  state.googleSetupKeyHandler = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeGoogleSetup();
  };
  document.addEventListener("keydown", state.googleSetupKeyHandler, true);
  requestAnimationFrame(() => {
    const primary = $(".google-setup-foot .btn.accent", root);
    if (primary) primary.focus({ preventScroll: true });
  });
}

function openGoogleSetup(options = {}) {
  if (state.googleSetup) {
    if (Number.isInteger(options.step)) {
      state.googleSetup.step = Math.max(
        0,
        Math.min(GOOGLE_SETUP_STEPS - 1, options.step)
      );
      renderGoogleSetup();
    }
    return;
  }
  if (state.modalOpen) return;
  state.modalOpen = true;
  state.googleSetup = {
    step: Number.isInteger(options.step) ? Math.max(0, Math.min(5, options.step)) : 0,
    firstRun: Boolean(options.firstRun),
    imported: Boolean(state.settings.oauth_client_configured),
    startedConfigured: Boolean(state.settings.oauth_client_configured),
    connecting: false,
    connected: false,
    accountId: "",
    accountEmail: "",
    accountCount: 0,
    missingScopes: [],
    complete: false,
    importError: "",
    jsonText: "",
    confirmReplace: false,
    pendingJson: "",
    knownAccountIds: new Set(state.accounts.map((account) => account.id)),
    status: null,
  };
  if (state.settings.oauth_client_configured && state.accounts.length) {
    const missing = new Set();
    for (const account of state.accounts) {
      for (const scope of missingOAuthScopes(account)) missing.add(scope);
    }
    state.googleSetup.connected = true;
    state.googleSetup.accountId =
      state.accounts.length === 1 ? state.accounts[0].id : "";
    state.googleSetup.accountEmail =
      state.accounts.length === 1 ? state.accounts[0].email : "";
    state.googleSetup.accountCount = state.accounts.length;
    state.googleSetup.missingScopes = Array.from(missing);
    state.googleSetup.complete =
      state.googleSetup.imported && missing.size === 0;
  }
  renderGoogleSetup();
}

function closeGoogleSetup() {
  if (!state.googleSetup) return;
  const firstRun = state.googleSetup.firstRun;
  state.googleSetup = null;
  state.modalOpen = false;
  if (state.googleSetupKeyHandler) {
    document.removeEventListener("keydown", state.googleSetupKeyHandler, true);
    state.googleSetupKeyHandler = null;
  }
  const root = $("#modal-root");
  if (root) {
    root.hidden = true;
    root.innerHTML = "";
  }
  if (!state.prefs.googleSetupSeen) {
    state.prefs.googleSetupSeen = true;
    savePrefs();
  }
  if (firstRun && !state.accounts.length) {
    openSettings("accounts");
  }
}

async function chooseOAuthJson() {
  if (!state.googleSetup) return;
  try {
    const data = await api("/api/choose-oauth-json", {
      method: "POST",
      body: {},
    });
    const field = $("#oauth-json-input");
    if (field) field.value = data.text || "";
    state.googleSetup.importError = "";
    state.googleSetup.jsonText = data.text || "";
    renderGoogleSetup();
  } catch (error) {
    if (error.message === "No file selected.") return;
    state.googleSetup.importError = `${error.message || "Could not open the file chooser."} Paste the JSON below instead.`;
    renderGoogleSetup();
  }
}

async function importOAuthJson(text) {
  if (!state.googleSetup) return;
  const setup = state.googleSetup;
  try {
    const data = await api("/api/oauth/import", {
      method: "POST",
      body: { json: text },
    });
    state.settings = Object.assign({}, state.settings, data.settings || {});
    setup.imported = true;
    setup.confirmReplace = false;
    setup.pendingJson = "";
    setup.jsonText = "";
    setup.importError = "";
    setup.connected = false;
    setup.complete = false;
    setup.accountId = "";
    setup.accountEmail = "";
    setup.accountCount = 0;
    setup.missingScopes = [];
    setup.status = null;
    renderGoogleSetup();
  } catch (error) {
    setup.importError = error.message || "Could not import that JSON.";
    renderGoogleSetup();
  }
}

async function submitOAuthJson() {
  const setup = state.googleSetup;
  if (!setup) return;
  const field = $("#oauth-json-input");
  const text = field ? field.value.trim() : "";
  if (!text) {
    setup.importError = "Paste the downloaded OAuth client JSON first.";
    renderGoogleSetup();
    return;
  }
  setup.jsonText = text;
  if (state.settings.oauth_client_configured && !setup.confirmReplace) {
    setup.confirmReplace = true;
    setup.pendingJson = text;
    setup.importError = "";
    renderGoogleSetup();
    return;
  }
  await importOAuthJson(text);
}

/* -------------------------------------------------------------------------- */
/* Search                                                                    */
/* -------------------------------------------------------------------------- */

function updateSearchClear() {
  const input = $("#search-input");
  const clear = $("#search-clear");
  if (clear) clear.hidden = !input || !input.value;
}

function handleSearchInput() {
  const input = $("#search-input");
  if (!input) return;
  const value = input.value;
  if (value.trim()) dismissSettingsPage();
  updateSearchClear();
  if (!value.trim()) {
    if (state.searchMode || state.query) {
      state.query = "";
      state.searchMode = false;
      state.remoteSearch = false;
      clearTimeout(state.searchTimer);
      loadThreads();
    }
    return;
  }
  state.query = value;
  state.searchMode = true;
  state.labelName = null;
  renderSidebar();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.remoteSearch = false;
    loadThreads({ quiet: true });
  }, 260);
}

function clearSearch(load = true) {
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  clearTimeout(state.searchTimer);
  if (load) loadThreads();
  renderSidebar();
  renderList();
}

/* -------------------------------------------------------------------------- */
/* OAuth flow                                                                 */
/* -------------------------------------------------------------------------- */

async function beginOAuth(options = {}) {
  const setupMode = Boolean(options.setup);
  const idInput = $("#oauth-client-id");
  const secretInput = $("#oauth-client-secret");
  const clientId = idInput
    ? idInput.value.trim()
    : state.settings.oauth_client_id || "";
  const clientSecret = secretInput ? secretInput.value.trim() : "";
  const report = setupMode ? setGoogleSetupStatus : setOAuthStatus;
  if (!clientId || (!clientSecret && !state.settings.oauth_client_secret_set)) {
    if (setupMode && state.googleSetup) {
      state.googleSetup.importError =
        "Import a Desktop OAuth client JSON before connecting.";
      state.googleSetup.step = GOOGLE_SETUP_STEPS - 1;
      renderGoogleSetup();
    } else {
      openGoogleSetup();
    }
    return;
  }
  if (setupMode && state.googleSetup) {
    state.googleSetup.connecting = true;
    state.googleSetup.connected = false;
    state.googleSetup.missingScopes = [];
    state.googleSetup.complete = false;
    state.googleSetup.status = { html: "Starting Google sign-in.", error: false };
    renderGoogleSetup();
  } else {
    report("Starting Google sign-in.", false);
  }
  try {
    const body =
      clientId && (clientSecret || !state.settings.oauth_client_secret_set)
        ? { client_id: clientId, client_secret: clientSecret }
        : {};
    const data = await api("/api/oauth/start", {
      method: "POST",
      body,
    });
    state.oauthUrl = data.url;
    state.oauthPending = true;
    const wasEmpty = state.accounts.length === 0;
    state.oauthWasEmpty = wasEmpty;
    report(
      `Waiting for Google sign-in. <a href="${esc(
        data.url
      )}" target="_blank" rel="noreferrer">Open Google sign-in</a>`,
      false
    );
    try {
      window.open(data.url, "_blank", "noopener");
    } catch (error) {
      /* The link above is the fallback. */
    }
    state.settings.oauth_client_id = clientId;
    state.settings.oauth_client_secret_set = true;
    state.settings.oauth_client_configured = true;
    if (setupMode && state.googleSetup) renderGoogleSetup();
    pollOAuth(wasEmpty, { setup: setupMode });
  } catch (error) {
    if (setupMode && state.googleSetup) {
      state.googleSetup.connecting = false;
      state.googleSetup.status = {
        html: esc(error.message || "Could not start Google sign-in."),
        error: true,
      };
      renderGoogleSetup();
    } else {
      setOAuthStatus(
        esc(error.message || "Could not start Google sign-in."),
        true
      );
    }
  }
}

function pollOAuth(wasEmpty = false, options = {}) {
  const setupMode = Boolean(options.setup);
  if (state.oauthTimer) clearTimeout(state.oauthTimer);
  const deadline = Date.now() + 5 * 60 * 1000;
  const finishSetup = (connectedEmail) => {
    if (!state.googleSetup) return;
    const known = state.googleSetup.knownAccountIds || new Set();
    const found =
      state.accounts.find(
        (item) => connectedEmail && item.email === connectedEmail
      ) ||
      state.accounts.find((item) => !known.has(item.id)) ||
      state.accounts[state.accounts.length - 1] ||
      null;
    const missing = found ? missingOAuthScopes(found) : [];
    state.googleSetup.connecting = false;
    state.googleSetup.connected = Boolean(found);
    state.googleSetup.accountId = found ? found.id : "";
    state.googleSetup.accountEmail = found ? found.email : connectedEmail;
    state.googleSetup.accountCount = found ? 1 : 0;
    state.googleSetup.missingScopes = missing;
    state.googleSetup.complete = Boolean(
      state.googleSetup.imported && found && missing.length === 0
    );
    state.googleSetup.status = found
      ? null
      : {
          html: "Google sign-in completed, but the account was not found.",
          error: true,
        };
    renderGoogleSetup();
  };
  const tick = async () => {
    if (!state.oauthPending && !state.oauthUrl) return;
    try {
      const data = await api("/api/oauth/status");
      if (data.status === "connected") {
        state.oauthPending = false;
        state.oauthUrl = "";
        const connectedEmail = data.account && data.account.email;
        await refreshState({ quiet: true });
        if (setupMode && state.googleSetup) {
          finishSetup(connectedEmail || "");
        } else {
          setOAuthStatus("Account connected.");
          toast("Google account connected");
          if (state.settingsOpen) renderSettings();
        }
        await loadThreads({ quiet: true });
        if (wasEmpty && !setupMode) {
          setTimeout(() => {
            if (state.settingsOpen) closeSettings();
          }, 500);
        }
        return;
      }
      if (data.status === "error") {
        state.oauthPending = false;
        state.oauthUrl = "";
        const message = esc(data.error || "Google sign-in failed.");
        if (setupMode && state.googleSetup) {
          state.googleSetup.connecting = false;
          state.googleSetup.status = { html: message, error: true };
          renderGoogleSetup();
        } else {
          setOAuthStatus(message, true);
        }
        return;
      }
      if (Date.now() > deadline) {
        state.oauthPending = false;
        const message = "Google sign-in timed out. Try again.";
        if (setupMode && state.googleSetup) {
          state.googleSetup.connecting = false;
          state.googleSetup.status = { html: message, error: true };
          renderGoogleSetup();
        } else {
          setOAuthStatus(message, true);
        }
        return;
      }
      state.oauthTimer = setTimeout(tick, 1300);
    } catch (error) {
      state.oauthTimer = setTimeout(tick, 2000);
    }
  };
  state.oauthTimer = setTimeout(tick, 900);
}

/* -------------------------------------------------------------------------- */
/* AI settings                                                               */
/* -------------------------------------------------------------------------- */

function readAIFields() {
  return {
    base: $("#ai-base-url")?.value.trim() || "",
    model: $("#ai-model")?.value.trim() || "",
    key: $("#ai-key")?.value.trim() || "",
  };
}

async function saveAISettings(options = {}) {
  const fields = readAIFields();
  if (!fields.base && !fields.model) return false;
  try {
    const data = await api("/api/settings", {
      method: "POST",
      body: {
        ai_base_url: fields.base,
        ai_model: fields.model,
        ai_api_key: fields.key,
      },
    });
    state.settings = Object.assign({}, state.settings, data);
    const keyInput = $("#ai-key");
    if (keyInput) {
      keyInput.value = "";
      keyInput.placeholder = data.ai_api_key_set ? "Saved" : "API key";
    }
    if (!options.silent) {
      setAIStatus("Saved.");
      if (state.settingsOpen) renderSettings();
    }
    return true;
  } catch (error) {
    setAIStatus(esc(error.message || "Could not save."), true);
    return false;
  }
}

async function testAI() {
  const saved = await saveAISettings({ silent: true });
  if (!saved) return;
  setAIStatus(`<span class="spinner"></span> Testing`);
  try {
    const data = await api("/api/ai/test", { method: "POST", body: {} });
    setAIStatus(`Provider replied: ${esc(data.result)}`);
  } catch (error) {
    setAIStatus(esc(error.message || "Provider test failed."), true);
  }
}

async function clearAIKey() {
  try {
    const data = await api("/api/settings", {
      method: "POST",
      body: { clear_ai_api_key: true },
    });
    state.settings = Object.assign({}, state.settings, data);
    setAIStatus("Key removed.");
    if (state.settingsOpen) renderSettings();
  } catch (error) {
    setAIStatus(esc(error.message || "Could not remove the key."), true);
  }
}

/* -------------------------------------------------------------------------- */
/* Account actions                                                            */
/* -------------------------------------------------------------------------- */

async function removeAccount(accountId) {
  const account = accountFor(accountId);
  if (!account) return;
  const confirmed = await showModal({
    title: "Remove account",
    message: `${account.email} will be disconnected from Courier. Mail stays in Gmail.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api("/api/accounts/remove", {
      method: "POST",
      body: { id: accountId },
    });
    if (state.editingAccountId === accountId) {
      state.editingAccountId = null;
      state.accountEditorColor = null;
    }
    if (state.accountFilter === accountId) state.accountFilter = null;
    if (state.selected && state.selected.thread.account_id === accountId) {
      clearSelection();
    }
    await refreshState({ quiet: true });
    renderSettings();
    renderReader();
    renderList();
    if (!state.accounts.length) openSettings("accounts");
    else loadThreads({ quiet: true });
  } catch (error) {
    toast(error.message || "Could not remove the account", true);
  }
}

/* -------------------------------------------------------------------------- */
/* Composer interactions                                                      */
/* -------------------------------------------------------------------------- */

function toggleCcBcc() {
  const form = $("#composer .composer-form");
  if (!form) return;
  for (const row of $$(".composer-row", form)) {
    if ($(".composer-cc", row) || $(".composer-bcc", row)) row.hidden = !row.hidden;
  }
}

async function applyFormat(command) {
  const editor = $("#composer .composer-editor");
  if (!editor) return;
  editor.focus();
  if (command === "createLink") {
    let range = null;
    const selection = window.getSelection();
    if (selection && selection.rangeCount) range = selection.getRangeAt(0).cloneRange();
    const url = await showModal({
      title: "Insert link",
      input: true,
      placeholder: "https://",
      confirmLabel: "Insert",
    });
    if (!url) return;
    let href = url.trim();
    if (/^javascript:/i.test(href)) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = `https://${href}`;
    editor.focus();
    if (range) {
      try {
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (error) {
        /* Ignore stale selections. */
      }
    }
    document.execCommand("createLink", false, href);
    return;
  }
  document.execCommand(command, false, null);
}

function removeComposerAttachment(index) {
  if (!state.composer) return;
  state.composer.attachments.splice(index, 1);
  renderComposerAttachments();
  scheduleDraftSave();
  scheduleComposerSize(state.composer);
}

function setComposerMode(mode) {
  if (!state.composer) return;
  if (!currentThread()) return;
  captureComposerFields();
  state.composer.mode = mode;
  state.prefs.composerMode = mode;
  savePrefs();
  renderComposer();
}

/* -------------------------------------------------------------------------- */
/* Focus / layout                                                             */
/* -------------------------------------------------------------------------- */

function setLayout(layout) {
  if (!["split", "reading"].includes(layout)) return;
  state.prefs.layout = layout;
  savePrefs();
  $$(".segment").forEach((button) =>
    button.setAttribute("aria-pressed", button.dataset.layout === layout ? "true" : "false")
  );
  updateReaderPane();
  updateReaderToolbar();
  renderList();
  window.dispatchEvent(new Event("resize"));
}

function toggleFocus() {
  if (!currentThread()) return;
  state.focusEmail = !state.focusEmail;
  updateReaderPane();
  updateReaderToolbar();
}

/* -------------------------------------------------------------------------- */
/* Event wiring                                                               */
/* -------------------------------------------------------------------------- */

async function handleAction(element, event) {
  const action = element.dataset.action;
  if (!action) return;
  if (element.disabled) return;
  closeMenu();
  switch (action) {
    case "toggle-sidebar":
      state.prefs.sidebarCollapsed = !state.prefs.sidebarCollapsed;
      savePrefs();
      updateReaderPane();
      renderSidebar();
      return;
    case "compose":
      openComposer("new");
      return;
    case "add-account":
      openSettings("accounts");
      return;
    case "settings":
      openSettings();
      return;
    case "folder":
      selectFolder(element.dataset.folder);
      return;
    case "label":
      selectLabel(
        element.dataset.label,
        element.dataset.labelAccount || undefined
      );
      return;
    case "view":
      selectView(Number(element.dataset.view));
      return;
    case "view-create":
      openViewEditor(element.dataset.account);
      return;
    case "view-edit": {
      const view = viewById(element.dataset.view);
      if (view) openViewEditor(view.account_id, view);
      return;
    }
    case "view-delete":
      await deleteViewEditor();
      return;
    case "view-delete-menu": {
      const view = viewById(element.dataset.view);
      if (view) await confirmDeleteView(view);
      return;
    }
    case "view-cancel":
      closeViewEditor();
      return;
    case "view-save":
      await saveViewEditor();
      return;
    case "toggle-account-labels": {
      const key = element.dataset.account;
      if (!key) return;
      if (state.expandedAccounts.has(key)) state.expandedAccounts.delete(key);
      else state.expandedAccounts.add(key);
      renderSidebar();
      return;
    }
    case "account-labels-more": {
      const key = element.dataset.account;
      if (!key) return;
      if (state.expandedLabelLists.has(key)) state.expandedLabelLists.delete(key);
      else state.expandedLabelLists.add(key);
      renderSidebar();
      return;
    }
    case "account-filter":
      setAccountFilter(element.dataset.account);
      return;
    case "all-accounts":
      setAccountFilter(null);
      return;
    case "sync":
      try {
        await api("/api/sync", { method: "POST", body: {} });
        await refreshState({ quiet: true });
        schedulePoll(1200);
      } catch (error) {
        toast(error.message || "Could not check mail", true);
      }
      return;
    case "back-to-list":
      closeSummary();
      if (state.composer) closeComposer();
      clearSelection();
      renderReader();
      renderList();
      if (state.unreadOnly) loadThreads({ quiet: true });
      updateReaderPane();
      return;
    case "toggle-unread":
      state.unreadOnly = !state.unreadOnly;
      loadThreads();
      return;
    case "retry-list":
      loadThreads();
      return;
    case "retry-reader":
      if (state.selectedKey) {
        const [accountId, threadId] = state.selectedKey.split(":");
        await openThread(accountId, threadId, { force: true });
      }
      return;
    case "star-row":
      if (element.dataset.account && element.dataset.thread) {
        toggleStarRow(element.dataset.account, element.dataset.thread);
      }
      return;
    case "reply":
    case "reply-all":
    case "forward":
      if (!currentThread()) {
        toast("Open a thread first.", true);
        return;
      }
      openComposer(action, { messageId: element.dataset.messageId || "" });
      return;
    case "summarize-message":
      startSummary("message", element.dataset.messageId || "");
      return;
    case "expand-message": {
      const id = element.dataset.messageId;
      if (!id) return;
      state.expanded.add(id);
      renderReader();
      return;
    }
    case "collapse-message": {
      const id = element.dataset.messageId;
      if (!id) return;
      state.expanded.delete(id);
      renderReader();
      return;
    }
    case "reply-from-message":
      openComposer("reply", { messageId: element.dataset.messageId });
      return;
    case "summary-menu":
      summaryMenu(element);
      return;
    case "summary-offer": {
      const thread = currentThread();
      if (thread) startSummary("thread");
      return;
    }
    case "summary-offer-dismiss": {
      const thread = currentThread();
      if (thread) {
        state.summaryOffersDismissed.add(threadKey(thread.account_id, thread.id));
        renderReader();
      }
      return;
    }
    case "summary-unread":
      startSummary("unread");
      return;
    case "summary-thread":
      startSummary("thread");
      return;
    case "summary-latest": {
      const messages = currentMessages();
      const latest = messages[messages.length - 1];
      startSummary("message", latest ? latest.id : "");
      return;
    }
    case "summary-close":
      closeSummary({ discard: true });
      return;
    case "summary-stop":
      if (state.summary && state.summary.controller) {
        state.summary.controller.abort();
      }
      closeSummary();
      return;
    case "summary-regenerate":
      if (state.summary) {
        startSummary(state.summary.scope, state.summary.messageId, {
          force: true,
        });
      }
      return;
    case "star-thread": {
      const thread = currentThread();
      if (thread) toggleStarRow(thread.account_id, thread.id);
      return;
    }
    case "mark-unread": {
      const thread = currentThread();
      if (thread) await actOnThread(thread.unread ? "read" : "unread");
      return;
    }
    case "archive-thread":
      await actOnThread("archive");
      return;
    case "trash-thread":
      await actOnThread("trash");
      return;
    case "thread-menu":
      threadMenu(element);
      return;
    case "thread-debug-copy":
      await copyThreadDebug();
      return;
    case "message-debug-copy": {
      const messageId = element.dataset.messageId || "";
      const message = currentMessages().find((item) => item.id === messageId);
      if (message) await copyMessageDebug(message);
      return;
    }
    case "thread-spam":
      await actOnThread("spam");
      return;
    case "thread-inbox":
      await actOnThread("inbox");
      return;
    case "toggle-focus":
      toggleFocus();
      return;
    case "close-menu":
      closeMenu();
      return;
    case "context-summary-all":
    case "context-summary-unread": {
      const thread = threadFromElement(element);
      if (thread) {
        openContextSummary(
          thread,
          action === "context-summary-unread" ? "unread" : "thread"
        );
      }
      return;
    }
    case "context-summary-stop":
      if (state.contextSummary && state.contextSummary.controller) {
        state.contextSummary.controller.abort();
      }
      if (state.contextSummary) {
        state.contextSummary.loading = false;
        renderContextSummary();
      }
      return;
    case "context-summary-regenerate":
      if (state.contextSummary) {
        openContextSummary(
          {
            account_id: state.contextSummary.account,
            id: state.contextSummary.id,
          },
          state.contextSummary.scope
        );
      }
      return;
    case "context-summary-close":
      closeContextSummary();
      return;
    case "context-read":
    case "context-unread":
    case "context-spam": {
      const thread = threadFromElement(element);
      if (thread) {
        await actOnThread(action.replace("context-", ""), { thread });
      }
      return;
    }
    case "context-archive": {
      const thread = threadFromElement(element);
      if (thread) await actOnThread("archive", { thread });
      return;
    }
    case "context-trash": {
      const thread = threadFromElement(element);
      if (thread) await actOnThread("trash", { thread });
      return;
    }
    case "context-inbox": {
      const thread = threadFromElement(element);
      if (thread) await actOnThread("inbox", { thread });
      return;
    }
    case "composer-attach":
      await chooseComposerAttachments();
      return;
    case "download-attachment": {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const url = element.dataset.attachmentUrl || "";
      const filename = element.dataset.attachmentName || "";
      if (!url) return;
      try {
        const absoluteUrl = new URL(url, window.location.href).href;
        await api("/api/download-attachment", {
          method: "POST",
          body: { url: absoluteUrl, filename },
        });
        toast("Downloading attachment");
      } catch (error) {
        toast(error.message || "Could not save the attachment", true);
      }
      return;
    }
    case "open-attachment": {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const url = element.dataset.attachmentUrl || element.getAttribute("href") || "";
      const filename = element.dataset.attachmentName || "";
      if (!url) return;
      try {
        const absoluteUrl = new URL(url, window.location.href).href;
        await api("/api/open-attachment", {
          method: "POST",
          body: { url: absoluteUrl, filename },
        });
        toast("Opening attachment");
      } catch (error) {
        toast(error.message || "Could not open the attachment", true);
      }
      return;
    }
    case "copy-email-address": {
      const value = element.dataset.email || "";
      if (!value) return;
      if (await copyText(value)) toast("Email address copied");
      else toast("Could not copy the email address", true);
      return;
    }
    case "account-customize": {
      const account = accountFor(element.dataset.account);
      if (!account) return;
      state.editingAccountId = account.id;
      state.accountEditorColor = account.color;
      if (!(account.id in state.signatures)) {
        await loadSignatures({ quiet: true });
      }
      state.accountEditorSignatureEnabled = Boolean(account.signature_enabled);
      state.accountEditorSignatureHtml = String(
        state.signatures[account.id] || ""
      );
      openSettings("accounts");
      const pane = $("#settings-pane");
      if (pane) pane.scrollTop = 0;
      setTimeout(
        () => $("#account-username-input")?.focus({ preventScroll: true }),
        20
      );
      return;
    }
    case "lightbox-close":
      closeLightbox();
      return;
    case "lightbox-prev":
      stepLightbox(-1);
      return;
    case "lightbox-next":
      stepLightbox(1);
      return;
    case "lightbox-zoom-in":
      setLightboxZoom((state.lightbox ? state.lightbox.zoom : 1) + 0.5);
      return;
    case "lightbox-zoom-out":
      setLightboxZoom((state.lightbox ? state.lightbox.zoom : 1) - 0.5);
      return;
    case "lightbox-zoom-reset":
      setLightboxZoom(1);
      return;
    case "lightbox-select": {
      const index = Number(element.dataset.index);
      if (Number.isFinite(index)) setLightboxIndex(index);
      return;
    }
    case "theme": {
      state.prefs.theme = element.dataset.theme;
      applyPrefs();
      syncThemeSelection();
      return;
    }
    case "accent": {
      state.prefs.accent = element.dataset.accent;
      applyPrefs();
      syncThemeSelection();
      return;
    }
    case "google-setup-open":
      openGoogleSetup();
      return;
    case "google-setup-close":
      closeGoogleSetup();
      return;
    case "google-setup-done":
      closeGoogleSetup();
      return;
    case "google-setup-next":
      if (state.googleSetup) {
        state.googleSetup.step = Math.min(
          GOOGLE_SETUP_STEPS - 1,
          state.googleSetup.step + 1
        );
        renderGoogleSetup();
      }
      return;
    case "google-setup-back":
      if (state.googleSetup) {
        state.googleSetup.step = Math.max(0, state.googleSetup.step - 1);
        renderGoogleSetup();
      }
      return;
    case "google-setup-skip":
      if (state.googleSetup) {
        state.googleSetup.step = GOOGLE_SETUP_STEPS - 1;
        renderGoogleSetup();
      }
      return;
    case "google-setup-copy-scopes":
      await copyText(GOOGLE_OAUTH_SCOPES.join("\n"));
      toast("Copied the Gmail scopes");
      return;
    case "google-setup-choose-json":
      await chooseOAuthJson();
      return;
    case "google-setup-import":
      await submitOAuthJson();
      return;
    case "google-setup-import-replace":
      if (state.googleSetup && state.googleSetup.pendingJson) {
        await importOAuthJson(state.googleSetup.pendingJson);
      }
      return;
    case "google-setup-import-cancel":
      if (state.googleSetup) {
        state.googleSetup.confirmReplace = false;
        state.googleSetup.pendingJson = "";
        renderGoogleSetup();
      }
      return;
    case "google-setup-connect":
    case "google-setup-reconnect":
      await beginOAuth({ setup: true });
      return;
    case "oauth-connect":
      await beginOAuth();
      return;
    case "account-edit": {
      const account = accountFor(element.dataset.account);
      if (!account) return;
      state.editingAccountId = account.id;
      state.accountEditorColor = account.color;
      if (!(account.id in state.signatures)) {
        await loadSignatures({ quiet: true });
      }
      state.accountEditorSignatureEnabled = Boolean(account.signature_enabled);
      state.accountEditorSignatureHtml = String(
        state.signatures[account.id] || ""
      );
      const pane = $("#settings-pane");
      const scroll = pane ? pane.scrollTop : 0;
      renderSettings();
      if (pane) pane.scrollTop = scroll;
      setTimeout(() => $("#account-username-input")?.focus({ preventScroll: true }), 20);
      return;
    }
    case "account-edit-cancel":
      state.editingAccountId = null;
      state.accountEditorColor = null;
      state.accountEditorSignatureEnabled = false;
      state.accountEditorSignatureHtml = "";
      {
        const pane = $("#settings-pane");
        const scroll = pane ? pane.scrollTop : 0;
        renderSettings();
        if (pane) pane.scrollTop = scroll;
      }
      return;
    case "account-color":
      state.accountEditorColor = element.dataset.color;
      updateAccountEditorColors();
      return;
    case "account-save":
      await saveAccountEditor();
      return;
    case "account-signature-edit":
      openSignatureEditor();
      return;
    case "signature-save":
      await saveSignatureEditor();
      return;
    case "signature-cancel":
      requestCloseSignatureEditor();
      return;
    case "signature-discard":
      closeSignatureEditor();
      return;
    case "signature-keep-editing":
      hideSignatureDiscardConfirm();
      return;
    case "signature-link-insert":
      insertSignatureLink();
      return;
    case "signature-link-cancel":
      hideSignatureLinkRow();
      return;
    case "signature-image-small":
      resizeSignatureContextImage("small");
      return;
    case "signature-image-original":
      resizeSignatureContextImage("original");
      return;
    case "signature-image-delete":
      deleteSignatureImage();
      return;
    case "badge-position":
      state.prefs.badgePosition = element.dataset.position;
      savePrefs();
      syncChoiceGroup("badge-position", "position", state.prefs.badgePosition);
      renderList();
      return;
    case "label-position":
      state.prefs.labelPosition = element.dataset.position;
      savePrefs();
      syncChoiceGroup("label-position", "position", state.prefs.labelPosition);
      renderList();
      return;
    case "notify-badge-position":
      state.prefs.notifyBadgePosition = element.dataset.position;
      savePrefs();
      syncChoiceGroup(
        "notify-badge-position",
        "position",
        state.prefs.notifyBadgePosition
      );
      return;
    case "content-width":
      state.prefs.contentWidth = element.dataset.width;
      applyPrefs();
      syncChoiceGroup("content-width", "width", state.prefs.contentWidth);
      return;
    case "email-theme":
      state.prefs.emailTheme = element.dataset.emailTheme;
      savePrefs();
      syncThemeSelection();
      updateComposerPaperTheme();
      updateSignaturePaperTheme();
      if (state.selected) renderReader();
      return;
    case "minimize-behavior":
      state.prefs.minimizeBehavior = element.dataset.behavior;
      savePrefs();
      syncChoiceGroup("minimize-behavior", "behavior", state.prefs.minimizeBehavior);
      return;
    case "close-behavior":
      state.prefs.closeBehavior = element.dataset.behavior;
      savePrefs();
      syncChoiceGroup("close-behavior", "behavior", state.prefs.closeBehavior);
      return;
    case "login-startup":
      state.prefs.loginStartup = element.dataset.mode;
      savePrefs();
      syncChoiceGroup("login-startup", "mode", state.prefs.loginStartup);
      return;
    case "update-interval":
      state.prefs.updateInterval = Number(element.dataset.hours) || 5;
      savePrefs();
      syncChoiceGroup(
        "update-interval",
        "hours",
        String(state.prefs.updateInterval)
      );
      scheduleUpdateCheck();
      return;
    case "update-check":
      await checkForUpdates();
      return;
    case "update-apply":
      await applyUpdate();
      return;
    case "update-restart":
      await restartCourier();
      return;
    case "update-open":
      if (state.updateResult && state.updateResult.url) {
        try {
          window.open(state.updateResult.url, "_blank", "noopener");
        } catch (error) {
          /* The release link is also shown in the update status. */
        }
      }
      return;
    case "notify-upload":
      $("#notification-sound-file")?.click();
      return;
    case "notify-test":
      try {
        await api("/api/notify/test", { method: "POST", body: {} });
        toast("Test notification sent");
      } catch (error) {
        toast(error.message || "Could not send a test notification", true);
      }
      return;
    case "refresh-mode":
      await setRefreshMode(element.dataset.mode);
      return;
    case "account-remove":
      await removeAccount(element.dataset.account);
      return;
    case "ai-save":
      await saveAISettings();
      return;
    case "ai-test":
      await testAI();
      return;
    case "ai-clear-key":
      await clearAIKey();
      return;
    case "composer-mode":
      setComposerMode(element.dataset.mode);
      return;
    case "composer-minimize":
      toggleComposerMinimize();
      return;
    case "composer-restore":
      if (state.composer && state.composer.minimized) {
        state.composer.minimized = false;
        renderComposer();
      }
      return;    case "composer-delete-draft":
      await deleteComposerDraftAction();
      return;
    case "composer-close":
      closeComposer();
      return;
    case "composer-cc":
      toggleCcBcc();
      return;
    case "composer-image-small":
      resizeComposerContextImage("small");
      return;
    case "composer-image-original":
      resizeComposerContextImage("original");
      return;
    case "composer-image-attach":
      convertComposerImageToAttachment();
      return;
    case "composer-image-delete":
      deleteComposerImage();
      return;
    case "composer-inline-image":
      await chooseComposerInlineImage();
      return;
    case "toggle-composer-attachments":
      if (!state.composer) return;
      state.composer.attachmentShelfCollapsed =
        !state.composer.attachmentShelfCollapsed;
      renderComposerAttachments();
      return;
    case "view-composer-attachment":
      await viewComposerAttachment(Number(element.dataset.index));
      return;
    case "composer-remove-attachment":
      removeComposerAttachment(Number(element.dataset.index));
      return;
    default:
      return;
  }
}
function bindEvents() {
  let panelResize = null;

  const finishPanelResize = () => {
    if (!panelResize) return;
    panelResize.handle.classList.remove("dragging");
    panelResize = null;
    document.body.style.userSelect = "";
    $("#app")?.classList.remove("panel-resizing");
    window.dispatchEvent(new Event("resize"));
    savePrefs();
  };

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const handle = event.target.closest?.("[data-resizer]");
    if (!handle) return;
    const kind = handle.dataset.resizer;
    if (kind === "sidebar" && state.prefs.sidebarCollapsed) return;
    const pane = kind === "sidebar" ? $("#sidebar") : $("#list-pane");
    if (!pane) return;
    const startWidth = pane.getBoundingClientRect().width;
    if (startWidth < 20) return;
    event.preventDefault();
    panelResize = {
      kind,
      handle,
      startX: event.clientX,
      startWidth,
      width: startWidth,
    };
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    $("#app")?.classList.add("panel-resizing");
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Ignore. */
    }
  });

  document.addEventListener("pointermove", (event) => {
    if (!panelResize) return;
    panelResize.width = setPanelWidth(
      panelResize.kind,
      panelResize.startWidth + event.clientX - panelResize.startX
    );
  });

  document.addEventListener("pointerup", finishPanelResize);
  document.addEventListener("pointercancel", finishPanelResize);

  document.addEventListener("keydown", (event) => {
    const handle = event.target.closest?.("[data-resizer]");
    if (!handle) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const kind = handle.dataset.resizer;
    const key = kind === "sidebar" ? "sidebarWidth" : "listWidth";
    const pane = kind === "sidebar" ? $("#sidebar") : $("#list-pane");
    const current =
      Number(state.prefs[key]) || (pane ? pane.getBoundingClientRect().width : 0);
    setPanelWidth(
      kind,
      current + (event.key === "ArrowRight" ? 16 : -16) * (event.shiftKey ? 3 : 1)
    );
    savePrefs();
  });

  let summaryDrag = null;

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const head = event.target.closest?.(".summary-popover-head");
    if (!head || event.target.closest("button")) return;
    const root = $("#summary-popover");
    if (!root || root.hidden) return;
    const rect = root.getBoundingClientRect();
    event.preventDefault();
    summaryDrag = {
      head,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    if (state.contextSummary) state.contextSummary.dragged = true;
    head.classList.add("dragging");
    document.body.style.userSelect = "none";
    try {
      head.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Ignore. */
    }
  });

  document.addEventListener("pointermove", (event) => {
    if (!summaryDrag) return;
    const root = $("#summary-popover");
    if (!root) return;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const left = Math.max(
      8,
      Math.min(event.clientX - summaryDrag.offsetX, window.innerWidth - width - 8)
    );
    const top = Math.max(
      8,
      Math.min(event.clientY - summaryDrag.offsetY, window.innerHeight - height - 8)
    );
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    if (state.contextSummary) {
      state.contextSummary.position = { left, top };
    }
  });

  const finishSummaryDrag = () => {
    if (!summaryDrag) return;
    summaryDrag.head.classList.remove("dragging");
    summaryDrag = null;
    document.body.style.userSelect = "";
  };
  document.addEventListener("pointerup", finishSummaryDrag);
  document.addEventListener("pointercancel", finishSummaryDrag);

  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    const viewRow = target.closest?.(".view-row[data-view]");
    if (viewRow) {
      event.preventDefault();
      openViewContextMenu(
        viewById(viewRow.dataset.view),
        event.clientX,
        event.clientY
      );
      return;
    }
    const accountRow = target.closest?.(".account-row[data-account]");
    if (accountRow) {
      event.preventDefault();
      openAccountContextMenu(
        accountFor(accountRow.dataset.account),
        event.clientX,
        event.clientY
      );
      return;
    }
    const row = target.closest?.(".thread-row");
    if (row) {
      event.preventDefault();
      openThreadContextMenu(
        threadFromElement(row),
        event.clientX,
        event.clientY
      );
      return;
    }
    const messageHeader = target.closest?.(".message-header");
    if (messageHeader) {
      const article = messageHeader.closest?.(".message, .collapsed-message");
      const messageId = article?.dataset.messageId || "";
      if (messageId) {
        event.preventDefault();
        openMessageContextMenu(messageId, event.clientX, event.clientY);
        return;
      }
    }
    const composerImage = target.closest?.(".composer-editor img");
    if (composerImage) {
      event.preventDefault();
      openComposerImageContextMenu(
        composerImage,
        event.clientX,
        event.clientY
      );
      return;
    }
    if (target.closest?.("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });

  document.addEventListener(
    "click",
    (event) => {
      if (!state.contextSummary) return;
      if (
        event.target.closest?.("#summary-popover") ||
        event.target.closest?.(".menu-root")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeContextSummary();
    },
    true
  );

  document.addEventListener("click", async (event) => {
    if (
      state.contextSummary &&
      !event.target.closest?.("#summary-popover") &&
      !event.target.closest?.(".menu-root")
    ) {
      closeContextSummary();
    }
    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      const isAnchor = actionEl.tagName === "A";
      if (!isAnchor) event.preventDefault();
      await handleAction(actionEl, event);
      return;
    }
    const row = event.target.closest(".thread-row");
    if (row) {
      await openThread(row.dataset.account, row.dataset.thread);
      return;
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (state.lightbox) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepLightbox(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepLightbox(1);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setLightboxZoom(state.lightbox.zoom + 0.5);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setLightboxZoom(state.lightbox.zoom - 0.5);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setLightboxZoom(1);
        return;
      }
      if (event.key === "Tab") return;
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (state.contextSummary) {
        closeContextSummary();
        return;
      }
      if (state.menuOpen) {
        closeMenu();
        return;
      }
      if (state.settingsOpen) {
        closeSettings();
        return;
      }
      if (state.composer) {
        closeComposer();
        return;
      }
      if (state.focusEmail) {
        state.focusEmail = false;
        updateReaderPane();
        updateReaderToolbar();
        return;
      }
      return;
    }
    if (isTypingTarget(event.target) || state.settingsOpen) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === "/") {
      event.preventDefault();
      $("#search-input")?.focus();
      return;
    }
    if (key === "c") {
      event.preventDefault();
      openComposer("new");
      return;
    }
    if (!currentThread()) return;
    if (key === "r") {
      event.preventDefault();
      openComposer("reply");
    } else if (key === "a") {
      event.preventDefault();
      openComposer("reply-all");
    } else if (key === "f") {
      event.preventDefault();
      openComposer("forward");
    } else if (key === "e") {
      event.preventDefault();
      await actOnThread("archive");
    } else if (key === "#") {
      event.preventDefault();
      await actOnThread("trash");
    } else if (key === "u") {
      event.preventDefault();
      await actOnThread(currentThread().unread ? "read" : "unread");
    } else if (key === "s") {
      event.preventDefault();
      const thread = currentThread();
      toggleStarRow(thread.account_id, thread.id);
    } else if (key === "j" || key === "k") {
      event.preventDefault();
      const index = state.threads.findIndex((thread) => thread.key === state.selectedKey);
      const nextIndex = key === "j" ? Math.min(index + 1, state.threads.length - 1) : Math.max(index - 1, 0);
      const next = state.threads[nextIndex];
      if (next) openThread(next.account_id, next.id);
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest?.("button, a, input, textarea, select")) return;
    const row = event.target.closest?.(".thread-row");
    if (row) {
      event.preventDefault();
      await openThread(row.dataset.account, row.dataset.thread);
    }
    const collapsed = event.target.closest?.(".collapsed-message");
    if (collapsed) {
      event.preventDefault();
      state.expanded.add(collapsed.dataset.messageId);
      renderReader();
    }
  });

  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.query.trim().length >= 2) remoteSearch();
  });
  $("#search-input").addEventListener("input", handleSearchInput);
  $("#search-input").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSearch();
      event.target.blur();
    }
  });
  $("#search-clear").addEventListener("click", () => {
    clearSearch();
    $("#search-input")?.focus();
  });

  $$(".segment").forEach((button) => {
    button.addEventListener("click", () => setLayout(button.dataset.layout));
  });

  const settingsPane = $("#settings-pane");
  settingsPane.addEventListener("input", (event) => {
    if (event.target.id !== "notify-volume") return;
    const value = Math.min(100, Math.max(0, Number(event.target.value) || 0));
    state.prefs.notifyVolume = value;
    const label = $("#notify-volume-label");
    if (label) label.textContent = `${value}%`;
    savePrefs();
  });
  settingsPane.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.id === "account-signature-toggle") {
      const accountId = state.editingAccountId;
      const enabled = target.checked;
      state.accountEditorSignatureEnabled = enabled;
      const actions = $("#account-signature-actions");
      if (actions) actions.hidden = !enabled;
      if (!accountId) return;
      const status = $("#account-signature-status");
      try {
        const data = await api("/api/accounts/update", {
          method: "POST",
          body: { id: accountId, signature_enabled: enabled },
        });
        state.accounts = data.state.accounts || state.accounts;
        if (data.signature_html !== undefined) {
          state.signatures[accountId] = data.signature_html;
        }
        if (status) {
          status.textContent = enabled ? "Signature on" : "Signature off";
          status.classList.remove("error");
        }
      } catch (error) {
        target.checked = !enabled;
        state.accountEditorSignatureEnabled = !enabled;
        if (actions) actions.hidden = enabled;
        if (status) {
          status.textContent =
            error.message || "Could not update the signature setting.";
          status.classList.add("error");
        }
      }
      return;
    }
    if (target.matches(".account-color-input")) {
      state.accountEditorColor = target.value;
      updateAccountEditorColors();
      return;
    }
    if (target.matches(".custom-color input")) {
      state.prefs.accent = target.value;
      applyPrefs();
      syncThemeSelection();
      return;
    }
    if (target.id === "notification-sound-file") {
      await uploadNotificationSound(target.files && target.files[0]);
      return;
    }
    if (target.id === "notify-sound-select") {
      state.prefs.notifySound = target.value;
      savePrefs();
      updateNotificationSoundUi();
      return;
    }
    if (target.id === "notify-volume") {
      const value = Math.min(100, Math.max(0, Number(target.value) || 0));
      state.prefs.notifyVolume = value;
      const label = $("#notify-volume-label");
      if (label) label.textContent = `${value}%`;
      savePrefs();
      return;
    }
    if (target.id === "notify-ai-chars") {
      const value = Math.min(5000, Math.max(80, Number(target.value) || 400));
      state.prefs.notifyAIMinChars = value;
      target.value = String(value);
      savePrefs();
      return;
    }
    if (target.matches("input[data-pref='updateAuto']")) {
      state.prefs.updateAuto = target.checked;
      savePrefs();
      scheduleUpdateCheck();
      renderSettings();
      return;
    }
    if (target.matches("input[data-pref='aiEnabled']")) {
      if (target.checked) {
        target.checked = false;
        const accepted = await showModal({
          title: "Enable AI summaries?",
          message:
            "AI summaries send the selected email text to the endpoint you configure. Courier does not operate or control that service. You are responsible for the endpoint, its privacy and retention terms, and the data you choose to share. Only enable this with a provider you trust.",
          confirmLabel: "I understand",
          cancelLabel: "Cancel",
        });
        if (!accepted) return;
        state.prefs.aiEnabled = true;
      } else {
        state.prefs.aiEnabled = false;
        closeSummary();
        closeContextSummary();
      }
      savePrefs();
      renderSettings();
      return;
    }
    if (target.matches("input[data-pref]")) {
      const key = target.dataset.pref;
      state.prefs[key] = target.checked;
      savePrefs();
      if (key === "notifyShowAccount") {
        const row = $("#notify-badge-row");
        if (row) row.hidden = !target.checked;
      }
      if (key === "notifyUseAI") {
        const row = $("#notify-ai-threshold");
        const note = $("#notify-ai-note");
        if (row) row.hidden = !target.checked;
        if (note) note.hidden = !target.checked;
      }
      if (key === "blockImages" && target.checked) clearImageAllowances();
      if (["hideSignatures", "hideQuotes", "blockImages"].includes(key) && state.selected) {
        /* The reader is hidden while settings is open; it will re-render on return. */
      }
    }
  });

  $("#reader").addEventListener("click", (event) => {
    const header = event.target.closest(".message-header");
    if (!header) return;
    const article = header.closest(".message");
    if (!article || article.classList.contains("collapsed-message")) return;
    if (event.target.closest("button, a, summary, details, input, select, label")) return;
    if (window.getSelection && String(window.getSelection())) return;
    toggleMessageExpanded(article.dataset.messageId);
  });

  const composer = $("#composer");
  const keepCaretBeforeSignature = (event) => {
    const editor = event.target.closest?.(".composer-editor");
    if (!editor) return;
    if (event.type === "click") {
      const signature = editor.querySelector("[data-courier-signature]");
      if (signature && event.clientY > signature.getBoundingClientRect().bottom + 2) {
        window.setTimeout(() => placeCaretBeforeSignature(editor), 0);
        return;
      }
    }
    window.setTimeout(() => ensureComposerCaretBeforeSignature(editor), 0);
  };
  composer.addEventListener("click", keepCaretBeforeSignature);
  composer.addEventListener("focusin", keepCaretBeforeSignature);
  composer.addEventListener("click", (event) => {
    if (Date.now() < composerImageClickGuard) {
      event.preventDefault();
      return;
    }
    if (event.target.closest?.(".composer-image-tools")) return;
    const image = event.target.closest?.(".composer-editor img");
    if (!image) {
      if (state.composer && state.composer.selectedImage) {
        clearComposerImageSelection();
      }
      return;
    }
    event.preventDefault();
    selectComposerImage(image);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (composerImageResizeActive || Date.now() < composerImageClickGuard) return;
      if (!state.composer || !state.composer.selectedImage) return;
      if (event.target.closest?.(".composer-image-tools")) return;
      if (event.target.closest?.(".composer-editor img")) return;
      clearComposerImageSelection();
    },
    true
  );
  window.addEventListener("resize", () => {
    if (state.composer && state.composer.selectedImage) {
      positionComposerImageTools();
    }
  });
  composer.addEventListener("submit", async (event) => {
    if (event.target.closest(".composer-form")) {
      event.preventDefault();
      await sendComposer();
    }
  });
  composer.addEventListener("keydown", async (event) => {
    if (event.isComposing) return;
    if (
      state.composer &&
      state.composer.selectedImage &&
      event.target.closest?.(".composer-editor") &&
      !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)
    ) {
      clearComposerImageSelection();
    }
    if (
      event.target.closest?.(".composer-editor") &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey
    ) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        document.execCommand(
          event.shiftKey ? "redo" : "undo",
          false,
          null
        );
        return;
      }
      if (key === "y") {
        event.preventDefault();
        document.execCommand("redo", false, null);
        return;
      }
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      await sendComposer();
      return;
    }
    const suggestionInput = event.target.closest?.(RECIPIENT_SELECTOR);
    if (state.contactMenu && state.contactMenu.input === suggestionInput) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveContactSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeContactMenu();
        return;
      }
      if (event.key === "Tab") {
        closeContactMenu();
        return;
      }
      if (event.key === "Enter" && state.contactMenu.items.length) {
        event.preventDefault();
        event.stopPropagation();
        selectContact(state.contactMenu.items[state.contactMenu.index]);
        return;
      }
    }
    if (event.key !== "Enter") return;
    const input = event.target.closest(
      ".composer-to, .composer-cc, .composer-bcc"
    );
    if (input) {
      event.preventDefault();
      const value = input.value.trim();
      if (value && !value.endsWith(",")) {
        input.value = `${value}, `;
      }
      const end = input.value.length;
      input.setSelectionRange(end, end);
      return;
    }
    if (
      (event.target.tagName === "INPUT" ||
        event.target.tagName === "SELECT") &&
      event.target.closest(".composer-form")
    ) {
      event.preventDefault();
    }
  });
  composer.addEventListener("paste", (event) => {
    const editor = event.target.closest?.(".composer-editor");
    if (!editor || !state.composer) return;
    const beforeImages = editor.querySelectorAll("img").length;
    const data = event.clipboardData;
    if (!data) {
      setTimeout(() => {
        adoptPastedImages(editor);
        if (editor.querySelectorAll("img").length === beforeImages) {
          readClipboardImages();
        }
      }, 0);
      return;
    }
    const files = [];
    for (const item of Array.from(data.items || [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    for (const file of Array.from(data.files || [])) {
      if (file.type.startsWith("image/") && !files.includes(file)) {
        files.push(file);
      }
    }
    if (!files.length) {
      const types = Array.from(data.types || []);
      const mightHaveImage =
        types.some((type) => type === "Files" || type.startsWith("image/"));
      setTimeout(async () => {
        adoptPastedImages(editor);
        if (
          mightHaveImage &&
          editor.querySelectorAll("img").length === beforeImages
        ) {
          await readClipboardImages();
        }
      }, 0);
      return;
    }
    event.preventDefault();
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount &&
      editor.contains(selection.anchorNode)
    ) {
      state.composer.imageRange = selection.getRangeAt(0).cloneRange();
    } else {
      state.composer.imageRange = null;
    }
    for (const file of files) insertComposerInlineImage(file);
    setTimeout(() => adoptPastedImages(editor), 60);
    setTimeout(() => prepareComposerImages(editor).catch(() => {}), 350);
    setTimeout(() => prepareComposerImages(editor).catch(() => {}), 900);
  });

  composer.addEventListener("change", async (event) => {
    if (event.target.matches(".composer-inline-image")) {
      insertComposerInlineImage(event.target.files && event.target.files[0]);
      event.target.value = "";
      return;
    }
    if (event.target.matches(".composer-account")) {
      updateComposerAccount(event.target.value);
      return;
    }
  });
  document.addEventListener("selectionchange", () => {
    if (!state.composer) return;
    const editor = $("#composer .composer-editor");
    const selection = window.getSelection();
    if (
      editor &&
      selection &&
      selection.rangeCount &&
      editor.contains(selection.anchorNode)
    ) {
      state.composer.lastSelection =
        selection.getRangeAt(0).cloneRange();
    }
  });
  composer.addEventListener("input", (event) => {
    captureComposerFields();
    scheduleDraftSave();
    scheduleComposerSize(state.composer);
    if (
      state.composer &&
      state.composer.selectedImage &&
      event.target.closest?.(".composer-editor")
    ) {
      clearComposerImageSelection();
    }
    if (state.composer && state.composer.selectedImage) {
      positionComposerImageTools();
    }
    const input = event.target.closest?.(RECIPIENT_SELECTOR);
    if (input) queueContactSuggestions(input);
  });
  composer.addEventListener("focusin", (event) => {
    const input = event.target.closest?.(RECIPIENT_SELECTOR);
    if (!input) return;
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
  });
  composer.addEventListener("focusout", (event) => {
    const input = event.target.closest?.(RECIPIENT_SELECTOR);
    if (!input) return;
    window.setTimeout(() => {
      if (!state.contactMenu || state.contactMenu.input !== input) return;
      const active = document.activeElement;
      if (!active || !active.closest?.("#contact-menu")) {
        closeContactMenu();
      }
    }, 120);
  });
  document.addEventListener("mousedown", (event) => {
    const option = event.target.closest?.("#contact-menu .contact-item");
    if (option) {
      event.preventDefault();
      const current = state.contactMenu;
      const contact = current && current.items[Number(option.dataset.index)];
      if (contact) selectContact(contact);
      return;
    }
    if (!event.target.closest?.("#contact-menu")) {
      if (!event.target.closest?.(RECIPIENT_SELECTOR)) closeContactMenu();
    }
  });
  window.addEventListener("resize", closeContactMenu);
  document.addEventListener(
    "scroll",
    (event) => {
      if (event.target.closest && event.target.closest("#contact-menu")) return;
      closeContactMenu();
    },
    true
  );
  composer.addEventListener("mousedown", (event) => {
    if (event.target.closest(".format-btn")) event.preventDefault();
  });
  composer.addEventListener("click", (event) => {
    const format = event.target.closest(".format-btn");
    if (format) {
      event.preventDefault();
      applyFormat(format.dataset.format);
      return;
    }
    const head = event.target.closest(".composer-head");
    if (head && state.composer && state.composer.minimized) {
      const action = event.target.closest("[data-action]");
      if (!action || action.dataset.action === "composer-restore") {
        state.composer.minimized = false;
        renderComposer();
      }
    }
  });

  let resizing = null;
  const finishComposerResize = () => {
    if (!resizing) return;
    if (resizing.handle) {
      try {
        resizing.handle.releasePointerCapture(resizing.pointerId);
      } catch (error) {
        /* Ignore. */
      }
    }
    if (resizing.next) state.prefs.trayHeight = Math.round(resizing.next);
    else state.prefs.trayHeight = Math.round(resizing.startHeight);
    savePrefs();
    resizing = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const handle = event.target.closest(".composer-resizer");
    if (!handle) return;
    const pane = $("#reader-pane");
    const composerEl = $("#composer");
    if (!pane || !composerEl) return;
    event.preventDefault();
    resizing = {
      handle,
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: composerEl.getBoundingClientRect().height,
      paneHeight: pane.getBoundingClientRect().height,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (error) {
      /* Ignore. */
    }
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  });
  document.addEventListener("pointermove", (event) => {
    if (!resizing || event.pointerId !== resizing.pointerId) return;
    const delta = resizing.startY - event.clientY;
    const next = Math.max(
      180,
      Math.min(resizing.startHeight + delta, resizing.paneHeight * 0.68)
    );
    $("#reader-pane").style.setProperty("--tray-height", `${Math.round(next)}px`);
    resizing.next = next;
  });
  document.addEventListener("pointerup", finishComposerResize);
  document.addEventListener("pointercancel", finishComposerResize);
  window.addEventListener("blur", finishComposerResize);

  document.addEventListener(
    "wheel",
    (event) => {
      const body = event.target.closest?.(
        ".summary-body, .summary-popover-body"
      );
      if (!body || !body.classList.contains("scrollable")) return;
      const atTop = body.scrollTop <= 0;
      const atBottom =
        body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
      if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  $("#thread-scroll").addEventListener("scroll", () => {
    const pane = $("#thread-scroll");
    if (!pane || state.searchMode || state.query) return;
    if (pane.scrollTop + pane.clientHeight < pane.scrollHeight - 420) return;
    if (state.listLoading || state.loadingMore) return;
    if (state.localHasMore) {
      state.listLimit += 80;
      loadThreads({ quiet: true });
    } else if (state.remoteHasMore) {
      fetchOlderThreads();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden) {
      await refreshState({ quiet: true });
      markOpenThreadRead();
    }
  });
  window.addEventListener("focus", markOpenThreadRead);
}

/* -------------------------------------------------------------------------- */
/* Initialisation                                                             */
/* -------------------------------------------------------------------------- */

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("t") || "";
  if (fromQuery) {
    try {
      sessionStorage.setItem("courier.token", fromQuery);
    } catch (error) {
      /* Ignore. */
    }
    return fromQuery;
  }
  try {
    return sessionStorage.getItem("courier.token") || "";
  } catch (error) {
    return "";
  }
}

async function init() {
  state.token = getToken();
  if (!state.token) {
    document.body.innerHTML =
      '<div style="padding:40px;font:15px Nimbus Sans,sans-serif">Open Courier from its launcher.</div>';
    return;
  }
  hydrateIcons();
  $("#brand-mark").innerHTML = brandMark(22);
  bindEvents();
  try {
    await refreshState({ quiet: true });
  } catch (error) {
    toast(error.message || "Could not connect to the Courier service", true);
    return;
  }
  await loadSignatures({ quiet: true });
  state.initialized = true;
  $$(".segment").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      button.dataset.layout === state.prefs.layout ? "true" : "false"
    )
  );
  renderAll();
  if (!state.accounts.length) {
    if (!state.prefs.googleSetupSeen) openGoogleSetup({ firstRun: true });
    else openSettings("accounts");
  } else {
    await loadThreads();
    schedulePoll(5000);
  }
}

window.courierSetWindowActive = (active) => {
  state.windowActive = Boolean(active);
  if (state.windowActive) markOpenThreadRead();
};

window.courierRefresh = async () => {
  try {
    await refreshState({ quiet: true });
    if (!state.searchMode && !state.query) {
      await loadThreads({ quiet: true });
    }
  } catch (error) {
    /* The window may have just become visible; the poll will retry. */
  }
};

window.courierOpenUpdates = () => {
  openSettings("updates");
};

window.courierOpenThread = async (accountId, threadId) => {  if (!accountId || !threadId) return;
  const account = accountFor(accountId);
  if (!account) return;
  dismissSettingsPage();
  if (state.composer) closeComposer();
  state.accountFilter = account.id;
  state.labelName = null;
  state.folder = "inbox";
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = true;
  focusSidebarAccount(account.id);
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  await loadThreads({ quiet: true });
  await openThread(account.id, threadId);
};

window.courierOpenAccount = (accountId) => {
  const account = accountFor(accountId);
  if (!account) return;
  dismissSettingsPage();
  if (state.composer) closeComposer();
  closeSummary();
  state.accountFilter = account.id;
  const defaultView = account.default_view_id
    ? viewById(account.default_view_id)
    : null;
  state.viewId = defaultView ? defaultView.id : null;
  state.viewTotal = 0;
  state.labelName = null;
  state.folder = "inbox";
  state.query = "";
  state.searchMode = false;
  state.remoteSearch = false;
  state.listLimit = 80;
  state.localHasMore = false;
  state.remoteHasMore = !state.viewId;
  const input = $("#search-input");
  if (input) input.value = "";
  updateSearchClear();
  clearSelection();
  renderSidebar();
  renderList();
  renderReader();
  updateReaderPane();
  loadThreads();
};

window.addEventListener("DOMContentLoaded", init);
