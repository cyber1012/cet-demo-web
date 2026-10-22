/**
 * 用户身份与云端进度同步
 *
 * 为什么必须有这个：localStorage 只能存在本机，
 * 换手机、清缓存、换浏览器就全没了。用户说的「保证进度」做不到。
 *
 * 方案：邮箱验证码登录 → 进度存云端 → 任何设备登录同一账号都恢复。
 * 未登录时仍可用本地模式，登录后自动把本地进度合并上云。
 */

import { getCloud } from './cloud.js';

const SYNC_KEY = 'cet.sync.v1';

let session = null;
let user = null;

// ===== 身份 =====

/** 检查是否已登录 */
export async function getCurrentSession() {
  if (session) return session;
  try {
    const res = await getCloud().auth.getSession();
    if (res && res.error) {
      // 未登录是正常状态，不算错误
      return null;
    }
    session = res && res.data ? res.data : null;
    user = session && session.user ? session.user : null;
    return session;
  } catch (e) {
    return null;
  }
}

export function getUser() {
  return user;
}

export function isLoggedIn() {
  return !!(session && user);
}

/**
 * 发送邮箱验证码
 *
 * SDK 契约（查 lib/chunk-*.js 确认）：
 *   signInWithOtp({email}) → { data: { verificationId, isExistingUser, verify } }
 * `verify({token})` 就在返回对象里，不在 data.challenge。
 * （此前误取 data.challenge，导致 verify is not an object。）
 */
export async function sendEmailCode(email) {
  const res = await getCloud().auth.signInWithOtp({ email });
  if (res && res.error) throw new Error(res.error.message || '验证码发送失败');

  const d = (res && res.data) || {};
  const verify = d.verify;
  if (typeof verify !== 'function') {
    throw new Error('验证码服务异常，请稍后重试');
  }
  return { verify, email: d.email || email, isExistingUser: !!d.isExistingUser };
}

/**
 * 登录：邮箱 + 验证码
 * 新用户首次登录会自动注册
 */
export async function loginWithEmail(email, token, verifyFn) {
  if (typeof verifyFn !== 'function') {
    throw new Error('验证码已失效，请重新获取');
  }
  const res = await verifyFn({ token });
  if (res && res.error) throw new Error(res.error.message || '登录失败');

  const s = await getCloud().auth.getSession();
  session = s && s.data ? s.data : null;
  user = session && session.user ? session.user : null;
  if (!user) throw new Error('登录未完成，请重试');

  await pullAll();
  return user;
}

export async function signOut() {
  try {
    await getCloud().auth.signOut();
  } catch (e) {}
  session = null;
  user = null;
}

// ===== 进度同步 =====

/**
 * 云端文档 id：每个用户一份进度
 * localStorage 里的数据作为「本地草稿」，登录后合并上云
 */
function docId() {
  return `progress_${user.id}`;
}

async function db() {
  return getCloud().database;
}

/** 把本地进度写进云端 */
export async function pushLocal(localState) {
  if (!isLoggedIn()) return false;
  try {
    const d = await db();
    const id = docId();
    const now = Date.now();

    // 覆盖式写入：本地是权威来源（用户刚做的操作）
    const payload = {
      id,
      userId: user.id,
      cards: localState.cards || [],
      tasks: localState.tasks || {},
      streak: localState.streak || 0,
      streakDate: localState.streakDate || '',
      aiHistory: (localState.aiHistory || []).slice(0, 50),
      bankVersion: localState.bankVersion || 0,
      examLevel: localState.examLevel || 'CET4',
      updatedAt: now,
    };

    // 先查是否已存在
    const exist = await d.from('progress').select().eq('userId', user.id).limit(1);
    const rows = (exist && exist.data) || [];

    if (rows.length) {
      await d.from('progress').update({ id: rows[0].id }).set(payload);
    } else {
      await d.from('progress').insert(payload);
    }
    return true;
  } catch (e) {
    console.warn('推送失败', e);
    return false;
  }
}

/**
 * 从云端拉取进度并合并到本地
 * 合并策略：卡片的复习进度取「更新的那次」，避免覆盖掉用户刚做的复习
 */
export async function pullAll() {
  if (!isLoggedIn()) return null;
  try {
    const d = await db();
    const res = await d.from('progress').select().eq('userId', user.id).limit(1);
    const rows = (res && res.data) || [];
    if (!rows.length) return null;

    const remote = rows[0];
    const local = readLocal();
    const merged = mergeProgress(local, remote);

    writeLocal(merged);
    return merged;
  } catch (e) {
    console.warn('拉取失败', e);
    return null;
  }
}

/** 合并：本地与云端各取更新的 */
function mergeProgress(local, remote) {
  const cards = new Map();
  // 先放云端
  (remote.cards || []).forEach((c) => cards.set(c.word, c));
  // 本地覆盖：若本地复习更新过，则用本地
  (local.cards || []).forEach((c) => {
    const r = cards.get(c.word);
    if (!r || (c.lastReview || 0) > (r.lastReview || 0)) cards.set(c.word, c);
  });

  // 任务：并集
  const tasks = Object.assign({}, remote.tasks || {});
  Object.keys(local.tasks || {}).forEach((k) => {
    tasks[k] = Object.assign({}, tasks[k], local.tasks[k]);
  });

  // 历史：按时间戳去重合并
  const hist = (a) => (a || []).map((x) => ({ id: `${x.kind}|${x.title}|${x.time}`, ...x }));
  const mergeArr = (a, b, cap) => {
    const m = new Map();
    hist(b).forEach((x) => m.set(x.id, x));
    hist(a).forEach((x) => m.set(x.id, x));
    return [...m.values()].sort((x, y) => (y.time || 0) - (x.time || 0)).slice(0, cap);
  };

  return {
    cards: [...cards.values()],
    tasks,
    streak: Math.max(local.streak || 0, remote.streak || 0),
    streakDate: local.streakDate || remote.streakDate || '',
    aiHistory: mergeArr(local.aiHistory, remote.aiHistory, 50),
    // 取两者较大值，避免换设备后词库版本回退
    bankVersion: Math.max(local.bankVersion || 0, remote.bankVersion || 0),
    examLevel: local.examLevel || remote.examLevel || 'CET4',
  };
}

// ===== 本地存储桥接 =====

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem('cet.web.v1')) || {};
  } catch (e) {
    return {};
  }
}

function writeLocal(s) {
  try {
    localStorage.setItem('cet.web.v1', JSON.stringify(s));
  } catch (e) {}
}

/** 自动同步：登录状态变化时拉取，本地变更时推送（防抖） */
let syncTimer = null;

export function scheduleSync(getState) {
  if (!isLoggedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    pushLocal(getState());
  }, 1500);
}

export { readLocal, writeLocal };