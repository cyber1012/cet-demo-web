/**
 * 独立网页版验证
 *
 * 从生成的 HTML 中抽取内联脚本，在 Node 下真实执行，
 * 验证「import/export 改写」没有破坏任何逻辑。
 * 这是独立版最容易出错的地方，必须实测而非只看文件生成。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.resolve(__dirname, '../四六级AI批改.html');

// ===== DOM 垫片 =====
class El {
  constructor(tag) {
    this.tagName = tag || 'div';
    this.childNodes = [];
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.className = '';
    this._text = '';
    this._html = '';
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      contains: (c) => this.classList._s.has(c),
    };
  }
  set innerHTML(v) {
    this._html = v;
    this.childNodes = [];
  }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
  get children() { return this.childNodes; }
  appendChild(c) { this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); }
  remove() {}
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatch(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e || { preventDefault() {}, stopPropagation() {} })); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getAttribute() { return null; }
  setAttribute() {}
  focus() {}
}

function makeEnv() {
  const storage = {};
  const win = {};
  const doc = {
    getElementById: (id) => (id === 'main' || id === 'nav' ? new El('div') : null),
    createElement: (t) => new El(t),
    body: new El('body'),
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const ctx = {
    window: win,
    document: doc,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => (storage[k] = String(v)),
      removeItem: (k) => delete storage[k],
    },
    navigator: { mediaDevices: null },
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    location: { protocol: 'file:', reload: () => {} },
    confirm: () => false,
    alert: () => {},
    fetch: async () => ({ ok: false, status: 0 }),
    TextDecoder,
    Blob: class {},
    URL: { createObjectURL: () => '' },
  };
  ctx.globalThis = ctx;
  // 浏览器里 window === globalThis，SDK 的顶层 var 会挂到 window
  // Node 的 vm 里顶层 var 挂到 ctx，因此需要桥接
  win.window = win;
  win.globalThis = win;
  ctx.window = win;
  win.localStorage = ctx.localStorage;
  win.document = doc;
  win.setTimeout = setTimeout;
  win.setInterval = setInterval;
  win.clearTimeout = clearTimeout;
  win.clearInterval = clearInterval;
  win.console = console;
  win.navigator = ctx.navigator;
  win.fetch = ctx.fetch;
  win.location = ctx.location;
  win.confirm = ctx.confirm;
  win.alert = ctx.alert;
  win.WorkBuddyCloud = undefined;
  return vm.createContext(ctx);
}

/**
 * 提取会被浏览器执行的脚本段。
 * 必须排除 type="application/gzip"（词库数据）——
 * 浏览器不会执行它，但它 592KB，若当 JS 跑会直接抛语法错误。
 */
function extractScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    // 非 JS 类型（gzip 数据等）跳过
    if (/type\s*=\s*["'](?!text\/javascript|application\/javascript|module)[^"']*["']/i.test(attrs)) {
      continue;
    }
    if (body.trim()) out.push(body);
  }
  return out;
}

function main() {
  console.log('【1】解析生成的 HTML');
  const html = fs.readFileSync(FILE, 'utf8');
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`  文件大小：${kb} KB`);

  const scripts = extractScripts(html);
  console.log(`  内联脚本段：${scripts.length} 段`);

  const checks = [];
  const ck = (n, p, extra) => checks.push({ n, p: !!p, extra });

  // ===== 静态检查 =====
  console.log('\n【2】静态检查');
  ck('不含ES module 语法', !/<script[^>]*type=["']module["']/.test(html));
  ck('已内联样式', /<style>/.test(html) && html.includes('--cream'));
  ck('已内联 SDK', html.includes('WorkBuddyCloud'));
  ck('无外链 JS', !/<script[^>]+src=/.test(html));
  ck('无外链 CSS', !/<link[^>]+stylesheet/.test(html));
  ck('无 import 语句残留', !/^\s*import\s.*from\s+['"]/m.test(scripts.join('\n')));

  // 词库内联校验。
  // 注意：词库放在 <script type="application/gzip"> 里 —— 浏览器不把它当 JS 解析，
  // 所以不阻塞首屏渲染。测试环境没有浏览器的 type 语义，
  // 必须从标签内容里取，不能把 scripts[] 里的 gzip 数据拿去执行。
  const gzMatch = html.match(
    /<script type="application\/gzip" id="wordbank-gz">([\s\S]*?)<\/script>/
  );
  ck('词库已内联（gzip 标签）', !!gzMatch);
  if (gzMatch) {
    try {
      const zlib = require('zlib');
      const buf = Buffer.from(gzMatch[1].trim(), 'base64');
      ck('内联词库是合法 gzip', buf[0] === 0x1f && buf[1] === 0x8b);
      const parsed = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
      ck('解压后四级 2000 词', Array.isArray(parsed.cet4) && parsed.cet4.length === 2000,
        String(parsed.cet4 && parsed.cet4.length));
      ck('解压后六级 2500+ 词', Array.isArray(parsed.cet6) && parsed.cet6.length >= 2500,
        String(parsed.cet6 && parsed.cet6.length));
      const keys = [...parsed.cet4, ...parsed.cet6].map((w) => w.word.toLowerCase());
      ck('内联词库零重复', new Set(keys).size === keys.length,
        `${new Set(keys).size}/${keys.length}`);
      const noPh = [...parsed.cet4, ...parsed.cet6].filter((w) => !/^\/.+\/$/.test(w.phonetic));
      ck('内联词库音标完整', noPh.length === 0, noPh.length + ' 个缺音标');
    } catch (e) {
      ck('内联词库可解压', false, e.message);
    }
  }
  ck('无 export 语句残留', !/^\s*export\s+(const|default|function|class|\{)/m.test(scripts.join('\n')));

  // 体积合理性（含gzip 内联词库，允许到 1MB）
  ck('体积在合理区间(<1MB)', Buffer.byteLength(html) < 1024 * 1024, `${kb}KB`);

  checks.forEach((c) => console.log(`  ${c.p ? '✓' : '✗'} ${c.n}${c.extra ? ` (${c.extra})` : ''}`));

  // ===== 实际执行 =====
  console.log('\n【3】在 Node 中真实执行内联脚本');
  const ctx = makeEnv();

  try {
    scripts.forEach((code, i) => {
      vm.runInContext(code, ctx, { filename: `inline-${i}.js`, timeout: 15000 });
      console.log(`  ✓ 第 ${i + 1} 段执行通过`);
    });
  } catch (e) {
    console.log(`  ✗ 执行失败：${e.message}`);
    checks.push({ n: '内联脚本执行', p: false });
    console.log('\n' + '='.repeat(56));
    console.log('构建产物无法运行，需修复');
    console.log('='.repeat(56));
    process.exit(1);
  }
  checks.push({ n: '内联脚本执行', p: true });

  // ===== 验证全局对象与渲染 =====
  console.log('\n【4】验证渲染与数据');
  try {
    const w = ctx.window;
    const doc = ctx.document;

    // Node 的 vm 里，顶层 var 声明挂到 globalThis（即 ctx），
    // 浏览器里才挂到 window。两处都检查。
    ck('SDK 已挂载', typeof w.WorkBuddyCloud === 'object' || typeof ctx.WorkBuddyCloud === 'object');

    // 模块系统应已注册全部 12 个模块
    const factories = w.__modFactories || ctx.__modFactories;
    const names = ['bank-loader', 'tasks', 'srs', 'cloud', 'ai', 'app',
      'view-home', 'view-review', 'view-vocab', 'view-me', 'main'];
    const loaded = names.filter((n) => factories && typeof factories[n] === 'function');
    ck('全部模块已注册', loaded.length === names.length, `${loaded.length}/${names.length}`);
    checks.push({ n: '模块隔离生效（无变量冲突）', p: loaded.length === names.length });

    // 逐个执行模块，确认都能跑通
    const req = w.__requireModule || ctx.__requireModule;
    let modOk = 0;
    const modErr = [];
    for (const n of names) {
      try {
        const m = req(n);
        if (m && typeof m === 'object') modOk++;
        else modErr.push(`${n}: 返回空`);
      } catch (e) {
        modErr.push(`${n}: ${e.message}`);
      }
    }
    ck('全部模块可执行', modOk === names.length, modErr.length ? modErr[0] : `${modOk}/${names.length}`);

    // 数据层抽查
    try {
      const appMod = req('app');
      const loader = req('bank-loader');
      ck('词库加载器可用', loader && typeof loader.loadBank === 'function');
      ck('bank-loader 已注入版本号', loader && typeof loader.BANK_VERSION === 'number');
      const cards = req('srs').createCard('t', { meaning: 'm', level: 'CET4' });
      ck('SM-2 可用', cards && typeof cards.mastery === 'number');
      ck('应用状态已初始化', typeof appMod.state === 'object');
      ck('路由可用', typeof appMod.TABS === 'object' && appMod.TABS.length === 4);
    } catch (e) {
      ck('数据层可用', false, e.message);
    }

    // 渲染首页
    try {
      const home = req('view-home');
      const main = doc.getElementById('main');
      home.renderHome(main);
      const h = main.innerHTML;
      ck('首页可渲染', h.length > 500, `${h.length}字符`);
      ck('首页无 undefined', !/\bundefined\b/.test(h));
      ck('首页无未求值模板', !/\$\{/.test(h));
      ck('勾选圈使用 SVG tick', h.includes('ring-tick'));
      ck('任务项含 task-text 类', h.includes('task-text'));
    } catch (e) {
      ck('首页渲染无异常', false, e.message);
    }
  } catch (e) {
    ck('渲染过程无异常', false, e.message);
  }

  checks.forEach((c) => {
    if (!['不含ES module 语法', '已内联样式', '已内联 SDK', '无外链 JS', '无外链 CSS', '无 import 语句残留', '无 export 语句残留', '体积在合理区间(<1MB)', '内联脚本执行'].includes(c.n))
      console.log(`  ${c.p ? '✓' : '✗'} ${c.n}${c.extra ? ` (${c.extra})` : ''}`);
  });

  console.log('\n' + '='.repeat(56));
  const bad = checks.filter((c) => !c.p);
  console.log(bad.length ? `${bad.length} 项未通过` : '独立网页版全部验证通过');
  console.log('='.repeat(56));
  console.log('\n提示：请双击 HTML 文件在浏览器中打开，确认视觉效果。');
  process.exit(bad.length ? 1 : 0);
}

main();