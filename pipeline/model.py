"""Core data model: year numbering, fuzzy date bounds, and the Entry record.

Year numbering is the single most error-prone part of this codebase, so it gets
exactly one conversion boundary:

    historical numbering    -1 is 1 BCE, 1 is 1 CE, there is NO year 0
    astronomical numbering  0 is 1 BCE, 1 is 1 CE, arithmetic just works

Source files and display strings use historical numbering. Every calculation
(durations, ages, interval overlap) goes through ``astro`` first. Nothing else in
the pipeline is allowed to do year arithmetic directly.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field

# Geological "before present" is conventionally measured from 1950 CE.
BP_EPOCH = 1950

PRESENT = _dt.date.today().year

EN_DASH = "–"

_DEEP_UNITS = {"ka": 1_000, "Ma": 1_000_000, "Ga": 1_000_000_000}
_DEEP_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(ka|Ma|Ga)$")
_INT_RE = re.compile(r"^-?\d+$")


# --------------------------------------------------------------------------
# year numbering
# --------------------------------------------------------------------------

def astro(year: int) -> int:
    """Historical year -> astronomical year. Raises on the non-existent year 0."""
    if year == 0:
        raise ValueError("there is no year zero in historical numbering; use -1 or 1")
    return year + 1 if year < 0 else year


def historical(astro_year: int) -> int:
    """Astronomical year -> historical year. Inverse of :func:`astro`."""
    return astro_year - 1 if astro_year <= 0 else astro_year


def duration(start: int, end: int) -> int:
    """Elapsed years between two historical years.

    Elapsed, not inclusive: 1526 to 1857 is 331 years, and 1 BCE to 1 CE is 1.
    """
    return astro(end) - astro(start)


# --------------------------------------------------------------------------
# display
# --------------------------------------------------------------------------

def _exact_display(year: int) -> str:
    """Display for a year the author wrote as a plain integer.

    Always BCE/CE - an author who means deep time writes ``"66 Ma"`` instead, and
    that authored form is echoed back verbatim.
    """
    if year < 0:
        return f"{abs(year)} BCE"
    return f"{year} CE" if year < 1000 else str(year)


def format_year(year: int) -> str:
    """General-purpose formatter for an arbitrary year (axis ticks, reports).

    Unlike :func:`_exact_display` this switches to ka/Ma/Ga for deep time, because
    an axis tick at -65,998,051 must read "66 Ma" rather than a ten-digit number.
    """
    bp = BP_EPOCH - astro(year)
    if bp >= 1_000_000_000:
        return f"{bp / 1e9:.2f} Ga"
    if bp >= 1_000_000:
        return f"{bp / 1e6:g} Ma"
    if bp >= 10_000:
        return f"{bp / 1e3:g} ka"
    return _exact_display(year)


def _range_display(lo: int, hi: int, lo_txt: str, hi_txt: str, deep: bool) -> str:
    if deep:
        # Deep time is inherently approximate; the "c." prefix adds nothing.
        return f"{lo_txt} {EN_DASH} {hi_txt}"
    if lo < 0 and hi < 0:
        return f"c. {abs(lo)}{EN_DASH}{abs(hi)} BCE"
    if lo > 0 and hi > 0:
        # An early-CE range sitting next to a BCE one is ambiguous without the
        # marker; a four-digit range never needs it.
        era = " CE" if hi < 1000 else ""
        return f"c. {lo}{EN_DASH}{hi}{era}"
    return f"c. {abs(lo)} BCE {EN_DASH} {hi} CE"


# --------------------------------------------------------------------------
# fuzzy date bounds
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Bound:
    """A bracketed date. ``min == max`` means a precise year.

    The invariants are enforced here rather than in :func:`parse_bound` so that
    a ``Bound`` built directly - by the loader, a test, or an importer - cannot
    carry a reversed bracket or the non-existent year zero.
    """

    min: int
    max: int
    display: str

    def __post_init__(self) -> None:
        astro(self.min)  # raises on year zero
        astro(self.max)
        if self.min > self.max:
            raise ValueError(
                f"date bound min {self.min} falls after max {self.max}"
            )

    @property
    def is_precise(self) -> bool:
        return self.min == self.max

    @property
    def width(self) -> int:
        """Elapsed years spanned by the bracket, via the astronomical boundary."""
        return duration(self.min, self.max)


def is_ongoing(raw: object) -> bool:
    return isinstance(raw, str) and raw.strip() == "ongoing"


def _parse_scalar(raw: object) -> tuple[int, str, bool]:
    """Parse one endpoint. Returns (historical_year, display, came_from_deep_time)."""
    if isinstance(raw, bool):  # bool is an int subclass; reject it explicitly
        raise ValueError(f"could not parse date bound: {raw!r}")

    if isinstance(raw, int):
        if raw == 0:
            raise ValueError("there is no year zero in historical numbering; use -1 or 1")
        return raw, _exact_display(raw), False

    if isinstance(raw, str):
        text = raw.strip()

        deep = _DEEP_RE.match(text)
        if deep:
            value, unit = float(deep.group(1)), deep.group(2)
            bp = round(value * _DEEP_UNITS[unit])
            return historical(BP_EPOCH - bp), f"{value:g} {unit}", True

        if _INT_RE.match(text):
            return _parse_scalar(int(text))

    raise ValueError(f"could not parse date bound: {raw!r}")


def parse_bound(raw: object) -> Bound:
    """Parse any of the authoring shorthands into a :class:`Bound`.

    Accepted forms::

        1526                                  precise year
        [1398, 1440]                          bracketed range
        {min: -500, max: 200, display: "..."} explicit, display optional
        "66 Ma" / "4.54 Ga" / "12 ka"         deep time, before 1950 CE
        "ongoing"                             resolves to the present year
    """
    if is_ongoing(raw):
        return Bound(PRESENT, PRESENT, "present")

    if isinstance(raw, dict):
        if "min" not in raw or "max" not in raw:
            raise ValueError(f"date bound mapping needs 'min' and 'max': {raw!r}")
        lo, lo_txt, lo_deep = _parse_scalar(raw["min"])
        hi, hi_txt, hi_deep = _parse_scalar(raw["max"])
        explicit = raw.get("display")
    elif isinstance(raw, (list, tuple)):
        if len(raw) != 2:
            raise ValueError(f"date bound list needs exactly two entries: {raw!r}")
        lo, lo_txt, lo_deep = _parse_scalar(raw[0])
        hi, hi_txt, hi_deep = _parse_scalar(raw[1])
        explicit = None
    else:
        lo, lo_txt, lo_deep = _parse_scalar(raw)
        hi, hi_txt, hi_deep = lo, lo_txt, lo_deep
        explicit = None

    if explicit:
        return Bound(lo, hi, explicit)
    if lo == hi:
        return Bound(lo, hi, lo_txt)
    return Bound(lo, hi, _range_display(lo, hi, lo_txt, hi_txt, lo_deep or hi_deep))


# --------------------------------------------------------------------------
# records
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Source:
    title: str
    url: str


@dataclass(frozen=True)
class Entry:
    id: str
    title: str
    kind: str
    regions: tuple[str, ...]
    start: Bound
    end: Bound
    importance: int
    summary: str
    categories: tuple[str, ...] = ()
    aliases: tuple[str, ...] = ()
    significance: str | None = None
    note: str | None = None
    related: tuple[str, ...] = ()
    sources: tuple[Source, ...] = ()   # citations for the DATING claim
    texts: tuple[Source, ...] = ()     # where to READ the work itself
    wikidata: str | None = None
    confidence: str = "high"
    origin: str = "curated"
    ongoing: bool = False
    source_file: str = field(default="", compare=False)

    @property
    def display_range(self) -> str:
        """Start and end as one string.

        When either bound is itself a bracket its display already contains a
        dash, so joining with another one reads as three dates rather than two
        ("243 Ma - 233 Ma - 66 Ma"). Switch the join to a word in that case.
        """
        if self.start == self.end:
            return self.start.display
        joiner = "to" if not (self.start.is_precise and self.end.is_precise) else EN_DASH
        return f"{self.start.display} {joiner} {self.end.display}"
