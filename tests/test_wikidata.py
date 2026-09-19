"""Wikidata matching and parsing. No network - fixtures are recorded."""
import pytest

from pipeline.wikidata import (
    normalise, parse_entities, parse_pageprops, titles_match,
)


class TestTitlesMatch:
    @pytest.mark.parametrize("ours,theirs", [
        ("Genghis Khan", "Genghis Khan"),
        ("Genghis Khan", "genghis khan"),
        ("The Scythians", "Scythians"),
        ("Scythians", "The Scythians"),
    ])
    def test_accepts_the_same_subject(self, ours, theirs):
        assert titles_match(ours, theirs)

    @pytest.mark.parametrize("ours,theirs", [
        # Rejected deliberately: a qualifier cannot be told from a different
        # subject by string shape alone, so both are refused and handled by a
        # curated mapping instead.
        ("Euclid", "Euclid of Alexandria"),
        ("Rigveda", "Ṛgveda"),
        ("Ashoka", "Ashoka (film)"),
        ("Ashoka", "Ashoka Hotel"),
        ("Kabir", "Kabir Singh"),
        ("Mali Empire", "Mali"),
        ("Homer", "Homer Simpson"),
        ("Taiping Rebellion", "Boxer Rebellion"),
        ("Euclid", ""),
        ("", "Euclid"),
    ])
    def test_rejects_a_different_subject(self, ours, theirs):
        # A near-miss imports another entity's dates, which is worse than
        # importing nothing at all.
        assert not titles_match(ours, theirs)


class TestNormalise:
    def test_folds_case_accents_and_punctuation(self):
        assert normalise("Ṛgveda") == "rgveda"
        assert normalise("Chimpanzee–human") == "chimpanzee human"


class TestParsePageprops:
    def test_returns_title_and_qid(self):
        got = parse_pageprops({"query": {"pages": {"1": {
            "title": "Genghis Khan", "pageprops": {"wikibase_item": "Q720"}}}}})
        assert got == {"title": "Genghis Khan", "qid": "Q720"}

    def test_missing_page_is_none(self):
        assert parse_pageprops({"query": {"pages": {"-1": {"missing": ""}}}}) is None

    def test_page_without_a_wikidata_item_is_none(self):
        assert parse_pageprops({"query": {"pages": {"1": {"title": "X"}}}}) is None


class TestParseEntities:
    ENTITY = {"entities": {"Q720": {
        "labels": {"en": {"value": "Genghis Khan"}},
        "claims": {
            "P18": [{"mainsnak": {"datavalue": {"value": "Genghis Khan.jpg"}}}],
            "P569": [{"mainsnak": {"datavalue": {"value": {"time": "+1162-00-00T00:00:00Z"}}}}],
            "P570": [{"mainsnak": {"datavalue": {"value": {"time": "+1227-08-25T00:00:00Z"}}}}],
        }}}}

    def test_extracts_label_image_and_dates(self):
        got = parse_entities(self.ENTITY)["Q720"]
        assert got["label"] == "Genghis Khan"
        assert got["image_file"] == "File:Genghis Khan.jpg"
        assert got["birth"] == "1162"
        assert got["death"] == "1227"

    def test_bce_dates_keep_their_sign(self):
        payload = {"entities": {"Q1": {"labels": {}, "claims": {
            "P569": [{"mainsnak": {"datavalue": {"value": {"time": "-0384-00-00T00:00:00Z"}}}}]}}}}
        assert parse_entities(payload)["Q1"]["birth"] == "-384"

    def test_year_zero_is_skipped_because_it_does_not_exist(self):
        payload = {"entities": {"Q1": {"labels": {}, "claims": {
            "P569": [{"mainsnak": {"datavalue": {"value": {"time": "+0000-00-00T00:00:00Z"}}}}]}}}}
        assert "birth" not in parse_entities(payload)["Q1"]

    def test_missing_entities_are_dropped(self):
        assert parse_entities({"entities": {"Q9": {"missing": ""}}}) == {}
