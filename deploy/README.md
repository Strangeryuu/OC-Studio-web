# OC Studio Cloud · 单 VPS 部署草案

> 本部署目录面向 `feat/cloud-workspaces-foundation` 分支的 Web 云端版，保留原仓库 main 分支。当前代码仍属于 Draft，GitHub Actions 的依赖锁文件生成和类型/构建测试完成后，再投入真实用户使用。

## VPS 准备

推荐 Ubuntu 24.04、2–4 CPU、4–8 GB 内存、40 GB 以上 SSD；安装 Docker Engine 与 Docker Compose 插件。准备一个已解析至 VPS 公网 IP 的域名，开放 TCP 80/443。

1. `git clone https://github.com/Strangeryuu/OC-Studio-web.git`，`cd OC-Studio-web`，`git switch feat/cloud-workspaces-foundation`。
2. 确保 `package-lock.json` 已更新：在 GitHub Actions 选择 `Refresh cloud dependency lockfile`，对功能分支运行一次；或在联网的本地开发环境执行 `npm install --package-lock-only` 并提交。然后以 `npm ci` 验证。
3. 复制 `deploy/env.example` 为 `deploy/.env`，编辑：
   - `DOMAIN`、`BETTER_AUTH_URL` 为真实域名；
   - `BETTER_AUTH_SECRET` 使用 `openssl rand -base64 48` 生成；
   - `DB_PASSWORD` 是强随机密码；`DATABASE_URL` 中的密码保持一致。密码含 URL 保留字符时需进行百分号编码。
   - 文件应仅允许服务器运维账号读取，例如 `chmod 600 deploy/.env`。
4. 先启动数据库：

   ```bash
   docker compose --env-file deploy/.env -f deploy/compose.yml up -d db
   ```

5. 先执行 Better Auth 数据库迁移，再执行 OC Studio 业务数据库迁移。迁移容器会按顺序自动执行，业务迁移具有版本表和事务保护：

   ```bash
   docker compose --env-file deploy/.env -f deploy/compose.yml --profile tools run --rm migrate
   ```

6. 创建第一个站点管理员。管理员密码在终端中交互输入：

   ```bash
   docker compose --env-file deploy/.env -f deploy/compose.yml --profile tools run --rm migrate \
     ./node_modules/.bin/auth create-admin --config ./src/lib/cloud/server/auth.ts \
     --email your-admin@example.com --name Admin --role admin
   ```

7. 运行服务：

   ```bash
   docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build web proxy
   docker compose --env-file deploy/.env -f deploy/compose.yml ps
   ```

8. 访问 `https://你的域名/login`，使用管理员账号登录。顶部「用户管理」可创建普通用户和禁用/恢复账号。用户创建各自世界观后可在项目页邀请成员进行协作。

## 存储与安全

- PostgreSQL 数据存放在 Docker 命名卷 `db_data` 中。
- 原始立绘与图片存放在 `media_data` 中，由应用内的 `MEDIA_ROOT=/data/media` 对应。媒体 GET 请求每次按项目权限授权，历史版本保留旧素材 ID。
- Caddy 自动管理 HTTPS 证书，使用独立的持久卷 `caddy_data` / `caddy_config`。
- 数据库和 Web 容器运行在 Docker 内部网络；只有 Caddy 暴露公网 80/443。
- Caddy 将请求体限制为 9MB。当前单次图片上传限制为 8MB，格式为 JPEG、PNG、WebP 和 GIF。
- 上线前通过 `npm run typecheck`、`npm run test`、`npm run build:web` 和隔离账号的端到端验收。
- 备份必须**同时包含 PostgreSQL 数据库与 media_data 文件卷**。建议每日独立备份、加密传输到 VPS 以外的存储，并每月演练一次恢复。可先使用：

   ```bash
   mkdir -p backups
   docker compose --env-file deploy/.env -f deploy/compose.yml exec -T db \
     pg_dump -U ocstudio -d ocstudio -Fc > backups/ocstudio-$(date +%F).dump
   ```

  数据库备份还需配套媒体卷文件的独立增量备份。上述脚本只处理数据库。

## 当前实现范围

云端版已经编写登录保护、私人世界观、成员邀请/管理、简化角色编辑器、1.8 秒自动保存、版本冲突提示、完整 JSON 快照、历史正文预览、角色立绘上传和管理员账号界面。

原版高阶自定义模板、关系图、国家/事件编辑器、Yjs 实时双光标协同、旧 `.ocbak` 全量导入，以及综合备份工具仍在计划中。

**这些 Docker 配置目前已经写入仓库，但还需 GitHub Actions / VPS 环境中的实际构建、数据库迁移及安全测试。**
