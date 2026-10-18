# 远程资料拉取

> [!NOTE] 中文说明
> **远程资料拉取**：把 GitHub / GitCode / Gitee 仓库里的笔记和资料一键下载到手机、平板的 Obsidian 中查看，整仓克隆、一键覆盖，只下载不回传。

典型用法：电脑端把 Obsidian 笔记持续推送到远程仓库（GitHub / GitCode / Gitee），手机和平板只负责**看**。本插件不做双向同步、不在移动端维护长期 git 仓库，而是通过 git smart HTTP 对远程仓库做一次**浅克隆（depth=1，约 2 个请求拉全仓）**，按过滤规则把文件覆盖写入 vault 后即清理克隆数据——移动端不受 API 限流影响，专为「电脑推、移动看」的单向场景设计。

> English description below for review purposes. / 以下为英文说明，用于过审。

**XU Git Pull** downloads notes one-way from a GitHub / GitCode / Gitee repository (public or private) into a phone or tablet vault for reading. It performs a shallow git clone (depth=1, roughly 2 HTTP requests for the whole repo) over smart HTTP, then writes the fetched files into the vault according to your filter rules and cleans up afterwards — immune to hosting-platform API rate limits, and built for the "write on desktop, read on mobile" one-way scenario.

## 功能特性

- **移动端查看优先**：电脑端推送远程仓库，手机/平板点一下即可获得最新资料，无需电脑、无需 git 客户端
- **整仓克隆、不限流**：git 浅克隆约 2 个请求拉全仓，数千文件也不再触发平台 API 限流；克隆完成后按规则过滤写入
- **进度可见、随时取消**：克隆阶段显示计时心跳，写盘阶段显示精确进度（n/总数），点击状态栏或通知即可取消
- **只增改、不删除**：远程删掉的文件本地保留；移动端本地文件不会被误删，也永远不会上传任何内容
- **私有库支持**：填写平台 Token 即可拉取私有仓库（GitHub 推荐 fine-grained 只读令牌，Gitee/GitCode 用私人令牌）
- **Token 级联下拉**：填入 Token 后，仓库、分支、子目录全部自动加载为下拉框，全程只选不填，避免输错
- **安全过滤**：默认排除 `.obsidian/` 配置目录（可开关），始终排除 `.git/`、`.trash/`，支持自定义 glob 排除规则
- **全平台可用**：桌面、手机、平板均可使用，中英双语

### Features

- Built for reading on phones and tablets: pull the latest notes from GitHub / GitCode / Gitee with one tap, no git client required
- Shallow git clone fetches the whole repo in roughly 2 requests — no more platform API rate limits even with thousands of files; files are filtered into the vault after cloning
- Visible progress: heartbeat during clone, precise file count during write-out, tap to cancel at any time
- One-way only: files are added or updated, never deleted, and nothing is ever uploaded
- Private repositories supported via a fine-grained read-only token
- Cascading dropdowns for repository, branch and subfolder after entering a token — pick, don't type
- Excludes `.obsidian/` by default (toggleable), always excludes `.git/` and `.trash/`, custom glob patterns supported
- Works on desktop, iOS/iPadOS and Android; bilingual Chinese/English UI

## 适用场景与边界

| 这个插件做 | 这个插件不做 |
|---|---|
| 把远程仓库（GitHub / GitCode / Gitee）的资料拉到本地查看 | 不上传、不回传本地修改 |
| 整仓克隆后一键覆盖更新 | 不做三方合并、不处理冲突 |
| 只增改文件，不删除本地文件 | 不同步删除操作 |
| 克隆数据写盘后即清理，不留 `.git` 目录 | 不提供提交历史、分支管理 |
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
7. 插件先验证远程仓库可访问，随即整仓克隆并按过滤规则覆盖写入，完成后通知汇总（新增 n / 更新 m），即可阅读

日常使用只有一步：打开 vault → 点下载图标 → 等完成通知。

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
4. The plugin verifies the remote repository, shallow-clones it and overwrites local files according to your filter rules, then shows a summary notice when done

The plugin is one-way: it only adds or updates local files, never uploads or deletes.

## 设置说明

| 设置项 | 说明 |
|--------|------|
| 界面语言 | 中文 / English，默认中文 |
| 代码托管平台 | 国内（🇨🇳 GitCode、Gitee）与国外（🌍 GitHub）分组下拉；当前版本已适配 GitHub、GitCode 与 Gitee（三平台 git 协议同构），其他平台后续按需添加。切换平台后，仓库、分支、子目录、本地目录整组配置跟随平台切换，各平台独立记忆（未配置则为空），无需二次配置 |
| 平台 Token（如 GitHub Token） | 名称与帮助文档跟随所选平台，各平台令牌独立保存、切换互不影响；私有库必填，填入后下方仓库、分支、子目录自动变为下拉选择；公开库可不填。「如何创建 / 直接创建」按钮点击后复制链接并打开，手机端可把链接转发到电脑操作 |
| 仓库地址 | 有 Token 时为下拉选择（令牌可访问的全部仓库）；无 Token 时手动输入 `owner/repo`（仅公开库） |
| 分支 | 下拉选择远程分支；留空项「默认分支（最新）」跟随仓库默认分支 |
| 仓库内子目录 | 下拉选择后只拉取该目录；「/（整个仓库）」为默认 |
| 本地目标目录 | 下载到 vault 中的位置，留空为 vault 根目录 |
| 下载 .obsidian 配置目录 | 默认关闭，避免移动端配置被仓库覆盖；需要同步插件配置时手动开启 |
| 额外排除规则 | 每行一条 glob，`**` 匹配任意层级；`.git/`、`.trash/` 始终排除 |

## 命令列表

| 命令 | 作用 |
|------|------|
| 拉取远程文件（整仓覆盖） | 验证远程仓库后整仓克隆并覆盖更新本地文件 |

## 技术说明

- 通过 git smart HTTP 对远程仓库做浅克隆（depth=1）：`info/refs?service=git-upload-pack` + `upload-pack` 两个请求拉全仓，与 REST API 是两套独立配额，实测 GitCode 连发多次零限流
- 克隆由内置的 isomorphic-git（v1.44.2）+ LightningFS 完成，全部打包进 main.js，零外部 require 依赖，桌面/移动端行为一致；克隆数据写入内存级 IndexedDB 文件系统，写盘完成后清理
- 写盘按过滤规则执行：始终排除 `.git/`、`.trash/`，默认排除 `.obsidian/`（可开关），支持自定义 glob；克隆中新文件先落盘，远程已删除的本地文件保留不动
- 设置页级联下拉（仓库/分支/子目录）仍走各平台 REST API 并按令牌缓存，仅低频调用
- 克隆超时 5 分钟（可取消）；401/404 等验证失败均有中文错误提示
- 无 Node/Electron 专有 API，`isDesktopOnly: false`，支持 iOS/iPadOS/Android

## 许可证

MIT License - Copyright (c) 2026 旭说
