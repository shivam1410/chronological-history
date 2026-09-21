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
import os
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
THUMB_WIDTH = 480

# Commons resets a connection now and then. Without retries a single reset
# drops an image the site already had, silently, on an otherwise good run.
DOWNLOAD_TRIES = 3

# entry id -> Commons file title. Curated: the picture has to actually depict
# the thing, and be a reasonable lead image rather than a detail or a diagram.
# Every filename here has been confirmed to resolve on Commons. Ones that do
# not are removed rather than left to fail on every run.
COMMONS_FILES: dict[str, str] = {
    "australopithecus": "File:Lucy Skeleton.jpg",
    "neanderthals": "File:Homo sapiens neanderthalensis.jpg",
    "cave-art": "File:Lascaux painting.jpg",
    "moai": "File:Moai Rano raraku.jpg",
    "great-zimbabwe": "File:Great-Zimbabwe-2.jpg",
    "great-pyramid": "File:Kheops-Pyramid.jpg",
    "taj-mahal": "File:Taj Mahal (Edited).jpeg",
    "angkor-wat": "File:Angkor Wat.jpg",
    "borobudur": "File:Borobudur-Nothwest-view.jpg",
    "machu-picchu": "File:Machu Picchu, Peru.jpg",
    "cahokia": "File:Monks Mound in July.JPG",
    "nazca-lines": "File:Nazca colibri.jpg",
    "oracle-bone-script": "File:Shang dynasty inscribed scapula.jpg",
    "indus-valley": "File:Mohenjo-daro.jpg",
    "rigveda": "File:Rigveda MS2097.jpg",
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


def lead_image_titles(
    articles: dict[str, str],
    session: requests.Session | None = None,
    pause: float = 0.25,
) -> dict[str, str]:
    """Ask Wikipedia for each article's lead image file name.

    Guessing Commons filenames by hand does not scale and gets them wrong;
    asking the article which image represents it does. The file still goes
    through the Commons lookup afterwards for its licence, because Wikipedia
    does not return usable terms.
    """
    client = session or requests.Session()
    found: dict[str, str] = {}

    for entry_id, article in sorted(articles.items()):
        try:
            response = client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "prop": "pageimages",
                    "piprop": "name",
                    "redirects": 1,
                    "titles": article,
                    "format": "json",
                },
                headers={"User-Agent": USER_AGENT},
                timeout=30,
            )
            response.raise_for_status()
            pages = (response.json().get("query") or {}).get("pages") or {}
        except requests.RequestException as exc:
            print(f"  {entry_id:<28} lookup failed ({exc})")
            continue

        page = next(iter(pages.values()), {})
        name = page.get("pageimage")
        if not name:
            print(f"  {entry_id:<28} no lead image on {article}")
            continue
        found[entry_id] = f"File:{name}"
        time.sleep(pause)

    return found


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


# ---------------------------------------------------------------------------
# Downloading, so the deployed site has no runtime dependency on Wikimedia
# ---------------------------------------------------------------------------

LOCAL_DIR = "site/images"
ATTRIBUTION = "site/images/CREDITS.md"

_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "image/webp": ".webp", "image/svg+xml": ".svg"}


def download_all(resolved: dict[str, dict], out_dir: str = LOCAL_DIR,
                 pause: float = 0.15) -> dict[str, dict]:
    """Fetch each image into the repo and rewrite its url to a local path.

    Hotlinking makes every visitor's browser call Wikimedia, which is both a
    runtime dependency the rest of this site does not have and a cost borne by
    someone giving bandwidth away. The remote url is kept as `source_url` so
    the origin stays traceable.
    """
    os.makedirs(out_dir, exist_ok=True)
    session = requests.Session()
    out: dict[str, dict] = {}

    for entry_id, record in sorted(resolved.items()):
        response = None
        for attempt in range(DOWNLOAD_TRIES):
            try:
                response = session.get(record["url"],
                                       headers={"User-Agent": USER_AGENT},
                                       timeout=60)
                response.raise_for_status()
                break
            except requests.RequestException as exc:
                response = None
                if attempt + 1 < DOWNLOAD_TRIES:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                print(f"  {entry_id:<26} download failed ({exc})")

        if response is None:
            # A reset connection should not cost an image the site already
            # has. The licence and credit came from the resolve step, which
            # succeeded, so a copy already on disk is still publishable.
            kept = _existing_local(entry_id, out_dir)
            if kept:
                print(f"  {entry_id:<26} kept the copy already on disk")
                out[entry_id] = {**record, "url": f"images/{kept}",
                                 "source_url": record["url"],
                                 "bytes": os.path.getsize(
                                     os.path.join(out_dir, kept))}
            continue

        suffix = _EXT.get(response.headers.get("content-type", "").split(";")[0])
        if not suffix:
            print(f"  {entry_id:<26} unsupported type "
                  f"{response.headers.get('content-type')!r}")
            continue

        name = f"{entry_id}{suffix}"
        with open(os.path.join(out_dir, name), "wb") as handle:
            handle.write(response.content)

        out[entry_id] = {**record,
                         "url": f"images/{name}",
                         "source_url": record["url"],
                         "bytes": len(response.content)}
        time.sleep(pause)

    return out


def write_attribution(resolved: dict[str, dict], path: str = ATTRIBUTION) -> None:
    """A single file listing every image, its author and its licence.

    CC BY-SA requires attribution to travel with the work. The panel shows it
    per image; this is the same information in one place, for the repo.
    """
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = [
        "# Image credits",
        "",
        "Every image here comes from Wikimedia Commons and is reproduced under",
        "the licence named beside it. Credit is shown in the site's detail panel",
        "as well as here, because most of these licences require it.",
        "",
        "| Entry | Author | Licence | Source |",
        "|---|---|---|---|",
    ]
    for entry_id, record in sorted(resolved.items()):
        credit = (record.get("credit") or "Unknown").replace("|", "/")
        lines.append(
            f"| `{entry_id}` | {credit} | {record['license']} "
            f"| [Commons]({record['source']}) |")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")

# Entries whose article carries a usable lead image even though Wikidata has
# no P18 for the item. Asking the article beats guessing a Commons filename:
# a guess that is wrong silently picks another subject's picture, while an
# article that does not exist simply logs a miss and is skipped.
#
# Six entries are deliberately absent. African, Arab, East African and South
# Asian independence, European contact in the Pacific, and fossil carbon in
# the atmosphere are composites this dataset assembled, and no single article
# represents them - the same reason they carry no Wikidata item.
ARTICLE_LEADS: dict[str, str] = {
    # deep time and prehistory
    "great-oxidation": "Great Oxidation Event",
    "cambrian-explosion": "Cambrian explosion",
    "permian-triassic-extinction": "Permian\u2013Triassic extinction event",
    "human-chimp-split": "Chimpanzee\u2013human last common ancestor",
    "neanderthal-extinction": "Neanderthal extinction",
    "last-glacial-maximum": "Last Glacial Maximum",
    "jomon-period": "J\u014dmon period",

    # south and southeast asia
    "gupta-empire": "Gupta Empire",
    "kushan-empire": "Kushan Empire",
    "delhi-sultanate": "Delhi Sultanate",
    "vijayanagara-empire": "Vijayanagara Empire",
    "bhaskara-ii": "Bh\u0101skara II",
    "bhavabhuti": "Bhavabhuti",
    "ramcharitmanas": "Ramcharitmanas",
    "khmer-empire": "Khmer Empire",
    "srivijaya": "Srivijaya",
    "majapahit": "Majapahit",
    "ayutthaya": "Ayutthaya Kingdom",

    # east asia
    "shang-dynasty": "Shang dynasty",
    "sui-dynasty": "Sui dynasty",
    "qing-dynasty": "Qing dynasty",
    "grand-canal": "Grand Canal (China)",
    "movable-type": "Movable type",
    "sengoku-period": "Sengoku period",
    "reform-and-opening": "Chinese economic reform",

    # central and west asia
    "achaemenid-empire": "Achaemenid Empire",
    "gokturk-khaganate": "Turkic Khaganate",
    "uyghur-khaganate": "Uyghur Khaganate",
    "karakhanid-khanate": "Kara-Khanid Khanate",
    "samanid-empire": "Samanid Empire",
    "seljuk-empire": "Seljuk Empire",
    "khwarazmian-empire": "Khwarazmian Empire",
    "chagatai-khanate": "Chagatai Khanate",
    "timurid-empire": "Timurid Empire",
    "mongol-empire": "Mongol Empire",
    "safavid-empire": "Safavid Iran",
    "quran-codified": "History of the Quran",

    # africa
    "egypt-old-kingdom": "Old Kingdom of Egypt",
    "kanem-bornu": "Kanem\u2013Bornu Empire",
    "songhai-empire": "Songhai Empire",
    "ethiopian-empire": "Ethiopian Empire",
    "indian-ocean-slave-trade": "Indian Ocean slave trade",
    "south-africa-1994": "1994 South African general election",

    # the americas
    "olmec": "Olmecs",
    "moche": "Moche culture",
    "wari": "Wari Empire",
    "aztec-empire": "Aztec Empire",
    "columbus-1492": "Voyages of Christopher Columbus",
    "latin-american-independence": "Spanish American wars of independence",
    "abolition-us": "Thirteenth Amendment to the United States Constitution",
    "trail-of-tears": "Trail of Tears",
    "residential-schools": "Canadian Indian residential school system",

    # oceania
    "aboriginal-australia": "Aboriginal Australians",
    "polynesian-navigation": "Polynesian navigation",
    "settlement-of-aotearoa": "M\u0101ori people",
    "tui-tonga-empire": "Tu\u02bbi Tonga Empire",
    "hawaiian-kingdom": "Hawaiian Kingdom",
    "kula-ring": "Kula ring",
    "mabo-decision": "Mabo v Queensland (No 2)",
    "stolen-generations": "Stolen Generations",

    # europe
    "antonine-plague": "Antonine Plague",
    "plague-of-justinian": "Plague of Justinian",
    "plato-on-socrates": "Socratic problem",
    "irish-independence": "Irish War of Independence",

    # science, industry and art
    "germ-theory": "Germ theory of disease",
    "telescope": "History of the telescope",
    "human-genome": "Human Genome Project",
    "hilbert-program": "Entscheidungsproblem",
    "telegraph": "Electrical telegraph",
    "railways": "History of rail transport",
    "cinema": "History of film",
}


def _existing_local(entry_id: str, out_dir: str) -> str | None:
    """A previously downloaded file for this entry, whatever its extension."""
    for suffix in sorted(set(_EXT.values())):
        name = f"{entry_id}{suffix}"
        if os.path.exists(os.path.join(out_dir, name)):
            return name
    return None
