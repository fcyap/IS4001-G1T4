// What each zone is used for, from Table 1 of Salama (2021), "Data-driven modeling of smart building
// energy management", Nova SBE, which takes it from the CU-BEMS site. Zone numbers match the dataset.

export type ZoneKind = "office" | "circulation" | "lobby" | "plant" | "exterior";

const FUNCTIONS: Record<number, string[]> = {
  1: ["Sitting hall", "Electrical engine room", "Central stair hall", "Around the building"],
  2: ["Registration and processing office", "Admin department, registration and processing office", "Central stair hall", "Procurement and finance department"],
  3: ["University resource management centre", "Finance department", "Central stair hall", "Planning and information work", "Project analysis and admin activities"],
  4: ["Infrastructure department", "Planning, design and physical systems information department", "Central stair hall", "Accounting department", "Building department"],
  5: ["Mission group, civil servants and employees", "Mission, benefits and personnel relations", "Central stair hall", "HR development department", "HR development department"],
  6: ["Office of strategy management", "Office of research administration", "Central stair hall", "Office of academic admin", "Office of academic admin"],
  7: ["Registration line inspection and procurement parcels", "Legal library and procurement organisation", "Central hall", "Office 3", "Legal and legal centre"],
};

const KIND_LABEL: Record<ZoneKind, string> = {
  office: "Office",
  circulation: "Circulation",
  lobby: "Lobby",
  plant: "Plant Room",
  exterior: "Exterior",
};

/** Where the energy lever is for this kind of space, for the facilities manager. */
const KIND_LEVER: Record<ZoneKind, string> = {
  office: "Office space used during working hours, so after-hours switch-off of lights and plugs and a setpoint raise are the main levers.",
  circulation: "Stair and circulation hall without metered AC. Lighting is the main load: occupancy or daylight controls can cut it, but egress lighting must stay on.",
  lobby: "Ground-floor sitting hall at the main entrance. Lighting-led, so tie lighting to opening hours and daylight.",
  plant: "Electrical plant room. Much of its load is equipment that must keep running, so check with engineering before switching anything off.",
  exterior: "Lighting around the outside of the building only. A timer or photocell schedule is the lever.",
};

function kindOf(floor: number, zone: string): ZoneKind {
  const n = Number(zone.slice(1));
  if (n === 3) return "circulation";
  if (floor === 1) return n === 1 ? "lobby" : n === 2 ? "plant" : "exterior";
  return "office";
}

export interface ZoneUse { name: string; kind: ZoneKind; kindLabel: string; lever: string }

export function zoneUse(floor: number, zone: string): ZoneUse | null {
  const name = FUNCTIONS[floor]?.[Number(zone.slice(1)) - 1];
  if (!name) return null;
  const kind = kindOf(floor, zone);
  return { name, kind, kindLabel: KIND_LABEL[kind], lever: KIND_LEVER[kind] };
}

/** "Zone 2 · Finance department", or just "Zone 2" when the use is unknown. */
export const zoneLabel = (floor: number, zone: string) => {
  const use = zoneUse(floor, zone);
  return `Zone ${zone.slice(1)}${use ? ` · ${use.name}` : ""}`;
};
