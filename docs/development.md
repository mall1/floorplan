# 开发与部署

[返回首页](../README.md) | [使用指南](user-guide.md)

## 本地开发与检查

使用 Node.js 22.12+；`.nvmrc` 与 GitHub Actions 使用 Node.js 24。依赖由 `package-lock.json` 锁定，安装时使用 `npm ci`。

```bash
npm ci
npm run dev
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run format:check
```

`npm run build` 先执行 TypeScript 检查，再将生产文件写入 `dist/`。开发服务器默认监听 `http://127.0.0.1:5173`；生产构建可用 `npm run preview` 预览。浏览器应通过 HTTP 访问应用，不要直接打开 `dist/index.html`。

Playwright 默认启动开发服务器；本地已有服务器时可复用，CI 中则启动独立服务器。可用 `PLAYWRIGHT_BASE_URL` 指向已经启动的服务。测试报告、失败截图和追踪文件位于 `artifacts/`，不提交到仓库。

Windows PowerShell 下也可以使用已安装的 Chrome：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

单元测试覆盖几何、门窗与墙体识别、铺装、墙面面积、旧方案迁移和家具模型；浏览器测试覆盖户型编辑、图片上传与识别、尺寸校准、用量估算、JSON 往返、PNG 导出、3D 与窄屏布局。

## GitHub Pages

仓库地址为 <https://github.com/mall1/floorplan>，默认分支为 `main`。`.github/workflows/ci.yml` 在推送、拉取请求和手动触发时运行构建、单元测试与浏览器测试。

Pages 部署默认关闭；需要发布在线演示时：

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions → Variables** 添加仓库变量 `ENABLE_PAGES`，值为 `true`。
3. 推送到 `main`，或在 Actions 中选择 `main` 分支手动运行 **Check and deploy editor**。
4. 所有检查通过后，工作流将 `dist/` 上传并部署。成功部署后的预期访问地址为 <https://mall1.github.io/floorplan/>，以部署任务显示的 URL 为准。

其他分支和拉取请求只执行检查。移除 `ENABLE_PAGES` 或将其设为其他值会停止后续自动部署，但不会删除已经发布的站点。

## 其他静态托管

构建命令为 `npm ci && npm run build`，发布目录为 `dist/`。Vite 使用相对资源路径（`base: './'`），可部署到域名根目录或子目录。应用不需要后端、数据库或运行时密钥。

更换访问域名、协议或端口会进入不同的浏览器存储空间；迁移前先导出 JSON，再从新地址导入。

## 工程结构

```text
src/
  App.tsx                    工作台、文件操作与快捷键
  components/                React 画布、工具库、属性、图片识别、铺装、3D
  hooks/useProject.ts        方案历史与本地保存
  model/types.ts             统一毫米坐标的数据模型
  model/project.ts           方案校验、默认户型、旧版迁移
  model/geometry.ts          多边形、投影吸附、派生墙体与洞口切分
  model/architecture.ts      墙角斜接、洞口墙厚、飘窗与联动尺寸编辑
  model/bay-recognition.ts   外挑 / 内凹飘窗结构识别
  model/feature-recognition.ts  阳台推拉门与烟道识别
  model/door-presets.ts      门垛保护与门洞宽度预设
  model/wall-presets.ts      墙厚预设与容差匹配
  model/pipe-recognition.ts  竖管符号识别
  model/pipe-presets.ts      管道外径预设与容差匹配
  model/wall-area.ts         墙面面积与洞口扣除估算
  model/calibration.ts       按参考边等比例校准全屋
  model/shafts.ts            扣除烟道占地的房间净面积
  model/walkthrough.ts       安全出生点、碰撞和滑动
  render/architecture-models.ts  门套、门扇五金、平窗和飘窗模型
  render/furniture-extra.js  新增家具模型，横向尺寸随家具宽深调整
  model/flooring.ts           2D / 3D 共用排布算法
  model/recognition.ts        矩形分区、实心/空心墙、门洞、窗框和房间识别
  workers/                   后台图片识别
  data/original.js            原始户型与家具目录
  render/                    保留的 SVG 图形和 Three.js 家具模型
  styles.css                 工作台与窄屏抽屉样式
tests/
  model.test.ts              领域测试
  recognition.test.ts        标注过滤、模糊墙线、空心墙、拐角和门窗回归
  e2e/studio.spec.ts         浏览器工作流回归
```

户型几何、点位、管线、铺装和底图均存入带 `version: 2` 的方案。导入用 Zod 校验类型、范围、轮廓和重复 ID；历史记录只在一次操作完成时提交，拖动预览不逐帧写入存储。3D 组件负责释放几何、材质、贴图、事件和渲染循环。

## 提交约定

提交源码、测试、锁文件、配置与文档。依赖目录、构建产物、识别调试结果、浏览器测试输出、日志和本地 `.env` 文件由 `.gitignore` 排除。展示用截图保存在 `docs/images/`，与临时测试输出分开。

文本文件通过 `.gitattributes` 统一使用 LF 换行；`npm run format` 和 `npm run format:check` 包含 `docs/` 中的 Markdown 文档。
