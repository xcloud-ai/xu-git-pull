/* XU Git Pull v2 — 远程资料拉取：从 GitHub/GitCode/Gitee 整仓克隆或限速增量同步到 vault
 * v2 重写要点：设置页回归经典 display() API（下载模式下拉单选，根治声明式双开关三次翻车）；
 * 设置加载 normalizeSettings 逐字段类型校验（根治旧格式穿透）；下载链路沿用已验证设计。
 * v2.2：级联列表改统一「刷新列表」按钮（缓存无 TTL，远端新建条目需手动强刷）+
 * 本地目标目录 FolderSuggest 建议弹层（可选可手填，新目录下载时逐级创建）。 */
'use strict';

const obsidianApi = require('obsidian');
const { Plugin, Notice, Setting, PluginSettingTab, AbstractInputSuggest, requestUrl, normalizePath, Platform } = obsidianApi;

// isomorphic-git bundle（v1.44.2 + LightningFS）：源码形态静态 require（Node e2e 可 mock），
// 发版经 build.sh 内联进 main.js——移动端 Capacitor 对 require 相对路径不可靠，内联是唯一可靠形态
let isogit = null;
try { isogit = require('./isogit.bundle.js'); } catch (e) {
  console.warn('[xu-git-pull] isogit.bundle.js 加载失败（未打包环境属预期）:', (e && e.message) || e);
}

const PLUGIN_ID = 'xu-git-pull';
const REPO_URL = 'https://github.com/xcloud-ai/xu-git-pull';
const CLONE_TIMEOUT_MS = 300000; // 整仓克隆超时：手机慢网拉大包可能要几分钟
const CLONE_FS_DB = 'xu-git-pull-fs';
const CLONE_DIR = '/repo';
// 设备本地状态文件：覆盖会让手机端插件「消失」/工作区错乱，恒排除且不可配置
const BUILTIN_EXCLUDES = ['community-plugins.json', 'workspace.json'];

const PLATFORMS = [
  { id: 'gitcode', name: 'GitCode', apiBase: 'https://api.gitcode.com/api/v5', gitBase: 'https://gitcode.com', rpm: 40, tokenDoc: 'https://gitcode.com/docs/zh/docs/auth/token.html', available: true },
  { id: 'github', name: 'GitHub', apiBase: 'https://api.github.com', gitBase: 'https://github.com', rpm: 60, tokenDoc: 'https://github.com/settings/personal-access-tokens/new', available: true },
  { id: 'gitee', name: 'Gitee', apiBase: 'https://gitee.com/api/v5', gitBase: 'https://gitee.com', rpm: 50, tokenDoc: 'https://gitee.com/profile/personal_access_tokens', available: true },
];

// ================================================================
//  设置：默认值 + 逐字段类型校验（v2 根治：任何旧格式/污染数据在加载时归位）
// ================================================================
const DEFAULT_SETTINGS = {
  language: 'zh',
  platform: 'gitcode',
  tokens: { github: '', gitcode: '', gitee: '' },
  profiles: {
    github: { repo: '', ref: '', remotePath: '', localPath: '' },
    gitcode: { repo: '', ref: '', remotePath: '', localPath: '' },
    gitee: { repo: '', ref: '', remotePath: '', localPath: '' },
  },
  downloadMode: { desktop: 'clone', mobile: 'clone' },
  ratePerMin: { github: 60, gitcode: 40, gitee: 50 },
  includeObsidian: true,
  exclude: '',
};

/** 逐字段校验归位：类型不符（旧格式字符串/数字、缺失、污染）一律用默认值，不深合并不保留坏数据 */
function normalizeSettings(raw) {
  const d = DEFAULT_SETTINGS;
  const out = {};
  out.language = raw && raw.language === 'en' ? 'en' : 'zh';
  out.platform = PLATFORMS.some((p) => p.id === (raw && raw.platform)) ? raw.platform : d.platform;
  out.tokens = { github: '', gitcode: '', gitee: '' };
  if (raw && raw.tokens && typeof raw.tokens === 'object') {
    for (const k of Object.keys(out.tokens)) if (typeof raw.tokens[k] === 'string') out.tokens[k] = raw.tokens[k].trim();
  }
  out.profiles = {};
  for (const pf of Object.keys(d.profiles)) {
    const src = raw && raw.profiles && typeof raw.profiles === 'object' ? raw.profiles[pf] : null;
    out.profiles[pf] = {};
    for (const k of ['repo', 'ref', 'remotePath', 'localPath']) {
      out.profiles[pf][k] = src && typeof src === 'object' && typeof src[k] === 'string' ? src[k] : '';
    }
  }
  out.downloadMode = { desktop: 'clone', mobile: 'clone' };
  if (raw && raw.downloadMode && typeof raw.downloadMode === 'object') {
    for (const k of ['desktop', 'mobile']) if (raw.downloadMode[k] === 'incremental') out.downloadMode[k] = 'incremental';
  } else if (raw && typeof raw.downloadMode === 'string') {
    // 旧版单字符串格式一次性归位（两端同值）
    const mode = raw.downloadMode === 'incremental' ? 'incremental' : 'clone';
    out.downloadMode = { desktop: mode, mobile: mode };
  }
  out.ratePerMin = { github: d.ratePerMin.github, gitcode: d.ratePerMin.gitcode, gitee: d.ratePerMin.gitee };
  if (raw && raw.ratePerMin && typeof raw.ratePerMin === 'object') {
    for (const k of Object.keys(out.ratePerMin)) {
      const v = Number(raw.ratePerMin[k]);
      if (Number.isFinite(v) && v >= 0) out.ratePerMin[k] = Math.floor(v);
    }
  } else if (raw && typeof raw.ratePerMin === 'number' && Number.isFinite(raw.ratePerMin) && raw.ratePerMin >= 0) {
    const v = Math.floor(raw.ratePerMin);
    out.ratePerMin = { github: v, gitcode: v, gitee: v };
  }
  out.includeObsidian = raw && typeof raw.includeObsidian === 'boolean' ? raw.includeObsidian : d.includeObsidian;
  out.exclude = raw && typeof raw.exclude === 'string' ? raw.exclude : '';
  return out;
}

// ================================================================
//  工具函数
// ================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function trimSlashes(s) {
  return String(s || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** glob 行编译为正则；匹配 / 分隔的相对路径。
 * 语义对齐 gitignore：无斜杠模式按 basename 全层级匹配（*.md 命中 a/b/c.md）；
 * 以 / 结尾的目录规则匹配该目录及其全部后代（tmp/ 命中 tmp、tmp/x.log、tmp/a/b.md） */
function compileGlob(pattern) {
  const raw = String(pattern || '').trim();
  const dirAll = /\/$/.test(raw);
  const p = trimSlashes(raw);
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
  return new RegExp('^(.*/)?' + re + (dirAll ? '(/.*)?' : '') + '$');
}

function matchAny(pathRel, matchers) {
  for (const m of matchers) if (m && m.test(pathRel)) return true;
  return false;
}

// ================================================================
//  i18n（zh 主语言）
// ================================================================
const I18N = {
  zh: {
    setting_title: 'XU Git Pull（远程资料拉取）',
    plugin_desc: '从 GitHub/GitCode/Gitee 整仓克隆或限速增量同步仓库文件到笔记库',
    cmd_pull: '拉取远程仓库文件',
    ribbon_pull: '拉取远程仓库文件',
    set_language: '界面语言', set_language_desc: '切换设置页与通知语言',
    set_platform: '平台', set_platform_desc: '选择远程仓库托管平台',
    set_token: '访问令牌（Token）', set_token_desc: '私有库必填；公开库可不填。仅存本机，不上传',
    set_token_doc: '创建 Token', set_token_copied: '令牌创建页链接已复制，请在浏览器打开',
    set_repo: '仓库', set_repo_desc: '格式 owner/repo，支持嵌套命名空间',
    set_repo_placeholder: 'owner/repo',
    set_ref: '分支', set_ref_desc: '留空 = 跟随默认分支最新',
    set_ref_default: '默认分支（最新）',
    set_remote_path: '仓库子目录', set_remote_path_desc: '只拉取该子目录；「/」表示整个仓库',
    set_remote_root: '/（整个仓库）',
    set_local_path: '本地目标目录', set_local_path_desc: '下载到库中的位置，留空表示库根目录；点击输入框可从建议中选择',
    set_refresh_lists: '刷新列表', set_refresh_lists_desc: '列表有缓存，远端新建的仓库/分支/子目录不会自动出现；点击强制重新拉取',
    refreshing: '刷新中…',
    suggest_root: '（库根目录）',
    set_mode: '下载模式', set_mode_desc: '全量覆盖=速度最快；限速增量=只下变更、内存占用极小、断点续传',
    set_mode_clone: '全量覆盖（整仓克隆，桌面推荐）',
    set_mode_incr: '限速增量（逐文件下载，手机/大仓推荐）',
    set_rpm: '每分钟请求数', set_rpm_desc: '限速增量的下载节奏；0 = 全速（易触发平台限流）',
    set_obsidian: '下载 .obsidian 配置目录', set_obsidian_desc: '开启后插件与外观配置跟随仓库同步；不希望覆盖本机配置时手动关闭',
    set_exclude: '额外排除规则（每行一个 glob）', set_exclude_desc: '已内置排除 .git/、.trash/、community-plugins.json、workspace.json；** 跨级、* 单级、tmp/ 匹配整个目录',
    set_pull: '立即拉取', set_pull_desc: '按当前配置从远程同步到本地',
    set_docs: '使用文档',
    pull_btn: '立即拉取',
    loading: '加载中…', refresh: '刷新',
    notice_pull_busy: '拉取进行中，请等待本次完成',
    notice_isogit_missing: '克隆组件缺失，请重新安装插件',
    notice_no_repo: '请先在设置中填写仓库（owner/repo）',
    notice_repo_invalid: '仓库格式不正确，应为 owner/repo',
    notice_platform_unsupported: '平台不可用：{name}',
    notice_unauthorized: 'Token 无效或权限不足（401），请检查设置中的令牌',
    notice_repo_not_found: '仓库不存在或无权访问（404），请检查仓库名与 Token 权限',
    notice_rate_limited: 'API 限流中，请稍后重试',
    notice_ref_not_found: '分支不存在：{ref}',
    notice_aborted_simple: '已取消',
    notice_token_doc_copy: 'Token 创建页链接已复制',
    clone_checking: '正在验证远程仓库…',
    clone_verified: '验证通过：{repo}（{ref}），开始整仓克隆…',
    clone_progress: '克隆中… {s}s',
    write_progress: '写入 {i}/{n}',
    clone_ok: '拉取完成：写入 {n} 个文件（跳过未变 {s} 个·过滤 {m} 个）· 验证 {v}s + 下载 {c}s + 写盘 {w}s',
    clone_fail: '克隆失败：{reason}',
    clone_fail_mobile_hint: '手机端内存不足可能导致克隆失败，建议切换到「限速增量」模式',
    err_download_timeout: '下载超时：网络无响应',
    incremental_hint: '限速增量同步：{rpm} 个/分钟，只下载有变更的文件',
    incr_tree: '正在获取远程文件清单…',
    incr_start: '增量下载 {n}/{total}',
    incr_wait: '触发限流，等待 {s}s 后重试…',
    incr_none: '增量同步：无变更（{total} 个文件均为最新）',
    incr_done: '增量同步完成：更新 {n} 个、清理远程已删除 {d} 个（{m} 个无变更跳过），耗时 {s}s',
    incr_truncated: '远程文件清单不完整（超过 2 万条），已中止以防误删，请缩小子目录范围',
    incr_skipped: '已跳过 {n} 个超大文件（>20MB）：{list}',
    ref_default: '默认分支',
    statusbar_cancel_hint: '点击取消拉取',
  },
  en: {
    setting_title: 'XU Git Pull',
    plugin_desc: 'Clone or incrementally sync repository files from GitHub/GitCode/Gitee into your vault',
    cmd_pull: 'Pull remote repository files',
    ribbon_pull: 'Pull remote repository files',
    set_language: 'Language', set_language_desc: 'Switch settings page and notice language',
    set_platform: 'Platform', set_platform_desc: 'Choose the remote hosting platform',
    set_token: 'Access Token', set_token_desc: 'Required for private repos; optional for public ones. Stored locally only',
    set_token_doc: 'Create Token', set_token_copied: 'Token creation link copied, open it in your browser',
    set_repo: 'Repository', set_repo_desc: 'Format owner/repo, nested namespaces supported',
    set_repo_placeholder: 'owner/repo',
    set_ref: 'Branch', set_ref_desc: 'Empty = follow the default branch',
    set_ref_default: 'Default branch (latest)',
    set_remote_path: 'Repository subfolder', set_remote_path_desc: 'Only pull this subfolder; "/" means the whole repo',
    set_remote_root: '/ (whole repo)',
    set_local_path: 'Local target folder', set_local_path_desc: 'Where files land in the vault; empty = vault root; click the box to pick from suggestions',
    set_refresh_lists: 'Refresh lists', set_refresh_lists_desc: "Lists are cached; newly created repos/branches/folders won't show up automatically. Click to force re-fetch",
    refreshing: 'Refreshing…',
    suggest_root: '(vault root)',
    set_mode: 'Download mode', set_mode_desc: 'Full clone = fastest; Rate-limited incremental = only changes, tiny memory, resumable',
    set_mode_clone: 'Full clone (desktop recommended)',
    set_mode_incr: 'Rate-limited incremental (mobile/large repos)',
    set_rpm: 'Requests per minute', set_rpm_desc: 'Pace of incremental downloads; 0 = full speed (may trigger rate limits)',
    set_obsidian: 'Sync .obsidian config folder', set_obsidian_desc: 'Sync plugin and appearance config from the repo; turn off to protect local settings',
    set_exclude: 'Extra exclude rules (one glob per line)', set_exclude_desc: '.git/, .trash/, community-plugins.json, workspace.json always excluded; ** spans levels, * single level, tmp/ matches a whole folder',
    set_pull: 'Pull now', set_pull_desc: 'Sync from remote with current settings',
    set_docs: 'Documentation',
    pull_btn: 'Pull now',
    loading: 'Loading…', refresh: 'Refresh',
    notice_pull_busy: 'A pull is already in progress',
    notice_isogit_missing: 'Clone component missing, please reinstall the plugin',
    notice_no_repo: 'Please set a repository (owner/repo) in settings first',
    notice_repo_invalid: 'Invalid repository format, expected owner/repo',
    notice_platform_unsupported: 'Platform unavailable: {name}',
    notice_unauthorized: 'Token invalid or insufficient (401), check the token in settings',
    notice_repo_not_found: 'Repository not found or no access (404), check repo name and token scope',
    notice_rate_limited: 'Rate limited, please retry later',
    notice_ref_not_found: 'Branch not found: {ref}',
    notice_aborted_simple: 'Cancelled',
    notice_token_doc_copy: 'Token creation link copied',
    clone_checking: 'Verifying remote repository…',
    clone_verified: 'Verified: {repo} ({ref}), cloning…',
    clone_progress: 'Cloning… {s}s',
    write_progress: 'Writing {i}/{n}',
    clone_ok: 'Done: wrote {n} files (skipped {s} unchanged, filtered {m}) · verify {v}s + download {c}s + write {w}s',
    clone_fail: 'Clone failed: {reason}',
    clone_fail_mobile_hint: 'Mobile memory may be insufficient for cloning; switch to rate-limited incremental mode',
    err_download_timeout: 'Download timed out: no network response',
    incremental_hint: 'Incremental sync: {rpm} files/min, only changed files are downloaded',
    incr_tree: 'Fetching remote file list…',
    incr_start: 'Incremental {n}/{total}',
    incr_wait: 'Rate limited, retrying in {s}s…',
    incr_none: 'Incremental: no changes ({total} files up to date)',
    incr_done: 'Incremental done: {n} updated, {d} remote-deleted cleaned ({m} unchanged skipped), {s}s',
    incr_truncated: 'Remote file list incomplete (>20k entries), aborted to prevent mis-deletion; narrow the subfolder',
    incr_skipped: 'Skipped {n} oversized files (>20MB): {list}',
    ref_default: 'default branch',
    statusbar_cancel_hint: 'Click to cancel',
  },
};

// ================================================================
//  git smart HTTP 适配器（clone/ls-remote 共用，认证在此注入）
// ================================================================
const createGitHttp = (plugin) => ({
  async request({ url, method, headers, body }) {
    const h = Object.assign({}, headers || {});
    const token = plugin.token();
    if (token && /^https:\/\/(github\.com|gitcode\.com|gitee\.com)\//.test(url)) {
      h.Authorization = 'Basic ' + btoa('oauth2:' + token);
    }
    let payload = null;
    if (body) {
      if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
        payload = body instanceof Uint8Array ? body : new Uint8Array(body);
      } else {
        const chunks = [];
        for await (const c of body) chunks.push(c instanceof Uint8Array ? c : new TextEncoder().encode(String(c)));
        const merged = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.length; }
        payload = merged;
      }
    }
    let res;
    try {
      res = await requestUrl({
        url, method: method || 'GET', headers: h,
        body: payload ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : undefined,
        throw: false,
      });
    } catch (e) {
      if (e && e.response) res = e.response;
      else throw e;
    }
    const buf = res.arrayBuffer;
    return {
      statusCode: res.status,
      statusMessage: String(res.status),
      headers: Object.keys(res.headers || {}).reduce((acc, k) => {
        acc[String(k).toLowerCase()] = String(res.headers[k]);
        return acc;
      }, {}),
      body: (async function* () { if (buf && buf.byteLength) yield new Uint8Array(buf); })(),
    };
  },
});

// ================================================================
//  主插件
// ================================================================
class GitPullPlugin extends Plugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this._listCache = {};
    this._pullBusy = false;
    this._cancelAll = false;
    this._activeAbort = null;

    this.addRibbonIcon('download-cloud', this.t('ribbon_pull'), () => this.pull());
    this.addCommand({ id: 'pull', name: this.t('cmd_pull'), callback: () => this.pull() });
    this._statusEl = this.addStatusBarItem();
    if (this._statusEl && this._statusEl.addClass) this._statusEl.addClass('xgp-status');
    this.registerDomEvent(this._statusEl, 'click', () => { if (this._activeAbort) this._activeAbort(); });
    this.addSettingTab(new GitPullSettingTab(this.app, this));
  }

  onunload() {
    // register* 系资源自动清理；状态栏元素随插件卸载自动移除
  }

  t(key, vars) {
    const pack = I18N[this.settings.language] || I18N.zh;
    let s = pack[key] != null ? pack[key] : (I18N.zh[key] || key);
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  async saveSettings() {
    await this.saveData(JSON.parse(JSON.stringify(this.settings)));
  }

  /** 当前平台的令牌 */
  token() {
    const t = this.settings.tokens || {};
    return String(t[this.settings.platform] || '').trim();
  }

  platformCfg() {
    return PLATFORMS.find((p) => p.id === this.settings.platform) || PLATFORMS[0];
  }

  apiBase() { return this.platformCfg().apiBase; }

  headers() {
    const h = {};
    if ((this.settings.platform || 'github') === 'github') {
      h.Accept = 'application/vnd.github+json';
      h['X-GitHub-Api-Version'] = '2022-11-28';
    }
    const token = this.token();
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  /** 解析并校验设置 → 下载配置（错误以 error 返回） */
  resolveConfig() {
    const repoRaw = trimSlashes(this.settings.profiles[this.settings.platform].repo);
    if (!repoRaw) return { error: this.t('notice_no_repo') };
    const m = repoRaw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+?)(?:\.git)?$/);
    if (!m) return { error: this.t('notice_repo_invalid') };
    const pf = this.settings.profiles[this.settings.platform];
    const patterns = ['.git/**', '.trash/**'].concat(BUILTIN_EXCLUDES);
    if (!this.settings.includeObsidian) patterns.push('.obsidian/**');
    const matchers = patterns
      .concat(String(this.settings.exclude || '').split('\n').map((s) => s.trim()))
      .map(compileGlob)
      .filter(Boolean);
    return {
      platform: this.settings.platform,
      owner: m[1],
      repo: m[2],
      ref: trimSlashes(pf.ref),
      remotePath: trimSlashes(pf.remotePath),
      localPath: trimSlashes(pf.localPath),
      matchers,
    };
  }

  async apiGetJson(url) {
    let res;
    try {
      res = await requestUrl({ url, method: 'GET', headers: this.headers() });
    } catch (err) {
      if (err && err.status === 401) throw Object.assign(new Error(this.t('notice_unauthorized')), { code: 'unauthorized' });
      if (err && (err.status === 404 || err.status === 422)) throw Object.assign(new Error(this.t('notice_repo_not_found')), { code: 'not_found' });
      if (err && err.status === 403) {
        const remain = err.response?.headers?.['x-ratelimit-remaining'];
        if (remain === '0' || remain === 0) throw Object.assign(new Error(this.t('notice_rate_limited')), { code: 'rate_limited' });
        throw Object.assign(new Error(this.t('notice_unauthorized')), { code: 'unauthorized' });
      }
      throw err;
    }
    return res.json;
  }

  /** 全量文件清单：GitHub/Gitee 单请求；GitCode 分页自动翻页取全（短页=最后一页；失败退避重试后中止） */
  async fetchTreeAll(owner, repo, ref) {
    const base = this.apiBase() + '/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(ref);
    if (!this.paginatesTree()) return this.apiGetJson(base + '?recursive=1');
    const merged = [];
    const fetchPage = async (page) => {
      let lastErr = null;
      for (let t = 0; t < 3; t++) {
        try { return await this.apiGetJson(base + '?recursive=1&per_page=100&page=' + page); }
        catch (e) { lastErr = e; await sleep(400 * (t + 1)); }
      }
      throw lastErr; // 翻页失败绝不伪装成最后一页——残缺清单会让增量误删本地文件
    };
    let page = 1;
    let more = true;
    while (more && merged.length <= 20000) {
      const batch = [];
      for (let k = 0; k < 5; k++) batch.push(page++);
      const results = await Promise.all(batch.map(fetchPage));
      for (const d of results) {
        const items = Array.isArray(d.tree) ? d.tree : [];
        merged.push(...items);
        if (items.length < 100) more = false;
      }
    }
    return { tree: merged.slice(0, 20000), truncated: merged.length > 20000 };
  }

  paginatesTree() { return (this.settings.platform || 'github') === 'gitcode'; }

  gitRemoteUrl(owner, repo) {
    return this.platformCfg().gitBase + '/' + owner + '/' + repo + '.git';
  }

  gitAuth() {
    const token = this.token();
    if (!token) return undefined;
    return () => ({ username: 'oauth2', password: token });
  }

  gitHttp() {
    if (!this._gitHttpInst) this._gitHttpInst = createGitHttp(this);
    return this._gitHttpInst;
  }

  cloneFs() {
    if (!this._cloneFs) this._cloneFs = new isogit.fs(CLONE_FS_DB);
    return this._cloneFs;
  }

  async fsRmrf(fsp, p) {
    let entries;
    try { entries = await fsp.promises.readdir(p); } catch (e) { return; }
    for (const e of entries) {
      const full = (p === '/' ? '' : p) + '/' + e;
      let st;
      try { st = await fsp.promises.stat(full); } catch (e2) { continue; }
      if (st.isDirectory()) {
        await this.fsRmrf(fsp, full);
        try { await fsp.promises.rmdir(full); } catch (e2) { /* 忽略 */ }
      } else {
        try { await fsp.promises.unlink(full); } catch (e2) { /* 忽略 */ }
      }
    }
  }

  async verifyRemote(url) {
    const info = await isogit.git.getRemoteInfo({ http: this.gitHttp(), url });
    return { refs: (info && info.refs) || {} };
  }

  /** vault 目录逐级创建（adapter.mkdir 只建单级） */
  async ensureDirFor(localPath) {
    const parts = localPath.split('/').filter(Boolean);
    parts.pop();
    let cur = '';
    for (const seg of parts) {
      cur = cur ? cur + '/' + seg : seg;
      try {
        if (!(await this.app.vault.adapter.exists(cur))) await this.app.vault.adapter.mkdir(cur);
      } catch (e) { /* 已存在等场景忽略 */ }
    }
  }

  /** 增量底账路径：平台-仓库-子目录 slug（切范围互不干扰） */
  manifestKey(owner, repo) {
    const rpSlug = (trimSlashes(this.settings.profiles[this.settings.platform].remotePath).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'root');
    return normalizePath('.xu-git-pull/' + (this.settings.platform || 'github') + '-' + owner + '-' + repo + '-' + rpSlug + '.json');
  }

  async saveManifestSafe(key, obj) {
    const dir = key.split('/').slice(0, -1).join('/');
    try {
      if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
      await this.app.vault.adapter.write(key, JSON.stringify(obj));
    } catch (e) {
      console.error('[' + PLUGIN_ID + '] manifest save failed:', e);
    }
  }

  // ---------------- 拉取入口 ----------------

  async pull() {
    const cfg = this.resolveConfig();
    if (cfg.error) { new Notice(cfg.error, 4000); return; }
    if (this._pullBusy) { new Notice(this.t('notice_pull_busy'), 3000); return; }
    this._pullBusy = true;
    const n1 = new Notice(this.t('clone_checking'), 0);
    this._cancelAll = false;
    this._activeAbort = () => { this._cancelAll = true; };
    if (this._statusEl) {
      this._statusEl.setAttribute('title', this.t('statusbar_cancel_hint'));
      this._statusEl.setText('⬇ ' + this.t('clone_checking'));
    }
    try {
      const platKey = Platform.isMobile ? 'mobile' : 'desktop';
      const dm = (this.settings.downloadMode && this.settings.downloadMode[platKey]) || 'clone';
      if (dm === 'incremental') {
        const rpm = (this.settings.ratePerMin && this.settings.ratePerMin[this.settings.platform]) || 40;
        const msg = this.t('incremental_hint', { rpm });
        n1.setMessage(msg);
        new Notice(msg, 4000);
        await this.pullIncremental(cfg, n1);
        return;
      }
      await this.pullViaClone(cfg, n1);
    } catch (err) {
      n1.hide();
      if (this._cancelAll || (err && err.code === 'aborted')) { new Notice(this.t('notice_aborted_simple'), 4000); return; }
      if (err && err.code === 'verify') { new Notice(err.message, 6000); return; }
      console.error('[' + PLUGIN_ID + '] pull failed:', err);
      if (Platform.isMobile) new Notice(this.t('clone_fail_mobile_hint'), 8000);
      new Notice(this.t('clone_fail', { reason: String((err && err.message) || err) }), 6000);
    } finally {
      this._pullBusy = false;
      this._activeAbort = null;
      if (this._statusEl) this._statusEl.setText('');
    }
  }

  // ---------------- 全量克隆（depth=1 浅克隆 + 树遍历 + 对账跳写） ----------------

  async pullViaClone(cfg, notice) {
    const url = this.gitRemoteUrl(cfg.owner, cfg.repo);
    let vS = 0;
    if (cfg.ref) {
      notice.setMessage(this.t('clone_checking'));
      const tv = Date.now();
      const { refs } = await this.verifyRemote(url);
      if (!(refs.heads && refs.heads[cfg.ref] !== undefined)) {
        throw Object.assign(new Error(this.t('notice_ref_not_found', { ref: cfg.ref })), { code: 'verify' });
      }
      vS = Math.max(1, Math.round((Date.now() - tv) / 1000));
    }
    const ref = cfg.ref || undefined;
    const refLabel = cfg.ref || this.t('ref_default');
    if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }

    notice.setMessage(this.t('clone_verified', { repo: cfg.owner + '/' + cfg.repo, ref: refLabel }));
    const fsp = this.cloneFs();
    await this.fsRmrf(fsp, CLONE_DIR);
    const t1 = Date.now();
    const hb = setInterval(() => {
      if (this._cancelAll) {
        notice.setMessage(this.t('notice_aborted_simple'));
        if (this._statusEl) this._statusEl.setText('⬇ ' + this.t('notice_aborted_simple'));
        return;
      }
      const s = Math.round((Date.now() - t1) / 1000);
      notice.setMessage(this.t('clone_progress', { s }));
      if (this._statusEl) this._statusEl.setText('⬇ ' + this.t('clone_progress', { s }));
    }, 1000);
    let timeoutId = null;
    try {
      await Promise.race([
        isogit.git.clone({
          fs: fsp, http: this.gitHttp(), url, dir: CLONE_DIR,
          depth: 1, singleBranch: true, ref, noCheckout: true,
        }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(this.t('err_download_timeout'))), CLONE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearInterval(hb);
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }
    try {
      const t2 = Date.now();
      const headOid = await isogit.git.resolveRef({ fs: fsp, dir: CLONE_DIR, ref: 'HEAD' });
      const commit = await isogit.git.readCommit({ fs: fsp, dir: CLONE_DIR, oid: headOid });
      const all = [];
      const walkTree = async (oid, prefix) => {
        const { tree } = await isogit.git.readTree({ fs: fsp, dir: CLONE_DIR, oid });
        for (const it of tree) {
          const full = prefix ? prefix + '/' + it.path : it.path;
          if (it.type === 'tree') await walkTree(it.oid, full);
          else if (it.type === 'blob') all.push({ path: full, oid: it.oid });
        }
      };
      await walkTree(commit.commit.tree, '');
      const prefix = cfg.remotePath ? cfg.remotePath.replace(/\/+$/, '') + '/' : '';
      const targets = all.filter((it) => {
        if (it.path.split('/').includes('..')) return false;
        const key = prefix ? (it.path.startsWith(prefix) ? it.path.slice(prefix.length) : null) : it.path;
        if (key === null || key === '') return false;
        return !matchAny(key, cfg.matchers);
      });
      let written = 0;
      let skipped = 0;
      const manifestMap = {};
      for (const it of targets) {
        if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }
        const key = prefix ? it.path.slice(prefix.length) : it.path;
        manifestMap[it.path] = it.oid;
        const localPath = normalizePath(cfg.localPath ? cfg.localPath + '/' + key : key);
        try {
          const buf = await this.app.vault.adapter.readBinary(localPath);
          const { oid: localOid } = await isogit.git.hashBlob({ object: new Uint8Array(buf) });
          if (localOid === it.oid) { skipped++; continue; }
        } catch (e) { /* 本地不存在/读取失败 → 覆盖写 */ }
        const { blob } = await isogit.git.readBlob({ fs: fsp, dir: CLONE_DIR, oid: it.oid });
        await this.ensureDirFor(localPath);
        await this.app.vault.adapter.writeBinary(localPath, blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
        written++;
        notice.setMessage(this.t('write_progress', { i: written, n: targets.length }));
        if (this._statusEl) this._statusEl.setText('⬇ ' + this.t('write_progress', { i: written, n: targets.length }));
      }
      try {
        await this.ensureDirFor(this.manifestKey(cfg.owner, cfg.repo));
        await this.app.vault.adapter.write(this.manifestKey(cfg.owner, cfg.repo), JSON.stringify({ ref: cfg.ref || 'HEAD', files: manifestMap }));
      } catch (e) { /* 底账失败只影响下次增量效率 */ }
      const cS = Math.max(1, Math.round((t2 - t1) / 1000));
      const wS = Math.max(1, Math.round((Date.now() - t2) / 1000));
      notice.hide();
      new Notice(this.t('clone_ok', { n: written, m: all.length - targets.length, s: skipped, v: vS, c: cS, w: wS }), 8000);
      console.log('[' + PLUGIN_ID + '] clone: verify=' + vS + 's clone=' + cS + 's write=' + wS + 's (' + written + ' written, ' + skipped + ' skipped)');
    } finally {
      try {
        await this.fsRmrf(fsp, CLONE_DIR + '/.git');
        await fsp.promises.rmdir(CLONE_DIR + '/.git');
      } catch (e) { /* 忽略 */ }
    }
  }

  // ---------------- 限速增量（tree 清单对比 + 逐文件限速下载 + 断点续传） ----------------

  async pullIncremental(cfg, notice) {
    const owner = cfg.owner;
    const repo = cfg.repo;
    const refName = cfg.ref || 'HEAD';
    const url = this.gitRemoteUrl(owner, repo);
    const { refs } = await this.verifyRemote(url);
    if (cfg.ref && !(refs.heads && refs.heads[cfg.ref] !== undefined)) {
      throw Object.assign(new Error(this.t('notice_ref_not_found', { ref: cfg.ref })), { code: 'verify' });
    }
    if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }
    notice.setMessage(this.t('incr_tree'));
    const data = await this.fetchTreeAll(owner, repo, refName);
    if (data.truncated) throw new Error(this.t('incr_truncated'));

    const prefix = cfg.remotePath ? cfg.remotePath.replace(/\/+$/, '') + '/' : '';
    const targets = [];
    for (const it of data.tree || []) {
      if (it.type !== 'blob') continue;
      const p = String(it.path || '');
      if (p === '' || p.startsWith('.git/') || p.startsWith('.trash/')) continue;
      if (p.split('/').includes('..')) continue;
      const key = prefix ? (p.startsWith(prefix) ? p.slice(prefix.length) : null) : p;
      if (key === null || key === '') continue;
      if (key === '.obsidian' || key.startsWith('.obsidian/')) {
        if (!this.settings.includeObsidian) continue;
      }
      if (matchAny(key, cfg.matchers)) continue;
      targets.push({ key, path: p, sha: it.sha, size: Number(it.size) || 0 });
    }

    const mKey = this.manifestKey(owner, repo);
    let manifest = { ref: refName, files: {} };
    try {
      const prev = JSON.parse(await this.app.vault.adapter.read(mKey));
      if (prev && prev.ref === refName && prev.files && typeof prev.files === 'object') manifest = prev;
    } catch (e) { /* 无清单 → 全量建账 */ }

    // 远程删除同步：manifest 有而远程清单无 → 删本地（必须在 changed==0 提前返回之前）
    const have = new Set(targets.map((t) => t.path));
    const goneKeys = Object.keys(manifest.files).filter((p) => !have.has(p));
    let deleted = 0;
    if (goneKeys.length > 0) {
      const lp = cfg.localPath || '';
      for (const gp of goneKeys) {
        const key = prefix ? (gp.startsWith(prefix) ? gp.slice(prefix.length) : null) : gp;
        delete manifest.files[gp];
        if (key === null || key === '') continue;
        try {
          const fp = normalizePath(lp + '/' + key);
          if (await this.app.vault.adapter.exists(fp)) { await this.app.vault.adapter.remove(fp); deleted++; }
        } catch (e) { /* 单文件删除失败不阻塞同步 */ }
      }
      if (deleted > 0) await this.saveManifestSafe(mKey, manifest);
    }

    // 变更集 = 远端有变（底账 sha 不同）+ 本地缺失（底账最新但本地文件不存在）。
    // 本地缺失补下（优化点③-lite）：换本地目标目录、误删文件后，增量也能自愈，不再出现
    // 「底账说无变更而本地是空的」的死角；超大文件从不落盘，缺失不视为需补（见下载循环跳过逻辑）。
    const BIG_FILE = 20 * 1024 * 1024;
    const changed = [];
    for (const t of targets) {
      if (manifest.files[t.path] !== t.sha) { changed.push(t); continue; }
      if (t.size > BIG_FILE) continue;
      try {
        const fp = normalizePath(cfg.localPath ? cfg.localPath + '/' + t.key : t.key);
        if (!(await this.app.vault.adapter.exists(fp))) changed.push(t);
      } catch (e) { changed.push(t); }
    }
    const t0 = Date.now();
    if (changed.length === 0) {
      notice.hide();
      if (deleted > 0) new Notice(this.t('incr_done', { n: 0, m: 0, d: deleted, s: 0 }), 8000);
      else new Notice(this.t('incr_none', { total: targets.length }), 8000);
      return;
    }
    notice.setMessage(this.t('incr_start', { n: 0, total: targets.length }));
    if (this._statusEl) this._statusEl.setText('⬇ 0/' + changed.length);

    const rpm = (this.settings.ratePerMin && this.settings.ratePerMin[this.settings.platform]) || 40;
    const gap = rpm > 0 ? Math.ceil(60000 / rpm) : 0;
    const blobBase = this.apiBase() + '/repos/' + owner + '/' + repo + '/git/blobs/';
    let lastTs = 0;
    let done = 0;
    let dirty = 0;
    const skipped = [];
    for (const t of changed) {
      if (t.size > BIG_FILE) { skipped.push(t.key); manifest.files[t.path] = t.sha; continue; }
      if (this._cancelAll) {
        if (dirty > 0) await this.saveManifestSafe(mKey, manifest);
        const e = new Error('aborted'); e.code = 'aborted'; throw e;
      }
      const now = Date.now();
      if (lastTs > 0 && gap > 0 && now - lastTs < gap) await sleep(gap - (now - lastTs));
      lastTs = Date.now();
      let bytes = null;
      let lastErr = null;
      let tooBig = false;
      for (let attempt = 0; attempt <= 5; attempt++) {
        if (this._cancelAll) {
          if (dirty > 0) await this.saveManifestSafe(mKey, manifest);
          const e = new Error('aborted'); e.code = 'aborted'; throw e;
        }
        try {
          const info = await this.apiGetJson(blobBase + t.sha);
          if (info && typeof info.content === 'string' && info.encoding === 'base64') {
            if (info.content.length > BIG_FILE * 1.4) { tooBig = true; break; }
            bytes = b64ToBytes(info.content.replace(/\s+/g, ''));
          }
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 5 && (err.code === 'rate_limited' || err.status === 429)) {
            notice.setMessage(this.t('incr_wait', { s: 60 }));
            if (this._statusEl) this._statusEl.setText('⬇ ' + done + '/' + changed.length + ' (...60s)');
            await sleep(60000);
            notice.setMessage(this.t('incr_start', { n: done, total: targets.length }));
          } else if (err.code === 'unauthorized' || err.code === 'not_found') {
            throw err;
          } else {
            await sleep(1000 * (attempt + 1));
          }
        }
      }
      if (tooBig) { skipped.push(t.key); manifest.files[t.path] = t.sha; continue; }
      if (!bytes) {
        if (lastErr) throw lastErr;
        throw new Error(this.t('clone_fail', { reason: 'blob ' + t.path + ' (empty content)' }));
      }
      const localPath = normalizePath(cfg.localPath ? cfg.localPath + '/' + t.key : t.key);
      await this.ensureDirFor(localPath);
      await this.app.vault.adapter.writeBinary(localPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      manifest.files[t.path] = t.sha;
      dirty++;
      done++;
      if (dirty >= 20) { await this.saveManifestSafe(mKey, manifest); dirty = 0; }
      notice.setMessage(this.t('incr_start', { n: done, total: targets.length }));
      if (this._statusEl) this._statusEl.setText('⬇ ' + done + '/' + changed.length);
    }
    await this.saveManifestSafe(mKey, manifest);
    const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    notice.hide();
    new Notice(this.t('incr_done', { n: done, m: targets.length - changed.length, d: deleted, s: secs }), 8000);
    if (skipped.length > 0) {
      const list = skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? ' …' : '');
      new Notice(this.t('incr_skipped', { n: skipped.length, list }), 8000);
    }
  }

  // ---------------- 级联下拉数据（仓库 → 分支 → 子目录；仅设置页低频调用） ----------------

  cacheGet(key) { return (this._listCache ||= {})[key]; }
  cacheSet(key, value) { (this._listCache ||= {})[key] = value; return value; }
  cacheClear(prefix) {
    const c = this._listCache ||= {};
    for (const k of Object.keys(c)) if (!prefix || k.startsWith(prefix)) delete c[k];
  }

  async fetchRepoList(force) {
    const token = this.token();
    const key = 'repos:' + token;
    if (!force) { const hit = this.cacheGet(key); if (hit) return hit; }
    if (!token) return [];
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await this.apiGetJson(this.apiBase() + '/user/repos?per_page=100&page=' + page + '&sort=updated&affiliation=owner,collaborator,organization_member');
      all.push(...data);
      if (data.length < 100) break;
    }
    const names = all.map((r) => r.full_name).sort((a, b) => a.localeCompare(b));
    this.cacheClear('branches:');
    this.cacheClear('folders:');
    return this.cacheSet(key, names);
  }

  async fetchBranchList(owner, repo, force) {
    const key = 'branches:' + (this.token() ? 't' : 'a') + ':' + owner + '/' + repo;
    if (!force) { const hit = this.cacheGet(key); if (hit) return hit; }
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo + '/branches?per_page=100&page=' + page);
      all.push(...data.map((b) => b.name));
      if (data.length < 100) break;
    }
    this.cacheClear('folders:');
    return this.cacheSet(key, all);
  }

  async fetchFolderList(owner, repo, branch, force) {
    const key = 'folders:' + (this.token() ? 't' : 'a') + ':' + owner + '/' + repo + '@' + (branch || ':default');
    if (!force) { const hit = this.cacheGet(key); if (hit) return hit; }
    let ref = branch;
    if (!ref) {
      const info = await this.apiGetJson(this.apiBase() + '/repos/' + owner + '/' + repo);
      ref = info.default_branch || 'main';
    }
    const tree = await this.fetchTreeAll(owner, repo, ref);
    const folders = (tree.tree || [])
      .filter((it) => it.type === 'tree')
      .map((it) => it.path)
      .sort((a, b) => a.localeCompare(b));
    return this.cacheSet(key, folders);
  }
}

// ================================================================
//  设置页（经典 display() API）
// ================================================================

/** 本地目录建议弹层（官方 AbstractInputSuggest 模式）：输入框聚焦/输入时列出库内目录，
 *  点击选中回填；不拦截手填——不存在的新目录仍可输入，下载时逐级自动创建 */
class FolderSuggest extends AbstractInputSuggest {
  constructor(app, inputEl, onPick, rootLabel) {
    super(app, inputEl);
    this._onPick = onPick;
    this._rootLabel = rootLabel || '/';
  }
  /** 深度优先收集全部目录（父目录在前，排序稳定），按输入过滤，限 60 条防长列表卡顿 */
  getSuggestions(query) {
    const q = String(query || '').toLowerCase().replace(/^\/+|\/+$/g, '');
    const folders = [];
    const walk = (f) => {
      for (const c of f.children) {
        if (c.children) { folders.push(c); walk(c); }
      }
    };
    walk(this.app.vault.getRoot());
    const all = [{ isRoot: true, path: '' }].concat(folders);
    const hit = q ? all.filter((x) => x.path.toLowerCase().includes(q)) : all;
    return hit.slice(0, 60);
  }
  renderSuggestion(item, el) {
    el.setText(item.isRoot ? this._rootLabel : item.path);
  }
  selectSuggestion(item) {
    this.inputEl.value = item.path;
    this.close();
    if (this._onPick) this._onPick(item.path);
  }
}

class GitPullSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this._autoTried = {}; // autoFillCascades 每 key 一次的尝试标记
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const p = this.plugin;
    const s = p.settings;

    // 标准头（官方审核要求：设置页标题必须 Setting.setHeading，禁止 createEl('hX')）
    new Setting(containerEl).setName(p.t('setting_title')).setDesc(p.t('plugin_desc')).setHeading();

    // 1. 语言
    new Setting(containerEl)
      .setName(p.t('set_language'))
      .setDesc(p.t('set_language_desc'))
      .addDropdown((dd) => dd
        .addOption('zh', '中文')
        .addOption('en', 'English')
        .setValue(s.language)
        .onChange(async (v) => { s.language = v; await p.saveSettings(); this.display(); }));

    // 2. 平台
    const pf = s.profiles[s.platform] || {};
    new Setting(containerEl)
      .setName(p.t('set_platform'))
      .setDesc(p.t('set_platform_desc'))
      .addDropdown((dd) => {
        for (const cfg of PLATFORMS) dd.addOption(cfg.id, (cfg.id === 'gitcode' ? '🇨🇳 ' : '🌐 ') + cfg.name);
        dd.setValue(s.platform).onChange(async (v) => {
          s.platform = v;
          this._autoTried = {}; // 新平台 → 重新自动拉取仓库/分支/目录
          await p.saveSettings();
          this.display();
        });
      });

    // 3. Token（失焦保存 + 清下游缓存）
    new Setting(containerEl)
      .setName(p.t('set_token'))
      .setDesc(p.t('set_token_desc'))
      .addText((tx) => {
        tx.inputEl.type = 'password';
        tx.inputEl.addClass('xgp-wide');
        tx.setPlaceholder('token')
          .setValue(s.tokens[s.platform] || '')
          .onChange(async (v) => {
            s.tokens[s.platform] = v.trim();
            p.cacheClear('repos:');
            await p.saveSettings();
          });
        tx.inputEl.addEventListener('blur', () => { this._autoTried = {}; this.display(); });
      })
      .addExtraButton((btn) => btn
        .setIcon('file-text')
        .setTooltip(p.t('set_token_doc'))
        .onClick(() => {
          navigator.clipboard.writeText(p.platformCfg().tokenDoc);
          new Notice(p.t('notice_token_doc_copy'), 4000);
        }));

    // 4. 仓库（级联下拉：token 仓库列表 + 当前值兜底；刷新走下方统一「刷新列表」按钮）
    const repoSetting = new Setting(containerEl)
      .setName(p.t('set_repo'))
      .setDesc(p.t('set_repo_desc'));
    this.buildCascade(repoSetting, {
      getValue: () => pf.repo || '',
      setValue: async (v) => { pf.repo = v; this._autoTried = {}; await p.saveSettings(); },
      placeholder: p.t('set_repo_placeholder'),
      getCached: () => p.cacheGet('repos:' + p.token()),
    });

    // 5. 分支
    const refSetting = new Setting(containerEl)
      .setName(p.t('set_ref'))
      .setDesc(p.t('set_ref_desc'));
    this.buildBranchCascade(refSetting);

    // 6. 子目录
    const rpSetting = new Setting(containerEl)
      .setName(p.t('set_remote_path'))
      .setDesc(p.t('set_remote_path_desc'));
    this.buildFolderCascade(rpSetting);

    // 6.5 刷新列表（统一手动刷新：一次强制重拉仓库+分支+子目录，绕过缓存）
    new Setting(containerEl)
      .setName(p.t('set_refresh_lists'))
      .setDesc(p.t('set_refresh_lists_desc'))
      .addButton((btn) => btn
        .setButtonText(p.t('refresh'))
        .onClick(async () => {
          btn.setButtonText(p.t('refreshing')).setDisabled(true);
          const parts = (pf.repo || '').split('/');
          const owner = parts[0], repo = parts.slice(1).join('/');
          const jobs = [];
          if (p.token()) jobs.push(() => p.fetchRepoList(true));
          if (owner && repo) {
            jobs.push(() => p.fetchBranchList(owner, repo, true));
            jobs.push(() => p.fetchFolderList(owner, repo, pf.ref, true));
          }
          const results = await Promise.allSettled(jobs.map((run) => run()));
          const failed = results.find((r) => r.status === 'rejected');
          if (failed) new Notice(String((failed.reason && failed.reason.message) || failed.reason), 5000);
          this.display();
        }));

    // 7. 本地目标目录（FolderSuggest：点击/输入弹出库内目录建议，点击选中；保留手填新目录能力）
    new Setting(containerEl)
      .setName(p.t('set_local_path'))
      .setDesc(p.t('set_local_path_desc'))
      .addText((tx) => {
        tx.setPlaceholder('e.g. notes/remote')
          .setValue(pf.localPath || '')
          .onChange(async (v) => { pf.localPath = v; await p.saveSettings(); });
        new FolderSuggest(this.app, tx.inputEl, async (path) => { pf.localPath = path; await p.saveSettings(); }, p.t('suggest_root'));
      });

    // 8. 下载模式（单个下拉，二选一，无互斥）
    const platKey = Platform.isMobile ? 'mobile' : 'desktop';
    new Setting(containerEl)
      .setName(p.t('set_mode'))
      .setDesc(p.t('set_mode_desc'))
      .addDropdown((dd) => dd
        .addOption('clone', p.t('set_mode_clone'))
        .addOption('incremental', p.t('set_mode_incr'))
        .setValue(s.downloadMode[platKey] || 'clone')
        .onChange(async (v) => {
          s.downloadMode[platKey] = v;
          await p.saveSettings();
          this.display(); // 限速行随模式显隐
        }));

    // 9. 每分钟请求数（仅增量模式显示）
    if ((s.downloadMode[platKey] || 'clone') === 'incremental') {
      new Setting(containerEl)
        .setName(p.t('set_rpm'))
        .setDesc(p.t('set_rpm_desc'))
        .addText((tx) => {
          tx.inputEl.type = 'number';
          tx.inputEl.addClass('xgp-narrow');
          tx.setValue(String(s.ratePerMin[s.platform] != null ? s.ratePerMin[s.platform] : ''))
            .setPlaceholder(String(p.platformCfg().rpm))
            .onChange(async (v) => {
              const n = Number(v);
              s.ratePerMin[s.platform] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
              await p.saveSettings();
            });
        });
    }

    // 10. 过滤组
    new Setting(containerEl)
      .setName(p.t('set_obsidian'))
      .setDesc(p.t('set_obsidian_desc'))
      .addToggle((tg) => tg.setValue(s.includeObsidian).onChange(async (v) => { s.includeObsidian = v; await p.saveSettings(); }));

    new Setting(containerEl)
      .setName(p.t('set_exclude'))
      .setDesc(p.t('set_exclude_desc'))
      .addTextArea((tx) => {
        tx.inputEl.addClass('xgp-wide');
        tx.inputEl.rows = 3;
        tx.setValue(s.exclude || '')
          .setPlaceholder('*.log\ntmp/')
          .onChange(async (v) => { s.exclude = v; await p.saveSettings(); });
      });

    // 11. 立即拉取
    new Setting(containerEl)
      .setName(p.t('set_pull'))
      .setDesc(p.t('set_pull_desc'))
      .addButton((btn) => btn
        .setButtonText(p.t('pull_btn'))
        .setCta()
        .onClick(() => p.pull()));

    // 12. 使用文档
    new Setting(containerEl)
      .setName(p.t('set_docs'))
      .addExtraButton((btn) => btn
        .setIcon('github')
        .setTooltip(REPO_URL)
        .onClick(() => window.open(REPO_URL)));

    // 渲染完成后后台自动补拉级联列表（仓库/分支/目录），成功后重绘一次
    void this.autoFillCascades();
  }

  /** 自动填充级联列表（恢复 1.9.2「打开设置即见列表」体验）：
   *  有 Token 自动拉仓库列表；有 repo 自动拉分支与子目录。每个 key 每轮设置页会话只尝试一次，
   *  失败静默（不打扰，手动刷新按钮仍可用），任一成功后重绘一次让下拉出现完整选项。 */
  async autoFillCascades() {
    const p = this.plugin;
    const s = p.settings;
    const pf = s.profiles[s.platform] || {};
    const parts = (pf.repo || '').split('/');
    const owner = parts[0] || '';
    const repo = parts.slice(1).join('/');
    const jobs = [];
    if (p.token() && !p.cacheGet('repos:' + p.token())) {
      jobs.push({ k: 'repos', run: () => p.fetchRepoList(false) });
    }
    if (owner && repo) {
      const brKey = 'branches:' + (p.token() ? 't' : 'a') + ':' + owner + '/' + repo;
      const foKey = 'folders:' + (p.token() ? 't' : 'a') + ':' + owner + '/' + repo + '@' + (pf.ref || ':default');
      if (!p.cacheGet(brKey)) jobs.push({ k: 'br', run: () => p.fetchBranchList(owner, repo, false) });
      if (!p.cacheGet(foKey)) jobs.push({ k: 'fo', run: () => p.fetchFolderList(owner, repo, pf.ref, false) });
    }
    const todo = jobs.filter((j) => !this._autoTried[j.k]);
    if (!todo.length) return;
    for (const j of todo) this._autoTried[j.k] = true; // 同步标记，防并发/防循环
    let filled = false;
    await Promise.all(todo.map(async (j) => {
      try { await j.run(); filled = true; } catch (e) {
        console.warn('[xu-git-pull] 自动加载列表失败(' + j.k + '):', (e && e.message) || e);
      }
    }));
    if (filled) this.display();
  }

  /** 仓库级联：下拉（token 列表 + 当前值兜底）；列表不可用时保持手填，刷新走统一「刷新列表」按钮 */
  buildCascade(setting, opts) {
    const current = opts.getValue();
    const cached = opts.getCached ? opts.getCached() : null;
    const list = cached && cached.length ? cached : (current ? [current] : []);
    const options = list.slice();
    if (!options.some((x) => x === '')) options.unshift(''); // 首项恒为空值（显示 placeholder，可主动清空）
    setting.addDropdown((dd) => {
      for (const item of options) dd.addOption(item, item || opts.placeholder || ' ');
      dd.selectEl.addClass('xgp-dropdown-wide');
      dd.setValue(current);
      dd.selectEl.addEventListener('change', async (ev) => {
        await opts.setValue(ev.target.value);
      });
    });
  }

  buildBranchCascade(setting) {
    const p = this.plugin;
    const s = p.settings;
    const pf = s.profiles[s.platform] || {};
    const m = (pf.repo || '').split('/');
    const owner = m[0], repo = m.slice(1).join('/');
    const current = pf.ref || '';
    const cached = owner && repo ? p.cacheGet('branches:' + (p.token() ? 't' : 'a') + ':' + owner + '/' + repo) : null;
    const list = cached && cached.length ? cached : [];
    const options = [{ v: '', label: p.t('set_ref_default') }].concat(list.map((b) => ({ v: b, label: b })));
    if (current && !options.some((o) => o.v === current)) options.push({ v: current, label: current });
    setting.addDropdown((dd) => {
      for (const o of options) dd.addOption(o.v, o.label);
      dd.selectEl.addClass('xgp-dropdown-wide');
      dd.setValue(current);
      dd.selectEl.addEventListener('change', async (ev) => {
        pf.ref = ev.target.value;
        this._autoTried = {}; // 分支变化 → 子目录列表按新分支重拉
        await p.saveSettings();
      });
      if (!owner || !repo) dd.setDisabled(true);
    });
  }

  buildFolderCascade(setting) {
    const p = this.plugin;
    const s = p.settings;
    const pf = s.profiles[s.platform] || {};
    const m = (pf.repo || '').split('/');
    const owner = m[0], repo = m.slice(1).join('/');
    const current = pf.remotePath || '';
    const cached = owner && repo ? p.cacheGet('folders:' + (p.token() ? 't' : 'a') + ':' + owner + '/' + repo + '@' + (pf.ref || ':default')) : null;
    const list = cached && cached.length ? cached : [];
    const options = [{ v: '', label: p.t('set_remote_root') }].concat(list.map((f) => ({ v: f, label: '/' + f })));
    if (current && !options.some((o) => o.v === current)) options.push({ v: current, label: '/' + current });
    setting.addDropdown((dd) => {
      for (const o of options) dd.addOption(o.v, o.label);
      dd.selectEl.addClass('xgp-dropdown-wide');
      dd.setValue(current);
      dd.selectEl.addEventListener('change', async (ev) => {
        pf.remotePath = ev.target.value;
        await p.saveSettings();
      });
      if (!owner || !repo) dd.setDisabled(true);
    });
  }
}

// Obsidian 插件加载器约定：默认导出插件类本身；SettingTab 挂静态属性供加载器注册
GitPullPlugin.SettingTab = GitPullSettingTab;
// 纯函数挂静态属性，供 e2e 直接断言（运行时无副作用）
GitPullPlugin.normalizeSettings = normalizeSettings;
GitPullPlugin.compileGlob = compileGlob;
GitPullPlugin.matchAny = matchAny;
GitPullPlugin.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports = GitPullPlugin;
