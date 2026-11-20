class VisitedPlacesCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; padding:8px 0;">
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Titre de la carte
          <input id="ed-title" type="text" value="${this._config.title || "Carnet de voyage"}"
            style="padding:8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Entité capteur
          <input id="ed-entity" type="text" value="${this._config.entity || "sensor.visited_places_lieux_visites"}"
            style="padding:8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Hauteur de la carte (ex: 550px)
          <input id="ed-height" type="text" value="${this._config.height || "550px"}"
            style="padding:8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Style de carte
          <select id="ed-style"
            style="padding:8px; border-radius:6px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);">
            <option value="voyager" ${(this._config.map_style || "voyager") === "voyager" ? "selected" : ""}>Clair détaillé (CARTO Voyager)</option>
            <option value="dark" ${this._config.map_style === "dark" ? "selected" : ""}>Sombre (CARTO Dark Matter)</option>
            <option value="satellite" ${this._config.map_style === "satellite" ? "selected" : ""}>Satellite (Esri World Imagery)</option>
          </select>
        </label>
      </div>
    `;

    ["ed-title", "ed-entity", "ed-height", "ed-style"].forEach((id) => {
      this.querySelector(`#${id}`).addEventListener("change", () => this._valueChanged());
    });
  }

  _valueChanged() {
    const newConfig = {
      ...this._config,
      title: this.querySelector("#ed-title").value,
      entity: this.querySelector("#ed-entity").value,
      height: this.querySelector("#ed-height").value,
      map_style: this.querySelector("#ed-style").value,
    };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: newConfig }, bubbles: true, composed: true }));
  }
}

customElements.define("visited-places-card-editor", VisitedPlacesCardEditor);

class VisitedPlacesCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("visited-places-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Mes lieux visités",
      entity: "sensor.visited_places_lieux_visites",
      height: "550px",
      map_style: "voyager",
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._map = null;
    this._tileLayer = null;
    this._markersLayer = null;
    this._filter = "all";
    this._personFilter = "all";
    this._pendingCoords = null;
    this._initialized = false;
    this._viewCentered = false;
  }

  setConfig(config) {
    this._config = {
      entity: config.entity || "sensor.visited_places_lieux_visites",
      title: config.title || "Mes lieux visités",
      height: config.height || "550px",
      map_style: config.map_style || "voyager",
      lat: config.lat || null,
      lon: config.lon || null,
      zoom: config.zoom || null,
    };
    if (this._initialized) {
      const titleEl = this.shadowRoot.querySelector(".title");
      if (titleEl) titleEl.textContent = this._config.title;
      const mapEl = this.shadowRoot.getElementById("map");
      if (mapEl) mapEl.style.height = this._config.height;
      this._applyTileLayer();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._renderShell();
      this._loadLeaflet().then(() => this._initMap());
    } else {
      this._syncPeopleOptions();
      this._updateMarkers();
    }
  }

  async _loadLeaflet() {
    if (window.L) return;
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    await new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  _getTileConfig() {
    const style = this._config.map_style || "voyager";
    if (style === "dark") {
      return {
        url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr: "&copy; OpenStreetMap &copy; CARTO",
        subdomains: "abcd",
      };
    }
    if (style === "satellite") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        subdomains: [],
      };
    }
    return {
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      attr: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
    };
  }

  _applyTileLayer() {
    if (!this._map || !window.L) return;
    if (this._tileLayer) {
      this._map.removeLayer(this._tileLayer);
    }
    const cfg = this._getTileConfig();
    const opts = { attribution: cfg.attr, maxZoom: 19 };
    if (cfg.subdomains && cfg.subdomains.length) {
      opts.subdomains = cfg.subdomains;
    }
    this._tileLayer = window.L.tileLayer(cfg.url, opts).addTo(this._map);
  }

  _showFeedback(msg, isError = false) {
    const banner = this.shadowRoot.getElementById("feedback-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = msg ? "block" : "none";
    banner.style.background = isError ? "#c62828" : "#2e7d32";
    if (msg) {
      clearTimeout(this._feedbackTimer);
      this._feedbackTimer = setTimeout(() => {
        banner.style.display = "none";
      }, 4500);
    }
  }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>
        ha-card { overflow: hidden; display: flex; flex-direction: column; position: relative; }
        .toolbar {
          display: flex; flex-wrap: wrap; gap: 8px; padding: 12px;
          align-items: center; justify-content: space-between;
          border-bottom: 1px solid var(--divider-color);
        }
        .title { font-size: 1.1rem; font-weight: 600; }
        .stats { font-size: 0.85rem; color: var(--secondary-text-color); }
        .filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .controls { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 12px; background: var(--secondary-background-color); }
        input, select, button {
          padding: 6px 10px; border-radius: 6px; border: 1px solid var(--divider-color);
          background: var(--card-background-color); color: var(--primary-text-color); font-size: 0.85rem;
        }
        button { cursor: pointer; font-weight: 500; }
        button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border: none; }
        button.active { background: var(--primary-color); color: #fff; }
        #map { width: 100%; height: ${this._config.height}; z-index: 1; }
        .modal {
          display: none; padding: 12px; background: var(--card-background-color);
          border-top: 1px solid var(--divider-color); gap: 8px; flex-wrap: wrap; align-items: center;
        }
        .modal.open { display: flex; }
        .feedback {
          display: none; padding: 8px 12px; color: #fff; font-size: 0.85rem; font-weight: 500;
        }
        .popup-btn {
          margin-top: 6px; padding: 5px 9px; border-radius: 4px; border: none;
          cursor: pointer; font-size: 12px; margin-right: 4px;
        }
      </style>
      <ha-card>
        <div class="toolbar">
          <div>
            <div class="title">${this._config.title}</div>
            <div class="stats" id="stats">Chargement...</div>
          </div>
          <div class="filters">
            <select id="person-filter">
              <option value="all">Toutes les personnes</option>
            </select>
            <button data-filter="all" class="active">Tous</button>
            <button data-filter="visited">Visités</button>
            <button data-filter="wishlist">À visiter</button>
          </div>
        </div>
        <div class="controls">
          <input type="text" id="search-input" placeholder="Ajouter par nom ou adresse (ex: Mont Blanc)..." style="flex:1; min-width: 170px;" />
          <select id="category-input">
            <option value="Ville">Ville</option>
            <option value="Monument">Monument</option>
            <option value="Nature">Nature</option>
            <option value="Restaurant">Restaurant</option>
            <option value="Musée">Musée</option>
            <option value="Autre">Autre</option>
          </select>
          <select id="person-input"></select>
          <label style="display:flex; align-items:center; gap:4px; font-size:0.85rem;">
            <input type="checkbox" id="visited-checkbox" checked /> Visité
          </label>
          <button class="primary" id="add-search-btn">+ Épingler</button>
        </div>
        <div class="feedback" id="feedback-banner"></div>
        <div class="modal" id="click-modal">
          <span id="click-coords" style="font-size:0.8rem; font-weight:600;"></span>
          <input type="text" id="click-name" placeholder="Nom de ce point précis..." style="flex:1; min-width:150px;" />
          <input type="text" id="click-notes" placeholder="Note (optionnel)..." />
          <label style="display:flex; align-items:center; gap:4px; font-size:0.85rem;">
            <input type="checkbox" id="click-visited" checked /> Visité
          </label>
          <button class="primary" id="save-click-btn">Enregistrer</button>
          <button id="cancel-click-btn">Annuler</button>
        </div>
        <div id="map"></div>
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._filter = e.target.dataset.filter;
        this.shadowRoot.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this._updateMarkers();
      });
    });

    this.shadowRoot.getElementById("person-filter").addEventListener("change", (e) => {
      this._personFilter = e.target.value;
      this._updateMarkers();
    });

    const submitSearch = async () => {
      const inputEl = this.shadowRoot.getElementById("search-input");
      const btnEl = this.shadowRoot.getElementById("add-search-btn");
      const name = inputEl.value.trim();
      if (!name) return;

      const category = this.shadowRoot.getElementById("category-input").value;
      const person = this.shadowRoot.getElementById("person-input").value || "Commun";
      const visited = this.shadowRoot.getElementById("visited-checkbox").checked;

      btnEl.disabled = true;
      btnEl.textContent = "Recherche...";
      try {
        await this._hass.callService("visited_places", "add_place", {
          name,
          query: name,
          category,
          person,
          visited,
        });
        inputEl.value = "";
        this._showFeedback(`Lieu "${name}" ajouté avec succès !`);
      } catch (err) {
        this._showFeedback(`Erreur : ${err.message || "Lieu introuvable"}`, true);
      } finally {
        btnEl.disabled = false;
        btnEl.textContent = "+ Épingler";
      }
    };

    this.shadowRoot.getElementById("add-search-btn").addEventListener("click", submitSearch);
    this.shadowRoot.getElementById("search-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitSearch();
    });

    const submitClick = async () => {
      const name = this.shadowRoot.getElementById("click-name").value.trim();
      if (!name || !this._pendingCoords) return;
      const notes = this.shadowRoot.getElementById("click-notes").value.trim();
      const visited = this.shadowRoot.getElementById("click-visited").checked;
      const category = this.shadowRoot.getElementById("category-input").value;
      const person = this.shadowRoot.getElementById("person-input").value || "Commun";

      try {
        await this._hass.callService("visited_places", "add_place", {
          name,
          latitude: this._pendingCoords.lat,
          longitude: this._pendingCoords.lng,
          category,
          person,
          notes,
          visited,
        });
        this._closeModal();
        this._showFeedback(`Point "${name}" enregistré !`);
      } catch (err) {
        this._showFeedback(`Erreur : ${err.message || "Impossible d'enregistrer"}`, true);
      }
    };

    this.shadowRoot.getElementById("save-click-btn").addEventListener("click", submitClick);
    this.shadowRoot.getElementById("click-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitClick();
    });

    this.shadowRoot.getElementById("cancel-click-btn").addEventListener("click", () => this._closeModal());
  }

  _syncPeopleOptions() {
    if (!this._hass) return;
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) return;
    const people = stateObj.attributes.people || ["Commun"];
    const key = people.join("|");
    if (this._lastPeopleKey === key) return;
    this._lastPeopleKey = key;

    const personInput = this.shadowRoot.getElementById("person-input");
    const personFilter = this.shadowRoot.getElementById("person-filter");
    if (personInput && personFilter) {
      personInput.innerHTML = people.map((p) => `<option value="${p}">${p}</option>`).join("");
      personFilter.innerHTML =
        `<option value="all">Toutes les personnes</option>` +
        people.map((p) => `<option value="${p}">${p}</option>`).join("");
    }
  }

  _closeModal() {
    this._pendingCoords = null;
    this.shadowRoot.getElementById("click-modal").classList.remove("open");
    this.shadowRoot.getElementById("click-name").value = "";
    this.shadowRoot.getElementById("click-notes").value = "";
  }

  _initMap() {
    const stateObj = this._hass?.states[this._config.entity];
    const homeLat = this._hass?.config?.latitude ?? 45.764;
    const homeLon = this._hass?.config?.longitude ?? 4.8357;

    const lat = this._config.lat ?? stateObj?.attributes?.default_latitude ?? homeLat;
    const lon = this._config.lon ?? stateObj?.attributes?.default_longitude ?? homeLon;
    const zoom = this._config.zoom ?? stateObj?.attributes?.default_zoom ?? 6;

    const mapEl = this.shadowRoot.getElementById("map");
    this._map = window.L.map(mapEl).setView([lat, lon], zoom);
    this._applyTileLayer();

    this._markersLayer = window.L.layerGroup().addTo(this._map);

    this._map.on("click", (e) => {
      this._pendingCoords = e.latlng;
      this.shadowRoot.getElementById("click-coords").textContent =
        `📍 ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      this.shadowRoot.getElementById("click-modal").classList.add("open");
      this.shadowRoot.getElementById("click-name").focus();
    });

    this._syncPeopleOptions();
    this._updateMarkers();
  }

  _createPinIcon(visited) {
    const color = visited ? "#2e7d32" : "#ef6c00";
    return window.L.divIcon({
      className: "custom-pin",
      html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.45);"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  _updateMarkers() {
    if (!this._map || !this._markersLayer || !this._hass) return;
    const stateObj = this._hass.states[this._config.entity];
    if (!stateObj) {
      this.shadowRoot.getElementById("stats").textContent =
        `⚠️ Entité introuvable : ${this._config.entity}`;
      return;
    }

    if (!this._viewCentered && this._config.lat === null && stateObj.attributes.default_latitude !== undefined) {
      this._viewCentered = true;
      this._map.setView(
        [stateObj.attributes.default_latitude, stateObj.attributes.default_longitude],
        stateObj.attributes.default_zoom || 6
      );
    }

    const places = stateObj.attributes.places || [];
    const visitedCount = stateObj.attributes.visited_count || 0;
    const wishlistCount = stateObj.attributes.wishlist_count || 0;

    this.shadowRoot.getElementById("stats").textContent =
      `✅ ${visitedCount} visité(s) • 📌 ${wishlistCount} à visiter (Cliquez sur la carte pour ajouter)`;

    this._markersLayer.clearLayers();

    places
      .filter((p) => {
        if (this._filter === "visited" && !p.visited) return false;
        if (this._filter === "wishlist" && p.visited) return false;
        if (this._personFilter !== "all" && p.person !== this._personFilter) return false;
        return true;
      })
      .forEach((place) => {
        const marker = window.L.marker([place.latitude, place.longitude], {
          icon: this._createPinIcon(place.visited),
        });

        const container = document.createElement("div");
        container.innerHTML = `
          <strong>${place.name}</strong><br/>
          <small>${place.category} • ${place.person || "Commun"} ${place.visited_date ? "• " + place.visited_date : ""}</small><br/>
          ${place.notes ? `<em>${place.notes}</em><br/>` : ""}
        `;

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "popup-btn";
        toggleBtn.style.background = place.visited ? "#ef6c00" : "#2e7d32";
        toggleBtn.style.color = "#fff";
        toggleBtn.textContent = place.visited ? "Marquer à visiter" : "Marquer visité";
        toggleBtn.onclick = async () => {
          await this._hass.callService("visited_places", "toggle_visited", { place_id: place.id });
          this._map.closePopup();
          this._showFeedback(`Statut mis à jour pour "${place.name}"`);
        };

        const delBtn = document.createElement("button");
        delBtn.className = "popup-btn";
        delBtn.style.background = "#c62828";
        delBtn.style.color = "#fff";
        delBtn.textContent = "Supprimer";
        delBtn.onclick = async () => {
          await this._hass.callService("visited_places", "remove_place", { place_id: place.id });
          this._map.closePopup();
          this._showFeedback(`"${place.name}" supprimé`);
        };

        container.appendChild(toggleBtn);
        container.appendChild(delBtn);
        marker.bindPopup(container);
        marker.addTo(this._markersLayer);
      });
  }

  getCardSize() {
    return 8;
  }
}

customElements.define("visited-places-card", VisitedPlacesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "visited-places-card",
  name: "Visited Places Map",
  description: "Carte interactive des lieux visités et à visiter avec ajout par clic ou recherche.",
  preview: true,
});
