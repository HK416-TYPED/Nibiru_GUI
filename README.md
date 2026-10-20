# Nibiru Image Lab

面向小规模内测的多用户 ComfyUI 生图工作台，支持邀请码注册、个人图库、TXT 批量生成、参数预设和按用户轮转的任务调度。

使用原生 Node.js HTTP、SQLite 与浏览器 ES Modules，无第三方 npm 依赖，无前端构建步骤。服务按**单实例**运行。

## 快速开始

需要支持 `node:sqlite` 的 Node.js 24 或更新版本。部署请使用对应发布线最新的安全修复版本。

```sh
git clone https://github.com/deepghs/Nibiru_GUI.git
cd Nibiru_GUI
cp .env.example .env
chmod 600 .env
```

编辑根目录 `.env`，设置数据目录、端口和管理员凭据：

```dotenv
HOST=127.0.0.1
PORT=3000
DATA_DIR=./data
COMFYUI_URL=http://127.0.0.1:8188
ADMIN_USERNAME=DeepGHS
ADMIN_PASSWORD="替换为你自己的至少12位密码"
SECURE_COOKIE=0
```

首次部署到空数据库时执行：

```sh
npm run setup:admin
npm start
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用配置的管理员账号登录。管理员生成邀请码后，其他用户才能注册。

- 默认管理员用户名为 `DeepGHS`，**仓库不提供默认密码**。实际凭据只放在部署机器的 `.env`，该文件已排除 Git。
- `setup:admin` 只初始化空数据库，密码经过 scrypt 哈希保存。重复执行会拒绝覆盖已有账号；修改 `.env` 或重启服务不会重置已有密码。
- 也可以跳过命令行初始化，直接启动服务，通过首次设置页创建管理员；需要输入服务器生成的 `DATA_DIR/.setup-token` 中的密钥，成功后密钥文件移除。
- 已有账号在「设置 → 账户安全」修改密码，成功后撤销其他登录会话。
- 不需要执行 `npm install`。从项目根目录运行以上命令。

## 连接远端 ComfyUI

连接链路：浏览器 → Nibiru 后端 → 本机 SSH 转发端口 → 远端 ComfyUI。

先在算力机器运行 ComfyUI，再在**运行 Nibiru 的同一台机器**建立隧道：

```sh
node scripts/tunnel.mjs your-ssh-host
# 也支持 user@host，使用现有 SSH 配置和密钥
```

隧道转发 `127.0.0.1:8188` 到远端 `127.0.0.1:8188`，包含存活检测。保持隧道进程运行；如果已经通过 Termius 等工具转发，无须重复启动。使用其他本地端口时自行配置隧道，并修改 `COMFYUI_URL`。

远端必须安装工作流所需节点和模型。默认工作流为 `workflows/krea2-turbo.json`，使用：

- `krea2_turbo_bf16.safetensors`
- `qwen3vl_4b_bf16.safetensors`
- `qwen_image_vae.safetensors`

网站管理员添加模型时分别填写 **ComfyUI 模型名**和**用户显示名称**。其他模型沿用当前工作流的 CLIP/VAE 配置；不同架构需要适配工作流，不能仅替换模型名。删除网站模型登记不会删除远端 checkpoint。

不要向用户直接开放 ComfyUI 的 8188 端口。生成图片由 Nibiru 下载并保存，清空 ComfyUI 历史不会删除网站图库。

## 功能

### 生成

- 基础参数：prompt、模型、参数预设、每批张数、生成次数。
- 进阶参数：negative prompt、尺寸、steps、CFG、sampler、scheduler、seed、denoise；可命名保存预设。
- 每批张数可选 **1/2/4/8**，生成次数最多 **32**。
- 预设随账户保存，可在设置页使用、重命名、编辑或删除；用户选择的模型和预设可恢复。
- 网格根据实际图片宽高、数量及画布空间选择排列，保持比例、不裁切；支持大图查看、下载、复用参数。
- 设置中可切换为纵向逐张浏览，使用左侧圆点定位。
- 右侧为可收起的任务队列，列出排队和生成中的批次，可取消尚未提交的图片；已完成图片在历史中查看。

### TXT 批量任务

上传 UTF-8 TXT，可选择每行一个 prompt，或按空行分段。每行模式示例：

```text
A glass greenhouse above a sea of clouds
An olive ceramic vase on cream linen
A quiet bookstore on a rainy evening
```

任务拥有独立的模型和推理参数，可载入已保存预设；修改任务参数不会改变普通生成页。

| 限制 | 数值 |
| --- | --- |
| 每批张数 | 1 / 2 / 4 / 8 |
| 每条 prompt 重复次数 | 固定为 1 |
| 每任务 prompt 数量 | 最多 128 |
| 每任务图片数量 | 最多 1024 |
| 每账户待处理图片 | 最多 4096 |

支持任务进度、结果查看和取消剩余图片。已结束且有图片的任务可以下载整包 ZIP，包含原图与 `manifest.json` 参数清单，支持 ZIP64。运行中任务需要完成或取消剩余图片后再导出。

PNG Grid 在浏览器合成，可选 1/2/3/4/8 列及标签，每页最多 64 张、16MP，逐页下载，不影响原始图片。

交互参考 [Lumi Batcher](https://github.com/bytedance/comfyui-lumi-batcher)，没有复制其源码；TXT 格式是本项目自己的导入约定。

### 历史、设置与管理

- 历史按批次层叠展示，支持关键词检索、日期筛选、时间轴及前后排序。
- 支持单张、批次、多选删除，以及清空当前账户历史。删除会移除本地图片文件；有活动任务时禁止清空历史。
- 日间、夜间、跟随系统主题及中英文界面。
- 邀请码一人一次，用后失效，有效期可选 1/2/3/5/7 天或永久。
- 管理员可管理模型、停用其他账户，并查看登录和使用活动。
- 管理员可设置新用户的初始模型和参数预设。预设以快照复制为用户自己的副本，仅首次进入时应用，之后不会覆盖个人选择；已有用户不受追溯影响。

## 多用户调度

每个逻辑 batch 拆为持久化的单图片任务，保存独立种子和工作流。调度器按近期图片耗时的指数移动平均、等待用户数和远端队列深度，动态决定每轮纳入用户数；软时间片预算为 30 秒，游标和耗时估计保存到 SQLite。

普通生成优先于 TXT 批量任务：两类都有等待时，按 **3 个普通生成片段 : 1 个批量片段**分配机会，各自维护用户轮转游标。

ComfyUI 无法无损抢占正在采样的单张图片，因此轮转发生在单张完成后；单张可能超过软预算。单个 ComfyUI 实例同一时刻只提交一个本站执行片段，外部提交的 ComfyUI 任务不受本站控制。

取消只停止未提交的图片，已经提交的单张仍会完成并保存。服务重启后会核对持久化任务与远端状态；维护时仍建议先等待当前图片完成再停服务。

## 配置与部署

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `HOST` | `127.0.0.1`，后端监听地址 |
| `PORT` | `3000` |
| `DATA_DIR` | `./data`，SQLite 和私有图片目录 |
| `COMFYUI_URL` | `http://127.0.0.1:8188` |
| `ADMIN_USERNAME` | `DeepGHS`，仅命令行初始化使用 |
| `ADMIN_PASSWORD` | 无默认值，仅命令行初始化使用 |
| `APP_ORIGIN` | 部署时设置精确 HTTPS 网站源，如 `https://images.example.com` |
| `SECURE_COOKIE` | HTTPS 部署设为 `1` |
| `NIBIRU_SETUP_TOKEN` | 可选网页初始化密钥，至少 32 位 URL-safe 随机字符 |
| `MAX_USER_IMAGE_BYTES` | `21474836480`，每账户默认 20 GiB 图片额度 |

自定义本地端口和数据目录：

```sh
PORT=3001 DATA_DIR=/path/to/private-data npm start
```

多人部署应放在可信 HTTPS 反向代理后，设置 `APP_ORIGIN` 与 `SECURE_COOKIE=1`。后端本身不提供 TLS，启动器会拒绝未配置 HTTPS 的公网绑定。反向代理应保留正确 Host，统一代理页面和同源 API，并配置访问控制及边缘限流。不要直接运行多个实例共享同一数据库；限流、导出锁和调度目前按单实例协调。

首次创建管理员应在受控环境完成，再开放访问。使用进程管理器维护网站与 SSH 隧道；仓库不包含域名、证书、SSH 私钥或远端主机凭据。

### 数据与备份

账户、会话、邀请码、模型、参数预设、任务和活动记录保存在 `DATA_DIR/nibiru.sqlite`，图片保存在该数据目录内。目录权限为 0700，私有文件为 0600。不要把 `DATA_DIR` 映射到静态文件服务。

备份整个数据目录；运行中使用 SQLite 在线备份并协调图片快照，或停服务后复制整个目录。恢复时停服务再替换，并确认所有者、权限及 `DATA_DIR` 一致。`.env` 单独保管，不提交仓库。

写图会保留至少 1 GiB 磁盘空间。ZIP 每用户同时最多一个、全局最多两个，最长 10 分钟；导出期间禁止删除该用户历史。

### 安全范围

实现了账户归属检查、管理员角色校验、Host/Origin 校验、跨站请求限制、安全响应头、登录限流、异步 scrypt 和会话撤销。无 npm 运行依赖不代表不存在运行时或主机漏洞。

详细审查记录见 [安全报告](docs/security/review-2026-10-20.md)，它是 2026-10-20 的历史检查结果，不是当前运行环境的安全保证。部署前核对 [Node.js 安全公告](https://nodejs.org/en/blog/vulnerability)，使用已修复版本；远端 ComfyUI、自定义节点和 SSH/主机配置需独立检查。

## 开发与验证

```sh
npm test          # 隔离数据库、模拟 ComfyUI 的回归测试
npm run check     # JavaScript 语法检查
npm run dev       # Node watch 模式
```

实际 GPU 联调脚本 `scripts/live-smoke.mjs` 需要显式的测试环境与环境变量凭据；只用于一次性测试实例，不要对真实用户数据做删除测试。

| 目录 / 文件 | 用途 |
| --- | --- |
| `public/` | 浏览器界面、样式及静态素材 |
| `server/` | 鉴权、数据库、API、调度、ComfyUI 与图片存储 |
| `setup-admin.mjs` | 部署管理员初始化入口 |
| `workflows/` | ComfyUI API 工作流 |
| `scripts/` | 隧道、语法检查、显式联调工具 |
| `tests/` | 自动回归测试 |
| `docs/` | 设计、实现与历史验证记录 |

协议参考：[ComfyUI API 示例](https://github.com/Comfy-Org/ComfyUI/tree/master/script_examples)、[OpenSSH 本地转发](https://man.openbsd.org/ssh#L)。
