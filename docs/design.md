# Nibiru 内测工作台

## 目标
受邀用户登录后通过 ComfyUI 生成图像；数据按账户隔离，重启与刷新后保留。参考 NovelAI 的画布/历史分区及用户提供的米色界面。用户已要求自主完成，实现与验证直接推进。

## 界面
- 米白底、墨绿字、橄榄绿主操作，细线、紧凑工具栏、留白。英文品牌 NIBIRU / IMAGE LAB，默认中文。
- 桌面左导航 204px，右侧批次 280px；中央优先占空间。底部直角 composer 与窗口底边相接，基础/进阶向上展开。
- 登录/注册；首次本机部署显示创建管理员流程。普通注册要求单次邀请码。
- 生成：prompt、模型、batchSize、repeat；进阶 negative、steps、cfg、sampler、scheduler、seed、denoise、width/height。默认对应所给 JSON：8/1/euler/simple/1。
- 中央单图/网格、图片弹窗/下载/复用参数；右侧按批次持久保存。
- 任务留空，仅显示预留页；历史提供关键词、日期、排序、日期时间轴。
- 设置提供浅色/深色/系统与中/英，保存在账户；超管管理模型、邀请码（有效天数/永久）、用户状态、登录与生成活动。

## 实现
Node 26 原生 HTTP + node:sqlite + 浏览器 ES modules，无第三方运行依赖。SQLite 存储账户、会话、邀请码、模型、批次、活动；图片复制到私有 data/images，通过鉴权路由访问。
浏览器只访问本站后端；后端 COMFYUI_URL 默认 http://127.0.0.1:8188。SSH 隧道在部署层建立，远端身份未知时不猜测主机。端口 8188 已实时检查可用。
密码 scrypt；HttpOnly SameSite=Strict cookie；写请求同源校验；邀请码原子消耗；服务端权限与账户隔离；请求大小、参数及并发限制。
后台队列提交 /prompt，轮询 /history/{id}，获取 /view 后保存图片。服务重启保留批次并重新查询有 promptId 的任务，不盲目重复提交。失败向用户展示。
模型添加界面分别输入 ComfyUI 模型名与用户显示名称。后端自动补充文件扩展名；已发现的 checkpoint 使用 CheckpointLoaderSimple，其他模型沿用当前 Krea2 编码器和 VAE。不同模型架构另行适配工作流。

## API 契约
所有响应 JSON，错误 {error:string}；日期 ISO UTC，界面按本地时间显示。
- GET /api/session → {user:null|User,setupRequired:boolean}
- POST /api/setup {username,password,confirmPassword} → {user}; 仅空库且 loopback
- POST /api/auth/register {username,password,confirmPassword,inviteCode} → {user}
- POST /api/auth/login {username,password} → {user}; POST /api/auth/logout
- User: {id,username,role:'admin'|'user',disabled:boolean,preferences:{theme:'light'|'dark'|'system',language:'zh'|'en'}}
- GET /api/models → {models:Model[]}; Model {id,name,kind:'unet'|'checkpoint',filename,clipName,clipType,vaeName,enabled}
- GET /api/capabilities → {online,samplers:string[],schedulers:string[],unets:string[],checkpoints:string[],clips:string[],vaes:string[],clipTypes:string[]}
- POST /api/generations {prompt,negativePrompt,modelId,batchSize,repeat,width,height,steps,cfg,sampler,scheduler,seed,denoise} → {batches:Batch[]}; seed=-1 random
- GET /api/batches?q=&date=YYYY-MM-DD&sort=desc|asc → {batches:Batch[]}
- Batch {id,createdAt,status:'queued'|'running'|'completed'|'failed',prompt,negativePrompt,modelName,params,images:[{id,url}],error?,promptId?}; params includes all generation inputs + actual seed
- GET /api/images/:id → authorized image; optional ?download=1
- PATCH /api/preferences {theme,language} → {user}
- GET /api/admin/overview → {users:User[],invites:Invite[],models:Model[],events:Event[]}
- POST /api/admin/models {name,filename} → {model}
- PATCH /api/admin/models/:id {enabled,name} → {model}
- POST /api/admin/invites {count,expiresInDays:null|number} → {invites}; Invite {id,code,createdAt,expiresAt,usedAt,usedBy}
- PATCH /api/admin/users/:id {disabled:boolean} → {user}; 禁止停用自己
- Event {id,username,action,createdAt,detail}; user overview additional lastLoginAt,generationCount

## 验证
原生测试覆盖邀请码一次性/过期、权限隔离、登录、工作流参数映射、队列保存及重启恢复。真实 ComfyUI 做一次小尺寸生成，验证图片落盘及刷新。Safari 检查登录、生成、进阶、历史、设置、管理员及窄屏。
