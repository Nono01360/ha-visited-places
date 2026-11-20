const DEFAULT_ENTITY = "sensor.visited_places";

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
          Titre du carnet
          <input id="ed-title" type="text" value="${this._config.title || "BeenThere • Mes Voyages"}"
            style="padding:8px; border-radius:8px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Entité capteur
          <input id="ed-entity" type="text" value="${this._config.entity || DEFAULT_ENTITY}"
            style="padding:8px; border-radius:8px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Hauteur de la carte (ex: 560px)
          <input id="ed-height" type="text" value="${this._config.height || "560px"}"
            style="padding:8px; border-radius:8px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);" />
        </label>
        <label style="display:flex; flex-direction:column; gap:4px; font-weight:500;">
          Thème visuel de la carte (sans clé API)
          <select id="ed-style"
            style="padding:8px; border-radius:8px; border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color);">
            <option value="beenthere_light" ${(this._config.map_style || "beenthere_light") === "beenthere_light" ? "selected" : ""}>BeenThere Épuré Clair (Esri Light Gray)</option>
            <option value="beenthere_dark" ${this._config.map_style === "beenthere_dark" ? "selected" : ""}>BeenThere Sombre (Esri Dark Gray)</option>
            <option value="street" ${this._config.map_style === "street" ? "selected" : ""}>Plan Détaillé (Esri World Street)</option>
            <option value="satellite" ${this._config.map_style === "satellite" ? "selected" : ""}>Satellite (Esri World Imagery)</option>
          </select>
        </label>
        <label style="display:flex; align-items:center; gap:8px; font-weight:500;">
          <input id="ed-labels" type="checkbox" ${this._config.show_labels !== false ? "checked" : ""} />
          Afficher en permanence le nom des lieux sur la carte
        </label>
      </div>
    `;

    ["ed-title", "ed-entity", "ed-height", "ed-style", "ed-labels"].forEach((id) => {
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
      show_labels: this.querySelector("#ed-labels").checked,
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
      title: "BeenThere • Mes Voyages",
      entity: DEFAULT_ENTITY,
      height: "560px",
      map_style: "beenthere_light",
      show_labels: true,
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._map = null;
    this._tileLayer = null;
    this._labelsLayer = null;
    this._markersLayer = null;
    this._filter = "all";
    this._personFilter = "all";
    this._pendingCoords = null;
    this._initialized = false;
    this._viewCentered = false;
    this._drawerOpen = false;
  }

  setConfig(config) {
    this._config = {
      entity: config.entity || DEFAULT_ENTITY,
      title: config.title || "BeenThere • Mes Voyages",
      height: config.height || "560px",
      map_style: config.map_style || "beenthere_light",
      show_labels: config.show_labels !== false,
      lat: config.lat || null,
      lon: config.lon || null,
      zoom: config.zoom || null,
    };
    if (this._initialized) {
      const titleEl = this.shadowRoot.querySelector(".bt-title");
      if (titleEl) titleEl.textContent = this._config.title;
      const mapEl = this.shadowRoot.getElementById("map");
      if (mapEl) mapEl.style.height = this._config.height;
      this._applyTileLayer();
      this._updateMarkers();
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

  _resolveEntityState() {
    if (!this._hass) return null;
    if (this._hass.states[this._config.entity]) {
      return this._hass.states[this._config.entity];
    }
    const fallback = Object.keys(this._hass.states).find((id) =>
      id.startsWith("sensor.visited_places")
    );
    return fallback ? this._hass.states[fallback] : null;
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
    const style = this._config.map_style || "beenthere_light";
    if (style === "beenthere_dark") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri, HERE, Garmin",
        maxZoom: 16,
      };
    }
    if (style === "street" || style === "voyager") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri, HERE, Garmin",
        maxZoom: 18,
      };
    }
    if (style === "satellite") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        maxZoom: 18,
      };
    }
    return {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      attr: "&copy; Esri, HERE, Garmin",
      maxZoom: 16,
    };
  }

  _applyTileLayer() {
    if (!this._map || !window.L) return;
    if (this._tileLayer) {
      this._map.removeLayer(this._tileLayer);
      this._tileLayer = null;
    }
    if (this._labelsLayer) {
      this._map.removeLayer(this._labelsLayer);
      this._labelsLayer = null;
    }
    const cfg = this._getTileConfig();
    const opts = { attribution: cfg.attr, maxZoom: cfg.maxZoom || 18 };
    this._tileLayer = window.L.tileLayer(cfg.url, opts).addTo(this._map);
    if (cfg.labelsUrl) {
      this._labelsLayer = window.L.tileLayer(cfg.labelsUrl, opts).addTo(this._map);
    }
  }

  _showFeedback(msg, isError = false) {
    const banner = this.shadowRoot.getElementById("feedback-banner");
    if (!banner) return;
    banner.textContent = msg;
    banner.style.display = msg ? "block" : "none";
    banner.style.background = isError ? "#e53935" : "#00897b";
    if (msg) {
      clearTimeout(this._feedbackTimer);
      this._feedbackTimer = setTimeout(() => {
        banner.style.display = "none";
      }, 4000);
    }
  }

  _getCategoryEmoji(cat) {
    const map = {
      Ville: "🏙️",
      Monument: "🏛️",
      Nature: "🏔️",
      Restaurant: "🍽️",
      Musée: "🖼️",
      Autre: "📍",
    };
    return map[cat] || "📍";
  }

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>
        :host {
          --bt-visited: #10b981;
          --bt-visited-bg: rgba(16, 185, 129, 0.14);
          --bt-wish: #f59e0b;
          --bt-wish-bg: rgba(245, 158, 11, 0.14);
        }
        ha-card {
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border-radius: 16px;
          position: relative;
        }
        .bt-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 16px;
          background: var(--card-background-color);
          border-bottom: 1px solid var(--divider-color);
        }
        .bt-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .bt-logo {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: linear-gradient(135deg, #10b981, #0d9488);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
        }
        .bt-title {
          font-size: 1.08rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .bt-subtitle {
          font-size: 0.78rem;
          color: var(--secondary-text-color);
        }
        .bt-stats-pills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 11px;
          border-radius: 999px;
          font-size: 0.8rem;
          font-weight: 600;
        }
        .pill.visited { background: var(--bt-visited-bg); color: #059669; }
        .pill.wish { background: var(--bt-wish-bg); color: #d97706; }
        .pill.countries { background: rgba(59, 130, 246, 0.12); color: #2563eb; }

        .bt-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px 14px;
          background: var(--secondary-background-color);
          border-bottom: 1px solid var(--divider-color);
          align-items: center;
        }
        .bt-search-box {
          display: flex;
          flex: 1;
          min-width: 210px;
          gap: 6px;
        }
        input, select {
          padding: 7px 11px;
          border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 0.84rem;
          outline: none;
        }
        input:focus, select:focus {
          border-color: #10b981;
        }
        button {
          padding: 7px 12px;
          border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 0.83rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        button:hover { opacity: 0.9; }
        button.primary {
          background: #10b981;
          color: #fff;
          border: none;
        }
        .seg-group {
          display: inline-flex;
          background: var(--card-background-color);
          border-radius: 10px;
          padding: 2px;
          border: 1px solid var(--divider-color);
        }
        .seg-group button {
          border: none;
          border-radius: 8px;
          padding: 5px 10px;
          background: transparent;
          font-size: 0.8rem;
        }
        .seg-group button.active {
          background: #10b981;
          color: #fff;
        }

        .map-wrapper {
          position: relative;
          width: 100%;
        }
        #map {
          width: 100%;
          height: ${this._config.height};
          z-index: 1;
        }
        .bt-pin-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: translate(-50%, -50%);
          pointer-events: auto;
        }
        .bt-pin-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: #fff;
          border: 2.5px solid #ffffff;
          box-shadow: 0 3px 10px rgba(0,0,0,0.3);
          transition: transform 0.15s ease;
        }
        .bt-pin-wrap:hover .bt-pin-dot {
          transform: scale(1.18);
        }
        .bt-pin-label {
          margin-top: 3px;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.95);
          color: #1f2937;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0,0,0,0.22);
          border: 1px solid rgba(0,0,0,0.08);
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bt-list-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          background: var(--card-background-color);
          border-top: 1px solid var(--divider-color);
          cursor: pointer;
          user-select: none;
        }
        .bt-places-list {
          display: none;
          max-height: 240px;
          overflow-y: auto;
          padding: 8px 14px 14px;
          gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          background: var(--secondary-background-color);
          border-top: 1px solid var(--divider-color);
        }
        .bt-places-list.open {
          display: grid;
        }
        .place-card {
          background: var(--card-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          cursor: pointer;
          transition: transform 0.12s ease;
        }
        .place-card:hover {
          transform: translateY(-1px);
          border-color: #10b981;
        }
        .place-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        .place-name {
          font-weight: 700;
          font-size: 0.9rem;
        }
        .place-meta {
          font-size: 0.76rem;
          color: var(--secondary-text-color);
        }

        .modal {
          display: none;
          padding: 10px 14px;
          background: var(--card-background-color);
          border-bottom: 1px solid var(--divider-color);
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .modal.open { display: flex; }
        .feedback {
          display: none;
          padding: 8px 14px;
          color: #fff;
          font-size: 0.83rem;
          font-weight: 600;
        }
        .popup-btn {
          margin-top: 6px;
          padding: 5px 9px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          margin-right: 4px;
        }
      </style>
      <ha-card>
        <div class="bt-header">
          <div class="bt-brand">
            <div class="bt-logo">🌍</div>
            <div>
              <div class="bt-title">${this._config.title}</div>
              <div class="bt-subtitle">Cliquez n'importe où sur la carte pour épingler un souvenir</div>
            </div>
          </div>
          <div class="bt-stats-pills">
            <span class="pill visited" id="stat-visited">✅ 0 visités</span>
            <span class="pill wish" id="stat-wishlist">📌 0 à visiter</span>
            <span class="pill countries" id="stat-countries">🏳️ 0 pays</span>
          </div>
        </div>

        <div class="bt-bar">
          <div class="bt-search-box">
            <input type="text" id="search-input" placeholder="Ajouter une ville, un lieu, un pays..." style="flex:1;" />
            <select id="category-input">
              <option value="Ville">🏙️ Ville</option>
              <option value="Monument">🏛️ Monument</option>
              <option value="Nature">🏔️ Nature</option>
              <option value="Restaurant">🍽️ Resto</option>
              <option value="Musée">🖼️ Musée</option>
              <option value="Autre">📍 Autre</option>
            </select>
            <select id="person-input"></select>
            <label style="display:flex; align-items:center; gap:4px; font-size:0.82rem; font-weight:600;">
              <input type="checkbox" id="visited-checkbox" checked /> Visité
            </label>
            <button class="primary" id="add-search-btn">+ Épingler</button>
          </div>

          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <select id="person-filter">
              <option value="all">Tous les voyageurs</option>
            </select>
            <div class="seg-group">
              <button data-filter="all" class="active">Tous</button>
              <button data-filter="visited">Visités</button>
              <button data-filter="wishlist">À visiter</button>
            </div>
          </div>
        </div>

        <div class="feedback" id="feedback-banner"></div>

        <div class="modal" id="click-modal">
          <span id="click-coords" style="font-size:0.8rem; font-weight:700; color:#10b981;"></span>
          <input type="text" id="click-name" placeholder="Nom de ce lieu (ex: Plage de Palombaggia)..." style="flex:1; min-width:170px;" />
          <input type="text" id="click-notes" placeholder="Souvenir / Note..." style="min-width:140px;" />
          <label style="display:flex; align-items:center; gap:4px; font-size:0.83rem; font-weight:600;">
            <input type="checkbox" id="click-visited" checked /> Visité
          </label>
          <button class="primary" id="save-click-btn">Enregistrer</button>
          <button id="cancel-click-btn">Annuler</button>
        </div>

        <div class="map-wrapper">
          <div id="map"></div>
        </div>

        <div class="bt-list-bar" id="toggle-drawer">
          <span style="font-weight:700; font-size:0.88rem;" id="drawer-label">📋 Voir la liste complète des lieux (0)</span>
          <span id="drawer-arrow" style="font-size:0.85rem; color:var(--secondary-text-color);">▼ Ouvrir</span>
        </div>
        <div class="bt-places-list" id="places-list"></div>
      </ha-card>
    `;

    this.shadowRoot.getElementById("toggle-drawer").addEventListener("click", () => {
      this._drawerOpen = !this._drawerOpen;
      this.shadowRoot.getElementById("places-list").classList.toggle("open", this._drawerOpen);
      this.shadowRoot.getElementById("drawer-arrow").textContent = this._drawerOpen ? "▲ Fermer" : "▼ Ouvrir";
    });

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
      btnEl.textContent = "⏳...";
      try {
        await this._hass.callService("visited_places", "add_place", {
          name,
          query: name,
          category,
          person,
          visited,
        });
        inputEl.value = "";
        this._showFeedback(`"${name}" ajouté à votre carte !`);
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
        this._showFeedback(`"${name}" enregistré !`);
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
    const stateObj = this._resolveEntityState();
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
        `<option value="all">Tous les voyageurs</option>` +
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
    const stateObj = this._resolveEntityState();
    const homeLat = this._hass?.config?.latitude ?? 45.764;
    const homeLon = this._hass?.config?.longitude ?? 4.8357;

    const lat = this._config.lat ?? stateObj?.attributes?.default_latitude ?? homeLat;
    const lon = this._config.lon ?? stateObj?.attributes?.default_longitude ?? homeLon;
    const zoom = this._config.zoom ?? stateObj?.attributes?.default_zoom ?? 5;

    const mapEl = this.shadowRoot.getElementById("map");
    this._map = window.L.map(mapEl).setView([lat, lon], zoom);
    this._applyTileLayer();

    this._markersLayer = window.L.layerGroup().addTo(this._map);

    this._map.on("click", (e) => {
      this._pendingCoords = e.latlng;
      this.shadowRoot.getElementById("click-coords").textContent =
        `📍 ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      this.shadowRoot.getElementById("click-modal").classList.add("open");
      this.shadowRoot.getElementById("click-name").focus();
    });

    this._syncPeopleOptions();
    this._updateMarkers();
  }

  _createBeenTherePin(place) {
    const color = place.visited ? "#10b981" : "#f59e0b";
    const emoji = this._getCategoryEmoji(place.category);
    const labelHtml = this._config.show_labels
      ? `<div class="bt-pin-label">${place.name}</div>`
      : "";

    return window.L.divIcon({
      className: "bt-custom-pin",
      html: `
        <div class="bt-pin-wrap">
          <div class="bt-pin-dot" style="background:${color};">${emoji}</div>
          ${labelHtml}
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  _updateMarkers() {
    if (!this._map || !this._markersLayer || !this._hass) return;
    const stateObj = this._resolveEntityState();
    if (!stateObj) {
      this.shadowRoot.getElementById("stat-visited").textContent = `⚠️ Entité ${this._config.entity} introuvable`;
      return;
    }

    if (!this._viewCentered && this._config.lat === null && stateObj.attributes.default_latitude !== undefined) {
      this._viewCentered = true;
      this._map.setView(
        [stateObj.attributes.default_latitude, stateObj.attributes.default_longitude],
        stateObj.attributes.default_zoom || 5
      );
    }

    const places = stateObj.attributes.places || [];
    const visitedCount = stateObj.attributes.visited_count || 0;
    const wishlistCount = stateObj.attributes.wishlist_count || 0;
    const countriesCount = stateObj.attributes.countries_count || 0;

    this.shadowRoot.getElementById("stat-visited").textContent = `✅ ${visitedCount} visité${visitedCount > 1 ? "s" : ""}`;
    this.shadowRoot.getElementById("stat-wishlist").textContent = `📌 ${wishlistCount} à visiter`;
    this.shadowRoot.getElementById("stat-countries").textContent = `🏳️ ${countriesCount} pays`;

    const filtered = places.filter((p) => {
      if (this._filter === "visited" && !p.visited) return false;
      if (this._filter === "wishlist" && p.visited) return false;
      if (this._personFilter !== "all" && p.person !== this._personFilter) return false;
      return true;
    });

    this.shadowRoot.getElementById("drawer-label").textContent =
      `📋 Liste des lieux affichés (${filtered.length})`;

    this._markersLayer.clearLayers();
    const listEl = this.shadowRoot.getElementById("places-list");
    listEl.innerHTML = "";

    filtered.forEach((place) => {
      const marker = window.L.marker([place.latitude, place.longitude], {
        icon: this._createBeenTherePin(place),
      });

      const container = document.createElement("div");
      container.style.minWidth = "180px";
      container.innerHTML = `
        <div style="font-size:14px; font-weight:700; margin-bottom:2px;">${this._getCategoryEmoji(place.category)} ${place.name}</div>
        <div style="font-size:11px; color:#6b7280;">
          ${place.country ? place.country + " • " : ""}${place.person || "Commun"}${place.visited_date ? " • " + place.visited_date : ""}
        </div>
        ${place.notes ? `<div style="font-size:12px; font-style:italic; margin-top:4px;">« ${place.notes} »</div>` : ""}
      `;

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "popup-btn";
      toggleBtn.style.background = place.visited ? "#f59e0b" : "#10b981";
      toggleBtn.style.color = "#fff";
      toggleBtn.textContent = place.visited ? "Passer à visiter" : "Marquer visité";
      toggleBtn.onclick = async () => {
        await this._hass.callService("visited_places", "toggle_visited", { place_id: place.id });
        this._map.closePopup();
        this._showFeedback(`Statut mis à jour pour "${place.name}"`);
      };

      const delBtn = document.createElement("button");
      delBtn.className = "popup-btn";
      delBtn.style.background = "#ef4444";
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

      const card = document.createElement("div");
      card.className = "place-card";
      card.innerHTML = `
        <div class="place-card-top">
          <span class="place-name">${this._getCategoryEmoji(place.category)} ${place.name}</span>
          <span style="font-size:11px; font-weight:700; color:${place.visited ? "#10b981" : "#f59e0b"};">
            ${place.visited ? "Visité" : "À visiter"}
          </span>
        </div>
        <div class="place-meta">
          ${place.country ? place.country + " • " : ""}${place.person || "Commun"}${place.visited_date ? " • " + place.visited_date : ""}
        </div>
        ${place.notes ? `<div class="place-meta" style="font-style:italic;">${place.notes}</div>` : ""}
      `;
      card.addEventListener("click", () => {
        this._map.flyTo([place.latitude, place.longitude], 11, { duration: 0.8 });
        marker.openPopup();
      });
      listEl.appendChild(card);
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
  name: "Visited Places Map (BeenThere)",
  description: "Carte interactive style BeenThere avec noms visibles, statistiques par pays et carnet de voyage.",
  preview: true,
});
