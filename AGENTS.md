# Courier

A local Gmail client for Linux. Python backend, system WebKitGTK window, no bundled
Chromium, no Electron, no calendar.

## Run

```sh
cd courier
./run.sh
```

Install the Debian package built from a checkout:

```sh
./packaging/build-deb.sh 1.0.0-1 dist
sudo apt install ./dist/courier_1.0.0-1_all.deb
```

Install a menu launcher for the checkout:

```sh
./install.sh
```

Remove the launcher but keep mail data:

```sh
./install.sh --uninstall
```

Developer mode:

```sh
COURIER_DEV=1 ./run.sh
```

Server only:

```sh
python3 -m app.main --serve
```

Runtime data lives in `~/.local/share/courier/` (`courier.db`, `courier.log`). Override
with `COURIER_DATA_DIR`. The database holds accounts, OAuth tokens, cached mail, and
settings. Directory mode is 0700, database 0600.

Do not put development data under `/tmp`; it may be cleared when the session restarts.
Project-local development artifacts live under `.dev/` (ignored by `.gitignore`).

## Requirements and platform

- Debian 12 / LMDE 6 with WebKitGTK 2.50 or newer.
- Python 3.11+ with `gi`, GTK 3.24, WebKit2 4.1.
- No pip packages, no Node build step, no npm runtime dependencies.

Memory footprint is roughly 300 MB PSS total across the Python
process and its WebKitWebProcess. WebKit hardware acceleration is deliberately disabled
by default to reduce memory; `COURIER_GPU=1` leaves it on.

## Architecture

```
LICENSE          MIT license
app/
  main.py        GTK window, WebKit settings, downloads, external links, server lifecycle
  server.py      local HTTP API, static files, page-token auth, OAuth callback, SSE AI proxy
  store.py       SQLite schema, threads/messages/accounts/labels/settings, counts
  gmail.py       OAuth helpers, Gmail REST client, MIME parser/builder
  sync.py        full/incremental sync, history paging, labels, older page tokens
  ai.py          OpenAI-compatible streaming summaries, prompt building, key isolation
  notifications.py desktop notifications, sounds, AI notification summaries
  theme.py       account colour palette
  web/
    index.html
    styles.css
    icon.svg
    js/app.js    UI state, rendering, events, composer, settings, menus, lightbox
    js/body.js   sanitising, signature/quote detection, per-fragment iframes, images
    js/icons.js  inline SVG icon set
    setup/       cropped Google Cloud screenshots for the setup guide
    sounds/soft-knock.wav  bundled default notification sound
    vendor/purify.min.js
tests/
  test_core.py    Gmail parsing, MIME building, store counts, labels, paging, sync
  make_demo.py    sample two-account database for UI work
packaging/
  build-deb.sh    builds an Architecture: all .deb without external tools
  courier         installed /usr/bin wrapper that sets PYTHONPATH
  courier.desktop menu launcher, installed under /usr/share/applications
  courier.1       manual page, installed under /usr/share/man/man1
  copyright       package copyright file
.github/workflows/
  debian.yml      JS checks, tests, .deb artifact, release asset on v* tags
docs/
  courier.png     main README screenshot, taken from the demo database
  themes/         collapsed README theme-combination screenshots
.dev/            ignored local demo DB, Chrome profile, helper scripts, screenshots
```

`app/__init__.py` defines `APP_VERSION`; bump it with each release. The Updates section
compares it with the latest GitHub release tag returned by `releases/latest`.

### Network and auth

- The HTTP server binds only to `127.0.0.1` and uses a random per-run page token.
  API routes require `X-Courier-Token` (or `t=` for image/attachment GETs).
- OAuth uses a Desktop app client created by the user. The auth flow generates
  state + PKCE, opens the default browser, and listens on the app's random loopback
  port. The redirect URI is the loopback root, `http://127.0.0.1:<port>`, which Google
  accepts for Desktop clients. The callback can also be served at `/oauth/callback`.
- Scopes: `https://www.googleapis.com/auth/gmail.modify` and
  `https://www.googleapis.com/auth/gmail.send`, plus `openid`, `email`, and `profile`.
  Keep the Google Cloud app in Testing and add the account addresses as test users.
  Google issues 7-day refresh tokens for external apps in Testing; the setup guide and
  README both mention this.
- Google setup is a six-step modal, not a wall of Settings fields. It opens on first
  launch while `googleSetupSeen` is false and reopens from **Settings → Accounts → Open
  setup guide**. It deep-links to project creation, Gmail API, Google Auth platform
  Branding/Audience/Data Access, and Clients, with an actual Google Cloud screenshot for
  each step. The screenshot assets live in `app/web/setup/`. The support email is replaced
  with `you@example.com`; client IDs and secrets are redacted. Never commit real account
  emails, client IDs, or secrets in these images. Replace the screenshots when Google
  changes the console; do not add CSS mockups back. Step 6
  imports the Desktop client JSON. `POST /api/oauth/import` validates the `installed`
  object (rejecting `web`), the client ID suffix, and the client secret.
  `POST /api/choose-oauth-json` uses a native GTK chooser in the desktop app; the paste
  box is the browser/server-only fallback. Replacing an existing client warns first and
  can require connected accounts to reconnect.
- `account_public` exposes the stored `scope`. After Google sign-in, the setup modal checks
  it against `GOOGLE_OAUTH_SCOPES` and lists missing permissions with a **Reconnect**
  action in the setup footer. Setup is complete only after a client is imported, an account
  is connected, and no scopes are missing. The setup modal blocks the automatic Settings
  open while it is visible; closing it sets `googleSetupSeen` and, on first run, opens
  Settings → Accounts.
- Google moved consent configuration to the **Google Auth platform**: Branding,
  Audience, Data Access, and Clients. Setup copy follows the official
  Google Workspace guides. The old "OAuth consent screen" labels are
  wrong; account setup uses Branding > Get started, Audience > Test users,
  Data Access > Add or remove scopes, and Clients > Create client > Desktop app.
  There is no redirect URI field to fill for a Desktop app.
- Background refresh modes live in the `refresh_mode` setting: fast = 10s (default),
  balanced = 60s, manual = no periodic sync after the startup pass. The GUI triggers an
  immediate sync after startup and whenever the window is shown from the tray; the
  background loop remains the periodic fallback. The frontend polls
  local `/api/state` every ~5s. Sync completion is signalled by `sync.revision`, bumped
  whenever thread metadata is upserted or removed, so the list refreshes without relying
  on catching a short syncing window. Gmail push is not used because it requires a public
  Pub/Sub webhook; polling at this rate is far below documented Gmail quotas.
- Secrets (OAuth client secret, refresh tokens, AI key) stay server-side and are never
  returned to the browser.
- UI preferences are stored in the `ui_prefs` setting, not `localStorage`. The server
  injects theme, accent, and content-width into `<html>` in `_serve_index` so the first
  paint already has the saved appearance. Do not reintroduce `boot.js`.
- User labels are fetched from Gmail every 5 minutes during sync and stored in `labels`;
  only `type: user` labels are kept. The UI merges same-named labels across accounts.
- Older mail is fetched a page at a time through `/api/threads/older`, which holds Gmail
  page tokens per account and folder or label. Local lists page with `limit`/`offset`
  and report `has_more`.
- The Gmail client uses the REST API with `urllib`, not IMAP. Full sync pulls recent
  all-mail, spam, and trash thread IDs, then metadata for each in a 4-worker pool.
  Incremental sync uses Gmail history plus a recent-list safety net. Bodies are loaded
  only when a thread is opened and are cached in SQLite. Remote search queries Gmail
  and caches returned threads. Messages and drafts above 2 MB use the Gmail multipart
  upload endpoint instead of base64 JSON, which Gmail rejects around 5 MB. The MIME payload
  is capped at 34 MiB. Send and draft requests use XHR with a native timeout and upload
  progress; a send never waits for an in-flight draft save, and aborts it first. `_read_json`
  drains rejected oversized bodies and closes the connection before returning 413.

### Security

- DOMPurify sanitises mail HTML. It renders in a sandboxed iframe (`allow-same-origin`,
  popups) with scripts disabled, a restrictive iframe CSP, and a strict app CSP.
- Remote images are rewritten to a transparent pixel and blocked by CSP until the user
  selects Show images for that message. 1×1 tracking pixels are removed.
- Links are forced to target `_blank`; the native shell opens only http, https, and
  mailto URLs in the system browser. File and JavaScript URLs are ignored.
- Attachments use per-index local URLs with the page token. Header values and filenames
  are sanitised before response. Clicking an attachment calls
  `POST /api/open-attachment`; `App.open_attachment` is installed by `run_gui` and
  validates that the URL is the local `/api/attachment` endpoint with the page token.
  The page sends an absolute attachment URL; the opener also resolves a relative
  `/api/attachment...` path against `app.base_url`. View downloads to
  `data_dir/attachments` (0700 directory, 0600 file) on a background thread and opens it
  with `Gio.AppInfo.launch_default_for_uri`. If there is no default app it shows
  `Gtk.AppChooserDialog`; failures use a native error dialog. Download uses
  `app.download_attachment`, which saves the bytes through a `Gtk.FileChooserAction.SAVE`
  dialog starting in Downloads. Do not use the WebKit script-message bridge for this; the
  server routes are the reliable path. Do not send arbitrary URLs or filenames to the
  shell.
- Compose subjects, references, addresses, and attachment names are stripped of CR/LF
  before MIME construction.
- Browser dialogs are not used. Connection removal and link creation use the in-app
  modal (`showModal`) so WebKitGTK behaves consistently. Permanent deletion is not
  exposed: `gmail.modify` allows trash/untrash but not bypassing Trash; requesting the
  full-mail scope only for that was not worth the extra access.

### UI decisions to preserve

- UI font: Liberation Sans first, then Helvetica Neue/Arial. Nimbus Sans caused visibly
  high glyph baselines inside flex-centered buttons and labels in WebKitGTK, so do not
  put it back into `--ui-font`. Email bodies keep their sender fonts.
- The visual language is restrained iPhone 4-era desktop: fine bevels, subdued gloss,
  inset wells, hairline rules, paper-like message sheets. Do not add heavy textures,
  glassmorphism, neon glows, giant icons, or marketing copy.
- No eyebrow labels, no AI badges, no calendar.
- Account badges use the custom `accounts.username` field (falling back to the part
  before `@`) and the custom `accounts.color`. There is no dot inside the badge. The
  full address is in the title.
- Badge placement is controlled by `prefs.badgePosition`: before/after sender or
  before/after subject. Label chip placement is `prefs.labelPosition` with the same four
  choices. In a shared position the account badge comes first, then the label chips.
  Label chips use `label_summary()["ids"][account_id]` to match thread label IDs, show at
  most two, and deliberately remain visible when `accountFilter` hides the account badge.
- The reader toolbar is a direct child of the scrolling reader, so it spans the full
  pane width, including Reading and full-screen modes. Do not put it back inside the
  max-width reader-inner. Reader-inner top padding is intentional breathing room below
  the action bar.
- Message width is controlled by `prefs.contentWidth`: standard 880px, wide 1120px
  (default), full. The server writes it to `<html data-content-width>` before paint.
- Reply composer is never an overlay. Tray mode splits the reader vertically; panel
  mode splits horizontally and hides the list pane so the message remains readable.
  Composer content is preserved when switching modes or minimizing.
- Signatures and quotes are hidden behind explicit `Show signature` / `Show quoted
  text` rows. This is a core feature; never regress it.
- Summaries push content down in their own panel, with no decorative AI chrome. The
  summary body traps wheel scroll at its boundaries so overscroll does not move the
  email thread.
- A one-message thread summarizes that message directly from the toolbar. Longer threads
  open a menu with thread, latest-message, and unread options. Threads with five or more
  messages show a compact **Summarize** offer below the thread. The summary panel also
  lives at the bottom of the thread, after the messages. Starting a summary from the
  toolbar scrolls the reader to that panel.
- Right-click summaries open a popover at the pointer and do not disturb the reader. The
  popover title bar is draggable; the first click outside closes it without activating the
  thing underneath (capture-phase handler), like the context menu.
- Completed reader summaries live in an in-memory cache: ten entries, 30-minute TTL.
  Reopening a thread restores its most recent summary; the X button discards that entry.
  Regenerate bypasses the cache. Do not cache context-popover summaries.
- Account and thread context menus are custom HTML. Thread rows offer summary,
  read/unread, spam, archive, and delete; account rows offer customisation, filtering,
  and reconnect. Marking the open thread unread closes the reader so no thread is selected,
  and updates cached message labels so the unread-summary option stays truthful. Inputs and
  editable fields keep the native edit menu.
- The unread-only list keeps the open thread visible and selected after it is marked read.
  `withPinnedUnreadThread` re-inserts the selected summary after each unread fetch, and
  `renderList` hides read threads again as soon as `selectedKey` clears. Leaving the reader
  removes the row immediately and reloads the unread list; opening another thread drops the
  previous one. Do not reload an unread list without preserving the selected thread.
- AI summaries are gated by `aiEnabled` plus a configured endpoint, and are off by default.
  While either is missing, hide the toolbar **Summary** button, thread-list context summary
  items, reader overflow summary item, the five-message offer, and cached summary
  restoration. Turning it on requires the
  responsibility acknowledgement modal; only then do the endpoint/model/key fields render.
  Turning it off closes open summaries. The AI section warning must remain visible even
  when the fields are hidden. Notification AI controls live at the bottom of the AI section,
  not in Notifications.
- Settings is a page in `.main`, not an overlay. It hides the list and reader, marks the
  Settings sidebar row active, and dismisses when Inbox, All Accounts, a folder, a label,
  search, or Compose is used. The header is full width and has no back button. The Updates
  section compares `APP_VERSION` with GitHub's latest release. Automatic checks are off by
  default; when enabled they run after 15 seconds and then at 1, 5, or 8 hour intervals.
  `POST /api/update/check` returns the latest tag, URL, and whether it is newer. A newer
  version sends one desktop notification per version with the version in the title; clicking
  it opens Settings and scrolls to Updates. Manual status lives in `#update-status`;
  automatic checks only toast once per version when no desktop notification was sent.
- Accounts own their labels in the sidebar. Each account row has a disclosure control;
  labels are nested beneath it, five at a time with Show more. All accounts is expandable
  too and shows merged labels. Selecting an account where the current label does not exist
  clears the label and shows that account's folder. Label summaries include labels with
  zero synced threads so accounts with older or unsynced labels still show them; selecting
  one fetches its threads from Gmail. Keep sidebar and list counts scoped to the account.
- Switching accounts collapses the previously active account and expands the new one,
  including All accounts. Chevron expansion is independent of the current filter.
- Account badges are omitted while `accountFilter` is set; they return in the merged view.
  Label chips do not disappear in that case.
- Schema v7 adds the `views` table and `accounts.default_view_id`.
- Custom views live in the `views` table and are scoped to one account. The filter shape
  is `include_labels`, `exclude_labels`, `include_senders`, `exclude_senders`,
  `include_subject`, and `exclude_subject`. Include labels and senders are ANDed; excludes
  win. Spam and trash stay hidden unless explicitly included. Draft-only threads are
  hidden, but a reply draft that also carries `INBOX`, `SENT`, or `STARRED` must remain
  visible in views; do not hide every thread with a `DRAFT` label. `GET /api/threads`
  with `view=<id>` returns `view_total`; view lists are local and never page through
  Gmail. Views render above labels under the account with an eye icon. Right-click an
  account for **Create custom view**; right-click a view to edit or delete.
- `accounts.default_view_id` selects the view opened when an account is chosen, including
  `window.courierOpenAccount`. Deleting a view clears that reference. The account editor
  exposes it as a select with Inbox as the fallback. Custom views are Courier-local
  filters; they do not alter Gmail filters or labels.
- The sidebar and list panes have persisted widths (`sidebarWidth`, `listWidth`). Resizers
  are keyboard-accessible separators; drag and arrow keys update the CSS variables and
  save through the normal preference debounce. Resizers hide when the pane is hidden or
  the sidebar is collapsed.
- AI summary bodies go through `clean_email_body` in `ai.py`, not the raw body. It drops
  known quote/signature HTML containers (`gmail_quote`, `gmail_signature`, etc.), `>`
  quote lines, `On ... wrote:` / `Original Message` / Outlook header markers, `--`
  separators, common closers, and contact-only signature tails. Quote-only forwards fall
  back to the original so the summary is not empty. Notification AI summaries use the same
  cleaner; do not read `body_text` directly there.
- AI endpoint/test requests are rejected server-side when `aiEnabled` is false.
  `notifications.py` requires `aiEnabled`, `notifyUseAI`, and a configured endpoint before
  using an AI notification summary. The notification monitor falls back to the normal
  sender/subject/preview when any of those is missing or the provider fails.
- The AI system prompt asks for short ordered bullet points rather than paragraphs, and
  tells the model to stop after the factual summary when nothing is required; the thread
  prompt no longer asks for a general action note. The UI also strips trailing "No action
  needed from you" boilerplate after streaming. This is needed because identifying the
  reader as "you" makes small models answer the action question explicitly.
- The app window must never scroll. `bindEvents` resets `window.scrollY` to zero so focusing
  a Settings control cannot move the whole shell and take the sticky header away.
- Email content themes are separate from client themes: `emailTheme` is fog, linen, sepia,
  graphite, or midnight. The five content themes pair with the client themes and live in
  the Appearance section below the client theme tiles, with paper preview tiles. Old saved
  values (paper/white/dark) migrate to fog/fog/midnight. The main message body chooses
  the selected content theme when it has no design tags; designed HTML and picture
  content uses the neutral white Fog palette so its own design is not recoloured. Theme
  classification happens after `body.js` removes folded signatures and quotes, so a
  designed signature must not force a plain main body onto Fog paper. Signature and quote
  frames use the main theme when their own fragment is plain, and Fog when they contain
  design tags. Simple Gmail `<div>`/`<br>` bodies count as plain. Design tags are `img`,
  `table`, `style`, `link`, `video`, `svg`, `canvas`, `iframe`, `object`, `embed`,
  `picture`, and `hr`; debug copies include whole-message and main-fragment tags.
  `body.js` owns the palette, applies CSS variables to the message host and inner paper,
  and passes the resolved palette into each sanitised iframe.
- The message mount is `.message-body-host`; only the inner `.message-body` carries the
  paper border, padding, and shadow. Do not put the class on both, which produced a
  double frame.
- `recipientSummary` appends `/ CC: address, ...` to the header summary. Keep the
  detailed recipient popover as the full To/Cc/Bcc list.
- The list header is 49px high to align its bottom border with the reader toolbar.
- Composer inline images are inserted at the saved selection with a `data-courier-cid`
  marker. On send they are rewritten to `cid:` URLs and sent as inline MIME parts in a
  `multipart/related` body. Inline images are not shown as attachment chips; unused ones
  are dropped at send time.
- Composer drafts are Gmail drafts. The debounced composer posts the same MIME content as
  send to `/api/draft`, which calls `drafts.create` or `drafts.update`; `draft_id` and the
  returned thread ID live on the composer object. The `drafts` SQLite table remains only
  as a legacy source and must not receive new drafts. `_get_thread` returns a `draft`
  object for DRAFT threads; `_thread_draft` pulls the composer payload from the parsed
  draft message, downloads attachments, and converts inline `cid:` images to data URLs.
  `restoreThreadDraft` opens new-message drafts full-height as `Draft · New message` and
  reply drafts minimized above the thread. Sending deletes the Gmail draft. A restored
  draft with an empty `subject` keeps the `Re:`/`Fwd:` subject derived from the thread;
  never let a blank draft subject override it. `primeComposerDraftBaseline()` recomputes
  `initialSignature` and `draftSignature` from the rendered editor after opening or
  restoring a draft, including inline images converted to CIDs. Merely opening a draft must
  not save it back to Gmail or bump its thread date. If a DRAFT thread no longer has a Gmail
  draft and no legacy payload, `_get_thread` removes the ghost thread (or drops the stale
  DRAFT label when real messages remain); a Gmail 404 on archive/trash/spam/inbox deletes
  the local ghost so it can be removed from Drafts. The send endpoint also removes any
  remaining Gmail drafts in the thread after a send, including a first draft save that was
  in flight when Send was clicked.
- DRAFT messages are filtered out of the reader; they belong only to the composer and the
  Drafts folder. `openThread` and `refreshSelectedThreadIfNeeded` both filter message
  labels before assigning `state.selected`, and set the local message count to the visible
  count so draft-only messages cannot cause endless quiet refreshes.
- An untouched Reply must not create a Gmail draft. `composer.initialSignature` records
  the prefilled state and `saveComposerDraft` skips it; typing, attachments, or recipient
  changes then save normally. `openComposer` reuses an existing composer for the same
  thread instead of creating a second draft when Reply is clicked again. The composer
  header trash button runs `deleteComposerDraftAction`, confirms with `showModal`, deletes
  the Gmail/legacy draft, and refreshes the list.
- The sidebar has a **Drafts** folder (`DRAFT` label). Full and incremental sync list
  Gmail drafts explicitly; saving a new draft refreshes its thread metadata once so the
  folder updates without waiting for the next poll.
- The composer resize uses pointer capture and finishes on pointerup/cancel and window
  blur, so a fast drag outside the window cannot leave it stuck resizing.
- Composer Enter handling: Ctrl/Cmd+Enter sends; plain Enter in To/Cc/Bcc appends `, `
  and keeps focus; plain Enter in other composer inputs is prevented. Bare Enter must never
  submit the form. The server strips trailing commas/semicolons from recipient strings
  before `getaddresses`, so a trailing separator is not treated as an empty recipient.
  While the recipient suggestion list is open, Up/Down move the selection, Enter accepts
  it, Escape closes it, and Tab moves to the next field without selecting. Suggestions
  never open on focus alone; they require an input event.
- `GET /api/contacts` merges names from `threads.participants`, thread sender fields, and
  message From headers. Local-part fallbacks such as `ana` for `ana@example.com` are
  ignored; the best candidate prefers multi-word names, then length, then recency. Ranking
  prefers email/name prefixes, then name-word prefixes, then substrings, then usage count
  and recency. All connected account addresses are excluded. The menu is a fixed-position
  listbox; choosing an entry replaces the current comma/semicolon token with
  `Name <email>, ` and keeps focus in the field. Addresses already present in the field are
  filtered out. Cap the menu height to the space above `.composer-foot`; an overlong menu
  can cover the Send button and make it appear unresponsive.
- The composer toolbar has Undo/Redo buttons backed by `document.execCommand`; Ctrl/Cmd+Z
  undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. The editor keeps native typing history, and
  `mousedown` on format buttons is prevented so clicking them does not blur the selection.
- Reply/forward with no loaded messages shows a toast instead of failing silently. If a
  same-thread refresh fails after a send, `openThread` restores the previous messages and
  expansion state so Reply remains usable. Send validation errors and API failures also
  raise a toast, not only the inline composer error.
- Send progress is `#send-status`, a fixed bottom-center popover, deliberately separate
  from the top-right generic toast. It persists with a spinner while `/api/send` is in
  flight and shows the browser upload percentage, then `Uploading to Gmail… Ns` while the
  server uploads. It then says `Message sent` (4.5 seconds) or shows the send error
  (8 seconds). The XHR timeout is five minutes; an in-flight draft save is aborted when
  sending starts so it cannot hold the send spinner open.
- The composer foot shows the approximate encoded message size to the left of Send,
  updated with a 350 ms debounce after typing, pasting, attachments, and image resizing.
  Above 34 MiB it reads `Too large · …`, disables Send, and suppresses draft saves so an
  oversized autosave cannot block sync or thread loads. Ctrl/Cmd+Enter still runs the same
  preflight and shows the error.
- Reply/Reply all targets are formatted with `formatRecipient`, which keeps the sender’s
  display name (`Jane Doe <jane@example.com>`). Do not format targets as bare emails;
  dropping the name makes recipients fall back to their local-part username. Single-word
  local-part fallbacks are omitted rather than written as names. After opening a composer,
  `enrichRecipientNames` checks any remaining bare addresses against the local contact
  history and fills a real name when one is known.
- The main Compose action calls `openComposer("new")` with `thread = null`, so it cannot
  inherit the viewed thread's account/draft context or open as a reply tray. `compose-only`
  is applied to every new composer, even when a thread is still selected behind it, so it
  fills the reader pane; closing it reveals the thread again.
- The GTK `run-file-chooser` handler opens a native chooser in the Downloads directory for
  sound upload. Only apply a MIME filter when the request has real MIME types other than
  `*/*`; an empty filter can hide every file.
- Composer Insert image does not use the WebKitGTK file input. It calls
  `POST /api/choose-inline-image`; `run_gui` installs `app.choose_inline_image`, which opens
  a single-file image chooser in Downloads (falling back to Pictures), returns one base64
  payload under 10 MB, and the composer inserts it as an inline attachment. The hidden file
  input remains only as the browser fallback when the native chooser is unavailable.
- Composer inline images can be resized from four corner handles or with the **Small** and
  **Original Size** actions below the image. The width and proportional height are written
  to the image's `width`/`height` attributes and to `width: Npx; height:auto;
  max-width:100%`, so the size survives Gmail drafts and sending. The selection border,
  handles, and actions live in `.editor-wrap`, outside `.composer-editor`, and are never
  serialised into the message. Handles use `--accent-ink` borders and a paper fill so they
  stay visible on dark themes. Dragging beyond the image's natural width clamps at the
  original size and shows a small `Already at original size` hint to the right of the
  corner handle. The hint is positioned once and does not follow the pointer. Right-clicking
  an inline image opens the custom menu with **Small**, **Original Size**, **Convert to
  attachment**, and **Delete image**. Converting removes the inline image and adds the same
  data as a normal composer attachment; deleting removes both the image and its inline
  attachment entry.
- Composer Attach does not use an HTML file input. It calls
  `POST /api/choose-attachments`; `run_gui` installs `app.choose_attachments`, which
  schedules `Gtk.FileChooserDialog` on the main loop, waits for the selection thread, and
  returns paths. The endpoint reads the files and returns base64 payloads; the composer
  adds them with the 20 MB total limit. This avoids WebKitGTK's unreliable generic file
  input path.
- Non-inline composer attachments render in `.composer-attachment-shelf` between the
  format bar and the Send footer, hidden while empty, with icon-only View and Delete
  actions. The shelf header is a toggle button; `composer.attachmentShelfCollapsed`
  controls the collapsed class and `aria-expanded`. Adding attachments re-expands it. The
  items use `repeat(auto-fill, minmax(min(240px, 100%), 1fr))` so wide composers get
  multiple columns, and the item list has a 126px internal scroll instead of growing the
  composer indefinitely. View posts the base64 payload to
  `/api/open-composer-attachment`; the server writes a private copy under
  `data_dir/attachments` and calls `app.open_attachment_file`, which launches it like a
  received attachment. Delete removes the original index from `composer.attachments` (do
  not use the filtered shelf index) and schedules a Gmail draft save.
- Sending with an empty subject or an empty body opens the in-app confirmation modal.
  If the body mentions an attachment and no non-inline files are attached, a second
  confirmation asks before sending.
- `accounts.name` is the outgoing From display name, editable as **Outgoing name** in the
  account editor. At OAuth connection, request `openid email profile` and take the name
  from the ID token (falling back to the OpenID userinfo endpoint); never use the custom
  badge username for sending. Existing accounts must reconnect to grant the profile
  scopes and refresh the name; Settings and the account context menu show Reconnect for
  every account, not only expired ones, so this does not require removing the account.
  Changing the name affects only new messages: sent messages keep their original From
  header, and Gmail's
  sendAs display name can override the raw From name. Courier has no settings scope to
  read or change sendAs, so the account editor note tells users to update Gmail's
  **Send mail as** name if the old name persists. `_outgoing_name` in `server.py` treats a
  stored name equal to the email local part as unset and falls back to the custom badge
  username before the local part.
- Right-clicking a `mailto:` link in a message frame opens Courier's menu with
  **Copy email address** instead of WebKit's page menu. `body.js` extracts the addresses
  from the href (minus the `?subject=` query) and passes the iframe-relative click point
  to the parent `openEmailAddressMenu`. Other context clicks inside frames are suppressed.
- `collectImageUrls` excludes images inside `a[href]`, and the image click handler skips
  them so the link keeps its normal behavior. Unlinked images get both a direct image
  listener and an absolute parent-DOM hotspot overlay over the iframe; the overlay makes
  clicks reliable in WebKitGTK where cross-document click listeners can be dropped. If the
  URL list is stale, the clicked image opens as a one-image lightbox.
- WebKit's `javascript_can_access_clipboard` setting is enabled for the local trusted
  page. Composer paste first reads clipboard files, then adopts data/blob images inserted
  by the default paste, and finally tries the Async Clipboard API. `prepareComposerImages`
  runs before send and converts any remaining data/blob URLs to inline attachments; blob
  images that cannot be read are removed rather than emailed as broken URLs.
- `collectImageUrls` uses only the current message's main content and signature, not its
  quoted previous emails, so the lightbox carousel stays scoped to one email. Quote-frame
  images do not get lightbox handlers. The lightbox image is `flex: none`, which allows
  zoom beyond the stage width and scroll/pan through the overflow.
- The reader overflow menu has **Copy debug content**. It copies JSON containing the raw
  HTML/text of every message, selected/resolved main theme, plain-text classification for
  the whole message and the main fragment, per-fragment signature/quote themes, and
  signature/quote detection previews. Keep this diagnostic action when changing body
  rendering; it is how users report missed signatures and theme problems.
- Opening a thread keeps its toolbar, subject, account badge, and message count visible
  while a spinner occupies only the thread body area. The body stays `visibility: hidden`
  until every rendered message frame has loaded, measured, and settled its images; then
  the spinner is removed. Multi-message threads scroll once to the latest message;
  single-message threads stay at the top of that message. Expansion state is reset on
  every open and background refresh: all messages for three or fewer, otherwise only the
  newest. Carrying old expansion state across a refresh let previously expanded images
  shift the final scroll position. The spinner has a three second fallback so a failed
  frame cannot leave the reader hidden.
- The loading-to-content handoff must replace only `.thread-content` with
  `preserveChrome: true`; rebuilding the toolbar or `.thread-head` there causes visible
  flicker. `updateThreadHead` and `updateThreadToolbarState` adjust the existing nodes in
  place. The reader also uses `scrollbar-gutter: stable`, because the scrollbar appearing
  when the hidden body is mounted otherwise changes the toolbar and subject width. Do not
  put the spinner back as a full-reader overlay.
- Polling compares the selected thread's message count and last date against the list
  summary; a newer thread is re-fetched quietly, its stale summary cache is invalidated,
  and the reader moves to the latest message only when it was already near the bottom.
  Clicking the already selected row also forces that check. A quiet refresh uses
  `read=0` while the window is hidden or unfocused, so a new message in the open thread
  stays unread long enough for the notification monitor; focusing the window marks the
  open thread read. The GTK window sends focus, show/hide, and iconified state to
  `window.courierSetWindowActive`, because WebKit's own `document.hidden`/focus state can
  lag behind a tray hide.
- Labels are alphabetically sorted in every account list; counts never reorder them.
- Archive means no `INBOX`, `SPAM`, `TRASH`, or `DRAFT` label. Sent-only threads stay out
  of Archive, but a thread with a sent reply (`SENT` and more than one message) appears once
  Inbox is removed. This keeps manually archived replies visible without duplicating the
  Sent folder.
- `fitWideEmail()` runs after each email frame load and after images load. It clamps tables
  and fixed inline widths, including `min-width`, to the frame width. This handles desktop
  marketing tables that sit between their mobile breakpoint and design width. It never
  rewrites image widths; images keep `max-width:100% !important; height:auto !important`,
  so inline width/height pairs scale proportionally as the pane narrows and return to their
  designed size when it widens.
- Summary overflow only traps wheel scrolling when the summary body actually overflows;
  short summaries let the thread scroll normally.
- Inline images from a message open in a full-screen viewer. Multiple images from that
  message form a thumbnail carousel; zoom is 100–400% with buttons, +/-/0, arrow keys,
  and Escape to close. The viewer uses the sanitised, already-allowed image URLs. Scrolling
  over the image zooms toward the pointer: the image is translated and scrolled so the
  point under the cursor stays put until it reaches the canvas edge.
- Thread cards and account rows are the only things that intercept right-click. A generic
  right-click elsewhere suppresses WebKit's page menu.
- Expanded message headers collapse/expand on click except when clicking buttons,
  details, links, or selecting text.
- Per-message Reply all/Reply/Forward are small bordered buttons with icons, not bare text
  links, and sit at the left edge of the message content. There is no per-message
  Summarize button; the toolbar Summary and the bottom offer are the entry points.
- Full-screen email hides sidebar, topbar, and list; Escape exits. Reading mode hides
  the list behind a back control in the reader toolbar.
- Dark client themes do not recolour HTML or picture email content; that stays on white
  paper. A plain main message follows the selected email content theme, which may be dark,
  even when a folded signature or quoted reply contains designed HTML.
- The GTK window is placed against the right edge of the X screen after mapping so the
  user can keep other work on the left. This is a one-time placement, not a window
  manager replacement; the user can still move it.
- Reading mode without a selected thread makes the list pane fill the workspace; the
  reader pane is hidden. Selecting a thread switches back to the full-width reader.
- Courier uses a deprecated-but-available `Gtk.StatusIcon` for the tray. Left click calls
  `show_window`, which deiconifies, refreshes state, triggers sync, and resets the unread
  baseline. Right click builds a fresh menu with a disabled “N new emails since last
  opened” item, account items, and Quit. Account items call the page global
  `window.courierOpenAccount(id)`.
- `closeBehavior` (tray/quit), `minimizeBehavior` (default/tray), and `loginStartup`
  (off/minimized/foreground) live in `ui_prefs`. The GUI reads them fresh on each close or
  minimize event. Close/minimize to tray are disabled if the status icon could not be
  created, so the window cannot disappear without a tray entry.
- The GUI writes/removes `~/.config/autostart/courier.desktop` when `loginStartup` changes,
  polling prefs every 2 seconds and again on quit. Demo mode and custom `COURIER_DATA_DIR`
  skip autostart changes. `--minimized` starts with only the tray visible; foreground
  startup uses no flag. `install.sh --uninstall` removes the autostart entry too.
- A Unix-domain single-instance socket lives under `$XDG_RUNTIME_DIR` (or `~/.cache`) with
  a hash of the data directory in its name. A second launch sends `show` to the running
  instance and exits before creating a database, server, window, or tray icon. The socket
  is removed on quit; stale sockets are cleaned on the next launch.
- `app/notifications.py` owns desktop notifications. It polls the thread list every two
  seconds, baselines at startup, skips sent/spam/trash threads, and uses libnotify. The
  default sound is the bundled `app/sounds/soft-knock.wav`; system sounds live under
  `/usr/share/sounds/freedesktop/stereo`, and playback uses `ffplay` first, then
  `paplay`, `pw-play`, and `aplay`. Custom sounds are uploaded to `data_dir/sounds` by
  `POST /api/notification-sound` and never leave the local machine.
- Notification preferences are `notifyEnabled`, `notifyArchived`, `notifySound`,
  `notifySoundPath`, `notifyShowAccount`, `notifyBadgePosition`, `notifyUseAI`, and
  `notifyAIMinChars`. `notifyArchived` defaults to false; archived threads without
  `INBOX` stay quiet until it is enabled. `notifyUseAI` is ineffective unless the separate
  `aiEnabled` preference is on.
  `POST /api/notify/test` increments a setting counter; the GUI monitor notices it and
  sends a synthetic long notification using the current formatting and sound.
- Related notification rows use `.settings-cluster` so dependent controls share one
  container without internal borders. The AI length row is hidden unless `notifyUseAI`
  is on; the account-placement row is hidden unless `notifyShowAccount` is on. The whole
  notification AI cluster is hidden unless the main `aiEnabled` toggle is on.
- The notification uses the `suppress-sound` hint so the desktop daemon does not play its
  own sound over Courier's chosen sound. `notifyVolume` (0–100) is applied by `ffplay`
  first because PulseAudio/PipeWire stream restore can reset `paplay`/`pw-play` stream
  volume to 100%; those remain fallbacks. `aplay` has no volume fallback. The `system`
  sound option omits
  the suppress hint and plays nothing from Courier, intentionally leaving the daemon's
  configured sound in charge. Sound options remain `notifySound` and `notifySoundPath`.
- The notification monitor tracks the last seen date per thread; do not reintroduce a
  single global high-water mark. Draft saves and other filtered threads must not hide a
  notification for unrelated mail that syncs slightly later.
- The notification monitor skips archived threads (unless `notifyArchived`), draft-only
  threads, spam, trash, sent-only, and already-read threads. A reply-draft thread that
  still has `INBOX` can notify when a new incoming message arrives.
  Self-sent filtering uses `threads.last_from_email`, the actual From of the newest
  message, rather than `sender_email`: for a SENT thread the display sender is deliberately
  the recipient, which otherwise makes your own reply look like incoming mail. Schema v6
  adds `last_from_email` and migrates older databases in place.
- Real notifications attach a libnotify `default` action carrying `(account_id, thread_id)`
  and call `main.open_notification_thread`, which shows the window and runs
  `window.courierOpenThread(accountId, threadId)`. The notification object stays in
  `NotificationMonitor.active` until its `closed` signal; dropping it earlier loses the
  action callback. Test notifications have no thread id, so they get no action.
- AI notification summaries use `NOTIFICATION_PROMPT` in `ai.py` and
  `AIClient.notification_summary(timeout=8)`. The prompt asks for a one-line,
  sender-first action statement such as “John needs his password reset.” The monitor
  falls back to the normal preview on short messages, missing configuration, provider
  errors, or timeout. `_strip_thinking` removes paired and unclosed think/reasoning tags
  and their content before the notification line is taken; a lone trailing closing tag is
  removed while keeping the answer before it.

### Signature and quote detection

Located in `app/web/js/body.js`.

- Quote signals: Gmail/Yahoo/Proton/Zimbra/Outlook classes and ids (`gmail_quote`,
  `gmail_extra`, `moz-cite-prefix`, `divRplyFwdMsg`, `appendonsend`,
  `mail-editor-reference-message-container`), plus text markers (`On … wrote:`,
  `-----Original Message-----`, Outlook From/Sent/To blocks, long underscores).
- Signature signals: Gmail and other signature containers, RFC `--` separator,
  common closers on the first line of a block (Regards, Thanks, Sincerely, Best,
  cheers, sent-from-phone), then contact density, logos, addresses, social links.
- Folding splits the sanitised DOM into main, signature, and quote fragments with
  Range extraction. Each fragment gets its own measured iframe. A fold is skipped if
  it would leave no readable main content.
- `visibleText()` treats `<br>` and block ends as newlines, important for closers that
  arrive as `<p>Thanks,<br>Joel</p>`.
- When users supply real examples, add fixtures and tune closer/tail heuristics
  here. Keep the guard that requires content before a fold.
- `findInlineCloserBoundary` handles closers such as "Many thanks" inside one large
  Gmail `<div>`, where the closer is a text line after a `<br>` rather than its own block.
  It only folds when at least 55% of the visible text is before the closer.

### Tests

```sh
python3 -m unittest discover -s tests -v
```

CI runs the same tests and JavaScript syntax checks before building the package. The
Debian workflow uses the standard Ubuntu 24.04 GitHub-hosted runner, which is free for
public repositories. Pushing a `v*` tag attaches the built `.deb` to a GitHub Release.

The 42 tests cover thread metadata extraction, plain-text fallback, inline/attachment
parsing, MIME construction, folder counting/archive/drafts semantics, thread label updates,
account metadata, refresh intervals, user-label merging and label paging, folder paging,
older-page fetching with Gmail page tokens, notification default actions, archived-mail
filtering, self-sent filtering, outgoing-name and ID-token fallbacks, AI signature/quote
cleaning, AI and Google-setup preference defaults, AI notification gating, contact name
resolution, custom view filtering/default clearing, and a full sync plus lazy thread load
using a fake Gmail client. UI smoke tests
cover custom account names/colours, the four badge and label positions, wide/full reader
widths, header clicks, entity decoding, summary scope and scroll containment, labels/Show
more, custom view creation/filtering/default view, draft filtering/no empty reply drafts,
the draft trash confirmation, reply recipient name preservation/contact enrichment, the
composer attachment shelf and its View/Delete actions, the attachment-mention prompt,
Settings navigation, the six-step Google setup modal, client JSON import and replacement
confirmation, missing-scope warnings, AI acknowledgement and summary-action gating, context
menus, the summary popover, the mailto copy menu, and the image viewer.

Demo workflow:

```sh
COURIER_DATA_DIR="$PWD/.dev/demo-data" python3 tests/make_demo.py
COURIER_DATA_DIR="$PWD/.dev/demo-data" COURIER_DEMO=1 python3 -m app.main --serve
```

UI smoke tests used headless Chrome against the demo server plus the native GTK window.
Verified in Chrome: account-nested labels and Show more, zero-thread label visibility,
account-label boot-out, read/unread/spam context menu entries, unread-list pinning while
reading, local scroll paging, Settings navigation and full-width header, accent selection
ring, Settings focus scroll containment, thread/account context menus, single-message and
thread/unread summaries with
"You" in the prompt, summary cache restore/discard and trailing-boilerplate cleanup,
short-summary scroll pass-through, draggable summary popovers with click-away, account
collapse on switch, hidden single-account badges, resizable panes, email content themes,
wide-table fitting, theme persistence across reload, and the lightbox carousel/zoom. Verified natively: both
accounts merged, sidebar, thread opening, 6-message summary offer, context menu replacing
WebKit's page menu, single-message summary streaming, inline images, signature folding,
and no console errors except Chrome's password-field advisory. Native image clicks used
synthetic X events and were not a reliable input test; the image path is covered in
Chrome.

## Conventions

- Keep copy concrete. No greetings, exclamation marks, emoji, sparkle icons,
  "seamless", "supercharge", eyebrow labels, or explanatory filler.
- Interactive icon-only buttons need `aria-label` and `title`.
- Use sentence case. Uppercase only for short keyboard hints, if needed.
- New persisted interface preferences go in `state.prefs`, POST to `/api/prefs`, and are
  added to `UI_PREF_DEFAULTS`/`_clean_ui_prefs` in `server.py`. Do not use localStorage
  for preferences; it is scoped to the random port and resets each launch. Server secrets
  never go to the browser. Composer drafts are Gmail drafts; old localStorage drafts are
  read once for migration and cleared after the Gmail save, never written again.
- Run `node --input-type=module --check < app/web/js/app.js` and the Python tests
  after edits.
- Keep this file current.
