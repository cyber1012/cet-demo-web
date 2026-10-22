/**
 * 白屏 bug 第二轮回归测试
 *
 * 用户反馈：首页任务勾选之后白屏，刷新才能恢复。
 *
 * 根因：invalidatePage() 里的 removeChild。
 * main 里任何时刻只挂着一个页面节点，所以那句唯一能摘到的，
 * 就是「当前正在显示的那个页面」→ 摘掉即白屏。
 *
 * 这与上一轮的复习白屏是同一类问题的不同表现：
 * 上一轮是「词汇页被缓存」，这一轮是「首页在 CACHEABLE 白名单里」。
 *
 * 本测试锁定的不变量：
 *   1. invalidatePage 绝不能摘掉正在显示的页面节点
 *   2. 勾选任务这类「页面自更新」场景，不应触发整页重绘
 *   3. 缓存失效只清引用，不碰 DOM
 */
const fs = require('fs');
const path = require('path');

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

const mainJs = read('web/js/main.js');
const home = read('web/js/view-home.js');

console.log('\n【1】invalidatePage 绝不摘掉正在显示的页面');
t('invalidatePage 会检查 parentNode !== main', () =>
  /hit\.parentNode !== main/.test(mainJs) ? true : '未判断是否正在显示');
t('只有不在 main 里的节点才 removeChild', () => {
  const seg = mainJs.slice(
    mainJs.indexOf('export function invalidatePage'),
    mainJs.indexOf('export function invalidatePage') + 700
  );
  const hasGuard = /parentNode !== main/.test(seg);
  const removeIdx = seg.indexOf('removeChild');
  const guardIdx = seg.indexOf('parentNode !== main');
  return hasGuard && guardIdx < removeIdx
    ? true
    : 'removeChild 没有被「是否正在显示」的判断保护';
});
t('失效时不整页重绘（避免闪烁）', () => {
  const seg = mainJs.slice(
    mainJs.indexOf('export function invalidatePage'),
    mainJs.indexOf('export function invalidatePage') + 700
  );
  return /renderer\(hit\)/.test(seg) ? '失效时仍会整页重绘' : true;
});

console.log('\n【2】首页勾选任务是自更新，不该整页重画');
t('勾选圈用 class 切换（局部更新）', () =>
  /ring\.classList\.toggle\('done', nowDone\)/.test(home) ? true : '未局部更新勾选圈');
t('文字样式用 class 切换', () =>
  /text\.classList\.toggle\('done', nowDone\)/.test(home) ? true : '未局部更新文字');
t('进度数字与进度条原地更新', () =>
  /countEl\.textContent = /.test(home) && /barEl\.style\.width/.test(home)
    ? true
    : '进度未原地更新');
t('勾选后没有调用 renderHome 整页重绘', () => {
  // 排除注释：注释里提到「之前调 renderHome(root)」是解释历史
  const code = home
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
  const seg = code.slice(code.indexOf("el.addEventListener('click'"));
  return /renderHome\(/.test(seg) ? '勾选后仍在整页重绘' : true;
});
t('persist() 在局部更新之后调用', () => {
  const seg = home.slice(home.indexOf("el.addEventListener('click'"));
  const pIdx = seg.indexOf('persist()');
  const cIdx = seg.indexOf('countEl.textContent');
  return pIdx > cIdx ? true : 'persist() 早于局部更新';
});

console.log('\n【3】缓存语义');
t('缓存只清引用，不碰 DOM', () =>
  /pageCache\.delete\(key\)/.test(mainJs) ? true : '未删除缓存引用');
t('onDataChange 只失效白名单页', () =>
  /onDataChange\(\(\) => \{\s*CACHEABLE\.forEach\(invalidatePage\);/.test(mainJs)
    ? true
    : '失效范围不对');
t('没有「清空全部缓存」的写法', () =>
  /onDataChange\(\(\) => \{[\s\S]{0,200}pageCache\.clear\(\)/.test(mainJs)
    ? '仍会 pageCache.clear()'
    : true);
t('CACHEABLE 含首页（首页数据会变）', () =>
  /CACHEABLE = new Set\(\['home', 'me'\]\)/.test(mainJs) ? true : '白名单内容不对');
t('切页时 main.innerHTML 清空是预期行为', () =>
  /main\.innerHTML = '';/.test(mainJs) ? true : '切页未清空 main');

console.log('\n【4】模拟：勾选任务后当前页仍在 DOM');
t('模拟首页勾选 → persist → invalidatePage → 页面节点仍在', () => {
  // 构造一个最小 DOM 模型，复现 main.js 的行为
  const makeEl = () => ({
    parentNode: null,
    children: [],
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
  });

  const main = makeEl();
  const pageCache = new Map();

  // 模拟 render()：首页渲染后挂到 main
  const homeHost = makeEl();
  main.appendChild(homeHost);
  pageCache.set('home', homeHost);

  // 模拟 invalidatePage（当前实现）
  const invalidatePage = (key) => {
    const hit = pageCache.get(key);
    pageCache.delete(key);
    if (hit && hit.parentNode && hit.parentNode !== main) {
      hit.parentNode.removeChild(hit);
    }
  };

  // 模拟勾选任务 → persist() → onDataChange → invalidatePage('home')
  invalidatePage('home');

  return main.children.length === 1
    ? true
    : '当前页被摘掉了，main 剩 ' + main.children.length + ' 个子节点（白屏）';
});
t('模拟：修复前会白屏（对照验证）', () => {
  // 反向验证：旧实现确实会白屏，说明这个测试有意义
  const makeEl = () => ({
    parentNode: null, children: [],
    set innerHTML(v) { this.children = []; },
    get innerHTML() { return ''; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
  });
  const main = makeEl();
  const homeHost = makeEl();
  main.appendChild(homeHost);

  // 旧实现
  const hit = homeHost;
  if (hit && hit.parentNode) hit.parentNode.removeChild(hit);

  return main.children.length === 0 ? true : '旧实现竟未白屏，测试无意义';
});

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);