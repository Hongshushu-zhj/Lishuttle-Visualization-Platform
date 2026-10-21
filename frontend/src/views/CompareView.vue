<template>
  <div class="page">
    <!-- 控制面板 -->
    <el-card shadow="never" class="ctrl-card">
      <template #header>
        <div class="ctrl-head">
          <div class="ctrl-head__title">
            <el-icon color="#1f6feb"><Grid /></el-icon>
            <span>多结果对比</span>
            <span class="muted">选择多个结果文件夹与同一数据类型,按高度层自动对齐排列对比</span>
          </div>
          <div class="ctrl-head__ops">
            <el-button
              type="primary"
              :icon="MagicStick"
              :loading="plotting"
              :disabled="!canRun"
              @click="run"
            >
              {{ plotting ? '绘图进行中…' : '生成对比图' }}
            </el-button>
            <el-button :icon="Download" :disabled="cachedCount === 0" @click="exportAll">
              导出对比图 ({{ cachedCount }})
            </el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="16">
        <el-col :span="9">
          <div class="field">
            <div class="field__label">参与对比的数据源 / 任务</div>
            <el-select
              v-model="selectedSourceIds"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="请选择数据源及任务(可多选)"
              style="width: 100%"
            >
              <el-option v-for="s in taskOptions" :key="s.id" :label="s.name" :value="s.id">
                <span>{{ s.name }}</span>
                <span class="muted" style="float: right">{{ knownTypes(s).map((t) => t.label).join('/') }}</span>
              </el-option>
            </el-select>
            <div style="margin-top: 6px">
              <el-button link size="small" :icon="FolderAdd" @click="picker.open()">
                添加新的结果文件夹
              </el-button>
            </div>
          </div>
        </el-col>

        <el-col :span="6">
          <div class="field">
            <div class="field__label">对比数据类型</div>
            <el-select
              v-model="dataType"
              placeholder="请选择数据类型"
              style="width: 100%"
              :disabled="selectedSourceIds.length < 2"
            >
              <el-option v-for="t in commonTypes" :key="t.key" :label="`${t.label} (${t.desc})`" :value="t.key" />
            </el-select>
            <div class="muted" style="margin-top: 6px">
              {{ typeHint }}
            </div>
          </div>
        </el-col>

        <el-col :span="9">
          <div class="field">
            <div class="field__label">
              对比高度层
              <el-checkbox v-model="includePartial" size="small" style="margin-left: 10px; font-weight: normal">
                含部分源缺失的层
              </el-checkbox>
            </div>
            <el-select
              v-model="selectedLayers"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="请选择高度层"
              style="width: 100%"
              :disabled="!dataType"
            >
              <el-option
                v-for="l in layerOptions"
                :key="l.key"
                :label="l.label + (l.partial ? '(部分源缺失)' : '')"
                :value="l.key"
              />
            </el-select>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="16" style="margin-top: 4px">
        <el-col :span="24">
          <CoordModeSelect v-model="coordMode" />
        </el-col>
      </el-row>

      <el-alert
        v-if="taskOptions.length < 2"
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 10px"
        title="对比至少需要 2 个任务"
        description="选择同一数据源内的不同任务,或添加其他结果文件夹进行跨源任务对比。"
      />
      <el-alert
        v-else-if="selectedSourceIds.length >= 2 && commonTypes.length === 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top: 10px"
        title="所选任务之间没有共同的数据类型,无法对比"
        :description="`已选 ${selectedSourceIds.length} 个任务,但它们的可绘图数据类型没有交集。请改选具有共同数据类型的任务。`"
      />

      <el-progress
        v-if="plotting || justFinished"
        :percentage="percent"
        :status="jobError ? 'exception' : (!plotting && justFinished ? 'success' : '')"
        :stroke-width="14"
        style="margin-top: 14px"
      />
      <div v-if="plotting" class="muted" style="margin-top: 4px">
        <el-icon class="is-loading"><Loading /></el-icon>
        正在绘图 {{ progress.done }} / {{ progress.total }} 张(所有数据源合并为一次 MATLAB 任务)
        <span v-if="elapsed">· 已用 {{ elapsed }} 秒</span>
      </div>
      <el-alert
        v-if="jobError"
        type="error"
        show-icon
        closable
        style="margin-top: 10px"
        title="对比绘图失败"
        :description="jobError"
        @close="jobError = ''"
      />
    </el-card>

    <!-- 对比网格 -->
    <el-card v-if="rows.length" shadow="never" style="margin-top: 16px">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between">
          <div>
            <span style="font-weight: 700">对比类型:{{ typeLabel }}</span>
            <span class="muted" style="margin-left: 10px">
              行 = 高度层(由低到高),列 = 数据源及任务;各图使用同一数值范围与色标,可直接横向比较
            </span>
          </div>
          <div class="muted">共 {{ rows.length }} 层 × {{ columns.length }} 任务 = {{ rows.length * columns.length }} 格</div>
        </div>
      </template>

      <div class="table-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th style="width: 90px">高度层</th>
              <th v-for="c in columns" :key="c.id">
                <div class="col-head">{{ c.name }}</div>
                <div class="muted mono col-head__path" :title="c.path">{{ c.path }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <th>
                <div class="row-head">
                  <span class="tag-layer">{{ row.label }}</span>
                  <div class="muted" style="margin-top: 6px">第 {{ row.index + 1 }} 层</div>
                </div>
              </th>
              <td v-for="c in columns" :key="c.id">
                <FigureCard
                  v-if="cellOf(row.key, c.id)"
                  :fig="cellOf(row.key, c.id)"
                  :version="version"
                />
                <div v-else class="cell-missing">
                  <el-icon size="22"><Warning /></el-icon>
                  <div>该数据源无此高度层数据</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <el-empty
      v-else
      :image-size="120"
      description="选择数据源、数据类型与高度层后,点击「生成对比图」"
    />

    <FolderPicker ref="picker" @select="onPick" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Grid, MagicStick, Download, FolderAdd, Warning, Loading } from '@element-plus/icons-vue';
import * as api from '../api';
import { addSource, knownTypes, taskSources } from '../store';
import FigureCard from '../components/FigureCard.vue';
import FolderPicker from '../components/FolderPicker.vue';
import CoordModeSelect from '../components/CoordModeSelect.vue';

const picker = ref(null);
const selectedSourceIds = ref([]);
const dataType = ref('');
const coordMode = ref('abs');
const selectedLayers = ref([]);
const includePartial = ref(false);
const cells = ref([]);
const rows = ref([]);
const columns = ref([]);
const version = ref(0);
const plotting = ref(false);
const justFinished = ref(false);
const jobError = ref('');
const progress = ref({ done: 0, total: 0, status: '' });
const elapsed = ref(0);
let timer = null;
let elapsedTimer = null;

const taskOptions = computed(taskSources);
const selectedSources = computed(() =>
  taskOptions.value.filter((s) => selectedSourceIds.value.includes(s.id))
);

// 所有选中源都支持的可绘图类型(交集)
const commonTypes = computed(() => {
  if (selectedSources.value.length === 0) return [];
  const first = knownTypes(selectedSources.value[0]).map((t) => t.key);
  return first
    .filter((k) => selectedSources.value.every((s) => knownTypes(s).some((t) => t.key === k)))
    .map((k) => {
      const t = knownTypes(selectedSources.value[0]).find((x) => x.key === k);
      return { key: k, label: t.label, desc: t.desc };
    });
});

// 各源在该类型下的高度层
function layersOf(source, type) {
  const t = (source.types || {})[type];
  return t ? t.layers.map((l) => l.key) : [];
}

// 交集(默认)或并集(含缺失)
const layerOptions = computed(() => {
  if (!dataType.value || selectedSources.value.length === 0) return [];
  const lists = selectedSources.value.map((s) => layersOf(s, dataType.value));
  const union = [];
  for (const l of lists) for (const k of l) if (!union.includes(k)) union.push(k);
  const ordered = orderLayers(union);
  return ordered.map((k) => ({
    key: k,
    label: selectedSources.value[0]?.types[dataType.value]?.layers.find((l) => l.key === k)?.label || layerLabel(k),
    partial: !lists.every((l) => l.includes(k)),
  }));
});

const typeLabel = computed(() => {
  const t = commonTypes.value.find((x) => x.key === dataType.value);
  return t ? t.label : dataType.value;
});

// 类型选择框下方的说明文字:区分"源不够""无共同类型""正常"三种状态
const typeHint = computed(() => {
  const n = selectedSourceIds.value.length;
  if (n < 2) return '请至少选择 2 个任务';
  if (commonTypes.value.length === 0) {
    return '所选任务之间没有共同的数据类型,无法对比,请检查各任务包含的数据类型';
  }
  const names = commonTypes.value.map((t) => t.label).join(' / ');
  return `共 ${n} 个任务都含此类型,可选:${names}`;
});

function layerLabel(k) {
  return k === 'ground' ? '地面' : k;
}

// 地面在最前,其余按高度数值升序
function orderLayers(keys) {
  const sorted = keys.slice().sort((a, b) => {
    const num = (k) => {
      const m = String(k).match(/^(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : Infinity;
    };
    const na = num(a);
    const nb = num(b);
    if (a === 'ground') return -1;
    if (b === 'ground') return 1;
    if (na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });
  return sorted;
}

const canRun = computed(
  () => selectedSources.value.length >= 2 && !!dataType.value && selectedLayers.value.length > 0
);
const cachedCount = computed(() => cells.value.filter((c) => ['cached', 'done'].includes(c.status)).length);
const percent = computed(() => {
  const { done, total } = progress.value;
  if (!total) return justFinished.value ? 100 : 0;
  return Math.min(100, Math.round((done / total) * 100));
});

function cellOf(layerKey, sourceId) {
  return cells.value.find((c) => c.layer === layerKey && JSON.stringify([c.sourceId, c.taskId]) === sourceId) || null;
}

function buildRequests() {
  return selectedSources.value.map((s) => ({
    sourceId: s.sourceId,
    taskId: s.taskId,
    dataType: dataType.value,
    layers: selectedLayers.value,
  }));
}

// 选择变化时,重建网格行/列,并展示已生成的图片(dryRun)
async function refreshGrid(dryRun = true) {
  columns.value = selectedSources.value.map((s) => ({ id: s.id, name: s.name, path: s.path }));
  // 对比至少需要 2 个源,否则不构建网格(避免出现"每个格子都缺数据"的无意义表格)
  if (!canRun.value) {
    rows.value = [];
    cells.value = [];
    return;
  }
  const layers = includePartial.value ? layerOptions.value : layerOptions.value.filter((l) => !l.partial);
  rows.value = layers.map((l, i) => ({ key: l.key, label: l.label, index: i }));
  // 只保留仍然合法的已选层
  const validKeys = rows.value.map((r) => r.key);
  const kept = selectedLayers.value.filter((k) => validKeys.includes(k));
  if (kept.length !== selectedLayers.value.length) {
    selectedLayers.value = kept;
    return;
  }
  if (dryRun) {
    try {
      const r = await api.plot(buildRequests(), true, { coordMode: coordMode.value });
      cells.value = r.figures;
    } catch (e) {
      cells.value = [];
    }
  }
}

async function run() {
  jobError.value = '';
  justFinished.value = false;
  plotting.value = true;
  progress.value = { done: 0, total: selectedLayers.value.length * selectedSources.value.length, status: 'running' };
  const t0 = Date.now();
  elapsed.value = 0;
  elapsedTimer = setInterval(() => (elapsed.value = Math.round((Date.now() - t0) / 1000)), 1000);
  try {
    const r = await api.plot(buildRequests(), false, { coordMode: coordMode.value });
    cells.value = r.figures;
    if (!r.jobId) {
      progress.value = { done: r.figures.length, total: r.figures.length, status: 'done' };
      finish(true);
      return;
    }
    await pollJob(r.jobId);
  } catch (e) {
    jobError.value = e.message;
    plotting.value = false;
    clearTimers();
  }
}

function pollJob(jobId) {
  return new Promise((resolve) => {
    timer = setInterval(async () => {
      try {
        const st = await api.getJob(jobId);
        progress.value = { done: st.done, total: st.total, status: st.status };
        cells.value = st.figures;
        if (st.status === 'done' || st.status === 'failed') {
          clearInterval(timer);
          timer = null;
          version.value = Date.now();
          if (st.status === 'failed') jobError.value = st.error || 'MATLAB 绘图失败';
          else finish(false);
          resolve();
        }
      } catch (e) {
        clearInterval(timer);
        timer = null;
        jobError.value = e.message;
        plotting.value = false;
        clearTimers();
        resolve();
      }
    }, 1500);
  });
}

function finish(allCached) {
  plotting.value = false;
  justFinished.value = true;
  clearTimers();
  const failed = cells.value.filter((c) => c.status === 'failed').length;
  if (failed) ElMessage.warning(`对比图完成,其中 ${failed} 张失败`);
  else ElMessage.success(allCached ? '对比图已命中缓存' : `已生成 ${cells.value.length} 张对比图`);
  setTimeout(() => (justFinished.value = false), 3000);
}

function clearTimers() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

async function exportAll() {
  try {
    const r = await api.exportZip(buildRequests(), { coordMode: coordMode.value });
    if (r.count < r.requested) {
      ElMessage.warning(`已导出 ${r.count} 张(${r.requested} 张中还有未绘制的)`);
    } else {
      ElMessage.success(`已导出 ${r.count} 张对比图`);
    }
    const a = document.createElement('a');
    a.href = r.url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    ElMessageBox.alert(e.message, '导出失败', { type: 'error' });
  }
}

async function onPick(path) {
  try {
    const s = await addSource(path);
    // 用新数组赋值触发 watch(ref 数组的原地 push 不会触发),否则类型/高度层不会自动选中
    selectedSourceIds.value = [...new Set([...selectedSourceIds.value, ...taskOptions.value.filter((t) => t.sourceId === s.id).map((t) => t.id)])];
    ElMessage.success(`已添加「${s.name}」并加入对比`);
  } catch (e) {
    ElMessageBox.alert(e.message, '添加失败', { type: 'error' });
  }
}

// 数据源列表变化时,清掉已失效的选择
watch(
  () => taskOptions.value.map((s) => s.id).join(','),
  () => {
    const ids = taskOptions.value.map((s) => s.id);
    selectedSourceIds.value = selectedSourceIds.value.filter((id) => ids.includes(id));
  }
);

watch(selectedSourceIds, () => {
  if (!commonTypes.value.some((t) => t.key === dataType.value)) {
    dataType.value = commonTypes.value.length ? commonTypes.value[0].key : '';
  }
  refreshGrid();
}, { deep: true });

watch(dataType, () => {
  selectedLayers.value = layerOptions.value.filter((l) => includePartial.value || !l.partial).map((l) => l.key);
  refreshGrid();
});

watch([selectedLayers, includePartial], () => refreshGrid(), { deep: true });
// 坐标显示方式变化:重新查询该口径下的已生成图
watch(coordMode, () => refreshGrid());
</script>

<style scoped>
.ctrl-card {
  border-left: 4px solid var(--brand);
}

.ctrl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ctrl-head__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.ctrl-head__ops {
  display: flex;
  gap: 8px;
}

.field {
  margin-bottom: 4px;
}

.field__label {
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  margin-bottom: 6px;
}

.table-wrap {
  overflow: auto;
  max-height: 78vh;
}

.col-head {
  font-weight: 700;
  font-size: 13px;
}

.col-head__path {
  font-weight: normal;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 2px auto 0;
}

.row-head {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cell-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 200px;
  color: #c0c4cc;
  font-size: 12px;
  border: 1px dashed #e4e7ed;
  border-radius: 5px;
}
</style>
