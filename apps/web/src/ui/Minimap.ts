import { Entity } from '@vectojs/core';
import type { GraphViewport } from '../scene/GraphViewport';
import { getCanvasCtx, Theme } from './theme';

export class Minimap extends Entity {
  private viewport: GraphViewport;
  private widthPx = 170;
  private heightPx = 126;
  private lastSweepTime = 0;
  private radarAngle = 0;
  private enabled = true;

  constructor(viewport: GraphViewport) {
    super();
    this.id = 'minimap';
    this.interactive = true;
    this.viewport = viewport;
  }

  public handleClick(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const startX = 24;
    const startY = this.scene ? this.scene.height - this.heightPx - 24 : 0;
    // Only the map area (below the title strip) triggers fitToView
    const mapTop = startY + 20;
    if (x >= startX && x <= startX + this.widthPx && y >= mapTop && y <= startY + this.heightPx) {
      this.viewport.fitToView();
      return true;
    }
    return false;
  }

  isPointInside(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const startX = 24;
    const startY = this.scene ? this.scene.height - this.heightPx - 24 : 0;
    return x >= startX && x <= startX + this.widthPx && y >= startY && y <= startY + this.heightPx;
  }

  render(r: any): void {
    if (!this.enabled) return;
    const ctx = getCanvasCtx(r);
    const startX = 24;
    const startY = this.scene.height - this.heightPx - 24;
    const now = performance.now();
    if (this.lastSweepTime === 0) this.lastSweepTime = now;
    const dt = Math.min(0.1, (now - this.lastSweepTime) / 1000);
    this.lastSweepTime = now;
    this.radarAngle += dt * 2.2;

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
    const nodes = this.viewport.getNodes();
    const count = nodes.length;

    const innerX = startX + 12;
    const innerY = startY + 24;
    const innerW = this.widthPx - 24;
    const innerH = this.heightPx - 36;

    // Clip inner radar and node content
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, innerY, innerW, innerH);
    ctx.clip();

    // Radar Sweep Beam
    const mcx = innerX + innerW / 2;
    const mcy = innerY + innerH / 2;
    const mRadius = Math.min(innerW, innerH) / 2;

    const sweepX = mcx + Math.cos(this.radarAngle) * mRadius;
    const sweepY = mcy + Math.sin(this.radarAngle) * mRadius;
    ctx.strokeStyle = 'rgba(255, 217, 142, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mcx, mcy);
    ctx.lineTo(sweepX, sweepY);
    ctx.stroke();

    if (count > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < count; i++) {
        const node = nodes[i]!;
        if (node.x === undefined || node.y === undefined) continue;
        const px = node.x;
        const py = node.y;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);

      for (let i = 0; i < count; i++) {
        const node = nodes[i]!;
        if (node.x === undefined || node.y === undefined) continue;
        const px = node.x;
        const py = node.y;

        const nx = innerX + ((px - minX) / spanX) * innerW;
        const ny = innerY + ((py - minY) / spanY) * innerH;

        ctx.fillStyle = node.color || Theme.getNodeColor(node.type);
        ctx.beginPath();
        ctx.arc(nx, ny, node.type === 'author' ? 2.8 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Camera Box Frame
      const topLeft = this.viewport.screenToWorld(0, 64);
      const bottomRight = this.viewport.screenToWorld(this.viewport.width, this.viewport.height);
      const boxLeft = innerX + ((topLeft.x - minX) / spanX) * innerW;
      const boxTop = innerY + ((topLeft.y - minY) / spanY) * innerH;
      const boxW = Math.max(12, ((bottomRight.x - topLeft.x) / spanX) * innerW);
      const boxH = Math.max(12, ((bottomRight.y - topLeft.y) / spanY) * innerH);

      ctx.strokeStyle = Theme.colors.borderActive;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
    }
    ctx.restore();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.scene?.markDirty();
  }
}
