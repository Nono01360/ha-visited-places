"""Capteur exposant les statistiques et la liste complète des lieux."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    ATTR_DEFAULT_LAT,
    ATTR_DEFAULT_LON,
    ATTR_DEFAULT_ZOOM,
    ATTR_PEOPLE,
    ATTR_PLACES,
    ATTR_VISITED_COUNT,
    ATTR_WISHLIST_COUNT,
    CONF_DEFAULT_LAT,
    CONF_DEFAULT_LON,
    CONF_DEFAULT_ZOOM,
    CONF_PEOPLE,
    DEFAULT_PEOPLE,
    DEFAULT_ZOOM,
    DOMAIN,
)
from .coordinator import VisitedPlacesCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Configure le capteur principal Visited Places."""
    coordinator: VisitedPlacesCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([VisitedPlacesSensor(coordinator, entry)])


class VisitedPlacesSensor(CoordinatorEntity[VisitedPlacesCoordinator], SensorEntity):
    """Entité centrale contenant les lieux visités et à visiter."""

    _attr_has_entity_name = True
    _attr_name = "Lieux visités"
    _attr_icon = "mdi:map-marker-check"

    def __init__(
        self, coordinator: VisitedPlacesCoordinator, entry: ConfigEntry
    ) -> None:
        """Initialise le capteur."""
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_places"

    @property
    def native_value(self) -> int:
        """Retourne le nombre total de lieux marqués comme visités."""
        return sum(1 for p in self.coordinator.data.values() if p.get("visited"))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose tous les lieux, compteurs et réglages UI pour la carte Lovelace."""
        cfg = {**self._entry.data, **self._entry.options}
        places_list = [dict(p) for p in self.coordinator.data.values()]
        visited_count = sum(1 for p in places_list if p.get("visited"))
        people_raw = cfg.get(CONF_PEOPLE, DEFAULT_PEOPLE)
        people_list = [p.strip() for p in people_raw.split(",") if p.strip()]

        return {
            ATTR_PLACES: places_list,
            ATTR_VISITED_COUNT: visited_count,
            ATTR_WISHLIST_COUNT: len(places_list) - visited_count,
            ATTR_DEFAULT_LAT: cfg.get(CONF_DEFAULT_LAT, self.hass.config.latitude),
            ATTR_DEFAULT_LON: cfg.get(CONF_DEFAULT_LON, self.hass.config.longitude),
            ATTR_DEFAULT_ZOOM: cfg.get(CONF_DEFAULT_ZOOM, DEFAULT_ZOOM),
            ATTR_PEOPLE: people_list or ["Commun"],
        }
