"""Constantes pour l'intégration Visited Places."""

DOMAIN = "visited_places"
STORAGE_KEY = f"{DOMAIN}_storage"
STORAGE_VERSION = 1

FRONTEND_SCRIPT_URL = f"/{DOMAIN}/visited-places-card.js"

CONF_DEFAULT_LAT = "default_latitude"
CONF_DEFAULT_LON = "default_longitude"
CONF_DEFAULT_ZOOM = "default_zoom"
CONF_PEOPLE = "people"

DEFAULT_ZOOM = 6
DEFAULT_PEOPLE = "Nolann, Commun"

ATTR_PLACES = "places"
ATTR_VISITED_COUNT = "visited_count"
ATTR_WISHLIST_COUNT = "wishlist_count"
ATTR_DEFAULT_LAT = "default_latitude"
ATTR_DEFAULT_LON = "default_longitude"
ATTR_DEFAULT_ZOOM = "default_zoom"
ATTR_PEOPLE = "people"

SERVICE_ADD_PLACE = "add_place"
SERVICE_UPDATE_PLACE = "update_place"
SERVICE_TOGGLE_VISITED = "toggle_visited"
SERVICE_REMOVE_PLACE = "remove_place"
