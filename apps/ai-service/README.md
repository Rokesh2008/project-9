# AI Service

The Member 3 FastAPI advisory service currently lives in `services/ai` so it
can be built independently by Docker and tested as a Python package. It owns
performance analysis only; selection, eligibility, ranking, and allocation
remain authoritative backend responsibilities.
