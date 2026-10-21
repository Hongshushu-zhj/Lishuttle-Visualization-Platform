<template>
  <el-button @click="visible = true">全局色标配置</el-button>
  <el-dialog v-model="visible" title="全局色标配置" width="700px" @open="loadDraft">
    <p class="muted">按指标统一画图展示与结果对比页的预览色标,覆盖所有数据源、任务和楼层。配置保存在当前浏览器,刷新后保留。</p>
    <div v-for="type in colorTypes" :key="type.key" class="preset-row">
      <strong>{{ type.key }} <small>{{ type.unit }}</small></strong>
      <el-input-number v-model="draft[type.key][0]" :precision="2" aria-label="色标下限" />
      <span>至</span>
      <el-input-number v-model="draft[type.key][1]" :precision="2" aria-label="色标上限" />
      <el-button type="primary" @click="apply(type.key)">保存并应用</el-button>
      <el-switch :model-value="!!colorRanges[type.key]?.enabled" :disabled="!colorRanges[type.key]"
        active-text="启用" @change="(value) => toggle(type.key, value)" />
    </div>
    <p class="muted">停用后恢复 MATLAB 原图展示,已保存范围仍可再次启用。单图实时调色继续保留,修改单图不会自动影响其他图。原图下载及批量导出仍使用 MATLAB 结果。</p>
    <template #footer>
      <el-button @click="applySaved">一键装配已保存范围</el-button>
      <el-button @click="disableAll">全部停用</el-button>
      <el-button type="primary" @click="visible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { colorTypes, colorRanges, saveColorRange, enableColorRange } from '../colorRanges';
const visible = ref(false);
const draft = reactive(Object.fromEntries(colorTypes.map((type) => [type.key, [...type.range]])));
function loadDraft() { for (const type of colorTypes) draft[type.key] = [...(colorRanges[type.key]?.range || type.range)]; }
function apply(type) {
  try { saveColorRange(type, draft[type]); ElMessage.success(`已保存并应用 ${type} 全局范围`); }
  catch (e) { ElMessage.error(e.message); }
}
function toggle(type, enabled) {
  try { enableColorRange(type, enabled); } catch (e) { ElMessage.error(e.message); }
}
function applySaved() {
  const saved = colorTypes.filter((type) => colorRanges[type.key]);
  if (!saved.length) return ElMessage.info('请先保存至少一个指标范围');
  try { for (const type of saved) enableColorRange(type.key, true); ElMessage.success('已装配所有已保存范围'); }
  catch (e) { ElMessage.error(e.message); }
}
function disableAll() { for (const type of colorTypes) toggle(type.key, false); }
</script>

<style scoped>
.preset-row { display: flex; align-items: center; gap: 10px; margin: 18px 0; }
.preset-row strong { width: 100px; flex-shrink: 0; }
.preset-row small { font-weight: normal; color: #6b7280; }
.preset-row .el-input-number { width: 135px; }
</style>
