# 天线覆盖绘图平台

基于 MATLAB 仿真结果的一站式出图平台:添加结果文件夹后自动识别其中可绘制的数据类型与高度层,
在网页上勾选即可调用 MATLAB 出图,支持单张下载、整包导出与多结果横向对比。

后端实际绘图仍然使用仓库根目录下原有的 `showrsrp_*.m` 脚本,出图风格与手动运行完全一致
(同样的数值范围、色标、建筑物与基站叠加)。

---

## 一、快速开始

1. 双击 **`启动平台.bat`**
   - 首次运行会自动安装依赖并构建前端(需要 Node.js,约 1~3 分钟);
   - 随后自动启动服务并打开浏览器,地址 `http://127.0.0.1:8000`。
2. 在页面左上角点「**添加**」,选择跑完仿真的**结果文件夹**(例如 `D:\workspace\antenna-draw\kokin_tg`)。
3. 在数据源卡片中选择「数据类型」与「高度层」,点「**开始绘图**」。
4. 关闭启动窗口不影响使用;需要停止服务时双击 **`停止平台.bat`**。

> 平台服务常驻在后台,重启电脑后需要重新双击 `启动平台.bat`。

---

## 二、对结果文件夹的要求

选择的文件夹需包含 `pred\0\index.txt`,典型结构:

```
<结果文件夹>\
├─ pred\
│  └─ 0\
│     ├─ index.txt          # 首行 UTM 分区,其余每行:文件名.dem 左 右 下 上 分辨率
│     ├─ RSRP.dem           # 地面层数据(-32768 为无效值)
│     ├─ building1          # 可选:建筑物轮廓
│     ├─ cells1.txt         # 可选:基站位置
│     ├─ 10m\RSRP.dem       # 各高度层(文件夹名即高度层名)
│     ├─ 20m\RSRP.dem
│     └─ ...
├─ rays\  features\  addition\ ...   # 其他产出目录,平台不使用
```

平台通过重建 `index.txt` + 扫描子文件夹自动识别:

- **数据类型**:`RSRP.dem`、`SCR.dem`、`ECHORP.dem`、`DLRSSINR.dem`、`BESTSERVER.dem` 等,
  有对应绘图脚本的会标为「可绘图」,没有脚本的类型会显示但不可选;
- **高度层**:凡存在同名 `.dem` 的子文件夹都算一个高度层,`pred\0` 根目录下的数据记为「地面」。

## 三、两种类型的数据差异(已内置)

| 类型 | 含义 | 显示范围 | 备注 |
|---|---|---|---|
| RSRP | 参考信号接收功率 | -120 ~ -40 dBm | 数值需 ÷100 |
| SCR | 信杂比 | -30 ~ 15 dB | 数值需 ÷100 |
| ECHORP | 回波接收功率 | -180 ~ -110 dBm | 数值需 ÷100 |
| DLRSSINR | 下行 RS-SINR | -10 ~ 30 dB | 数值需 ÷100 |
| BESTSERVER | 最佳服务小区 | 自动 | 存的是小区编号,不除以 100 |

如需调整显示范围或新增类型,改 `showrsrp_*.m` 中的 `*Lims` 变量,并在
`platform/backend/src/plotTypes.js` 与 `platform/matlab/plot_dispatch.m` 中登记新类型即可。

---

## 四、功能说明

### 1. 画图展示页

- **多数据源分区展示**:每个结果文件夹是一张独立卡片(左侧蓝色竖条 + 源名 + 完整路径),
  卡片之间互不混淆;
- **自动识别**:卡片上直接显示识别到的类型与层数,只列出该源实际存在的数据;
- **高度层集中展示**:同一数据源选中的所有高度层在同一网格中平铺,每张图标注「数据类型 · 高度层」;
- **图片自带标注**:每张图内部烧录标题,形如 `RSRP (dBm) @ 10m · kokin_tg`,导出后单独看也能分辨类型、高度层与来源;
- **导出**:单张下载(文件名带源名/类型/层)、卡片级「导出全部」打包 zip,
  zip 内按 `<源名>/<数据类型>/<高度层>.png` 组织;
- **缓存**:已生成过的图会记录在 `platform/backend/data/cache` 下,
  再次打开或切换类型时秒级显示(不会重复启动 MATLAB);
  `.dem` 文件被重新仿真覆盖后(mtime/大小变化)会自动重新绘图;
- **放大预览**:点图卡右上角放大镜可看大图。

### 2. 结果对比页

- 选择 **2 个及以上**数据源 + 一个**共同的数据类型**,按高度层自动对齐:
  **行 = 高度层(由低到高),列 = 数据源**,同一类型共用同一套数值范围与色标,可直接横向比较;
- 高度层默认取各源的**交集**(保证每格都有数据);勾选「含部分源缺失的层」后按并集展开,
  缺数据的格子显示「该数据源无此高度层数据」;
- 各源类型无交集时会明确提示,不会出现无意义的空表;
- 点「生成对比图」时,所有格子合并为**一次 MATLAB 调用**完成(22 张图也只启动一次 MATLAB);
- 支持整页打包导出。

---

## 五、目录结构

```
platform/
├─ 启动平台.bat / 停止平台.bat   # 一键启动 / 停止
├─ matlab/
│  └─ plot_dispatch.m            # MATLAB 批量绘图调度(调用根目录 showrsrp_*.m)
├─ backend/                      # Node.js + Express,端口 8000
│  ├─ config.json                # ← MATLAB 路径、端口、并发数(可修改)
│  ├─ server.js
│  ├─ src/                       # scanner / matlabRunner / jobQueue / cache / exporter / routes
│  ├─ scripts/                   # 开发自检脚本(node scripts/dev-check.js)
│  └─ data/                      # 运行时:数据源注册表、图片缓存、导出 zip
└─ frontend/                     # Vue 3 + Element Plus + Vite
   ├─ src/views/PlotView.vue     # 画图展示页
   ├─ src/views/CompareView.vue  # 结果对比页
   └─ src/components/            # 数据源卡片 / 图卡 / 文件夹选择器
```

## 六、配置

### 6.1 后端配置 `platform/backend/config.json`

该文件含**本机 MATLAB 路径**,默认不入库(`.gitignore` 已排除);仓库里提供的是模板
`platform/backend/config.example.json`。新环境按需复制:

```bash
cd platform/backend
copy config.example.json config.json   # 然后按需修改
```

不创建 `config.json` 也能启动(使用内置默认值),启动日志会打印当前生效的配置来源:

```json
{ "port": 8000,
  "matlabExe": "D:\\Matlab\\R2022a\\bin\\matlab.exe",
  "maxConcurrentJobs": 1 }
```

| 字段 | 说明 |
|---|---|
| `port` | 服务端口;修改后需同步改 `启动平台.bat` 里的 `PORT` |
| `matlabExe` | MATLAB 可执行文件路径;换版本/换机器时改这里 |
| `maxConcurrentJobs` | 同时运行的 MATLAB 进程数,默认 1,避免多实例抢资源与许可 |

### 6.2 其他配置文件

| 文件 | 作用 |
|---|---|
| `platform/.gitignore` | 排除依赖、构建产物、运行时数据与本机配置 |
| `platform/.gitattributes` | 统一换行:`*.bat` 强制 CRLF(cmd 解析要求),源码与文本 LF,二进制不做处理 |
| `platform/.editorconfig` | 编辑器基础排版约定(UTF-8、缩进、行尾) |
| `platform/backend/config.example.json` | 后端配置模板 |
| `frontend/package.json` `backend/package.json` | 依赖与脚本入口(`npm run dev` / `build` / `start`) |
| `frontend/vite.config.js` | 前端构建与开发代理(`/api` → 8000) |

---

## 七、常见问题

**启动后浏览器打不开 / 页面提示"无法连接后端服务"**
看 `platform/backend/data/backend.log`;常见原因是端口被占用(启动脚本会自动停掉旧实例)。

**点「开始绘图」后长时间停在 0/N**
MATLAB 启动本身约需 10~30 秒,属正常;若最终失败,页面会弹出红色错误信息,
一般是 MATLAB 路径不对、许可不可用或 `.dem` 文件不完整。

**图片中文标题显示成方框**
标题使用「微软雅黑」等中文字体,极端情况下缺失时回退到 SimHei/SimSun;
如仍有问题,可在 `platform/matlab/plot_dispatch.m` 的 `titleFont()` 中指定本机可用字体。

**想重新出图**
删掉 `.dem` 源文件重新仿真后平台会自动重画;也可直接删除
`platform/backend/data/cache/<数据源id>` 目录后再次点「开始绘图」。

**支持目录联接(junction / 符号链接)**
扫描与目录浏览都会跟随链接读取,方便把同一份结果挂到不同位置做对比测试。

---

## 八、版本管理(git 上传)

### 8.1 两种建库方式

| 方式 | 适用场景 | 说明 |
|---|---|---|
| **只把 `platform/` 建库**(推荐) | 平台代码独立维护、便于分享 | 在 `platform/` 目录执行 `git init`,`platform/.gitignore` 生效 |
| 把整个 `antenna-draw/` 建库 | 连仿真脚本一起备份 | 在 `antenna-draw/` 执行 `git init`,需依赖根目录的 `.gitignore`(已提供)排除仿真结果 |

> 注意:两类仿真结果文件夹单案体积可达数百 MB(`LiJobID00060730_20736` 约 651MB),
> 根目录 `.gitignore` 已排除 `*.dem`、`*_png/` 以及已知结果文件夹,避免误提交大文件。

### 8.2 首次推送

```bash
cd D:/workspace/antenna-draw/platform

git init
git add .
git status              # 先确认没有 node_modules / dist / data 被加入
git commit -m "feat: 天线覆盖绘图平台(自动识别数据、MATLAB 出图、多源对比)"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

若只需上传平台,而工作区已有其他内容,可只添加平台:在仓库根执行
`git add platform`。

### 8.3 什么不会入库(以及为什么)

| 忽略项 | 原因 |
|---|---|
| `node_modules/`(约 130MB) | 依赖,可用 `npm install` 还原 |
| `frontend/dist/` | 构建产物;`启动平台.bat` 在缺失时会自动 `npm run build` |
| `backend/data/` | 运行时数据:`sources.json`(记录本机绝对路径)、图片缓存、导出 zip、日志 |
| `backend/config.json` | 含本机 MATLAB 路径;模板见 `config.example.json` |
| `*.dem` / `*_png/` / 结果文件夹 | 仿真产物,体积大且可重跑得到 |
| `gui-test-screenshots/` | 验收测试截图(如需作为文档请删掉根 `.gitignore` 中对应行) |

### 8.4 换机器/克隆后怎么用

```bash
git clone <仓库地址> && cd platform
启动平台.bat            # 自动 npm install + 构建前端 + 启动
# 若 MATLAB 路径不同:改 backend/config.json(或先复制 config.example.json)
```

数据源注册表不入库,新机器打开平台后重新「添加」一次结果文件夹即可;
已生成的图片缓存在本机,重新绘图会自动建立。

---

## 九、开发模式(可选)

```bash
# 后端(热重载需自行使用 nodemon)
cd platform/backend && node server.js

# 前端开发服务器(端口 5173,/api 已代理到 8000)
cd platform/frontend && npm run dev

# 前端改动后重新构建,供 启动平台.bat 使用
cd platform/frontend && npm run build

# 查看某个文件夹的自动识别结果
cd platform/backend && node scripts/dev-check.js "D:/workspace/antenna-draw/kokin_tg"
```
