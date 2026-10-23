# XU Git Pull v2.0 重写设计

## 1. 为何重写

设置页双开关互斥在 1.13 声明式框架下三次翻车（1.8.9 无限循环重绘 / 1.9.1 直切竞态断持久化 / 1.9.2 手机端双开关同亮、点击失效、持久化丢失）。根因：声明式渲染器的 render/update 重入模型对「双控件联动」场景天然不友好，防御代码（重入锁、30ms 栈外重绘、类型守卫）越堆越多仍无法根治。决策：抛弃声明式框架，回归经典 `display()` API + 下拉单选，核心功能精简重写。

## 2. 旧版逻辑梳理（1.9.2，已验证可靠的部分照搬）

### 下载链路（这部分是好的，e2e 真实网络 11+11 项全绿）
- **全量克隆**：`gitRemoteUrl`（三平台 https 域名同构）→ `createGitHttp`（requestUrl 包装：Basic `oauth2:<token>`、body 收集、响应单 chunk async iterator）→ `isogit.clone`（depth=1, singleBranch, noCheckout）→ 提交树遍历 → glob 过滤 → 本地 blob SHA-1 对账（一致跳过）→ `writeBinary` 覆盖写盘。未指定分支跳过 ls-remote 验证。
- **限速增量**：`verifyRemote`（ls-remote，仅指定分支时校验）→ `fetchTreeAll`（tree API，GitCode 分页翻页取全、失败退避重试 3 次后中止、触顶 2 万条上报 truncated）→ 过滤（remotePath 前缀/排除 glob/.obsidian 开关/`.git/`、`.trash/` 恒排除）→ manifest 对比（`vault/.xu-git-pull/<platform>-<owner>-<repo>-<slug>.json`，path→sha 快照，ref 或 slug 变化自动全量重下）→ 远程删除同步（manifest 有而远程无 → 删本地）→ 逐文件限速 blob 下载（每 20 文件落盘断点、单文件 >20MB 跳过、429/403 限流等 60s 重试、失败重试 5 次）→ 汇总通知。
- **pull() 入口**：`_pullBusy` 锁防双击 → `downloadMode[platKey]`（desktop/mobile 按平台记忆）分流 → 状态栏 ⬇ 进度可点击取消（`_cancelAll` 标志位）。
- **认证**：REST API 用 `Bearer <token>`；git 协议用 Basic `oauth2:<token>`（createGitHttp 内注入）。Token 仅存本机 data.json。
- **内置排除**：`community-plugins.json`、`workspace.json`（设备本地状态，覆盖会出问题）+ `.git/`、`.trash/`。

### 设置页（这部分是坏的，全部重写）
- 旧：1.13 声明式 `getSettingDefinitions()` + 双 toggle 互斥 + render 回调 + visible 谓词 + update() 重绘 —— 三次翻车土壤。
- 新：**经典 `display()` Setting API**（xu 系列插件通用模式，移动端久经考验），下载模式用**单个下拉框**（全量覆盖 / 限速增量），单控件单值，无联动无竞态无防御代码。

## 3. v2.0 功能范围（精简）

**保留**：三平台（GitHub/GitCode/Gitee）拉取、全量克隆（depth=1 + 对账跳写）、限速增量（manifest 断点续传 + 远程删除同步）、Token 级联下拉（仓库/分支/子目录只选不填）、按平台记忆配置（含下载模式与限速值）、`.obsidian` 开关 + 自定义 glob、中英双语、桌面/手机/平板、ribbon + 命令 + 状态栏进度取消。

**砍掉**：指定提交版本回退（commitSha）、`?` 帮助弹窗、全量模式「清理远端已删除文件」开关（全量=纯覆盖不删；增量=自动同步远程删除，内建无开关）、声明式设置全部防御代码。

## 4. 设置页布局（经典 display，自上而下）

1. 界面语言（dropdown：中文/English）
2. 平台（dropdown：🇨🇳 GitCode / 🌐 GitHub / Gitee）
3. Token（password 文本 + 「如何创建」按钮，点击复制文档链接；失焦级联刷新仓库列表）
4. 仓库（级联下拉 + 可手填 owner/repo）
5. 分支（级联下拉，默认分支最新）
6. 仓库子目录（级联下拉，`/` = 整仓）
7. 本地目标目录（text，空 = vault 根）
8. 下载模式（**dropdown 二选一**：全量覆盖（默认）/ 限速增量）——切平台各自记忆
9. 每分钟请求数（text，仅增量模式显示；预填建议值 GitCode 40 / GitHub 60 / Gitee 50；0=全速）
10. 过滤组：下载 .obsidian 配置目录（toggle）+ 额外排除规则（textarea，每行一个 glob）
11. 立即拉取（button，页面底部）
12. 使用文档（GitHub 入口）

模式或平台切换后 `this.display()` 全量重绘（经典 API 成熟模式，无重入风险）。

## 5. data.json v2 格式与加载策略

```json
{
  "language": "zh",
  "platform": "gitcode",
  "tokens": { "github": "", "gitcode": "", "gitee": "" },
  "profiles": { "github": { "repo": "", "ref": "", "remotePath": "", "localPath": "" }, "gitcode": {}, "gitee": {} },
  "downloadMode": { "desktop": "clone", "mobile": "clone" },
  "ratePerMin": { "github": 60, "gitcode": 40, "gitee": 50 },
  "includeObsidian": true,
  "exclude": ""
}
```

**加载策略（根治旧格式穿透）**：不再 `Object.assign({}, DEFAULT, loadData())` 浅合并，改为 `normalizeSettings(raw)` 逐字段类型校验——每个字段读取时验证类型，类型不符（含旧格式字符串/数字、缺失、污染）直接用默认值替换，迁移在内存完成，下次保存自然落为新格式。无一次性迁移分支、无类型守卫散布。

## 6. 工程结构

```
xu-git-pull/
  manifest.json     # version 2.0.0, minAppVersion 1.5.0（经典 API 无 1.13 硬需求，真实兼容值）
  src/main.js       # 唯一源码（i18n 内置），约 850 行
  src/isogit.bundle.js  # isomorphic-git v1.44.2 + LightningFS 内联包（自旧版拷贝，发版经 esbuild 内联）
  build.sh          # esbuild --bundle src/main.js（external:obsidian）→ main.js 零 require
  styles.css        # 极少量（经典 API 原生控件）
  README.md / LICENSE / versions.json / .gitignore
```

## 7. 质量门禁

1. Node 桩环境 onload 冒烟测试（真实执行 display() 全部控件渲染，零 TypeError）
2. e2e：设置页交互（下拉切换/持久化/平台切换记忆）+ 真实网络增量三场景（无底账建账/秒回/丢文件重下，blob 请求数 = 写盘数、uploadPack = 0）
3. release_check.py 双体检后发版 2.0.0（同仓库 xcloud-ai/xu-git-pull）
