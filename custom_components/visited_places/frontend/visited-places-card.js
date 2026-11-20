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
          Thème visuel de la carte
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
        <label style="display:flex; align-items:center; gap:8px; font-weight:500;">
          <input id="ed-compact" type="checkbox" ${this._config.compact ? "checked" : ""} />
          Masquer la barre d'ajout/filtres (carte pure)
        </label>
      </div>
    `;

    ["ed-title", "ed-entity", "ed-style", "ed-labels", "ed-compact"].forEach((id) => {
      this.querySelector(`#${id}`).addEventListener("change", () => this._valueChanged());
    });
  }

  _valueChanged() {
    const newConfig = {
      ...this._config,
      title: this.querySelector("#ed-title").value,
      entity: this.querySelector("#ed-entity").value,
      map_style: this.querySelector("#ed-style").value,
      show_labels: this.querySelector("#ed-labels").checked,
      compact: this.querySelector("#ed-compact").checked,
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
      map_style: "beenthere_light",
      show_labels: true,
      compact: false,
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._map = null;
    this._tileLayer = null;
    this._labelsLayer = null;
    this._markersLayer = null;
    this._resizeObserver = null;
    this._filter = "all";
    this._personFilter = "all";
    this._pendingCoords = null;
    this._initialized = false;
    this._userInteracted = false;
    this._viewCentered = false;
    this._drawerOpen = false;
    this._lastPlacesSignature = null;
  }

  connectedCallback() {
    if (this._map) {
      requestAnimationFrame(() => this._map && this._map.invalidateSize(false));
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  setConfig(config) {
    const prevStyle = this._config?.map_style;
    const prevCompact = this._config?.compact;
    this._config = {
      entity: config.entity || DEFAULT_ENTITY,
      title: config.title !== undefined ? config.title : "BeenThere • Mes Voyages",
      map_style: config.map_style || "beenthere_light",
      show_labels: config.show_labels !== false,
      compact: Boolean(config.compact),
      lat: config.lat ?? null,
      lon: config.lon ?? null,
      zoom: config.zoom ?? null,
    };
    if (this._initialized) {
      const titleEl = this.shadowRoot.querySelector(".bt-title");
      if (titleEl) titleEl.textContent = this._config.title;
      if (prevCompact !== this._config.compact) {
        const barEl = this.shadowRoot.querySelector(".bt-bar");
        if (barEl) barEl.style.display = this._config.compact ? "none" : "flex";
      }
      if (prevStyle !== this._config.map_style) {
        this._applyTileLayer();
      }
      this._updateMarkers(true);
      requestAnimationFrame(() => this._map && this._map.invalidateSize(false));
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._renderShell();
      this._resolveLeaflet().then((L) => {
        if (L) this._initMap(L);
      });
    } else {
      this._syncPeopleOptions();
      this._updateMarkers(false);
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

  _getLocalLeafletUrls() {
    const frontendUrl =
      this._hass?.config?.frontend_url ||
      document.querySelector("home-assistant")?.hass?.config?.frontend_url ||
      "/frontend_latest";
    return {
      js: `${frontendUrl}/leaflet.js`,
      css: `${frontendUrl}/leaflet.css`,
    };
  }

  async _resolveLeaflet() {
    if (window.L) return window.L;

    // 1. Tente de charger le bundle Leaflet natif déjà présent dans Home Assistant (0 ms réseau externe)
    if (!window._btLeafletPromise) {
      window._btLeafletPromise = (async () => {
        const local = this._getLocalLeafletUrls();
        this._injectLeafletCss(local.css);

        try {
          const mod = await import(/* @vite-ignore */ local.js);
          const L = mod.default || mod.L || window.L;
          if (L && typeof L.map === "function") {
            window.L = L;
            return L;
          }
        } catch (_e) {
          // Fallback script local puis CDN rapide si nécessaire
        }

        const loadScript = (src) =>
          new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = () => (window.L ? resolve(window.L) : reject());
            s.onerror = reject;
            document.head.appendChild(s);
          });

        try {
          return await loadScript(local.js);
        } catch (_e2) {
          this._injectLeafletCss("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css");
          return await loadScript("https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js");
        }
      })();
    }

    return window._btLeafletPromise;
  }

  _injectLeafletCss(href) {
    if (!this.shadowRoot.getElementById("bt-leaflet-css")) {
      const link = document.createElement("link");
      link.id = "bt-leaflet-css";
      link.rel = "stylesheet";
      link.href = href;
      this.shadowRoot.prepend(link);
    }
  }

  _getTileConfig() {
    const style = this._config.map_style || "beenthere_light";
    if (style === "beenthere_dark") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
        maxZoom: 16,
      };
    }
    if (style === "street" || style === "voyager") {
      return {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        attr: "&copy; Esri",
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
      attr: "&copy; Esri",
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
    const opts = {
      attribution: cfg.attr,
      maxZoom: cfg.maxZoom || 18,
      updateWhenIdle: false,
      keepBuffer: 2,
    };
    this._tileLayer = window.L.tileLayer(cfg.url, opts).addTo(this._map);
    if (cfg.labelsUrl) {
      this._labelsLayer = window.L.tileLayer(cfg.labelsUrl, opts).addTo(this._map);
    }
  }

  _recenterDefault() {
    if (!this._map) return;
    const stateObj = this._resolveEntityState();
    const homeLat = this._hass?.config?.latitude ?? 45.764;
    const homeLon = this._hass?.config?.longitude ?? 4.8357;
    const lat = this._config.lat ?? stateObj?.attributes?.default_latitude ?? homeLat;
    const lon = this._config.lon ?? stateObj?.attributes?.default_longitude ?? homeLon;
    const zoom = this._config.zoom ?? stateObj?.attributes?.default_zoom ?? 5;
    this._map.flyTo([lat, lon], zoom, { duration: 0.6 });
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
      }, 3500);
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
    const localCss = this._getLocalLeafletUrls().css;
    this.shadowRoot.innerHTML = `
      <link id="bt-leaflet-css" rel="stylesheet" href="${localCss}" />
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 220px;
          box-sizing: border-box;
          --bt-visited: #10b981;
          --bt-visited-bg: rgba(16, 185, 129, 0.14);
          --bt-wish: #f59e0b;
          --bt-wish-bg: rgba(245, 158, 11, 0.14);
        }
        ha-card {
          width: 100%;
          height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border-radius: var(--ha-card-border-radius, 12px);
          position: relative;
          box-sizing: border-box;
        }
        .bt-header {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 14px;
          background: var(--card-background-color);
          border-bottom: 1px solid var(--divider-color);
        }
        .bt-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .bt-logo {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          border-radius: 8px;
          background: linear-gradient(135deg, #10b981, #0d9488);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
        }
        .bt-title {
          font-size: 0.98rem;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .bt-stats-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 0.76rem;
          font-weight: 600;
        }
        .pill.visited { background: var(--bt-visited-bg); color: #059669; }
        .pill.wish { background: var(--bt-wish-bg); color: #d97706; }
        .pill.countries { background: rgba(59, 130, 246, 0.12); color: #2563eb; }

        .bt-bar {
          flex: 0 0 auto;
          display: ${this._config.compact ? "none" : "flex"};
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 12px;
          background: var(--secondary-background-color);
          border-bottom: 1px solid var(--divider-color);
          align-items: center;
        }
        .bt-search-box {
          display: flex;
          flex: 1 1 200px;
          min-width: 0;
          gap: 6px;
          flex-wrap: wrap;
        }
        input, select {
          padding: 6px 9px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 0.82rem;
          outline: none;
          min-width: 0;
        }
        input:focus, select:focus {
          border-color: #10b981;
        }
        button {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
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
          border-radius: 8px;
          padding: 2px;
          border: 1px solid var(--divider-color);
        }
        .seg-group button {
          border: none;
          border-radius: 6px;
          padding: 4px 8px;
          background: transparent;
          font-size: 0.78rem;
        }
        .seg-group button.active {
          background: #10b981;
          color: #fff;
        }

        /* La zone carte occupe exactement l'espace restant attribué par Home Assistant */
        .map-wrapper {
          position: relative;
          flex: 1 1 auto;
          width: 100%;
          min-height: 160px;
          overflow: hidden;
        }
        #map {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 1;
          touch-action: none;
        }
        .recenter-btn {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 500;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          padding: 5px 9px;
          font-size: 0.78rem;
          font-weight: 700;
          box-shadow: 0 2px 6px rgba(0,0,0,0.18);
          cursor: pointer;
        }
        .bt-pin-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          transform: translate(-50%, -50%);
          pointer-events: auto;
        }
        .bt-pin-dot {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #fff;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .bt-pin-label {
          margin-top: 2px;
          padding: 1px 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.95);
          color: #1f2937;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          max-width: 130px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .bt-list-bar {
          flex: 0 0 auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px;
          background: var(--card-background-color);
          border-top: 1px solid var(--divider-color);
          cursor: pointer;
          user-select: none;
        }
        .bt-places-list {
          display: none;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 35px;
          max-height: 55%;
          overflow-y: auto;
          padding: 10px 12px;
          gap: 8px;
          grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
          background: var(--card-background-color);
          border-top: 1px solid var(--divider-color);
          box-shadow: 0 -4px 16px rgba(0,0,0,0.18);
          z-index: 600;
        }
        .bt-places-list.open {
          display: grid;
        }
        .place-card {
          background: var(--secondary-background-color);
          border: 1px solid var(--divider-color);
          border-radius: 10px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          cursor: pointer;
        }
        .place-card:hover {
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
          font-size: 0.85rem;
        }
        .place-meta {
          font-size: 0.74rem;
          color: var(--secondary-text-color);
        }

        .modal {
          flex: 0 0 auto;
          display: none;
          padding: 8px 12px;
          background: var(--card-background-color);
          border-bottom: 1px solid var(--divider-color);
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .modal.open { display: flex; }
        .feedback {
          flex: 0 0 auto;
          display: none;
          padding: 6px 12px;
          color: #fff;
          font-size: 0.8rem;
          font-weight: 600;
        }
        .popup-btn {
          margin-top: 6px;
          padding: 4px 8px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          margin-right: 4px;
        }
      </style>
      <ha-card>
        <div class="bt-header">
          <div class="bt-brand">
            <div class="bt-logo">🌍</div>
            <div class="bt-title">${this._config.title}</div>
          </div>
          <div class="bt-stats-pills">
            <span class="pill visited" id="stat-visited">✅ 0</span>
            <span class="pill wish" id="stat-wishlist">📌 0</span>
            <span class="pill countries" id="stat-countries">🏳️ 0 pays</span>
          </div>
        </div>

        <div class="bt-bar">
          <div class="bt-search-box">
            <input type="text" id="search-input" placeholder="Ajouter une ville, un lieu..." style="flex:1 1 120px;" />
            <select id="category-input">
              <option value="Ville">🏙️ Ville</option>
              <option value="Monument">🏛️ Monument</option>
              <option value="Nature">🏔️ Nature</option>
              <option value="Restaurant">🍽️ Resto</option>
              <option value="Musée">🖼️ Musée</option>
              <option value="Autre">📍 Autre</option>
            </select>
            <select id="person-input"></select>
            <label style="display:flex; align-items:center; gap:4px; font-size:0.8rem; font-weight:600;">
              <input type="checkbox" id="visited-checkbox" checked /> Visité
            </label>
            <button class="primary" id="add-search-btn">+ Épingler</button>
          </div>

          <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <select id="person-filter">
              <option value="all">Tous</option>
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
          <span id="click-coords" style="font-size:0.78rem; font-weight:700; color:#10b981;"></span>
          <input type="text" id="click-name" placeholder="Nom de ce lieu..." style="flex:1 1 130px;" />
          <input type="text" id="click-notes" placeholder="Note..." style="flex:1 1 100px;" />
          <label style="display:flex; align-items:center; gap:4px; font-size:0.8rem; font-weight:600;">
            <input type="checkbox" id="click-visited" checked /> Visité
          </label>
          <button class="primary" id="save-click-btn">OK</button>
          <button id="cancel-click-btn">✕</button>
        </div>

        <div class="map-wrapper" id="map-wrapper">
          <button class="recenter-btn" id="recenter-btn" title="Recentrer">🎯</button>
          <div id="map"></div>
        </div>

        <div class="bt-places-list" id="places-list"></div>
        <div class="bt-list-bar" id="toggle-drawer">
          <span style="font-weight:700; font-size:0.82rem;" id="drawer-label">📋 Lieux affichés (0)</span>
          <span id="drawer-arrow" style="font-size:0.8rem; color:var(--secondary-text-color);">▲ Liste</span>
        </div>
      </ha-card>
    `;

    this.shadowRoot.getElementById("recenter-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      this._recenterDefault();
    });

    this.shadowRoot.getElementById("toggle-drawer").addEventListener("click", () => {
      this._drawerOpen = !this._drawerOpen;
      this.shadowRoot.getElementById("places-list").classList.toggle("open", this._drawerOpen);
      this.shadowRoot.getElementById("drawer-arrow").textContent = this._drawerOpen ? "▼ Fermer" : "▲ Liste";
    });

    this.shadowRoot.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this._filter = e.target.dataset.filter;
        this.shadowRoot.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this._updateMarkers(true);
      });
    });

    this.shadowRoot.getElementById("person-filter").addEventListener("change", (e) => {
      this._personFilter = e.target.value;
      this._updateMarkers(true);
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
      btnEl.textContent = "⏳";
      try {
        await this._hass.callService("visited_places", "add_place", {
          name,
          query: name,
          category,
          person,
          visited,
        });
        inputEl.value = "";
        this._showFeedback(`"${name}" ajouté !`);
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
        `<option value="all">Tous</option>` +
        people.map((p) => `<option value="${p}">${p}</option>`).join("");
    }
  }

  _closeModal() {
    this._pendingCoords = null;
    this.shadowRoot.getElementById("click-modal").classList.remove("open");
    this.shadowRoot.getElementById("click-name").value = "";
    this.shadowRoot.getElementById("click-notes").value = "";
  }

  _initMap(L) {
    const stateObj = this._resolveEntityState();
    const homeLat = this._hass?.config?.latitude ?? 45.764;
    const homeLon = this._hass?.config?.longitude ?? 4.8357;

    const lat = this._config.lat ?? stateObj?.attributes?.default_latitude ?? homeLat;
    const lon = this._config.lon ?? stateObj?.attributes?.default_longitude ?? homeLon;
    const zoom = this._config.zoom ?? stateObj?.attributes?.default_zoom ?? 5;

    const mapEl = this.shadowRoot.getElementById("map");
    const wrapperEl = this.shadowRoot.getElementById("map-wrapper");

    this._map = L.map(mapEl, {
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      zoomAnimation: false,
    }).setView([lat, lon], zoom);

    if (stateObj?.attributes?.default_latitude !== undefined || this._config.lat !== null) {
      this._viewCentered = true;
    }

    this._map.on("dragstart zoomstart", () => {
      this._userInteracted = true;
      this._viewCentered = true;
    });

    ["pointerdown", "mousedown", "touchstart"].forEach((evtName) => {
      mapEl.addEventListener(evtName, (e) => e.stopPropagation(), { passive: true });
    });

    // Adapte automatiquement Leaflet dès que Home Assistant redimensionne la carte ou la grille
    this._resizeObserver = new ResizeObserver(() => {
      if (this._map) {
        this._map.invalidateSize(false);
      }
    });
    this._resizeObserver.observe(wrapperEl);

    this._applyTileLayer();
    this._markersLayer = L.layerGroup().addTo(this._map);

    this._map.on("click", (e) => {
      this._pendingCoords = e.latlng;
      this.shadowRoot.getElementById("click-coords").textContent =
        `📍 ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      this.shadowRoot.getElementById("click-modal").classList.add("open");
      this.shadowRoot.getElementById("click-name").focus();
    });

    this._syncPeopleOptions();
    this._updateMarkers(true);
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

  _updateMarkers(forceRedraw = false) {
    if (!this._map || !this._markersLayer || !this._hass) return;
    const stateObj = this._resolveEntityState();
    if (!stateObj) {
      this.shadowRoot.getElementById("stat-visited").textContent = `⚠️ ${this._config.entity} introuvable`;
      return;
    }

    if (
      !this._viewCentered &&
      !this._userInteracted &&
      this._config.lat === null &&
      stateObj.attributes.default_latitude !== undefined
    ) {
      this._viewCentered = true;
      this._map.setView(
        [stateObj.attributes.default_latitude, stateObj.attributes.default_longitude],
        stateObj.attributes.default_zoom || 5,
        { animate: false }
      );
    }

    const places = stateObj.attributes.places || [];
    const signature = JSON.stringify({
      places,
      filter: this._filter,
      person: this._personFilter,
      labels: this._config.show_labels,
    });

    if (!forceRedraw && signature === this._lastPlacesSignature) {
      return;
    }
    this._lastPlacesSignature = signature;

    const visitedCount = stateObj.attributes.visited_count || 0;
    const wishlistCount = stateObj.attributes.wishlist_count || 0;
    const countriesCount = stateObj.attributes.countries_count || 0;

    this.shadowRoot.getElementById("stat-visited").textContent = `✅ ${visitedCount}`;
    this.shadowRoot.getElementById("stat-wishlist").textContent = `📌 ${wishlistCount}`;
    this.shadowRoot.getElementById("stat-countries").textContent = `🏳️ ${countriesCount} pays`;

    const filtered = places.filter((p) => {
      if (this._filter === "visited" && !p.visited) return false;
      if (this._filter === "wishlist" && p.visited) return false;
      if (this._personFilter !== "all" && p.person !== this._personFilter) return false;
      return true;
    });

    this.shadowRoot.getElementById("drawer-label").textContent =
      `📋 Lieux affichés (${filtered.length})`;

    this._markersLayer.clearLayers();
    const listEl = this.shadowRoot.getElementById("places-list");
    listEl.innerHTML = "";

    filtered.forEach((place) => {
      const marker = window.L.marker([place.latitude, place.longitude], {
        icon: this._createBeenTherePin(place),
      });

      const container = document.createElement("div");
      container.style.minWidth = "170px";
      container.innerHTML = `
        <div style="font-size:13px; font-weight:700; margin-bottom:2px;">${this._getCategoryEmoji(place.category)} ${place.name}</div>
        <div style="font-size:11px; color:#6b7280;">
          ${place.country ? place.country + " • " : ""}${place.person || "Commun"}${place.visited_date ? " • " + place.visited_date : ""}
        </div>
        ${place.notes ? `<div style="font-size:11px; font-style:italic; margin-top:4px;">« ${place.notes} »</div>` : ""}
      `;

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "popup-btn";
      toggleBtn.style.background = place.visited ? "#f59e0b" : "#10b981";
      toggleBtn.style.color = "#fff";
      toggleBtn.textContent = place.visited ? "À visiter" : "Visité";
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
          <span style="font-size:10px; font-weight:700; color:${place.visited ? "#10b981" : "#f59e0b"};">
            ${place.visited ? "Visité" : "À visiter"}
          </span>
        </div>
        <div class="place-meta">
          ${place.country ? place.country + " • " : ""}${place.person || "Commun"}
        </div>
      `;
      card.addEventListener("click", () => {
        this._userInteracted = true;
        this._drawerOpen = false;
        listEl.classList.remove("open");
        this.shadowRoot.getElementById("drawer-arrow").textContent = "▲ Liste";
        this._map.flyTo([place.latitude, place.longitude], 11, { duration: 0.7 });
        marker.openPopup();
      });
      listEl.appendChild(card);
    });
  }

  /* Laisse Home Assistant calculer naturellement la taille sans imposer ni déborder */
  getCardSize() {
    return 4;
  }

  getLayoutOptions() {
    return {
      grid_columns: 4,
      grid_min_columns: 2,
      grid_rows: 5,
      grid_min_rows: 3,
    };
  }
}

customElements.define("visited-places-card", VisitedPlacesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "visited-places-card",
  name: "Visited Places Map (BeenThere)",
  description: "Carte interactive style BeenThere adaptée aux grilles Home Assistant.",
  preview: true,
});
