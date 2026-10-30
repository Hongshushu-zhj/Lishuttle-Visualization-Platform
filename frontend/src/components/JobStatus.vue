<template>
  <div v-if="job" class="job-status">
    <div class="job-status__header">
      <strong>{{ jobStateLabel(job.status) }}</strong>
      <span>成功 {{ job.done || 0 }} / {{ job.total }} · 失败 {{ job.failed || 0 }} · 取消/中断 {{ job.cancelled || 0 }}</span>
      <el-button v-if="!terminalJobStates.has(job.status)" size="small" :loading="busy" :disabled="job.status === 'cancelling'" @click="cancel">取消任务</el-button>
      <el-button v-else-if="job.status !== 'done' && job.errorDetails?.retryable !== false" size="small" :loading="busy" @click="retry">重试未完成层</el-button>
    </div>
    <el-progress :percentage="jobPercent(job)" :status="job.status === 'done' ? 'success' : ['failed','timed_out','partial','interrupted'].includes(job.status) ? 'exception' : ''" />
    <p v-if="job.error" class="muted">{{ job.error }} <span v-if="job.errorDetails?.code">（{{ job.errorDetails.code }}）</span></p>
    <details v-if="details"><summary>逐图结果与任务记录</summary><p class="muted">任务 {{ job.id }} · {{ job.createdAt }}</p><div v-for="f in job.figures" :key="f.key">{{ f.sourceName }} · {{ f.taskName }} · {{ f.dataType }} · {{ f.layerLabel }}：{{ f.status }} {{ f.error || '' }}</div></details>
    <p v-if="error" style="color: #c00000">{{ error }}</p>
  </div>
</template>
<script setup>
import { ref } from 'vue';
import * as api from '../api';
import { jobStateLabel, jobPercent, terminalJobStates } from '../jobModel.mjs';
import { ensurePlotReady } from '../desktopState';
const props = defineProps({ job: Object, details: { type: Boolean, default: false } });
const emit = defineEmits(['update', 'retry']); const busy = ref(false), error = ref('');
async function act(fn) { busy.value = true; error.value = ''; try { await fn(); } catch (e) { error.value = e.message; } finally { busy.value = false; } }
function cancel() { return act(async () => emit('update', await api.cancelJob(props.job.id))); }
function retry() { if (!ensurePlotReady()) return; return act(async () => emit('retry', await api.retryJob(props.job.id))); }
</script>
<style scoped>.job-status { padding: 12px; margin: 12px 0; border: 1px solid #dcdfe6; border-radius: 6px; } .job-status__header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; } details { line-height: 1.8; font-size: 13px; }</style>
