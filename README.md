# PinCopy

轻量级桌面贴图工具：将剪贴板文本快速贴到屏幕上，支持代码高亮、缩放、透明度调节、深浅色主题与系统托盘常驻。

## 下载安装（Windows）

| 方式 | 链接 |
|------|------|
| **安装程序（推荐）** | [PinCopy_0.1.0_x64-setup.exe](releases/windows/PinCopy_0.1.0_x64-setup.exe) |

> 也可在 GitHub 页面进入 [`releases/`](releases/) 目录下载。安装前请先退出托盘中的旧版 PinCopy。

**macOS** 安装包暂未收录于本目录，需在 Mac 上自行构建，详见下方 [打包](#打包) 说明。

## 功能概览

- **全局热键贴图**：连按两次 `Ctrl` 读取剪贴板文本，在鼠标位置弹出贴图窗口
- **代码高亮**：自动识别代码语言（JavaScript、TypeScript、Rust、Python、JSON、Shell 等），中文内容优先按纯文本展示
- **JSON 自动格式化**：贴图内容为合法 JSON 时，自动以 2 空格缩进展示
- **窗口交互**：拖动、缩放、调透明度、复制、双击关闭
- **外观主题**：托盘右键 → **外观**，可选跟随系统 / 浅色 / 深色
- **系统托盘**：后台常驻，支持开机自启与手动贴图
- **单实例运行**：避免多开抢占热键

## 快捷键与操作

### 全局

| 操作 | 说明 |
|------|------|
| 双击 `Ctrl` | 将剪贴板文本贴到鼠标位置（需为文本内容） |
| 托盘 → 立即贴图 | 与双击 Ctrl 效果相同 |
| 托盘 → 外观 | 切换浅色 / 深色 / 跟随系统 |

### 贴图窗口

| 操作 | 说明 |
|------|------|
| 顶部拖动条 | 移动窗口 |
| 任意区域双击 | 关闭窗口 |
| `Shift` + 滚轮 | 缩放（0.3× ~ 3×） |
| `Alt` + 滚轮 | 调节透明度 |
| 普通滚轮 | 滚动内容 |
| `Ctrl` + `Shift` + `C` | 复制全部内容 |
| 「复制」按钮 | 复制全部内容 |
| `Esc` | 关闭窗口 |
| 内容区拖选 | 选择并复制部分文本 |

## 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install)（含 Cargo）
- **Windows** 10/11（当前提供预编译安装包）
- **macOS** 10.13+（需自行构建）

## 开发

```powershell
# 安装依赖
npm install

# 开发模式（热重载）
npm run tauri dev
```

## 打包

```powershell
# 仅生成 exe（便携版）
npm run tauri build -- --no-bundle
```

输出路径：

```
src-tauri\target\release\pincopy.exe
```

生成完整安装包（MSI / NSIS）：

```powershell
npm run tauri build
```

安装包默认输出在 `src-tauri\target\release\bundle\`。发布新版本时，可将 Windows 安装程序复制到 [`releases/windows/`](releases/windows/) 并更新本 README 的下载链接。

**macOS（Universal，Apple Silicon + Intel）：**

```bash
npm ci
npm run tauri build -- --target universal-apple-darwin
```

> 打包前请先退出正在运行的 `pincopy.exe`（托盘 → 退出），否则可能因文件被占用导致失败：
>
> ```powershell
> Stop-Process -Name pincopy -Force
> ```

## 使用说明

1. 运行安装程序或 `pincopy.exe` 后，应用会在**系统托盘**（任务栏右下角）显示图标，主窗口默认隐藏
2. 复制一段文本
3. **快速连按两次 Ctrl**，贴图窗口会在鼠标位置弹出
4. 需要开机启动时，在托盘菜单勾选「开机自启」（会写入当前 exe 路径）
5. 需要切换外观时，托盘右键 → **外观** → 选择主题

## 常见问题

### 双击 Ctrl 无反应

1. 确认剪贴板里是**文本**（图片、文件无效）
2. 确认没有其他 PinCopy 实例在运行（含 debug 版或旧的开机自启路径）
3. 查看日志：`%APPDATA%\com.pincopy.desktop\pincopy.log`

### 打包失败「拒绝访问」

`pincopy.exe` 正在运行，先退出进程再重新打包。

### 中文乱码

请使用最新版本；旧版曾用 `atob` 解码导致 UTF-8 中文异常，现已改为 `TextDecoder`。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | React 19 + Vite + Tailwind CSS 4 |
| 后端 | Rust |
| 代码高亮 | Prism.js |
| 全局热键 | rdev（双击 Ctrl 检测） |
| 剪贴板 | tauri-plugin-clipboard-manager |

## 项目结构

```
PinCopy/
├── src/                    # 前端 React 源码
│   ├── components/         # PinWindow 贴图窗口组件
│   ├── hooks/              # 主题等 Hook
│   └── utils/              # 代码检测、高亮、主题、内容解码
├── src-tauri/              # Rust 后端
│   ├── src/lib.rs          # 托盘、贴图窗口创建、热键
│   ├── src/hotkey.rs       # 双击 Ctrl 监听
│   ├── src/theme.rs        # 外观主题持久化
│   └── capabilities/       # Tauri 权限配置
├── releases/               # 预编译安装包（Windows 等）
└── dist/                   # 前端构建产物
```

## 许可证

私有项目，按需自行使用与分发。
