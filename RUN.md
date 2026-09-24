# 运行说明 · 3D 探索房间

> 对应 Day 7 交付的第一版可运行 MVP
> 技术栈见 `TECH_DESIGN.md` §2.1：原生 HTML/CSS/JS + Three.js + GSAP + Vite

---

## 一、前置条件

只需要 **Node.js 18 或更高版本**（本项目在 Node 22.22.2 上开发）。

检查是否已装：

```bash
node -v
```

看到 `v22.x.x` 或更高即可。看不到就说明没装，去 https://nodejs.org 下 LTS 版。

**不需要**：数据库、后端服务、任何环境变量。本项目是纯静态的（`TECH_DESIGN.md` §1）。

---

## 二、首次运行（三步）

在项目根目录 `D:\vibe-coding-project` 打开终端：

```bash
# 1. 安装依赖 —— 从 npm 仓库下载 Three.js / Vite 等零件到 node_modules/
npm install

# 2. 如果安装后被提示有 install script 未批准（npm 11 的新策略）
npm install-scripts approve esbuild

# 3. 启动开发服务器
npm run dev
```

**成功后终端会显示**：

```
  VITE v5.4.21  ready in 312 ms

  ➜  Local:   http://localhost:5173/
```

浏览器会自动打开（配置文件里设了 `open: true`）。

**验证成功**：地址栏是 `localhost:5173`，页面上先出现一条进度条，然后淡出露出昏暗的 3D 房间。

---

## 三、三个命令的分工

| 命令 | 用途 | 什么时候用 |
| --- | --- | --- |
| `npm run dev` | 启动开发服务器，改代码保存即自动刷新 | 日常开发 |
| `npm run build` | 打包成静态文件到 `dist/` | 准备上线 |
| `npm run preview` | 本地预览打包结果（先跑 build） | 上线前确认 |

### 关于开发服务器

- **终端不能关**。关了等于关掉服务器，页面就再也打不开（`localhost` 连不上）
- 停止服务：在终端里按 `Ctrl + C`
- 端口被占用时 Vite 会自动换一个（如 5174），以终端显示的地址为准

---

## 四、上线部署

```bash
npm run build
```

产出的 `dist/` 文件夹就是完整的网站：

```
dist/
├── index.html
└── assets/
    ├── index-xxxxxx.css
    └── index-xxxxxx.js
```

把这个文件夹整个上传到任意静态托管（GitHub Pages / Netlify / Vercel 均可），不需要任何服务端配置。

配置里已设 `base: './'`，用相对路径引用资源，因此放在子目录下也能正常访问。

---

## 五、常见问题

### `npm install` 报错「禁止运行脚本」

PowerShell 的执行策略限制。两个办法：

- 改用 Git Bash 执行
- 或在管理员 PowerShell 里执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 启动后页面空白 / 一直停在进度条

1. 按 `F12` 打开控制台，看有没有红字报错
2. 确认 `npm install` 完整跑完过（`node_modules/` 文件夹存在且内容非空）
3. 如果报 `Cannot find module ... esbuild`，执行 `npm install-scripts approve esbuild` 后重启服务

### 页面很暗，几乎看不清

**这是设计如此**，不是故障。`PRD.md` §1.4 设定的氛围是「昏暗但有几处微光的房间」——光是从三件物件上发出来的，不是照明打出来的。房间里能看到的三个发光体就是可点击的物件。

### 鼠标移动时画面轻微偏移

这是 `PRD.md` F1.2 要求的视差感，不是页面抖动。

### 3D 部分在手机上打不开或很卡

**已知未完成项**。`PRD.md` §5.4 的移动端验收（D1–D3）本期未做，属后续迭代。

---

## 六、当前版本的能力边界

`PRD.md` 里的验收标准尚未全部达成。这个 MVP 已完成的部分：

- 房间场景 + 鼠标视差 + 尘埃动效
- 3 件可交互物件，未解锁时自发光并呼吸式明暗起伏
- 悬停时粒子飘散反馈
- 点击打开内容页（淡入淡出过渡，**不是**电影式镜头推进）
- 已解锁与未解锁在视觉上可区分
- 三件全解锁后的收束信号

**尚未完成**（属后续迭代，非本次遗漏）：

| 未完成 | 依据 |
| --- | --- |
| 角色设定稿 → 真实配文 | `PRD.md` §1.5 已知缺口 |
| 真实 3D 模型（现为程序化几何体） | `TECH_DESIGN.md` §5 已知缺口 |
| 电影式镜头推进（现为淡入淡出） | `PRD.md` §6.2 R2 已定「后置」 |
| 内容页滚动视差 | `TECH_DESIGN.md` §2.4 定档为「轻量视差」，本期未实现 |
| 移动端适配与降级 | `PRD.md` §5.4 |
| 加载失败的错误提示与重试入口 | `PRD.md` §5.3 C1 |
| 性能验收（B1 三秒可交互 / B2 帧率） | `PRD.md` §5.2，**未实测** |
