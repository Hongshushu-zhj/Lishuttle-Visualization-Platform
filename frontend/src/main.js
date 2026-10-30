import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import App from './App.vue';
import './styles.css';
import { initializePreferences } from './preferences';

const app = createApp(App);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.use(ElementPlus, { locale: zhCn });
initializePreferences().then(() => app.mount('#app')).catch(error => {
  const container = document.getElementById('app');
  const message = document.createElement('p'); message.textContent = '偏好配置加载失败：' + error.message;
  const retry = document.createElement('button'); retry.textContent = '重新加载'; retry.onclick = () => location.reload();
  container.replaceChildren(message, retry);
});
