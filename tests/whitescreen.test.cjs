/**
 * 复习白屏 bug 回归测试
 *
 * 用户反馈：记单词时白屏，必须来回切换页面才能继续。
 *
 * 根因：上一轮加的页面缓存 + onDataChange 组合出的问题。
 * 复习每翻一个单词都会 persist() → 触发 onDataChange →
 * 把所有缓存节点从 DOM 摘掉 → 当前页（包括正在复习的词卡）消失 → 白屏。
 *
 * 本测试验证：
 * 1. 只有「结构稳定」的页面才进缓存
 * 2. 词汇页/批改页每次都重新渲染
 * 3. 数据变更不会摘掉正在显示的页面
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
const vocab = read('web/js/view-vocab.js');
const appCss = read('web/styles/app.css');

console.log('\n【1】缓存范围（白屏的直接原因）');
t('定义了 CACHEABLE 白名单', () =>
  /const CACHEABLE = new Set\(\[/.test(mainJs) ? true : '未定义白名单');
t('首页在白名单里（结构稳定）', () =>
  /CACHEABLE = new Set\(\['home', 'me'\]\)/.test(mainJs) ? true : '白名单内容不对');
t('词汇页不在白名单（复习时整页重绘）', () =>
  /CACHEABLE = new Set\(\['home', 'me'\]\)/.test(mainJs)
    ? true
    : '词汇页被缓存了 —— 复习中会出问题');
t('批改页不在白名单', () =>
  /CACHEABLE = new Set\(\['home', 'me'\]\)/.test(mainJs) ? true : '批改页被缓存了');
t('非缓存页不进pageCache', () =>
  /if \(cacheable\) pageCache\.set\(key, host\)/.test(mainJs)
    ? true
    : '所有页面都被缓存');
t('非缓存页切走时会摘掉旧节点（避免 main 堆叠多页）', () =>
  /if \(!cacheable\) \{[\s\S]*?removeChild\(old\)/.test(mainJs)
    ? true
    : '未清理旧节点，切页会叠加');
t('缓存命中时才复用节点', () =>
  /const cached = cacheable \? pageCache\.get\(key\) : null/.test(mainJs)
    ? true
    : '缓存读取未受白名单约束');

console.log('\n【2】数据变更不再清掉当前页');
t('onDataChange 只失效白名单页面', () =>
  /onDataChange\(\(\) => \{\s*CACHEABLE\.forEach\(invalidatePage\);/.test(mainJs)
    ? true
    : '仍在清理全部缓存 —— 复习时会白屏');
t('没有「数据一变就清空所有缓存」的写法', () =>
  /onDataChange\(\(\) => \{[\s\S]{0,200}pageCache\.clear\(\)/.test(mainJs)
    ? '仍会 pageCache.clear()'
    : true);

console.log('\n【3】复习流程本身不再触发失效');
t('复习翻词仍在同一容器内重绘', () =>
  /sessionDone\+\+;[\s\S]{0,200}renderVocab\(root\)/.test(vocab)
    ? true
    : '复习流程未在容器内重绘');

console.log('\n【4】动效一致性（上一条需求）');
t('定义了 view-enter（一次性入场 class）', () =>
  /\.view-enter\s*\{/.test(appCss) ? true : '未定义');
t('main.js 在换页时加 view-enter', () =>
  /classList\.add\('view-enter'\)/.test(mainJs) ? true : '未添加');
t('动画播完移除该class', () =>
  /animationend[\s\S]{0,120}classList\.remove\('view-enter'\)/.test(mainJs)
    ? true
    : '未移除，会重复触发');
t('页内重绘用 view-silent（无位移）', () =>
  /\.view-silent\s*\{[\s\S]*?fadeInOnly/.test(appCss) ? true : '未定义静默模式');
t('复习会话视图用 view-silent', () =>
  /class="view view-silent"/.test(vocab) ? true : '会话视图未用静默模式');
t('view-silent 不加入场动效', () =>
  /!view\.classList\.contains\('view-silent'\)/.test(mainJs)
    ? true
    : '静默页面也会加入场动效');
t('词汇页列表视图用普通 view（换页有动效）', () =>
  /class="view"/.test(vocab) ? true : '列表视图缺少 view 类');

console.log('\n【5】词库筛选器与新词库对齐');
t('筛选维度只有 ALL/CET4/CET6', () =>
  /const FILTERS = \[\['ALL', '全部'\], \['CET4', '四级'\], \['CET6', '六级'\]\]/.test(vocab)
    ? true
    : '筛选维度未对齐');
t('已移除旧的 CET4A（四级进阶）', () => {
  // 排除注释：注释里提到历史原因不算残留
  const code = vocab.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return /CET4A/.test(code) ? '仍残留 CET4A' : true;
});
t('counts 不再统计 CET4A', () =>
  /const counts = \{ ALL: cards\.length, CET4: 0, CET6: 0 \}/.test(vocab)
    ? true
    : 'counts 仍有旧键');
t('no-anim 类已完全移除', () => {
  // 精确匹配 CSS 规则（注释里提到 .no-anim 是解释历史，不算残留）
  const cssRule = /\.no-anim\s*\{/.test(appCss);
  const htmlClass = /class="[^"]*\bno-anim\b/.test(vocab);
  return cssRule || htmlClass ? '仍有 no-anim 规则或类名' : true;
});
t('LEVEL_TEXT 与新等级一致', () =>
  /LEVEL_TEXT = \{ CET4: '四级', CET6: '六级' \}/.test(vocab) ? true : '未对齐');

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);