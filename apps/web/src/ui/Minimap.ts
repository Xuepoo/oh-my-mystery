import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';

export class Minimap extends Entity {
  private viewport: GraphViewport;
  private widthPx = 170;
  private heightPx = 126;
  private radarAngle = 0;

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

  render(r: any): void {
    const ctx = getCanvasCtx(r);
    const startX = 24;
    const startY = this.scene.height - this.heightPx - 24;
    this.radarAngle += 0.035;

    // Minimap Container Frame
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(40, 31, 24, 0.92)';
    ctx.beginPath();
    ctx.roundRect(startX, startY, this.widthPx, this.heightPx, 8);
    ctx.fill();

    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // Minimap Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🧭 鹰眼小地图 (MINIMAP)', startX + 12, startY + 8);

    // Mini nodes representation from real positions
    const entities = this.viewport.getEntities();
    const positions = this.viewport.getPositions();
    const count = entities.length;

    const innerX = startX + 12;
    const innerY = startY + 24;
    const innerW = this.widthPx - 24;
    const innerH = this.heightPx - 36;

    // Radar Sweep Beam
    const mcx = innerX + innerW / 2;
    const mcy = innerY + innerH / 2;
    const mRadius = Math.min(innerW, innerH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(mcx, mcy, mRadius, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = 'rgba(243, 196, 118, 0.12)';
    ctx.stroke();

    const sweepX = mcx + Math.cos(this.radarAngle) * mRadius;
    const sweepY = mcy + Math.sin(this.radarAngle) * mRadius;
    ctx.strokeStyle = 'rgba(255, 217, 142, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mcx, mcy);
    ctx.lineTo(sweepX, sweepY);
    ctx.stroke();
    ctx.restore();

    if (positions && count > 0) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let i = 0; i < count; i++) {
        const px = positions[i * 3]!;
        const py = positions[i * 3 + 1]!;
        if (Number.isFinite(px) && Number.isFinite(py)) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }

      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);

      for (let i = 0; i < count; i++) {
        const e = entities[i]!;
        const px = positions[i * 3]!;
        const py = positions[i * 3 + 1]!;
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

        const nx = innerX + ((px - minX) / spanX) * innerW;
        const ny = innerY + (1 - (py - minY) / spanY) * innerH;

        ctx.fillStyle = Theme.getNodeColor(e.type);
        ctx.beginPath();
        ctx.arc(nx, ny, e.type === 'author' ? 3.0 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Camera Box Frame
      ctx.strokeStyle = Theme.colors.borderActive;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(innerX + innerW * 0.22, innerY + innerH * 0.22, innerW * 0.56, innerH * 0.56);
    }
  }
}
