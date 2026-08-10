// 与 ai 包解耦：插件不把 ai 声明为自身依赖。
// 运行时 generateText 复用 Koishi 宿主里 yesimbot 提供的 ai 包（外置、不上报依赖）。
// 这里仅给 tsc 一个环境声明，让其通过类型检查，而不需要真正安装 ai。
declare module 'ai';
