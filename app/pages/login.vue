<script setup lang="ts">
const supabase = useSupabaseClient()

const email = ref('')
const sent = ref(false)
const pending = ref(false)
const errorMessage = ref<string | null>(null)

async function requestLink() {
  const address = email.value.trim()
  if (!address || pending.value) return

  pending.value = true
  errorMessage.value = null

  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: window.location.origin }
  })

  pending.value = false
  if (error) errorMessage.value = error.message
  else sent.value = true
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-6">
      <div class="w-full max-w-sm space-y-6">
        <div class="space-y-1 text-center">
          <h1 class="text-2xl font-semibold">
            Shopping List
          </h1>
          <p class="text-sm text-muted">
            Sign in once. This device stays signed in.
          </p>
        </div>

        <UAlert
          v-if="sent"
          icon="i-lucide-mail-check"
          color="primary"
          variant="subtle"
          title="Check your email"
          :description="`We sent a sign-in link to ${email.trim()}. Open it on this device.`"
        />

        <UForm
          v-else
          :state="{ email }"
          class="space-y-3"
          @submit="requestLink"
        >
          <UFormField label="Email">
            <UInput
              v-model="email"
              type="email"
              autocomplete="email"
              size="xl"
              placeholder="you@example.com"
              class="w-full"
              :disabled="pending"
            />
          </UFormField>
          <UButton
            type="submit"
            size="xl"
            block
            :loading="pending"
            :disabled="!email.trim()"
          >
            Email me a link
          </UButton>
          <UAlert
            v-if="errorMessage"
            color="error"
            variant="subtle"
            :description="errorMessage"
          />
        </UForm>
      </div>
    </div>
  </div>
</template>
