<template>
  <el-dialog v-model="ui.open" title="应用设置（当前本机服务共享）" width="820px" :close-on-click-modal="false">
    <el-alert v-if="ui.error" :title="ui.error" type="error" :closable="false" show-icon style="margin-bottom:16px" />
    <el-button v-if="!ui.loaded" @click="perform(app.load)">重试加载设置</el-button>
    <el-tabs>
      <el-tab-pane label="MATLAB 与输出">
        <el-form label-position="top" :disabled="ui.saving || !ui.loaded">
          <el-form-item label="MATLAB 可执行文件（bin/matlab.exe）">
            <el-input :model-value="ui.draft.matlabExe" aria-label="MATLAB 路径" :disabled="ui.checking" placeholder="粘贴完整路径，或浏览本机 matlab.exe" @input="app.setMatlabPath">
              <template #append><el-button :disabled="ui.checking" @click="choose('matlab')">选择…</el-button></template>
            </el-input>
          </el-form-item>
          <div class="settings-actions">
            <el-button :disabled="ui.checking" @click="discover">自动发现</el-button>
            <el-button type="primary" :loading="ui.checking" :disabled="!ui.draft.matlabExe" @click="perform(app.startCheck)">保存并检测</el-button>
            <el-button v-if="ui.checking" @click="perform(app.cancelCheck)">取消检测</el-button>
          </div>
          <el-select v-if="ui.candidates.length" placeholder="选择发现的 MATLAB（不会自动执行）" style="width:100%;margin-top:12px" @change="app.setMatlabPath">
            <el-option v-for="item in ui.candidates" :key="item" :label="item" :value="item" />
          </el-select>
          <el-alert :type="app.isReady() ? 'success' : 'info'" :closable="false" show-icon style="margin:16px 0" :title="environmentLabel(ui.environment)" :description="environmentDescription" />
          <el-progress v-if="ui.checking" :percentage="50" indeterminate :show-text="false" />
          <el-form-item label="新任务的结果保存位置">
            <el-radio-group v-model="ui.draft.outputMode"><el-radio value="source">源目录旁的路损结果图</el-radio><el-radio value="separate">独立结果目录</el-radio></el-radio-group>
            <el-input v-if="ui.draft.outputMode === 'separate'" v-model="ui.draft.outputRoot" aria-label="独立结果目录" style="margin-top:8px" placeholder="粘贴可写文件夹的完整路径">
              <template #append><el-button @click="choose('output')">选择…</el-button></template>
            </el-input>
          </el-form-item>
          <p class="muted">更改位置只影响新任务，已有结果保留原位置。MATLAB 并发固定为 1。</p>
          <el-form-item label="每批绘图超时（分钟，5～240）"><el-input-number v-model="ui.draft.jobTimeoutMinutes" aria-label="绘图超时分钟" :min="5" :max="240" :step="5" /></el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="导入与诊断">
        <p>选择旧项目目录，导入设置和登记的数据源。原始数据保持在原目录。</p>
        <el-input v-model="legacyDirectory" aria-label="旧项目目录" placeholder="旧项目目录（包含 backend/config.json）"><template #append><el-button @click="choose('legacy')">选择…</el-button></template></el-input>
        <p><label>可选偏好 JSON：<input type="file" accept=".json,application/json" aria-label="偏好 JSON 文件" @change="readPreferences" /></label></p>
        <details v-if="filePreferences"><summary>文件偏好预览（将覆盖所列指标）</summary><pre>{{ JSON.stringify(filePreferences, null, 2) }}</pre></details>
        <div class="settings-actions"><el-button :disabled="!legacyDirectory" :loading="importing" @click="importOld">导入旧项目</el-button><el-button :disabled="!filePreferences" :loading="importing" @click="importFile">导入文件偏好</el-button></div>
        <el-divider />
        <p>将当前浏览器、当前地址下的旧偏好迁入服务端。只覆盖预览中的指标，其他浏览器标签页也将使用这些偏好。</p>
        <el-button @click="previewBrowser">预览本浏览器旧偏好</el-button>
        <template v-if="browserPreview">
          <p>可迁入 {{ browserPreview.count }} 项；服务端同名指标将被覆盖，旧浏览器存储会保留。</p>
          <el-alert v-for="warning in browserPreview.warnings" :key="warning" :title="warning" type="warning" :closable="false" />
          <pre>{{ JSON.stringify(browserPreview.preferences, null, 2) }}</pre>
          <el-button type="primary" :disabled="!browserPreview.count" :loading="importing" @click="importBrowser">确认迁入预览中的偏好</el-button>
        </template>
        <el-divider />
        <div class="settings-actions"><el-button @click="perform(api.openLogs)">打开日志目录</el-button><el-button @click="previewDiagnostics">预览并下载诊断</el-button><el-button @click="cleanupTemporary">清理 7 天前的临时文件</el-button></div>
      </el-tab-pane>
      <el-tab-pane label="关于"><p>天线覆盖绘图平台 Web {{ ui.appInfo?.version || '' }}</p><p>本机 Web 服务 · 浏览器访问 · Windows 上本机计算。</p><p>MATLAB 由用户安装并提供有效许可。关闭浏览器不会停止后台绘图任务，可从任务记录继续查看。</p></el-tab-pane>
    </el-tabs>
    <template #footer><el-button @click="ui.open = false">关闭</el-button><el-button type="primary" :loading="ui.saving" :disabled="ui.checking || !ui.loaded" @click="save">保存设置</el-button></template>
  </el-dialog>
  <FolderPicker ref="picker" @select="selected" />
  <el-dialog v-model="diagnosticsVisible" title="诊断预览" width="800px">
    <p>诊断可能包含本地路径，请检查后再下载或分享。</p><pre>{{ diagnosticsText }}</pre>
    <template #footer><el-button @click="diagnosticsVisible = false">关闭</el-button><el-button type="primary" @click="exportDiagnostics">发起诊断下载</el-button></template>
  </el-dialog>
</template>
<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { app } from '../appState';
import { environmentLabel } from '../appModel.mjs';
import * as api from '../api';
import { loadSources } from '../store';
import { initializePreferences } from '../preferences';
import { previewLegacyPreferences, parsePreferencesFile } from '../legacyPreferences.mjs';
import FolderPicker from './FolderPicker.vue';
const ui = app.state;
watch(() => ui.open, value => { if (value && !ui.checking && !ui.saving) perform(app.load); });
const legacyDirectory = ref(''), filePreferences = ref(null), importing = ref(false), browserPreview = ref(null);
const picker = ref(null), pickerTarget = ref('');
const diagnosticsVisible = ref(false), diagnosticsText = ref('');
const environmentDescription = computed(() => ui.environment.error?.message || (ui.environment.status === 'passed'
  ? `${ui.environment.matlabVersion} · 检测时间 ${new Date(ui.environment.finishedAt).toLocaleString()} · 室内/室外绘图及 PNG 通过`
  : ui.checking ? '正在启动 MATLAB 并生成微型测试图片。取消后会等待所属进程停止。' : '分析与交互预览可直接使用；MATLAB 绘图需保存路径并完成实际检测。'));
async function perform(fn) { ui.error = ''; try { return await fn(); } catch (error) { ui.error = error.message; } }
function choose(target) { pickerTarget.value = target; picker.value.open({ mode: target === 'matlab' ? 'matlab' : 'directory' }); }
function selected(value) { if (pickerTarget.value === 'matlab') app.setMatlabPath(value); else if (pickerTarget.value === 'output') ui.draft.outputRoot = value; else legacyDirectory.value = value; }
async function readPreferences(event) { filePreferences.value = null; const file = event.target.files?.[0]; if (file) await perform(async () => { filePreferences.value = await parsePreferencesFile(file); }); }
function previewBrowser() { perform(() => { browserPreview.value = previewLegacyPreferences(window.localStorage); }); }
async function refreshImported() { await initializePreferences({ force: true }); await loadSources(); }
async function importValues(value) { importing.value = true; await perform(async () => { await api.importPreferences(value); await refreshImported(); ElMessage.success('偏好已迁入本机服务'); }); importing.value = false; }
function importFile() { return importValues(filePreferences.value); }
function importBrowser() { return importValues(browserPreview.value.preferences); }
async function importOld() { importing.value = true; await perform(async () => { const result = await api.importLegacy(legacyDirectory.value, filePreferences.value || undefined); await app.load(); await refreshImported(); ElMessage.success(`已导入 ${result.sourceCount} 个数据源，${result.offlineCount} 个离线`); }); importing.value = false; }
async function discover() { const value = await perform(api.discoverMatlab); if (value) { ui.candidates = value; if (!value.length) ElMessage.info('常见位置未找到 MATLAB，请手动选择或粘贴路径'); } }
async function save() { await perform(async () => { await app.save(); await loadSources(); ElMessage.success('设置已保存'); }); }
async function previewDiagnostics() { const result = await perform(api.getDiagnostics); if (result) { diagnosticsText.value = JSON.stringify(result, null, 2); diagnosticsVisible.value = true; } }
function exportDiagnostics() { const link = document.createElement('a'); link.href = api.diagnosticsDownloadUrl; link.click(); ElMessage.info('已发起诊断下载，请查看浏览器下载记录'); }
async function cleanupTemporary() { const result = await perform(api.cleanupTemporary); if (result) ElMessage.info(result.skippedActive ? '有绘图任务，暂不清理临时文件' : `已清理 ${result.removed} 个旧临时文件`); }
</script>
<style scoped>.settings-actions { display:flex; gap:8px; flex-wrap:wrap; } pre { max-height:40vh; overflow:auto; white-space:pre-wrap; word-break:break-all; }</style>
