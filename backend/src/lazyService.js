// 兼容原 CLI/脚本接口；只有首次使用旧接口时才初始化默认实例。
// serverApp 始终调用显式工厂，导入模块不触及个人配置或目录。
function lazyService(createDefault, factories) {
  let instance;
  const getInstance = () => instance || (instance = createDefault());
  return new Proxy(factories, {
    get(target, key) { return Reflect.has(target, key) ? Reflect.get(target, key) : getInstance()[key]; },
    set(target, key, value) { if (Reflect.has(target, key)) return Reflect.set(target, key, value); getInstance()[key] = value; return true; },
  });
}
module.exports = { lazyService };
