"""Write the JSON bundles the browser reads.

Two shapes, for two different access patterns:

``spine.json``
    Every entry's interval, in one compact array-of-arrays. The client answers
    search, year-slice and visible-window culling from this alone, with no
    further fetch, so it has to be complete - and therefore has to be small.

``eras/<bucket>.json``
    The prose: summaries, notes, sources, related links. Fetched lazily. Bucketed
    by era rather than hashed because reads are temporally local - a year slice or
    a zoomed window touches a handful of adjacent eras, not every shard.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
from dataclasses import dataclass

from pipeline.loader import Entry, Taxonomy

SPINE_FIELDS = (
    "id", "title", "kind", "lane", "region", "alias",
    "sMin", "sMax", "eMin", "eMax",
    "imp", "bucket", "flags",
)

FLAG_UNCERTAIN_START = 1
FLAG_UNCERTAIN_END = 2
FLAG_ONGOING = 4
FLAG_CONTESTED = 8
FLAG_IMPORTED = 16


@dataclass(frozen=True)
class EraBucket:
    id: str
    start: int   # inclusive
    end: int     # inclusive


def _build_buckets() -> tuple[EraBucket, ...]:
    """Fixed geological buckets, then 500-year blocks, then centuries.

    Resolution follows entry density rather than elapsed time: the Mesozoic is
    one bucket because few entries fall in it, while 1500 CE onward gets a
    bucket per century.
    """
    buckets = [
        EraBucket("pre-cambrian", -4_600_000_000, -541_000_001),
        EraBucket("paleozoic", -541_000_000, -252_000_001),
        EraBucket("mesozoic", -252_000_000, -66_000_001),
        EraBucket("cenozoic-early", -66_000_000, -2_580_001),
        EraBucket("pleistocene", -2_580_000, -11_701),
        EraBucket("holocene-early", -11_700, -3_001),
    ]
    for start in range(-3_000, 0, 500):
        end = start + 499
        buckets.append(EraBucket(f"bce-{abs(start)}-{abs(end)}", start, end))
    for start in (1, 501, 1_001):
        end = 1_499 if start == 1_001 else start + 499
        buckets.append(EraBucket(f"ce-{start:04d}-{end:04d}", start, end))
    # Extend the century ladder past the present so a "ongoing" entry, whose end
    # bound tracks the current year, always has a bucket of its own.
    last_century = (_dt.date.today().year // 100 + 1) * 100
    for start in range(1_500, last_century, 100):
        buckets.append(EraBucket(f"{start}-{start + 99}", start, start + 99))
    return tuple(buckets)


BUCKETS = _build_buckets()


def bucket_for(year: int) -> str:
    """The era bucket an entry starting in ``year`` is filed under."""
    for bucket in BUCKETS:
        if bucket.start <= year <= bucket.end:
            return bucket.id
    # Clamp rather than fail: a year outside the table still needs a home.
    return BUCKETS[0].id if year < BUCKETS[0].start else BUCKETS[-1].id


def _flags(entry: Entry) -> int:
    flags = 0
    if not entry.start.is_precise:
        flags |= FLAG_UNCERTAIN_START
    if not entry.end.is_precise:
        flags |= FLAG_UNCERTAIN_END
    if entry.ongoing:
        flags |= FLAG_ONGOING
    if entry.confidence == "contested":
        flags |= FLAG_CONTESTED
    if entry.origin != "curated":
        flags |= FLAG_IMPORTED
    return flags


def _spine_row(entry: Entry, taxonomy: Taxonomy, bucket: str) -> list:
    # The primary region is the most specific one the author gave; `lane` is
    # what it rolls up to. Both are needed: lanes group the default view, and
    # sub-regions are what a zoomed-in view expands a lane into.
    region = entry.regions[0]
    return [
        entry.id,
        entry.title,
        entry.kind,
        taxonomy.lane_for(region) or "global",
        region,
        # Aliases ride in the spine because search has to match them and the
        # spine is the only thing guaranteed to be loaded. Pipe-separated
        # rather than nested, to keep the row a flat array.
        "|".join(entry.aliases),
        entry.start.min, entry.start.max,
        entry.end.min, entry.end.max,
        entry.importance,
        bucket,
        _flags(entry),
    ]


def _detail(entry: Entry) -> dict:
    """Everything the spine deliberately leaves out."""
    detail = {
        "display": entry.display_range,
        "summary": entry.summary,
        "regions": list(entry.regions),
    }
    if entry.significance:
        detail["significance"] = entry.significance
    if entry.note:
        detail["note"] = entry.note
    if entry.categories:
        detail["categories"] = list(entry.categories)
    if entry.aliases:
        detail["aliases"] = list(entry.aliases)
    if entry.related:
        detail["related"] = list(entry.related)
    if entry.texts:
        detail["texts"] = [{"title": t.title, "url": t.url} for t in entry.texts]
    if entry.sources:
        detail["sources"] = [{"title": s.title, "url": s.url} for s in entry.sources]
    if entry.wikidata:
        detail["wikidata"] = entry.wikidata
    if entry.confidence != "high":
        detail["confidence"] = entry.confidence
    return detail


def _write_json(path: str, payload: object) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"),
                  sort_keys=False)
        handle.write("\n")


def write_bundles(
    entries: list[Entry],
    taxonomy: Taxonomy,
    out_dir: str = "site/data",
) -> dict:
    """Write meta, spine and era bundles. Returns the meta payload."""
    entries = sorted(entries, key=lambda e: (e.start.min, e.id))

    buckets = {e.id: bucket_for(e.start.min) for e in entries}
    rows = [_spine_row(e, taxonomy, buckets[e.id]) for e in entries]

    by_bucket: dict[str, dict] = {}
    for entry in entries:
        by_bucket.setdefault(buckets[entry.id], {})[entry.id] = _detail(entry)

    meta = {
        "generated": _dt.datetime.now(_dt.timezone.utc).replace(
            microsecond=0).isoformat().replace("+00:00", "Z"),
        "counts": {
            "entries": len(entries),
            "curated": sum(1 for e in entries if e.origin == "curated"),
            "imported": sum(1 for e in entries if e.origin != "curated"),
        },
        "yearRange": [
            min(e.start.min for e in entries),
            max(e.end.max for e in entries),
        ] if entries else [0, 0],
        "lanes": [
            {
                "id": lane.id,
                "label": lane.label,
                "order": lane.order,
                "color": lane.color,
                "subRegions": [sub_id for sub_id, _ in lane.sub_regions],
                "subRegionLabels": {sub_id: label for sub_id, label in lane.sub_regions},
            }
            for lane in taxonomy.lanes
        ],
        "kinds": [{"id": k, "label": v} for k, v in taxonomy.kinds.items()],
        "categories": [{"id": k, "label": v} for k, v in taxonomy.categories.items()],
        "eraBuckets": [
            {
                "id": bucket.id,
                "from": bucket.start,
                "to": bucket.end,
                "count": len(by_bucket[bucket.id]),
            }
            for bucket in BUCKETS
            if bucket.id in by_bucket
        ],
    }

    _write_json(os.path.join(out_dir, "meta.json"), meta)
    _write_json(os.path.join(out_dir, "spine.json"),
                {"fields": list(SPINE_FIELDS), "rows": rows})
    for bucket_id, bundle in by_bucket.items():
        _write_json(os.path.join(out_dir, "eras", f"{bucket_id}.json"),
                    {"bucket": bucket_id, "entries": bundle})
    return meta
