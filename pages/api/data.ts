// 原生 @vercel/node handler（不用 next/server，与 vercel.json 的 @vercel/node 构建匹配）
// 数据源：随部署打包的 data/appdata.json（本地 server.mjs 生成的全量快照）
// 兜底：若本地文件读不到，匿名从公开仓库 raw.githubusercontent 拉取

import * as fs from 'fs';
import * as path from 'path';

const RAW_BASE = 'https://raw.githubusercontent.com/xiaomingtools/wechat-ops-center/main/data/appdata.json';

function readLocalAppData(): any | null {
  // 候选路径：函数工作目录 / 上级 / 项目根，兼容 Vercel 打包后的 cwd 差异
  const cands = [
    path.join(process.cwd(), 'data', 'appdata.json'),
    path.join(process.cwd(), '..', 'data', 'appdata.json'),
    path.join(__dirname, '..', '..', 'data', 'appdata.json'),
    path.join(__dirname, 'data', 'appdata.json'),
    'E:/自动盈利系统/公众号运营中心/wechat-ops-center/data/appdata.json',
  ];
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) {
      // try next
    }
  }
  return null;
}

async function fetchRemoteAppData(): Promise<any | null> {
  try {
    const res = await fetch(RAW_BASE);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  let appData = readLocalAppData();
  if (!appData) {
    appData = await fetchRemoteAppData();
  }

  if (!appData || !appData.overview) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: '数据未加载', detail: 'data/appdata.json 缺失，请在本地运行 sync 脚本后重新部署' }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(appData));
}

export default handler;
