"""Resolve entries to Wikidata items, and pull what Wikidata knows about them.

Runs on demand, never at page load. Output is committed to
`data/imported/wikidata.yaml` and merged at build time, so the deployed site
makes no request to Wikidata - or anywhere else - for its data.

Matching is the dangerous part: attaching the wrong item would silently import
another Ashoka's dates. So an item is only accepted when the article title it
came from matches the entry's own title, or when the mapping was curated by
hand. Everything else is reported and skipped.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Iterable

import requests
import yaml

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
USER_AGENT = (
    "chronological-history/0.1 "
    "(https://github.com/shivam1410/chronological-history)"
)
OUTPUT = "data/imported/wikidata.yaml"

#: wbgetentities accepts fifty ids per request.
BATCH = 50

# Properties worth importing. Curated data always wins over all of them.
P_IMAGE = "P18"
P_BIRTH = "P569"
P_DEATH = "P570"
P_START = "P580"
P_END = "P582"
P_POINT = "P585"


def normalise(text: str) -> str:
    """Fold case, accents and punctuation so titles can be compared safely."""
    stripped = unicodedata.normalize("NFD", str(text or ""))
    stripped = "".join(c for c in stripped if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def titles_match(ours: str, theirs: str) -> bool:
    """Is a Wikipedia article plausibly about the same thing as our entry?

    Deliberately strict: titles must be equal once case, accents, punctuation
    and a leading article are removed.

    There is no string rule that tells "Euclid" / "Euclid of Alexandria" apart
    from "Homer" / "Homer Simpson", so prefix matching is not attempted at all.
    That rejects some genuine matches, which is the right way to be wrong here -
    a false positive imports another entity's dates under our label, while a
    false negative just means a curated mapping is needed.
    """
    a, b = normalise(ours), normalise(theirs)
    if not a or not b:
        return False

    drop_article = lambda words: [w for w in words if w not in {"the", "a"}]
    return drop_article(a.split()) == drop_article(b.split())


def parse_pageprops(payload: dict) -> dict | None:
    """Pull the canonical title and Wikidata id out of a Wikipedia response."""
    pages = (payload.get("query") or {}).get("pages") or {}
    if not pages:
        return None
    page = next(iter(pages.values()))
    if "missing" in page:
        return None
    qid = (page.get("pageprops") or {}).get("wikibase_item")
    if not qid:
        return None
    return {"title": page.get("title", ""), "qid": qid}


def resolve_qids(
    wanted: dict[str, str],
    curated: Iterable[str] = (),
    session: requests.Session | None = None,
    pause: float = 0.2,
) -> tuple[dict[str, dict], list[str]]:
    """Map entry id -> {qid, title} for the entries we can match confidently.

    `wanted` maps entry id to the article title to try. Ids listed in `curated`
    skip the title check, because a human already chose that article.
    """
    client = session or requests.Session()
    resolved: dict[str, dict] = {}
    rejected: list[str] = []
    curated = set(curated)

    for entry_id, (our_title, article) in sorted(wanted.items()):
        try:
            response = client.get(
                WIKIPEDIA_API,
                params={
                    "action": "query", "prop": "pageprops", "ppprop": "wikibase_item",
                    "redirects": 1, "titles": article, "format": "json",
                },
                headers={"User-Agent": USER_AGENT}, timeout=30,
            )
            response.raise_for_status()
            found = parse_pageprops(response.json())
        except requests.RequestException as exc:
            print(f"  {entry_id:<28} lookup failed ({exc})")
            continue

        if not found:
            rejected.append(f"{entry_id}: no Wikidata item for {article!r}")
            continue
        if entry_id not in curated and not titles_match(our_title, found["title"]):
            rejected.append(
                f"{entry_id}: {found['title']!r} does not match {our_title!r}")
            continue

        resolved[entry_id] = found
        time.sleep(pause)

    return resolved, rejected


def _time_claim(entity: dict, prop: str) -> str | None:
    """The year from a time-valued claim, as a signed string."""
    claims = (entity.get("claims") or {}).get(prop) or []
    for claim in claims:
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, dict) and value.get("time"):
            match = re.match(r"([+-])(\d{4,})-", value["time"])
            if match:
                sign, digits = match.groups()
                year = int(digits)
                if year == 0:
                    continue
                return str(-year if sign == "-" else year)
    return None


def parse_entities(payload: dict) -> dict[str, dict]:
    """Reduce a wbgetentities response to the facts worth importing."""
    out: dict[str, dict] = {}
    for qid, entity in (payload.get("entities") or {}).items():
        if entity.get("missing") is not None:
            continue
        label = ((entity.get("labels") or {}).get("en") or {}).get("value", "")
        claims = entity.get("claims") or {}
        image = None
        for claim in claims.get(P_IMAGE, []):
            value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
            if isinstance(value, str) and value:
                image = f"File:{value}"
                break

        record = {"label": label}
        if image:
            record["image_file"] = image
        for name, prop in (("birth", P_BIRTH), ("death", P_DEATH),
                           ("start", P_START), ("end", P_END), ("point", P_POINT)):
            year = _time_claim(entity, prop)
            if year:
                record[name] = year
        out[qid] = record
    return out


def fetch_entities(
    qids: list[str],
    session: requests.Session | None = None,
    pause: float = 0.3,
) -> dict[str, dict]:
    client = session or requests.Session()
    facts: dict[str, dict] = {}

    for i in range(0, len(qids), BATCH):
        chunk = qids[i:i + BATCH]
        try:
            response = client.get(
                WIKIDATA_API,
                params={
                    "action": "wbgetentities", "ids": "|".join(chunk),
                    "props": "labels|claims", "languages": "en", "format": "json",
                },
                headers={"User-Agent": USER_AGENT}, timeout=60,
            )
            response.raise_for_status()
            facts.update(parse_entities(response.json()))
        except requests.RequestException as exc:
            print(f"  batch {i // BATCH + 1} failed ({exc})")
        time.sleep(pause)

    return facts


def write(resolved: dict, path: str = OUTPUT) -> None:
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(resolved, handle, sort_keys=True, allow_unicode=True,
                       default_flow_style=False)


def load(path: str = OUTPUT) -> dict:
    try:
        with open(path, encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return {}
