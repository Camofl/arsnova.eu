#!/usr/bin/env bash
set -euo pipefail

COMPOSE="compose.experiment-1a.yml"
ROOT="experiments/1a/results/series-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ROOT"

dc() {
  docker compose -f "$COMPOSE" "$@"
}

capture_cpu() {
  dc exec -T spacy python -c '
from pathlib import Path
for name in ("cpu.stat", "cpu.max", "memory.current", "memory.peak"):
    path = Path("/sys/fs/cgroup") / name
    print(name + ":")
    print(path.read_text() if path.exists() else "unavailable")
'
}

stats_pid=""
cleanup() {
  if [ -n "$stats_pid" ]; then
    kill "$stats_pid" 2>/dev/null || true
    wait "$stats_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

for entry in 1-A 1-B 1-C 2-B 2-C 2-A 3-C 3-A 3-B; do
  scenario="${entry#*-}"
  directory="$ROOT/$entry"
  mkdir -p "$directory"

  enabled=false
  cpus=1.0
  if [ "$scenario" != A ]; then enabled=true; fi
  if [ "$scenario" = C ]; then cpus=0.25; fi
  export EXP_NLP_ENABLED="$enabled"
  export EXP_SPACY_CPUS="$cpus"

  dc stop app

  if [ "$scenario" = A ]; then
    dc --profile nlp stop spacy
  else
    dc --profile nlp up -d --no-deps --force-recreate \
      --wait --wait-timeout 240 spacy
  fi

  dc exec -T redis redis-cli FLUSHDB > /dev/null
  dc up -d --no-deps --force-recreate --wait --wait-timeout 240 app

  dc exec -T app node -e '
console.log(JSON.stringify({
  nlp: process.env.NLP_ENABLED,
  encoder: process.env.WORD_CLOUD_SEMANTIC_ENABLED,
  qaNlp: process.env.QA_NLP_ENABLED,
  summary: process.env.QA_SUMMARY_ENABLED,
  llm: process.env.OPEN_WEIGHT_LLM_ENABLED
}, null, 2))
' > "$directory/flags.json"

  if [ "$scenario" != A ]; then
    dc ps -q spacy | xargs docker inspect \
      --format '{{json .HostConfig}}' > "$directory/spacy-limits.json"
    capture_cpu > "$directory/cgroup-before.txt"
  fi

  ids="$(dc ps -q)"
  docker stats --format '{{json .}}' $ids > "$directory/docker-stats.jsonl" &
  stats_pid=$!

  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  PARTICIPANTS=100 \
  ITERATIONS=10 \
  ANALYSIS_P95_LIMIT_MS=30000 \
  REPORT_FILE="$directory/report.json" \
    node scripts/load/experiment-1a-concurrent.mjs \
    > "$directory/console.log" 2>&1
  result=$?
  set -e

  cleanup
  stats_pid=""
  printf '%s\n' "$result" > "$directory/exit-code.txt"

  if [ "$scenario" != A ]; then
    capture_cpu > "$directory/cgroup-after.txt"
  fi

  dc logs --since "$started" app > "$directory/app.log"
  cat "$directory/console.log"

  if [ "$result" -eq 2 ]; then
    echo "Laufzeitfehler in Szenario $scenario; Abbruch."
    exit 2
  fi
done

printf '\nErgebnisse: %s\n' "$ROOT"
