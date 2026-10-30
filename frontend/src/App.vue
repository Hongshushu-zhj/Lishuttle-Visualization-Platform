<template>
  <el-container style="min-height: 100vh">
    <el-header class="app-header">
      <div class="app-header__left">
        <el-icon size="22" style="color: #1f6feb"><Picture /></el-icon>
        <span class="app-header__title">天线覆盖绘图平台</span>
        <el-tag size="small" :type="desktop.state.appInfo?.channel === 'stable' ? 'success' : 'warning'">{{ desktop.state.appInfo?.channel === 'stable' ? '稳定版' : '开发版' }}</el-tag>
      </div>
      <div class="app-header__right" style="display: flex; align-items: center; gap: 12px">
        <el-button link :type="desktop.isReady() ? 'success' : 'warning'" @click="desktop.state.open = true">{{ environmentLabel(desktop.state.environment) }}</el-button>
        <el-button @click="desktop.state.open = true">应用设置</el-button>
        <el-button @click="history.open()">任务记录</el-button>
        <GlobalColorRanges />
        <el-radio-group v-model="currentView" size="default">
          <el-radio-button value="plot">
            <el-icon><DataLine /></el-icon>&nbsp;画图展示
          </el-radio-button>
          <el-radio-button value="compare">
            <el-icon><Grid /></el-icon>&nbsp;结果对比
          </el-radio-button>
          <el-radio-button value="analysis">
            <el-icon><DataAnalysis /></el-icon>&nbsp;结果分析
          </el-radio-button>
        </el-radio-group>
      </div>
    </el-header>

    <el-main style="padding: 0">
      <el-alert
        v-if="!state.backendOk"
        type="error"
        :closable="false"
        show-icon
        style="margin: 12px 20px 0"
        title="本地服务连接中断"
        :description="state.backendError + '。请重试；仍不可用时重新打开应用，并在设置中查看日志。'"
      ><el-button size="small" @click="retry">重试连接</el-button><el-button size="small" @click="desktop.state.open = true">设置与诊断</el-button></el-alert>
      <el-alert v-if="desktop.state.loaded && desktop.state.onboarding.warnings?.length" :title="desktop.state.onboarding.warnings.join('；')" type="warning" :closable="false" />
      <PlotView v-show="currentView === 'plot'" />
      <CompareView v-show="currentView === 'compare'" />
      <AnalysisView v-if="analysisOpened" v-show="currentView === 'analysis'" />
    </el-main>
  </el-container>
  <AppSettings />
  <FirstRunWizard />
  <JobHistory ref="history" />
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch, defineAsyncComponent } from 'vue';
import { state, loadSources } from './store';
import PlotView from './views/PlotView.vue';
import GlobalColorRanges from './components/GlobalColorRanges.vue';
import CompareView from './views/CompareView.vue';
import AppSettings from './components/AppSettings.vue';
import FirstRunWizard from './components/FirstRunWizard.vue';
import JobHistory from './components/JobHistory.vue';
import { desktop } from './desktopState';
import { desktopBridge } from './desktopBridge';
import { environmentLabel } from './desktopModel.mjs';
import { ElMessage } from 'element-plus';

const currentView = ref('plot');
const history = ref(null);
const AnalysisView = defineAsyncComponent(() => import('./views/AnalysisView.vue'));
const analysisOpened = ref(false);
watch(currentView, view => { if (view === 'analysis') analysisOpened.value = true; });

let poll, polling = false;
const stopDownloadNotifications = desktopBridge.onDownloadResult(({ state, filename }) => {
  if (state === 'completed') ElMessage.success(`文件已保存：${filename}`);
  else ElMessage.error('文件保存失败，请检查目标目录和磁盘空间后重试。');
});
async function retry() {
  await loadSources();
  try { await desktop.load(); desktop.state.appInfo = await desktopBridge.getAppInfo(); }
  catch (error) { state.backendOk = false; state.backendError = error.message; }
}
onMounted(async () => {
  await retry();
  poll = setInterval(async () => {
    if (polling || !desktop.state.checking) return;
    polling = true;
    try { await desktop.pollCheck(); } catch { /* settings shows retryable error */ } finally { polling = false; }
  }, 1000);
});
onUnmounted(() => { clearInterval(poll); stopDownloadNotifications(); });
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  height: 60px;
}

.app-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-header__title {
  font-size: 17px;
  font-weight: 700;
}
@media (max-width: 1320px) {
  .app-header { height: auto; min-height: 60px; flex-wrap: wrap; gap: 8px; padding-top: 8px; padding-bottom: 8px; }
  .app-header__right { flex-wrap: wrap; }
}
</style>
