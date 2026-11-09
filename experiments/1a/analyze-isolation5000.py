#!/usr/bin/env python3
"""Wertet vorhandene 1A-Berichte aus; startet keine Experimente."""
import argparse
import csv
import hashlib
import json
import re
import statistics
from collections import Counter
from pathlib import Path

RUNS = [
    "1-A", "1-B", "1-C",
    "2-A", "2-B", "2-C",
    "3-A", "3-B", "3-C",
]

def read_cgroup(path):
    content = path.read_text(encoding="utf-8")
    values = {
        key: int(value)
        for key, value in re.findall(
            r"^(usage_usec|nr_periods|nr_throttled|throttled_usec)\s+(\d+)$",
            content,
            re.MULTILINE,
        )
    }
    peak = re.search(r"memory\.peak:\s*(\d+)", content)
    values["memory_peak_bytes"] = int(peak.group(1)) if peak else None
    return values

def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = args.directory
    rows = []

    for run in RUNS:
        folder = root / run
        report = json.loads(
            (folder / "report.json").read_text(encoding="utf-8")
        )
        metrics = report["metrics"]
        analyses = [
            analysis
            for round_ in metrics["rounds"]
            for analysis in round_.get("analyses", [])
        ]
        reasons = Counter(
            analysis.get("normalizationFallbackReason")
            for analysis in analyses
            if analysis.get("normalizationFallbackReason")
        )
        assertions = report.get("assertions", [])
        lemma = sum(
            analysis.get("normalizationApplied") == "LEMMA"
            for analysis in analyses
        )
        row = {
            "run": run,
            "variant": run[-1],
            "vote_p95_ms": metrics["voteP95Ms"],
            "visibility_p95_ms": metrics["hostVisibilityP95Ms"],
            "analysis_p95_ms": metrics["analysisP95Ms"],
            "analyses": len(analyses),
            "lemma": lemma,
            "lemma_pct": round(100 * lemma / len(analyses), 2)
                if analyses else "",
            "normalization_fallback_reasons": json.dumps(
                reasons, ensure_ascii=False, sort_keys=True
            ),
            "assertions_passed": bool(assertions) and all(
                a.get("passed") is True for a in assertions
            ),
            "elapsed_s": float(
                (folder / "elapsed-seconds.txt").read_text().strip()
            ),
            "spacy_cpu_s": "",
            "throttled_periods_delta": "",
            "throttled_s_delta": "",
            "spacy_cgroup_lifetime_peak_mib": "",
        }
        if run[-1] != "A":
            before = read_cgroup(folder / "cgroup-before.txt")
            after = read_cgroup(folder / "cgroup-after.txt")
            for key in ("usage_usec", "nr_throttled", "throttled_usec"):
                if after[key] < before[key]:
                    raise ValueError(f"{run}: Zählerrücksetzung bei {key}")
            row["spacy_cpu_s"] = (
                after["usage_usec"] - before["usage_usec"]
            ) / 1_000_000
            row["throttled_periods_delta"] = (
                after["nr_throttled"] - before["nr_throttled"]
            )
            row["throttled_s_delta"] = (
                after["throttled_usec"] - before["throttled_usec"]
            ) / 1_000_000
            if after["memory_peak_bytes"] is not None:
                row["spacy_cgroup_lifetime_peak_mib"] = round(
                    after["memory_peak_bytes"] / 1024**2, 2
                )
        rows.append(row)

    write_csv(root / "summary-runs.csv", rows)
    variants = []
    for variant in "ABC":
        group = [row for row in rows if row["variant"] == variant]
        total = sum(row["analyses"] for row in group)
        lemma = sum(row["lemma"] for row in group)
        result = {
            "variant": variant,
            "runs": len(group),
            "analyses": total,
            "lemma": lemma,
            "lemma_pct": round(100 * lemma / total, 2),
        }
        for key in (
            "vote_p95_ms", "visibility_p95_ms", "analysis_p95_ms",
            "spacy_cpu_s", "throttled_s_delta",
        ):
            values = [
                row[key] for row in group
                if isinstance(row[key], (int, float))
            ]
            for label, function in (
                ("median", statistics.median),
                ("min", min),
                ("max", max),
            ):
                result[f"{key}_{label}"] = (
                    round(function(values), 6) if values else ""
                )
        variants.append(result)
    write_csv(root / "summary-variants.csv", variants)

    checksum_path = root / "checksums.sha256"
    paths = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path != checksum_path
    )
    checksum_path.write_text(
        "".join(
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  "
            f"{path.relative_to(root).as_posix()}\n"
            for path in paths
        ),
        encoding="utf-8",
    )
    for row in variants:
        print(
            f"{row['variant']}: "
            f"Vote-p95 Median={row['vote_p95_ms_median']} ms; "
            f"Analyse-p95 Median={row['analysis_p95_ms_median']} ms; "
            f"LEMMA={row['lemma']}/{row['analyses']}"
        )
    print(f"Ausgewertet: {len(rows)} Läufe")
    print(f"Prüfsummen: {len(paths)} Veröffentlichungsdateien")

if __name__ == "__main__":
    main()
