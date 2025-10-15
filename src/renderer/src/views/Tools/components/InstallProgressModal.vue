<script setup lang="ts">
import type { InstallProgress } from '../composables/useToolVersion'

interface Props {
  progress: InstallProgress
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

function handleClose(): void {
  emit('close')
}

</script>

<template>
  <a-modal
    :visible="progress.visible"
    :title="`安装 ${progress.tool} ${progress.version}`"
    :footer="false"
    :closable="true"
    :mask-closable="false"
    width="600px"
    @cancel="handleClose"
  >
    <div class="flex flex-col gap-4 max-h-96">
      <a-alert :type="progress.status" :closable="false">
        {{ progress.message }}
      </a-alert>

      <div v-if="progress.logs.length > 0" class="flex flex-col min-h-0">
        <div class="text-sm font-medium mb-2 text-gray-800 flex-shrink-0">安装日志：</div>
        <div
          class="bg-gray-50 rounded px-3 py-3 h-[300px] overflow-y-auto font-mono text-xs leading-relaxed"
        >
          <div v-for="(log, index) in progress.logs" :key="index" class="text-gray-600 mb-1">
            {{ log }}
          </div>
        </div>
      </div>

      <div
        v-if="progress.status === 'info'"
        class="text-xs text-gray-500 mt-2 border-t pt-3"
      >
        提示：关闭弹窗不会中断下载，安装将在后台继续进行
      </div>
    </div>
  </a-modal>
</template>
