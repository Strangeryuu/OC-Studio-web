# OC Studio Web — 云端协作版实施方案（阶段 0）

> 本目录用于用户自己的 Fork：`Strangeryuu/OC-Studio-web`。目标是「登录后使用、个人世界观、按项目邀请协作、多设备同步、完整修改历史」。本次提交为**基础设施与纯业务逻辑准备**，尚未接通登录、数据库或 UI。暂不可作为私有云服务直接部署。
>
> 保持上游桌面/Android 构建安全：本阶段**不修改**原有 `next.config.ts`、`src/lib/db.ts`、`src/lib/vault/` 与原应用页面。原有默认构建继续使用静态导出。

## 技术方案

- Next.js 16 / React 19：复用原始编辑器、角色、关系图、地图等 UI。
- Better Auth：邮件密码登录，管理员创建账号，关闭自由注册。具体适配器和数据库表须与锁定版本一致。
- PostgreSQL + Drizzle：项目、角色、成员、邀请、审计及历史，数据在 VPS。
- Tiptap + Yjs + Hocuspocus：长文本协同编辑，后续阶段接入。
- 私有文件存储：图片通过已认证、已授权的服务端上传/下载接口处理。
- IndexedDB：仅作为用户/项目隔离的缓存和待同步草稿；退出/切换账号清理敏感缓存。
- Docker Compose + Caddy：单 VPS 部署；数据库不暴露公网。

## 分阶段实施与验收

1. **阶段 0（本提交）**：版本控制分支、项目权限纯函数、版本冲突纯函数、PostgreSQL 初始业务 Schema、单测；不接生产入口。
2. **阶段 1：认证与服务器构建**：安装/锁定 Better Auth、Drizzle 和 PostgreSQL 客户端；先执行 Auth 表迁移再执行 `cloud/migrations/0001_workspaces.sql`；为 Web Server 添加有条件的 Next standalone 构建、登录页、Server-side Session 校验、路由与 API 权限保护。逐步以自动化测试验证未登录访问。桌面版保留静态导出，Web Server 仅通过显式构建开关启用。
3. **阶段 2：云端存储**：项目列表；账号独立工作区；云端实体、字段模板、关系图、地图、图片持久化；前端 `cloud-adapter`。旧 Dexie 数字主键需要可复现的 UUID 映射；`.ocbak` 导入应通过用户授权与事务执行。
4. **阶段 3：邀请协作**：邀请码仅存哈希、过期/撤销/单次使用；成员增删改、操作审计；角色权限每个请求即时查库。WebSocket 连接和每次修改同样验证权限。
5. **阶段 4：修改历史**：保存完整 JSON 快照、字段变更事件、操作者 ID。所有实体修改与 revisions 写入同一数据库事务；CAS (id + workspace_id + version)；版本冲突 HTTP 409；恢复通过写入**新版本**。媒体文件在历史版本仍被引用时继续保留。
6. **阶段 5：实时正文协同与部署**：Yjs/Hocuspocus、断线重连与持久化、快照和归因、异地备份、回滚演练、压力测试。

## 数据库与权限约束

- Better Auth 的 `"user"` 表由对应认证迁移负责。本阶段 SQL **不能直接在空数据库执行**，应在 Auth 表创建后使用迁移工具执行。
- Workspace Owner / Admin / Editor / Viewer 为独立的项目角色。站点管理员仅管理平台；查看其他用户内容需单独项目授权。
- 当前的 `src/lib/cloud/permissions.ts` 为纯策略，角色必须来自可信数据库会话。所有对象都需校验 workspace 归属；**不能根据客户端传入的 role/actorId 授权**。
- `src/lib/cloud/versioning.ts` 仅负责生成更新计划。实际写入必须执行事务内的条件更新：`UPDATE entities ... WHERE id=? AND workspace_id=? AND version=?`，确认受影响行数为 1 后插入快照与变更事件；请求重复提交使用 `client_mutation_id` 去重。旧版本冲突返回 409，不静默覆盖。
- Owner 变更在事务内同步修改 `workspaces.owner_id` 和 `workspace_members`。必须有且只有一位 Owner；最后一位 Owner 不允许被移除。
- `entity_revisions` 是用户内容历史，默认保留；项目永久删除必须经过明确权限与二次确认，并由运营策略决定备份保留期。
- `media_assets.storage_key` 映射 VPS 私有目录，禁止将原始路径直接传入文件读写接口。
- 后续协作正文可记录按用户归因的 CRDT updates；由 Yjs 状态生成的历史版本需可实际恢复并供编辑器正确加载。

## 安全上线清单

- [ ] 服务端登录校验与受保护路由完成
- [ ] 数据库迁移 / 首位平台管理员初始化完成
- [ ] API / 图片 / 导出 / WebSocket 全部按项目授权
- [ ] 关闭公开注册、开启登录速率限制、HttpOnly + Secure Cookie
- [ ] 多人冲突、恶意请求、跨项目越权测试通过
- [ ] 多设备同步与修改历史恢复测试通过
- [ ] PostgreSQL + 图片 + Yjs 持久化异地备份且演练恢复
- [ ] Docker Compose + HTTPS + 数据库内网隔离完成

## 基础代码自检

```bash
npm ci
npx vitest run tests/cloud-permissions.test.ts tests/cloud-versioning.test.ts
npm run typecheck
```

> 本阶段未进行 VPS 生产部署，创建了技术基础和测试。后续按阶段通过 Pull Request 合入 Fork 的 main，便于逐步复核，也方便追踪原项目上游更新。
