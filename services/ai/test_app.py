from fastapi.testclient import TestClient

from services.ai.app import app


client = TestClient(app)


def test_analysis_is_advisory_and_excludes_official_fields():
    response = client.post("/analyze", json={
        "codingScore": 82,
        "aptitudeScore": 76,
        "cgpa": 8.4,
        "attendancePercent": 91,
        "dsaLevel": "INTERMEDIATE",
        "preferences": ["PEPC-01 AI/ML"],
        "completedCertificates": ["Data Science Foundation"],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["advisoryOnly"] is True
    for protected in ("eligible", "rank", "selected", "marks", "capacity"):
        assert protected not in body


def test_rejects_official_decision_fields_and_oversized_inputs():
    payload = {"codingScore": 82, "aptitudeScore": 76, "cgpa": 8.4,
               "attendancePercent": 91, "dsaLevel": "INTERMEDIATE",
               "preferences": [], "completedCertificates": []}
    assert client.post("/analyze", json={**payload, "selected": True}).status_code == 422
    assert client.post("/analyze", json={**payload, "completedCertificates": ["a"] * 101}).status_code == 422
    assert client.post("/analyze", json={**payload, "preferences": ["a" * 121]}).status_code == 422
