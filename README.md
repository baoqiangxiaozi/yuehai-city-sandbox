# 粤海：山海之间的科技城 · 3D 城市沙盘

本包是**粤海街道单文件版**城市沙盘。用 OpenStreetMap 建筑轮廓和路网（ODbL）在浏览器里生成可交互的三维场景，包含昼夜、天气、交通模拟、地标精模和世界控制面板。

这不是精确地图。建筑轮廓来自 OSM 快照，车流、拥堵、风速和天气都是**模拟演示**，不是实时路况或真实气象。

## 这个包里有什么

- `index.html` — 构建好的单文件页面，CSS、JS、OSM 数据、全部标名地标几何和 Three.js r128 全部内嵌，可脱机打开。
- `src/yuehai.shell.html`、`src/yuehai.css`、`src/yuehai.js` — 页面外壳、样式和场景源码。
- `src/yuehai.lod.js` — 普通楼附加细节的静态分块与距离 LOD，构建时内联。
- `src/yuehai.refined.js` — 全部 Blender 地标的材质、环境反射和夜景接入策略。
- `landmarks/` — 标名地标的内联数据、适配器、可编辑 `.blend`、GLB、生成脚本和来源说明。
- `tests/roam.test.js` — 确认页面源码和成品里已经没有第一人称漫游入口。
- `tests/lod.test.js`、`tests/generic-fixture.js` — Three.js 几何与 LOD 测试；不运行浏览器/WebGL。
- `tests/landmarks.test.js` — 全部内联资产、接入位置、夜景、反射、射线与建筑图层挂载测试。
- `data/yuehai-osm.json` — 已投影的粤海 OSM 建筑 / 路网 / 地铁 / 水域数据（2026-10-28）。
- `vendor/three.min.js` — 与页面配套的 Three.js **r128**（不要换成其他版本）。来源与校验见 `vendor/README.md`。
- `scripts/build_page.py` — 把上面的源文件和 vendor 重新合成 `index.html`。
- `README-yuehai.md` — 本版实现细节和开发过程记录。其中的帧率数字是当时机器上的历史记录，不是现在的实测成绩；文中提到的部分旧路径（如前海页面、数据构建脚本、验收截图）也不在本包内。
- `GROKBOT.md` — 源码修改与构建备注。
- `.nojekyll` — 若放到 GitHub Pages，避免 Jekyll 处理隐藏文件。

本包**没有**前海升级版（`qianhai.html`、`src/qianhai.js`、`styles/qianhai.css`、`scripts/build_qianhai_data.py`、`README-qianhai.md`），也**没有**从 GeoJSON 重新生成数据的 `scripts/build_yuehai_data.py`。当前数据就是 `data/yuehai-osm.json`。

## 打开页面

直接用浏览器打开根目录的 `index.html` 即可，**不必访问 CDN，也可以脱机使用**。

或者在项目根目录启动本地服务：

```bash
python -m http.server 8000
```

然后访问 <http://127.0.0.1:8000/>。

如果 Three.js 未能载入或启动超时，页面会停留在启动屏并给出中文错误说明，而不会一直停在「正在启动城市沙盘…」。

## 修改后重新构建

不要直接改构建出来的 `index.html`。改 `src/`、`data/yuehai-osm.json` 或 `vendor/three.min.js` 之后，在项目根目录运行：

```bash
python scripts/build_page.py
```

需要 Python 3，构建脚本只用标准库。构建会覆盖根目录的 `index.html`，并把 `vendor/three.min.js` 内联进去。

## 数据与许可

- 建筑轮廓、路网、地铁和水域来自 OpenStreetMap，许可为 [ODbL 1.0](https://www.openstreetmap.org/copyright)。
- Three.js r128 为 MIT 许可，见 `vendor/three.min.js` 文件头。
- 交通、天气、车速和拥堵指数均为场景内模拟，页面上会标注「模拟」。

## 镜头

页面只保留俯瞰轨道相机：「自由观察」「自动环绕」「跟随地标」，以及「重置镜头视角」。
拖动旋转，滚轮缩放，右键平移。第一人称漫游、方向键和相关说明已经从页面移除。

```bash
node --check src/yuehai.js
node tests/roam.test.js
python scripts/build_page.py
```

## 普通楼程序化细节与分层 LOD（v4 / T-3）

**这不是实测建筑建模。** 普通楼的窗框、入口、雨棚、基座、屋顶设备均为程序化示意，
不代表真实门址、用途、材料或楼顶设施。本轮不修改 OSM 文件、不改普通楼基础轮廓/高度/位置，
普通楼 LOD 不替换标名地标。标名地标见下节的 Blender 资产。近景细节是已有体量上的装饰附加层。

### 真正新增 / 复用的内容

- 在普通楼最长的两个合适外立面加基座线；选一面加深色门厅、门框、薄雨棚和小台阶。
- 每栋最多给 **4 个现有窗灯面板位置**加几何细框；不再铺一套重叠窗片、不增加新窗灯。
  原幕墙 shader 的窗格、昼夜反射、窗灯占用率和种子继续复用。
- 原来已有的普通楼屋顶设备三角形从全城屋顶合批里**迁移**到中景分块，不画双份。
- 原来没有设备且内部能放得下的屋顶，近景增加一台小型设备和三条格栅；已有设备不再叠放新机箱。
- 重点地标及其登记建筑排除在普通楼装饰之外。夜景开关仍控制原灯光系统；新增物体是非自发光实体，
  随正常场景照明变化，不另开夜间常亮通道。建筑图层关闭时所有普通楼附加物随之隐藏。

### LOD 距离与开销边界

按 **160 米网格**静态合批，所有几何只在初始化时生成；每 **250ms** 检查一次相机距离，
只切换缓存 mesh 的可见性，不在移动时重建网格。

距离采用相机到分块三维建筑包围盒的最短距离，除以现有 `PLAN` 换算；不是相机到单栋楼中心的距离。
当前仍保留项目原有竖向夸张，因此它是场景距离换算，不是精密地理测距。

| 状态 | 接近时 | 远离时（滞回） | 实际提交的附加几何 |
|---|---|---|---|
| 近景 | ≤180 米进入 | >240 米退出 | 基座/门厅/框/雨棚/新增屋顶设备 + 原屋顶设备 |
| 中景 | ≤600 米进入 | >720 米退出 | 仅复用原屋顶设备（本来没有设备的分块不会凭空增加 mesh） |
| 远景 | 在中景阈值外 | 同左 | 不提交上述附加细节；继续保留原基础体量、原幕墙和夜间窗灯 |

这是真正的几何可见性 LOD，而非调亮度冒充细节切换。近景到中景、到远景都有不同的实体几何。
已有幕墙和夜景保留是为了不破坏原画面：**本轮不声称整座城市的全部几何都已做 LOD**。
不盲目拆原基础大 mesh，不改旧拾取映射。附加块开启视锥剔除，但原基础网格的策略保持不变。
每块最多一个近景合批和一个复用屋顶合批，共享材质，不是每栋/每窗一个 draw call。

所有层级缓存仍占内存；远景只是**不提交额外细节绘制**，不代表释放远处分块的 GPU/CPU 内存。
`ordinaryLOD.stats()` 里的 active mesh/triangle 是**附加层的逻辑上界**，不含基础城市场景、
阴影重复 pass，也未扣去视锥剔除，不是实际 GPU draw call 或 FPS。

### 浏览器里怎么看到切换

1. 默认总览下附加细节为远景关闭。用滚轮把轨道相机拉近普通楼，观察基座、门厅雨棚、已有亮窗面板的浅色细框。
2. 拉近或拉远同一片普通楼。近景约 180 米进入，退到 240 米外退出；继续远离到 720 米外连中景屋顶设备也不绘制。
   切换粒度是整个分块，不是每栋独立渐变；边界附近有滞回，不会因来回一两米高频闪烁。
3. 回到总览后这些附加物消失，原城市基础体量和窗灯仍在。
4. 控制台只读检查：`__YUEHAI__.ordinaryLOD.stats()`；也可用 `debugChunks()` 查看块的 level(0远/1中/2近)、距离和对应建筑索引。
5. 更明确的调试对比：把轨道相机停在一栋普通楼前，再在控制台分别隐藏/显示名字以 `ordinary-near-` 开头的 mesh，可辨认具体附加几何；
   正常自动 LOD 在下一次更新会恢复可见性，最终验收仍应以实际距离切换为准。
6. 验证建筑图层关闭不遗留门厅/设备；切到夜间并关闭夜景时没有新加常亮窗片；
   普通楼仍可点中原卡片，地标聚焦和俯瞰控制仍工作。

### 本轮纯几何计数（不是 FPS）

实际执行本包普通楼构建代码得到：2212 栋纳入附加层、485 个分块；4416 段基座、2210 处入口、
5115 个既有窗灯面板细框、1863 台原先空白屋顶的小设备；105 栋原有屋顶设备迁移复用。
全部近景附加几何缓存 342456 三角形，中景复用旧屋顶 1050 三角形；
position/color/normal 属性合计 37098648 字节（不是整个场景内存，也不含 JS 构建对象与材质）。
默认总览逻辑上附加层为 0 三角形 / 0 mesh；在科苑南路名义街边坐标的合成相机采样中，
附加层逻辑上界约为 2146 三角形 / 11 mesh（不含基础场景、视锥剔除和阴影 pass）。
这些仅是几何预算与状态检查，不能称为实际 GPU 量测、FPS 或整城性能验收。

### 开发验证

```bash
node --check src/yuehai.lod.js
node tests/roam.test.js
node tests/lod.test.js
# 可选：在保留 v3 的机器上指定路径，额外逐字节比较基础几何/窗灯/数据/拾取映射
node tests/lod.test.js /path/to/yuehai-sandbox-v3
python scripts/build_page.py
```

几何测试只执行真实通用楼构建代码与 Three.js 几何/射线，2D canvas 用桩替代，不跑 WebGL 或自动化浏览器。
因此计数可用于预算核对，但不能替代完整城市画面、夜景或实际设备性能验收；历史 FPS 不作为本轮成绩。

## 标名地标的 Blender 外观模型

页面上每一处有具体建筑的标名地标都换成了 Blender 资产，挂在 `buildingsGroup` 上，并关掉了原来的专用 JS 构建体，避免新旧几何重叠。科技园片区只有范围标签、没有体量；深圳大学校园仍是通用楼，只单独做了演会中心。这些模型是可编辑的外观，不是 BIM、测绘或施工模型。

- **腾讯滨海大厦已重做**，不再使用上一版的锯齿幕墙、大裙楼和暴露桁架。南塔 245.8 米、北塔 194.8 米仍用 OSM 高度和轮廓，朝向已烘焙。三条连廊是中灰带铜框的水平体：低连廊约 22–58 米（按街景，不是“2–5 层”），中连廊取南塔 21–25 层，高连廊取南塔 35–38 层。层位和连廊出挑是近似。塔身是浅色实墙，不是黑墙，也不是可透视的线框。幕墙格子按沙盘尺度加粗，不是实测模数。
- **中国华润大厦保留**上一版网格（392.5 米，36036 三角面），没有重生成。玻璃改为深青灰，外柱仍是浅色。柱距仍不是测绘值。
- 其余标名建筑按 OSM 轮廓和高度生成，立面分格、冠部和低层连接体都是近似。百度国际大厦用公开高度替换了 OSM 的 12.8 米占位。腾讯大厦和深圳湾万象城没有 OSM 轮廓，分别是锚点处的梭形示意和低层商业示意。长短边对调时包围盒中心要跟着转，否则竖梃会离开楼体。中海油和留学生创业大厦已按修正后的位置重新看过。
- 全部资产合计 158338 三角面。这是几何计数，不是整场景 draw call 或帧率，也不能据此说每一栋都是精模。
- 日夜走 `setNight`，建筑图层关闭时整组隐藏。新材质标记为 `blenderRefined`，不会被全场材质修正覆盖。
- 页面没有第一人称漫游。镜头是俯瞰轨道相机。

内联数据是米制 Y-up，OBB 朝向已烘焙。运行时只映射一次：`position=(rawX*.058,.09,rawZ*.058)`，`scale=(.058,.112,.058)`。
`landmarks/inline-loader.js` 和 `landmarks/assets/*.inline.json` 由构建脚本嵌进 HTML，没有 fetch、GLTFLoader 或 CDN。
重新生成需要 Blender 5.0.1 的 Python 模块：`python landmarks/generate_landmarks.py`（会覆盖除华润以外的资产；华润只改过材质颜色）。来源和逐栋说明见 `landmarks/ASSET_NOTES.md` 与 `docs/验收报告.md`。

本轮用无头 Chrome 打开 `file://` 页面，并拦截一切非 file/data/blob 请求。验收截图在 `/opt/cursor/artifacts/yuehai-qa/final/`。腾讯滨海的正面和斜向是 `tencent-gap.png` 与 `tencent-gap-oblique.png`，城市环境是 `tencent-city.png`。上一轮侧向的 `close/tencent-binhai-32-a.png` 看起来像线框，不再作为验收画面。细节见 `docs/验收报告.md`。

```bash
node tests/landmarks.test.js
python tests/build.test.py
```

## GitHub Pages 部署（仓库原有说明，保留并按 v4 修订）

仓库保留 `.github/workflows/pages.yml`：推送到 `main` 时由 GitHub Actions 发布仓库根目录。
**本分支只开 PR，不推 `main`、不触发部署。** 合并与否由仓库所有者决定。

手动部署步骤（与原仓库 README 一致）：

1. 仓库 **Settings → Pages**，Source 选 **GitHub Actions**（或 Deploy from a branch → `main` / root）。
2. 等待约 1 分钟，访问 `https://<你的 GitHub 用户名>.github.io/<仓库名>/`。

与原仓库版本的区别：v4 起 Three.js r128 已内联进 `index.html`，页面**不再需要访问 `cdnjs.cloudflare.com`**。
`.nojekyll` 保留。

### 数据与版权（仓库原有说明）

- 城市数据：OpenStreetMap contributors，ODbL 1.0；页面内已包含 `© OpenStreetMap contributors` 链接。
- OSM 数据为展示用抽样，不是完整测绘成果；建筑高度、轮廓和地标锚点不应作为规划、报建或导航依据。
- 页面代码由项目作者提供；如要再分发，请保留 OpenStreetMap 署名。
