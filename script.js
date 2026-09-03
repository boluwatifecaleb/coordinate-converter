/* =========================================================
   Lagos Coordinate Converter — script.js
   Independent modes: LCS→NTM | NTM→UTM | Full | Batch | Units
   
   LCS Sign Convention:
     X (East/West):  East  = positive (+), West  = negative (−)
     Y (North/South): North = positive (+), South = negative (−)
========================================================= */

/* =========================================================
   THEME TOGGLE
========================================================= */
const themeBtn = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("cc-theme");
if (savedTheme === "light") document.body.classList.add("light");

themeBtn.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("cc-theme", document.body.classList.contains("light") ? "light" : "dark");
  setTimeout(() => map.invalidateSize(), 50);
});

/* =========================================================
   MAP — initialise immediately, absolute positioned
========================================================= */
const map = L.map("map", {
  zoomControl: true,
  zoomControlOptions: { position: "bottomright" }
}).setView([6.5244, 3.3792], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Force map to render fully on load
window.addEventListener("load", () => { map.invalidateSize(); });
setTimeout(() => map.invalidateSize(), 100);
setTimeout(() => map.invalidateSize(), 300);
setTimeout(() => map.invalidateSize(), 700);

let markersLayer = L.featureGroup().addTo(map); // featureGroup (not layerGroup) is required because getBounds() is used below and is only defined on featureGroup
let userLocMarker = null, userLocCircle = null;
let ptCount = 0;

function refreshCounter() {
  const el = document.getElementById("pointCounter");
  if (ptCount > 0) {
    el.style.display = "block";
    document.getElementById("pointCount").textContent = ptCount;
  } else {
    el.style.display = "none";
  }
}

/* =========================================================
   PROJECTIONS
========================================================= */
proj4.defs("EPSG:4326",  "+proj=longlat +datum=WGS84 +no_defs");
proj4.defs("EPSG:32631", "+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32632", "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32633", "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:26331", "+proj=utm +zone=31 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:26332", "+proj=utm +zone=32 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:26333", "+proj=utm +zone=33 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:26391", "+proj=tmerc +lat_0=4 +lon_0=4.5  +k=0.99975 +x_0=230738.266  +y_0=0 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:26392", "+proj=tmerc +lat_0=4 +lon_0=8.5  +k=0.99975 +x_0=670553.984  +y_0=0 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");
proj4.defs("EPSG:26393", "+proj=tmerc +lat_0=4 +lon_0=12.5 +k=0.99975 +x_0=1110369.702 +y_0=0 +ellps=clrk80 +towgs84=-92,-93,122,0,0,0,0 +units=m +no_defs");

const BELTS      = { west: "EPSG:26391", mid: "EPSG:26392", east: "EPSG:26393" };
const UTM_MIN    = { 31: "EPSG:26331", 32: "EPSG:26332", 33: "EPSG:26333" };
const UTM_WGS    = { 31: "EPSG:32631", 32: "EPSG:32632", 33: "EPSG:32633" };
const BELT_LABEL = { west: "West Belt", mid: "Mid Belt", east: "East Belt" };

const FT = 0.3047972654;
const BE = 347419.060;   // Base Easting tie-point (feet)
const BN = 912966.990;   // Base Northing tie-point (feet)

function ok(n) { return typeof n === "number" && isFinite(n); }

/*
  LCS Sign Convention applied here:
  - lcsX = East/West value: East positive, West negative
  - lcsY = North/South value: North positive, South negative

  Tie-point formula:
    NTM_E = (BE + lcsX) × FT       → East increases BE
    NTM_N = (BN − (−lcsY)) × FT    → Since South was traditionally positive in old notation,
                                       and we now accept North as +, South as −:
                                       NTM_N = (BN + lcsY) × FT when Y is signed
                                       (because subtracting a negative = adding)
  
  If user enters a South value as negative (−24386.87), NTM_N = (BN − 24386.87) × FT  ✓
  If user enters a North value as positive (+5000),    NTM_N = (BN + 5000) × FT        ✓
  This preserves the original formula intent.
*/
function lcsToNTM(lcsX, lcsY) {
  const E = (BE + lcsX) * FT;
  // Original: N = (BN - South_ft). With signed convention: South is negative, so -lcsY gives +|south|
  const N = (BN - (-lcsY)) * FT;  // equivalent to (BN + lcsY) × FT
  return { E, N };
}

function ntmToUTM(e, n, belt, zone, datum) {
  const src  = BELTS[belt];
  const dMin = UTM_MIN[zone];
  const dWgs = UTM_WGS[zone];
  const [mX, mY] = proj4(src, dMin, [e, n]);
  let fX = mX, fY = mY, crs = dMin;
  if (datum === "wgs84") { [fX, fY] = proj4(dMin, dWgs, [mX, mY]); crs = dWgs; }
  const [lon, lat] = proj4(crs, "EPSG:4326", [fX, fY]);
  return { utm_e: fX, utm_n: fY, lat, lon };
}

function fullChain(lcsX, lcsY, belt, zone, datum) {
  const ntm = lcsToNTM(lcsX, lcsY);
  return { ntm, utm: ntmToUTM(ntm.E, ntm.N, belt, zone, datum) };
}

/* =========================================================
   RESULT HELPERS
========================================================= */
function row(k, v, hi) {
  return `<div class="res-row"><span class="res-key">${k}</span><span class="res-val${hi?" hi":""}">${v}</span></div>`;
}
function section(title, content) {
  return `<div class="res-section"><div class="res-title">${title}</div>${content}</div>`;
}
function showRes(id, html) {
  const el = document.getElementById(id);
  el.innerHTML = html; el.classList.remove("hidden");
}
function showErr(id, msg) {
  showRes(id, `<div class="res-error">⚠ ${msg}</div>`);
}

function signLabel(val, posWord, negWord) {
  if (val > 0) return `${posWord} (+)`;
  if (val < 0) return `${negWord} (−)`;
  return "Origin";
}

/* =========================================================
   CLEAR OUTPUT HELPERS
========================================================= */
function clearResultPanel(id, placeholderText) {
  const el = document.getElementById(id);
  el.innerHTML = `<div class="res-placeholder">${placeholderText}</div>`;
}

document.getElementById("btn-clear-lcs-ntm").addEventListener("click", () => {
  clearResultPanel("res-lcs-ntm", "Enter coordinates above and click Convert to see NTM output here.");
});

document.getElementById("btn-clear-ntm-utm").addEventListener("click", () => {
  clearResultPanel("res-ntm-utm", "Enter NTM coordinates above and click Convert to see UTM output here.");
});

document.getElementById("btn-clear-full-output").addEventListener("click", () => {
  clearResultPanel("res-full", "Enter LCS coordinates above and click Convert &amp; Plot to see UTM output here.");
});

/* =========================================================
   TABS
========================================================= */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

/* =========================================================
   DATUM TOGGLES
========================================================= */
function datumToggle(mId, wId, hId) {
  document.getElementById(mId).addEventListener("click", () => {
    document.getElementById(mId).classList.add("active");
    document.getElementById(wId).classList.remove("active");
    document.getElementById(hId).value = "minna";
  });
  document.getElementById(wId).addEventListener("click", () => {
    document.getElementById(wId).classList.add("active");
    document.getElementById(mId).classList.remove("active");
    document.getElementById(hId).value = "wgs84";
  });
}
datumToggle("n2-dm", "n2-dw", "n2-datum");
datumToggle("f-dm",  "f-dw",  "f-datum");

/* =========================================================
   LCS → NTM
========================================================= */
document.getElementById("btn-lcs-ntm").addEventListener("click", () => {
  const lcsX = parseFloat(document.getElementById("n1-east").value);
  const lcsY = parseFloat(document.getElementById("n1-north").value);
  const belt = document.getElementById("n1-belt").value;
  if (!ok(lcsX) || !ok(lcsY)) return showErr("res-lcs-ntm", "Enter valid X (East/West) and Y (North/South) values.");
  try {
    const { E, N } = lcsToNTM(lcsX, lcsY);
    const xDir = signLabel(lcsX, "East", "West");
    const yDir = signLabel(lcsY, "North", "South");

    // Plot on map: silently project NTM -> UTM Zone 31N / Minna just to get a lat/lon for display.
    // This does not change the displayed NTM result, it is only used for the map pin.
    let plotted = false;
    try {
      const { lat, lon } = ntmToUTM(E, N, belt, 31, "minna");
      addMarker([lat, lon], {
        title: "LCS → NTM Point",
        belt: BELT_LABEL[belt],
        zone: 31,
        datum: "minna",
        utm_e: E, utm_n: N,
        lat, lon
      });
      map.setView([lat, lon], 14);
      plotted = true;
    } catch (_) { /* plotting is best-effort; ignore failures */ }

    showRes("res-lcs-ntm",
      section("Input — LCS 165P",
        row("X Coordinate", `${Math.abs(lcsX).toLocaleString()} ft (${xDir})`) +
        row("Y Coordinate", `${Math.abs(lcsY).toLocaleString()} ft (${yDir})`)
      ) +
      section("Output — NTM " + BELT_LABEL[belt],
        row("Easting",  E.toFixed(3) + " m", true) +
        row("Northing", N.toFixed(3) + " m", true)
      ) +
      (plotted ? `<div class="res-section"><div class="res-title">Map</div><div class="res-row"><span class="res-key">Status</span><span class="res-val">Plotted on map ✓</span></div></div>` : "")
    );
  } catch(e) { showErr("res-lcs-ntm", e.message); }
});

/* =========================================================
   NTM → UTM
========================================================= */
document.getElementById("btn-ntm-utm").addEventListener("click", () => {
  const e    = parseFloat(document.getElementById("n2-east").value);
  const n    = parseFloat(document.getElementById("n2-north").value);
  const belt = document.getElementById("n2-belt").value;
  const zone = parseInt(document.getElementById("n2-zone").value, 10);
  const datum= document.getElementById("n2-datum").value;
  if (!ok(e) || !ok(n)) return showErr("res-ntm-utm", "Enter valid NTM Easting and Northing.");
  try {
    const { utm_e, utm_n, lat, lon } = ntmToUTM(e, n, belt, zone, datum);
    addMarker([lat, lon], {
      title: "NTM → UTM Point",
      belt: BELT_LABEL[belt],
      zone, datum, utm_e, utm_n, lat, lon
    });
    map.setView([lat, lon], 14);
    showRes("res-ntm-utm",
      section("Input — NTM " + BELT_LABEL[belt],
        row("Easting",  e.toFixed(3) + " m") +
        row("Northing", n.toFixed(3) + " m")
      ) +
      section("Output — UTM Zone " + zone + "N (" + datum.toUpperCase() + ")",
        row("Easting",  utm_e.toFixed(3) + " m", true) +
        row("Northing", utm_n.toFixed(3) + " m", true)
      ) +
      section("Geographic (WGS84)",
        row("Latitude",  lat.toFixed(6) + "°") +
        row("Longitude", lon.toFixed(6) + "°")
      ) +
      `<div class="res-section"><div class="res-title">Map</div><div class="res-row"><span class="res-key">Status</span><span class="res-val">Plotted on map ✓</span></div></div>`
    );
  } catch(e) { showErr("res-ntm-utm", e.message); }
});

/* =========================================================
   FULL CHAIN
========================================================= */
document.getElementById("btn-full").addEventListener("click", () => {
  const lcsX = parseFloat(document.getElementById("f-east").value);
  const lcsY = parseFloat(document.getElementById("f-south").value);
  const belt = document.getElementById("f-belt").value;
  const zone = parseInt(document.getElementById("f-zone").value, 10);
  const datum= document.getElementById("f-datum").value;
  if (!ok(lcsX) || !ok(lcsY)) return showErr("res-full", "Enter valid LCS X and Y values.");
  try {
    const { utm: { utm_e, utm_n, lat, lon } } = fullChain(lcsX, lcsY, belt, zone, datum);
    addMarker([lat, lon], { title:"Converted Point", belt: BELT_LABEL[belt], zone, datum, utm_e, utm_n, lat, lon });
    map.setView([lat, lon], 15);
    const xDir = signLabel(lcsX, "East", "West");
    const yDir = signLabel(lcsY, "North", "South");
    showRes("res-full",
      section("Input — LCS 165P",
        row("X Coordinate", `${Math.abs(lcsX).toLocaleString()} ft (${xDir})`) +
        row("Y Coordinate", `${Math.abs(lcsY).toLocaleString()} ft (${yDir})`)
      ) +
      section("Output — UTM Zone " + zone + "N (" + datum.toUpperCase() + ")",
        row("Easting",  utm_e.toFixed(3) + " m", true) +
        row("Northing", utm_n.toFixed(3) + " m", true)
      ) +
      section("Geographic",
        row("Latitude",  lat.toFixed(6) + "°") +
        row("Longitude", lon.toFixed(6) + "°")
      )
    );
  } catch(e) { showErr("res-full", e.message); }
});

document.getElementById("btn-clear-full").addEventListener("click", clearMap);

/* =========================================================
   GENERIC FILE PARSING (CSV + XLSX)
========================================================= */
function readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          // Normalize keys to lowercase, trimmed
          const rows = json.map(row => {
            const o = {};
            Object.keys(row).forEach(k => { o[k.trim().toLowerCase()] = String(row[k]).trim(); });
            return o;
          });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("Could not read Excel file."));
      reader.readAsArrayBuffer(file);
    } else {
      file.text().then(text => resolve(parseCsv(text))).catch(reject);
    }
  });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const hs = lines[0].split(",").map(h=>h.trim());
  return lines.slice(1).map(l => {
    const vs = l.split(",").map(v=>v.trim());
    const o = {}; hs.forEach((h,i) => o[h.toLowerCase()] = vs[i]??"");
    return o;
  });
}

function toCsv(rows) {
  if (!rows.length) return "";
  const h = Object.keys(rows[0]);
  return [h.join(","), ...rows.map(r => h.map(k => String(r[k]??"")).join(","))].join("\n");
}

function downloadCsv(filename, csvText) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvText], { type:"text/csv" }));
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

/* =========================================================
   FILE PICKER NAME DISPLAY (shared across all 3 batch sections)
========================================================= */
function wireFilePicker(inputId, nameId) {
  const input = document.getElementById(inputId);
  const nameEl = document.getElementById(nameId);
  input.addEventListener("change", () => {
    if (input.files[0]) {
      nameEl.textContent = input.files[0].name;
      nameEl.classList.add("has-file");
    } else {
      nameEl.textContent = "No file selected";
      nameEl.classList.remove("has-file");
    }
  });
}
wireFilePicker("file-lcs-ntm", "fname-lcs-ntm");
wireFilePicker("file-ntm-utm", "fname-ntm-utm");
wireFilePicker("file-full",    "fname-full");

/* =========================================================
   BATCH 1 — LCS → NTM
   Expected columns: east_feet, south_feet, optional id
========================================================= */
let outCsv_lcsNtm = "";

document.getElementById("batchBtn-lcs-ntm").addEventListener("click", async () => {
  const file  = document.getElementById("file-lcs-ntm").files[0];
  const belt  = document.getElementById("n1-belt").value;
  const statusId = "batchStatus-lcs-ntm";
  if (!file) return showErr(statusId, "Please choose a CSV or Excel file first.");

  try {
    const rows = await readFileAsRows(file);
    if (!rows.length) return showErr(statusId, "File is empty or malformed.");
    const headers = Object.keys(rows[0]);
    if (!headers.includes("east_feet") || !headers.includes("south_feet"))
      return showErr(statusId, "File must have columns: east_feet, south_feet");

    const out = []; let good = 0, bad = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], id = r.id || String(i+1);
      const lcsX = parseFloat(r.east_feet), lcsY = -Math.abs(parseFloat(r.south_feet)); // south_feet is always treated as a magnitude of southing regardless of sign in the file (e.g. "24,386.87" or "-24,386.87" both mean 24,386.87 ft south), then negated to match the signed North(+)/South(-) convention lcsToNTM() expects
      if (!ok(lcsX) || !ok(lcsY)) { bad++; out.push({ id, status:"INVALID" }); continue; }
      try {
        const { E, N } = lcsToNTM(lcsX, lcsY);
        try {
          const { lat, lon } = ntmToUTM(E, N, belt, 31, "minna");
          addMarker([lat, lon], { title:"LCS→NTM Point "+id, belt: BELT_LABEL[belt], zone:31, datum:"minna", utm_e:E, utm_n:N, lat, lon });
        } catch (_) {}
        out.push({ id, east_feet:lcsX, south_feet:lcsY,
          ntm_easting_m: E.toFixed(3), ntm_northing_m: N.toFixed(3),
          belt, status:"OK" });
        good++;
      } catch { bad++; out.push({ id, east_feet:lcsX, south_feet:lcsY, status:"CONVERSION_ERROR" }); }
    }

    const b = markersLayer.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.12));

    outCsv_lcsNtm = toCsv(out);
    document.getElementById("downloadBtn-lcs-ntm").disabled = false;
    showRes(statusId,
      section("Batch Complete",
        row("Converted", good + " points", true) +
        row("Failed",    bad  + " points") +
        row("Belt", BELT_LABEL[belt])
      )
    );
  } catch(e) { showErr(statusId, "Processing failed: " + e.message); }
});

document.getElementById("downloadBtn-lcs-ntm").addEventListener("click", () => {
  if (outCsv_lcsNtm) downloadCsv("lcs_to_ntm_results.csv", outCsv_lcsNtm);
});

document.getElementById("clearBtn-lcs-ntm").addEventListener("click", () => {
  clearResultPanel("batchStatus-lcs-ntm", "Upload a file and click Process Batch to see results here.");
  document.getElementById("downloadBtn-lcs-ntm").disabled = true;
  outCsv_lcsNtm = "";
  document.getElementById("file-lcs-ntm").value = "";
  document.getElementById("fname-lcs-ntm").textContent = "No file selected";
  document.getElementById("fname-lcs-ntm").classList.remove("has-file");
});

/* =========================================================
   BATCH 2 — NTM → UTM
   Expected columns: easting, northing, optional id
========================================================= */
let outCsv_ntmUtm = "";

document.getElementById("batchBtn-ntm-utm").addEventListener("click", async () => {
  const file  = document.getElementById("file-ntm-utm").files[0];
  const belt  = document.getElementById("n2-belt").value;
  const zone  = parseInt(document.getElementById("n2-zone").value, 10);
  const datum = document.getElementById("n2-datum").value;
  const statusId = "batchStatus-ntm-utm";
  if (!file) return showErr(statusId, "Please choose a CSV or Excel file first.");

  try {
    const rows = await readFileAsRows(file);
    if (!rows.length) return showErr(statusId, "File is empty or malformed.");
    const headers = Object.keys(rows[0]);
    if (!headers.includes("easting") || !headers.includes("northing"))
      return showErr(statusId, "File must have columns: easting, northing");

    const out = []; let good = 0, bad = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], id = r.id || String(i+1);
      const e = parseFloat(r.easting), n = parseFloat(r.northing);
      if (!ok(e) || !ok(n)) { bad++; out.push({ id, status:"INVALID" }); continue; }
      try {
        const { utm_e, utm_n, lat, lon } = ntmToUTM(e, n, belt, zone, datum);
        addMarker([lat, lon], { title:"NTM→UTM Point "+id, belt: BELT_LABEL[belt], zone, datum, utm_e, utm_n, lat, lon });
        out.push({ id, easting:e, northing:n,
          utm_easting_m: utm_e.toFixed(3), utm_northing_m: utm_n.toFixed(3),
          latitude: lat.toFixed(7), longitude: lon.toFixed(7),
          zone: zone+"N", belt, datum, status:"OK" });
        good++;
      } catch { bad++; out.push({ id, easting:e, northing:n, status:"CONVERSION_ERROR" }); }
    }

    const b = markersLayer.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.12));

    outCsv_ntmUtm = toCsv(out);
    document.getElementById("downloadBtn-ntm-utm").disabled = false;
    showRes(statusId,
      section("Batch Complete",
        row("Converted", good + " points", true) +
        row("Failed",    bad  + " points") +
        row("Belt / Zone", BELT_LABEL[belt] + " / " + zone+"N") +
        row("Datum", datum.toUpperCase())
      )
    );
  } catch(e) { showErr(statusId, "Processing failed: " + e.message); }
});

document.getElementById("downloadBtn-ntm-utm").addEventListener("click", () => {
  if (outCsv_ntmUtm) downloadCsv("ntm_to_utm_results.csv", outCsv_ntmUtm);
});

document.getElementById("clearBtn-ntm-utm").addEventListener("click", () => {
  clearResultPanel("batchStatus-ntm-utm", "Upload a file and click Process Batch to see results here.");
  document.getElementById("downloadBtn-ntm-utm").disabled = true;
  outCsv_ntmUtm = "";
  document.getElementById("file-ntm-utm").value = "";
  document.getElementById("fname-ntm-utm").textContent = "No file selected";
  document.getElementById("fname-ntm-utm").classList.remove("has-file");
});

/* =========================================================
   BATCH 3 — FULL CHAIN (LCS → UTM)
   Expected columns: east_feet, south_feet, optional id
========================================================= */
let outCsv_full = "";

document.getElementById("batchBtn-full").addEventListener("click", async () => {
  const file  = document.getElementById("file-full").files[0];
  const belt  = document.getElementById("f-belt").value;
  const zone  = parseInt(document.getElementById("f-zone").value, 10);
  const datum = document.getElementById("f-datum").value;
  const statusId = "batchStatus-full";
  if (!file) return showErr(statusId, "Please choose a CSV or Excel file first.");

  try {
    const rows = await readFileAsRows(file);
    if (!rows.length) return showErr(statusId, "File is empty or malformed.");
    const headers = Object.keys(rows[0]);
    if (!headers.includes("east_feet") || !headers.includes("south_feet"))
      return showErr(statusId, "File must have columns: east_feet, south_feet");

    const out = []; let good = 0, bad = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], id = r.id || String(i+1);
      const lcsX = parseFloat(r.east_feet), lcsY = -Math.abs(parseFloat(r.south_feet)); // south_feet is always treated as a magnitude of southing regardless of sign in the file (e.g. "24,386.87" or "-24,386.87" both mean 24,386.87 ft south), then negated to match the signed North(+)/South(-) convention lcsToNTM() expects
      if (!ok(lcsX) || !ok(lcsY)) { bad++; out.push({ id, status:"INVALID" }); continue; }
      try {
        const { utm: { utm_e, utm_n, lat, lon } } = fullChain(lcsX, lcsY, belt, zone, datum);
        addMarker([lat, lon], { title:"Point "+id, belt: BELT_LABEL[belt], zone, datum, utm_e, utm_n, lat, lon });
        out.push({ id, east_feet:lcsX, south_feet:lcsY,
          utm_easting_m: utm_e.toFixed(3), utm_northing_m: utm_n.toFixed(3),
          latitude: lat.toFixed(7), longitude: lon.toFixed(7),
          zone: zone+"N", belt, datum, status:"OK" });
        good++;
      } catch { bad++; out.push({ id, east_feet:lcsX, south_feet:lcsY, status:"CONVERSION_ERROR" }); }
    }

    const b = markersLayer.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.12));

    outCsv_full = toCsv(out);
    document.getElementById("downloadBtn-full").disabled = false;
    showRes(statusId,
      section("Batch Complete",
        row("Converted", good + " points", true) +
        row("Failed",    bad  + " points") +
        row("Belt / Zone", BELT_LABEL[belt] + " / " + zone+"N") +
        row("Datum", datum.toUpperCase())
      )
    );
  } catch(e) { showErr(statusId, "Processing failed: " + e.message); }
});

document.getElementById("downloadBtn-full").addEventListener("click", () => {
  if (outCsv_full) downloadCsv("lcs_to_utm_results.csv", outCsv_full);
});

document.getElementById("clearBtn-full").addEventListener("click", () => {
  clearResultPanel("batchStatus-full", "Upload a file and click Process Batch to see results here.");
  document.getElementById("downloadBtn-full").disabled = true;
  outCsv_full = "";
  document.getElementById("file-full").value = "";
  document.getElementById("fname-full").textContent = "No file selected";
  document.getElementById("fname-full").classList.remove("has-file");
});

/* =========================================================
   UNIT CONVERTER
========================================================= */
const M2FT = 3.280839895, ACRE2M2 = 4046.8564224, HA2ACRE = 2.4710538147, YD22M2 = 0.83612736;
const unitFns = {
  m_to_ft: v=>v*M2FT, ft_to_m: v=>v/M2FT,
  acre_to_m2: v=>v*ACRE2M2, m2_to_acre: v=>v/ACRE2M2,
  hectare_to_acre: v=>v*HA2ACRE, acre_to_hectare: v=>v/HA2ACRE,
  yd2_to_m2: v=>v*YD22M2, m2_to_yd2: v=>v/YD22M2
};

document.getElementById("unitConvertBtn").addEventListener("click", () => {
  const v = parseFloat(document.getElementById("unitInput").value);
  const t = document.getElementById("unitType").value;
  const r = ok(v) && unitFns[t] ? unitFns[t](v) : NaN;
  document.getElementById("unitOutput").value = ok(r) ? r.toFixed(6) : "—";
});

document.getElementById("unitClearBtn").addEventListener("click", () => {
  document.getElementById("unitInput").value = "";
  document.getElementById("unitOutput").value = "";
});

/* =========================================================
   MAP CONTROLS
========================================================= */
document.getElementById("myLocationBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocation not supported by your browser.");
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: la, longitude: lo, accuracy: ac } }) => {
      if (userLocCircle) map.removeLayer(userLocCircle);
      if (userLocMarker) map.removeLayer(userLocMarker);
      userLocCircle = L.circle([la, lo], { radius: ac, color:"#60a5fa", fillOpacity:0.09, weight:1.5 }).addTo(map);
      userLocMarker = L.marker([la, lo], { icon: L.divIcon({
        className:"",
        html:`<div style="width:16px;height:16px;background:#60a5fa;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(96,165,250,.3),0 2px 10px rgba(0,0,0,.4)"></div>`,
        iconSize:[16,16], iconAnchor:[8,8]
      })}).addTo(map);
      userLocMarker.bindPopup(
        `<b style="color:#60a5fa">Your Location</b><br/>` +
        `${la.toFixed(6)}°, ${lo.toFixed(6)}°<br/>±${ac.toFixed(0)} m accuracy`
      ).openPopup();
      map.setView([la, lo], 15);
    },
    () => alert("Could not get location — please enable location services."),
    { enableHighAccuracy: true }
  );
});

document.getElementById("lagosBtn").addEventListener("click", () => map.setView([6.5244, 3.3792], 12));
document.getElementById("clearMapBtn").addEventListener("click", clearMap);

function clearMap() {
  markersLayer.clearLayers();
  ptCount = 0; refreshCounter();
}

/* =========================================================
   MARKER HELPER
========================================================= */
function addMarker([la, lo], { title, belt, zone, datum, utm_e, utm_n, lat, lon }) {
  const m = L.marker([la, lo], { icon: L.divIcon({
    className:"",
    html:`<div style="width:14px;height:14px;background:#4f7eff;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 3px rgba(79,126,255,.4),0 2px 8px rgba(0,0,0,.5)"></div>`,
    iconSize:[14,14], iconAnchor:[7,7]
  })}).addTo(markersLayer);
  m.bindPopup(
    `<b style="color:#4f7eff">${title}</b><br/>` +
    `<span style="opacity:.65">${belt} · Zone ${zone}N · ${datum.toUpperCase()}</span><br/>` +
    `<b>E:</b> ${utm_e.toFixed(3)} m<br/><b>N:</b> ${utm_n.toFixed(3)} m<br/>` +
    `<span style="opacity:.65">${lat.toFixed(6)}°, ${lon.toFixed(6)}°</span>`
  );
  ptCount++; refreshCounter();
}
