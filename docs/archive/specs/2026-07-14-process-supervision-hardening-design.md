# Pi 进程监督与崩溃恢复设计

**日期：** 2026-07-14  
**状态：** 已完成  
**范围：** macOS-only MVP，Electron main、backend supervisor、Pi RPC runner 与 session 写入所有权

## 背景

当前实现已经把 Renderer 状态、backend runner 表和 Pi RPC 子进程分层，但终止路径仍把“已发送信号”当成“进程已经死亡”。`ChildProcess.kill()` 成功只表示内核接受了信号，不表示目标已经退出；如果此时删除 runner record 或释放 session lease，新的 Pi 进程可能与旧进程同时写入同一个 JSONL。

Backend 和 lease 都是内存状态。Backend 被强制终止、Electron 崩溃或第二个应用实例启动时，新的 backend 无法仅凭内存判断是否存在遗留 Pi。MVP 需要在不把进程状态复制到 Renderer 的前提下，增加 OS 级监督和可恢复的外部所有权记录。

## 目标

1. 同一个 canonical `sessionPath` 在任何可确认状态下最多只有一个 live writer。
2. 只有收到子进程 `close`，或验证目标 PID 已不存在后，才能释放 session 所有权。
3. 正常退出优先让 Pi 处理 `SIGTERM` 并清理它创建的工具进程；超时后才强制终止整棵已发现的后代树。
4. Backend 异常退出后，Electron 必须先清理旧 backend process group，再启动新 backend。
5. Prompt 和 abort 的状态变更以 Pi RPC response 为准，不以 `stdin.write()` 返回为准。
6. 第二个桌面应用实例不得启动第二套 backend。
7. 对无法确认身份的遗留进程 fail closed：保留锁并向用户报告，不按 PID 猜测性强杀。
8. 生命周期诊断跨 backend 重启保留，但不记录 prompt、模型输出或环境变量等敏感内容。

## 非目标

- 本轮不支持 Windows 和 Linux。Windows 后续应使用 Job Object，Linux 后续应使用 cgroup/systemd scope 或等价 supervisor。
- 不保证清理由任务主动 daemonize、切换用户或脱离所有已知进程关系的外部 daemon。
- 不把 runner 迁移到 Renderer，也不让 Renderer 持有 PID、PGID 或 session lock。
- 不因单次心跳超时自动强杀正在工作的 agent；健康检测与终止决策分离。

## 必须保持的不变量

### 进程终止

- `signalSent === true` 不等于 `terminal === true`。
- `PiProcessRunner.terminate()` 必须是异步操作，并返回 `graceful`、`forced` 或 `already-exited` 结果。
- TERM 超时后，在根进程仍可识别时枚举后代，按叶到根顺序发送 KILL，并等待根进程 `close`。
- 强杀后仍检测到存活 PID 时，runner 进入 `termination_failed`；Manager 不得删除 record 或释放 session lock。
- `start()` 替换已有进程前必须等待旧进程完成终止，不能重叠启动。

### Session 所有权

- 内存 lease 负责同一 backend 内的快速判重；runtime lock 负责跨 backend/应用实例的最终判重。
- `sessionPath` 对已存在文件使用 `realpath` 收敛软链接；新文件使用 canonical parent realpath 加 basename。
- runtime lock 使用原子目录创建，元数据包含 schema version、owner instance、PID、PGID、进程启动标识和 sessionPath。
- runtime lock 不使用短时间 mtime 自动过期。系统睡眠和事件循环暂停不能让另一个 owner 抢锁。
- 只有 owner 正常释放，或启动恢复已确认 owner 进程不存在，才能删除旧锁。

### RPC 命令

- Prompt/abort 写入走统一 pending request 表，必须处理 timeout、进程退出和重复 id。
- `prompt` response 成功后才提交 `running`；失败时恢复提交前 phase。
- `abort` response 成功后才提交 `stopping`；失败时保持 `running`。
- stdin 写入必须观察 callback/error；队列超过上限时明确拒绝，不能无限累积内存。

### Backend supervisor

- Electron 启动 backend 时为它创建独立 process group，且保留 child handle。
- Backend child 的 `error`、`exit`、启动超时和正常退出都必须收敛到同一 supervisor 状态机。
- Restart timer 必须可取消；`isQuitting` 或 intentional stop 后不得再次 spawn。
- Backend 意外退出后，先 TERM 旧 process group，超时再 KILL；cleanup 瞬时失败时保持旧 record 并退避重试，确认旧组消失后才能按退避策略重启。
- 应用使用 `app.requestSingleInstanceLock()`；第二个实例只激活已有主窗口。

## 生命周期

```text
new
  -> starting
  -> idle
  -> running
  -> stopping       # Pi 已确认 abort
  -> terminating    # 正在结束 OS 进程
  -> exited         # close 或确认 PID 不存在
  -> termination_failed
```

`error` 表示 RPC/agent 错误，不再隐含“进程已经死亡”。`termination_failed` 表示进程所有权仍可能存在，必须继续阻止该 session 启动。

## 终止算法

1. 使当前 generation 停止接收新命令，拒绝全部 pending RPC。
2. 在发送任何信号前捕获 root PID、启动标识和当前后代快照，再发送 `SIGTERM`。
3. 等待 `close`，默认宽限 5 秒。Pi 0.80.3 会在 TERM/SIGHUP 中清理其 tracked detached bash children，因此正常路径不做抢先强杀。
4. 超时后枚举仍属于 root 的后代 PID，重新验证 root 身份，按叶到根发送 `SIGKILL`，最后 KILL root。
5. 再等待 2 秒并验证已发现 PID 不存在。
6. 全部消失后返回 `forced`；否则返回失败并保留 runtime lock。

进程枚举参考 VS Code 在 Unix 上使用 `pgrep -P` 递归构造进程树的做法。项目当前只支持 macOS，可以通过 `/bin/ps` 一次读取 PID、PPID、PGID 和启动时间，避免为每个节点启动一个命令。

## 崩溃恢复

Electron main 是 backend 的正常 supervisor。Backend 以独立 process group 运行，Pi 和 installer 默认继承该组。Backend 异常退出时 Electron 对旧 PGID 执行兜底清理；Electron main 本身崩溃时，backend 的 parent watchdog 会发现 PPID 变化，先执行正常 shutdown，再对自身 process group 执行最终强制收敛。Pi 自己创建并登记的 detached bash group 会在收到 TERM 时由 Pi 清理。

Session runtime lock 使用 claim-time 惰性恢复，而不是在应用启动时扫描并猜测性强杀所有登记 PID：

1. 新 backend 对某个 canonical sessionPath 发起 claim 时读取对应 lock。
2. 同时核对 owner/writer 的 PID、启动标识和 command；任一身份不匹配都视为原进程已不存在，不发送信号。
3. owner 与 writer 都明确不存在时删除 stale lock 并重新原子 claim。
4. owner 或 writer 仍存活时拒绝第二个 writer；系统调用失败、元数据损坏、writer 缺失等无法确认状态一律保留锁并 fail closed。

这种取舍避免在恢复扫描中误杀 PID 复用后的无关进程。代价是极端情况下脱离已知 process group 的遗留 writer 不会被自动强杀，而会阻止该 session 再次启动，等待人工诊断。

## 诊断与资源保护

生命周期日志使用 JSONL 追加到 Desktop data dir：`process-lifecycle.jsonl` 记录 runner 的时间、instanceId、conversationId、sessionPath hash、PID、动作、phase、结果和错误类型；`backend-supervisor.jsonl` 记录 backend spawn、ready、group cleanup、restart delay 和错误类型。两者均轮转保留最近文件，不写 prompt、模型输出、完整 stderr、token 或环境变量。

必须显式限制：

- 同时 active runner 数量；
- 单个 stdout JSONL record 字节数；
- 单 runner stdin 待写字节数；
- 单 WebSocket client bufferedAmount；
- backend 连续重启频率。

达到限制时返回结构化错误，不能静默丢事件或自动杀死其他 active runner。

## 测试策略

除现有 mock 单测外，增加 macOS/Unix 真实子进程 fixture：

- 正常 TERM 后退出；
- 忽略 TERM，验证 KILL 升级；
- 创建 detached grandchild，验证后代清理；
- shutdown 与 start 竞态，验证旧 close 前不 spawn；
- prompt/abort success、failure、timeout 和 stdin error；
- backend crash 后旧 process group 清理完成再 restart；
- restart backoff 期间退出不会重新 spawn；
- 第二实例只激活第一实例；
- sessionPath 软链接别名不能取得第二个 lock；
- stale lock、PID 复用和身份不确定的 fail-closed 行为。

## 参考

- Node.js `subprocess.killed`：只表示信号已成功发送，不表示进程已终止。
- Node.js `options.detached`：Unix 下创建新的 process group 和 session。
- Execa termination：优雅取消、超时 KILL 和 descendant cleanup 的分层语义。
- VS Code `cli/src/util/command.rs`：Unix 递归枚举并终止 process tree。
- Electron `app.requestSingleInstanceLock()`：桌面应用单实例入口。

## 完成标准

- 本文所有“不变量”均有实现或自动化测试覆盖。
- 真实 fixture 测试确认 TERM、KILL、detached descendant 和 restart 顺序。
- `npm run verify`、`npm run build`、`npm run check:build-output` 全部通过。
- `DESIGN.md`、`PRODUCT.md`、`README.md` 和 E2E 验收清单与最终行为一致。
- 最终复审不存在会导致重复 session writer、退出后遗留受管进程或永久错误 phase 的已知路径。
