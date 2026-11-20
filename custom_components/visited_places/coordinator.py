"""Coordinateur et stockage persistant pour Visited Places."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
import uuid

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"


class VisitedPlacesCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """Gère le stockage, le géocodage et les mises à jour des lieux."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise le coordinateur."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
        )
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self.data: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Charge les données depuis .storage."""
        stored = await self._store.async_load()
        if stored and isinstance(stored, dict):
            self.data = dict(stored.get("places", {}))
        else:
            self.data = {}
        self.async_set_updated_data(dict(self.data))

    async def _async_save(self) -> None:
        """Sauvegarde les données dans .storage et notifie les entités avec une nouvelle référence."""
        new_data = {k: dict(v) for k, v in self.data.items()}
        self.data = new_data
        await self._store.async_save({"places": new_data})
        self.async_set_updated_data(new_data)

    async def async_geocode(self, query: str) -> tuple[float, float, str, str]:
        """Géocode une adresse ou un nom de lieu via OpenStreetMap Nominatim."""
        session = async_get_clientsession(self.hass)
        headers = {"User-Agent": "HomeAssistant-VisitedPlaces/1.3.1 (contact@local.ha)"}
        params = {"q": query, "format": "json", "addressdetails": 1, "limit": 1, "accept-language": "fr"}

        async with session.get(
            NOMINATIM_SEARCH_URL, params=params, headers=headers, timeout=12
        ) as resp:
            if resp.status != 200:
                raise HomeAssistantError(
                    f"Erreur HTTP {resp.status} lors du géocodage de '{query}'"
                )
            results = await resp.json()
            if not results:
                raise HomeAssistantError(f"Aucun lieu trouvé pour '{query}'")

            first = results[0]
            addr = first.get("address", {})
            country = str(addr.get("country", ""))
            return (
                float(first["lat"]),
                float(first["lon"]),
                str(first.get("display_name", query)),
                country,
            )

    async def async_reverse_country(self, lat: float, lon: float) -> tuple[str, str]:
        """Récupère l'adresse et le pays pour des coordonnées GPS."""
        try:
            session = async_get_clientsession(self.hass)
            headers = {"User-Agent": "HomeAssistant-VisitedPlaces/1.3.1 (contact@local.ha)"}
            params = {"lat": lat, "lon": lon, "format": "json", "addressdetails": 1, "accept-language": "fr"}
            async with session.get(
                NOMINATIM_REVERSE_URL, params=params, headers=headers, timeout=8
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    addr = data.get("address", {})
                    return str(data.get("display_name", "")), str(addr.get("country", ""))
        except Exception:  # pylint: disable=broad-except
            pass
        return "", ""

    async def async_add_place(
        self,
        name: str,
        latitude: float | None = None,
        longitude: float | None = None,
        query: str | None = None,
        visited: bool = True,
        category: str = "Ville",
        notes: str = "",
        visited_date: str | None = None,
        person: str = "Commun",
    ) -> dict[str, Any]:
        """Ajoute un nouveau lieu (par coordonnées exactes ou géocodage)."""
        resolved_address = ""
        country = ""
        if latitude is None or longitude is None:
            search_term = query or name
            latitude, longitude, resolved_address, country = await self.async_geocode(search_term)
        else:
            resolved_address, country = await self.async_reverse_country(float(latitude), float(longitude))

        place_id = uuid.uuid4().hex[:8]
        now_iso = datetime.now(timezone.utc).date().isoformat()

        place = {
            "id": place_id,
            "name": name.strip(),
            "latitude": round(float(latitude), 6),
            "longitude": round(float(longitude), 6),
            "address": resolved_address,
            "country": country,
            "visited": bool(visited),
            "category": category.strip() or "Ville",
            "notes": notes.strip(),
            "visited_date": (visited_date or now_iso) if visited else None,
            "person": person.strip() or "Commun",
        }
        self.data[place_id] = place
        await self._async_save()
        return place

    async def async_update_place(
        self, place_id: str, updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Met à jour les propriétés d'un lieu existant."""
        if place_id not in self.data:
            raise HomeAssistantError(f"Lieu introuvable : {place_id}")

        place = dict(self.data[place_id])
        for key in ("name", "latitude", "longitude", "visited", "category", "notes", "visited_date", "person", "country"):
            if key in updates and updates[key] is not None:
                place[key] = updates[key]

        if place["visited"] and not place.get("visited_date"):
            place["visited_date"] = datetime.now(timezone.utc).date().isoformat()
        elif not place["visited"]:
            place["visited_date"] = None

        self.data[place_id] = place
        await self._async_save()
        return place

    async def async_toggle_visited(
        self, place_id: str, visited: bool | None = None
    ) -> dict[str, Any]:
        """Bascule ou force le statut visité d'un lieu."""
        if place_id not in self.data:
            raise HomeAssistantError(f"Lieu introuvable : {place_id}")

        current = self.data[place_id]["visited"]
        new_state = (not current) if visited is None else bool(visited)
        return await self.async_update_place(place_id, {"visited": new_state})

    async def async_remove_place(self, place_id: str) -> None:
        """Supprime un lieu."""
        if place_id not in self.data:
            raise HomeAssistantError(f"Lieu introuvable : {place_id}")

        del self.data[place_id]
        await self._async_save()
