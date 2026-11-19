# OC Studio Web · Docker/GHCR 自动发布与 VPS 部署

> 适用分支：`web-dev`。Docker 不需要独立分支；`main` 的桌面代码保持不变。
> 当前为开发环境部署方案。正式对外提供服务前，请先完成多用户浏览器、备份恢复、安全和功能验收。

## 架构

```
GitHub web-dev push
  -> Web cloud verification (TypeScript / ESLint / tests / build / PostgreSQL HTTP)
  -> publish-docker (two OCI images)
  -> GHCR
       ghcr.io/strangeryuu/oc-studio-web:dev
       ghcr.io/strangeryuu/oc-studio-web-migrate:dev
  -> VPS update.sh or optional systemd timer
       PostgreSQL 16 volume + encrypted offsite backups (operator-managed)
       One-off Better Auth/business migration
       Next.js standalone web container + persistent MEDIA_ROOT
       Nginx/Caddy -> HTTPS -> 127.0.0.1:3000
```

镜像仅承载程序；每个世界观的内容保存在 PostgreSQL，私有图片保存在 `data/media`，更新/替换镜像时两处均保留。GHCR 是云端镜像仓库，负责存储版本；实际网页继续运行在你的 VPS。

## 一、发布分支与镜像版本

1. 将代码推送到 `web-dev`。仓库已有 `.github/workflows/web-cloud-check.yml`：只有 `web`、`postgres-schema` 和 `first-run-onboarding` 三个作业成功，才执行 `publish-docker`。每个测试通过的提交都发布独立 `sha-...` 镜像；仅当该提交仍为 `web-dev` 最新 HEAD 时才同步更新 `dev` 标签。
2. Actions 使用仓库的 `GITHUB_TOKEN` + `packages: write` 发布至 GitHub Container Registry；不需要把私人 Registry 令牌提交到仓库。
3. 先发布迁移镜像，再发布 Web 镜像。每个通过 CI 的提交都有可回溯的 `:sha-<提交前 12 位>`；如果该提交仍为最新 `web-dev` HEAD，再将两张镜像提升为浮动 `:dev`。在持续频繁推送代码时，`dev` 可能暂时落后于仓库最新提交，仍以最近成功提升的版本为准。当前只针对 `linux/amd64` 构建；ARM VPS 需要增加多架构构建。
4. 可从 GitHub 仓库 **Actions → Web cloud verification** 查看代码测试及 Docker 发布状态，也可在 **Packages** 查看 OCI 镜像。

GHCR 新建包通常默认 private，与 GitHub 源码仓库可见性独立。如果希望公开镜像，可在 Packages 的包设置中调整可见性；如继续 private，VPS 应使用只具备 `read:packages` 权限的 token 登录镜像仓库。不要将 token 写进 `.env` 或 Git。

## 二、首次 VPS 安装

先安装 Docker Engine 和 Docker Compose v2 插件，确认 `docker compose version` 正常。推荐 Ubuntu 24.04、x86_64 VPS。防火墙只允许 SSH 与 HTTP/HTTPS，保持 PostgreSQL 端口私有。

从仓库下载部署文件（这里的 Git 克隆仅用于取得部署脚本；后续**应用更新不需要在 VPS 再编译或 git pull**）：

```bash
git clone --branch web-dev --single-branch https://github.com/Strangeryuu/OC-Studio-web.git ocstudio-deploy-src
sudo mkdir -p /opt/ocstudio/data/media
sudo install -m 0644 ocstudio-deploy-src/deploy/compose.yaml /opt/ocstudio/compose.yaml
sudo install -m 0755 ocstudio-deploy-src/deploy/update.sh /opt/ocstudio/update.sh
sudo install -m 0755 ocstudio-deploy-src/deploy/backup.sh /opt/ocstudio/backup.sh
# 如需容器内 Sendmail 模式，按 docs/web-local-sendmail-relay.md 配置可选中继。
sudo cp ocstudio-deploy-src/deploy/.env.example /opt/ocstudio/.env
sudo chown -R 10001:10001 /opt/ocstudio/data/media
sudo chmod 700 /opt/ocstudio/data/media
sudo chmod 600 /opt/ocstudio/.env
```

编辑 `/opt/ocstudio/.env`，将示例密码替换为真实机密。注意：

- `APP_ORIGIN` 为访问者的 HTTPS Origin，例如 `https://studio.example.com`，没有末尾斜杠；Better Auth 会使用该值校验来源。
- `POSTGRES_PASSWORD` 使用随机 **URL-safe** 字符，例如 `openssl rand -hex 24` 的输出（该密码也嵌入 `DATABASE_URL`）；`BETTER_AUTH_SECRET` 独立生成，例如 `openssl rand -base64 48`。
- `IMAGE_TAG=dev` 代表跟随 `web-dev` 上最近通过所有 CI 的 Docker 镜像。若要固定稳定版本，改为 `sha-<前12位提交SHA>` 并关闭自动更新计时器。
- `HTTP_PORT` 供宿主机 Nginx/Caddy 反向代理，Docker Compose 仅绑定 `127.0.0.1`。
- `data/media` 必须由容器内 UID/GID 10001 拥有，保证上传图片能写入持久目录。

若 GHCR 两个镜像是 private，需要在 VPS 上**以运行 Docker 更新脚本的同一个系统账号**执行一次 `docker login ghcr.io -u Strangeryuu`，使用具备 `read:packages` 的 GitHub token 作为密码；注意 Docker 的凭据存储安全。若镜像公开，拉取通常无需登录。

首次部署（执行前确保对应镜像的 GitHub Actions 已成功）：

```bash
cd /opt/ocstudio
sudo ./update.sh
sudo docker compose --env-file .env -f compose.yaml ps
sudo docker compose --env-file .env -f compose.yaml logs --tail=100 web
```

更新脚本会拉取两张镜像，启动 PostgreSQL，执行 Better Auth 与业务迁移及数据库自检，然后启动 Web 并检查容器健康。**切勿在生产执行 `scripts/cloud-ci-seed-user.cjs` 或 `scripts/cloud-http-smoke.cjs`**：这些只供自动化测试。

Nginx/Caddy 将 `https://studio.example.com` 反向代理到 `http://127.0.0.1:3000`，请保留 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`。HTTPS 证书需要配置自动续期。可以参照 [web-vps-deployment.md](./web-vps-deployment.md) 中已有 Nginx 方案。

## 三、更新模式：手动或自动

**推荐先手动更新，跑通几次后在测试 VPS 启用自动更新。** 更新行为分开处理：

- GitHub：每次 `web-dev` push 先完整测试，成功后自动发布不可变 `:sha-...` OCI 镜像；当前分支 HEAD 通过验证后再发布 `:dev`。失败不发布；在新提交密集到来时，已通过验证的旧提交仍有 SHA 镜像可部署。
- VPS：运行 `sudo /opt/ocstudio/update.sh` 才会拉取最新镜像并部署。脚本有排他锁，已运行且健康的相同镜像会跳过重复部署；检测到更新后，先备份数据库/媒体，再执行迁移并启动新的 Web 容器，健康检查失败会报告错误。

在测试服务器可选择用 systemd 自动检测 Registry 的新镜像：

```bash
sudo install -m 0644 ocstudio-deploy-src/deploy/ocstudio-update.service /etc/systemd/system/
sudo install -m 0644 ocstudio-deploy-src/deploy/ocstudio-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ocstudio-update.timer
sudo systemctl list-timers ocstudio-update.timer
```

此定时器定期运行更新脚本，发现已通过 CI 的新 `:dev` 镜像才更新。无需把 VPS SSH 私钥提供给 GitHub，也不用开暴露在公网的部署 webhook。如果希望正式环境每次更新都人工审核，关闭 timer，并将 `IMAGE_TAG` 固定为已经验收的 SHA 标签。

部署脚本/Compose 文件自身有改动时，请手动从 GitHub 同步到 VPS；尤其要确保 `update.sh` 与 `backup.sh` 同步更新。自动更新的是已发布的**应用镜像**。

Web 镜像现在预装 `msmtp-mta`，提供 `/usr/sbin/sendmail`。需要使用 **本机 Sendmail** 模式时，遵循 [msmtp 中继配置步骤](./web-local-sendmail-relay.md)：将 `deploy/compose.mail.yaml` 安装到 `/opt/ocstudio/compose.mail.yaml`，并为非 root Web 用户准备专属的 SMTP 配置与授权码文件。新版 `update.sh` 会自动加载可选中继配置并验证文件权限。独立使用管理后台的 SMTP 模式时无需这套额外挂载。

## 四、数据保存、备份及升级注意事项

Compose 的 `postgres-data` 是持久命名卷，`data/media` 是宿主机私有媒体目录。二者都需要纳入离站备份。

更新脚本在执行迁移前调用 `backup.sh`，即使 Web 容器已经停止也会备份现存的 PostgreSQL 数据与私有媒体。备份保存在 `backups/UTC时间-PID/` 下，包含 `postgres.dump`、`media.tgz`、`SHA256SUMS` 和说明文件。脚本先检查 PostgreSQL 自定义归档可读取、媒体 tar 可解压、两份文件的 SHA-256 正确，随后原子发布这组备份；任一操作失败会中止升级并清理临时备份。可以单独执行：

```bash
sudo /opt/ocstudio/backup.sh
# 将下面路径替换为实际输出的备份目录
cd /opt/ocstudio/backups/UTC时间-PID
sha256sum -c SHA256SUMS
```

请定期将整个备份目录加密后复制到服务器外，安排保留期并在隔离测试实例恢复数据库和媒体。数据库与媒体备份采集存在时间间隔，正式业务强一致性快照请安排写入维护窗口。

重要：数据库迁移通常向前演进。回退到旧镜像时，仍应先检查数据库 schema 兼容性，必要时使用升级前备份在维护窗口恢复。脚本对健康检查失败会报错并保留备份，不自动回滚数据库。若使用 `IMAGE_TAG=sha-...` 做发布冻结，请分别确认 Web 和迁移镜像标签都存在。

**不要执行 `docker compose down -v`**，该命令会移除数据库数据卷。

## 五、上线前验收

1. 验证登录后才能读取任何资料库；两个世界观之间不可读取对方实体或私有图片。
2. 验证上传角色立绘、小说封面、地图底图，重启/更新容器后仍能读取。
3. 以 owner、editor、viewer 三个账号测试邀请、写入、删除与历史记录。
4. 用第二个世界观和第二位成员测试并发保存、重排和删除版本冲突。
5. 使用备份在独立测试环境恢复 PostgreSQL 与媒体目录，确认版本/图片一致。
6. 升级到新 `:dev`，核对 Nginx HTTPS 和所有核心板块；在生产设置监控和告警。
