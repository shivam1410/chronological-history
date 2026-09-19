"""Behavior of the entry model: year numbering, fuzzy dates, display strings."""
import pytest

from pipeline.model import (
    Bound,
    astro,
    historical,
    duration,
    parse_bound,
    is_ongoing,
    format_year,
    PRESENT,
)


class TestYearNumbering:
    """Historical numbering has no year zero: -1 is 1 BCE, 1 is 1 CE."""

    def test_astro_shifts_bce_up_by_one(self):
        assert astro(-1) == 0
        assert astro(-500) == -499

    def test_astro_leaves_ce_untouched(self):
        assert astro(1) == 1
        assert astro(1526) == 1526

    def test_historical_is_the_inverse_of_astro(self):
        for y in (-4_539_998_051, -65_998_051, -10_051, -500, -1, 1, 1526, 2026):
            assert historical(astro(y)) == y

    def test_year_zero_is_rejected(self):
        with pytest.raises(ValueError, match="no year zero"):
            astro(0)

    def test_duration_crosses_the_era_boundary_without_an_off_by_one(self):
        # 1 BCE to 1 CE is one elapsed year, not two.
        assert duration(-1, 1) == 1

    def test_duration_of_a_ce_span(self):
        assert duration(1526, 1857) == 331   # Mughal Empire

    def test_duration_of_a_bce_span(self):
        assert duration(-500, -1) == 499


class TestParseExactYears:
    def test_plain_int(self):
        assert parse_bound(1526) == Bound(1526, 1526, "1526")

    def test_negative_int_displays_as_bce(self):
        assert parse_bound(-500) == Bound(-500, -500, "500 BCE")

    def test_numeric_string(self):
        assert parse_bound("1526") == Bound(1526, 1526, "1526")
        assert parse_bound("-500") == Bound(-500, -500, "500 BCE")

    def test_year_zero_is_rejected(self):
        with pytest.raises(ValueError, match="no year zero"):
            parse_bound(0)


class TestParseDeepTime:
    """ka/Ma/Ga are years before 1950 CE, the geological BP convention."""

    def test_millions_of_years(self):
        b = parse_bound("66 Ma")
        assert b.min == b.max == -65_998_051
        assert b.display == "66 Ma"

    def test_billions_of_years(self):
        b = parse_bound("4.54 Ga")
        assert b.min == -4_539_998_051
        assert b.display == "4.54 Ga"

    def test_thousands_of_years(self):
        b = parse_bound("12 ka")
        assert b.min == -10_051
        assert b.display == "12 ka"

    def test_suffix_is_case_sensitive_and_spacing_is_flexible(self):
        assert parse_bound("66Ma") == parse_bound("66 Ma")
        assert parse_bound("  66 Ma  ") == parse_bound("66 Ma")

    def test_unknown_suffix_is_rejected(self):
        with pytest.raises(ValueError, match="could not parse"):
            parse_bound("66 Xa")


class TestParseRanges:
    def test_two_element_list_becomes_a_bracket(self):
        b = parse_bound([1398, 1440])
        assert (b.min, b.max) == (1398, 1440)
        assert b.display == "c. 1398–1440"

    def test_both_bce_share_one_era_label(self):
        assert parse_bound([-500, -200]).display == "c. 500–200 BCE"

    def test_range_crossing_the_era_boundary_labels_both_sides(self):
        b = parse_bound([-500, 200])
        assert (b.min, b.max) == (-500, 200)
        assert b.display == "c. 500 BCE – 200 CE"

    def test_deep_time_range(self):
        b = parse_bound(["2.58 Ma", "11.7 ka"])
        assert b.min == parse_bound("2.58 Ma").min
        assert b.max == parse_bound("11.7 ka").max
        assert b.display == "2.58 Ma – 11.7 ka"

    def test_reversed_range_is_rejected(self):
        with pytest.raises(ValueError, match="min 1440 falls after max 1398"):
            parse_bound([1440, 1398])


class TestExplicitMapping:
    def test_explicit_display_wins(self):
        b = parse_bound({"min": -500, "max": 200, "display": "5th c. BCE – 2nd c. CE"})
        assert b == Bound(-500, 200, "5th c. BCE – 2nd c. CE")

    def test_display_is_derived_when_absent(self):
        assert parse_bound({"min": 1398, "max": 1440}).display == "c. 1398–1440"

    def test_mapping_accepts_deep_time_strings(self):
        assert parse_bound({"min": "66 Ma", "max": "66 Ma"}).min == -65_998_051


class TestOngoing:
    def test_ongoing_is_recognised(self):
        assert is_ongoing("ongoing") is True
        assert is_ongoing(1526) is False

    def test_ongoing_resolves_to_the_present(self):
        b = parse_bound("ongoing")
        assert b.min == b.max == PRESENT
        assert b.display == "present"


class TestFormatYear:
    """Fallback formatting for arbitrary years, used by axis ticks and reports."""

    @pytest.mark.parametrize("year,expected", [
        (-4_539_998_051, "4.54 Ga"),
        (-65_998_051, "66 Ma"),
        (-10_051, "12 ka"),
        (-500, "500 BCE"),
        (-1, "1 BCE"),
        (1, "1 CE"),
        (1526, "1526"),
    ])
    def test_format_year(self, year, expected):
        assert format_year(year) == expected
