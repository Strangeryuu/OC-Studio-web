# OC Studio 云端分支：本地启动与部署准备

本分支 `feat/cloud-workspaces-foundation` 属于 **Draft 开发版本**。已经编写账号登录、项目管理、邀请和实体历史 API；旧 Dexie 编辑器暂时关闭云端入口，防止不同账号在同一浏览器中读取同一个 IndexedDB。原始编辑器源代码保留在 Git 历史和功能模块中，待数据适配完成后再接入。

## 前置条件

- Node.js 22，PostgreSQL 16+，可用的 npm / psql。
- 本分支新增了 Better Auth 与 pg 依赖，**package-lock.json 尚未重新生成**。目前在隔离环境中无法访问 npm registry，也无法运行完整项目，因此首次使用需要在可联网的开发机器执行 `npm install`，把生成的 `package-lock.json` 提交到当前 PR，之后再使用 `npm ci`。
- 此 Draft 尚无生产级 VPS 编排、媒体存储或原编辑器的云端同步。完成验收后再对外开放。

## 本地初始化

1. 切到开发分支：`git switch feat/cloud-workspaces-foundation`
2. 运行 `npm install` 更新依赖及 lockfile。
3. 创建 PostgreSQL 数据库、专用低权限数据库账号，并配置连接。
4. 将 `cloud/env.sample` 中的值复制到根目录 `.env.local`。用 `openssl rand -base64 48` 生成随机 `BETTER_AUTH_SECRET`。生产站点要将 `BETTER_AUTH_URL` 改为 HTTPS 域名。
5. 按顺序创建认证表和业务表：

   ```bash
   npx auth@1.6.34 migrate --config ./src/lib/cloud/server/auth.ts --yes
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud/migrations/0001_workspaces.sql
   ```

   注意：`psql` 需要读到根目录 `.env.local` 中的同一个 `DATABASE_URL`；可在当前终端安全地设置环境变量。Better Auth 先创建 `"user"` 等基础表，之后业务迁移才能成功引用用户表。

6. 使用 Admin 插件的 CLI 创建第一位管理员（请在终端交互式输入密码，避免命令历史泄露）：

   ```bash
   npx auth@1.6.34 create-admin --config ./src/lib/cloud/server/auth.ts --email admin@example.com --name Admin
   ```

7. 执行自检，启动：

   ```bash
   npm run typecheck
   npm run test
   npm run build:web
   npm run dev
   ```

   打开 `http://localhost:3000/login`。当前登录页没有公开注册入口，Better Auth 的 email/password 注册端点也已关闭。

## 功能验收

- 未登录访问 `/` → 跳转 `/login`；登录后可以创建自己的世界观。
- 创建第二位用户：由管理员调用 Admin 插件的 create-user 接口，或后续增加管理 UI。注意：用户必须已有平台账号才能受邀。
- A 用户创建世界观；B 用户访问 A 的世界观 API → 404；A 创建 B 的邀请码，B 访问 `/join` 输入代码，之后可进入项目。
- Viewer 可查询世界观及历史，但无法修改实体；Editor 可创建和更新实体；Admin/Owner 可恢复历史或软删除实体。
- 创建实体、按 `expectedVersion` 更新，确认历史快照与操作日志存在；使用过期版本应返回 409。恢复旧版本应生成**新的**最新版本。
- 测试邀请码过期、账号不匹配、邀请码复用、账户封禁、跨项目越权、退出登录和 CSRF Origin 检查。
- PostgreSQL 数据、图片、Yjs 状态须各自纳入备份；目前图片和实时协作仍待开发。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET/POST | /api/workspaces | 查看/创建私人项目 |
| GET | /api/workspaces/:id | 读取项目 |
| GET | /api/workspaces/:id/members | 查看成员 |
| POST | /api/workspaces/:id/invitations | 发出一次性邀请码 |
| POST | /api/invitations/accept | 已登录受邀人接受邀请 |
| GET/POST | /api/workspaces/:id/entities | 列出/新建实体 |
| GET/PATCH/DELETE | /api/entities/:id | 读取、乐观锁修改、软删除 |
| GET | /api/entities/:id/revisions | 历史概要 |
| GET | /api/entities/:id/revisions/:version | 历史快照 |
| POST | /api/entities/:id/restore | 恢复旧版本并产生新版本 |

所有自定义写入 API 使用已验证的登录 Cookie 和同源 Origin。请通过 HTTPS 反向代理部署，并确认 `BETTER_AUTH_URL` 指向浏览器实际访问的域名。

## 目前的限制和下阶段

- Next.js 现在以 `standalone` 服务器模式构建。本 Fork 的云端开发分支暂时面向 Web，原项目桌面/Android 的静态导出流程保留在 main；后续独立构建或重构再支持。
- IndexedDB 旧项目数据尚未导入 PostgreSQL；本地已有角色/立绘暂时仍在原浏览器中，由原 `.ocbak` 导出后在云端迁移阶段处理。
- 云端图片服务、模板/关系图全量迁移、多人实时协作、用户管理 UI 与自动备份尚待开发。
- 本次 GitHub 提交仅表示文件已推送；**没有在 VPS 上部署，也没有在真实数据库和 npm 依赖环境里完成构建与端到端测试**。
