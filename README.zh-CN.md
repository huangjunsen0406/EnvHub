# EnvHub

中文 | [English](./README.md)

现代化的开发环境管理器，面向 Windows 和 macOS，提供主流开发工具和数据库的一键在线安装和多版本管理。

## 核心特性

- **多平台支持**：支持 `win-x64`、`darwin-x64`、`darwin-arm64`，自动识别平台并兼容 Rosetta
- **在线安装**：从官方镜像直接下载安装（npmmirror、EDB、Foojay 等）
- **多版本管理**：可安装并在多个版本间无缝切换
- **Shim 架构**：基于 `~/.envhub/shims` 实现版本切换，无需管理员权限
- **支持的工具**：
  - **编程语言**：Python、Node.js、Java（Temurin、Oracle、Corretto、GraalVM、Zulu、Liberica、Microsoft）
  - **数据库**：PostgreSQL（含 pgvector 扩展）、Redis（Redis Stack / Windows 移植版）
- **智能功能**：
  - 下载断点续传支持
  - 安装包智能缓存，加速重复安装
  - 实时安装进度追踪
  - 自动 PATH 管理
- **现代化界面**：使用 Electron + Vue 3 + TypeScript + Arco Design 构建

## 安装

### 下载

下载适合您平台的最新版本：

- **macOS**：`EnvHub-{version}-arm64.dmg`（Apple Silicon）或 `EnvHub-{version}-x64.dmg`（Intel）
- **Windows**：`EnvHub-{version}-win-x64.exe`

### 首次启动

**注意**：EnvHub 是一个开源应用程序，未进行代码签名。这是一个有意的选择，因为项目 100% 透明，由开发者维护并服务于开发者。

**macOS 用户：**

首次启动时，macOS Gatekeeper 会阻止应用运行。解决方法：

1. 右键点击（或按住 Control 点击）应用图标
2. 选择"打开"
3. 在对话框中点击"打开"

或在终端中移除隔离属性：
```bash
xattr -cr /Applications/EnvHub.app
```

**Windows 用户：**

Windows SmartScreen 可能会显示警告。解决方法：

1. 点击"更多信息"
2. 点击"仍要运行"

**首次启动后：**

1. 应用会自动检测您的平台并显示可用工具
2. 浏览 Languages 或 Databases 标签页查看可安装内容

## 快速开始

### 1. 安装工具

1. 进入 **Languages** 或 **Databases** 标签页
2. 点击 **Refresh** 从在线源获取最新版本列表
3. 选择要安装的版本
4. 点击 **Install** 并等待下载完成
5. 工具会自动解压并配置

### 2. 设为当前版本

安装完成后，点击 **Set as Current** 按钮：
- 在 `~/.envhub/shims` 生成 shim 脚本
- 使选定版本全局生效

### 3. 配置 PATH

将 `~/.envhub/shims` 添加到系统 PATH：

**macOS/Linux：**
```bash
# 添加到 ~/.zshrc 或 ~/.bashrc
export PATH="$HOME/.envhub/shims:$PATH"
```

**Windows：**
1. 在 Windows 设置中搜索"环境变量"
2. 编辑用户 PATH 变量
3. 添加 `%USERPROFILE%\.envhub\shims`

或者在 **Settings** 标签页使用内置的 PATH 管理器一键配置。

### 4. 验证安装

打开新的终端窗口并运行：
```bash
python --version
node --version
java --version
psql --version
redis-server --version
```

## 目录结构

```
~/.envhub/
├── cache/
│   ├── downloads/         # 已下载的安装包
│   ├── temp/              # 临时解压文件
│   └── versions-cache.json # 缓存的版本列表（24小时有效期）
├── toolchains/            # 已安装的工具版本
│   ├── python/{version}/{platform}/
│   ├── node/{version}/{platform}/
│   ├── java/{version}/{platform}/
│   └── pg/{version}/{platform}/
├── shims/                 # 版本切换脚本
│   ├── python, pip, python3
│   ├── node, npm, npx, corepack, pnpm
│   ├── java, javac, jar
│   ├── psql, pg_ctl, postgres, initdb
│   └── redis-server, redis-cli
├── logs/                  # 安装和运行日志
├── pg/                    # PostgreSQL 数据目录
│   └── {major}/
│       └── {cluster}/
│           ├── data/      # 数据库文件
│           └── logs/      # 服务器日志
└── state.json             # 已安装版本和当前选择
```

## 开发

### 环境要求

- Node.js 18+ 和 pnpm
- Git

### 开始开发

```bash
# 克隆仓库
git clone <repository-url>
cd envhub

# 安装依赖
pnpm install

# 运行开发模式
pnpm dev
```

### 可用命令

```bash
# 开发
pnpm dev              # 启动开发服务器（支持 HMR）

# 类型检查
pnpm typecheck        # 检查所有模块
pnpm typecheck:node   # 检查 main + preload
pnpm typecheck:web    # 检查 renderer

# 代码质量
pnpm lint             # 代码检查
pnpm format           # 代码格式化

# 构建
pnpm build            # 生产构建
pnpm build:mac        # 构建 macOS 安装包
pnpm build:win        # 构建 Windows 安装包
pnpm build:linux      # 构建 Linux 安装包
```

### 项目结构

- **`src/main/`**：Electron 主进程
  - `envhub/core/`：核心模块（平台检测、路径管理、日志、解压）
  - `envhub/registry/`：在线版本源和下载器
  - `envhub/runtimes/`：编程语言安装器（Python、Node、Java）
  - `envhub/databases/`：数据库安装器（PostgreSQL、Redis）
  - `envhub/env/`：环境管理（shims、PATH、自启动）
- **`src/preload/`**：通过 `contextBridge` 提供的安全 IPC 桥接
- **`src/renderer/`**：Vue 3 应用程序
  - `views/`：主视图（Languages、Databases、Settings、Logs）
  - `components/`：可复用 UI 组件
  - `store/`：Pinia 状态管理

## 致谢

- 使用 [Electron](https://www.electronjs.org/)、[Vue 3](https://vuejs.org/) 和 [TypeScript](https://www.typescriptlang.org/) 构建
- UI 组件来自 [Arco Design](https://arco.design/)
- 使用 [python-build-standalone](https://github.com/indygreg/python-build-standalone) 提供 Python 发行版
- 使用 [Foojay DiscoAPI](https://api.foojay.io/) 提供 Java 发行版
- 使用 [EDB binaries](https://www.enterprisedb.com/) 提供 PostgreSQL
- 使用 [Redis Stack](https://redis.io/docs/stack/) 提供 macOS/Linux Redis
- 使用 [tporadowski/redis](https://github.com/tporadowski/redis) 提供 Windows Redis
