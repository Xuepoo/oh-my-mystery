import { App } from './App';

async function bootstrap() {
  const canvas = document.getElementById('app-canvas') as HTMLCanvasElement;

  if (!canvas) {
    throw new Error('Canvas element #app-canvas not found');
  }

  const app = new App(canvas);
  window.__OMM_APP__ = app;
  await app.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      app.dispose();
      delete window.__OMM_APP__;
    });
  }
}

void bootstrap();
