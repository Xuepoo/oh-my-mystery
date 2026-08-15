import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from '../ui/theme';

interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

export class BackgroundLayer extends Entity {
  private particles: DustParticle[] = [];
  private mouseX = -1000;
  private mouseY = -1000;
  private time = 0;
  private cachedCanvas: HTMLCanvasElement | null = null;
  private cachedW = 0;
  private cachedH = 0;

  constructor() {
    super();
    this.id = 'background-layer';
    this.interactive = false;
    this.initParticles(24);

    // Track mouse for particle interaction
    window.addEventListener('pointermove', this.onPointerMove);
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  public dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
  }

  private initParticles(count: number): void {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.2 - 0.1, // gentle upward drift
        size: Math.random() * 2.0 + 1.0,
        alpha: Math.random() * 0.5 + 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  private updateCache(w: number, h: number): void {
    if (this.cachedCanvas && this.cachedW === w && this.cachedH === h) {
      return;
    }

    if (!this.cachedCanvas) {
      this.cachedCanvas = document.createElement('canvas');
    }
    this.cachedCanvas.width = w;
    this.cachedCanvas.height = h;
    this.cachedW = w;
    this.cachedH = h;

    const ctx = this.cachedCanvas.getContext('2d');
    if (!ctx) return;

    // 1. Warm Antique Mahogany Parchment Gradient
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.sqrt(cx * cx + cy * cy);

    const grad = ctx.createRadialGradient(cx, cy * 0.85, radius * 0.12, cx, cy, radius);
    grad.addColorStop(0, '#382B21'); // Luminous amber warm desk center
    grad.addColorStop(0.45, '#2D221A'); // Rich antique mahogany tone
    grad.addColorStop(1, '#1C140F'); // Deep walnut perimeter

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Subtle Vintage Chart Coordinate Grid
    const gridSize = 64;
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.05)';
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

    // 3. Ruler Ticks along Borders (Antique Map Scale)
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < w - 40; x += 16) {
      const tickH = x % 80 === 0 ? 8 : 4;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, tickH);
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - tickH);
    }
    for (let y = 40; y < h - 40; y += 16) {
      const tickW = y % 80 === 0 ? 8 : 4;
      ctx.moveTo(0, y);
      ctx.lineTo(tickW, y);
      ctx.moveTo(w, y);
      ctx.lineTo(w - tickW, y);
    }
    ctx.stroke();

    // 4. Baroque Filigree Corner Accents
    this.drawCornerFiligree(ctx, 28, 28, 1, 1); // Top-Left
    this.drawCornerFiligree(ctx, w - 28, 28, -1, 1); // Top-Right
    this.drawCornerFiligree(ctx, 28, h - 28, 1, -1); // Bottom-Left
    this.drawCornerFiligree(ctx, w - 28, h - 28, -1, -1); // Bottom-Right

    // 5. Watermark Stamp (Bottom Center)
    ctx.fillStyle = 'rgba(243, 196, 118, 0.22)';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      'ARCHIVE DOSSIER • CONFIDENTIAL GRAPH • 全球推理文脉考证 • VECTOJS NATIVE',
      w / 2,
      h - 16,
    );
  }

  render(renderer: any) {
    const ctx = getCanvasCtx(renderer);
    const w = this.scene.width;
    const h = this.scene.height;
    this.time += 0.025;

    // 1. Blit pre-rendered static background in 0.02ms
    this.updateCache(w, h);
    if (this.cachedCanvas) {
      ctx.drawImage(this.cachedCanvas, 0, 0);
    }

    // 2. Animated Astrolabe & Compass Rose in Lower Right
    this.drawAstrolabe(ctx, w - 170, h - 150, 72);

    // 3. Floating Golden Dust Embers
    this.renderParticles(ctx, w, h);
  }

  private drawCornerFiligree(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scaleX: number,
    scaleY: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX, scaleY);
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;

    // Corner L-Bracket
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(0, 0);
    ctx.lineTo(32, 0);
    ctx.stroke();

    // Filigree Flourish Spiral (卷草花纹)
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.bezierCurveTo(8, 16, 16, 8, 16, 0);
    ctx.moveTo(0, 24);
    ctx.bezierCurveTo(14, 24, 24, 14, 24, 0);
    ctx.stroke();

    // Corner Diamond Dot
    ctx.fillStyle = Theme.colors.borderActive;
    ctx.beginPath();
    ctx.arc(6, 6, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawAstrolabe(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save();
    ctx.translate(cx, cy);

    // Outer Calibrated Ring
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner Ring
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.1)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating 8-Point Compass Star
    const rot = this.time * 0.25;
    ctx.rotate(rot);

    ctx.strokeStyle = 'rgba(243, 196, 118, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const armLen = i % 2 === 0 ? r * 0.65 : r * 0.42;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * armLen, Math.sin(angle) * armLen);
    }
    ctx.stroke();

    // Orbiting celestial marker bead
    const orbAngle = this.time * 0.6;
    const orbX = Math.cos(orbAngle) * (r * 0.72);
    const orbY = Math.sin(orbAngle) * (r * 0.72);
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.beginPath();
    ctx.arc(orbX, orbY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;

      // Mouse repulsion impulse
      const dx = p.x - this.mouseX;
      const dy = p.y - this.mouseY;
      const distSq = dx * dx + dy * dy;
      if (distSq < 10000 && distSq > 1) {
        const force = (1 - distSq / 10000) * 1.5;
        p.vx += (dx / Math.sqrt(distSq)) * force;
        p.vy += (dy / Math.sqrt(distSq)) * force;
      }

      // Linear motion and damping
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy = p.vy * 0.95 - 0.008; // upward buoyancy

      // Wrap around bounds
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      // Render glowing golden dust specks
      const shimmer = Math.sin(this.time * 2 + p.phase) * 0.2 + p.alpha;
      ctx.fillStyle = `rgba(255, 217, 142, ${Math.max(0.08, Math.min(0.8, shimmer)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
