# 流转

一个公开、自托管的文档转换工作台：

- PDF 转 DOCX，包括中英文印刷体扫描件 OCR
- DOC、DOCX 转 PDF
- JPG、JPEG、PNG 排序后合并为 PDF
- 单次最多 20 个文件、合计不超过 50 MB
- 单任务串行队列、取消任务、单独下载和 ZIP 下载
- 每个浏览器最多 5 个活动任务，每个 IP 每天最多提交 100 次
- 北京时间每天凌晨 3 点清理已结束任务与临时文件

## 部署架构

GitHub Pages 只托管静态前端，不能执行 LibreOffice 或 OCR。完整部署由两部分组成：

1. GitHub Pages：公开前端，由 GitHub Actions 自动构建。
2. Linux 云服务器：运行 Docker 转换后端和 Caddy HTTPS 反向代理。

前端通过 HTTPS API 与后端通信。任务下载地址带随机访问令牌，不使用登录或第三方 Cookie。

## 服务器部署

最低建议为 2 核 CPU、2 GB 内存、20 GB 磁盘。服务器需要安装 Docker 与 Docker Compose，并在云防火墙中开放 TCP 80 和 443。

没有域名时，可以通过 `sslip.io` 将公网 IP 变成可申请免费 HTTPS 证书的主机名。假设服务器公网 IP 是 `203.0.113.10`，主机名可写为：

```text
203-0-113-10.sslip.io
```

在项目目录创建 `.env`：

```env
TEAM_PASSWORD=unused-in-public-mode
SESSION_SECRET=至少32位的随机字符串
PUBLIC_HOST=203-0-113-10.sslip.io
PUBLIC_ORIGIN=https://你的GitHub用户名.github.io
```

若 GitHub Pages 使用自定义域名，`PUBLIC_ORIGIN` 应改为该完整来源地址。然后启动服务：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100
```

API 健康检查地址为 `https://PUBLIC_HOST/api/health`。Caddy 会自动申请并续期 HTTPS 证书，任务数据保存在 Docker 卷 `docuflow-data`。

## GitHub Pages 部署

仓库已包含 `.github/workflows/pages.yml`。推送前需要在 GitHub 仓库中完成两项设置：

1. 在 `Settings > Pages > Build and deployment` 中选择 `GitHub Actions`。
2. 在 `Settings > Secrets and variables > Actions > Variables` 中创建 `API_BASE_URL`，值为 `https://PUBLIC_HOST`。

推送到 `main` 分支后，工作流会运行测试、构建前端并发布 Pages。默认地址为：

```text
https://你的GitHub用户名.github.io/仓库名/
```

服务器的 `PUBLIC_ORIGIN` 必须与浏览器地址的来源一致。GitHub 项目页面的来源通常不包含仓库路径，例如 `https://用户名.github.io`。

## 本地开发

```bash
npm install
npm run dev
```

前端运行在 `http://localhost:5173`，API 运行在 `http://localhost:3000`。本地默认使用团队密码模式，密码为 `docuflow`。

测试公开模式：

```bash
PUBLIC_ACCESS=true npm start
```

Windows PowerShell：

```powershell
$env:PUBLIC_ACCESS='true'
npm.cmd start
```

## 验证

```bash
npm test
npm run build
```
