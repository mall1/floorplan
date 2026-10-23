import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Horizontal coordinates use a unit footprint; heights are metres. Scaling the
// completed group keeps details inside the footprint at any editable size.
export function buildExtraFurniture(type, w, d, color, material) {
  const g = new THREE.Group();
  const surface = (paint) => (typeof paint === 'string' ? material(paint) : paint);
  const metal = material('#737b7c', { metalness: 0.65, roughness: 0.35 });
  const glass = material('#bcd9de', { transparent: true, opacity: 0.25, depthWrite: false, roughness: 0.1 });
  const dark = '#3e4546',
    linen = '#f4eee4',
    leaf = '#789265';
  const add = (geometry, paint, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, surface(paint));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const b = (bw, h, bd, paint = color, x = 0, y = 0, z = 0, radius = 0) =>
    add(
      radius
        ? new RoundedBoxGeometry(bw, h, bd, 2, Math.min(radius, bw / 3, h / 3, bd / 3))
        : new THREE.BoxGeometry(bw, h, bd),
      paint,
      x,
      y + h / 2,
      z,
    );
  const cy = (radius, h, paint = color, x = 0, y = 0, z = 0) =>
    add(new THREE.CylinderGeometry(radius, radius, h, 24), paint, x, y + h / 2, z);
  const ell = (rx, ry, rz, paint, x = 0, y = 0, z = 0) => {
    const mesh = add(new THREE.SphereGeometry(1, 20, 12), paint, x, y, z);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  };
  const rod = (a, end, radius = 0.02, paint = metal) => {
    const from = new THREE.Vector3(...a),
      to = new THREE.Vector3(...end);
    const mesh = add(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 12), paint, 0, 0, 0);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
    return mesh;
  };
  const legs = (height, paint = color) => {
    for (const x of [-0.4, 0.4]) for (const z of [-0.38, 0.38]) b(0.05, height, 0.06, paint, x, 0, z);
  };
  const cabinet = (height) => {
    b(1, 0.06, 1, color, 0, 0.06);
    b(1, 0.04, 1, color, 0, height - 0.04);
    b(1, height - 0.12, 0.04, color, 0, 0.1, -0.48);
    for (const x of [-0.48, 0.48]) b(0.04, height - 0.12, 1, color, x, 0.1);
  };
  const drawer = (y, height, width = 0.9, x = 0) => {
    b(width, height - 0.008, 0.04, color, x, y, 0.46);
    b(Math.min(0.2, width * 0.45), 0.018, 0.025, metal, x, y + height * 0.6, 0.493);
  };
  switch (type) {
    case 'bunkbed': {
      for (const x of [-0.465, 0.465]) for (const z of [-0.47, 0.47]) b(0.07, 1.85, 0.06, color, x, 0, z);
      for (const y of [0.3, 1.35]) {
        b(0.94, 0.08, 0.94, color, 0, y);
        b(0.84, 0.13, 0.88, linen, 0, y + 0.08, 0, 0.04);
        b(0.84, 0.035, 0.57, '#a9bac5', 0, y + 0.21, 0.15, 0.015);
        b(0.55, 0.1, 0.18, '#ffffff', 0, y + 0.21, -0.3, 0.04);
      }
      for (const y of [1.66, 1.8]) {
        for (const x of [-0.465, 0.465]) b(0.04, 0.035, 0.94, color, x, y);
        b(0.94, 0.035, 0.04, color, 0, y, -0.47);
        b(0.58, 0.035, 0.04, color, -0.18, y, 0.47);
      }
      for (const x of [0.17, 0.42]) b(0.025, 1.5, 0.035, color, x, 0, 0.48);
      for (let i = 1; i < 6; i++) b(0.25, 0.03, 0.055, color, 0.295, i * 0.25, 0.47);
      break;
    }
    case 'daybed':
      legs(0.23, dark);
      b(0.98, 0.2, 0.95, color, 0, 0.2, 0, 0.035);
      b(1, 0.64, 0.1, color, 0, 0.2, -0.45, 0.025);
      for (const x of [-0.46, 0.46]) b(0.08, 0.48, 1, color, x, 0.2, 0, 0.025);
      b(0.82, 0.13, 0.86, color, 0, 0.4, 0.03, 0.04);
      b(0.22, 0.13, 0.5, linen, -0.27, 0.53, 0, 0.05);
      for (const x of [-0.25, 0, 0.25]) ell(0.012, 0.012, 0.008, dark, x, 0.68, -0.393);
      break;
    case 'ottoman':
      legs(0.12, dark);
      b(0.94, 0.23, 0.94, color, 0, 0.1, 0, 0.06);
      b(1, 0.13, 1, color, 0, 0.33, 0, 0.06);
      for (const x of [-0.22, 0.22]) for (const z of [-0.22, 0.22]) cy(0.016, 0.006, dark, x, 0.459, z);
      break;
    case 'bench':
      legs(0.39, '#8f775e');
      b(0.86, 0.035, 0.8, color, 0, 0.13);
      b(1, 0.05, 1, color, 0, 0.36);
      b(0.95, 0.08, 0.92, linen, 0, 0.41, 0, 0.025);
      break;
    case 'chest':
    case 'filingcabinet': {
      const height = type === 'chest' ? 1.15 : 0.65,
        rows = type === 'chest' ? 5 : 3;
      cabinet(height);
      for (let i = 0; i < rows; i++) drawer(0.12 + (i * (height - 0.16)) / rows, (height - 0.16) / rows);
      if (type === 'filingcabinet')
        for (const x of [-0.38, 0.38])
          for (const z of [-0.35, 0.35]) ell(0.055, 0.035, 0.055, dark, x, 0.035, z);
      break;
    }
    case 'pantry':
      cabinet(2.1);
      for (const x of [-0.23, 0.23]) {
        b(0.45, 1.94, 0.04, color, x, 0.12, 0.46);
        b(0.02, 0.28, 0.03, metal, x * 0.25, 0.95, 0.493);
      }
      break;
    case 'displaycabinet':
      cabinet(1.8);
      for (const y of [0.45, 0.86, 1.27]) b(0.9, 0.025, 0.86, color, 0, y);
      for (const x of [-0.23, 0.23]) {
        b(0.44, 1.6, 0.015, glass, x, 0.13, 0.46);
        b(0.025, 1.6, 0.03, color, x * 2, 0.13, 0.46);
        b(0.02, 0.16, 0.03, metal, x * 0.24, 0.85, 0.48);
      }
      for (const y of [0.475, 0.885, 1.295]) {
        cy(0.1, 0.19, '#ebe0ce', -0.21, y);
        ell(0.13, 0.12, 0.16, '#8fa3a4', 0.22, y + 0.12, 0);
      }
      break;
    case 'coatrack':
      cy(0.36, 0.045, color);
      cy(0.045, 1.75, color);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3,
          x = Math.cos(a) * 0.42,
          z = Math.sin(a) * 0.42;
        rod([0, 1.36, 0], [x, 1.63, z], 0.025, color);
        ell(0.04, 0.04, 0.04, color, x, 1.65, z);
      }
      break;
    case 'mirror':
      b(1, 1.7, 0.08, color, 0, 0.05, 0.3, 0.02);
      b(0.86, 1.55, 0.012, material('#d5e6e8', { metalness: 0.7, roughness: 0.08 }), 0, 0.12, 0.347);
      for (const x of [-0.4, 0.4]) rod([x, 1.1, 0.28], [x, 0.025, -0.45], 0.025, color);
      rod([-0.4, 0.12, -0.4], [0.4, 0.12, -0.4], 0.02, color);
      break;
    case 'screen': {
      const nodes = [
        [-0.48, 0.4],
        [-0.16, -0.4],
        [0.16, 0.4],
        [0.48, -0.4],
      ];
      for (let i = 0; i < 3; i++) {
        const [x1, z1] = nodes[i],
          [x2, z2] = nodes[i + 1];
        for (const y of [0.15, 1.7]) rod([x1, y, z1], [x2, y, z2], 0.018, color);
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          b(0.012, 1.5, 0.025, color, x1 + (x2 - x1) * t, 0.18, z1 + (z2 - z1) * t);
        }
      }
      for (const [x, z] of nodes) b(0.028, 1.8, 0.04, color, x, 0, z);
      break;
    }
    case 'recliner':
      legs(0.2, dark);
      b(0.9, 0.27, 0.66, color, 0, 0.16, 0.05, 0.05);
      b(0.72, 0.13, 0.6, color, 0, 0.43, 0.04, 0.05);
      b(0.78, 0.68, 0.18, color, 0, 0.35, -0.34, 0.05).rotation.x = -0.2;
      for (const x of [-0.43, 0.43]) b(0.14, 0.23, 0.65, color, x, 0.45, 0, 0.04);
      b(0.7, 0.1, 0.25, color, 0, 0.33, 0.37, 0.025);
      break;
    case 'nestingtable':
      for (const [x, z, radius, height, paint] of [
        [-0.18, -0.08, 0.32, 0.45, color],
        [0.25, 0.18, 0.25, 0.34, '#b19b7d'],
      ]) {
        const top = cy(radius, 0.035, paint, x, height, z);
        top.scale.z = 1.3;
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI * 2) / 3;
          b(0.025, height, 0.025, dark, x + Math.cos(a) * radius * 0.7, 0, z + Math.sin(a) * radius * 0.9);
        }
      }
      break;
    case 'barcart':
      for (const y of [0.12, 0.7]) {
        b(0.86, 0.03, 1, color, 0, y);
        for (const z of [-0.47, 0.47]) b(0.86, 0.065, 0.025, metal, 0, y, z);
      }
      for (const x of [-0.4, 0.4])
        for (const z of [-0.4, 0.4]) {
          b(0.025, 0.72, 0.025, metal, x, 0.06, z);
          ell(0.04, 0.04, 0.055, dark, x, 0.04, z);
        }
      rod([-0.47, 0.84, -0.4], [-0.47, 0.84, 0.4]);
      for (const z of [-0.4, 0.4]) rod([-0.4, 0.7, z], [-0.47, 0.84, z]);
      cy(0.1, 0.18, linen, 0.2, 0.73);
      break;
    case 'microwave':
      b(1, 0.3, 1, color, 0, 0.86, 0, 0.025);
      b(0.66, 0.22, 0.015, dark, -0.1, 0.9, 0.495);
      b(0.52, 0.16, 0.008, glass, -0.13, 0.93, 0.505);
      b(0.025, 0.17, 0.04, metal, 0.21, 0.925, 0.5);
      b(0.17, 0.06, 0.015, '#597a78', 0.36, 1.05, 0.501);
      ell(0.04, 0.025, 0.02, metal, 0.36, 0.96, 0.51);
      break;
    case 'winecooler':
      cabinet(1.2);
      b(0.9, 1.02, 0.018, glass, 0, 0.13, 0.47);
      b(0.025, 0.3, 0.035, metal, 0.38, 0.7, 0.485);
      for (const y of [0.2, 0.4, 0.6, 0.8, 1]) {
        b(0.9, 0.025, 0.86, '#bba17b', 0, y);
        for (const x of [-0.28, 0, 0.28]) {
          ell(0.09, 0.055, 0.27, '#586749', x, y + 0.08, -0.06);
          ell(0.035, 0.025, 0.1, '#586749', x, y + 0.08, 0.25);
        }
      }
      break;
    case 'laundrytower':
      for (const y of [0, 0.89]) {
        b(0.94, 0.85, 0.94, color, 0, y, 0, 0.025);
        ell(0.32, 0.27, 0.035, dark, 0, y + 0.4, 0.47);
        ell(0.25, 0.21, 0.04, y ? '#cbbdab' : '#9fbac8', 0, y + 0.4, 0.485);
        b(0.32, 0.08, 0.015, '#687d83', -0.23, y + 0.72, 0.478);
        ell(0.05, 0.035, 0.025, metal, 0.25, y + 0.76, 0.48);
      }
      b(1, 0.04, 1, dark, 0, 0.85);
      break;
    case 'dryingrack':
      for (const x of [-0.38, 0.38]) {
        rod([x, 0.025, -0.45], [x, 1.05, 0.45], 0.015);
        rod([x, 0.025, 0.45], [x, 1.05, -0.45], 0.015);
      }
      for (const x of [-0.48, 0.48]) rod([x, 1.05, -0.45], [x, 1.05, 0.45], 0.012);
      for (let i = 0; i < 9; i++)
        rod([-0.48, 1.05, -0.45 + i * 0.1125], [0.48, 1.05, -0.45 + i * 0.1125], 0.009);
      break;
    case 'laundrybasket':
      b(0.85, 0.04, 0.85, color);
      for (const x of [-0.45, 0.45]) b(0.08, 0.55, 0.98, color, x, 0.04, 0, 0.025);
      for (const z of [-0.45, 0.45]) b(0.98, 0.55, 0.08, color, 0, 0.04, z, 0.025);
      ell(0.36, 0.15, 0.35, linen, 0, 0.4);
      for (let i = 1; i <= 7; i++) b(0.96, 0.008, 0.012, '#a08d75', 0, i * 0.07, 0.492);
      break;
    case 'lounger':
      legs(0.27, '#8f775e');
      b(1, 0.06, 1, color, 0, 0.24);
      b(0.9, 0.09, 0.56, color, 0, 0.3, 0.2, 0.025);
      b(0.9, 0.1, 0.43, color, 0, 0.46, -0.27, 0.025).rotation.x = 0.65;
      b(0.65, 0.12, 0.12, linen, 0, 0.63, -0.35, 0.035);
      break;
    case 'planterbox':
      b(0.9, 0.07, 0.85, color);
      for (const x of [-0.46, 0.46]) b(0.08, 0.45, 1, color, x);
      for (const z of [-0.46, 0.46]) b(1, 0.45, 0.08, color, 0, 0, z);
      b(0.84, 0.025, 0.84, '#655342', 0, 0.36);
      for (const x of [-0.3, 0, 0.3]) {
        rod([x, 0.38, 0], [x, 0.9, 0], 0.008, leaf);
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          ell(0.08, 0.14, 0.16, leaf, x + Math.cos(a) * 0.08, 0.6 + i * 0.04, Math.sin(a) * 0.19);
        }
      }
      break;
    case 'standingdesk':
      for (const x of [-0.34, 0.34]) {
        b(0.07, 0.04, 0.85, metal, x);
        b(0.045, 0.65, 0.07, metal, x, 0.04);
        b(0.03, 0.43, 0.05, dark, x, 0.65);
      }
      b(0.68, 0.045, 0.05, dark, 0, 0.6);
      b(1, 0.045, 1, color, 0, 1.08, 0, 0.01);
      b(0.14, 0.035, 0.07, dark, 0.32, 1.045, 0.44);
      b(0.18, 0.025, 0.2, dark, 0, 1.125, -0.23);
      b(0.025, 0.15, 0.04, dark, 0, 1.15, -0.25);
      b(0.42, 0.3, 0.025, dark, 0, 1.29, -0.25);
      b(0.39, 0.265, 0.01, '#688d9a', 0, 1.307, -0.23);
      b(0.28, 0.018, 0.16, '#d7dcda', 0, 1.125, 0.14);
      break;
    case 'exercisebike': {
      for (const z of [-0.4, 0.4]) rod([-0.4, 0.055, z], [0.4, 0.055, z], 0.035, dark);
      rod([0, 0.1, -0.4], [0, 0.1, 0.4], 0.035, color);
      rod([0, 0.1, -0.3], [0, 0.75, 0.22], 0.045, color);
      rod([0, 0.1, 0.3], [0, 0.95, -0.32], 0.035, color);
      ell(0.12, 0.28, 0.24, dark, 0, 0.35, -0.08);
      rod([0, 0.6, 0.22], [0, 0.94, 0.22], 0.025);
      b(0.5, 0.065, 0.25, dark, 0, 0.94, 0.22, 0.03);
      rod([-0.4, 1.02, -0.32], [0.4, 1.02, -0.32], 0.03, dark);
      for (const x of [-0.25, 0.25]) b(0.2, 0.035, 0.12, dark, x, 0.3, x > 0 ? 0.12 : -0.12);
      break;
    }
    case 'petbed': {
      ell(0.49, 0.08, 0.49, color, 0, 0.08);
      const rim = new THREE.TorusGeometry(0.4, 0.085, 12, 56, (Math.PI * 5) / 3);
      rim.rotateZ((Math.PI * 2) / 3);
      rim.rotateX(Math.PI / 2);
      add(rim, color, 0, 0.16, 0).scale.y = 1.35;
      ell(0.34, 0.055, 0.33, linen, 0, 0.14);
      break;
    }
    default:
      return null;
  }
  g.scale.set(w, 1, d);
  return g;
}
