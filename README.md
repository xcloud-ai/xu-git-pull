# 远程资料拉取

> [!NOTE] 中文说明
> **远程资料拉取**：把 GitHub / GitCode / Gitee 仓库里的笔记和资料一键下载到手机、平板的 Obsidian 中查看，差异可见、一键覆盖，只下载不回传。

典型用法：电脑端把 Obsidian 笔记持续推送到远程仓库（GitHub / GitCode / Gitee），手机和平板只负责**看**。本插件不做双向同步、不在移动端维护 git 仓库，而是直接调用托管平台 API 逐文件比对、按需下载——没有 `.git` 目录、不解包 packfile，移动端内存占用小，专为「电脑推、移动看」的单向场景设计。

> English description below for review purposes. / 以下为英文说明，用于过审。

**XU Git Pull** downloads notes one-way from a GitHub / GitCode / Gitee repository (public or private) into a phone or tablet vault for reading. It calls the hosting platform's API to list files, compares git blob SHAs, previews added/modified files, and overwrites with one tap. It never uploads, never deletes local files, and keeps no `.git` folder — a lightweight, mobile-friendly alternative to full git sync plugins for read-only mobile devices.

## 功能特性

- **移动端查看优先**：电脑端推送远程仓库，手机/平板点一下即可获得最新资料，无需电脑、无需 git 客户端
- **差异预览、一键覆盖**：自动比对远程与本地，按「新增 / 修改 / 无变化」分类展示，确认后一次下载，差异文件直接覆盖
- **只增改、不删除**：远程删掉的文件本地保留；移动端本地文件不会被误删，也永远不会上传任何内容
- **私有库支持**：填写平台 Token 即可拉取私有仓库（GitHub 推荐 fine-grained 只读令牌，Gitee/GitCode 用私人令牌）
- **Token 级联下拉**：填入 Token 后，仓库、分支、提交、子目录全部自动加载为下拉框，全程只选不填，避免输错
- **版本回退**：可在设置中下拉选择某一次提交，始终拉取该版本（默认跟随分支最新）
- **安全过滤**：默认排除 `.obsidian/` 配置目录（可开关），始终排除 `.git/`、`.trash/`，支持自定义 glob 排除规则
- **全平台可用**：桌面、手机、平板均可使用，中英双语

### Features

- Built for reading on phones and tablets: pull the latest notes from GitHub / GitCode / Gitee with one tap, no git client required
- Preview added / modified / unchanged files via git blob SHA comparison, then overwrite in one tap
- One-way only: files are added or updated, never deleted, and nothing is ever uploaded
- Private repositories supported via a fine-grained read-only token
- Cascading dropdowns for repository, branch, commit and subfolder after entering a token — pick, don't type
- Optionally pin a specific commit from a dropdown; follows the branch latest by default
- Excludes `.obsidian/` by default (toggleable), always excludes `.git/` and `.trash/`, custom glob patterns supported
- Works on desktop, iOS/iPadOS and Android; bilingual Chinese/English UI

## 适用场景与边界

| 这个插件做 | 这个插件不做 |
|---|---|
| 把远程仓库（GitHub / GitCode / Gitee）的资料拉到本地查看 | 不上传、不回传本地修改 |
| 差异预览后一键覆盖更新 | 不做三方合并、不处理冲突 |
| 只增改文件，不删除本地文件 | 不同步删除操作 |
| 无 `.git` 目录，移动端轻量 | 不提供提交历史、分支管理 |
| 适合：电脑端写、移动端看 | 不适合：移动端也要编辑并同步回电脑（请用 obsidian-git 等双向同步方案） |

建议把移动设备定位为**只读终端**：所有编辑在电脑端完成并推送，移动端只负责拉取和阅读。

## 安装

### 方式一：从 Obsidian 社区目录安装（推荐）

1. 打开 Obsidian 设置 → 社区插件
2. 点击「浏览」，搜索 "XU Git Pull"
3. 点击「安装」，然后「启用」

### 方式二：手动安装（Beta）

1. 从 [最新 Release](https://github.com/xcloud-ai/xu-git-pull/releases) 下载 `main.js`、`manifest.json`、`styles.css` 三个文件（国内网络可在链接前加 `https://gh-proxy.com/` 加速）
2. 在 vault 中创建目录 `.obsidian/plugins/xu-git-pull/`
3. 将三个文件放入该目录
4. 打开 Obsidian 设置 → 社区插件，找到 XU Git Pull 并开启

手机端也可使用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件，添加仓库 `xcloud-ai/xu-git-pull` 完成安装。

### Installation

**From Obsidian Community Directory:**
1. Open Obsidian Settings → Community Plugins
2. Click "Browse" and search for "XU Git Pull"
3. Click "Install", then "Enable"

**Manual Installation (Beta):**
1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/xcloud-ai/xu-git-pull/releases)
2. Put them in `<vault>/.obsidian/plugins/xu-git-pull/`
3. Enable in Settings → Community Plugins

You can also install the beta with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using `xcloud-ai/xu-git-pull`.

## 使用方法

**电脑端（资料来源）**：正常用 Obsidian 写作，把 vault（或其中的笔记目录）推送到远程仓库（GitHub / GitCode / Gitee），公开或私有均可。

**手机/平板（只看）**：

1. 新建或打开一个用于阅读的 vault，安装并启用插件
2. 设置 → XU Git Pull：选择平台并粘贴对应 Token（私有库必填，旁有「如何创建 Token？」与「直接创建」按钮），输入框失焦后自动加载
3. **仓库地址**：下拉选择要阅读的仓库
4. **分支**：下拉选择分支（默认分支 = 最新内容）
5. **仓库内子目录**（可选）：只拉某个文件夹；本地目标目录（可选）：在 vault 中的存放位置
6. 点击左侧边栏下载图标（或命令面板搜索「拉取远程文件」）
7. 在弹窗查看「新增 / 修改 / 无变化」清单，点击「全部下载」，完成后即可阅读

日常使用只有一步：打开 vault → 点下载图标 → 确认覆盖。想回看某次历史资料时，在设置中「指定提交」下拉选择对应版本再拉取即可。

### 私有库 Token 创建

各平台私有库均需 Token（设置页「直接创建」按钮可直达对应创建页，点击还会自动复制链接）：

- **GitHub**：<https://github.com/settings/personal-access-tokens/new>（fine-grained，推荐）→ Repository access 勾选笔记仓库 → Contents 选 Read-only（其余权限一律不给）→ 生成 `github_pat_` 开头令牌
- **GitCode**：设置 → 安全设置 → 私人令牌（classic）：<https://gitcode.com/setting/token-classic/create> → 生成令牌
- **Gitee**：设置 → 安全设置 → 私人令牌：<https://gitee.com/profile/personal_access_tokens> → 生成令牌

安全须知：Token 只保存在本机 `data.json` 中；若 vault 开启了 iCloud 等同步，请使用**短期、只读、可随时吊销**的令牌，且不要把 data.json 提交到任何仓库。

### Usage

1. Push notes from your computer to a remote repository (GitHub / GitCode / Gitee, public or private)
2. On the phone/tablet, open XU Git Pull settings, pick the platform and paste a token (required for private repos; buttons copy the link and open the docs/creation page), then pick the repository, branch and optional subfolder from the dropdowns
3. Tap the download ribbon icon (or run "Pull remote files" from the command palette)
4. Review added / modified / unchanged files, then tap "Download all"

The plugin is one-way: it only adds or updates local files, never uploads or deletes.

## 设置说明

| 设置项 | 说明 |
|--------|------|
| 界面语言 | 中文 / English，默认中文 |
| 代码托管平台 | 国内（🇨🇳 GitCode、Gitee）与国外（🌍 GitHub）分组下拉；当前版本已适配 GitHub、GitCode 与 Gitee（三平台 API 同构），其他平台后续按需添加。切换平台后，仓库、分支、提交、子目录、本地目录整组配置跟随平台切换，各平台独立记忆（未配置则为空），无需二次配置 |
| 平台 Token（如 GitHub Token） | 名称与帮助文档跟随所选平台，各平台令牌独立保存、切换互不影响；私有库必填，填入后下方仓库、分支、提交、子目录自动变为下拉选择；公开库可不填。「如何创建 / 直接创建」按钮点击后复制链接并打开，手机端可把链接转发到电脑操作 |
| 仓库地址 | 有 Token 时为下拉选择（令牌可访问的全部仓库）；无 Token 时手动输入 `owner/repo`（仅公开库） |
| 分支 | 下拉选择远程分支；留空项「默认分支（最新）」跟随仓库默认分支 |
| 指定提交 | 默认「跟随分支最新」；下拉选择某次提交后始终拉取该版本（列出所选分支最近 30 次），适合推送出错后回退 |
| 仓库内子目录 | 下拉选择后只拉取该目录；「/（整个仓库）」为默认 |
| 本地目标目录 | 下载到 vault 中的位置，留空为 vault 根目录 |
| 下载 .obsidian 配置目录 | 默认关闭，避免移动端配置被仓库覆盖；需要同步插件配置时手动开启 |
| 额外排除规则 | 每行一条 glob，`**` 匹配任意层级；`.git/`、`.trash/` 始终排除 |

## 命令列表

| 命令 | 作用 |
|------|------|
| 拉取远程文件（比对后覆盖） | 获取远程文件清单，比对本地并弹出差异预览，确认后一键下载覆盖 |

## 技术说明

- 不使用 isomorphic-git，不执行 clone/fetch/merge：文件清单走 Tree API（`/git/trees/{ref}?recursive=1`），本地文件按 git 规则计算 blob SHA-1（`blob <大小>\0<内容>`）与清单逐文件比对，无变化的文件零流量
- 文件下载双通道：配置 Token 时走 blob API（`/git/blobs/{sha}`，base64 解码，支持私有库与大文件）；匿名时 GitHub 走 raw 域名，GitCode/Gitee 公开库匿名走 blob API（已实测）
- 级联下拉数据分页获取并按令牌缓存（仓库、分支、提交、目录树），切换仓库/分支自动清空下游选择，过期请求自动丢弃
- 频率限额由各平台决定（GitHub 匿名 60 次/小时、带 Token 5000 次/小时）；401/403/404 均有中文错误提示
- 配置 Token 后运行时只访问对应平台 API 域名（`api.github.com` / `api.gitcode.com` / `gitee.com`）；符号链接自动跳过，含 `..` 的路径一律拒绝以防越界
- 无 Node/Electron 专有 API，`isDesktopOnly: false`，支持 iOS/iPadOS/Android

## 许可证

MIT License - Copyright (c) 2026 旭说
