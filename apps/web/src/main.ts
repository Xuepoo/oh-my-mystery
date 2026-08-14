import { App } from './App';

async function bootstrap() {
  const canvas = document.getElementById('canvas-viewport') as HTMLCanvasElement;
  if (!canvas) {
    throw new Error('Canvas element #canvas-viewport not found');
  }

  const app = new App(canvas);
  await app.start();

  // Expose to window for testing / DevTools
  (window as any).__OMM_APP__ = app;
}

void bootstrap();
