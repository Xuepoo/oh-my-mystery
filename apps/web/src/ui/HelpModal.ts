import { Entity } from '@vectojs/core';
import { getCanvasCtx, Theme } from './theme';

interface HelpSection {
  icon: string;
  title: string;
  lines: string[];
}

const SECTIONS: HelpSection[] = [
  {
    icon: '🧭',
    title: '画布导航',
    lines: [
      '拖拽空白处平移画布 · 松手有惯性滑动',
      '滚轮缩放 · 触屏双指捏合缩放/平移',
      '双击空白处重置视角 · 右下角按钮可适应视图 / 冻结动画',
    ],
  },
  {
    icon: '🕵️',
    title: '节点探索',
    lines: [
      '点击节点打开档案抽屉(生平/事实/推荐)',
      '双击/双击触屏节点展开或收起一跳邻居',
      '右键或长按节点打开操作圆环菜单',
      '圆环支持固定/隐藏/重排/两跳探索/档案',
      '点住的节点会被钉住,拖拽可自由摆放',
    ],
  },
  {
    icon: '🔍',
    title: '搜索与筛选',
    lines: [
      '按 / 聚焦搜索框,支持中文/日文/英文',
      '顶部类型药丸(作家/作品/奖项…)过滤图谱',
      '点击搜索结果直达实体',
    ],
  },
  {
    icon: '🔗',
    title: '推理工具',
    lines: [
      '关系探路:推演任意两个实体间的最短关联链',
      '编年史导览:按时间线叙事漫游黄金时代',
      '小地图:定位全局位置,点击跳转',
    ],
  },
  {
    icon: '⌨️',
    title: '快捷键',
    lines: [
      '/ 聚焦搜索 · ? 打开本帮助',
      'Esc 依次关闭 面板/抽屉/搜索下拉',
      'Ctrl/Cmd+S、P 已拦截(防误存页面)',
    ],
  },
];

export class HelpModal extends Entity {
  private isOpen = false;
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };

  constructor() {
    super();
    this.id = 'help-modal';
    this.interactive = true;
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.isOpen;
  }

  open(): void {
    this.isOpen = true;
    this.scene.markDirty();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.scene.markDirty();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  isModalOpen(): boolean {
    return this.isOpen;
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  handleClick(clientX: number, clientY: number): boolean {
    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return true;
    }
    if (!this.isInRect(clientX, clientY, this.modalRect)) {
      this.close();
      return true;
    }
    return true;
  }

  render(r: { width: number; height: number }): void {
    if (!this.isOpen) return;

    const ctx = getCanvasCtx(r);
    const modalWidth = Math.min(640, this.scene.width * 0.92);
    const modalHeight = Math.min(600, this.scene.height * 0.92);
    const modalX = (this.scene.width - modalWidth) / 2;
    const modalY = (this.scene.height - modalHeight) / 2;
    this.modalRect = { x: modalX, y: modalY, w: modalWidth, h: modalHeight };

    // Dim Background Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);

    // Modal Frame
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 32;
    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(modalX, modalY, modalWidth, modalHeight, 12);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Header Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 18px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🕯️ OMM 使用指南', modalX + 24, modalY + 22);

    // Close Button
    this.closeBtnRect = {
      x: modalX + modalWidth - 48,
      y: modalY + 16,
      w: 32,
      h: 32,
    };
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(this.closeBtnRect.x, this.closeBtnRect.y, 32, 32, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `600 15px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', this.closeBtnRect.x + 16, this.closeBtnRect.y + 16);

    // Content Sections (two-column layout on wide modals)
    const contentX = modalX + 24;
    const contentW = modalWidth - 48;
    const twoCol = modalWidth >= 480;
    const colW = twoCol ? (contentW - 16) / 2 : contentW;
    const colGap = twoCol ? 16 : 0;
    const lineH = 20;
    const sectionPad = 12;

    let curY = modalY + 58;
    for (let i = 0; i < SECTIONS.length; i++) {
      const s = SECTIONS[i]!;
      const col = twoCol ? i % 2 : 0;
      const secX = contentX + col * (colW + colGap);
      const secH = sectionPad * 2 + 22 + s.lines.length * lineH;
      const secY = curY;

      // Section card
      ctx.fillStyle = 'rgba(28, 24, 22, 0.55)';
      ctx.beginPath();
      ctx.roundRect(secX, secY, colW, secH, 8);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = Theme.colors.textHigh;
      ctx.font = `700 13px ${Theme.fonts.serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${s.icon} ${s.title}`, secX + 12, secY + 12);

      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `500 12px ${Theme.fonts.sans}`;
      for (let li = 0; li < s.lines.length; li++) {
        ctx.fillText(s.lines[li]!, secX + 12, secY + 34 + li * lineH);
      }

      if (!twoCol || col === 1) curY += secH + 12;
    }

    // Footer hint
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(
      '所有操作都在画布内完成 · 点击本卡片外任意处关闭',
      modalX + modalWidth / 2,
      modalY + modalHeight - 30,
    );
  }
}
