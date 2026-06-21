# Halo - Chrome Extension

By **Rishabh Bhatia** · irishabh96@gmail.com

Ask ChatGPT from a side panel and get the answer back to copy, with one-click
**Rephrase / Shorten / Professional / Longer / Humanize**, a custom follow-up (**Ask**),
and an **Ask Halo** button when you select text on any page.

No backend, no API key. It uses your existing chatgpt.com login (free tier is fine).

## How it works

```
Side panel (UI + orchestration)  --port-->  Content script on the chatgpt.com tab
                                            types your prompt, then reads the reply
                                            from ChatGPT's data API
```

- **`sidepanel.html` / `sidepanel.css` / `sidepanel.js`** - the UI and controller. Finds (or opens,
  in the background) a chatgpt.com tab, sends your prompt to the content script, and shows the result.
- **`content.js`** - runs on chatgpt.com. Inserts the prompt and clicks send, then reads the answer
  from ChatGPT's **data API** (`/backend-api/conversation/{id}`, using your logged-in session token).
  Data fetches aren't throttled in background tabs, so this works with the tab fully in the
  **background** - no tab switching. If the API path fails (logged out / API change), it falls back to
  briefly bringing the tab to the front and reading the rendered page, then returns you to your tab.
- **`selection.js`** - runs on every page; shows the floating **Ask Halo** button on text selection
  and sends the selected text to the panel input.
- **`background.js`** - opens the side panel (from the toolbar icon or the Ask Halo button).

Refine buttons send follow-ups in the **same** ChatGPT conversation, so it keeps prior context.

## Setup (development)

No build step - it's plain HTML/CSS/JS, loaded unpacked.

1. Clone or download this folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Sign into **chatgpt.com** in the same Chrome profile.
5. Click the **Halo** toolbar icon to open the side panel.

After editing files:

- Panel files (`sidepanel.*`): click **reload (↻)** on the Halo card, then close and reopen the side panel.
- Page scripts (`content.js`, `selection.js`): reload the extension **and** reload the affected web tab
  so the new content script injects.

Debug: right-click inside the side panel -> **Inspect** for the panel; use the page's own DevTools for
content scripts.

## Use

1. Type a question -> **Answer** (`Cmd/Ctrl + Enter` also submits).
2. The answer appears in the panel; click the **copy icon** to copy it.
3. Refine with **Rephrase / Shorten / Professional / Longer / Humanize**, or type a custom instruction
   and hit **Ask**.
4. On any web page, **select text** -> click **Ask Halo** to drop it into the panel input.

## Release (Chrome Web Store)

1. Bump `"version"` in `manifest.json` (e.g. `1.0.0` -> `1.0.1`).
2. Validate and smoke-test: `python3 -c "import json; json.load(open('manifest.json'))"` then load
   unpacked once and confirm a question, a refine, and Ask Halo all work.
3. Package the extension (zip the folder **contents**, so `manifest.json` is at the zip root):

   ```bash
   zip -r -X halo.zip . \
     -x ".git/*" ".gitignore" "*.zip" ".DS_Store" "**/.DS_Store"
   ```

4. Go to the **Chrome Web Store Developer Dashboard** -> your item -> **Upload new package** ->
   upload `halo.zip`.
5. Complete the listing (description, screenshots, icon), set visibility, and **Submit for review**.

Notes:
- The package must have `manifest.json` at the root (don't zip the parent folder).
- Halo requests broad host access (`http(s)://*/*`) for the Ask Halo selection button - be ready to
  justify it in the review ("show an action on user-selected text on any page").

## Caveats

- No API key means this drives ChatGPT's web app. If OpenAI changes the page/API, automation may
  break; the page-specific selectors live in one `SELECTORS` object at the top of `content.js`, and
  the API calls are isolated nearby, so fixes are localized.
- You must be signed into ChatGPT in Chrome. Usage/rate limits are whatever your account has.
