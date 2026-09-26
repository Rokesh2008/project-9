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
