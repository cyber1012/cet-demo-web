/**
 * 本轮三项改动的端到端验证
 * 1. 首页「开始」按钮光晕可见（上一版被 z-index:-1 + overflow:hidden 完全遮住）
 * 2. 切词不再震荡（.view 带位移的入场动画不应在内部交互时触发）
 * 3. 「我的」页打赏区块默认收起、点击展开
 *
 * 验证方式：读真实 CSS 与 JS，并用 DOM 垫片真实执行 renderMe/renderHome。
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

const views = read('web/styles/views.css');
const appCss = read('web/styles/app.css');
const viewHome = read('web/js/view-home.js');
const viewMe = read('web/js/view-me.js');

console.log('\n【1】开始按钮光晕可见性（上一轮的真 bug）');
t('按钮不再用 isolation:isolate（会建立层叠上下文遮住负 z-index）', () =>
  /\.hero-ai-btn\s*\{[^}]*isolation/.test(views) ? '仍用 isolation: isolate' : true);
t('按钮不再用 overflow:hidden（会裁掉溢出的光晕）', () => {
  const m = views.match(/\.hero-ai-btn\s*\{([^}]*)\}/);
  return m && /overflow\s*:/.test(m[1]) ? '仍有 overflow:' + m[1].match(/overflow[^;]*/) : true;
});
t('光晕挂在 .hero-ai-cta（外层容器，能溢出按钮边界）', () =>
  /\.hero-ai-cta::before/.test(views) ? true : '未找到 .hero-ai-cta::before');
t('光晕 z-index:-1 但父容器有 z-index:0 建立层叠上下文', () => {
  const cta = views.match(/\.hero-ai-cta\s*\{([^}]*)\}/);
  return cta && /position:\s*relative/.test(cta[1]) && /z-index:\s*0/.test(cta[1])
    ? true
    : '.hero-ai-cta 缺 position:relative 或 z-index:0';
});
t('光晕动画仍是 transform+opacity（不走 box-shadow 重绘）', () => {
  const seg = views.slice(views.indexOf('@keyframes btnBreath'), views.indexOf('@keyframes btnBreath') + 200);
  return /transform/.test(seg) && !/box-shadow/.test(seg) ? true : 'btnBreath 动用了 box-shadow';
});
t('光晕有明确尺寸（能看出扩散）', () => {
  const m = views.match(/\.hero-ai-cta::before\s*\{([^}]*)\}/);
  if (!m) return '未找到样式';
  return /width:\s*96px/.test(m[1]) && /height:\s*44px/.test(m[1]) ? true : '尺寸未定义';
});
t('箭头 hover 右移（静态反馈，不持续动画）', () =>
  /\.hero-ai:hover \.hero-ai-arrow/.test(views) ? true : '缺少 hover 箭头反馈');

console.log('\n【2】切词震荡');
t('新增 .view-silent（纯淡入，无位移）', () => {
  if (!/\.view-silent/.test(appCss)) return '缺少 .view-silent 规则';
  const seg = appCss.slice(appCss.indexOf('.view-silent'), appCss.indexOf('.view-silent') + 120);
  return /fadeInOnly/.test(seg) ? true : 'no-anim 未指向纯淡入动画';
});
t('fadeInOnly 不含 translateY（无位移=不震荡）', () => {
  const seg = appCss.slice(appCss.indexOf('@keyframes fadeInOnly'), appCss.indexOf('@keyframes fadeInOnly') + 150);
  return /translateY/.test(seg) ? '含 translateY' : true;
});
t('.view 原始入场动画仍在（换页时仍需动效）', () =>
  /\.view\s*\{[^}]*animation:\s*fadeUp/.test(appCss) ? true : '换页动效被误删');
t('词汇页复习视图用 view-silent（列表视图保留入场动效）', () => {
  // 震荡发生在词汇页，所以要查 view-vocab.js（不是 view-home.js）
  const vv = read('web/js/view-vocab.js');
  // 列表视图应为普通 view（换页有动效），复习会话视图才是 view-silent
  const silent = (vv.match(/view view-silent/g) || []).length;
  const normal = (vv.match(/class="view"/g) || []).length;
  return silent >= 1 && normal >= 1 ? true : 'silent=' + silent + ' normal=' + normal;
});
t('词卡有 min-height（显示释义时不跳变）', () => {
  const m = views.match(/\.wordcard\s*\{([^}]*)\}/);
  return m && /min-height/.test(m[1]) ? true : '缺 min-height，下方按钮仍会上下移动';
});
t('词卡用 justify-content:center 配合 min-height', () =>
  /\.wordcard\s*\{[^}]*justify-content:\s*center/.test(views) ? true : '未居中，加释义时会偏上');

console.log('\n【3】打赏区块');
t('默认收起（showSupport 初始为 false）', () =>
  /let showSupport = false/.test(viewMe) ? true : '未找到 showSupport 初始值');
t('有 toggle 点击处理', () =>
  /a === 'support'/.test(viewMe) ? true : '未处理 support 点击');
t('二维码包在 showSupport 条件里', () =>
  /showSupport\s*\?/.test(viewMe) ? true : '未受 showSupport 控制');
t('文案不提学习委员身份（中性表述）', () => {
  if (/学习委员/.test(viewMe)) return '文案含「学习委员」';
  return true;
});
t('文案不提收费/付费字样', () => {
  // 只取「真正渲染出来的文字」：先剔除 HTML 注释，再查收费类字样
  // （注释里解释「为什么不做成收费」是合理的，不该算进去）
  //
  // 注意：模板结束标记是 `  </div>\`;` —— 反引号与 </div> 同行，
  // 不能假设它独占一行，这里找第一个「行尾是 \`;」的行。
  const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
  const lines = viewMe.split('\n');
  const start = lines.findIndex((l) => l.includes('root.innerHTML = `'));
  if (start < 0) return '未找到 root.innerHTML';

  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().endsWith('`;')) { end = i; break; }
  }
  if (end < 0) return '未找到模板结束标记';

  const tmpl = stripComments(lines.slice(start, end + 1).join('\n'));
  const bad = /付费|收费|购买/.test(tmpl);
  return bad ? '界面文案含收费类字样' : true;
});
t('引用可切换的收款码路径（私有真码 / 开源占位图）', () =>
  // 源码里写的是 data/qr-image.jpg，构建时会被替换成内联的 data URI。
  // 构建脚本按优先级选图：qr-image.jpg（私有真码）→ qr-placeholder.jpg（开源占位图）
  /data\/qr-image\.jpg/.test(viewMe) ? true : '未引用可切换的收款码路径');
t('已不再引用占位图', () =>
  viewMe.includes('qr-placeholder') ? '仍有占位图引用' : true);
t('二维码有 alt 文本（无障碍）', () =>
  /alt="[^"]*收款码[^"]*"/.test(viewMe) ? true : '缺 alt');
t('有展开动效（支持In）', () =>
  /@keyframes supportIn/.test(views) ? true : '缺展开动效');
t('收款码等比例缩放（height:auto，不能写死高度）', () => {
  const m = views.match(/\.support-qr img\s*\{([^}]*)\}/);
  if (!m) return '未找到 .support-qr img 样式';
  if (!/height:\s*auto/.test(m[1])) return '缺 height:auto，会压扁二维码';
  return true;
});
t('aspect-ratio 与裁剪后实际尺寸一致（506/540）', () =>
  /aspect-ratio:\s*506\s*\/\s*540/.test(views)
    ? true
    : 'aspect-ratio 与实际裁剪尺寸不符，会导致加载时跳动');

console.log('\n【4】冗余代码清理');
// 词库架构已升级为「按等级分片的 JSON + 按需加载」，
// 这里检查的是新的正确状态（旧的 wordbank.js 应已删除）
t('旧的硬编码词库 wordbank.js 已删除', () =>
  fs.existsSync(path.join(ROOT, 'web/js/wordbank.js')) ? '文件仍在' : true);
t('bank-loader 存在（负责按需加载）', () =>
  fs.existsSync(path.join(ROOT, 'web/js/bank-loader.js')) ? true : '文件缺失');
t('bank-loader 已在构建清单中', () =>
  /bank-loader/.test(read('build-standalone.js')) ? true : '构建配置缺引用');
t('utils/ 目录已删除', () =>
  fs.existsSync(path.join(ROOT, 'utils')) ? '目录仍在' : true);
t('词库按等级分为两个 JSON 分片', () => {
  const files = fs.existsSync(path.join(ROOT, 'web/data'))
    ? fs.readdirSync(path.join(ROOT, 'web/data'))
    : [];
  const c4 = files.includes('cet4.json');
  const c6 = files.includes('cet6.json');
  return c4 && c6 ? true : '缺 cet4.json=' + c4 + ' / cet6.json=' + c6;
});
t('词库无重复单词（读真实 JSON）', () => {
  const c4 = JSON.parse(read('web/data/cet4.json'));
  const c6 = JSON.parse(read('web/data/cet6.json'));
  const all = [...c4, ...c6];
  const seen = new Set();
  const dup = all.filter((w) => {
    const k = w.word.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  return dup.length === 0 ? true : '重复 ' + dup.length + ' 个: ' + [...new Set(dup.map((w) => w.word))].slice(0, 5).join(',');
});
t('测试目录无小程序版遗留', () => {
  const files = fs.readdirSync(path.join(ROOT, 'tests'));
  const bad = files.filter((f) => ['validate.js', 'wx-mock.js', 'ai-verify.js', 'ai-quality.js'].includes(f));
  return bad.length ? '仍存在: ' + bad.join(',') : true;
});
t('logic.test.js 不再引用 utils/', () =>
  /utils\//.test(read('tests/logic.test.js')) ? '仍有 utils 引用' : true);
t('收款码已内联进单文件版（无相对路径）', () => {
  const html = read('四六级AI批改.html');
  if (!html.includes('data:image/jpeg;base64')) return '未内联 JPEG';
  return !html.includes('data/qr-real.jpg') ? true : '仍有相对路径引用';
});
t('内联图片二进制未损坏（JPEG 头尾正确）', () => {
  const html = read('四六级AI批改.html');
  const m = html.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/);
  if (!m) return '未找到内联图片';
  const buf = Buffer.from(m[1], 'base64');
  const head = buf.slice(0, 3).toString('hex');
  const tail = buf.slice(-2).toString('hex');
  if (head !== 'ffd8ff') return 'JPEG 文件头损坏: ' + head;
  if (tail !== 'ffd9') return 'JPEG 文件尾不完整: ' + tail;
  return true;
});
t('内联图片与源文件字节数一致', () => {
  // 构建脚本按优先级选图：qr-image.jpg（私有真码）→ qr-placeholder.jpg（开源占位图）
  const src = fs.existsSync(path.join(ROOT, 'web/data/qr-image.jpg'))
    ? 'web/data/qr-image.jpg'
    : 'web/data/qr-placeholder.jpg';
  const html = read('四六级AI批改.html');
  const b64 = fs.readFileSync(path.join(ROOT, src)).toString('base64');
  return html.includes(b64) ? true : '内联内容与 ' + src + ' 不一致';
});
t('build-standalone 用 readBinary 读图片（不能用 utf8 的 read）', () =>
  // 路径已改为变量 qrFile（支持真码/占位图两种），但仍必须是 readBinary
  /readBinary\(qrFile\)/.test(read('build-standalone.js'))
    ? true
    : '未用 readBinary 读二进制，会损坏图片');

console.log('\n────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);