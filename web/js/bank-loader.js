/**
 * 词库按需加载器
 *
 * 为什么要按需加载：
 * 四级 2000 词 + 六级 2541 词 = 1.7MB JSON。
 * 一次性内联进单文件，微信里打开会明显卡顿。
 *
 * 策略：
 * 1. 词库按等级分成独立 JSON（cet4.json / cet6.json），只加载当前等级的
 * 2. 加载后缓存进 localStorage，二次进入直接读缓存，不重复下载
 * 3. 单文件版由构建脚本把词库内联为 base64，file:// 下也能用
 * 4. 加载失败时回退到内置的小词库，保证 App 不白屏
 */

const CACHE_PREFIX = 'cet.bank.v2.';
const CACHE_META = 'cet.bank.meta';

// 词库版本：内容变更时 +1，用来触发老用户词卡重建
export const BANK_VERSION = 2;

/** 构建脚本会把 gzipped base64 词库注入到 window.__WORDBANK_GZ__ */
function inlineBank() {
  if (typeof window === 'undefined') return null;
  const g = window.__WORDBANK__;
  return g && typeof g === 'object' ? g : null;
}

/**
 * 读取内联的 gzip 词库。
 *
 * 构建脚本把它放在 <script type="application/gzip"> 里——
 * 浏览器不会把它当 JS 解析，所以不阻塞首屏渲染。
 */
function readInlineGz() {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('wordbank-gz');
  const text = el ? (el.textContent || '').trim() : '';
  return text || null;
}

/**
 * 解压内联的 gzipped 词库（单文件版用）。
 * 用浏览器原生 DecompressionStream，不引入任何解压库。
 * 解压结果缓存在 window.__WORDBANK__，后续读同一份。
 */
let inflatePromise = null;
function inflateInline() {
  if (inlineBank()) return Promise.resolve(window.__WORDBANK__);
  if (inflatePromise) return inflatePromise;

  const b64 = readInlineGz();
  if (!b64) return Promise.resolve(null);

  if (typeof DecompressionStream === 'undefined') {
    // 极老浏览器不支持 → 走外部 JSON，再不行用兜底词库
    return Promise.resolve(null);
  }

  inflatePromise = (async () => {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const ds = new DecompressionStream('gzip');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const text = await new Response(stream).text();
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.cet4) && Array.isArray(parsed.cet6)) {
        window.__WORDBANK__ = parsed;
        return parsed;
      }
      return null;
    } catch (e) {
      return null;
    }
  })();

  return inflatePromise;
}

/** 内置兜底词库（加载失败时用，保证界面不空） */
const FALLBACK = [
  { word: 'access', phonetic: '/ˈækses/', meaning: 'v. 获取；n. 接近，入口', example: 'Users can access their voice mail remotely.', level: 'CET4' },
  { word: 'project', phonetic: '/prəˈdʒekt/', meaning: 'n. 工程；课题、作业', example: 'The total park project will need more plantings.', level: 'CET4' },
  { word: 'negotiate', phonetic: '/nɪˈɡəʊʃieɪt/', meaning: 'v. 谈判，协商', example: 'Children have to learn to negotiate the world.', level: 'CET4' },
  { word: 'battery', phonetic: '/ˈbætri/', meaning: 'n. 电池', example: 'You should recharge the battery.', level: 'CET6' },
  { word: 'possession', phonetic: '/pəˈzeʃn/', meaning: 'n. 拥有', example: 'He is in possession of the letter.', level: 'CET6' },
];

/**
 * 取指定等级的词库。
 * @param {'CET4'|'CET6'} level
 * @returns {Promise<Array>}
 */
export async function loadBank(level) {
  const key = level === 'CET6' ? 'cet6' : 'cet4';
  const cacheKey = CACHE_PREFIX + key;

  // 1) 内存缓存（同一页面内切换等级时复用）
  if (loadBank._mem && loadBank._mem[key]) return loadBank._mem[key];

  // 2) localStorage 缓存
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        loadBank._mem = loadBank._mem || {};
        loadBank._mem[key] = parsed;
        return parsed;
      }
    }
  } catch (e) {
    // 缓存损坏，继续走网络
  }

  // 3) 已解压的内联词库
  const inline = inlineBank();
  if (inline && Array.isArray(inline[key]) && inline[key].length) {
    loadBank._mem = loadBank._mem || {};
    loadBank._mem[key] = inline[key];
    return inline[key];
  }

  // 4) 外部 JSON（线上版：只下载当前等级那一份）
  //    放在内联解压之前，因为线上有HTTP 缓存，比解压 gzip 更快
  try {
    const res = await fetch('data/' + key + '.json', { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) {
        loadBank._mem = loadBank._mem || {};
        loadBank._mem[key] = list;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(list));
          localStorage.setItem(CACHE_META, JSON.stringify({ v: BANK_VERSION, t: Date.now() }));
        } catch (e) {
          /* 超配额则只留内存 */
        }
        return list;
      }
    }
  } catch (e) {
    // file:// 下 fetch 会被 CORS 拦，走下一步
  }

  // 5) 内联 gzip 解压（单文件版 / 离线场景）
  const inflated = await inflateInline();
  if (inflated && Array.isArray(inflated[key]) && inflated[key].length) {
    loadBank._mem = loadBank._mem || {};
    loadBank._mem[key] = inflated[key];
    return inflated[key];
  }

  // 6) 兜底小词库，保证界面不空
  const fb = FALLBACK.filter((w) => w.level === level);
  loadBank._mem = loadBank._mem || {};
  loadBank._mem[key] = fb;
  return fb;
}

/** 词库是否已缓存到本地（用于判断能否离线用） */
export function isCached(level) {
  const key = (level === 'CET6' ? 'cet6' : 'cet4');
  if (loadBank._mem && loadBank._mem[key]) return true;
  try {
    return !!localStorage.getItem(CACHE_PREFIX + key);
  } catch (e) {
    return false;
  }
}

/** 清空词库缓存（换词库版本时用） */
export function clearCache() {
  try {
    ['cet4', 'cet6'].forEach((k) => localStorage.removeItem(CACHE_PREFIX + k));
    localStorage.removeItem(CACHE_META);
  } catch (e) {
    /* 忽略 */
  }
  loadBank._mem = null;
}

export default { loadBank, isCached, clearCache, BANK_VERSION };