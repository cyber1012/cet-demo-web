/**
 * 性能优化专项验证
 *
 * 本轮优化点：
 * 1. 词库 gzip 改为 <script type="application/gzip"> —— 不阻塞首屏解析
 * 2. 首页统计从 5 遍遍历（4 filter + 1 reduce）改为 1 遍 for
 * 3. 页面 DOM 缓存 —— 切回看过的页面不再重建
 * 4. persist() 触发缓存失效，保证数据一致性
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

const build = read('build-standalone.js');
const loader = read('web/js/bank-loader.js');
const home = read('web/js/view-home.js');
const mainJs = read('web/js/main.js');
const appJs = read('web/js/app.js');

console.log('\n【1】首屏不阻塞（词库不再当 JS 解析）');
t('构建用 application/gzip 标签（浏览器不解析）', () =>
  /type="application\/gzip"/.test(build) ? true : '未使用非 JS type');
t('不再把 592KB 塞进普通 <script>', () =>
  /window\.__WORDBANK_GZ__ = "\$\{bankGzB64\}"/.test(build)
    ? '仍放在普通 script 里，会阻塞首屏'
    : true);
t('bank-loader 从 DOM 读取 gzip（不是全局变量）', () =>
  /getElementById\(['"]wordbank-gz['"]\)/.test(loader) ? true : '未从 DOM 读取');
t('构建产物里确实有该标签', () => {
  const html = read('四六级AI批改.html');
  return /<script type="application\/gzip" id="wordbank-gz">/.test(html)
    ? true
    : '产物缺该标签';
});

console.log('\n【2】首页统计：1 遍遍历替代 5 遍');
t('使用单次 for 循环', () =>
  /for \(let i = 0; i < cards\.length; i\+\+\)/.test(home) ? true : '未用单次循环');
t('不再对 cards 用 4 次 filter', () => {
  const n = (home.match(/cards\.filter\(/g) || []).length;
  return n === 0 ? true : '仍有 ' + n + ' 次 cards.filter';
});
t('不再对 cards 用 reduce', () => {
  const n = (home.match(/cards\.reduce\(/g) || []).length;
  return n === 0 ? true : '仍有 ' + n + ' 次 cards.reduce';
});
t('统计变量已改成数字（不再是数组）', () =>
  /const dueCount = stat\.due;/.test(home) && /const mastered = stat\.mastered;/.test(home)
    ? true
    : '变量未正确赋值');
t('模板里不再有 mastered.length（数组改数字后的残留）', () =>
  /\$\{mastered\.length\}/.test(home) ? '仍有 .length 残留' : true);
t('卡片仍兜底空数组（防白屏）', () =>
  /const cards = state\.cards \|\| \[\];/.test(home) ? true : '缺空值防御');

console.log('\n【3】页面缓存');
t('存在 pageCache', () =>
  /const pageCache = new Map\(\)/.test(mainJs) ? true : '未实现缓存');
t('命中缓存时不重新渲染', () => {
  // 缓存读取受 CACHEABLE 白名单约束（只有结构稳定的页面才缓存）
  return /const cached = cacheable \? pageCache\.get\(key\) : null/.test(mainJs)
    ? true
    : '未按白名单读缓存';
});
t('缓存命中时直接 appendChild 复用节点', () =>
  /main\.appendChild\(cached\)/.test(mainJs) ? true : '未复用节点');
t('首次渲染创建独立容器（便于缓存）', () =>
  /host\.dataset\.page = key/.test(mainJs) ? true : '未创建独立容器');
t('提供 invalidatePage', () =>
  /export function invalidatePage/.test(mainJs) ? true : '缺失效接口');
t('滚动复位抽成独立函数（缓存路径也要调）', () =>
  /function scrollTop\(\)/.test(mainJs) ? true : '未抽函数');

console.log('\n【4】缓存一致性（最重要：不能显示旧数据）');
t('app.js 提供 onDataChange 订阅', () =>
  /export function onDataChange/.test(appJs) ? true : '缺订阅接口');
t('persist() 会通知数据变更', () => {
  const seg = appJs.slice(appJs.indexOf('export function persist'));
  return /dataChangeListeners\.forEach/.test(seg) ? true : 'persist 未通知';
});
t('main.js 订阅并清空缓存', () =>
  /onDataChange\(\(\) => \{/.test(mainJs) ? true : '未订阅');
t('词库加载完会失效相关页面', () =>
  /\['home', 'vocab', 'me'\]\.forEach\(invalidatePage\)/.test(mainJs)
    ? true
    : '词库就绪后未失效缓存');
t('不会残留 emitBankReady 的旧引用', () =>
  /emitBankReady/.test(mainJs) ? 'main.js 仍引用已移除的 emitBankReady' : true);

console.log('\n【5】动画性能');
t('云团不逐帧重算高斯模糊', () => {
  const css = read('web/styles/views.css');
  const m = css.match(/\.hero-ai-clouds\s*\{([^}]*)\}/);
  return m && /filter\s*:/.test(m[1]) ? '仍有 filter（会逐帧重算）' : true;
});
t('页面切换有轻量淡入', () =>
  /#main\.is-switching/.test(read('web/styles/app.css')) ? true : '缺切换过渡');
t('页面不可见时暂停动画', () =>
  /page-hidden/.test(read('web/styles/views.css')) &&
  /visibilitychange/.test(mainJs)
    ? true
    : '未实现后台暂停');

console.log('\n【6】清理结果');
t('小程序版目录已删除', () =>
  !fs.existsSync(path.join(ROOT, 'pages')) && !fs.existsSync(path.join(ROOT, 'components'))
    ? true
    : '仍有小程序遗留');
t('旧的硬编码词库已删除', () =>
  !fs.existsSync(path.join(ROOT, 'web/js/wordbank.js')) ? true : 'wordbank.js 仍在');
t('临时视频/压缩包已清理', () =>
  !fs.existsSync(path.join(ROOT, '.workbuddy/tmp/vids')) ? true : '临时视频仍在');
t('词库构建脚本与源数据已备份', () =>
  fs.existsSync(path.join(ROOT, 'build-wordbank.js')) &&
  fs.existsSync(path.join(ROOT, '.workbuddy/backup/wordbank-source'))
    ? true
    : '构建资产缺失');

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);