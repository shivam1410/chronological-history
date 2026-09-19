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

from dataclasses import replace

from pipeline import citations as citations_mod
from pipeline import images as images_mod
from pipeline.emit import bucket_for, write_bundles
from pipeline.loader import curated_paths, load_entries, load_taxonomy
from pipeline.model import format_year


def _load():
    taxonomy = load_taxonomy()
    paths = curated_paths()
    if not paths:
        raise SystemExit("no source files found under data/curated/")
    entries = load_entries(paths, taxonomy)
    return _apply_citations(_apply_images(entries)), taxonomy, paths


def _apply_citations(entries):
    """Attach fetched citations to entries that cite nothing yet.

    Kept out of the curated YAML because these were resolved by machine, and
    mixing them into hand-authored files would blur which is which.
    """
    from pipeline.model import Source

    fetched = citations_mod.load()
    if not fetched:
        return entries
    return [
        replace(entry, sources=(Source(title=fetched[entry.id]["title"],
                                       url=fetched[entry.id]["url"]),))
        if not entry.sources and entry.id in fetched else entry
        for entry in entries
    ]


def _apply_images(entries):
    """Attach fetched Commons images to entries that do not declare one.

    Kept out of the curated YAML so that machine-fetched metadata never gets
    mixed into hand-authored files.
    """
    from pipeline.model import parse_image

    fetched = images_mod.load()
    if not fetched:
        return entries
    return [
        replace(entry, image=parse_image(fetched[entry.id]))
        if entry.image is None and entry.id in fetched else entry
        for entry in entries
    ]


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
    entries, _taxonomy, paths = _load()
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


def cmd_audit(_args) -> int:
    """Where the dataset's evidence is thin.

    Everything here was written from knowledge rather than researched from
    sources, so this is the honest measure of how much of it a reader can
    check independently.
    """
    entries, _taxonomy, _paths = _load()
    sourced = [e for e in entries if e.sources]
    contested = [e for e in entries if e.confidence == "contested"]
    unsourced_contested = [e for e in contested if not e.sources]

    print(f"\n  {len(entries)} entries")
    print(f"    with a source link      {len(sourced):>4}"
          f"  ({100 * len(sourced) // max(1, len(entries))}%)")
    print(f"    with an image           "
          f"{len([e for e in entries if e.image]):>4}")
    print(f"    marked contested        {len(contested):>4}")
    print(f"    contested, unsourced    {len(unsourced_contested):>4}"
          f"   <- each of these should cite the dispute")

    fetched = citations_mod.load()
    if fetched:
        verdicts = Counter(v.get("dates_corroborated", "?") for v in fetched.values())
        print("\n  of the machine-resolved citations, does the cited article's")
        print("  own opening mention the dates this dataset claims?")
        for verdict in ("yes", "partial", "no", "not checked (deep time)"):
            if verdicts.get(verdict):
                print(f"    {verdict:<26} {verdicts[verdict]:>3}")
        unconfirmed = [k for k, v in fetched.items()
                       if v.get("dates_corroborated") == "no"]
        if unconfirmed:
            print("\n  cited but NOT corroborated by the article's opening")
            print("  (not necessarily wrong - worth a human's eye)")
            for entry_id in sorted(unconfirmed)[:12]:
                print(f"    {entry_id}")
            if len(unconfirmed) > 12:
                print(f"    ... and {len(unconfirmed) - 12} more")

    if unsourced_contested:
        print("\n  contested entries needing a citation")
        for entry in sorted(unsourced_contested, key=lambda e: e.id)[:15]:
            print(f"    {entry.id}")
        if len(unsourced_contested) > 15:
            print(f"    ... and {len(unsourced_contested) - 15} more")
    return 0


def cmd_images(_args) -> int:
    """Curated filenames first, then every article's own lead image.

    The hand-written mapping wins where it exists, because a chosen image is
    usually a better lead than whatever the article happens to open with.
    """
    print("resolving lead images from Wikipedia articles")
    discovered = images_mod.lead_image_titles(citations_mod.ARTICLES)

    mapping = {**discovered, **images_mod.COMMONS_FILES}
    print(f"\n{len(mapping)} files to look up on Commons "
          f"({len(images_mod.COMMONS_FILES)} curated, "
          f"{len(set(discovered) - set(images_mod.COMMONS_FILES))} discovered)\n")

    resolved = images_mod.fetch_all(mapping)
    images_mod.write(resolved)
    print(f"\nwrote {len(resolved)} images to {images_mod.OUTPUT}")
    return 0


def cmd_cite(_args) -> int:
    taxonomy = load_taxonomy()
    entries = load_entries(curated_paths(), taxonomy)
    resolved = citations_mod.fetch_all({e.id: e for e in entries})
    citations_mod.write(resolved)

    verdicts = Counter(v["dates_corroborated"] for v in resolved.values())
    print(f"\nresolved {len(resolved)} citations -> {citations_mod.OUTPUT}")
    for verdict, count in sorted(verdicts.items()):
        print(f"  dates corroborated: {verdict:<26} {count}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="emit site/data from data/ sources")
    sub.add_parser("validate", help="check sources without emitting")
    sub.add_parser("stats", help="coverage report")
    sub.add_parser("audit", help="report sourcing and evidence gaps")
    sub.add_parser("images", help="fetch Commons images for the curated mapping")
    sub.add_parser("cite", help="resolve citations for entries that lack one")

    args = parser.parse_args(argv)
    return {
        "build": cmd_build,
        "validate": cmd_validate,
        "stats": cmd_stats,
        "audit": cmd_audit,
        "images": cmd_images,
        "cite": cmd_cite,
    }[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
