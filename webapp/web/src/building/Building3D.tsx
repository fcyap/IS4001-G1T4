import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ZoneInfo } from "../lib/api";
import { C, MEASURES } from "../lib/colors";
import { replayValue, useData, zoneValue } from "../lib/data";
import { useStore, zoneName } from "../lib/store";
import { FLOORS, FLOOR_H, LIFT, SLAB, ZONE_H, bandShape, coreShape, floorY, footprint, stairSpan } from "./layout";

const fmt = (v: number | null, unit: string) =>
  v === null ? "no data" : `${unit === "" ? (v > 0 ? "+" : "") + v.toFixed(2) : Math.round(v).toLocaleString()}${unit ? ` ${unit === "%" ? "%" : unit}` : ""}`;

/** Value + colour for one zone under the current mode, measure and replay step. */
function useZoneLook(z: ZoneInfo) {
  const { byId, replay } = useData();
  const mode = useStore((s) => s.mode);
  const measure = useStore((s) => s.measure);
  const t = useStore((s) => s.replay.t);
  const after = useStore((s) => s.replay.after);
  if (z.status === "nodata") return { value: null, color: C.nodata };
  const m = mode === "replay" ? (measure === "ac" ? "ac" : "pmv") : measure;
  const value = mode === "replay"
    ? replayValue(replay, z.id, m, t, after)
    : zoneValue(byId.get(z.id), m, mode === "whatif");
  return { value, color: value === null ? C.nodata : MEASURES[m].color(value), measure: m };
}

const UP: [number, number, number] = [-Math.PI / 2, 0, 0];   // stands an XY-plane extrusion upright
const STONE = "#8d9bb0";
const NO_RAYCAST = () => null;                                 // faded/hidden floors must not catch clicks                                       // facade elements stay neutral so colour = data

function Zone({ z, faded }: { z: ZoneInfo; faded: boolean }) {
  const f = footprint(z.floor, z.zone);
  const { value, color, measure } = useZoneLook(z);
  const { byId } = useData();
  const mode = useStore((s) => s.mode);
  const scope = useStore((s) => s.scope);
  const hover = useStore((s) => s.hover);
  const select = useStore((s) => s.select);
  const setHover = useStore((s) => s.setHover);
  const breach = mode === "whatif" && (byId.get(z.id)?.breach.length ?? 0) > 0;
  const selected = scope.floor === z.floor && scope.zone === z.zone;
  const isHover = hover === z.id;
  const pulse = useRef<THREE.LineBasicMaterial>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const target = useMemo(() => new THREE.Color(color), [color]);
  const h = z.status === "nodata" ? ZONE_H * 0.55 : ZONE_H;
  const geom = useMemo(() => new THREE.ExtrudeGeometry(f.shape, { depth: h, bevelEnabled: false }), [f, h]);
  const outline = useMemo(() => new THREE.EdgesGeometry(geom, 20), [geom]);

  useFrame(({ clock }, dt) => {
    if (mat.current) {               // ease colour changes so what-if and replay read as change
      mat.current.color.lerp(target, Math.min(1, dt * 6));
      mat.current.emissive.copy(mat.current.color);
    }
    if (pulse.current) pulse.current.opacity = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4));
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(scope.floor === z.floor ? { floor: z.floor, zone: z.zone } : { floor: z.floor });
  };
  const edge = selected ? "#ffffff" : isHover ? "#cfe0f2" : z.inspect ? C.inspect : "#41597a";

  return (
    <group position={[0, 0.17, 0]}>
      <mesh
        geometry={geom}
        rotation={UP}
        raycast={faded ? NO_RAYCAST : THREE.Mesh.prototype.raycast}
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); setHover(z.id); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(null); document.body.style.cursor = ""; }}
      >
        <meshStandardMaterial
          ref={mat}
          color={color}
          emissive={color}
          emissiveIntensity={z.status === "nodata" ? 0.05 : selected ? 0.75 : 0.42}
          roughness={0.55}
          metalness={0.05}
          transparent
          opacity={faded ? 0.14 : z.status === "nodata" ? 0.55 : 0.9}
          depthWrite={!faded}
        />
        {!breach && <Edges color={edge} threshold={20} visible={!faded || selected} />}
      </mesh>
      {breach && !faded && (
        <lineSegments geometry={outline} rotation={UP}>
          <lineBasicMaterial ref={pulse} color={C.alert} transparent />
        </lineSegments>
      )}
      {(isHover || (scope.floor === z.floor && !scope.zone)) && !faded && (
        <Html center position={[f.cx, h + 0.7, f.cz]} pointerEvents="none" zIndexRange={[20, 0]}>
          <div className={`tag ${isHover ? "tag-hover" : ""}`}>
            <b>{zoneName(z.zone)}</b>
            <span>{z.status === "nodata" ? (z.note ?? "no sensor") : fmt(value, MEASURES[measure ?? "pmv"].unit)}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function Floor({ floor, zones }: { floor: number; zones: ZoneInfo[] }) {
  const scope = useStore((s) => s.scope);
  const view = useStore((s) => s.view);
  const select = useStore((s) => s.select);
  const group = useRef<THREE.Group>(null);
  const focus = scope.floor === floor;
  const faded = scope.floor !== undefined && !focus;
  const base = floorY(floor);
  const lift = focus ? LIFT : scope.floor !== undefined && floor > scope.floor ? LIFT * 2.4 : 0;
  const band = useMemo(() => new THREE.ExtrudeGeometry(bandShape(), { depth: 0.17, bevelEnabled: false, curveSegments: 10 }), []);
  const core = useMemo(() => new THREE.ExtrudeGeometry(coreShape(floor), { depth: ZONE_H, bevelEnabled: false }), [floor]);

  useFrame((_, dt) => {
    if (group.current) group.current.position.y += (base + lift - group.current.position.y) * Math.min(1, dt * 5);
  });

  return (
    <group ref={group} position={[0, base, 0]} visible={!(view === "plan" && faded)}>
      {/* projecting floor band with rounded ends, as on the Chamchuri 5 facade */}
      <mesh geometry={band} rotation={UP}>
        <meshStandardMaterial color={focus ? "#3a5272" : "#2a3d57"} transparent opacity={faded ? 0.08 : focus ? 0.8 : 0.42} depthWrite={false} roughness={0.6} />
        <Edges color={focus ? "#a9c2de" : STONE} threshold={20} visible={!faded} />
      </mesh>
      {/* lift core */}
      <mesh geometry={core} rotation={UP} position={[0, 0.17, 0]}>
        <meshStandardMaterial color="#3b4a60" transparent opacity={faded ? 0.08 : 0.8} />
        <Edges color="#5a6c86" visible={!faded} />
      </mesh>
      {zones.map((z) => <Zone key={z.id} z={z} faded={faded} />)}
      {/* number tags pick a floor from the whole-building view; once a floor is chosen the stage floor picker takes over */}
      {view === "3d" && scope.floor === undefined && <Html position={[-SLAB.w / 2 - 3.2, 0.6, SLAB.d / 2]} center zIndexRange={[10, 0]}>
        <button className="floor-tag" aria-label={`Go to floor ${floor}`}
          onClick={() => select({ floor })}>{floor}</button>
      </Html>}
    </group>
  );
}

/** Stair towers with vertical glazing on both short sides, roof plant rooms and the rooftop PV array. */
function Exterior() {
  const scope = useStore((s) => s.scope);
  const view = useStore((s) => s.view);
  const top = FLOORS * FLOOR_H;
  const [z0, z1] = stairSpan(3);
  const tower = { w: 1.7, d: z1 - z0, h: top + 1.1, cz: (z0 + z1) / 2 };
  const roof = useMemo(() => new THREE.ExtrudeGeometry(bandShape(0.5, 1.4), { depth: 0.3, bevelEnabled: false, curveSegments: 10 }), []);
  const pv = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.05, 0.95),
      new THREE.MeshStandardMaterial({ color: "#2d4f7f", metalness: 0.6, roughness: 0.3, emissive: "#0f2442" }), 2 * 6 * 9);
    const o = new THREE.Object3D();
    let i = 0;
    for (const side of [-1, 1])
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 9; c++) {
          o.position.set(-5.2 + c * 1.3, 0.5, side * (0.9 + r * 1.08));
          o.rotation.set(side * 0.16, 0, 0);
          o.updateMatrix();
          m.setMatrixAt(i++, o.matrix);
        }
    return m;
  }, []);
  const fade = scope.floor !== undefined;
  const op = (v: number) => (fade ? v * 0.15 : v);

  return (
    <group visible={!(view === "plan" && fade)}>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (SLAB.w / 2 + tower.w / 2 + 0.1), 0, tower.cz]}>
          <mesh position={[0, tower.h / 2, 0]}>
            <boxGeometry args={[tower.w, tower.h, tower.d]} />
            <meshStandardMaterial color="#22344c" transparent opacity={op(0.55)} depthWrite={false} />
            <Edges color={STONE} visible={!fade} />
          </mesh>
          <mesh position={[side * (tower.w / 2 + 0.02), tower.h / 2, 0]}>
            <boxGeometry args={[0.04, tower.h - 1.6, tower.d * 0.12]} />
            <meshStandardMaterial color="#59b5e8" emissive="#2d7fb8" emissiveIntensity={0.35} transparent opacity={op(0.45)} />
          </mesh>
        </group>
      ))}
      <group position={[0, top + 0.05, 0]} visible={!fade}>
        <mesh geometry={roof} rotation={UP}>
          <meshStandardMaterial color="#2b3e58" roughness={0.7} />
          <Edges color={STONE} threshold={20} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * 9.2, 0.95, 0]}>
            <boxGeometry args={[4.2, 1.3, SLAB.d - 1]} />
            <meshStandardMaterial color="#33465f" />
            <Edges color={STONE} />
          </mesh>
        ))}
        <primitive object={pv} />
      </group>
    </group>
  );
}

function Ground() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(64,120,190,0.35)");
    grad.addColorStop(0.55, "rgba(30,60,100,0.12)");
    grad.addColorStop(1, "rgba(12,24,41,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
  const rings = useMemo(() => new THREE.PolarGridHelper(34, 24, 6, 96, "#1d3554", "#172b45"), []);
  return (
    <group position={[0, -0.12, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[46, 64]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
      <primitive object={rings} />
    </group>
  );
}

/** Eases the camera to the selected scope, then hands control back to the user. */
function CameraRig({ zones }: { zones: ZoneInfo[] }) {
  const scope = useStore((s) => s.scope);
  const view = useStore((s) => s.view);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const y = scope.floor !== undefined ? floorY(scope.floor) + LIFT : 6.5;
    const target = new THREE.Vector3(0, y, 0);
    let pos = new THREE.Vector3(42, 30, 54);
    if (scope.floor !== undefined) pos = new THREE.Vector3(20, y + 30, 40);
    if (scope.floor !== undefined && scope.zone) {
      const f = footprint(scope.floor, scope.zone);
      target.set(f.cx, y, f.cz);
      pos = new THREE.Vector3(f.cx + 16, y + 28, f.cz + 36);
    }
    if (view === "plan") {
      const top = scope.floor !== undefined ? y : floorY(7);
      target.set(scope.zone ? target.x : 0, top, scope.zone ? target.z : 0);
      pos = new THREE.Vector3(target.x, top + (scope.zone ? 24 : 44), target.z + 0.01);
    }
    goal.current = { pos, target };
  }, [scope, view, zones]);

  useEffect(() => {                 // the user grabbing the view cancels any camera move in flight
    if (!controls) return;
    const stop = () => { goal.current = null; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    if (!goal.current || !controls) return;
    const k = Math.min(1, dt * 3.2);
    camera.position.lerp(goal.current.pos, k);
    controls.target.lerp(goal.current.target, k);
    controls.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.05) goal.current = null;
  });
  return null;
}

export default function Building3D() {
  const { meta } = useData();
  const select = useStore((s) => s.select);
  const view = useStore((s) => s.view);
  const zones = meta?.zones ?? [];
  // Clicking empty space goes up one level; in plan view it never leaves the chosen floor.
  // Only clicks on the canvas itself count: clicks on HTML labels (floor tags) bubble here too.
  const up = (e: MouseEvent) => {
    if (e.type !== "click" || !(e.target instanceof HTMLCanvasElement)) return;
    const { scope: cur, view: v } = useStore.getState();
    if (cur.zone) select({ floor: cur.floor });
    else if (v !== "plan") select({});
  };
  const floors = meta?.floors ?? [];

  return (
    <Canvas
      camera={{ position: [42, 30, 54], fov: 34, near: 0.5, far: 400 }}
      dpr={[1, 2]}
      onPointerMissed={up}
    >
      <color attach="background" args={[C.night]} />
      <fog attach="fog" args={[C.night, 60, 130]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#9cc4ff", "#0c1829", 0.6]} />
      <directionalLight position={[20, 40, 25]} intensity={1.1} />
      <group>
        {floors.map((f) => <Floor key={f} floor={f} zones={zones.filter((z) => z.floor === f)} />)}
        <Exterior />
      </group>
      <Ground />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={12}
        maxDistance={90}
        maxPolarAngle={view === "plan" ? 0.01 : Math.PI / 2.05}
        minPolarAngle={0}
      />
      <CameraRig zones={zones} />
    </Canvas>
  );
}
