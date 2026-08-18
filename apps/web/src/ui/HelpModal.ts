import { Entity, type A11yAttributes } from '@vectojs/core';
import { getCanvasCtx, Theme } from './theme';
import { truncateText, wrapText, withClip } from './text-layout';
import { EXTERNAL_LINKS, openAllowedExternalLink } from './external-links';

interface HelpSection {
  icon: string;
  title: string;
  lines: string[];
}

const JOIN_LINKS = [
  { label: 'OMM GitHub', url: EXTERNAL_LINKS.omm },
  { label: 'VectoJS GitHub', url: EXTERNAL_LINKS.vectojs },
] as const;

export function getHelpModalLayout(
  width: number,
  height: number,
): {
  modal: { x: number; y: number; w: number; h: number };
  columns: number;
  sectionHeight: number;
  sectionGap: number;
  sectionsY: number;
  join: { x: number; y: number; w: number; h: number };
  footerY: number | null;
  compact: boolean;
} {
  const w = Math.max(0, Math.min(640, width - 24));
  const h = Math.max(0, Math.min(680, height - 24));
  const modal = { x: (width - w) / 2, y: (height - h) / 2, w, h };
  const compact = h < 400;
  const columns = w >= 300 ? 2 : 1;
  const rows = Math.ceil(SECTIONS.length / columns);
  const sectionGap = h < 500 ? 6 : 8;
  const sectionsY = modal.y + 58;
  const footerY = compact ? null : modal.y + modal.h - 22;
  const contentX = modal.x + 24;
  const contentW = Math.max(0, modal.w - 48);
  const joinH = compact ? 42 : h < 500 ? 50 : contentW < 390 ? 84 : 56;
  const contentBottom = footerY ?? modal.y + modal.h - 10;
  const available = contentBottom - 10 - joinH - 8 - sectionsY - sectionGap * (rows - 1);
  const sectionHeight = Math.max(28, Math.min(132, available / rows));
  const joinY = sectionsY + rows * sectionHeight + (rows - 1) * sectionGap + 8;
  return {
    modal,
    columns,
    sectionHeight,
    sectionGap,
    sectionsY,
    join: { x: contentX, y: joinY, w: contentW, h: joinH },
    footerY,
    compact,
  };
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
      '环形菜单支持固定/隐藏/重排/展开/档案',
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

class HelpTarget extends Entity {
  constructor(
    private readonly label: string,
    private readonly activate: () => void,
    private readonly url?: string,
  ) {
    super();
    this.interactive = true;
    this.a11yHidden = true;
    this.on('click', (event) => {
      event.preventDefault?.();
      this.activate();
    });
  }

  getA11yAttributes(): A11yAttributes {
    return this.url
      ? {
          tag: 'a',
          label: this.label,
          href: this.url,
          target: '_blank',
          pointerEvents: 'auto',
        }
      : { tag: 'button', role: 'button', label: this.label, pointerEvents: 'auto' };
  }

  isPointInside(): boolean {
    return false;
  }

  render(): void {}
}

export class HelpModal extends Entity {
  private isOpen = false;
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private joinRects: { x: number; y: number; w: number; h: number; url: string }[] = [];
  private linkTargets = JOIN_LINKS.map(
    (link) => new HelpTarget(link.label, () => openAllowedExternalLink(link.url), link.url),
  );
  private closeTarget = new HelpTarget('关闭使用指南', () => this.close());
  private previousFocus: HTMLElement | null = null;

  constructor(private readonly onOpenChange: (open: boolean) => void = () => {}) {
    super();
    this.id = 'help-modal';
    this.interactive = true;
    this.a11yFullViewport = true;
    this.a11yHidden = true;
    this.add(this.closeTarget, ...this.linkTargets);
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.isOpen;
  }

  open(): void {
    this.previousFocus =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.isOpen = true;
    this.a11yHidden = false;
    this.closeTarget.a11yHidden = false;
    for (const target of this.linkTargets) target.a11yHidden = false;
    this.onOpenChange(true);
    this.scene.markDirty();
    this.closeTarget.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.a11yHidden = true;
    this.closeTarget.a11yHidden = true;
    for (const target of this.linkTargets) target.a11yHidden = true;
    this.onOpenChange(false);
    this.scene.markDirty();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  isModalOpen(): boolean {
    return this.isOpen;
  }

  getA11yAttributes(): A11yAttributes {
    return {
      role: 'dialog',
      label: 'OMM 使用指南',
      ariaModal: 'true',
      pointerEvents: 'none',
    };
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
    for (const link of this.joinRects) {
      if (this.isInRect(clientX, clientY, link)) {
        openAllowedExternalLink(link.url);
        return true;
      }
    }
    return true;
  }

  render(r: { width: number; height: number }): void {
    if (!this.isOpen) return;

    const ctx = getCanvasCtx(r);
    const layout = getHelpModalLayout(this.scene.width, this.scene.height);
    const { x: modalX, y: modalY, w: modalWidth, h: modalHeight } = layout.modal;
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
    this.closeTarget.x = this.closeBtnRect.x;
    this.closeTarget.y = this.closeBtnRect.y;
    this.closeTarget.width = this.closeBtnRect.w;
    this.closeTarget.height = this.closeBtnRect.h;
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
    const twoCol = layout.columns === 2;
    const colW = twoCol ? (contentW - 16) / 2 : contentW;
    const colGap = twoCol ? 16 : 0;
    const lineH = layout.compact ? 15 : 20;
    this.joinRects = [];
    ctx.font = `500 12px ${Theme.fonts.sans}`;
    const preparedSections = SECTIONS.map((section) => {
      const sourceLines = layout.compact ? section.lines.slice(0, 1) : section.lines;
      const lines = sourceLines.flatMap((line) =>
        wrapText(ctx, line, colW - 24, layout.compact ? 1 : twoCol ? 1 : 2),
      );
      return { section, lines };
    });
    for (let i = 0; i < SECTIONS.length; i++) {
      const prepared = preparedSections[i]!;
      const s = prepared.section;
      const col = twoCol ? i % 2 : 0;
      const row = twoCol ? Math.floor(i / 2) : i;
      const secX = contentX + col * (colW + colGap);
      const preparedLines = prepared.lines;
      const secH = layout.sectionHeight;
      const secY = layout.sectionsY + row * (secH + layout.sectionGap);

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
      const titleY = layout.compact ? secY + 7 : secY + 12;
      const bodyY = layout.compact ? secY + 25 : secY + 34;
      ctx.fillText(truncateText(ctx, `${s.icon} ${s.title}`, colW - 24), secX + 12, titleY);

      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `500 12px ${Theme.fonts.sans}`;
      withClip(ctx, { x: secX + 8, y: bodyY - 2, w: colW - 16, h: secH - (bodyY - secY) }, () => {
        for (let li = 0; li < preparedLines.length; li++) {
          ctx.fillText(preparedLines[li]!, secX + 12, bodyY + li * lineH);
        }
      });
    }

    // Join Us is deliberately a fixed allowlist, not user-provided navigation.
    const joinY = layout.join.y;
    const joinH = layout.join.h;
    const compactJoin = contentW < 390 && joinH >= 70;
    const joinX = layout.join.x;
    ctx.fillStyle = 'rgba(28, 24, 22, 0.55)';
    ctx.beginPath();
    ctx.roundRect(joinX, joinY, contentW, joinH, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 12px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🤝 加入我们', joinX + 12, joinY + 9);
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    JOIN_LINKS.forEach((link, index) => {
      const linkW = compactJoin ? (contentW - 34) / 2 : Math.min(108, (contentW - 132) / 2);
      const linkRect = {
        x: compactJoin ? joinX + 12 + index * (linkW + 10) : joinX + 112 + index * (linkW + 8),
        y: compactJoin ? joinY + 32 : joinY + 8,
        w: linkW,
        h: 24,
        url: link.url,
      };
      this.joinRects.push(linkRect);
      const target = this.linkTargets[index]!;
      target.x = linkRect.x;
      target.y = linkRect.y;
      target.width = linkRect.w;
      target.height = linkRect.h;
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(linkRect.x, linkRect.y, linkRect.w, linkRect.h, 5);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.border;
      ctx.stroke();
      ctx.fillStyle = Theme.colors.textMid;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(link.label, linkRect.x + linkRect.w / 2, linkRect.y + 12);
    });
    ctx.fillStyle = Theme.colors.textLow;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('QQ群: 1065814686', compactJoin ? joinX + 12 : joinX + 112, joinY + joinH - 18);

    if (layout.footerY !== null) {
      ctx.fillStyle = Theme.colors.textLow;
      ctx.font = `500 11px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        '所有操作都在画布内完成 · 点击本卡片外任意处关闭',
        modalX + modalWidth / 2,
        layout.footerY,
      );
    }
  }
}
