// 产物体积守卫：任一 JS 分块 gzip 后超过阈值即失败，防止无意引入大依赖
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// 产物体积上限（KB，gzip 后）：单块 500、合计 1200
const LIMITS = { total: 1200, chunk: 500 };
// Vite 构建产物目录
const ASSETS_DIR = 'dist/assets';

// 构建后的全部 JS 文件
const jsFiles = readdirSync(ASSETS_DIR).filter((file) => file.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('未找到构建产物，请先运行 npm run build');
  process.exit(1);
}

// 累计 gzip 体积
let totalKb = 0;
// 单文件统计
const rows = jsFiles.map((file) => {
  // 单文件 gzip 后大小（KB，向上取整）
  const gzipKb = Math.ceil(gzipSync(readFileSync(join(ASSETS_DIR, file))).length / 1024);
  totalKb += gzipKb;
  return { file, gzipKb };
});

// 按体积降序输出，便于定位回归
rows.sort((a, b) => b.gzipKb - a.gzipKb);
for (const row of rows) {
  console.log(`${row.file}\t${row.gzipKb} KB`);
}
console.log(`合计\t${totalKb} KB`);

// 单块超限
const oversized = rows.filter((row) => row.gzipKb > LIMITS.chunk);
if (oversized.length > 0) {
  console.error(
    `以下分块超过 ${LIMITS.chunk} KB：${oversized.map((row) => row.file).join(', ')}`,
  );
  process.exit(1);
}

// 总量超限
if (totalKb > LIMITS.total) {
  console.error(`JS 总体积 ${totalKb} KB 超过上限 ${LIMITS.total} KB`);
  process.exit(1);
}
