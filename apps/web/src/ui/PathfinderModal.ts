import { Entity } from '@vectojs/core';
import type { PathfinderResult } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { Theme } from './theme';

export interface PathfinderModalOptions {
  source: D1DataSource;
  onClose: () => void;
  onHighlightPath: (nodeIds: string[], edges: { source: string; target: string }[]) => void;
}

export class PathfinderModal extends Entity {
  private source: D1DataSource;
  private isOpen = false;
  private sourceId = 'wd:Q347412'; // Default Edogawa Ranpo
  private sourceName = '江户川乱步';
  private targetId = 'wd:Q35064'; // Default Agatha Christie
  private targetName = '阿加莎·克里斯蒂';
  private searchLoading = false;
  private pathResult: PathfinderResult | null = null;
  private onCloseCb: () => void;
  private onHighlightPathCb: (
    nodeIds: string[],
    edges: { source: string; target: string }[],
  ) => void;

  private closeBtnRect = { x: 0, y: 0, w: 32, h: 32 };
  private runBtnRect = { x: 0, y: 0, w: 140, h: 38 };
  private highlightBtnRect = { x: 0, y: 0, w: 160, h: 36 };

  constructor(options: PathfinderModalOptions) {
    super();
    this.id = 'pathfinder-modal';
    this.interactive = true;
    this.source = options.source;
    this.onCloseCb = options.onClose;
    this.onHighlightPathCb = options.onHighlightPath;

    this.on('pointerdown', (e: any) => {
      if (!this.isOpen) return;
      this.handleClick(e.clientX, e.clientY);
    });
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.isOpen;
  }

  open(initialSource?: { id: string; name: string }): void {
    if (initialSource) {
      this.sourceId = initialSource.id;
      this.sourceName = initialSource.name;
    }
    this.isOpen = true;
    this.pathResult = null;
    this.executeSearch();
  }

  close(): void {
    this.isOpen = false;
    this.onCloseCb();
  }

  isModalOpen(): boolean {
    return this.isOpen;
  }

  setSource(id: string, name: string): void {
    this.sourceId = id;
    this.sourceName = name;
  }

  setTarget(id: string, name: string): void {
    this.targetId = id;
    this.targetName = name;
  }

  async executeSearch(): Promise<void> {
    this.searchLoading = true;
    this.pathResult = await this.source.findPath(this.sourceId, this.targetId);
    this.searchLoading = false;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isOpen) return;

    const modalWidth = Math.min(580, this.scene.width * 0.92);
    const modalHeight = Math.min(480, this.scene.height * 0.88);
    const modalX = (this.scene.width - modalWidth) / 2;
    const modalY = (this.scene.height - modalHeight) / 2;

    // Dim Background Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, this.scene.width, this.scene.height);

    // Modal Frame
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 30;
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
    ctx.fillText('🔗 侦探关系探路器 (Pathfinder)', modalX + 24, modalY + 22);

    // Close Button
    this.closeBtnRect = { x: modalX + modalWidth - 48, y: modalY + 16, w: 32, h: 32 };
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

    // Source / Target Selection Boxes
    const boxY = modalY + 64;
    const boxW = (modalWidth - 80) / 2;
    const boxH = 50;

    // Source box
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(modalX + 24, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.author;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.author;
    ctx.font = `700 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('起点线索 (SOURCE)', modalX + 36, boxY + 8);

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 14px ${Theme.fonts.serif}`;
    ctx.fillText(this.sourceName, modalX + 36, boxY + 24);

    // Arrow Indicator
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➔', modalX + 24 + boxW + 16, boxY + 25);

    // Target box
    const targetX = modalX + 24 + boxW + 32;
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(targetX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.work;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.work;
    ctx.font = `700 10px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('目标线索 (TARGET)', targetX + 12, boxY + 8);

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 14px ${Theme.fonts.serif}`;
    ctx.fillText(this.targetName, targetX + 12, boxY + 24);

    // Action Trigger Button
    const triggerY = modalY + 126;
    this.runBtnRect = { x: modalX + 24, y: triggerY, w: modalWidth - 48, h: 36 };

    ctx.fillStyle = Theme.colors.bgCardHover;
    ctx.beginPath();
    ctx.roundRect(this.runBtnRect.x, this.runBtnRect.y, this.runBtnRect.w, this.runBtnRect.h, 6);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();

    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `600 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      this.searchLoading ? '正在推演最短关联链条...' : '⚡ 立即推演两个实体之间的关联路径',
      this.runBtnRect.x + this.runBtnRect.w / 2,
      this.runBtnRect.y + 18,
    );

    // Results Display Area
    let curY = modalY + 180;
    const resAreaH = modalHeight - 240;

    if (this.pathResult) {
      if (this.pathResult.found) {
        // Result summary banner
        ctx.fillStyle = Theme.colors.bgCard;
        ctx.beginPath();
        ctx.roundRect(modalX + 24, curY, modalWidth - 48, resAreaH, 8);
        ctx.fill();
        ctx.strokeStyle = Theme.colors.border;
        ctx.stroke();

        ctx.fillStyle = Theme.colors.textHigh;
        ctx.font = `700 14px ${Theme.fonts.serif}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`✓ ${this.pathResult.explanation}`, modalX + 38, curY + 16);

        // Path Nodes Chain
        let nodeY = curY + 48;
        const nodes = this.pathResult.nodes || [];
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]!;
          const labels = n.names?.labels || {};
          const name = labels.zh || labels['zh-cn'] || labels.en || n.id;
          const typeColor = Theme.getNodeColor(n.type);

          // Node pill
          ctx.fillStyle = typeColor;
          ctx.beginPath();
          ctx.roundRect(modalX + 38, nodeY, 80, 22, 4);
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `700 10px ${Theme.fonts.sans}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            Theme.getNodeTypeLabel(n.type).split(' / ')[0]!,
            modalX + 38 + 40,
            nodeY + 11,
          );

          ctx.fillStyle = Theme.colors.textHigh;
          ctx.font = `600 13px ${Theme.fonts.serif}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(name, modalX + 130, nodeY + 11);

          if (i < nodes.length - 1) {
            // Predicate indicator
            const edge = this.pathResult.edges[i];
            const predName = edge ? edge.predicate : '关联';
            ctx.fillStyle = Theme.colors.textLow;
            ctx.font = `500 11px ${Theme.fonts.sans}`;
            ctx.fillText(` ↓ [ ${predName} ]`, modalX + 130, nodeY + 28);
          }

          nodeY += 38;
        }

        // Highlight in Graph Button
        const hY = modalY + modalHeight - 50;
        this.highlightBtnRect = { x: modalX + modalWidth - 184, y: hY, w: 160, h: 34 };
        ctx.fillStyle = Theme.colors.borderHighlight;
        ctx.beginPath();
        ctx.roundRect(
          this.highlightBtnRect.x,
          this.highlightBtnRect.y,
          this.highlightBtnRect.w,
          this.highlightBtnRect.h,
          6,
        );
        ctx.fill();

        ctx.fillStyle = '#1A1715';
        ctx.font = `700 12px ${Theme.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          '✨ 在图谱中高亮线索链',
          this.highlightBtnRect.x + 80,
          this.highlightBtnRect.y + 17,
        );
      } else {
        ctx.fillStyle = Theme.colors.textLow;
        ctx.font = `400 14px ${Theme.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          this.pathResult.explanation || '未发现关联路径',
          modalX + modalWidth / 2,
          curY + resAreaH / 2,
        );
      }
    }
  }

  private handleClick(clientX: number, clientY: number): void {
    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return;
    }

    if (this.isInRect(clientX, clientY, this.runBtnRect)) {
      void this.executeSearch();
      return;
    }

    if (this.isInRect(clientX, clientY, this.highlightBtnRect) && this.pathResult?.found) {
      const nodeIds = this.pathResult.nodes.map((n) => n.id);
      this.onHighlightPathCb(nodeIds, this.pathResult.edges);
      this.close();
      return;
    }
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
