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
  <div class="auth-panel mx-auto">
    <ul class="nav nav-pills justify-content-center mb-4">
      <li class="nav-item">
        <button
          type="button"
          class="nav-link"
          :class="{ active: mode === 'login' }"
          @click="switchMode('login')"
        >
          {{ t('home.login') }}
        </button>
      </li>
      <li class="nav-item">
        <button
          type="button"
          class="nav-link"
          :class="{ active: mode === 'signup' }"
          @click="switchMode('signup')"
        >
          {{ t('home.signup') }}
        </button>
      </li>
    </ul>

    <form class="d-flex flex-column gap-3" @submit.prevent="submit">
      <div v-if="mode === 'signup'">
        <label class="form-label" for="username">{{ t('home.usernameLabel') }}</label>
        <input
          id="username"
          v-model="username"
          type="text"
          class="form-control"
          :placeholder="t('home.usernamePlaceholder')"
        />
      </div>

      <div>
        <label class="form-label" for="email">{{ t('home.emailLabel') }}</label>
        <input id="email" v-model="email" type="email" class="form-control" required />
      </div>

      <div>
        <label class="form-label" for="password">{{ t('home.passwordLabel') }}</label>
        <input
          id="password"
          v-model="password"
          type="password"
          class="form-control"
          minlength="6"
          required
        />
      </div>

      <div v-if="error" class="alert alert-danger py-2 mb-0">{{ error }}</div>
      <div v-if="successMessage" class="alert alert-success py-2 mb-0">{{ successMessage }}</div>

      <button type="submit" class="btn btn-primary btn-lg glow-button" :disabled="submitting">
        {{ mode === 'login' ? t('home.submitLogin') : t('home.submitSignup') }}
      </button>

      <button type="button" class="btn btn-link" @click="switchMode(mode === 'login' ? 'signup' : 'login')">
        {{ mode === 'login' ? t('home.switchToSignup') : t('home.switchToLogin') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.auth-panel {
  width: 100%;
  max-width: 380px;
}
</style>
