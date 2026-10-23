import * as THREE from 'three';
import { distance } from '../model/geometry';
import { openingLevels } from '../model/architecture';
import type { Opening } from '../model/types';

/** Millimetre inputs; local X follows the opening and local Z is its left normal. */
export function buildOpening(o: Opening, cut: boolean) {
  const root = new THREE.Group(),
    len = distance(o.a, o.b) / 1000,
    depth = o.width / 1000;
  root.position.set(o.a[0] / 1000, 0, o.a[1] / 1000);
  root.rotation.y = -Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]);
  root.userData.openingId = o.id;
  const levels = openingLevels(o),
    bottom = levels.bottom / 1000,
    top = Math.min(levels.top / 1000, cut ? 1 : 10);
  const wood = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.52 });
  const trim = new THREE.MeshStandardMaterial({ color: '#eee8dc', roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: '#a5aaa9', roughness: 0.28, metalness: 0.8 });
  const frame = new THREE.MeshStandardMaterial({ color: '#3e5458', roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#b3d9df',
    roughness: 0.1,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Dispose unused materials as well: only materials on meshes are collected by scene cleanup.
  const used = new Set<THREE.Material>();
  const box = (
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
  ) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mat !== glass;
    mesh.receiveShadow = true;
    parent.add(mesh);
    used.add(mat);
    return mesh;
  };
  if (o.type === 'threshold') box(root, len / 2, 0.02, 0, len, 0.03, depth, wood);
  if (o.type === 'railing') {
    const height = Math.min((o.railingHeight ?? 1100) / 1000, cut ? 1 : 10),
      count = Math.max(1, Math.ceil(len / 1.1)),
      panel = len / count;
    box(root, len / 2, 0.025, 0, len, 0.05, 0.06, metal);
    box(root, len / 2, height - 0.015, 0, len, 0.03, 0.045, metal);
    for (let i = 0; i <= count; i++)
      box(root, Math.min(len - 0.015, Math.max(0.015, i * panel)), height / 2, 0, 0.03, height, 0.04, frame);
    for (let i = 0; i < count; i++)
      box(
        root,
        (i + 0.5) * panel,
        (height + 0.05) / 2,
        0,
        Math.max(0.01, panel - 0.04),
        height - 0.09,
        0.012,
        glass,
      );
  }
  if (o.type === 'door' && o.doorStyle === 'sliding') {
    const h = top,
      post = Math.min(0.04, len / 8),
      usable = len - 2 * post,
      panelWidth = usable / 2 + 0.015;
    for (const x of [post / 2, len - post / 2]) box(root, x, h / 2, 0, post, h, depth, frame);
    for (const z of [-depth * 0.22, depth * 0.22]) {
      box(root, len / 2, 0.012, z, len, 0.024, 0.022, metal);
      if (!cut) box(root, len / 2, h - 0.02, z, len, 0.04, 0.045, frame);
    }
    for (let i = 0; i < 2; i++) {
      const panel = new THREE.Group();
      panel.userData.doorId = o.id;
      panel.position.set(
        post + (i ? usable / 2 - 0.015 : ((usable / 2 - 0.015) * (o.slideOpen ?? 0)) / 100),
        0,
        (i ? 1 : -1) * depth * 0.22,
      );
      root.add(panel);
      box(panel, panelWidth / 2, h / 2, 0, Math.max(0.01, panelWidth - 0.07), h - 0.08, 0.012, glass);
      for (const x of [0.018, panelWidth - 0.018]) box(panel, x, h / 2, 0, 0.036, h, 0.045, frame);
      box(panel, panelWidth / 2, 0.03, 0, panelWidth, 0.06, 0.045, frame);
      if (!cut) box(panel, panelWidth / 2, h - 0.022, 0, panelWidth, 0.044, 0.045, frame);
      const x = i ? 0.06 : panelWidth - 0.06,
        y = Math.min(0.98, h * 0.7);
      for (const z of [-0.04, 0.04]) box(panel, x, y, z, 0.018, 0.18, 0.018, metal);
    }
  }
  if (o.type === 'door' && o.doorStyle !== 'sliding') {
    const h = top,
      post = Math.min(0.04, len / 8),
      leafLen = Math.max(0.04, len - 2 * post - 0.008),
      leafHeight = Math.max(0.05, h - (cut ? 0.01 : 0.045));
    for (const x of [post / 2, len - post / 2]) box(root, x, h / 2, 0, post, h, depth, wood);
    if (!cut) box(root, len / 2, h - 0.02, 0, len, 0.04, depth, wood);
    for (const z of [-depth / 2 - 0.012, depth / 2 + 0.012]) {
      for (const x of [-0.012, len + 0.012]) box(root, x, h / 2, z, 0.065, h + 0.035, 0.025, trim);
      if (!cut) box(root, len / 2, h + 0.012, z, len + 0.09, 0.065, 0.025, trim);
    }
    const pivot = new THREE.Group(),
      sign = o.hinge === 'b' ? -1 : 1;
    pivot.position.x = sign === 1 ? post : len - post;
    pivot.rotation.y = ((-(o.swing ?? -1) * (o.openAngle ?? 90) * Math.PI) / 180) * sign;
    pivot.userData.doorId = o.id;
    root.add(pivot);
    box(pivot, (sign * leafLen) / 2, leafHeight / 2 + 0.008, 0, leafLen, leafHeight, 0.044, wood);
    // Recessed panel mouldings, a lock plate, handles on both sides, and three hinge barrels.
    for (const z of [-0.025, 0.025]) {
      const panelWidth = Math.max(0.06, leafLen - 0.2),
        panelHeight = Math.max(0.06, (leafHeight - 0.28) / 2);
      for (const cy of [0.1 + panelHeight / 2, 0.18 + panelHeight * 1.5]) {
        for (const x of [(sign * (leafLen - panelWidth)) / 2, (sign * (leafLen + panelWidth)) / 2])
          box(pivot, x, cy, z, 0.015, panelHeight, 0.009, wood);
        for (const y of [cy - panelHeight / 2, cy + panelHeight / 2])
          box(pivot, (sign * leafLen) / 2, y, z, panelWidth, 0.015, 0.009, wood);
      }
      const handleY = Math.min(0.98, leafHeight * 0.7),
        handleX = sign * (leafLen - 0.07);
      box(pivot, handleX, handleY, z, 0.035, 0.13, 0.008, metal);
      box(pivot, handleX, handleY + 0.02, z * 2, 0.025, 0.025, 0.055, metal);
      box(pivot, handleX - sign * 0.04, handleY + 0.02, z * 3, 0.1, 0.018, 0.022, metal);
    }
    for (const y of [0.18, leafHeight * 0.5, leafHeight - 0.15])
      box(pivot, 0, y, 0, 0.018, 0.075, 0.055, metal);
  }
  if (o.type === 'window' && top > bottom) {
    const h = top - bottom,
      frameDepth = Math.min(0.085, depth),
      side = o.baySide ?? -1,
      projection = (o.bayDepth ?? 600) / 1000;
    const frameRun = (x1: number, z1: number, x2: number, z2: number) => {
      const run = new THREE.Group(),
        width = Math.hypot(x2 - x1, z2 - z1);
      run.position.set(x1, 0, z1);
      run.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      root.add(run);
      box(
        run,
        width / 2,
        bottom + h / 2,
        0,
        Math.max(0.01, width - 0.07),
        Math.max(0.01, h - 0.07),
        0.012,
        glass,
      );
      for (const y of [bottom + 0.025, top - 0.025])
        box(run, width / 2, y, 0, width, 0.05, frameDepth, frame);
      const count = Math.max(1, Math.ceil(width / 0.85));
      for (let i = 0; i <= count; i++)
        box(run, (width * i) / count, bottom + h / 2, 0, 0.045, h, frameDepth, frame);
    };
    if (o.windowStyle === 'bay') {
      const far = side * (depth / 2 + projection),
        near = (-side * depth) / 2,
        extent = depth + projection;
      box(
        root,
        len / 2,
        Math.max(0.02, bottom - 0.025),
        (near + far) / 2,
        len + 0.08,
        0.05,
        extent + 0.08,
        trim,
      );
      if (bottom > 0.05)
        box(root, len / 2, (bottom - 0.05) / 2, (near + far) / 2, len, bottom - 0.05, extent, trim);
      frameRun(0, far, len, far);
      frameRun(0, 0, 0, far);
      frameRun(len, 0, len, far);
      if (!cut) box(root, len / 2, top + 0.025, (near + far) / 2, len + 0.08, 0.05, extent + 0.08, trim);
    } else {
      frameRun(0, 0, len, 0);
      box(root, len / 2, bottom - 0.025, 0, len + 0.08, 0.05, depth + 0.08, trim);
    }
  }
  for (const mat of [wood, trim, metal, frame, glass]) if (!used.has(mat)) mat.dispose();
  return root;
}
