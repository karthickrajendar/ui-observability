/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_FARO_COLLECTOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
