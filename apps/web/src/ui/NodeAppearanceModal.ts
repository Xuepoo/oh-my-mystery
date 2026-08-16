import { Entity } from '@vectojs/core';
import {
  NODE_TYPES,
  type DistributionMode,
  type NodeStyleSettings,
  type NodeType,
  createDefaultNodeStyleSettings,
} from '../node-style-settings';
import { getCanvasCtx, Theme } from './theme';

const LABELS: Record<NodeType, string> = {
  author: '作家',
  work: '作品',
  award: '奖项',
  character: '角色',
  series: '系列',
  publisher: '出版社',
  genre: '流派',
  other: '其他',
};

interface HitRect {
  action: 'color' | 'smaller' | 'larger' | 'distribution' | 'reset';
  type?: NodeType;
  value?: DistributionMode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class NodeAppearanceModal extends Entity {
  private openState = false;
  private settings: NodeStyleSettings;
  private readonly onChangeCb: (settings: NodeStyleSettings) => void;
  private hits: HitRect[] = [];
  private closeRect = { x: 0, y: 0, w: 44, h: 44 };
  private colorInput: HTMLInputElement | null = null;
  private activeColorType: NodeType | null = null;

  constructor(settings: NodeStyleSettings, onChange: (settings: NodeStyleSettings) => void) {
    super();
    this.id = 'node-appearance-modal';
    this.interactive = true;
    this.settings = this.clone(settings);
    this.onChangeCb = onChange;
  }

  open(): void {
    this.openState = true;
    this.scene.markDirty();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.removeColorInput();
    this.scene.markDirty();
  }

  dispose(): void {
    this.removeColorInput();
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
    const hit = this.hits.find((rect) => this.inRect(x, y, rect));
    if (!hit) return true;
    if (hit.action === 'color' && hit.type) {
      this.openColorPicker(hit.type, hit);
      return true;
    }
    if ((hit.action === 'smaller' || hit.action === 'larger') && hit.type) {
      const delta = hit.action === 'larger' ? 0.1 : -0.1;
      this.settings.sizeMultipliers[hit.type] = Math.max(
        0.5,
        Math.min(2, Math.round((this.settings.sizeMultipliers[hit.type] + delta) * 10) / 10),
      );
    }
    if (hit.action === 'distribution' && hit.value) this.settings.distribution = hit.value;
    if (hit.action === 'reset') this.settings = createDefaultNodeStyleSettings();
    this.commit();
    return true;
  }

  render(r: any): void {
    if (!this.openState) return;
    const ctx = getCanvasCtx(r);
    const w = Math.min(620, this.scene.width - 24);
    const h = Math.min(650, this.scene.height - 24);
    const x = (this.scene.width - w) / 2;
    const y = (this.scene.height - h) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.64)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);
    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();
    this.closeRect = { x: x + w - 54, y: y + 10, w: 44, h: 44 };
    this.drawButton(ctx, this.closeRect, '✕', false);
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 21px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.fillText('节点外观与分布', x + 22, y + 34);
    ctx.fillStyle = Theme.colors.textMuted;
    ctx.font = `400 11px ${Theme.fonts.sans}`;
    ctx.fillText('点击色块选择颜色；大小和布局立即应用并保存', x + 22, y + 57);

    this.hits = [];
    const compact = w < 500;
    const columns = compact ? 1 : 2;
    const gap = 10;
    const rowW = (w - 44 - gap * (columns - 1)) / columns;
    for (let i = 0; i < NODE_TYPES.length; i++) {
      const type = NODE_TYPES[i]!;
      const col = i % columns;
      const row = Math.floor(i / columns);
      const rx = x + 22 + col * (rowW + gap);
      const ry = y + 82 + row * 54;
      ctx.fillStyle = 'rgba(64,51,42,0.82)';
      ctx.beginPath();
      ctx.roundRect(rx, ry, rowW, 46, 7);
      ctx.fill();
      ctx.fillStyle = Theme.colors.textHigh;
      ctx.font = `600 12px ${Theme.fonts.sans}`;
      ctx.fillText(LABELS[type], rx + 12, ry + 23);
      const colorRect = {
        action: 'color' as const,
        type,
        x: rx + rowW - 132,
        y: ry + 7,
        w: 36,
        h: 32,
      };
      this.hits.push(colorRect);
      ctx.fillStyle = this.settings.colors[type];
      ctx.beginPath();
      ctx.roundRect(colorRect.x, colorRect.y, colorRect.w, colorRect.h, 6);
      ctx.fill();
      ctx.strokeStyle = '#FFFDF9';
      ctx.stroke();
      const smaller = {
        action: 'smaller' as const,
        type,
        x: rx + rowW - 88,
        y: ry + 7,
        w: 32,
        h: 32,
      };
      const larger = {
        action: 'larger' as const,
        type,
        x: rx + rowW - 36,
        y: ry + 7,
        w: 32,
        h: 32,
      };
      this.hits.push(smaller, larger);
      this.drawButton(ctx, smaller, '−', false);
      this.drawButton(ctx, larger, '+', false);
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 10px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${this.settings.sizeMultipliers[type].toFixed(1)}×`, rx + rowW - 46, ry + 23);
      ctx.textAlign = 'left';
    }

    const footerY = y + h - 108;
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 12px ${Theme.fonts.sans}`;
    ctx.fillText('节点分布', x + 22, footerY);
    const modes: [DistributionMode, string][] = [
      ['compact', '紧凑'],
      ['balanced', '均衡'],
      ['dispersed', '分散'],
    ];
    const modeW = Math.min(100, (w - 184) / 3);
    modes.forEach(([value, label], index) => {
      const rect = {
        action: 'distribution' as const,
        value,
        x: x + 96 + index * (modeW + 8),
        y: footerY - 18,
        w: modeW,
        h: 40,
      };
      this.hits.push(rect);
      this.drawButton(ctx, rect, label, this.settings.distribution === value);
    });
    const reset = { action: 'reset' as const, x: x + w - 104, y: y + h - 58, w: 82, h: 40 };
    this.hits.push(reset);
    this.drawButton(ctx, reset, '恢复默认', false);
  }

  private openColorPicker(type: NodeType, rect: HitRect): void {
    this.removeColorInput();
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.settings.colors[type];
    input.style.position = 'fixed';
    input.style.left = `${rect.x}px`;
    input.style.top = `${rect.y}px`;
    input.style.width = `${rect.w}px`;
    input.style.height = `${rect.h}px`;
    input.style.opacity = '0';
    input.style.zIndex = '30';
    input.addEventListener('input', () => {
      this.settings.colors[type] = input.value;
      this.commit();
    });
    input.addEventListener('change', () => this.removeColorInput());
    document.body.appendChild(input);
    this.colorInput = input;
    this.activeColorType = type;
    input.click();
  }

  private removeColorInput(): void {
    this.colorInput?.remove();
    this.colorInput = null;
    this.activeColorType = null;
  }

  private commit(): void {
    this.onChangeCb(this.clone(this.settings));
    this.scene.markDirty();
  }

  private clone(settings: NodeStyleSettings): NodeStyleSettings {
    return {
      ...settings,
      colors: { ...settings.colors },
      sizeMultipliers: { ...settings.sizeMultipliers },
    };
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    label: string,
    active: boolean,
  ): void {
    ctx.fillStyle = active ? Theme.colors.borderHighlight : Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.strokeStyle = active ? Theme.colors.borderActive : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = active ? '#1A1715' : Theme.colors.textMid;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  private inRect(
    x: number,
    y: number,
    rect: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }
}
