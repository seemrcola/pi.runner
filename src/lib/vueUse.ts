import { computed, reactive, watchEffect } from 'vue'

export function reactiveOmit<T extends Record<string, unknown>, K extends keyof T>(
  source: T,
  ...keys: K[]
): Omit<T, K> {
  const omitted = reactive({}) as Record<string, unknown>
  const skipped = new Set<keyof T>(keys)

  watchEffect(() => {
    for (const key of Object.keys(omitted)) {
      delete omitted[key]
    }
    for (const key of Object.keys(source) as Array<keyof T>) {
      if (!skipped.has(key)) omitted[key as string] = source[key]
    }
  })

  return omitted as Omit<T, K>
}

export function useVModel<
  T extends Record<string, unknown>,
  K extends Extract<keyof T, string>,
  V = Exclude<T[K], undefined>,
>(
  props: T,
  key: K,
  emit: (event: `update:${K}`, value: V) => void,
  options: { defaultValue?: V } = {},
) {
  return computed<V>({
    get: () => (props[key] ?? options.defaultValue) as V,
    set: (value) => emit(`update:${key}`, value),
  })
}
