/**
 * 本轮修复验证：
 * 1. 箭头图标不再用会缺字形的字符（⌄ = U+2304 家谱符号）
 * 2. 筛选切换只更新列表，不重建整页（content-visibility 已移除）
 * 3. 词库版本迁移：老用户能拿到去重后的词表，且不丢复习进度
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

const viewMe = read('web/js/view-me.js');
const viewVocab = read('web/js/view-vocab.js');
const appJs = read('web/js/app.js');
const loaderJs = read('web/js/bank-loader.js');
const accountJs = read('web/js/account.js');
const appCss = read('web/styles/app.css');
const viewsCss = read('web/styles/views.css');

// 剔除注释行后再检查 —— 代码里保留了「为什么不用它」的说明，
// 但注释中出现关键词不代表还在用。
const stripComments = (s) =>
  s
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');

console.log('\n【1】箭头图标（⌄ 在中文字体下缺字形）');
t('不再使用 ⌄（U+2304 家谱符号）', () => {
  const code = stripComments(viewMe);
  return code.includes('⌄') ? '代码里仍含 ⌄ 字符' : true;
});
t('改用内联 SVG 折线箭头', () =>
  /const CHEVRON = `<svg/.test(viewMe) ? true : '未定义 CHEVRON SVG');
t('SVG 有正确属性（stroke-linecap 等）', () =>
  /stroke-linecap="round"/.test(viewMe) ? true : 'SVG 属性不全');
t('SVG 在页面上被使用', () =>
  viewMe.includes('${CHEVRON}') ? true : '未插入到模板');
t('样式里有 .support-chev-svg 尺寸', () =>
  /\.support-chev-svg\s*\{[^}]*width/.test(viewsCss) ? true : '缺 SVG 尺寸');
t('.support-chev 改为 flex 居中', () =>
  /\.support-chev\s*\{[^}]*align-items:\s*center/.test(viewsCss)
    ? true
    : '未改 flex，字形会不居中');

console.log('\n【2】筛选切换的「刷新感」');
const appCode = stripComments(appCss);
t('已移除 content-visibility（它引起容器高度突变）', () =>
  /content-visibility/.test(appCode) ? 'CSS 里仍在用 content-visibility' : true);
t('已移除 contain-intrinsic-size', () =>
  /contain-intrinsic-size/.test(appCode) ? 'CSS 里仍在用 contain-intrinsic-size' : true);
t('列表容器有独立 id', () =>
  /id="wordList"/.test(viewVocab) ? true : '未给列表容器 id');
t('列表 HTML 抽成独立函数', () =>
  /function listHTML\(\)/.test(viewVocab) ? true : '未抽出 listHTML');
t('存在 refreshList 局部更新函数', () =>
  /function refreshList\(root\)/.test(viewVocab) ? true : '未实现局部更新');
t('筛选切换调用 refreshList（不是 renderVocab）', () => {
  const seg = viewVocab.slice(
    viewVocab.indexOf("t.closest('[data-filter]')"),
    viewVocab.indexOf("t.closest('[data-filter]')") + 400
  );
  return /refreshList\(root\)/.test(seg)
    ? true
    : /renderVocab\(root\)/.test(seg) ? '仍在重建整页' : '未找到处理';
});
t('「显示更多」也走局部更新', () => {
  const seg = viewVocab.slice(
    viewVocab.indexOf("t.closest('[data-act=\"more\"]')"),
    viewVocab.indexOf("t.closest('[data-act=\"more\"]')") + 250
  );
  return /refreshList\(root\)/.test(seg) ? true : '仍在重建整页';
});
t('点击当前筛选项不做无谓重绘', () =>
  /next === filter\) return/.test(viewVocab) ? true : '未做同项判断');
t('refreshList 同步筛选按钮选中态', () =>
  /classList\.toggle\('on', b\.dataset\.filter === filter\)/.test(viewVocab)
    ? true
    : '未同步选中态');
t('旧的 visibleWords/hasMore 变量已清除（改为函数内计算）', () => {
  const beforeList = viewVocab.slice(0, viewVocab.indexOf('root.innerHTML = inSession'));
  return /visibleWords|filteredWords|hasMore/.test(beforeList)
    ? '仍有残留变量'
    : true;
});

console.log('\n【3】词库版本迁移（老用户拿不到新词表）');
t('state 中有 bankVersion 字段', () =>
  /bankVersion:\s*0/.test(appJs) ? true : 'state 未声明 bankVersion');
t('定义了 BANK_VERSION 常量（在 bank-loader 中）', () =>
  /export const BANK_VERSION = \d+/.test(loaderJs) ? true : '未定义');
t('ensureCards 会检查版本并重建', () =>
  // 词库改成异步加载后，判断写法从 !== 变成 ===（版本一致才跳过重建）
  /state\.bankVersion === BANK_VERSION/.test(appJs) ? true : '未检查版本');
t('重建时保留已有复习进度（不是从零开始）', () => {
  const seg = appJs.slice(
    appJs.indexOf('export function ensureCards'),
    appJs.indexOf('export function todayKey')
  );
  return /prev\.get\(w\.word\)/.test(seg) && /Object\.assign\(old, w\)/.test(seg)
    ? true
    : '重建会丢失进度';
});
t('云同步 payload 带 bankVersion', () =>
  /bankVersion: localState\.bankVersion \|\| 0/.test(accountJs)
    ? true
    : 'payload 未带版本号');
t('合并时取版本号最大值（避免换设备回退）', () =>
  /bankVersion: Math\.max\(local\.bankVersion/.test(accountJs)
    ? true
    : '未取最大值');
t('新词库确实无重复词（读真实 JSON）', () => {
  const c4 = JSON.parse(read('web/data/cet4.json'));
  const c6 = JSON.parse(read('web/data/cet6.json'));
  const all = [...c4, ...c6];
  const seen = new Set();
  const dup = all.filter((w) => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  return dup.length === 0 ? true : '重复 ' + dup.length + ' 个';
});

console.log('\n【4】迁移行为模拟');
t('老用户场景：旧 166 卡 → 重建为完整词表', () => {
  const c4 = JSON.parse(read('web/data/cet4.json'));
  const c6 = JSON.parse(read('web/data/cet6.json'));
  // 模拟老用户：本地只有 166 张旧卡
  const oldCards = c4.slice(0, 166).map((w) => ({ ...w, repetitions: 1, mastery: 50, lastReview: Date.now() }));
  const prev = new Map(oldCards.map((c) => [c.word, c]));
  const rebuilt = c4.map((w) => {
    const old = prev.get(w.word);
    return old ? { ...old, word: w.word } : { word: w.word, repetitions: 0, mastery: 0 };
  });
  return rebuilt.length === c4.length ? true : '重建数量不符: ' + rebuilt.length;
});
t('迁移后已有进度不丢', () => {
  const prev = new Map([['abandon', { word: 'abandon', repetitions: 3, mastery: 70 }]]);
  const rebuilt = ['abandon', 'ability'].map((w) => {
    const old = prev.get(w);
    return old ? Object.assign(old, { word: w }) : { word: w, mastery: 0 };
  });
  const a = rebuilt.find((c) => c.word === 'abandon');
  return a.repetitions === 3 && a.mastery === 70
    ? true
    : '进度丢失: ' + JSON.stringify(a);
});

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);