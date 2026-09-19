"""Command line entry point: ``python -m pipeline.cli <command>``.

Commands
--------
build     load sources, emit bundles into site/data, print a summary
validate  load sources without emitting, to check them in isolation
stats     coverage report over the current sources
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from pipeline.emit import bucket_for, write_bundles
from pipeline.loader import curated_paths, load_entries, load_taxonomy
from pipeline.model import format_year


def _load():
    taxonomy = load_taxonomy()
    paths = curated_paths()
    if not paths:
        raise SystemExit("no source files found under data/curated/")
    return load_entries(paths, taxonomy), taxonomy, paths


def _summary(entries, taxonomy) -> None:
    lanes = Counter(taxonomy.lane_for(e.regions[0]) or "global" for e in entries)
    kinds = Counter(e.kind for e in entries)
    conf = Counter(e.confidence for e in entries)

    print(f"\n  {len(entries)} entries "
          f"({sum(1 for e in entries if e.origin == 'curated')} curated, "
          f"{sum(1 for e in entries if e.origin != 'curated')} imported)")
    print(f"  span  {format_year(min(e.start.min for e in entries))}"
          f"  ->  {format_year(max(e.end.max for e in entries))}")

    print("\n  by lane")
    for lane in taxonomy.lanes:
        count = lanes.get(lane.id, 0)
        bar = "#" * min(count, 40)
        flag = "" if count else "   <- empty"
        print(f"    {lane.label:<26} {count:>4}  {bar}{flag}")

    print("\n  by kind")
    for kind, count in kinds.most_common():
        print(f"    {kind:<26} {count:>4}")

    print("\n  confidence")
    for level in ("high", "medium", "contested"):
        if conf.get(level):
            print(f"    {level:<26} {conf[level]:>4}")

    widest = sorted(entries, key=lambda e: -e.start.width)[:5]
    human = [e for e in widest if e.start.min > -11_700]
    if human:
        print("\n  widest brackets (human history)")
        for entry in human:
            print(f"    {entry.title:<36} {entry.start.width:>5} yr  {entry.confidence}")


def cmd_build(_args) -> int:
    entries, taxonomy, paths = _load()
    meta = write_bundles(entries, taxonomy)
    print(f"built from {len(paths)} source file(s) -> site/data/")
    print(f"  {len(meta['eraBuckets'])} era bundles")
    _summary(entries, taxonomy)
    return 0


def cmd_validate(_args) -> int:
    entries, taxonomy, paths = _load()
    # The full rule set lands in Phase 4; loading already enforces schema,
    # date parsing, and ordering, so a clean load is a real signal today.
    print(f"loaded {len(entries)} entries from {len(paths)} file(s) with no errors")
    return 0


def cmd_stats(_args) -> int:
    entries, taxonomy, _ = _load()
    _summary(entries, taxonomy)
    buckets = Counter(bucket_for(e.start.min) for e in entries)
    print("\n  by era bucket")
    for bucket, count in sorted(buckets.items(), key=lambda kv: -kv[1]):
        print(f"    {bucket:<26} {count:>4}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="emit site/data from data/ sources")
    sub.add_parser("validate", help="check sources without emitting")
    sub.add_parser("stats", help="coverage report")

    args = parser.parse_args(argv)
    return {
        "build": cmd_build,
        "validate": cmd_validate,
        "stats": cmd_stats,
    }[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
