# OC Studio Web

> 基于 [OC Studio](https://github.com/Pokanshuu/OC-Studio) 的多用户 Web 改造版。保留原项目的原创角色（OC）与世界观创作体验，并为浏览器访问、独立资料库、协作权限、版本历史和 VPS 部署提供云端支持。

[![Web cloud verification](https://github.com/Strangeryuu/OC-Studio-web/actions/workflows/web-cloud-check.yml/badge.svg?branch=web-dev)](https://github.com/Strangeryuu/OC-Studio-web/actions/workflows/web-cloud-check.yml)
[![Branch](https://img.shields.io/badge/branch-web--dev-2563eb)](https://github.com/Strangeryuu/OC-Studio-web/tree/web-dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**当前定位：开发与测试版本。** `web-dev` 是云端改造分支；仓库的 `main` 保留原版桌面项目代码。主要工作台板块已接入云端，部分原版高级功能仍在移植和实际浏览器验收中。仓库 `package.json` 中的 `v0.20.5-beta` 沿用原项目版本号，不代表 Web 分支已正式发布稳定版。

[功能概览](#功能概览) · [Docker 部署](#docker-部署推荐) · [本地开发](#本地开发) · [版本与数据安全](#版本更新与数据安全) · [开发进度](docs/web-dev-progress.md) · [上游项目](https://github.com/Pokanshuu/OC-Studio)

---

## 项目简介

OC Studio Web 面向原创角色、小说设定与世界观资料管理，提供可通过 HTTPS 域名访问的创作工作台。你可以为不同故事创建独立世界观资料库，邀请其他账号参与编辑，并在浏览器中管理角色、国家、事件、地图、小说和相互关系。

本分支优先**复用原版组件、编辑器和数据结构**，在其上增加 Better Auth 账号系统、PostgreSQL 持久化、私有图片服务及 Docker 部署流程。现阶段的云端资料使用服务器存储；上游桌面版的本地文件夹 / IndexedDB 工作方式仍保留在原项目代码中。

### 与原版的主要区别

| | 上游 OC Studio | 本仓库 `web-dev` |
| --- | --- | --- |
| 主要运行方式 | 本地优先的桌面 / 移动端创作工具 | 浏览器访问、可自行部署在 VPS |
| 数据存储 | 本地笔记库及应用本地数据 | PostgreSQL + 服务器私有媒体目录 |
| 账号 | 本地使用 | Better Auth 邮箱密码登录；管理员创建账号 |
| 世界观组织 | 本地资料与创作模块 | 每个世界观拥有独立资料库和成员权限 |
| 协作 | 原版以本地创作为主 | 邀请协作、角色权限、版本冲突保护和修改历史 |
| 发布更新 | 应用安装包 / 本地构建 | GitHub Actions → GHCR → Docker Compose / VPS |

## 功能概览

以下功能已在云端工作台接入。**“已接入”表示功能入口及其主要数据流程已实现，具体交互成熟度以验收记录为准。**

| 模块 | 当前 Web 功能 |
| --- | --- |
| 🏠 主页 | 世界观概览、内容统计、最近更新、快捷入口及私有世界封面 |
| 👤 角色 | 资料字段、头像 / 封面 / 立绘 / 相册、富文本正文、标签与人物关系 |
| 🏳️ 国家 | 国家层级、旗帜、描述、角色归属及关联事件 |
| 📅 事件 | 时间、参与角色、相关国家、正文和事件关联 |
| 📖 世界观 | 多层级词条、富文本、关联引用、自定义分类 |
| ✍️ 小说 | 书架、章节树、拖拽排序、富文本写作、分页阅读、TXT / Markdown / Word 导出 |
| 📋 表格 | 角色、国家、事件、词条的树形总览和快捷编辑；安全删除及子项提升 |
| 🗺️ 地图 | 地图底图、国家 / 事件锚点、国界与道路、地图生成器、多视图、`.ocmap` 与 PNG 导出 |
| ⏳ 时间线 | 事件与相关角色 / 国家的时间信息展示、跳转和部分编辑 |
| 🕸️ 关系图 | 跨角色、国家、事件、词条的关系可视化与节点位置保存 |
| 🖼️ 全局相册 | 自动汇总私有图片，来源 / 标签筛选、全屏预览及移动端长按操作 |

### 云端增强功能

- **独立资料库**：按世界观隔离实体、媒体文件、标签和配置；支持成员邀请与管理。
- **权限控制**：所有者（`owner`）、管理员（`admin`）、编辑者（`editor`）、查看者（`viewer`）。服务端依据登录会话和资料库成员身份进行校验。
- **修改历史与回收站**：实体版本记录、并发版本检查、删除后恢复；小说支持章节整树删除与恢复。
- **模板与自定义分类**：管理分类、模板和组件启用状态 / 顺序，配置随资料库持久保存。
- **全局搜索**：在当前资料库内搜索角色、国家、事件、词条、小说章节和地图，支持多关键词。
- **`.ocbak` 备份与迁移**：导出含内容、私有图片、历史、标签与配置的备份；可导入到**空白资料库**。支持原版桌面 v1 归档及带云端扩展数据的归档。
- **私有媒体**：图片经登录权限校验访问，数据与其他资料库隔离。

> **功能边界：** 实时多人同屏协同编辑、部分高级视图 / 导出功能、桌面专属能力、AI 助手与插件的完整云端移植仍在计划或验收中。`.ocbak` 目前有体积与媒体格式限制，详见[高级功能验收说明](docs/web-advanced-acceptance.md)。

## 技术架构

```text
浏览器（HTTPS）
    │
    ▼
Nginx / Caddy 反向代理
    │
    ▼
Next.js 16 · React 19 · TypeScript
    ├── Better Auth（登录、账号管理）
    ├── 原版 OC Studio 工作台组件 / TipTap 编辑器
    ├── 资料库 API、权限与版本历史
    ├── PostgreSQL 16（业务数据）
    └── 私有媒体目录（图片文件）

GitHub web-dev → Actions 验证 → GHCR 镜像 → VPS Docker Compose
```

主要技术包括 Next.js、React、TypeScript、Tailwind CSS、TipTap、Better Auth、PostgreSQL、`@xyflow/react`；仓库同时保留原版 Dexie、Tauri 和 Capacitor 相关源码。

## Docker 部署（推荐）

推荐 **Ubuntu 24.04 + x86_64 VPS + Docker Engine / Compose v2 + HTTPS 域名**。当前 GHCR 镜像构建目标是 `linux/amd64`。

### 1. 获取部署文件

```bash
git clone --branch web-dev --single-branch \
  https://github.com/Strangeryuu/OC-Studio-web.git ocstudio-deploy-src

sudo mkdir -p /opt/ocstudio/data/media
sudo install -m 0644 ocstudio-deploy-src/deploy/compose.yaml /opt/ocstudio/compose.yaml
sudo install -m 0755 ocstudio-deploy-src/deploy/update.sh /opt/ocstudio/update.sh
sudo install -m 0755 ocstudio-deploy-src/deploy/backup.sh /opt/ocstudio/backup.sh
sudo cp ocstudio-deploy-src/deploy/.env.example /opt/ocstudio/.env
sudo chown -R 10001:10001 /opt/ocstudio/data/media
sudo chmod 700 /opt/ocstudio/data/media
sudo chmod 600 /opt/ocstudio/.env
```

### 2. 配置环境变量

编辑 `/opt/ocstudio/.env`，至少设置：

```dotenv
POSTGRES_USER=ocstudio
POSTGRES_DB=ocstudio
POSTGRES_PASSWORD=请替换为随机且URL安全的数据库密码
APP_ORIGIN=https://studio.example.com
BETTER_AUTH_SECRET=请替换为独立的随机密钥
IMAGE_TAG=dev
HTTP_PORT=3000
```

`APP_ORIGIN` 必须是用户实际访问的 **HTTPS Origin**，不要带结尾斜杠。使用强随机密码与密钥，严禁提交真实 `.env`、管理员密码或数据库备份。

`dev` 指向最近一次成功通过 CI 并发布的开发镜像；希望固定版本时，可换成 `sha-<Git提交前12位>`。

### 3. 拉取镜像并启动

GHCR 发布两个配套镜像：

- `ghcr.io/strangeryuu/oc-studio-web:dev`：Next.js Web 应用
- `ghcr.io/strangeryuu/oc-studio-web-migrate:dev`：Better Auth 与业务数据库迁移

如果包是私有的，先使用具备 `read:packages` 权限的 GitHub Token 以**执行部署的同一系统账号**登录 GHCR。

```bash
cd /opt/ocstudio
sudo ./update.sh
sudo docker compose --env-file .env -f compose.yaml ps
```

更新脚本会拉取镜像、启动 PostgreSQL、执行迁移、启动 Web，并检查服务健康状态。服务默认只在 VPS 的 `127.0.0.1:3000` 监听，请使用 Nginx 或 Caddy 配置 HTTPS 反向代理。

完成 HTTPS 配置后，访问 `https://studio.example.com/login`。**公开注册已关闭，站点没有默认管理员账号**；首次使用需要由部署者安全地初始化管理员，后续可在 `/admin/users` 管理普通账号。请勿在正式服务器运行用于 CI 的 `cloud-ci-seed-user.cjs`。

更完整的部署、GHCR 认证和自动更新说明：[Docker / VPS 部署指南](docs/web-docker-deployment.md)。

## 版本更新与数据安全

此分支的 GitHub Actions 会依次执行 TypeScript、ESLint、单元测试、项目自检、Next.js 生产构建以及独立 PostgreSQL 16 迁移与 HTTP 测试。全部通过后，才构建并发布 Docker 镜像：

- `sha-xxxxxxxxxxxx`：与具体提交对应的可追溯镜像。
- `dev`：当前 `web-dev` 最新通过验证后提升的浮动标签。

VPS 可以手动执行 `sudo /opt/ocstudio/update.sh` 更新，或在**测试环境**配置 `deploy/ocstudio-update.timer` 定期检查。生产环境建议固定 SHA 标签，并在升级前备份。

数据与镜像分开保存：

| 数据 | 存储位置 |
| --- | --- |
| 角色、世界观、账户、版本历史等 | PostgreSQL 16 的 `postgres-data` 持久卷 |
| 头像、立绘、地图及其他私有图片 | VPS `/opt/ocstudio/data/media`（按部署示例） |
| 代码及 Web 运行环境 | GHCR Docker 镜像 |

**请同时备份数据库与媒体目录，并定期在独立环境验证恢复。** `.ocbak` 主要用于资料库便携迁移，无法替代完整 VPS 灾备。更新脚本每次实际执行数据库迁移前，都会通过 `backup.sh` 创建一组经过 PostgreSQL 归档检查及 SHA-256 校验的数据库/媒体备份（即使原 Web 容器已停止）。也可手动运行 `sudo /opt/ocstudio/backup.sh`。仍需部署者安排加密异地备份和真实恢复演练。

## 本地开发

环境：**Node.js 24、npm、PostgreSQL 16+**。

```bash
git clone --branch web-dev https://github.com/Strangeryuu/OC-Studio-web.git
cd OC-Studio-web
npm ci
cp cloud/env.sample .env.local
```

将 `.env.local` 的 `DATABASE_URL`、`BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`MEDIA_ROOT` 改成自己的开发环境配置。启动前初始化数据库：

```bash
npx --no-install auth migrate --yes --config ./src/lib/cloud/server/auth.ts
node scripts/cloud-migrate-business.cjs
node scripts/cloud-db-smoke.cjs
npm run dev
```

打开 `http://localhost:3000`。公开注册同样默认关闭；开发数据库需要预先建立合法账号。

开发自检：

```bash
npm run check      # TypeScript、ESLint、Vitest、项目自检
npm run build:web  # Next.js 生产构建
```

完整的自动验证与 CI 发布规则位于 [`.github/workflows/web-cloud-check.yml`](.github/workflows/web-cloud-check.yml)。

## 当前状态与开发计划

主要云端工作台板块和数据流程已接入，并已有自动化测试覆盖。当前仍属于**持续开发阶段**，上线前建议重点验收：

1. 实际浏览器中的地图绘制、章节拖拽、复杂模板、移动端相册及图片上传下载。
2. 多账号同时编辑的版本冲突、权限隔离与草稿恢复。
3. 大型桌面归档、SVG / 视频等扩展媒体及未移植的桌面附加功能。
4. PostgreSQL + 私有媒体的配套备份恢复、HTTPS 配置与服务器安全。
5. 实时协同、AI 助手、原版插件、部分高级导出与桌面特有功能的后续移植。

开发记录与验收依据：

- [Web 移植开发进度](docs/web-dev-progress.md)
- [高级功能验收清单](docs/web-advanced-acceptance.md)
- [Docker / GHCR / VPS 部署](docs/web-docker-deployment.md)
- [非 Docker 的 VPS 部署](docs/web-vps-deployment.md)
- [GitHub Actions 构建记录](https://github.com/Strangeryuu/OC-Studio-web/actions/workflows/web-cloud-check.yml)

## 上游项目、贡献与许可

本项目基于 [Pokanshuu/OC-Studio](https://github.com/Pokanshuu/OC-Studio) 改造，原版的角色、世界观、地图、小说、模板及其他组件和设计归其原作者与贡献者所有。感谢上游开发者 [Pokanshuu](https://github.com/Pokanshuu)、[nekibud](https://github.com/nekibud)、[AyaoUwU](https://github.com/AyaoUwU) 等人的贡献。

本 Fork 的 `web-dev` 分支主要用于网页化和云端功能开发；如需上游原版桌面功能或安装包，请访问[上游仓库与 Releases](https://github.com/Pokanshuu/OC-Studio/releases)。

本仓库遵循 [MIT License](LICENSE)，使用和再分发时请保留原有版权和许可证声明。