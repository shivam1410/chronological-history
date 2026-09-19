"""Resolve citations for entries, and check what the cited page actually says.

The dataset was written from a model's knowledge rather than researched, so an
invented citation would be worse than none at all - it would look verified.
Nothing here is asserted: each article is fetched, redirects are followed to
the canonical title, and the entry's own dates are looked for in the article's
opening section.

Entries whose dates the article does NOT mention are reported rather than
hidden, because those are exactly the ones worth a human's attention.

These are tertiary sources. They point a reader at where a dispute is
documented; they are not evidence that the bracket in this dataset is right.
"""

from __future__ import annotations

import re
import time
from typing import Iterable

import requests
import yaml

API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = (
    "chronological-history/0.1 "
    "(https://github.com/shivam1410/chronological-history)"
)
OUTPUT = "data/imported/citations.yaml"

#: Years outside this range are deep time; an article will not print them as
#: a bare number, so corroboration is recorded as unchecked rather than failed.
RECORDED_HISTORY = 4000

# entry id -> Wikipedia article title. Curated: the article has to be about the
# entry's subject, and the one that documents the dispute.
ARTICLES: dict[str, str] = {
    "adi-shankara": "Adi Shankara",
    "al-farabi": "Al-Farabi",
    "algerian-war": "Algerian War",
    "an-lushan-rebellion": "An Lushan rebellion",
    "analects": "Analects",
    "australian-frontier-wars": "Australian frontier wars",
    "avesta-written": "Avesta",
    "bangladesh-independence": "Bangladesh Liberation War",
    "behavioural-modernity": "Behavioral modernity",
    "bijak-kabir": "Kabir",
    "cocoliztli-epidemics": "Cocoliztli epidemics",
    "congo-free-state": "Congo Free State",
    "control-of-fire": "Control of fire by early humans",
    "daodejing": "Tao Te Ching",
    "denisovans": "Denisovan",
    "dog-domestication": "Domestication of the dog",
    "euclid": "Euclid",
    "eukaryotes": "Eukaryote",
    "genghis-khan": "Genghis Khan",
    "ghana-empire": "Ghana Empire",
    "gospels": "Gospel",
    "great-leap-forward": "Great Leap Forward",
    "hephthalites": "Hephthalites",
    "heraclitus": "Heraclitus",
    "homer": "Homer",
    "homeric-epics-written": "Homeric Question",
    "homo-habilis": "Homo habilis",
    "homo-heidelbergensis": "Homo heidelbergensis",
    "homo-naledi": "Homo naledi",
    "horse-domestication": "Domestication of the horse",
    "human-chimp-split": "Chimpanzee–human last common ancestor",
    "indian-ocean-slave-trade": "Indian Ocean slave trade",
    "iroquois-confederacy": "Iroquois",
    "jain-agamas": "Jain literature",
    "jesus": "Jesus",
    "kautilya": "Chanakya",
    "laozi": "Laozi",
    "madhvacharya": "Madhvacharya",
    "mahabharata": "Mahabharata",
    "mahavira": "Mahavira",
    "maya-collapse": "Classic Maya collapse",
    "mirabai": "Mirabai",
    "nagarjuna": "Nagarjuna",
    "origin-of-life": "Abiogenesis",
    "peopling-of-americas": "Settlement of the Americas",
    "pythagoras": "Pythagoras",
    "rapa-nui-decline": "Easter Island",
    "sahelanthropus": "Sahelanthropus",
    "second-sino-japanese-war": "Second Sino-Japanese War",
    "settlement-of-hawaii": "Ancient Hawaii",
    "settlement-of-rapa-nui": "Easter Island",
    "stone-tools": "Stone tool",
    "sushruta": "Sushruta",
    "taiping-rebellion": "Taiping Rebellion",
    "thales": "Thales of Miletus",
    "trans-saharan-trade": "Trans-Saharan slave trade",
    "upanishads": "Upanishads",
    "variolation": "Inoculation",
    "zero-decimal-system": "0",
    "zoroaster": "Zoroaster",
}


def fetch_article(title: str, session: requests.Session | None = None) -> dict | None:
    """Fetch one article's canonical url and opening section."""
    client = session or requests.Session()
    response = client.get(
        API,
        params={
            "action": "query",
            "prop": "extracts|info",
            "inprop": "url",
            "exintro": 1,
            "explaintext": 1,
            "redirects": 1,
            "titles": title,
            "format": "json",
        },
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return parse_response(response.json())


def parse_response(payload: dict) -> dict | None:
    pages = (payload.get("query") or {}).get("pages") or {}
    if not pages:
        return None
    page = next(iter(pages.values()))
    if "missing" in page:
        return None
    url = page.get("fullurl") or ""
    if not url.startswith("https://"):
        return None
    return {
        "title": page.get("title", ""),
        "url": url,
        "extract": page.get("extract", "") or "",
    }


def years_in(text: str) -> set[int]:
    return {int(y) for y in re.findall(r"\b(\d{3,4})\b", text)}


def corroboration(bounds: Iterable[int], extract: str) -> str | None:
    """Does the article's own opening mention the years this entry claims?

    Returns "yes", "partial", "no", or None when the dates are deep time and a
    bare-number search cannot answer the question.
    """
    wanted = {abs(b) for b in bounds if abs(b) <= RECORDED_HISTORY}
    if not wanted:
        return None
    found = years_in(extract)
    hits = len(wanted & found)
    if hits == 0:
        return "no"
    return "yes" if hits == len(wanted) else "partial"


def fetch_all(entries_by_id: dict, mapping: dict[str, str] | None = None,
              pause: float = 0.3) -> dict[str, dict]:
    mapping = ARTICLES if mapping is None else mapping
    session = requests.Session()
    resolved: dict[str, dict] = {}

    for entry_id, title in sorted(mapping.items()):
        entry = entries_by_id.get(entry_id)
        if entry is None:
            print(f"  {entry_id:<28} no such entry, skipped")
            continue
        try:
            article = fetch_article(title, session)
        except requests.RequestException as exc:
            print(f"  {entry_id:<28} request failed ({exc})")
            continue
        if not article:
            print(f"  {entry_id:<28} article not found: {title}")
            continue

        bounds = [entry.start.min, entry.start.max, entry.end.min, entry.end.max]
        verdict = corroboration(bounds, article["extract"])
        resolved[entry_id] = {
            "title": f"Wikipedia — {article['title']}",
            "url": article["url"],
            "dates_corroborated": verdict or "not checked (deep time)",
        }
        print(f"  {entry_id:<28} {verdict or 'deep time':<10} {article['title'][:34]}")
        time.sleep(pause)

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
