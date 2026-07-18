<script setup lang="ts">
import { Toaster as Sonner } from 'vue-sonner'
import 'vue-sonner/style.css'
</script>

<template>
  <Sonner
    theme="dark"
    class="app-sonner"
    position="top-center"
    :gap="8"
    :offset="{ top: 14 }"
    :style="{ '--width': '280px' }"
    :toast-options="{
      style: {
        '--width': '280px',
      },
      classes: {
        toast:
          'min-h-0 border border-border bg-background px-2.5 py-2 text-[11px] leading-4 text-foreground shadow-xl shadow-black/30',
        content: 'gap-0.5',
        icon: 'size-3.5',
        title: 'text-[11px] font-medium leading-4',
        description: 'text-[10px] leading-3 text-muted-foreground',
        actionButton: 'h-5 rounded-sm bg-primary px-2 text-[10px] leading-none text-primary-foreground',
        cancelButton: 'h-5 rounded-sm bg-secondary px-2 text-[10px] leading-none text-secondary-foreground',
      },
    }"
  />
</template>

<style>
.app-sonner[data-sonner-toaster] {
  --width: 280px;
}

.app-sonner [data-sonner-toast][data-styled='true'] {
  min-height: 0;
  padding: 8px 10px;
  background: hsl(var(--background));
  border-color: hsl(var(--border));
  color: hsl(var(--foreground));
  border-radius: 4px;
  box-shadow: 0 12px 30px hsl(0 0% 0% / 0.3);
  font-size: 11px;
  line-height: 16px;
}

.app-sonner [data-sonner-toast][data-styled='true'] [data-content] {
  gap: 2px;
}

.app-sonner [data-sonner-toast][data-styled='true'] [data-title] {
  font-size: 11px;
  line-height: 16px;
}

.app-sonner [data-sonner-toast][data-styled='true'] [data-description] {
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  line-height: 12px;
}

.app-sonner [data-sonner-toast][data-styled='true'] [data-icon],
.app-sonner [data-sonner-toast][data-styled='true'] [data-icon] svg {
  width: 14px;
  height: 14px;
}

.app-sonner [data-sonner-toast][data-styled='true'] [data-button] {
  height: 20px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1;
}
</style>
