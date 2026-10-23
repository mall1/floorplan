# Floorplan Studio · 筑间

[中文](README.md) | English

A browser-based floorplan editor for drawing rooms, recognizing reference images, placing furniture, planning utilities and laying floors, with an interactive 3D view. Built with React 19, TypeScript, Vite and Three.js. Image processing and project storage run locally in the browser; no backend or API key is required.

[User guide](docs/user-guide.en.md) · [Development and deployment (中文)](docs/development.md) · [GitHub](https://github.com/mall1/floorplan)

![Floorplan Studio with the 2D editor and wall-area estimates](docs/images/editor.png)

## Features

- **Floorplan editing:** rectangular and polygonal rooms, editable vertices and dimensions, walls, doors, windows, bay windows, glass railings and shafts.
- **Image recognition:** upload, drop or paste a reference image; review locally detected rooms, walls, openings, shafts and vertical pipes, then calibrate dimensions.
- **Furniture and utilities:** more than 60 furniture items, editable water and electrical routes, and device placement with elevation and circuit settings.
- **Floor layouts:** tile and wood presets, custom dimensions, grout, patterns and laying origins, with whole-home or per-room layouts.
- **Quantity estimates:** flooring materials and costs, wall finish areas and wallpaper reference areas, with CSV exports.
- **3D views:** orbit and top views, cutaway walls, day/night lighting, interactive doors and indoor walkthroughs.
- **Project files:** local autosave, up to 60 undo/redo steps, validated JSON import/export and 2D/3D PNG export.

## Quick start

Use **Node.js 22.12 or newer**. The repository's `.nvmrc` and CI use Node.js 24.

```bash
git clone https://github.com/mall1/floorplan.git
cd floorplan
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`. The interface is currently in Simplified Chinese. Dependencies are bundled, with no external CDN needed at runtime.

Start with the included apartment or create an empty plan. For image-based plans, review recognition candidates and calibrate using a known room-edge length. See the [user guide](docs/user-guide.en.md) for capabilities and limitations, or the [Chinese guide](docs/user-guide.md) for step-by-step instructions and keyboard shortcuts.

## Commands

| Command                | Purpose                                |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start the development server           |
| `npm run build`        | Type-check and build to `dist/`        |
| `npm run preview`      | Preview the production build           |
| `npm run typecheck`    | Check TypeScript types                 |
| `npm test`             | Run unit and regression tests          |
| `npm run test:e2e`     | Run Playwright browser tests           |
| `npm run format`       | Format source, tests and documentation |
| `npm run format:check` | Check formatting                       |

Before running browser tests for the first time:

```bash
npx playwright install chromium
npm run test:e2e
```

To use installed Chrome on Windows PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

Test output and screenshots are written to the ignored `artifacts/` directory.

## Architecture

`src/components/` implements the editor UI, SVG canvas and 3D scene. `src/model/` contains the shared millimetre-based domain model, geometry, recognition, floor layouts, quantity estimates and validation. `src/hooks/` manages history and local persistence; `src/workers/` runs image analysis off the UI thread. Sample data and furniture assets live in `src/data/` and `src/render/`. Tests live in `tests/`, with browser scenarios in `tests/e2e/`.

See [development documentation (中文)](docs/development.md) for the module map and deployment configuration.

## Data and limitations

All coordinates use millimetres. Dimensions and areas are estimates until the reference image is calibrated. Recognition requires manual review, especially for blurred images, diagonal walls and open-plan spaces; room-name OCR and structural wall classification are not included.

Autosave is specific to the current browser and site address. Export JSON backups to retain multiple designs or move between devices. Material estimates are not optimized cutting lists; wall finish estimates are not wallpaper roll counts. The [user guide](docs/user-guide.en.md) describes calculation limits.

## Deployment

Deploy the contents of `dist/` to a static host after `npm run build`. GitHub Actions runs builds, unit tests and browser tests on pushes and pull requests.

GitHub Pages deployment is optional. To enable it, select **GitHub Actions** in **Settings → Pages → Source**, add the repository Actions variable `ENABLE_PAGES` with the value `true`, then push to `main` or manually run **Check and deploy editor**. The expected project URL after successful deployment is `https://mall1.github.io/floorplan/`.

## License and credits

[MIT](LICENSE). The original sample apartment, furniture models and copyright notices are preserved. Original author: [@akokoi1](https://x.com/akokoi1).
