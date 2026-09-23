<template>
  <div class="figure-card">
    <div class="figure-card__head">
      <div class="figure-card__title">
        <span class="tag-type">{{ fig.dataTypeLabel }}</span>
        <span style="margin: 0 6px">·</span>
        <span class="tag-layer">{{ fig.layerLabel }}</span>
        <span v-if="showSource" class="muted" style="margin-left: 8px">{{ fig.sourceName }}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 2px">
        <el-tag v-if="fig.status === 'pending'" size="small" type="info">待绘图</el-tag>
        <el-tag v-else-if="fig.status === 'failed'" size="small" type="danger">失败</el-tag>
        <template v-else>
          <el-tooltip content="放大查看" placement="top">
            <el-button link :icon="ZoomIn" @click="previewVisible = true" />
          </el-tooltip>
          <el-tooltip content="下载此图" placement="top">
            <el-button link :icon="Download" @click="download" />
          </el-tooltip>
        </template>
      </div>
    </div>

    <div class="figure-card__body">
      <div v-if="fig.status === 'failed'" class="figure-card__error">
        <div style="font-weight: 600; margin-bottom: 6px">绘图失败</div>
        {{ fig.error || '未知错误' }}
      </div>
      <div v-else-if="hasImage" class="figure-card__imgwrap">
        <img :src="displayUrl" :alt="`${fig.dataTypeLabel} ${fig.layerLabel}`" loading="lazy" @click="previewVisible = true" />
      </div>
      <div v-else class="figure-card__placeholder">
        <el-icon size="30"><Picture /></el-icon>
        <div style="margin-top: 8px">尚未生成,点击「开始绘图」</div>
      </div>
    </div>

    <el-dialog v-model="previewVisible" :title="`${fig.dataTypeLabel} @ ${fig.layerLabel} · ${fig.sourceName}`" width="92%" top="4vh">
      <img :src="displayUrl" style="width: 100%; display: block" />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ZoomIn, Download } from '@element-plus/icons-vue';
import { imageUrl } from '../api';

const props = defineProps({
  fig: { type: Object, required: true },
  showSource: { type: Boolean, default: false },
  version: { type: Number, default: 0 },
});

const previewVisible = ref(false);

const hasImage = computed(() => ['cached', 'done'].includes(props.fig.status) && !!props.fig.url);
const displayUrl = computed(() => imageUrl(props.fig, false, props.version));

function download() {
  const a = document.createElement('a');
  a.href = imageUrl(props.fig, true, props.version);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
</script>

<style scoped>
.figure-card__imgwrap {
  width: 100%;
}
</style>
