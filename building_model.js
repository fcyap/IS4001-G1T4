const DATA = window.BUILDING_MODEL_DATA;
const floors = Array.from({ length: 7 }, (_, index) => `Floor${index + 1}`);
const zones = Array.from({ length: 5 }, (_, index) => `z${index + 1}`);
const wasteMapColors = [
  [255, 255, 204],
  [255, 237, 160],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [252, 78, 42],
  [227, 26, 28],
  [189, 0, 38],
  [128, 0, 38],
];

let selectedFloor = null;
let selectedZone = null;
let mode = "classification";
const zoneCaptureRates = Object.fromEntries(
  floors.flatMap((floor) => zones.map((zone) => [`${floor}_${zone}`, 50])),
);

const number = (value) => Number(value || 0);
const money = (value) => `฿${Math.round(value).toLocaleString("en-US")}`;
const format = (value) => number(value).toLocaleString("en-US", {
  maximumFractionDigits: 2,
});

function syncScopeTabs() {
  renderScopeTabs();
}

function renderScopeTabs() {
  const floorTabs = document.querySelector("#floorTabs");
  const floorOptions = [
    `<button type="button" role="tab" data-floor="all" aria-selected="${selectedFloor === null}">Whole building</button>`,
    ...floors.map((floor) => `<button type="button" role="tab" data-floor="${floor}" aria-selected="${selectedFloor === floor}">Floor ${floor.replace("Floor", "")}</button>`),
  ];
  floorTabs.innerHTML = floorOptions.join("");

  const zoneSection = document.querySelector("#zoneTabSection");
  zoneSection.hidden = !selectedFloor;
  if (!selectedFloor) {
    syncScopeCaptureControl();
    return;
  }

  document.querySelector("#zoneTabs").innerHTML = [
    `<button type="button" role="tab" data-zone="all" aria-selected="${selectedZone === null}">All zones</button>`,
    ...zones.map((zone) => `<button type="button" role="tab" data-zone="${zone}" aria-selected="${selectedZone === zone}">${zone.toUpperCase()}</button>`),
  ].join("");
  syncScopeCaptureControl();
}

function scopeZoneKeys() {
  return Object.keys(zoneCaptureRates).filter((key) => {
    const [floor, zone] = key.split("_");
    return (!selectedFloor || floor === selectedFloor)
      && (!selectedZone || zone === selectedZone);
  });
}

function syncScopeCaptureControl() {
  const rates = [...new Set(scopeZoneKeys().map((key) => zoneCaptureRates[key]))];
  const rate = rates[0] ?? 50;
  document.querySelector("#reduction").value = rate;
  document.querySelector("#reductionLabel").textContent = rates.length > 1
    ? "Mixed"
    : `${rate}%`;
}

function wasteMapColor(intensity) {
  const position = intensity * (wasteMapColors.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, wasteMapColors.length - 1);
  const blend = position - lowerIndex;
  const rgb = wasteMapColors[lowerIndex].map((channel, index) => (
    Math.round(channel + (wasteMapColors[upperIndex][index] - channel) * blend)
  ));

  return `rgb(${rgb.join(", ")})`;
}

function renderSummary() {
  const wasteCircuits = DATA.filter(
    (circuit) => circuit.Classification === "Preventable Waste",
  );
  const annualCost = wasteCircuits.reduce(
    (total, circuit) => total + number(circuit.Annual_Avoided_Cost_THB),
    0,
  );
  document.querySelector("#summary").innerHTML = `
    <div class="metric">
      <span>Floors represented</span><strong>${floors.length}</strong>
    </div>
    <div class="metric">
      <span>Preventable waste labels</span><strong>${wasteCircuits.length}</strong>
    </div>
    <div class="metric">
      <span>Annual cost opportunity · excl. VAT</span>
      <strong>${money(annualCost)}</strong>
    </div>`;
}

function renderCircuitChip(floor, zone, type, label) {
  const compactLabel = type === "Light" ? "L" : "P";
  const circuit = DATA.find(
    (item) => item.Floor === floor && item.Zone_Col === `${zone}_${type}`,
  );

  if (!circuit) {
    return `<span class="chip empty" title="${label}: no circuit recorded">${compactLabel} —</span>`;
  }
  const classification = circuit.Classification === "Preventable Waste"
    ? "waste"
    : "critical";
  const maximumLoad = Math.max(
    ...DATA.map((item) => number(item.Unocc_Mean_kW)),
    1,
  );
  const loadLevel = Math.min(
    4,
    Math.ceil(number(circuit.Unocc_Mean_kW) / maximumLoad * 4),
  );
  const loadClass = mode === "load" && classification === "waste"
    ? `level-${loadLevel}`
    : "";
  const value = mode === "load" ? format(circuit.Unocc_Mean_kW) : "";
  const chipText = value ? `${compactLabel} ${value}` : compactLabel;

  return `
    <span class="chip ${classification} ${loadClass}"
      aria-label="${label}: ${format(circuit.Unocc_Mean_kW)} kW, ${circuit.Classification}"
      title="${label}: ${format(circuit.Unocc_Mean_kW)} kW · ${circuit.Classification}">
      ${chipText}
    </span>`;
}

function renderZone(floor, zone) {
  const isSelected = !selectedZone || selectedZone === zone;
  const opacity = isSelected ? "" : "opacity:.22";
  const lighting = renderCircuitChip(floor, zone, "Light", "Light");
  const plugLoad = renderCircuitChip(floor, zone, "Plug", "Plug");

  return `
    <div class="zone" data-zone="${zone}" style="${opacity}">
      <div class="zone-name">${zone.toUpperCase()}</div>
      <div class="chips">${lighting}${plugLoad}</div>
    </div>`;
}

function renderBuilding() {
  const building = document.querySelector("#building");
  const floorMarkup = [...floors].reverse().map((floor) => {
    const filtered = selectedFloor && selectedFloor !== floor ? "filtered" : "";
    const selected = selectedFloor === floor ? "selected" : "";
    const circuitCount = DATA.filter((item) => item.Floor === floor).length;
    const zoneMarkup = zones.map((zone) => renderZone(floor, zone)).join("");

    return `
      <div class="floor ${filtered} ${selected}" data-floor="${floor}">
        <div class="floor-label">
          ${floor.replace("Floor", "FLOOR ")}
          <small>${circuitCount} circuits</small>
        </div>
        ${zoneMarkup}
      </div>`;
  }).join("");

  building.innerHTML = `
    <div class="roof"></div>
    ${floorMarkup}
    <div class="building-base"></div>`;

  attachFloorClickHandlers();
}

function attachFloorClickHandlers() {
  const building = document.querySelector("#building");

  building.querySelectorAll(".floor").forEach((floorElement) => {
    floorElement.addEventListener("click", (event) => {
      const zone = event.target.closest(".zone")?.dataset.zone;
      const floor = floorElement.dataset.floor;

      if (zone) {
        selectedFloor = floor;
        selectedZone = zone;
        renderDetails(selectedFloor, selectedZone);
      } else if (selectedFloor === floor) {
        selectedFloor = null;
        selectedZone = null;
        renderDetails(null, null);
      } else {
        selectedFloor = floor;
        selectedZone = null;
        renderDetails(selectedFloor, null);
      }

      syncScopeTabs();
      renderSummary();
      renderBuilding();
      updateSimulator();
    });
  });

}

function renderDetails(floor, zone) {
  const details = document.querySelector("#details");

  if (!floor) {
    details.className = "detail-empty";
    details.textContent = "Choose a floor or zone on the model to see its audit details.";
    return;
  }

  const circuits = DATA.filter((circuit) => (
    circuit.Floor === floor
    && (!zone || circuit.Zone_Col.startsWith(`${zone}_`))
  ));
  const annualWasteCost = circuits
    .filter((circuit) => circuit.Classification === "Preventable Waste")
    .reduce((total, circuit) => total + number(circuit.Annual_Avoided_Cost_THB), 0);
  const circuitCards = circuits.map((circuit) => {
    const classification = circuit.Classification === "Preventable Waste"
      ? "waste"
      : "critical";

    return `
      <div class="circuit">
        <div class="circuit-top">
          <span class="circuit-name">${circuit.Type} · ${circuit.Zone_Col}</span>
          <span class="badge ${classification}">${circuit.Classification}</span>
        </div>
        <div class="facts">
          <div class="fact">
            <span>After-hours mean</span>
            <b>${format(circuit.Unocc_Mean_kW)} kW</b>
          </div>
          <div class="fact">
            <span>Occ. ratio</span><b>${format(circuit.Unocc_to_Occ_Ratio)}×</b>
          </div>
          <div class="fact">
            <span>Annual surplus</span>
            <b>${Math.round(number(circuit.Annual_Surplus_kWh)).toLocaleString()} kWh</b>
          </div>
          <div class="fact">
            <span>Annual cost estimate</span>
            <b>${money(circuit.Annual_Avoided_Cost_THB)}</b>
          </div>
        </div>
      </div>`;
  }).join("");

  details.className = "";
  details.innerHTML = `
    <div class="detail-title">
      ${floor.replace("Floor", "Floor ")}${zone ? ` · ${zone.toUpperCase()}` : ""}
    </div>
    <div class="detail-sub">
      ${circuits.length} audited circuits · ${money(annualWasteCost)} estimated preventable cost / year
    </div>
    ${circuitCards || '<div class="detail-empty">No audited circuit is available for this zone.</div>'}`;
}

function renderWasteMap() {
  const map = document.querySelector("#heatMap");
  const circuitColumns = [...new Set(DATA.map((item) => item.Zone_Col))].sort((a, b) => {
    const zoneNumber = (value) => Number(value.match(/z(\d+)/)?.[1] || 0);
    const loadOrder = (value) => value.endsWith("Light") ? 0 : 1;
    return zoneNumber(a) - zoneNumber(b) || loadOrder(a) - loadOrder(b);
  });
  const cells = floors.flatMap((floor) => circuitColumns.map((column) => {
    const circuit = DATA.find(
      (item) => item.Floor === floor && item.Zone_Col === column,
    );
    return {
      floor,
      column,
      circuit,
      mwh: number(circuit?.Surplus_kWh_18M) / 1000,
    };
  }));
  const maximumMwh = Math.max(
    ...cells.map((cell) => cell.mwh),
    0.1,
  );
  const columnHeaders = circuitColumns.map((column) => `
    <div class="heat-head">${column.replace("_", "<br>")}</div>`).join("");
  const floorRows = [...floors].reverse().map((floor) => {
    const cellsForFloor = circuitColumns.map((column) => {
      const cell = cells.find((item) => item.floor === floor && item.column === column);
      const intensity = cell.mwh / maximumMwh;
      const textColor = intensity > 0.75 ? "#fff" : "#5b2810";
      const zone = cell.column.match(/^z\d+/)?.[0];
      const isActive = (!selectedFloor || selectedFloor === floor)
        && (!selectedZone || selectedZone === zone);
      const dataStatus = cell.circuit ? "" : "no-data";
      const filterStatus = isActive ? "" : "dim";
      const selectedStatus = selectedFloor === floor && selectedZone === zone
        ? "active"
        : "";
      const missingNote = cell.circuit ? "" : " · no circuit recorded";

      return `
        <button class="heat-cell ${dataStatus} ${filterStatus} ${selectedStatus}"
          data-floor="${floor}" data-zone="${zone}"
          style="background:${wasteMapColor(intensity)};color:${textColor}"
          title="${floor} ${cell.column} · ${cell.mwh.toFixed(1)} MWh 18-month surplus${missingNote}">
          ${cell.mwh.toFixed(1)}<small>MWh</small>
        </button>`;
    }).join("");

    return `<div class="heat-floor">${floor.replace("Floor", "F")}</div>${cellsForFloor}`;
  }).join("");

  map.innerHTML = `<div></div>${columnHeaders}${floorRows}`;
}

function updateSimulator() {
  const circuits = DATA.filter((circuit) => (
    (!selectedFloor || circuit.Floor === selectedFloor)
    && (!selectedZone || circuit.Zone_Col.startsWith(`${selectedZone}_`))
    && circuit.Classification === "Preventable Waste"
  ));
  const annualEnergy = circuits.reduce(
    (total, circuit) => total + number(circuit.Annual_Surplus_kWh),
    0,
  );
  const annualCost = circuits.reduce(
    (total, circuit) => total + number(circuit.Annual_Avoided_Cost_THB),
    0,
  );
  const scenario = circuits.reduce((totals, circuit) => {
    const zone = circuit.Zone_Col.split("_")[0];
    const captureRate = zoneCaptureRates[`${circuit.Floor}_${zone}`] ?? 50;
    const currentLoad = number(circuit.Unocc_Mean_kW);
    const baselineLoad = number(circuit.Baseload_kW);
    totals.currentLoad += currentLoad;
    totals.baselineLoad += baselineLoad;
    totals.projectedLoad += currentLoad - Math.max(0, currentLoad - baselineLoad) * captureRate / 100;
    totals.energy += number(circuit.Annual_Surplus_kWh) * captureRate / 100;
    totals.cost += number(circuit.Annual_Avoided_Cost_THB) * captureRate / 100;
    return totals;
  }, { energy: 0, cost: 0, currentLoad: 0, projectedLoad: 0, baselineLoad: 0 });
  const scope = selectedFloor
    ? `${selectedFloor.replace("Floor", "Floor ")}${selectedZone ? ` · ${selectedZone.toUpperCase()}` : ""}`
    : "whole building";

  document.querySelector("#simScope").textContent = `Scope: ${scope}`;
  document.querySelector("#simBase").textContent =
    `Annualized opportunity · scope: ${Math.round(annualEnergy).toLocaleString()} kWh and ${money(annualCost)} excl. VAT`;
  document.querySelector("#simEnergy").textContent =
    `${Math.round(scenario.energy).toLocaleString()} kWh`;
  document.querySelector("#simCost").textContent = money(scenario.cost);
  document.querySelector("#simCostVat").textContent =
    `incl. 7% VAT: ${money(scenario.cost * 1.07)}`;
  document.querySelector("#simCurrentLoad").textContent = `${format(scenario.currentLoad)} kW`;
  document.querySelector("#simProjectedLoad").textContent = `${format(scenario.projectedLoad)} kW`;
  document.querySelector("#simBaselineLoad").textContent = `${format(scenario.baselineLoad)} kW`;

  syncScopeCaptureControl();
  renderWasteMap();
}

function applyCaptureToScope(event) {
  const captureRate = Number(event.currentTarget.value);
  document.querySelector("#reductionLabel").textContent = `${captureRate}%`;
  for (const key of scopeZoneKeys()) zoneCaptureRates[key] = captureRate;
  updateSimulator();
}

function selectFromWasteMap(event) {
  const cell = event.target.closest(".heat-cell[data-floor]");
  if (!cell) return;

  selectedFloor = cell.dataset.floor;
  selectedZone = cell.dataset.zone;
  syncScopeTabs();
  renderSummary();
  renderDetails(selectedFloor, selectedZone);
  renderBuilding();
  updateSimulator();
  document.querySelector("#tab-building").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function setBuildingColorMode(event) {
  mode = event.currentTarget.dataset.mode;
  document.querySelectorAll(".mode button").forEach((button) => {
    button.classList.toggle("active", button === event.currentTarget);
  });
  renderBuilding();
}

document.querySelector("#reduction").addEventListener("input", applyCaptureToScope);
document.querySelector("#building").addEventListener("click", () => {
  setTimeout(updateSimulator, 0);
});
document.querySelector("#heatMap").addEventListener("click", selectFromWasteMap);
document.querySelector("#floorTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-floor]");
  if (!tab) return;
  selectedFloor = tab.dataset.floor === "all" ? null : tab.dataset.floor;
  selectedZone = null;
  syncScopeTabs();
  renderDetails(selectedFloor, null);
  renderBuilding();
  updateSimulator();
});
document.querySelector("#zoneTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-zone]");
  if (!tab) return;
  selectedZone = tab.dataset.zone === "all" ? null : tab.dataset.zone;
  renderScopeTabs();
  renderDetails(selectedFloor, selectedZone);
  renderBuilding();
  updateSimulator();
});
document.querySelectorAll(".mode button").forEach((button) => {
  button.addEventListener("click", setBuildingColorMode);
});

renderSummary();
renderScopeTabs();
renderBuilding();
updateSimulator();
