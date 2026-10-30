#!/usr/bin/env bash
# Run database migrations using dbmate on the Docker Compose network.
# Usage: ./database/scripts/migrate.sh [dbmate args...]
# Example: ./database/scripts/migrate.sh up
#          ./database/scripts/migrate.sh status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_ROOT}"

if [[ ! -f .env ]]; then
  echo "Error: .env not found. Copy .env.example to .env and configure credentials." >&2
  exit 1
fi

docker compose --profile tools run --rm dbmate "$@"
