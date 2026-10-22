/**
 * 词数按等级判定 · 专项测试
 *
 * 背景：作文批改界面出现过自相矛盾——
 *上面 AI 评语写「词数约150词，符合要求」，
 * 下面红字却写「词数不足，已降档」。
 *
 * 根因：wordBlock 的调用条件是 `${r.wordCount ? wordBlock(r) : ''}`，
 * 只要有词数就无条件显示警告，从没做过范围判断。
 * 而且 wordCount 采信 AI 返回值，AI 也可能数错。
 *
 * 本测试锁定：
 * 1. 判定只用及格线（黄金区仅作建议），避免区间重叠导致无法判定
 * 2. 判定完全本地计算，不依赖 AI
 * 3. 达标时不显示任何警告块
 * 4. 等级切换后标准随之改变
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

const std = read('web/js/grading-levels.js');
const ai = read('web/js/ai.js');
const review = read('web/js/view-review.js');
const build = read('build-standalone.js');

console.log('\n【1】标准唯一来源');
t('grading-levels.js 已建立', () =>
  /ESSAY_WORDS/.test(std) ? true : '未定义标准表');
t('四级 120-180 / 六级 150-200', () =>
  /CET4:\s*\{\s*min:\s*120,\s*max:\s*180/.test(std) &&
  /CET6:\s*\{\s*min:\s*150,\s*max:\s*200/.test(std)
    ? true
    : '及格线数值不对');
t('黄金区独立定义（只作建议）', () =>
  /safeMin/.test(std) && /safeMax/.test(std) ? true : '未定义黄金区');
t('判定函数只用 min/max，不拿黄金区当门槛', () => {
  const fn = std.slice(std.indexOf('export function judgeWordCount'));
  // 状态判断只能基于 min/max；safe 只能用于 tip 文案
  const statusLines = fn
    .split('\n')
    .filter((l) => /status:/.test(l))
    .join('\n');
  return /safeMin| safe /.test(statusLines) ? '状态判定用到了黄金区' : true;
});

console.log('\n【2】修掉「只要有词数就报警」');
t('不再无条件显示「词数不足，已降档」', () => {
  // 排除注释：注释里复述历史问题是必要的
  const code = review.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
  return code.includes('词数不足，已降档') ? '文案仍硬编码在渲染逻辑里' : true;
});
t('wordBlock 先判状态再决定是否显示', () =>
  /judgeWordCount\(count, state\.examLevel\)/.test(review) ? true : '未按等级判定');
t('达标且在稳妥区时返回空（不加警告块）', () =>
  /if \(v\.status === 'ok' && v\.inSafe\) return '';/.test(review)
    ? true
    : '达标时仍会渲染');
t('词数为 0 时不显示', () =>
  /if \(count <= 0\) return '';/.test(review) ? true : '空作文会渲染空块');

console.log('\n【3】wordCount 不采信 AI');
t('ai.js 用本地 countWords 覆盖', () =>
  /result\.wordCount = countWords\(essay\)/.test(ai) ? true : '仍采信模型返回值');
t('已导入 countWords', () =>
  /import \{[^}]*countWords[^}]*\} from '\.\/grading-levels\.js'/.test(ai)
    ? true
    : '未导入');

console.log('\n【4】提示词按等级注入');
t('提示词里不再写死「四级120-180词，六级150-200词」', () =>
  /词数是否达标（四级120-180词/.test(ai) ? '写死的标准仍在' : true);
t('range 由 getEssayWords 动态生成', () =>
  /const std = getEssayWords\(lv\)/.test(ai) ? true : '未按等级取标准');
t('提示词同时给出及格线与稳妥区间', () =>
  /及格区间/.test(ai) && /稳妥区间/.test(ai) ? true : '未区分两者');
t('明确告知 AI 不必播报字数达标（避免与界面矛盾）', () =>
  /不要在 comment 里重复播报字数/.test(ai) ? true : '未约束 AI');

console.log('\n【5】翻译：只看译文质量');
t('reviewTranslation 接�� level', () =>
  /reviewTranslation\(\{ source, translation, level, onDelta \}\)/.test(ai)
    ? true
    : '未接收 level');
t('系统提示随等级变化', () =>
  /大学英语\$\{lvLabel\}翻译阅卷教师/.test(ai) ? true : '未按等级区分');
t('明确列出五个质量维度', () =>
  /语义准确/.test(ai) && /要点完整/.test(ai) && /语法正确/.test(ai) &&
  /中式直译规避/.test(ai) && /表达效果/.test(ai)
    ? true
    : '五维度不全');
t('界面不再显示原文汉字数要求', () =>
  /140-160 汉字|180-200 汉字/.test(review.replace(/\/\/[^\n]*/g, ''))
    ? '仍有「汉字数」要求'
    : true);
t('改为「按译文质量评分」', () =>
  /按译文质量评分/.test(review) ? true : '未改文案');
t('调用处传了 level', () =>
  /reviewTranslation\(\{[\s\S]{0,200}level:/.test(review) ? true : '未传 level');

console.log('\n【6】界面实时提示');
t('输入区用标准表生成范围', () =>
  /const range = `\$\{std\.min\}-\$\{std\.max\} 词`/.test(review)
    ? true
    : '仍用硬编码 range');
t('显示实时达标状态', () =>
  /judgeWordCount\(wc, lv\)/.test(review) ? true : '无实时状态');
t('导入 grading-levels', () =>
  /from '\.\/grading-levels\.js'/.test(review) ? true : '未导入');

console.log('\n【7】构建配置');
t('grading-levels 在模块清单中', () =>
  /'js\/grading-levels\.js'/.test(build) ? true : '未加入清单');
t('声明为无依赖', () =>
  /'grading-levels': \[\]/.test(build) ? true : '依赖声明缺失');
t('ai 依赖 grading-levels', () =>
  /ai: \['cloud', 'grading-levels'\]/.test(build) ? true : '未声明');
t('view-review 依赖 grading-levels', () =>
  /'view-review': \['app', 'grading-levels'\]/.test(build) ? true : '未声明');
t('grading-levels 排在 ai 之前', () => {
  const i = build.indexOf("'js/grading-levels.js'");
  const j = build.indexOf("'js/ai.js'");
  return i > 0 && i < j ? true : '加载顺序错误（依赖必须在前）';
});

console.log('\n【8】边界与实际用例');
t('实际验证：判定函数行为正确', () => {
  // 直接执行被测模块
  const src = std
    .replace(/export const/g, 'const')
    .replace(/export function/g, 'function');
  const fn = new Function(src + `
    return { judgeWordCount, countWords, getEssayWords, ESSAY_WORDS };
  `)();

  const cases = [
    // [词数, 等级, 期望状态, 说明]
    [153, 'CET6', 'ok', '用户案例：153词在六级150-200内'],
    [153, 'CET4', 'ok', '153词在四级120-180内'],
    [100, 'CET4', 'short', '100词低于四级下限'],
    [100, 'CET6', 'short', '100词低于六级下限'],
    [119, 'CET4', 'short', '119词差1词仍算不足'],
    [120, 'CET4', 'ok', '120词正好达四级下限'],
    [180, 'CET4', 'ok', '180词正好达四级上限'],
    [181, 'CET4', 'long', '181词超四级上限'],
    [150, 'CET6', 'ok', '150词正好达六级下限'],
    [200, 'CET6', 'ok', '200词正好达六级上限'],
    [201, 'CET6', 'long', '201词超六级上限'],
    [145, 'CET4', 'ok', '145词：及格线内且在黄金区(140-170)'],
    [175, 'CET4', 'ok', '175词：及格线内但不在黄金区 —— 必须判 ok，不能模糊'],
    [0, 'CET4', 'short', '0词（调用处会拦，这里兜底）'],
  ];

  const bad = [];
  for (const [n, lv, expect, desc] of cases) {
    const r = fn.judgeWordCount(n, lv);
    if (r.status !== expect) {
      bad.push(desc + ' → 期望 ' + expect + ' 得到 ' + r.status);
    }
  }
  return bad.length ? bad.join('; ') : true;
});

t('实际验证：175词（黄金区外但及格线内）判为 ok 且提示建议', () => {
  const src = std.replace(/export const/g, 'const').replace(/export function/g, 'function');
  const fn = new Function(src + 'return { judgeWordCount };')();
  const r = fn.judgeWordCount(175, 'CET4');
  return r.status === 'ok' && !r.inSafe && /稳妥/.test(r.tip)
    ? true
    : 'status=' + r.status + ' inSafe=' + r.inSafe + ' tip=' + r.tip;
});

t('实际验证：词数统计准确（本地计算）', () => {
  const src = std.replace(/export const/g, 'const').replace(/export function/g, 'function');
  const fn = new Function(src + 'return { countWords };')();
  const cases = [
    ['', 0],
    ['   ', 0],
    ['hello world', 2],
    ['a b c d e', 5],
    ['  leading and trailing  ', 3],
    ['line1\nline2', 2],
    ['中文中文', 1],
  ];
  const bad = [];
  for (const [input, expect] of cases) {
    const got = fn.countWords(input);
    if (got !== expect) bad.push(JSON.stringify(input) + ' → 期望 ' + expect + ' 得到 ' + got);
  }
  return bad.length ? bad.join('; ') : true;
});

t('实际验证：等级切换后标准改变', () => {
  const src = std.replace(/export const/g, 'const').replace(/export function/g, 'function');
  const fn = new Function(src + 'return { judgeWordCount, getEssayWords };')();
  // 同一个词数在两个等级下应得到不同判定
  const n = 130;
  const r4 = fn.judgeWordCount(n, 'CET4');
  const r6 = fn.judgeWordCount(n, 'CET6');
  return r4.status === 'ok' && r6.status === 'short'
    ? true
    : '130词：四级=' + r4.status + ' 六级=' + r6.status + '（应四级达标、六级不足）';
});

t('实际验证：未知等级按四级（保守）', () => {
  const src = std.replace(/export const/g, 'const').replace(/export function/g, 'function');
  const fn = new Function(src + 'return { judgeWordCount, getEssayWords };')();
  const a = fn.judgeWordCount(130, undefined);
  const b = fn.judgeWordCount(130, 'CET4');
  return a.status === b.status && a.label === b.label
    ? true
    : '未知等级行为不一致：' + a.label + ' vs ' + b.label;
});

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);