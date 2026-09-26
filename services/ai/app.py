from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Project 9 Advisory AI", version="1.0.0")


class StudentFeatures(BaseModel):
    codingScore: float = Field(ge=0, le=100)
    aptitudeScore: float = Field(ge=0, le=100)
    cgpa: float = Field(ge=0, le=10)
    attendancePercent: float = Field(ge=0, le=100)
    dsaLevel: Literal["BEGINNER", "INTERMEDIATE", "ADVANCED"]
    preferences: list[str] = Field(max_length=5)
    completedCertificates: list[str]


class DomainRecommendation(BaseModel):
    domain: str
    score: int
    reason: str


class AdvisoryResult(BaseModel):
    strengths: list[str]
    gaps: list[str]
    trend: Literal["STRONG", "STABLE", "AT_RISK"]
    recommendedDomains: list[DomainRecommendation]
    advisoryOnly: Literal[True] = True


@app.get("/health")
def health():
    return {"status": "ok", "mode": "deterministic-advisory"}


@app.post("/analyze", response_model=AdvisoryResult)
def analyze(features: StudentFeatures):
    """Produces advice only. No eligibility, rank, marks, capacity, or selection fields are accepted or returned."""
    strengths: list[str] = []
    gaps: list[str] = []
    if features.codingScore >= 75:
        strengths.append("Strong coding performance")
    else:
        gaps.append("Improve coding and DSA consistency")
    if features.aptitudeScore >= 70:
        strengths.append("Strong analytical aptitude")
    else:
        gaps.append("Practice quantitative and logical aptitude")
    if features.cgpa >= 8:
        strengths.append("Consistent academic performance")
    if features.attendancePercent < 75:
        gaps.append("Attendance is below the recommended level")
    if not features.completedCertificates:
        gaps.append("Complete the chosen domain prerequisite certificates")

    base = features.codingScore * 0.45 + features.aptitudeScore * 0.25 + features.cgpa * 3
    domains = features.preferences[:3] or ["PEPC-01 AI/ML", "PEPC-05 Data Science", "PEPC-06 Full Stack MERN"]
    recommendations = [
        DomainRecommendation(
            domain=domain,
            score=max(50, min(99, round(base - index * 4))),
            reason=(
                "Matches first preference and the supplied performance profile"
                if index == 0
                else "Alternative preference supported by the supplied skills"
            ),
        )
        for index, domain in enumerate(domains)
    ]
    trend: Literal["STRONG", "STABLE", "AT_RISK"] = (
        "STRONG" if features.codingScore >= 75 and features.attendancePercent >= 75
        else "AT_RISK" if len(gaps) >= 2 else "STABLE"
    )
    return AdvisoryResult(
        strengths=strengths,
        gaps=gaps,
        trend=trend,
        recommendedDomains=recommendations,
    )
