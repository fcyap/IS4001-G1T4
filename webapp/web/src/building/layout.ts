// Zone footprints traced from CU-BEMS Fig. 2 (Pipattanasomporn et al., 2020, Scientific Data):
// one plan for Floors 1-2, another for Floors 3-7. Coordinates are pixels in that figure, mapped
// onto a SLAB.w x SLAB.d scene footprint; image top = back of the building (-z), bottom = front.
import * as THREE from "three";

export const SLAB = { w: 24, d: 16 };
export const FLOOR_H = 2.15;          // storey spacing in scene units
export const ZONE_H = 1.2;
export const LIFT = 3.6;              // how far a selected floor rises out of the stack
export const FLOORS = 7;

type Pt = [number, number];
interface Plan { box: [x0: number, x1: number, y0: number, y1: number]; zones: Record<string, Pt[]>; core: Pt[]; stairs: [y0: number, y1: number] }

const LOW: Plan = {                   // Floors 1-2 (Fig. 2, left)
  box: [85, 925, 200, 765],
  zones: {
    z1: [[530, 200], [925, 200], [925, 765], [570, 765], [570, 500], [455, 500], [455, 345], [530, 290]],
    z2: [[85, 200], [530, 200], [530, 290], [455, 345], [455, 500], [250, 500], [250, 450], [85, 450]],
    z3: [[290, 500], [570, 500], [570, 580], [530, 580], [530, 765], [290, 765]],
    z4: [[85, 450], [250, 450], [250, 500], [290, 500], [290, 765], [85, 765]],
  },
  core: [[530, 580], [570, 580], [570, 765], [530, 765]],
  stairs: [280, 685],
};

const HIGH: Plan = {                  // Floors 3-7 (Fig. 2, right)
  box: [1110, 1930, 200, 765],
  zones: {
    z1: [[1430, 200], [1930, 200], [1930, 435], [1575, 435], [1575, 495], [1515, 495], [1515, 380], [1430, 380]],
    z2: [[1575, 435], [1930, 435], [1930, 765], [1620, 765], [1620, 500], [1575, 500]],
    z3: [[1300, 495], [1575, 495], [1575, 765], [1300, 765]],
    z4: [[1110, 200], [1430, 200], [1430, 380], [1515, 380], [1515, 495], [1300, 495], [1300, 435], [1110, 435]],
    z5: [[1110, 435], [1300, 435], [1300, 765], [1110, 765]],
  },
  core: [[1575, 500], [1620, 500], [1620, 765], [1575, 765]],
  stairs: [285, 690],
};

export const planFor = (floor: number) => (floor <= 2 ? LOW : HIGH);

function toScene(p: Plan, [px, py]: Pt): Pt {
  const [x0, x1, y0, y1] = p.box;
  return [-SLAB.w / 2 + ((px - x0) / (x1 - x0)) * SLAB.w, -SLAB.d / 2 + ((py - y0) / (y1 - y0)) * SLAB.d];
}

/** Shape in the XY plane with y = -z, so rotating the extrusion by -90° about X stands it up. */
function shapeOf(pts: Pt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}

function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cz = 0;
  pts.forEach(([x0, z0], i) => {
    const [x1, z1] = pts[(i + 1) % pts.length];
    const k = x0 * z1 - x1 * z0;
    a += k; cx += (x0 + x1) * k; cz += (z0 + z1) * k;
  });
  return [cx / (3 * a), cz / (3 * a)];
}

/** Shrink a polygon slightly toward its centroid so neighbouring zones read as separate rooms. */
const inset = (pts: Pt[], c: Pt, k = 0.985): Pt[] => pts.map(([x, z]) => [c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k]);

export interface Footprint { cx: number; cz: number; shape: THREE.Shape }

const cache = new Map<string, Footprint>();
export function footprint(floor: number, zone: string): Footprint {
  const key = `${floor <= 2 ? "low" : "high"}:${zone}`;
  if (!cache.has(key)) {
    const plan = planFor(floor);
    const pts = plan.zones[zone].map((p) => toScene(plan, p));
    const c = centroid(pts);
    cache.set(key, { cx: c[0], cz: c[1], shape: shapeOf(inset(pts, c)) });
  }
  return cache.get(key)!;
}

export function coreShape(floor: number): THREE.Shape {
  const plan = planFor(floor);
  return shapeOf(plan.core.map((p) => toScene(plan, p)));
}

/** z-range of the stair towers on the two short sides. */
export function stairSpan(floor: number): [number, number] {
  const p = planFor(floor);
  return [toScene(p, [0, p.stairs[0]])[1], toScene(p, [0, p.stairs[1]])[1]];
}

/** Rounded slab outline, a little larger than the plan: the projecting floor bands of the facade. */
export function bandShape(margin = 0.9, r = 1.6): THREE.Shape {
  const w = SLAB.w / 2 + margin, d = SLAB.d / 2 + margin;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -d);
  s.lineTo(w - r, -d); s.quadraticCurveTo(w, -d, w, -d + r);
  s.lineTo(w, d - r); s.quadraticCurveTo(w, d, w - r, d);
  s.lineTo(-w + r, d); s.quadraticCurveTo(-w, d, -w, d - r);
  s.lineTo(-w, -d + r); s.quadraticCurveTo(-w, -d, -w + r, -d);
  return s;
}

export const floorY = (floor: number) => (floor - 1) * FLOOR_H;
