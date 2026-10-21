<template>
  <div class="page">
    <el-row :gutter="16">
      <!-- 左侧:数据源管理 -->
      <el-col :span="5">
        <el-card shadow="never" class="side-card">
          <template #header>
            <div class="side-head">
              <span>数据源</span>
              <el-button type="primary" size="small" :icon="FolderAdd" @click="picker.open()">
                添加
              </el-button>
            </div>
          </template>

          <div v-if="state.sources.length === 0" class="muted" style="padding: 8px 0; line-height: 1.8">
            还没有数据源。<br />点击「添加」选择跑完仿真得到的结果文件夹(需包含 pred 子目录)。
          </div>

          <section v-for="group in sourceGroups" :key="group.key" class="source-group">
            <div class="source-group__title">
              <span>{{ group.label }}</span>
              <el-tag size="small" effect="plain">{{ group.sources.length }}</el-tag>
            </div>
            <div v-if="!group.sources.length" class="muted source-group__empty">暂无{{ group.label }}数据源</div>
          <div
            v-for="s in group.sources"
            :key="s.id"
            class="src-item"
            :class="{ 'src-item--offline': s.offline, 'src-item--selected': s.id === selectedSourceId && group.key === selectedGroup }"
          >
            <button class="src-item__select" :aria-pressed="s.id === selectedSourceId && group.key === selectedGroup" @click="selectSource(s, group.key)">
            <div class="src-item__name" :title="s.path">
              <el-icon :color="s.offline ? '#f56c6c' : '#1f6feb'"><Folder /></el-icon>
              <span>{{ s.name }}</span>
              <el-tag v-if="group.key === 'indoor'" size="small" type="warning" effect="plain">室内</el-tag>
            </div>
            <div class="muted src-item__meta">
              {{ s.tasks.filter((task) => task.indoor === (group.key === 'indoor')).length }} 个任务
              <span v-if="s.offline" style="color: #f56c6c"> · 目录已丢失</span>
            </div>
            </button>
            <div class="src-item__ops">
              <el-tooltip content="重新识别数据" placement="top">
                <el-button link size="small" :icon="Refresh" @click="doRefresh(s)" />
              </el-tooltip>
              <el-tooltip content="移除数据源(不影响原始文件)" placement="top">
                <el-button link size="small" :icon="Delete" @click="doRemove(s)" />
              </el-tooltip>
            </div>
          </div>
          </section>
        </el-card>

        <el-card shadow="never" class="side-card" style="margin-top: 12px">
          <template #header><span>使用说明</span></template>
          <ol class="tips">
            <li>添加结果文件夹后,平台会自动识别其中可绘制的数据类型与高度层。</li>
            <li>在室内/室外分组中选择数据源,右侧切换到对应结果。</li>
            <li>选择「任务」「数据类型」与「高度层/楼层」,点击「开始绘图」。</li>
            <li>图片按高度层依次展示,可单张下载、也可整包导出。</li>
            <li>结果图统一保存在各自结果文件夹下的「路损结果图」目录;仿真重跑后自动重新绘图。</li>
          </ol>
        </el-card>
      </el-col>

      <!-- 右侧:当前选择的数据源 -->
      <el-col :span="19">
        <div v-if="selectedSource" class="display-bar">
          <CoordModeSelect v-model="coordMode" />
        </div>
        <el-empty
          v-if="state.sources.length === 0"
          description="请先在左侧添加结果文件夹"
          :image-size="120"
        />
        <el-empty
          v-else-if="!selectedSource"
          description="请在左侧室内/室外分组中选择数据源"
          :image-size="120"
        />
        <KeepAlive>
          <TaskSourceSection
            v-if="selectedSource"
            :key="selectedSource.id + '-' + selectedGroup + '-' + (refreshVersions[selectedSource.id] || 0)"
            :source="selectedSource"
            :indoor="selectedGroup === 'indoor'"
            :coord-mode="coordMode"
            style="margin-bottom: 18px"
          />
        </KeepAlive>
      </el-col>
    </el-row>

    <FolderPicker ref="picker" @select="onPick" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderAdd, Folder, Refresh, Delete } from '@element-plus/icons-vue';
import { state, addSource, removeSource, refreshSource } from '../store';
import FolderPicker from '../components/FolderPicker.vue';
import TaskSourceSection from '../components/TaskSourceSection.vue';
import CoordModeSelect from '../components/CoordModeSelect.vue';

const picker = ref(null);
const coordMode = ref('abs');
const selectedSourceId = ref('');
const selectedGroup = ref('outdoor');
function selectSource(source, group) {
  selectedSourceId.value = source.id;
  selectedGroup.value = group;
}
const refreshVersions = ref({});
const selectedSource = computed(() => state.sources.find((s) => s.id === selectedSourceId.value));
const sourceGroups = computed(() => [
  { key: 'indoor', label: '室内', sources: state.sources.filter((s) => s.tasks?.some((task) => task.indoor)) },
  { key: 'outdoor', label: '室外', sources: state.sources.filter((s) => s.tasks?.some((task) => !task.indoor)) },
]);

watch(() => state.sources.map((s) => s.id), (ids) => {
  if (!ids.includes(selectedSourceId.value)) selectedSourceId.value = '';
});

async function onPick(path) {
  try {
    const s = await addSource(path);
    selectSource(s, s.tasks[0]?.indoor ? 'indoor' : 'outdoor');
    ElMessage.success(`已添加「${s.name}」,识别到 ${s.tasks.length} 个任务`);
  } catch (e) {
    ElMessageBox.alert(e.message, '添加失败', { type: 'error' });
  }
}

async function doRefresh(s) {
  try {
    const r = await refreshSource(s.id);
    refreshVersions.value[s.id] = (refreshVersions.value[s.id] || 0) + 1;
    if (selectedSourceId.value === s.id && !r.tasks.some((t) => t.indoor === (selectedGroup.value === 'indoor'))) {
      selectedGroup.value = r.tasks[0]?.indoor ? 'indoor' : 'outdoor';
    }
    ElMessage.success(`已重新识别「${r.name}」`);
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function doRemove(s) {
  try {
    await ElMessageBox.confirm(
      `确定移除数据源「${s.name}」吗?只会从平台列表中移除,不会删除任何原始文件。`,
      '移除数据源',
      { type: 'warning' }
    );
    await removeSource(s.id);
    ElMessage.success('已移除');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || String(e));
  }
}
</script>

<style scoped>
.side-card {
  position: sticky;
  top: 12px;
}

.display-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 10px;
  padding: 6px 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.source-group { margin-top: 12px; }
.source-group__title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 600; font-size: 13px; }
.source-group__empty { padding: 4px 0 10px; }
.src-item__select { display: block; width: 100%; padding: 0; border: 0; background: transparent; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.src-item__select:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.src-item.src-item--selected { border-color: var(--brand); background: #ecf5ff; }

.src-item {
  position: relative;
  padding: 8px 8px 8px 10px;
  border-radius: 5px;
  border: 1px solid #e4e7ed;
  margin-bottom: 8px;
  background: #fff;
}

.src-item:hover {
  border-color: #c6d9f7;
  background: #f7fbff;
}

.src-item--offline {
  border-color: #fbc4c4;
  background: #fff8f8;
}

.src-item__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
  padding-right: 46px;
}

.src-item__meta {
  margin-top: 4px;
  padding-right: 46px;
}

.src-item__ops {
  position: absolute;
  top: 6px;
  right: 4px;
}

.tips {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.9;
}
</style>
