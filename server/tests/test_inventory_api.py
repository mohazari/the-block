import json
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.clock import FrozenClock
from app.services.inventory import COPIED_SUMMARY_FIELDS, check_copied_fields

from .conftest import DATA_PATH

DATASET: list[dict[str, Any]] = json.loads(DATA_PATH.read_text())
ALL: dict[str, Any] = {"status": ["live", "upcoming", "ended"], "page_size": 100}


def _list(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.get("/api/vehicles", params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _all_items(client: TestClient, **params: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    while True:
        body = _list(client, page=page, page_size=100, **params)
        items += body["items"]
        if len(items) >= body["total"]:
            return items
        page += 1


def _facet(body: dict[str, Any], name: str) -> dict[str, int]:
    return {f["value"]: f["count"] for f in body["facets"][name]}


def test_default_listing_is_open_auctions_closing_soonest_first(client: TestClient) -> None:
    body = _list(client)
    assert body["total"] == 200  # nothing has ended yet at the seeded clock
    assert body["page_size"] == 24 and len(body["items"]) == 24
    ends = [item["auction"]["ends_at"] for item in body["items"]]
    assert ends == sorted(ends)
    assert _facet(body, "status") == {"live": 112, "upcoming": 88}


def test_reserve_price_never_leaves_the_server(client: TestClient) -> None:
    listing = client.get("/api/vehicles", params=ALL).text
    vehicle_id = DATASET[0]["id"]
    detail = client.get(f"/api/vehicles/{vehicle_id}").text
    for payload in (listing, detail):
        assert "reserve_price" not in payload
        assert '"reserve_status"' in payload


def test_keyword_search_requires_every_token(client: TestClient) -> None:
    items = _all_items(client, q="ford bronco")
    expected = [v for v in DATASET if v["make"] == "Ford" and v["model"] == "Bronco"]
    assert len(items) == len(expected) > 0
    assert all(item["model"] == "Bronco" for item in items)


def test_words_match_at_word_starts_only(client: TestClient) -> None:
    """ "ford" finds Fords (and dealers named Ford), not "Oxford White" paint — found in QA."""
    items = _all_items(client, q="ford", status=["live", "upcoming", "ended"])
    assert any(item["make"] == "Ford" for item in items)
    for item in items:
        assert item["make"] == "Ford" or "Ford" in item["selling_dealership"]


def test_partial_lot_numbers_and_hyphenated_words_match(client: TestClient) -> None:
    lot = DATASET[42]["lot"]  # e.g. "A-0043"
    items = _all_items(client, q=lot.split("-")[1], status=["live", "upcoming", "ended"])
    assert DATASET[42]["id"] in {item["id"] for item in items}
    f150 = _all_items(client, q="150", status=["live", "upcoming", "ended"])
    assert any(item["model"] == "F-150" for item in f150)


def test_short_tokens_with_digits_match_models_not_random_vins(client: TestClient) -> None:
    items = _all_items(client, q="x5", status=["live", "upcoming", "ended"])
    assert items and all(item["model"] == "X5" for item in items)


def test_digits_match_anywhere_for_partial_vins(client: TestClient) -> None:
    target = DATASET[3]
    items = _all_items(client, q=target["vin"][-6:].lower())
    assert target["id"] in {item["id"] for item in items}


def test_search_by_vin_and_lot(client: TestClient) -> None:
    target = DATASET[17]
    for query in (target["vin"].lower(), target["lot"]):
        items = _all_items(client, q=query)
        assert [item["id"] for item in items] == [target["id"]]


def test_like_wildcards_are_escaped(client: TestClient) -> None:
    assert _list(client, q="%")["total"] == 0
    assert _list(client, q="_")["total"] == 0


def test_facets_ignore_their_own_selection(client: TestClient) -> None:
    unfiltered = _list(client)
    filtered = _list(client, make=["Ford", "BMW"])

    # Make counts are unchanged, so the buyer can see what adding another make would give.
    assert _facet(filtered, "make") == _facet(unfiltered, "make")
    assert (
        filtered["total"] == _facet(unfiltered, "make")["Ford"] + _facet(unfiltered, "make")["BMW"]
    )
    # Other facets are narrowed to Ford + BMW.
    assert sum(_facet(filtered, "body_style").values()) == filtered["total"]


def test_range_filters_use_the_current_price(client: TestClient) -> None:
    items = _all_items(client, price_min=20_000, price_max=30_000, year_min=2020)
    assert items
    for item in items:
        price = item["auction"]["current_bid"] or item["auction"]["starting_bid"]
        assert 20_000 <= price <= 30_000
        assert item["year"] >= 2020


def test_status_filter_and_ended_auctions(client: TestClient, clock: FrozenClock) -> None:
    assert _list(client, status="live")["total"] == 112

    clock.advance(timedelta(hours=1))  # the first auction closes 20 minutes after seeding
    ended = _list(client, status="ended")
    assert ended["total"] >= 1
    assert all(item["auction"]["outcome"] is not None for item in ended["items"])
    assert _list(client)["total"] == 200 - ended["total"]


def test_sorting_and_stable_pagination(client: TestClient) -> None:
    items = _all_items(client, sort="price_asc")
    prices = [i["auction"]["current_bid"] or i["auction"]["starting_bid"] for i in items]
    assert prices == sorted(prices)
    assert len({i["id"] for i in items}) == 200  # no duplicates or gaps across pages


def test_detail_has_severity_tagged_damage_and_recent_bids(client: TestClient) -> None:
    record = max(DATASET, key=lambda v: (len(v["damage_notes"]), v["bid_count"]))
    body = client.get(f"/api/vehicles/{record['id']}").json()

    assert [d["note"] for d in body["damage"]] == record["damage_notes"]
    assert {d["severity"] for d in body["damage"]} <= {"cosmetic", "mechanical", "major"}
    assert body["images"] == record["images"]
    bids = body["recent_bids"]
    assert len(bids) <= body["recent_bids_limit"] == 10
    assert [b["amount"] for b in bids] == sorted((b["amount"] for b in bids), reverse=True)
    assert all(b["bidder"].startswith("Bidder ") and not b["is_you"] for b in bids)
    datetime.fromisoformat(body["server_time"])


def test_unknown_vehicle_uses_the_error_envelope(client: TestClient) -> None:
    response = client.get("/api/vehicles/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "vehicle_not_found"


def test_invalid_query_is_rejected_with_field_issues(client: TestClient) -> None:
    response = client.get("/api/vehicles", params={"page_size": 1000, "colour": "red"})
    assert response.status_code == 422
    fields = {issue["field"] for issue in response.json()["error"]["issues"]}
    assert fields == {"page_size", "colour"}


def test_bidder_id_is_validated_and_rivals_cannot_be_impersonated(client: TestClient) -> None:
    for bad in ("short", "rival-01", "has spaces in it"):
        response = client.get("/api/vehicles", headers={"X-Bidder-Id": bad})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_bidder_id"


def test_watching_filter_requires_a_bidder(client: TestClient) -> None:
    response = client.get("/api/vehicles", params={"watching": True})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bidder_id_required"


def test_selected_facet_values_survive_zero_matches(client: TestClient) -> None:
    body = _list(client, make=["Tesla"], q="no-such-vehicle")
    assert body["total"] == 0
    assert {"value": "Tesla", "count": 0} in body["facets"]["make"]


def test_ending_soon_orders_live_then_upcoming_then_recently_ended(
    client: TestClient, clock: FrozenClock
) -> None:
    items = _all_items(client)
    statuses = [item["auction"]["status"] for item in items]
    assert statuses == sorted(statuses, key=["live", "upcoming"].index)
    live = [i["auction"]["ends_at"] for i in items if i["auction"]["status"] == "live"]
    upcoming = [i["auction"]["starts_at"] for i in items if i["auction"]["status"] == "upcoming"]
    assert live == sorted(live) and upcoming == sorted(upcoming)

    clock.advance(timedelta(hours=6))
    ended = _all_items(client, status="ended")
    assert len(ended) > 1
    ended_at = [i["auction"]["ends_at"] for i in ended]
    assert ended_at == sorted(ended_at, reverse=True)


def test_inverted_ranges_are_rejected(client: TestClient) -> None:
    response = client.get("/api/vehicles", params={"price_min": 50_000, "price_max": 5_000})
    assert response.status_code == 422
    assert "price_min must not exceed price_max" in response.text


def test_framework_errors_use_the_envelope(client: TestClient) -> None:
    missing = client.get("/api/no-such-route")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    wrong_method = client.delete("/api/vehicles")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["error"]["code"] == "method_not_allowed"


def test_reserve_price_is_never_copied_into_a_summary() -> None:
    # (That copied fields exist on the model is checked when the module loads.)
    assert "reserve_price" not in COPIED_SUMMARY_FIELDS


def test_a_schema_field_missing_from_the_model_fails_loudly() -> None:
    with pytest.raises(RuntimeError, match=r"\['mpg'\] are not Vehicle columns"):
        check_copied_fields((*COPIED_SUMMARY_FIELDS, "mpg"))
