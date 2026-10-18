/* XU Git Pull — 远程资料拉取：从 GitHub/GitCode/Gitee（公开/私有）仓库整仓浅克隆，按过滤规则覆盖写入 vault. */
'use strict';

const obsidianApi = require('obsidian');
const { Plugin, Notice, Modal, Setting, PluginSettingTab, requestUrl, normalizePath } = obsidianApi;

// isomorphic-git bundle（v1.44.2 + LightningFS 4.10.3）
// 源码形态：静态 require 上级目录的 isogit.bundle.js（esbuild 相对 src/ 解析；Node e2e 沙盒可 mock）；
// 发版形态：build.sh 经 esbuild --bundle 将其内联进 main.js，零 require 依赖（桌面/移动端通吃）
let isogit = null;
try { isogit = require('../isogit.bundle.js'); } catch (e) {
  console.warn('[xu-git-pull] isogit.bundle.js 加载失败（未打包环境属预期）：', (e && e.message) || e);
}

const PLUGIN_ID = 'xu-git-pull';
const REPO_URL = 'https://github.com/xcloud-ai/xu-git-pull';
// 整仓克隆超时：手机慢网拉大包可能要几分钟，放宽到 5 分钟（可随时取消）
const CLONE_TIMEOUT_MS = 300000;
// 各平台 git smart HTTP 基址（与 REST API 是两套服务，配额独立——实测 GitCode 连发克隆零限流）
const GIT_BASES = { github: 'https://github.com', gitcode: 'https://gitcode.com', gitee: 'https://gitee.com' };
// LightningFS（IndexedDB）内的克隆工作目录与库名
const CLONE_FS_DB = 'xu-git-pull-fs';
const CLONE_DIR = '/repo';

/** isomorphic-git HTTP 适配器工厂：底层换用 Obsidian requestUrl（桌面/手机统一网络栈，绕 CORS）。
 *  认证在适配器层注入 Basic 头（getRemoteInfo 不支持 onAuth 回调，统一在此处理三平台凭据）；
 *  响应体整体到达后包装为单 chunk async iterator（isomorphic-git 接口约定）；
 *  throw:false 让 4xx/5xx 以 statusCode 交给 isomorphic-git 处理（老版本无此参数时从异常里取 response） */
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
        url,
        method: method || 'GET',
        headers: h,
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
//  i18n
// ================================================================
const I18N = {
  zh: {
    cmd_pull: '拉取远程文件（整仓覆盖）',
    ribbon_pull: '拉取远程文件',
    notice_no_repo: '请先在设置中填写仓库（owner/repo）',
    notice_repo_invalid: '仓库格式不正确，应为 owner/repo',
    err_download_timeout: '下载超时：网络无响应',
    clone_checking: '正在验证远程仓库…',
    clone_verified: '验证通过：{repo}（{ref}），开始整仓克隆…',
    clone_progress: '克隆中… {s}s',
    write_progress: '写入 {i}/{n}',
    clone_ok: '拉取完成：写入 {n} 个文件（过滤掉 {m} 个）· 用时 {s}s',
    clone_fail: '克隆失败：{reason}',
    notice_ref_not_found: '分支不存在：{ref}',
    notice_aborted_simple: '已取消',
    notice_pull_busy: '拉取进行中，请等待本次完成',
    notice_isogit_missing: '克隆组件（isogit.bundle.js）缺失，请重新安装插件',
    setting_title: 'XU Git Pull（远程资料拉取）',
    setting_header_desc: '从远程仓库（支持私有库）单向拉取文件到本 vault：整仓克隆后按过滤规则覆盖写入，适合手机/平板只看资料的场景。只增改，不删除本地文件。',
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
    action_pull: '立即拉取',
    action_pull_desc: '验证远程仓库后整仓克隆并覆盖更新',
    setting_token: '{name} Token',
    setting_token_desc: '私有库必填，公开库可不填。填写后下方仓库、分支、子目录自动加载为下拉选择，无需手填。各平台令牌独立保存在本设备 data.json 中，切换平台互不影响。建议使用只读权限的最小授权令牌。',
    ph_github: 'github_pat_…',
    ph_gitcode: 'GitCode 个人访问令牌',
    ph_gitee: 'Gitee 私人令牌',
    notice_link_copied: '链接已复制，可发送到电脑打开',
    btn_token_docs: '如何创建 Token？',
    btn_token_create: '直接创建',
    list_loading: '列表加载中…',
    list_failed: '加载失败，点右侧刷新重试',
    btn_refresh: '刷新列表',
    setting_docs: '使用文档',
    btn_github: 'GitHub',
  },
  en: {
    cmd_pull: 'Pull remote files (full clone overwrite)',
    ribbon_pull: 'Pull remote files',
    notice_no_repo: 'Set a repository (owner/repo) in settings first',
    notice_repo_invalid: 'Invalid repository format, expected owner/repo',
    err_download_timeout: 'Download timed out: no response',
    clone_checking: 'Verifying remote repository…',
    clone_verified: 'Verified: {repo} ({ref}). Cloning…',
    clone_progress: 'Cloning… {s}s',
    write_progress: 'Writing {i}/{n}',
    clone_ok: 'Done: {n} file(s) written ({m} filtered) in {s}s',
    clone_fail: 'Clone failed: {reason}',
    notice_ref_not_found: 'Branch not found: {ref}',
    notice_aborted_simple: 'Cancelled',
    notice_pull_busy: 'Pull already in progress — please wait',
    notice_isogit_missing: 'Clone component (isogit.bundle.js) missing — reinstall the plugin',
    setting_title: 'XU Git Pull',
    setting_header_desc: 'One-way pull from a remote repo (private supported) into this vault: full clone, then filtered overwrite — ideal for read-only phones/tablets. Files are added/updated, never deleted.',
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
    action_pull: 'Pull now',
    action_pull_desc: 'Verify the remote repo, then clone and overwrite',
    setting_token: '{name} token',
    setting_token_desc: 'Required for private repos, optional for public. Once set, repository, branch and subfolder become dropdowns — no typing. Tokens are stored per platform in local data.json; switching platforms never mixes them. A minimal read-only token is recommended.',
    ph_github: 'github_pat_…',
    ph_gitcode: 'GitCode personal access token',
    ph_gitee: 'Gitee personal access token',
    notice_link_copied: 'Link copied — paste it on your computer',
    btn_token_docs: 'How to create a token?',
    btn_token_create: 'Create one',
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
const PROFILE_KEYS = ['repo', 'ref', 'remotePath', 'localPath'];

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
      g.remotePath = this.settings.remotePath || '';
      g.localPath = this.settings.localPath || '';
      void this.saveSettings();
    }
    this.addSettingTab(new GitPullSettingTab(this.app, this));

    this.addRibbonIcon('download', this.t('ribbon_pull'), () => { void this.pull(); });

    // 状态栏兜底入口：后台下载时显示进度，通知被误关后仍可从状态栏取消
    this._statusEl = this.addStatusBarItem();
    this.registerDomEvent(this._statusEl, 'click', () => {
      if (this._activeAbort) this._activeAbort();
    });

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

  /** GitCode 的 tree API 会分页（默认 20 条/页，且目录排在文件前）；GitHub/Gitee 单次返回全量 */
  paginatesTree() {
    return (this.settings.platform || 'github') === 'gitcode';
  }

  /** 取完整文件树：统一入口。GitCode 分页页与页之间并行预取（每批 5 页），大幅缩短大仓库等待 */
  async fetchTreeAll(owner, repo, ref) {
    const base = this.apiBase() + '/repos/' + owner + '/' + repo + '/git/trees/' + encodeURIComponent(ref);
    if (!this.paginatesTree()) {
      return this.apiGetJson(base + '?recursive=1');
    }
    const merged = [];
    const fetchPage = (page) =>
      this.apiGetJson(base + '?recursive=1&per_page=100&page=' + page).catch(() => ({ tree: [] }));
    let page = 1;
    let more = true;
    while (more && merged.length <= 20000) {
      const batch = [];
      for (let k = 0; k < 5; k++) batch.push(page++);
      const results = await Promise.all(batch.map(fetchPage));
      for (const d of results) {
        const items = Array.isArray(d.tree) ? d.tree : [];
        merged.push(...items);
        if (items.length < 100) more = false; // 短页=最后一页
      }
    }
    return { tree: merged, truncated: false };
  }

  /** 当前平台的令牌（按平台独立存储，切换平台互不影响） */
  token() {
    const t = this.settings.tokens || {};
    return String(t[this.settings.platform] || '').trim();
  }

  /** ── 整仓克隆（git smart HTTP）────────────────────────────
   *  git 服务与 REST API 配额独立，实测连发大仓库克隆零限流；
   *  isomorphic-git（bundle）+ LightningFS（IndexedDB）+ requestUrl HTTP 适配 */

  /** 平台 git 仓库 URL（https://<gitBase>/<owner>/<repo>.git） */
  gitRemoteUrl(owner, repo) {
    return (GIT_BASES[this.settings.platform || 'github'] || GIT_BASES.github) + '/' + owner + '/' + repo + '.git';
  }

  /** isomorphic-git 认证回调：统一 oauth2:<token> Basic 形式（GitHub/GitCode 官方写法，Gitee 兼容） */
  gitAuth() {
    const token = this.token();
    if (!token) return undefined;
    return () => ({ username: 'oauth2', password: token });
  }

  /** HTTP 适配器实例（clone/ls-remote 共用，认证在适配器内注入） */
  gitHttp() {
    if (!this._gitHttpInst) this._gitHttpInst = createGitHttp(this);
    return this._gitHttpInst;
  }

  /** LightningFS 单例（IndexedDB 库 CLONE_FS_DB） */
  cloneFs() {
    if (!this._cloneFs) this._cloneFs = new isogit.fs(CLONE_FS_DB);
    return this._cloneFs;
  }

  /** LightningFS 递归删除目录（LightningFS 无 rimraf，逐项 unlink/rmdir） */
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

  /** 收集目录下所有文件的相对路径（skip 指定顶层条目，如 .git） */
  async fsCollect(fsp, root, rel, out, skip) {
    let entries;
    try { entries = await fsp.promises.readdir(rel ? root + '/' + rel : root); } catch (e) { return; }
    for (const e of entries) {
      if (rel === '' && skip && skip.includes(e)) continue;
      const child = rel ? rel + '/' + e : e;
      let st;
      try { st = await fsp.promises.stat(root + '/' + child); } catch (e2) { continue; }
      if (st.isDirectory()) await this.fsCollect(fsp, root, child, out, skip);
      else out.push(child);
    }
  }

  /** vault 目录逐级创建（adapter.mkdir 只建单级） */
  async ensureDirFor(localPath) {
    const parts = localPath.split('/').filter(Boolean);
    parts.pop(); // 最后一段是文件名
    let cur = '';
    for (const seg of parts) {
      cur = cur ? cur + '/' + seg : seg;
      try {
        if (!(await this.app.vault.adapter.exists(cur))) await this.app.vault.adapter.mkdir(cur);
      } catch (e) { /* 已存在等场景忽略 */ }
    }
  }

  /** ① ls-remote 验证（1 个请求）：仓库可达、Token 有效、分支存在。
   *  返回 refs 结构化映射（{heads:{分支名:sha}}）；isomorphic-git 不回 HEAD symref，默认分支由 clone 自动跟随 */
  async verifyRemote(url) {
    const info = await isogit.git.getRemoteInfo({ http: this.gitHttp(), url });
    return { refs: (info && info.refs) || {} };
  }

  /** ②③ 整仓克隆 → 过滤 → 写盘 → 汇总。抛错由调用方决定回退/终止 */
  async pullViaClone(cfg, notice) {
    const url = this.gitRemoteUrl(cfg.owner, cfg.repo);
    const t0 = Date.now();

    // ① 验证：分支校验（未指定分支时 isomorphic-git 跟随远程默认）
    notice.setMessage(this.t('clone_checking'));
    const { refs } = await this.verifyRemote(url);
    if (cfg.ref && !(refs.heads && refs.heads[cfg.ref] !== undefined)) {
      throw Object.assign(new Error(this.t('notice_ref_not_found', { ref: cfg.ref })), { code: 'verify' });
    }
    const ref = cfg.ref || undefined;
    const refLabel = cfg.ref || '默认分支';
    if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }

    // ② 清理旧克隆 → 浅克隆（5 分钟超时兜底，心跳显示已用时）
    notice.setMessage(this.t('clone_verified', { repo: cfg.owner + '/' + cfg.repo, ref: refLabel }));
    const fsp = this.cloneFs();
    await this.fsRmrf(fsp, CLONE_DIR);
    const t1 = Date.now();
    const hb = setInterval(() => {
      const s = Math.round((Date.now() - t1) / 1000);
      notice.setMessage(this.t('clone_progress', { s }));
      if (this._statusEl) this._statusEl.setText('⬇ ' + this.t('clone_progress', { s }));
    }, 1000);
    try {
      await Promise.race([
        isogit.git.clone({
          fs: fsp, http: this.gitHttp(), url, dir: CLONE_DIR,
          depth: 1, singleBranch: true, ref,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(this.t('err_download_timeout'))), CLONE_TIMEOUT_MS)),
      ]);
    } finally {
      clearInterval(hb);
    }

    // ③ 遍历工作区 → 过滤（.obsidian/exclude/子目录）→ 逐文件写 vault（精确进度）
    if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }
    const prefix = cfg.remotePath ? cfg.remotePath.replace(/\/+$/, '') + '/' : '';
    const all = [];
    await this.fsCollect(fsp, CLONE_DIR, '', all, ['.git']);
    const targets = all.filter((rel) => {
      if (rel.split('/').includes('..')) return false; // 防越界
      const key = prefix ? (rel.startsWith(prefix) ? rel.slice(prefix.length) : null) : rel;
      if (key === null || key === '') return false;
      return !matchAny(key, cfg.matchers);
    });
    let written = 0;
    for (const rel of targets) {
      if (this._cancelAll) { const e = new Error('aborted'); e.code = 'aborted'; throw e; }
      const key = prefix ? rel.slice(prefix.length) : rel;
      const localPath = normalizePath(cfg.localPath ? cfg.localPath + '/' + key : key);
      const buf = await fsp.promises.readFile(CLONE_DIR + '/' + rel);
      await this.ensureDirFor(localPath);
      await this.app.vault.adapter.writeBinary(localPath, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      written++;
      notice.setMessage(this.t('write_progress', { i: written, n: targets.length }));
      if (this._statusEl) this._statusEl.setText('⬇ ' + this.t('write_progress', { i: written, n: targets.length }));
    }
    const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    notice.hide();
    new Notice(this.t('clone_ok', { n: written, m: all.length - targets.length, s: secs }), 6000);
    if (this._statusEl) this._statusEl.setText('');
  }


  /** 仓库链路快照：抓取顶层活跃字段（切平台前调用） */
  profileSnapshot() {
    const s = this.settings;
    return { repo: s.repo || '', ref: s.ref || '', remotePath: s.remotePath || '', localPath: s.localPath || '' };
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
      // 下拉选择的分支（空 = 默认分支最新）
      ref: trimSlashes(this.settings.ref),
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
    const tree = await this.fetchTreeAll(owner, repo, ref);
    const folders = (tree.tree || [])
      .filter((it) => it.type === 'tree')
      .map((it) => it.path)
      .sort((a, b) => a.localeCompare(b));
    return this.cacheSet(key, folders);
  }

  /** 整仓拉取：git smart HTTP 浅克隆（约 2 个请求），克隆完过滤写盘覆盖本地 */
  async pull() {
    const cfg = this.resolveConfig();
    if (cfg.error) {
      new Notice(cfg.error, 4000);
      return;
    }
    // 插件级锁：克隆进行中拒绝重复触发（ribbon/命令双击）
    if (this._pullBusy) {
      new Notice(this.t('notice_pull_busy'), 3000);
      return;
    }
    if (!isogit) {
      new Notice(this.t('notice_isogit_missing'), 6000);
      return;
    }
    this._pullBusy = true;
    const n1 = new Notice(this.t('clone_checking'), 0);
    this._cancelAll = false;
    try {
      await this.pullViaClone(cfg, n1);
    } catch (err) {
      n1.hide();
      if (this._cancelAll || (err && err.code === 'aborted')) {
        new Notice(this.t('notice_aborted_simple'), 4000);
        return;
      }
      if (err && err.code === 'verify') {
        new Notice(err.message, 6000);
        return;
      }
      console.error('[' + PLUGIN_ID + '] clone failed:', err);
      new Notice(this.t('clone_fail', { reason: String((err && err.message) || err) }), 6000);
    } finally {
      this._pullBusy = false;
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
          // 5. 子目录下拉（无分支时禁用）
          { name: p.t('setting_remote_path'), desc: p.t('setting_remote_path_desc'), render: (setting) => this.renderFolderSelect(setting) },
          // 6. 本地目录仍用原生选择器
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
        p.settings.remotePath = '';
        await p.saveSettings();
        this.update();
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
      loader: (force) => p.fetchFolderList(r.owner, r.repo, p.settings.ref, force)
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
