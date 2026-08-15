# 贡献指南 (Contributing Guide)

感谢你对 **Oh My Mystery (OMM)** 的关注与支持！无论是提交缺陷报告、改进文档、优化知识图谱数据，还是贡献新功能，我们都非常欢迎。

---

## 🛠️ 开发环境与前置准备

1. **运行时与包管理器**：本项目统一使用 [Bun](https://bun.sh/)（v1.2+），请勿使用 `npm` / `yarn` / `pnpm`。
2. **任务执行器**：推荐安装 [just](https://github.com/casey/just)，通过快捷命令运行质量门禁与构建。

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/<your-username>/oh-my-mystery.git
cd oh-my-mystery

# 2. 安装依赖
bun install

# 3. 启动前后端本地协同开发服务
just dev
```

---

## 📐 代码规范与质量门禁

在提交代码或发起 Pull Request 前，请确保通过本地所有质量门禁：

```bash
# 格式化所有代码 (oxfmt)
just fmt

# 运行完整静态检查与 Lint (oxfmt check + oxlint + markdownlint)
just check

# 运行全套单元测试与集成测试
just test

# 一键执行校验
just verify
```

### 编码与提交要求

- **单引号规范**：TypeScript/JavaScript 文件中统一使用单引号 `'`。
- **Zero-DOM 规范**：前端视觉与图谱渲染基于 VectoJS Canvas 原生实体与组件，请勿直接注入原生 DOM 节点破坏 Canvas 渲染管线。
- **路径纯净性**：请勿在提交的代码、注释或文档中包含任何开发者本机的绝对路径。
- **提交信息规范**：遵循 Conventional Commits 约定（`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`）。

---

## 🌿 工作流规范

1. 从 `main` 分支切出功能分支：`git checkout -b feat/your-feature-name`
2. 编写代码并添加对应的单元测试（`apps/api/test/` 或前端测试）
3. 运行 `just verify` 确保检查与测试 100% 通过
4. 提交更改并发起 Pull Request
5. 等待代码审查（Review）通过后合并

---

## 💬 社区与交流

有任何新构想、推理流派数据建议或使用疑问，欢迎在 GitHub **Discussions** 中畅所欲言！
