<template>
  <el-container style="min-height: 100vh">
    <el-header class="app-header">
      <div class="app-header__left">
        <el-icon size="22" style="color: #1f6feb"><Picture /></el-icon>
        <span class="app-header__title">天线覆盖绘图平台</span>
        <span class="muted">基于 MATLAB 仿真结果自动出图</span>
      </div>
      <div class="app-header__right">
        <el-radio-group v-model="currentView" size="default">
          <el-radio-button value="plot">
            <el-icon><DataLine /></el-icon>&nbsp;画图展示
          </el-radio-button>
          <el-radio-button value="compare">
            <el-icon><Grid /></el-icon>&nbsp;结果对比
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
        title="无法连接后端服务"
        :description="state.backendError + ' —— 请确认已通过 启动平台.bat 或 node server.js 启动后端(默认端口 8000)'"
      />
      <PlotView v-show="currentView === 'plot'" />
      <CompareView v-show="currentView === 'compare'" />
    </el-main>
  </el-container>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { state, loadSources } from './store';
import PlotView from './views/PlotView.vue';
import CompareView from './views/CompareView.vue';

const currentView = ref('plot');

onMounted(loadSources);
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
</style>
