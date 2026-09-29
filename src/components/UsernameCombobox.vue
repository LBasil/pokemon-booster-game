<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { searchUsernames } from '@/api/profiles'

// Username field that suggests public trainers as you type ("fr" -> fr00sti).
// v-model = the text; `pick` fires when a suggestion is chosen (click, or
// arrows + Enter). Enter without a highlighted suggestion submits the form.
const props = defineProps({
  id: { type: String, required: true },
  placeholder: { type: String, default: '' },
  excludeId: { type: String, default: null },
})
const model = defineModel({ type: String, default: '' })
const emit = defineEmits(['pick'])
const { t } = useI18n()

const DEBOUNCE_MS = 200
const suggestions = ref([])
const open = ref(false)
const active = ref(-1)
let timer = null
let request = 0

const listId = computed(() => `${props.id}-suggestions`)
const expanded = computed(() => open.value && suggestions.value.length > 0)

function onInput(event) {
  model.value = event.target.value
  active.value = -1
  clearTimeout(timer)
  const prefix = model.value.trim()
  if (!prefix) {
    suggestions.value = []
    open.value = false
    return
  }
  timer = setTimeout(() => lookup(prefix), DEBOUNCE_MS)
}

async function lookup(prefix) {
  const mine = ++request
  try {
    const rows = await searchUsernames(prefix, { excludeId: props.excludeId })
    if (mine !== request) return // a newer keystroke won
    // An exact match alone isn't worth a dropdown
    suggestions.value = rows.length === 1 && rows[0].username.toLowerCase() === prefix.toLowerCase() ? [] : rows
    open.value = true
  } catch {
    if (mine === request) suggestions.value = [] // the field still works by hand
  }
}

function choose(row) {
  request++ // drop any lookup in flight
  clearTimeout(timer)
  model.value = row.username
  suggestions.value = []
  open.value = false
  active.value = -1
  emit('pick', row.username)
}

function onKeydown(event) {
  if (!expanded.value) return
  const count = suggestions.value.length
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = (active.value + 1) % count
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = (active.value - 1 + count) % count
  } else if (event.key === 'Enter' && active.value >= 0) {
    event.preventDefault()
    choose(suggestions.value[active.value])
  } else if (event.key === 'Escape') {
    open.value = false
    active.value = -1
  }
}

// Let a click on a suggestion land before closing
const close = () => setTimeout(() => (open.value = false), 150)

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="combo">
    <input
      :id="id"
      :value="model"
      type="text"
      class="form-control"
      role="combobox"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      :aria-controls="listId"
      :aria-activedescendant="expanded && active >= 0 ? `${listId}-${active}` : undefined"
      :placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @focus="open = true"
      @blur="close"
    />
    <ul v-show="expanded" :id="listId" class="combo-list" role="listbox" :aria-label="t('trades.suggestions')">
      <li
        v-for="(row, index) in suggestions"
        :id="`${listId}-${index}`"
        :key="row.username"
        class="combo-option"
        role="option"
        :aria-selected="index === active"
        @mousedown.prevent="choose(row)"
      >
        <span class="combo-name">{{ row.username }}</span>
        <span v-if="row.accepts_trades === false" class="combo-note">{{ t('trades.suggestionClosed') }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
  flex: 1;
  min-width: 0;
}

.combo-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 16rem;
  margin: 0;
  padding: 0.3rem;
  overflow-y: auto;
  list-style: none;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-lg);
}

.combo-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  cursor: pointer;
}

.combo-option[aria-selected='true'] {
  background: var(--pb-selected);
}

@media (hover: hover) {
  .combo-option:hover {
    background: var(--pb-selected);
  }
}

.combo-name {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.combo-note {
  flex-shrink: 0;
  color: var(--pb-text-muted);
  font-size: 0.78rem;
}
</style>
