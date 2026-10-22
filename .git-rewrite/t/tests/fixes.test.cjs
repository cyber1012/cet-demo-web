/**
 * 本轮五项修复的回归测试
 *
 * 1. 详细解析不再死循环（按钮出现次数 / 请求次数）
 * 2. 词汇队列：同优先级内乱序，但逾期优先不被破坏
 * 3. 词汇编号从 1 开始
 * 4. 页面切换性能：不再有逐帧 filter: blur
 * 5. 无 emoji 图标
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
    if (r === true || r === undefined) {
      console.log('  ✓ ' + name);
      pass++;
    } else {
      console.log('  ✗ ' + name + ' → ' + r);
      fail++;
    }
  } catch (e) {
    console.log('  ✗ ' + name + ' → 抛错: ' + e.message);
    fail++;
  }
};

console.log('\n【1】详细解析死循环');
const vr = read('web/js/view-review.js');
t('详情加载后清空 __essayText（否则按钮重现导致循环）', () => {
  const seg = vr.slice(vr.indexOf('r.detailPending = false;'));
  return seg.includes("r.__essayText = ''") ? true : '未清空 __essayText';
});
t('详情加载后清空 __source / __transText', () => {
  const seg = vr.slice(vr.indexOf('r.detailPending = false;'));
  return seg.includes("r.__source = ''") && seg.includes("r.__transText = ''")
    ? true
    : '未清空原文/译文缓存';
});
t('按钮显示条件只依赖 detailPending（不再用 __essayText）', () => {
  return /r\.detailPending\s*\n?\s*\?/.test(vr) || /\$\{\s*r\.detailPending\s*\?/.test(vr)
    ? true
    : '按钮条件仍含 __essayText';
});
t('loading 态按钮被 disabled（防止重复点击）', () =>
  vr.includes("${r.detailLoading ? 'disabled' : ''}") ? true : '未禁用');
t('错误分支重置 detailLoading', () => {
  const seg = vr.slice(vr.indexOf('} catch (e) {', vr.indexOf('r.detailPending = false;')));
  return seg.includes('r.detailLoading = false') ? true : 'catch 未重置 loading';
});
t('重绘保留滚动位置', () =>
  vr.includes('sheet.scrollTop = prevTop') ? true : '未保留 scrollTop');

console.log('\n【2】词汇队列优先级');
const srsSrc = read('web/js/srs.js');
t('buildReviewQueue 内部有分组打散（不依赖外部 shuffle）', () =>
  srsSrc.includes('buckets') ? true : '未见分组逻辑');
t('保留 tier 分档（逾期 > 新词 > 薄弱 > 已掌握）', () =>
  /tier = 4/.test(srsSrc) && /tier = 3/.test(srsSrc) && /tier = 2/.test(srsSrc)
    ? true
    : '缺少 tier 分档');
t('view-vocab 不再对整个队列 shuffle', () => {
  const vv = read('web/js/view-vocab.js');
  return /queue\s*=\s*shuffle/.test(vv) ? '仍有 queue = shuffle(...)' : true;
});
t('shuffle 辅助函数已删除', () => {
  const vv = read('web/js/view-vocab.js');
  return /function\s+shuffle/.test(vv) ? 'shuffle 函数仍在' : true;
});

console.log('\n【3】词汇编号');
const vv = read('web/js/view-vocab.js');
t('显示「第 N / M 个」且 N 从 1 开始', () => {
  const m = vv.match(/const current = ([^;]+);/);
  if (!m) return '未找到 current 计算';
  return /sessionDone\s*\+\s*1/.test(m[1]) ? true : 'current 计算不是 sessionDone+1: ' + m[1];
});
t('界面文案为「第 N / M 个」', () =>
  vv.includes('第 ${current} / ${sessionTotal} 个') ? true : '文案未更新');

console.log('\n【4】页面切换性能');
const views = read('web/styles/views.css');
t('云团容器不再有 filter: blur（逐帧重算高斯模糊）', () => {
  const m = views.match(/\.hero-ai-clouds\s*\{[^}]*\}/);
  if (!m) return '未找到 .hero-ai-clouds';
  return /filter\s*:/.test(m[0]) ? '仍有 filter: ' + m[0] : true;
});
t('云团改用多层径向渐变自带柔边', () =>
  (views.match(/radial-gradient\(circle, rgba\([^)]+\) 0%, rgba\([^)]+\)/g) || []).length >= 3
    ? true
    : '渐变层数不足');
t('按钮呼吸光晕改用 transform 而非 box-shadow 动画', () => {
  const m = views.match(/@keyframes btnBreath\s*\{[^}]*\{[^}]*\}[^}]*\}[^}]*\}/);
  const seg = views.slice(views.indexOf('@keyframes btnBreath'));
  const body = seg.slice(0, seg.indexOf('}'));
  return /transform/.test(body) && !/box-shadow/.test(body)
    ? true
    : 'btnBreath 仍在动 box-shadow';
});
t('导航栏不再每次重建（改为 class 切换）', () => {
  const mj = read('web/js/main.js');
  return /function buildNav/.test(mj) && /navBuilt/.test(mj) ? true : '未做一次性构建';
});
t('导航文字用 CSS 过渡而非 JS 条件渲染', () => {
  const app = read('web/styles/app.css');
  return /\.tabnav-item\.has-text \.tabnav-txt/.test(app) ? true : '缺少 has-text 规则';
});
t('词表列表分页（一次只渲染 40 条）', () => {
  // 注：分页变量（filtered/visible/hasMore）后来移进了 listHTML() 函数内，
  // 所以这里检查 listLimit 与 slice(0, listLimit) 这对组合。
  return /listLimit = 40/.test(vv) && /slice\(0,\s*listLimit\)/.test(vv)
    ? true
    : '未分页';
});
t('页面不可见时暂停动画', () => {
  const mj = read('web/js/main.js');
  return /visibilitychange/.test(mj) && /page-hidden/.test(views) ? true : '未实现';
});

console.log('\n【5】图标与翻译页');
t('无 emoji 图标残留', () => {
  const files = ['view-review.js', 'view-home.js', 'view-vocab.js', 'view-me.js', 'app.js'];
  for (const f of files) {
    const s = read('web/js/' + f);
    const m = s.match(/[\u{1F300}-\u{1FAFF}]/gu);
    if (m) return f + ' 仍有 emoji: ' + m.join(' ');
  }
  return true;
});
t('使用内联 SVG 相机图标', () =>
  /CAMERA_ICON\s*=\s*`<svg/.test(vr) ? true : '未定义 SVG 图标');
t('SVG 图标用于两处拍照按钮', () => {
  const n = (vr.match(/\$\{CAMERA_ICON\}/g) || []).length;
  return n >= 2 ? true : '仅用了 ' + n + ' 处';
});
t('翻译页原文输入框默认折叠（showSource 控制）', () =>
  /showSource\s*\?/.test(vr) ? true : '未用 showSource 控制');
t('翻译页有折叠开关按钮', () =>
  vr.includes('data-act="toggle-source"') ? true : '缺少 toggle-source');
t('识别到原文时自动展开', () =>
  /showSource = true/.test(vr) ? true : '未自动展开');

console.log('\n────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
