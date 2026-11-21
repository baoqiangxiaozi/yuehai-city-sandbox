# 粤海沙盘 · 首批 Blender 地标资产

此目录只包含独立资产及测试，不修改 `/workspace/yuehai-sandbox-v2` 或 `v3`。

## 定位 / 准确性边界

这是**依据建筑设计方公开资料的可编辑建筑级外观精修**，不是测绘、BIM、竣工模型或逐窗复刻。保留原沙盘建筑定位、OBB 朝向和总高；面板排布、构件截面、门窗及屋面设备位置是可调参数化表达。无室内、无碰撞体。

- 腾讯滨海大厦：直接读取数据中建筑 602（南塔 245.8m、50 层）、603（北塔 194.8m、38 层）；不把网络中的约 248m 强行覆盖进来。
- 华润大厦：读取建筑 423；原数据的 392.5m 不变，中心沿用原 JS 对轮廓点取平均的计算。外轮廓半径沿用原沙盘控制点，故不宣称重新校准了建筑宽度。
- 腾讯连廊层位：旧模型使用高塔高度的 .32/.55/.78 三个比例。这里依据 B+H 的中段 L21–25、上段 L35–38，以原南塔平均层高估算为 103.236–122.9m、172.06–186.808m；下段仅有“裙楼延伸”资料，L3–6 / 14.748–29.496m **为示意**。这是有依据的形态调整，不是精确标高。若验收要求保留原连廊标高，可在生成脚本的 `bridges` 参数里改回，不应移动整个建筑。

## 对比旧模型：真正新增 / 重构了什么

### 腾讯滨海大厦

旧模型已具有圆角双塔、长边竖鳍、三条外露桁架小桥、三层裙楼和入口；不是普通盒子。

本资产重建为独立 Blender 网格，重点是：

1. 基于幕墙顾问描述的重复倾斜外挑面板：六种 0.22–1.0m 深度组合，具有实际几何折面、金属边和局部遮阳唇；不是把旧 JS 网格导出。
2. 三条封闭玻璃连廊，带黄铜色门式外框、层带、竖梃、深色底板、屋顶采光体及花池体量；替代细窄外露三角桁架桥的表达。
3. 在南塔上段 / 北塔中段增加与实拍辨识特征对应的外围门式套框。
4. 塔端立面竖梃、可见屋顶百叶 / 设备屏、退让屋面、入口门架和三级台阶。
5. 独立的夜间窗光 / 连廊灯带网格，可由沙盘昼夜状态控制，不把夜景烘进照片。

**注意：**本资产没有照搬旧版包围双塔的大裙楼 / 下沉庭院。为避免漫游近看穿模，采用塔脚入口与最低连廊表达。整合时请替换整个旧腾讯专用组；不要再叠加旧桥与旧裙楼。若希望保留大裙楼，应单独做基座融合，不能两个模型直接重叠。

### 中国华润大厦（春笋）

旧模型已有旋转塔体、自定义玻璃着色器、48 条线式鳍片、16 根底部斜柱和技术环带。

本资产保持原半径控制点 / 总高，但重建为：

1. 56 根**有截面的几何外柱**，底部成对落到 28 个支点，上段从 56 根过渡到 28 根冠部构件。
2. 冠部可编辑的三角玻璃分片、收拢肋和斜向构件，替代仅靠曲面 / shader 暗示塔冠的方式。
3. 凹进式玻璃门厅、28 组细门框、近地台阶，避免旧圆筒基座把柱脚全部遮住。
4. 独立的楼层接缝、技术环带和夜间窗 / 塔冠 / 门厅灯带。

轮廓为原控制点之间的**分段线性插值**，不是原 JS CatmullRom 曲线逐点复制；不会引入未经证实的新建筑尺寸。近看仍是轻量外观模型，不是每个窗框的施工详图。

## 文件

`assets/<id>.blend`：真实 Blender 5.0.1 保存，可编辑，建筑语义对象按角色命名，材质共享；`STUDIO • not exported` 集合仅为摄影棚灯光 / 地面 / 相机。

`assets/<id>.glb`：单栋完整建筑组的 Y-up 米制轻量模型；无纹理、外部资源、Draco 或其他解码器依赖。

`assets/<id>.inline.json`：相同 Blender 网格的离线 BufferGeometry 数据，Float32 位置、规范化 Int8 法线、Uint16 / Uint32 索引。各字段以 little-endian 二进制 Base64 保存；这比展开长小数 JSON 小很多。法线有 8-bit 量化误差；顶点位置和三角形完全一致。JSON 可直接内嵌单文件 HTML，不需要 fetch。

`inline-loader.js`：Three.js r128 兼容，默认按材质批成 7 个绘制网格 / 每座（白天 6 个可见，夜间 7 个）。`mergeByMaterial:false` 可保留每个语义对象。GLB 保留语义节点，drawcall 数相应高于内联合批版。

`assets/*-overall.png` / `*-detail.png`：每座整体和局部预览；Cycles CPU 渲染，无第三方照片贴图。

`manifest.json`、`asset-test-results.json`、`inline-test-results.json`：统计、真实 .blend / GLB / 内联网格一致性、r128 构建 / 拾取 / 夜间开关测试结果。

`generate_landmarks.py`：完整生成脚本；`validate_assets.py`、`test_inline.cjs`：可复现检查。

## 比例 / 原点 / 坐标映射（不要重复缩放）

- Blender：米制，X = 原沙盘 raw X，Y = **负**原沙盘 raw Z，Z = 高度；每座原点在地面中心。
- GLB / 内联：米制，X = 原 raw X 相对中心，Y = 高度，Z = 原 raw Z 相对中心。glTF 的 Y-up 导出自动进行 `(Blender X, Blender Z, -Blender Y)` 转换。
- 没有额外整体旋转。腾讯两个塔的 OBB 朝向已经**烘在顶点里**，与现有 JS 的 `toWorld` / `rotation.y` 约定一致；不要再套 OBB 角度。
- `.blend` 若直接放入 Blender GIS：需要自行加回项目平面偏移；不可当成已带 WGS84 的地理文件。
- `.glb` 或内联网格放入 Three.js：

```js
root.position.set(originRaw[0] * .058, BUILD_Y /* .09 */, originRaw[1] * .058);
root.scale.set(.058, .112, .058); // 沙盘纵向夸张在这里施加一次
```

具体中心见 `manifest.json` 的 `originRaw`。GLB 里不含 `.058/.112` 缩放，不要假设已经是沙盘单位。

## 提供给源码整合 worker 的最小接法

推荐直接内联 JSON，避免引入 r128 GLTFLoader，也避免 `file:// fetch` 失败：

```js
// inline-loader.js 内容先于以下代码加载；JSON 是对象字面量，不是 URL。
const tencentAsset = YuehaiLandmarks.create(THREE, TENCENT_INLINE, {envMap:currentCityEnv, buildY:BUILD_Y});
const crAsset = YuehaiLandmarks.create(THREE, CR_INLINE, {envMap:currentCityEnv, buildY:BUILD_Y});
buildingsGroup.add(tencentAsset.group, crAsset.group);
tencentPickMeshes.push(...tencentAsset.pickMeshes);
crPickMeshes.push(...crAsset.pickMeshes);
```

1. 跳过 / 移除 `buildChinaResourcesTower` 和 `buildTencentSeafrontTowers` 旧自执行构建体，**保留**顶部 `CR_BUILDING_INDEX`、`CR_CENTER_RAW`、`TENCENT_BUILDING_INDICES`、地标登记及普通楼跳过规则。不应让 OSM 普通体块重新长回来。
2. 在 `markerPickables` 汇总前构建新资产，仍用 `customLandmarkId='china-resources' / 'tencent-binhai'`；原地标卡、标签、收藏 / 摄像机目标不必重建。
3. 将 `crTowerGroup = crAsset.group`；不要再给它原旧组的重复 position / scale。核对图层开关：腾讯旧组直接加 world，现在建议进入 buildingsGroup，随建筑图层一起开关。
4. 在原昼夜更新函数中调用：

```js
const p = state.layers.night ? Math.max(.0, Math.min(1, lightPower)) : 0;
tencentAsset.setNight(p);
crAsset.setNight(p);
```

5. 新材质不是原 `crTowerMaterial` 自定义 ShaderMaterial；原 shader uniform 更新分支可以留在空值保护里，但新夜景必须走 `setNight`。不要把旧 `tencentNightMaterial` 的单变量接口当成全资产的灯光开关。
6. 环境反射更换时遍历这两份 `asset.materials` 更新 `envMap` / `needsUpdate`，而不是只更新旧 `tencentGlassMaterial` 等变量。玻璃为不透明标准材质以避免排序问题；接入沙盘环境贴图后反射才与全城一致。
7. 拾取尽量只注册 envelope / lobby / bridge 等大网格，精细构件不必逐帧 raycast。默认合批只有 6 个白天网格/座，也可对大玻璃网格单独注册。`asset.pickMeshes` 所有可拾取网格都已带正确地标 id。
8. 这不是有碰撞的游戏地图。漫游需自由飞行或另设极简碰撞代理，不要拿所有幕墙小三角形做逐帧碰撞。
9. 单文件大小会增长，务必用 `index.html` 内嵌数据构建并断网 / file:// 实测。不得为减文件大小改回在线 CDN。

## 参考资料与版权

仅作造型依据，无第三方照片被作为贴图或打入 GLB / .blend；`references/` 中的下载照片为本地检查参考，**不纳入交付 zip**。

1. NBBJ 建筑设计方：腾讯滨海大厦，双塔错位 / 旋转、三条连桥、立面遮阳模块。
   https://www.nbbj.com/work/tencent-seafront-towers
2. B+H 项目参与方：50 / 39 层概述，Health Link L21–25、Knowledge Link L35–38。原数据北塔 38 层仍保留，不做暗改。
   https://bharchitects.com/en/project/tencent-seafront-towers/
3. Inhabit 幕墙顾问：立面交替倾斜、三对标准模块、向外最多约 1200mm；桥的主题与裙楼延伸。
   https://inhabitgroup.com/project/tencent-seafront-tower-shenzhen-prc/
4. Thornton Tomasetti 幕墙工程：15 种立面系统、锯齿形外挑单元；不同系统提到最多 1.5m，不与 1.2m 单系统描述混为一谈。
   https://www.thorntontomasetti.com/project/tencent-seafront-towers
5. KPF 设计方：春笋 56 柱汇成 28 柱、底部门廊、冠部三角玻璃、顶部 sky hall。
   https://www.kpf.com/project/china-resources-tower
   https://www.kpf.com/news/kpf-completes-landmark-office-tower-in-shenzhen

预览参考照片：NBBJ 项目页 Shao Feng 摄影、KPF 项目页图片；仅在本地 `references/` 中保留链接下载版本供复核，不表示获得再分发许可。

## 重建

```sh
uv venv .venv --python 3.11
uv pip install --python .venv/bin/python bpy==5.0.1
# 默认只读输入：/workspace/yuehai-sandbox-v2/data/yuehai-osm.json
.venv/bin/python generate_landmarks.py
.venv/bin/python validate_assets.py
node test_inline.cjs
```

亦可用 Blender 5.0.1：`blender -b --python generate_landmarks.py`。更换只读输入根目录可设 `YUEHAI_BASE`；如果该目录不存在，自动读取随包附带的 `source-buildings.json`（仅三座原始 OSM 轮廓快照，含版权标注）。没有 Blender GUI 依赖，渲染用 Cycles CPU；生成过程不会打开浏览器。

已验证项目见测试 JSON。本资产独立测试不等于已验证整合后的漫游、全城帧率或手机适配；最终浏览器 / 离线单文件验收由源码 worker 合并后完成。

## 本轮统计

| 建筑 | 三角形 | 建筑对象（不含摄影棚） | 材质 | GLB | 内联 JSON |
|---|---:|---:|---:|---:|---:|
| 腾讯滨海双塔 | 28,748 | 25 | 7 | 约 1.50 MiB | 约 1.32 MiB |
| 中国华润大厦 | 36,036 | 15 | 7 | 约 1.88 MiB | 约 1.65 MiB |

内联合批后每座 7 个 mesh，白天隐藏夜景批次仅 6 个可见绘制批次。

放置中心（raw 米）：腾讯 `[371.58649574693254, -605.0937312176508]`；华润 `[1525.1735294117648, 281.1411764705882]`。
