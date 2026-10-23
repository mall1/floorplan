import * as THREE from 'three';
import type { Device } from '../model/types';
import { deviceStyle, resolvedDeviceKind } from '../model/utility-style';
export function buildUtilityDevice(d: Device) {
  const group = new THREE.Group(),
    kind = resolvedDeviceKind(d),
    color = deviceStyle(d).color;
  const mesh = (geo: THREE.BufferGeometry, tint: string, x = 0, y = 0, z = 0) => {
    const part = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: tint }));
    part.position.set(x, y, z);
    group.add(part);
    return part;
  };
  const box = (w: number, h: number, depth: number, tint: string, x = 0, y = 0, z = 0) =>
    mesh(new THREE.BoxGeometry(w, h, depth), tint, x, y, z);
  if (kind === 'pipe')
    mesh(
      new THREE.CylinderGeometry((d.diameter ?? 110) / 2000, (d.diameter ?? 110) / 2000, d.height / 1000, 24),
      color,
    );
  else if (kind === 'light') {
    mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24), '#fff3c8');
    mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 32), color).rotation.x = Math.PI / 2;
  } else if (kind === 'coldwater' || kind === 'hotwater') {
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), color).rotation.x = Math.PI / 2;
    box(0.15, 0.025, 0.025, color, 0, 0.06, 0.04);
    box(0.025, 0.1, 0.025, color, 0, 0.06, 0.04);
  } else if (kind === 'drain' || kind === 'acdrain') {
    box(0.15, 0.02, 0.15, color);
    for (let i = -1; i <= 1; i++) box(0.11, 0.005, 0.014, '#ecf0ed', 0, 0.012, i * 0.035);
  } else if (kind === 'acindoor' && d.acMode === 'central') {
    box(0.65, 0.12, 0.65, '#f6f6f0');
    box(0.45, 0.025, 0.45, color, 0, -0.065);
    for (let i = -2; i <= 2; i++) box(0.42, 0.01, 0.018, '#d4e3df', 0, -0.08, i * 0.065);
  } else if (kind === 'acindoor') {
    box(0.85, 0.28, 0.22, '#f6f6f0');
    box(0.7, 0.055, 0.025, color, 0, -0.08, 0.12);
    for (let i = -3; i <= 3; i++) box(0.035, 0.08, 0.025, '#c3d3ce', i * 0.085, -0.06, 0.135);
  } else if (kind === 'acoutdoor') {
    box(0.7, 0.52, 0.3, '#e8eeeb');
    mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 24), color, -0.1, 0, 0.16);
    for (let i = 0; i < 4; i++) {
      const blade = box(0.3, 0.035, 0.02, color, -0.1, 0, 0.17);
      blade.rotation.z = (i * Math.PI) / 4;
    }
    box(0.12, 0.37, 0.03, color, 0.24, 0, 0.16);
  } else {
    box(kind === 'panel' ? 0.3 : 0.15, kind === 'panel' ? 0.4 : 0.15, 0.05, '#faf8f1');
    if (kind === 'switch') box(0.09, 0.1, 0.025, color, 0, 0, 0.04);
    else if (kind === 'socket' || kind === 'acsocket') {
      for (const [x, y] of [
        [-0.035, 0.02],
        [0.035, 0.02],
        [0, -0.035],
      ])
        box(0.018, 0.04, 0.015, color, x, y, 0.035);
    } else box(0.08, 0.06, 0.02, color, 0, 0, 0.035);
  }
  group.position.set(d.x / 1000, kind === 'pipe' ? d.height / 2000 : d.height / 1000 + 0.04, d.y / 1000);
  group.rotation.y = (-d.rotation * Math.PI) / 180;
  group.userData.deviceId = d.id;
  group.traverse((part) => {
    part.userData.deviceId = d.id;
  });
  return group;
}
