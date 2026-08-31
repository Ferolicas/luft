from __future__ import annotations

import hmac
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

app = FastAPI(
    title="LUFT Scoring",
    version="0.1.0",
    docs_url=None if os.getenv("NODE_ENV") == "production" else "/docs",
    redoc_url=None,
)


class ScoreFeatures(BaseModel):
    planning: float = Field(ge=0, le=10)
    consistency: float = Field(ge=0, le=10)
    risk_awareness: float = Field(ge=0, le=10)
    savings_habit: float = Field(ge=0, le=10)
    income_stability: float = Field(ge=0, le=10)
    existing_history: bool = False
    bureau_score: int | None = Field(default=None, ge=0, le=1000)


class ScoreResponse(BaseModel):
    score: int
    archetype: str
    decision_version: str
    model_used: bool
    factors: dict[str, float | bool | int | None]


def internal_auth(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("INTERNAL_SERVICE_TOKEN", "")
    if not expected or not x_internal_token or not hmac.compare_digest(expected, x_internal_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_internal_token")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "luft-scoring"}


@app.post("/v1/score", response_model=ScoreResponse, dependencies=[Depends(internal_auth)])
def calculate_score(features: ScoreFeatures) -> ScoreResponse:
    behavioral = (
        features.planning * 0.24
        + features.consistency * 0.27
        + features.risk_awareness * 0.19
        + features.savings_habit * 0.17
        + features.income_stability * 0.13
    )
    base_score = 180 + behavioral * 52
    if features.existing_history and features.bureau_score is not None:
        score = round(base_score * 0.35 + features.bureau_score * 0.65)
    else:
        score = round(base_score)
    score = max(100, min(900, score))
    archetype = "ESTRATEGA" if behavioral >= 7.5 else "EXPLORADOR" if behavioral >= 5 else "CONSTRUCTOR" if behavioral >= 2.5 else "INICIADOR"
    return ScoreResponse(
        score=score,
        archetype=archetype,
        decision_version="rules-2026.09",
        model_used=False,
        factors={**features.model_dump(), "behavioral_index": round(behavioral, 4)},
    )
