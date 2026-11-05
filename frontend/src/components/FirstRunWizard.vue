<template>
  <el-dialog :model-value="ui.loaded && !ui.onboarding.completed && !ui.open" title="欢迎使用本机 Web 版" width="660px" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
    <p>先配置本机 MATLAB，或跳过后直接分析数据和使用交互预览。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <h3>1. MATLAB 环境</h3>
    <p>{{ environmentLabel(ui.environment) }}</p>
    <el-button @click="ui.open = true">配置 MATLAB 与输出</el-button>
    <h3>2. 选择数据</h3>
    <div class="wizard-actions">
      <el-button :loading="busy" @click="demo">使用演示数据</el-button>
      <el-button @click="picker.open()">添加结果文件夹</el-button>
    </div>
    <p class="muted">{{ state.sources.length ? `已登记 ${state.sources.length} 个数据源，可在主界面选择任务。` : '也可进入后再添加数据。' }}</p>
    <h3>3. 结果保存位置</h3>
    <p>{{ ui.draft.outputMode === 'source' ? '源目录旁的路损结果图' : ui.draft.outputRoot }}</p>
    <p class="muted">可在应用设置中更改新任务的保存策略。</p>
    <template #footer><el-button type="primary" :loading="busy" @click="enter">{{ app.isReady() ? '进入主界面' : '先跳过 MATLAB 并进入' }}</el-button></template>
  </el-dialog>
  <FolderPicker ref="picker" @select="pick" />
</template>
<script setup>
import { ref } from 'vue';
import { app } from '../appState';
import { environmentLabel } from '../appModel.mjs';
import * as api from '../api';
import { state, loadSources, addSource } from '../store';
import FolderPicker from './FolderPicker.vue';
const ui = app.state, busy = ref(false), error = ref(''), picker = ref(null);
async function attempt(fn) { busy.value = true; error.value = ''; try { await fn(); } catch (e) { error.value = e.message; } finally { busy.value = false; } }
function demo() { return attempt(async () => { await api.addDemoSource(); await loadSources(); }); }
function pick(value) { return attempt(() => addSource(value)); }
function enter() { return attempt(async () => { await app.save(); await app.completeOnboarding(); }); }
</script>
<style scoped>.wizard-actions { display: flex; gap: 12px; }</style>
