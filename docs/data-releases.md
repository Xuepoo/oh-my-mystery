# OMM 公共数据库发布

OMM 发布经过版本化的 SQLite 公共快照。稳定入口如下：

- 发布索引：<https://cdn.xuepoo.xyz/omm/database/index.json>
- 最新版本清单：<https://cdn.xuepoo.xyz/omm/database/latest/manifest.json>
- 版本清单：`https://cdn.xuepoo.xyz/omm/database/releases/<version>/manifest.json`
- 版本下载：`https://cdn.xuepoo.xyz/omm/database/releases/<version>/omm.sqlite.zst`
- 版本校验文件：`https://cdn.xuepoo.xyz/omm/database/releases/<version>/sha256.txt`

其中 `<version>` 从发布索引或清单的 `release_version` 字段取得。每个不可变版本目录都包含 `omm.sqlite.zst`、`manifest.json` 和 `sha256.txt`。清单记录源码 revision、生成时间、压缩大小、SHA-256、schema 标记和各表行数。

这些文件是公开的 OMM 转换快照，不是实时的生产 Cloudflare D1（`omm-db`）数据库，也不是爬虫层的 `mystery-clawer/data/mystery.db`。爬虫数据库（`mystery-clawer/data/mystery.db`）经过筛选、清理、实体合并和派生数据生成后，才成为 OMM 快照（`omm/data/omm-d1.sqlite`，仓库内路径 `data/omm-d1.sqlite`）。不可变版本使用版本化 R2 key 保存；`latest` 清单是短缓存指针，可以回滚到旧版本。

## 下载、校验与解压

先读取最新清单，从 `compressed.download_url`、`compressed.sha256` 和版本号得到对应文件。下面的命令会把 `<version>` 替换为清单中的实际版本：

```bash
version='<version>'
base='https://cdn.xuepoo.xyz/omm/database/releases/'"$version"
curl -fLO "$base/omm.sqlite.zst"
curl -fsSLO "$base/sha256.txt"
sha256sum --check sha256.txt
unzstd -f omm.sqlite.zst -o omm.sqlite
sqlite3 omm.sqlite 'PRAGMA integrity_check;'
```

也可以直接使用清单中的完整 `download_url` 下载，并使用同一版本目录下的 `sha256.txt` 校验。校验通过后再打开 SQLite；不要把压缩文件直接当作 SQLite 文件使用。

完成本地完整性检查后，发布当前 OMM SQLite 快照：

```sh
bun scripts/publish-database-release.ts
```

脚本需要已认证的 Wrangler CLI 和现有的 `cdn-xuepoo-xyz` R2 bucket。它不读取或写入 secrets。发布前请确认输入的是 `omm/data/omm-d1.sqlite`（仓库内 `data/omm-d1.sqlite`），而不是爬虫数据库 `mystery-clawer/data/mystery.db`；脚本会先执行 SQLite integrity check，再压缩、计算校验值并写入版本对象、索引和 latest 清单。
