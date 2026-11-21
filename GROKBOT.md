# 粤海城市沙盘 — 修改说明

## 直接打开

- 成品：`index.html`（单文件，已内联 CSS、JS、OSM 数据和 Three.js r128）
- GitHub Pages 需要的隐藏文件：`.nojekyll`
- 构建后的页面**没有运行时 CDN 依赖**，可以脱机打开。Three.js 来自本包 `vendor/three.min.js`（r128），不是浏览时再去下载。

## 修改源码（推荐）

不要直接改成品 HTML；改以下源文件：

- `src/yuehai.js` — 场景、建筑、夜景、标签调度
- `src/yuehai.roam.js` — 独立自由漫游控制器（WASD / 拖动转向 / 退出恢复）
- `src/yuehai.lod.js` — 静态分块合批的普通楼近/中/远附加几何 LOD
- `src/yuehai.refined.js`、`landmarks/` — 两座 Blender 资产及日夜/环境接入，JSON与适配器内联
- `src/yuehai.css` — UI / 标签样式
- `src/yuehai.shell.html` — HTML 外壳与设置面板
- `data/yuehai-osm.json` — OSM 建筑/道路源数据
- `vendor/three.min.js` — 固定版本 Three.js r128
- `scripts/build_page.py` — 将上述文件组装为单文件 `index.html`

修改后重新构建：

```bash
python scripts/build_page.py
```

构建会覆盖根目录 `index.html`，并把 `vendor/three.min.js` 内联进去。需要 Python 3，构建脚本只用标准库。

Three.js r128 来源：`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`  
SHA256：`9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2`  
详见 `vendor/README.md`。不要换成其他版本。

若 Three.js 未能载入或 20 秒内没有完成启动，启动屏会显示中文错误，而不会一直停在「正在启动城市沙盘…」。

## 当前状态备注

- 深圳大学校园统一化已回退：`szu-campus` 被禁用，演会中心 2404 使用原版本。
- 全城住宅统一化已回退：`city-residential` 被禁用，住宅使用主站通用外观。
- 已建精模/准精模保留。
- 标签系统包含：
  - 一级/二级/三级标签；
  - 相机距离分档、最多 14 个；
  - 40% 屏幕重叠避让；
  - 悬停/点选强制显示；
  - 标签密度“精简 / 标准 / 全部”，存 `localStorage`。
- 标签密度请求写死在 `src/yuehai.js` 的 `LABEL_TIER1 / LABEL_TIER2` 名称清单中。
- 顶栏车流、均速、拥堵和路段悬停/路段卡已标明「模拟」；不要把这些数字当成真实路况。

## 验证

打开 `index.html`（可脱机），或本地启动：

```bash
python -m http.server 8000
```

访问 `http://127.0.0.1:8000/`。

## v3 / T-2 漫游

入口位于右侧世界控制面板的「镜头」区，按钮「进入第一人称 · 自由漫游」。
无 Pointer Lock 依赖，脱机拖动可用。WASD / 方向键移动，Shift 加速，R 复位，Esc 退出。
独立漫游 HUD 始终保留退出和返回总览；触屏提供方向键。固定视高和地图边界，**无建筑碰撞**。
详见根 README。`node tests/roam.test.js` 是纯逻辑/模拟 DOM 测试，不代表浏览器验收或实测性能。

## v4 / T-3 普通楼分层

普通楼细节为程序化示意。160米分块，250ms节流，近景180米进入/240米退出，
中景600米进入/720米退出；保留原基础体量/幕墙/窗灯，迁移原屋顶设备而不重复绘制。
新近景只加入口基座、既有窗灯面板细框、缺设备屋顶的小机箱格栅，不替换重点地标。
所有几何初始化缓存；远处隐藏细节，但缓存内存仍保留。
`__YUEHAI__.ordinaryLOD.stats()` / `debugChunks()` 可核对逻辑计数，不是实测FPS。
`node tests/lod.test.js` 覆盖LOD与通用几何；有v3路径时额外比较基础/窗灯/拾取映射不变。
漫游起点探针也检查暂时不可见的LOD细节，避免只看远景就把人放进后续出现的装饰里。

## 最终合并：腾讯滨海 / 华润 Blender 资产

两个旧专用 IIFE 已整个移除，不叠旧裙楼、连廊或塔体。保留通用楼跳过索引、地标ID、原卡片和拾取登记。
新模型位于 buildingsGroup，参与漫游起点检查；仍无逐帧碰撞。
夜景/反射用 `refinedLandmarks` 的统一策略，不能再依赖旧 cr/tencent 单材质变量（它们保留为null兼容守卫）。
场景材质遍历须跳过 `material.userData.blenderRefined` 以保留资产PBR。
`landmarks/assets/` 含可编辑 .blend/GLB 与实际运行的 inline JSON；改 .blend 不会自动同步网页。
`node tests/landmarks.test.js` 是 Node 几何与策略测试，最终 file:// / 漫游 / 窄屏 / 反射/夜景视觉必须浏览器验收。
