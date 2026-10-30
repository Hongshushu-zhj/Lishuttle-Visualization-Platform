<template>
  <el-dialog v-model="ui.open" title="应用设置" width="820px" :close-on-click-modal="false">
    <el-alert v-if="ui.error" :title="ui.error" type="error" :closable="false" show-icon style="margin-bottom: 16px" />
    <el-tabs>
      <el-tab-pane label="MATLAB 与输出">
        <el-form label-position="top" :disabled="ui.saving">
          <el-form-item label="MATLAB 可执行文件（bin/matlab.exe）">
            <el-input :model-value="ui.draft.matlabExe" aria-label="MATLAB 路径" :disabled="ui.checking" placeholder="粘贴完整路径，或选择本机 matlab.exe" @input="desktop.setMatlabPath">
              <template #append><el-button :disabled="!isDesktop || ui.checking" @click="selectMatlab">选择…</el-button></template>
            </el-input>
          </el-form-item>
          <div class="settings-actions">
            <el-button :disabled="ui.checking" @click="discover">自动发现</el-button>
            <el-button type="primary" :loading="ui.checking" :disabled="!ui.draft.matlabExe" @click="detect">保存并检测</el-button>
            <el-button v-if="ui.checking" @click="perform(desktop.cancelCheck)">取消检测</el-button>
          </div>
          <el-select v-if="ui.candidates.length" placeholder="选择发现的 MATLAB（不会自动执行）" style="width: 100%; margin-top: 12px" @change="desktop.setMatlabPath">
            <el-option v-for="item in ui.candidates" :key="item" :label="item" :value="item" />
          </el-select>
          <el-alert :type="desktop.isReady() ? 'success' : 'info'" :closable="false" show-icon style="margin: 16px 0" :title="environmentLabel(ui.environment)"
            :description="environmentDescription" />
          <el-progress v-if="ui.checking" :percentage="50" indeterminate :show-text="false" />
          <el-form-item label="新任务的结果保存位置">
            <el-radio-group v-model="ui.draft.outputMode">
              <el-radio value="source">源目录旁的路损结果图</el-radio>
              <el-radio value="separate">独立结果目录</el-radio>
            </el-radio-group>
            <el-input v-if="ui.draft.outputMode === 'separate'" v-model="ui.draft.outputRoot" aria-label="独立结果目录" style="margin-top: 8px" placeholder="粘贴可写文件夹的完整路径">
              <template #append><el-button :disabled="!isDesktop" @click="selectOutput">选择…</el-button></template>
            </el-input>
          </el-form-item>
          <p class="muted">更改位置只影响新任务，已有结果保留原位置。MATLAB 并发固定为 1。</p>
          <el-form-item label="每批绘图超时（分钟，5～240）">
            <el-input-number v-model="ui.draft.jobTimeoutMinutes" aria-label="绘图超时分钟" :min="5" :max="240" :step="5" />
          </el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="导入与诊断">
        <p>主动选择旧项目目录，导入设置和登记的数据源。原始数据保持在原目录。</p>
        <el-input v-model="legacyDirectory" aria-label="旧项目目录" placeholder="旧项目目录（包含 backend/config.json）">
          <template #append><el-button :disabled="!isDesktop" @click="selectLegacy">选择…</el-button></template>
        </el-input>
        <el-input v-model="preferencesFile" aria-label="偏好导出文件" placeholder="可选：用户主动导出的 preferences.json" style="margin: 12px 0">
          <template #append><el-button :disabled="!isDesktop" @click="selectPreferences">选择…</el-button></template>
        </el-input>
        <el-button :disabled="!legacyDirectory" :loading="importing" @click="importOld">导入旧项目</el-button>
        <el-divider />
        <el-button :disabled="!isDesktop" @click="perform(desktopBridge.openLogs)">打开日志目录</el-button>
        <el-button :disabled="!isDesktop" @click="previewDiagnostics">预览并导出诊断</el-button>
        <el-button @click="cleanupTemporary">清理 7 天前的临时文件</el-button>
        <p class="muted">失败时保留错误说明和任务记录。色标和分析偏好可在原功能入口修改。</p>
      </el-tab-pane>
      <el-tab-pane label="关于">
        <p>天线覆盖绘图平台 {{ ui.appInfo?.version || '' }}</p>
        <p>渠道：{{ ui.appInfo?.channel === 'stable' ? '稳定版' : '开发版' }}</p>
        <p>Windows x64 · 本机计算 · MATLAB 由用户安装并提供有效许可。</p>
        <p>验证基线：MATLAB R2022a；阶段 A 独立设备已验证 R2024b。完整 V1 最终验收状态以交付说明为准。</p>
        <p class="muted">当前版本采用手动安装升级，无账号、云上传或自动更新。</p>
      </el-tab-pane>
    </el-tabs>
    <template #footer>
      <el-button @click="ui.open = false">关闭</el-button>
      <el-button type="primary" :loading="ui.saving" :disabled="ui.checking" @click="save">保存设置</el-button>
    </template>
  </el-dialog>
  <el-dialog v-model="diagnosticsVisible" title="诊断预览" width="800px">
    <el-alert title="诊断可能包含本地路径，请检查后再保存或分享。不会收集输入 DEM、配置、许可或凭证。" type="warning" :closable="false" />
    <pre style="max-height: 50vh; overflow: auto; white-space: pre-wrap; word-break: break-all">{{ diagnosticsText }}</pre>
    <template #footer><el-button @click="diagnosticsVisible = false">关闭</el-button><el-button type="primary" @click="exportDiagnostics">保存诊断…</el-button></template>
  </el-dialog>
</template>
<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { desktop } from '../desktopState';
import { desktopBridge, isDesktop } from '../desktopBridge';
import { environmentLabel } from '../desktopModel.mjs';
import * as api from '../api';
import { loadSources } from '../store';
import { initializePreferences } from '../preferences';
const ui = desktop.state;
const legacyDirectory = ref(''), preferencesFile = ref(''), importing = ref(false);
const diagnosticsVisible = ref(false), diagnosticsText = ref('');
async function previewDiagnostics() { const result=await perform(desktopBridge.previewDiagnostics); if(result){diagnosticsText.value=JSON.stringify(result,null,2);diagnosticsVisible.value=true;} }
async function exportDiagnostics() { const result=await perform(desktopBridge.exportDiagnostics); if(result?.ok) ElMessage.success('诊断已保存'); }
async function cleanupTemporary() { const result=await perform(api.cleanupTemporary); if(result) ElMessage.info(result.skippedActive ? '有绘图任务，暂不清理临时文件' : `已清理 ${result.removed} 个旧临时文件，输入和结果保持原位`); }
const environmentDescription = computed(() => ui.environment.error?.message || (ui.environment.status === 'passed'
  ? `${ui.environment.matlabVersion} · 检测时间 ${new Date(ui.environment.finishedAt).toLocaleString()} · 室内/室外绘图及 PNG 通过`
  : ui.checking ? '正在启动 MATLAB 并生成微型测试图片，最多等待 180 秒。取消后会等待所属进程停止。' : '分析与交互预览可直接使用；MATLAB 绘图需保存路径并完成实际检测。'));
async function perform(fn) { try { return await fn(); } catch (error) { ui.error = error.message; } }
async function selectMatlab() { const value = await perform(desktopBridge.selectMatlab); if (value) desktop.setMatlabPath(value); }
async function selectOutput() { const value = await perform(desktopBridge.selectDirectory); if (value) ui.draft.outputRoot = value; }
async function selectLegacy() { const value = await perform(desktopBridge.selectDirectory); if (value) legacyDirectory.value = value; }
async function selectPreferences() { const value = await perform(desktopBridge.selectPreferences); if (value) preferencesFile.value = value; }
async function discover() { const value = await perform(api.discoverMatlab); if (value) { ui.candidates = value; if (!value.length) ElMessage.info('常见位置未找到 MATLAB，请手动选择或粘贴路径'); } }
async function detect() { await perform(desktop.startCheck); }
async function save() { try { await desktop.save(); await loadSources(); ElMessage.success('设置已保存'); } catch { /* model preserves draft and reports error */ } }
async function importOld() {
  importing.value = true;
  try { const result = await api.importLegacy(legacyDirectory.value, preferencesFile.value || undefined); await desktop.load(); await initializePreferences(); await loadSources(); ElMessage.success(`已导入 ${result.sourceCount} 个数据源，${result.offlineCount} 个离线`); }
  catch (error) { ui.error = error.message; } finally { importing.value = false; }
}
</script>
<style scoped>.settings-actions { display: flex; gap: 8px; flex-wrap: wrap; }</style>
