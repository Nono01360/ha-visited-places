"""Initialisation de l'intégration Visited Places."""
from __future__ import annotations

import logging
from pathlib import Path
import voluptuous as vol

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, Event, HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    FRONTEND_SCRIPT_BASE,
    FRONTEND_SCRIPT_URL,
    SERVICE_ADD_PLACE,
    SERVICE_REMOVE_PLACE,
    SERVICE_TOGGLE_VISITED,
    SERVICE_UPDATE_PLACE,
)
from .coordinator import VisitedPlacesCoordinator

_LOGGER = logging.getLogger(__name__)
PLATFORMS: list[Platform] = [Platform.SENSOR]

ADD_PLACE_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
        vol.Optional("latitude"): vol.Coerce(float),
        vol.Optional("longitude"): vol.Coerce(float),
        vol.Optional("query"): cv.string,
        vol.Optional("visited", default=True): cv.boolean,
        vol.Optional("category", default="Ville"): cv.string,
        vol.Optional("notes", default=""): cv.string,
        vol.Optional("visited_date"): cv.string,
        vol.Optional("person", default="Commun"): cv.string,
    }
)

UPDATE_PLACE_SCHEMA = vol.Schema(
    {
        vol.Required("place_id"): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("latitude"): vol.Coerce(float),
        vol.Optional("longitude"): vol.Coerce(float),
        vol.Optional("visited"): cv.boolean,
        vol.Optional("category"): cv.string,
        vol.Optional("notes"): cv.string,
        vol.Optional("visited_date"): cv.string,
        vol.Optional("person"): cv.string,
    }
)

TOGGLE_VISITED_SCHEMA = vol.Schema(
    {
        vol.Required("place_id"): cv.string,
        vol.Optional("visited"): cv.boolean,
    }
)

REMOVE_PLACE_SCHEMA = vol.Schema(
    {
        vol.Required("place_id"): cv.string,
    }
)


async def _async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Enregistre ou met à jour la ressource Lovelace avec cache-busting."""
    try:
        lovelace_data = hass.data.get("lovelace")
        if not lovelace_data or not hasattr(lovelace_data, "resources"):
            return
        resources = lovelace_data.resources
        if not resources.loaded:
            await resources.async_load()
        for item in resources.async_items():
            url = item.get("url", "")
            if url == FRONTEND_SCRIPT_URL:
                return
            if url.startswith(FRONTEND_SCRIPT_BASE):
                await resources.async_update_item(
                    item["id"], {"res_type": "module", "url": FRONTEND_SCRIPT_URL}
                )
                return
        await resources.async_create_item({"res_type": "module", "url": FRONTEND_SCRIPT_URL})
        _LOGGER.info("Ressource Lovelace enregistrée : %s", FRONTEND_SCRIPT_URL)
    except Exception as err:  # pylint: disable=broad-except
        _LOGGER.debug("Enregistrement auto Lovelace ignoré : %s", err)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Configure Visited Places depuis une ConfigEntry."""
    coordinator = VisitedPlacesCoordinator(hass)
    await coordinator.async_load()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    frontend_path = Path(__file__).parent / "frontend" / "visited-places-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_SCRIPT_BASE, str(frontend_path), cache_headers=False)]
    )

    if hass.state is CoreState.running:
        await _async_register_lovelace_resource(hass)
    else:
        async def _on_ha_started(_event: Event) -> None:
            await _async_register_lovelace_resource(hass)

        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_ha_started)

    async def handle_add_place(call: ServiceCall) -> None:
        await coordinator.async_add_place(**call.data)

    async def handle_update_place(call: ServiceCall) -> None:
        data = dict(call.data)
        place_id = data.pop("place_id")
        await coordinator.async_update_place(place_id, data)

    async def handle_toggle_visited(call: ServiceCall) -> None:
        await coordinator.async_toggle_visited(
            call.data["place_id"], call.data.get("visited")
        )

    async def handle_remove_place(call: ServiceCall) -> None:
        await coordinator.async_remove_place(call.data["place_id"])

    if not hass.services.has_service(DOMAIN, SERVICE_ADD_PLACE):
        hass.services.async_register(
            DOMAIN, SERVICE_ADD_PLACE, handle_add_place, schema=ADD_PLACE_SCHEMA
        )
        hass.services.async_register(
            DOMAIN, SERVICE_UPDATE_PLACE, handle_update_place, schema=UPDATE_PLACE_SCHEMA
        )
        hass.services.async_register(
            DOMAIN, SERVICE_TOGGLE_VISITED, handle_toggle_visited, schema=TOGGLE_VISITED_SCHEMA
        )
        hass.services.async_register(
            DOMAIN, SERVICE_REMOVE_PLACE, handle_remove_place, schema=REMOVE_PLACE_SCHEMA
        )

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Recharge l'intégration lorsque les options sont modifiées dans l'UI."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Décharge l'intégration proprement."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
