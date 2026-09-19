"""Resolve Wikimedia Commons images, with the licence terms needed to show them.

Which image suits an entry is an editorial judgement, so the mapping from entry
id to Commons file lives in `COMMONS_FILES` and is curated by hand. What that
file's licence and attribution actually are is a matter of fact, so it is
fetched from the Commons API rather than assumed - an image whose terms we
guessed at is one we would be publishing unlawfully.

Output goes to `data/imported/images.yaml`, which is committed, so the site
never needs network access to build.
"""

from __future__ import annotations

import html
import re
import time
from typing import Iterable

import requests
import yaml

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = (
    "chronological-history/0.1 "
    "(https://github.com/shivam1410/chronological-history)"
)
OUTPUT = "data/imported/images.yaml"

# Ask Commons for a scaled copy rather than the original. The panel shows the
# picture about 350px wide, and pulling multi-megabyte originals for that is
# both slow and discourteous to a service that gives its bandwidth away.
THUMB_WIDTH = 720

# entry id -> Commons file title. Curated: the picture has to actually depict
# the thing, and be a reasonable lead image rather than a detail or a diagram.
COMMONS_FILES: dict[str, str] = {
    "australopithecus": "File:Lucy Skeleton.jpg",
    "neanderthals": "File:Homo sapiens neanderthalensis.jpg",
    "cave-art": "File:Lascaux painting.jpg",
    "moai": "File:Moai Rano raraku.jpg",
    "great-zimbabwe": "File:Great-Zimbabwe-2.jpg",
    "timbuktu": "File:Djinguereber 2.jpg",
    "benin-kingdom": "File:Benin Brass Plaque 03.jpg",
    "great-pyramid": "File:Kheops-Pyramid.jpg",
    "taj-mahal": "File:Taj Mahal (Edited).jpeg",
    "angkor-wat": "File:Angkor Wat.jpg",
    "borobudur": "File:Borobudur-Nothwest-view.jpg",
    "machu-picchu": "File:Machu Picchu, Peru.jpg",
    "teotihuacan": "File:Piramide del sol.jpg",
    "cahokia": "File:Monks Mound in July.JPG",
    "chaco-canyon": "File:Pueblo Bonito Aerial 1929.jpg",
    "nazca-lines": "File:Nazca colibri.jpg",
    "oracle-bone-script": "File:Shang dynasty inscribed scapula.jpg",
    "indus-valley": "File:Mohenjo-daro.jpg",
    "rigveda": "File:Rigveda MS2097.jpg",
    "mughal-empire": "File:Akbarnama 1590s.jpg",
    "moon-landing": "File:Aldrin Apollo 11 original.jpg",
    "dna-structure": "File:DNA Structure+Key+Labelled.pn NoBB.png",
    "marie-curie": "File:Marie Curie c1920.jpg",
    "einstein": "File:Albert Einstein Head.jpg",
    "newton": "File:Portrait of Sir Isaac Newton, 1689.jpg",
    "galileo": "File:Justus Sustermans - Portrait of Galileo Galilei, 1636.jpg",
    "turing": "File:Alan Turing Aged 16.jpg",
    "mandela": "File:Nelson Mandela 1994.jpg",
    "gandhi-ahimsa": "File:Portrait Gandhi.jpg",
    "ambedkar": "File:Dr. Bhimrao Ambedkar.jpg",
    "aristotle": "File:Aristotle Altemps Inv8575.jpg",
    "socrates": "File:Socrates Louvre.jpg",
    "confucius": "File:Confucius Tang Dynasty.jpg",
    "genghis-khan": "File:YuanEmperorAlbumGenghisPortrait.jpg",
    "ulugh-beg": "File:Ulugh Beg Observatory sextant.jpg",
}

_TAG = re.compile(r"<[^>]+>")


def _plain(markup: str | None) -> str:
    """Commons returns attribution as HTML; reduce it to a readable name."""
    if not markup:
        return ""
    return " ".join(html.unescape(_TAG.sub("", markup)).split())


def fetch_image(title: str, session: requests.Session | None = None) -> dict | None:
    """Look up one Commons file. Returns None when it does not exist."""
    client = session or requests.Session()
    response = client.get(
        API,
        params={
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": THUMB_WIDTH,
            "format": "json",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return parse_response(response.json())


def parse_response(payload: dict) -> dict | None:
    """Pull url, licence and attribution out of an API response."""
    pages = (payload.get("query") or {}).get("pages") or {}
    if not pages:
        return None
    page = next(iter(pages.values()))
    if "missing" in page or not page.get("imageinfo"):
        return None

    info = page["imageinfo"][0]
    meta = info.get("extmetadata") or {}
    licence = _plain((meta.get("LicenseShortName") or {}).get("value"))
    if not licence:
        # No stated licence means no permission to display it.
        return None

    # Prefer the scaled copy; fall back to the original when Commons cannot
    # scale it (SVG and some formats come back without a thumburl).
    url = (info.get("thumburl") or info.get("url") or "").split("?")[0]
    if not url.startswith("https://"):
        return None

    return {
        "url": url,
        "license": licence,
        "source": info.get("descriptionurl") or page.get("title", ""),
        "credit": _plain((meta.get("Artist") or {}).get("value")),
    }


def fetch_all(
    mapping: dict[str, str] | None = None,
    pause: float = 0.4,
    log: Iterable | None = None,
) -> dict[str, dict]:
    """Resolve every mapped file, skipping the ones that cannot be resolved."""
    mapping = COMMONS_FILES if mapping is None else mapping
    session = requests.Session()
    resolved: dict[str, dict] = {}

    for entry_id, title in sorted(mapping.items()):
        try:
            found = fetch_image(title, session)
        except requests.RequestException as exc:
            print(f"  {entry_id:<24} request failed ({exc})")
            continue
        if not found:
            print(f"  {entry_id:<24} not found: {title}")
            continue
        resolved[entry_id] = found
        print(f"  {entry_id:<24} {found['license']}")
        time.sleep(pause)  # Commons asks for modest request rates

    return resolved


def write(resolved: dict[str, dict], path: str = OUTPUT) -> None:
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        yaml.safe_dump(resolved, handle, sort_keys=True, allow_unicode=True,
                       default_flow_style=False)


def load(path: str = OUTPUT) -> dict[str, dict]:
    try:
        with open(path, encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return {}
