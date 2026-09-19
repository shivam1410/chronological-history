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
