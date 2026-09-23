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

          <div
            v-for="s in state.sources"
            :key="s.id"
            class="src-item"
            :class="{ 'src-item--offline': s.offline }"
          >
            <div class="src-item__name" :title="s.path">
              <el-icon :color="s.offline ? '#f56c6c' : '#1f6feb'"><Folder /></el-icon>
              <span>{{ s.name }}</span>
            </div>
            <div class="muted src-item__meta">
              {{ knownTypes(s).map((t) => t.label).join(' / ') || '无可绘图数据' }}
              <span v-if="s.offline" style="color: #f56c6c"> · 目录已丢失</span>
            </div>
            <div class="src-item__ops">
              <el-tooltip content="重新识别数据" placement="top">
                <el-button link size="small" :icon="Refresh" @click="doRefresh(s)" />
              </el-tooltip>
              <el-tooltip content="移除数据源(不影响原始文件)" placement="top">
                <el-button link size="small" :icon="Delete" @click="doRemove(s)" />
              </el-tooltip>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" class="side-card" style="margin-top: 12px">
          <template #header><span>使用说明</span></template>
          <ol class="tips">
            <li>添加结果文件夹后,平台会自动识别其中可绘制的数据类型与高度层。</li>
            <li>在每个数据源卡片中选择「数据类型」与「高度层」,点击「开始绘图」。</li>
            <li>图片按高度层依次展示,可单张下载、也可整包导出。</li>
            <li>已画过的图会缓存,再次打开秒级显示;仿真重跑后自动重新绘图。</li>
          </ol>
        </el-card>
      </el-col>

      <!-- 右侧:各数据源绘图区 -->
      <el-col :span="19">
        <el-empty
          v-if="state.sources.length === 0"
          description="请先在左侧添加结果文件夹"
          :image-size="120"
        />
        <SourceSection
          v-for="s in state.sources"
          :key="s.id + '-' + s.scanVersion"
          :source="s"
          style="margin-bottom: 18px"
        />
      </el-col>
    </el-row>

    <FolderPicker ref="picker" @select="onPick" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderAdd, Folder, Refresh, Delete } from '@element-plus/icons-vue';
import { state, addSource, removeSource, refreshSource, knownTypes } from '../store';
import FolderPicker from '../components/FolderPicker.vue';
import SourceSection from '../components/SourceSection.vue';

const picker = ref(null);

async function onPick(path) {
  try {
    const s = await addSource(path);
    const n = knownTypes(s).length;
    ElMessage.success(`已添加「${s.name}」,识别到 ${n} 种可绘图数据`);
  } catch (e) {
    ElMessageBox.alert(e.message, '添加失败', { type: 'error' });
  }
}

async function doRefresh(s) {
  try {
    const r = await refreshSource(s.id);
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

.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

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
