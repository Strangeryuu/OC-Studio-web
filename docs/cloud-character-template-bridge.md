# 角色编辑器云端适配：第一批字段与版面功能

此变更是完整恢复 OC Studio 角色编辑器的**第一批可测试功能**。适配时保留原版模块并复用纯数据定义，云端页面按 Workspace 单独读取配置。原版桌面应用使用 Dexie 和 Tauri vault 的功能模块仍保留在源码中，按优先级逐步接入云端。

## 目前支持

1. **原版角色基本信息字段目录**：来自 `src/lib/fields/defaults.ts`，默认包含别名、种族、元素、职业、阵营、国籍、身高、生日和主要角色开关。
2. **字段表管理**：每个世界观可更改字段显示名、顺序，隐藏/重新加入内置字段，创建文本型自定义字段；字段自定义值保存到角色实体 JSON 的 `custom` 里。
3. **原版角色模板顺序子集**：复用 `src/lib/templates/defaults.ts` 的 `character` 顺序，并开放封面、头像、基本信息、独立立绘集、文字标签、相册、简介、正文八个**已经接线的**组件；可调整顺序、启用/隐藏部分组件，正文始终显示。其他原版组件仍继续迁移。以前已保存的四组件配置会自动补齐新模块，新增模块默认隐藏，保留原有排序与开关状态；新建世界观使用八组件默认配置。
4. **富文本扩展**：在现有基础格式上加入有序列表、待办列表和表格操作；保留 1.8 秒自动保存、登录权限、版本冲突提示、完整历史快照和恢复。
5. **多人配置保护**：`workspace_settings` 中每套配置有自增 `version`。PUT 类更新必须携带 `expectedVersion`；服务端事务行锁、冲突 409、`audit_logs` 保存修改人及新旧内容。Owner/Admin 可以改设置，Editor/Viewer 可读取。
6. **数据保持**：隐藏一个字段只更改配置，不修改各角色的 JSON 内容；未知的原始角色字段保持不变，自定义字段使用严格键校验，保留此前未在配置中显示的值。

## 在界面如何使用

1. 登录并进入一个世界观。
2. 点击「角色模板与字段设置」进入 `/workspaces/<workspaceId>/settings/character`。
3. 调整组件顺序与开关；拖动排序暂由上移、下移按钮完成。
4. 字段可以重命名、移动、隐藏，或重新添加已隐藏的内置字段。
5. 在「新增自定义字段」中填写显示名及字段键，保存配置。
6. 返回世界观创建角色，或打开已有角色，刷新后可看到新字段与模板顺序；字段值依旧通过原来的云端实体 API 自动保存。

## 权限及接口

- `GET /api/workspaces/:workspaceId/character-config` — 成员查询，返回 `{ config, version }`；没有自定义设置时返回上游默认配置及 `version: 0`。
- `PATCH /api/workspaces/:workspaceId/character-config` — Owner/Admin 管理，输入 `{ expectedVersion, config }`，返回最新 `{ config, version }`。
- `GET` 及 `PATCH` 与所有私人世界观接口一样查询当前用户会话与当前成员资格。写入检查同源 Origin。
- `cloud/migrations/0002_workspace_settings_version.sql` 对已有数据库增加 `version` 列。运行 `node scripts/cloud-migrate-business.cjs` 会按版本执行未应用的迁移，并记录已执行版本。建议在执行前备份数据库。

## 待适配的原版角色编辑功能

- **完整模板组件**：关系图、原版全局标签库、角色动画、关联资料选择；当前封面、立绘、相册和文字标签已具备基础云端能力，图片裁剪、全局素材管理及原版交互仍待完善；
- **字段特化**：国籍与「国家」实体关联、生日三段式输入；
- **高级正文**：原版的 `@提及`、`[[内链]]`、图片块、更多工具栏及移动交互；
- **模板库**：新建/复制独立模板、正文预设、每篇笔记独立模板、完整拖放组件排序、模板参数；
- **其余内容与导入**：国家/事件/词条、关系和地图、旧 `.ocbak` 备份迁移。

这些功能可继续沿用上游组件与序列化逻辑；需先改造依赖 Dexie 数字 ID 和 Tauri 文件存储的部分，并在服务端保证跨项目权限和版本一致性。

## 验证入口

- `npm run typecheck`、`npm run build:web`、`npm run test`；
- `OC Studio Cloud Database CI` 运行 Better Auth 与业务迁移、重复执行测试、登录及模板创建 / 409 / CSRF smoke；
- `OC Studio Cloud CI` 运行类型、构建与完整单元测试。

所有改动均在 Fork 的 `feat/cloud-workspaces-foundation` 分支，PR #1 继续保留 Draft。

## 新增角色图片与标签（第二批）

- 封面、头像、立绘集、相册分别存储在角色 JSON 的 `headerMediaId`、`avatarMediaId`、`portraitMediaIds` 和 `galleryMediaIds`。图片用 `/api/workspaces/:id/media` 上传，由 `/api/media/:assetId` 做私有读取。立绘最多 24 张、相册最多 48 张；单张 8 MB，支持 JPEG、PNG、WebP、GIF。
- 图片可查看原图、排序和移除引用；历史快照保留旧图片 ID。服务器拒绝引用其他世界观图片的实体创建与更新，并验证 UUID、数量及重复项。
- 文字标签保存到 `cloudTags: string[]`（最多 30 个，每项不超过 40 字）；保留原版数字 ID `tags`，未来将接入统一的云端标签库。
- 原版已存在的 `headerUrl`、`avatars`、`gallery` 等字段会保留在旧 JSON 中，等待专门的文件迁移工具映射到云端媒体 ID。目前可通过界面上传新的云端素材。
- 上传之后约 1.8 秒自动保存图片引用与标签。新增素材在保存前临时存储在云端文件目录中，后续会提供孤立素材回收及存储配额管理。实际部署需要备份 PostgreSQL **以及** `media_data` 文件卷。

### Windows Docker 测试

在现有分支目录执行：

```powershell
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.local.yml --profile tools run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.local.yml up -d --build web
```

随后访问 `http://localhost:3000`，在世界观中创建角色，进入「角色模板与字段设置」启用需要的模块，返回角色编辑页使用封面、立绘、相册及标签。
