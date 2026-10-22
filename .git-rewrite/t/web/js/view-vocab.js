/**
 * 词汇页 · 记忆曲线
 *
 * 定位：AI 批改报错的高频词优先进入复习队列，而不是背通用词表。
 * 四级与六级词库分开，学习时乱序出题（按记忆曲线+随机打散）。
 */
import { state, persist, ensureCards, toast, srs } from './app.js';

let queue = [];
let qIndex = 0;
let revealed = false;
let sessionDone = 0;
let sessionTotal = 0;

// 词表列表每次渲染的条数上限（分页加载）
let listLimit = 40;
let filter = 'ALL';
let inSession = false;

const LEVEL_TEXT = { CET4: '四级', CET6: '六级' };

export function renderVocab(root) {
  ensureCards();
  // 词库异步加载，首次渲染时 state.cards 可能为 null，必须兜底
  const cards = state.cards || [];
  const now = Date.now();
  const due = cards.filter((c) => c.due <= now).length;
  const learned = cards.filter((c) => c.repetitions > 0).length;
  const mastered = cards.filter((c) => c.mastery >= 70).length;

  const counts = { ALL: cards.length, CET4: 0, CET6: 0 };
  cards.forEach((c) => {
    if (counts[c.level] !== undefined) counts[c.level]++;
  });

  // 列表分页：一次只渲染 40 条，滚动到底再加载。
  // 之前一次渲染 150 条 DOM，切到词汇页会明显卡一下。
  // 列表内容由 listHTML() 负责，便于筛选时局部更新。

  // 筛选维度必须与当前词库的 level 字段一致。
  // 词库换代后 level 只有 CET4 / CET6 两级（来自官方四级/六级词书），
  // 之前这里还写着旧的 CET4/CET4A/CET6 三级，导致「四级进阶」「六级」恒为 0。
  const FILTERS = [['ALL', '全部'], ['CET4', '四级'], ['CET6', '六级']];

  root.innerHTML = inSession ? sessionView() : `<div class="view">
    <header class="flex between mt-lg mb-lg" style="align-items:flex-end">
      <h1 class="display">词汇</h1>
      <span class="label">MEMORY CURVE</span>
    </header>

    <div class="grid-2 mb-lg">
      <div class="card-grad g-violet">
        <p class="label" style="color:rgba(15,15,14,.5)">四级</p>
        <p class="numeral mt-xs" style="font-size:40px">${counts.CET4}</p>
      </div>
      <div class="card-grad g-mint">
        <p class="label" style="color:rgba(15,15,14,.5)">六级</p>
        <p class="numeral mt-xs" style="font-size:40px">${counts.CET6}</p>
      </div>
      <div class="card-grad g-lime">
        <p class="label" style="color:rgba(15,15,14,.5)">待复习</p>
        <p class="numeral mt-xs" style="font-size:40px">${due}</p>
      </div>
      <div class="inner-dark p-lg">
        <p class="label" style="color:rgba(255,255,255,.45)">已掌握</p>
        <p class="numeral mt-xs" style="font-size:40px;color:var(--lime)">${mastered}</p>
      </div>
    </div>

    <button class="btn btn-primary btn-block mb-lg" data-act="start">
      开始今日复习 · ${due} 词
    </button>

    <div class="flex gap-xs mb-md">
      ${FILTERS
        .map(([k, t]) => `<button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">${t}<span class="chip-n">${counts[k] || 0}</span></button>`)
        .join('')}
    </div>

    <div class="card-flat" id="wordList" style="padding:0 var(--s-md)">
      ${listHTML()}
    </div>
  </div>`;

  bind(root);
}

/**
 * 词表列表的 HTML。
 *
 * 抽成独立函数，是为了筛选切换时能只替换 #wordList 的内容，
 * 而不重建整个页面 —— 之前每次都重写 root.innerHTML，
 * 导致标题、统计卡、筛选按钮全部重新创建，
 * 加上列表长度变化引起容器高度突变，视觉上就是「刷新一下」。
 */
function listHTML() {
  const cards = state.cards || [];
  const filtered = cards.filter((c) => filter === 'ALL' || c.level === filter);
  const visible = filtered.slice(0, listLimit);
  const hasMore = filtered.length > visible.length;

  if (!visible.length) {
    return `<p class="label" style="text-align:center;padding:var(--s-lg) 0">该分类暂无单词</p>`;
  }

  return (
    visible
      .map(
        (c) => `
    <div class="row">
      <div class="grow">
        <div class="flex" style="align-items:baseline;gap:8px">
          <span class="body" style="color:var(--ink);font-weight:700">${esc(c.word)}</span>
          <span class="faint" style="font-size:12px">${esc(c.phonetic)}</span>
        </div>
        <span class="caption muted">${esc(c.meaning)}</span>
      </div>
      <div class="mastery-bar"><div class="mastery-fill" style="height:${c.mastery}%"></div></div>
    </div>`
      )
      .join('') +
    (hasMore
      ? `<button class="btn btn-ghost btn-block mt-md" data-act="more">
           显示更多（还有 ${filtered.length - visible.length} 个）
         </button>`
      : '')
  );
}

function sessionView() {
  const c = queue[qIndex];
  const pct = sessionTotal ? (sessionDone / sessionTotal) * 100 : 0;
  // 当前是第几个（从 1 开始数）。sessionDone 是「已完成数」，
  // 直接显示它会让人看到 0/30 —— 第一个词明明正在眼前，却显示 0。
  const current = Math.min(sessionDone + 1, sessionTotal);

  // 复习会话视图：每翻一个单词都会重绘，必须用静默模式（纯淡入、不位移），
  // 否则整张卡会往上弹一下 —— 那就是用户说的「屏幕震荡」。
  return `<div class="view view-silent">
    <div class="bar mt-lg"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="flex between center mt-sm mb-lg">
      <span class="label">第 ${current} / ${sessionTotal} 个</span>
      <button class="label" data-act="quit" style="color:var(--ink-faint)">结束</button>
    </div>

    <div class="wordcard mb-lg">
      <span class="tag tag-info">${LEVEL_TEXT[c.level] || c.level}</span>
      <h2 class="wordcard-word">${esc(c.word)}</h2>
      <p class="wordcard-ph">${esc(c.phonetic)}</p>

      ${
        revealed
          ? `
        <div class="hairline my-lg"></div>
        <p class="wordcard-mean">${esc(c.meaning)}</p>
        <div class="card-flat p-md mt-lg" style="text-align:left">
          <p class="label">EXAMPLE</p>
          <p class="body mt-xs" style="font-style:italic">${esc(c.example)}</p>
        </div>`
          : ''
      }
    </div>

    ${
      revealed
        ? `<div class="flex gap-sm">
             <button class="btn btn-ghost grow" data-grade="0">没记住</button>
             <button class="btn btn-primary grow" data-grade="4">记住了</button>
           </div>
           <p class="label mt-md" style="text-align:center">下次复习 ${c.interval} 天后</p>`
        : `<button class="btn btn-primary btn-block" data-act="reveal">显示释义</button>`
    }
  </div>`;
}

/**
 * 局部更新：只替换词表列表 + 筛选按钮选中态。
 *
 * 不重建整个视图的原因：每次重建 DOM 会让浏览器重新布局，
 * 加上列表长度变化引起页面高度突变，用户看到的就是「刷新一下」。
 * 只动列表这一小块，其余部分（标题、统计卡、开始按钮）完全不变。
 */
function refreshList(root) {
  if (inSession) {
    renderVocab(root);
    return;
  }

  const list = root.querySelector('#wordList');
  if (list) list.innerHTML = listHTML();

  // 筛选按钮的选中态
  root.querySelectorAll('[data-filter]').forEach((b) => {
    b.classList.toggle('on', b.dataset.filter === filter);
  });
}

/**
 * 事件绑定：每次渲染后调用一次，绑定在容器上。
 *
 * 注意不能写进 sessionView()—— 那只是返回 HTML 字符串的纯函数，
 * 绑定代码永远不会执行（曾因此导致「显示释义」点了没反应）。
 */
function bind(root) {
  root.onclick = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;

    const filterBtn = t.closest('[data-filter]');
    if (filterBtn) {
      const next = filterBtn.dataset.filter;
      if (next === filter) return; // 点当前项不做任何事，避免无谓重绘
      filter = next;
      listLimit = 40; // 换筛选条件后重置分页
      refreshList(root);
      return;
    }

    const moreBtn = t.closest('[data-act="more"]');
    if (moreBtn) {
      listLimit += 60;
      refreshList(root);
      return;
    }

    const gradeBtn = t.closest('[data-grade]');
    if (gradeBtn) {
      const knew = gradeBtn.dataset.grade === '4';
      const w = queue[qIndex].word;
      const idx = state.cards.findIndex((x) => x.word === w);
      if (idx >= 0) {
        const next = srs.reviewCard(state.cards[idx], knew ? 4 : 1);
        if (!knew) next.wrongCount++;
        state.cards[idx] = next;
      }
      sessionDone++;
      qIndex++;
      revealed = false;
      persist();

      if (qIndex >= sessionTotal) {
        inSession = false;
        toast(`完成 ${sessionTotal} 词`);
      }
      renderVocab(root);
      return;
    }

    const actBtn = t.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.dataset.act;

    if (act === 'quit') {
      inSession = false;
      queue = [];
      renderVocab(root);
    } else if (act === 'reveal') {
      revealed = true;
      renderVocab(root);
    } else if (act === 'start') {
      // 队列乱序已由 srs.buildReviewQueue 内部按「同优先级内打散」完成。
      // 这里绝不能再对整个队列 shuffle —— 那会把逾期优先的顺序一起打乱，
      // 导致逾期最久的词排到最后，记忆曲线就失效了。
      const q = srs.buildReviewQueue(state.cards, 30);
      queue = q;
      if (!queue.length) return toast('今天没有待复习的词');
      qIndex = 0;
      revealed = false;
      sessionDone = 0;
      sessionTotal = queue.length;
      inSession = true;
      renderVocab(root);
    }
  };
}

/** 兼容入口：事件已在 renderVocab 内部绑定 */
export function bindVocab() {}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}