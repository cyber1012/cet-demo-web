/**
 * 应用入口
 * 状态管理 + 路由 + 共享工具
 *
 * 状态双写：本地立即生效（保证离线可用），登录后同步到云端
 * （换设备、清缓存都不丢进度）。
 */
import { loadBank, BANK_VERSION } from './bank-loader.js';
import { ESSAY_TASKS, TRANSLATION_TASKS, SPEAKING_TASKS, PHRASES } from './tasks.js';
import * as srs from './srs.js';
import * as ai from './ai.js';
import * as account from './account.js';

// ===== 本地存储 =====
const KEY = 'cet.web.v1';

function defaultState() {
  return {
    examLevel: 'CET4',
    cards: null,          // 词卡（首次进入时按等级加载词库生成）
    // 词库版本号：词表内容变更时 +1（在 bank-loader.js 里定义），
    // 用来触发老用户的词卡重建。
    // 没有它的话，老用户本地缓存里会永远留着旧词表。
    bankVersion: 0,
    tasks: {},            // 今日任务完成状态 { '2026-10-21': {vocab:true,...} }
    streak: 0,
    streakDate: '',
    aiHistory: [],
    // mockHistory / wrongBook 随模考下线一并移除。
    // load() 用 Object.assign 合并，旧用户本地的残留字段会被自动忽略。
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('存储失败', e);
  }
}

export const state = load();

/**
 * 数据变更后由main.js 注册的回调。
 * 页面缓存依赖于此：任何 persist() 都会清空缓存，
 * 保证下次切页看到的是最新数据，不会漏掉。
 */
const dataChangeListeners = new Set();
export function onDataChange(fn) {
  dataChangeListeners.add(fn);
  return () => dataChangeListeners.delete(fn);
}

export function persist() {
  save(state);
  // 已登录时，防抖同步到云端
  account.scheduleSync(() => state);
  // 通知页面层：数据变了，缓存的 DOM 该丢弃
  dataChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* 单个监听器出错不影响其他 */
    }
  });
}

export { account };

/**
 * 首次进入：把词库灌进卡片列表。
 *
 * 现在词库是按等级分片懒加载的（1.7MB，不可能内联进代码），
 * 所以改成异步：先返回缓存/已有数据，随后在后台加载词库并重建。
 *
 * 同一个 Promise 会被复用，避免首页和词汇页重复触发加载。
 */
let ensurePromise = null;

export function ensureCards() {
  // 已有词卡且版本一致 → 直接返回，绝不重复加载
  if (state.cards && state.bankVersion === BANK_VERSION && !ensurePromise) {
    return state.cards;
  }
  if (ensurePromise) return state.cards || [];

  ensurePromise = (async () => {
    try {
      const level = state.examLevel === 'CET6' ? 'CET6' : 'CET4';
      const list = await loadBank(level);

      const prev = new Map((state.cards || []).map((c) => [c.word, c]));
      state.cards = list.map((w) => {
        const old = prev.get(w.word);
        // 已有进度则沿用（保留掌握度、复习时间、错误次数）
        return old ? Object.assign(old, w) : srs.createCard(w.word, w);
      });
      state.bankVersion = BANK_VERSION;
      persist();
      emitBankReady();
    } catch (e) {
      // 加载失败：保留原有词卡，App 仍可用
      console.warn('词库加载失败', e);
    } finally {
      ensurePromise = null;
    }
    return state.cards || [];
  })();

  // 立刻返回当前已有的（首屏不等网络）
  return state.cards || [];
}

/** 词库加载完成的信号，供页面在加载完刷新 UI */
export function onBankReady(fn) {
  bankReadyListeners.push(fn);
  if (state.cards && state.bankVersion === BANK_VERSION) {
    setTimeout(() => fn(state.cards), 0);
  }
}
const bankReadyListeners = [];
export function emitBankReady() {
  bankReadyListeners.forEach((fn) => {
    try {
      fn(state.cards);
    } catch (e) {
      /* 单个订阅者出错不影响其他 */
    }
  });
}

/** 切换考试等级时需要重新加载对应词库 */
export function reloadBankForLevel(level) {
  state.bankVersion = 0; // 触发 ensureCards 重建
  state.examLevel = level;
  persist();
  return ensureCards();
}

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ===== 导航 =====
export const TABS = [
  { key: 'home', text: '今日', icon: '◎' },
  { key: 'review', text: '批改', icon: 'AI' },
  { key: 'vocab', text: '词汇', icon: '词' },
  { key: 'me', text: '我的', icon: '我' },
];

let currentTab = 'home';
const listeners = new Set();

export function getTab() {
  return currentTab;
}

export function go(key) {
  if (key === currentTab) return;
  currentTab = key;
  listeners.forEach((fn) => fn(key));
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ===== 吐司提示 =====
let toastTimer = null;

export function toast(text, ms = 2200) {
  let el = document.getElementById('toast');
  if (el) el.remove();
  clearTimeout(toastTimer);

  el = document.createElement('div');
  el.className = 'toast';
  el.id = 'toast';
  el.textContent = text;
  document.body.appendChild(el);

  toastTimer = setTimeout(() => el?.remove(), ms);
}

export { ESSAY_TASKS, TRANSLATION_TASKS, SPEAKING_TASKS, PHRASES, srs, ai };