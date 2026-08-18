import { Entity } from '@vectojs/core';
import type { RenderSettings } from '../render-settings';
import { getCanvasCtx, Theme } from './theme';

interface OptionRect {
  group: 'fps' | 'point' | 'particle';
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class RenderSettingsModal extends Entity {
  private openState = false;
  private settings: RenderSettings;
  private displayHz = 60;
  private optionRects: OptionRect[] = [];
  private closeRect = { x: 0, y: 0, w: 32, h: 32 };
  private appearanceRect = { x: 0, y: 0, w: 120, h: 40 };
  private clearSessionRect = { x: 0, y: 0, w: 120, h: 40 };
  private onChangeCb: (settings: RenderSettings, backendChanged: boolean) => void;
  private onOpenAppearanceCb?: () => void;
  private onClearSessionCb?: () => void;

  constructor(
    settings: RenderSettings,
    onChange: (settings: RenderSettings, backendChanged: boolean) => void,
    onOpenAppearance?: () => void,
    onClearSession?: () => void,
  ) {
    super();
    this.id = 'render-settings-modal';
    this.interactive = true;
    this.settings = { ...settings };
    this.onChangeCb = onChange;
    this.onOpenAppearanceCb = onOpenAppearance;
    this.onClearSessionCb = onClearSession;
  }

  open(displayHz: number): void {
    this.displayHz = displayHz;
    this.openState = true;
    this.scene.markDirty();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.scene.markDirty();
  }

  isModalOpen(): boolean {
    return this.openState;
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.openState;
  }

  handleClick(x: number, y: number): boolean {
    if (!this.openState) return false;
    if (this.inRect(x, y, this.closeRect)) {
      this.close();
      return true;
    }
    if (this.onOpenAppearanceCb && this.inRect(x, y, this.appearanceRect)) {
      this.close();
      this.onOpenAppearanceCb();
      return true;
    }
    if (this.onClearSessionCb && this.inRect(x, y, this.clearSessionRect)) {
      this.close();
      this.onClearSessionCb();
      return true;
    }
    for (const rect of this.optionRects) {
      if (!this.inRect(x, y, rect)) continue;
      const next = { ...this.settings };
      if (rect.group === 'fps')
        next.fps = rect.value === 'max' ? 'max' : (Number(rect.value) as 60 | 120);
      if (rect.group === 'point') next.pointBackend = rect.value as RenderSettings['pointBackend'];
      if (rect.group === 'particle')
        next.particleBackend = rect.value as RenderSettings['particleBackend'];
      const backendChanged =
        next.pointBackend !== this.settings.pointBackend ||
        next.particleBackend !== this.settings.particleBackend;
      this.settings = next;
      this.onChangeCb(next, backendChanged);
      this.scene.markDirty();
      return true;
    }
    return true;
  }

  render(r: any): void {
    if (!this.openState) return;
    const ctx = getCanvasCtx(r);
    const w = Math.min(560, this.scene.width - 32);
    // Footer buttons start at y + h - 58; the last option row ends at y + 338.
    // Keep a 14px gap between them and a comfortable bottom margin.
    const h = 410;
    const x = (this.scene.width - w) / 2;
    const y = Math.max(76, (this.scene.height - h) / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.closeRect = { x: x + w - 48, y: y + 16, w: 32, h: 32 };
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(this.closeRect.x, this.closeRect.y, 32, 32, 6);
    ctx.fill();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeRect.x + 16, this.closeRect.y + 16);
    ctx.textAlign = 'left';
    ctx.font = `700 22px ${Theme.fonts.serif}`;
    ctx.fillText('渲染设置', x + 24, y + 34);
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `400 11px ${Theme.fonts.sans}`;
    ctx.fillText(`保守估算刷新率 ${this.displayHz} Hz · 空闲时仍保持零绘制`, x + 24, y + 58);
    this.optionRects = [];
    this.drawGroup(
      ctx,
      x + 24,
      y + 88,
      w - 48,
      '帧率上限',
      'fps',
      [
        ['60', '60 FPS'],
        ['120', '120 FPS'],
        ['max', `Max FPS (${this.displayHz})`],
      ],
      String(this.settings.fps),
    );
    this.drawGroup(
      ctx,
      x + 24,
      y + 184,
      w - 48,
      '节点渲染器',
      'point',
      [
        ['canvas', 'Canvas 2D'],
        ['webgl', 'WebGL 2'],
      ],
      this.settings.pointBackend,
    );
    this.drawGroup(
      ctx,
      x + 24,
      y + 280,
      w - 48,
      '粒子 / 计算加速',
      'particle',
      [
        ['webgpu', 'WebGPU (默认)'],
        ['cpu', 'CPU fallback'],
      ],
      this.settings.particleBackend,
    );
    if (this.onOpenAppearanceCb) {
      this.appearanceRect = { x: x + 24, y: y + h - 58, w: 120, h: 40 };
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(
        this.appearanceRect.x,
        this.appearanceRect.y,
        this.appearanceRect.w,
        this.appearanceRect.h,
        7,
      );
      ctx.fill();
      ctx.strokeStyle = Theme.colors.borderHighlight;
      ctx.stroke();
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('节点外观', this.appearanceRect.x + 60, this.appearanceRect.y + 20);
    }
    if (this.onClearSessionCb) {
      this.clearSessionRect = { x: x + 160, y: y + h - 58, w: 120, h: 40 };
      this.drawButton(ctx, this.clearSessionRect, '清除会话', false);
    }
  }

  private drawGroup(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    title: string,
    group: OptionRect['group'],
    options: string[][],
    selected: string,
  ): void {
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.fillText(title, x, y);
    const gap = 10;
    const optionW = (w - gap * (options.length - 1)) / options.length;
    options.forEach(([value, label], index) => {
      const rect = {
        group,
        value: value!,
        x: x + index * (optionW + gap),
        y: y + 16,
        w: optionW,
        h: 42,
      };
      this.optionRects.push(rect);
      ctx.fillStyle = selected === value ? Theme.colors.borderHighlight : Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
      ctx.fill();
      ctx.strokeStyle = selected === value ? Theme.colors.borderActive : Theme.colors.border;
      ctx.stroke();
      ctx.fillStyle = selected === value ? '#1A1715' : Theme.colors.textMid;
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.fillText(label!, rect.x + rect.w / 2, rect.y + rect.h / 2);
    });
  }

  private inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    active: boolean,
  ): void {
    ctx.fillStyle = active ? Theme.colors.borderHighlight : Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = active ? Theme.colors.borderActive : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = active ? '#1A1715' : Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
}
