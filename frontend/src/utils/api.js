// Base URL for the Foliovex backend. All API calls are prefixed with this so
// the frontend works regardless of where it's deployed (no reliance on a
// same-origin dev proxy). Vite sets import.meta.env.DEV to true under
// `vite dev`, so local development targets the local backend while production
// builds (e.g. on Vercel) hit the Render-hosted deployment.
export const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:8000'
  : 'https://foliovex-backend.onrender.com'
