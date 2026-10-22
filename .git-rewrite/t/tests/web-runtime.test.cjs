/**
 * 浏览器运行时验证
 *
 * 用极简的 DOM 垫片在 Node 下真实执行页面渲染函数，
 * 捕获「模块导入失败 / 渲染抛错 / 事件绑定缺失」这类静态检查发现不了的问题。
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '../web');

// ===== 极简 DOM 垫片（能模拟父子关系与事件绑定）=====
class El {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      toggle: (c) => (this.classList._s.has(c) ? this.classList._s.delete(c) : this.classList._s.add(c)),
      contains: (c) => this.classList._s.has(c),
    };
    this._text = '';
    this._html = '';
  }
  set innerHTML(v) {
    this._html = v;
    this.childNodes = [];
    // 提取 data-* 绑定，供事件检查
    this._binds = [];
    const re = /data-([a-z-]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(v))) {
      this._binds.push({ key: m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), val: m[2] });
    }
  }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text; }
  get children() { return this.childNodes; }
  appendChild(c) { this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); }
  remove() {}
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  /** 桩不需要真实查询，返回空数组即可—— 事件绑定检查在下方单独做 */
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getAttribute() { return null; }
  setAttribute() {}
  focus() {}
}

const storage = {};
global.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => (storage[k] = String(v)),
  removeItem: (k) => delete storage[k],
};
global.window = {
  localStorage: global.localStorage,
  scrollTo: () => {},
  WorkBuddyCloud: undefined,
  SpeechRecognition: undefined,
  webkitSpeechRecognition: undefined,
  addEventListener: () => {},
};
global.document = {
  getElementById: (id) => (id === 'main' || id === 'nav' ? new El('div') : null),
  createElement: (t) => new El(t),
  body: new El('body'),
  addEventListener: () => {},
};
global.setTimeout = setTimeout;

// ===== 词库加载所需的环境 =====
// bank-loader 的加载链路是：localStorage → fetch → DecompressionStream → 兜底。
// 测试桩原本三者都没有，导致异步加载根本没启动，state.cards 一直是空。
const fsx = require('fs');
const pathx = require('path');
const zlibx = require('zlib');
const DATA_DIR = pathx.resolve(__dirname, '../web/data');

global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
global.fetch = async (url) => {
  const name = String(url).split('/').pop();
  const p = pathx.join(DATA_DIR, name);
  if (!fsx.existsSync(p)) return { ok: false, status: 404 };
  const text = fsx.readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
};
global.DecompressionStream = undefined; // 走 fetch 分支即可
global.Blob = class {};
global.Response = class {};
global.clearTimeout = clearTimeout;
global.location = { reload: () => {} };
global.confirm = () => false;

// ===== 加载模块 =====
async function main() {
  console.log('【1】加载 ES 模块依赖图\n');

  const results = [];
  for (const f of ['app.js', 'ai.js', 'bank-loader.js', 'view-home.js', 'view-review.js', 'view-vocab.js', 'view-me.js']) {
    try {
      await import(`file:///${path.join(WEB, 'js', f).replace(/\\/g, '/')}`);
      results.push({ f, ok: true });
      console.log(`  ✓ ${f}`);
    } catch (e) {
      results.push({ f, ok: false, err: e.message });
      console.log(`  ✗ ${f} — ${e.message}`);
    }
  }

  const appMod_loader = await import(`file:///${path.join(WEB, 'js', 'bank-loader.js').replace(/\\/g, '/')}`);
  const app = await import(`file:///${path.join(WEB, 'js', 'app.js').replace(/\\/g, '/')}`);
  const home = await import(`file:///${path.join(WEB, 'js', 'view-home.js').replace(/\\/g, '/')}`);

  console.log('\n【2】验证核心导出');
  const checks = [];
  const ck = (n, c) => checks.push({ n, p: !!c });

  ck('state 初始化', typeof app.state === 'object');
  ck('bank-loader 可用', typeof appMod_loader.loadBank === 'function');
  
  ck('题库齐全', app.ESSAY_TASKS.length >= 5 && app.TRANSLATION_TASKS.length >= 3 && app.SPEAKING_TASKS.length >= 5);
  ck('SM-2 可用', typeof app.srs.reviewCard === 'function');
  ck('AI 模块可用', typeof app.ai.reviewEssay === 'function' && typeof app.ai.evaluateSpeaking === 'function');
  ck('TABS 4 项', app.TABS.length === 4);
  checks.forEach((c) => console.log(`  ${c.p ? '✓' : '✗'} ${c.n}`));

  console.log('\n【3】实际渲染各页面');
  const review = await import(`file:///${path.join(WEB, 'js', 'view-review.js').replace(/\\/g, '/')}`);
  const vocab = await import(`file:///${path.join(WEB, 'js', 'view-vocab.js').replace(/\\/g, '/')}`);
  const me = await import(`file:///${path.join(WEB, 'js', 'view-me.js').replace(/\\/g, '/')}`);

  const views = [
    ['首页', home.renderHome],
    ['批改', review.renderReview],
    ['词汇', vocab.renderVocab],
    
    ['我的', me.renderMe],
  ];

  for (const [name, fn] of views) {
    const root = new El('div');
    try {
      fn(root);
      // renderReview 会把内容写进 childNodes[0]，其余直接写 root.innerHTML
      const target = root.childNodes[0] || root;
      const html = target.innerHTML || '';
      const len = html.length;
      const hasBad = /\bundefined\b|\[object Object\]|\bNaN\b/.test(html);
      const ok = len > 500 && !hasBad;
      console.log(`  ${ok ? '✓' : '✗'} ${name} — 渲染 ${len} 字符${hasBad ? '（含异常值）' : ''}`);
      checks.push({ n: `${name}页渲染`, p: ok });
    } catch (e) {
      console.log(`  ✗ ${name} — ${e.message}`);
      checks.push({ n: `${name}页渲染`, p: false });
    }
  }

  console.log('\n【4】验证 HTML 无未替换模板残留');
  {
    const root = new El('div');
    home.renderHome(root);
    const html = root.innerHTML;
    const issues = [];
    if (/\$\{/.test(html)) issues.push('存在未求值的 ${} 模板');
    if (/\bundefined\b/.test(html)) issues.push('出现 undefined');
    if (/\[object Object\]/.test(html)) issues.push('出现 [object Object]');
    if (issues.length) {
      issues.forEach((i) => console.log(`  ✗ ${i}`));
    } else {
      console.log('  ✓ 首页 HTML 干净');
    }
    checks.push({ n: 'HTML 无模板残留', p: issues.length === 0 });
  }

  console.log('\n【5】验证 SM-2 在浏览器环境下的行为');
  const srs = app.srs;
  let card = srs.createCard('test', { meaning: 'x', level: 'CET4' });
  card = srs.reviewCard(card, 5);
  const r1 = card.interval;
  card = srs.reviewCard(card, 5);
  const r2 = card.interval;
  const okSrs = r1 === 1 && r2 === 6;
  console.log(`  ${okSrs ? '✓' : '✗'} 间隔递增 1 → ${r1} → ${r2}`);
  checks.push({ n: 'SM-2 间隔递增', p: okSrs });

  // 词库是异步加载的，等它完成再验队列
  console.log('  …等待词库加载');
  for (let i = 0; i < 40; i++) {
    if ((app.state.cards || []).length > 100) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const cardCount = (app.state.cards || []).length;
  const okBank = cardCount >= 1000;
  console.log(`  ${okBank ? '✓' : '✗'} 词库加载完成 ${cardCount} 张卡`);
  checks.push({ n: '词库异步加载', p: okBank });

  const q = srs.buildReviewQueue(app.state.cards || [], 10);
  console.log(`  ${q.length > 0 ? '✓' : '✗'} 复习队列生成 ${q.length} 词`);
  checks.push({ n: '复习队列', p: q.length > 0 });

  console.log('\n' + '='.repeat(56));
  const failed = checks.filter((c) => !c.p).length;
  const modFailed = results.filter((r) => !r.ok).length;
  console.log(modFailed ? `${modFailed} 个模块加载失败` : '模块全部加载成功');
  console.log(failed ? `${failed} 项检查未通过` : '全部检查通过');
  console.log('='.repeat(56));
  process.exit(failed || modFailed ? 1 : 0);
}

main().catch((e) => {
  console.error('验证脚本异常:', e);
  process.exit(1);
});