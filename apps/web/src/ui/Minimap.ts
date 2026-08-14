import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { Theme } from './theme';

export class Minimap extends Entity {
  private viewport: GraphViewport;
  private widthPx = 160;
  private heightPx = 120;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'minimap';
    this.interactive = true;
    this.viewport = viewport;

    this.on('pointerdown', (e: any) => {
      const startX = 24;
      const startY = this.scene.height - this.heightPx - 24;
      if (
        e.clientX >= startX &&
        e.clientX <= startX + this.widthPx &&
        e.clientY >= startY &&
        e.clientY <= startY + this.heightPx
      ) {
        this.viewport.fitToView();
      }
    });
  }

  isPointInside(x: number, y: number): boolean {
    const startX = 24;
    const startY = this.scene ? this.scene.height - this.heightPx - 24 : 0;
    return x >= startX && x <= startX + this.widthPx && y >= startY && y <= startY + this.heightPx;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const startX = 24;
    const startY = this.scene.height - this.heightPx - 24;

    // Minimap Container Frame
    ctx.save();
    ctx.fillStyle = 'rgba(24, 21, 19, 0.85)';
    ctx.beginPath();
    ctx.roundRect(startX, startY, this.widthPx, this.heightPx, 8);
    ctx.fill();

    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Minimap Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 9px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🧭 鹰眼小地图 (MINIMAP)', startX + 10, startY + 8);

    // Mini nodes representation
    const entities = this.viewport.getEntities();
    const count = entities.length;
    const cx = startX + this.widthPx / 2;
    const cy = startY + this.heightPx / 2 + 6;

    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const e = entities[i]!;
        const angle = (i / count) * Math.PI * 2;
        const dist = 14 + (i % 5) * 6;
        const nx = cx + Math.cos(angle) * dist;
        const ny = cy + Math.sin(angle) * dist * 0.75;

        ctx.fillStyle = Theme.getNodeColor(e.type);
        ctx.beginPath();
        ctx.arc(nx, ny, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Camera Box
      ctx.strokeStyle = Theme.colors.borderHighlight;
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 24, cy - 18, 48, 36);
    }

    ctx.restore();
  }
}
