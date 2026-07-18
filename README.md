# Pi RUNNER

Pi RUNNER 是一个面向 Pi agent sessions 的桌面客户端。它不重新发明一套会话存储，而是读取 Pi 写出的 JSONL session 历史，在桌面端建立一个可查询、可分组、可隐藏的本地展示投影，并为每个会话管理独立的 Pi 运行进程。

当前是 macOS-only 内测 MVP，核心会话工作流已经可用，只交付 Apple Silicon 构建。Intel Mac、Windows 和 Linux 暂不支持。

## 架构

项目分为四层：

```text
electron/        桌面窗口、preload、后端进程管理
backend/         WebSocket 服务、Pi RPC 子进程、session index
shared/          renderer/backend 共用协议和 domain type
src/             Vue renderer UI、composables、组件和展示状态
```

核心数据流：

```text
Pi JSONL sessions
  -> backend/sessions/sessionJsonlParser.ts
  -> backend/sessions/sessionService.ts
  -> backend/sessions/sessionIndexStore.ts
  -> SQLite projection
  -> WebSocket protocol
  -> Vue renderer
```

运行时事件流：

```text
renderer command / image prompt
  -> backend/client/clientMessageDispatcher.ts
  -> backend/pi/index.ts
  -> PiRunnerManager
     (sessionPath -> live runner, conversationId -> 当前附着视图)
  -> PiProcessRunner
  -> pi:* event with conversationId
  -> useBackendEvents
  -> per-conversation messages/runtime
```

Pi 子进程按需启动。Backend 会等到真实 `spawn` 和 runtime writer 登记后才确认启动；prompt/abort 必须收到 Pi RPC ACK 才提交运行状态。终止时先 TERM 并等待 `close`，超时后验证并清理进程树，确认死亡前不会释放 session lock。执行中的 runner 不会因为切换会话而关闭；最多同时运行 4 个 active runner，进入 idle 后当前会话保留 30 分钟、后台会话保留 10 分钟，并最多保留 3 个 idle runner。自动回收不会删除或隐藏会话。

macOS 从 Finder 启动时，Backend 会读取并缓存用户交互式登录 shell 的环境；Pi 检测、版本探测和 runner 启动共用同一份 `PATH`。应用不会枚举或混用 NVM 中的多个 Node 版本，Electron 的 `ELECTRON_RUN_AS_NODE` 也不会传给外部 Pi 进程。通过设置页安装 Pi 成功后会刷新该环境缓存。

应用同时保留 Dock 与 macOS 菜单栏入口，并通过 macOS 单实例锁避免启动第二套 backend。关闭主窗口或按 `Cmd+W` 只隐藏窗口，backend 和 Pi 任务继续运行；从 Dock 或菜单栏可以恢复窗口。只有 `Cmd+Q` 或菜单中的显式退出才结束应用，有进行中任务或任务状态未知时会先说明退出影响。Electron 会等待 backend 清理，异常退出时先收敛旧 process group 再重启。

主窗口顶部和菜单栏都可以唤起独立桌面宠物。宠物窗口透明、置顶，宠物本体、气泡、关闭按钮或透明区域都可以直接拖动，短点击仍保留说话和隐藏行为，首次显示不抢焦点；黄绿色的滑稽像素怪球拥有一大一小的眼睛、歪嘴、腮红和小耳朵，会在敲代码、休息、思考、散步四种表情间随机切换并显示短台词。只有散步状态会移动窗口：Electron main 每次随机选择方向，让宠物沿当前显示器底部从一边走到另一边，用户聚焦或拖动后暂停 5 秒。主窗口和宠物窗口使用各自的窄 preload，主进程同时按发送窗口和 renderer URL 校验 IPC；宠物宿主不连接 backend，也拿不到工作区或任务状态 API。

消息中的 `http:` / `https:` 链接可以正常点击，并始终由系统默认浏览器打开，Electron 窗口不会导航到外部页面。其他协议和无效 URL 会被拒绝。

两个窗口共用同一个 renderer 构建入口：默认加载主应用，`?window=pet` 加载宠物宿主。`src/features/desktop-pet/core` 与 `components` 不依赖 Electron，可直接在普通 Vue 应用中使用；只有 `host/PetWindowApp.vue` 知道桌面 preload API。

设置页通过同一条 WebSocket 连接访问 backend。Renderer 只发送设置意图，backend 负责检查 `pi` 命令、执行 macOS 安装命令、读取和保存 `~/.pi/agent/settings.json` 与 `~/.pi/agent/models.json`，并优先通过 Pi 自身的 `DefaultResourceLoader.getSkills()` 读取 skills；列表行内操作可以直接打开 skill 所在文件夹。安装 shell 同样属于受管进程，backend 退出时会等待其进程树结束。

配置保存会先校验 JSON，再通过同目录临时文件原子替换，避免写入中断损坏现有文件；设置读取、保存和安装请求互斥执行，避免两个 snapshot 交叉覆盖草稿，保存期间继续输入的新内容也会保留；“保存并返回”会共同校验并暂存两份配置，提交失败时恢复原文件。设置页存在未保存草稿时不会刷新覆盖，返回会提供继续编辑、放弃修改或保存并返回。Pi 一键安装会在执行官方脚本前展示确认。Backend 断连时，创建会话和刷新历史动作统一禁用，进行中的刷新和设置请求锁会被取消，设置草稿仍保留供重连后重试；尚未完成的连接 URL 请求会随页面卸载失效，不会在关闭后重建 WebSocket。设置页在没有可信快照时显示连接不可用，不会把未知状态误报为 Pi 未安装或空配置。

会话同步遇到尚未完整写入的 JSONL 最后一行时会保留上一版 SQLite 投影并等待下次重试，不会把缺少末尾消息的结果标记为已同步。

输入区支持粘贴或拖拽图片。Renderer 会把图片转成 Pi RPC 兼容的 `ImageContent`，通过 prompt 消息的 `images` 字段交给 Pi；Desktop 同时把图片文件保存到本地数据目录的 `attachments/` 并在 SQLite 里记录消息映射，用于刷新后的桌面回看。待发送图片和用户消息图片都会以缩略图列表展示，点击后由 App shell 中唯一的全屏查看器预览；查看器支持焦点隔离、关闭后焦点恢复、多图切换、位置播报，以及加载失败反馈。该投影不改写 Pi JSONL 历史，也不实现通用文件附件协议。

应用内命令面板可以通过顶部栏搜索按钮或 `Cmd/Ctrl+K` 打开。它只搜索和触发 renderer 已有能力，包括新建会话、开始普通会话、选择工作区、刷新历史、打开设置，以及按标题、工作区路径或运行状态切换已有会话；它不新增 Pi RPC 命令，也不改写 Pi 会话历史。

新建但尚未发送的会话会在列表中标记为“草稿”，只保存在当前窗口；发送第一条消息后才会持久化。导出会话后会通过通知显示实际下载文件名。

侧边栏会话支持标准键盘操作：使用 `Tab` / `Shift+Tab` 在会话与行内菜单间移动，使用 `Enter` / `Space` 选择会话或打开菜单。

消息列表会在当前 runner 仍在运行或最后一条 assistant 消息仍在流式输出时，在底部显示轻量状态，提示 Pi 仍在工作。该状态只消费现有 runner snapshot 和消息状态，不新增后端协议。Backend 短暂断连不会立即破坏 active turn；重连后的完整 runner 列表会结束 backend 已不再持有的旧流式消息，避免重启后残留虚假的工作状态。

产品上下文、MVP 边界和交互原则见 [PRODUCT.md](./PRODUCT.md)。更详细的 sessions、SQLite 投影和多进程 runner 设计见 [DESIGN.md](./DESIGN.md)。

## 会话导出

侧边栏的会话导出会生成面向阅读的 Markdown 文件。导出内容只包含正常对话文本，不包含 thinking、工具调用、工具输出、turn 元数据或 Pi JSONL 内部字段；它不是 Pi 历史的备份格式。

## 数据位置

Pi 的真实 session 历史默认读取：

```text
~/.pi/agent/sessions
```

Pi 的模型配置默认读取和保存：

```text
~/.pi/agent/models.json
```

Pi 的 agent 设置默认读取和保存：

```text
~/.pi/agent/settings.json
```

设置页的一键安装命令仅面向 macOS：

```bash
installer=$(curl -fsSL https://pi.dev/install.sh) && test -n "$installer" && printf "%s\n" "$installer" | sh
```

桌面端自己的 SQLite 投影默认写入：

```text
~/pi.runner/data/session-index.sqlite
```

桌面端图片输入投影默认写入：

```text
~/pi.runner/data/attachments
```

进程 runtime lock 和不含 prompt/模型输出的生命周期诊断默认写入：

```text
~/pi.runner/data/runtime/session-locks
~/pi.runner/data/runtime/process-lifecycle.jsonl
~/pi.runner/data/runtime/backend-supervisor.jsonl
```

可用环境变量覆盖：

- `PI_DESKTOP_SOURCE_SESSIONS_DIR`：Pi JSONL sessions 目录
- `PI_DESKTOP_DATA_DIR`：桌面端本地数据目录
- `PI_DESKTOP_BACKEND_PORT`：后端 WebSocket 端口，默认 `47831`
- `PI_DESKTOP_WORKSPACE_CWD`：默认工作区路径

## 开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

开发脚本会先编译后端 TypeScript，再启动 Vite/Electron 开发流程。

## 测试和构建

运行测试：

```bash
npm test
```

生产构建：

```bash
npm run build
```

`build` 会自动检查最终产物结构，避免遗留旧构建目录或把测试文件编译进发布包。

完整执行类型检查和测试：

```bash
npm run verify
```

每个 macOS 内测候选版本还应按 [E2E 验收清单](./docs/E2E_ACCEPTANCE.md) 完成打包 App、真实 Pi 进程和用户工作流的人工黑盒验收。

生成未压缩的 macOS App 目录，适合快速验证打包内容：

```bash
npm run package:dir
```

生成 Apple Silicon 的未签名 DMG 和 ZIP：

```bash
npm run package
```

安装包写入 `release/`。当前 MVP 打包流程不包含 Developer ID 签名与 Apple 公证，产物仅用于本地开发和测试分发。

## 目录说明

- `backend/server.ts`：本地 WebSocket 服务入口
- `backend/runtime/createBackendRuntime.ts`：backend store、runner、dispatcher 和事件总线装配
- `backend/client/clientMessageDispatcher.ts`：renderer -> backend 消息分发
- `backend/client/conversationLifecycle.ts`：start/delete workspace 等会话生命周期服务
- `backend/events/bus.ts`：backend 事件统一出口
- `backend/events/subscribers.ts`：backend 事件副作用订阅者
- `backend/events/agentEndSessionSync.ts`：agent 结束后的 session 索引同步副作用
- `backend/settings/settingsService.ts`：Pi 安装状态、模型配置和 Pi loader skills 读取
- `backend/config/paths.ts`：backend 本地数据目录解析
- `backend/pi/index.ts`：Pi 进程管理模块公开入口
- `backend/pi/runnerManager.ts`：按 sessionPath 管理 live Pi runner，并把事件路由到当前附着的 conversationId
- `backend/pi/sessionLeaseRegistry.ts`：维护 sessionPath live writer lease
- `backend/pi/processRunner.ts`：Pi RPC 子进程封装
- `backend/process/processTree.ts` / `processIdentity.ts`：backend 共享的进程树终止与 PID 身份校验
- `backend/pi/lifecycleLog.ts`：脱敏的进程生命周期 JSONL
- `backend/pi/rpcEvents.ts`：Pi RPC JSONL 事件解析和命令序列化
- `backend/sessions/sessionService.ts`：backend 外部使用的 sessions facade
- `backend/sessions/sessionIndexStore.ts`：SQLite session projection
- `backend/sessions/sessionJsonlParser.ts`：Pi JSONL session 解析
- `electron/main.ts`：Electron 主进程
- `electron/backendSupervisor.ts` / `processGroup.ts`：backend readiness、重启和 process-group 清理
- `electron/preload.ts` / `electron/petPreload.ts`：分别暴露给主窗口和宠物窗口的最小桌面 API
- `electron/windowManager.ts`：主窗口与桌面宠物窗口的注册表、加载和生命周期
- `electron/windowOptions.ts`：两类窗口的纯配置与初始位置计算
- `shared/protocol.ts`：WebSocket client/backend 协议
- `shared/chat.ts`：聊天和会话 domain type
- `src/App.vue`：应用布局 shell
- `src/main.ts` / `src/windowRoot.ts`：按窗口身份选择主应用或宠物 renderer root
- `src/features/desktop-pet/core/`：与 Vue/Electron 解耦的宠物状态和台词调度
- `src/features/desktop-pet/components/`：可移植的像素球宠物 Vue 组件
- `src/features/desktop-pet/host/`：Electron 宠物窗口宿主适配层
- `src/composables/useAppSessionShell.ts`：renderer 应用状态和依赖装配
- `src/composables/useBackendEvents.ts`：backend event reducer
- `src/composables/backendEvents/`：按事件族拆分的 backend event 局部 reducer
- `src/composables/useConversationLifecycle.ts`：前端会话生命周期交互
- `src/composables/useConversationMessages.ts`：消息流、thinking、tool call 和 segments 时间线
- `src/composables/usePiSettings.ts`：设置页状态和 backend 设置消息
- `src/composables/useWorkspaceViewState.ts`：工作区置顶/折叠的持久状态请求与失败反馈
- `src/components/chat/`：侧边栏、header、输入框、timeline
- `src/components/chat/CommandPalette.vue`：本地命令面板 UI
- `src/components/settings/`：Pi 设置界面
- `src/components/message/`：消息渲染组件
- `src/components/image-viewer/`：无聊天协议依赖的缩略图列表和全屏查看器 UI
- `src/lib/imageViewerState.ts`：应用级单例查看器状态与导航逻辑
- `src/lib/chatImageViewer.ts`：聊天图片协议到查看器展示模型的适配层
- `src/lib/commandPalette.ts`：命令面板命令构建和搜索逻辑
- `src/lib/messageWorkingStatus.ts`：消息列表底部工作状态显示条件
