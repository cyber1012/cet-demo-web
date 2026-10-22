/**
 * SM-2 间隔重复算法（SuperMemo 2）
 * 遗忘曲线不是玄学：在 t 时刻复习，记忆保持率 R = e^(-t/S)，S 为记忆强度。
 * SM-2 的核心是根据每次回忆结果调整 S，从而推算下次复习的最优时刻。
 *
 * 质量分 q ∈ [0,5]：
 *   q < 3  → 忘记，间隔重置为 1 天
 *   q >= 3 → 记住，间隔按递增系数放大
 */

// SM-2 质量分换算
function gradeFromAccuracy(accuracy) {
  // accuracy: 0~1 的自评正确率
  if (accuracy < 0.4) return 1; // 完全想不起
  if (accuracy < 0.6) return 3; // 想起来很吃力
  if (accuracy < 0.8) return 4; // 有点犹豫但答对
  return 5; // 秒答
}

/**
 * 计算一次复习后的新状态
 * @param {object} card 单词卡片状态
 * @param {number} quality 质量分 0-5
 * @returns {object} 新的卡片状态
 */
function reviewCard(card, quality) {
  const next = Object.assign({}, card);

  if (quality < 3) {
    // 忘了：重置重复次数，回到第一阶段
    next.repetitions = 0;
    next.interval = 1; // 明天再来
    next.easeFactor = Math.max(1.3, next.easeFactor - 0.2);
  } else {
    next.repetitions += 1;
    if (next.repetitions === 1) {
      next.interval = 1;
    } else if (next.repetitions === 2) {
      next.interval = 6;
    } else {
      // 间隔 = 上一间隔 × 难度系数
      next.interval = Math.round(next.interval * next.easeFactor);
    }
    // 难度系数随表现浮动
    next.easeFactor = Math.max(
      1.3,
      next.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
  }

  next.lastReview = Date.now();
  next.due = Date.now() + next.interval * 24 * 3600 * 1000;
  next.mastery = calcMastery(next);
  return next;
}

/**
 * 估算当前记忆保持率 —— 用于首页「记忆留存」可视化
 * R = e^(-t / S)，t 为距上次复习的天数，S 由难度系数推得
 */
function retentionRate(card) {
  if (!card.lastReview) return 0;
  const days = (Date.now() - card.lastReview) / (24 * 3600 * 1000);
  // 记忆强度：难度系数越高，遗忘越慢
  const S = Math.max(0.5, card.easeFactor - 0.6) * 2.2;
  const r = Math.exp(-days / S);
  return Math.max(0, Math.min(1, r));
}

/** 掌握度 0-100，综合重复次数与保持率 */
function calcMastery(card) {
  const repScore = Math.min(60, card.repetitions * 15);
  const retScore = retentionRate(card) * 40;
  return Math.round(Math.min(100, repScore + retScore));
}

/** 创建新卡片 */
function createCard(word, data) {
  const card = {
    word: word,
    meaning: data.meaning,
    phonetic: data.phonetic,
    example: data.example || '',
    level: data.level || 'CET4',
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    lastReview: 0,
    due: Date.now(),
    mastery: 0,
    wrongCount: 0,
  };
  return card;
}

/**
 * 生成今日复习队列
 * 优先级规则（分档 tier，档内再乱序）：
 *   1. 已到期待复习 → tier 4，逾期越久越靠前
 *   2. 未学新词     → tier 3
 *   3. 已学但薄弱   → tier 2（掌握度越低越靠前）
 *   4. 已掌握       → tier 1
 *
 * 关键：乱序只发生在「同一档内」。
 * 若对整个队列做随机打乱，逾期最久的词会排到最后 —— 记忆曲线就失效了。
 */
function buildReviewQueue(cards, limit = 50) {
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;

  const scored = cards.map((c) => {
    const isDue = c.due <= now;
    const overdueDays = Math.max(0, (now - c.due) / DAY);
    const weak = c.repetitions > 0 && c.mastery < 70;

    let tier;
    if (isDue) {
      tier = 4; // 到期（含逾期）
    } else if (c.repetitions === 0) {
      tier = 3; // 没学过的生词
    } else if (weak) {
      tier = 2; // 学过但没掌握牢
    } else {
      tier = 1; // 已掌握，兜底
    }
    return { card: c, tier, overdueDays, mastery: c.mastery };
  });

  // 档内用 Fisher-Yates 打乱；档间按 tier 降序、逾期天数降序、掌握度升序
  const buckets = new Map();
  scored.forEach((s) => {
    if (!buckets.has(s.tier)) buckets.set(s.tier, []);
    buckets.get(s.tier).push(s);
  });

  const tiers = [...buckets.keys()].sort((a, b) => b - a);
  const out = [];
  for (const t of tiers) {
    const arr = buckets.get(t);
    // 同档内打乱，避免按字母序/录入序背诵
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // 档内再按「逾期更久 / 掌握更差」细排，保证重点词靠前
    arr.sort((a, b) => {
      if (a.tier === 4 && b.tier === 4) return b.overdueDays - a.overdueDays;
      if (a.tier === 2 && b.tier === 2) return a.mastery - b.mastery;
      return 0;
    });
    out.push(...arr);
  }

  return out.slice(0, limit).map((s) => s.card);
}

export {
  reviewCard,
  retentionRate,
  createCard,
  buildReviewQueue,
  gradeFromAccuracy,
  calcMastery,
};