# TXT 批量任务与多用户公平调度

目标：批量 TXT 导入、任务进度、结果和 PNG Grid；历史清除、模型删除、停用用户、限定邀请码期限、单图纵向浏览。

## 固定契约
- batchSize 仅 1/2/4/8，repeat 整数1..32。所有入口/预设统一校验。
- 每行一个 prompt，可选空行分段。UTF-8 BOM/CRLF 支持，去空行，最多128条且总图片<=4096/任务（UI提前展示总量）。重复次数与batch含义不变。
- GET /api/tasks => {tasks:Task[]}; POST /api/tasks {name,text,parseMode:'lines'|'paragraphs',params:<draft>} => {task:Task}。
- Task {id,name,createdAt,status,totalImages,completedImages,failedImages,batches:Batch[]}。批次沿用原结构；新 batch 增加taskId。GET /api/tasks/:id同鉴权。POST /api/tasks/:id/cancel取消尚未提交的片段，运行中单张完成后保留结果，不能interrupt全局Comfy队列。
- Grid在浏览器canvas生成真正PNG，支持列数/标签，每页最多64图且画布不超过16MP，多页逐页下载。图片从鉴权/api/images载入，不新增依赖。
- DELETE /api/history {confirm:true}：仅清除当前用户已终结批次、对应图片和已终结任务；活跃任务存在时409，提示先等完成/取消。不碰账户、预设、模型及其他用户。
- DELETE /api/admin/models/:id {confirm:true}：仅移除网站模型注册，保留已有生成记录的model_name与workflow；先将batches.model_id=NULL再删除，保留历史图片；已有排队workflow照常，不删远端checkpoint。
- 停用用户立即失效现有session，未提交jobs标为cancelled；正在生成的单图可完成并保存。
- 邀请有效期只能1/2/3/5/7或null，前后台同时限制。
- PATCH /api/preferences支持部分更新 theme/language/imageView:'grid'|'single'；保留activePresetId等现有项。

## Scheduler 数据契约（backend拥有迁移）
新增 batches.task_id TEXT，batches.cancel_requested INTEGER DEFAULT0。
新增 tasks(id TEXT PRIMARY KEY,user_id INTEGER,name TEXT,created_at TEXT,params TEXT,cancel_requested INTEGER DEFAULT0)。
新增 generation_jobs(id TEXT PRIMARY KEY,batch_id TEXT,user_id INTEGER,image_index INTEGER,seed INTEGER,status TEXT DEFAULT'queued',workflow TEXT,prompt_id TEXT,submitted INTEGER DEFAULT0,started_at TEXT,retry_count INTEGER DEFAULT0,error TEXT,created_at TEXT, UNIQUE(batch_id,image_index))。
新增 images.job_id TEXT（可空legacy），images.image_index INTEGER DEFAULT0。
新增 scheduler_state(key TEXT PRIMARY KEY,value TEXT)，持久cursor及每轮待服务用户。

Backend在POST生成和tasks事务里创建parent batch + 每张图一个job，workflow中latent.batch_size=1，seed=parent seed+image_index（安全整数回绕）。父batch.params保留逻辑batchSize，images展示按image_index排序，batch.status由worker按jobs聚合。
Worker支持旧数据库：如queued/running parent没有jobs，未提交拆单张；已提交的legacy整个batch建一个job并沿用prompt_id/原workflow，不重复提交。
Worker每次tick先处理已提交running job，再选择用户轮转的新job。单Comfy实例同时只提交一个不可抢占片段，避免把一人全量塞远端。每轮根据等待人数、近期单图耗时EWMA、Comfy队列深度计算用户数，按cursor循环；每用户每轮最多一张，轮满或30s后切换下一组。实际边界为图片完成；每张运行可能超过30s，不承诺硬时限。禁用用户不选取，cancel_requested也不选取。DB重启保留cursor/轮队列。

## 分工与验证
1. Backend: schema、tasks/import、参数统一校验、删除/停用/邀请码/偏好API。tests/tasks-api.test.mjs。
2. Scheduler: server/worker.mjs + tests/scheduler.test.mjs；多用户A1 B1 C1 A2...、大batch不独占、取消、重启不重发、故障隔离。
3. Frontend任务模块: public/tasks.mjs、public/tasks.css；TXT预览/任务列表/拼图真实PNG。
4. Leader: public/app.mjs/views.mjs/admin.mjs/styles.css；设置/删除确认/单图与圆点/批量参数/任务集成。
5. 全测试、UI隔离验证，保留现有数据；不在已有用户数据执行清除/删除。

最新修正：取消固定每轮3用户。roundCapacity=min(等待用户数,max(1,floor(30000/(1+远端队列深度)/单图耗时EWMA)))，每轮及软时间片耗尽时重新计算。游标为最后服务用户ID，未服务用户优先保留。单张超过预算时完成后再让出。
