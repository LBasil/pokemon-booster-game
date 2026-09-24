<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const mode = ref('login')
const email = ref('')
const password = ref('')
const username = ref('')
const showPassword = ref(false)
const error = ref('')
const successMessage = ref('')
const submitting = ref(false)

function switchMode(next) {
  mode.value = next
  error.value = ''
  successMessage.value = ''
}

async function submit() {
  error.value = ''
  successMessage.value = ''
  submitting.value = true

  try {
    if (mode.value === 'login') {
      await auth.signIn({ email: email.value, password: password.value })
      router.push({ name: 'game' })
    } else {
      const data = await auth.signUp({
        email: email.value,
        password: password.value,
        username: username.value || null,
      })
      if (data.session) {
        router.push({ name: 'game' })
      } else {
        successMessage.value = t('home.signupSuccess')
      }
    }
  } catch (err) {
    error.value = err.message || t('home.genericError')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="auth-panel pb-glass" :aria-label="mode === 'login' ? t('home.login') : t('home.signup')">
    <div class="auth-tabs" :class="`is-${mode}`" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="mode === 'login'"
        :class="{ active: mode === 'login' }"
        @click="switchMode('login')"
      >
        {{ t('home.login') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="mode === 'signup'"
        :class="{ active: mode === 'signup' }"
        @click="switchMode('signup')"
      >
        {{ t('home.signup') }}
      </button>
    </div>

    <p class="auth-intro">
      {{ mode === 'login' ? t('home.loginIntro') : t('home.signupIntro') }}
    </p>

    <form class="d-flex flex-column gap-3" @submit.prevent="submit">
      <div v-if="mode === 'signup'">
        <label class="form-label" for="username">{{ t('home.usernameLabel') }}</label>
        <input
          id="username"
          v-model="username"
          type="text"
          class="form-control"
          autocomplete="nickname"
          :placeholder="t('home.usernamePlaceholder')"
        />
      </div>

      <div>
        <label class="form-label" for="email">{{ t('home.emailLabel') }}</label>
        <input
          id="email"
          v-model="email"
          type="email"
          class="form-control"
          autocomplete="email"
          inputmode="email"
          :placeholder="t('home.emailPlaceholder')"
          required
        />
      </div>

      <div>
        <label class="form-label" for="password">{{ t('home.passwordLabel') }}</label>
        <div class="password-field">
          <input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="form-control"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            minlength="6"
            required
          />
          <button
            type="button"
            class="password-toggle"
            :aria-label="showPassword ? t('home.hidePassword') : t('home.showPassword')"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
              <path v-if="showPassword" d="M4 4l16 16" />
            </svg>
          </button>
        </div>
        <p v-if="mode === 'signup'" class="field-hint">{{ t('home.passwordHint') }}</p>
      </div>

      <div v-if="error" class="alert alert-danger py-2 mb-0" role="alert">{{ error }}</div>
      <div v-if="successMessage" class="alert alert-success py-2 mb-0" role="status">
        {{ successMessage }}
      </div>

      <button type="submit" class="btn btn-primary btn-lg glow-button mt-1" :disabled="submitting">
        <span v-if="submitting" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        {{ mode === 'login' ? t('home.submitLogin') : t('home.submitSignup') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.auth-panel {
  width: 100%;
  max-width: 420px;
  padding: 1.5rem;
}

@media (min-width: 576px) {
  .auth-panel {
    padding: 2rem;
  }
}

/* Segmented control with a sliding pill */
.auth-tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  border-radius: var(--pb-radius-md);
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
}

.auth-tabs::before {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: calc(var(--pb-radius-md) - 4px);
  background: var(--pb-surface-hover);
  border: 1px solid var(--pb-border-strong);
  transition: transform 0.35s var(--pb-ease-out);
}

.auth-tabs.is-signup::before {
  transform: translateX(100%);
}

.auth-tabs button {
  position: relative;
  padding: 0.6rem;
  border: none;
  background: none;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.95rem;
  transition: color 0.2s;
}

.auth-tabs button.active {
  color: var(--pb-text);
}

.auth-intro {
  margin: 1.25rem 0 1.25rem;
  color: var(--pb-text-muted);
  font-size: 0.95rem;
}

.password-field {
  position: relative;
}

.password-field .form-control {
  padding-right: 3rem;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 0.4rem;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: var(--pb-radius-sm);
  background: none;
  color: var(--pb-text-muted);
}

.password-toggle:hover {
  color: var(--pb-text);
}

.password-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.field-hint {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}
</style>
