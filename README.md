# 粤海街道 3D 城市沙盘

一个无需构建步骤的静态网页，以 Three.js 展示深圳粤海街道的 3D 城市、道路交通、地铁、天气与昼夜变化。

## 在线体验

发布到 GitHub Pages 后，访问：<https://baoqiangxiaozi.github.io/yuehai-city-sandbox/>

## 本地预览

直接在浏览器打开 `index.html`。网页从 cdnjs 加载 Three.js r128，需要网络连接。

## 发布方式

推送到 `main` 分支后，GitHub Actions 会自动发布根目录到 GitHub Pages。仓库的 Pages 来源需设为 **GitHub Actions**。

## 数据与署名

地图数据来自 OpenStreetMap，经 Overpass Turbo 导出并按页面范围处理。页面内保留 OpenStreetMap contributors 署名和 ODbL 1.0 版权链接。部分未取得建筑轮廓的地标以近似位置示意。
