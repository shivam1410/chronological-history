"""Read YAML sources into :class:`~pipeline.model.Entry` objects.

The loader is deliberately strict: an unknown field or a missing required one
is an error naming the file and the entry, because a typo that is silently
ignored produces a timeline that is quietly wrong rather than obviously broken.
"""

from __future__ import annotations

import glob
from dataclasses import dataclass

import yaml

from pipeline.model import Bound, Entry, Source, is_ongoing, parse_bound

REQUIRED_FIELDS = {"id", "title", "kind", "regions", "start", "end", "importance", "summary"}
OPTIONAL_FIELDS = {
    "categories", "aliases", "significance", "note", "related",
    "sources", "wikidata", "confidence", "origin",
}
KNOWN_FIELDS = REQUIRED_FIELDS | OPTIONAL_FIELDS


@dataclass(frozen=True)
class Lane:
    id: str
    label: str
    order: int
    color: str
    sub_regions: tuple[tuple[str, str], ...] = ()
    note: str | None = None


@dataclass(frozen=True)
class Taxonomy:
    lanes: tuple[Lane, ...]
    kinds: dict[str, str]
    categories: dict[str, str]
    _region_to_lane: dict[str, str]

    def lane_for(self, region: str) -> str | None:
        """Map any region id - lane or sub-region - to its lane id."""
        return self._region_to_lane.get(region)

    @property
    def regions(self) -> set[str]:
        return set(self._region_to_lane)


def _read_yaml(path: str) -> list:
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if data is None:
        return []
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a list at the top level")
    return data


def load_taxonomy(
    regions_path: str = "data/taxonomy/regions.yaml",
    kinds_path: str = "data/taxonomy/kinds.yaml",
    categories_path: str = "data/taxonomy/categories.yaml",
) -> Taxonomy:
    lanes, region_to_lane = [], {}
    for raw in sorted(_read_yaml(regions_path), key=lambda r: r["order"]):
        subs = tuple((s["id"], s["label"]) for s in raw.get("sub_regions", ()))
        lanes.append(Lane(
            id=raw["id"], label=raw["label"], order=raw["order"],
            color=raw["color"], sub_regions=subs, note=raw.get("note"),
        ))
        region_to_lane[raw["id"]] = raw["id"]
        for sub_id, _ in subs:
            region_to_lane[sub_id] = raw["id"]

    kinds = {k["id"]: k["label"] for k in _read_yaml(kinds_path)}
    categories = {c["id"]: c["label"] for c in _read_yaml(categories_path)}
    return Taxonomy(tuple(lanes), kinds, categories, region_to_lane)


def _tuple_of_str(raw: object, field: str, where: str) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError(f"{where}: '{field}' must be a list")
    return tuple(str(item) for item in raw)


def _build_entry(raw: dict, source_file: str) -> Entry:
    entry_id = raw.get("id", "<no id>")
    where = f"{source_file}: entry '{entry_id}'"

    if not isinstance(raw, dict):
        raise ValueError(f"{source_file}: expected a mapping, got {type(raw).__name__}")

    unknown = set(raw) - KNOWN_FIELDS
    if unknown:
        raise ValueError(f"{where}: unknown field {sorted(unknown)[0]!r}")

    missing = REQUIRED_FIELDS - set(raw)
    if missing:
        raise ValueError(f"{where}: missing required field {sorted(missing)[0]!r}")

    try:
        start = parse_bound(raw["start"])
        end = parse_bound(raw["end"])
    except ValueError as exc:
        raise ValueError(f"{where}: {exc}") from exc

    if start.min > end.max:
        raise ValueError(
            f"{where}: starts at {start.min} but ends at {end.max}"
        )

    sources = tuple(
        Source(title=str(s["title"]), url=str(s["url"]))
        for s in raw.get("sources") or ()
    )

    return Entry(
        id=str(raw["id"]),
        title=str(raw["title"]),
        kind=str(raw["kind"]),
        regions=_tuple_of_str(raw["regions"], "regions", where),
        start=start,
        end=end,
        importance=int(raw["importance"]),
        summary=" ".join(str(raw["summary"]).split()),
        categories=_tuple_of_str(raw.get("categories"), "categories", where),
        aliases=_tuple_of_str(raw.get("aliases"), "aliases", where),
        significance=raw.get("significance"),
        note=" ".join(str(raw["note"]).split()) if raw.get("note") else None,
        related=_tuple_of_str(raw.get("related"), "related", where),
        sources=sources,
        wikidata=raw.get("wikidata"),
        confidence=str(raw.get("confidence", "high")),
        origin=str(raw.get("origin", "curated")),
        ongoing=is_ongoing(raw["end"]),
        source_file=source_file,
    )


def load_entries(paths: list[str], taxonomy: Taxonomy) -> list[Entry]:
    """Load every entry from ``paths``, sorted by id for deterministic output."""
    entries = [
        _build_entry(raw, path)
        for path in paths
        for raw in _read_yaml(path)
    ]
    return sorted(entries, key=lambda e: e.id)


def curated_paths(pattern: str = "data/curated/**/*.yaml") -> list[str]:
    return sorted(glob.glob(pattern, recursive=True))
