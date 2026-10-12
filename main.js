/* XU Git Pull — 远程资料拉取：从 GitHub（公开/私有）仓库单向下载指定分支/提交的文件到 vault，比对后一键覆盖更新. */
'use strict';

const obsidianApi = require('obsidian');
const { Plugin, Notice, Modal, Setting, PluginSettingTab, requestUrl, normalizePath } = obsidianApi;

const PLUGIN_ID = 'xu-git-pull';
const REPO_URL = 'https://github.com/xcloud-ai/xu-git-pull';
// 仅 GitHub 匿名下载走 raw 直连；GitCode/Gitee 公开库匿名也走 blob API（已实测支持）
const RAW_BASE = 'https://raw.githubusercontent.com';

// ================================================================
//  i18n
// ================================================================
const I18N = {
  zh: {
    cmd_pull: '拉取远程文件（比对后覆盖）',
    ribbon_pull: '拉取远程文件',
    notice_no_repo: '请先在设置中填写 GitHub 仓库（owner/repo）',
    notice_repo_invalid: '仓库格式不正确，应为 owner/repo',
    notice_checking: '正在获取远程文件清单…',
    notice_fetch_failed: '获取远程信息失败：{msg}',
    notice_repo_not_found: '仓库不存在、无权限，或为私有库（私有库需在高级设置中填写 Token）',
    notice_unauthorized: 'Token 无效或已过期，请检查后重试',
    notice_rate_limited: 'GitHub 访问频率超限，可在高级设置中检查/更换 Token',
    notice_tree_truncated: '仓库文件过多，远程清单被截断，请缩小「仓库内子目录」范围',
    notice_up_to_date: '已是最新，没有需要下载的文件',
    modal_title: '远程变更确认',
    modal_desc: '仓库 {repo}（{ref}）与本地比对结果。下载后差异文件将直接覆盖本地，不会删除本地文件。',
    summary: '新增 {add} · 修改 {mod} · 无变化 {same}',
    label_add: '新增',
    label_modify: '修改',
    label_same: '无变化',
    btn_download_all: '全部下载（{n} 项变更）',
    btn_cancel: '取消',
    downloading: '正在下载 {index}/{total}：{name}',
    notice_done: '下载完成：{n} 个文件已更新',
    notice_failed: '{ok} 个成功，{fail} 个失败：{names}（原因：{reason}）',
    setting_title: 'XU Git Pull（远程资料拉取）',
    setting_header_desc: '从 GitHub 仓库（支持私有库）单向拉取文件到本 vault：比对远程与本地差异，确认后一键覆盖，适合手机/平板只看资料的场景。只增改，不删除本地文件。',
    setting_language: '界面语言',
    lang_zh: '中文',
    lang_en: 'English',
    sec_repo: '仓库设置',
    setting_platform: '代码托管平台',
    setting_platform_desc: '选择远程仓库所在平台。当前版本已支持 GitHub、GitCode 与 Gitee，其他平台后续按需添加。',
    notice_platform_unsupported: '「{name}」平台将在后续版本支持，当前版本请先选择 GitHub',
    grp_domestic: '🇨🇳 国内',
    grp_overseas: '🌍 国外',
    pn_github: 'GitHub',
    pn_gitcode: 'GitCode',
    pn_gitee: 'Gitee（码云）',
    setting_repo: '仓库地址',
    setting_repo_desc: '填写 Token 后此处自动列出可访问的仓库，直接选择即可；未填 Token 时手动输入 owner/repo（仅公开库）',
    setting_ref: '分支',
    setting_ref_desc: '选择远程分支，默认拉取该分支的最新内容',
    ref_default: '默认分支（最新）',
    ref_select_first: '请先选择仓库',
    setting_remote_path: '仓库内子目录',
    setting_remote_path_desc: '自动列出仓库内文件夹，选择后只拉取该目录；选「/」表示整个仓库',
    folder_root: '/（整个仓库）',
    folder_select_first: '请先选择分支',
    setting_local_path: '本地目标目录',
    setting_local_path_desc: '下载到 vault 中的位置，留空表示 vault 根目录',
    sec_filter: '过滤',
    setting_include_obsidian: '下载 .obsidian 配置目录',
    setting_include_obsidian_desc: '默认关闭（排除 .obsidian/，避免覆盖本机插件与外观配置）。需要同步插件配置时手动开启。',
    setting_exclude: '额外排除规则（每行一条 glob）',
    setting_exclude_desc: '始终排除 .git/ 与 .trash/；此处可追加，** 匹配任意层级目录，* 匹配单层名称',
    action_pull: '立即检查并拉取',
    action_pull_desc: '获取远程文件清单，比对后覆盖更新',
    setting_token: '{name} Token',
    setting_token_desc: '私有库必填，公开库可不填。填写后下方仓库、分支、提交、子目录自动加载为下拉选择，无需手填。各平台令牌独立保存在本设备 data.json 中，切换平台互不影响。建议使用只读权限的最小授权令牌。',
    ph_github: 'github_pat_…',
    ph_gitcode: 'GitCode 个人访问令牌',
    ph_gitee: 'Gitee 私人令牌',
    notice_link_copied: '链接已复制，可发送到电脑打开',
    btn_token_docs: '如何创建 Token？',
    btn_token_create: '直接创建',
    setting_commit_select: '指定提交（可选）',
    setting_commit_select_desc: '默认跟随分支最新；选择某次提交后始终拉取该版本，适合推送出错后回退。列表为所选分支最近 30 次提交',
    commit_latest: '跟随分支最新（默认）',
    list_loading: '列表加载中…',
    list_failed: '加载失败，点右侧刷新重试',
    btn_refresh: '刷新列表',
    setting_docs: '使用文档',
    btn_github: 'GitHub',
  },
  en: {
    cmd_pull: 'Pull remote files (compare and overwrite)',
    ribbon_pull: 'Pull remote files',
    notice_no_repo: 'Set a GitHub repository (owner/repo) in settings first',
    notice_repo_invalid: 'Invalid repository format, expected owner/repo',
    notice_checking: 'Fetching remote file list…',
    notice_fetch_failed: 'Failed to fetch remote info: {msg}',
    notice_repo_not_found: 'Repository not found, inaccessible, or private (a token is required for private repos)',
    notice_unauthorized: 'Token is invalid or expired. Check it and try again.',
    notice_rate_limited: 'GitHub rate limit exceeded. Check/refresh the token in advanced settings.',
    notice_tree_truncated: 'Repository too large, remote tree was truncated. Narrow the remote subfolder.',
    notice_up_to_date: 'Up to date — nothing to download',
    modal_title: 'Confirm remote changes',
    modal_desc: 'Diff between {repo} ({ref}) and local. Downloading overwrites changed local files; local files are never deleted.',
    summary: '{add} added · {mod} modified · {same} unchanged',
    label_add: 'Added',
    label_modify: 'Modified',
    label_same: 'Unchanged',
    btn_download_all: 'Download all ({n} changes)',
    btn_cancel: 'Cancel',
    downloading: 'Downloading {index}/{total}: {name}',
    notice_done: 'Download complete: {n} file(s) updated',
    notice_failed: '{ok} succeeded, {fail} failed: {names} (reason: {reason})',
    setting_title: 'XU Git Pull',
    setting_header_desc: 'One-way pull from a GitHub repo (private supported) into this vault: compare remote vs local, then overwrite with one tap — ideal for read-only phones/tablets. Files are added/updated, never deleted.',
    setting_language: 'UI language',
    lang_zh: '中文',
    lang_en: 'English',
    sec_repo: 'Repository',
    setting_platform: 'Hosting platform',
    setting_platform_desc: 'Where the remote repository is hosted. GitHub, GitCode and Gitee are supported now; more platforms will be added as needed.',
    notice_platform_unsupported: '{name} support is coming soon. Please choose GitHub in this version.',
    grp_domestic: '🇨🇳 China',
    grp_overseas: '🌍 Overseas',
    pn_github: 'GitHub',
    pn_gitcode: 'GitCode',
    pn_gitee: 'Gitee',
    setting_repo: 'Repository',
    setting_repo_desc: 'With a token set, accessible repositories are listed here for picking; without a token, type owner/repo manually (public repos only)',
    setting_ref: 'Branch',
    setting_ref_desc: 'Pick a remote branch; the latest commit on it is pulled',
    ref_default: 'Default branch (latest)',
    ref_select_first: 'Pick a repository first',
    setting_remote_path: 'Remote subfolder',
    setting_remote_path_desc: 'Repository folders are listed automatically; pick one to pull only that folder, or "/" for the whole repo',
    folder_root: '/ (whole repository)',
    folder_select_first: 'Pick a branch first',
    setting_local_path: 'Local destination folder',
    setting_local_path_desc: 'Where to download inside the vault; empty = vault root',
    sec_filter: 'Filtering',
    setting_include_obsidian: 'Download the .obsidian config folder',
    setting_include_obsidian_desc: 'Off by default (excludes .obsidian/ to avoid overwriting local plugins and appearance). Turn on to sync plugin config.',
    setting_exclude: 'Extra exclude patterns (one glob per line)',
    setting_exclude_desc: '.git/ and .trash/ are always excluded. Add more here. ** matches any depth, * a single segment.',
    action_pull: 'Check and pull now',
    action_pull_desc: 'Fetch the remote file list, compare, and overwrite',
    setting_token: '{name} token',
    setting_token_desc: 'Required for private repos, optional for public. Once set, repository, branch, commit and subfolder become dropdowns — no typing. Tokens are stored per platform in local data.json; switching platforms never mixes them. A minimal read-only token is recommended.',
    ph_github: 'github_pat_…',
    ph_gitcode: 'GitCode personal access token',
    ph_gitee: 'Gitee personal access token',
    notice_link_copied: 'Link copied — paste it on your computer',
    btn_token_docs: 'How to create a token?',
    btn_token_create: 'Create one',
    setting_commit_select: 'Pin commit (optional)',
    setting_commit_select_desc: 'Follows the branch latest by default; pick a commit to always pull that version — handy for rolling back a bad push. Lists the 30 most recent commits on the selected branch',
    commit_latest: 'Follow branch (latest)',
    list_loading: 'Loading list…',
    list_failed: 'Load failed, click refresh to retry',
    btn_refresh: 'Refresh list',
    setting_docs: 'Documentation',
    btn_github: 'GitHub',
  },
};

// 平台清单：国内在前（GitCode/Gitee），国外在后（GitHub）；均可用
// 三平台 API 同构（Gitee v5 兼容风格），仅 base URL 不同；tokenCreate/tokenDoc 跟随平台
const PLATFORMS = [
  {
    id: 'gitcode', group: 'domestic', available: true,
    apiBase: 'https://api.gitcode.com/api/v5',
    // 令牌创建页：设置 → 安全设置 → 私人令牌（classic）
    tokenCreate: 'https://gitcode.com/setting/token-classic/create',
    tokenDoc: { zh: 'https://docs.gitcode.com/en/docs/oauth/', en: 'https://docs.gitcode.com/en/docs/oauth/' },
  },
  {
    id: 'gitee', group: 'domestic', available: true,
    apiBase: 'https://gitee.com/api/v5',
    // 令牌创建页：设置 → 安全设置 → 私人令牌
    tokenCreate: 'https://gitee.com/profile/personal_access_tokens',
    tokenDoc: { zh: 'https://gitee.com/api/v5/swagger', en: 'https://gitee.com/api/v5/swagger' },
  },
  {
    id: 'github', group: 'overseas', available: true,
    apiBase: 'https://api.github.com',
    tokenCreate: 'https://github.com/settings/personal-access-tokens/new',
    tokenDoc: {
      zh: 'https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
      en: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    },
  },
];

// 仓库链路字段：按平台隔离（切换平台整组换装），过滤项保持全局
const PROFILE_KEYS = ['repo', 'ref', 'commitSha', 'remotePath', 'localPath'];

function defaultProfile() {
  const p = {};
  for (const k of PROFILE_KEYS) p[k] = '';
  return p;
}

const DEFAULT_SETTINGS = {
  language: 'zh',
  platform: 'github',
  // 仓库链路「活跃字段」：声明式控件直接读写顶层，切换平台时整组换装（快照存 profiles）
  repo: '',
  ref: '',
  commitSha: '',
  remotePath: '',
  localPath: '',
  includeObsidian: false,
  exclude: '',
  tokens: { github: '', gitcode: '', gitee: '' },
  profiles: { github: defaultProfile(), gitcode: defaultProfile(), gitee: defaultProfile() },
};

// ================================================================
//  工具函数
// ================================================================

function trimSlashes(s) {
  return String(s || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** glob 行规则编译为正则；匹配以 / 分隔的相对路径 */
function compileGlob(pattern) {
  const p = trimSlashes(pattern);
  if (!p) return null;
  let re = '';
  const parts = p.split('**');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) re += '.*';
    re += parts[i]
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
  }
  return new RegExp('^(.*/)?' + re + '$');
}

function matchAny(pathRel, matchers) {
  for (const m of matchers) {
    if (m && m.test(pathRel)) return true;
  }
  return false;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/** 计算字节内容的 git blob SHA-1（与 GitHub tree 中的 blob sha 一致） */
async function gitBlobSha(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const prefix = new TextEncoder().encode('blob ' + bytes.byteLength + '\0');
  const buf = new Uint8Array(prefix.length + bytes.byteLength);
  buf.set(prefix, 0);
  buf.set(bytes, prefix.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** GitHub blob API 返回的 base64 内容解码为 ArrayBuffer（二进制安全） */
function base64ToArrayBuffer(b64) {
  const bin = atob(String(b64).replace(/[^A-Za-z0-9+/=]/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ================================================================
//  插件主体
// ================================================================
class GitPullPlugin extends Plugin {
  t(key, params) {
    const dict = I18N[this.settings.language] || I18N.zh;
    let text = dict[key] || key;
    if (params) {
      for (const k of Object.keys(params)) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      }
    }
    return text;
  }

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
    // tokens / profiles 浅合并（旧配置可能缺 gitcode 键），profile 逐键补默认
    this.settings.tokens = Object.assign({}, DEFAULT_SETTINGS.tokens, this.settings.tokens || {});
    this.settings.profiles = Object.assign({}, DEFAULT_SETTINGS.profiles, this.settings.profiles || {});
    for (const pf of Object.keys(this.settings.profiles)) {
      this.settings.profiles[pf] = Object.assign(defaultProfile(), this.settings.profiles[pf] || {});
    }
    // 旧版单 token 字段迁移（历史配置只可能是 GitHub Token）
    if (this.settings.token) {
      if (!this.settings.tokens.github) this.settings.tokens.github = String(this.settings.token).trim();
      delete this.settings.token;
      void this.saveSettings();
    }
    // 旧版平铺仓库链路字段迁移为 GitHub 档案（活跃顶层字段保留）
    if (this.settings.repo !== undefined && !this.settings.profiles.github.repo) {
      const g = this.settings.profiles.github;
      g.repo = this.settings.repo || '';
      g.ref = this.settings.ref || '';
      g.commitSha = this.settings.commitSha || '';
      g.remotePath = this.settings.remotePath || '';
      g.localPath = this.settings.localPath || '';
      void this.saveSettings();
    }
    this.addSettingTab(new GitPullSettingTab(this.app, this));

    this.addRibbonIcon('download', this.t('ribbon_pull'), () => { void this.pull(); });

    this.addCommand({
      id: 'pull-latest',
      name: this.t('cmd_pull'),
      callback: () => { void this.pull(); },
    });

    console.log('[' + PLUGIN_ID + '] loaded');
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** 当前平台的 API 基址（三平台端点同构，仅基址不同） */
  apiBase() {
    const pf = PLATFORMS.find((x) => x.id === (this.settings.platform || 'github')) || PLATFORMS.find((x) => x.available);
    return pf.apiBase;
  }

  /** 当前平台的令牌（按平台独立存储，切换平台互不影响） */
  token() {
    const t = this.settings.tokens || {};
    return String(t[this.settings.platform] || '').trim();
  }

  /** 仓库链路快照：抓取顶层活跃字段（切平台前调用） */
  profileSnapshot() {
    const s = this.settings;
    return { repo: s.repo || '', ref: s.ref || '', commitSha: s.commitSha || '', remotePath: s.remotePath || '', localPath: s.localPath || '' };
  }

  /** 恢复仓库链路快照到顶层活跃字段（切平台后调用） */
  applyProfile(snap) {
    for (const k of PROFILE_KEYS) this.settings[k] = String((snap && snap[k]) || '');
  }

  headers() {
    const h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = this.token();
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  /** 解析并校验设置 */
  resolveConfig() {
    const platform = PLATFORMS.find((x) => x.id === this.settings.platform) || PLATFORMS.find((x) => x.available);
    if (!platform.available) {
      return { error: this.t('notice_platform_unsupported', { name: this.t('pn_' + platform.id) }) };
    }
    const repoRaw = trimSlashes(this.settings.repo);
    if (!repoRaw) return { error: this.t('notice_no_repo') };
    // owner/repo；Gitee/GitCode 允许嵌套命名空间（org/group/repo），URL 按完整路径拼接
    const m = repoRaw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+?)(?:\.git)?$/);
    if (!m) return { error: this.t('notice_repo_invalid') };

    // 始终排除 .git/.trash；.obsidian 由开关决定；再拼用户自定义规则
    const patterns = ['.git/**', '.trash/**'];
    if (!this.settings.includeObsidian) patterns.push('.obsidian/**');
    const matchers = patterns
      .concat(String(this.settings.exclude || '').split('\n').map((s) => s.trim()))
      .map(compileGlob)
      .filter(Boolean);

    return {
      platform: platform.id,
      owner: m[1],
      repo: m[2],
      // 指定提交优先（版本回退）；否则用下拉选择的分支（空 = 默认分支最新）
      ref: trimSlashes(this.settings.commitSha) || trimSlashes(this.settings.ref),
      remotePath: trimSlashes(this.settings.remotePath),
      localPath: trimSlashes(this.settings.localPath),
      matchers,
    };
  }

  async apiGetJson(url) {
    let res;
    try {
      res = await requestUrl({ url, method: 'GET', headers: this.headers() });
    } catch (err) {
      if (err && err.status === 401) {
        const e = new Error(this.t('notice_unauthorized'));
        e.code = 'unauthorized';
        throw e;
      }
      if (err && (err.status === 404 || err.status === 422)) {
        // 匿名访问私有库时 GitHub 同样返回 404（不暴露仓库存在性）
        const e = new Error(this.t('notice_repo_not_found'));
        e.code = 'not_found';
        throw e;
      }
      if (err && err.status === 403) {
        const remain = err.response?.headers?.['x-ratelimit-remaining'];
        if (remain === '0' || remain === 0) {
          const e = new Error(this.t('notice_rate_limited'));
          e.code = 'rate_limited';
          throw e;
        }
        // 403 也可能是令牌权限不足
        const e = new Error(this.t('notice_unauthorized'));
        e.code = 'unauthorized';
        throw e;
      }
      throw err;
    }
    return res.json;
  }

  // ---------------- 级联下拉数据（仓库 → 分支 → 子目录） ----------------

  cacheGet(key) {
    return (this._listCache ||= {})[key];
  }

  cacheSet(key, value) {
    (this._listCache ||= {})[key] = value;
    return value;
  }

  cacheClear(prefix) {
    const c = this._listCache ||= {};
    for (const k of Object.keys(c)) {
      if (!prefix || k.startsWith(prefix)) delete c[k];
    }
  }

  /** Token 可访问的仓库全名列表（最多 5 页 500 个） */
  async fetchRepoList(force) {
    const token = this.token();
    const key = 'repos:' + token;
    if (!force) {
      const hit = this.cacheGet(key);
      if (hit) return hit;
    }
    if (!token) return [];
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await this.apiGetJson(this.apiBase() + '/user/repos?per_page=100&page=' + page +
        '&sort=updated&affiliation=owner,collaborator,organization_member');
      all.push(...data);
      if (data.length < 100) break;
    }
    const names = all.map((r) => r.full_name).sort((a, b) => a.localeCompare(b));
    // 换 token 时清掉下游缓存
    this.cacheClear('branches:');
    this.cacheClear('folders:');
    return this.cacheSet(key, names);
  }

  /** 某仓库的分支名列表 */
  async fetchBranchList(owner, repo, force) {
    const key = 'branches:' + (this.token() ? 't' : 'a') + ':' + owner + '/' + repo;
    if (!force) {
      const hit = this.cacheGet(key);
      if (hit) return hit;
    }
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo +
        '/branches?per_page=100&page=' + page);
      all.push(...data.map((b) => b.name));
      if (data.length < 100) break;
    }
    this.cacheClear('folders:');
    return this.cacheSet(key, all);
  }

  /** 某仓库某分支下的文件夹路径列表（含根目录） */
  async fetchFolderList(owner, repo, branch, force) {
    const key = 'folders:' + (this.token() ? 't' : 'a') + ':' + owner + '/' + repo + '@' + (branch || ':default');
    if (!force) {
      const hit = this.cacheGet(key);
      if (hit) return hit;
    }
    let ref = branch;
    if (!ref) {
      const info = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo);
      ref = info.default_branch || 'main';
    }
    const tree = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo +
      '/git/trees/' + encodeURIComponent(ref) + '?recursive=1');
    const folders = (tree.tree || [])
      .filter((it) => it.type === 'tree')
      .map((it) => it.path)
      .sort((a, b) => a.localeCompare(b));
    return this.cacheSet(key, folders);
  }

  /** 某仓库某分支最近 30 次提交（供「指定提交」下拉做版本回退） */
  async fetchCommitList(owner, repo, branch, force) {
    const key = 'commits:' + (this.token() ? 't' : 'a') + ':' + owner + '/' + repo + '@' + (branch || ':default');
    if (!force) {
      const hit = this.cacheGet(key);
      if (hit) return hit;
    }
    let ref = branch;
    if (!ref) {
      const info = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo);
      ref = info.default_branch || 'main';
    }
    const data = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo +
      '/commits?sha=' + encodeURIComponent(ref) + '&per_page=30');
    const list = (Array.isArray(data) ? data : []).map((c) => {
      const msg = String((c.commit && c.commit.message) || '').split('\n')[0];
      const date = String((c.commit && c.commit.author && c.commit.author.date) || '').slice(0, 10);
      return { value: c.sha, label: c.sha.slice(0, 7) + ' · ' + date + ' · ' + msg.slice(0, 40) };
    });
    return this.cacheSet(key, list);
  }

  /** 拉取并比对，弹出确认 Modal */
  async pull() {
    const cfg = this.resolveConfig();
    if (cfg.error) {
      new Notice(cfg.error, 4000);
      return;
    }

    const notice = new Notice(this.t('notice_checking'), 0);
    let ref = cfg.ref;
    try {
      if (!ref) {
        const info = await this.apiGetJson(this.apiBase() + '/repos/' + cfg.owner + '/' + cfg.repo);
        ref = info.default_branch || 'main';
      }
      const treeUrl = this.apiBase() + '/repos/' + cfg.owner + '/' + cfg.repo +
        '/git/trees/' + encodeURIComponent(ref) + '?recursive=1';
      const tree = await this.apiGetJson(treeUrl);

      if (tree.truncated) {
        notice.hide();
        new Notice(this.t('notice_tree_truncated'), 5000);
        return;
      }

      const prefix = cfg.remotePath ? cfg.remotePath + '/' : '';
      const entries = [];
      for (const item of tree.tree) {
        if (item.type !== 'blob' || item.mode === '120000') continue;
        if (prefix && !item.path.startsWith(prefix)) continue;
        const rel = prefix ? item.path.slice(prefix.length) : item.path;
        if (!rel || rel.split('/').includes('..')) continue; // 防越界
        if (matchAny(rel, cfg.matchers)) continue;
        const localPath = normalizePath(cfg.localPath ? cfg.localPath + '/' + rel : rel);
        let status = 'add';
        try {
          const exists = await this.app.vault.adapter.exists(localPath);
          if (exists) {
            const buf = await this.app.vault.adapter.readBinary(localPath);
            status = (await gitBlobSha(buf)) === item.sha ? 'same' : 'modify';
          }
        } catch (e) {
          status = 'add'; // 本地读取异常按新增处理，下载时会暴露真实错误
        }
        entries.push({ rel, localPath, sha: item.sha, size: item.size, status });
      }

      notice.hide();
      if (!entries.some((e) => e.status !== 'same')) {
        new Notice(this.t('notice_up_to_date'), 3000);
        return;
      }
      new PullPreviewModal(this.app, this, entries, {
        owner: cfg.owner,
        repo: cfg.repo,
        ref,
        prefix,
      }).open();
    } catch (err) {
      notice.hide();
      const msg = err?.code ? err.message : this.t('notice_fetch_failed', { msg: String(err && err.message || err) });
      new Notice(msg, 5000);
      console.error('[' + PLUGIN_ID + ']', err);
    }
  }

  /**
   * 下载单个文件：
   * - 配置了 Token（含私有库）：走 blob API，按 sha 取 base64 解码，支持大文件，不依赖 ref
   * - Gitee/GitCode：公开库匿名也走 blob API（已实测 Gitee 匿名 200）
   * - GitHub 匿名（公开库）：走 raw 直连，不消耗 API 配额
   */
  async downloadBlob(meta, entry) {
    const pf = PLATFORMS.find((x) => x.id === this.settings.platform) || PLATFORMS.find((x) => x.available);
    const token = this.token();
    if (token || pf.id !== 'github') {
      const url = this.apiBase() + '/repos/' + meta.owner + '/' + meta.repo + '/git/blobs/' + entry.sha;
      const res = await requestUrl({ url, method: 'GET', headers: token ? this.headers() : {} });
      return base64ToArrayBuffer(res.json.content);
    }
    const relPath = entry.rel.split('/').map(encodeURIComponent).join('/');
    const url = RAW_BASE + '/' + meta.owner + '/' + meta.repo + '/' +
      encodeURIComponent(meta.ref) + '/' + meta.prefix + relPath;
    const res = await requestUrl({ url, method: 'GET' });
    return res.arrayBuffer;
  }
}

// ================================================================
//  变更确认 Modal（只读清单 + 一键覆盖）
// ================================================================
class PullPreviewModal extends Modal {
  constructor(app, plugin, entries, meta) {
    super(app);
    this.plugin = plugin;
    this.entries = entries;
    this.meta = meta;
    this.busy = false;
  }

  t(key, params) { return this.plugin.t(key, params); }

  onOpen() {
    const { contentEl, titleEl, modalEl } = this;
    modalEl.addClass('xu-gp-modal');

    titleEl.setText(this.t('modal_title'));
    contentEl.createDiv({
      cls: 'xu-gp-desc',
      text: this.t('modal_desc', { repo: this.meta.owner + '/' + this.meta.repo, ref: this.meta.ref }),
    });

    const counts = { add: 0, modify: 0, same: 0 };
    for (const e of this.entries) counts[e.status]++;
    contentEl.createDiv({
      cls: 'xu-gp-summary',
      text: this.t('summary', { add: counts.add, mod: counts.modify, same: counts.same }),
    });

    // 文件清单（先变更后无变化，每组内按路径排序）
    const list = contentEl.createDiv({ cls: 'xu-gp-list' });
    const order = { add: 0, modify: 1, same: 2 };
    const sorted = this.entries.slice().sort((a, b) => (order[a.status] - order[b.status]) || a.rel.localeCompare(b.rel));
    for (const e of sorted) {
      const row = list.createDiv({ cls: 'xu-gp-row xu-gp-' + e.status });
      row.createSpan({ cls: 'xu-gp-badge xu-gp-badge-' + e.status, text: this.t('label_' + e.status) });
      row.createSpan({ cls: 'xu-gp-path', text: e.rel });
      row.createSpan({ cls: 'xu-gp-size', text: formatSize(e.size) });
    }

    // 进度条
    this.progressWrap = contentEl.createDiv({ cls: 'xu-gp-progress-wrap' });
    this.progressWrap.createDiv({ cls: 'xu-gp-progress' }).createDiv({ cls: 'xu-gp-progress-bar' });
    this.progressText = this.progressWrap.createDiv({ cls: 'xu-gp-progress-text' });
    this.progressWrap.hide();

    // 底部按钮
    const changes = this.entries.filter((e) => e.status !== 'same');
    const footer = contentEl.createDiv({ cls: 'xu-gp-footer' });
    new Setting(footer)
      .addButton((b) => {
        this.downloadBtn = b;
        b.setCta();
        b.setButtonText(this.t('btn_download_all', { n: changes.length }));
        b.onClick(() => { void this.runDownload(); });
      })
      .addButton((b) => b.setButtonText(this.t('btn_cancel')).onClick(() => {
        if (!this.busy) this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }

  setProgress(index, total, name) {
    const pct = total ? Math.round((index / total) * 100) : 0;
    this.progressWrap.querySelector('.xu-gp-progress-bar').style.setProperty('--xu-gp-pct', pct + '%');
    this.progressText.setText(this.t('downloading', { index, total, name }));
  }

  async runDownload() {
    const targets = this.entries.filter((e) => e.status !== 'same');
    if (targets.length === 0 || this.busy) return;
    this.busy = true;
    this.downloadBtn.setDisabled(true);
    this.progressWrap.show();

    let ok = 0;
    const failed = [];
    let firstError = '';
    let i = 0;
    for (const e of targets) {
      i++;
      this.setProgress(i - 1, targets.length, e.rel);
      try {
        const buf = await this.plugin.downloadBlob(this.meta, e);
        // writeBinary 不会自动创建目录：先逐级确保父目录存在（否则新子目录下全部下载失败）
        const slash = e.localPath.lastIndexOf('/');
        if (slash > 0) await this.ensureDir(e.localPath.slice(0, slash));
        await this.app.vault.adapter.writeBinary(e.localPath, buf);
        ok++;
      } catch (err) {
        console.error('[' + PLUGIN_ID + '] download failed:', e.rel, err);
        failed.push(e.rel);
        if (!firstError) firstError = (err && err.message) || String(err);
      }
    }
    this.setProgress(targets.length, targets.length, '');

    if (failed.length === 0) {
      new Notice(this.t('notice_done', { n: ok }), 3000);
      this.busy = false;
      this.close();
    } else {
      new Notice(this.t('notice_failed', { ok, fail: failed.length, names: failed.slice(0, 3).join(', '), reason: firstError.slice(0, 120) }), 6000);
      this.busy = false;
      this.downloadBtn.setDisabled(false);
    }
  }

  // 逐级创建目录（mkdir 非递归；已存在时忽略报错）
  async ensureDir(path) {
    const adapter = this.app.vault.adapter;
    const segs = path.split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      cur = cur ? cur + '/' + s : s;
      if (!(await adapter.exists(cur))) {
        try {
          await adapter.mkdir(cur);
        } catch (_) {
          /* 已存在（并发）时忽略 */
        }
      }
    }
  }
}

// ================================================================
//  设置页（1.13 声明式 Path A）
// ================================================================
class GitPullSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  t(key, params) { return this.plugin.t(key, params); }

  getSettingDefinitions() {
    const p = this.plugin;
    // 每次重绘计数 +1，异步回调据此丢弃过期结果
    this.seq = (this.seq || 0) + 1;
    return [
      // 头部说明（empty 定义，不进搜索）
      { name: p.t('setting_title'), desc: p.t('setting_header_desc'), searchable: false },
      // 语言切换（render 回调 + update 重绘）
      {
        name: p.t('setting_language'),
        render: (setting) => {
          setting.addDropdown((d) => {
            d.addOptions({ zh: p.t('lang_zh'), en: p.t('lang_en') });
            d.setValue(p.settings.language);
            d.onChange(async (v) => {
              p.settings.language = v;
              await p.saveSettings();
              this.update();
            });
          });
        },
      },
      {
        type: 'group',
        heading: p.t('sec_repo'),
        items: [
          // 1. 平台下拉：决定下方 Token 字段名称与后续平台适配
          {
            name: p.t('setting_platform'),
            desc: p.t('setting_platform_desc'),
            render: (setting) => {
              setting.addDropdown((d) => {
                // 按组用 optgroup 展示：国内在前、国外在后；组名自带原生分隔，emoji 提供颜色锚点（原生下拉菜单不响应 CSS，emoji 是唯一可靠的「上色」方式）
                for (const grp of ['domestic', 'overseas']) {
                  const og = document.createElement('optgroup');
                  og.label = p.t(grp === 'domestic' ? 'grp_domestic' : 'grp_overseas');
                  for (const pf of PLATFORMS.filter((x) => x.group === grp)) {
                    const o = document.createElement('option');
                    o.value = pf.id;
                    o.textContent = p.t('pn_' + pf.id);
                    og.appendChild(o);
                  }
                  d.selectEl.appendChild(og);
                }
                d.setValue(p.settings.platform || 'github');
                d.onChange(async (v) => {
                  if (v !== (p.settings.platform || 'github')) {
                    // 仓库链路配置按平台隔离：切走前快照当前整组，切入时恢复目标平台配置（未配置则全空）
                    p.settings.profiles[p.settings.platform || 'github'] = p.profileSnapshot();
                    p.settings.platform = v;
                    if (!p.settings.profiles[v]) p.settings.profiles[v] = defaultProfile();
                    p.applyProfile(p.settings.profiles[v]);
                    // 所有远程下拉的数据源都变了，级联缓存全部作废
                    p.cacheClear('repos:');
                    p.cacheClear('branches:');
                    p.cacheClear('folders:');
                    p.cacheClear('commits:');
                    await p.saveSettings();
                  }
                  this.update(); // 重绘后 Token 名称/内容与下游下拉跟随平台变化
                });
              });
            },
          },
          // 2. Token：名称跟随所选平台（GitHub Token / GitCode Token / Gitee Token…）
          {
            name: p.t('setting_token', { name: this.platformBareName(p) }),
            desc: p.t('setting_token_desc'),
            render: (setting) => this.renderToken(setting),
          },
          // 3. 仓库地址：有 token → 下拉选择；无 token → 手填（公开库）
          { name: p.t('setting_repo'), desc: p.t('setting_repo_desc'), render: (setting) => this.renderRepoSelect(setting) },
          // 4. 分支下拉（无仓库时禁用）
          { name: p.t('setting_ref'), desc: p.t('setting_ref_desc'), render: (setting) => this.renderBranchSelect(setting) },
          // 5. 提交下拉（可选，版本回退；无仓库时禁用）
          { name: p.t('setting_commit_select'), desc: p.t('setting_commit_select_desc'), render: (setting) => this.renderCommitSelect(setting) },
          // 6. 子目录下拉（无分支时禁用）
          { name: p.t('setting_remote_path'), desc: p.t('setting_remote_path_desc'), render: (setting) => this.renderFolderSelect(setting) },
          // 7. 本地目录仍用原生选择器
          { name: p.t('setting_local_path'), desc: p.t('setting_local_path_desc'), control: { type: 'folder', key: 'localPath', placeholder: '/', includeRoot: true } },
        ],
      },
      {
        type: 'group',
        heading: p.t('sec_filter'),
        items: [
          { name: p.t('setting_include_obsidian'), desc: p.t('setting_include_obsidian_desc'), control: { type: 'toggle', key: 'includeObsidian' } },
          { name: p.t('setting_exclude'), desc: p.t('setting_exclude_desc'), control: { type: 'textarea', key: 'exclude', rows: 3 } },
        ],
      },
      // 立即拉取（action 行）
      { name: p.t('action_pull'), desc: p.t('action_pull_desc'), action: () => { void p.pull(); } },
      // GitHub 文档入口（页面底部统一）
      {
        name: p.t('setting_docs'),
        render: (setting) => {
          setting.addButton((b) => {
            b.setButtonText(p.t('btn_github'));
            b.onClick(() => window.open(REPO_URL, '_blank'));
          });
        },
      },
    ];
  }

  // ---------------- 级联控件渲染 ----------------

  // 当前平台条目（PLATFORMS 中匹配所选平台；异常时回退到可用平台）
  currentPlatform(p) {
    return PLATFORMS.find((x) => x.id === (p.settings.platform || 'github')) || PLATFORMS.find((x) => x.available);
  }

  // 当前平台的裸名称（如 GitHub / GitCode），用于 Token 字段名
  platformBareName(p) {
    return p.t('pn_' + this.currentPlatform(p).id);
  }

  // 复制链接并打开：手机端不便填长表单，复制后可转发到电脑操作
  async copyLink(p, url) {
    try {
      await navigator.clipboard.writeText(url);
      new Notice(p.t('notice_link_copied'), 2500);
    } catch (_) { /* 复制失败时静默，仍打开链接 */ }
    window.open(url, '_blank');
  }

  renderToken(setting) {
    const p = this.plugin;
    const pf = this.currentPlatform(p);
    setting.addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder(p.t('ph_' + pf.id));
      // 令牌按平台独立存储：切换平台后显示对应平台的令牌（未填则为空）
      text.setValue((p.settings.tokens && p.settings.tokens[pf.id]) || '');
      // 逐字输入只保存不重绘（避免焦点丢失）；失焦/回车后再级联加载
      text.onChange((v) => {
        p.settings.tokens = p.settings.tokens || {};
        p.settings.tokens[pf.id] = v.trim();
        void p.saveSettings();
      });
      text.inputEl.addEventListener('blur', () => {
        p.cacheClear('repos:');
        p.cacheClear('branches:');
        p.cacheClear('folders:');
        p.cacheClear('commits:');
        this.update();
      });
      text.inputEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') text.inputEl.blur();
      });
    });
    // 文档/创建按钮：链接跟随所选平台，点击复制到剪贴板（Notice 提示）并打开
    setting.addButton((b) => {
      b.setButtonText(p.t('btn_token_docs'));
      b.onClick(() => { void this.copyLink(p, pf.tokenDoc[p.settings.language] || pf.tokenDoc.zh); });
    });
    setting.addButton((b) => {
      b.setButtonText(p.t('btn_token_create'));
      b.onClick(() => { void this.copyLink(p, pf.tokenCreate); });
    });
  }

  renderRepoSelect(setting) {
    const p = this.plugin;
    if (!p.token()) {
      // 无 Token：手填 owner/repo（公开库），由声明式 text 控件持久化
      setting.addText((t) => {
        t.setPlaceholder('owner/repo');
        t.setValue(p.settings.repo);
        t.onChange((v) => { p.settings.repo = v.trim(); void p.saveSettings(); });
        // 失焦后重绘，让下方分支/提交/子目录下拉跟随新仓库
        t.inputEl.addEventListener('blur', () => { this.update(); });
      });
      return;
    }
    this.bindAsyncSelect(setting, {
      current: p.settings.repo,
      hint: p.t('ref_select_first'),
      loader: (force) => p.fetchRepoList(force).then((names) => names.map((n) => ({ value: n, label: n }))),
      refresh: () => p.cacheClear('repos:'),
      onPick: async (v) => {
        p.settings.repo = v;
        p.settings.ref = '';
        p.settings.commitSha = '';
        p.settings.remotePath = '';
        await p.saveSettings();
        this.update();
      },
    });
  }

  parseRepo() {
    // 与 resolveConfig 一致：允许嵌套命名空间（org/group/repo）
    const m = String(this.plugin.settings.repo || '').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+?)(?:\.git)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }

  renderBranchSelect(setting) {
    const p = this.plugin;
    const r = this.parseRepo();
    if (!r) {
      setting.addDropdown((d) => { d.addOptions({ '': p.t('ref_select_first') }); d.setDisabled(true); });
      return;
    }
    this.bindAsyncSelect(setting, {
      current: p.settings.ref,
      hint: p.t('ref_default'),
      loader: (force) => p.fetchBranchList(r.owner, r.repo, force).then((names) => names.map((n) => ({ value: n, label: n }))),
      refresh: () => p.cacheClear('branches:'),
      onPick: async (v) => {
        p.settings.ref = v;
        p.settings.commitSha = '';
        p.settings.remotePath = '';
        await p.saveSettings();
        this.update();
      },
    });
  }

  // 提交下拉：按所选分支列出最近 30 次，选中后始终拉取该版本（回退）
  renderCommitSelect(setting) {
    const p = this.plugin;
    const r = this.parseRepo();
    if (!r) {
      setting.addDropdown((d) => { d.addOptions({ '': p.t('ref_select_first') }); d.setDisabled(true); });
      return;
    }
    this.bindAsyncSelect(setting, {
      current: p.settings.commitSha,
      hint: p.t('commit_latest'),
      loader: (force) => p.fetchCommitList(r.owner, r.repo, p.settings.ref, force),
      refresh: () => p.cacheClear('commits:'),
      onPick: async (v) => {
        p.settings.commitSha = v;
        p.settings.remotePath = '';
        await p.saveSettings();
        this.update(); // 子目录清单跟随所选提交变化
      },
    });
  }

  renderFolderSelect(setting) {
    const p = this.plugin;
    const r = this.parseRepo();
    if (!r) {
      setting.addDropdown((d) => { d.addOptions({ '': p.t('folder_select_first') }); d.setDisabled(true); });
      return;
    }
    this.bindAsyncSelect(setting, {
      current: p.settings.remotePath,
      hint: p.t('folder_root'),
      loader: (force) => p.fetchFolderList(r.owner, r.repo, p.settings.commitSha || p.settings.ref, force)
        .then((paths) => paths.map((x) => ({ value: x, label: x + '/' }))),
      refresh: () => p.cacheClear('folders:'),
      onPick: async (v) => {
        p.settings.remotePath = v;
        await p.saveSettings();
      },
    });
  }

  /**
   * 通用异步下拉：加载中禁用 → 到达后填充；带刷新按钮。
   * 过期渲染（seq 不符）的结果直接丢弃。
   */
  bindAsyncSelect(setting, opts) {
    const p = this.plugin;
    const seq = this.seq;
    let dropdown;
    setting.addDropdown((d) => {
      dropdown = d;
      d.addOptions({ '': p.t('list_loading') });
      d.setDisabled(true);
    });
    setting.addButton((b) => {
      b.setIcon('refresh-cw');
      b.setTooltip(p.t('btn_refresh'));
      b.onClick(() => { opts.refresh?.(); this.update(); });
    });

    opts.loader(false).then((items) => {
      if (seq !== this.seq) return;
      dropdown.selectEl.empty();
      const options = { '': opts.hint || p.t('list_loading') };
      for (const it of items) options[it.value] = it.label;
      dropdown.addOptions(options);
      const cur = opts.current;
      dropdown.setValue(cur != null && cur !== '' && options[cur] != null ? cur : '');
      dropdown.onChange((v) => { void opts.onPick(v); });
      dropdown.setDisabled(false);
    }).catch((err) => {
      if (seq !== this.seq) return;
      dropdown.selectEl.empty();
      dropdown.addOptions({ '': p.t('list_failed') });
      console.error('[' + PLUGIN_ID + '] list load failed:', err);
    });
  }
}

// 设置页类挂为静态属性，便于自动化测试；默认导出仍为插件主类
GitPullPlugin.SettingTab = GitPullSettingTab;

module.exports = GitPullPlugin;
