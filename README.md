# <img src="https://cdn.xuepoo.xyz/omm/community/omm-logo.png" alt="OMM Logo" width="72" height="72"> Oh My Mystery (OMM) · 全球推理小说知识图谱

[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)
[![Built with VectoJS](https://img.shields.io/badge/Render-VectoJS%20Zero--DOM-blue.svg)](https://github.com/vectojs/vectojs)
[![Backend: Cloudflare Workers](https://img.shields.io/badge/Serverless-Cloudflare%20Workers%20%2B%20D1-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black.svg)](https://bun.sh/)

**Oh My Mystery (OMM)** 是一个基于 [VectoJS](https://github.com/vectojs/vectojs) Zero-DOM 渲染引擎打造的沉浸式全球推理小说知识图谱与文脉叙事探索平台。

本项目将古典案卷、羊皮纸与漆器美学融入现代化数据可视化中，汇聚黄金时代、古典本格、社会派、新本格、冷硬派等全球数万条推理小说知识图谱数据，提供多维漫游、编年史导览与线索路径推演。

---

## ✨ 核心特性

- 🚀 **Zero-DOM 纯 Canvas 渲染架构**：采用 VectoJS 与 Three.js 2D/3D 双层渲染管线，摒弃沉重 DOM 树，在万级实体拓扑下保持恒定 60FPS 极速交互。
- 📜 **推理演进编年史 (Chronicle Trails)**：沉浸式多幕叙事导览，带你穿梭于「黄金时代三巨头」与「日本推理小说百年演进史」，镜头自动平滑滑行聚焦至历史线索中心。
- 🔗 **侦探关系探路器 (Pathfinder)**：基于图拓扑的最短关系链推演算法，一键揭示任意两位侦探作家或作品之间的隐秘脉络（如：_柯南·道尔 ↔ 江户川乱步_）。
- 🌟 **智能文脉关联与推荐 (Recommendations)**：结合图谱拓扑与离线预计算的关联推荐系统，并附带动态文脉共鸣度仪表。
- 🎨 **顶级获奖级古典案卷美学**：
  - **金色线索星尘场**：具备流体动力学光标避让与呼吸浮动的线索微粒；
  - **宗师引力波涟漪**：核心派系大师向外周期扩散的黄金引力波动；
  - **浑天星盘与雷达**：自转八角罗盘与小地图 360° 动态雷达扫描；
  - **侦探准星与火漆印**：悬浮光学放大镜准星与矢量 `VERIFIED ARCHIVE` 认证火漆印章。
- 📱 **全端响应式与 HiDPI 视网膜屏适配**：支持移动端触控捏合手势、平板与高分屏整数像素对齐，字体与边框细腻锐利。

---

## 🏗️ 架构与技术栈

```text
omm/
├── apps/
│   ├── web/              # 前端应用：Vite + TypeScript + VectoJS Zero-DOM Canvas
│   └── api/              # 后端服务：Hono + Cloudflare Workers + D1 SQLite
├── packages/
│   └── shared/           # 共享类型定义、三元组数据模型与工具函数
├── scripts/              # Cloudflare Pages / Workers 自动化部署与 E2E 审计脚本
├── Justfile              # 统一任务运行配置 (fmt, check, lint, test, deploy)
└── package.json          # Monorepo 根依赖配置
```

| 模块           | 技术选型                             | 说明                                          |
| :------------- | :----------------------------------- | :-------------------------------------------- |
| **前端核心**   | VectoJS + Three.js + TypeScript      | Zero-DOM Canvas 渲染与 3D 力导向知识图谱      |
| **构建工具**   | Vite 8 + Bun                         | 高效模块热更新与代码分包构建                  |
| **后端框架**   | Hono                                 | 轻量极速 Web 框架，原生运行于 Edge 边缘节点   |
| **边缘运行时** | Cloudflare Workers + D1              | Serverless 分布式无服务器架构与 SQLite 数据库 |
| **质量门禁**   | oxfmt + oxlint + Vitest + Playwright | 统一高性能 Rust/Go 代码规范与自动化测试套件   |

---

## 🛠️ 快速开始

### 1. 环境准备

本项目采用 [Bun](https://bun.sh/) 作为统一的包管理器与运行时，并推荐使用 [just](https://github.com/casey/just) 作为任务执行工具。

```bash
# 克隆仓库
git clone https://github.com/Xuepoo/oh-my-mystery.git
cd oh-my-mystery

# 安装项目依赖
bun install
```

### 2. 本地协同开发

```bash
# 启动本地完整前后端开发服务（API: http://localhost:8787，Web: http://localhost:3000）
just dev
```

### 3. 代码质量检查与测试

```bash
# 代码自动格式化 (oxfmt)
just fmt

# 完整 CI 门禁检查 (oxfmt check + oxlint + markdownlint)
just check

# 运行单元测试与集成测试 (Vitest / bun test)
just test

# 运行 Playwright 端到端视觉与交互审计
just audit
```

### 4. 生产构建与部署

```bash
# 编译生产打包
just build

# 部署至 Cloudflare Pages & Workers
just deploy
```

---

## 🤝 贡献与反馈

欢迎提交 Issue 与 Pull Request！在贡献代码前，请确保运行 `just check && just test` 并通过所有质量门禁。

### OMM 讨论群

欢迎加入 OMM QQ 群 `1065814686`，交流推理小说数据、图谱使用体验与项目构想。

<p align="center">
  <img src="https://cdn.xuepoo.xyz/omm/community/omm-discussion-group.webp" alt="OMM QQ 群二维码" width="280">
</p>

爬虫数据目前由项目维护流程持续整理。后续计划在完成清理、文档和脱敏工作后，开放 `mystery-clawer` 爬虫代码，方便社区共同维护数据来源与采集规则。

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证。
