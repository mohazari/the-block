"""Print the API's response/request models as one JSON Schema document.

`npm --workspace web run gen:api` turns this into TypeScript types, so the web client is typed
from the same Pydantic models that validate the API — and CI fails if they drift.
"""

import json

from pydantic import BaseModel

from app.lane.schemas import LaneProblem, LaneReply, LaneStep, LaneText
from app.main import create_app
from app.schemas import AuctionEvent, InventoryQuery

# Not reachable from a REST response, but the client needs them: SSE payloads (live auction
# updates, Lane's replies), and the query model behind the inventory filters.
_EXTRA_MODELS: tuple[type[BaseModel], ...] = (
    AuctionEvent,
    InventoryQuery,
    LaneStep,
    LaneText,
    LaneReply,
    LaneProblem,
)


def api_schema() -> dict[str, object]:
    components = create_app().openapi()["components"]["schemas"]
    defs: dict[str, object] = json.loads(
        json.dumps(components).replace("#/components/schemas/", "#/$defs/")
    )
    for model in _EXTRA_MODELS:
        schema = model.model_json_schema(ref_template="#/$defs/{model}", mode="serialization")
        for name, definition in {**schema.pop("$defs", {}), model.__name__: schema}.items():
            # The same name must mean the same shape, or the generated TS type would silently
            # depend on which copy came last.
            if name in defs and defs[name] != definition:
                raise SystemExit(f"Conflicting JSON Schema definitions for {name!r}")
            defs[name] = definition
    return {"title": "Api", "type": "object", "$defs": defs}


if __name__ == "__main__":
    print(json.dumps(api_schema(), indent=2, sort_keys=True))
