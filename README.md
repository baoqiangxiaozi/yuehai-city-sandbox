# 粤海：山海之间的科技城 · 3D 城市沙盘

一个可直接打开的**单文件 Three.js 网页**。建筑、路网、交通、天气、昼夜、地标卡片和世界控制面板都在 `index.html` 内，无需构建。

## GitHub Pages 部署

1. 在 GitHub 新建一个 **Public** 仓库，例如 `yuehai-3d`。
2. 把本目录的 `index.html`、`README.md` 和 `.nojekyll` 上传到仓库根目录。
3. 打开仓库 **Settings → Pages**。
4. **Build and deployment** 选择 **Deploy from a branch**，Branch 选 `main`，目录选 `/ (root)`，保存。
5. 等待约 1 分钟，访问：

```text
https://<你的 GitHub 用户名>.github.io/yuehai-3d/
```

页面本身还需要能访问 `cdnjs.cloudflare.com` 来加载 Three.js r128。GitHub Pages 是 HTTPS，CDN 也是 HTTPS，可直接使用。

## 用 Git 推送

```bash
cd github-pages
git init -b main
git add index.html README.md .nojekyll
git commit -m "Deploy Yuehai 3D city sandbox"
git remote add origin https://github.com/<你的用户名>/yuehai-3d.git
git push -u origin main
```

如果已安装 GitHub CLI：

```bash
gh repo create yuehai-3d --public --source=. --remote=origin --push
gh api --method POST repos/<你的用户名>/yuehai-3d/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

## 数据与版权

- 城市数据：OpenStreetMap contributors，ODbL 1.0。
- 页面内已包含 `© OpenStreetMap contributors` 链接。
- OSM 数据为展示用抽样，不是完整测绘成果；建筑高度、轮廓和地标锚点不应作为规划、报建或导航依据。
- 页面代码由项目作者提供；如要再分发，请保留 OpenStreetMap 署名。

## 本地预览

直接双击 `index.html` 即可；或在本目录启动静态服务器：

```bash
python -m http.server 8000
```

然后访问 <http://localhost:8000/>。
