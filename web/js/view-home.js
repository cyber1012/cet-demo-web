/**
 * 首页 · 今日
 * 设计要点：第一屏就让用户看到「AI 批改」这个真正的差异点，
 * 而不是把背单词放在最前面（那是墨墨的战场）。
 */
import { state, persist, ensureCards, todayKey, go, toast, srs, account } from './app.js';
import { showLoginSheet } from './login-sheet.js';

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 登录提示条（仅展示，点击后由 login-sheet.js 弹出登录框） */
function loginBanner() {
  return `
    <div class="login-banner" data-act="login">
      <div class="grow">
        <p class="login-banner-t">进度只存在这台设备上</p>
        <p class="login-banner-s">登录后换设备、清缓存都不丢进度</p>
      </div>
      <span class="login-banner-btn">登录</span>
    </div>`;
}

export function renderHome(root) {
  ensureCards();

  const d = new Date();
  const countdown = Math.max(
    0,
    Math.floor((new Date('2026-12-19T08:00:00') - d) / 86400000)
  );

  // 词库是异步加载的，首次渲染时 state.cards 可能还是 null。
  // 这里必须兜底成空数组，否则 .filter() 会直接抛错导致首页白屏。
  const cards = state.cards || [];
  const now = Date.now();

  // 一次遍历算完所有统计。
  // 之前是4 次 filter + 1 次 reduce，每次切页都要遍历 2000 张卡 5 遍
  // —— 首页是最常打开的页面，这个浪费很明显。
  const stat = { due: 0, mastered: 0, learning: 0, retentionSum: 0 };
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (c.due <= now) stat.due++;
    if (c.mastery >= 70) stat.mastered++;
    else if (c.mastery > 0) stat.learning++;
    stat.retentionSum += srs.retentionRate(c);
  }
  const dueCount = stat.due;
  const mastered = stat.mastered;
  const learning = stat.learning;
  const avgRetention = cards.length
    ? Math.round((stat.retentionSum / cards.length) * 100)
    : 0;

  const key = todayKey();
  const doneMap = state.tasks[key] || {};
  const TASKS = [
    { k: 'review', t: 'AI 批改一篇作文', r: 'review', time: '优先' },
    { k: 'vocab', t: `复习 ${dueCount} 个待巩固词`, r: 'vocab', time: '20min' },
    // 原「完成一套真题」指向已下线的模考页。改为翻译训练，
    // 路由指向仍存在的批改页（切到翻译模式）。
    { k: 'trans', t: '练一篇汉译英', r: 'review', time: '15min' },
    { k: 'speak', t: '口语跟读训练', r: 'review', time: '10min' },
  ];
  const doneCount = TASKS.filter((t) => doneMap[t.k]).length;
  const pct = Math.round((doneCount / TASKS.length) * 100);

  const lvl = state.examLevel === 'CET4' ? '四级' : '六级';

  root.innerHTML = `
  <div class="view">
    <!-- 登录条：未登录时提示进度只存本机 -->
    ${account.isLoggedIn() ? '' : loginBanner()}

    <!-- 顶部标题 -->
    <header class="flex between mt-lg mb-lg" style="align-items:flex-end">
      <div>
        <h1 class="display">今日</h1>
        <p class="label mt-xs">${WEEKDAY[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日</p>
      </div>
      <div style="text-align:right">
        <p class="label">距${lvl}考试</p>
        <p class="title" style="margin-top:2px">${countdown} 天</p>
      </div>
    </header>

    <!-- 主视觉：AI 批改（差异化主打） -->
    <section class="hero-ai mb-lg" data-go="review">
      <div class="hero-ai-clouds">
        <span class="cloud cloud-1"></span>
        <span class="cloud cloud-2"></span>
        <span class="cloud cloud-3"></span>
        <span class="cloud cloud-4"></span>
      </div>
      <div class="flex between center" style="position:relative">
        <div>
          <p class="label" style="color:rgba(255,255,255,.55)">AI REVIEW</p>
          <h2 class="title mt-xs" style="color:#fff">按四六级标准<br/>批改你的作文</h2>
          <p class="hero-ai-sub mt-sm">切题·结构·语言 三维度评分</p>
        </div>
        <div class="hero-ai-cta">
          <span class="hero-ai-btn">开始 <span class="hero-ai-arrow">→</span></span>
        </div>
      </div>
      <div class="hero-ai-stats">
        <div><b>${state.aiHistory.length}</b><span>已批改</span></div>
        <div><b>${state.aiHistory.length ? (state.aiHistory.reduce((a, x) => a + (x.score || 0), 0) / state.aiHistory.length).toFixed(1) : '—'}</b><span>平均分</span></div>
        <div><b>15</b><span>满分</span></div>
      </div>
    </section>

    <!-- 今日进度 -->
    <section class="card-flat p-lg mb-lg" id="progressCard">
      <div class="flex between center mb-md">
        <span class="label">今日进度</span>
        <span class="subtitle" id="progressCount">${doneCount}/${TASKS.length}</span>
      </div>
      <div class="bar mb-md">
        <div class="bar-fill" id="progressBar" style="width:${pct}%"></div>
      </div>
      <ul>
        ${TASKS.map(
          (t) => `
          <li class="row task-row" data-task="${t.k}">
            <span class="ring ${doneMap[t.k] ? 'done' : ''}">
              <svg class="ring-tick" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3"
                      stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="grow body task-text ${doneMap[t.k] ? 'done' : ''}">${t.t}</span>
            <span class="label">${t.time}</span>
          </li>`
        ).join('')}
      </ul>
    </section>

    <!-- 词汇快照 -->
    <section class="grid-2 mb-lg">
      <div class="card-grad g-violet">
        <p class="label" style="color:rgba(15,15,14,.5)">待复习</p>
        <p class="numeral mt-xs" style="font-size:44px">${dueCount}</p>
      </div>
      <div class="card-grad g-mint">
        <p class="label" style="color:rgba(15,15,14,.5)">记忆留存</p>
        <p class="numeral mt-xs" style="font-size:44px">${avgRetention}<span style="font-size:18px">%</span></p>
      </div>
    </section>

    <section class="grid-2">
      <div class="card-flat p-lg">
        <p class="label">已掌握</p>
        <p class="title mt-xs">${mastered}<span class="faint" style="font-size:15px;font-weight:500"> / ${cards.length}</span></p>
      </div>
      <div class="card-flat p-lg">
        <p class="label">连续打卡</p>
        <p class="title mt-xs">${state.streak}<span class="faint" style="font-size:15px;font-weight:500"> 天</span></p>
      </div>
    </section>
  </div>`;

  // 交互
  root.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => go(el.dataset.go));
  });

  const loginBtn = root.querySelector('[data-act="login"]');
  if (loginBtn) loginBtn.addEventListener('click', showLoginSheet);

  /**
   * 勾选任务：只更新受影响的几个节点，不重建整页。
   * 之前调renderHome(root) 会把整棵 DOM 重建，导致「刷新一下」的观感。
   */
  root.querySelectorAll('[data-task]').forEach((el) => {
    el.addEventListener('click', () => {
      const k = el.dataset.task;
      const kk = todayKey();

      state.tasks[kk] = state.tasks[kk] || {};
      const nowDone = !state.tasks[kk][k];
      state.tasks[kk][k] = nowDone;

      // 局部更新：勾选圈
      const ring = el.querySelector('.ring');
      if (ring) ring.classList.toggle('done', nowDone);

      // 局部更新：文字样式（用class 驱动，便于 CSS 过渡）
      const text = el.querySelector('.task-text');
      if (text) text.classList.toggle('done', nowDone);

      // 局部更新：进度数字与进度条
      //
      // 统计口径必须与初始渲染（第 51 行）完全一致：只数 TASKS 里定义的键。
      //
      // 之前这里写的是 Object.values(state.tasks[kk]).filter(Boolean).length
      // —— 它会把「已下线模考页残留的 mock: true」也数进去，
      // 导致明明只勾了 3 项却显示 4/4，刷新后又变回 3/4。
      const total = TASKS.length;
      const doneCount = TASKS.filter((t) => state.tasks[kk][t.k]).length;
      const pct = total ? Math.round((doneCount / total) * 100) : 0;

      const countEl = root.querySelector('#progressCount');
      if (countEl) {
        countEl.textContent = `${doneCount}/${total}`;
        // 数字跳动一下，强化反馈
        countEl.classList.remove('bump');
        void countEl.offsetWidth; // 强制重排以重启动画
        countEl.classList.add('bump');
      }

      const barEl = root.querySelector('#progressBar');
      if (barEl) barEl.style.width = `${pct}%`;

      // 全部完成 → 记录连续打卡
      if (doneCount >= total && state.streakDate !== kk) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yk = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
        state.streak = state.streakDate === yk ? state.streak + 1 : 1;
        state.streakDate = kk;
        celebrate();
        toast(`连续打卡 ${state.streak} 天`);
      }

      persist();
    });
  });
}

/** 全部完成时的庆祝动效 */
function celebrate() {
  const card = document.getElementById('progressCard');
  if (!card) return;
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}