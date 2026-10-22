/**
 * 主入口：路由 + 导航
 */
import { TABS, getTab, go, onRoute, ensureCards, onBankReady, onDataChange, account } from './app.js';
import { renderHome } from './view-home.js';
import { renderReview } from './view-review.js';
import { renderVocab, bindVocab } from './view-vocab.js';
import { renderMe } from './view-me.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

/**
 * 导航栏：只构建一次，之后靠 class 切换。
 *
 * 之前每次切页都重建 innerHTML 并重新绑定 5 个监听器 ——
 * 在移动端这是可感知的延迟来源。改为一次构建 + class 切换后，
 * 切页时导航零成本。
 */
let navBuilt = false;

function buildNav() {
  nav.className = 'tabnav';
  nav.innerHTML = `<div class="tabnav-inner">
    ${TABS.map(
      (t) => `<button class="tabnav-item" data-tab="${t.key}"
        aria-label="${t.text}" title="${t.text}">
        <span class="tabnav-ico">${t.icon}</span>
        <span class="tabnav-txt">${t.text}</span>
      </button>`
    ).join('')}
  </div>`;

  nav.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.tab))
  );
  navBuilt = true;
}

function syncNav() {
  const cur = getTab();
  nav.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === cur;
    b.classList.toggle('on', on);
    // 文字只在选中时展开（靠 CSS 控制宽度，避免布局抖动）
    b.classList.toggle('has-text', on);
  });
}

const RENDERERS = {
  home: renderHome,
  review: renderReview,
  vocab: renderVocab,
  me: renderMe,
};

// 页面切换时不做整页重建动画，只做极轻的淡入，避免视觉抖动
let switching = false;

/**
 * 页面缓存：把已渲染过的页面 DOM 保留在内存里。
 *
 * 之前每次切页都调用 renderer(main) 重建整棵 DOM —— 要重新解析 HTML、
 * 重新创建节点、重新绑定事件。首页/批改/我的都有几十个元素，
 * 在手机上这一下能感觉到。
 *
 * 现在：首次进入才渲染，之后切回直接把缓存的节点挂回去（appendChild
 * 会移动节点，事件监听器跟着走，不用重新绑定）。
 * 数据变化时（词库加载完、任务勾选）主动让对应页面失效。
 */
const pageCache = new Map();

/**
 * 哪些页面可以缓存？
 *
 * 判断标准：**这个页面的交互会不会改变它自己显示的数据**。
 *  - 首页：勾任务会改，但改的是局部节点，整页结构不变 → 可缓存
 *  - 我的  ：结构稳定 → 可缓存
 *  - 词汇  ：复习时整页重绘（词卡/进度/按钮全变）→ 不缓存
 *  - 批改  ：提交后结果区大改→ 不缓存
 *
 * 不缓存的页面每次切过去都重新渲染，代价很小（几十个元素），
 * 但避免了「缓存了旧数据」和「复习到一半白屏」这类问题。
 */
const CACHEABLE = new Set(['home', 'me']);

/**
 * 让某个页面的缓存失效（下次切回该页时用新数据重建）。
 *
 * 关键：**失效缓存 ≠ 把 DOM 节点摘掉。**
 *
 * 踩过的坑：原来这里写的是
 *   if (hit.parentNode) hit.parentNode.removeChild(hit)
 * 而 main 里任何时刻只挂着一个页面节点（render 每次都先清空 main），
 * 所以这句唯一能摘到的，就是**当前正在显示的那个页面**。
 * 结果：首页勾选任务 → persist() → 失效首页缓存 → 把正在显示的首页摘掉
 * → 白屏，必须刷新才恢复。
 *
 * 现在：只清缓存引用，**完全不碰 DOM**。
 * 当前显示的页面由它自己的逻辑负责更新（首页勾选任务做了局部更新：
 * 勾选圈 / 文字 / 进度数字 / 进度条），不需要整页重绘。
 */
export function invalidatePage(key) {
  const hit = pageCache.get(key);
  pageCache.delete(key);
  // 节点还在 DOM 里就留着不动 —— 它是当前显示的页面，摘掉就是白屏。
  // 下次切走时 main.innerHTML='' 会自然清掉。
  if (hit && hit.parentNode && hit.parentNode !== main) {
    hit.parentNode.removeChild(hit);
  }
}

function render() {
  const key = getTab();
  const renderer = RENDERERS[key];

  // 兜底：路由指向已下线页面时回首页，绝不留白屏
  if (!renderer) {
    go('home');
    return render();
  }

  if (!navBuilt) buildNav();
  syncNav();

  // 只有「结构稳定」的页面才走缓存（见 CACHEABLE）。
  // 词汇/批改页每次都重新渲染：它们的交互就是改数据，
  // 用缓存反而会出现「复习到一半白屏」或「显示旧进度」。
  const cacheable = CACHEABLE.has(key);
  const cached = cacheable ? pageCache.get(key) : null;

  if (cached) {
    // 命中缓存：直接挂回，零解析、零创建
    main.innerHTML = '';
    main.appendChild(cached);
    scrollTop();
    return;
  }

  // 不走缓存时，先把旧节点摘掉（否则 main 里会堆叠多个页面）
  if (!cacheable) {
    const old = pageCache.get(key);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    pageCache.delete(key);
  }

  // 离屏内容先隐藏 → 渲染 → 显示，避免用户看到中间态
  if (!switching) {
    switching = true;
    main.classList.add('is-switching');
  }

  // 每个页面渲染到自己的容器里，方便缓存复用
  const host = document.createElement('div');
  host.className = 'page-host';
  host.dataset.page = key;
  renderer(host);
  if (key === 'vocab') bindVocab(host);

  main.innerHTML = '';
  main.appendChild(host);
  if (cacheable) pageCache.set(key, host);

  // 换页入场动效：给 view容器加一次性 class，播完移除。
  // 这样所有页面（含词汇页）的换页观感一致，
  // 而页内重绘不会触发它 —— 避免「屏幕震荡」。
  const view = host.querySelector('.view');
  if (view && !view.classList.contains('view-silent')) {
    view.classList.add('view-enter');
    view.addEventListener('animationend', () => view.classList.remove('view-enter'), { once: true });
  }

  scrollTop();

  requestAnimationFrame(() => {
    main.classList.remove('is-switching');
    switching = false;
  });
}

/** 回到顶部：部分环境（如内嵌 webview）没有 scrollTo，需防御 */
function scrollTop() {
  try {
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (e) {
    try {
      window.scrollTo(0, 0);
    } catch (_) {
      /* 忽略 */
    }
  }
}

/**
 * 词库加载完成后刷新当前页。
 * 首屏不等词库（秒开），加载完再重绘，用户看到的是词数从 0 变成 2000，
 * 而不是一直空着。
 */
onBankReady(() => {
  // 词库变了，所有依赖词卡的页面缓存都失效
  ['home', 'vocab', 'me'].forEach(invalidatePage);
  render();
});

// 页面不可见时暂停所有动画，节省电量与 GPU
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
});

// SDK 加载状态提示
function showSdkWarning() {
  setTimeout(() => {
    if (typeof window.WorkBuddyCloud === 'undefined') {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = 'AI 组件加载中，请稍候…';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }, 2500);
}

/**
 * 启动流程：
 * 1. 先渲染本地进度（保证秒开，离线可用）
 * 2. 后台检查登录状态；若已登录则拉取云端进度并合并
 */
async function boot() {
  ensureCards();
  onRoute(render);
  render();
  showSdkWarning();

  // 预热：后台探测最快的可用模型，避免用户首次批改时等探测
  const warm = () => import('./ai.js').then((m) => m.warmup()).catch(() => {});
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warm, { timeout: 3000 });
  } else {
    setTimeout(warm, 1200);
  }

  // 后台静默同步，不阻塞首屏
  try {
    const s = await account.getCurrentSession();
    if (s) {
      await account.pullAll();
      render();
    }
  } catch (e) {
    // 未登录或网络失败都不影响使用
  }
}

/**
 * 数据变更时的缓存处理。
 *
 * 这里要区分两种情况：
 *
 * 1. **页面自己更新了**（首页勾选任务）—— 页面在 persist() 之前就做了
 *    局部更新（勾选圈 / 文字 / 进度数字 / 进度条），屏幕上的内容已经是对的。
 *    这时**不需要**让缓存失效，只需要保证「下次切回时」用新数据重建。
 *
 * 2. **页面不知道数据变了**（在别的页面改了数据）—— 这时才需要失效缓存。
 *
 * 两种情况统一处理就是「persist() 就清缓存」，但那会把当前显示的页面
 * 从 DOM 摘掉 → 白屏（首页勾选任务后白屏就是这个原因）。
 *
 * 现在的做法：**只清缓存引用，绝不碰 DOM**。
 * 当前页继续显示（它自己已经更新好了），下次切回该页时用新数据重建。
 */
onDataChange(() => {
  CACHEABLE.forEach(invalidatePage);
});

boot();
