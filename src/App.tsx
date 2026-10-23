import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid2X2,
  Sofa,
  Cable,
  Layers3,
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  ChevronDown,
  Check,
  Maximize,
  Minus,
  MousePointer2,
  Hand,
  PanelLeftClose,
  PanelRightClose,
  FolderOpen,
  X,
  Compass,
} from 'lucide-react';
import { useProject } from './hooks/useProject';
import { StudioContext, type StudioState, type RecognitionPreview } from './components/StudioContext';
import Library from './components/Library';
import { analyzeCirculation, FLOW_TYPES } from './model/circulation';
import { DEFAULT_ANALYSIS } from './model/space-analysis';
import type { UtilityLayoutResult } from './model/auto-utilities';
import Inspector from './components/Inspector';
import PlanCanvas from './components/PlanCanvas';
import { demoProject, emptyProject, parseProject } from './model/project';
import { download, pngFromSvg } from './model/files';
import { uid } from './model/geometry';
import type { Candidate, DeviceKind, Selection, Tool, UtilityKind, Workspace } from './model/types';
const Scene3D = lazy(() => import('./components/Scene3D'));
const toolNames: Record<Tool, string> = {
  select: '点击选择对象，拖动调整位置 · 滚轮缩放 · 空格拖动平移',
  pan: '拖动画布平移 · 滚轮缩放',
  rectangle: '依次点击房间的两个对角点',
  shaft: '依次点击烟道的两个对角点 · 选中后可拖动和修改尺寸',
  polygon: '沿轮廓点击顶点 · 点击起点、双击或 Enter 完成 · Esc 取消',
  wall: '点击墙体的起点和终点 · Shift 锁定方向',
  door: '在墙上点击门洞两端，靠近墙线自动吸附',
  window: '在墙上点击窗户两端',
  railing: '点击开放阳台护栏两端，下半部玻璃，上方敞开',
  threshold: '点击门槛石两端，右侧可调整宽度和颜色',
  route: '点击连续布线 · 双击或 Enter 完成 · Alt 自由方向 · Esc 取消',
  device: '点击放置设备点位 · 在右侧设置高度和回路',
  measure: '点击两点测量实际距离',
  calibrate: '在底图上点击已知尺寸的两个端点',
  'floor-move': '在房间内拖动铺装 · 按住 Alt 精细移动 · Esc 结束',
  'floor-origin': '点击房间内或角点设置起铺点 · 靠近顶点自动吸附 · Esc 结束',
};
export default function App() {
  const store = useProject(),
    { project, commit } = store;
  const [selection, select] = useState<Selection>(null),
    [tool, setTool] = useState<Tool>('select'),
    [workspace, setWorkspaceState] = useState<Workspace>('plan'),
    [view, setView] = useState<'2d' | '3d'>('2d');
  const [deviceKind, setDeviceKind] = useState<DeviceKind>('socket'),
    [routeKind, setRouteKind] = useState<UtilityKind>('cold'),
    [circuit, setCircuit] = useState('默认回路'),
    [calibrationLength, setCalibrationLength] = useState(3000),
    [candidates, setCandidates] = useState<Candidate[]>([]);
  const [recognition, setRecognition] = useState<RecognitionPreview | null>(null);
  const [utilityPreview, setUtilityPreview] = useState<UtilityLayoutResult | null>(null);
  useEffect(() => {
    setUtilityPreview(null);
  }, [project]);
  const circulation = useMemo(
    () =>
      analyzeCirculation(
        project,
        project.analysis?.flows ?? [],
        project.analysis?.clearance ?? DEFAULT_ANALYSIS.clearance,
      ),
    [project],
  );
  useEffect(() => {
    setCandidates([]);
    setRecognition(null);
  }, [project.reference?.src]);
  const [layers, setLayers] = useState<StudioState['layers']>({
      grid: true,
      furniture: true,
      labels: true,
      flooring: false,
      utilities: true,
      dimensions: true,
    }),
    [fitToken, setFitToken] = useState(0),
    [zoomToken, setZoomToken] = useState({ seq: 0, factor: 1 }),
    [toast, setToast] = useState(''),
    [left, setLeft] = useState(() => window.innerWidth > 680),
    [right, setRight] = useState(() => window.innerWidth > 960),
    [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    notify = useCallback((text: string) => setToast(text), []),
    fit = useCallback(() => setFitToken((v) => v + 1), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const setWorkspace = (w: Workspace) => {
    setWorkspaceState(w);
    setTool('select');
    setView('2d');
    setLeft(true);
    if (window.innerWidth <= 960) setRight(false);
    setLayers((v) => ({ ...v, flooring: w === 'flooring', furniture: w !== 'flooring' }));
  };
  const deleteSelected = () => {
    if (!selection) return;
    const { kind, id } = selection;
    if (kind === 'wall' && id.includes(':edge:')) {
      notify('边界墙由房间生成，请编辑房间轮廓或关闭自动边界墙');
      return;
    }
    if (kind === 'wall' && project.walls.find((w) => w.id === id)?.bearing) {
      notify('已标记承重墙，请先在属性中核对墙体类型');
      return;
    }
    commit((d) => {
      if (kind === 'room') d.rooms = d.rooms.filter((v) => v.id !== id);
      if (kind === 'wall') d.walls = d.walls.filter((v) => v.id !== id);
      if (kind === 'opening') d.openings = d.openings.filter((v) => v.id !== id);
      if (kind === 'shaft') d.shafts = d.shafts.filter((v) => v.id !== id);
      if (kind === 'furniture') d.furniture = d.furniture.filter((v) => v.id !== id);
      if (kind === 'device') d.devices = d.devices.filter((v) => v.id !== id);
      if (kind === 'route') d.routes = d.routes.filter((v) => v.id !== id);
      if (kind === 'measure') d.measures = d.measures.filter((v) => v.id !== id);
    });
    select(null);
  };
  const rotateSelected = () => {
    if (!selection) return;
    commit((d) => {
      if (selection.kind === 'furniture') {
        const f = d.furniture.find((v) => v.id === selection.id);
        if (f) f.rot = (f.rot + 90) % 360;
      }
      if (selection.kind === 'device') {
        const f = d.devices.find((v) => v.id === selection.id);
        if (f) f.rotation = (f.rotation + 90) % 360;
      }
    });
  };
  const duplicateSelected = () => {
    if (!selection) return;
    const id = uid();
    commit((d) => {
      if (selection.kind === 'room') {
        const r = d.rooms.find((v) => v.id === selection.id);
        if (r)
          d.rooms.push({
            ...structuredClone(r),
            id,
            name: r.name + ' 副本',
            poly: r.poly.map(([x, y]) => [x + 500, y + 500]),
          });
      }
      if (selection.kind === 'furniture') {
        const f = d.furniture.find((v) => v.id === selection.id);
        if (f) d.furniture.push({ ...f, id, cx: f.cx + 300, cy: f.cy + 300 });
      }
      if (selection.kind === 'device') {
        const f = d.devices.find((v) => v.id === selection.id);
        if (f) {
          const copy = { ...f, id, x: f.x + 300, y: f.y + 300 };
          delete copy.autoUtility;
          d.devices.push(copy);
        }
      }
    });
    if (['room', 'device', 'furniture'].includes(selection.kind)) select({ kind: selection.kind, id });
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea,[contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
        select(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        store.redo();
        select(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.toLowerCase() === 'r') rotateSelected();
      else if (e.key.toLowerCase() === 'v') setTool('select');
      else if (e.key.toLowerCase() === 'f') fit();
      else if (e.key.toLowerCase() === 't') setView((v) => (v === '2d' ? '3d' : '2d'));
      else if (e.key === 'Escape') {
        select(null);
        setMenu(false);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw Error('方案不能超过 12 MB');
      const p = parseProject(JSON.parse(await file.text()));
      commit(p);
      select(null);
      setCandidates([]);
      setRecognition(null);
      setView('2d');
      fit();
      notify('方案已导入，可撤销恢复之前的方案');
    } catch (error) {
      notify('导入失败：' + (error instanceof Error ? error.message.slice(0, 180) : '方案格式不正确'));
    }
  };
  const exportImage = async () => {
    setMenu(false);
    if (view === '3d') {
      window.dispatchEvent(new Event('export-3d'));
      return;
    }
    try {
      await pngFromSvg(document.querySelector('#plan-canvas')!, `${project.name}-平面图.png`);
    } catch (e) {
      notify(String(e));
    }
  };
  const state: StudioState = {
    project,
    circulation,
    utilityPreview,
    setUtilityPreview,
    commit,
    selection,
    select: (v, reveal) => {
      select(v);
      if (reveal) {
        setRight(true);
        if (window.innerWidth <= 960) setLeft(false);
      }
    },
    tool,
    setTool: (next) => {
      setTool(next);
      if (next !== 'select') setView('2d');
    },
    workspace,
    setWorkspace,
    notify,
    deviceKind,
    setDeviceKind,
    routeKind,
    setRouteKind,
    circuit,
    setCircuit,
    calibrationLength,
    setCalibrationLength,
    candidates,
    setCandidates,
    recognition,
    setRecognition,
    layers,
    setLayers,
    fit,
    deleteSelected,
    rotateSelected,
    duplicateSelected,
  };
  return (
    <StudioContext.Provider value={state}>
      <div className={`studio ${left ? '' : 'hide-left'} ${right ? '' : 'hide-right'}`}>
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">
              <Grid2X2 size={23} />
            </div>
            <div>
              <b>
                筑间<span>STUDIO</span>
              </b>
              <small>把理想生活，落在每一寸空间</small>
            </div>
          </div>
          <div className="project-title">
            <span className="project-dot" />
            <input
              aria-label="方案名称"
              value={project.name}
              maxLength={150}
              onChange={(e) =>
                commit((d) => {
                  d.name = e.target.value;
                })
              }
            />
            <span className="local-badge">本地方案</span>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              title="撤销 (Ctrl+Z)"
              aria-label="撤销"
              disabled={!store.canUndo}
              onClick={() => {
                store.undo();
                select(null);
              }}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              title="重做 (Ctrl+Shift+Z)"
              aria-label="重做"
              disabled={!store.canRedo}
              onClick={() => {
                store.redo();
                select(null);
              }}
            >
              <Redo2 size={17} />
            </button>
            <span className="divider" />
            <button
              className="secondary"
              onClick={() => {
                commit(emptyProject());
                select(null);
                setCandidates([]);
                setRecognition(null);
                setView('2d');
                fit();
                notify('已创建空白方案，可撤销恢复之前的方案');
              }}
            >
              <Plus size={15} />
              新建户型
            </button>
            <div className="file-menu">
              <button className="primary" onClick={() => setMenu((v) => !v)}>
                <FolderOpen size={15} />
                方案文件
                <ChevronDown size={13} />
              </button>
              {menu && (
                <>
                  <button
                    className="menu-backdrop"
                    aria-label="关闭文件菜单"
                    onClick={() => setMenu(false)}
                  />
                  <div className="menu-popup">
                    <button
                      onClick={() => {
                        input.current?.click();
                        setMenu(false);
                      }}
                    >
                      <Upload size={15} />
                      导入 JSON 方案
                    </button>
                    <button
                      onClick={() => {
                        download(
                          `${project.name}.json`,
                          new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
                        );
                        setMenu(false);
                      }}
                    >
                      <Download size={15} />
                      导出 JSON 方案
                    </button>
                    <button onClick={exportImage}>
                      <Download size={15} />
                      导出当前视图 PNG
                    </button>
                    <button
                      onClick={() => {
                        commit(demoProject());
                        select(null);
                        setCandidates([]);
                        setRecognition(null);
                        setView('2d');
                        fit();
                        setMenu(false);
                        notify('已载入示例，可撤销恢复之前的方案');
                      }}
                    >
                      <Grid2X2 size={15} />
                      载入示例户型
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <input
            ref={input}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </header>
        <nav className="workspace-tabs">
          <div className="workflow-label">设计工作台</div>
          {(
            [
              { id: 'plan', name: '户型设计', Icon: Grid2X2 },
              { id: 'furniture', name: '家具布置', Icon: Sofa },
              { id: 'utilities', name: '水电布局', Icon: Cable },
              { id: 'flooring', name: '地面铺装', Icon: Layers3 },
              { id: 'analysis', name: '空间分析', Icon: Compass },
            ] as const
          ).map(({ id, name, Icon }, i) => (
            <button key={id} className={workspace === id ? 'active' : ''} onClick={() => setWorkspace(id)}>
              <Icon size={16} />
              {name}
              <small>0{i + 1}</small>
            </button>
          ))}
          <div className="nav-end">
            <span className="saved">
              <Check size={13} />
              {store.saveStatus}
            </span>
            <div className="view-toggle">
              <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
                2D 平面
              </button>
              <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
                3D 空间
              </button>
            </div>
          </div>
        </nav>
        <Library onClose={() => setLeft(false)} />
        <main className="canvas-area">
          <div className="canvas-top">
            <button className="icon-button" aria-label="切换工具面板" onClick={() => setLeft((v) => !v)}>
              <PanelLeftClose size={17} />
            </button>
            <span>
              {project.name}
              <small> / {view === '2d' ? '平面设计' : '空间预览'}</small>
            </span>
            <button className="icon-button" aria-label="切换属性面板" onClick={() => setRight((v) => !v)}>
              <PanelRightClose size={17} />
            </button>
          </div>
          {view === '2d' ? (
            <PlanCanvas fitToken={fitToken} zoomToken={zoomToken} />
          ) : (
            <Suspense fallback={<div className="loading">正在载入 3D 空间…</div>}>
              <Scene3D />
            </Suspense>
          )}
          {view === '2d' && (
            <>
              <div className="canvas-toolbar">
                <button
                  className={tool === 'select' ? 'active' : ''}
                  aria-label="选择工具"
                  title="选择 (V)"
                  onClick={() => setTool('select')}
                >
                  <MousePointer2 size={18} />
                </button>
                <button
                  className={tool === 'pan' ? 'active' : ''}
                  aria-label="平移工具"
                  title="平移 (空格)"
                  onClick={() => setTool('pan')}
                >
                  <Hand size={18} />
                </button>
                <span />
                <button
                  aria-label="放大"
                  onClick={() => setZoomToken((v) => ({ seq: v.seq + 1, factor: 0.8 }))}
                >
                  <Plus size={18} />
                </button>
                <button
                  aria-label="缩小"
                  onClick={() => setZoomToken((v) => ({ seq: v.seq + 1, factor: 1.25 }))}
                >
                  <Minus size={18} />
                </button>
                <button aria-label="适应窗口" title="适应窗口 (F)" onClick={fit}>
                  <Maximize size={17} />
                </button>
              </div>
              <div className={`tool-hint ${tool !== 'select' ? 'drawing' : ''}`}>
                {tool !== 'select' && <span className="pulse" />}
                {toolNames[tool]}
              </div>
              <div className="north">
                <Compass size={28} />
                <span>N</span>
              </div>
              {(!!project.analysis?.flows.length || project.analysis?.showAreas) && (
                <div className="analysis-legend">
                  {project.analysis?.flows.map((kind) => (
                    <span key={kind}>
                      <i style={{ background: FLOW_TYPES[kind].color }} />
                      {FLOW_TYPES[kind].label}
                    </span>
                  ))}
                  {project.analysis?.showAreas && (
                    <>
                      <span>
                        <i style={{ background: '#d59b58' }} />
                        家具占地
                      </span>
                      <span>
                        <i style={{ background: '#8a6aaf' }} />
                        收纳占地
                      </span>
                    </>
                  )}
                  {!!project.analysis?.flows.length && (
                    <span>
                      <i style={{ background: '#c45f4d' }} />
                      家具瓶颈
                    </span>
                  )}
                </div>
              )}
              <div className="scale-note">
                <span />
                网格 250 mm · 尺寸单位 mm
              </div>
            </>
          )}
        </main>
        <Inspector onClose={() => setRight(false)} />
        <footer>
          <span>
            <i className="status-dot" />
            {view === '2d' ? '2D 编辑器' : '3D 预览'} · {project.rooms.length} 个空间
          </span>
          <span className="footer-help">
            Ctrl Z 撤销 <i /> R 旋转 <i /> Delete 删除 <i /> F 适应画布
          </span>
          <span>数据保存在当前浏览器 · 建议定期导出方案</span>
        </footer>
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button aria-label="关闭提示" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </StudioContext.Provider>
  );
}
