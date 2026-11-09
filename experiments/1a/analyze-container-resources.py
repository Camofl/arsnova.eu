#!/usr/bin/env python3
"""Wertet vorhandene docker-stats-Dateien aus; startet keine Container."""
import argparse
import csv
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

RUNS = [
    "1-A", "1-B", "1-C",
    "2-A", "2-B", "2-C",
    "3-A", "3-B", "3-C",
]
FACTORS = {
    "B": 1,
    "kB": 1000,
    "KB": 1000,
    "MB": 1000**2,
    "GB": 1000**3,
    "TB": 1000**4,
    "KiB": 1024,
    "MiB": 1024**2,
    "GiB": 1024**3,
    "TiB": 1024**4,
}

def memory_mib(value):
    match = re.fullmatch(r"\s*([\d.]+)\s*([A-Za-z]+)\s*", value)
    if not match or match.group(2) not in FACTORS:
        raise ValueError(f"Unbekannte Speicherangabe: {value!r}")
    return float(match.group(1)) * FACTORS[match.group(2)] / 1024**2

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    root = parser.parse_args().directory
    rows = []

    for run in RUNS:
        samples = defaultdict(list)
        path = root / run / "docker-stats.jsonl"

        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1
        ):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                name = item["Name"]
                service = next(
                    (
                        service for service in
                        ("app", "postgres", "redis", "spacy")
                        if name.endswith(f"-{service}-1")
                    ),
                    None,
                )
                if service is None:
                    raise ValueError(f"Unbekannter Container: {name}")
                cpu = float(item["CPUPerc"].strip().removesuffix("%"))
                used, _ = item["MemUsage"].split("/", 1)
                samples[service].append((cpu, memory_mib(used)))
            except Exception as error:
                raise ValueError(f"{path}:{number}: {error}") from error

        expected = {"app", "postgres", "redis"}
        if run[-1] != "A":
            expected.add("spacy")
        if set(samples) != expected:
            raise ValueError(
                f"{run}: Dienste {sorted(samples)}, "
                f"erwartet {sorted(expected)}"
            )

        for service, values in sorted(samples.items()):
            cpu = [value[0] for value in values]
            ram = [value[1] for value in values]
            rows.append({
                "run": run,
                "variant": run[-1],
                "service": service,
                "samples": len(values),
                "cpu_pct_sample_median": round(statistics.median(cpu), 2),
                "cpu_pct_sample_max": round(max(cpu), 2),
                "memory_mib_sample_median": round(
                    statistics.median(ram), 2
                ),
                "memory_mib_sample_max": round(max(ram), 2),
            })

    destination = root / "summary-resources.csv"
    with destination.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print("Je Variante: Median der laufbezogenen CPU-Mediane;")
    print("RAM: höchster aufgezeichneter Einzelwert über drei Läufe.")
    for variant in "ABC":
        for service in ("app", "postgres", "redis", "spacy"):
            selected = [
                row for row in rows
                if row["variant"] == variant and row["service"] == service
            ]
            if selected:
                cpu = statistics.median(
                    row["cpu_pct_sample_median"] for row in selected
                )
                ram = max(
                    row["memory_mib_sample_max"] for row in selected
                )
                print(
                    f"{variant} {service:8s}: "
                    f"CPU={cpu:.2f} %, RAM-Stichprobenmax={ram:.2f} MiB"
                )
    print(f"Ergebnis: {destination}")

if __name__ == "__main__":
    main()
