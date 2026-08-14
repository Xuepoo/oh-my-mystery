import { Entity } from '@vectojs/core';
import { Theme } from '../ui/theme';

export class BackgroundLayer extends Entity {
  constructor() {
    super();
    this.id = 'background-layer';
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  render(ctx: CanvasRenderingContext2D) {
    const w = this.scene.width;
    const h = this.scene.height;

    // 1. Base Dark Parchment Gradient (Vignette)
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.sqrt(cx * cx + cy * cy);

    const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#211D19');
    grad.addColorStop(0.65, '#191614');
    grad.addColorStop(1, '#110F0E');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Subtle Vintage Ink Grid
    const gridSize = 40;
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 160, 140, 0.035)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = 0; x <= w; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // 3. Accent Corner Marks (Detective Dossier Style)
    ctx.strokeStyle = 'rgba(212, 163, 115, 0.12)';
    ctx.lineWidth = 1.5;
    const cornerSize = 20;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(16, 16 + cornerSize);
    ctx.lineTo(16, 16);
    ctx.lineTo(16 + cornerSize, 16);
    // Top-right
    ctx.moveTo(w - 16 - cornerSize, 16);
    ctx.lineTo(w - 16, 16);
    ctx.lineTo(w - 16, 16 + cornerSize);
    // Bottom-left
    ctx.moveTo(16, h - 16 - cornerSize);
    ctx.lineTo(16, h - 16);
    ctx.lineTo(16 + cornerSize, h - 16);
    // Bottom-right
    ctx.moveTo(w - 16 - cornerSize, h - 16);
    ctx.lineTo(w - 16, h - 16);
    ctx.lineTo(w - 16, h - 16 - cornerSize);
    ctx.stroke();

    // 4. Subtle Dossier Header Label Watermark
    ctx.fillStyle = 'rgba(212, 163, 115, 0.06)';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.fillText('CONFIDENTIAL INVESTIGATION ARCHIVE // VECTO-ZERO-DOM', 32, 28);

    ctx.restore();
  }
}
