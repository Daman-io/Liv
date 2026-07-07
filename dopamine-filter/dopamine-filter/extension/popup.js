// popup.js

const labelCountEl = document.getElementById("labelCount");
const progressFillEl = document.getElementById("progressFill");
const labelingToggle = document.getElementById("labelingToggle");
const filterToggle = document.getElementById("filterToggle");
const trainBtn = document.getElementById("trainBtn");
const trainStatus = document.getElementById("trainStatus");

async function getConfig() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
  return resp.data;
}

async function refreshLabelCount() {
  try {
    const { backendUrl } = await getConfig();
    const res = await fetch(`${backendUrl}/api/stats`);
    const stats = await res.json();
    const goal = 30;
    const count = stats.total_labels || 0;
    labelCountEl.textContent = `${count} / ${goal}`;
    progressFillEl.style.width = `${Math.min(100, (count / goal) * 100)}%`;
  } catch (e) {
    labelCountEl.textContent = "backend offline";
  }
}

async function init() {
  const cfg = await getConfig();
  labelingToggle.checked = !!cfg.labelingMode;
  filterToggle.checked = !!cfg.filterEnabled;
  await refreshLabelCount();
}

labelingToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ labelingMode: labelingToggle.checked });
});

filterToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ filterEnabled: filterToggle.checked });
});

trainBtn.addEventListener("click", async () => {
  trainStatus.textContent = "Training...";
  try {
    const { backendUrl } = await getConfig();
    const res = await fetch(`${backendUrl}/api/train`, { method: "POST" });
    const data = await res.json();
    if (data.error) {
      trainStatus.textContent = `Error: ${data.error}`;
    } else {
      trainStatus.textContent = `Trained on ${data.n_samples} samples. CV accuracy: ${(data.accuracy * 100).toFixed(1)}%`;
      chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }); // predictions may have changed
    }
  } catch (e) {
    trainStatus.textContent = `Backend unreachable: ${e.message}`;
  }
});

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LABEL_SAVED") refreshLabelCount();
});

init();
