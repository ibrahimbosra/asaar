import { defineConfig } from 'vite'

// GitHub Actions supplies the repository path; local builds remain rooted at '/'.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
})
