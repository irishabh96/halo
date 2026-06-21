/*
 * Halo - Ask ChatGPT from a side panel
 * Author: Rishabh Bhatia <irishabh96@gmail.com>
 */
// Content script — runs inside the chatgpt.com tab.
// It receives a prompt over a port from the side panel, types it into ChatGPT,
// sends it, waits for the streamed reply to finish, and posts the text back.
//
// EVERYTHING that depends on ChatGPT's markup is in SELECTORS below. If OpenAI
// changes the page and automation breaks, fixing the selectors here is the fix.

(() => {
  // Guard against double-injection (static content_script + scripting fallback).
  if (window.__answerMachineLoaded) return;
  window.__answerMachineLoaded = true;

  const SELECTORS = {
    // The prompt box. ChatGPT uses a ProseMirror contenteditable div; older/
    // alternate states use a textarea. Tried in order.
    input: [
      "#prompt-textarea",
      "div.ProseMirror[contenteditable='true']",
      "textarea[name='prompt-textarea']",
      "textarea[data-id]",
      "form textarea",
    ],
    // The "send" button (becomes the stop button while generating).
    sendButton: [
      "[data-testid='send-button']",
      "[data-testid='composer-submit-button']",
      "button[data-testid='send-button']",
      "button[aria-label*='Send']",
      "button[aria-label*='send']",
      "form button[type='submit']",
    ],
    // Signals that a reply is still streaming/generating.
    stopButton: [
      "[data-testid='stop-button']",
      "[data-testid='composer-stop-button']",
      "button[aria-label*='Stop']",
      "button[data-testid='composer-submit-button'][aria-label*='Stop']",
      "[data-stream-active]", // scroll-root gets this while streaming
      "button[aria-label*='Stop streaming']",
    ],
    // Each assistant turn.
    assistantMessage: "[data-message-author-role='assistant']",
    // The rendered markdown content of a reply (assistant only — user
    // messages don't get a .markdown wrapper, so the LAST one is the reply).
    content: [".markdown", "[class*='markdown']", ".prose"],
    // Start-a-new-chat control (SPA — no full reload).
    newChat: [
      "[data-testid='create-new-chat-button']",
      "a[aria-label*='New chat']",
      "button[aria-label*='New chat']",
      "nav a[href='/']",
    ],
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function queryFirst(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  async function waitForElement(selectors, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = queryFirst(selectors);
      if (el && el.offsetParent !== null) return el;
      await delay(200);
    }
    return queryFirst(selectors); // last attempt even if not visible
  }

  function countAssistantMessages() {
    return document.querySelectorAll(SELECTORS.assistantMessage).length;
  }

  // Block-level tags that should produce line breaks in extracted text.
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
    "PRE", "BLOCKQUOTE", "TABLE", "TR", "SECTION", "ARTICLE", "HR",
  ]);

  // Nodes that are not part of the actual reply text and must be skipped:
  // the "ChatGPT said:" screen-reader label, action buttons, icons, etc.
  function shouldSkip(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName;
    if (tag === "BUTTON" || tag === "SVG" || tag === "STYLE" || tag === "SCRIPT")
      return true;
    const cls = (node.getAttribute && node.getAttribute("class")) || "";
    if (/\bsr-only\b/.test(cls)) return true;
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true")
      return true;
    return false;
  }

  // Strip ChatGPT "writing/canvas" directive fences so the answer is clean prose
  // rather than raw markup, e.g.:
  //   :::writing{variant="standard" id="58294"}
  //   <actual text>
  //   :::
  function cleanAnswerText(s) {
    if (!s) return s;
    return s
      .split("\n")
      .filter((line) => !/^\s*:::/.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Extract text from an element WITHOUT relying on innerText. innerText is
  // layout-dependent (returns "" in a never-rendered background tab) AND can
  // include the hidden "ChatGPT said:" label. This structure-aware walk skips
  // non-content nodes and keeps readable line breaks in both tab states.
  function extractText(el) {
    if (!el) return "";
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (shouldSkip(node)) return;
      const tag = node.tagName;
      if (tag === "BR") {
        out += "\n";
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block && out && !out.endsWith("\n")) out += "\n";
      for (const child of node.childNodes) walk(child);
      if (block && out && !out.endsWith("\n")) out += "\n";
    };
    walk(el);
    return cleanAnswerText(
      out.replace(/^\s*(chatgpt|assistant) said:?\s*/i, "")
    );
  }

  // Read the newest assistant reply. Strategy, most→least robust:
  //  1) the last ".markdown"/".prose" block (these wrap assistant content only)
  //  2) the last [data-message-author-role="assistant"]
  //  3) the last conversation-turn container
  function getLastAssistantText() {
    for (const sel of SELECTORS.content) {
      const blocks = document.querySelectorAll(sel);
      if (blocks.length) {
        const t = extractText(blocks[blocks.length - 1]);
        if (t) return t;
      }
    }

    const roleNodes = document.querySelectorAll(SELECTORS.assistantMessage);
    if (roleNodes.length) {
      const t = extractText(roleNodes[roleNodes.length - 1]);
      if (t) return t;
    }

    const turns = document.querySelectorAll('[data-testid^="conversation-turn"]');
    if (turns.length) {
      const t = extractText(turns[turns.length - 1]);
      if (t) return t;
    }

    return "";
  }

  // Counts used purely for diagnostics when scraping comes back empty.
  function scrapeDiagnostics() {
    return {
      markdown: document.querySelectorAll(".markdown").length,
      markdownLike: document.querySelectorAll("[class*='markdown']").length,
      prose: document.querySelectorAll(".prose").length,
      roleAssistant: document.querySelectorAll(SELECTORS.assistantMessage).length,
      anyRole: document.querySelectorAll("[data-message-author-role]").length,
      turns: document.querySelectorAll('[data-testid^="conversation-turn"]').length,
    };
  }

  // When scraping fails, capture the actual markup of the last reply so the
  // selectors can be fixed precisely. Returns a short, truncated snapshot.
  function domDebug() {
    const snip = (el, n) =>
      el ? (el.outerHTML || "").replace(/\s+/g, " ").slice(0, n) : "(none)";
    const lastOf = (sel) => {
      const list = document.querySelectorAll(sel);
      return list.length ? list[list.length - 1] : null;
    };
    return {
      counts: scrapeDiagnostics(),
      lastTurn: snip(lastOf('[data-testid^="conversation-turn"]'), 900),
      lastAssistant: snip(lastOf(SELECTORS.assistantMessage), 600),
      lastMarkdown: snip(lastOf(".markdown"), 400),
    };
  }

  // Put text into the prompt box, handling both contenteditable and textarea.
  function setInputText(el, text) {
    el.focus();
    const tag = el.tagName.toLowerCase();

    if (tag === "textarea" || tag === "input") {
      const proto =
        tag === "textarea"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // contenteditable (ProseMirror): execCommand drives its input pipeline.
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
      document.execCommand("insertText", false, text);
    } catch (e) {
      /* fall through to fallback */
    }

    // If nothing landed, fall back to dispatching an input event with text.
    if (!el.innerText || !el.innerText.trim()) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        })
      );
    }
  }

  // Click send once it's present and enabled; fall back to pressing Enter.
  async function submit(editor) {
    const start = Date.now();
    while (Date.now() - start < 6000) {
      const btn = queryFirst(SELECTORS.sendButton);
      const enabled =
        btn &&
        !btn.disabled &&
        btn.getAttribute("aria-disabled") !== "true" &&
        btn.offsetParent !== null;
      if (enabled) {
        btn.click();
        return;
      }
      await delay(150);
    }
    // Fallback: synthetic Enter.
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
  }

  // Wait for the reply, driven mainly by TEXT STABILITY (robust even if the
  // stop-button selector is wrong). `prevText` is the last assistant text from
  // BEFORE we submitted, so we only accept genuinely new text.
  async function waitForResponse(prevText) {
    const MAX = 180000; // 3 min hard cap
    const NO_TEXT_BAILOUT = 60000; // patient: thinking models can be slow to start
    const start = Date.now();
    const baseTurns = countAssistantMessages();

    let lastText = "";
    let lastChange = Date.now();
    let sawNewText = false;
    let everGenerated = false;

    while (Date.now() - start < MAX) {
      await delay(300);
      const generating = !!queryFirst(SELECTORS.stopButton);
      const turnAppeared = countAssistantMessages() > baseTurns;
      if (generating || turnAppeared) everGenerated = true;

      const cur = getLastAssistantText();
      if (cur && cur !== prevText) sawNewText = true;

      if (cur !== lastText) {
        lastText = cur;
        lastChange = Date.now();
      }
      const stableMs = Date.now() - lastChange;

      // Finished: have new text, not generating, settled ~1.2s.
      if (sawNewText && !generating && stableMs >= 1200) break;
      // Safety: text settled a long time even if a generating flag is stuck on.
      if (sawNewText && stableMs >= 4000) break;
      // Bail: nothing ever generated, no text, and we've waited a while.
      if (
        !sawNewText &&
        !generating &&
        !everGenerated &&
        Date.now() - start > NO_TEXT_BAILOUT
      ) {
        break;
      }
    }

    return sawNewText ? lastText : "";
  }

  async function startNewChat() {
    const btn = queryFirst(SELECTORS.newChat);
    if (btn) {
      btn.click();
      await delay(500);
      // Wait (best effort) for the previous conversation to clear.
      const start = Date.now();
      while (Date.now() - start < 4000) {
        if (countAssistantMessages() === 0) break;
        await delay(200);
      }
      return;
    }
    // Fallback: hard navigation. Only when there's something to clear, since
    // this reloads the page and drops the port (the side panel will retry).
    if (countAssistantMessages() > 0) {
      location.assign("https://chatgpt.com/");
      await delay(3000);
    }
  }

  // --- Data API (preferred path) -------------------------------------------
  // Read the answer from ChatGPT's own conversation API using the logged-in
  // session token. Data fetches aren't throttled in background tabs, so this
  // works with the tab fully in the background — no rendering, no tab switching.

  // Fresh session token via the app's own endpoint; fall back to the token
  // embedded in the page bootstrap (needs no cookies).
  async function getToken() {
    try {
      const r = await fetch(location.origin + "/api/auth/session", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.accessToken) return j.accessToken;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      const el = document.getElementById("client-bootstrap");
      if (el) {
        const j = JSON.parse(el.textContent || "{}");
        const t = j && j.session && j.session.accessToken;
        if (t) return t;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function currentConversationId() {
    const m = location.pathname.match(/\/c\/([0-9a-zA-Z-]+)/);
    return m ? m[1] : null;
  }

  // After a fresh "new chat" submit, wait for a conversation id to appear that
  // differs from the one before we sent.
  async function waitForNewConversationId(prevId, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const id = currentConversationId();
      if (id && id !== prevId) return id;
      await delay(300);
    }
    return currentConversationId();
  }

  async function fetchConversation(id, token) {
    const r = await fetch(location.origin + "/backend-api/conversation/" + id, {
      credentials: "include",
      headers: { accept: "application/json", authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error("conversation fetch failed: " + r.status);
    return r.json();
  }

  // Walk up from the conversation's current node to the newest assistant TEXT
  // message (skips reasoning/'thoughts' nodes).
  function latestAssistantText(conv) {
    const mapping = (conv && conv.mapping) || {};
    let id = conv && conv.current_node;
    let guard = 0;
    while (id && guard++ < 2000) {
      const node = mapping[id];
      if (!node) break;
      const m = node.message;
      if (
        m &&
        m.author &&
        m.author.role === "assistant" &&
        m.content &&
        m.content.content_type === "text" &&
        Array.isArray(m.content.parts)
      ) {
        const text = cleanAnswerText(
          m.content.parts.filter((p) => typeof p === "string").join("\n")
        );
        const finished =
          m.status === "finished_successfully" || m.end_turn === true;
        return { id, text, finished };
      }
      id = node.parent;
    }
    return { id: null, text: "", finished: false };
  }

  // Poll the conversation until the new assistant answer is complete.
  async function pollForAnswer(convId, token, prevNodeId, timeoutMs) {
    const start = Date.now();
    let lastText = "";
    let stableSince = Date.now();
    while (Date.now() - start < timeoutMs) {
      await delay(1500);
      const conv = await fetchConversation(convId, token); // throws → caller falls back
      const { id: nodeId, text, finished } = latestAssistantText(conv);
      const isNew = !prevNodeId || (nodeId && nodeId !== prevNodeId);
      if (text && isNew) {
        if (finished) return text;
        if (text !== lastText) {
          lastText = text;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 3000) {
          return text; // settled even without a finished flag
        }
      }
    }
    return lastText; // best effort; empty → caller falls back to DOM
  }

  // Full background read: returns the answer text, or "" to signal fallback.
  async function dataApiRead(newChat, editor, prompt, onStatus) {
    const token = await getToken();

    // For follow-ups, note the current answer node so we can tell the new one apart.
    let prevNodeId = null;
    const idBefore = currentConversationId();
    if (token && !newChat && idBefore) {
      try {
        prevNodeId = latestAssistantText(await fetchConversation(idBefore, token)).id;
      } catch (e) {
        /* ignore */
      }
    }

    setInputText(editor, prompt);
    await delay(150);
    await submit(editor);
    onStatus("generating");

    if (!token) return ""; // submitted; fall back to foreground DOM read

    try {
      const convId = newChat
        ? await waitForNewConversationId(idBefore, 15000)
        : idBefore || (await waitForNewConversationId(null, 15000));
      if (!convId) return "";
      return await pollForAnswer(convId, token, prevNodeId, 180000);
    } catch (e) {
      return ""; // 401/etc → fall back
    }
  }

  // --- Port handler ---
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "answer-machine") return;
    let prevText = "";
    const onStatus = (stage) => port.postMessage({ type: "status", stage });

    port.onMessage.addListener(async (msg) => {
      try {
        if (!msg) return;

        // Phase 2: side panel brought the tab to the front — read via DOM.
        if (msg.cmd === "foreground-ready") {
          onStatus("generating");
          const text = await waitForResponse(prevText);
          if (!text) {
            const dbg = domDebug();
            console.warn(
              "[Answer Machine] empty scrape; DOM debug:",
              JSON.stringify(dbg)
            );
            port.postMessage({
              type: "error",
              message:
                "ChatGPT replied but I couldn't read the answer. DOM debug: " +
                JSON.stringify(dbg),
            });
            return;
          }
          port.postMessage({ type: "result", text });
          return;
        }

        // Phase 1: submit + read the answer from the data API (background).
        const { prompt, newChat } = msg;

        if (newChat) {
          onStatus("newchat");
          await startNewChat();
        }

        onStatus("typing");
        const editor = await waitForElement(SELECTORS.input, 20000);
        if (!editor) {
          port.postMessage({
            type: "error",
            message:
              "Couldn't find ChatGPT's input box. Open chatgpt.com and make sure you're signed in, then try again.",
          });
          return;
        }

        prevText = getLastAssistantText(); // baseline for the DOM fallback

        const apiText = await dataApiRead(newChat, editor, prompt, onStatus);
        if (apiText) {
          port.postMessage({ type: "result", text: apiText });
          return;
        }

        // Data API didn't yield anything — ask the side panel to bring the tab
        // to the front so we can read the rendered DOM instead.
        port.postMessage({ type: "need-foreground" });
      } catch (e) {
        port.postMessage({
          type: "error",
          message:
            "Something went wrong automating ChatGPT: " +
            (e && e.message ? e.message : String(e)),
        });
      }
    });
  });

  // --- Ping (lets the side panel detect we're loaded) ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "ping") {
      sendResponse({ ok: true });
      return true;
    }
  });
})();
