# EnvHub 用户指南

EnvHub 是一个类似 phpEnv/phpStudy 的本地开发环境管理器，支持 Python、Node.js、PostgreSQL 的多版本离线安装与管理。

## 🚀 快速开始

### 第一步：准备离线包

**重要：必须先准备离线包！** 详见 [OFFLINE_PACKAGE_GUIDE.md](OFFLINE_PACKAGE_GUIDE.md)

离线包目录结构：

```
my-bundle/
├── manifest.json        # 必需！版本清单文件
├── toolchains/          # 二进制文件
│   ├── python/
│   ├── node/
│   └── pg/
├── wheels/              # Python wheels（可选）
└── npm/                 # pnpm 安装包（可选）
```

### 第二步：启动应用

```bash
# 开发模式
pnpm dev

# 或打包后运行
pnpm build:mac   # macOS
pnpm build:win   # Windows
```

### 第三步：配置离线包

1. 打开应用，进入**"设置"**页面
2. 点击**"浏览"**按钮，选择你的离线包目录
3. 目录会自动保存，下次打开应用时会记住

或者在**"工具管理"**页面直接点击**"浏览"**按钮。

### 第四步：安装工具

1. 进入**"工具管理"**页面
2. 点击**"加载清单"**按钮（读取 manifest.json）
3. 选择需要的版本，点击**"安装"**
4. 等待安装完成（会显示进度弹窗）
5. 点击**"设为当前"**激活版本

### 第五步：配置 PATH

1. 返回**"设置"**页面
2. 点击**"添加到 PATH"**按钮
3. 重启终端或执行提示的命令
4. 现在可以在终端使用 `python`、`node`、`psql` 等命令了！

## 📖 功能详解

### 仪表盘

- **系统信息**：显示操作系统、架构、Shims 路径
- **工具状态**：显示 Python/Node/PostgreSQL 的当前版本和已安装数量
- **PATH 状态**：检查 PATH 是否已配置
- **快速开始指南**：帮助新用户了解使用流程

### 工具管理

#### Python 管理

- **安装版本**：支持多版本并存
- **设为当前**：切换默认 Python 版本
- **安装工具**：
  - `pipx`：独立环境的 Python 应用安装器
  - `uv`：高性能 Python 包管理器
- **卸载**：删除已安装的版本

#### Node.js 管理

- **安装版本**：支持多版本并存
- **设为当前**：切换默认 Node 版本
- **安装 pnpm**：快速的包管理器
- **卸载**：删除已安装的版本

#### PostgreSQL 管理

- **安装版本**：支持多版本并存
- **初始化并启动**：
  - 自定义集群名称（默认 `main`）
  - 自定义端口（默认 `5432`）
  - 使用 SCRAM 认证（安全）
- **状态监控**：
  - 显示运行状态（PID、端口）
  - 刷新状态按钮
- **控制按钮**：
  - **停止**：停止 PostgreSQL 服务
  - **重启**：重启 PostgreSQL 服务
- **安装 pgvector**：向量数据库扩展（用于 AI/ML）
- **设为当前**：切换默认 PostgreSQL 版本

### 日志

- **实时日志**：显示所有操作的日志
- **过滤**：搜索关键词
- **自动滚动**：自动滚动到最新日志
- **导出**：导出日志到 txt 文件
- **清空**：清空所有日志

### 设置

- **离线包配置**：选择离线包目录
- **PATH 管理**：
  - 查看 Shims 路径
  - 查看配置状态
  - 一键添加到系统 PATH
  - 一键从 PATH 移除
- **关于信息**：应用版本和技术栈

## 🔧 高级功能

### Shims 机制

EnvHub 使用 **Shims** 技术实现版本切换：

1. 安装路径：`~/.envhub/toolchains/<tool>/<version>/<platform>`
2. Shims 脚本：`~/.envhub/shims/<command>`
3. 切换版本时只需更新 Shims，无需修改多个配置

```bash
# 查看 Shims
ls ~/.envhub/shims/

# macOS/Linux
python -> ~/.envhub/toolchains/python/3.12.6/darwin-arm64/bin/python
pip -> ~/.envhub/toolchains/python/3.12.6/darwin-arm64/bin/python -m pip
node -> ~/.envhub/toolchains/node/20.11.1/darwin-arm64/bin/node
npm -> ~/.envhub/toolchains/node/20.11.1/darwin-arm64/bin/npm
psql -> ~/.envhub/toolchains/pg/16.4/darwin-arm64/bin/psql
```

### PostgreSQL 多集群管理

支持创建多个 PostgreSQL 集群：

```bash
# 数据目录
~/.envhub/pg/<version>/<cluster-name>/

# 例如
~/.envhub/pg/16.4/main/
~/.envhub/pg/16.4/test/
~/.envhub/pg/15.6/dev/
```

在**工具管理**页面的 PostgreSQL 配置区可以设置：

- **集群名**：给集群命名（如 `main`、`test`、`dev`）
- **端口**：避免端口冲突（默认 5432）

### PATH 配置详解

**macOS/Linux**：

- 自动检测 shell 类型（zsh/bash）
- 写入 `~/.zshrc` 或 `~/.bashrc`
- 添加内容：
  ```bash
  # EnvHub shims
  export PATH="~/.envhub/shims:$PATH"
  ```

**Windows**：

- 使用 PowerShell 修改用户环境变量
- 添加 `%USERPROFILE%\.envhub\shims` 到 PATH
- 无需管理员权限

### 离线安装额外工具

**Python 工具**：

- 从 `wheels/` 目录离线安装
- 自动使用 `pip install --no-index --find-links`
- 支持 pipx、uv 等工具

**Node.js 工具**：

- 从 `npm/pnpm.tgz` 离线安装 pnpm
- 使用 `npm install -g <path-to-tarball>`

## ⚠️ 注意事项

### manifest.json 是必需的

没有 manifest.json，无法加载离线包！它包含：

- 所有可安装的版本
- 文件路径
- SHA256 校验和（安全验证）

### 平台标识

- `darwin-arm64`：macOS Apple Silicon (M1/M2/M3)
- `darwin-x64`：macOS Intel
- `win-x64`：Windows 64-bit

确保下载对应平台的二进制文件！

### PATH 生效时间

- **macOS/Linux**：需要重启终端或执行 `source ~/.zshrc`
- **Windows**：需要重启终端或重新登录

### PostgreSQL 端口占用

如果提示端口已被占用：

1. 修改端口号（如 5433、5434）
2. 停止其他 PostgreSQL 服务
3. 使用不同的集群名

### 磁盘空间

- Python：~150-250MB / 版本
- Node.js：~50-100MB / 版本
- PostgreSQL：~200-300MB / 版本

建议预留至少 **2GB** 空间。

## 🐛 常见问题

### Q: 提示"找不到 manifest.json"

**A**: 检查离线包目录是否包含 `manifest.json` 文件。

### Q: 安装后命令不可用

**A**:

1. 检查 PATH 是否已配置（设置页面）
2. 重启终端
3. 检查 `~/.envhub/shims` 是否有对应的脚本

### Q: PostgreSQL 无法启动

**A**:

1. 检查端口是否被占用
2. 查看日志：`~/.envhub/pg/<version>/<cluster>/pg.log`
3. 尝试使用不同的端口或集群名

### Q: macOS 提示"无法验证开发者"

**A**:

```bash
# 解除隔离属性
xattr -cr ~/. envhub/toolchains/python/3.12.6/darwin-arm64/
```

### Q: Windows 杀毒软件拦截

**A**: 将 `~/.envhub` 目录添加到杀毒软件白名单。

### Q: 如何卸载 EnvHub

**A**:

1. 在设置页面点击"从 PATH 移除"
2. 删除 `~/.envhub` 目录
3. 卸载应用程序

## 📝 更新日志

### v1.0.0 (2025-01-XX)

- ✅ 核心功能实现
- ✅ Python/Node/PostgreSQL 多版本管理
- ✅ PATH 环境变量自动配置
- ✅ PostgreSQL 状态监控和控制
- ✅ 安装进度显示
- ✅ 实时日志系统
- ✅ Arco Design UI

## 🆘 获取帮助

- 查看 [OFFLINE_PACKAGE_GUIDE.md](OFFLINE_PACKAGE_GUIDE.md) 了解如何制作离线包
- 查看 [CLAUDE.md](CLAUDE.md) 了解项目架构
- 查看 [DESIGN.md](DESIGN.md) 了解设计方案

## 📜 许可证

本项目使用 MIT 许可证。
