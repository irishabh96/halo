/*
 * Halo - Ask ChatGPT from a side panel
 * Author: Rishabh Bhatia <irishabh96@gmail.com>
 */
// Runs on every web page. When the user selects text, it shows a small
// floating "Ask Halo" button above the selection; clicking it sends the
// selected text to the Halo side panel's input.

(() => {
  if (window.__haloSelectionLoaded) return;
  window.__haloSelectionLoaded = true;

  // Isolated UI in a shadow root so page CSS can't affect it.
  const host = document.createElement("div");
  host.style.cssText =
    "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; display: none;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    button {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 30px;
      padding: 0 12px;
      font: 500 13px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #F7F8F8;
      background: #1A1B1E;
      border: 1px solid #323334;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: background 150ms cubic-bezier(.16,1,.3,1),
        border-color 150ms cubic-bezier(.16,1,.3,1);
    }
    button:hover { background: #232427; border-color: #3F4147; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #5E6AD2; flex: none; }
  `;

  const btn = document.createElement("button");
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = "Ask Halo";
  btn.append(dot, label);
  shadow.append(style, btn);
  (document.documentElement || document.body).appendChild(host);

  let selectedText = "";

  const hide = () => {
    host.style.display = "none";
  };

  function showForSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text) {
      hide();
      return;
    }
    let rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (e) {
      hide();
      return;
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hide();
      return;
    }
    selectedText = text;

    // Reveal off-screen first to measure, then position.
    host.style.display = "block";
    host.style.left = "-9999px";
    host.style.top = "-9999px";
    const b = btn.getBoundingClientRect();
    let x = rect.left + rect.width / 2 - b.width / 2;
    let y = rect.top - b.height - 8;
    if (y < 4) y = rect.bottom + 8; // no room above → show below
    x = Math.max(4, Math.min(x, window.innerWidth - b.width - 4));
    host.style.left = `${Math.round(x)}px`;
    host.style.top = `${Math.round(y)}px`;
  }

  document.addEventListener("mouseup", () => setTimeout(showForSelection, 0));

  document.addEventListener("mousedown", (e) => {
    if (e.composedPath && e.composedPath().includes(host)) return;
    hide();
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  // Keep the selection alive through the click.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("mouseup", (e) => e.stopPropagation());

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = selectedText;
    hide();
    try {
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      /* ignore */
    }
    if (!text) return;
    try {
      chrome.runtime.sendMessage({ type: "ask-halo", text });
    } catch (err) {
      /* extension context may be reloading */
    }
  });
})();
