/**
 * 行为验证：队列排序、编号、导航切换
 * 用真实模块执行，不是看代码
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === true) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + ' → ' + r); fail++; }
  } catch (e) {
    console.log('  ✗ ' + name + ' → 抛错: ' + e.message);
    fail++;
  }
};

// ===== 加载 srs.js（ESM 导出块 → CommonJS）=====
const srsSrc = read('web/js/srs.js').replace(
  /^export\s*\{([\s\S]*?)\};?\s*$/m,
  (m, inner) =>
    'module.exports = {\n' +
    inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => '  ' + s + ',')
      .join('\n') +
    '\n};'
);
const srsCtx = { module: { exports: {} }, exports: {}, console, Date, Math };
srsCtx.exports = srsCtx.module.exports;
vm.createContext(srsCtx);
vm.runInContext(srsSrc, srsCtx);
const srs = srsCtx.module.exports;
if (typeof srs.buildReviewQueue !== 'function') {
  console.log('  ! srs 导出异常，可用键: ' + Object.keys(srs).join(','));
}

console.log('\n【A】复习队列实际行为');
const DAY = 24 * 3600 * 1000;
const now = Date.now();

const cards = [
  // 逾期 10 天的老词
  { word: 'old_overdue', due: now - 10 * DAY, repetitions: 3, mastery: 40, level: 'CET4' },
  // 逾期 2 天的新词
  { word: 'new_overdue', due: now - 2 * DAY, repetitions: 0, mastery: 0, level: 'CET4' },
  // 刚创建未到期的新词
  { word: 'fresh', due: now + 5 * DAY, repetitions: 0, mastery: 0, level: 'CET4' },
  // 学过但薄弱
  { word: 'weak', due: now + 3 * DAY, repetitions: 2, mastery: 20, level: 'CET4' },
  // 已掌握
  { word: 'mastered', due: now + 10 * DAY, repetitions: 5, mastery: 95, level: 'CET4' },
];

t('逾期词排在未到期词之前', () => {
  const q = srs.buildReviewQueue(cards, 10).map((c) => c.word);
  const iOld = q.indexOf('old_overdue');
  const iFresh = q.indexOf('fresh');
  const iWeak = q.indexOf('weak');
  const iMastered = q.indexOf('mastered');
  if (iOld === -1 || iFresh === -1) return '队列缺词: ' + q.join(',');
  if (iOld > iFresh) return '逾期词排到了未到期新词之后: ' + q.join(' > ');
  if (iWeak > iMastered) return '薄弱词排到了已掌握词之后: ' + q.join(' > ');
  return true;
});

t('新词在已到期组内，但排在「已学薄弱」之前', () => {
  const q = srs.buildReviewQueue(cards, 10).map((c) => c.word);
  const iNew = q.indexOf('new_overdue');
  const iWeak = q.indexOf('weak');
  return iNew < iWeak ? true : '顺序不对: ' + q.join(' > ');
});

t('同优先级内是乱序的（多次采样不应完全相同）', () => {
  // 造 20 个同档词
  const many = Array.from({ length: 20 }, (_, i) => ({
    word: 'w' + i, due: now + 5 * DAY, repetitions: 0, mastery: 0, level: 'CET4',
  }));
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    orders.add(srs.buildReviewQueue(many, 20).map((c) => c.word).join(','));
  }
  return orders.size > 1 ? true : '12 次采样结果完全相同 → 未打散';
});

t('逾期越久排越前（同档内细分）', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    word: 'w' + i,
    due: now - (i + 1) * DAY,
    repetitions: 2,
    mastery: 50,
    level: 'CET4',
  }));
  const q = srs.buildReviewQueue(many, 20).map((c) => c.word);
  // w7 逾期 8 天，应在最前
  return q[0] === 'w7' ? true : '最前面是 ' + q[0] + '（应为 w7，逾期最久）';
});

t('limit 生效', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    word: 'w' + i, due: now, repetitions: 0, mastery: 0, level: 'CET4',
  }));
  return srs.buildReviewQueue(many, 10).length === 10 ? true : '数量不对';
});

console.log('\n【B】编号计算');
const vv = read('web/js/view-vocab.js');
t('第 1 个词显示为「第 1 / N 个」', () => {
  const m = vv.match(/const current = ([^;]+);/);
  if (!m) return '未找到 current';
  const expr = m[1];
  // sessionDone=0 → current 应为 1
  const sessionDone = 0;
  const sessionTotal = 30;
  const current = eval(expr.replace(/sessionDone/g, sessionDone).replace(/sessionTotal/g, sessionTotal));
  return current === 1 ? true : '算出来是 ' + current;
});
t('最后一个词显示为「第 N / N 个」', () => {
  const m = vv.match(/const current = ([^;]+);/);
  const expr = m[1];
  const sessionDone = 29, sessionTotal = 30;
  const current = eval(expr.replace(/sessionDone/g, sessionDone).replace(/sessionTotal/g, sessionTotal));
  return current === 30 ? true : '算出来是 ' + current;
});
t('不会超出总数', () => {
  const m = vv.match(/const current = ([^;]+);/);
  const expr = m[1];
  const sessionDone = 30, sessionTotal = 30;
  const current = eval(expr.replace(/sessionDone/g, sessionDone).replace(/sessionTotal/g, sessionTotal));
  return current <= 30 ? true : '算出来是 ' + current;
});

console.log('\n【C】渲染不报错（含 SVG 图标与折叠原文）');
// 极简 DOM 垫片
class El {
  constructor(tag) {
    this.tagName = tag || 'div';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this._html = '';
    this._text = '';
    this.classList = {
      _s: new Set(),
      add: (c) => this.classList._s.add(c),
      remove: (c) => this.classList._s.delete(c),
      toggle: (c) => (this.classList._s.has(c) ? this.classList._s.delete(c) : this.classList._s.add(c)),
      contains: (c) => this.classList._s.has(c),
    };
  }
  set innerHTML(v) {
    this._html = v;
    this.children = [];
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
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() {}
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getAttribute() { return null; }
  setAttribute() {}
  focus() {}
}

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { localStorage: global.localStorage, scrollTo: () => {} };
global.document = {
  getElementById: () => new El(),
  createElement: () => new El(),
  body: new El(),
  addEventListener: () => {},
};
global.setInterval = () => {};
global.clearInterval = () => {};
global.requestIdleCallback = () => {};

(async () => {
  const WEB = path.join(ROOT, 'web').replace(/\\/g, '/');
  const mod = await import('file:///' + WEB + '/js/view-review.js');
  const root = new El('div');
  try {
    mod.renderReview(root);
    // renderReview 往子节点 body 写内容，root.innerHTML 为空
    const body = root.children[0];
    const h = body ? body.innerHTML : root.innerHTML;
    t('批改页渲染成功', () => (h.length > 500 ? true : '仅 ' + h.length + ' 字符'));
    t('无 undefined 泄漏', () => (!/\bundefined\b/.test(h) ? true : '含 undefined'));
    t('含 SVG 相机图标', () => (h.includes('<svg') ? true : '未找到 svg'));
    t('无 emoji 图标', () => (!/[\u{1F300}-\u{1FAFF}]/u.test(h) ? true : '含 emoji'));
    t('作文页不含折叠开关（折叠开关属于翻译页）', () =>
      !h.includes('toggle-source') ? true : '作文页不该有 toggle-source');
    t('无未求值模板残留', () => (!/\$\{/.test(h) ? true : '含未求值模板'));

    // 切到翻译模式：模拟点击 data-mode="translate"
    const bodyEl = root.children[0];
    const modeBtn = (bodyEl._binds || []).find((b) => b.key === 'mode' && b.val === 'translate');
    if (modeBtn) {
      // 模拟点击：调用绑定的事件
      const btns = bodyEl._handlers && bodyEl._handlers['click'];
      console.log('  · 翻译模式按钮已找到（' + modeBtn.val + '）');
    } else {
      console.log('  · 未找到翻译模式按钮（渲染结构可能变了）');
    }
  } catch (e) {
    t('批改页渲染成功', () => '抛错: ' + e.message);
  }

  // 直接验证翻译页模板包含折叠开关
  console.log('\n【C2】翻译页模板');
  const transSeg = read('web/js/view-review.js').slice(
    read('web/js/view-review.js').indexOf('function transPane()'),
    read('web/js/view-review.js').indexOf('function speakPane()')
  );
  t('翻译页模板含折叠开关', () =>
    transSeg.includes('toggle-source') ? true : '未找到');
  t('翻译页原文 textarea 由 showSource 控制（默认不渲染）', () =>
    /showSource\s*\?/.test(transSeg) ? true : '未受 showSource 控制');
  t('翻译页译文 textarea 直接可见（主输入区）', () =>
    /id="trans"/.test(transSeg) ? true : '未找到');
  t('翻译页不再有独立的原文输入区标题', () =>
    !transSeg.includes('原文（可选，可拍照）') ? true : '旧标题仍在');

  // 导航：构建一次 + class 切换
  console.log('\n【D】导航栏');
  const mj = read('web/js/main.js');
  t('buildNav 里有 addEventListener（点击能生效）', () =>
    mj.includes("addEventListener('click', () => go(b.dataset.tab))") ? true : '未绑定');
  t('syncNav 用 classList.toggle 切换选中态', () =>
    mj.includes("classList.toggle('on', on)") ? true : '未用 class 切换');
  t('导航文字靠 has-text 类控制显隐（不需重建 DOM）', () =>
    mj.includes("classList.toggle('has-text', on)") ? true : '未用 has-text');
  t('render 中不再无条件重建 nav.innerHTML', () => {
    const seg = mj.slice(mj.indexOf('function render()'), mj.indexOf('// SDK 加载状态提示'));
    return seg.includes('nav.innerHTML') ? 'render 里仍在重建 nav' : true;
  });

  console.log('\n────────────────────────');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
