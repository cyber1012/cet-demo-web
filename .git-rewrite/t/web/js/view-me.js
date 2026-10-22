/**
 * 我的页 —— 账号同步、学习数据总览、成绩趋势
 *
 * 说明：原「模考」与「我的」同处一个文件，现已拆分。
 * 模考功能已下线（现有题库仅 6 道客观题、缺 4 个题型，
 * 与其做成半成品占位，不如把位置让给真正有用的功能）。
 */
import { state, persist, srs, account, reloadBankForLevel } from './app.js';
import { showLoginSheet } from './login-sheet.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const KIND_TEXT = { write: '作文', speak: '口语', translate: '翻译' };

// 展开箭头：最简向上折线（∧），内联 SVG。
//
// 两次踩坑记录：
// 1. 曾用 ⌄（U+2304 家谱符号）—— 绝大多数中文字体没有该字形，会回退成怪图形
// 2. 曾用 polyline 版本 —— 在部分环境下被填充实心块
//
// 因此这里把 fill/stroke/线宽全部显式写在元素上，
// 并给 svg 本身加 width/height 属性，不依赖任何继承或默认值。
const CHEVRON = `<svg class="support-chev-svg" width="14" height="14"
  viewBox="0 0 14 14" fill="none" aria-hidden="true">
  <path d="M2.5 8.5 L7 4 L11.5 8.5" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// 支持区块默认收起：学习工具不该让人第一眼以为要收费
let showSupport = false;

export function renderMe(root) {
  const c = state.cards || [];
  const mastered = c.filter((x) => x.mastery >= 70).length;
  const ret = c.length
    ? Math.round((c.reduce((a, x) => a + srs.retentionRate(x), 0) / c.length) * 100)
    : 0;

  const history = state.aiHistory || [];
  const avg = history.length
    ? (history.reduce((a, x) => a + (x.score || 0), 0) / history.length).toFixed(1)
    : '—';
  const best = history.length
    ? Math.max(...history.map((x) => x.score || 0))
    : '—';
  const recent = history.length ? history.slice(0, 5) : [];

  // 成绩趋势：按时间正序，取最近 5 次，画成小柱状
  const trend = history
    .slice(0, 5)
    .reverse()
    .map((x) => x.score || 0);
  const trendMax = trend.length ? Math.max(...trend, 15) : 15;

  const logged = account.isLoggedIn();
  const user = account.getUser();

  root.innerHTML = `<div class="view">
    <header class="mt-lg mb-lg">
      <h1 class="display">我的</h1>
    </header>

    <!-- 账号与同步 -->
    <div class="card-glass p-lg mb-lg">
      ${
        logged
          ? `<div class="flex between center">
               <div class="grow">
                 <p class="subtitle">${esc(user.email || user.id || '已登录')}</p>
                 <p class="caption faint mt-xs">进度已同步到云端 · 换设备自动恢复</p>
               </div>
               <button class="label" data-act="signout" style="color:var(--ink-mute)">退出</button>
             </div>`
          : `<div class="flex between center">
               <div class="grow">
                 <p class="subtitle">未登录</p>
                 <p class="caption faint mt-xs">进度仅存本机，清缓存会丢失</p>
               </div>
               <span class="login-banner-btn" data-act="gotologin">登录</span>
             </div>`
      }
    </div>

    <!-- 考试倒计时 + 等级切换 -->
    <div class="card-glass p-lg mb-lg">
      <div class="flex between">
        <span class="label">距${state.examLevel === 'CET4' ? '四级' : '六级'}考试</span>
        <button class="tag tag-info" data-act="switch">${state.examLevel}</button>
      </div>
      <div class="flex mt-sm" style="align-items:baseline;gap:6px">
        <span class="numeral">${Math.max(0, Math.floor((new Date('2026-12-19T08:00:00') - new Date()) / 86400000))}</span>
        <span class="faint" style="font-size:18px;font-weight:700">天</span>
      </div>
      <div class="flex between mt-md" style="padding-top:var(--s-sm);border-top:1px solid var(--hairline)">
        <span class="label">连续打卡</span>
        <span class="subtitle">${state.streak} 天</span>
      </div>
    </div>

    <!-- 词汇数据 -->
    <div class="grid-2 mb-lg">
      <div class="card-grad g-violet"><p class="label" style="color:rgba(15,15,14,.5)">词库</p><p class="numeral mt-xs" style="font-size:36px">${c.length}</p></div>
      <div class="card-grad g-mint"><p class="label" style="color:rgba(15,15,14,.5)">已掌握</p><p class="numeral mt-xs" style="font-size:36px">${mastered}</p></div>
      <div class="card-grad g-lime"><p class="label" style="color:rgba(15,15,14,.5)">记忆留存</p><p class="numeral mt-xs" style="font-size:36px">${ret}<span style="font-size:16px">%</span></p></div>
      <div class="inner-dark p-lg"><p class="label" style="color:rgba(255,255,255,.45)">批改次数</p><p class="numeral mt-xs" style="font-size:36px;color:var(--lime)">${history.length}</p></div>
    </div>

    <!-- 成绩趋势：批改是核心功能，这里是它的长期价值 -->
    <div class="card-flat p-lg mb-lg">
      <p class="label mb-md">批改成绩趋势</p>
      ${
        trend.length
          ? `<div class="flex" style="align-items:flex-end;gap:10px;height:96px;margin-bottom:14px">
              ${trend
                .map(
                  (s) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
                    <span class="faint" style="font-size:11px;font-weight:700">${s}</span>
                    <div style="width:100%;height:${Math.max(6, (s / trendMax) * 68)}px;border-radius:var(--r-sm);
                      background:linear-gradient(180deg, var(--lime), rgba(215,242,107,.35))"></div>
                  </div>`
                )
                .join('')}
             </div>`
          : `<p class="label" style="text-align:center;padding:var(--s-md) 0">还没有批改记录，去批改页试试</p>`
      }
      <div class="flex between mb-md">
        ${[
          [history.length, '批改次数'],
          [avg, '平均分'],
          [best, '最高分'],
        ]
          .map(
            ([n, l]) =>
              `<div style="text-align:center"><p class="title">${n}</p><p class="label">${l}</p></div>`
          )
          .join('')}
      </div>
      ${
        recent.length
          ? recent
              .map(
                (x) => `
        <div class="row">
          <span class="tag tag-info">${esc(KIND_TEXT[x.kind] || '批改')}</span>
          <span class="grow caption muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.title)}</span>
          <span class="subtitle">${x.score}</span>
        </div>`
              )
              .join('')
          : ''
      }
    </div>

    <div class="card-flat" style="padding:0 var(--s-md)">
      <div class="row"><span class="grow body" style="color:var(--ink)">评分标准</span><span class="caption faint">四六级官方评分体系</span></div>
      <div class="row" data-act="clear"><span class="grow body" style="color:var(--crimson)">清空学习数据</span><span class="faint">›</span></div>
    </div>

    <!-- 支持作者：默认收起，只在用户主动点击时展开二维码。
         刻意做得安静 —— 学习工具不该让人第一眼以为要收费。 -->
    <div class="support mt-lg">
      <button class="support-toggle" data-act="support">
        <span>${showSupport ? '收起' : '觉得有用？支持一下这个网站'}</span>
        <span class="support-chev ${showSupport ? 'up' : ''}">${CHEVRON}</span>
      </button>

      ${
        showSupport
          ? `<div class="support-panel">
               <div class="support-qr">
                 <img src="data/qr-image.jpg" alt="微信收款码" />
               </div>
               <p class="support-title">这个网站是我自己做的</p>
               <p class="support-text">
                 用了不少晚上，把觉得对的地方一点点调顺。<br/>
                 如果它帮到你考过了，可以请我喝杯咖啡。
               </p>
               <p class="support-hint">长按图片可保存到相册</p>
             </div>`
          : ''
      }
    </div>
  </div>`;

  root.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'switch') {
        const next = state.examLevel === 'CET4' ? 'CET6' : 'CET4';
        // 词库是按等级分片加载的，切等级必须重新加载对应词库
        reloadBankForLevel(next);
        renderMe(root);
        toast(`已切换到${next === 'CET4' ? '四级' : '六级'}，正在载入词库`);
      } else if (a === 'signout') {
        if (confirm('退出登录？云端进度会保留，重新登录后恢复。')) {
          await account.signOut();
          location.reload();
        }
      } else if (a === 'gotologin') {
        // 直接在本页弹出登录框，不做页面跳转
        showLoginSheet();
      } else if (a === 'clear') {
        if (confirm('将删除词汇进度与批改记录，且无法恢复。确定继续？')) {
          localStorage.removeItem('cet.web.v1');
          location.reload();
        }
      } else if (a === 'support') {
        showSupport = !showSupport;
        renderMe(root);
      }
    })
  );
}

/** 轻量提示（与 app.js 的 toast 同名导出冲突时用别名） */
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}