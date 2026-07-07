"""
app.py - tiny Flask backend for the Mindful Feed extension.

Endpoints:
  POST /api/label     store a manually-labeled video (from the labeling session)
  POST /api/feedback   store a post-watch feedback label (ongoing training data)
  POST /api/train      retrain the classifier on everything stored so far
  POST /api/predict     classify a single video's features
  GET  /api/stats       counts, for the popup's progress bar

Storage: a single SQLite file (data.db), one row per labeled video. Feedback and
manual labels are stored the same way (a 'source' column tells them apart) so both
feed into every retrain, per the "keep learning from feedback" requirement.
"""

import sqlite3
from contextlib import closing

from flask import Flask, jsonify, request
from flask_cors import CORS

import model

app = Flask(__name__)
CORS(app)  # the extension calls this from a chrome-extension:// origin

DB_PATH = "data.db"

FEATURE_COLUMNS = [
    "video_id", "title", "description", "tags", "channel_name", "channel_url",
    "top_comments", "view_count", "like_count", "subscriber_count",
    "hours_since_publish", "duration_seconds", "category_id",
]


def init_db():
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                {", ".join(f"{c} TEXT" for c in FEATURE_COLUMNS)},
                label TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def insert_sample(payload: dict, source: str):
    values = [payload.get(c, "") for c in FEATURE_COLUMNS]
    label = payload.get("label")
    if label not in ("dopamine", "productive"):
        raise ValueError("label must be 'dopamine' or 'productive'")

    with closing(sqlite3.connect(DB_PATH)) as conn:
        placeholders = ", ".join("?" for _ in FEATURE_COLUMNS)
        conn.execute(
            f"""INSERT INTO samples ({", ".join(FEATURE_COLUMNS)}, label, source)
                VALUES ({placeholders}, ?, ?)""",
            (*values, label, source),
        )
        conn.commit()


def fetch_all_samples() -> list[dict]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM samples").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/label")
def api_label():
    payload = request.get_json(force=True)
    try:
        insert_sample(payload, source="manual")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"status": "saved"})


@app.post("/api/feedback")
def api_feedback():
    payload = request.get_json(force=True)
    try:
        insert_sample(payload, source="feedback")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"status": "saved"})


@app.post("/api/train")
def api_train():
    rows = fetch_all_samples()
    if len(rows) < 6:
        return jsonify({"error": f"Need at least 6 labeled samples, have {len(rows)}"}), 400

    accuracy = model.train_model(rows)
    return jsonify({
        "status": "trained",
        "n_samples": len(rows),
        "accuracy": accuracy if accuracy is not None else -1,
    })


@app.post("/api/predict")
def api_predict():
    features = request.get_json(force=True)
    result = model.predict_one(features)
    return jsonify(result)


@app.get("/api/stats")
def api_stats():
    rows = fetch_all_samples()
    dopamine = sum(1 for r in rows if r["label"] == "dopamine")
    productive = sum(1 for r in rows if r["label"] == "productive")
    return jsonify({
        "total_labels": len(rows),
        "dopamine": dopamine,
        "productive": productive,
    })


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
