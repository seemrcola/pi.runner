# 桌面宠物与多窗口设计

## 目标

为 Pi RUNNER 增加一个独立的桌面宠物窗口，并把当前单窗口 Electron 外壳改造成职责清楚的多窗口架构。

首个版本需要满足：

- 主窗口可以唤起或再次显示桌面宠物；
- 宠物窗口透明、置顶、不出现在 Dock/任务切换器中，并且可以拖动；
- 宠物是带眼睛和嘴巴的简单马赛克球体，包含敲代码、休息、思考、散步四种可辨识表情；
- 只有散步状态移动窗口，每次随机从宠物当前显示器一边走到另一边，用户操作后短暂停止；
- 宠物会按随机节奏切换动作和说台词；
- 宠物核心模块不依赖 Electron、backend、聊天协议或 `window.piDesktop`，可直接用于普通 Vue 页面；
- 多窗口能力不能改变主窗口关闭即隐藏、backend 常驻和显式退出保护的既有语义。

## 设计参考与取舍

- Electron `BrowserWindow`：每个窗口由主进程拥有，renderer 只表达“显示/隐藏宠物”的意图。这样符合 Electron 的进程模型，也避免 renderer 保存失效的窗口引用。
- Electron 安全清单：继续启用 `contextIsolation`、禁用 `nodeIntegration`，只通过 preload 暴露无任意参数执行能力的窄 API。
- macOS 工具面板交互：宠物窗口采用无标题栏、置顶、跳过任务切换器的轻量浮动面板语义；首次显示不抢主窗口焦点，整个窗口表面都可直接拖动。
- Vue 官方组件模型：宠物视觉组件只通过 props、events 和纯 TypeScript controller 交互。Electron 宿主只是一个组合层，不进入组件内部。
- 参考 VS Code 等成熟 Electron 应用的窗口所有权原则：窗口创建、恢复、销毁和 sender 生命周期由主进程统一管理，窗口内页面不自行 `window.open`。

上述参考决定了本 MVP 不引入通用路由器、跨窗口状态总线或可配置窗口框架。当前只有两个固定窗口，直接的窗口注册表更容易检查和删除。

## 总体架构

```text
main window renderer
  -> window.piDesktop.showPet()
  -> preload narrow IPC
  -> Electron window manager
  -> create/show pet BrowserWindow
  -> same renderer entry, ?window=pet
  -> PetWindowApp (Electron host adapter)
  -> DesktopPet (portable Vue component)
  -> petDirector + pixel sprites (portable TypeScript/data)
```

窗口与宠物模块采用单向依赖：

```text
electron/*
  -> 只管理 BrowserWindow 与 IPC

src/windowRoot.ts
  -> 只选择 main 或 pet renderer root

src/features/desktop-pet/host/*
  -> 只可以调用 window.piPet

src/features/desktop-pet/core/*
src/features/desktop-pet/components/*
  -> 不允许依赖 Electron、backend、shared/chat 或应用 shell
```

## 文件结构

```text
electron/
  main.ts                         应用生命周期、backend 与 IPC 装配
  preload.ts                      主窗口 API
  petPreload.ts                   宠物窗口最小 API
  windowManager.ts                main/pet 窗口注册表和生命周期
  windowOptions.ts                两类 BrowserWindow 配置的纯函数

src/
  main.ts                         读取窗口身份并挂载对应 root
  windowRoot.ts                   解析受支持的窗口类型
  App.vue                         既有主窗口 shell
  features/desktop-pet/
    core/
      petDirector.ts              动作/台词调度，无 Vue/Electron 依赖
      petTypes.ts                 公共状态与配置类型
    components/
      DesktopPet.vue              可复用宠物组件
      PixelPetOrb.vue             纯代码像素球与表情渲染
    host/
      PetWindowApp.vue            Electron 宠物窗口组合层
    index.ts                      可移植模块公共出口

tests/
  electron/windowManager.test.ts  多窗口配置与生命周期边界
  src/desktopPet.test.ts          随机调度、台词与状态行为
  src/windowRoot.test.ts          renderer 入口选择
```

`host/` 是唯一允许知道 `window.piPet` 的宠物目录。未来要把宠物发布为独立包时，只需要移动 `core/`、`components/` 和 `index.ts`。

## 多窗口设计

### 窗口身份

继续使用一个 Vite HTML 入口，避免为两个窗口复制构建配置。主进程加载：

- 主窗口：`index.html`
- 宠物窗口：`index.html?window=pet`

renderer 入口只接受白名单值 `main | pet`，未知值回退到 `main`。生产环境通过 `loadFile(..., { query })` 设置查询参数，开发环境通过标准 `URL` API 生成地址，避免手工拼接和编码错误。

### 窗口注册表

主进程维护固定的 `mainWindow` 与 `petWindow` 引用，并提供：

- `showMainWindow()`：不存在则创建，最小化则恢复，然后显示并聚焦；
- `showPetWindow()`：不存在则创建，存在则显示；首次显示使用 `showInactive()`，不打断编码焦点；
- `hidePetWindow()`：只隐藏，不销毁；
- `getMainWindow()`：只供需要 modal parent 的主进程能力使用。

主窗口 close 仍然被拦截并转为 hide。宠物窗口没有独立任务所有权，隐藏或销毁都不能影响 backend 与会话。

### 宠物窗口配置

- `160 x 160` 固定逻辑尺寸，保证像素球和台词气泡不因内容变化跳动；
- `frame: false`、`transparent: true`、`backgroundColor: '#00000000'`；
- `resizable: false`、`maximizable: false`、`fullscreenable: false`；
- `alwaysOnTop: true`、`skipTaskbar: true`；
- 独立的最小权限 pet preload，与主窗口相同的安全选项和图标策略；
- 首次放置在主屏幕 work area 的左下角，保留 16px 屏幕边距；
- renderer 根节点监听 Pointer Events，窗口内所有可见或透明区域都能作为拖拽起点；
- 按下时由原始表面自身取得 pointer capture，短点击仍以原按钮为 click target；移动超过 3px 后才开始拖拽，拖拽后的合成 click 会被根节点拦截；
- 主进程限制单次增量，并把最终位置约束在最近显示器 work area 内，异常 IPC 不能把窗口移出所有屏幕。

拖拽只在 Electron 宿主层实现，不进入可移植视觉组件 API。Renderer 只通过 pet preload 上报开始意图和单次指针增量，绝对窗口坐标与 `BrowserWindow` 移动仍由主进程持有。

### IPC 合同

主窗口 preload 新增显示意图：

```ts
showPet(): void
```

宠物窗口使用独立 `petPreload`：

```ts
beginDrag(): void
dragBy(deltaX: number, deltaY: number): void
hide(): void
updateState(state: PetState): void
```

分别对应 `pet:show`、`pet:drag-start`、`pet:drag-move`、`pet:hide` 和 `pet:update-state` 单向消息。主进程按 `webContents` 限制 `show` 只能来自主窗口，其余消息只能来自宠物窗口，并继续对状态和拖拽增量做运行时校验；增量必须是有限数值，取整后仍须为安全整数且处于上限内，目标位置再按显示器 work area 收口。宠物 preload 不暴露 backend token、工作区、任务摘要、窗口坐标、BrowserWindow id 或通用 invoke。

## 宠物模块设计

### 视觉语言

宠物采用代码原生像素球，不使用带背景的插画或运行时图片服务：

- 粗深色像素轮廓、黄绿色身体、浅黄高光、粉色耳心与腮红；
- 表情由一大一小两只白眼睛、歪嘴、小耳朵和状态信号组成；
- 敲代码使用睁眼与青绿色信号，休息使用闭眼与 `Z` 信号，思考使用不对称眼睛、圆嘴与琥珀色信号，散步使用笑脸与蓝色方向信号；
- 只有散步状态让球体外壳使用 `steps()` 旋转，保持马赛克边缘清晰；
- 不使用模糊、插值缩放、装饰性渐变或大面积单色背景。

`PixelPetOrb.vue` 只负责球体与表情，窗口移动和 Electron 生命周期留在 `windowManager.ts`，替换视觉不会改状态机或窗口协议。

### 行为状态机

状态集合固定为：

```ts
type PetState = 'coding' | 'resting' | 'thinking' | 'walking'
```

默认行为：

- 启动后立即进入 `resting` 并显示一条该状态台词；
- 每 8-15 秒切换一次状态，不连续选择相同状态；
- 每 6-12 秒说一句当前状态台词；
- 状态变化时立刻换一条对应台词；
- 台词显示 4 秒后淡出，但动作继续；
- 点击宠物时立即触发一条当前状态台词。

只有进入 `walking` 才通知主进程开始移动。主进程每次随机选择方向，将窗口放到对应边缘后每 50ms 前进 10px，抵达另一侧即停止。离开 `walking`、隐藏或销毁窗口会停止 interval，用户聚焦或拖动窗口后暂停 5 秒。

`petDirector` 接受可注入的 `random`、`setTimeout` 和 `clearTimeout`，测试可以使用假时钟和固定随机数，不依赖真实时间。

### 默认台词

台词短、与开发工作相关、不过度打断用户。例如：

- 敲代码：“这段我盯着呢。”“再跑一次测试？”“键盘有点热了。”
- 休息：“先让脑子缓存一下。”“我只眯一小会儿。”“后台任务还在跑。”
- 思考：“这个边界值得再看一眼。”“让我理一下依赖。”“也许可以更简单。”
- 散步：“出去转一圈。”“活动一下再回来。”“换个方向看看。”

使用方可以通过 props 覆盖每个状态的台词集合；空集合会回退到默认值，避免调度器产生 `undefined`。

### 可复用组件 API

```ts
type DesktopPetProps = {
  initialState?: PetState
  dialogue?: Partial<Record<PetState, readonly string[]>>
  autoStart?: boolean
}

type DesktopPetEvents = {
  'state-change': [state: PetState]
  speak: [line: string]
  'request-close': []
}
```

组件不假设自己位于透明窗口，也不自行关闭页面。Electron 宿主监听 `request-close` 并调用 `window.piPet.hide()`；普通网页可以把该事件映射到删除组件、隐藏浮层或其他行为。

## 主窗口入口

在 `ChatHeader` 的搜索与设置之间加入宠物图标按钮：

- 使用 Lucide `Dog` 图标；
- tooltip 与 `aria-label` 为“显示桌面宠物”；
- 不依赖 backend 连接状态，因为宠物由本地 Electron 主进程管理；
- 点击只触发 `showPet`，不在 App shell 保存“是否打开”的副本状态。

浏览器开发模式没有 preload 时，入口保持可见但安全降级为无操作；测试环境可以通过 mock `window.piDesktop` 验证事件。

## 可访问性与交互约束

- 关闭按钮可通过键盘聚焦，具备 tooltip 与 `aria-label`；
- 台词气泡使用 `aria-live="polite"`，不会打断屏幕阅读器当前播报；
- 动作只改变 transform/opacity，不引起窗口尺寸变化；
- `prefers-reduced-motion` 下停用跳动和帧动画，但保留状态姿态；
- 全部文本限制在气泡宽度内，中文自然换行，最长台词不会覆盖宠物；
- 宠物窗口首次显示不夺取主窗口输入焦点。

## 测试与验收

自动验证：

- window options 覆盖透明、置顶、固定尺寸和安全 webPreferences；
- window manager 覆盖单例创建、重复 show、hide、closed 后重建和主窗口 close -> hide；
- renderer route 覆盖 main、pet 和未知值；
- pet director 覆盖不重复状态、台词来源、计时器清理和固定随机源；
- 组件测试覆盖四个状态都能渲染、点击说话和关闭事件；
- `npm run typecheck`、相关 Vitest、完整 `npm test`、`npm run build`。

人工/视觉验收：

- 主窗口按钮能创建并再次显示同一个宠物窗口；
- 宠物在透明窗口中没有矩形底色或裁切；
- 四种表情在 100% 和 Retina 缩放下都能辨识；
- 窗口可从宠物、气泡、关闭按钮或透明区域拖动，按钮短点击仍可用且拖动后不会误触；
- 宠物置顶但首次出现不抢走消息输入焦点；
- 随机台词不溢出，动作切换不改变窗口尺寸；
- 关闭主窗口后宠物与 backend 生命周期仍符合既有产品规则。

## 非目标

- 宠物跟随真实 Pi runner 状态；
- 跨启动持久化宠物位置、开关或台词；
- 多只宠物、换装、商店、音效；
- 点击穿透、自由行走或物理碰撞；
- 通用多窗口路由器或跨窗口全局状态同步；
- Windows/Linux 的窗口行为适配。

这些能力都可以在核心模块稳定后增加，但当前 MVP 不提前抽象对应协议。
