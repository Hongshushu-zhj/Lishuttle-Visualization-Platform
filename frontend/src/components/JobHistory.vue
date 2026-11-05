<template>
  <el-drawer v-model="visible" title="任务记录" size="650px" @open="refresh">
    <el-button @click="refresh">刷新记录</el-button>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-empty v-if="!jobs.length" description="暂无绘图任务" />
    <JobStatus v-for="job in jobs" :key="job.id" :job="job" details @update="refresh" @retry="refresh" />
  </el-drawer>
</template>
<script setup>
import { onUnmounted, ref, watch } from 'vue';
import * as api from '../api';
import JobStatus from './JobStatus.vue';
const visible = ref(false), jobs = ref([]), error = ref(''); let timer, refreshing = false;
async function refresh() { if (refreshing) return; refreshing = true; try { jobs.value = await api.listJobs(); error.value = ''; } catch (e) { error.value = e.message; } finally { refreshing = false; } }
watch(visible, value => { clearInterval(timer); if (value) timer = setInterval(refresh, 2000); });
onUnmounted(() => clearInterval(timer)); defineExpose({ open: () => { visible.value = true; } });
</script>
