"""
Intent Detection Service — port 8001

HTTP contract matches BartIntentProvider:
  GET  /health
  POST /v1/intent/classify
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from intent.classifier import DEFAULT_MODEL_ID, classify_zero_shot

app = FastAPI(title="Feedback Memory Intent Service", version="1.0.0")


class ClassifyRequest(BaseModel):
    text: str
    model_id: str = Field(default=DEFAULT_MODEL_ID, alias="model_id")
    candidate_labels: list[str] = Field(default_factory=list, alias="candidate_labels")
    multi_label: bool = Field(default=False, alias="multi_label")

    model_config = {"populate_by_name": True}


class LabelScore(BaseModel):
    label: str
    score: float


class ClassifyResponse(BaseModel):
    labels: list[LabelScore]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/intent/classify", response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> ClassifyResponse:
    text = request.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    if not request.candidate_labels:
        raise HTTPException(status_code=400, detail="candidate_labels is required")

    try:
        scores = classify_zero_shot(
            text=text,
            model_id=request.model_id,
            candidate_labels=request.candidate_labels,
            multi_label=request.multi_label,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ClassifyResponse(
        labels=[LabelScore(label=str(entry["label"]), score=float(entry["score"])) for entry in scores]
    )


def main() -> None:
    import uvicorn

    uvicorn.run("intent.main:app", host="127.0.0.1", port=8001, reload=False)


if __name__ == "__main__":
    main()
