export type Point = [number, number];
export type Pattern = 'straight' | 'half' | 'third' | 'herringbone' | 'diagonal';
export interface Flooring {
  material: string;
  width: number;
  length: number;
  gap: number;
  pattern: Pattern;
  angle: number;
  origin: Point;
  color: string;
  grout: string;
  price: number;
  waste: number;
}
export interface Room {
  id: string;
  name: string;
  poly: Point[];
  flooring: Flooring;
  boundary: boolean;
  counted: boolean;
  wallWidth: number;
  edgeWidths?: Record<string, number>;
  wallFinish?: { included?: boolean; height?: number };
}
export interface Wall {
  id: string;
  a: Point;
  b: Point;
  width: number;
  bearing: boolean;
  height: number;
}
export interface Opening {
  id: string;
  type: 'door' | 'window' | 'threshold' | 'railing';
  a: Point;
  b: Point;
  width: number;
  color: string;
  autoDepth?: boolean;
  sill?: number;
  height?: number;
  windowStyle?: 'flat' | 'bay';
  bayDepth?: number;
  baySide?: 1 | -1;
  hinge?: 'a' | 'b';
  swing?: 1 | -1;
  openAngle?: number;
  doorStyle?: 'swing' | 'sliding';
  slideOpen?: number;
  jambStart?: number;
  jambEnd?: number;
  railingHeight?: number;
}
export interface Shaft {
  id: string;
  name: string;
  poly: Point[];
  height: number;
}
export interface WallRecognitionSettings {
  thin: number;
  thick: number;
  tolerance: number;
  enabled: boolean;
}
export interface DoorRecognitionSettings {
  presetVersion?: 2;
  enabled: boolean;
  widths: number[];
  slidingWidths: number[];
  tolerance: number;
}
export interface PipeRecognitionSettings {
  enabled: boolean;
  diameters: number[];
  tolerance: number;
}
export type UtilityKind = 'cold' | 'hot' | 'drain' | 'power' | 'weak';
export interface Route {
  id: string;
  kind: UtilityKind;
  points: Point[];
  circuit: string;
  diameter: number;
  height: number;
}
export type DeviceKind = 'socket' | 'switch' | 'light' | 'water' | 'drain' | 'network' | 'panel' | 'pipe';
export interface Device {
  id: string;
  kind: DeviceKind;
  x: number;
  y: number;
  height: number;
  name: string;
  circuit: string;
  rotation: number;
  diameter?: number;
  pipeSystem?: 'drain' | 'water' | 'unknown';
}
export interface Furniture {
  id: string;
  type: string;
  name: string;
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot: number;
  color: string;
}
export interface ReferenceImage {
  src: string;
  pixelWidth: number;
  pixelHeight: number;
  x: number;
  y: number;
  width: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  calibrated: boolean;
  wallSettings?: WallRecognitionSettings;
  doorSettings?: DoorRecognitionSettings;
  pipeSettings?: PipeRecognitionSettings;
}
export interface Project {
  version: 2;
  name: string;
  rooms: Room[];
  walls: Wall[];
  openings: Opening[];
  shafts: Shaft[];
  furniture: Furniture[];
  routes: Route[];
  devices: Device[];
  measures: { id: string; a: Point; b: Point }[];
  reference: ReferenceImage | null;
  continuous: boolean;
  globalFlooring: Flooring;
  wallFinish?: { height?: number; waste: number };
}
export type Selection = {
  kind: 'room' | 'wall' | 'opening' | 'shaft' | 'furniture' | 'route' | 'device' | 'measure';
  id: string;
} | null;
export type Workspace = 'plan' | 'furniture' | 'utilities' | 'flooring';
export type Tool =
  | 'select'
  | 'pan'
  | 'rectangle'
  | 'polygon'
  | 'wall'
  | 'door'
  | 'window'
  | 'railing'
  | 'threshold'
  | 'route'
  | 'device'
  | 'measure'
  | 'calibrate'
  | 'floor-move'
  | 'floor-origin'
  | 'shaft';
export interface Candidate {
  id: string;
  name: string;
  poly: Point[];
  selected: boolean;
  areaPixels: number;
}
