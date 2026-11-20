# OC Studio Web · 三仓库功能对照与 OC-editor 移植候选（2026-11-20）

> 审查基线（实际读取 GitHub 仓库树及关键组件源码）
>
> - 本仓库 `Strangeryuu/OC-Studio-web@web-dev`：`795ac046debde19179bfc18b31873336ac8cf386`
> - 上游 `Pokanshuu/OC-Studio@main`：`22588336760ac16b6fdaba94947ed3bb4c834846`
> - 借鉴仓库 `nekibud/OC-editor@main`：`d4ce2fa87d62d8b25960bf4d56e2d005f3340c50`
>
> 本文件是 **源码/入口静态核对**，尚未代表 VPS、iOS/Android 真机或完整导入导出的运行验收。本轮只新增审查文档，**未修改业务代码、数据库迁移或部署配置**。

## 一、结论

`web-dev` 并未丢弃大量原版代码：上游 `main` 的 977 条 blob 路径中有 975 条仍能在 `web-dev` 中找到；仅原版 `src/app/layout.tsx`、`src/app/page.tsx` 两个入口替换为 Web/原版路由组。此数字描述**文件存在**，并不代表功能已经云端接入。约 89 个上游同路径文件在 Web 端已有 SHA 差异，主要是云端兼容、交互修复和数据操作调整。

当前主要欠缺项是保留了原版组件但缺少云端数据适配/交互入口，以及原版存储在本地的附加内容尚未完整可视化。

## 二、原版功能差距（按源码可验证情况）

| 项目 | 当前状态 | 依据与下一步 | 优先级 |
| --- | --- | --- | --- |
| 角色/事件/国家卡片、画廊、列表、排序、搜索 | **源码已接入** | `src/components/cloud/WorkspaceEntityCatalog.tsx` 使用原版 `CoverCard`、`CoverFlow`、`SortViewControls`；需三端 UI 验收 | 验收 |
| 角色分组/国家筛选/手工拖拽排序 | **源码已接入** | `WorkspaceEntityCatalog.tsx` 通过 `/api/workspaces/[workspaceId]/catalog` 保存；需校验冲突、批量顺序与文件夹操作 | 验收 |
| 主题切换和设置入口 | **源码已接入** | `src/components/cloud/CloudSettingsMenu.tsx` 有浅色、深色、系统跟随、预设配色和管理员入口；偏好存本浏览器 | 验收 |
| 海报导出：6 种原版版式 | **原版组件保留，云端未完整接入** | `src/components/shared/export/PosterPanel.tsx`、`ExportCenter.tsx`；Web 工作台 `WorkspaceCharacters.tsx` 未挂通用导出中心及云端素材/实体适配 | P1 |
| 静态网站：3 种模板、单文件 HTML | **原版组件保留，云端未完整接入** | `SitePanel.tsx` 与 `src/lib/export/site/`；需作用域内内容与私有图片内嵌、过滤只读/私有信息、HTML 安全审查 | P1 |
| 通用文档：词条/角色/事件等的多条目 Word/Markdown/TXT | **原版组件保留，云端未完整接入** | `DocumentPanel.tsx`、`src/lib/export/document*`；Web 小说单独已有 TXT/MD/Word，避免重复开发小说导出 | P1 |
| 随手记/灵感 → 正式笔记 | **原版能力与额外数据保留，云端入口待接入** | 参照原版 `AppShell`/灵感模块；Web 的 `desktop-extras` 目前用于备份往返，不包含完整创作 UI | P1 |
| 创作日志/世界元数据 | **保留可往返，但编辑可视化不足** | `src/lib/cloud/backup-format.ts` 的 `DesktopArchiveExtras` 包含 `meta`、`config`、`journal`；需权限化设置/编辑与备份验证 | P2 |
| AI 助手/插件 | **原版相关代码保留，未整体云端移植** | 需服务器密钥管理、按世界观及角色授权、读写权限与审计、调用限流/成本约束；禁止把桌面 Shell/本地文件工具直接暴露给多用户服务 | P2/独立阶段 |
| 高级模板、宠物/武器类型化字段组、预设正文 | **基础模板与自定义分类已接入，高级编辑需验收/扩展** | `WorkspaceCustomizationPanel` + 原版 template-blocks；检查字段组复用、默认正文及移动端编辑，不以文件存在视为已工作 | P2 |
| 自定义背景图/窗口材质效果 | **主题配色已接入；剩余按平台分类** | 自定义背景可做 Web 设置；Tauri Mica/系统窗口能力属桌面专用，不纳入 VPS 必须项 | P3 |
| 实时同屏协作 | **在线状态和版本冲突保护已实现，同屏 CRDT 协作仍待实现** | 现有 presence/版本号逻辑不等同实时共同编辑；另行设计 WebSocket/Yjs 授权与持久化 | 独立阶段 |
| 地图/关系图/时间线/小说复杂交互与大媒体 | **主流程已有，实现级验收持续进行** | 复用现有高级验收文档，涵盖浏览器下载、真机拖拽、长时间输入、100~1000 节点、Worker、超大归档 | 验收 |

**不要重复移植：** 原版 `RelationGraph.tsx` 已明确支持一对角色/事件之间多条不同命名关系；Web 图谱采用上游组件。另外，角色分组、卡片/画廊/列表、主题模式等最近已在 `web-dev` 接入，下一步是 UI/并发回归而非重复重写。

## 三、OC-editor 候选功能与复制边界

OC-editor 的一些路径在原版与 Web 仓库中均不存在，说明是值得独立研究的实现，但部分已与原版现有能力重叠，需择优借鉴。

| 候选 | OC-editor 源码 | 本仓库差距与建议 | 优先级 |
| --- | --- | --- | --- |
| **分类 `.ocbak` 导出**：角色文件夹、全部角色、事件、国家、世界词条、自建分类 | `src/lib/ocav.ts`、`src/components/shared/OcavExportButton.tsx` | 本仓库只提供资料库整库 `.ocbak`。优先新增只读选择性导出，分组范围在服务器按授权资料库过滤；保留关联对象/关系线和必要私有图片 | **P1** |
| **分类智能导入及冲突策略**：跳过、覆盖、保留两者；按实际条目形状判断类别 | `src/lib/ocav.ts` 中 `detectTableFromItems`、`validateOcav` 和导入事务 | 当前 `src/app/api/workspaces/[workspaceId]/backup/route.ts` 仅接受全库 v1 格式，要求目标世界观为空。应另建分类导入协议，按项目 ACL + PostgreSQL 事务、版本校验和 ID/图片/关系映射实现。**不要直接复制 Dexie 读写** | **P1** |
| **3D 球体展示、地形剖面** | `src/features/map/components/GlobeCanvas.tsx`、`ProfileChart.tsx`、`src/features/map/profile.ts` | 云端地图已接原版地图生成器/Canvas；需定义高度与气候栅格的持久化格式，按世界观关联地图，不仅存最终 PNG；WebGL2 失败/移动端性能时退回 2D | **P2** |
| **新地图算法/气候/水文视图** | `src/features/map/generator/`、`map.worker.ts`、`MapView.tsx` | 与原版 MapGeneratorPanel 存在重叠。优先做**算法输出和导入接口**，在已有地图生成器中增加可选模式，不覆盖原版地图数据 | P2 |
| **自定义分类专属关系网** | `src/features/custom-sections/CustomSectionGraph.tsx`、`CustomSectionView.tsx` | Web 已有自定义分类词条与全局关系图。新增「当前分类关系网」只读筛选，复用现有图节点与关系算法，不另建一套脱离云端关系数据的表 | **P2** |
| **移动端文字选区快捷条** | `src/components/shared/MobileTextSelectionBar.tsx` | 已有原版移动编辑工具栏。应提取选择检测与动作菜单策略，避免原样复制对 DOM 的临时插入与 `normalize()` 影响 TipTap 选区、撤销/重做、输入法 | P2 |
| **长按拖动分类顺序** | `src/components/layout/SidebarCreateOrder.tsx` | Web 有分类顺序配置，补触摸拖拽与乐观版本写入可提升移动体验，沿用现有设置接口 | P2 |
| **局部错误边界 / 防消失弹窗** | `src/components/shared/ErrorBoundary.tsx`、`AppConfirm.tsx` | 与 Web 已有二次确认及菜单修复重叠。优先加入地图、小说、关系图局部错误恢复，统一跨 Portal 的弹层关闭逻辑 | P3 |

### 格式及权限特殊注意

1. **同为 `.ocbak`，数据格式不同。** OC-editor 分类文件标识 `format: 'oc-editor-ocav'`、`payload.items`、`relations`；本仓库云端导入检查 `version=1`、`data`、可选 `cloud.format='oc-studio-web-v1'`。需要显式区分、预览与转换，避免误判和覆盖。OC-editor 源码与 README 对识别策略存在历史描述差异，当前 `validateOcav` 实现优先按条目形状、再 `payload.table`、最后 `kind` 判断。
2. **分类增量导入权限必须与现有世界观写权限一致**，并校验跨库引用、恶意图片地址与字节限制。覆盖场景需 `expectedVersion`，事务中一并处理标签、父子树、关系和媒体；错误必须整批回滚。
3. **桌面本地 API、Dexie、AppData、Windows/MSIX 安装器不适用于浏览器 VPS 运行时。** 这类实现只借鉴算法/交互，不直接复制桌面存储与构建脚本。
4. **MIT 许可。** 复用代码须保留相应原作者的版权声明及 MIT 许可信息，并按仓库现有 LICENSE/NOTICE 约定归档。

## 四、建议实施批次

1. **批次 A · 完成原版导出中心（P1）：** 先接海报，随后通用文档和静态网站。对每个导出提供浏览器预览、私有图片内嵌、异步错误、受控权限、手机端下载测试。
2. **批次 B · OC-editor 分类迁移（P1）：** 首版导出角色/事件/国家/自建分类；引入分类文件验证、预览、增量导入（先跳过重复，再做覆盖/保留两者），服务器端事务与冲突测试。所有导入测试在空白/模拟资料库进行，禁止直接操作线上现有资料。
3. **批次 C · 创作附加数据（P1/P2）：** 恢复随手记/灵感、创作日志、预设正文等浏览器能力，沿用 `desktop-extras` 的可往返数据保护并规划正式表结构。
4. **批次 D · OC-editor 视图（P2）：** 先自定义分类关系网（复用图算法），再研究地形剖面/3D 球体、新地图算法及移动端文字工具。
5. **批次 E · 高风险专项（独立）：** 原版 AI 助手/插件、CRDT 协作和多用户持久实时编辑，先做权限和隔离方案，再评估实现。

## 五、每批合并前检查

- `npm run check`、`npm run build:web`，以及真实 PostgreSQL HTTP 权限、跨世界观隔离与冲突测试。
- 新增导入必须覆盖：坏格式、内容类型伪造、悬空关系、重复 ID、图片外链、超限与事务部分失败。
- 导出必须确认只包含授权世界观的数据，访客/只读成员无写入能力，取消分享后私有媒体继续封闭。
- 真实桌面 Chromium、Android Chrome、iOS Safari 的菜单、选择、拖拽、长按、下载验收各自记录。
- 用备份恢复演练通过后再用于正式 VPS，禁止把自动 CI 通过视为生产环境的交互验收。

## 六、主要源码索引

- 本仓库：[Web 工作台入口](../src/features/characters/cloud/WorkspaceCharacters.tsx)、[角色/事件/国家列表](../src/components/cloud/WorkspaceEntityCatalog.tsx)、[设置](../src/components/cloud/CloudSettingsMenu.tsx)、[整库备份 UI](../src/features/backup/cloud/WorkspaceBackup.tsx)、[备份格式](../src/lib/cloud/backup-format.ts)、[云端备份 API](../src/app/api/workspaces/%5BworkspaceId%5D/backup/route.ts)。
- 原版：[项目 README](https://github.com/Pokanshuu/OC-Studio/blob/main/README.md)、[导出中心](https://github.com/Pokanshuu/OC-Studio/blob/main/src/components/shared/export/ExportCenter.tsx)、[关系图](https://github.com/Pokanshuu/OC-Studio/blob/main/src/features/relations/components/RelationGraph.tsx)。
- OC-editor：[项目 README](https://github.com/nekibud/OC-editor/blob/main/README.md)、[分类归档](https://github.com/nekibud/OC-editor/blob/main/src/lib/ocav.ts)、[地图球体](https://github.com/nekibud/OC-editor/blob/main/src/features/map/components/GlobeCanvas.tsx)、[地形剖面](https://github.com/nekibud/OC-editor/blob/main/src/features/map/components/ProfileChart.tsx)、[分类关系图](https://github.com/nekibud/OC-editor/blob/main/src/features/custom-sections/CustomSectionGraph.tsx)、[移动文本工具](https://github.com/nekibud/OC-editor/blob/main/src/components/shared/MobileTextSelectionBar.tsx)。

## 审查约束

本轮只提供静态证据和可实施的迁移路线；未在容器中克隆项目（当前环境无法连接 github.com 主机），也未运行本地测试或部署。因此已实现功能与候选功能的最终判断，仍以相应功能的自动测试和真实浏览器验收为准。
