import { App } from './App';

async function bootstrap() {
  const canvas = document.getElementById('app-canvas') as HTMLCanvasElement;

  if (!canvas) {
    throw new Error('Canvas element #app-canvas not found');
  }

  const app = new App(canvas);
  await app.start();

  // Expose to window for testing / DevTools
  (window as any).__OMM_APP__ = app;
}

void bootstrap();
