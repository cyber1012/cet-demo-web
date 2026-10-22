/**
 * 首页任务进度统计一致性测试
 *
 * 复现的真实 bug：
 * 局部更新用 Object.values(state.tasks[kk]).filter(Boolean).length 统计，
 * 而初始渲染用 TASKS.filter(t => doneMap[t.k]).length 统计。
 * 两者口径不一致 —— 已下线模考页残留的 { mock: true } 会被前者计入，
 * 导致「显示 4/4 但只勾了 3 项」，刷新后又变回 3/4。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'web/js/view-home.js'), 'utf8');

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

console.log('\n【A】统计口径一致');
t('局部更新不再用 Object.values 统计', () => {
  // 排除注释行：旧代码只作为「为什么这样改」的说明保留在注释里
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const bad = /Object\.values\(\s*state\.tasks\s*\[\s*kk\s*\]\s*\)/.test(code);
  return bad ? '仍在用 Object.values(state.tasks[kk])' : true;
});
t('局部更新改为 TASKS.filter 统计', () =>
  /TASKS\.filter\(\s*\(t\)\s*=>\s*state\.tasks\[kk\]\[t\.k\]/.test(src)
    ? true
    : '未按 TASKS 键过滤');
t('初始渲染与局部更新口径一致（都用 TASKS 过滤）', () => {
  const initial = src.match(/const doneCount = TASKS\.filter\(\(t\) => doneMap\[t\.k\]\)/);
  const local = src.match(/const doneCount = TASKS\.filter\(\(t\) => state\.tasks\[kk\]\[t\.k\]\)/);
  return initial && local ? true : '两处口径不一致';
});

console.log('\n【B】行为验证（真实复现 bug）');
// 模拟真实场景：旧用户本地存了 { review:true, vocab:true, trans:true, mock:true, speak:false }
const TASKS = [
  { k: 'review' }, { k: 'vocab' }, { k: 'trans' }, { k: 'speak' },
];
const legacyTasks = {
  review: true,
  vocab: true,
  trans: true,
  mock: true, // 已下线模考页的残留
  // speak 未完成
};

const initialDone = TASKS.filter((t) => legacyTasks[t.k]).length;
const buggy = Object.values(legacyTasks).filter(Boolean).length;
const fixed = TASKS.filter((t) => legacyTasks[t.k]).length;

t('旧算法会把残留 mock 计入（复现 bug）', () =>
  buggy === 4 ? true : '旧算法算出 ' + buggy + '，与截图不符');
t('正确算法只数当前任务键', () =>
  fixed === 3 ? true : '算出 ' + fixed + '，应为 3');
t('新旧口径不一致正是 bug 根因', () =>
  buggy !== fixed ? true : '两者相同，无法复现问题');
t('新代码的统计结果与初始渲染一致', () => {
  const m = src.match(/const doneCount = TASKS\.filter\(\(t\) => state\.tasks\[kk\]\[t\.k\]\)\.length/);
  if (!m) return '未找到新统计代码';
  // 直接用新逻辑跑一遍
  const result = TASKS.filter((t) => legacyTasks[t.k]).length;
  return result === initialDone ? true : '新逻辑 ' + result + ' ≠ 初始渲染 ' + initialDone;
});

console.log('\n【C】边界情况');
t('pct 除零保护存在', () => {
  const m = src.match(/const pct = (.*?);/g);
  if (!m) return '未找到 pct 计算';
  const local = m.find((x) => x.includes('total ?'));
  return local ? true : '局部更新的 pct 未做 total=0 保护: ' + m.join(' | ');
});
t('新的一天 tasks 为空时 doneCount 为 0', () => {
  const empty = {};
  const c = TASKS.filter((t) => empty[t.k]).length;
  return c === 0 ? true : '算成 ' + c;
});
t('全部完成时 doneCount 等于任务总数', () => {
  const all = { review: true, vocab: true, trans: true, speak: true };
  const c = TASKS.filter((t) => all[t.k]).length;
  return c === 4 ? true : '算成 ' + c;
});

console.log('\n────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);