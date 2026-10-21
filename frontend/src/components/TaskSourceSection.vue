<template>
  <div>
    <el-card shadow="never" style="margin-bottom: 12px">
      <div class="task-picker">
        <span>任务</span>
        <el-select v-model="taskId" placeholder="请选择任务" style="width: 280px">
          <el-option v-for="task in tasks" :key="task.id" :value="task.id" :label="task.name" />
        </el-select>
        <span class="muted">识别到 {{ tasks.length }} 个{{ indoor ? '室内' : '室外' }}任务</span>
      </div>
    </el-card>
    <KeepAlive>
      <SourceSection v-if="currentSource" :key="currentSource.taskId" :source="currentSource" :coord-mode="coordMode" />
    </KeepAlive>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import SourceSection from './SourceSection.vue';
const props = defineProps({
  source: { type: Object, required: true },
  indoor: { type: Boolean, required: true },
  coordMode: { type: String, default: 'abs' },
});
const taskId = ref('');
const tasks = computed(() => (props.source.tasks || []).filter((task) => task.indoor === props.indoor));
watch(tasks, (list) => {
  if (!list.some((task) => task.id === taskId.value)) taskId.value = list[0]?.id || '';
}, { immediate: true });
const currentSource = computed(() => {
  const task = tasks.value.find((entry) => entry.id === taskId.value);
  return task ? { ...props.source, ...task, id: props.source.id, name: props.source.name, taskId: task.id, taskName: task.name } : null;
});
</script>

<style scoped>
.task-picker { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
</style>
