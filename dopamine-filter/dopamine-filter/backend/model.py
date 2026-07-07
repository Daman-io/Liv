"""
model.py - the classifier itself.

Feature strategy (kept intentionally simple):
- All text fields (title, description, tags, channel_name, top_comments) are joined
  into one blob and run through TF-IDF.
- Numeric fields (views, likes, subscribers, duration, hours since publish) are scaled.
- category_id is treated as a categorical field (one-hot).
- Classifier: Logistic Regression - works fine on small (~30-100 row) datasets and
  gives us predict_proba for a confidence score.
"""

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

MODEL_PATH = "model.joblib"

TEXT_COLS = ["title", "description", "tags", "channel_name", "top_comments"]
NUMERIC_COLS = ["view_count", "like_count", "subscriber_count", "duration_seconds", "hours_since_publish"]
CATEGORICAL_COLS = ["category_id"]


def _combine_text(df: pd.DataFrame) -> pd.Series:
    return df[TEXT_COLS].fillna("").agg(" ".join, axis=1)


def build_pipeline() -> Pipeline:
    text_transformer = TfidfVectorizer(max_features=2000, stop_words="english")
    numeric_transformer = StandardScaler()
    categorical_transformer = OneHotEncoder(handle_unknown="ignore")

    preprocessor = ColumnTransformer(
        transformers=[
            ("text", text_transformer, "combined_text"),
            ("numeric", numeric_transformer, NUMERIC_COLS),
            ("categorical", categorical_transformer, CATEGORICAL_COLS),
        ]
    )

    return Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced")),
        ]
    )


def _prepare_dataframe(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for col in NUMERIC_COLS:
        df[col] = pd.to_numeric(df.get(col, 0), errors="coerce").fillna(0)
    for col in CATEGORICAL_COLS:
        df[col] = df.get(col, "0").astype(str)
    for col in TEXT_COLS:
        df[col] = df.get(col, "").fillna("") if col in df else ""
    df["combined_text"] = _combine_text(df)
    return df


def train_model(rows: list[dict]):
    """rows: list of dicts, each including a 'label' key ('dopamine'/'productive')."""
    df = _prepare_dataframe(rows)
    y = df["label"]
    X = df.drop(columns=["label"])

    pipeline = build_pipeline()

    # Cross-val accuracy only makes sense with a few samples per class; guard small data.
    accuracy = None
    n_classes = y.nunique()
    if len(df) >= 6 and n_classes == 2:
        cv_folds = min(5, y.value_counts().min())
        if cv_folds >= 2:
            scores = cross_val_score(pipeline, X, y, cv=cv_folds)
            accuracy = float(scores.mean())

    pipeline.fit(X, y)
    joblib.dump(pipeline, MODEL_PATH)
    return accuracy


def load_model():
    try:
        return joblib.load(MODEL_PATH)
    except FileNotFoundError:
        return None


def predict_one(features: dict):
    model = load_model()
    if model is None:
        return {"label": "unknown", "probability": 0.0}

    df = _prepare_dataframe([features])
    X = df  # already has combined_text etc.
    proba = model.predict_proba(X)[0]
    classes = model.classes_
    label = classes[proba.argmax()]
    probability = float(proba.max())
    return {"label": label, "probability": probability}
