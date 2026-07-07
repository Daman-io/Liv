const apiKeyEl = document.getElementById("youtubeApiKey");
const backendUrlEl = document.getElementById("backendUrl");
const statusEl = document.getElementById("status");

async function load() {
  const cfg = await chrome.storage.sync.get(["youtubeApiKey", "backendUrl"]);
  apiKeyEl.value = cfg.youtubeApiKey || "";
  backendUrlEl.value = cfg.backendUrl || "http://localhost:5000";
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    youtubeApiKey: apiKeyEl.value.trim(),
    backendUrl: (backendUrlEl.value.trim() || "http://localhost:5000").replace(/\/$/, "")
  });
  statusEl.textContent = "Saved!";
  setTimeout(() => (statusEl.textContent = ""), 2000);
});

load();
