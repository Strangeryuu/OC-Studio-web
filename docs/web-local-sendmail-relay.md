# OC Studio Web · Docker 内置 Sendmail 客户端（msmtp-mta）

本功能适用于 `web-dev` 分支的 Web Docker 镜像。Web 镜像已安装 Debian `msmtp-mta`，提供 `/usr/sbin/sendmail` 兼容命令。程序以 UID 10001（`ocstudio`）运行，带 TLS 证书校验。

`msmtp` 是用于 SMTP 中继投递的轻量客户端：它会将邮件提交至指定 SMTP 服务商，**自身不负责维护收件箱、MX 邮件服务器或排队重试**。因此安装完成后还需指定 SMTP 中继账户。Web 管理后台的 **SMTP** 模式独立使用服务器端 SMTP 客户端；只有选择 **本机 Sendmail** 模式才使用本文件介绍的 `msmtp` 配置。

## VPS 首次启用（建议使用 465 TLS）

在仓库克隆目录（以下以 `ocstudio-deploy-src` 为例）执行：

```bash
# 只同步部署文件和配置样板。保留原来的生产 .env。
sudo install -m 0755 ocstudio-deploy-src/deploy/update.sh /opt/ocstudio/update.sh
sudo install -m 0644 ocstudio-deploy-src/deploy/compose.mail.yaml /opt/ocstudio/compose.mail.yaml
sudo install -d -o 10001 -g 10001 -m 0700 /opt/ocstudio/mail
sudo install -o 10001 -g 10001 -m 0600 \
  ocstudio-deploy-src/deploy/msmtprc.example /opt/ocstudio/mail/msmtprc
sudo install -o 10001 -g 10001 -m 0600 /dev/null /opt/ocstudio/mail/smtp-password
```

1. 使用 `sudo nano /opt/ocstudio/mail/msmtprc` 修改 `host`、`port`、`from` 和 `user`。与邮箱提供商的 SMTP 配置保持一致。**465** 端口使用 `tls_starttls off`；**587** 端口改成 `tls_starttls on`。
2. 使用 `sudo nano /opt/ocstudio/mail/smtp-password` 填入 SMTP **授权码或应用密码**（请勿提交到 Git、写进 Dockerfile 或粘贴至公开日志）。这份密码只在容器内被 `passwordeval` 读取。
3. 检查两份文件确实归 UID 10001 所有、权限为 `0600`。自带的 `update.sh` 会执行这项检查，权限错误将直接拒绝部署。
4. 确认 [Web cloud verification](https://github.com/Strangeryuu/OC-Studio-web/actions) 的最新 `web-dev` 镜像构建成功，再更新 VPS：

```bash
cd /opt/ocstudio
sudo ./update.sh

# 验证镜像中已有真实 sendmail 程序，且非 root 账号可读中继配置：
sudo docker compose --env-file .env -f compose.yaml -f compose.mail.yaml \
  exec -T web sh -c 'id -u; /usr/sbin/sendmail --version | head -n 1; test -r "$HOME/.msmtprc"; test -r "$HOME/.msmtp-password"'
```

返回 UID 为 `10001`，版本信息中包含 `msmtp`，且命令无错误，表示程序和配置挂载正常。之后登录站点管理员 `/admin/mail`，选择 **本机 Sendmail**，填写与 `msmtprc` 中一致的发件人邮箱，保存后点击 **发送测试邮件**。邮件只发送到当前管理员自己的账号邮箱。

### 配置变更、关闭中继

如果修改了 `msmtprc` 或密码文件，建议从容器重建以确保 bind-mount 文件被重新加载：

```bash
cd /opt/ocstudio
sudo docker compose --env-file .env -f compose.yaml -f compose.mail.yaml \
  up -d --force-recreate --no-deps web
```

如需停止使用本机模式，可在后台切换到 **SMTP**，并从 VPS 移走 `compose.mail.yaml`（请保存密码文件到安全位置或安全销毁），然后运行 `sudo ./update.sh`。该脚本在检测到镜像相同且健康时，也会让 Compose 检查配置变化并按需重建 Web 服务。

**重要：** 挂载邮件配置时，Web 容器内部的 `HOME` 是 `/home/ocstudio`。不要把配置文件放到公有静态目录，也不要设置世界可读权限。邮件密码位于 VPS 持久目录 `/opt/ocstudio/mail/smtp-password`，应纳入安全密钥备份，并在更换授权码后同步更新。

## 常见排障

| 现象 | 优先检查 |
| --- | --- |
| 后台显示已找到 Sendmail，但发送失败 | `/home/ocstudio/.msmtprc` 及密码文件是否挂载、可读取，是否设置 `account default` |
| `MAIL_LOCAL_SEND_FAILED` | `msmtprc` 主机/端口/TLS、授权码、服务商 SMTP 限制；容器到中继服务器的出站连接 |
| 服务器端口连接超时 | VPS 云平台对 465/587 出站端口的限制、DNS、云防火墙 |
| SMTP 账号验证失败 | 账号完整邮箱、是否开启 SMTP、专用授权码或应用密码 |
| 网页提示已提交但收件箱未收到 | 垃圾邮件、退信、服务商投递日志、域名信誉与 SPF/DKIM/DMARC |

若继续故障，可查看 `sudo docker compose --env-file .env -f compose.yaml -f compose.mail.yaml logs --tail=100 web`。请自行遮蔽 SMTP 凭据和重置链接，之后再分享排障日志。

**验收边界：** CI 可确认镜像含 sendmail 程序、非 root 用户、Compose 配置有效；实际外部投递还需使用你自己的服务商 SMTP 授权码在 VPS 上测试。
