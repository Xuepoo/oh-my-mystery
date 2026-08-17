/// <reference types="vite/client" />

import type { App } from './App';

declare global {
  interface Window {
    __OMM_APP__?: App;
  }

  interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_TURNSTILE_SITE_KEY?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
