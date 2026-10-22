#!/usr/bin/env node
/**
 * 词库数据准备脚本（可重跑）
 *
 * 作用：从网易有道官方 CDN 下载四六级词书，解压成 JSONL，
 * 放到 .workbuddy/backup/wordbank-source/。
 *
 * 之后运行 `node build-wordbank.js` 即可重新生成
 * web/data/cet4.json 与 cet6.json。
 *
 * 用法：node scripts/prepare-books.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, '.workbuddy/backup/wordbank-source');
const RAW = path.join(DEST, 'raw');

// 网易有道「有道考神」官方词书（按历年真题词频筛选）
const BOOKS = [
  { file: 'CET4luan_1', url: 'http://ydschool-online.nos.netease.com/1523620217431_CET4luan_1.zip', desc: '四级真题核心词 1162' },
  { file: 'CET4luan_2', url: 'http://ydschool-online.nos.netease.com/1524052539052_CET4luan_2.zip', desc: '四级英语词汇 3739' },
  { file: 'CET6luan_1', url: 'http://ydschool-online.nos.netease.com/1521164660466_CET6luan_1.zip', desc: '六级真题核心词 1228' },
  { file: 'CET6_2', url: 'http://ydschool-online.nos.netease.com/1524052554766_CET6_2.zip', desc: '六级英语词汇 2078' },
  { file: 'CET6_3', url: 'http://ydschool-online.nos.netease.com/1521164633851_CET6_3.zip', desc: '新东方六级词汇 2345' },
];

function download(url, dest, attempt = 1) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 60000 }, (r) => {
        if (r.statusCode !== 200) {
          r.resume();
          reject(new Error('HTTP ' + r.statusCode));
          return;
        }
        const f = fs.createWriteStream(dest);
        r.pipe(f);
        f.on('finish', () => {
          f.close();
          resolve(fs.statSync(dest).size);
        });
      })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy();
        reject(new Error('timeout'));
      });
  });
}

/** 从 zip 中读出第一个 .json（JSONL 格式） */
function readZipJsonLines(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 结构损坏');

  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const cmtLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');

    if (name.endsWith('.json')) {
      const lhName = buf.readUInt16LE(localOff + 26);
      const lhExtra = buf.readUInt16LE(localOff + 28);
      const method = buf.readUInt16LE(localOff + 8);
      const compSize = buf.readUInt32LE(localOff + 18);
      const start = localOff + 30 + lhName + lhExtra;
      const raw = buf.slice(start, start + compSize);
      const content = method === 0 ? raw : zlib.inflateRawSync(raw);
      return content
        .toString('utf8')
        .split('\n')
        .filter((l) => l.trim());
    }
    cd += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('zip 内未找到 .json');
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });

  for (const b of BOOKS) {
    const out = path.join(DEST, b.file + '.jsonl');
    if (fs.existsSync(out) && fs.statSync(out).size > 10000) {
      console.log('已存在 ' + b.file + '.jsonl');
      continue;
    }

    const zip = path.join(RAW, b.file + '.zip');
    let ok = false;
    for (let i = 1; i <= 3 && !ok; i++) {
      try {
        const sz = await download(b.url, zip);
        console.log('✓ 下载 ' + b.file + ' ' + (sz / 1024).toFixed(0) + 'KB  (' + b.desc + ')');
        ok = true;
      } catch (e) {
        console.log('  重试' + i + ' ' + b.file + ' 失败: ' + e.message);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!ok) {
      console.log('✗ 放弃 ' + b.file);
      continue;
    }

    const lines = readZipJsonLines(zip);
    fs.writeFileSync(out, lines.join('\n'), 'utf8');
    console.log('  → 解压 ' + lines.length + ' 条 → ' + b.file + '.jsonl');
  }

  // 清理 zip（JSONL 已保存）
  fs.readdirSync(RAW)
    .filter((f) => f.endsWith('.zip'))
    .forEach((f) => fs.unlinkSync(path.join(RAW, f)));

  console.log('\n完成。接下来运行：node build-wordbank.js');
})();