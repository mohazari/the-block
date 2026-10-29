"""Print the API's response/request models as one JSON Schema document.

`npm --workspace web run gen:api` turns this into TypeScript types, so the web client is typed
from the same Pydantic models that validate the API — and CI fails if they drift.
"""

import json

from pydantic import BaseModel

from app.main import create_app
from app.schemas import AuctionEvent, InventoryQuery

# Not reachable from a REST response, but the client needs them: SSE payloads, and the query
# model behind the inventory filters.
_EXTRA_MODELS: tuple[type[BaseModel], ...] = (AuctionEvent, InventoryQuery)


def api_schema() -> dict[str, object]:
    components = create_app().openapi()["components"]["schemas"]
    defs: dict[str, object] = json.loads(
        json.dumps(components).replace("#/components/schemas/", "#/$defs/")
    )
    for model in _EXTRA_MODELS:
        schema = model.model_json_schema(ref_template="#/$defs/{model}", mode="serialization")
        defs.update(schema.pop("$defs", {}))
        defs[model.__name__] = schema
    return {"title": "Api", "type": "object", "$defs": defs}


if __name__ == "__main__":
    print(json.dumps(api_schema(), indent=2, sort_keys=True))
