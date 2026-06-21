# Chrome Web Store - Listing & Review Copy (Halo)

Paste-ready text for the Developer Console. Keep this file in sync with `manifest.json`.

---

## Single purpose

> Halo sends text you type or select to ChatGPT and shows the answer in a Chrome side panel, where
> you can copy or refine it.

## Short description (max 132 chars)

> Ask ChatGPT in a side panel: answer, rephrase, shorten, humanize, and ask about text you select. No API key needed.

## Category / language

- Category: **Productivity**
- Language: **English**

## Detailed description

> Halo puts ChatGPT one keystroke away, in Chrome's side panel.
>
> Ask a question and get the answer right beside whatever you're working on, then refine it with one
> click: Rephrase, Shorten, Professional, Longer, or Humanize. Need something specific? Type a custom
> instruction and hit Ask. Select text on any page and click "Ask Halo" to drop it straight into the
> panel.
>
> No backend. No API key. Halo uses your existing ChatGPT login, so you just sign in to chatgpt.com
> as usual and start asking.
>
> FEATURES
> - Ask ChatGPT from a clean, fast side panel
> - One-click refine: Rephrase / Shorten / Professional / Longer / Humanize
> - Custom follow-ups - tell Halo exactly how to change the answer
> - "Ask Halo" button on any text you select on the web
> - Copy the answer in one tap
> - Minimal, dark, Linear-inspired interface
>
> PRIVACY
> - Runs entirely in your browser; no backend server
> - Your text goes only to ChatGPT (OpenAI) through your own logged-in session
> - No analytics, no tracking, no ads, no data selling
>
> REQUIREMENTS
> - You must be signed in to chatgpt.com in the same Chrome profile (free tier works)
>
> Note: Halo is an independent project and is not affiliated with, or endorsed by, OpenAI.

## Privacy policy URL

> https://github.com/irishabh96/halo/blob/main/PRIVACY.md

(For a cleaner URL you can enable GitHub Pages and use the rendered page instead.)

---

## Permission justifications (paste one per field)

- **sidePanel** - Provides Halo's entire user interface inside Chrome's side panel.
- **tabs** - Locate or open the chatgpt.com tab used to get answers, and return focus to the tab you
  started on after a fallback.
- **scripting** - Inject Halo's content script into the chatgpt.com tab if it isn't already present
  (one-time fallback so the panel can talk to the page).
- **storage** - Temporarily remember your last question/answer for the session and pass text selected
  on a page to the side panel. Uses session storage only.
- **Host permission: `https://chatgpt.com/*`, `https://chat.openai.com/*`** - Send your prompt to
  ChatGPT and read the answer from ChatGPT's own API using your logged-in session.
- **Host permission: `http://*/*`, `https://*/*` (all sites)** - Show the "Ask Halo" button when you
  select text on a page. Halo reads the current selection only when you click "Ask Halo" and does not
  read or transmit any other page content.

## Remote code

> No. Halo does not load or execute remote code. All scripts and the bundled font ship inside the
> package.

## Data usage certifications (check in the console)

- We handle **user-provided content** (your prompts and selected text) and **website content** (text
  you select). This content is transmitted to OpenAI/ChatGPT solely to produce the answer you asked
  for; it is not sent to the developer.
- [x] I do not sell or transfer user data to third parties, apart from the approved use cases.
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Assets checklist

- [x] Store icon 128x128 - `icons/icon128.png`
- [ ] 1-5 screenshots, 1280x800 (or 640x400): empty panel, an answer, the refine row, the "Ask Halo"
      button on a selection
- [ ] (optional) Small promo tile 440x280

## Before you upload

1. Bump `manifest.json` `"version"` for each new submission.
2. `python3 -c "import json; json.load(open('manifest.json'))"` and load unpacked once to smoke-test.
3. Package: `zip -r -X halo.zip . -x ".git/*" ".gitignore" "*.zip" ".DS_Store" "**/.DS_Store" "STORE_LISTING.md"`
4. Upload `halo.zip`, fill the listing + privacy tabs above, and submit for review.

> Heads-up: Halo automates ChatGPT's web app. Review may flag this under policies about interacting
> with third-party services - be prepared to explain the use case, and consider publishing as
> Unlisted/Private if it's mainly for personal use.
