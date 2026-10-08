<template>
  <div class="coord-mode">
    <span class="coord-mode__label">坐标显示</span>
    <el-radio-group v-model="mode" size="small">
      <el-radio-button value="abs">绝对 UTM</el-radio-button>
      <el-radio-button value="rel-ll">相对(区域左下角)</el-radio-button>
      <el-radio-button value="rel-center">相对(区域中心)</el-radio-button>
    </el-radio-group>
    <el-tooltip placement="top" content="所有图采用同一坐标范围,保证跨源对比时坐标轴严格一致;x/y 方向已做等比例锁定,图上量距可信。">
      <el-icon class="coord-mode__tip"><QuestionFilled /></el-icon>
    </el-tooltip>
    <span v-if="mode !== 'abs'" class="muted">切换相对坐标后需重新绘图(刻度标签不同)</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: String, default: 'abs' },
});
const emit = defineEmits(['update:modelValue']);

const mode = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});
</script>

<style scoped>
.coord-mode {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.coord-mode__label {
  font-size: 13px;
  font-weight: 600;
  color: #4b5563;
}

.coord-mode__tip {
  color: #9aa1a9;
  cursor: help;
}
</style>
