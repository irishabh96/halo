/*
 * Halo - Ask ChatGPT from a side panel
 * Author: Rishabh Bhatia <irishabh96@gmail.com>
 */
// Side panel controller.
// Owns the UI and orchestrates the whole flow: find/create the chatgpt.com tab,
// make sure the content script is there, then talk to it over a port and wait
// for the answer. Lives here (not the service worker) because the panel stays
// alive while open, so it survives the long wait for ChatGPT to finish.

const PROMPTS = {
  rephrase: "Rephrase your previous response, keeping the same meaning.",
  shorten:
    "Make your previous response shorter and more concise, keeping the key points.",
  professional: "Rewrite your previous response in a clear, professional tone.",
  longer: "Expand your previous response into a longer, more detailed version.",
  humanize:
    "Rewrite your previous response so it sounds natural and human: a warm, conversational tone, natural phrasing, and correct grammar. Avoid robotic or AI-sounding wording, filler, and clichés, while keeping the same meaning.",
};

const LABELS = {
  rephrase: "rephrased",
  shorten: "shortened",
  professional: "made professional",
  longer: "expanded",
  humanize: "humanized",
  custom: "customized",
};

const STAGE_LABELS = {
  newchat: "Starting a new chat…",
  typing: "Sending your prompt…",
  generating: "ChatGPT is generating…",
};

const CHAT_URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];

// --- Elements ---
const questionEl = document.getElementById("question");
const answerBtn = document.getElementById("answer-btn");
const copyBtn = document.getElementById("copy-btn");
const responseEl = document.getElementById("response");
const statusEl = document.getElementById("status");
const customEl = document.getElementById("custom");
const responseSection = document.getElementById("response-section");
const transformSection = document.getElementById("transform-section");
const transformBtns = Array.from(document.querySelectorAll(".transform"));

// --- State ---
const state = { hasAnswer: false, answer: "", question: "" };
let busy = false;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// --- UI helpers ---
function setStatus(text, kind = "idle") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function setBusy(value) {
  busy = value;
  answerBtn.disabled = value;
  copyBtn.disabled = value || !state.hasAnswer;
  customEl.disabled = value || !state.hasAnswer;
  transformBtns.forEach((b) => {
    b.disabled = value || !state.hasAnswer;
  });
}

function showAnswer(text) {
  state.answer = text;
  state.hasAnswer = true;
  responseEl.textContent = text;
  // Reveal the answer + refine panels (hidden until there's an answer).
  responseSection.hidden = false;
  transformSection.hidden = false;
}

// --- Tab + content script plumbing ---
async function getOrCreateChatTab() {
  const tabs = await chrome.tabs.query({ url: CHAT_URLS });
  if (tabs.length) return tabs[0];
  const tab = await chrome.tabs.create({
    url: "https://chatgpt.com/",
    active: false,
  });
  await waitForTabComplete(tab.id);
  return tab;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === "complete") {
        resolve();
        return;
      }
      const listener = (updatedId, info) => {
        if (updatedId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    if (res && res.ok) return;
  } catch (e) {
    // No receiver yet — fall through and inject.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await delay(200);
}

// Connect to the content script and run one prompt. Resolves with the answer
// text, or rejects with a readable error. onNeedForeground is awaited if the
// content script asks us to make the tab visible (data-API read fell back).
function sendToTab(tabId, payload, onStatus, onNeedForeground) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.tabs.connect(tabId, { name: "answer-machine" });
    } catch (e) {
      reject(new Error("Could not connect to the ChatGPT tab."));
      return;
    }
    let settled = false;

    // Hard safety net: never let the panel hang forever (which would leave it
    // stuck "busy" and ignoring further clicks).
    const HARD_TIMEOUT = 200000;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch (e) {
        /* ignore */
      }
      fn(arg);
    };
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error("ChatGPT took too long to respond. Please try again.")
        ),
      HARD_TIMEOUT
    );

    port.onMessage.addListener(async (msg) => {
      if (!msg || settled) return;
      if (msg.type === "status") {
        onStatus && onStatus(msg);
      } else if (msg.type === "need-foreground") {
        try {
          onNeedForeground && (await onNeedForeground());
        } catch (e) {
          /* ignore */
        }
        try {
          port.postMessage({ cmd: "foreground-ready" });
        } catch (e) {
          /* ignore */
        }
      } else if (msg.type === "result") {
        finish(resolve, msg.text);
      } else if (msg.type === "error") {
        finish(reject, new Error(msg.message));
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      finish(
        reject,
        new Error(
          err
            ? err.message
            : "Lost connection to ChatGPT (the page may have reloaded). Try again."
        )
      );
    });

    port.postMessage(payload);
  });
}

// --- Main action ---
async function run(action) {
  if (busy) return;

  const isAnswer = action === "answer";
  let prompt;
  let newChat;

  if (isAnswer) {
    prompt = questionEl.value.trim();
    if (!prompt) {
      setStatus("Type a question first.", "error");
      return;
    }
    state.question = prompt;
    newChat = true;
  } else if (action === "custom") {
    if (!state.hasAnswer) {
      setStatus("Get an answer first, then refine it.", "error");
      return;
    }
    prompt = customEl.value.trim();
    if (!prompt) {
      setStatus("Type a custom instruction first.", "error");
      return;
    }
    newChat = false;
  } else {
    if (!state.hasAnswer) {
      setStatus("Get an answer first, then refine it.", "error");
      return;
    }
    prompt = PROMPTS[action];
    newChat = false;
  }

  setBusy(true);
  setStatus("Connecting to ChatGPT…", "working");

  let originalTab = null;
  let chatTab = null;
  let switchedToChat = false;
  try {
    // Remember the tab you're on, in case we need to switch back later.
    const [active] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    originalTab = active || null;

    chatTab = await getOrCreateChatTab();
    await ensureContentScript(chatTab.id);

    // Only invoked if silent network capture fails: bring ChatGPT to the front
    // so it renders the reply for a DOM read. Restored in the finally block.
    const onNeedForeground = async () => {
      if (chatTab && (!originalTab || chatTab.id !== originalTab.id)) {
        setStatus("Bringing ChatGPT to the front…", "working");
        try {
          await chrome.tabs.update(chatTab.id, { active: true });
          switchedToChat = true;
        } catch (e) {
          /* ignore */
        }
      }
    };

    const text = await sendToTab(
      chatTab.id,
      { cmd: "run", prompt, newChat },
      (msg) => setStatus(STAGE_LABELS[msg.stage] || "Working…", "working"),
      onNeedForeground
    );
    showAnswer(text);
    setStatus(""); // clear the spinner; the answer panel is the confirmation
    await saveState();
  } catch (err) {
    console.error("Answer Machine:", err);
    setStatus(err.message || "Something went wrong.", "error");
  } finally {
    // If we had to switch to ChatGPT, return you to where you were.
    if (switchedToChat && originalTab && chatTab && originalTab.id !== chatTab.id) {
      try {
        await chrome.tabs.update(originalTab.id, { active: true });
      } catch (e) {
        /* ignore */
      }
    }
    setBusy(false);
  }
}

// --- Copy ---
async function copyAnswer() {
  if (!state.answer) return;
  try {
    await navigator.clipboard.writeText(state.answer);
    copyBtn.classList.add("copied"); // swaps the icon to a check via CSS
    setTimeout(() => copyBtn.classList.remove("copied"), 1200);
  } catch (e) {
    setStatus("Couldn't copy to clipboard.", "error");
  }
}

// --- Persistence (survives closing/reopening the panel) ---
async function saveState() {
  try {
    await chrome.storage.session.set({
      answer: state.answer,
      question: state.question,
      hasAnswer: state.hasAnswer,
    });
  } catch (e) {
    /* non-fatal */
  }
}

async function loadState() {
  try {
    const saved = await chrome.storage.session.get([
      "answer",
      "question",
      "hasAnswer",
      "pendingQuestion",
    ]);
    if (saved.question) questionEl.value = saved.question;
    if (saved.hasAnswer && saved.answer) {
      showAnswer(saved.answer);
      copyBtn.disabled = false;
      customEl.disabled = false;
      transformBtns.forEach((b) => (b.disabled = false));
    }
    // Text sent in from a page's "Ask Halo" button takes precedence.
    if (saved.pendingQuestion) {
      questionEl.value = saved.pendingQuestion;
      questionEl.focus();
      await chrome.storage.session.remove("pendingQuestion");
    }
  } catch (e) {
    /* non-fatal */
  }
}

// "Ask Halo" arriving while the panel is already open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "halo-fill" && typeof msg.text === "string") {
    questionEl.value = msg.text;
    questionEl.focus();
    setStatus("");
  }
});

// --- Wiring ---
answerBtn.addEventListener("click", () => run("answer"));
copyBtn.addEventListener("click", copyAnswer);
transformBtns.forEach((btn) =>
  btn.addEventListener("click", () => run(btn.dataset.action))
);

// Cmd/Ctrl+Enter in the textarea = Answer.
questionEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    run("answer");
  }
});

// Enter in the custom box = Apply.
customEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    run("custom");
  }
});

loadState();
