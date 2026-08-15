import { App } from './App';

async function bootstrap() {
  const graphCanvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
  const uiCanvas = document.getElementById('ui-canvas') as HTMLCanvasElement;

  if (!graphCanvas || !uiCanvas) {
    throw new Error('Canvas elements #graph-canvas or #ui-canvas not found');
  }

  const app = new App(graphCanvas, uiCanvas);
  await app.start();

  // Expose to window for testing / DevTools
  (window as any).__OMM_APP__ = app;
}

void bootstrap();
