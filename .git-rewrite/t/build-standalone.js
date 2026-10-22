/**
 * 独立网页版构建脚本
 *
 * 目标：把 CSS / ES 模块 / SDK 全部内联进一个 HTML 文件，
 * 使其能双击直接打开（file:// 协议），无需服务器、无需联网加载依赖。
 *
 * 核心技术点：ES 模块在 file:// 下会被 CORS 拦截，且原生模块靠作用域隔离变量名。
 * 合并成单文件后必须自行实现这套隔离，否则 result / paper 等同名变量
 * 会跨文件冲突（Identifier 'result' has already been declared）。
 * 方案：每个模块编译成一个「工厂函数」，加载时先注入依赖再调用。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, '四六级AI批改.html');

// 模块加载顺序（依赖在前）
const MODULES = [
  'js/bank-loader.js',
  'js/tasks.js',
  'js/grading-levels.js',
  'js/srs.js',
  'js/cloud.js',
  'js/ai.js',
  'js/account.js',
  'js/app.js',
  'js/login-sheet.js',
  'js/view-home.js',
  'js/view-review.js',
  'js/view-vocab.js',
  'js/view-me.js',
  'js/main.js',
];

// 模块依赖图
const GRAPH = {
  'bank-loader': [],
  tasks: [],
  'grading-levels': [],
  srs: [],
  cloud: [],
  ai: ['cloud', 'grading-levels'],
  account: ['cloud'],
  'login-sheet': ['app'],
  app: ['bank-loader', 'tasks', 'srs', 'ai', 'account'],
  'view-home': ['app', 'login-sheet'],
  'view-review': ['app', 'grading-levels'],
  'view-vocab': ['app'],
  'view-me': ['app', 'login-sheet'],
  main: ['app', 'view-home', 'view-review', 'view-vocab', 'view-me'],
};

function read(p) {
  return fs.readFileSync(path.join(WEB, p), 'utf8');
}

/** 读二进制文件（图片等）。read() 的 utf8 会破坏二进制内容。 */
function readBinary(p) {
  return fs.readFileSync(path.join(WEB, p));
}

/**
 * 把一个 ES 模块编译成工厂函数源码。
 * 产出形如：function () { var __mod = window.__mod; ...body...; __exports = {...}; window.__registerModule(name, __exports); }
 */
function compileModule(code, name) {
  const exportsList = [];

  // ---------- import 逐行扫描（支持跨多行） ----------
  const lines = code.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\b/.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    // 收集完整语句
    let stmt = lines[i];
    let j = i;
    while (!/from\s+['"][^'"]+['"]/.test(stmt) && !/;\s*$/.test(stmt.trim()) && j + 1 < lines.length) {
      j++;
      stmt += '\n' + lines[j];
    }
    i = j;

    const m = stmt.match(/^\s*import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/);
    if (!m) continue; // 副作用导入，丢弃
    const clause = m[1].trim();

    // import * as ns from '...'
    let mm = clause.match(/^\*\s+as\s+(\w+)$/);
    if (mm) {
      kept.push(`var ${mm[1]} = __mod;`);
      continue;
    }

    // import def, * as ns from '...'
    mm = clause.match(/^(\w+)\s*,\s*\*\s+as\s+(\w+)$/);
    if (mm) {
      kept.push(`var ${mm[1]} = __mod.default !== undefined ? __mod.default : __mod;`);
      kept.push(`var ${mm[2]} = __mod;`);
      continue;
    }

    // import def from '...'
    mm = clause.match(/^(\w+)$/);
    if (mm) {
      kept.push(`var ${mm[1]} = (__mod.default !== undefined ? __mod.default : __mod.${mm[1]});`);
      continue;
    }

    // import { a, b as c } from '...'（可能跨多行）
    mm = clause.match(/^\{([\s\S]*)\}$/);
    if (mm) {
      const decls = mm[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
          return `var ${alias || orig} = __mod.${orig};`;
        });
      kept.push(decls.join('\n'));
      continue;
    }
  }
  let out = kept.join('\n');

  // ---------- export 处理 ----------
  // export default X
  out = out.replace(/^[ \t]*export\s+default\s+/gm, '__exports.default = ');

  // export { A, B as C }
  out = out.replace(/^[ \t]*export\s*\{([\s\S]*?)\}[ \t]*;?[ \t]*$/gm, (m, inner) => {
    inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
        exportsList.push(alias ? `${alias}: ${orig}` : orig);
      });
    return '';
  });

  // export const/let/var/function/class/async function X
  out = out.replace(
    /^[ \t]*export\s+(const|let|var|function|class|async\s+function)\s+(\w+)/gm,
    (m, kw, id) => {
      exportsList.push(id);
      return `${kw} ${id}`;
    }
  );

  out = out.replace(/\n{3,}/g, '\n\n');

  const exportLine = exportsList.length
    ? `__exports = { ${exportsList.join(', ')} };`
    : '/* 该模块无导出 */';

  // 去掉可能残留的 export 关键字（保险）
  out = out.replace(/^[ \t]*export\s+/gm, '');

  return `function () {
  var __exports = {};
  var __mod = window.__mod || {};
${out}
${exportLine}
  window.__registerModule(${JSON.stringify(name)}, __exports);
}`;
}

function build() {
  // ===== CSS =====
  const tokens = read('styles/tokens.css');
  const app = read('styles/app.css').replace(/@import\s+url\(['"]\.\/tokens\.css['"]\);?/g, '');
  const views = read('styles/views.css');
  const css = tokens + '\n' + app + '\n' + views;

  // ===== SDK（内联）=====
  const sdkPath = path.join(ROOT, 'node_modules/@tencent-ai/workbuddy-cloud-sdk/lib/index.global.js');
  let sdk = fs.readFileSync(sdkPath, 'utf8').replace(/\/\/#\s*sourceMappingURL=.*$/gm, '');

  // ===== 词库内联 =====
  // 词库原始 JSON 1.1MB，内联后单文件会涨到 1.6MB，微信里打开明显变慢。
  // 词库是纯文本，gzip 后只595KB（含 base64），且浏览器有原生解压 API
  // （DecompressionStream），无需引入任何解压库。
  // 线上版优先走 fetch 外部 JSON（只下当前等级那份），
  // 内联版作为 file:// 与离线场景的兜底。
  const cet4 = JSON.parse(read('data/cet4.json'));
  const cet6 = JSON.parse(read('data/cet6.json'));
  const slim = (arr) =>
    arr.map((w) => ({
      word: w.word,
      phonetic: w.phonetic,
      meaning: w.meaning,
      example: w.example,
      exampleCn: w.exampleCn || '',
      examExample: w.examExample || '',
      examSource: w.examSource || '',
      level: w.level,
    }));
  const bankJson = JSON.stringify({ cet4: slim(cet4), cet6: slim(cet6) });
  const bankGzB64 = zlib.gzipSync(Buffer.from(bankJson, 'utf8'), { level: 9 }).toString('base64');

  // ===== publishableKey 注入 =====
  // 真key 不能进仓库（开源仓库里的 key 会被任何人拿走消耗额度）。
  // 做法：key 放在 .workbuddy/local-config.json（已 gitignore），
  // 构建时读取并注入到 window.__WB_CONFIG__。
  // 没有这个文件 → 开源版构建，AI 功能不可用但其余功能正常。
  const LOCAL_CFG = path.join(ROOT, '.workbuddy/local-config.json');
  let wbConfig = null;
  if (fs.existsSync(LOCAL_CFG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf8'));
      if (cfg.publishableKey) {
        wbConfig = { publishableKey: cfg.publishableKey };
      }
    } catch (e) {
      console.log('  ! local-config.json 解析失败，AI 功能将不可用');
    }
  }
  console.log(
    '  ' +
      (wbConfig
        ? '✓ 已注入 publishableKey（私有版）'
        : '· 未注入 publishableKey（开源版，AI 功能需自行配置）')
  );

  // ===== 应用 JS =====
  // 收款码内联为 data URI：单文件版双击打开时，
  // 若引用相对路径会显示不出图（file:// 下 fetch 被 CORS 拦）。
  // 注意：read() 是按 utf8 读文本的，二进制图片必须用 readBinary，
  // 否则字节被按字符解码后损坏，图片变成乱码。
  //
  // 两种收款码：
  //   data/qr-image.jpg      —— 你的私有版本放真实收款码（不入库）
  //   data/qr-placeholder.jpg —— 开源版本放占位图（入库）
  // 优先用真实收款码，没有则回退到占位图，两种情况都能正常构建。
  const qrCandidates = ['data/qr-image.jpg', 'data/qr-placeholder.jpg'];
  const qrFile = qrCandidates.find((f) => fs.existsSync(path.join(WEB, f)));
  if (!qrFile) {
    throw new Error('缺少收款码图片：' + qrCandidates.join(' 或 '));
  }
  const qrDataUri =
    'data:image/jpeg;base64,' + readBinary(qrFile).toString('base64');

  const factories = MODULES.map((m) => {
    const name = path.basename(m, '.js');
    let code = read(m);
    if (name === 'view-me') {
      code = code.split('data/qr-image.jpg').join(qrDataUri);
    }
    return compileModule(code, name);
  });

  const names = MODULES.map((m) => path.basename(m, '.js'));

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F7F6F2">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>四六级AI批改</title>
<style>
${css}
</style>
</head>
<body>
<div class="shell"><main id="main"></main></div>
<nav id="nav"></nav>

<script type="application/gzip" id="wordbank-gz">
${bankGzB64}
</script>
<script>
/* ===== 运行时配置（publishableKey）=====
   真key 只在私有构建里注入（来自 .workbuddy/local-config.json，已 gitignore）。
   开源版这里是 null —— 部署者需自行在控制台执行：
     localStorage.setItem('wb.publishableKey', '你的 key')
   未配置时 AI 批改不可用，词库/背词/错题本等功能不受影响。 */
window.__WB_CONFIG__ = ${JSON.stringify(wbConfig)};
</script>
<script>
/* 词库以 type="application/gzip" 内联 —— 浏览器不会把它当 JS 解析，
   因此不阻塞首屏渲染。相比放在普通 <script> 里，能让首屏快几百毫秒。
   bank-loader 会按需读取 #wordbank-gz 的 textContent 并解压。 */
window.__WORDBANK_GZ__ = null;
window.__WORDBANK__ = null;
</script>

<script>
/* ===== 云服务 SDK（内联，免联网加载）===== */
${sdk}
</script>

<script>
/* ===== 模块运行时 =====
 * 原本用 ES 模块的 import/export 隔离变量名，合并为单文件后需自行实现：
 * 每个模块编译为一个工厂函数，加载时先把依赖注入 window.__mod 再调用。
 */
(function () {
  var GRAPH = ${JSON.stringify(GRAPH)};
  var cache = {};
  window.__modFactories = {};
  window.__registerModule = function (name, exportsObj) { cache[name] = exportsObj; };
  window.__requireModule = function (name) {
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    var deps = GRAPH[name] || [];
    var mod = {};
    for (var i = 0; i < deps.length; i++) {
      var dep = window.__requireModule(deps[i]);
      for (var k in dep) if (Object.prototype.hasOwnProperty.call(dep, k)) mod[k] = dep[k];
    }
    var f = window.__modFactories[name];
    if (f) { window.__mod = mod; f(); }
    return cache[name] || {};
  };
})();
</script>

<script>
/* ===== 应用模块（工厂函数，调用时执行，作用域相互隔离）===== */
(function () {
  var F = window.__modFactories;
${factories.map((f, i) => `  F[${JSON.stringify(names[i])}] = ${f};`).join('\n\n')}
})();
</script>

<script>
/* ===== 启动 ===== */
(function () {
  var ORDER = ${JSON.stringify(names)};
  var app = {};
  for (var i = 0; i < ORDER.length; i++) app[ORDER[i]] = window.__requireModule(ORDER[i]);
  window.__app = app;
})();
</script>
</body>
</html>
`;

  fs.writeFileSync(OUT, html, 'utf8');

  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  const appKb = (factories.join('').length / 1024).toFixed(0);
  console.log(`✓ 已生成 ${path.basename(OUT)}  (${kb} KB)`);
  console.log(`  样式 ${(css.length / 1024).toFixed(0)} KB · SDK ${(sdk.length / 1024).toFixed(0)} KB · 应用 ${appKb} KB`);
}

build();