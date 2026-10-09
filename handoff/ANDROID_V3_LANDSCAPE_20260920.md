> 最新交付改为累计 R19：包含安卓横屏、地图拖动及战术阵容线/替补席修复，服务器仍最后确认 R16。部署见 outputs/hot-update-20260920-r19/yellowdogs-hot-update-20260920-r19/DEPLOY.md。R18 是本轮中间产物，不再推荐。

# Android v3 / 0.2.0 横屏适配 · 2026-09-20

服务器最后用户确认 R16。最新交付 R18（从 R16 累积，包含 R17），未部署。Windows 最新仍 0.1.4。安卓由 v2/0.1.1 升级为 v3/0.2.0，同签名，可覆盖安装；仍加载正式服同源 WebView 网页，不等于 Windows 的预置资源模式。

## 交付
- APK：outputs/android/releases/3-20260920-041954-f75e1a/yellowdogs-android-v3.apk（459226 字节）。
- 安卓下载发布包：同目录 yellowdogs-android-release-v3.tar.gz 及 .sha256；只发布下载接口，不更新游戏网页。
- 网页包：outputs/hot-update-20260920-r18/yellowdogs-hot-update-20260920-r18.tar.gz 及 .sha256；操作说明在同名目录 DEPLOY.md。
- 安卓部署说明：deploy/ANDROID_CLIENT.md。

## 改动
44dp 左侧返回/菜单栏代替占用高度的顶部栏；系统栏、屏幕缺口和 IME 空间由原生容器处理；返回优先关闭游戏内顶层确认框、导航、工具、活动窗口，之后走历史/退出。原生只保留轻量样式，网页决定最新功能布局。

横屏阈值扩至 1280×600，移动样式放到功能样式之后，战术球场按实际空间适配。联军按我的球员/联军阵容/盟友借调切换；球员仓库高级筛选可收起。机场、科技编辑、确认弹窗适配小屏；确认框独立滚动正文，底部按钮可见且层级高于联军。修改仅涉及表现，不改变规则和权限。

## 验证与边界
38 个浏览器界面场景、24 项 Chrome 触控检查（696×320、800×390、1236×540 已扣除侧栏宽度；包含真实隔离接口借调、筛选展开、嵌套返回和 180px 高键盘窗口），浏览器异常 0。26 项 Node 回归、7 项安卓发布测试、32 项 Java 更新策略检查通过；APK 签名 v2/v3 校验成功。R18 1216 文件基线、损坏拒绝、应用/重复应用/显式回滚/健康失败回滚演练通过，服务钩子为模拟。

本次 USB 手机 unauthorized，没有 AVD，因此没有 v3 真机安装、系统键盘或刘海屏验收。旧版设备测试记录不得套用到新版。未操作正式服，未提交/推送代码。

QA：outputs/android-landscape-v3-review/report.json、outputs/mobile-landscape-20260920/report.json、APK 同目录 DEVICE_QA.json、BUILD.json、SIGNATURE.txt、releases/20260920-r18/QA.json。

系统窗口处理参考：https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets

## 追加：战术板修复
旧 bindDrag 已停用，阵容线事件遗漏在旧函数中；提取并接入 bindFormationLineDrag，取消时恢复起始状态，只读/研究锁定仍生效。重绘前后保留替补席两轴滚动及手机工作区属性，移除死代码。28 项战术单测通过；outputs/tactics-drag-r19/report.json 记录桌面鼠标和手机 CDP 触控线拖动/球员移动保存 200、滚动 200px 保持 200px、页面异常 0。
