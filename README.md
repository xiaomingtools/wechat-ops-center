# 经营指挥中心 V3 - wechat-ops-center

微信公众号内容运营管理后台，完全独立于 AI 工具研究所（tool-archive）。

## 快速启动

### 方式一：本地访问
```bash
双击 start.bat
# 或命令行
node src/server.mjs
```
访问: http://localhost:3001/

### 方式二：Tailscale 公网访问
```bash
双击 start_funnel.bat
```
需要 Tailscale Premium 账户。

## 技术栈

- **后端**: Node.js (原生模块，零依赖)
- **前端**: Vanilla HTML/CSS/JavaScript
- **数据源**: 本地 JSON/CSV 文件

## 项目结构

```
wechat-ops-center/
├── src/
│   ├── server.mjs      # Express-like HTTP server
│   └── index.html      # V3 PRO dashboard
├── start.bat           # Windows 启动脚本
├── start_funnel.bat    # Tailscale Funnel 脚本
├── package.json
└── README.md
```

## 数据源路径

所有数据从以下固定位置读取（不随仓库移动变化）：

| 数据类型 | 路径 |
|---------|------|
| 主台账 | `E:/自动盈利系统/公众号运营中心/00_总控/WEBSITE_TUTORIAL_MANIFEST.json` |
| 微信快照 | `E:/自动盈利系统/公众号运营中心/10_运营数据/wechat_backend/` |
| 粉丝数据 | `E:/自动盈利系统/公众号运营中心/10_运营数据/follower_watch.json` |
| 文章绩效 | `E:/自动盈利系统/公众号运营中心/10_运营数据/article-performance.csv` |

## API 端点

- `GET /` - 主页
- `GET /api/app` - 完整应用数据
- `GET /api/overview` - KPI 概览
- `GET /api/topics` - 选题列表
- `GET /api/drafts` - 草稿箱
- `GET /api/publish-history` - 发布历史

## 版本历史

- V3 PRO (2026-11-25): 首次独立部署，浅色系配色匹配 aitoolyan.com
