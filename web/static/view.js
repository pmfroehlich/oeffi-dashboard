console.log("view.js loaded");

const DASHBOARD_ID = window.DASHBOARD_ID;

const pageTitle = document.getElementById("pageTitle");
const refreshBtn = document.getElementById("refreshBtn");
const refreshStatus = document.getElementById("refreshStatus");
const departuresContainer = document.getElementById("departuresContainer");

let selectedStations = [];        // entries (inkl. Duplikate)
let lastDeparturesResults = null; // [{station_id, departures, error?}, ...]


let columnConfig = null; // aus dashboard.config.columns

const FALLBACK_COLUMNS = [
  { key: "line", label: "Linie" },
  { key: "destination", label: "Ziel" },
  { key: "planned", label: "Plan" },
  { key: "time", label: "Erwartet" },
  { key: "eta_planned", label: "Zeit1" },
  { key: "eta_time",    label: "Zeit2" },
  { key: "delay", label: "Versp." },
  { key: "platform", label: "Gleis" },
  { key: "type", label: "Typ" },
];

function ensureViewColumnDefaults() {
  // wenn gar nichts gespeichert ist -> fallback
  if (!Array.isArray(columnConfig) || !columnConfig.length) {
    columnConfig = FALLBACK_COLUMNS.map(c => ({ key: c.key, label: c.label, enabled: true }));
    return;
  }

  // ✅ falls config existiert, aber neue Keys fehlen -> ergänzen
  const seen = new Set(columnConfig.map(c => c.key));
  for (const c of FALLBACK_COLUMNS) {
    if (!seen.has(c.key)) {
      columnConfig.push({ key: c.key, label: c.label, enabled: true });
    }
  }

  // labels/enabled normalisieren
  for (const c of columnConfig) {
    const base = FALLBACK_COLUMNS.find(x => x.key === c.key);
    if (base && (!c.label || c.label === c.key)) c.label = base.label;
    if (typeof c.enabled !== "boolean") c.enabled = true;
  }
}


function getViewColumnsEnabled() {
  // ✅ In /view: NUR aktivierte Spalten anzeigen, Reihenfolge beibehalten
  ensureViewColumnDefaults();
  return columnConfig.filter(c => c && c.enabled !== false);
}


function getColLabel(col) {
  return col?.label || col?.key || "";
}

function minutesFromNow(epochSeconds) {
  if (!epochSeconds) return "-";
  const diffMin = Math.ceil((epochSeconds * 1000 - Date.now()) / 60000);
  if (diffMin <= 0) return "0 min";
  return `${diffMin} min`;
}


function cellValue(colKey, d) {
  if (colKey === "line") return d.line ?? "-";
  if (colKey === "destination") return d.destination ?? "-";
  if (colKey === "planned") return fmtTime(d.planned);
  if (colKey === "time") return fmtTime(d.time);
  if (colKey === "delay") return fmtDelay(d.delay);
  if (colKey === "platform") return d.platform ?? "";
  if (colKey === "type") return d.type ?? "";
  if (colKey === "eta_planned") return minutesFromNow(d.planned);
  if (colKey === "eta_time") return minutesFromNow(d.time);
  return "";
}


function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function norm(x) {
  return (x ?? "").toString().trim().toLowerCase();
}

function groupIsEmpty(g) {
  if (!g) return true;
  return (
    norm(g.line) === "" &&
    norm(g.direction) === "" &&
    norm(g.platform) === "" &&
    norm(g.type) === ""
  );
}

function matchesGroup(dep, g) {
  if (!g) return true;

  if (norm(g.line) !== "" && norm(dep.line) !== norm(g.line)) return false;
  if (norm(g.direction) !== "" && norm(dep.destination) !== norm(g.direction)) return false;
  if (norm(g.platform) !== "" && norm(dep.platform) !== norm(g.platform)) return false;
  if (norm(g.type) !== "" && norm(dep.type) !== norm(g.type)) return false;

  return true;
}

// OR über Gruppen; 0 Gruppen => alles anzeigen
function passesStationFilters(dep, entry) {
  const groups = Array.isArray(entry?.filterGroups) ? entry.filterGroups : [];
  const active = groups.filter(g => !groupIsEmpty(g));
  if (active.length === 0) return true;
  return active.some(g => matchesGroup(dep, g));
}

function fmtTime(epoch) {
  if (!epoch) return "-";
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDelay(min) {
  if (min === null || min === undefined) return "";
  if (min === 0) return "±0";
  return `${min > 0 ? "+" : "-"}${Math.abs(min)} min`;
}

async function loadDashboard() {
  const resp = await fetch(`/api/dashboards/${encodeURIComponent(DASHBOARD_ID)}`);
  if (!resp.ok) throw new Error("Dashboard load failed");

  const data = await resp.json();
  const dashboardName = data.name || "Dashboard";
  if (pageTitle) pageTitle.textContent = `${dashboardName} – View`;

  const raw = Array.isArray(data.config?.stations) ? data.config.stations : [];
  selectedStations = raw.map(e => ({
    entryId: e.entryId || (crypto?.randomUUID?.() || ("e_" + Math.random().toString(16).slice(2))),
    id: e.id,
    label: e.label,
    limit: e.limit ?? 20,
    filterGroups: Array.isArray(e.filterGroups) ? e.filterGroups : []
  }));

  columnConfig = Array.isArray(data.config?.columns) ? data.config.columns : null;
  ensureViewColumnDefaults();


  console.log("Loaded entries:", selectedStations.length);
}

function renderDepartures(results) {
  departuresContainer.innerHTML = "";

  if (!selectedStations.length) {
    departuresContainer.innerHTML = `<div style="margin-top:12px;" class="muted">Keine Stationen konfiguriert.</div>`;
    return;
  }

  const byStationId = new Map();
  for (const block of results || []) {
    byStationId.set(block.station_id, block);
  }

  for (const entry of selectedStations) {
    const block = byStationId.get(entry.id);

    const wrapper = document.createElement("div");
    wrapper.style.border = "1px solid #eee";
    wrapper.style.borderRadius = "14px";
    wrapper.style.padding = "12px";
    wrapper.style.margin = "12px 0";

    wrapper.innerHTML = `<h3 style="margin:0 0 8px 0;">${escapeHtml(entry.label)}</h3>`;

    if (!block) {
      const msg = document.createElement("div");
      msg.className = "muted";
      msg.textContent = "Keine Daten (Refresh).";
      wrapper.appendChild(msg);
      departuresContainer.appendChild(wrapper);
      continue;
    }

    if (block.error) {
      const err = document.createElement("div");
      err.className = "muted";
      err.textContent = `Fehler: ${block.error}`;
      wrapper.appendChild(err);
      departuresContainer.appendChild(wrapper);
      continue;
    }

    const depsAll = block.departures || [];
    const deps = depsAll.filter(d => passesStationFilters(d, entry));

    if (deps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "Keine Abfahrten (Filter zu strikt?) Versuche unter Konfigurieren den Punkt 'Anzahl Abfahrten' zu erhöhen, z.B. von 20 auf 100.";
      wrapper.appendChild(empty);
      departuresContainer.appendChild(wrapper);
      continue;
    }

        const cols = getViewColumnsEnabled();

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    for (const c of cols) {
      const th = document.createElement("th");
      th.style.textAlign = "left";
      th.style.padding = "10px";
      th.style.borderBottom = "1px solid #eee";
      th.textContent = getColLabel(c);
      trh.appendChild(th);
    }

    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (const d of deps) {
      const tr = document.createElement("tr");

      for (const c of cols) {
        const td = document.createElement("td");
        td.style.padding = "10px";
        td.style.borderBottom = "1px solid #eee";
        td.textContent = escapeHtml(cellValue(c.key, d));
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);


    wrapper.appendChild(table);
    departuresContainer.appendChild(wrapper);
  }
}

async function refreshDepartures() {
  if (!selectedStations.length) {
    refreshStatus.textContent = "Keine Stationen konfiguriert.";
    renderDepartures([]);
    return;
  }

  refreshStatus.textContent = "Lade…";

  // unique station IDs, limit = max limit über Entries derselben Station
  const unique = new Map();
  for (const e of selectedStations) {
    const prev = unique.get(e.id);
    const lim = e.limit ?? 20;
    if (!prev || lim > prev.limit) unique.set(e.id, { id: e.id, limit: lim });
  }
  const payload = { stations: [...unique.values()] };

  try {
    const resp = await fetch("/api/departures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      refreshStatus.textContent = data.error || `Fehler (${resp.status})`;
      return;
    }

    lastDeparturesResults = data;
    renderDepartures(data);

    refreshStatus.textContent = "Aktualisiert ✅";
    setTimeout(() => (refreshStatus.textContent = ""), 1500);
  } catch (e) {
    console.error(e);
    refreshStatus.textContent = "Fehler beim Laden (Console)";
  }
}

if (refreshBtn) refreshBtn.addEventListener("click", refreshDepartures);

// init: refresh on load
(async () => {
  try {
    await loadDashboard();
    await refreshDepartures();
  } catch (e) {
    console.error(e);
    if (refreshStatus) refreshStatus.textContent = "Fehler beim Laden (Console)";
  }
})();
