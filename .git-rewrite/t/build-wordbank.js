/**
 * 词库构建脚本
 *
 * 数据源：网易有道「有道考神」官方词书（真��真题词频筛选）
 *   - CET4luan_1  四级真题核心词1162（有道按历年四级真题词频筛）
 *   - CET4_2/CET4luan_2  四级英语词汇 3739
 *   - CET6luan_1  六级真题核心词 1228
 *   - CET6_2      六级英语词汇 2078
 *   - CET6_3      新东方六级词汇 2345
 *
 * 产出：
 *   web/data/cet4.json  四级 2000 词
 *   web/data/cet6.json  六级 4000 词
 *
 * 分组依据（A 顺序）：
 *   1) 真题核心词全部收录，排在最前 —— 这是最高频的部分
 *   2) 剩余名额由大纲词书按「原书顺序」补足
 *   3) 词书原书顺序本身就是词频序（有道/新东方的编排依据）
 *
 * 全局去重：四级与六级共用一个 seen 集合
 */

const fs = require('fs');
const path = require('path');

// 原始词书数据放在 backup 目录（tmp 只是下载中转，已清理）。
// 若 backup 里没有，去网易有道 CDN 重新下载后用 scripts/prepare-books 预处理。
const TMP = path.resolve(__dirname, '.workbuddy/backup/wordbank-source');
// 词书已由 Python 预解压为 JSONL（zip 压缩方式多样，JS 手写解析不稳）
const BOOKS = path.join(TMP, 'books_jsonl');
const OUT = path.resolve(__dirname, 'web/data');

const CET4_TARGET = 2000;
const CET6_TARGET = 4000;

// ===== 词条解析 =====
function pickPosMeaning(trans) {
  // trans 结构：[{ pos:'adj', tranCn:'一致的', descCn:'中释' }]
  // 注意：真正的中文释义是 tranCn，descCn 在这个数据源里是占位符「中释」
  if (!Array.isArray(trans) || !trans.length) return '';
  const parts = [];
  for (const t of trans) {
    if (!t) continue;
    const cn = (t.tranCn || '').trim();
    if (!cn || cn === '中释' || cn === '英释') continue;
    const pos = (t.pos || '').trim();
    const piece = pos ? pos + '. ' + cn : cn;
    if (!parts.includes(piece)) parts.push(piece);
    if (parts.length >= 2) break;
  }
  return parts.join('；');
}

function pickSentences(sentenceGroup, word, max = 2) {
  if (!sentenceGroup || !sentenceGroup.sentences) return [];
  const list = sentenceGroup.sentences;
  const w = String(word).toLowerCase();
  // 例句必须真的含该词（允许 -s/-ed/-ing 变形）
  const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es|ed|d|ing|ly)?\\b', 'i');

  const good = list
    .filter((s) => s && s.sContent && re.test(s.sContent))
    .map((s) => ({
      en: s.sContent.trim(),
      cn: (s.sCn || '').trim(),
      // 带中文翻译的优先：有些例句只有英文没有译文
      hasCn: !!(s.sCn && s.sCn.trim() && s.sCn.trim() !== '中释'),
    }))
    .filter((s) => {
      const words = s.en.split(/\s+/).length;
      return words >= 5 && words <= 22;
    })
    // 排序：先要带中文的，再按句子长度适中优先
    .sort((a, b) => {
      if (a.hasCn !== b.hasCn) return a.hasCn ? -1 : 1;
      return Math.abs(a.en.split(/\s+/).length - 12) - Math.abs(b.en.split(/\s+/).length - 12);
    });

  // 只要有带中文的就优先用它；全部都没有中文时，退回第一条（英文例句仍有价值）
  const withCn = good.filter((s) => s.hasCn);
  const pool = withCn.length ? withCn : good;
  return pool.slice(0, max);
}

/** 从一个词书 JSONL 里读出标准化词条 */
function loadBook(file, level) {
  const p = path.join(BOOKS, file);
  if (!fs.existsSync(p)) {
    console.log('  ! 文件不存在: ' + file);
    return [];
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  const out = [];
  lines.forEach((line, idx) => {
    let w;
    try {
      w = JSON.parse(line);
    } catch (e) {
      return; // 单行解析失败不影响整体
    }
    const head = w.headWord ||
      (w.content && w.content.word && w.content.word.content &&
       w.content.word.content.wordHead);
    if (!head) return;
    const c = (w.content && w.content.word && w.content.word.content) || {};
    const phone = (c.ukphone || c.usphone || '').toString().trim().replace(/^\/|\/$/g, '');
    const meaning = pickPosMeaning(c.trans);
    if (!phone || !meaning) return;

    // 例句选择：
    // 关键 —— realExamSentence（真题例句）设计上只有英文原文 + 来源信息，
    // 没有 sCn 中文翻译。所以它只能作为「第二选择」：
    //   1) 优先取带中文翻译的普通例句
    //   2) 普通例句都没有翻译时，才用真题例句（至少是真实考过的高频句）
    // 之前把真题例句排前面，导致四级 64% 的词没有中文翻译。
    const normalSents = pickSentences(c.sentence, head, 2);
    const examSents = pickSentences(c.realExamSentence, head, 2);
    const sents = normalSents.length ? normalSents : examSents;
    if (!sents.length) return;

    out.push({
      word: head.trim(),
      phonetic: '/' + phone + '/',
      meaning: meaning,
      example: sents[0].en,
      exampleCn: sents[0].cn,
      example2: sents[1] ? sents[1].en : '',
      example2Cn: sents[1] ? sents[1].cn : '',
      // 真题例句单独存（附年份/题型来源），界面上可作为「考点提示」展示
      examExample: examSents.length ? examSents[0].en : '',
      examSource: (c.realExamSentence && c.realExamSentence.sentences &&
        c.realExamSentence.sentences[0] && c.realExamSentence.sentences[0].sourceInfo)
        ? [c.realExamSentence.sentences[0].sourceInfo.year, c.realExamSentence.sentences[0].sourceInfo.type]
            .filter(Boolean).join(' ')
        : '',
      rank: Number(w.wordRank) || idx + 1,
      level,
    });
  });
  return out;
}

// ===== 开始构建 =====
console.log('读取词书…');
const CET4_CORE = loadBook('1523620217431_CET4luan_1.jsonl', 'CET4'); // 四级真题核心 1162
const CET4_FULL = loadBook('1524052539052_CET4luan_2.jsonl', 'CET4'); // 四级全量 3739
const CET6_CORE = loadBook('1521164660466_CET6luan_1.jsonl', 'CET6'); // 六级真题核心 1228
const CET6_FULL = loadBook('1524052554766_CET6_2.jsonl', 'CET6');   // 六级词汇 2078
const CET6_EXTRA = loadBook('1521164633851_CET6_3.jsonl', 'CET6'); // 新东方六级 2345

console.log('  四级真题核心 ' + CET4_CORE.length + ' · 四级全量 ' + CET4_FULL.length);
console.log('  六级真题核心 ' + CET6_CORE.length + ' · 六级词汇 ' + CET6_FULL.length + ' · 新东方六级 ' + CET6_EXTRA.length);

const norm = (w) => String(w).toLowerCase().trim();
const globalSeen = new Set();

/** 按「核心优先、原书顺序」组装词库 */
function assemble(core, fullList, extras, target, levelName) {
  const result = [];
  let dupSkip = 0;

  const push = (item) => {
    if (result.length >= target) return false;
    const k = norm(item.word);
    if (!k || globalSeen.has(k)) { dupSkip++; return true; }
    globalSeen.add(k);
    // 高频核心词标记为 CET4A / CET6A（进阶层）
    result.push(item);
    return result.length < target;
  };

  // 第 1 层：真题核心词（最高频）
  core.forEach((it) => { it.level = levelName; push(it); });
  // 第 2 层：大纲词书（按原书顺序 = 词频序）
  fullList.forEach((it) => { it.level = levelName; push(it); });
  // 第 3 层：补充来源
  extras.forEach((it) => { it.level = levelName; push(it); });

  return { list: result, dupSkip };
}

console.log('\n组装四级（目标 ' + CET4_TARGET + '）…');
const r4 = assemble(CET4_CORE, CET4_FULL, [], CET4_TARGET, 'CET4');
console.log('  四级 ' + r4.list.length + ' 词（去重跳过 ' + r4.dupSkip + '）');
const coreInCet4 = r4.list.filter((w) => CET4_CORE.some((c) => norm(c.word) === norm(w.word))).length;
console.log('  其中真题核心词 ' + coreInCet4 + '（占比 ' + Math.round((coreInCet4 / r4.list.length) * 100) + '%）');

console.log('\n组装六级（目标 ' + CET6_TARGET + '）…');
let r6 = assemble(CET6_CORE, CET6_FULL, CET6_EXTRA, CET6_TARGET, 'CET6');
console.log('  三级来源合并后 ' + r6.list.length + ' 词（去重跳过 ' + r6.dupSkip + '）');


console.log('  其中真题核心词 ' + r6.list.filter((w) => CET6_CORE.some((c) => norm(c.word) === norm(w.word))).length +
  '（占 ' + Math.round((r6.list.filter((w) => CET6_CORE.some((c) => norm(c.word) === norm(w.word))).length / r6.list.length) * 100) + '%）');

// ===== 输出 =====
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'cet4.json'), JSON.stringify(r4.list));
fs.writeFileSync(path.join(OUT, 'cet6.json'), JSON.stringify(r6.list));

const kb = (a) => (Buffer.byteLength(JSON.stringify(a)) / 1024).toFixed(0);
console.log('\n产出：');
console.log('  cet4.json  ' + r4.list.length + ' 词 · ' + kb(r4.list) + ' KB');
console.log('  cet6.json  ' + r6.list.length + ' 词 · ' + kb(r6.list) + ' KB');

// ===== 质量校验 =====
console.log('\n质量校验：');
const all = [...r4.list, ...r6.list];
const keys = all.map((w) => norm(w.word));
const uniq = new Set(keys).size;
console.log('  总词数 ' + all.length + ' | 唯一 ' + uniq + (uniq === all.length ? ' ✓ 全局无重复' : ' ✗ 有 ' + (all.length - uniq) + ' 个重复'));
const badPh = all.filter((w) => !/^\/.+\/$/.test(w.phonetic));
const noMn = all.filter((w) => !w.meaning);
const noEx = all.filter((w) => !w.example);
console.log('  音标 ' + (all.length - badPh.length) + '/' + all.length + (badPh.length ? '✗' : '✓'));
console.log('  释义 ' + (all.length - noMn.length) + '/' + all.length + (noMn.length ? '✗' : '✓'));
console.log('  例句 ' + (all.length - noEx.length) + '/' + all.length +
  ' (' + Math.round(((all.length - noEx.length) / all.length) * 100) + '%)' + (noEx.length ? '✗' : '✓'));

console.log('\n四级前 5（应为真题高频）:');
r4.list.slice(0, 5).forEach((w) =>
  console.log('  ' + w.word.padEnd(14) + w.phonetic.padEnd(18) + w.meaning.slice(0, 24)));
console.log('\n六级前 5（应为真题高频）:');
r6.list.slice(0, 5).forEach((w) =>
  console.log('  ' + w.word.padEnd(14) + w.phonetic.padEnd(18) + w.meaning.slice(0, 24)));