# Cron 模块与官方实现差异说明

## 对比入口

- 官方入口：
  - [cron.ts](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts)
  - [cron.test.ts](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.test.ts)
- 当前实现：
  - [CronPage.tsx](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx)
  - [cron.css](/Users/chendunqiao/code/openclaw/src/features/cron/components/cron.css)

## 总体结论

- 官方是相对克制的三段式工作区：顶部 `summary strip`、左侧 `jobs + runs`、右侧 `form`。
- 当前实现已经演化成“增强版控制台”，核心功能大体覆盖官方，但页面骨架、交互路径、表单层级、可访问性细节和视觉语言都明显偏离官方。

## 1. 页面骨架差异

- 官方顶部只有一个简洁 `summary strip`，信息只有 `enabled / jobs / nextWake` 加 `Refresh`。
  - 参考 [cron.ts#L394](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L394)
- 当前实现顶部先放了一个完整 `hero toolbar`，里面有 eyebrow、store path、gateway meta、selected scope 和 `Refresh/New Job`，然后下面又放了一层 `summary strip`。
  - 参考 [CronPage.tsx#L1476](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1476)
  - 参考 [CronPage.tsx#L1530](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1530)
- 官方左侧主区域只有 `Jobs` 卡和 `Runs` 卡。
  - 参考 [cron.ts#L427](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L427)
- 当前实现在 `Jobs` 后又插入了 `selected job spotlight` 详情卡，再往下才是 `Runs`，打乱了官方“列表优先”的阅读节奏。
  - 参考 [CronPage.tsx#L1847](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1847)

## 2. Jobs 区差异

- 官方 `job row` 行内动作是：
  - `Edit`
  - `Clone`
  - `Enable / Disable`
  - `Run`
  - `Run if due`
  - `History`
  - `Remove`
  - 参考 [cron.ts#L1490](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L1490)
- 当前实现 `job row` 主要是：
  - `Edit`
  - `Clone`
  - `Enable / Disable`
  - `Run Now`
  - `Delete`
- 当前实现把 `Run Due` 挪到了上方 spotlight，把 `History` 变成“选中行后加载 runs”，动作路径与官方不一致。
  - 参考 [CronPage.tsx#L1530](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1530)
- 官方 job row 更强调 `schedule + payload + state` 三段式信息。
- 当前实现增加了更重的 pill、badge、error 强调和选中态装饰，视觉权重更高。

## 3. Runs 区差异

- 官方 runs 是单列列表，筛选里 `status` 和 `delivery` 使用 `dropdown + checkbox` 组合。
  - 参考 [cron.ts#L585](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L585)
  - 参考 [cron.ts#L625](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L625)
- 当前实现改成了更重的筛选面板，`status` 和 `delivery` 使用 `chip toggle`，并额外展示 `active filter pills`。
  - 参考 [CronPage.tsx#L1939](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1939)
- 官方 run entry 在有 `sessionKey` 时会直接渲染 `Open run chat` 深链，这是测试明确覆盖的行为。
  - 参考 [cron.ts#L1710](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L1710)
  - 参考 [cron.test.ts#L170](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.test.ts#L170)
- 当前实现没有直接跳转 chat session 的入口，只在右侧详情里展示 `sessionId / sessionKey` 文本，这是明确功能缺口。
  - 参考 [CronPage.tsx#L2089](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2089)
- 当前实现额外做了 runs 双栏布局和静态 detail 面板，这不是官方结构。
  - 参考 [CronPage.tsx#L2058](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2058)

## 4. Form 区差异

- 官方 form 主结构是：
  - `Basics`
  - `Schedule`
  - `Execution`
  - `Delivery`
  - 其余高级项折叠进 `Advanced`
  - 参考 [cron.ts#L706](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L706)
  - 参考 [cron.ts#L759](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L759)
  - 参考 [cron.ts#L783](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L783)
  - 参考 [cron.ts#L894](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L894)
  - 参考 [cron.ts#L1016](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L1016)
- 当前实现把很多官方高级项直接平铺到了主表单里，并单独做成 `Failure alerts` 主 section。
  - 参考 [CronPage.tsx#L2190](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2190)
  - 参考 [CronPage.tsx#L2254](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2254)
  - 参考 [CronPage.tsx#L2375](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2375)
  - 参考 [CronPage.tsx#L2476](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2476)
  - 参考 [CronPage.tsx#L2570](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2570)
- 官方有 `clearAgent` 开关，用来显式清空 agent override；当前实现没有这个字段。
- 官方支持 `thinking`、`timezone`、`delivery account` 等 datalist suggestion，并且测试明确要求存在。
  - 参考 [cron.test.ts#L700](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.test.ts#L700)
- 当前实现只有 `agent / model / timezone / delivery-to / account` datalist，没有 `thinking` datalist，而且部分 id 命名也和官方不一致。
  - 参考 [CronPage.tsx#L2724](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2724)

## 5. 校验与可访问性差异

- 官方在 `canSubmit = false` 时，会显示：
  - `Can't add job yet`
  - `Fix N fields to continue`
  - 并把错误字段列成可点击跳转项
  - 参考 [cron.ts#L1337](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.ts#L1337)
  - 参考 [cron.test.ts#L540](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.test.ts#L540)
- 当前实现只有“保存前请先修复 N 个字段”的普通提示，没有字段列表，也没有点击聚焦。
  - 参考 [CronPage.tsx#L2174](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2174)
- 官方为关键字段做了 `aria-invalid`、`aria-describedby` 和固定 error id，这也是测试覆盖项。
  - 参考 [cron.test.ts#L577](/Users/chendunqiao/code/openclaw/upstream/ui/src/ui/views/cron.test.ts#L577)
- 当前实现的 [renderFieldError](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L995) 只是纯文本输出，没有官方那套 aria 绑定和 error id。

## 6. 当前实现额外新增、官方没有的部分

- `Gateway Scheduler` hero toolbar。
  - 参考 [CronPage.tsx#L1476](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1476)
- `Failures` 和 `Runs` 顶部指标卡。
  - 参考 [CronPage.tsx#L1530](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1530)
- `selected job spotlight` 健康/投递/错误专用卡。
  - 参考 [CronPage.tsx#L1847](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L1847)
- `Wake gateway` 卡片。
  - 参考 [CronPage.tsx#L2676](/Users/chendunqiao/code/openclaw/src/features/cron/components/CronPage.tsx#L2676)
- 更重的 empty state、pill、spotlight、subpanel 体系。
  - 参考 [cron.css](/Users/chendunqiao/code/openclaw/src/features/cron/components/cron.css)

## 7. 样式差异

- 官方 `cron` 没有单独的模块级皮肤文件，主要复用通用 `.card / .filters / .list / .field / .chip` 体系，整体很克制。
- 当前实现有完整独立皮肤 [cron.css](/Users/chendunqiao/code/openclaw/src/features/cron/components/cron.css)，包含：
  - 渐变背景
  - hero toolbar
  - metric cards
  - pill rows
  - split panels
  - spotlight cards
- 视觉上明显比官方更“控制台化”。

## 8. 已对齐的部分

- 当前实现已经覆盖官方最核心的功能域：
  - jobs 列表
  - runs 列表
  - 分页加载
  - 三种 schedule 模式
  - 两种 payload 模式
  - 三种 delivery 模式
  - failure alert 配置
- 当前实现也保留了官方的大致主 section 划分，说明问题不是“功能缺失”，而是“结构偏、样式重、若干行为细节没对齐”。

## 9. 最值得优先修的差异

1. 补回官方明确行为：
   - `Run if due`
   - run chat deep link
   - `thinking` datalist
   - `clearAgent`
   - aria / error-id 绑定
2. 收页面骨架：
   - 去掉或弱化 hero toolbar
   - 去掉或弱化 selected job spotlight
   - 去掉或弱化 wake gateway 卡
   - 拉回官方三段式
3. 收 form 层级：
   - 把高级项重新塞回 `Advanced`
   - 不要全部平铺
4. 收样式语言：
   - 从 [cron.css](/Users/chendunqiao/code/openclaw/src/features/cron/components/cron.css) 的定制控制台风格
   - 压回官方共享 card / list / filter 风格
