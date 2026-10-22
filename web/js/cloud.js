/**
 * 云服务客户端 · Web 版
 *
 * 与小程序版共用同一个后端环境。这里用 CDN 形态的 SDK
 * （小程序没有 <script> 标签，所以那边走 npm 子路径）。
 */

// 后端激活时下发的公开配置
const PUBLIC_CONFIG = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: ""',
};

let cloud = null;

function getCloud() {
  if (cloud) return cloud;
  if (typeof window.WorkBuddyCloud === 'undefined') {
    throw new Error('sdk_not_loaded');
  }
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  });
// 挂到全局，供需要绕过 import 的场景使用（如图片转录模块）
  window.__wbCloud = cloud;
  return cloud;
}

export { PUBLIC_CONFIG, getCloud };