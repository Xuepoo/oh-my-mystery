import { Entity } from '@vectojs/core';
import type { PathfinderResult } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { getCanvasCtx, Theme } from './theme';

export interface PathfinderModalOptions {
  source: D1DataSource;
  onClose: () => void;
  onHighlightPath: (nodeIds: string[], edges: { source: string; target: string }[]) => void;
}

interface PresetPair {
  label: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  rect?: { x: number; y: number; w: number; h: number };
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
  private searchEpoch = 0;
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private onCloseCb: () => void;
  private onHighlightPathCb: (
    nodeIds: string[],
    edges: { source: string; target: string }[],
  ) => void;

  private presets: PresetPair[] = [
    {
      label: '道尔 ⟷ 乱步',
      sourceId: 'wd:Q35610',
      sourceName: '阿瑟·柯南·道尔',
      targetId: 'wd:Q347412',
      targetName: '江户川乱步',
    },
    {
      label: '阿加莎 ⟷ 东野圭吾',
      sourceId: 'wd:Q35064',
      sourceName: '阿加莎·克里斯蒂',
      targetId: 'wd:Q125970',
      targetName: '东野圭吾',
    },
    {
      label: '横沟正史 ⟷ 绫辻行人',
      sourceId: 'wd:Q1071279',
      sourceName: '横沟正史',
      targetId: 'wd:Q1074744',
      targetName: '绫辻行人',
    },
    {
      label: '奎因 ⟷ 岛田庄司',
      sourceId: 'wd:Q849201',
      sourceName: '埃勒里·奎因',
      targetId: 'wd:Q862215',
      targetName: '岛田庄司',
    },
  ];

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
    this.scene.markDirty();
    void this.executeSearch();
  }

  close(): void {
    this.isOpen = false;
    this.onCloseCb();
    this.scene.markDirty();
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
    if (this.searchLoading) return;
    const epoch = ++this.searchEpoch;
    this.searchLoading = true;
    this.pathResult = null;
    this.scene.markDirty();
    try {
      const result = await this.source.findPath(this.sourceId, this.targetId);
      if (epoch !== this.searchEpoch) return;
      this.pathResult = result;
    } catch (err) {
      if (epoch !== this.searchEpoch) return;
      console.error('findPath failed', err);
      this.pathResult = null;
    } finally {
      if (epoch === this.searchEpoch) {
        this.searchLoading = false;
        this.scene.markDirty();
      }
    }
  }

  render(r: any): void {
    if (!this.isOpen) return;

    const ctx = getCanvasCtx(r);
    const modalWidth = Math.min(620, this.scene.width * 0.92);
    const modalHeight = Math.min(520, this.scene.height * 0.9);
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
    ctx.fillText('🔗 侦探关系探路器 (Pathfinder)', modalX + 24, modalY + 22);

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

    // Preset Exploration Buttons
    let presetX = modalX + 24;
    const presetY = modalY + 54;
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('经典探案链:', presetX, presetY + 12);
    presetX += 72;

    for (const p of this.presets) {
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      const metrics = ctx.measureText(p.label);
      const btnW = metrics.width + 16;
      const btnH = 24;
      p.rect = { x: presetX, y: presetY, w: btnW, h: btnH };

      const isSelected = p.sourceId === this.sourceId && p.targetId === this.targetId;
      ctx.fillStyle = isSelected ? Theme.colors.bgCardHover : 'rgba(28, 24, 22, 0.7)';
      ctx.beginPath();
      ctx.roundRect(presetX, presetY, btnW, btnH, 4);
      ctx.fill();
      ctx.strokeStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.border;
      ctx.stroke();

      ctx.fillStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.textMid;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, presetX + btnW / 2, presetY + 12);

      presetX += btnW + 8;
    }

    // Source / Target Selection Boxes
    const boxY = modalY + 90;
    const boxW = (modalWidth - 80) / 2;
    const boxH = 48;

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
    ctx.fillText('起点线索 (SOURCE)', modalX + 36, boxY + 7);

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 13px ${Theme.fonts.serif}`;
    ctx.fillText(this.sourceName, modalX + 36, boxY + 23);

    // Arrow Indicator
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➔', modalX + 24 + boxW + 16, boxY + 24);

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
    ctx.fillText('目标线索 (TARGET)', targetX + 12, boxY + 7);

    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 13px ${Theme.fonts.serif}`;
    ctx.fillText(this.targetName, targetX + 12, boxY + 23);

    // Action Trigger Button
    const triggerY = modalY + 148;
    this.runBtnRect = {
      x: modalX + 24,
      y: triggerY,
      w: modalWidth - 48,
      h: 36,
    };

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
    const curY = modalY + 196;
    const resAreaH = Math.max(80, modalHeight - 256);

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
        ctx.font = `700 13px ${Theme.fonts.serif}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`✓ ${this.pathResult.explanation}`, modalX + 38, curY + 14);

        // Path Nodes Chain (clipped to the results area)
        ctx.save();
        ctx.beginPath();
        ctx.rect(modalX + 24, curY, modalWidth - 48, resAreaH);
        ctx.clip();
        let nodeY = curY + 42;
        const nodes = this.pathResult.nodes || [];
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]!;
          const labels = n.names?.labels || {};
          const name = labels.zh || labels['zh-cn'] || labels.en || n.id;
          const typeColor = Theme.getNodeColor(n.type);

          // Node pill
          ctx.fillStyle = typeColor;
          ctx.beginPath();
          ctx.roundRect(modalX + 38, nodeY, 76, 20, 4);
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `700 10px ${Theme.fonts.sans}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            Theme.getNodeTypeLabel(n.type).split(' / ')[0]!,
            modalX + 38 + 38,
            nodeY + 10,
          );

          ctx.fillStyle = Theme.colors.textHigh;
          ctx.font = `600 13px ${Theme.fonts.serif}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(name, modalX + 126, nodeY + 10);

          if (i < nodes.length - 1) {
            // Predicate indicator
            const edge = this.pathResult.edges[i];
            const predName = edge ? edge.predicate : '关联';
            ctx.fillStyle = Theme.colors.borderHighlight;
            ctx.font = `600 11px ${Theme.fonts.sans}`;
            ctx.fillText(` ↓ [ ${predName} ]`, modalX + 126, nodeY + 24);
          }

          nodeY += 34;
        }
        ctx.restore();

        // Highlight in Graph Button
        const hY = modalY + modalHeight - 48;
        this.highlightBtnRect = {
          x: modalX + modalWidth - 184,
          y: hY,
          w: 160,
          h: 34,
        };
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
        ctx.fillStyle = Theme.colors.textMid;
        ctx.font = `500 14px ${Theme.fonts.sans}`;
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

  public handleClick(clientX: number, clientY: number): boolean {
    if (!this.isOpen) return false;

    if (this.isInRect(clientX, clientY, this.closeBtnRect)) {
      this.close();
      return true;
    }

    // Check Preset buttons
    for (const p of this.presets) {
      if (p.rect && this.isInRect(clientX, clientY, p.rect)) {
        this.sourceId = p.sourceId;
        this.sourceName = p.sourceName;
        this.targetId = p.targetId;
        this.targetName = p.targetName;
        void this.executeSearch();
        return true;
      }
    }

    if (this.isInRect(clientX, clientY, this.runBtnRect)) {
      void this.executeSearch();
      return true;
    }

    if (this.isInRect(clientX, clientY, this.highlightBtnRect) && this.pathResult?.found) {
      const nodeIds = (this.pathResult.nodes || []).map((n) => n.id);
      this.onHighlightPathCb(nodeIds, this.pathResult.edges || []);
      this.close();
      return true;
    }

    if (!this.isInRect(clientX, clientY, this.modalRect)) {
      this.close();
      return true;
    }

    return true; // Click inside modal absorbed
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
