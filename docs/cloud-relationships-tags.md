# OC Studio Cloud · 人物关系和共享标签（阶段三）

该阶段继续在 `feat/cloud-workspaces-foundation` 分支上适配原版编辑器。世界观隔离、登录、保存历史继续由 PostgreSQL 与权限 API 负责；原版数字 ID 与 Dexie 服务仍保留在源码中供后续迁移。

## 人物关系

在世界观角色编辑页启用「人物关系与关系图」组件后，可选择本世界观内的另一个角色，填写「表姐」「伙伴」等关系名并指定箭头：无方向、指向对方、指向自己、双向。同一角色对可保存多条关系，单角色最多 100 条。

- 当前角色保存到 JSON 的 `cloudRelations` 字段，元素为 `{id,targetId,relation,arrow}`，均采用 UUID。既有 `relatedCharacters` 数字关联字段保留。
- 页面显示其他角色指向当前角色的只读反向关系，提供 React Flow 关系图预览。
- 世界观首页新增「世界观人物关系图」入口，可在只读画布中看到同世界观的云端命名关系（首批限 300 个角色）。
- 编辑、移除关系通过原实体更新 API 保存完整快照，延续 409 冲突处理。
- 服务器在同一数据库事务中核验 UUID、目标角色 ID、自关联及其工作区归属；即使两个世界观属于同一个用户，也无法跨库引用。

目前图是**只读预览**。完整原版图谱的拖拽建边、节点布局保存、节点类型（事件/国家/词条）、边色板等交互继续适配。

## 世界观共享标签

- 新增 `workspace_tags` 表，标签由 UUID、名称和颜色组成。每个世界观独立，名称做大小写无关的唯一性约束。
- 在角色编辑页的「世界观共用标签」里创建、选择、取消和统一重命名标签。角色 JSON 使用 `cloudTagIds` 保存 UUID 数组，标签改名无需逐个修改角色。
- 原版的 `tags: number[]` 与上一批的 `cloudTags: string[]` 都保留。旧文字标签继续显示为历史标签，可以手动创建对应的共享标签。
- `GET/POST /api/workspaces/:workspaceId/tags` 列出/创建标签；`PATCH /api/workspaces/:workspaceId/tags/:tagId` 修改名称或颜色。
- API 根据会话与世界观成员权限授权。标签操作进入审计日志；角色引用标签时再次按世界观校验，避免跨项目混用。

目前暂未实现标签删除/合并和从旧 `.ocbak` 数字 ID 的批量导入映射。原版全局标签库的其他筛选视图还需要迁移。

## 升级与 Windows 测试

**升级已有数据前备份 PostgreSQL 和 `media_data`。**

```powershell
git switch feat/cloud-workspaces-foundation
git pull --ff-only

docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.local.yml --profile tools run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yml -f deploy/compose.local.yml up -d --build web
```

迁移 `cloud/migrations/0003_workspace_tags.sql` 新增共享标签表。已有八模块/四模块角色配置在读取时补入关系模块，并默认隐藏，保留原配置的顺序与开关。需要在「角色模板与字段设置」中打开「人物关系与关系图」后显示。

建议用两个独立世界观和两个角色验证关系及标签。GitHub Cloud CI 包含类型检查、构建及单元测试；数据库 CI 还使用真实 PostgreSQL 执行标签创建、改名、关系版本历史和跨项目关联拒绝。

## 待办

- 图谱完整编辑（拖动/连线、布局位置持久化、其他实体类型与颜色）
- 标签管理中心、合并/删除、全部实体的共享标签和筛选
- 原有 `.ocbak` 关系 ID 与标签 ID 转换
- 多人富文本实时协作和实时关系变更广播
