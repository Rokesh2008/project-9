#!/usr/bin/env bash
# Deploy an immutable image while retaining instance caps and IAM.
# API concurrency is 20; an explicit secret version can update its database pool.
# A failed health gate leaves existing production traffic untouched.
set -euo pipefail
service=${1:?Provide project9-api, project9-web or project9-ai}
image=${2:?Provide an immutable Artifact Registry image digest}
case "$service" in project9-api|project9-web|project9-ai) ;; *) echo 'Unsupported service' >&2; exit 2;; esac
component=${service#project9-}
if [[ ! "$image" =~ ^us-central1-docker.pkg.dev/khadamaty-502614/project9/$component@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Use the matching project9 image with a SHA256 digest' >&2; exit 2
fi
extra=(--quiet)
if [[ "$service" == project9-api ]]; then extra+=(--update-env-vars=HTTP_LOGGING=true --concurrency=20); fi
if [[ "$service" == project9-api && -n "${DATABASE_SECRET_VERSION:-}" ]]; then
  [[ "$DATABASE_SECRET_VERSION" =~ ^[0-9]+$ ]] || exit 2
  extra+=(--update-secrets="DATABASE_URL=project9-database-url:$DATABASE_SECRET_VERSION")
fi
gcloud run services update "$service" --image="$image" --no-traffic --tag=verify "${extra[@]}" --region=us-central1 --project=khadamaty-502614
candidate=$(gcloud run services describe "$service" --region=us-central1 --project=khadamaty-502614 --format='json(status.traffic)' | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const t=JSON.parse(s).status.traffic.find(t=>t.tag==="verify");if(!t?.url)process.exit(1);process.stdout.write(t.url)})')
route=/health
if [[ "$service" == project9-api ]]; then route=/api/health/ready; fi
if [[ "$service" == project9-ai ]]; then
  identity=$(gcloud auth print-identity-token)
  curl --retry 2 --retry-all-errors --max-time 15 --fail --silent --show-error -H "Authorization: Bearer $identity" "$candidate$route"
else
  curl --retry 2 --retry-all-errors --max-time 15 --fail --silent --show-error "$candidate$route"
fi
revision=$(gcloud run services describe "$service" --region=us-central1 --project=khadamaty-502614 --format='value(status.latestReadyRevisionName)')
gcloud run services update-traffic "$service" --to-revisions="$revision=100" --region=us-central1 --project=khadamaty-502614 --quiet
echo "Verified and released $service ($revision)"
