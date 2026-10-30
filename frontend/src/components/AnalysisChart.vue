<template>
  <el-card shadow="never" class="analysis-chart">
    <div class="chart-tools"><el-button size="small" :disabled="empty" @click="download">下载图表 PNG</el-button></div>
    <div ref="host" :style="{ height: height + 'px' }" role="img" :aria-label="title" />
  </el-card>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent, GraphicComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([BarChart, PieChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, GraphicComponent, CanvasRenderer]);

const props = defineProps({ title: String, subtitle: String, filename: String, option: Object, empty: Boolean, height: { type: Number, default: 390 } });
const host = ref(null);
let chart, observer;
function render() {
  if (!host.value?.clientWidth) return;
  if (!chart) chart = echarts.init(host.value);
  chart.resize();
  chart.setOption({ ...props.option, animation: false, backgroundColor: '#fff',
    title: { text: props.title, subtext: props.subtitle, left: 12, top: 8,
      textStyle: { fontSize: 15 }, subtextStyle: { fontSize: 11, lineHeight: 17, width: Math.max(200, host.value.clientWidth - 30), overflow: 'break' } },
    ...(props.empty ? { graphic: [{ type: 'text', left: 'center', top: '55%', style: { text: '无有效数据', fill: '#909399', fontSize: 16 } }], series: [] } : {}),
  }, true);
}
function download() {
  if (!chart) return;
  const a = document.createElement('a'); a.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
  a.download = `${props.filename}_${props.title}.png`.replace(/[\\/:*?"<>|]/g, '_'); a.click();
}
onMounted(() => { observer = new ResizeObserver(render); observer.observe(host.value); render(); });
watch(() => [props.option, props.subtitle, props.title, props.empty], render);
onBeforeUnmount(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<style scoped>
.analysis-chart { min-width: 0; }
.chart-tools { display: flex; justify-content: flex-end; margin-bottom: 4px; }
</style>
