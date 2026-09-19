"""Citation resolution. No network - responses are recorded fixtures."""
import pytest

from pipeline.citations import corroboration, parse_response, years_in

PAGE = {
    "query": {"pages": {"1": {
        "title": "Taiping Rebellion",
        "fullurl": "https://en.wikipedia.org/wiki/Taiping_Rebellion",
        "extract": "A civil war fought from 1850 to 1864 in southern China.",
    }}}
}


class TestParseResponse:
    def test_extracts_canonical_title_url_and_text(self):
        got = parse_response(PAGE)
        assert got["title"] == "Taiping Rebellion"
        assert got["url"].startswith("https://en.wikipedia.org/wiki/")
        assert "1850" in got["extract"]

    def test_missing_page_is_none(self):
        assert parse_response({"query": {"pages": {"-1": {"missing": ""}}}}) is None

    def test_empty_payload_is_none(self):
        assert parse_response({}) is None

    def test_non_https_url_is_refused(self):
        bad = {"query": {"pages": {"1": {"title": "X", "fullurl": "http://x", "extract": ""}}}}
        assert parse_response(bad) is None


class TestCorroboration:
    def test_both_years_present_is_yes(self):
        assert corroboration([1850, 1850, 1864, 1864], PAGE["query"]["pages"]["1"]["extract"]) == "yes"

    def test_one_year_present_is_partial(self):
        assert corroboration([1850, 1850, 1999, 1999],
                             PAGE["query"]["pages"]["1"]["extract"]) == "partial"

    def test_neither_present_is_no(self):
        assert corroboration([1700, 1700, 1750, 1750],
                             PAGE["query"]["pages"]["1"]["extract"]) == "no"

    def test_deep_time_is_not_checked_rather_than_failed(self):
        # A bare-number search cannot answer this, so it must not claim to.
        assert corroboration([-65998051, -65998051, -60000000, -60000000], "text") is None

    def test_bce_years_are_matched_without_their_sign(self):
        assert corroboration([-1850, -1850, -1864, -1864],
                             PAGE["query"]["pages"]["1"]["extract"]) == "yes"


class TestYearsIn:
    @pytest.mark.parametrize("text,expected", [
        ("from 1850 to 1864", {1850, 1864}),
        ("in 960 CE", {960}),
        ("no years here", set()),
        ("only 12 and 7", set()),   # too short to be a year
    ])
    def test_finds_three_and_four_digit_years(self, text, expected):
        assert years_in(text) == expected
