console.log("dashboard.js loaded");
console.log("URL:", location.pathname);
console.log("window.DASHBOARD_ID:", window.DASHBOARD_ID);

// ---- Columns config (global) ----

const AVAILABLE_COLUMNS = [
  { key: "line", label: "Linie" },
  { key: "destination", label: "Ziel" },
  { key: "planned", label: "Plan" },
  { key: "time", label: "Erwartet" },
  { key: "eta_planned", label: "Zeit1" },
  { key: "eta_time",    label: "Zeit2" },
  { key: "delay", label: "Versp." },
  { key: "platform", label: "Gleis" },
  { key: "type", label: "Transportmittel" },
];

const headerMap = Object.fromEntries(AVAILABLE_COLUMNS.map(c => [c.key, c.label]));

let columnConfig = null; // [{key, enabled, label?}]



function newEntryId() {
  return (crypto?.randomUUID?.() || ("e_" + Math.random().toString(16).slice(2)));
}

function ensureEntryDefaults(e) {
  if (!e.entryId) e.entryId = newEntryId();
  if (e.limit == null) e.limit = 20;

  if (!Array.isArray(e.filterGroups)) e.filterGroups = [];

  return e;
}




const DASHBOARD_ID = window.DASHBOARD_ID; // kommt aus Template
const dashboardNameInput = document.getElementById("dashboardName");



// Wir merken uns die letzten geladenen Daten, damit "Anwenden" neu rendern kann
let lastDeparturesResults = null;


const input = document.getElementById("stationInput");
const resultsBox = document.getElementById("results");
const addBtn = document.getElementById("addBtn");
const stationsTable = document.getElementById("stationsTable");
const countPill = document.getElementById("count");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const STORAGE_KEY = "mvg_dashboard_v1";

let selectedStations = []; // {id, label}
let picked = null; // {id,label}

let isDirty = false;

function markDirty() {
  isDirty = true;
  // optional: Status leeren, damit "Gespeichert" nicht stehen bleibt
  if (typeof statusEl !== "undefined" && statusEl) statusEl.textContent = "";
}

function clearDirty() {
  isDirty = false;
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}



function setStatus(msg) {
  statusEl.textContent = msg || "";
  if (msg) setTimeout(() => (statusEl.textContent = ""), 2000);
}


// ---------- Suggestions (datalist) per Station Entry ----------
const suggestionsCache = new Map(); // stationId -> { deps:[...], lines:[], directions:[], platforms:[], types:[] }

function uniqSorted(arr) {
  return [...new Set(arr.filter(Boolean).map(x => String(x).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "de"));
}

async function fetchSuggestionsForStation(stationId) {
  if (!stationId) return { deps: [], lines: [], directions: [], platforms: [], types: [] };
  if (suggestionsCache.has(stationId)) return suggestionsCache.get(stationId);

  const payload = { stations: [{ id: stationId, limit: 200 }] };

  const resp = await fetch("/api/departures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !Array.isArray(data)) {
    console.warn("Suggestions fetch failed", resp.status, data);
    const empty = { deps: [], lines: [], directions: [], platforms: [], types: [] };
    suggestionsCache.set(stationId, empty);
    return empty;
  }

  const block = data.find(b => b && b.station_id === stationId);
  const deps = (block && Array.isArray(block.departures)) ? block.departures : [];

  const out = {
    deps,
    lines: uniqSorted(deps.map(d => d?.line)),
    directions: uniqSorted(deps.map(d => d?.destination)),
    platforms: uniqSorted(deps.map(d => d?.platform)),
    types: uniqSorted(deps.map(d => d?.type)),
  };

  suggestionsCache.set(stationId, out);
  return out;
}


async function ensureEntrySuggestions(entry) {
  if (!entry || !entry.id) return;
  if (entry._suggestions && entry._suggestionsLoadedFor === entry.id) return;

  const sug = await fetchSuggestionsForStation(entry.id);
  entry._suggestions = sug;
  entry._suggestionsLoadedFor = entry.id;
}




async function loadFromServer() {
  const resp = await fetch(`/api/dashboards/${encodeURIComponent(DASHBOARD_ID)}`);
  if (!resp.ok) throw new Error("Dashboard load failed");

  const data = await resp.json();
  if (dashboardNameInput) dashboardNameInput.value = data.name || "";

  const rawStations = Array.isArray(data.config?.stations) ? data.config.stations : [];
  selectedStations = rawStations.map(ensureEntryDefaults);

  columnConfig = Array.isArray(data.config?.columns) ? data.config.columns : null;



}


async function saveToServer() {
  try {
    const name = (dashboardNameInput?.value || "Dashboard").trim();

    // Nur Felder speichern, die du wirklich brauchst
    const stationsToSave = selectedStations.map(s => ({
      entryId: s.entryId,
      id: s.id,
      label: s.label,
      limit: s.limit ?? 20,
      filterGroups: Array.isArray(s.filterGroups) ? s.filterGroups : []
    }));

    const payload = {
      name,
      config: { name, stations: stationsToSave, columns: columnConfig }
    };

    const resp = await fetch(`/api/dashboards/${encodeURIComponent(DASHBOARD_ID)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("Save failed:", resp.status, data);
      setStatus(`Speichern fehlgeschlagen (${resp.status})`);
      return;
    }

    // Optional: direkt wieder laden, um sicher zu sein, dass Server es hat
    await loadFromServer();
    renderStations();

    setStatus("Gespeichert ✅");
    clearDirty();
  } catch (e) {
    console.error(e);
    setStatus("Speichern fehlgeschlagen (Console)");
  }
}



function reset() {
  markDirty();
  selectedStations = [];
  localStorage.removeItem(STORAGE_KEY);
  renderStations();
  setStatus("Zurückgesetzt");
}



function ensureColumnDefaults() {

  if (!Array.isArray(columnConfig)) {
    columnConfig = [
      { key: "line", enabled: true },
      { key: "destination", enabled: true },
      { key: "planned", enabled: true },
      { key: "time", enabled: true },
      { key: "eta_planned", enabled: false },
      { key: "eta_time", enabled: false },
      { key: "delay", enabled: true },
      { key: "platform", enabled: false },
      { key: "type", enabled: false },
    ];
    return;
  }



  // fehlende Keys ergänzen
  const seen = new Set(columnConfig.map(c => c.key));
  for (const c of AVAILABLE_COLUMNS) {
    if (!seen.has(c.key)) columnConfig.push({ key: c.key, label: c.label, enabled: true });
  }

  // labels nachziehen
  for (const c of columnConfig) {
    const base = AVAILABLE_COLUMNS.find(x => x.key === c.key);
    if (base && (!c.label || c.label === c.key)) c.label = base.label;
    if (typeof c.enabled !== "boolean") c.enabled = true;
  }
}

function getColumnLabel(key) {
  return (columnConfig?.find(c => c.key === key)?.label)
    || (AVAILABLE_COLUMNS.find(c => c.key === key)?.label)
    || key;
}

function getEnabledColumns() {
  ensureColumnDefaults();
  return columnConfig.filter(c => c.enabled !== false);
}

function moveColumn(key, targetKey, insertAfter = false) {
  markDirty();
  ensureColumnDefaults();
  const fromIdx = columnConfig.findIndex(c => c.key === key);
  const toIdx0 = columnConfig.findIndex(c => c.key === targetKey);
  if (fromIdx < 0 || toIdx0 < 0 || fromIdx === toIdx0) return;

  const [item] = columnConfig.splice(fromIdx, 1);

  // wenn wir aus einem kleineren Index rausziehen, verschiebt sich Ziel nach links
  let toIdx = toIdx0;
  if (fromIdx < toIdx) toIdx--;

  if (insertAfter) toIdx++;
  columnConfig.splice(toIdx, 0, item);
}




function renderColumnsEditor() {
  const list = document.getElementById("columnsList");
  if (!list) return;

  ensureColumnDefaults();
  list.innerHTML = "";

  function tooltipTextForKey(key) {
    if (key === "eta_planned") {
      return `Zeit1 = Minuten bis zur geplanten Abfahrt (Planzeit), gerechnet ab "jetzt". 
Wenn die Planzeit bereits vorbei ist, wird 0 min angezeigt.`;
    }
    if (key === "eta_time") {
      return `Zeit2 = Minuten bis zur erwarteten/aktuellen Abfahrt (inkl. Verspätung), gerechnet ab "jetzt".
Wenn die erwartete Zeit bereits vorbei ist, wird 0 min angezeigt.`;
    }
    return null;
  }

  // Click-outside: schließt offene Tooltips
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".info-tip.open").forEach(el => {
      if (!el.contains(e.target)) el.classList.remove("open");
    });
  });

  for (const c of columnConfig) {
    const li = document.createElement("li");
    li.className = "col-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = (c.enabled !== false);

    cb.addEventListener("change", () => {
      c.enabled = cb.checked;
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });

    const label = document.createElement("span");
    label.className = "col-label";
    label.textContent = getColumnLabel(c.key);

    li.appendChild(cb);
    li.appendChild(label);

    // ⓘ for Zeit1 / Zeit2
    const tipText = tooltipTextForKey(c.key);
    if (tipText) {
      const tipWrap = document.createElement("span");
      tipWrap.className = "info-tip";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "info-btn";
      btn.textContent = "i";
      btn.title = "Info";

      const tip = document.createElement("div");
      tip.className = "tooltip";
      tip.innerHTML = `
        <strong>${escapeHtml(getColumnLabel(c.key))}</strong><br>
        ${escapeHtml(tipText)}
        <div class="muted" style="margin-top:6px;">Hinweis: Die Zeiten hängen von der MVG-API ab und können leicht schwanken.</div>
      `;

      // click toggle (mobile-friendly)
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        tipWrap.classList.toggle("open");
      });

      tipWrap.appendChild(btn);
      tipWrap.appendChild(tip);
      li.appendChild(tipWrap);
    }

    list.appendChild(li);
  }
}






function renderStations() {
  stationsTable.innerHTML = "";
  countPill.textContent = String(selectedStations.length);

  for (const entry of selectedStations) {
    ensureEntryDefaults(entry);

    // Suggestions lazy laden (async), UI wird danach nochmal gerendert
    if (!entry._suggestions || entry._suggestionsLoadedFor !== entry.id) {
      ensureEntrySuggestions(entry).then(() => {
        // nur re-rendern, wenn die entry noch existiert
        if (selectedStations.some(x => x.entryId === entry.entryId)) renderStations();
      });
    }


    const tr = document.createElement("tr");

    // Name
    const tdName = document.createElement("td");
    tdName.textContent = entry.label ?? "";

    // Controls
    const tdCtrl = document.createElement("td");
    tdCtrl.style.minWidth = "520px";

    const ctrlOuter = document.createElement("div");
    ctrlOuter.style.display = "flex";
    ctrlOuter.style.flexDirection = "column";
    ctrlOuter.style.gap = "10px";

    // Row 1: Limit + Reset/Remove
    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.flexWrap = "wrap";
    topRow.style.gap = "8px";
    topRow.style.alignItems = "center";

    const limitInput = document.createElement("input");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.max = "80";
    limitInput.value = entry.limit;
    limitInput.style.width = "90px";
    limitInput.title = "Anzahl Fahrten";
    limitInput.addEventListener("input", () => {
      entry.limit = Number(limitInput.value || 20);
    });

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Filter für Haltestelle Zurücksetzen";
    resetBtn.addEventListener("click", () => {
      markDirty();
      entry.filterGroups = []; // ✅ alles löschen
      renderStations();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Haltestelle Entfernen";
    removeBtn.addEventListener("click", () => {
      markDirty();
      selectedStations = selectedStations.filter(x => x.entryId !== entry.entryId);
      renderStations();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });

    topRow.appendChild(limitInput);
    topRow.appendChild(resetBtn);
    topRow.appendChild(removeBtn);

    // Row 2+: Filtergruppen optional
    const groupsWrap = document.createElement("div");
    groupsWrap.style.display = "flex";
    groupsWrap.style.flexDirection = "column";
    groupsWrap.style.gap = "8px";

    // ✅ Nur rendern, wenn Gruppen existieren
    (entry.filterGroups || []).forEach((g, idx) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexWrap = "wrap";
      row.style.gap = "8px";
      row.style.alignItems = "center";

    // ---- Stelle sicher: Suggestions sind geladen, bevor man Filtergruppen nutzt
    // (du kannst das z.B. beim Klick auf "+ Filtergruppe" awaiten – siehe unten)

    const lineListId = `dl_line_${entry.entryId}_${idx}`;
    const dirListId  = `dl_dir_${entry.entryId}_${idx}`;
    const platListId = `dl_plat_${entry.entryId}_${idx}`;
    const typeListId = `dl_type_${entry.entryId}_${idx}`;

    const lineInput = document.createElement("input");
    lineInput.placeholder = `Linie (G${idx + 1})`;
    lineInput.style.width = "110px";
    lineInput.value = g.line || "";
    lineInput.setAttribute("list", lineListId);

    const dirInput = document.createElement("input");
    dirInput.placeholder = `Richtung (G${idx + 1})`;
    dirInput.style.width = "180px";
    dirInput.value = g.direction || "";
    dirInput.setAttribute("list", dirListId);

    const platInput = document.createElement("input");
    platInput.placeholder = `Gleis (G${idx + 1})`;
    platInput.style.width = "90px";
    platInput.value = g.platform || "";
    platInput.setAttribute("list", platListId);

    const typeInput = document.createElement("input");
    typeInput.placeholder = `Typ (G${idx + 1})`;
    typeInput.style.width = "120px";
    typeInput.value = g.type || "";
    typeInput.setAttribute("list", typeListId);

    // datalists
    const lineDL = document.createElement("datalist"); lineDL.id = lineListId;
    const dirDL  = document.createElement("datalist"); dirDL.id  = dirListId;
    const platDL = document.createElement("datalist"); platDL.id = platListId;
    const typeDL = document.createElement("datalist"); typeDL.id = typeListId;

    // zentrale Update-Funktion für diese Gruppe
    function updateGroupDatalists() {
    // nur wenn suggestions vorhanden (sonst bleiben leer)
      if (!entry._suggestions || !entry._suggestions.deps) return;

      fillDatalist(lineDL, compatibleOptionsForField(entry, g, "line", lineInput.value));
      fillDatalist(dirDL,  compatibleOptionsForField(entry, g, "direction", dirInput.value));
      fillDatalist(platDL, compatibleOptionsForField(entry, g, "platform", platInput.value));
      fillDatalist(typeDL, compatibleOptionsForField(entry, g, "type", typeInput.value));
    }

    // Events: Wert schreiben + re-render departures + suggestions update
    lineInput.addEventListener("input", () => {
      markDirty(); // TODO Maybe annoying (-> Perhaps remove!)
      g.line = lineInput.value.trim();
      updateGroupDatalists();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });
    dirInput.addEventListener("input", () => {
      g.direction = dirInput.value.trim();
      updateGroupDatalists();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });
    platInput.addEventListener("input", () => {
      g.platform = platInput.value.trim();
      updateGroupDatalists();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });
    typeInput.addEventListener("input", () => {
      g.type = typeInput.value.trim();
      updateGroupDatalists();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });

    // auch bei Fokus aktualisieren (damit die Auswahl schon passend ist)
    [lineInput, dirInput, platInput, typeInput].forEach(el => {
      el.addEventListener("focus", updateGroupDatalists);
    });

    // initial füllen
    updateGroupDatalists();

    // append order: input + datalist
    row.appendChild(lineInput); row.appendChild(lineDL);
    row.appendChild(dirInput);  row.appendChild(dirDL);
    row.appendChild(platInput); row.appendChild(platDL);
    row.appendChild(typeInput); row.appendChild(typeDL);


    const removeGroupBtn = document.createElement("button");
    removeGroupBtn.textContent = "– Gruppe";
    removeGroupBtn.addEventListener("click", () => {
      markDirty();
      entry.filterGroups.splice(idx, 1);
      renderStations();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });

    row.appendChild(removeGroupBtn);

    groupsWrap.appendChild(row);
    });

    // ✅ Add group button (immer da)
    const addGroupBtn = document.createElement("button");
    addGroupBtn.textContent = "+ Filter Hinzufügen";
    addGroupBtn.addEventListener("click", async () => {
      markDirty();
      await ensureEntrySuggestions(entry); // ✅ holt 100 deps, damit Suggestions direkt passen

      entry.filterGroups.push({ line: "", direction: "", platform: "", type: "" });
      renderStations();
      if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
    });
    groupsWrap.appendChild(addGroupBtn);


    ctrlOuter.appendChild(topRow);
    ctrlOuter.appendChild(groupsWrap);
    tdCtrl.appendChild(ctrlOuter);

    tr.appendChild(tdName);
    tr.appendChild(tdCtrl);
    stationsTable.appendChild(tr);
  }
}


function showResults(items) {
  resultsBox.innerHTML = "";
  if (!items.length) {
    resultsBox.style.display = "none";
    return;
  }
  resultsBox.style.display = "block";

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = it.label;

    div.addEventListener("click", () => {
      picked = it;
      input.value = it.label;
      resultsBox.style.display = "none";
      addBtn.disabled = false;
    });

    resultsBox.appendChild(div);
  }
}

// Simple debounce
let t = null;
input.addEventListener("input", () => {
  picked = null;
  addBtn.disabled = true;

  const q = input.value.trim();
  if (t) clearTimeout(t);
  if (q.length < 2) {
    resultsBox.style.display = "none";
    return;
  }

  t = setTimeout(async () => {
    const resp = await fetch(`/api/stations?q=${encodeURIComponent(q)}`);
    const items = await resp.json();
    showResults(items);
  }, 120);
});

addBtn.addEventListener("click", () => {
  if (!picked) return;

  const entry = ensureEntryDefaults({
    entryId: newEntryId(),
    id: picked.id,
    label: picked.label,
    limit: 20,
    filterGroups: []
  });

  selectedStations.push(entry);
  markDirty();

  picked = null;
  input.value = "";
  addBtn.disabled = true;
  resultsBox.style.display = "none";

  renderStations();
  setStatus("Hinzugefügt");
  if (lastDeparturesResults) renderDepartures(lastDeparturesResults);

  console.log("Added entry:", entry);
  console.log("selectedStations length:", selectedStations.length);
});


saveBtn.addEventListener("click", saveToServer);
clearBtn.addEventListener("click", reset);

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (e.target === input || resultsBox.contains(e.target)) return;
  resultsBox.style.display = "none";
});


const refreshBtn = document.getElementById("refreshBtn");
const refreshStatus = document.getElementById("refreshStatus");
const departuresContainer = document.getElementById("departuresContainer");

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


function norm(x) {
  return (x ?? "").toString().trim().toLowerCase();
}

function depMatchesField(depVal, filterVal) {
  if (norm(filterVal) === "") return true;
  return norm(depVal) === norm(filterVal);
}

/**
 * Gibt Score: kleiner = besser
 * 0 = startsWith, 1 = includes, 2 = sonst
 */
function scoreMatch(optionValue, typed) {
  const o = norm(optionValue);
  const t = norm(typed);
  if (!t) return 999;         // wenn nix getippt: neutral
  if (o.startsWith(t)) return 0;
  if (o.includes(t)) return 1;
  return 2;
}

/**
 * Sortiert Optionen so, dass beste "Autocomplete"-Treffer oben stehen,
 * aber alle kompatiblen Optionen bleiben im Dropdown.
 */
function sortOptions(options, typed) {
  const t = norm(typed);
  if (!t) return options.slice().sort((a,b) => a.localeCompare(b,"de"));

  return options.slice().sort((a, b) => {
    const sa = scoreMatch(a, t);
    const sb = scoreMatch(b, t);
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b, "de");
  });
}

/**
 * Kompatible Optionen für ein Feld innerhalb einer Filtergruppe berechnen:
 * - Filtert deps nach den AND-Feldern der Gruppe (außer dem Feld selbst)
 * - Extrahiert daraus einzigartige Werte für das Ziel-Feld
 */
function compatibleOptionsForField(entry, group, field, typedValue) {
  const deps = entry?._suggestions?.deps || [];

  const filtered = deps.filter(d => {
    if (field !== "line" && !depMatchesField(d.line, group.line)) return false;
    if (field !== "direction" && !depMatchesField(d.destination, group.direction)) return false;
    if (field !== "platform" && !depMatchesField(d.platform, group.platform)) return false;
    if (field !== "type" && !depMatchesField(d.type, group.type)) return false;
    return true;
  });

  let values = [];
  if (field === "line") values = filtered.map(d => d.line);
  if (field === "direction") values = filtered.map(d => d.destination);
  if (field === "platform") values = filtered.map(d => d.platform);
  if (field === "type") values = filtered.map(d => d.type);

  const uniq = [...new Set(values.filter(v => norm(v) !== "").map(v => String(v)))];
  return sortOptions(uniq, typedValue);
}

function fillDatalist(datalistEl, options) {
  datalistEl.innerHTML = options.slice(0, 500).map(v => `<option value="${String(v).replaceAll('"', "&quot;")}"></option>`).join("");
}




// Eine Gruppe ist "leer", wenn ALLE Felder leer sind
function groupIsEmpty(g) {
  if (!g) return true;
  return (
    norm(g.line) === "" &&
    norm(g.direction) === "" &&
    norm(g.platform) === "" &&
    norm(g.type) === ""
  );
}

// AND innerhalb einer Gruppe
function matchesGroup(dep, g) {
  if (!g) return true;

  if (norm(g.line) !== "" && norm(dep.line) !== norm(g.line)) return false;
  if (norm(g.direction) !== "" && norm(dep.destination) !== norm(g.direction)) return false;
  if (norm(g.platform) !== "" && norm(dep.platform) !== norm(g.platform)) return false;
  if (norm(g.type) !== "" && norm(dep.type) !== norm(g.type)) return false;

  return true;
}

// OR über Gruppen
function passesStationFilters(dep, entry) {
  const groups = Array.isArray(entry?.filterGroups) ? entry.filterGroups : [];
  const active = groups.filter(g => !groupIsEmpty(g));

  // ✅ keine aktiven Filter => alles zeigen
  if (active.length === 0) return true;

  // ✅ sonst: mindestens eine Gruppe matchen
  return active.some(g => matchesGroup(dep, g));
}


function renderDepartures(results) {
  departuresContainer.innerHTML = "";

  const byStationId = new Map();
  for (const block of results || []) {
    byStationId.set(block.station_id, block);
  }

  for (const entry of selectedStations) {
    const block = byStationId.get(entry.id);

    const wrapper = document.createElement("div");
    wrapper.style.margin = "14px 0";

    // Titel: gleiche Station mehrfach -> unterscheidbar machen
    wrapper.innerHTML = `<h3 style="margin:6px 0;">${entry.label} <span class="muted">(${entry.entryId.slice(0,6)})</span></h3>`;

    if (!block) {
      const msg = document.createElement("div");
      msg.className = "muted";
      msg.textContent = "Noch keine Daten (Refresh klicken).";
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
      empty.textContent = "Keine Abfahrten (Filter zu strikt?).";
      wrapper.appendChild(empty);
      departuresContainer.appendChild(wrapper);
      continue;
    }

    // ✅ Spalten nach Dashboard-Config + Drag&Drop im Tabellen-Header
    ensureColumnDefaults();
    const cols = (typeof getEnabledColumns === "function")
      ? getEnabledColumns()
      : (columnConfig || []).filter(c => c.enabled !== false);

    // helper: entscheidet, ob drop "vor" oder "nach" target passiert
    function getInsertAfterByMouse(th, clientX) {
      const r = th.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      return clientX > mid;
    }

    function etaText(epochSeconds) {
      if (!epochSeconds) return "-";
      const now = Date.now() / 1000;
      const diffSec = epochSeconds - now;
      const mins = Math.ceil(diffSec / 60);
      if (mins <= 0) return "0 min";
      return `${mins} min`;
    }

    function cellValue(colKey, d) {
      if (colKey === "line") return d.line ?? "-";
      if (colKey === "destination") return d.destination ?? "-";
      if (colKey === "planned") return fmtTime(d.planned);
      if (colKey === "time") return fmtTime(d.time);
      if (colKey === "eta_planned") return etaText(d.planned);
      if (colKey === "eta_time")    return etaText(d.time);
      if (colKey === "delay") return fmtDelay(d.delay);
      if (colKey === "platform") return d.platform ?? "";
      if (colKey === "type") return d.type ?? "";
      return "";
    }

    const table = document.createElement("table");

    // THEAD (draggable)
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    cols.forEach(c => {
      const th = document.createElement("th");
      th.textContent = headerMap[c.key] || c.label || c.key;

      th.dataset.key = c.key;

      // Drag start
      th.draggable = true;
      th.style.cursor = "grab";
      th.style.userSelect = "none";

      th.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", c.key);
        e.dataTransfer.effectAllowed = "move";
      });

      th.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        th.style.background = "#f6f6f6";
      });

      th.addEventListener("dragleave", () => {
        th.style.background = "";
      });

      th.addEventListener("drop", (e) => {
        e.preventDefault();
        th.style.background = "";

        const draggedKey = e.dataTransfer.getData("text/plain");
        const targetKey = th.dataset.key;
        if (!draggedKey || !targetKey || draggedKey === targetKey) return;

        const insertAfter = getInsertAfterByMouse(th, e.clientX);

        // moveColumn() bevorzugt, fallback falls du’s (noch) nicht hast
        if (typeof moveColumn === "function") {
          moveColumn(draggedKey, targetKey, insertAfter);
        } else if (Array.isArray(columnConfig)) {
          const fromIdx0 = columnConfig.findIndex(x => x.key === draggedKey);
          const toIdx0 = columnConfig.findIndex(x => x.key === targetKey);
          if (fromIdx0 >= 0 && toIdx0 >= 0 && fromIdx0 !== toIdx0) {
            const [item] = columnConfig.splice(fromIdx0, 1);
            let toIdx = toIdx0;
            if (fromIdx0 < toIdx) toIdx--;
            if (insertAfter) toIdx++;
            columnConfig.splice(toIdx, 0, item);
          }
        }

        // UI refresh (Liste + Preview)
        if (typeof renderColumnsEditor === "function") renderColumnsEditor();
        if (lastDeparturesResults) renderDepartures(lastDeparturesResults);
      });

      trh.appendChild(th);
    });

    thead.appendChild(trh);
    table.appendChild(thead);

    // TBODY
    const tbody = document.createElement("tbody");
    for (const d of deps) {
      const tr = document.createElement("tr");
      cols.forEach(c => {
        const td = document.createElement("td");
        td.textContent = cellValue(c.key, d);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrapper.appendChild(table);
    departuresContainer.appendChild(wrapper);
  }
}



async function refreshDepartures() {
  if (!selectedStations.length) {
    refreshStatus.textContent = "Bitte erst Stationen hinzufügen.";
    return;
  }

  refreshStatus.textContent = "Lade…";


  const unique = new Map();
  for (const e of selectedStations) {
    if (!unique.has(e.id)) unique.set(e.id, { id: e.id, limit: e.limit || 20 });
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
    renderStations();                 // baut Inputs + datalists
    renderDepartures(data);           // zeigt Tabellen
    rebuildPerStationFilterOptions(data); // füllt Autocomplete pro Station



    renderDepartures(data);
    refreshStatus.textContent = "Aktualisiert ✅";
    setTimeout(() => (refreshStatus.textContent = ""), 1500);
  } catch (e) {
    console.error(e);
    refreshStatus.textContent = "Fehler beim Laden (Console checken)";
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    // Panel zeigen + Spaltenliste initial rendern
    ensureColumnDefaults();
    renderColumnsEditor();
    document.getElementById("columnsPanel")?.classList.remove("hidden");

    // Abfahrten laden + rendern
    await refreshDepartures();
  });
}


//----------------Filter Functions----------------

// Apply & Reset Buttons

function rebuildPerStationFilterOptions(results) {
  // results: [{station_id, departures:[...]}]
  const byStation = new Map();
  for (const block of results || []) byStation.set(block.station_id, block.departures || []);

  for (const st of selectedStations) {
    const deps = byStation.get(st.id) || [];

    const dirs = new Set();
    const types = new Set();

    for (const d of deps) {
      if (d.destination) dirs.add(String(d.destination));
      if (d.type) types.add(String(d.type));
    }

    const directionListId = `dir_${st.id.replaceAll(":", "_").replaceAll(".", "_")}`;
    const typeListId = `type_${st.id.replaceAll(":", "_").replaceAll(".", "_")}`;

    const dirList = document.getElementById(directionListId);
    const typeList = document.getElementById(typeListId);

    if (dirList) {
      dirList.innerHTML = "";
      [...dirs].sort().slice(0, 500).forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        dirList.appendChild(opt);
      });
    }

    if (typeList) {
      typeList.innerHTML = "";
      [...types].sort().forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        typeList.appendChild(opt);
      });
    }
  }
}

async function openPreviewIfPossible() {
  // Spaltenpanel sichtbar + Liste rendern
  document.getElementById("columnsPanel")?.classList.remove("hidden");
  renderColumnsEditor();

  // wenn noch keine Abfahrten geladen: laden
  if (!lastDeparturesResults) {
    await refreshDepartures();
  } else {
    renderDepartures(lastDeparturesResults);
  }
}


// init

(async () => {
  try {
    await loadFromServer();
  } catch (e) {
    console.error(e);
  }

  ensureColumnDefaults();
  renderStations();

  // ✅ AUTO: Wenn schon Stationen existieren -> Vorschau + Spalten direkt öffnen
  if (selectedStations.length > 0) {
    await openPreviewIfPossible();
  } else {
    // keine Stationen -> Panel versteckt lassen
    document.getElementById("columnsPanel")?.classList.add("hidden");
  }
})();