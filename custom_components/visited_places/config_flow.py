"""Config flow et Options flow pour Visited Places."""
from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import HomeAssistant, callback

from .const import (
    CONF_DEFAULT_LAT,
    CONF_DEFAULT_LON,
    CONF_DEFAULT_ZOOM,
    CONF_PEOPLE,
    DEFAULT_PEOPLE,
    DEFAULT_ZOOM,
    DOMAIN,
)


def _build_schema(hass: HomeAssistant, defaults: dict[str, Any]) -> vol.Schema:
    """Construit le formulaire UI avec les coordonnées de la maison par défaut."""
    home_lat = hass.config.latitude
    home_lon = hass.config.longitude

    return vol.Schema(
        {
            vol.Required(
                CONF_DEFAULT_LAT,
                default=defaults.get(CONF_DEFAULT_LAT, home_lat),
            ): vol.Coerce(float),
            vol.Required(
                CONF_DEFAULT_LON,
                default=defaults.get(CONF_DEFAULT_LON, home_lon),
            ): vol.Coerce(float),
            vol.Required(
                CONF_DEFAULT_ZOOM,
                default=defaults.get(CONF_DEFAULT_ZOOM, DEFAULT_ZOOM),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=18)),
            vol.Optional(
                CONF_PEOPLE,
                default=defaults.get(CONF_PEOPLE, DEFAULT_PEOPLE),
            ): str,
        }
    )


class VisitedPlacesConfigFlow(ConfigFlow, domain=DOMAIN):
    """Gère l'assistant d'installation graphique."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> VisitedPlacesOptionsFlow:
        """Retourne le gestionnaire d'options (bouton Configurer)."""
        return VisitedPlacesOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Étape unique de configuration."""
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="Visited Places", data=user_input)

        return self.async_show_form(
            step_id="user", data_schema=_build_schema(self.hass, {})
        )


class VisitedPlacesOptionsFlow(OptionsFlow):
    """Permet de modifier les paramètres depuis l'interface graphique."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Affiche et sauvegarde les options modifiées."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(
            step_id="init", data_schema=_build_schema(self.hass, current)
        )
