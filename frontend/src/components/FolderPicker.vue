<template>
  <el-dialog
    v-model="visible"
    title="选择结果文件夹"
    width="720px"
    :close-on-click-modal="false"
    @open="init"
  >
    <div v-if="error" class="picker-error">
      <el-alert type="error" :closable="false" :title="error" show-icon />
    </div>

    <el-form-item label="直接输入路径" label-width="100px">
      <el-input v-model="manualPath" placeholder="例如 D:\workspace\antenna-draw\kokin_tg" clearable>
        <template #append>
          <el-button @click="goManual">跳转</el-button>
        </template>
      </el-input>
    </el-form-item>

    <el-form-item label="驱动器" label-width="100px">
      <el-button v-for="d in drives" :key="d" size="small" @click="go(d)">{{ d }}</el-button>
    </el-form-item>

    <el-form-item label="当前目录" label-width="100px">
      <div class="picker-current">
        <el-button size="small" :disabled="!parent" @click="go(parent)">
          <el-icon><Top /></el-icon>&nbsp;上一级
        </el-button>
        <span class="mono">{{ currentPath || '(未选择)' }}</span>
      </div>
    </el-form-item>

    <el-form-item label="子文件夹" label-width="100px">
      <div v-loading="loading" class="picker-list">
        <div v-if="!loading && dirs.length === 0" class="muted" style="padding: 8px">
          该目录下没有子文件夹
        </div>
        <div v-for="d in dirs" :key="d.path" class="picker-item" @click="go(d.path)">
          <el-icon color="#e6a23c"><Folder /></el-icon>
          <span>{{ d.name }}</span>
          <el-icon class="picker-item__enter" color="#c0c4cc"><ArrowRight /></el-icon>
        </div>
      </div>
    </el-form-item>

    <template #footer>
      <span class="muted" style="float: left; line-height: 32px">
        提示:选定的是包含 pred 子目录的结果文件夹
      </span>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!currentPath" @click="confirm">
        选择此文件夹
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import * as api from '../api';

const emit = defineEmits(['select']);
const visible = ref(false);
const drives = ref([]);
const dirs = ref([]);
const currentPath = ref('');
const parent = ref(null);
const manualPath = ref('');
const loading = ref(false);
const error = ref('');

async function init() {
  error.value = '';
  try {
    const r = await api.listDrives();
    drives.value = r.drives;
    if (!currentPath.value) {
      const home = drives.value[0] || 'C:\\';
      await go(home);
    }
  } catch (e) {
    error.value = e.message;
  }
}

async function go(path) {
  if (!path) return;
  loading.value = true;
  error.value = '';
  try {
    const r = await api.listDir(path);
    currentPath.value = r.path;
    parent.value = r.parent;
    dirs.value = r.dirs;
    manualPath.value = r.path;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function goManual() {
  if (manualPath.value) go(manualPath.value);
}

function confirm() {
  emit('select', currentPath.value);
  visible.value = false;
}

defineExpose({ open: () => (visible.value = true) });
</script>

<style scoped>
.picker-error {
  margin-bottom: 12px;
}

.picker-current {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  font-size: 12px;
  color: #555;
  word-break: break-all;
}

.picker-list {
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.picker-item:hover {
  background: #f0f7ff;
}

.picker-item__enter {
  margin-left: auto;
}
</style>
