/**
 * 云服务客户端 · Web 版
 *
 * 与小程序版共用同一个后端环境。这里用 CDN 形态的 SDK
 * （小程序没有 <script> 标签，所以那边走 npm 子路径）。
 *
 * ===== 关于 publishableKey =====
 *
 * 这个 key 决定谁能调用后端的大模型能力。**开源仓库里不能放真 key**，
 * 否则任何 clone 下来的人都能拿走它、消耗你的额度。
 *
 * 所以这里的取值顺序是：
 *   1. 运行时注入 window.__WB_CONFIG__.publishableKey（部署时由构建脚本填入）
 *   2. localStorage 里手动配置的 key（自己部署时在控制台设置一次即可）
 *   3. 都没有 → 走占位符，AI 功能不可用，但其余功能（词库/背词/错题本）正常
 *
 * 自己去部署的人，在浏览器控制台执行一次即可：
 *   localStorage.setItem('wb.publishableKey', '你的 key')
 */

/** 公开的后端地址（不含任何凭据，可以公开） */
const ENDPOINT = 'https://mp-api.app.workbuddy.host';

/** 本地存储 key 名 */
const KEY_STORE = 'wb.publishableKey';

/** 读取运行时注入的配置（构建脚本或部署环境提供） */
function runtimeConfig() {
  if (typeof window === 'undefined') return null;
  return window.__WB_CONFIG__ || null;
}

/**
 * 解析出可用的 publishableKey。
 * @returns {string} 没有可用 key 时返回空字符串
 */
function resolveKey() {
  const rt = runtimeConfig();
  if (rt && rt.publishableKey) return String(rt.publishableKey).trim();

  try {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) return saved.trim();
  } catch (e) {
    // 隐私模式下 localStorage 可能不可用
  }

  return '';
}

/** 后端激活时下发的公开配置 */
const PUBLIC_CONFIG = {
  endpoint: ENDPOINT,
  get publishableKey() {
    return resolveKey();
  },
};

let cloud = null;

function getCloud() {
  if (cloud) return cloud;
  if (typeof window.WorkBuddyCloud === 'undefined') {
    throw new Error('sdk_not_loaded');
  }
  const key = resolveKey();
  if (!key) {
    // 明确报错，而不是拿空 key 去请求后端（会得到难懂的 401）
    const e = new Error('no_publishable_key');
    e.hint =
      '未配置 publishableKey。开源版本需自行配置：\n' +
      "  localStorage.setItem('wb.publishableKey', '你的 key')";
    throw e;
  }
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    publishableKey: key,
  });
  // 挂到全局，供需要绕过 import 的场景使用（如图片转录模块）
  window.__wbCloud = cloud;
  return cloud;
}

/** 是否已配置可用的 key（界面据此提示用户） */
export function hasKey() {
  return !!resolveKey();
}

export { PUBLIC_CONFIG, getCloud, resolveKey, KEY_STORE, ENDPOINT };
