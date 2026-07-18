# 架构复审收口设计

## 目标

在保留现有 `electron / backend / shared / src` 四层模型的前提下，修复本轮架构复审中已经证实的稳定性、协议边界和文件所有权问题。

本轮只处理架构。产品交互和视觉设计在架构复审再次通过后单独评审。

## 已确认基线

- Pi JSONL 是会话历史事实来源，SQLite 是可重建的桌面投影。
- `backend/pi/index.ts` 是 Pi 进程管理公开入口。
- `PiRunnerManager` 拥有 runner 生命周期、session lease、前后台身份和 idle 回收状态。
- Renderer 只维护界面瞬态状态，不复制 backend 进程状态机。
- 当前源码依赖图无循环，类型检查和现有测试通过。

这些边界继续保留。本轮不重写 runner，不拆分仍然职责集中的 `sessionIndexStore.ts` 和 `runnerManager.ts`，也不引入通用事件框架。

## 整改设计

### 1. 隔离 agent-end 投影同步失败

`pi:agent_end` 后的 JSONL/SQLite 同步是可恢复的桌面投影副作用。读取或写入失败不得穿透 Pi stdout 事件回调，也不得终止 backend 进程。

订阅者捕获同步异常，并通过现有 `pi:error` 事件返回 `conversationId` 和可读错误。原有会话、runner 和 SQLite 内容保持不变，用户可以稍后手动刷新重试。

### 2. 收紧 backend 事件类型

跨进程公开事件统一使用 `BackendMessage`。client dispatcher、事件总线、transport subscriber 和 agent-end 同步副作用不得继续使用 `Record<string, unknown>` 作为公开输出类型。

Pi RPC 解析结果仍是 manager 内部事件，使用独立的 `PiRpcEvent` union。`PiRunnerManager` 添加当前 `conversationId` 后，事件才成为可发送的 `BackendMessage`。这样保留内部事件没有会话身份、公开事件必须有会话身份的真实边界。

### 3. 完整校验 Conversation

`conversations:list` 不能只验证数组元素是对象。为 `Conversation` 及其嵌套消息、回合、图片、工具和时间线片段建立完整 schema，并从 schema 推导 TypeScript domain 类型，消除手写类型与运行时校验的双份来源。

Schema 保持 strict；持久化 JSON 中的未知或损坏结构不能进入 renderer reducer。

### 4. 统一回合分组

`sessionJsonlParser` 和 SQLite projector 统一调用 `backend/sessions/turnGrouping.ts` 的 `buildAgentTurns`。删除 parser 内的重复实现，确保首次解析与投影回读使用同一规则。

### 5. 强化目录与架构守卫

将 renderer 私有的 `src/shared/workspaceNames.ts` 移到 `src/lib/workspaceNames.ts`，避免它与顶层跨进程 `shared/` 形成两个含义不同的 shared 目录。

架构测试递归扫描全部 `backend/**/*.ts`，禁止依赖 renderer `src/`；同时扫描 `backend / electron / shared / src` 的本地 import 图并拒绝依赖环。现有针对关键 facade 和职责拆分的断言继续保留。

## 错误处理

- 无效 client 消息继续返回 `pi:error`，不进入 handler。
- 无效 backend 消息继续在 renderer WebSocket 边界被拒绝。
- agent-end 投影同步失败只报告错误，不回滚已经完成的 Pi 任务，不修改 runner 生命周期。
- 完整 Conversation 校验失败时，整条 `conversations:list` 被拒绝，避免 renderer 接收半可信状态。

## 测试与验收

每项修复先添加失败测试，再实现最小改动：

1. 同步异常不会从 subscriber 抛出，并产生带 `conversationId` 的 `pi:error`。
2. backend 输出链使用 `BackendMessage`，错误事件形状在编译期失败。
3. 缺少字段、嵌套消息损坏或包含未知字段的 Conversation 被拒绝；合法历史可通过。
4. parser 与 projector 的回合分组结果一致。
5. 新增 backend 文件越层依赖或任意源码依赖环会让架构测试失败。

最终运行 `npm run typecheck`、`npm test`、`npm run build` 和依赖环扫描，并再次执行完整架构复审。只有没有新的明确架构问题时，才进入产品复审。

## 文档影响

实现时同步更新 `DESIGN.md` 中协议校验、backend 事件出口和同步失败语义。`README.md` 只在运行方式或用户可见行为变化时更新；本轮预计无需修改 `PRODUCT.md`。
