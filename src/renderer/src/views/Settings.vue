<script setup lang="ts">
// 设置页面目前只包含关于信息
</script>

<template>
  <div class="settings-page">
    <a-card title="关于" :bordered="false">
      <a-descriptions :column="2" bordered>
        <a-descriptions-item label="应用名称">EnvHub</a-descriptions-item>
        <a-descriptions-item label="版本">1.0.0</a-descriptions-item>
        <a-descriptions-item label="描述" :span="2">
          本地开发环境管理器，支持 Python、Node.js、PostgreSQL 的多版本离线安装与管理
        </a-descriptions-item>
        <a-descriptions-item label="技术栈" :span="2">
          Electron + Vue 3 + TypeScript + Arco Design
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 900px;
  margin: 0 auto;
}
</style>
