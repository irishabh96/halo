/*
 * Halo - Ask ChatGPT from a side panel
 * Author: Rishabh Bhatia <irishabh96@gmail.com>
 */
// Background service worker.
// Intentionally minimal: the heavy lifting (talking to the ChatGPT tab and
// waiting for replies) lives in the side panel, which stays alive while open.
// All this needs to do is make clicking the toolbar icon open the side panel.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("Answer Machine: setPanelBehavior failed", err));
});

// Also set it on startup in case the install event was missed.
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("Halo: setPanelBehavior failed", err));
});

// "Ask Halo" from the in-page selection button: stash the text and open the
// side panel. The panel reads the text on load (or via the broadcast below if
// it's already open).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "ask-halo") return;
  const text = typeof msg.text === "string" ? msg.text : "";

  chrome.storage.session.set({ pendingQuestion: text });

  const windowId = sender.tab && sender.tab.windowId;
  const tabId = sender.tab && sender.tab.id;
  (async () => {
    try {
      if (windowId != null) await chrome.sidePanel.open({ windowId });
      else if (tabId != null) await chrome.sidePanel.open({ tabId });
    } catch (e) {
      // Programmatic open can be blocked without a direct gesture — the text is
      // saved, so it appears when the panel is opened from the toolbar.
    }
    // Fill an already-open panel.
    chrome.runtime.sendMessage({ type: "halo-fill", text }).catch(() => {});
  })();

  sendResponse({ ok: true });
  return true;
});
