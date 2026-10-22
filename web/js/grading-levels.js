/**
 * 评分标准（唯一来源）
 *
 * 为什么要集中在这里：
 * 之前作文词数标准散落在三处（ai.js 的提示词、view-review.js 的调用处、
 * wordBlock 的警告文案），互相可能不一致 —— 出现过「AI 说符合要求、
 * 界面说词数不足」的自相矛盾。
 *
 * 现在：作文与翻译的所有字数相关判定都只从这里取。
 *
 * 设计要点：**判定只用及格线，黄金区只作建议。**
 * 及格线是考试规则（单一区间，无歧义）；
 * 黄金区是分数梯度（仅提示，不参与判定）。
 * 两者性质不同，混在一起判就会出现「145 词到底算达标还是接近黄金区」
 * 这种无法回答的问题。
 */

/** 作文词数标准（英文单词数） */
export const ESSAY_WORDS = {
  CET4: { min: 120, max: 180, safeMin: 140, safeMax: 170 },
  CET6: { min: 150, max: 200, safeMin: 165, safeMax: 190 },
};

/** 考试等级的中文名 */
export const LEVEL_LABEL = { CET4: '四级', CET6: '六级' };

/** 取等级对应的词数标准；未知等级一律按四级（保守） */
export function getEssayWords(level) {
  return ESSAY_WORDS[level] || ESSAY_WORDS.CET4;
}

/**
 * 判定词数状态。
 *
 * 完全由本地计算，不依赖 AI —— 字数是数出来的，必须确定性。
 *
 * @param {number} count 实际词数
 * @param {string} level 'CET4' | 'CET6'
 * @returns {{status:'short'|'ok'|'long', label:string, tone:'warn'|'good'|'info',
 *            tip:string, inSafe:boolean}}
 */
export function judgeWordCount(count, level) {
  const std = getEssayWords(level);
  const lv = LEVEL_LABEL[level] || '四级';
  const n = Number(count) || 0;
  const safe = std.safeMin - std.safeMax;
  const inSafe = n >= std.safeMin && n <= std.safeMax;

  if (n < std.min) {
    // 0 词是「没写」而非「写少了」，措辞要区分开
    const tip = n === 0
      ? '还没有检测到正文内容，作文不能为空。'
      : `距${lv}最低要求还差 ${std.min - n} 词，词数不足会直接压低「格式规范」与「语言表达」得分。`;
    return {
      status: 'short',
      label: n === 0 ? '未检测到正文' : `词数不足（${n} / ${std.min}-${std.max} 词）`,
      tone: 'warn',
      tip,
      inSafe: false,
    };
  }

  if (n > std.max) {
    return {
      status: 'long',
      label: `篇幅偏长（${n} / ${std.min}-${std.max} 词）`,
      tone: 'info',
      tip: `超出${lv}建议上限 ${n - std.max} 词。注意收束，删掉与主题无关的铺陈比堆砌更显功力。`,
      inSafe: false,
    };
  }

  // 达标（这是绝大多数情况）
  return {
    status: 'ok',
    label: `词数达标（${n} / ${std.min}-${std.max} 词）`,
    tone: 'good',
    tip: inSafe
      ? `处在${lv}稳妥区间 ${safe[0]}-${safe[1]} 词，篇幅控制得当。`
      : `已达${lv}要求。若想更稳妥，可调整到 ${safe[0]}-${safe[1]} 词。`,
    inSafe,
  };
}

/** 本地统计英文词数（不依赖 AI） */
export function countWords(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

/** 供提示词使用的一句话描述（避免 AI 猜错标准） */
export function wordSpecText(level) {
  const std = getEssayWords(level);
  const lv = LEVEL_LABEL[level] || '四级';
  return `${lv}作文要求 ${std.min}-${std.max} 词，稳妥区间 ${std.safeMin}-${std.safeMax} 词`;
}