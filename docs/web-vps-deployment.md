# OC Studio Web · VPS 部署检查清单（开发版）

> 适用分支：`Strangeryuu/OC-Studio-web` 的 `web-dev`。此文档与上游原版桌面 README 分开维护。
> 目前云端地图、资料库和历史 API 已通过自动化检查；真实浏览器多成员联调、媒体恢复与 VPS 安全验收仍在进行中。建议先部署到**独立测试环境**，保存演示数据。

## 1. 环境与入口

- Ubuntu 24.04 或类似 Linux 服务器；Node.js **24**、npm、PostgreSQL **16+**、Nginx（或等价的 HTTPS 反向代理）。
- VPS 应使用 HTTPS 域名，`BETTER_AUTH_URL` 必须等于用户实际访问的**完整公网 Origin**，例如 `https://studio.example.com`。
- 通过 `https://studio.example.com/studio/<资料库 UUID>` 访问独立资料库。应用内部根据账号会话和数据库成员权限执行访问控制。
- PostgreSQL 端口仅供应用及管理员内网访问；Node 服务绑定本机环回地址；所有公网流量先经过 HTTPS 代理。

## 2. 下载与最小权限目录

```bash
sudo useradd --system --create-home --home-dir /var/lib/ocstudio --shell /usr/sbin/nologin ocstudio
sudo install -d -o ocstudio -g ocstudio -m 0700 /var/lib/ocstudio/media
sudo install -d -o root -g ocstudio -m 0750 /etc/ocstudio
sudo install -d -o ocstudio -g ocstudio -m 0750 /srv/ocstudio
sudo -u ocstudio git clone https://github.com/Strangeryuu/OC-Studio-web.git /srv/ocstudio/app
cd /srv/ocstudio/app
sudo -u ocstudio git switch web-dev
```

部署前核对 `git rev-parse HEAD` 与 `docs/web-dev-progress.md`。新部署建议固定已通过 CI 的提交；更新时先备份再切换代码。

## 3. 机密配置

使用仅服务账号能读的 `/etc/ocstudio/web.env`，并设置 `0640 root:ocstudio`。示例：

```dotenv
DATABASE_URL='postgresql://ocstudio:REPLACE_ME@127.0.0.1:5432/ocstudio'
BETTER_AUTH_URL=https://studio.example.com
BETTER_AUTH_SECRET=REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
MEDIA_ROOT=/var/lib/ocstudio/media
PORT=3000
HOSTNAME=127.0.0.1
```

生成应用密钥可使用 `openssl rand -base64 48`，将生成结果妥善保存。密码、密钥、数据库备份与媒体目录均应排除在 Git 仓库和公开 Web 根目录之外。生产数据库使用单独的低权限应用账号。

## 4. 初始化数据库、迁移与构建

创建专用 PostgreSQL 16 数据库与应用账号，授予业务迁移所需的 schema 权限。首次建库需先运行 Better Auth 迁移，再运行项目自己的业务迁移。后续更新仍按这一顺序执行：

```bash
# 数据库迁移、构建与产物归属统一使用应用服务账号
sudo -u ocstudio bash <<'SH'
set -eu
cd /srv/ocstudio/app
set -a
. /etc/ocstudio/web.env
set +a

npm ci
npx --no-install auth migrate --yes --config ./src/lib/cloud/server/auth.ts
node scripts/cloud-migrate-business.cjs
node scripts/cloud-db-smoke.cjs
npm run build:web

# Next.js standalone 需要同时提供 public 与静态资源
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -a .next/static .next/standalone/.next/static
if [ -d public ]; then
  rm -rf .next/standalone/public
  cp -a public .next/standalone/public
fi
SH
```

上面迁移命令与数据库结构检查已在 GitHub Actions 的 PostgreSQL 16 环境使用。请使用可用于迁移的受控账户执行，不要以数据库超级用户运行长期应用。所有迁移前应准备快照与回滚方案。

**不要在生产环境运行** `scripts/cloud-ci-seed-user.cjs` 或 `scripts/cloud-http-smoke.cjs`：前者只为 CI 专用数据库准备固定测试账号，后者会新建测试资料库及数据。

## 5. systemd 运行（示例）

`/etc/systemd/system/ocstudio-web.service`：

```ini
[Unit]
Description=OC Studio Web (development deployment)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=ocstudio
Group=ocstudio
WorkingDirectory=/srv/ocstudio/app
EnvironmentFile=/etc/ocstudio/web.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /srv/ocstudio/app/.next/standalone/server.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

根据实际 Node 安装路径调整 `ExecStart`，随后执行 `sudo systemctl daemon-reload`、`sudo systemctl enable --now ocstudio-web`。使用 `journalctl -u ocstudio-web` 检查启动日志与运行错误。

## 6. HTTPS 反向代理

Nginx 核心配置示例（证书请使用受信任的 CA，HTTPS 开通完成后启用）：

```nginx
server {
    listen 443 ssl;
    server_name studio.example.com;

    ssl_certificate /etc/letsencrypt/live/studio.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/studio.example.com/privkey.pem;
    client_max_body_size 10m;  # 当前私有媒体接口单图限制 8 MiB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

再设置 HTTP → HTTPS 跳转、证书自动续期与基本安全响应头。对上传和认证接口采用合理的流量限制，并评估服务器防火墙、监控与日志脱敏。

## 7. 部署验收

1. 未登录访问 `/studio` 应跳转登录；未登录访问私有 API 应被拒绝。
2. 以所有者登录，建立两个世界观资料库，确认各自角色、国家、事件、词条、地图以及图片均独立。
3. 邀请编辑者和浏览者，核对新增、保存、删除、恢复、版本冲突、媒体读取权限。
4. 在真实浏览器验证地图拖动锚点、右键颜色、国界/道路、六档生成视图、`.ocmap` 与 PNG 导出。
5. 检查 PostgreSQL 与媒体目录备份/恢复、数据迁移幂等、升级回退、跨设备会话和并发写入。
6. 对照 GitHub Actions 中 `Web cloud verification` 的 Web 作业和独立 PostgreSQL 作业，再决定是否供正式数据使用。

## 8. 备份与恢复

业务数据分布在**PostgreSQL** 与 `MEDIA_ROOT` 私有媒体目录，二者必须一起备份：

```bash
# 示意；使用具备备份权限的账号在维护窗口执行，输出到受保护路径
pg_dump --format=custom --file=/secure-backups/ocstudio-YYYYMMDD.dump ocstudio
tar -C /var/lib/ocstudio -czf /secure-backups/ocstudio-media-YYYYMMDD.tgz media
```

备份应加密并定期验证可恢复性。升级前保留完整数据库与媒体目录快照。还原时先恢复数据库与媒体文件，再启动对应版本的应用；务必在隔离环境演练，以防出现历史版本引用的图片缺失。
