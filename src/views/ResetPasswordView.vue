<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/BrandLogo.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

// Landing page of the "forgot password" email. Supabase signs the player in
// with a recovery session from the link; without one the link is expired.
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const password = ref('')
const confirm = ref('')
const error = ref('')
const done = ref(false)
const saving = ref(false)

async function save() {
  error.value = ''
  if (password.value.length < 6) {
    error.value = t('home.passwordHint')
    return
  }
  if (password.value !== confirm.value) {
    error.value = t('reset.mismatch')
    return
  }
  saving.value = true
  try {
    await auth.updatePassword(password.value)
    done.value = true
    setTimeout(() => router.push({ name: 'game' }), 1500)
  } catch (err) {
    error.value = err.message || t('home.genericError')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="reset container">
    <header class="reset-top">
      <RouterLink :to="{ name: 'home' }"><BrandLogo /></RouterLink>
      <div class="d-flex align-items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>

    <main class="reset-main">
      <section class="reset-panel pb-glass">
        <h1 class="reset-title">{{ t('reset.title') }}</h1>

        <template v-if="!auth.isLoggedIn">
          <p class="pb-muted">{{ t('reset.expired') }}</p>
          <RouterLink :to="{ name: 'home' }" class="btn btn-primary btn-lg glow-button">{{ t('reset.backHome') }}</RouterLink>
        </template>

        <div v-else-if="done" class="alert alert-success mb-0" role="status">{{ t('reset.done') }}</div>

        <form v-else class="d-flex flex-column gap-3" @submit.prevent="save">
          <p class="pb-muted mb-0">{{ t('reset.intro', { email: auth.user?.email }) }}</p>
          <div>
            <label class="form-label" for="new-password">{{ t('reset.newPassword') }}</label>
            <input id="new-password" v-model="password" type="password" class="form-control" autocomplete="new-password" minlength="6" required />
          </div>
          <div>
            <label class="form-label" for="confirm-password">{{ t('reset.confirm') }}</label>
            <input id="confirm-password" v-model="confirm" type="password" class="form-control" autocomplete="new-password" minlength="6" required />
          </div>
          <div v-if="error" class="alert alert-danger py-2 mb-0" role="alert">{{ error }}</div>
          <button type="submit" class="btn btn-primary btn-lg glow-button" :disabled="saving">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
            {{ t('reset.save') }}
          </button>
        </form>
      </section>
    </main>
  </div>
</template>

<style scoped>
.reset {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.reset-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 0;
}

.reset-main {
  flex: 1;
  display: grid;
  place-items: center;
  padding-bottom: 3rem;
}

.reset-panel {
  width: 100%;
  max-width: 420px;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: color-mix(in srgb, var(--pb-bg-elevated) 94%, transparent);
  animation: pb-rise 0.5s var(--pb-ease-out) both;
}

.reset-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 800;
}
</style>
