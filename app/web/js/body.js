import { icon } from "./icons.js";

/* -------------------------------------------------------------------------- */
/* Sanitising and body folding                                                */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_TAGS = [
  "script",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "iframe",
  "object",
  "embed",
  "meta",
  "link",
  "base",
  "audio",
  "video",
  "svg",
  "math",
  "canvas",
  "template",
];

const PURIFY_CONFIG = {
  WHOLE_DOCUMENT: false,
  ADD_TAGS: ["style", "center", "font"],
  ADD_ATTR: [
    "target",
    "bgcolor",
    "background",
    "width",
    "height",
    "align",
    "valign",
    "cellpadding",
    "cellspacing",
    "border",
    "color",
    "face",
    "size",
    "role",
    "aria-hidden",
    "aria-label",
  ],
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: ["srcset", "imagesrcset", "ping"],
  ALLOW_DATA_ATTR: false,
};

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "TABLE",
  "TR",
  "TD",
  "SECTION",
  "ARTICLE",
  "ADDRESS",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "CENTER",
]);

const CLOSERS = [
  /^(best|kind|warm|warmest|many|with)\s+(regards|wishes)[,.!]?$/i,
  /^(regards|thanks|thank you|sincerely|cheers|best|take care|all the best|respectfully|yours|yours truly)[,.!]?$/i,
  /^(many thanks|thanks so much|thanks a lot|thanks again|much appreciated|appreciate it)[,.!]?$/i,
  /^sent from my (iphone|ipad|android|phone|mobile)[.!]?$/i,
  /^get outlook for (ios|android)[.!]?$/i,
];

const QUOTE_HINT =
  /(gmail_quote|gmail_extra|moz-cite-prefix|protonmail_quote|yahoo_quoted|zmail_quote|outlookmessageheader|divrplyfwdmsg|appendonsend|mail-editor-reference-message-container)/i;

const SIG_HINT =
  /(gmail_signature|moz-signature|protonmail_signature|yahoo_signature|(^|[\s_-])(signature|sig)([\s_-]|$))/i;

const DESIGN_TAGS =
  /<(img|table|style|link|video|svg|canvas|iframe|object|embed|picture|hr)\b[^>]*>/i;

const IMAGE_ALLOWANCES = new Set();

function escapeHtml(value) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text) {
  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/);
  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function purify(html) {
  if (window.DOMPurify) {
    return window.DOMPurify.sanitize(html, PURIFY_CONFIG);
  }
  return `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(
    html.replace(/<[^>]+>/g, " ")
  )}</pre>`;
}

function makeDocument(html) {
  const doc = document.implementation.createHTMLDocument("email");
  doc.body.innerHTML = html;
  return doc;
}

function visibleText(node) {
  if (!node) return "";
  const skip = new Set(["STYLE", "SCRIPT", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE"]);
  function walk(current) {
    if (!current) return "";
    if (current.nodeType === Node.TEXT_NODE) return current.nodeValue || "";
    if (current.nodeType !== Node.ELEMENT_NODE) return "";
    if (skip.has(current.tagName)) return "";
    if (current.tagName === "BR") return "\n";
    let text = "";
    for (const child of current.childNodes) text += walk(child);
    if (BLOCK_TAGS.has(current.tagName) && text && !text.endsWith("\n")) text += "\n";
    return text;
  }
  return walk(node)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function containsMeaningfulContent(element) {
  return Boolean(visibleText(element)) || Boolean(element.querySelector("img"));
}

function elementList(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

function classAndId(element) {
  return `${element.className || ""} ${element.id || ""}`;
}

function findStrongSignature(body) {
  const candidates = [];
  for (const element of body.querySelectorAll("[class],[id],[data-smartmail]")) {
    if (element === body) continue;
    const marker = classAndId(element);
    const smart = element.getAttribute("data-smartmail") || "";
    if (SIG_HINT.test(marker) || /gmail_signature/i.test(smart)) {
      if (containsMeaningfulContent(element)) candidates.push(element);
    }
  }
  if (!candidates.length) return null;
  // Keep the outermost signature containers, then pick the last one in the body.
  const outermost = candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate))
  );
  return outermost.length ? outermost[outermost.length - 1] : candidates[candidates.length - 1];
}

function closestBlock(node, body) {
  let element = node.nodeType === 1 ? node : node.parentElement;
  if (!element) return null;
  const table = element.closest("table");
  if (table && body.contains(table) && table !== body) return table;
  while (element && element !== body) {
    if (BLOCK_TAGS.has(element.tagName)) return element;
    element = element.parentElement;
  }
  return null;
}

function prefixHasContent(body, boundary, doc) {
  try {
    const range = doc.createRange();
    range.setStart(body, 0);
    range.setEndBefore(boundary);
    const holder = doc.createElement("div");
    holder.appendChild(range.cloneContents());
    return containsMeaningfulContent(holder);
  } catch (error) {
    return false;
  }
}

function extractFrom(doc, body, boundary) {
  const range = doc.createRange();
  range.setStartBefore(boundary);
  range.setEnd(body, body.childNodes.length);
  const fragment = range.extractContents();
  const holder = doc.createElement("div");
  holder.appendChild(fragment);
  return holder.innerHTML;
}

function isBefore(first, second) {
  if (!first || !second) return false;
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function signatureScore(node) {
  const text = visibleText(node);
  let score = 0;
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text)) score += 2;
  if (/(\+\d[\d\s().-]{7,}|\(\d{3}\)\s*\d{3}[-.]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b)/.test(text)) {
    score += 2;
  }
  if (/https?:\/\//i.test(text)) score += 1;
  if (/(linkedin|twitter|x\.com|instagram|facebook|github|youtube|threads\.net)/i.test(text)) {
    score += 1;
  }
  if (/(street|st\.|avenue|ave\.|road|rd\.|suite|floor|building|postal|zip|city|country)/i.test(text)) {
    score += 1;
  }
  if (node.querySelector("img")) score += 1;
  if (/\b(inc|llc|ltd|gmbh|corp|co\.)\b/i.test(text)) score += 1;
  if (text.length < 600) score += 1;
  return score;
}

function findCloserCandidate(body) {
  const blocks = elementList(
    body,
    "p,div,li,section,article,address,td,center,table"
  );
  let best = null;
  for (const block of blocks) {
    const text = visibleText(block);
    if (!text || text.length > 180) continue;
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const firstLine = lines[0].replace(/\s+/g, " ").toLowerCase();
    let matched = false;
    for (const closer of CLOSERS) {
      if (closer.test(firstLine) && lines.length <= 3) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    const boundary = closestBlock(block, body);
    if (!boundary) continue;
    if (!best || isBefore(boundary, best)) best = boundary;
  }
  return best;
}

function findSeparatorCandidate(body) {
  const blocks = elementList(body, "p,div,address,center,table");
  let best = null;
  for (const block of blocks) {
    const text = visibleText(block);
    if (!text || text.length > 160) continue;
    const firstLine = text.split("\n")[0].trim();
    if (/^--\s?$/.test(firstLine) || /^--\s+\S/.test(firstLine)) {
      if (!best || isBefore(block, best)) best = block;
    }
  }
  return best;
}

function findInlineCloserBoundary(body) {
  const doc = body.ownerDocument;
  const total = visibleText(body).length;
  if (!total) return null;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue || "";
    if (!raw.trim()) continue;
    const lines = raw.split(/\r?\n/);
    let offset = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        const lower = trimmed.toLowerCase();
        const matched = CLOSERS.some((closer) => closer.test(lower));
        const lineStart = offset + Math.max(0, line.indexOf(trimmed));
        const previous = node.previousSibling;
        const atLineStart =
          lineStart === 0 &&
          (!previous ||
            previous.nodeName === "BR" ||
            (previous.nodeType === 1 &&
              /^(BR|DIV|P|SECTION|ARTICLE)$/.test(previous.nodeName)));
        if (matched && atLineStart) {
          const prefixRange = doc.createRange();
          prefixRange.setStart(body, 0);
          prefixRange.setEnd(node, lineStart);
          const holder = doc.createElement("div");
          holder.appendChild(prefixRange.cloneContents());
          const prefixLength = visibleText(holder).length;
          if (prefixLength / total >= 0.55) {
            const range = doc.createRange();
            range.setStart(node, lineStart);
            range.setEnd(body, body.childNodes.length);
            const fragment = range.extractContents();
            const wrapper = doc.createElement("div");
            wrapper.appendChild(fragment);
            body.appendChild(wrapper);
            return wrapper;
          }
        }
      }
      offset += line.length + 1;
    }
  }
  return null;
}

function findContactTail(body) {
  const leafBlocks = elementList(body, "p,div,address,table").filter((element) => {
    if (!containsMeaningfulContent(element)) return false;
    return !element.querySelector("p,div,address,table");
  });
  if (leafBlocks.length < 2) return null;
  const tail = leafBlocks.slice(-6);
  for (let index = Math.min(2, tail.length - 1); index < tail.length; index += 1) {
    const start = tail[index];
    const holder = body.ownerDocument.createElement("div");
    let cursor = start;
    while (cursor) {
      holder.appendChild(cursor.cloneNode(true));
      cursor = cursor.nextElementSibling;
    }
    const text = visibleText(holder);
    if (!text || text.length > 1200) continue;
    const score = signatureScore(holder);
    if (score >= 3 && prefixHasContent(body, start, body.ownerDocument)) {
      return closestBlock(start, body) || start;
    }
  }
  return null;
}

function findSignatureBoundary(body) {
  const doc = body.ownerDocument;
  const strong = findStrongSignature(body);
  const closer = findCloserCandidate(body);
  const separator = findSeparatorCandidate(body);

  let chosen = null;
  if (strong) chosen = strong;
  if (closer && (!chosen || isBefore(closer, chosen))) {
    if (!strong || !strong.contains(closer)) chosen = closer;
  }
  if (separator && (!chosen || isBefore(separator, chosen))) {
    if (!strong || !strong.contains(separator)) chosen = separator;
  }

  if (!chosen && !strong && closer) {
    const text = visibleText(body);
    const prefixRange = doc.createRange();
    prefixRange.setStart(body, 0);
    prefixRange.setEndBefore(closer);
    const holder = doc.createElement("div");
    holder.appendChild(prefixRange.cloneContents());
    const prefixLength = visibleText(holder).length;
    const ratio = text.length ? prefixLength / text.length : 0;
    const score = signatureScore(closer);
    if (ratio < 0.55 && score < 2) chosen = null;
  }

  if (!chosen) chosen = findInlineCloserBoundary(body);
  if (!chosen) chosen = findContactTail(body);
  if (!chosen) return null;
  if (!body.contains(chosen)) chosen = closestBlock(chosen, body);
  if (!chosen || chosen === body || !containsMeaningfulContent(chosen)) return null;
  if (!prefixHasContent(body, chosen, doc)) return null;
  return chosen;
}

function findQuoteBoundary(body) {
  const doc = body.ownerDocument;
  const hinted = [];
  for (const element of body.querySelectorAll("[class],[id]")) {
    if (element === body) continue;
    if (QUOTE_HINT.test(classAndId(element))) {
      hinted.push(element);
    }
  }
  const outermost = hinted.filter(
    (candidate) => !hinted.some((other) => other !== candidate && other.contains(candidate))
  );
  let chosen = outermost.length ? outermost[0] : null;

  const blocks = elementList(body, "p,div,section,article");
  for (const block of blocks) {
    if (block === body || !containsMeaningfulContent(block)) continue;
    const text = visibleText(block);
    if (!text || text.length > 700) continue;
    const lower = text.toLowerCase();
    const isWrote = /^on\s.+\bwrote:$/is.test(text) && text.length < 320;
    const isOriginal = /^-{2,}\s*original message\s*-{2,}$/i.test(text);
    const isOutlook =
      /^from:\s.+/is.test(text) &&
      /(^|\n)sent:\s/i.test(text) &&
      /(^|\n)to:\s/i.test(text) &&
      text.length < 700;
    const isRule = /^_{10,}$/.test(text);
    if (!(isWrote || isOriginal || isOutlook || isRule)) continue;
    const boundary = closestBlock(block, body);
    if (!boundary) continue;
    if (!chosen || isBefore(boundary, chosen)) chosen = boundary;
    break;
  }

  if (!chosen || !body.contains(chosen) || chosen === body) return null;
  if (!prefixHasContent(body, chosen, doc)) return null;
  return chosen;
}

/* -------------------------------------------------------------------------- */
/* Image handling                                                             */
/* -------------------------------------------------------------------------- */

const TINY_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function rewriteInlineImages(doc, message, token) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const byCid = new Map();
  attachments.forEach((attachment, index) => {
    if (!attachment.content_id) return;
    const url = `/api/inline?account=${encodeURIComponent(
      message.account_id
    )}&message=${encodeURIComponent(message.id)}&index=${index}&t=${encodeURIComponent(token)}`;
    byCid.set(attachment.content_id.toLowerCase(), url);
    byCid.set(attachment.content_id.toLowerCase().replace(/^cid:/, ""), url);
  });
  for (const image of doc.querySelectorAll("img[src]")) {
    const src = (image.getAttribute("src") || "").trim();
    if (!/^cid:/i.test(src)) continue;
    const key = src.slice(4).toLowerCase();
    const url = byCid.get(key);
    if (url) image.setAttribute("src", url);
    else image.removeAttribute("src");
  }
}

function removeTrackingPixels(doc) {
  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const width = parseInt(image.getAttribute("width") || "0", 10);
    const height = parseInt(image.getAttribute("height") || "0", 10);
    const style = (image.getAttribute("style") || "").toLowerCase().replace(/\s+/g, "");
    const tinyStyle = /(width:1px|height:1px)/.test(style);
    if ((width && width <= 2) || (height && height <= 2) || tinyStyle) {
      const src = image.getAttribute("src") || "";
      if (!src.startsWith("data:")) image.remove();
    }
  }
}

function blockRemoteContent(doc, allowImages) {
  let blocked = 0;
  if (allowImages) return 0;
  for (const image of Array.from(doc.querySelectorAll("img[src]"))) {
    const src = (image.getAttribute("src") || "").trim();
    if (!src || src.startsWith("data:") || src.startsWith("/api/inline")) continue;
    if (/^(https?:)?\/\//i.test(src)) {
      blocked += 1;
      image.setAttribute("src", TINY_GIF);
      image.setAttribute("data-blocked", "1");
      image.setAttribute("alt", image.getAttribute("alt") || "");
    }
  }
  return blocked;
}

function applyLinkPolicy(doc) {
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = (anchor.getAttribute("href") || "").trim();
    if (!href) continue;
    if (/^(javascript|data|vbscript):/i.test(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer noopener");
  }
}

/* -------------------------------------------------------------------------- */
/* Email document and iframe measurements                                     */
/* -------------------------------------------------------------------------- */

export const EMAIL_THEMES = {
  fog: {
    name: "Fog",
    bg: "#ffffff",
    ink: "#24282c",
    muted: "#5d686f",
    line: "#e3eaee",
    border: "#d8e1e6",
    bar: "#f6f9fa",
    quote: "#d5e0e5",
    link: "#2e5f9e",
    scheme: "light",
  },
  linen: {
    name: "Linen",
    bg: "#fcf7eb",
    ink: "#322c24",
    muted: "#756b5d",
    line: "#e6dccb",
    border: "#d8c9b2",
    bar: "#f6edda",
    quote: "#d9cbb5",
    link: "#2e5f9e",
    scheme: "light",
  },
  sepia: {
    name: "Sepia",
    bg: "#f3e3c8",
    ink: "#3b2f22",
    muted: "#7a6548",
    line: "#e0cba6",
    border: "#cbb58e",
    bar: "#ecd7b4",
    quote: "#cdb78f",
    link: "#7a4f1f",
    scheme: "light",
  },
  graphite: {
    name: "Graphite",
    bg: "#222529",
    ink: "#e9e9e7",
    muted: "#a9adb0",
    line: "#3b3f44",
    border: "#3c4146",
    bar: "#2a2e32",
    quote: "#4a5056",
    link: "#9fc3ee",
    scheme: "dark",
  },
  midnight: {
    name: "Midnight",
    bg: "#141b24",
    ink: "#e4eaf2",
    muted: "#a2adba",
    line: "#2c3947",
    border: "#2e3d4c",
    bar: "#1b2632",
    quote: "#3d4e60",
    link: "#9fc3ee",
    scheme: "dark",
  },
};

function baseCss(theme) {
  return `
  html, body { margin:0; padding:0; }
  html { background:${theme.bg}; color-scheme:${theme.scheme}; }
  body {
    background:${theme.bg};
    color:${theme.ink};
    font: 15px/1.55 "Helvetica Neue", "Nimbus Sans", "Liberation Sans", Arial, sans-serif;
    overflow-x:hidden;
    overflow-wrap:break-word;
    -webkit-text-size-adjust:100%;
  }
  img { max-width:100% !important; height:auto !important; }
  table { max-width:100% !important; }
  pre { white-space:pre-wrap; overflow-wrap:break-word; }
  blockquote { margin: 0 0 0 12px; padding-left: 12px; border-left: 2px solid ${theme.quote}; color:${theme.muted}; }
  a { color:${theme.link}; text-decoration:underline; }
  h1,h2,h3,h4 { line-height:1.3; }
  .courier-plain { white-space:pre-wrap; }
`;
}

function emailDocument(fragment, allowImages, theme = EMAIL_THEMES.paper) {
  const remote = allowImages ? "https: http:" : "";
  const csp = [
    "default-src 'none'",
    `img-src data: http://127.0.0.1:* ${remote}`.trim(),
    "style-src 'unsafe-inline'",
    "font-src data:",
    "media-src data: http://127.0.0.1:*",
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>${baseCss(theme)}</style></head>
<body>${fragment}</body></html>`;
}

function fitWideEmail(doc) {
  try {
    const max = doc.documentElement.clientWidth || doc.body.clientWidth || 0;
    if (!max) return;
    for (const element of doc.querySelectorAll("[width]")) {
      if (element.tagName === "IMG") continue;
      const width = parseInt(element.getAttribute("width") || "0", 10);
      if (width > max) {
        element.setAttribute("width", "100%");
        element.style.setProperty("width", "100%", "important");
        element.style.setProperty("min-width", "0", "important");
        element.style.setProperty("max-width", "100%", "important");
      }
    }
    for (const element of doc.querySelectorAll("[style]")) {
      if (element.tagName === "IMG") continue;
      const style = element.getAttribute("style") || "";
      const widths = [
        ...style.matchAll(/(?:^|;)\s*(?:min-)?width\s*:\s*(\d+)px/gi),
      ].map((match) => Number(match[1]));
      if (widths.some((width) => width > max)) {
        element.style.setProperty("width", "100%", "important");
        element.style.setProperty("min-width", "0", "important");
        element.style.setProperty("max-width", "100%", "important");
      }
    }
  } catch (error) {
    /* Ignore layout probing failures. */
  }
}

function measureFrame(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;
    const height = Math.max(
      doc.body.scrollHeight,
      doc.body.offsetHeight,
      doc.documentElement ? doc.documentElement.scrollHeight : 0,
      22
    );
    frame.style.height = `${height + 1}px`;
  } catch (error) {
    /* The frame may have been detached. */
  }
}

let resizeBound = false;
function ensureResizeHandler() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    for (const frame of document.querySelectorAll("iframe.email-frame")) {
      fitWideEmail(frame.contentDocument);
      measureFrame(frame);
    }
  });
}



function collectImageUrls(html) {
  const urls = [];
  const doc = makeDocument(html || "");
  for (const image of doc.querySelectorAll("img[src]")) {
    const src = (image.getAttribute("src") || "").trim();
    if (!src || image.hasAttribute("data-blocked") || image.closest("a[href]")) {
      continue;
    }
    if (!urls.includes(src)) urls.push(src);
  }
  return urls;
}

function updateImageHotspots(wrap, frame, imageUrls, onImageClick) {
  const overlay = wrap.querySelector(".image-hotspots");
  if (!overlay || !onImageClick) return;
  overlay.innerHTML = "";
  const doc = frame.contentDocument;
  if (!doc || !doc.body) return;
  for (const image of doc.querySelectorAll("img[src]")) {
    if (image.hasAttribute("data-blocked") || image.closest("a[href]")) continue;
    const rect = image.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const src = (image.getAttribute("src") || "").trim();
    if (!src) continue;
    const index = imageUrls.indexOf(src);
    const urls = index >= 0 ? imageUrls : [src];
    const hotspot = document.createElement("button");
    hotspot.type = "button";
    hotspot.className = "image-hotspot";
    hotspot.tabIndex = -1;
    hotspot.title = "Open image";
    hotspot.setAttribute("aria-label", "Open image");
    hotspot.style.left = `${Math.round(rect.left)}px`;
    hotspot.style.top = `${Math.round(rect.top)}px`;
    hotspot.style.width = `${Math.round(rect.width)}px`;
    hotspot.style.height = `${Math.round(rect.height)}px`;
    hotspot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onImageClick(urls, Math.max(0, index));
    });
    overlay.appendChild(hotspot);
  }
}

function appendFrame(container, frame, imageUrls, onImageClick) {
  const wrap = document.createElement("div");
  wrap.className = "email-frame-wrap";
  wrap.appendChild(frame);
  const overlay = document.createElement("div");
  overlay.className = "image-hotspots";
  wrap.appendChild(overlay);
  container.appendChild(wrap);
  const update = () =>
    updateImageHotspots(wrap, frame, imageUrls, onImageClick);
  const hookImages = () => {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      for (const image of doc.querySelectorAll("img")) {
        if (image.dataset.hotspotHook) continue;
        image.dataset.hotspotHook = "1";
        image.addEventListener("load", update, { once: true });
        image.addEventListener("error", update, { once: true });
      }
    } catch (error) {
      /* Ignore detached frames. */
    }
  };
  const updateLater = () => {
    update();
    hookImages();
    window.setTimeout(update, 60);
    window.setTimeout(update, 350);
  };
  frame.addEventListener("load", updateLater);
  window.addEventListener("resize", update);
  update();
  return wrap;
}

function createFrame(
  fragment,
  allowImages,
  title,
  imageUrls = [],
  onImageClick = null,
  theme = EMAIL_THEMES.paper,
  onSettled = null,
  onEmailContext = null
) {
  ensureResizeHandler();
  const frame = document.createElement("iframe");
  frame.className = "email-frame";
  frame.title = title || "Email content";
  frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("scrolling", "no");
  frame.addEventListener("load", () => {
    let settleTimer = null;
    let settled = false;
    let ready = false;
    let pendingImages = 0;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (settleTimer) clearTimeout(settleTimer);
      window.setTimeout(() => {
        try {
          fitWideEmail(frame.contentDocument);
          measureFrame(frame);
        } catch (error) {
          /* The frame may be detached. */
        }
        if (onSettled) onSettled();
      }, 90);
    };
    const imageSettled = () => {
      try {
        fitWideEmail(frame.contentDocument);
        measureFrame(frame);
      } catch (error) {
        /* Ignore detached frames. */
      }
      pendingImages -= 1;
      if (pendingImages <= 0 && ready) settle();
    };
    try {
      const doc = frame.contentDocument;
      if (!doc) {
        settle();
        return;
      }
      fitWideEmail(doc);
      measureFrame(frame);
      doc.addEventListener("contextmenu", (event) => {
        const anchor = event.target.closest
          ? event.target.closest("a[href]")
          : null;
        const href = anchor ? (anchor.getAttribute("href") || "").trim() : "";
        if (onEmailContext && /^mailto:/i.test(href)) {
          let addressPart = href.replace(/^mailto:/i, "").split("?")[0];
          try {
            addressPart = decodeURIComponent(addressPart);
          } catch (error) {
            /* Keep the raw address. */
          }
          const addresses = addressPart
            .split(/[,;]+/)
            .map((value) => {
              const match = value.match(/<([^>]+)>/);
              return (match ? match[1] : value).trim();
            })
            .filter((value) => value.includes("@"));
          if (addresses.length) {
            event.preventDefault();
            event.stopPropagation();
            const rect = frame.getBoundingClientRect();
            onEmailContext(
              addresses,
              rect.left + event.clientX,
              rect.top + event.clientY
            );
            return;
          }
        }
        event.preventDefault();
      });
      for (const image of doc.querySelectorAll("img")) {
        image.loading = "eager";
        image.addEventListener(
          "load",
          () => {
            fitWideEmail(doc);
            measureFrame(frame);
          },
          { once: true }
        );
        image.addEventListener("error", () => measureFrame(frame), { once: true });
        if (!image.complete) {
          pendingImages += 1;
          image.addEventListener("load", imageSettled, { once: true });
          image.addEventListener("error", imageSettled, { once: true });
        }
        if (!image.closest("a[href]") && onImageClick) {
          image.style.cursor = "zoom-in";
        }
      }
      const openImage = (event) => {
        if (!onImageClick) return;
        const image = event.target.closest ? event.target.closest("img") : null;
        if (!image) return;
        if (image.closest("a[href]")) return;
        const src = (image.getAttribute("src") || "").trim();
        if (!src || image.hasAttribute("data-blocked")) return;
        const index = imageUrls.indexOf(src);
        event.preventDefault();
        event.stopPropagation();
        onImageClick(index >= 0 ? imageUrls : [src], Math.max(0, index));
      };
      doc.addEventListener("click", openImage);
      for (const image of doc.querySelectorAll("img")) {
        image.addEventListener("click", openImage);
      }
      window.setTimeout(() => {
        ready = true;
        if (pendingImages <= 0) settle();
      }, 380);
      settleTimer = window.setTimeout(settle, 1500);
    } catch (error) {
      /* Ignore cross-document issues. */
      settle();
    }
    window.setTimeout(() => {
      fitWideEmail(frame.contentDocument);
      measureFrame(frame);
    }, 60);
    window.setTimeout(() => {
      fitWideEmail(frame.contentDocument);
      measureFrame(frame);
    }, 350);
  });
  frame.srcdoc = emailDocument(fragment, allowImages, theme);
  return frame;
}

/* -------------------------------------------------------------------------- */
/* Public renderer                                                            */
/* -------------------------------------------------------------------------- */

function isPlainMessage(message) {
  const html = (message.body_html || "").trim();
  if (!html) return true;
  return !DESIGN_TAGS.test(html);
}

function isPlainFragment(html) {
  return !DESIGN_TAGS.test(String(html || ""));
}

function applyPaperTheme(node, themeName) {
  const palette = EMAIL_THEMES[themeName] || EMAIL_THEMES.fog;
  node.dataset.emailTheme = themeName;
  node.style.setProperty("--paper-bg", palette.bg);
  node.style.setProperty("--paper-border", palette.border);
  node.style.setProperty("--paper-bar", palette.bar);
  node.style.setProperty("--paper-muted", palette.muted);
  node.style.setProperty("--paper-line", palette.line);
  node.style.setProperty("--paper-ink", palette.ink);
  node.style.setProperty("--paper-accent", palette.link);
}

function analyzeEmail(sanitized, options = {}) {
  const withImages = options.allowImages === true;
  const hideSignatures = options.hideSignatures !== false;
  const hideQuotes = options.hideQuotes !== false;
  const doc = makeDocument(sanitized);
  const body = doc.body;
  applyLinkPolicy(doc);
  removeTrackingPixels(doc);
  const blocked = blockRemoteContent(doc, withImages);

  try {
    let quoteHtml = "";
    let quoteFound = false;
    const quote = findQuoteBoundary(body);
    if (quote) {
      quoteFound = true;
      quoteHtml = extractFrom(doc, body, quote);
    }

    let signatureHtml = "";
    let signatureCandidate = "";
    let signatureFound = false;
    if (hideSignatures) {
      const before = body.innerHTML;
      const signature = findSignatureBoundary(body);
      if (signature) {
        signatureFound = true;
        signatureCandidate = extractFrom(doc, body, signature);
        if (containsMeaningfulContent(body)) {
          signatureHtml = signatureCandidate;
        } else {
          body.innerHTML = before;
        }
      }
    }

    // Choose the content theme from the main message only. A designed
    // signature or folded quote must not force plain main text onto Fog paper.
    const mainPlain = isPlainFragment(body.innerHTML);
    let main = body.innerHTML;
    let quoteFold = "";
    if (quoteFound) {
      if (hideQuotes) {
        quoteFold = quoteHtml;
      } else {
        main += quoteHtml;
      }
    }
    return {
      main,
      mainPlain,
      signature: signatureHtml,
      signatureFound,
      signatureCandidate,
      signaturePlain: isPlainFragment(signatureHtml),
      quote: quoteFold,
      quoteFound,
      quoteHtml,
      quotePlain: isPlainFragment(quoteHtml),
      blocked,
    };
  } catch (error) {
    return {
      main: sanitized,
      mainPlain: isPlainFragment(sanitized),
      signature: "",
      signatureFound: false,
      signatureCandidate: "",
      signaturePlain: true,
      quote: "",
      quoteFound: false,
      quoteHtml: "",
      quotePlain: true,
      blocked,
    };
  }
}

export function inspectEmailForDebug(message, options = {}) {
  const selectedTheme = EMAIL_THEMES[options.contentTheme]
    ? options.contentTheme
    : "fog";
  const rawPlain = isPlainMessage(message);
  const result = {
    plain_text: rawPlain,
    raw_plain_text: rawPlain,
    selected_theme: selectedTheme,
    resolved_theme: rawPlain ? selectedTheme : "fog",
    has_body_html: Boolean(message.body_html && message.body_html.trim()),
    body_html_length: (message.body_html || "").length,
    body_text_length: (message.body_text || "").length,
    signature_detected: false,
    signature_preview: "",
    signature_theme: null,
    quote_detected: false,
    quote_preview: "",
    quote_theme: null,
    design_tags: (
      (message.body_html || "").match(
        /<(img|table|style|link|video|svg|canvas|iframe|object|embed|picture|hr)\b/gi
      ) || []
    ).map((tag) => tag.toLowerCase()),
  };
  try {
    const rawHtml =
      (message.body_html && message.body_html.trim()) ||
      textToHtml(message.body_text || "");
    const doc = makeDocument(purify(rawHtml));
    const analysis = analyzeEmail(doc.body.innerHTML, {
      allowImages: false,
      hideSignatures: true,
      hideQuotes: true,
    });
    result.plain_text = analysis.mainPlain;
    result.resolved_theme = analysis.mainPlain ? selectedTheme : "fog";
    result.main_design_tags = (
      (analysis.main || "").match(
        /<(img|table|style|link|video|svg|canvas|iframe|object|embed|picture|hr)\b/gi
      ) || []
    ).map((tag) => tag.toLowerCase());
    result.signature_detected = analysis.signatureFound;
    if (analysis.signatureFound) {
      const holder = makeDocument(
        analysis.signatureCandidate || analysis.signature
      );
      result.signature_preview = visibleText(holder.body || holder)
        .trim()
        .slice(0, 1500);
      result.signature_theme = analysis.signaturePlain
        ? result.resolved_theme
        : "fog";
    }
    result.quote_detected = analysis.quoteFound;
    if (analysis.quoteFound) {
      const holder = makeDocument(analysis.quoteHtml);
      result.quote_preview = visibleText(holder.body || holder)
        .trim()
        .slice(0, 1500);
      result.quote_theme = analysis.quotePlain
        ? result.resolved_theme
        : "fog";
    }
  } catch (error) {
    result.error = String(error);
  }
  return result;
}

export function renderEmailBody(container, message, options = {}) {
  const token = options.token || "";
  const hideSignatures = options.hideSignatures !== false;
  const hideQuotes = options.hideQuotes !== false;
  const blockImagesPref = options.blockImages !== false;
  const selectedTheme = EMAIL_THEMES[options.contentTheme]
    ? options.contentTheme
    : "fog";
  const allowImagesForMessage = IMAGE_ALLOWANCES.has(`${message.account_id}:${message.id}`);
  let allowImages = allowImagesForMessage || !blockImagesPref;

  const rawHtml =
    (message.body_html && message.body_html.trim()) ||
    textToHtml(message.body_text || "");

  const preDoc = makeDocument(rawHtml);
  rewriteInlineImages(preDoc, message, token);
  const sanitized = purify(preDoc.body.innerHTML);

  container.innerHTML = "";
  const bodyShell = document.createElement("div");
  bodyShell.className = "message-body";
  container.appendChild(bodyShell);

  let mainSettled = false;
  const settleMain = () => {
    if (mainSettled) return;
    mainSettled = true;
    if (options.onSettled) options.onSettled();
  };

  function build() {
    bodyShell.innerHTML = "";
    const result = analyzeEmail(sanitized, {
      allowImages,
      hideSignatures,
      hideQuotes,
    });
    const mainTheme = result.mainPlain ? selectedTheme : "fog";
    applyPaperTheme(container, mainTheme);
    applyPaperTheme(bodyShell, mainTheme);
    const imageUrls = collectImageUrls(
      [result.main, result.signature].filter(Boolean).join("")
    );

    if (result.blocked > 0) {
      const bar = document.createElement("div");
      bar.className = "image-bar";
      const warning = document.createElement("span");
      warning.className = "image-bar-text";
      warning.innerHTML = `${icon("image", 15)}<span>${
        result.blocked === 1 ? "Image blocked" : `${result.blocked} images blocked`
      }</span>`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-btn";
      button.textContent = "Show images";
      button.addEventListener("click", () => {
        allowImages = true;
        IMAGE_ALLOWANCES.add(`${message.account_id}:${message.id}`);
        build();
      });
      bar.append(warning, button);
      bodyShell.appendChild(bar);
    }

    const content = document.createElement("div");
    content.className = "message-frames";
    bodyShell.appendChild(content);

    const main = createFrame(
      result.main,
      allowImages,
      "Message content",
      imageUrls,
      options.onImageClick || null,
      EMAIL_THEMES[mainTheme],
      settleMain,
      options.onEmailContext || null
    );
    appendFrame(content, main, imageUrls, options.onImageClick || null);

    const folds = [];
    if (result.signature) {
      folds.push({
        kind: "signature",
        label: "Show signature",
        html: result.signature,
      });
    }
    if (result.quote) {
      folds.push({
        kind: "quote",
        label: "Show quoted text",
        html: result.quote,
      });
    }

    for (const fold of folds) {
      const wrap = document.createElement("div");
      wrap.className = `fold fold-${fold.kind}`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "fold-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = `<span class="fold-chevron">${icon(
        "chevronRight",
        14
      )}</span><span>${fold.label}</span>`;
      const foldContent = document.createElement("div");
      foldContent.className = "fold-content";
      foldContent.hidden = true;
      let built = false;
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        if (!open) {
          if (!built) {
            const foldTheme = isPlainFragment(fold.html)
              ? mainTheme
              : "fog";
            appendFrame(
              foldContent,
              createFrame(
                fold.html,
                allowImages,
                fold.kind === "signature" ? "Signature" : "Quoted text",
                imageUrls,
                fold.kind === "quote" ? null : options.onImageClick || null,
                EMAIL_THEMES[foldTheme],
                null,
                options.onEmailContext || null
              ),
              imageUrls,
              fold.kind === "quote" ? null : options.onImageClick || null
            );
            built = true;
          }
          foldContent.hidden = false;
          toggle.setAttribute("aria-expanded", "true");
          toggle.querySelector("span:last-child").textContent =
            fold.kind === "signature" ? "Hide signature" : "Hide quoted text";
          toggle.classList.add("open");
          window.setTimeout(() => {
            const frame = foldContent.querySelector("iframe");
            if (frame) measureFrame(frame);
          }, 30);
        } else {
          foldContent.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
          toggle.querySelector("span:last-child").textContent = fold.label;
          toggle.classList.remove("open");
        }
      });
      wrap.append(toggle, foldContent);
      content.appendChild(wrap);
    }

    if (!result.main || !visibleText(makeDocument(result.main).body)) {
      const empty = document.createElement("p");
      empty.className = "body-empty";
      empty.textContent = "This message has no readable content.";
      content.appendChild(empty);
    }
  }

  build();
}

export function sanitizeEmailHtml(html) {
  return purify(html || "");
}

export function clearImageAllowances() {
  IMAGE_ALLOWANCES.clear();
}
