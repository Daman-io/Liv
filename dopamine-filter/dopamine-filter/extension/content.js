// content.js
// Runs on youtube.com. Three jobs:
//  1) Labeling mode: draw "Productive / Dopamine" buttons over feed thumbnails so the
//     user can build the initial ~30-video training set.
//  2) Filter mode: ask the background worker to classify feed videos and hide/blur the
//     ones predicted as dopamine-driven.
//  3) Feedback: on a /watch page, when the video ends or the user navigates away after
//     watching a chunk of it, ask "was that dopamine or productive?" and send it back
//     as ongoing training data.

const FEED_ITEM_SELECTOR = "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer";
const processedNodes = new WeakSet();

function extractVideoIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/[?&]v=([^&]+)/) || href.match(/\/shorts\/([^?&/]+)/);
  return m ? m[1] : null;
}

function getVideoCardInfo(el) {
  const link = el.querySelector("a#thumbnail, a#video-title-link, a.ytd-thumbnail");
  const href = link ? link.getAttribute("href") : null;
  const videoId = extractVideoIdFromHref(href);
  const titleEl = el.querySelector("#video-title, #video-title-link, h3 a");
  const title = titleEl ? titleEl.textContent.trim() : "";
  return { videoId, title, href };
}

// ---------------------------------------------------------------------------------
// 1) LABELING MODE
// ---------------------------------------------------------------------------------

function buildLabelOverlay(videoId, title) {
  const overlay = document.createElement("div");
  overlay.className = "mf-label-overlay";

  const chip = document.createElement("div");
  chip.className = "mf-chip";
  chip.textContent = "Label this video";
  overlay.appendChild(chip);

  const btnRow = document.createElement("div");
  btnRow.className = "mf-btn-row";

  const productiveBtn = document.createElement("button");
  productiveBtn.className = "mf-btn mf-btn-productive";
  productiveBtn.textContent = "🌱 Productive";

  const dopamineBtn = document.createElement("button");
  dopamineBtn.className = "mf-btn mf-btn-dopamine";
  dopamineBtn.textContent = "⚡ Dopamine";

  const sendLabel = async (label, btnEl) => {
    btnEl.textContent = "Saving...";
    btnEl.disabled = true;
    const resp = await chrome.runtime.sendMessage({ type: "SAVE_LABEL", videoId, label });
    if (resp.ok) {
      chip.textContent = `Saved as ${label} ✔`;
      productiveBtn.remove();
      dopamineBtn.remove();
      chrome.runtime.sendMessage({ type: "LABEL_SAVED" }); // let popup update its counter
    } else {
      chip.textContent = `Error: ${resp.error}`;
      btnEl.disabled = false;
    }
  };

  productiveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendLabel("productive", productiveBtn);
  });
  dopamineBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendLabel("dopamine", dopamineBtn);
  });

  btnRow.appendChild(productiveBtn);
  btnRow.appendChild(dopamineBtn);
  overlay.appendChild(btnRow);
  return overlay;
}

function applyLabelingUI(el) {
  if (processedNodes.has(el)) return;
  const { videoId, title } = getVideoCardInfo(el);
  if (!videoId) return;
  el.style.position = "relative";
  el.appendChild(buildLabelOverlay(videoId, title));
  processedNodes.add(el);
}

// ---------------------------------------------------------------------------------
// 2) FILTER MODE
// ---------------------------------------------------------------------------------

async function applyFilterUI(el) {
  const { videoId } = getVideoCardInfo(el);
  if (!videoId) return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: "CLASSIFY_VIDEO", videoId });
    if (!resp.ok) return;
    const { label, probability } = resp.data;
    if (label === "dopamine") {
      el.classList.add("mf-hidden-video");
      const badge = document.createElement("div");
      badge.className = "mf-blocked-badge";
      badge.textContent = `Filtered: dopamine-driven (${Math.round((probability || 0) * 100)}%) — click to show`;
      badge.addEventListener("click", () => {
        el.classList.remove("mf-hidden-video");
        badge.remove();
      });
      el.style.position = "relative";
      el.appendChild(badge);
    }
  } catch (e) {
    // backend not reachable / not trained yet - fail open (show video)
  }
}

// ---------------------------------------------------------------------------------
// Scan loop - re-run whenever new cards appear (infinite scroll)
// ---------------------------------------------------------------------------------

async function scanFeed() {
  const { labelingMode, filterEnabled } = await chrome.runtime
    .sendMessage({ type: "GET_CONFIG" })
    .then((r) => r.data);

  if (!labelingMode && !filterEnabled) return;

  document.querySelectorAll(FEED_ITEM_SELECTOR).forEach((el) => {
    if (labelingMode) applyLabelingUI(el);
    if (filterEnabled && !processedNodes.has(el)) {
      processedNodes.add(el);
      applyFilterUI(el);
    }
  });
}

const observer = new MutationObserver(() => {
  clearTimeout(window.__mfScanTimeout);
  window.__mfScanTimeout = setTimeout(scanFeed, 400);
});
observer.observe(document.body, { childList: true, subtree: true });
scanFeed();

// react instantly when the popup toggles labeling/filter mode
chrome.storage.onChanged.addListener((changes) => {
  if (changes.labelingMode || changes.filterEnabled) {
    processedNodes && document.querySelectorAll(".mf-label-overlay, .mf-blocked-badge").forEach((n) => n.remove());
    scanFeed();
  }
});

// ---------------------------------------------------------------------------------
// 3) FEEDBACK ON THE WATCH PAGE
// ---------------------------------------------------------------------------------

let currentWatchedVideoId = null;
let watchStartTime = null;
let feedbackAsked = false;

function currentVideoIdFromUrl() {
  const url = new URL(location.href);
  return url.searchParams.get("v");
}

function showFeedbackPrompt(videoId) {
  if (feedbackAsked || !videoId) return;
  feedbackAsked = true;

  const box = document.createElement("div");
  box.className = "mf-feedback-box";
  box.innerHTML = `
    <div class="mf-feedback-title">How was that video?</div>
    <div class="mf-btn-row">
      <button class="mf-btn mf-btn-productive" id="mf-fb-productive">🌱 Productive</button>
      <button class="mf-btn mf-btn-dopamine" id="mf-fb-dopamine">⚡ Dopamine</button>
      <button class="mf-btn mf-btn-dismiss" id="mf-fb-dismiss">Skip</button>
    </div>`;
  document.body.appendChild(box);

  const cleanup = () => box.remove();

  box.querySelector("#mf-fb-productive").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "SAVE_FEEDBACK", videoId, label: "productive" });
    cleanup();
  });
  box.querySelector("#mf-fb-dopamine").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "SAVE_FEEDBACK", videoId, label: "dopamine" });
    cleanup();
  });
  box.querySelector("#mf-fb-dismiss").addEventListener("click", cleanup);

  setTimeout(cleanup, 20000); // auto-dismiss so it never blocks the UI forever
}

function attachPlayerListeners() {
  const player = document.querySelector("video.html5-main-video");
  if (!player || player.__mfListenerAttached) return;
  player.__mfListenerAttached = true;

  player.addEventListener("ended", () => showFeedbackPrompt(currentWatchedVideoId));

  // Also treat "watched at least 30s then paused/left" as a valid feedback trigger.
  player.addEventListener("pause", () => {
    if (player.currentTime > 30 && !player.ended) showFeedbackPrompt(currentWatchedVideoId);
  });
}

function handleWatchPageChange() {
  const vid = currentVideoIdFromUrl();
  if (vid && vid !== currentWatchedVideoId) {
    currentWatchedVideoId = vid;
    watchStartTime = Date.now();
    feedbackAsked = false;
    setTimeout(attachPlayerListeners, 1500); // give the player time to mount
  }
}

// YouTube is a SPA; it fires this custom event on internal navigation.
document.addEventListener("yt-navigate-finish", handleWatchPageChange);
handleWatchPageChange();
