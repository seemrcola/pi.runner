# macOS 生命周期与任务安全设计

## 目标

Pi RUNNER 当前明确为 macOS only、Apple Silicon 内测产品。窗口、应用和 Pi 任务拥有独立生命周期：关闭窗口只隐藏界面，明确退出才停止应用；运行中的会话或工作区不能从 Desktop 投影移除。

## 移除守卫

- `starting`、`running`、`stopping` 都视为进行中。
- 会话进行中时，“移除”保留在菜单中但禁用，并说明停止后才能移除。
- 工作区内任一会话进行中时，“移除工作区”禁用并显示进行中的任务数量。
- Renderer 在执行入口再次检查，避免组件状态延迟触发乐观移除。
- Backend 以 runner snapshot 为事实来源再次检查；竞态下返回带 `requestId` 的 `pi:error`，不隐藏投影、不关闭 runner。
- 空闲会话和空闲工作区仍可移除，Backend 可同步释放对应 idle runner。

## macOS 应用生命周期

- 首次启动显示主窗口，并同时创建 Dock 与菜单栏入口。
- 红色关闭按钮和 `Cmd+W` 只隐藏主窗口；backend 与所有 Pi runner 保持运行。
- 点击 Dock 图标或菜单栏“显示 Pi RUNNER”恢复并聚焦窗口；窗口意外销毁时重新创建。
- 菜单栏使用 Template 图标，菜单显示任务摘要、“显示 Pi RUNNER”和“退出 Pi RUNNER…”。
- Renderer 仅把 `{ known, activeTaskCount }` 通过窄 IPC 同步给 Electron main；任务事实仍来自 backend runner snapshots。
- 断连时菜单显示“任务状态未知”，不能推断为零任务。

## 退出保护

- 无进行中任务时，`Cmd+Q`、系统菜单和菜单栏退出直接退出。
- 有进行中任务时显示三选项：取消、隐藏窗口、退出并停止任务；默认焦点为取消。
- 状态未知时也确认，并明确“退出可能停止正在执行的任务”。
- 确认退出只执行一次，随后正常停止 backend 和 runners。
- 系统关机/注销不被应用确认阻塞。

## 验证

- Renderer 测试覆盖会话、工作区禁用状态和执行入口守卫。
- Backend 测试覆盖进行中拒绝、空闲允许及竞态错误的 `requestId`。
- Electron 纯函数测试覆盖菜单摘要、退出提示和退出决策；源码契约测试覆盖隐藏窗口、Tray 与 IPC 装配。
- 完整执行类型检查、测试、生产构建、构建产物检查和 macOS 打包目录验证。
