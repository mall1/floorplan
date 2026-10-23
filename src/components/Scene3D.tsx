import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { useStudio } from './StudioContext';
import { allWalls, bounds, distance, projectBounds, wallSegments, openingPolygon } from '../model/geometry';
import { floorFor, tilePolygons } from '../model/flooring';
import { DEVICE_KINDS, ROUTE_KINDS } from '../model/presets';
import { buildFurniture, disposeModelMaterials } from '../render/furniture-models';
import { buildOpening } from '../render/architecture-models';
import { resolvedOpening, wallFootprint } from '../model/architecture';
import { walkObstacles, walkStart, walkStep } from '../model/walkthrough';
import type { Point } from '../model/types';
function disposeGroup(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
    }
  });
  materials.forEach((m) => {
    if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
    m.dispose();
  });
  group.clear();
}
function floorTexture(poly: Point[], f: ReturnType<typeof floorFor>) {
  const b = bounds(poly),
    canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(32, Math.min(2048, Math.round((1024 * b.h) / (b.w || 1))));
  const ctx = canvas.getContext('2d')!;
  const tiles = tilePolygons(poly, f);
  ctx.fillStyle = tiles.length >= 16000 ? f.color : f.grout;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = f.color;
  for (const tile of tiles.length >= 16000 ? [] : tiles) {
    ctx.beginPath();
    tile.forEach(([x, y], i) =>
      ctx[i ? 'lineTo' : 'moveTo'](
        ((x - b.x) * canvas.width) / (b.w || 1),
        ((y - b.y) * canvas.height) / (b.h || 1),
      ),
    );
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export default function Scene3D() {
  const s = useStudio(),
    host = useRef<HTMLDivElement>(null),
    latest = useRef(s);
  latest.current = s;
  const [cut, setCut] = useState(true),
    [night, setNight] = useState(false),
    [hour, setHour] = useState(10),
    [walking, setWalking] = useState(false),
    [locked, setLocked] = useState(false),
    [paused, setPaused] = useState(false),
    [position, setPosition] = useState(''),
    [error, setError] = useState('');
  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    walk: PointerLockControls;
    root: THREE.Group;
    light: THREE.DirectionalLight;
    ambient: THREE.HemisphereLight;
    reset: (top?: boolean) => void;
    keys: Set<string>;
    lock: () => void;
  } | null>(null);
  const walkingRef = useRef(walking);
  walkingRef.current = walking;
  const pausedRef = useRef(paused),
    overhead = useRef(false),
    obstacles = useRef(walkObstacles(s.project));
  pausedRef.current = paused;
  useEffect(() => {
    obstacles.current = walkObstacles(s.project);
  }, [s.project]);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setError('当前浏览器无法启动 WebGL，请使用支持硬件加速的浏览器。');
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    container.append(renderer.domElement);
    const scene = new THREE.Scene();
    const environmentScene = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    const environment = generator.fromScene(environmentScene, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.35;
    environmentScene.dispose();
    generator.dispose();
    scene.background = new THREE.Color('#eeeee7');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1500),
      orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI * 0.48;
    orbit.minDistance = 1;
    orbit.maxDistance = 500;
    const walk = new PointerLockControls(camera, renderer.domElement),
      root = new THREE.Group();
    scene.add(root);
    const ambient = new THREE.HemisphereLight('#fffcf0', '#b7c4be', 2.4);
    scene.add(ambient);
    const light = new THREE.DirectionalLight('#fff2d8', 3);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -20;
    light.shadow.camera.right = 20;
    light.shadow.camera.top = 20;
    light.shadow.camera.bottom = -20;
    scene.add(light, light.target);
    const reset = (top = false) => {
      const b = projectBounds({ ...latest.current.project, reference: null }),
        x = (b.x + b.w / 2) / 1000,
        z = (b.y + b.h / 2) / 1000,
        size = Math.max(b.w, b.h) / 1000;
      orbit.target.set(x, 0, z);
      camera.position.set(
        x + (top ? 0 : size * 0.8),
        size * (top ? 1.65 : 1.2),
        z + (top ? 0.001 : size * 1.05),
      );
      camera.lookAt(orbit.target);
      orbit.update();
    };
    const keys = new Set<string>();
    const requestLock = () => {
      try {
        Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => lockError());
      } catch {
        lockError();
      }
    };
    engine.current = {
      renderer,
      scene,
      camera,
      orbit,
      walk,
      root,
      light,
      ambient,
      reset,
      keys,
      lock: requestLock,
    };
    reset();
    const observer = new ResizeObserver(() => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
    });
    observer.observe(container);
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      if (!walkingRef.current) return;
      if (e.code === 'Escape') {
        keys.clear();
        setPaused(true);
        return;
      }
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      )
        e.preventDefault();
      keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => {
      keys.clear();
      if (walkingRef.current) setPaused(true);
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    const lock = () => {
      setLocked(true);
      setPaused(false);
      keys.clear();
    };
    const unlock = () => {
      setLocked(false);
      setPaused(true);
      keys.clear();
    };
    walk.addEventListener('lock', lock);
    walk.addEventListener('unlock', unlock);
    const lockError = () => {
      keys.clear();
      setPaused(false);
      latest.current.notify('浏览器未允许锁定鼠标，可直接拖动视角并用 WASD 移动');
    };
    document.addEventListener('pointerlockerror', lockError);
    const ray = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    let mouseDown: {
      x: number;
      y: number;
      fid?: string;
      rid?: string;
      offset?: THREE.Vector3;
      last?: THREE.Vector3;
    } | null = null;
    const pick = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, (-(e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(root.children, true);
    };
    const pointerDown = (e: PointerEvent) => {
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      if (walkingRef.current) {
        if (!walk.isLocked && !pausedRef.current) {
          mouseDown = { x: e.clientX, y: e.clientY };
          renderer.domElement.setPointerCapture(e.pointerId);
        }
        return;
      }
      const hit = pick(e)[0];
      let obj: THREE.Object3D | undefined = hit?.object;
      while (
        obj &&
        !obj.userData.fid &&
        !obj.userData.doorId &&
        !obj.userData.rid &&
        !obj.userData.openingId &&
        !obj.userData.shaftId &&
        !obj.userData.deviceId
      )
        obj = obj.parent || undefined;
      if (obj?.userData.doorId) {
        const id = obj.userData.doorId;
        latest.current.select({ kind: 'opening', id });
        latest.current.commit((d) => {
          const o = d.openings.find((o) => o.id === id);
          if (o?.doorStyle === 'sliding') o.slideOpen = (o.slideOpen ?? 0) > 0 ? 0 : 100;
          else if (o) o.openAngle = (o.openAngle ?? 90) > 0 ? 0 : 90;
        });
        return;
      }
      if (obj?.userData.openingId) {
        latest.current.select({ kind: 'opening', id: obj.userData.openingId });
        return;
      }
      if (obj?.userData.deviceId) {
        latest.current.select({ kind: 'device', id: obj.userData.deviceId });
        return;
      }
      if (obj?.userData.shaftId) {
        latest.current.select({ kind: 'shaft', id: obj.userData.shaftId });
        return;
      }
      mouseDown = { x: e.clientX, y: e.clientY, fid: obj?.userData.fid, rid: obj?.userData.rid };
      if (obj?.userData.fid && latest.current.selection?.id === obj.userData.fid) {
        const point = new THREE.Vector3();
        if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) {
          mouseDown.offset = obj.position.clone().sub(point);
          orbit.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
        }
      }
    };
    const pointerMove = (e: PointerEvent) => {
      if (walkingRef.current) {
        if (mouseDown && !walk.isLocked && !pausedRef.current) {
          camera.rotation.order = 'YXZ';
          camera.rotation.y -= (e.clientX - mouseDown.x) * 0.004;
          camera.rotation.x = Math.max(
            -1.35,
            Math.min(1.35, camera.rotation.x - (e.clientY - mouseDown.y) * 0.004),
          );
          mouseDown.x = e.clientX;
          mouseDown.y = e.clientY;
        }
        return;
      }
      if (!mouseDown?.offset) return;
      pick(e);
      const point = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) {
        point.add(mouseDown.offset);
        const obj = root.children.find((o) => o.userData.fid === mouseDown!.fid);
        if (obj) {
          obj.position.set(point.x, 0, point.z);
          mouseDown.last = point;
        }
      }
    };
    const pointerUp = (e: PointerEvent) => {
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      if (walkingRef.current) {
        mouseDown = null;
        return;
      }
      if (!mouseDown) return;
      const drag = mouseDown;
      mouseDown = null;
      orbit.enabled = !walkingRef.current;
      if (drag.last && drag.fid) {
        latest.current.commit((d) => {
          const f = d.furniture.find((f) => f.id === drag.fid);
          if (f) {
            f.cx = Math.round((drag.last!.x * 1000) / 50) * 50;
            f.cy = Math.round((drag.last!.z * 1000) / 50) * 50;
          }
        });
      } else if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5)
        latest.current.select(
          drag.fid
            ? { kind: 'furniture', id: drag.fid }
            : drag.rid
              ? { kind: 'room', id: drag.rid }
              : latest.current.selection?.kind === 'opening'
                ? latest.current.selection
                : null,
        );
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const pointerCancel = () => {
      const f = latest.current.project.furniture.find((f) => f.id === mouseDown?.fid);
      const obj = f && root.children.find((o) => o.userData.fid === f.id);
      if (f && obj) obj.position.set(f.cx / 1000, 0, f.cy / 1000);
      mouseDown = null;
      orbit.enabled = !walkingRef.current;
    };
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    const shot = () => {
      renderer.render(scene, camera);
      const a = document.createElement('a');
      a.href = renderer.domElement.toDataURL('image/png');
      a.download = `${latest.current.project.name}-3D.png`;
      a.click();
    };
    window.addEventListener('export-3d', shot);
    let frame = 0,
      lastPosition = 0,
      last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (walkingRef.current && !pausedRef.current) {
        const forward =
            (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
            (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
          side =
            (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
            (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
          before = camera.position.clone(),
          speed = ((keys.has('ShiftLeft') ? 3 : 1.6) * dt) / (Math.hypot(forward, side) || 1);
        walk.moveForward(forward * speed);
        walk.moveRight(side * speed);
        const pt: Point = [camera.position.x * 1000, camera.position.z * 1000];
        const at = walkStep(
          [before.x * 1000, before.z * 1000],
          [pt[0] - before.x * 1000, pt[1] - before.z * 1000],
          obstacles.current,
        );
        camera.position.x = at[0] / 1000;
        camera.position.z = at[1] / 1000;
        camera.position.y = 1.65;
        if (now - lastPosition > 250) {
          setPosition(`${camera.position.x.toFixed(2)}, ${camera.position.z.toFixed(2)} m`);
          lastPosition = now;
        }
      } else if (!walkingRef.current) orbit.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('export-3d', shot);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      walk.removeEventListener('lock', lock);
      walk.removeEventListener('unlock', unlock);
      document.removeEventListener('pointerlockerror', lockError);
      walk.unlock();
      walk.dispose();
      orbit.dispose();
      disposeGroup(root);
      disposeModelMaterials();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    disposeGroup(e.root);
    disposeModelMaterials();
    const p = s.project;
    const addFloor = (poly: Point[], floor: ReturnType<typeof floorFor>, rid?: string) => {
      const shape = new THREE.Shape();
      poly.forEach(([x, y], i) => shape[i ? 'lineTo' : 'moveTo'](x / 1000, -y / 1000));
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const b = bounds(poly),
        pos = geo.attributes.position,
        uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++)
        uv.setXY(i, (pos.getX(i) * 1000 - b.x) / b.w, 1 - (pos.getZ(i) * 1000 - b.y) / b.h);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          map: floorTexture(poly, floor),
          roughness: 0.65,
          side: THREE.DoubleSide,
        }),
      );
      mesh.receiveShadow = true;
      mesh.position.y = 0.005;
      mesh.userData.rid = rid;
      e.root.add(mesh);
    };
    p.rooms.forEach((r) => addFloor(r.poly, floorFor(p, r), r.id));
    const walls = allWalls(p),
      openings = p.openings.map((o) => resolvedOpening(o, walls));
    if (p.continuous)
      openings
        .filter((o) => o.type === 'door' && distance(o.a, o.b) > 0)
        .forEach((o) => addFloor(openingPolygon(o.a, o.b, o.width), p.globalFlooring));
    walls.forEach((w) =>
      wallSegments(w, openings).forEach((seg) => {
        const top = Math.min(seg.top, cut ? 1000 : seg.top);
        if (top <= seg.bottom) return;
        const poly = wallFootprint({ ...w, a: seg.a, b: seg.b }, walls),
          shape = new THREE.Shape();
        poly.forEach(([x, y], i) => shape[i ? 'lineTo' : 'moveTo'](x / 1000, -y / 1000));
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: (top - seg.bottom) / 1000,
          bevelEnabled: false,
        });
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color: w.bearing ? '#b8b9ae' : '#e6e2d6', roughness: 0.75 }),
        );
        mesh.position.y = seg.bottom / 1000;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        e.root.add(mesh);
      }),
    );
    openings.forEach((o) => e.root.add(buildOpening(o, cut)));
    p.shafts.forEach((shaft) => {
      const shape = new THREE.Shape();
      shaft.poly.forEach(([x, y], i) => shape[i ? 'lineTo' : 'moveTo'](x / 1000, -y / 1000));
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.min(shaft.height, cut ? 1000 : 10000) / 1000,
        bevelEnabled: false,
      });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#bcb4a6', roughness: 0.82 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.shaftId = shaft.id;
      e.root.add(mesh);
    });
    if (s.layers.furniture) p.furniture.forEach((f) => e.root.add(buildFurniture(f)));
    if (s.layers.utilities) {
      p.routes.forEach((r) => {
        for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1],
            b = r.points[i],
            v1 = new THREE.Vector3(a[0] / 1000, r.height / 1000 + 0.04, a[1] / 1000),
            v2 = new THREE.Vector3(b[0] / 1000, r.height / 1000 + 0.04, b[1] / 1000);
          if (v1.distanceTo(v2) < 0.001) continue;
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(
              Math.max(0.015, r.diameter / 2000),
              Math.max(0.015, r.diameter / 2000),
              v1.distanceTo(v2),
              8,
            ),
            new THREE.MeshStandardMaterial({ color: ROUTE_KINDS[r.kind].color }),
          );
          mesh.position.copy(v1).add(v2).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.sub(v1).normalize());
          e.root.add(mesh);
        }
      });
      p.devices.forEach((d) => {
        const pipe = d.kind === 'pipe',
          height = Math.min(d.height / 1000, pipe && cut ? 1 : 10);
        const mesh = new THREE.Mesh(
          pipe
            ? new THREE.CylinderGeometry((d.diameter ?? 110) / 2000, (d.diameter ?? 110) / 2000, height, 24)
            : new THREE.BoxGeometry(0.15, 0.15, 0.07),
          new THREE.MeshStandardMaterial({ color: DEVICE_KINDS[d.kind].color }),
        );
        mesh.position.set(d.x / 1000, pipe ? height / 2 : d.height / 1000 + 0.08, d.y / 1000);
        mesh.userData.deviceId = d.id;
        mesh.rotation.y = (-d.rotation * Math.PI) / 180;
        e.root.add(mesh);
      });
    }
  }, [s.project, s.layers.furniture, s.layers.utilities, cut]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const b = projectBounds({ ...s.project, reference: null }),
      x = (b.x + b.w / 2) / 1000,
      z = (b.y + b.h / 2) / 1000,
      a = ((hour - 6) / 12) * Math.PI;
    e.light.position.set(x + Math.cos(a) * 15, Math.max(2, Math.sin(a) * 18), z + 8);
    e.light.target.position.set(x, 0, z);
    e.light.intensity = night ? 0.3 : 2;
    e.ambient.intensity = night ? 0.65 : 1.3;
    e.scene.background = new THREE.Color(night ? '#222e32' : '#eeeee7');
  }, [night, hour, s.project]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.orbit.enabled = !walking;
    e.orbit.enableDamping = !walking;
    e.keys.clear();
    if (walking) {
      e.orbit.update();
      const room =
        s.project.rooms.find((r) => s.selection?.kind === 'room' && r.id === s.selection.id) ||
        s.project.rooms[0];
      const at = room ? walkStart(room, obstacles.current) : null;
      if (!at) {
        setWalking(false);
        s.notify('这个房间没有可站立的位置，请选择更大的房间');
        return;
      }
      setPaused(false);
      e.camera.position.set(at[0] / 1000, 1.65, at[1] / 1000);
      e.camera.lookAt(at[0] / 1000, 1.65, at[1] / 1000 - 2);
    } else {
      e.walk.unlock();
      e.reset(overhead.current);
    }
  }, [walking]);
  return (
    <div className="scene">
      <div ref={host} className="scene-host" />
      {error && <div className="scene-error">{error}</div>}
      <div className="scene-controls">
        <button
          onClick={() => {
            overhead.current = false;
            setWalking(false);
            engine.current?.reset();
          }}
        >
          鸟瞰
        </button>
        <button
          onClick={() => {
            overhead.current = true;
            setWalking(false);
            engine.current?.reset(true);
          }}
        >
          俯视
        </button>
        <button
          className={walking ? 'active' : ''}
          onClick={() => {
            setCut(false);
            setWalking((v) => !v);
          }}
        >
          {walking ? '退出漫游' : '进入漫游'}
        </button>
        <button className={cut ? 'active' : ''} onClick={() => setCut((v) => !v)}>
          {cut ? '剖切墙' : '全高墙'}
        </button>
        <button className={night ? 'active' : ''} onClick={() => setNight((v) => !v)}>
          夜景
        </button>
        {walking && (
          <button
            onClick={() => {
              engine.current?.keys.clear();
              if (locked) engine.current?.walk.unlock();
              else setPaused((v) => !v);
            }}
          >
            {paused ? '继续漫游' : '暂停漫游'}
          </button>
        )}
        {walking && !locked && (
          <button
            onClick={() => {
              engine.current?.lock();
            }}
          >
            锁定鼠标
          </button>
        )}
        <label>
          日照{' '}
          <input
            aria-label="日照时间"
            type="range"
            min="6"
            max="18"
            value={hour}
            onChange={(e) => setHour(+e.target.value)}
          />
          {hour}:00
        </label>
      </div>
      {walking && paused && (
        <div className="walk-overlay">
          <button
            className="primary"
            onClick={() => {
              engine.current?.keys.clear();
              setPaused(false);
            }}
          >
            继续漫游 · WASD 移动 / 拖动转向
          </button>
          <span>Esc 释放鼠标 · Shift 加速</span>
        </div>
      )}
      {walking && !paused && (
        <div className="walk-pad" aria-label="漫游方向控制">
          {[
            ['', ''],
            ['KeyW', '↑'],
            ['', ''],
            ['KeyA', '←'],
            ['KeyS', '↓'],
            ['KeyD', '→'],
          ].map(([key, label], i) =>
            key ? (
              <button
                key={key}
                aria-label={`漫游${{ KeyW: '前进', KeyS: '后退', KeyA: '左移', KeyD: '右移' }[key]}`}
                onPointerDown={(ev) => {
                  ev.currentTarget.setPointerCapture(ev.pointerId);
                  engine.current?.keys.add(key);
                }}
                onPointerUp={() => engine.current?.keys.delete(key)}
                onPointerCancel={() => engine.current?.keys.delete(key)}
              >
                {label}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      )}
      <div className="scene-hint">
        {walking
          ? `WASD / 方向键移动 · ${locked ? '鼠标' : '拖动'}转向 · Esc 暂停 · ${position}`
          : '拖动旋转 · 滚轮缩放 · 右键平移 · 选中家具后拖动 · 点击门扇开关'}
      </div>
    </div>
  );
}
