/**
 * 核心逻辑单元测试：SM-2 间隔重复算法 + 复习队列 + 词库完整性
 * 这些是纯函数，可脱离浏览器运行时验证。
 *
 * 注：原先这里还测模考题库与试卷结构，已随模考下线一并移除。
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/** 加载 ES 模块并转为 CommonJS，以便在 Node 里直接测 */
function loadEsm(rel) {
  let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  src = src.replace(/^export\s*\{([\s\S]*?)\};?\s*$/m, (m, inner) =>
    'module.exports = {' +
    inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => '  ' + s + ',')
      .join('') +
    '};'
  );
  const ctx = { module: { exports: {} }, exports: {}, console, Date, Math };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.module.exports;
}

/** 词库是 export default，单独处理 */
function loadDefault(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const ctx = { module: { exports: {} }, exports: {}, console: null };
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(src.replace(/^export\s+default\s+/gm, 'module.exports.default = '), ctx);
  return ctx.module.exports.default;
}

const srs = loadEsm('web/js/srs.js');
// 词库现在是按等级分片的 JSON（web/data/*.json），不再是代码里的 ES 模块
const cet4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/cet4.json'), 'utf8'));
const cet6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/cet6.json'), 'utf8'));
const wordbank = [...cet4, ...cet6];

let pass = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fails.push(name + ': ' + e.message);
  }
}

const DAY = 24 * 3600 * 1000;

// ===== SM-2 间隔重复算法 =====

t('新卡片初始状态正确', () => {
  const c = srs.createCard('test', { meaning: '测试', phonetic: '/t/', level: 'CET4' });
  assert.strictEqual(c.repetitions, 0);
  assert.strictEqual(c.easeFactor, 2.5);
  assert.strictEqual(c.mastery, 0);
  assert.ok(c.due <= Date.now());
});

t('答对后间隔按 1 → 6 → interval*ease 递增', () => {
  let c = srs.createCard('x', { meaning: 'm' });
  c = srs.reviewCard(c, 5);
  assert.strictEqual(c.repetitions, 1);
  assert.strictEqual(c.interval, 1, '第一次答对应 1 天');

  c = srs.reviewCard(c, 5);
  assert.strictEqual(c.repetitions, 2);
  assert.strictEqual(c.interval, 6, '第二次答对应 6 天');

  const before = c.interval;
  const easeBefore = c.easeFactor;
  c = srs.reviewCard(c, 5);
  // 注意：SM-2 是「先按旧系数算间隔，再更新系数」，
  // 所以这里要用更新前的 easeFactor 验算，不能用更新后的。
  assert.strictEqual(
    c.interval,
    Math.round(before * easeBefore),
    '第三次间隔应等于上次间隔 × 上次系数'
  );
});

t('答错后重置到第一阶段', () => {
  let c = srs.createCard('y', { meaning: 'm' });
  c = srs.reviewCard(c, 5);
  c = srs.reviewCard(c, 5);
  c = srs.reviewCard(c, 5);
  assert.ok(c.repetitions >= 3);

  const easeBefore = c.easeFactor;
  c = srs.reviewCard(c, 1); // 想不起
  assert.strictEqual(c.repetitions, 0, '重复次数应归零');
  assert.strictEqual(c.interval, 1, '间隔应重置为 1 天');
  assert.ok(c.easeFactor < easeBefore, '难度系数应下降');
});

t('难度系数有下限保护', () => {
  let c = srs.createCard('z', { meaning: 'm' });
  for (let i = 0; i < 12; i++) c = srs.reviewCard(c, 1);
  assert.ok(c.easeFactor >= 1.3, '难度系数跌破下限: ' + c.easeFactor);
});

t('下次复习时间随间隔推进', () => {
  const c = srs.createCard('d', { meaning: 'm' });
  assert.ok(c.due - Date.now() <= DAY, '首次应安排在 1 天内');
});

t('保持率随复习间隔衰减', () => {
  // 用「已经复习过的卡」比较：从未复习的新卡保持率恒为 0，不具区分度
  let c = srs.createCard('r', { meaning: 'm' });
  c = srs.reviewCard(c, 5);
  c = srs.reviewCard(c, 5);

  const fresh = srs.retentionRate(c);
  const later = srs.retentionRate(
    Object.assign({}, c, { lastReview: Date.now() - 30 * DAY })
  );
  assert.ok(later < fresh, '30 天未复习的保持率应低于刚复习完: ' + later + ' vs ' + fresh);
});

t('掌握度随复习次数上升', () => {
  let c = srs.createCard('m', { meaning: 'm' });
  const m0 = c.mastery;
  for (let i = 0; i < 4; i++) c = srs.reviewCard(c, 5);
  assert.ok(c.mastery > m0, '连续答对掌握度应上升: ' + m0 + ' → ' + c.mastery);
  assert.ok(c.mastery <= 100, '掌握度不应超过 100');
});

t('自评换算覆盖全部区间', () => {
  for (const q of [0, 1, 2, 3, 4, 5]) {
    const g = srs.gradeFromAccuracy(q / 5);
    assert.ok(g >= 0 && g <= 5, 'grade 越界: ' + g);
  }
});

// ===== 复习队列 =====

t('复习队列把到期词排在未到期词之前', () => {
  const now = Date.now();
  const cards = [
    srs.createCard('future', { meaning: 'a' }),
    Object.assign(srs.createCard('due', { meaning: 'b' }), { due: now - DAY }),
  ];
  const q = srs.buildReviewQueue(cards, 10);
  assert.strictEqual(q[0].word, 'due', '到期词应排第一');
});

t('复习队列按档位排序：到期 > 新词 > 薄弱 > 已掌握', () => {
  const now = Date.now();
  const cards = [
    Object.assign(srs.createCard('mastered', { meaning: 'c' }), {
      due: now + 30 * DAY, repetitions: 5, mastery: 95,
    }),
    Object.assign(srs.createCard('weak', { meaning: 'd' }), {
      due: now + 3 * DAY, repetitions: 2, mastery: 20,
    }),
    Object.assign(srs.createCard('fresh', { meaning: 'e' }), {
      due: now + 5 * DAY, repetitions: 0, mastery: 0,
    }),
    Object.assign(srs.createCard('overdue', { meaning: 'f' }), {
      due: now - 2 * DAY, repetitions: 1, mastery: 40,
    }),
  ];
  const q = srs.buildReviewQueue(cards, 10).map((c) => c.word);
  const idx = (w) => q.indexOf(w);
  assert.ok(idx('overdue') < idx('fresh'), '到期应排在新词前: ' + q.join(' > '));
  assert.ok(idx('fresh') < idx('weak'), '新词应排在薄弱词前: ' + q.join(' > '));
  assert.ok(idx('weak') < idx('mastered'), '薄弱词应排在已掌握前: ' + q.join(' > '));
});

t('同档位内部是乱序的（避免按录入顺序背诵）', () => {
  const now = Date.now();
  const many = Array.from({ length: 20 }, (_, i) =>
    Object.assign(srs.createCard('w' + i, { meaning: 'm' }), {
      due: now + 5 * DAY, repetitions: 0, mastery: 0,
    })
  );
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    orders.add(srs.buildReviewQueue(many, 20).map((c) => c.word).join(','));
  }
  assert.ok(orders.size > 1, '12 次采样结果完全相同 → 未打散');
});

t('逾期越久排越前（同档内细分）', () => {
  const now = Date.now();
  const many = Array.from({ length: 8 }, (_, i) =>
    Object.assign(srs.createCard('w' + i, { meaning: 'm' }), {
      due: now - (i + 1) * DAY, repetitions: 2, mastery: 50,
    })
  );
  const q = srs.buildReviewQueue(many, 20).map((c) => c.word);
  assert.strictEqual(q[0], 'w7', '逾期 8 天的应排最前，实际首位: ' + q[0]);
});

t('复习队列遵守数量上限', () => {
  const cards = Array.from({ length: 60 }, (_, i) =>
    Object.assign(srs.createCard('w' + i, { meaning: 'm' }), { due: Date.now() })
  );
  assert.strictEqual(srs.buildReviewQueue(cards, 30).length, 30);
});

t('空词表不报错', () => {
  // 注意：模块在 vm 沙箱里执行，返回的数组来自另一个 realm，
  // 不能用 deepStrictEqual（原型不同）。只断言结构。
  const q = srs.buildReviewQueue([], 10);
  assert.ok(Array.isArray(q), '应返回数组');
  assert.strictEqual(q.length, 0, '应为空数组');
});

// ===== 词库完整性 =====

t('词库有足够规模', () => {
  assert.ok(wordbank.length >= 4000, '词库过小: ' + wordbank.length);
});

t('每个词条字段完整', () => {
  wordbank.forEach((w) => {
    assert.ok(w.word, '缺 word');
    assert.ok(w.phonetic, w.word + ' 缺音标');
    assert.ok(w.meaning, w.word + ' 缺释义');
    assert.ok(w.example, w.word + ' 缺例句');
    assert.ok(w.level, w.word + ' 缺等级');
  });
});

t('词库三个等级都有覆盖', () => {
  const lv = new Set(wordbank.map((w) => w.level));
  ['CET4', 'CET6'].forEach((k) => {
    assert.ok(lv.has(k), '缺少等级: ' + k);
  });
});

t('音标格式规范（应以 / 包裹）', () => {
  wordbank.forEach((w) => {
    assert.ok(/^\/.+\/$/.test(w.phonetic), w.word + ' 音标格式异常: ' + w.phonetic);
  });
});

t('词库无重复单词', () => {
  const seen = new Set();
  const dup = [];
  wordbank.forEach((w) => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) dup.push(w.word);
    seen.add(k);
  });
  assert.strictEqual(dup.length, 0, '重复词: ' + dup.join(', '));
});

// ===== 输出 =====
console.log('\n' + '='.repeat(56));
console.log('通过 ' + pass + ' 项');
if (fails.length) {
  console.log('\n失败 ' + fails.length + ' 项：');
  fails.forEach((f) => console.log('  ✗ ' + f));
}
console.log('='.repeat(56));
process.exit(fails.length ? 1 : 0);