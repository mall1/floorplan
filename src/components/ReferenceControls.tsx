import { useEffect, useRef, useState } from 'react';
import { ImagePlus, ScanLine, Ruler, LoaderCircle } from 'lucide-react';
import { useStudio } from './StudioContext';
import { NumberField, Section, TextField } from './Fields';
import { imagePoint, readReference } from '../model/files';
import { area, rect, uid, validPolygon } from '../model/geometry';
import { joinWallAxes, resolvedOpening } from '../model/architecture';
import { DEFAULT_WALL_SETTINGS, matchWallThickness } from '../model/wall-presets';
import { DEFAULT_DOOR_SETTINGS, doorRecognitionSettings, matchDoorWidth } from '../model/door-presets';
import { DEFAULT_PIPE_SETTINGS } from '../model/pipe-presets';
import { inferRoomKind, kindFromName, ROOM_TYPES } from '../model/room-types';
import type { Candidate, Point, Project, RoomKind } from '../model/types';
import type { RecognitionResult } from '../model/recognition';
import CandidateEditor from './CandidateEditor';
export default function ReferenceControls() {
  const {
    project,
    commit,
    notify,
    setTool,
    calibrationLength,
    setCalibrationLength,
    candidates,
    setCandidates,
    recognition,
    setRecognition,
    fit,
    candidateEdit,
  } = useStudio();
  const ref = project.reference;
  const wallSettings = ref?.wallSettings ?? DEFAULT_WALL_SETTINGS;
  const doorSettings = doorRecognitionSettings(ref?.doorSettings);
  const pipeSettings = ref?.pipeSettings ?? DEFAULT_PIPE_SETTINGS;
  const settingsKey = JSON.stringify([wallSettings, doorSettings, pipeSettings]);
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(''),
    [draggingImage, setDraggingImage] = useState(false),
    [threshold, setThreshold] = useState(220),
    [gap, setGap] = useState(80),
    [minWall, setMinWall] = useState(3),
    [maxWall, setMaxWall] = useState(32),
    [minArea, setMinArea] = useState(0.5);
  const worker = useRef<Worker | null>(null),
    uploadGeneration = useRef(0),
    generation = useRef(0);
  useEffect(
    () => () => {
      uploadGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    setBusy(false);
    return () => {
      worker.current?.terminate();
      generation.current++;
    };
  }, [ref?.src]);
  const update = (value: Partial<NonNullable<typeof ref>>) =>
    commit((d) => {
      if (d.reference) Object.assign(d.reference, value);
    });
  const updateWallSettings = (value: Partial<typeof wallSettings>) => {
    worker.current?.terminate();
    generation.current++;
    setBusy(false);
    setRecognition(null);
    setCandidates([]);
    update({ wallSettings: { ...wallSettings, ...value } });
  };
  const updateDoorSettings = (value: Partial<typeof doorSettings>) => {
    worker.current?.terminate();
    generation.current++;
    setBusy(false);
    setRecognition(null);
    setCandidates([]);
    update({ doorSettings: { ...doorSettings, ...value } });
  };
  const updateWidths = (key: 'widths' | 'slidingWidths', text: string) => {
    const values = text
      .trim()
      .split(/[,，、;；\s]+/)
      .map(Number);
    if (
      !values.length ||
      values.length > 20 ||
      values.some((v) => !Number.isFinite(v) || v < 300 || v > 6000)
    ) {
      notify('请输入 300–6000 mm 的洞口宽度，用逗号分隔，最多 20 项');
      return;
    }
    updateDoorSettings({ [key]: [...new Set(values)].sort((a, b) => a - b) });
  };
  const updatePipeSettings = (value: Partial<typeof pipeSettings>) => {
    worker.current?.terminate();
    generation.current++;
    setBusy(false);
    setRecognition(null);
    setCandidates([]);
    update({ pipeSettings: { ...pipeSettings, ...value } });
  };
  const updateDiameters = (text: string) => {
    const values = text
      .trim()
      .split(/[,，、;；\s]+/)
      .map(Number);
    if (
      !values.length ||
      values.length > 30 ||
      values.some((v) => !Number.isFinite(v) || v < 10 || v > 1000)
    ) {
      notify('请输入 10–1000 mm 的管道外径，用逗号分隔，最多 30 项');
      return;
    }
    updatePipeSettings({ diameters: [...new Set(values)].sort((a, b) => a - b) });
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const token = ++uploadGeneration.current;
    worker.current?.terminate();
    generation.current++;
    setBusy(false);
    setUploading(true);
    setUploadError('');
    try {
      const reference = await readReference(file);
      if (token !== uploadGeneration.current) return;
      commit((d) => {
        d.reference = reference;
      });
      setCandidates([]);
      setRecognition(null);
      notify('底图已上传，可直接识别；生成后也可选中房间校准全屋比例');
      setTimeout(fit, 100);
    } catch (error) {
      if (token !== uploadGeneration.current) return;
      const message = error instanceof Error ? error.message : '图片读取失败，请重试';
      setUploadError(message);
      notify(message);
    } finally {
      if (token === uploadGeneration.current) setUploading(false);
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('textarea, input:not([type="file"])'))
      )
        return;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      void upload(file);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [upload]);
  const recognize = async () => {
    if (!ref) return;
    worker.current?.terminate();
    const token = ++generation.current;
    setBusy(true);
    setCandidates([]);
    setRecognition(null);
    try {
      const img = new Image();
      img.src = ref.src;
      await img.decode();
      if (token !== generation.current) return;
      const canvas = document.createElement('canvas'),
        scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const sx = img.width / canvas.width,
        sy = img.height / canvas.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const w = new Worker(new URL('../workers/recognition.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onmessage = (e) => {
        if (token !== generation.current) return;
        setBusy(false);
        w.terminate();
        if (e.data.error) {
          notify(e.data.error);
          return;
        }
        const result = e.data as RecognitionResult;
        const typeContext: Project = {
          ...project,
          furniture: [],
          openings: [],
          shafts: result.shafts
            .filter((o) => o.selected)
            .map((o, i) => ({
              id: `type-shaft-${i}`,
              name: '烟道',
              poly: rect([o.x * sx, o.y * sy], [(o.x + o.w) * sx, (o.y + o.h) * sy]).map((point) =>
                imagePoint(ref, point),
              ),
              height: 2800,
            })),
          devices: result.pipes
            .filter((o) => o.selected)
            .map((o, i) => {
              const [x, y] = imagePoint(ref, [o.x * sx, o.y * sy]);
              return {
                id: `type-pipe-${i}`,
                kind: 'pipe',
                x,
                y,
                height: 2800,
                name: '竖管',
                circuit: '',
                rotation: 0,
              };
            }),
        };
        const found: Candidate[] = result.rooms.map((r: { poly: Point[]; areaPixels: number }, i: number) => {
          const poly = r.poly.map(([x, y]) => [x * sx, y * sy] as Point);
          const suggestion = inferRoomKind(typeContext, {
            name: '',
            poly: poly.map((point) => imagePoint(ref, point)),
          });
          return {
            id: uid(),
            name: `房间 ${i + 1}`,
            poly,
            kind: suggestion.confidence === 'low' ? undefined : suggestion.kind,
            suggestedKind: suggestion.kind,
            typeReason: suggestion.reason,
            selected: true,
            areaPixels: r.areaPixels * sx * sy,
          };
        });
        setCandidates(found);
        setRecognition({
          source: ref.src,
          referenceWidth: ref.width,
          calibrated: ref.calibrated,
          settingsKey,
          pipes: result.pipes.map((o) => ({
            ...o,
            id: uid(),
            x: o.x * sx,
            y: o.y * sy,
            diameterPixels: o.diameterPixels * sx,
          })),
          shafts: result.shafts.map((r) => ({
            ...r,
            id: uid(),
            x: r.x * sx,
            y: r.y * sy,
            w: r.w * sx,
            h: r.h * sy,
          })),
          walls: result.walls.map((r) => ({ ...r, x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy })),
          openings: result.openings.map((o) => ({
            ...o,
            id: uid(),
            selected: o.evidence !== 'gap',
            a: [o.a[0] * sx, o.a[1] * sy],
            b: [o.b[0] * sx, o.b[1] * sy],
            width: o.width * (o.a[0] === o.b[0] ? sx : sy),
            bayDepth: o.bayDepth === undefined ? undefined : o.bayDepth * (o.a[0] === o.b[0] ? sx : sy),
          })),
          grid: {
            xs: result.grid.xs.map((x) => x * sx),
            ys: result.grid.ys.map((y) => y * sy),
            cellCount: result.grid.cellCount,
          },
          warnings: result.warnings,
          showGrid: false,
          showWalls: true,
          importWalls: true,
        });
        notify(
          found.length
            ? `找到 ${found.length} 个房间、${result.openings.length} 处门窗、${result.shafts.length} 个烟道、${result.pipes.length} 根竖管候选，请核对后导入`
            : `找到 ${result.walls.length} 段墙体，尚未围合房间，请查看识别预览`,
        );
      };
      w.onerror = () => {
        if (token !== generation.current) return;
        setBusy(false);
        w.terminate();
        notify('识别失败，请尝试较小的图片');
      };
      w.postMessage(
        {
          pixels: pixels.buffer,
          width: canvas.width,
          height: canvas.height,
          options: {
            threshold,
            closeRadius: 0,
            maxOpening: gap,
            minArea: minArea / 100,
            minWallThickness: minWall,
            maxWallThickness: maxWall,
            mmPerPixel: ref.width / canvas.width,
            wallSettings,
            doorSettings,
            pipeSettings,
          },
        },
        [pixels.buffer],
      );
    } catch {
      if (token !== generation.current) return;
      setBusy(false);
      notify('无法读取底图像素，请重新上传图片');
    }
  };
  const apply = (onlyPipes = false) => {
    if (!ref || recognition?.source !== ref.src) return;
    if (!onlyPipes && candidateEdit) {
      notify('请先应用轮廓调整、确认切分或取消当前调整，再添加识别结果');
      return;
    }
    if (recognition.referenceWidth !== ref.width || recognition.settingsKey !== settingsKey) {
      notify('比例已变更，请重新识别后再导入，以保证墙厚和烟道尺寸准确');
      return;
    }
    const rooms = (onlyPipes ? [] : candidates)
      .filter((c) => c.selected)
      .map((c) => ({ ...c, poly: c.poly.map((p) => imagePoint(ref, p)) }));
    const selectedOpenings = onlyPipes ? [] : recognition.openings.filter((o) => o.selected);
    const selectedShafts = onlyPipes ? [] : recognition.shafts.filter((o) => o.selected);
    const selectedPipes = recognition.pipes
      .filter((o) => o.selected)
      .filter((o) => {
        if (!onlyPipes) return true;
        const [x, y] = imagePoint(ref, [o.x, o.y]);
        return !project.devices.some(
          (d) =>
            d.kind === 'pipe' &&
            Math.hypot(d.x - x, d.y - y) < Math.max(20, Math.min(d.diameter ?? 110, o.diameter) / 2),
        );
      });
    if (onlyPipes && !selectedPipes.length && recognition.pipes.some((o) => o.selected)) {
      notify('所选位置已有竖管，无需重复添加');
      return;
    }
    const selectedWalls =
      recognition.importWalls && !onlyPipes
        ? recognition.walls.filter(
            (r) => r.openingIndex === undefined || recognition.openings[r.openingIndex]?.selected,
          )
        : [];
    if (
      !rooms.length &&
      !selectedOpenings.length &&
      !selectedWalls.length &&
      !selectedShafts.length &&
      !selectedPipes.length
    ) {
      notify('请至少选择一项候选结果');
      return;
    }
    if (rooms.some((r) => !validPolygon(r.poly))) {
      notify('部分轮廓过小或相交，请取消勾选后手动描绘');
      return;
    }
    commit((d) => {
      d.rooms.push(
        ...rooms.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind ?? (kindFromName(r.name) === 'unknown' ? undefined : kindFromName(r.name)),
          poly: r.poly,
          flooring: structuredClone(d.globalFlooring),
          boundary: r.boundary ?? !recognition.importWalls,
          counted: true,
          wallWidth: wallSettings.thin,
        })),
      );
      const factor = ref.width / ref.pixelWidth;
      const wallStart = d.walls.length;
      for (const r of selectedWalls) {
        const horizontal = r.w >= r.h;
        const a: Point = horizontal ? [r.x, r.y + r.h / 2] : [r.x + r.w / 2, r.y];
        const b: Point = horizontal ? [r.x + r.w, r.y + r.h / 2] : [r.x + r.w / 2, r.y + r.h];
        d.walls.push({
          id: uid(),
          a: imagePoint(ref, a),
          b: imagePoint(ref, b),
          width: Math.max(
            20,
            Math.min(2000, r.widthMm ?? matchWallThickness(Math.min(r.w, r.h) * factor, wallSettings)),
          ),
          bearing: false,
          height: 2800,
        });
      }
      joinWallAxes(d.walls.slice(wallStart));
      if (!onlyPipes)
        for (const w of recognition.extraWalls ?? [])
          d.walls.push({
            id: uid(),
            a: imagePoint(ref, w.a),
            b: imagePoint(ref, w.b),
            width: Math.max(20, Math.min(2000, w.width * factor)),
            bearing: false,
            height: 2800,
          });
      for (const o of selectedOpenings) {
        const item = resolvedOpening(
          {
            id: o.id,
            type: o.type,
            a: imagePoint(ref, o.a),
            b: imagePoint(ref, o.b),
            width: Math.max(20, Math.min(2000, o.width * factor)),
            color: o.type === 'window' ? '#8bbfcb' : '#b6906a',
            windowStyle: o.windowStyle,
            bayDepth:
              o.bayDepth === undefined ? undefined : Math.max(100, Math.min(3000, o.bayDepth * factor)),
            baySide: o.baySide,
            autoDepth: true,
            doorStyle: o.doorStyle,
            hinge: o.hinge,
            swing: o.swing,
          },
          d.walls.slice(wallStart),
        );
        if (item.type === 'door') {
          const length = Math.hypot(item.b[0] - item.a[0], item.b[1] - item.a[1]),
            target = matchDoorWidth(length, item.doorStyle === 'sliding', doorSettings),
            t = (length - target) / (2 * (length || 1));
          const a: Point = [item.a[0] + (item.b[0] - item.a[0]) * t, item.a[1] + (item.b[1] - item.a[1]) * t],
            b: Point = [item.b[0] - (item.b[0] - item.a[0]) * t, item.b[1] - (item.b[1] - item.a[1]) * t];
          item.a = a;
          item.b = b;
        }
        d.openings.push(item);
      }
      for (const pipe of selectedPipes) {
        const [x, y] = imagePoint(ref, [pipe.x, pipe.y]);
        d.devices.push({
          id: pipe.id,
          kind: 'pipe',
          x,
          y,
          height: 2800,
          diameter: pipe.diameter,
          pipeSystem: pipe.pipeSystem,
          name:
            pipe.pipeSystem === 'drain'
              ? '排水立管'
              : pipe.pipeSystem === 'water'
                ? '给水立管'
                : '待核对竖管',
          circuit: '',
          rotation: 0,
        });
      }
      for (const o of selectedShafts)
        d.shafts.push({
          id: o.id,
          name: '烟道',
          poly: rect([o.x, o.y], [o.x + o.w, o.y + o.h]).map((pt) => imagePoint(ref, pt)),
          height: 2800,
        });
    });
    setCandidates([]);
    setRecognition(null);
    setTool('select');
    notify(
      `已添加 ${rooms.length} 个房间、${selectedWalls.length} 段墙体、${selectedOpenings.length} 处门窗、${selectedShafts.length} 个烟道、${selectedPipes.length} 根竖管，可选中微调`,
    );
  };
  return (
    <>
      <Section title="户型参考图" extra={<ImagePlus size={16} />}>
        <label
          className={`upload-zone${draggingImage ? ' dragging' : ''}`}
          aria-busy={uploading}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDraggingImage(true);
          }}
          onDragLeave={(e) => {
            if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget))
              setDraggingImage(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingImage(false);
            void upload(e.dataTransfer.files[0]);
          }}
        >
          <input
            className="upload-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={ref ? '更换参考底图' : '上传户型图'}
            disabled={uploading}
            onChange={(e) => {
              void upload(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
          {uploading ? <LoaderCircle size={26} className="spin" /> : <ImagePlus size={26} />}
          <strong>
            {uploading
              ? '正在读取图片…'
              : draggingImage
                ? '松开以载入图片'
                : ref
                  ? '更换参考底图'
                  : '上传户型图'}
          </strong>
          <span>PNG / JPG / WebP · 最大 20 MB</span>
          <span>点击选择，或将图片拖到这里</span>
        </label>
        <p className="help">也可复制图片后，在此页面按 Ctrl+V 粘贴。</p>
        {uploading && (
          <p className="help" role="status">
            正在读取并处理底图，请稍候…
          </p>
        )}
        {uploadError && (
          <p className="help warning" role="alert">
            {uploadError}
          </p>
        )}
        {ref && (
          <>
            <div className="inline-checks">
              <label>
                <input
                  type="checkbox"
                  checked={ref.visible}
                  onChange={(e) => update({ visible: e.target.checked })}
                />
                显示底图
              </label>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  commit((d) => {
                    d.reference = null;
                  });
                  setCandidates([]);
                }}
              >
                移除
              </button>
            </div>
            <label className="field">
              <span>
                底图透明度 <small>{Math.round(ref.opacity * 100)}%</small>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step=".05"
                value={ref.opacity}
                onChange={(e) => update({ opacity: +e.target.value })}
              />
            </label>
            <div className="fields">
              <NumberField label="位置 X" value={ref.x} onChange={(v) => update({ x: v })} />
              <NumberField label="位置 Y" value={ref.y} onChange={(v) => update({ y: v })} />
              <NumberField
                label="图纸总宽"
                value={ref.width}
                min={100}
                max={200000}
                onChange={(v) => update({ width: v, calibrated: false })}
              />
              <NumberField
                label="旋转"
                value={ref.rotation}
                min={-360}
                max={360}
                unit="°"
                step={1}
                onChange={(v) => update({ rotation: v })}
              />
            </div>
          </>
        )}
      </Section>
      {ref && (
        <>
          <Section
            title="底图比例 · 可选校准"
            extra={
              <span className={`badge ${ref.calibrated ? 'success' : ''}`}>
                {ref.calibrated ? '已校准' : '尺寸估算'}
              </span>
            }
          >
            <NumberField
              label="图中两点实际距离"
              value={calibrationLength}
              min={100}
              max={100000}
              onChange={setCalibrationLength}
            />
            <button className="wide secondary" onClick={() => setTool('calibrate')}>
              <Ruler size={15} />
              点击图中两点校准
            </button>
            <p className="help">
              可直接识别生成，无需先校准。生成后选中一个房间，在右侧「按房间校准全屋」输入实际边长即可；这里的两点校准仅缩放底图。
            </p>
          </Section>
          <Section title="图形识别生成" extra={<ScanLine size={16} />}>
            <h4>墙厚预设 · 识别前设置</h4>
            <label className="check-row">
              <input
                type="checkbox"
                checked={wallSettings.enabled}
                onChange={(e) => updateWallSettings({ enabled: e.target.checked })}
              />
              将墙厚匹配到预设
            </label>
            <div className="fields">
              <NumberField
                label="薄墙预设"
                value={wallSettings.thin}
                min={50}
                max={1000}
                step={10}
                onChange={(thin) => updateWallSettings({ thin })}
              />
              <NumberField
                label="厚墙预设"
                value={wallSettings.thick}
                min={50}
                max={1000}
                step={10}
                onChange={(thick) => updateWallSettings({ thick })}
              />
              <NumberField
                label="墙厚匹配容差"
                value={wallSettings.tolerance}
                min={0}
                max={200}
                step={5}
                onChange={(tolerance) => updateWallSettings({ tolerance })}
              />
            </div>
            <p className="help">
              按当前比例匹配最近的预设；默认 120 / 240 mm，误差不超过 40 mm
              时吸附，超出容差保留测量值。未校准时尺寸为估算，生成后可选中房间校准。设置随方案保存，不改变承重标记。
            </p>
            <p className="help">
              根据边线与拐角切分矩形，区分实心墙、白色双线墙与细标注线，再合并房间。结合墙间断口、开门弧和多条平行线识别门窗。
            </p>
            <h4>门洞尺寸预设 · 识别前设置</h4>
            <label className="check-row">
              <input
                type="checkbox"
                checked={doorSettings.enabled}
                onChange={(e) => updateDoorSettings({ enabled: e.target.checked })}
              />
              将门洞宽度匹配到预设
            </label>
            <TextField
              key={`swing-${doorSettings.widths.join(',')}`}
              label="平开门洞宽度预设"
              value={doorSettings.widths.join(', ')}
              onChange={(v) => updateWidths('widths', v)}
            />
            <button
              className="text-button"
              onClick={() => updateDoorSettings({ widths: [...DEFAULT_DOOR_SETTINGS.widths] })}
            >
              恢复平开门 50 mm 档位
            </button>
            <TextField
              key={`sliding-${doorSettings.slidingWidths.join(',')}`}
              label="推拉门洞宽度预设"
              value={doorSettings.slidingWidths.join(', ')}
              onChange={(v) => updateWidths('slidingWidths', v)}
            />
            <NumberField
              label="门洞匹配容差"
              value={doorSettings.tolerance}
              min={0}
              max={300}
              step={10}
              onChange={(tolerance) => updateDoorSettings({ tolerance })}
            />
            <p className="help">
              单位 mm，逗号分隔；指含门框的洞口宽度，不是门扇宽度。平开门默认 700–1200 mm，每 50 mm 一档。
              先保留两端门垛，再选择容差内不超过净宽的最近预设；没有合适档位时保留测量值。默认容差 80
              mm，可关闭匹配或修改预设。
            </p>
            <h4>管径预设 · 识别前设置</h4>
            <label className="check-row">
              <input
                type="checkbox"
                checked={pipeSettings.enabled}
                onChange={(e) => updatePipeSettings({ enabled: e.target.checked })}
              />
              将管道外径匹配到预设
            </label>
            <TextField
              key={`pipes-${pipeSettings.diameters.join(',')}`}
              label="管道外径预设"
              value={pipeSettings.diameters.join(', ')}
              onChange={updateDiameters}
            />
            <NumberField
              label="管径匹配容差"
              value={pipeSettings.tolerance}
              min={0}
              max={200}
              step={1}
              onChange={(tolerance) => updatePipeSettings({ tolerance })}
            />
            <p className="help">
              单位 mm，为外径，不是 DN。默认包含 20 / 25 / 32 / 40 / 50 / 75 / 110 / 160 / 200，误差不超过 20
              mm 时匹配；超出保留估算值。图纸圆圈可能只是示意，生成后可核对用途与尺寸。
            </p>
            <div className="fields">
              <NumberField
                label="黑白阈值"
                value={threshold}
                min={30}
                max={240}
                step={5}
                unit=""
                onChange={setThreshold}
              />
              <NumberField
                label="门洞最大跨度"
                value={gap}
                min={0}
                max={200}
                step={1}
                unit="px"
                onChange={setGap}
              />
              <NumberField
                label="最小实线墙厚"
                value={minWall}
                min={2}
                max={12}
                unit="px"
                step={1}
                onChange={setMinWall}
              />
              <NumberField
                label="最大空心墙厚"
                value={maxWall}
                min={minWall + 1}
                max={80}
                unit="px"
                step={1}
                onChange={setMaxWall}
              />
              <NumberField
                label="最小区域"
                value={minArea}
                min={0.05}
                max={20}
                step={0.1}
                unit="%"
                onChange={setMinArea}
              />
            </div>
            <p className="help">
              像素参数按识别图计算（长边最多 1200 px）。灰色细墙漏检可提高阈值；误收尺寸线可提高最小实线墙厚。
            </p>
            <button className="wide primary" disabled={busy || uploading} onClick={recognize}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <ScanLine size={15} />}
              {busy ? '正在分析墙体与门窗…' : '识别房间轮廓'}
            </button>
            {busy && (
              <button
                className="text-button"
                onClick={() => {
                  generation.current++;
                  worker.current?.terminate();
                  setBusy(false);
                }}
              >
                取消识别
              </button>
            )}
            {recognition?.source === ref.src && (
              <div className="recognition-review">
                <h4>识别预览 · {recognition.grid.cellCount.toLocaleString()} 个矩形分区</h4>
                <div className="inline-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={recognition.showWalls}
                      onChange={(e) => setRecognition({ ...recognition, showWalls: e.target.checked })}
                    />
                    墙体预览
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={recognition.showGrid}
                      onChange={(e) => setRecognition({ ...recognition, showGrid: e.target.checked })}
                    />
                    矩形分区
                  </label>
                </div>
                <p className="help">橙色：实心墙 · 紫色：空心墙 · 蓝色：窗 · 粉色：烟道 · 虚线：推测门洞</p>
                <label className="recognition-option">
                  <input
                    type="checkbox"
                    checked={recognition.importWalls}
                    onChange={(e) => setRecognition({ ...recognition, importWalls: e.target.checked })}
                  />
                  导入 {recognition.walls.length} 段独立墙体
                </label>
                <p className="help">
                  不重复生成边界墙；房间宽深可联动墙体与洞口。未勾选的推测门洞保留断口；颜色不代表承重属性。
                </p>
                {recognition.openings.length > 0 && (
                  <h4>
                    门窗候选 · {recognition.openings.filter((o) => o.selected).length}/
                    {recognition.openings.length}
                  </h4>
                )}
                <div className="opening-candidate-list">
                  {recognition.openings.map((o, i) => (
                    <div className="opening-candidate" key={o.id}>
                      <input
                        type="checkbox"
                        aria-label={`选择门窗 ${i + 1}`}
                        checked={o.selected}
                        onChange={(e) =>
                          setRecognition({
                            ...recognition,
                            openings: recognition.openings.map((v) =>
                              v.id === o.id ? { ...v, selected: e.target.checked } : v,
                            ),
                          })
                        }
                      />
                      <b>{i + 1}</b>
                      <select
                        aria-label={`门窗 ${i + 1} 类型`}
                        value={
                          o.type === 'window' && o.windowStyle === 'bay'
                            ? 'bay'
                            : o.type === 'door' && o.doorStyle === 'sliding'
                              ? 'sliding'
                              : o.type
                        }
                        onChange={(e) =>
                          setRecognition({
                            ...recognition,
                            openings: recognition.openings.map((v) =>
                              v.id === o.id
                                ? {
                                    ...v,
                                    type:
                                      e.target.value === 'door' || e.target.value === 'sliding'
                                        ? 'door'
                                        : e.target.value === 'railing'
                                          ? 'railing'
                                          : 'window',
                                    doorStyle: e.target.value === 'sliding' ? 'sliding' : 'swing',
                                    windowStyle: e.target.value === 'bay' ? 'bay' : 'flat',
                                  }
                                : v,
                            ),
                          })
                        }
                      >
                        <option value="door">门洞</option>
                        <option value="window">窗户</option>
                        <option value="bay">飘窗</option>
                        <option value="sliding">推拉门</option>
                        <option value="railing">开放阳台（玻璃护栏）</option>
                      </select>
                      <small>
                        {Math.round(
                          (Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) * ref.width) / ref.pixelWidth,
                        )}{' '}
                        mm
                        <br />
                        {o.evidence === 'balcony'
                          ? '轨道 · 阳台邻接'
                          : o.evidence === 'bay'
                            ? '三面围合飘窗'
                            : o.evidence === 'parallel'
                              ? '多线窗框'
                              : o.evidence === 'arc'
                                ? '开门弧'
                                : '断口 · 待核对'}
                      </small>
                    </div>
                  ))}
                </div>
                {recognition.pipes.length > 0 && (
                  <>
                    <h4>
                      竖管候选 · {recognition.pipes.filter((o) => o.selected).length}/
                      {recognition.pipes.length}
                    </h4>
                    <div className="opening-candidate-list">
                      {recognition.pipes.map((o, i) => {
                        const change = (value: Partial<typeof o>) =>
                          setRecognition({
                            ...recognition,
                            pipes: recognition.pipes.map((v) => (v.id === o.id ? { ...v, ...value } : v)),
                          });
                        return (
                          <div className="pipe-candidate" key={o.id}>
                            <label className="check-row">
                              <input
                                type="checkbox"
                                aria-label={`选择竖管 ${i + 1}`}
                                checked={o.selected}
                                onChange={(e) => change({ selected: e.target.checked })}
                              />
                              竖管 {i + 1}
                            </label>
                            <label className="field">
                              <span>用途</span>
                              <select
                                aria-label={`竖管 ${i + 1} 用途`}
                                value={o.pipeSystem}
                                onChange={(e) =>
                                  change({ pipeSystem: e.target.value as typeof o.pipeSystem })
                                }
                              >
                                <option value="unknown">待核对</option>
                                <option value="drain">排水立管</option>
                                <option value="water">给水立管</option>
                              </select>
                            </label>
                            <NumberField
                              label={`竖管 ${i + 1} 外径`}
                              min={10}
                              max={1000}
                              step={1}
                              value={o.diameter}
                              onChange={(diameter) => change({ diameter })}
                            />
                            <p className="help">
                              图形估算 Ø{o.measuredDiameter} → Ø{o.diameter} mm
                              {o.diameter !== o.measuredDiameter ? ' · 已匹配 / 调整' : ' · 保留估算'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {recognition.shafts.length > 0 && (
                  <>
                    <h4>
                      烟道候选 · {recognition.shafts.filter((o) => o.selected).length}/
                      {recognition.shafts.length}
                    </h4>
                    <div className="opening-candidate-list">
                      {recognition.shafts.map((o, i) => (
                        <label key={o.id} className="check-row">
                          <input
                            aria-label={`选择烟道 ${i + 1}`}
                            type="checkbox"
                            checked={o.selected}
                            onChange={(e) =>
                              setRecognition({
                                ...recognition,
                                shafts: recognition.shafts.map((v) =>
                                  v.id === o.id ? { ...v, selected: e.target.checked } : v,
                                ),
                              })
                            }
                          />
                          烟道 {i + 1} · {Math.round((o.w * ref.width) / ref.pixelWidth)} ×{' '}
                          {Math.round((o.h * ref.width) / ref.pixelWidth)} mm ·{' '}
                          {o.evidence === 'box' ? '待核对' : '封闭墙边符号'}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {
                  <p className="help">
                    墙厚预览与导入一致：
                    {
                      recognition.walls.filter(
                        (r) =>
                          r.widthMm !== undefined &&
                          Math.abs(r.widthMm - (Math.min(r.w, r.h) * ref.width) / ref.pixelWidth) > 0.5,
                      ).length
                    }{' '}
                    段匹配预设，其余保留测量值。
                  </p>
                }
                {recognition.warnings.map((message) => (
                  <p className="help" key={message}>
                    {message}
                  </p>
                ))}
              </div>
            )}
            {candidates.length > 0 && (
              <div className="candidates">
                <CandidateEditor />
                <h4>
                  候选房间 · {candidates.filter((c) => c.selected).length}/{candidates.length}
                </h4>
                {candidates.map((c, i) => (
                  <div key={c.id} className="candidate">
                    <label>
                      <input
                        type="checkbox"
                        checked={c.selected}
                        onChange={(e) =>
                          setCandidates(
                            candidates.map((v) => (v.id === c.id ? { ...v, selected: e.target.checked } : v)),
                          )
                        }
                      />
                      <b>{i + 1}</b>
                    </label>
                    <input
                      aria-label={`候选房间 ${i + 1} 名称`}
                      maxLength={150}
                      value={c.name}
                      onChange={(e) =>
                        setCandidates(
                          candidates.map((v) => (v.id === c.id ? { ...v, name: e.target.value } : v)),
                        )
                      }
                    />
                    <small>{area(c.poly.map((p) => imagePoint(ref, p))).toFixed(1)} ㎡</small>
                    <select
                      className="candidate-type"
                      aria-label={`候选房间 ${i + 1} 类型`}
                      value={c.kind ?? 'unknown'}
                      onChange={(e) =>
                        setCandidates(
                          candidates.map((v) =>
                            v.id === c.id ? { ...v, kind: e.target.value as RoomKind } : v,
                          ),
                        )
                      }
                    >
                      {Object.entries(ROOM_TYPES).map(([kind, value]) => (
                        <option value={kind} key={kind}>
                          {value.label}
                        </option>
                      ))}
                    </select>
                    <small className="candidate-type-hint">{c.typeReason}</small>
                    {c.suggestedKind && c.suggestedKind !== 'unknown' && c.kind !== c.suggestedKind && (
                      <button
                        className="candidate-type wide secondary"
                        onClick={() =>
                          setCandidates(
                            candidates.map((v) => (v.id === c.id ? { ...v, kind: c.suggestedKind } : v)),
                          )
                        }
                      >
                        采用建议：{ROOM_TYPES[c.suggestedKind].label}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {recognition?.source === ref.src && (
              <>
                {recognition.pipes.length > 0 && (project.rooms.length > 0 || project.walls.length > 0) && (
                  <button className="wide secondary" onClick={() => apply(true)}>
                    仅补充选中的竖管
                  </button>
                )}
                <button className="wide primary" onClick={() => apply()}>
                  添加选中的结果
                </button>
                {!ref.calibrated && (
                  <p className="help">可直接生成。当前尺寸为估算值，之后可选中房间校准全屋。</p>
                )}
                <button
                  className="wide ghost"
                  onClick={() => {
                    setCandidates([]);
                    setRecognition(null);
                  }}
                >
                  取消候选结果
                </button>
              </>
            )}
          </Section>
        </>
      )}
    </>
  );
}
