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


# Curated article titles for entries whose own title is not a Wikipedia
# article. These bypass the title check, because a human chose them - which
# means a wrong mapping imports another subject's dates in silence. The date
# comparison in `make audit` is the safety net, so check it after changing this.
#
# Entries with no single fitting article are deliberately left out rather than
# forced onto an approximate one.
EXTRA_ARTICLES: dict[str, str] = {
    # Titles this dataset words its own way, pointed at the article that
    # carries the subject. Each was checked by hand; the five entries left out
    # below have no single article to point at.
    "ajanta-caves": "Ajanta Caves",
    "arpanet": "ARPANET",
    "baroque": "Baroque",
    "benin-bronzes": "Benin Bronzes",
    "chinese-landscape-painting": "Shan shui",
    "cleopatra": "Cleopatra",
    "dijkstra": "Edsger W. Dijkstra",
    "eniac": "ENIAC",
    "first-world-war": "World War I",
    "ghalib": "Ghalib",
    "hilbert-program": "Entscheidungsproblem",
    "hokusai": "Hokusai",
    "integrated-circuit": "Integrated circuit",
    "islamic-calligraphy": "Islamic calligraphy",
    "napoleon": "Napoleon",
    "persian-miniature": "Persian miniature",
    "phidias-greek-sculpture": "Ancient Greek sculpture",
    "picasso-cubism": "Pablo Picasso",
    "railways": "History of rail transport",
    "second-world-war": "World War II",
    "tansen": "Tansen",
    "telegraph": "Electrical telegraph",
    "transistor": "Transistor",
    #
    # Left out on purpose, per the note above. Each is a composite this
    # dataset assembled - a wave of independence across a continent, two
    # centuries of emissions - and no single article covers it. Pointing them
    # at an approximate one would import another subject's dates in silence:
    #   arab-independence-wave, east-africa-independence,
    #   south-asia-partition-wave, european-contact-pacific, coal-and-carbon
    #
    # deep time and evolution
    "earth-formation": "History of Earth",
    "great-oxidation": "Great Oxidation Event",
    "multicellular-life": "Multicellular organism",
    "land-plants": "Embryophyte",
    "tetrapods-on-land": "Tetrapod",
    "first-mammals": "Evolution of mammals",
    "first-birds": "Origin of birds",
    "flowering-plants": "Flowering plant",
    "primates": "Primate",
    "apes-emerge": "Ape",
    "grasslands-spread": "Grassland",
    "dinosaur-era": "Dinosaur",
    "permian-triassic-extinction": "Permian–Triassic extinction event",
    "kpg-extinction": "Cretaceous–Paleogene extinction event",
    "pleistocene": "Pleistocene",
    "holocene": "Holocene",
    "toba-eruption": "Lake Toba",
    "homo-sapiens": "Homo sapiens",
    "neanderthals": "Neanderthal",
    "neanderthal-extinction": "Neanderthal extinction",
    "out-of-africa": "Recent African origin of modern humans",
    "cave-art": "Cave painting",
    "acheulean-handaxe": "Acheulean",
    "sahul-separation": "Sahul",
    "himalayan-orogeny": "Himalayas",

    # agriculture and technology
    "neolithic-revolution": "Neolithic Revolution",
    "kuk-swamp-agriculture": "Kuk Swamp",
    "maize-domestication": "Maize",
    "potato-domestication": "Potato",
    "cuneiform": "Cuneiform",
    "printing-press": "Printing press",
    "magnetic-compass": "Compass",
    "telescope": "History of the telescope",
    "dna-structure": "Nucleic acid double helix",
    "origin-of-species": "On the Origin of Species",
    "moon-landing": "Apollo 11",
    "hangul": "Hangul",
    "maya-writing": "Maya script",
    "polynesian-navigation": "Polynesian navigation",

    # people
    "buddha": "Gautama Buddha",
    "muhammad": "Muhammad",
    "gandhi-ahimsa": "Mahatma Gandhi",
    "avicenna": "Avicenna",
    "ibn-rushd": "Averroes",
    "al-khwarizmi": "Al-Khwarizmi",
    "ptolemy": "Ptolemy",
    "timur": "Timur",
    "ulugh-beg": "Ulugh Beg",
    "mansa-musa-hajj": "Mansa Musa",

    # states and periods
    "roman-empire": "Roman Empire",
    "three-kingdoms": "Three Kingdoms",
    "warring-states": "Warring States period",
    "xiongnu": "Xiongnu",
    "scythians": "Scythians",
    "sogdian-merchants": "Sogdia",
    "gokturk-khaganate": "Turkic Khaganate",
    "silk-road": "Silk Road",
    "sack-of-baghdad": "Siege of Baghdad (1258)",
    "safavid-empire": "Safavid Iran",
    "chola-empire": "Chola dynasty",
    "joseon-dynasty": "Joseon",
    "goryeo-dynasty": "Goryeo",
    "zheng-he-voyages": "Ming treasure voyages",
    "renaissance": "Renaissance",
    "swahili-coast": "Swahili coast",
    "timbuktu": "Timbuktu",
    "ashanti-empire": "Ashanti Empire",
    "chaco-canyon": "Chaco Culture National Historical Park",
    "norte-chico": "Caral–Supe civilization",
    "olmec": "Olmecs",
    "monte-alban": "Monte Albán",
    "nazca-lines": "Nazca Lines",
    "maya-classic": "Maya civilization",
    "chimu": "Chimú culture",
    "tenochtitlan": "Tenochtitlan",
    "moai": "Moai",
    "norse-vinland": "Vinland",
    "hawaiian-kingdom": "Hawaiian Kingdom",
    "kula-ring": "Kula ring",
    "austronesian-expansion": "Austronesian peoples",
    "settlement-of-aotearoa": "Māori history",
    "aboriginal-australia": "Prehistory of Australia",
    "aral-sea": "Aral Sea",

    # events
    "columbus-1492": "Voyages of Christopher Columbus",
    "fall-of-the-inca": "Spanish conquest of the Inca Empire",
    "potosi-silver": "Potosí",
    "columbian-exchange-epidemics": "Columbian exchange",
    "transatlantic-slave-trade": "Atlantic slave trade",
    "blackbirding": "Blackbirding",
    "apartheid": "Apartheid",
    "south-africa-1994": "1994 South African general election",
    "stolen-generations": "Stolen Generations",
    "residential-schools": "Canadian Indian residential school system",
    "trail-of-tears": "Trail of Tears",
    "mabo-decision": "Mabo v Queensland (No 2)",
    "hiroshima-nagasaki": "Atomic bombings of Hiroshima and Nagasaki",
    "xinhai-revolution": "Xinhai Revolution",
    "prc-founded": "Chinese Communist Revolution",
    "reform-and-opening": "Chinese economic reform",
    "pacific-nuclear-testing": "Nuclear weapons testing",
    "pacific-sea-level": "Sea level rise",

    # independence
    "us-independence": "United States Declaration of Independence",
    "indian-independence": "Partition of India",
    "indonesia-independence": "Indonesian National Revolution",
    "vietnam-independence": "First Indochina War",
    "israel-founded": "Israeli Declaration of Independence",
    "ghana-independence": "Ghana",
    "year-of-africa": "Year of Africa",
    "african-independence-wave": "Decolonisation of Africa",
    "liberia-independence": "Liberia",
    "lusophone-independence": "Portuguese Colonial War",
    "namibia-independence": "Namibia",
    "zimbabwe-independence": "Zimbabwe",
    "south-sudan-independence": "South Sudan",
    "samoa-independence": "Samoa",
    "png-independence": "Papua New Guinea",
    "abolition-us": "Thirteenth Amendment to the United States Constitution",
    "abolition-british": "Slavery Abolition Act 1833",
    "abolition-brazil": "Lei Áurea",

    # disease
    "hiv-aids": "HIV/AIDS",
    "influenza-1918": "Spanish flu",
    "russian-flu-1889": "1889–1890 pandemic",
    "cholera-pandemics": "Cholera outbreaks and pandemics",
    "smallpox-eradication": "Smallpox",
    "polio-vaccine": "Polio vaccine",

    # texts and the record gap
    "rigveda": "Rigveda",
    "ramayana": "Ramayana",
    "ramcharitmanas": "Ramcharitmanas",
    "pali-canon-written": "Pāli Canon",
    "quran-codified": "History of the Quran",
    "hadith-collections": "Hadith",
    "adi-granth-compiled": "Adi Granth",
    "guru-granth-sahib": "Guru Granth Sahib",
    "talmud": "Talmud",
    "plato-on-socrates": "Socratic problem",
}


#: Entries whose Wikidata item is a related but different subject. The image
#: and identifier are still worth having; the dates are not comparable, so
#: excluding them keeps the audit honest instead of flagging a known mismatch
#: as if it were a discovery.
DATE_CHECK_EXCLUDED: dict[str, str] = {
    "bijak-kabir":
        "Q[Kabir] is the poet; this entry is when his collections were written "
        "down, one to two centuries after his death.",
    "mansa-musa-hajj":
        "Q[Mansa Musa] is the ruler; this entry is his 1324 pilgrimage, not his "
        "lifespan.",
    "hiv-aids":
        "Wikidata dates the earliest confirmed infection (1959); this entry is "
        "the pandemic as recognised from 1981.",
    "polynesian-navigation":
        "Wikidata dates the Austronesian expansion's origin; this entry is the "
        "era of settlement voyaging.",
    "aztec-empire":
        "Wikidata dates the Tenochtitlan dynasty from 1367; this entry is the "
        "Triple Alliance from 1428.",
}


def dates_agree(ours: tuple[int, int], theirs: Iterable[int]) -> bool:
    """Does any Wikidata date corroborate our bracket?

    Agreement means a date of theirs falls inside our bracket, or sits close
    enough to one of its edges. Containment matters most: Wikidata usually
    records a single point where this dataset records a range, so 1.0 Ma for
    the control of fire corroborates a 1.5 Ma - 400 ka bracket rather than
    contradicting it.

    Tolerance scales, because one year is right for 1526 and meaningless at
    3.9 million years, where a BP-offset date and a round figure differ by
    thousands while meaning the same thing.
    """
    low, high = min(ours), max(ours)
    for year in theirs:
        if low <= year <= high:
            return True
        edge = low if year < low else high
        scale = max(abs(year), abs(edge))
        if abs(year - edge) <= (1 if scale <= 4000 else scale * 0.01):
            return True
    return False
