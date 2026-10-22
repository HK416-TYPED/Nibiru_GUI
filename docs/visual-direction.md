# NIBBLES 视觉方向

品牌：NIBBLES / NOOB & CHEESE。完整项目名为 NIBBLES-NOOB&CHEESE-UNIFIED MODEL PROJECT。

## 页面设计

- 新账户默认浅色；已有账户保留主题偏好，设置中支持浅色、深色和系统主题。
- 工作台保留 IMAGINE. 大字与功能性提示词按钮，去除宣传口号。
- 米色网页底层采用方格、网点和地形等高线；表单保持清晰背景。主图装饰与页面底层分开控制。
- 登录页沿用原创主图和 IMAGINE.，桌面左右分区，手机为紧凑主视觉与纵向表单。

## 素材与实现

主图来自用户提供的 NovelAI 原创探索者插画，再经内置 imagegen 补全头顶、调整构图和冷灰配色；成品为 public/assets/nibbles-explorer-cover.png（1672×941）。用于工作台和登录页，人物面罩、衣服及背景维持统一。

品牌与主图配置：public/workspace-config.mjs。工作台结构：public/workspace-ui.mjs。样式：public/art-direction.css、public/field-design.css、public/auth-design.css。地形图形为本地 SVG，无外部字体或 CDN 依赖。

## 验证

检查桌面 1440×960 与手机 390×844；手机品牌可见，无水平溢出；进阶参数展开和登录/注册切换正常。隔离预览脚本只用于视觉验证，不接入真实账户和 GPU。
