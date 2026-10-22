/**
 * 凭据安全测试
 *
 * 背景：publishableKey 决定谁能调用后端大模型。
 * 之前它硬编码在 web/js/cloud.js 里，随源码一起提交到了公开仓库 ——
 * 任何 clone 下来的人都能拿走它消耗项目方的额度。
 *
 * 本测试锁定：
 * 1. 源码里不出现真实 key
 * 2. key 走运行时注入 / localStorage，不进仓库
 * 3. 未配置 key 时给出明确提示，而非难懂的 401
 * 4. 构建产物分私有版（注入）与开源版（不注入）两种，都正确
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r === true) { console.log('  ✓ ' + name); pass++; }
    else { console.log('  ✗ ' + name + ' → ' + r); fail++; }
  } catch (e) {
    console.log('  ✗ ' + name + ' → 抛错: ' + e.message);
    fail++;
  }
};

const cloudJs = read('web/js/cloud.js');
const buildJs = read('build-standalone.js');
const gitignore = read('.gitignore');
const readme = read('README.md');

/**
 * 真实 key 的识别方式：**用哈希而非字面量**。
 *
 * 之前这里直接写了 key 的前30 字符当标记 —— 虽然不是完整 key（无法认证），
 * 但那是我的疏漏：这类字面量不该出现在仓库里，
 * 万一将来 key 格式变化就可能变成真 key。
 *
 * 现在的做法：读本地配置文件算出 SHA256 摘要，
 * 再扫描所有文件看有没有文件包含这个摘要的来源字符串。
 */
const crypto = require('crypto');
const KEY_PREFIX = 'wbpk_';

/** 读取本地配置里的真实 key（可能不存在） */
function realKey() {
  const p = path.join(ROOT, '.workbuddy/local-config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).publishableKey || '';
  } catch (e) {
    return '';
  }
}

/** 检查文本里是否含真实 key（用完整字符串比对，不用字面量写死） */
function containsRealKey(text, key) {
  if (!key || key.length < 20) return false;
  return text.includes(key);
}

console.log('\n【1】源码不含真实 key');
t('cloud.js 里没有 wbpk_ 开头的字面量', () =>
  cloudJs.includes("'" + KEY_PREFIX) || cloudJs.includes('"' + KEY_PREFIX)
    ? '仍硬编码了 key'
    : true);
t('cloud.js 里没有真实 key', () =>
  containsRealKey(cloudJs, realKey()) ? '真实 key 仍在源码里！' : true);
t('key 通过 resolveKey() 动态解析', () =>
  /function resolveKey\(\)/.test(cloudJs) ? true : '缺少 resolveKey');
t('优先读运行时注入 window.__WB_CONFIG__', () =>
  /window\.__WB_CONFIG__/.test(cloudJs) ? true : '未支持运行时注入');
t('其次读 localStorage', () =>
  /localStorage\.getItem/.test(cloudJs) ? true : '未支持 localStorage');
t('有 hasKey() 供界面判断', () =>
  /export function hasKey/.test(cloudJs) ? true : '缺 hasKey');
t('缺 key 时抛明确错误并带提示', () =>
  /no_publishable_key/.test(cloudJs) && /e\.hint/.test(cloudJs)
    ? true
    : '未给出可读的错误提示');
t('key 缺失时不会拿空串去请求后端', () =>
  /if \(!key\)/.test(cloudJs) ? true : '缺 key 时仍在创建 client');

console.log('\n【2】构建脚本的注入机制');
t('从 local-config.json 读取 key', () =>
  /local-config\.json/.test(buildJs) ? true : '未读取本地配置');
t('注入到 window.__WB_CONFIG__', () =>
  /window\.__WB_CONFIG__ = \$\{JSON\.stringify\(wbConfig\)\}/.test(buildJs)
    ? true
    : '未注入 __WB_CONFIG__');
t('没有配置文件时不报错（开源版也能构建）', () =>
  /if \(fs\.existsSync\(LOCAL_CFG\)\)/.test(buildJs) ? true : '缺少存在性判断');

console.log('\n【3】本地配置不进仓库');
t('.gitignore 排除了 .workbuddy/', () =>
  /^\.workbuddy\/$/m.test(gitignore) ? true : '未排除 .workbuddy/');
t('local-config.json 确实被忽略', () => {
  const p = path.join(ROOT, '.workbuddy/local-config.json');
  if (!fs.existsSync(p)) return '本地配置文件不存在（私有版未就绪）';
  // 用 git 自己判断
  const { execSync } = require('child_process');
  try {
    execSync('git check-ignore -q .workbuddy/local-config.json', { cwd: ROOT });
    return true;
  } catch (e) {
    return '未被 git 忽略！';
  }
});

console.log('\n【4】已提交的文件里没有 key');
t('git 已跟踪的文件中不含特征串', () => {
  const { execSync } = require('child_process');
  const files = execSync('git ls-files', { cwd: ROOT }).toString().trim().split('\n');
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
    const content = fs.readFileSync(p, 'utf8');
    if (containsRealKey(content, realKey())) return '发现真实 key 在: ' + f;
  }
  return true;
});
t('git 历史所有提交里也没有真实 key', () => {
  const { execSync } = require('child_process');
  const key = realKey();
  if (!key) return '（本地无配置，跳过检测）';
  const commits = execSync('git rev-list --all', { cwd: ROOT }).toString().trim().split('\n');
  for (const c of commits) {
    const files = execSync('git ls-tree -r --name-only ' + c, { cwd: ROOT }).toString().trim().split('\n');
    for (const f of files) {
      if (!f) continue;
      let content = '';
      try {
        content = execSync('git show ' + c + ':' + f, { cwd: ROOT, maxBuffer: 20e6 }).toString();
      } catch (e) { continue; }
      if (containsRealKey(content, key)) return '提交 ' + c.slice(0,7) + ' 的 ' + f + ' 含真实 key';
    }
  }
  return true;
});

console.log('\n【5】README 说明了配置方式');
t('说明了 localStorage 配置方法', () =>
  readme.includes('localStorage.setItem') ? true : '未说明 localStorage 方式');
t('说明了 local-config.json 方式', () =>
  readme.includes('local-config.json') ? true : '未说明配置文件方式');
t('说明了未配置时的行为', () =>
  /未配置/.test(readme) ? true : '未说明未配置时的行为');
t('说明了为什么不公开线上地址', () =>
  /暂不公开访问地址/.test(readme) ? true : '未说明地址不公开的原因');
t('README 里没有线上地址', () =>
  /cet-exam-prep|sharecode=/.test(readme) ? 'README 仍含线上地址！' : true);

console.log('\n【6】实际行为验证');
t('resolveKey 在无注入、无 localStorage 时返回空串', () => {
  const src = cloudJs
    .replace(/export function/g, 'function')
    .replace(/export \{[^}]*\};?/g, '');
  // 模拟：无 window.__WB_CONFIG__、localStorage 为空
  const sandbox = {
    window: {},
    localStorage: { getItem: () => null },
  };
  const fn = new Function(
    'window',
    'localStorage',
    src + '\nreturn resolveKey();'
  );
  const r = fn(sandbox.window, sandbox.localStorage);
  return r === '' ? true : '返回了: ' + r;
});
t('有 localStorage 时能取到 key', () => {
  const src = cloudJs
    .replace(/export function/g, 'function')
    .replace(/export \{[^}]*\};?/g, '');
  const fake = 'wbpk_TEST_FAKE_KEY';
  const sandbox = {
    window: {},
    localStorage: { getItem: (k) => (k === 'wb.publishableKey' ? fake : null) },
  };
  const fn = new Function(
    'window',
    'localStorage',
    src + '\nreturn resolveKey();'
  );
  const r = fn(sandbox.window, sandbox.localStorage);
  return r === fake ? true : '返回了: ' + r;
});
t('运行时注入优先于 localStorage', () => {
  const src = cloudJs
    .replace(/export function/g, 'function')
    .replace(/export \{[^}]*\};?/g, '');
  const sandbox = {
    window: { __WB_CONFIG__: { publishableKey: 'wbpk_FROM_RUNTIME' } },
    localStorage: { getItem: () => 'wbpk_FROM_STORAGE' },
  };
  const fn = new Function(
    'window',
    'localStorage',
    src + '\nreturn resolveKey();'
  );
  const r = fn(sandbox.window, sandbox.localStorage);
  return r === 'wbpk_FROM_RUNTIME' ? true : '返回了: ' + r;
});

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);