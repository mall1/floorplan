import { createContext, useContext } from 'react';
import type {
  Candidate,
  DeviceKind,
  Point,
  Project,
  Selection,
  Tool,
  UtilityKind,
  Workspace,
} from '../model/types';
import type { RecognitionResult, RecognizedOpening, RecognizedShaft } from '../model/recognition';
import type { analyzeCirculation } from '../model/circulation';
import type { UtilityLayoutResult } from '../model/auto-utilities';
export interface RecognitionPreview extends Omit<
  RecognitionResult,
  'rooms' | 'openings' | 'shafts' | 'pipes'
> {
  pipes: (RecognitionResult['pipes'][number] & { id: string })[];
  source: string;
  referenceWidth: number;
  calibrated: boolean;
  settingsKey: string;
  shafts: (RecognizedShaft & { id: string })[];
  openings: (RecognizedOpening & { id: string; selected: boolean })[];
  showGrid: boolean;
  showWalls: boolean;
  importWalls: boolean;
  extraWalls?: { a: Point; b: Point; width: number }[];
}
export interface CandidateEdit {
  id: string;
  poly: Point[];
  line: Point[];
  drawing: boolean;
}
export interface StudioState {
  project: Project;
  circulation: ReturnType<typeof analyzeCirculation>;
  utilityPreview: UtilityLayoutResult | null;
  setUtilityPreview: (preview: UtilityLayoutResult | null) => void;
  commit: (fn: Project | ((draft: Project) => void)) => void;
  selection: Selection;
  select: (v: Selection, reveal?: boolean) => void;
  tool: Tool;
  setTool: (v: Tool) => void;
  workspace: Workspace;
  setWorkspace: (v: Workspace) => void;
  notify: (msg: string) => void;
  deviceKind: DeviceKind;
  setDeviceKind: (v: DeviceKind) => void;
  routeKind: UtilityKind;
  setRouteKind: (v: UtilityKind) => void;
  powerUse: 'socket' | 'lighting' | 'ac';
  setPowerUse: (v: 'socket' | 'lighting' | 'ac') => void;
  circuit: string;
  setCircuit: (v: string) => void;
  calibrationLength: number;
  setCalibrationLength: (v: number) => void;
  candidates: Candidate[];
  setCandidates: (v: Candidate[]) => void;
  candidateEdit: CandidateEdit | null;
  setCandidateEdit: React.Dispatch<React.SetStateAction<CandidateEdit | null>>;
  editCandidates: (candidates: Candidate[], recognition: RecognitionPreview) => void;
  undoCandidateEdit: () => void;
  canUndoCandidateEdit: boolean;
  recognition: RecognitionPreview | null;
  setRecognition: React.Dispatch<React.SetStateAction<RecognitionPreview | null>>;
  layers: {
    grid: boolean;
    furniture: boolean;
    labels: boolean;
    flooring: boolean;
    utilities: boolean;
    dimensions: boolean;
  };
  setLayers: React.Dispatch<React.SetStateAction<StudioState['layers']>>;
  fit: () => void;
  deleteSelected: () => void;
  rotateSelected: () => void;
  duplicateSelected: () => void;
}
export const StudioContext = createContext<StudioState>(null!);
export const useStudio = () => useContext(StudioContext);
