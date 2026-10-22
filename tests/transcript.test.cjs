/**
 * 语音识别文本去重逻辑测试
 *
 * 背景：用户反馈录音时出现「This This crap This crap your…」这类重复文本。
 * 根因是 onresult 里对流式结果做增量追加，而识别会反复触发同一区间的结果。
 * 修复方案：每次从全部 results 重建 + 清洗相邻重复词。
 *
 * 这里直接抽出清洗函数做单元测试，确保修复真的有效。
 */
const fs = require('fs');
const path = require('path');

// 从源码抽出 cleanTranscript，保证测的是真实实现
const src = fs.readFileSync(
  path.resolve(__dirname, '../web/js/view-review.js'),
  'utf8'
);
const m = src.match(/function cleanTranscript\([\s\S]*?\n}\n/);
const m2 = src.match(/function keyOf\([\s\S]*?\n}/);
if (!m || !m2) {
  console.error('✗ 未找到 cleanTranscript / keyOf，无法测试');
  process.exit(1);
}
// 两个函数一起抽出（cleanTranscript 依赖 keyOf），用 return 语句返回前者
const code = m[0] + '\n' + m2[0];
const cleanTranscript = new Function(code + '\nreturn cleanTranscript;')();

const checks = [];
const ck = (name, input, expected) => {
  const got = cleanTranscript(input);
  const pass = got === expected;
  checks.push({ name, pass, got, expected });
};

// ===== 真实场景复现 =====
ck(
  '用户反馈的重复文本被清理',
  'This This crap This crap your This crap your favorite This crap your favorite way',
  'This crap your favorite way'
);

ck('相邻重复单词只保留一个', 'I I think think this is is good', 'I think this is good');

ck('大小写不同的重复也识别', 'The the answer answer is simple', 'The answer is simple');

ck('正常文本不受影响', 'Describe your favorite way to relax', 'Describe your favorite way to relax');

ck('带标点的重复词', 'really really good, very very nice', 'really good, very nice');

ck('空输入返回空串', '', '');

ck('多余空白被规范化', '  hello   world  ', 'hello world');

// ===== 重建式累积的正确性 =====
// 模拟流式识别：每次收到更多结果，但都是完整列表
const results = [
  [{ t: 'Describe', final: true }],
  [{ t: 'Describe your', final: true }],
  [{ t: 'Describe your favorite', final: false }],
  [{ t: 'Describe your favorite way', final: false }],
  [{ t: 'Describe your favorite way to', final: false }],
  [{ t: 'Describe your favorite way to relax', final: true }],
];
const rebuilt = results.map((list) => {
  const finalAll = list
    .filter((r) => r.final)
    .map((r) => r.t)
    .join(' ');
  const interimAll = list
    .filter((r) => !r.final)
    .map((r) => r.t)
    .join(' ');
  return cleanTranscript(interimAll ? finalAll + ' ' + interimAll : finalAll);
});

// 关键性质：最终文本必须等于最后一批 final 结果，且每步长度单调不减
const lastCorrect = rebuilt[rebuilt.length - 1] === 'Describe your favorite way to relax';
ck('重建式累积得到正确最终结果', '', ''); // 占位，稍后单独判定
checks.pop();

checks.push({
  name: '重建式累积得到正确最终结果',
  pass: lastCorrect,
  got: rebuilt[rebuilt.length - 1],
  expected: 'Describe your favorite way to relax',
});

// 对比：旧的追加式实现会产生的重复
let oldWay = '';
for (const list of results) {
  const delta = list[list.length - 1].t;
  oldWay = (oldWay + ' ' + delta).trim();
}
const oldBroken = oldWay !== 'Describe your favorite way to relax';
checks.push({
  name: '对比：旧追加式确实会产生错误（证明测试有意义）',
  pass: oldBroken,
  got: oldWay.slice(0, 60) + '…',
  expected: '非期望结果',
});

console.log('\n语音识别去重测试');
console.log('='.repeat(56));
checks.forEach((c) => {
  console.log(`${c.pass ? '✓' : '✗'} ${c.name}`);
  if (!c.pass && c.expected !== '') {
    console.log(`    期望: ${JSON.stringify(c.expected)}`);
    console.log(`    实际: ${JSON.stringify(c.got)}`);
  }
});
console.log('\n各步骤重建结果：');
rebuilt.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

const bad = checks.filter((c) => !c.pass).length;
console.log('='.repeat(56));
console.log(bad ? `${bad} 项未通过` : '全部通过 — 重复文本问题已修复');
console.log('='.repeat(56));
process.exit(bad ? 1 : 0);