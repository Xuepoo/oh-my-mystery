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

  constructor() {
    super();
    this.id = 'background-layer';
    this.interactive = false;
    this.initParticles(45);

    // Track mouse for particle interaction
    window.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  private initParticles(count: number): void {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.3 - 0.15, // gentle upward drift
        size: Math.random() * 2.2 + 1.0,
        alpha: Math.random() * 0.6 + 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  isPointInside(_x: number, _y: number): boolean {
    return false;
  }

  render(renderer: any) {
    const ctx = getCanvasCtx(renderer);
    const w = this.scene.width;
    const h = this.scene.height;
    this.time += 0.025;

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
    ctx.save();
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.06)';
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
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < w - 40; x += 16) {
      const tickH = x % 80 === 0 ? 9 : 5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, tickH);
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - tickH);
    }
    for (let y = 40; y < h - 40; y += 16) {
      const tickW = y % 80 === 0 ? 9 : 5;
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
    ctx.fillStyle = 'rgba(243, 196, 118, 0.25)';
    ctx.font = `700 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      'ARCHIVE DOSSIER • CONFIDENTIAL GRAPH • 全球推理文脉考证 • VECTOJS NATIVE',
      w / 2,
      h - 16,
    );

    // 6. Astrolabe & Compass Rose in Lower Right
    this.drawAstrolabe(ctx, w - 170, h - 150, 72);

    // 7. Floating Golden Dust Embers
    this.renderParticles(ctx, w, h);

    ctx.restore();
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

    // Filigree Flourish Curve
    ctx.beginPath();
    ctx.moveTo(6, 26);
    ctx.quadraticCurveTo(6, 6, 26, 6);
    ctx.stroke();

    // Corner Accent Dot
    ctx.fillStyle = Theme.colors.borderActive;
    ctx.beginPath();
    ctx.arc(10, 10, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawAstrolabe(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(243, 196, 118, 0.16)';
    ctx.lineWidth = 1;

    // Rotating Outer and Inner Astrolabe Rings
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();

    // 8-Point Compass Star with slow rotation
    const rot = this.time * 0.08;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + rot;
      const isMain = i % 2 === 0;
      const length = isMain ? r : r * 0.65;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    }
    ctx.stroke();

    // Orbiting bead
    const orbitAngle = this.time * 0.25;
    const obX = cx + Math.cos(orbitAngle) * r * 0.7;
    const obY = cy + Math.sin(orbitAngle) * r * 0.7;
    ctx.fillStyle = Theme.colors.borderActive;
    ctx.beginPath();
    ctx.arc(obX, obY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const p of this.particles) {
      // Mouse avoidance
      const dx = p.x - this.mouseX;
      const dy = p.y - this.mouseY;
      const distSq = dx * dx + dy * dy;
      if (distSq < 14400 && distSq > 0) {
        // 120px radius
        const dist = Math.sqrt(distSq);
        const force = (120 - dist) / 120;
        p.x += (dx / dist) * force * 1.8;
        p.y += (dy / dist) * force * 1.8;
      }

      p.x += p.vx;
      p.y += p.vy;

      // Wrap boundaries
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      // Shimmering alpha
      const alpha = p.alpha * (0.6 + 0.4 * Math.sin(this.time * 2 + p.phase));

      ctx.save();
      ctx.fillStyle = `rgba(255, 217, 142, ${alpha.toFixed(3)})`;
      ctx.shadowColor = '#FFD98E';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
