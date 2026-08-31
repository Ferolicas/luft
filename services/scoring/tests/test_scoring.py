import os

from fastapi.testclient import TestClient

os.environ["INTERNAL_SERVICE_TOKEN"] = "test-secret-token"

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_scoring_requires_internal_token():
    response = client.post("/v1/score", json={"planning": 5, "consistency": 5, "risk_awareness": 5, "savings_habit": 5, "income_stability": 5})
    assert response.status_code == 401


def test_score_is_bounded_and_explainable():
    response = client.post(
        "/v1/score",
        headers={"x-internal-token": "test-secret-token"},
        json={"planning": 8, "consistency": 8, "risk_awareness": 7, "savings_habit": 6, "income_stability": 7, "existing_history": True, "bureau_score": 720},
    )
    assert response.status_code == 200
    payload = response.json()
    assert 100 <= payload["score"] <= 900
    assert payload["decision_version"] == "rules-2026.09"
    assert "behavioral_index" in payload["factors"]
