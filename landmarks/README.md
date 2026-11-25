# 标名地标的 Blender 资产

- `assets/<id>.blend`：Blender 5.0.1 可编辑源。中国华润大厦沿用上一版，没有重新生成。
- `assets/*.glb`：Y-up 米制建筑组，不含外部图像。浏览器不读取 GLB。
- `assets/*.inline.json`：离线运行几何，格式 `yuehai-inline-mesh-v1`。
- `inline-loader.js`：Three.js r128 适配器，无 GLTFLoader、无网络请求。由 `scripts/build_page.py` 内联。
- `generate_landmarks.py`：本轮的可复现生成脚本。读取 `data/yuehai-osm.json`（可用环境变量 `YUEHAI_OSM` 改路径）。`ONLY=tencent-binhai` 只生成一栋。
- `generate_legacy.py`：上一版只生成腾讯滨海和华润的脚本，保留作对照，不要再用它覆盖新资产。
- `manifest.json`：每份资产的三角面、原点和高度。
- `ASSET_NOTES.md`：每栋建筑的来源、简化和近似说明。

相距超过约 450 米的同一地标会分成 `id-1`、`id-2` 两个文件，元数据 id 仍相同，拾取仍是同一地标。

运行映射只做一次：`position=(rawX*.058,.09,rawZ*.058)`，`scale=(.058,.112,.058)`。OBB 朝向已经烘焙进顶点，不要再旋转。

重新运行生成脚本会覆盖除华润以外的 `.blend` / `.glb` / `.inline.json`。手改 `.blend` 不会自动写回网页；网页只使用构建时内联的 JSON。

本目录不收录参考照片，也不使用第三方模型。
