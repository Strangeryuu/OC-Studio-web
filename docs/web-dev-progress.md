# Web 版移植进度

`web-dev` 从原项目的 `main` 创建。原版主界面保留在 `src/app/(original)/studio/OriginalHome.tsx`，原有角色、事件、世界观、地图、模板、素材和 Dexie 服务等代码保留。旧云端分支中的认证、授权、邀请、实体与历史、图片服务及其数据库迁移已移植；旧分支的独立角色编辑器没有接入本分支。

## 当前状态

- 有登录、管理员账号管理、资料库创建与成员邀请管理的代码；实体、历史、图片接口沿用旧分支实现。
- `0004_original_ids.sql` 给云端实体分配稳定的数字 ID；`legacy-entities` 接口按资料库权限分页读取完整实体与删除状态，用于后续适配原版组件。
- 新增原版角色云端适配器，复用原版角色数据结构和默认值，支持按资料库列出、创建、基于快照版本保存以及删除。保存时保留未修改的原版字段；发生版本冲突时返回错误，不覆盖已有版本。实体写入会核对所属资料库。
- 已用 PGlite（嵌入式 PostgreSQL）执行认证与业务迁移，并通过临时 PostgreSQL 协议连接、真实 Better Auth 会话和 HTTP 请求验证登录、资料库隔离、邀请、访客权限、角色保存、冲突及历史。原版表单另外做了 React 组件测试；独立 PostgreSQL 与完整浏览器联调仍待完成。
- 资料库页已接入原版角色基本信息组件、表单状态和自动保存流水线，可新建角色并编辑姓名、别名、种族、元素、职业、阵营、身高、生日、主要角色与简介，并查看角色修改历史。访客只读；角色切换和退出登录前会等待未完成的保存。版本冲突会保留当前页面中的草稿并提供复制入口。
- 角色正文接入原版 TipTap 编辑器和版本保存流程；可通过上传按钮添加正文图片，服务端校验图片属于当前资料库。图片粘贴和关联建议仍待接入；已有图片引用保留，访客正文只读。
- 角色头像、封面、立绘与相册复用原版图片组件，图片通过资料库的私有媒体接口保存和读取；图片编辑会保留已有说明和立绘类型。
- 角色之间的关系复用原版选择器、关系编辑和反向关系展示，并使用同一资料库的云端角色作为候选；服务端校验新增关系的目标和资料库，关系修改纳入版本历史。角色也可关联笔记，笔记页显示来自角色的反向关系。模板仍待接入。
- 国家已接入原版表单、富文本正文、旗帜、封面和相册，支持新建、编辑和查看版本历史。角色可用原版选择器设定、更换或清空国籍，国家页按角色保存的国籍反查相关角色。国家页可查看关联事件。地图锚点已在独立地图视图中接入；国家侧批量调整成员与删除界面仍待迁移。
- 事件已接入原版表单、日期、正文、封面、相册和关系组件。参与角色、相关国家和关联事件从当前资料库选择，修改纳入版本历史。原版时间线已接入云端事件、角色出生和国家时间节点，支持筛选、跳转和桌面端拖动修改事件日期。时期管理和时间线导出仍待迁移。
- 世界观笔记已接入原版目录树样式、搜索、词条层级、富文本正文、相册和关系组件。支持建立子笔记、更换父词条、版本历史、笔记间及角色到笔记的关联。`@` 和 `[[` 的正文补全读取当前资料库。小说、自定义分类管理、目录拖拽排序和笔记删除界面仍待迁移；地图笔记已由独立云端地图视图管理。
- 云端工作台入口为 `/studio/<资料库 ID>`，旧资料库地址会转到新入口。只有一个资料库时，`/studio` 直接打开它，有多个时回到资料库列表供选择。工作台沿用原版导航分组，角色、事件、国家、世界观笔记、地图、时间线、关系图与成员管理分区显示。切换分区或返回资料库列表前会先保存当前草稿。
- 原版关系图已接入云端工作台，显示当前资料库的角色、国家、事件及普通笔记，包含命名关系、归属/参与和正文引用。支持定位、筛选、聚焦、打开条目，桌面端编辑者可拖动节点并把位置存入版本历史。图上建边、批量重排和图片导出仍待迁移。
- 原版地图画布、地图切换器、生成面板、档案和图片导出已接入独立云端地图板块；底图与生成视图由私有媒体服务保存，关联的锚点、标注和地图管理写入版本历史。完整浏览器验收与剩余原版菜单交互待完成。
- 账号登录、数据库迁移、资料库隔离、邀请码和版本恢复仍需在实际 PostgreSQL 环境做端到端测试。当前版本仅供开发，不用于生产部署或保存正式数据。

## 接下来的移植工作

1. 继续接入原版 Dexie 缓存，明确数值 ID、外键与旧数据导入的映射；切换用户和资料库时隔离缓存。排序、文件夹、引用更新等直接写 Dexie 的路径也需要统一接入。
2. 把原版创建、编辑、删除、引用和模板等写入接到服务端事务；处理并发版本冲突，并记录可恢复历史。
3. 继续迁移其他附件、项目设置和模板；补齐地图导出叠加层、右键菜单及媒体垃圾回收，保证媒体与历史版本的引用一致。
4. 在原版界面提供资料库选择、成员、历史与冲突处理；完成跨账号、跨资料库、多设备与并发的数据库和浏览器测试后再开放编辑入口。
5. 完成实时协作、部署、备份与恢复测试。

## 本地开发准备

需要 Node.js 22+ 和 PostgreSQL。安装依赖后，将 `cloud/env.sample` 复制为 `.env.local` 并设置数据库地址、认证地址、随机密钥和媒体目录。先用 Better Auth CLI 创建认证表，再运行 `node scripts/cloud-migrate-business.cjs` 应用业务迁移。准备好账号与数据库后运行 `npm run dev`。这些步骤仍需在真实数据库中验证；请使用独立测试库。


## 2026-11-18：云端地图第一阶段（web-dev）

开发基线：`543154303c9a377c227d79b907256b3e456c38fc`（与上次交接的 `5431543` 一致），原版地图代码仍在 `src/features/map/`。

本阶段新增 `src/features/map/cloud/WorkspaceMaps.tsx`，通过云端笔记、国家及事件适配器调用原版 `MapCanvas`、`useMapViewport` 和 `annotations.ts`：在工作台地图板块创建/选择地图、上传底图、缩放平移、筛选国家/事件/词条图层、添加/拖动/移除地图锚点、绘制国界及道路、删除标注，并通过 `WorkspaceEntityHistory` 查看地图条目历史。访客保持只读；草稿、保存失败和版本冲突均提供离开保护及失败数据复制入口。

地图沿用原版的 `worldEntry`（`category=地图`）存储模型。云端底图改用 `/api/workspaces/<id>/media` 上传，`mapImage` 保存为私有 `/api/media/<assetId>` URL；服务器校验图片属于当前资料库，并校验锚点所指向的地图是当前资料库中的地图条目。地图的图片、尺寸、标注及每个锚点的修改全部通过原有版本化实体 API 进行，使用 `expectedVersion` 检测并发冲突。未修改上游原版画布。

为维持原版 `mapId` 按地图名称关联的语义，新加 `0005_map_name_unique.sql` 限制同一资料库下地图名称唯一；创建/修改地图时会在服务端提前检查同名。

新增 `tests/cloud-map-fields.test.ts` 与 PostgreSQL（PGlite）集成测试用例，覆盖归一化坐标、标注、私有底图、跨资料库地图引用、版本历史和访客权限。新增 `.github/workflows/web-cloud-check.yml`，在 `web-dev` 推送时执行类型检查、lint、单元测试和 Web 生产构建。

**验证状态**：本轮已完成远程分支核对、代码提交和服务端校验路径检查；新测试/CI 的实际执行结果及浏览器交互仍需查看工作流或在有依赖环境的本地/VPS 执行。原先的 558 项测试与 31 项自检仅属于 `5431543` 基线，本轮不沿用其通过结论。

**后续待做**：原版地图生成器与多视图生成、`.ocmap` 导入/导出、地图重命名/删除与锚点联动、完整原版地图菜单/详情、多个资料库实际浏览器切换、独立 PostgreSQL 联调及浏览器拖动验收。当前仍为开发版本。


## 2026-11-18：云端地图管理、生成和导入导出（第二阶段）

基于第一阶段的 `cac7642` 继续开发，仅提交到 `web-dev`，保留 `main`。本阶段主要提交：

- `180e1ff`、`7ba2146`：事务化地图重命名与删除。地图名称变化时，同一资料库关联国家、事件和笔记的 `mapId` 一并改写，每个受影响条目生成独立版本与 `change_events`；删除时清空锚点所属地图及坐标并软删除地图。地图管理使用资料库行锁与 `expectedVersion`，泛用实体 API 禁止绕过联动规则直接重命名或删除地图，并为版本恢复增加地图/媒体校验。
- `42b4b5c`：保留原版 `MapSwitcher` 的缩略图、重命名、删除确认及详情入口；通过可选权限 props 适配云端角色（查看者只读、编辑者可以重命名、所有者和管理员可删除）。
- `5a17944`、`24cf49f`：补充并修正 PGlite 集成测试，覆盖重命名与删除的锚点版本、跨资料库同名地图、权限和版本冲突。
- `21fc36a`：新增 `mapViews` 记录六档地图的私有媒体 URL；服务器对每一视图媒体引用进行当前资料库所有权校验。
- `e489f61`：接入原版 `MapGeneratorPanel` 和 `renderMapView`。可生成底图，使用原版 Worker 渲染与预渲染六档视图，缓存至云端私有媒体，通过地图笔记版本保存种子、参数、当前视图和各档 URL。若预渲染缺失，可由种子/参数按需补生成。复用原版 `archive.ts` 和 `export.ts`，支持 `.ocmap` 导入与导出（档案含当前底图、参数及政治标注）；空资料库也可导入，重名自动添加序号。
- `b2f12b3`、`908050d`：补足查看者空地图提示权限、无地图时的导入入口、未保存草稿保护；复用原版 `exportMapImage` 导出底图及锚点标签 PNG。

**自动验证记录**：GitHub Actions `Web cloud verification` 对 `e489f61` 和 `b2f12b3` 已返回成功（包含 `npm ci`、`typecheck`、`lint`、`test`、`build:web`）。`908050d` 及后续提交以其对应工作流最终状态为准。本次把 `npm run audit` 也纳入 `web-dev` 专用 CI，以覆盖原版地图与其他模块的项目自检。

**已知待验收 / 待完善**：
1. 用独立 PostgreSQL 测试迁移、并发重命名/删除、跨用户/跨资料库隔离；在真实浏览器验证地图锚点拖动、右键、缩放、地图生成器 Worker 和文件下载。
2. 地图详情、画线右键菜单、标注配色和地图生成器交互继续贴近完整原版；目前使用原版底图画布、地图选择器、生成面板、档案处理和 PNG 导出器，云端操作控件仍有部分差异。
3. PNG 导出沿用原版 `exportMapImage`，当前绘制底图与锚点标签；国界/道路叠加导出尚需实现。档案不包含其他实体的锚点历史（仍留在各实体版本中）。
4. 大型底图/六档视图上传、媒体垃圾回收、历史图片长期保留与失败后重试/断点续传需要完善和压力测试。
5. 其他原版功能（地图以外的模板、小说、表格、相册、分类管理、批量操作）、独立 PostgreSQL 环境、完整多设备联调、部署与备份恢复测试尚待推进。

工作台入口继续使用 `/studio/<资料库 ID>`。部署前仍需执行完整验收；当前为开发版本。


### CI 全量审计修复记录

对 `4e7da96` 的 CI 执行 `npm run audit` 时，31 个自检脚本中 29 个通过，`audit:agent` 与 `audit:library-guide` 由于新增 `world.mapViews` 未申明字段归属而失败；其余地图档案、地图内核和通用审计脚本通过。随后在 `src/lib/capabilities/agent-tools.ts` 的 `UI_ONLY_FIELDS.world` 标注了 `mapViews` 由云端地图编辑器维护，原版 Agent 工具仍维持已有写入边界。修复后以新提交的 CI 结果为准。


## 2026-11-18：云端地图第三阶段（右键标注 / 矢量导出 / PostgreSQL CI）

本阶段从 `3f0266d` 开始，继续沿用上游原版组件和操作模型，并保持 `main` 原状。

### 新增与修复

- `966c09c`：扩展原版 `exportMapImage` 的可选 `annotations` 参数，在当前底图与锚点标签之间绘制国界多边形、道路虚线、线下纸色外壳及色板颜色。浏览器导出 PNG 现在可以包含国界、道路和锚点；保留原版无标注时的导出效果。新增 `tests/cloud-map-export.test.ts` 验证归一化几何、闭合多边形、道路虚线和绘制调用。
- `8962df4`：云端地图接入上游 `MediaContextMenu`、`AnnotationColorMenu` 和 `annotationAt`。桌面端地图编辑模式右键可以在当前位置开始绘制国界/道路，右键已有标注可修改线条色、国界填充色或删除。所有保存继续使用资料库版本化实体接口。完成标注后先写入云端，成功才结束草稿；失败保留原有绘制点。
- `d34afb5`：在 `.github/workflows/web-cloud-check.yml` 新增独立 PostgreSQL 16 服务作业，执行 Better Auth 迁移、5 个业务迁移、幂等复跑与 `cloud-db-smoke.cjs` 检查；检验数字原版 ID 字段和当前资料库地图名称唯一索引。
- `44d87fc`：服务端验证地图政治标注颜色必须属于原版关系色板，拒绝重复标注 ID、道路填充和无效色值；补充回归测试。
- `5a109d1`：新增 `scripts/cloud-postgres-map-smoke.cjs`，以真实 PostgreSQL 事务验证：跨资料库允许同名地图、同库禁止重名、普通笔记允许同名，以及软删除地图后可复用名称；测试结束回滚所有测试数据。

### 已完成验证与明确界限

- `8962df4`、`966c09c` 和 `44d87fc` 的 GitHub Actions Web 作业已返回成功。包含 TypeScript、ESLint、Vitest、31 项项目自检及 Next.js 生产构建；`8962df4` 的记录为 60 个测试文件、567 项测试通过。
- `d34afb5` 的 PostgreSQL 作业已确认 Better Auth 与 5 项业务迁移、迁移幂等和数据库结构检查通过。
- `5a109d1` 引入的真实数据隔离写入测试，最终以对应 GitHub Actions 运行结论为准。

仍需验收：独立 PostgreSQL 下完整登录/邀请/编辑/媒体的 HTTP 端到端流程；实际浏览器锚点拖动、右键定位、生成器 Worker、文件下载和多成员并发；地图高级详情及其他原版功能（表格、小说、模板、相册等）。目前为开发版，部署 VPS 前仍需进行安全配置、备份恢复与端到端验证。


## 2026-11-18：独立 PostgreSQL HTTP 联调与 VPS 部署文档（第四阶段）

新增验证链路：
- `941c978`：CI 的独立 PostgreSQL 服务通过 Better Auth 迁移与业务迁移后，使用 `scripts/cloud-ci-seed-user.cjs` 在受限的 `ocstudio_ci` 测试库中，调用 Better Auth 的密码哈希模块生成专用测试账号，实际启动 standalone Web 服务并运行 `scripts/cloud-http-smoke.cjs`。测试覆盖会话登录、资料库创建、私有图片、角色关系与共享标签、版本历史、旧入口跳转、Origin 校验等。
- `15f0eb9`：将地图的真实 HTTP 生命周期加入 `cloud-http-smoke.cjs`，验证私有底图、多档视图 URL、跨库同名、同库重名拒绝、国家地图锚点、地图重命名的级联版本、旧版本冲突及删除后的锚点清理。
- `a22f486`：新增 `docs/web-vps-deployment.md`，说明 Linux + Node 24 + PostgreSQL 16 + Nginx 的测试部署、受控账号、环境变量、数据库迁移、standalone 资源、systemd、反向代理和数据库/媒体同步备份。

**已确认的 CI 结果**：`15f0eb9` 的 `Web cloud verification` 运行结论为 success，包含 Web 类型检查、ESLint、单元测试、31 项项目自检与生产构建，以及独立 PostgreSQL 的 Better Auth/业务迁移、幂等、数据库隔离与真实登录/地图生命周期 HTTP 测试。后续文档提交仍以各自工作流为准。

**上线前继续处理**：实际浏览器地图拖拽、上下文菜单位置、文件下载与地图生成器 Worker；邀请码/成员权限与多浏览器并发的独立 PostgreSQL 端到端覆盖；服务器备份恢复演练；原版其它工作台板块的完整移植。当前 Web 分支保持开发版，不建议存储未经备份的正式数据。


## 2026-11-18：云端树形表格第一阶段（第五阶段）

开发基线 `76cdd9b`（GitHub Actions Web + 独立 PostgreSQL 两个作业均 success）。继续直接复用上游 `src/features/tree-table` 的 `TreeTableTabs`、`TreeTableRow`、`EditableCell`、`tree-table-rows.ts` 与 `buildEntryTree`。

- 在 `src/components/cloud/WorkspaceNavigation.tsx` 开通“表格”板块；云端入口挂载 `src/features/tree-table/cloud/WorkspaceTreeTable.tsx`，使用已有四类云端快照，按原版树形行模型显示角色（按国家分组）、事件、国家（父子层级）和世界观词条（父子层级）。支持当前页签搜索、展开/折叠、页签顺序拖动、实体跳转及刷新。
- 角色名、种族、职业、所属国家，以及事件/国家/词条名称均通过原有版本化云端实体适配器保存；创建当前页签类型及子项也通过对应资料库 API。权限为 viewer 时原版单元格与国籍下拉只读、无新建入口。服务器返回版本冲突时，原版 `EditableCell` 保留正在编辑的文字。表格保存操作参与工作台切换前的 `flushPendingSaves`，在单元格编辑中禁止无提示离开。
- 原版 `EditableCell`、`TreeTableRow`、`FilterSelect` 增加兼容性的可选只读/编辑状态参数，默认保持原版交互。删除按钮暂在云端表格关闭，以避免父子提级过程出现多次请求的部分提交；后续应以事务方式实现。
- `src/features/tree-table/cloud/cloud-table-tags.ts` 将当前资料库的共享标签 UUID 与历史标签名映射为**仅用于展示**的临时数字 ID，复用原版 `TagBadge` 和行搜索口径。临时 ID 只在 React 行模型中使用，写入 API 时仍由已有实体适配器保存真实 UUID。
- 新增 `tests/cloud-tree-table.test.ts`，覆盖云端国家分组、条目跳转、viewer 只读、新建和正在编辑的草稿保护；新增 `tests/cloud-tree-table-tags.test.ts`，覆盖 UUID 标签显示、历史标签回落、无效标签颜色和展示 ID 不回写。
- 本阶段第一次新增 UI 用例因测试角色缺少预期的所属国家，导致行投影正确显示“未归属”，已修正测试夹具。完整 CI 结果以最后代码提交对应的工作流状态为准。

**后续表格差距**：安全的事务式删除和子项提升、从原版数据批量导入、云端标签增删编辑、测试真实浏览器单元格/下拉选项互动。其后进入原版多视图浏览模式、小说、模板与全局相册的云端移植。


## 2026-11-19：主页、小说、全局相册集中接入（第六阶段）

基线 `07bfc19`（此前 573 项测试、31 项自检、Web 构建和独立 PostgreSQL HTTP 验证均通过）。本阶段只在 `web-dev` 开发，`main` 保留原状。

### 原版 11 个主要导航板块的云端入口已全部接通

1. **主页**：从 `src/features/dashboard/components/Dashboard.tsx` 抽取共用的 `DashboardView`，原版桌面 `Dashboard` 保持自己的 IndexedDB hooks；云端注入当前资料库角色/国家/事件/词条与小说、地图数目，继续沿用主要角色、最近更新与快捷入口。新增 `src/features/dashboard/cloud/WorkspaceHome.tsx`；使用版本化 `workspace_settings['world-cover']` 和私有图片接口上传、替换、移除世界封面，更新操作仅限资料库所有者及管理员，读取对成员开放，记录到审计日志。
2. **小说**：新增 `src/features/novel/cloud/WorkspaceNovel.tsx`、`cloud-novel-projection.ts`，沿用原版 `worldEntry(category=小说)` 和 `parentId` 章节树、`CoverCard`、`CoverFlow`、`TreeRow`、TipTap `EditorCore`、分页 `NovelReader` 及原版 `flattenNovel`、`toTxt`、`toMarkdown`、`downloadNovelDocx`。支持多本小说、章节及子章节、标题和大纲、自动与手动保存、封面/作者/简介/目标字数、阅读预览（9:16/16:9/A4）、TXT/Markdown/Word 导出。导出前执行草稿 flush，再读取服务器最新的当前资料库章节，避免刚保存就导出旧文本。子章节搜索保留匹配子项的祖先路径。
3. **小说删除/权限**：新建 `/api/workspaces/[workspaceId]/novels/[entryId]` 的 DELETE 事务接口，递归删除所选章节/作品的整棵子树并逐条写版本历史和 change events；普通单条实体删除接口会拒绝该类别的直接删除。删除限 owner/admin；editor 可新建/修改，viewer 只读。服务端 `cloudNovelAllowed` 检查小说父级位于当前资料库且同为小说、字段值有效及封面是私有媒体引用；恢复旧版本同样执行这些校验。
4. **全局相册**：新增 `src/features/album/cloud/WorkspaceAlbum.tsx` 与 `cloud-album-projection.ts`，复用原版 `AlbumTreePanel`、`AlbumCard`、`FullscreenViewer`、`FilterSelect`、`SortSelect` 和 `lib/image-refs.ts`。汇总当前资料库角色、国家、事件及普通词条的字段图与富文本正文图片，另展示世界封面；沿用原版排除小说和地图条目的规则。仅使用 `/api/media/<uuid>` 类型的私有媒体，服务器仍验证实际归属。提供类别树、来源/共享标签过滤、搜索、时间排序、图片全屏查看和跳转来源，增加移动端目录、搜索与排序入口。
5. **原版导航**：工作台 `WorkspaceNavigation` 现包含主页、角色、国家、事件、世界观、小说、表格、地图、时间线、关系图、全局相册，以及额外的成员与邀请。原版 11/11 **主要板块已接入**，这是入口覆盖数；各板块高级功能仍在迁移中。

### 代码与测试

关键提交依次为：`8cf36d5`（主页展示与导航）、`139194d`（相册）、`d47e676`（小说）、`49d3887`（工作台挂载）、`21d74ee`（小说子树事务删除）、`cddb7a2`（草稿保护）、`175ad75`（投影测试）、`6f7fbb5`（PGlite 类型修复）、`4188884`（真实 PostgreSQL HTTP 小说生命周期）、`e7becb6`（历史恢复校验）、`70aaa0d`（权限及移动端）、`f8833c9`（最新章节导出/私有封面）、`8aa1b08`、`2b7a847`、`af92a2a`（世界封面 API/UI/相册集成）和 `410b3fe`（封面权限、版本与相册测试）。

已确认 `70aaa0d`、`4188884` 及 `f8833c9` 对应的完整 GitHub Actions 验证成功（含 Web 类型检查、ESLint、全部当时测试、31 项项目自检、生产构建和独立 PostgreSQL HTTP 作业）。`410b3fe` 的新封面测试发现 PGlite 对同一个 SQL 参数推断 UUID/TEXT 类型冲突，已通过 `977e068` 将审计日志 text 参数拆开；**最后提交的全套 CI 结果需重新核对**。

### 与原版完整功能仍有差距（不可混同于 11/11 入口覆盖）

- 小说章节的原版完整 DnD 排序、书架移动端长按动作、分页版式自定义、完整导出中心和批量恢复仍需进一步迁移。当前章节树和书架通过原版组件/纯函数搭建。
- 全局相册移动端长按动作和各高级筛选控件仍有精细适配工作，独立的分类管理、模板与个性化设置需要云端数据接口。世界封面使用 `workspace_settings` 版本及审计历史，与实体逐版本历史采用不同存储模型。
- 其他原版高级能力：表格事务删除、角色卡片/画廊多视图、全局快捷搜索、灵感、回收站 UI、完整导入导出、`.ocbak`、插件与 AI 助手、实时协同编辑，以及全库备份/恢复验证。
- 自动化验证已包含独立 PostgreSQL 的真实 HTTP 调用，仍需在真实浏览器完成小说章节编辑/阅读/Word 下载、封面上传、相册图片与移动端、地图拖动、多人并发等验收，再部署 VPS 正式使用。


## 2026-11-19：原版高级功能逐项移植与验收（第七阶段）

本轮沿用 `web-dev` 的原版组件/纯函数以及独立资料库实体快照；`main` 保留原状态。

### A. 小说 · 原版章节拖拽（已开发 / 自动化验收）

- 原版 `TreeRow`、`dnd-kit` 的 Pointer/Keyboard sensors、`SortableContext` 和 `src/lib/tree-order.ts:computeReorder` 现用于云端小说树。支持同书内移动章节、跨层级排序、折叠子树、搜索时禁用拖拽、只有 editor 及以上显示拖拽手柄。
- `src/lib/cloud/novel-reorder.ts` 按书根检查待移动章节/目标均属于同一小说，拒绝跨书与子孙循环父级。新增 `PATCH /api/workspaces/[workspaceId]/novels/[entryId]/reorder`，在同一事务里锁住资料库与有关小说条目、检查每个受影响实体的乐观版本，并同步写入旧层/新层兄弟序号、实体历史及变更记录；冲突返回 409。
- `tests/cloud-novel-album.test.ts` 与 `tests/cloud-original-characters.integration.test.ts` 增加重排规划、跨书拒绝、版本冲突、viewer/editor 权限、排序结果与历史记录的 PGlite 集成测试；`scripts/cloud-http-smoke.cjs` 增加真实 PostgreSQL HTTP 重排与旧版本拒绝验证。

### B. 小说 · 原版高级分页排版（已开发 / 构建验收）

- 继续复用原版 `NovelReader`、`NOVEL_LAYOUT_PRESETS`、`normalizeNovelLayout`、`toPaginateOptions` 和 `resolveNovelBackground`。云端分页预览提供书页/章首/极简/信笺四预设及字体、字号、行距、页边距、标题位置、页码、章节分页、作品扉页和纸张背景。
- 阅读偏好按资料库 + 小说 ID 存储在**当前浏览器本地**，不改写正文或云端版本。TXT/Markdown/Word 仍沿用原版独立导出逻辑；Word 排版和图片分页的高级参数需后续进一步衔接。

### C. 全局相册 · 原版移动交互和私有图片下载（已开发 / 自动化验收）

- `WorkspaceAlbum` 使用原版 `useDevice`、`AlbumCard` 长按手势与 `MobileActionSheet`：支持“查看大图 / 保存到… / 跳转来源”，移动端同时保留分类抽屉、来源/标签筛选及排序。
- 修复 `src/lib/media-download.ts` 的云端图片字节下载：对严格限定的 `/api/media/<uuid>` 地址经同源登录会话抓取图片，依响应 MIME 给文件附 png/jpg/webp/gif 后缀，安全净化文件名；原有 Tauri/Capacitor/普通文件下载分支保持不变。
- 新增 `tests/cloud-private-media-download.test.ts`，验证授权失败、同源会话、图片格式/文件名和浏览器下载行为。上传/读取媒体的已有独立 PostgreSQL 测试继续覆盖跨库隔离。

### D. 树形表格 · 事务式安全删除（已开发 / 自动化验收）

- `WorkspaceTreeTable` 恢复原版 `DeleteButton` 的删除入口；只有 owner/admin 可以操作，editor/viewer 继续可执行各自权限内的功能。删除按钮依据请求结果决定是否提示已移入回收站。
- 新增 `DELETE /api/workspaces/[workspaceId]/table/[entityId]`：删除国家或普通词条时，直接子项自动提升到被删条目的父级；删除国家时同步解绑角色国籍与事件相关国家；删除角色时同步清理角色关系表与事件参与者。所有更新、删除、版本历史和 change events 在单一事务中完成，检查受影响条目的 `expectedVersions`，有并发修改时返回 409。
- `tests/cloud-original-characters.integration.test.ts` 增加 PGlite 权限、版本冲突、父子提升、国籍/事件关联与历史测试；`scripts/cloud-http-smoke.cjs` 增加真实 PostgreSQL HTTP 子项提升与引用清理检查。小说、地图继续由各自特化的生命周期接口处理。

### 验证与尚待完成项

- 新增代码提交包括 `e4d4e21`、`0bca17f`、`5db1e6e`、`05af203`、`750e1de`、`4e02480`、`e7f9360`、`5ecf720`、`4eb951e`、`908836b`、`69c4815`、`205bdf1`、`237935b`、`917e830`。中途的 TypeScript 类型收敛、测试空国籍表示已修复。
- `205bdf1` 的完整 GitHub Actions 已通过，包含类型、lint、单元/PGlite 测试、自检、Next.js 生产构建及独立 PostgreSQL。针对 `917e830` 新增的真实 HTTP 高级操作，**独立 PostgreSQL 业务迁移自检作业已确认成功**；最新完整 Web 作业以 Actions 最终运行结论为准。
- **浏览器手动验收待办**：实际拖动嵌套章节、移动端长按/下载、深色主题的分页预览、真实多成员同时调整章节、资源文件可用性、备份恢复演练。GitHub Actions 的 HTTP/组件测试和生产构建属于自动化验证。
- **后续高级功能**：世界观/国家/事件/角色编辑器与表格的一致删除入口；云端回收站界面与整树恢复；模板/组件/分类在线设置；全局搜索与聚合浏览；旧数据与整库 `.ocbak` 的安全导入/导出；AI 插件、本地扩展与实时协同，以及部署安全与实际多浏览器验收。


## 2026-11-19：Docker / GHCR / VPS 自动更新打包

- 沿用 `web-dev`，保留 `main`；无需创建部署专用分支。
- 新增根目录多阶段 `Dockerfile` 和 `.dockerignore`，使用 Node 24 及 Next.js standalone Web 最小运行镜像，另建带 Better Auth CLI 和 `cloud-migrate-business.cjs` 的数据库迁移镜像。Web 使用独立 UID/GID 10001。
- `deploy/compose.yaml` 使用 PostgreSQL 16 持久卷、`./data/media` 私有媒体 bind mount，绑定宿主机 `127.0.0.1:3000`，按 HTTPS `BETTER_AUTH_URL`、数据库连接、独立密钥配置；数据库迁移服务只在 `maintenance` profile 运行。
- `.github/workflows/web-cloud-check.yml` 新增 Docker Compose 静态校验和 `publish-docker` 作业，只有 Web 类型检查/测试/自检/构建和真实 PostgreSQL 迁移+HTTP 全部成功，才用 GitHub 自带 Token 发布 `ghcr.io/strangeryuu/oc-studio-web:dev`、`...-migrate:dev` 及对应 `sha-<12位>` 标签。迁移镜像先发布、Web 后发布，防止 VPS 拉取新 Web 但尚无配套迁移镜像。因 `main` 保持不变，直接在现有分支 CI 添加 `needs: [web, postgres-schema]`，避开 `workflow_run` 依赖默认分支的限制。
- `deploy/update.sh` 为幂等更新工具：使用 `flock` 防止并发，比较已运行与镜像仓库最新 `web` 镜像 ID，发现更新后先备份 PostgreSQL 和媒体，再运行一次性迁移并启动新的 Web 容器；检查健康情况。失败时保留备份和日志，不对潜在不兼容迁移做自动数据库回滚。
- `deploy/ocstudio-update.service` 和 `.timer` 提供可选系统定时拉取（仅建议测试环境先开启）；正式环境建议固定 SHA 并人工升级。无需把 VPS 私钥交给 GitHub。
- 配套 `docs/web-docker-deployment.md`，说明 GHCR 私有镜像读权限、系统账号、HTTPS、机密变量、初始化、更新、备份、恢复与验收。项目源代码改动自动在 CI 中构建镜像，VPS 可只保留 Compose/脚本与持久数据，无需每次 git pull 与重新 npm 构建。

**验收边界：** 现有 Web/PostgreSQL CI 是代码和 HTTP 业务验证；新增容器构建/发布需等 `publish-docker` 作业结论。实际 VPS 的 HTTPS、数据库和媒体恢复演练，以及 x86_64 宿主机 Compose 运行仍需独立验收。


## 2026-11-19：四项高级功能的验收收尾（第八阶段）

以 `a95203e` 为基线，该提交的 Web、独立 PostgreSQL 和 GHCR Docker 发布作业已全部成功。本阶段进一步加严四项高级功能的测试与迁移安全：

- `4b9be97` 起，`scripts/cloud-http-smoke.cjs` 新增 PostgreSQL 16 真实 HTTP 验收：小说整树恢复、模板配置冲突、跨类型搜索与隔离、`.ocbak` 云端全量导出/空库导入、私有媒体、修订历史和跨库 ID 映射。
- 验收中发现的脚本响应体重复读取已修复（`dba87c0`）；为防止备份出现历史版本丢失，加严云端归档 schema 与时间戳完整性检查，并保留修改历史原时间戳（`82c46a5`）。因校验正则表达式转义错误引起真实备份拒绝已修复（`92f074a`）。
- 为跨设备映射验收，在授权实体读取返回原版数值 `local_id`（`eeab6ad`）。
- 新增桌面 v1 `.ocbak` HTTP 验收时，发现旧版内嵌图片创建的新目标媒体 URL 被二次视为外部来源而拒绝，已修复为仅认可当前导入过程新生成的 UUID（`1bb9d07`），严格拒绝其他外部 UUID。
- 针对桌面归档中尚未建成云端模块的年代、世界信息、灵感和创作日志，增加 `desktop-extras` 的版本化留存和再次导出（`5137ff7`），避免原版多 store 备份迁移后悄然遗失。真实 HTTP 测试现覆盖这四类数据的往返。
- 更详细的自动化覆盖与尚待手工操作验收见 `docs/web-advanced-acceptance.md`。本阶段的**最终 CI 状态须以最后代码/文档提交关联的 GitHub Actions 为准**；先前通过的旧运行不可代替后续提交验证。

仍待 VPS/浏览器验收：真实移动端相册长按、导航、复杂模板组件交互，多人同时编辑，完整桌面大型 SVG/视频/插件档案及 PostgreSQL + MEDIA_ROOT 故障恢复。


## 2026-11-19：首装管理员、权限、用户管理、邮件找回与注册码（第九阶段）

- 首次部署支持 `/setup`：用户名、邮箱与强密码；数据库事务及 advisory lock 保障管理员初始化仅一次，完成后隐藏入口。
- Better Auth 平台管理角色补上 `user:set-role`，支持管理员创建和调整普通/平台管理员账号；平台级管理员菜单 `/admin` 集中管理用户、邀请码和邮件设置。
- 统一站点管理角色的服务端校验：平台管理员访问全部世界观，普通用户仅访问自己创建或获邀请加入的世界观。工作台导航以数据库当前角色判断是否显示管理员入口。
- 登录及注册页面新增邀请码注册、找回密码；密码重置使用 Better Auth 一次性令牌，邮件可切换本机 sendmail 或加密保存 SMTP 凭据的 TLS/STARTTLS 模式。
- 新增真实 PostgreSQL HTTP 验证，覆盖管理员建号、邀请码消耗与非管理员限制、全站访问隔离、受控邮件投递、重置后保存的密码，以及独立首装数据库的并发初始化。发布 GHCR 镜像前需要全部 CI 作业通过。
- 运维操作及首装风险说明见 `docs/web-admin-onboarding.md`。实际公网 HTTPS、生产 SMTP 配置及多浏览器 UI 仍需 VPS 手动复核；请使用最新提交对应的 Actions 运行结果核对通过状态。
