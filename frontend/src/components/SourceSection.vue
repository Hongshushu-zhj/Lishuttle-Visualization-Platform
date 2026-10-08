<template>
  <el-card shadow="never" class="src-section">
    <template #header>
      <div class="sec-head">
        <div>
          <div class="sec-head__title">
            <el-icon color="#1f6feb"><Folder /></el-icon>
            <span>{{ source.name }}</span>
            <el-tag v-if="source.offline" type="danger" size="small">目录已丢失</el-tag>
            <el-tag v-else size="small" type="success" effect="plain">
              自动识别到 {{ knownTypes.length }} 种可绘图数据
            </el-tag>
          </div>
          <div class="muted mono" style="margin-top: 3px">{{ source.path }}</div>
        </div>
        <div class="sec-head__ops">
          <el-button
            type="primary"
            :icon="MagicStick"
            :loading="plotting"
            :disabled="source.offline || !canPlot"
            @click="startPlot"
          >
            {{ plotting ? '绘图进行中…' : '开始绘图' }}
          </el-button>
          <el-button :icon="Download" :disabled="cachedCount === 0" @click="exportAll">
            导出全部 ({{ cachedCount }})
          </el-button>
        </div>
      </div>
    </template>

    <el-alert
      v-if="knownTypes.length === 0"
      type="warning"
      :closable="false"
      show-icon
      title="该文件夹中没有找到可绘图的数据"
      description="请确认这是跑完仿真后的结果文件夹(内部含 pred\0\index.txt 与 .dem 文件)。"
    />

    <template v-else>
      <!-- 数据类型 -->
      <div class="row">
        <div class="row__label">数据类型</div>
        <div class="row__body">
          <el-radio-group v-model="dataType" size="default">
            <el-radio-button v-for="t in allTypes" :key="t.key" :value="t.key" :disabled="!t.known">
              {{ t.label }}
              <el-tooltip v-if="!t.known" content="暂无对应绘图脚本" placement="top">
                <el-icon style="margin-left: 4px"><Warning /></el-icon>
              </el-tooltip>
            </el-radio-button>
          </el-radio-group>
          <span class="muted" style="margin-left: 12px">{{ currentTypeDesc }}</span>
        </div>
      </div>

      <!-- 高度层 -->
      <div class="row">
        <div class="row__label">
          高度层
          <el-tooltip placement="right" content="地面数据位于 pred\0 根目录,其余为对应高度层文件夹">
            <el-icon style="margin-left: 3px; vertical-align: -2px"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <div class="row__body">
          <el-checkbox-group v-model="selectedLayers">
            <el-checkbox-button v-for="l in currentLayers" :key="l.key" :value="l.key">
              {{ l.label }}
            </el-checkbox-button>
          </el-checkbox-group>
          <el-button link size="small" style="margin-left: 10px" @click="selectAllLayers">全选</el-button>
          <el-button link size="small" @click="selectedLayers = []">清空</el-button>
          <span class="muted" style="margin-left: 8px">
            已选 {{ selectedLayers.length }} / {{ currentLayers.length }} 层
          </span>
        </div>
      </div>

      <!-- 进度 -->
      <el-progress
        v-if="plotting || justFinished"
        :percentage="percent"
        :status="progressStatus"
        :stroke-width="14"
        style="margin: 6px 0 14px"
      />
      <div v-if="plotting" class="muted" style="margin: -8px 0 12px">
        <el-icon class="is-loading"><Loading /></el-icon>
        {{ progressText }}
        <span v-if="elapsed">· 已用 {{ elapsed }} 秒 · MATLAB 启动约需 10~30 秒,请稍候</span>
      </div>
      <el-alert
        v-if="jobError"
        type="error"
        :closable="true"
        show-icon
        style="margin-bottom: 12px"
        title="绘图任务失败"
        :description="jobError"
        @close="jobError = ''"
      />

      <!-- 图片网格 -->
      <div v-if="figures.length" class="figure-grid">
        <FigureCard v-for="f in figures" :key="f.key" :fig="f" :version="version" />
      </div>
      <el-empty
        v-else
        :image-size="90"
        :description="selectedLayers.length ? '点击「开始绘图」生成图片' : '请先选择高度层'"
      />
    </template>
  </el-card>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Folder,
  MagicStick,
  Download,
  Warning,
  QuestionFilled,
  Loading,
} from '@element-plus/icons-vue';
import * as api from '../api';
import FigureCard from './FigureCard.vue';

const props = defineProps({
  source: { type: Object, required: true },
  coordMode: { type: String, default: 'abs' },
});

const allTypes = computed(() => {
  const order = ['RSRP', 'SCR', 'ECHORP', 'DLRSSINR', 'BESTSERVER'];
  const list = Object.values(props.source.types || {});
  return list.sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
});
const knownTypes = computed(() => allTypes.value.filter((t) => t.known));

const dataType = ref('');
const selectedLayers = ref([]);
const figures = ref([]);
const version = ref(0);
const plotting = ref(false);
const justFinished = ref(false);
const jobError = ref('');
const progress = ref({ done: 0, total: 0, status: '' });
const startedAt = ref(0);
const elapsed = ref(0);
let timer = null;
let elapsedTimer = null;

const currentType = computed(() => allTypes.value.find((t) => t.key === dataType.value) || null);
const currentLayers = computed(() => (currentType.value ? currentType.value.layers : []));
const currentTypeDesc = computed(() => (currentType.value ? currentType.value.desc : ''));
const canPlot = computed(() => !!dataType.value && selectedLayers.value.length > 0);
const cachedCount = computed(() => figures.value.filter((f) => ['cached', 'done'].includes(f.status)).length);
const percent = computed(() => {
  const { done, total } = progress.value;
  if (!total) return justFinished.value ? 100 : 0;
  return Math.min(100, Math.round((done / total) * 100));
});
const progressStatus = computed(() => {
  if (jobError.value) return 'exception';
  if (!plotting.value && justFinished.value) return 'success';
  return '';
});
const progressText = computed(() => {
  const { done, total, status } = progress.value;
  if (status === 'queued') return '任务已排队,等待上一个绘图任务完成';
  return `正在绘图 ${done} / ${total} 张`;
});

function selectAllLayers() {
  selectedLayers.value = currentLayers.value.map((l) => l.key);
}

function resetForType() {
  const first = knownTypes.value[0];
  dataType.value = first ? first.key : '';
  selectAllLayers();
}

// 切换类型/高度层时,只查询已生成图片用于展示(dryRun,不启动 MATLAB)
async function loadCached() {
  if (!canPlot.value || props.source.offline) {
    figures.value = [];
    return;
  }
  try {
    const r = await api.plot(
      [{ sourceId: props.source.id, dataType: dataType.value, layers: selectedLayers.value }],
      true,
      { coordMode: props.coordMode }
    );
    figures.value = r.figures;
  } catch (e) {
    figures.value = [];
  }
}

async function startPlot() {
  jobError.value = '';
  justFinished.value = false;
  plotting.value = true;
  startedAt.value = Date.now();
  elapsed.value = 0;
  progress.value = { done: 0, total: selectedLayers.value.length, status: 'running' };
  elapsedTimer = setInterval(() => {
    elapsed.value = Math.round((Date.now() - startedAt.value) / 1000);
  }, 1000);
  try {
    const r = await api.plot(
      [{ sourceId: props.source.id, dataType: dataType.value, layers: selectedLayers.value }],
      false,
      { coordMode: props.coordMode }
    );
    figures.value = r.figures;
    if (!r.jobId) {
      // 全部命中缓存
      progress.value = { done: r.figures.length, total: r.figures.length, status: 'done' };
      finishSuccess(true);
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
        figures.value = st.figures;
        if (st.status === 'done' || st.status === 'failed') {
          clearInterval(timer);
          timer = null;
          if (st.status === 'failed') {
            jobError.value = st.error || 'MATLAB 绘图失败';
          }
          version.value = Date.now(); // 刷新浏览器图片缓存
          if (st.status === 'done') {
            finishSuccess(false);
          } else {
            plotting.value = false;
            clearTimers();
          }
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

function finishSuccess(allCached) {
  plotting.value = false;
  justFinished.value = true;
  clearTimers();
  const failed = figures.value.filter((f) => f.status === 'failed').length;
  if (failed) {
    ElMessage.warning(`绘图完成,其中 ${failed} 张失败`);
  } else {
    ElMessage.success(allCached ? '图片已命中缓存,直接从本地展示' : `已完成 ${figures.value.length} 张图`);
  }
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
    const r = await api.exportZip(
      [{ sourceId: props.source.id, dataType: dataType.value, layers: selectedLayers.value }],
      { coordMode: props.coordMode }
    );
    if (r.count < r.requested) {
      ElMessage.warning(`已导出 ${r.count} 张(${r.requested} 张中还有 ${r.requested - r.count} 张未绘图)`);
    } else {
      ElMessage.success(`已导出 ${r.count} 张图片`);
    }
    triggerDownload(r.url);
  } catch (e) {
    ElMessageBox.alert(e.message, '导出失败', { type: 'error' });
  }
}

function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

watch(dataType, async () => {
  selectAllLayers();
  await loadCached();
});
watch(selectedLayers, loadCached, { deep: true });
// 坐标显示方式变化后,重新查询该口径下已生成的图(未生成的会显示为待绘图)
watch(() => props.coordMode, loadCached);

onMounted(async () => {
  resetForType();
  await loadCached();
});
</script>

<style scoped>
.src-section {
  border-left: 4px solid var(--brand);
}

.sec-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.sec-head__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.sec-head__ops {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 12px;
}

.row__label {
  width: 78px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
  padding-top: 6px;
}

.row__body {
  flex: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
