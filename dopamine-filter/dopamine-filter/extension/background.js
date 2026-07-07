// background.js
// Service worker: talks to the YouTube Data API (to enrich a bare video id with
// description/tags/stats/comments) and to our own backend (label/feedback/predict/train).
// Keeps a small in-memory + storage cache so we don't re-fetch/re-classify the same
// video repeatedly while the user scrolls.

const DEFAULTS = {
  backendUrl: "http://localhost:5000",
  youtubeApiKey: "",
  filterEnabled: false,
  labelingMode: false,
  labelGoal: 30
};

const classificationCache = new Map(); // videoId -> {label, probability}

async function getConfig() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

// ---- YouTube Data API enrichment -------------------------------------------------

function isoDurationToSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

function hoursSince(iso) {
  if (!iso) return 0;
  const published = new Date(iso).getTime();
  return Math.max(0, (Date.now() - published) / 36e5);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
  return res.json();
}

// Builds the full feature object our classifier expects, given just a videoId.
async function enrichVideo(videoId) {
  const { youtubeApiKey } = await getConfig();
  if (!youtubeApiKey) {
    throw new Error("Missing YouTube API key. Set it in the extension Options page.");
  }

  const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${youtubeApiKey}`;
  const videoData = await fetchJson(videoUrl);
  const item = videoData.items && videoData.items[0];
  if (!item) throw new Error("Video not found via YouTube API");

  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const content = item.contentDetails || {};

  // Subscriber count needs a second call against the channel.
  let subscriberCount = 0;
  if (snippet.channelId) {
    try {
      const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${snippet.channelId}&key=${youtubeApiKey}`;
      const chData = await fetchJson(chUrl);
      subscriberCount = parseInt(chData.items?.[0]?.statistics?.subscriberCount || "0", 10);
    } catch (e) {
      console.warn("Could not fetch subscriber count", e);
    }
  }

  // Top comments (best-effort - comments can be disabled).
  let topComments = "";
  try {
    const cUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=5&key=${youtubeApiKey}`;
    const cData = await fetchJson(cUrl);
    topComments = (cData.items || [])
      .map((c) => c.snippet.topLevelComment.snippet.textDisplay)
      .join(" || ");
  } catch (e) {
    // comments disabled or quota error - not fatal
  }

  return {
    video_id: videoId,
    title: snippet.title || "",
    description: snippet.description || "",
    tags: (snippet.tags || []).join(", "),
    channel_name: snippet.channelTitle || "",
    channel_url: snippet.channelId ? `https://www.youtube.com/channel/${snippet.channelId}` : "",
    top_comments: topComments,
    view_count: parseInt(stats.viewCount || "0", 10),
    like_count: parseInt(stats.likeCount || "0", 10),
    subscriber_count: subscriberCount,
    hours_since_publish: hoursSince(snippet.publishedAt),
    duration_seconds: isoDurationToSeconds(content.duration),
    category_id: snippet.categoryId || "0"
  };
}

// ---- Backend calls ----------------------------------------------------------------

async function postToBackend(path, body) {
  const { backendUrl } = await getConfig();
  const res = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function classifyVideo(videoId) {
  if (classificationCache.has(videoId)) return classificationCache.get(videoId);
  const features = await enrichVideo(videoId);
  const result = await postToBackend("/api/predict", features);
  classificationCache.set(videoId, result);
  return result;
}

// ---- Message router -----------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "GET_CONFIG": {
          sendResponse({ ok: true, data: await getConfig() });
          break;
        }
        case "ENRICH_VIDEO": {
          const data = await enrichVideo(msg.videoId);
          sendResponse({ ok: true, data });
          break;
        }
        case "SAVE_LABEL": {
          const features = await enrichVideo(msg.videoId);
          const data = await postToBackend("/api/label", { ...features, label: msg.label });
          sendResponse({ ok: true, data });
          break;
        }
        case "SAVE_FEEDBACK": {
          const features = await enrichVideo(msg.videoId);
          const data = await postToBackend("/api/feedback", { ...features, label: msg.label });
          sendResponse({ ok: true, data });
          break;
        }
        case "CLASSIFY_VIDEO": {
          const data = await classifyVideo(msg.videoId);
          sendResponse({ ok: true, data });
          break;
        }
        case "CLEAR_CACHE": {
          classificationCache.clear();
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
