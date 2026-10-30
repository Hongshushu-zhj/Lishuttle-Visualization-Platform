<template>
  <div class="page analysis-page">
    <el-card shadow="never">
      <template #header><div class="section-head"><div><strong>覆盖结果分析</strong><span class="muted">完整 DEM · 单任务多层统计</span></div><el-button type="primary" :disabled="!canRun" :loading="loading" @click="run">{{ loading ? '分析中…' : '开始分析' }}</el-button></div></template>
      <div class="conditions">
        <label>数据源<el-select v-model="sourceId" placeholder="请选择数据源"><el-option v-for="s in state.sources" :key="s.id" :value="s.id" :label="s.name" :disabled="s.offline" /></el-select></label>
        <label>任务<el-select v-model="taskId" placeholder="请选择任务"><el-option v-for="t in tasks" :key="t.id" :value="t.id" :label="`${t.name} · ${t.indoor ? '室内' : '室外'}`" /></el-select></label>
        <label>指标<el-select v-model="dataType" placeholder="请选择指标"><el-option v-for="t in types" :key="t.key" :value="t.key" :label="`${t.label} · ${t.desc}`" /></el-select></label>
        <label>楼层 / 高度层<el-select v-model="selectedLayers" multiple collapse-tags collapse-tags-tooltip placeholder="请选择层"><el-option v-for="l in availableLayers" :key="l.key" :label="l.label" :value="l.key" /></el-select></label>
      </div>
      <div class="source-actions"><el-button link type="primary" @click="picker.open()">添加结果文件夹</el-button><el-button link :disabled="!sourceId" @click="refresh">刷新当前数据源</el-button><span class="muted">不需要先绘图；统计区间与绘图色标相互独立。</span></div>
      <el-alert v-if="task?.types?.BESTSERVER" type="info" title="BESTSERVER 为小区编号数据，暂不纳入结果分析。" description="仍可在画图展示和结果对比中查看；本页聚焦 RSRP、DLRSSINR、SCR、ECHORP 的数值分布。" :closable="false" show-icon />
      <template v-if="dataType && !categorical">
        <el-divider />
        <div class="section-head"><strong>分析区间配置 <small>{{ unit }}</small></strong><span class="muted">仅为分析起点，可根据业务标准调整</span></div>
        <div class="boundary-editor"><span>分界值</span><div v-for="(_, i) in draftBoundaries" :key="i" class="boundary"><el-input-number v-model="draftBoundaries[i]" :controls="false" :precision="2" :aria-label="`分界值 ${i + 1}`" /><el-button text type="danger" :disabled="draftBoundaries.length <= 1" :aria-label="`删除分界值 ${i + 1}`" @click="draftBoundaries.splice(i, 1)">×</el-button></div><el-button :disabled="draftBoundaries.length >= 20" @click="draftBoundaries.push((Number(draftBoundaries.at(-1)) || 0) + 10)">添加分界值</el-button></div>
        <div class="boundary-editor"><span>达标门限 ≥</span><el-input-number v-model="draftThreshold" :controls="false" :precision="2" aria-label="达标门限" /><span>{{ unit }}</span><el-button type="primary" plain @click="applyConfig">应用并保存配置</el-button><el-button @click="resetConfig">恢复默认</el-button></div>
        <div class="muted">分界值须递增且不重复；区间左闭右开，自动包含两端超出值。配置保存在当前浏览器；修改后点击应用，无需重新读取 DEM。</div>
        <el-alert v-if="draftDirty" type="info" title="区间或门限尚未应用，下方仍使用已应用配置。" :closable="false" />
      </template>
    </el-card>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <el-alert v-if="stale" type="warning" title="分析条件或数据源已变化，请重新分析。" description="旧结果已隐藏，防止与当前选择混淆。" show-icon :closable="false" />
    <el-empty v-if="!snapshot && !loading" :description="task && !types.length ? '当前任务没有支持结果分析的连续指标，请切换任务或添加数据源' : '选择数据源、任务与指标，开始分析各层覆盖分布'" />
    <template v-if="snapshot && !stale">
      <el-card shadow="never">
        <div class="section-head"><div><strong>{{ snapshot.sourceName }} · 任务 {{ snapshot.taskName }} · {{ snapshot.dataType }}</strong><div class="muted">{{ new Date(snapshot.analyzedAt).toLocaleString() }} · {{ snapshot.indoor ? '室内' : '室外' }} · 共 {{ rows.length }} 层</div></div><div class="exports"><el-button @click="exportCsv(false)">导出统计汇总 CSV</el-button><el-button @click="exportCsv(true)">{{ categorical ? '导出小区明细 CSV' : '导出分档明细 CSV' }}</el-button></div></div>
        <div class="method">{{ categorical ? '小区编号保留整数；编号不计算均值或连续门限。' : `当前分档：${config.boundaries.join(' / ')} ${unit}；达标门限 ≥ ${config.threshold} ${unit}。` }} 百分比以每层有效点为分母，数据有效率另列。</div>
        <div v-if="categorical" class="muted">主导小区是有效栅格归属点数最多的小区（保留并列），主导占比是单个小区的最大占比；前三占比是点数最多的三个小区占比之和。它们描述服务归属集中程度，不代表用户负载或信号质量。编号 0 按有效类别处理，-32768 为无归属数据。</div>
        <div v-else class="muted">无效值：-32768{{ !snapshot.indoor && dataType === 'DLRSSINR' ? '，室外 DLRSSINR 同时排除 0（当前数据约定）' : '' }}；均值为 dB/dBm 算术平均；分位数使用最近秩法。</div>
        <div class="muted">面积为点数 × 分辨率²的栅格估算值，各层不相加。</div>
        <el-alert v-for="l in failures" :key="l.layer" type="error" :title="`${l.layerLabel}：${l.error}`" :closable="false" show-icon />
      </el-card>

      <el-card shadow="never" class="current-layer-overview">
        <div class="section-head"><strong>当前层统计概览</strong><el-select v-model="activeLayer" class="layer-select" placeholder="选择已分析层"><el-option v-for="l in successful" :key="l.layer" :value="l.layer" :label="l.layerLabel" /></el-select></div>
        <div v-if="current" class="metrics"><div v-for="m in metrics" :key="m.label" class="metric"><span>{{ m.label }}</span><strong :title="m.title || m.value">{{ m.value }}</strong></div></div>
        <el-empty v-else description="没有可展示的层，请检查分析错误" />
      </el-card>

      <template v-if="current">
        <div class="section-head"><strong>{{ current.layerLabel }} · {{ categorical ? '小区服务分布' : '数值分布详情' }}</strong><span class="muted">分辨率 {{ current.resolution }} m · 原始尺寸 {{ current.grid.width }} × {{ current.grid.height }}</span></div>
        <el-alert v-if="!current.validCount" :title="categorical ? '本层无有效小区归属数据，不计算小区组成与集中程度。' : '本层无有效数据，分布和达标率不作评价。'" type="info" show-icon :closable="false" />
        <div :class="categorical ? '' : 'chart-grid'">
          <AnalysisChart v-if="categorical" title="最佳服务小区占比（前十及其他）" :subtitle="detailContext" :filename="detailName" :option="categoryOption" :empty="!current.validCount" :height="500" />
          <template v-else>
            <AnalysisChart title="数值区间占比" :subtitle="detailContext" :filename="detailName" :option="pieOption" :empty="!current.validCount" :height="470" />
            <AnalysisChart title="数值分布直方图" :subtitle="detailContext" :filename="detailName" :option="histogramOption" :empty="!current.validCount" :height="470" />
          </template>
        </div>
        <el-card shadow="never"><template #header><strong>{{ categorical ? '全部小区明细' : '分档明细' }}</strong></template>
          <el-table :data="pagedBins" stripe><el-table-column prop="label" :label="categorical ? '小区编号' : `数值区间 (${unit})`" min-width="160" /><el-table-column label="有效点数"><template #default="{ row }">{{ display(row.count, false, true) }}</template></el-table-column><el-table-column label="占有效点比例"><template #default="{ row }">{{ display(row.percent, true) }}</template></el-table-column><el-table-column label="栅格估算面积 (m²)"><template #default="{ row }">{{ display(row.area) }}</template></el-table-column></el-table>
          <el-pagination v-if="current.bins.length > 20" v-model:current-page="binPage" :page-size="20" :total="current.bins.length" layout="prev, pager, next, total" />
        </el-card>
      </template>
      <div class="section-head"><strong>层间结果对比</strong><span class="muted">各层独立统计；点击下方行可返回该层详情</span></div>
      <template v-if="!categorical">
        <div class="chart-grid">
          <AnalysisChart title="各层数值区间占比" :subtitle="chartContext" :filename="exportName" :option="stackOption" :empty="!hasValid" :height="Math.max(430, successful.length * 32 + 220)" />
          <AnalysisChart title="各层有效点达标率" :subtitle="chartContext" :filename="exportName" :option="passOption" :empty="!hasValid" :height="Math.max(430, successful.length * 32 + 220)" />
        </div>
      </template>

      <el-card shadow="never">
        <template #header><strong>各层统计明细</strong><span class="muted"> 点击行查看该层详情</span></template>
        <el-table :data="successful" stripe highlight-current-row @row-click="showLayer" style="width: 100%">
          <el-table-column prop="layerLabel" label="层" fixed min-width="95" />
          <el-table-column v-for="col in summaryColumns" :key="col.key" :label="col.label" :min-width="col.width || 115" :show-overflow-tooltip="!!col.text"><template #default="{ row }">{{ col.text ? cellLabel(row.dominantCellIds) : display(row[col.key], col.percent, col.integer) }}</template></el-table-column>
        </el-table>
      </el-card>

    </template>
    <FolderPicker ref="picker" @select="addFolder" />
  </div>
</template>

<script setup>
import { computed, ref, shallowRef, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { state, addSource, refreshSource } from '../store';
import { analyzeResults } from '../api';
import { analysisConfig, saveAnalysisConfig } from '../analysisConfig';
import { analysisDefaults, analysisUnits, validateConfig, deriveLayer, histogram, topCategories, csvText, exportRows, availableAnalysisTypes } from '../analysisModel.mjs';
import AnalysisChart from '../components/AnalysisChart.vue';
import FolderPicker from '../components/FolderPicker.vue';

const sourceId = ref(''), taskId = ref(''), dataType = ref(''), selectedLayers = ref([]), activeLayer = ref('');
const snapshot = shallowRef(null), loading = ref(false), error = ref(''), picker = ref(null), binPage = ref(1);
const source = computed(() => state.sources.find(s => s.id === sourceId.value));
const tasks = computed(() => source.value?.tasks || []);
const task = computed(() => tasks.value.find(t => t.id === taskId.value));
const types = computed(() => availableAnalysisTypes(task.value));
const availableLayers = computed(() => task.value?.types[dataType.value]?.layers || []);
const categorical = computed(() => dataType.value === 'BESTSERVER');
const unit = computed(() => analysisUnits[dataType.value] || '');
const config = computed(() => analysisConfig[dataType.value]);
const draftBoundaries = ref([]), draftThreshold = ref(0);
const draftDirty = computed(() => !categorical.value && config.value && JSON.stringify({ boundaries: draftBoundaries.value, threshold: draftThreshold.value }) !== JSON.stringify(config.value));
const selectionKey = computed(() => JSON.stringify([sourceId.value, taskId.value, dataType.value, [...selectedLayers.value].sort()]));
const sourceRevision = ref(0), resultKey = ref(''), resultRevision = ref(0);
const stale = computed(() => !!snapshot.value && (selectionKey.value !== resultKey.value || sourceRevision.value !== resultRevision.value));
const canRun = computed(() => source.value && !source.value.offline && task.value && dataType.value && selectedLayers.value.length > 0 && selectedLayers.value.length <= 256);

watch(() => state.sources, (sources, previous) => {
  if (previous?.length) sourceRevision.value++;
  if (!sources.some(s => s.id === sourceId.value)) sourceId.value = sources.find(s => !s.offline)?.id || '';
}, { immediate: true });
watch(sourceId, () => { taskId.value = tasks.value[0]?.id || ''; }, { flush: 'sync' });
watch(tasks, () => { if (!tasks.value.some(t => t.id === taskId.value)) taskId.value = tasks.value[0]?.id || ''; }, { immediate: true });
watch([sourceId, taskId], () => { dataType.value = types.value.some(t => t.key === 'RSRP') ? 'RSRP' : types.value[0]?.key || ''; }, { flush: 'sync' });
watch(types, () => { if (!types.value.some(t => t.key === dataType.value)) dataType.value = types.value.some(t => t.key === 'RSRP') ? 'RSRP' : types.value[0]?.key || ''; }, { immediate: true });
watch([sourceId, taskId, dataType], () => { selectedLayers.value = availableLayers.value.map(l => l.key); }, { immediate: true, flush: 'sync' });
function loadDraft() { const c = config.value; draftBoundaries.value = c ? [...c.boundaries] : []; draftThreshold.value = c?.threshold ?? 0; }
watch(dataType, loadDraft, { immediate: true });
function applyConfig() {
  const next = { boundaries: [...draftBoundaries.value], threshold: draftThreshold.value };
  if (!validateConfig(next)) return ElMessage.error('请输入 1～20 个递增、不重复的分界值及有效门限');
  try { saveAnalysisConfig(dataType.value, next); ElMessage.success('分析配置已应用并保存'); }
  catch (e) { ElMessage.warning(e.message); }
}
function resetConfig() {
  try { saveAnalysisConfig(dataType.value, analysisDefaults[dataType.value]); }
  catch (e) { ElMessage.warning(e.message); }
  loadDraft();
}
let requestVersion = 0;
watch(selectionKey, () => { requestVersion++; loading.value = false; error.value = ''; });
async function run() {
  const version = ++requestVersion, key = selectionKey.value, revision = sourceRevision.value;
  loading.value = true; error.value = '';
  try {
    const result = await analyzeResults({ sourceId: sourceId.value, taskId: taskId.value, dataType: dataType.value, layers: [...selectedLayers.value] });
    if (version !== requestVersion || key !== selectionKey.value || revision !== sourceRevision.value) return;
    snapshot.value = result; resultKey.value = key; resultRevision.value = revision;
    activeLayer.value = result.layers.find(l => !l.error)?.layer || '';
  } catch (e) { if (version === requestVersion) error.value = e.message; }
  finally { if (version === requestVersion) loading.value = false; }
}
async function refresh() {
  try { await refreshSource(sourceId.value); } catch (e) { ElMessage.error(e.message); }
}
async function addFolder(path) {
  try { const added = await addSource(path); sourceId.value = added.id; } catch (e) { ElMessage.error(e.message); }
}
const rows = computed(() => stale.value ? [] : (snapshot.value?.layers || []).map(l => deriveLayer(l, config.value)));
const failures = computed(() => rows.value.filter(l => l.error));
const successful = computed(() => rows.value.filter(l => !l.error));
const hasValid = computed(() => successful.value.some(l => l.validCount));
const current = computed(() => successful.value.find(l => l.layer === activeLayer.value));
async function showLayer(row) {
  activeLayer.value = row.layer;
  await nextTick();
  document.querySelector('.current-layer-overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
watch(activeLayer, () => { binPage.value = 1; });
watch(config, () => { binPage.value = 1; });
const pagedBins = computed(() => current.value?.bins.slice((binPage.value - 1) * 20, binPage.value * 20) || []);
const display = (value, percent = false, integer = false) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: integer ? 0 : 2, maximumFractionDigits: integer ? 0 : 2 }) + (percent ? '%' : '');
const summaryColumns = computed(() => [
  { key: 'totalCount', label: '总点数', integer: true }, { key: 'validCount', label: '有效点数', integer: true }, { key: 'invalidCount', label: '无效点数', integer: true }, { key: 'validRate', label: '数据有效率', percent: true },
  ...(categorical.value ? [{ key: 'categoryCount', label: '有效小区数', integer: true }, { key: 'dominantCellIds', label: '主导小区（含并列）', text: true, width: 190 }, { key: 'dominantShare', label: '主导小区占比', percent: true, width: 140 }, { key: 'top3Share', label: '前三小区合计占比', percent: true, width: 160 }, { key: 'validArea', label: '有效归属估算面积 (m²)', width: 190 }] : [
    ...['min', 'max', 'mean', 'median', 'p10', 'p90'].map((key, i) => ({ key, label: ['最小值', '最大值', '均值', '中位数', 'P10', 'P90'][i] + ` (${unit.value})` })), { key: 'passRate', label: '有效点达标率', percent: true, width: 140 },
  ]),
]);
function cellLabel(ids, brief = false) {
  if (!ids?.length) return '—';
  if (brief && ids.length > 3) return `${ids.slice(0, 3).join('、')} 等 ${ids.length} 个`;
  return ids.join('、');
}
const metrics = computed(() => {
  const l = current.value; if (!l) return [];
  return [{ label: '有效点数', value: display(l.validCount, false, true) }, { label: '数据有效率', value: display(l.validRate, true) },
    ...(categorical.value ? [{ label: '有效小区数量', value: display(l.categoryCount, false, true) },
      { label: '主导小区（含并列）', value: cellLabel(l.dominantCellIds, true), title: cellLabel(l.dominantCellIds) },
      { label: '主导小区占比', value: display(l.dominantShare, true) },
      { label: '前三小区合计占比', value: display(l.top3Share, true) },
      { label: '有效归属估算面积 (m²)', value: display(l.validArea) }] : [
      { label: `均值 (${unit.value})`, value: display(l.mean) }, { label: `中位数 (${unit.value})`, value: display(l.median) },
      { label: `P10 / P90 (${unit.value})`, value: `${display(l.p10)} / ${display(l.p90)}` }, { label: '有效点达标率', value: display(l.passRate, true) },
    ])];
});
const exportName = computed(() => snapshot.value ? `${snapshot.value.sourceName}_${snapshot.value.taskName}_${snapshot.value.dataType}_各层` : '分析');
const detailName = computed(() => `${exportName.value}_${current.value?.layerLabel || ''}`);
const chartContext = computed(() => {
  if (!snapshot.value) return '';
  return `${snapshot.value.sourceName} · 任务 ${snapshot.value.taskName} · ${snapshot.value.dataType}\n${categorical.value ? '小区编号；占有效点比例' : `分界 ${config.value.boundaries.join('/')} ${unit.value}；门限 ≥ ${config.value.threshold} ${unit.value}；占有效点比例`}\n${new Date(snapshot.value.analyzedAt).toLocaleString()}`;
});
const detailContext = computed(() => `${chartContext.value}\n当前层：${current.value?.layerLabel || ''}`);
const colors = ['#c74b50', '#e28b50', '#e2bd58', '#73af9b', '#438ca4', '#4867a9', '#8d77b4'];
const binColors = computed(() => {
  const count = successful.value[0]?.bins.length || 1;
  return Array.from({ length: count }, (_, i) => colors[Math.round(i * (colors.length - 1) / Math.max(1, count - 1))]);
});
const labels = computed(() => successful.value.map(l => l.layerLabel + (l.validCount ? '' : '（无有效数据）')));
const axes = () => ({ grid: { top: 165, left: 145, right: 35, bottom: 45 }, tooltip: { trigger: 'axis', valueFormatter: value => display(value, true) }, xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } }, yAxis: { type: 'category', inverse: true, data: labels.value } });
const stackOption = computed(() => ({ ...axes(), color: binColors.value,
  legend: { type: 'scroll', top: 123 },
  series: (successful.value[0]?.bins || []).map((bin, i) => ({ name: bin.label, type: 'bar', stack: 'percent',
    data: successful.value.map(l => l.bins[i].percent), emphasis: { focus: 'series' }, barMaxWidth: 32 })),
}));
const passOption = computed(() => ({ ...axes(), series: [{ name: '有效点达标率', type: 'bar', barMaxWidth: 32, itemStyle: { color: '#438ca4' }, data: successful.value.map(l => l.passRate), label: { show: true, position: 'insideLeft', formatter: p => display(p.value, true) } }] }));
const pieOption = computed(() => ({ color: binColors.value, legend: { type: 'scroll', bottom: 4 }, tooltip: { trigger: 'item', valueFormatter: v => `${v} 点` }, series: [{ type: 'pie', radius: ['32%', '56%'], center: ['50%', '62%'], label: { formatter: '{b}\n{d}%' }, data: current.value?.bins.map(b => ({ name: b.label, value: b.count })) || [] }] }));
const histogramOption = computed(() => {
  const bins = current.value ? histogram(current.value) : [];
  return { grid: { top: 160, left: 65, right: 20, bottom: 115 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', name: unit.value, data: bins.map(b => b.label), axisLabel: { rotate: 45, fontSize: 10 } }, yAxis: { type: 'value', name: '有效点数' }, series: [{ type: 'bar', data: bins.map(b => b.count), itemStyle: { color: '#438ca4' }, barCategoryGap: '5%' }] };
});
const categoryOption = computed(() => {
  const bins = topCategories(current.value?.bins || []);
  return { ...axes(), grid: { top: 145, left: 95, right: 70, bottom: 40 }, yAxis: { type: 'category', inverse: true, data: bins.map(b => b.label) }, series: [{ type: 'bar', data: bins.map(b => b.percent), itemStyle: { color: '#4867a9' }, label: { show: true, position: 'right', formatter: p => display(p.value, true) } }] };
});
function exportCsv(detail) {
  const text = csvText(exportRows(snapshot.value, rows.value, config.value, detail));
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${exportName.value}_${detail ? categorical.value ? '小区明细' : '分档明细' : '统计汇总'}.csv`.replace(/[\\/:*?"<>|]/g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<style scoped>
.analysis-page { display: grid; gap: 16px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.section-head .muted { margin-left: 12px; }
.conditions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
.conditions label { display: grid; gap: 9px; font-size: 13px; font-weight: 600; }
.source-actions, .boundary-editor { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 15px; font-size: 13px; }
.boundary { display: flex; align-items: center; }
.boundary :deep(.el-input-number) { width: 105px; }
.boundary-editor + .muted { margin-top: 12px; line-height: 1.8; }
.method { margin: 16px 0 8px; font-size: 13px; line-height: 1.8; }
.layer-select { width: 180px; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; margin-top: 20px; }
.metric { background: #f5f8fc; border-radius: 8px; padding: 18px; display: grid; gap: 10px; }
.metric span { font-size: 12px; color: #687789; }
.metric strong { font-size: 21px; color: #24496b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.el-alert { margin-top: 12px; }
.el-pagination { margin-top: 16px; }
@media (max-width: 1100px) { .conditions { grid-template-columns: repeat(2, minmax(0, 1fr)); } .chart-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .conditions { grid-template-columns: 1fr; } .exports { display: flex; flex-wrap: wrap; gap: 8px; } }
</style>
