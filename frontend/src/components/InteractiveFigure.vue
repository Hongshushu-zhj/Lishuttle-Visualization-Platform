<template>
  <div v-loading="loading">
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    <template v-if="preview">
      <div v-if="!compact" class="range-controls">
        <strong>色标下限</strong>
        <el-input-number v-model="lower" :step="1" :precision="2" :disabled="preview.categorical" @change="commitRange" />
        <strong>上限</strong>
        <el-input-number v-model="upper" :step="1" :precision="2" :disabled="preview.categorical" @change="commitRange" />
        <span>{{ preview.unit }}</span>
        <el-button :disabled="preview.categorical" @click="resetRange">恢复默认</el-button>
        <el-button :disabled="!preview.validCount || preview.categorical" @click="useDataRange">按数据范围</el-button>
        <el-button :disabled="preview.categorical" @click="applyGlobal">保存并应用为全局 {{ fig.dataType }} 范围</el-button>
        <el-button v-if="globalRange" @click="setRange(globalRange)">装配全局范围</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存当前预览到结果文件夹</el-button>
        <el-button @click="download">下载当前预览</el-button>
      </div>
      <el-slider v-if="!compact && !preview.categorical" v-model="range" range :min="sliderMin" :max="sliderMax" :step="0.5"
        style="width: calc(100% - 32px); margin: 12px 16px 22px" @input="onSlider" />
      <div v-if="!compact" class="muted" style="margin: 8px 0; line-height: 1.8">
        {{ preview.categorical ? '小区编号为类别数据,不提供连续色标调节。' : '拖动只改变颜色映射,无需重新调用 MATLAB；超出范围的数据使用端点颜色,无效值保持透明。' }}
        原始栅格 {{ preview.original.width }} × {{ preview.original.height }}；
        <span v-if="preview.sampled">预览采样为 {{ preview.width }} × {{ preview.height }}，保存的是当前预览分辨率。</span>
        <span v-else>预览使用完整栅格。</span>
        有效数据范围 {{ preview.min ?? '无' }} ～ {{ preview.max ?? '无' }} {{ preview.unit }}。
      </div>
      <div class="canvas-wrap"><canvas ref="canvas" width="1200" height="820" /></div>
      <div v-if="!compact" class="muted" style="margin-top: 8px">
        本图为浏览器交互预览,版式可能与 MATLAB 原图不同。「开始绘图」和原图下载/导出继续保存 MATLAB 结果。
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { loadRasterPreview, saveRasterPreview } from '../api';
import { createRasterPainter, drawPreview } from '../rasterRenderer';
import { activeColorRange, saveColorRange } from '../colorRanges';
const props = defineProps({ fig: { type: Object, required: true }, compact: { type: Boolean, default: false } });
const globalRange = computed(() => activeColorRange(props.fig.dataType));
function applyGlobal() {
  try { saveColorRange(props.fig.dataType, range.value); ElMessage.success(`已保存并应用至所有 ${props.fig.dataType} 结果预览`); }
  catch (e) { ElMessage.error(e.message); }
}
watch(globalRange, (value) => { if (value && preview.value) setRange(value); }, { deep: true });
watch(() => [props.fig.coordMode, props.fig.xlim, props.fig.ylim], schedule, { deep: true });
const preview = ref(null), canvas = ref(null), loading = ref(true), saving = ref(false), error = ref('');
const range = ref([0, 1]), lower = ref(0), upper = ref(1);
let painter = null, frame = null, disposed = false;
const sliderMin = computed(() => Math.floor(Math.min(preview.value?.defaultRange[0] ?? 0, preview.value?.min ?? 0, range.value[0]) - 5));
const sliderMax = computed(() => Math.ceil(Math.max(preview.value?.defaultRange[1] ?? 1, preview.value?.max ?? 1, range.value[1]) + 5));
function redraw() {
  if (!canvas.value || !painter || disposed) return;
  try { drawPreview(canvas.value, painter, preview.value, props.fig, range.value); }
  catch (e) { error.value = e.message; }
}
function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { frame = null; redraw(); });
}
function onSlider(value) { lower.value = value[0]; upper.value = value[1]; schedule(); }
function commitRange() {
  if (!Number.isFinite(lower.value) || !Number.isFinite(upper.value) || lower.value >= upper.value) {
    ElMessage.warning('色标下限必须小于上限');
    [lower.value, upper.value] = range.value;
    return;
  }
  range.value = [lower.value, upper.value]; schedule();
}
function setRange(value) { range.value = [...value]; [lower.value, upper.value] = value; schedule(); }
function resetRange() { setRange(preview.value.defaultRange); }
function useDataRange() {
  const { min, max } = preview.value;
  setRange(min === max ? [min - 0.5, max + 0.5] : [min, max]);
}
function image() { redraw(); if (error.value) throw new Error(error.value); return canvas.value.toDataURL('image/png'); }
function fileName() {
  return `${props.fig.sourceName}_${props.fig.taskName}_${props.fig.dataType}_${props.fig.layerLabel}_交互预览_色标${range.value[0]}至${range.value[1]}.png`.replace(/[<>:"/\\|?*]/g, '_');
}
async function save() {
  saving.value = true;
  try {
    const r = await saveRasterPreview(props.fig, { range: range.value, png: image(), sampled: preview.value.sampled, coordMode: props.fig.coordMode || 'abs' });
    ElMessage.success({ message: `已保存: ${r.path}`, duration: 6000 });
  } catch (e) { ElMessage.error(e.message); }
  finally { saving.value = false; }
}
function download() {
  try { const a = document.createElement('a'); a.href = image(); a.download = fileName(); a.click(); }
  catch (e) { ElMessage.error(e.message); }
}
onMounted(async () => {
  try {
    const result = await loadRasterPreview(props.fig);
    if (disposed) return;
    preview.value = result;
    range.value = [...(globalRange.value || result.defaultRange)]; [lower.value, upper.value] = range.value;
    await nextTick();
    if (disposed) return;
    const [left, right] = props.fig.xlim || [result.bounds.left, result.bounds.right];
    const [bottom, top] = props.fig.ylim || [result.bounds.bottom, result.bounds.top];
    canvas.value.height = Math.round(Math.max(360, Math.min(1000, 190 + 950 * (top - bottom) / (right - left))));
    painter = createRasterPainter(result, !props.compact); redraw();
  } catch (e) { if (!disposed) error.value = e.message; }
  finally { loading.value = false; }
});
onUnmounted(() => { disposed = true; if (frame) cancelAnimationFrame(frame); painter?.dispose(); });
</script>

<style scoped>
.range-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.canvas-wrap { background: #fff; border: 1px solid #e4e7ed; overflow: auto; }
canvas { width: 100%; height: auto; display: block; }
</style>
