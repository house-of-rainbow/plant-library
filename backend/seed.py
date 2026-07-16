"""Seed the database with a few demo species and plants.

Run against a running backend (defaults to http://localhost:8000):

    python backend/seed.py
"""
from __future__ import annotations

import os
import sys

import httpx

BASE = os.environ.get("SEED_API_BASE", "http://localhost:8000")

SPECIES = [
    {
        "common_name": "Monstera Deliciosa",
        "scientific_name": "Monstera deliciosa",
        "family": "Araceae",
        "description": "The iconic Swiss cheese plant. Loves to climb.",
        "tags": ["tropical", "foliage"],
        "care_defaults": {
            "watering_interval_days": 7,
            "sunlight": "bright_indirect",
            "fertilizing_interval_days": 30,
            "repotting_interval_months": 24,
            "soil_type": "Well-draining aroid mix",
            "toxic_to_pets": True,
            "care_notes": "Let the top 2 inches of soil dry out between waterings.",
        },
    },
    {
        "common_name": "Snake Plant",
        "scientific_name": "Dracaena trifasciata",
        "family": "Asparagaceae",
        "description": "Nearly indestructible, tolerates neglect.",
        "tags": ["succulent", "low-light"],
        "care_defaults": {
            "watering_interval_days": 21,
            "sunlight": "low",
            "fertilizing_interval_days": 60,
            "toxic_to_pets": True,
            "care_notes": "Water sparingly; rot is the main risk.",
        },
    },
    {
        "common_name": "Fiddle Leaf Fig",
        "scientific_name": "Ficus lyrata",
        "family": "Moraceae",
        "description": "Dramatic violin-shaped leaves; a bit fussy.",
        "tags": ["tree", "statement"],
        "care_defaults": {
            "watering_interval_days": 10,
            "sunlight": "bright_indirect",
            "fertilizing_interval_days": 30,
            "toxic_to_pets": True,
            "care_notes": "Hates being moved. Keep away from drafts.",
        },
    },
]

PLANTS = [
    {"species": "Monstera Deliciosa", "nickname": "Monty", "location": "Living room"},
    {"species": "Snake Plant", "nickname": "Sly", "location": "Bedroom"},
    {"species": "Fiddle Leaf Fig", "nickname": "Fiddler", "location": "Office"},
]


def main() -> int:
    with httpx.Client(base_url=BASE, timeout=30) as client:
        client.get("/api/health").raise_for_status()

        # 1. Create the demo property with its Home garden.
        r = client.post(
            "/api/properties",
            json={"name": "Burien Station", "home_garden_name": "Home"},
        )
        r.raise_for_status()
        prop = r.json()
        property_id = prop["id"]
        home_garden = next(
            (g for g in prop.get("gardens", []) if g.get("is_home")),
            prop.get("gardens", [{}])[0] if prop.get("gardens") else None,
        )
        garden_id = home_garden["id"]
        print(f"property: {prop['name']} -> {property_id}")
        print(f"garden:   {home_garden['name']} -> {garden_id}")

        params = {"property_id": property_id}

        # 2. Seed the property's species library.
        ids: dict[str, str] = {}
        for s in SPECIES:
            r = client.post("/api/classes", params=params, json=s)
            r.raise_for_status()
            ids[s["common_name"]] = r.json()["id"]
            print(f"species:  {s['common_name']} -> {ids[s['common_name']]}")

        # 3. Seed plants into the Home garden.
        for p in PLANTS:
            payload = {
                "class_id": ids[p["species"]],
                "garden_id": garden_id,
                "nickname": p["nickname"],
                "location": p["location"],
                "health_status": "healthy",
            }
            r = client.post("/api/instances", params=params, json=payload)
            r.raise_for_status()
            inst = r.json()
            print(f"plant:    {p['nickname']} -> {inst['id']}  scan: {inst['scan_url']}")

    print("\nSeed complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
