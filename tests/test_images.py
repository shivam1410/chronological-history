"""Parsing Commons responses. No network - the fixtures are recorded."""
import json

import pytest

from pipeline.images import _plain, parse_response

FULL = {
    "query": {"pages": {"1": {
        "title": "File:Lucy Skeleton.jpg",
        "imageinfo": [{
            "url": "https://upload.wikimedia.org/commons/d/da/Lucy.jpg?utm=x",
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:Lucy.jpg",
            "extmetadata": {
                "LicenseShortName": {"value": "CC BY-SA 2.0"},
                "Artist": {"value": '<a href="https://x">Jane   Doe</a>'},
            },
        }],
    }}}
}


class TestParseResponse:
    def test_extracts_url_licence_source_and_credit(self):
        got = parse_response(FULL)
        assert got["url"] == "https://upload.wikimedia.org/commons/d/da/Lucy.jpg"
        assert got["license"] == "CC BY-SA 2.0"
        assert got["source"].startswith("https://commons.wikimedia.org/")
        assert got["credit"] == "Jane Doe"

    def test_strips_the_tracking_query_from_the_url(self):
        assert "?" not in parse_response(FULL)["url"]

    def test_prefers_the_scaled_copy_when_commons_offers_one(self):
        payload = json.loads(json.dumps(FULL))
        payload["query"]["pages"]["1"]["imageinfo"][0]["thumburl"] = (
            "https://upload.wikimedia.org/commons/thumb/d/da/Lucy.jpg/720px-Lucy.jpg")
        assert parse_response(payload)["url"].endswith("720px-Lucy.jpg")

    def test_falls_back_to_the_original_without_a_thumbnail(self):
        assert parse_response(FULL)["url"].endswith("Lucy.jpg")

    def test_missing_file_returns_none(self):
        assert parse_response({"query": {"pages": {"-1": {"missing": ""}}}}) is None

    def test_empty_response_returns_none(self):
        assert parse_response({}) is None

    def test_a_file_with_no_stated_licence_is_refused(self):
        payload = json.loads(json.dumps(FULL))
        payload["query"]["pages"]["1"]["imageinfo"][0]["extmetadata"].pop("LicenseShortName")
        # No stated terms means no permission to display it.
        assert parse_response(payload) is None

    def test_a_non_https_url_is_refused(self):
        payload = json.loads(json.dumps(FULL))
        payload["query"]["pages"]["1"]["imageinfo"][0]["url"] = "http://x/a.jpg"
        assert parse_response(payload) is None

    def test_public_domain_files_need_no_credit(self):
        payload = json.loads(json.dumps(FULL))
        payload["query"]["pages"]["1"]["imageinfo"][0]["extmetadata"]["Artist"] = {"value": ""}
        payload["query"]["pages"]["1"]["imageinfo"][0]["extmetadata"]["LicenseShortName"] = {
            "value": "Public domain"}
        got = parse_response(payload)
        assert got["credit"] == ""
        assert got["license"] == "Public domain"


class TestPlain:
    @pytest.mark.parametrize("markup,expected", [
        ('<a href="x">Name</a>', "Name"),
        ("A &amp; B", "A & B"),
        ("  spaced   out  ", "spaced out"),
        (None, ""),
        ("", ""),
    ])
    def test_reduces_markup_to_text(self, markup, expected):
        assert _plain(markup) == expected

    @pytest.mark.parametrize("markup,expected", [
        ("<a>Unknown author</a><a>Unknown author</a>", "Unknown author"),
        ("<a>Unknown author</a><a>Unknown author</a> Publisher: Acme",
         "Unknown author Publisher: Acme"),
        ("<a>Jane</a><a>John</a>", "Jane John"),
    ])
    def test_welded_names_are_separated_and_exact_repeats_collapsed(
            self, markup, expected):
        # Dropping tags outright welded adjacent elements into one word;
        # substituting a space unwelded them but left Commons' habit of
        # rendering a name twice, as a link and its own label.
        assert _plain(markup) == expected

    @pytest.mark.parametrize("markup,expected", [
        # The Artist field sometimes holds a link whose label is the page
        # title, so the wiki namespace arrives as if it were part of the
        # name. Commons' own attribution guidance names the user, not the
        # namespace.
        ('<a href="x">User:Hohum</a>', "Hohum"),
        ("<a>User:Kelvin Case</a><a>User:Turkish Flame</a>",
         "Kelvin Case Turkish Flame"),
        # A redlinked template: the uploader wrote {{Naynapragasanar}} in the
        # Artist field and it never expanded, so the credit reached the reader
        # as "Template:Naynapragasanar".
        ('<a class="new">Template:Naynapragasanar</a>', "Naynapragasanar"),
        ("<a>Category:Maps of Rome</a>", "Maps of Rome"),
    ])
    def test_a_wiki_namespace_prefix_is_not_part_of_the_name(
            self, markup, expected):
        assert _plain(markup) == expected

    @pytest.mark.parametrize("markup,expected", [
        # Only the MediaWiki namespaces, and only where no space follows the
        # colon - an ordinary label that happens to end in one stays whole.
        ("<a>Russell.jpg</a>: Photographer", "Russell.jpg: Photographer"),
        ("<a>Unknown</a> Publisher: Acme", "Unknown Publisher: Acme"),
        ("Photograph: Jane Doe", "Photograph: Jane Doe"),
        ("<a>Userland Software</a>", "Userland Software"),
        # Inside a URL the namespace is part of the path, and removing it
        # points the link at a page that does not exist.
        ("<a>http://en.wikipedia.org/wiki/User:Cculber007</a>",
         "http://en.wikipedia.org/wiki/User:Cculber007"),
    ])
    def test_an_ordinary_colon_is_left_alone(self, markup, expected):
        assert _plain(markup) == expected

    @pytest.mark.parametrize("markup,expected", [
        ("<a>Westphal</a>, which is Swedish", "Westphal, which is Swedish"),
        ("<a>Harold Thomas</a>; Vectorization: T", "Harold Thomas; Vectorization: T"),
        ("<i>Les Prix Nobel</i>.", "Les Prix Nobel."),
        ("<a>Russell.jpg</a>: Photographer", "Russell.jpg: Photographer"),
        ("<a>A</a> (<a>B</a>)", "A (B)"),
        ("<a>Jane Doe</a> [<a>CC BY 4.0</a>]", "Jane Doe [CC BY 4.0]"),
        ("Photo by <a>X</a> and <a>Y</a>", "Photo by X and Y"),
    ])
    def test_the_unwelding_space_is_taken_back_out_at_punctuation(
            self, markup, expected):
        # The fix for welding put a space where every tag had been, including
        # where a tag sat directly against punctuation - which is how 52
        # credits came to read "Westphal , which" and "Les Prix Nobel .".
        assert _plain(markup) == expected
