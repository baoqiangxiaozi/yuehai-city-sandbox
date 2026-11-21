# 本包内的 Blender 地标

- `assets/tencent-binhai.blend`、`assets/china-resources.blend`：Blender 5.0.1 可编辑源模型。
- `assets/*.glb`：Y-up 米制的独立建筑组，不含外部纹理；浏览器运行不直接读取它们。
- `assets/*.inline.json`：与资产几何对应的离线运行数据。
- `inline-loader.js`：r128 适配器，无 GLTFLoader / 网络请求；由上级 build_page.py 内联。
- `manifest.json`：原始资产统计、原点与准确性边界。
- `generate_landmarks.py`、`source-buildings.json`：原生成脚本与原始三栋 OSM 轮廓快照。
- `ASSET_NOTES.md`：制作方完整交接档案，其中预览、独立测试脚本、报告路径不是本包文件索引。

本包未收录制作过程照片/第三方参考图，也未用它们作纹理；不包含制作方预览PNG或临时备份 .blend1。
设计方参考链接及造型边界见交接档案。所有门窗/构件为解释性外观精修，不是测绘/BIM。

运行映射：原点 raw X/Z 乘 .058、地坪 .09；比例(.058,.112,.058)只应用一次，勿再旋转已烘焙 OBB。

如从生成脚本重建，需要 Blender 5.0.1 或其 bpy 环境；脚本会覆盖 assets/ 内成品。
**手工编辑 .blend 后不要直接重跑生成脚本，否则会覆盖修改。** 现有脚本是程序化生成，不是任意已编辑 .blend 的自动导出器。
手改 .blend 不会自动更新 .glb/.inline.json，网页只读取构建时内联的 JSON。
若使用原生成脚本，输入路径缺失时会回退到同目录 source-buildings.json；也可设置 YUEHAI_BASE 指向原包。

上级 README 给出本次整合后的控制方式、明确限制和浏览器验收路线。
