# Mindful Feed — Dopamine Filter for YouTube

A Chrome extension + small backend that:
1. Lets you label ~30 videos from your own YouTube feed as **dopamine-driven** or **productive**.
2. Trains a classifier (title/description/tags/comments + view/like/subscriber counts + duration + category) on those labels.
3. Uses the classifier to blur/hide dopamine-predicted videos in your feed, live.
4. Keeps asking for a quick thumbs-up/down after you watch or close a video, and folds that feedback back into the training data so the model keeps improving.

## How it works

- `extension/` — the Chrome extension (Manifest V3).
  - `content.js` runs on youtube.com: draws label buttons on feed cards, blurs
    dopamine-predicted videos, and shows a small feedback box after you finish/leave a video.
  - `background.js` is the service worker: it calls the YouTube Data API to turn a bare
    video ID into full features (description, tags, subscriber count, top comments, etc.)
    and talks to the backend.
  - `popup.html/js` — toggle labeling mode / filter mode, see label progress, trigger training.
  - `options.html/js` — set your YouTube Data API key and backend URL.
- `backend/` — a tiny Flask API.
  - `app.py` — endpoints: `/api/label`, `/api/feedback`, `/api/train`, `/api/predict`, `/api/stats`.
    Everything is stored in a single SQLite file (`data.db`), created automatically.
  - `model.py` — the actual classifier: TF-IDF on the combined text fields + scaled numeric
    features + one-hot category, feeding a Logistic Regression. Simple, and works fine on ~30
    rows.

## Setup

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

This starts the API on `http://localhost:5000` and creates `data.db` on first run.

### 2. YouTube Data API key

You need a free API key so the extension can pull description/tags/likes/subscriber
count/top comments for a video (feed cards alone don't expose these).

1. Go to the Google Cloud Console → create a project (or reuse one).
2. Enable **YouTube Data API v3**.
3. Create an API key (Credentials → Create Credentials → API key).

### 3. Load the extension

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select the `extension/` folder.
4. Click the extension icon → "Settings" and paste in your YouTube API key
   (backend URL defaults to `http://localhost:5000`).

## Using it

1. Open `youtube.com`, open the extension popup, turn on **Labeling mode**.
2. Scroll your home feed — each video card now shows 🌱 Productive / ⚡ Dopamine buttons.
   Label around 30 videos (mix of both, ideally at least 6 of each to start with).
3. In the popup, click **Train / retrain classifier**. You'll see the sample count and a
   cross-validated accuracy estimate.
4. Turn on **Enable dynamic filter**. New feed videos get classified in the background;
   ones predicted "dopamine" get blurred out with a small "click to show anyway" badge.
5. Keep browsing normally. When a video ends (or you pause after 30+ seconds), a small
   feedback box asks whether it was dopamine or productive. Every answer is stored and
   included the next time you click "Train / retrain classifier" — so accuracy improves
   the more you use it. Retrain periodically (e.g. every time you've given ~10 new
   labels/feedback answers).

## Notes / things kept intentionally simple

- The classifier retrains only when you click the button (not automatically on a timer),
  so you control when the model changes and can see the accuracy each time.
- Classification results are cached per video ID in the background worker for the
  session, so scrolling doesn't re-hit the backend for videos you've already seen.
- If comments are disabled on a video, `top_comments` is just left empty — it doesn't
  break enrichment.
- The DOM selectors in `content.js` target YouTube's current feed markup
  (`ytd-rich-item-renderer`, `ytd-video-renderer`, etc.). YouTube changes its DOM
  occasionally; if labeling buttons stop appearing, these selectors are the first
  place to check.
