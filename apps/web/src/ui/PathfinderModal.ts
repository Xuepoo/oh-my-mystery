import { Entity } from '@vectojs/core';
import type { EntityType, PathfinderResult, SearchResultItem } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { pickNodeLabel } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';
import { truncateText } from './text-layout';

export interface PathfinderModalOptions {
  source: D1DataSource;
  onClose: () => void;
  onHighlightPath?: (nodeIds: string[], edges: { source: string; target: string }[]) => void;
  onPathResult?: (result: PathfinderResult) => void;
}

interface PresetPair {
  label: string;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  rect?: { x: number; y: number; w: number; h: number };
}

interface ConfirmedEntity {
  id: string;
  name: string;
  type: EntityType;
}

interface EndpointState {
  text: string;
  confirmed: ConfirmedEntity | null;
  suggestions: SearchResultItem[];
  epoch: number;
  selectedIndex: number;
  composing: boolean;
}

export class PathfinderModal extends Entity {
  private source: D1DataSource;
  private isOpen = false;
  private sourceId = 'wd:Q347412';
  private sourceName = '江户川乱步';
  private targetId = 'wd:Q35064';
  private targetName = '阿加莎·克里斯蒂';
  private sourceState: EndpointState = this.createEndpointState(this.sourceId, this.sourceName);
  private targetState: EndpointState = this.createEndpointState(this.targetId, this.targetName);
  private searchLoading = false;
  private pathResult: PathfinderResult | null = null;
  private searchEpoch = 0;
  private modalRect = { x: 0, y: 0, w: 0, h: 0 };
  private onCloseCb: () => void;
  private onHighlightPathCb: (
    nodeIds: string[],
    edges: { source: string; target: string }[],
  ) => void;
  private onPathResultCb?: (result: PathfinderResult) => void;
  private sourceInput: HTMLInputElement | null = null;
  private targetInput: HTMLInputElement | null = null;
  private inputContainer: HTMLElement | null = null;
  private closeEpoch = 0;
  private statusMessage = '';
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
    this.onHighlightPathCb = options.onHighlightPath || (() => {});
    this.onPathResultCb = options.onPathResult;
  }

  isPointInside(_x: number, _y: number): boolean {
    return this.isOpen;
  }

  open(initialSource?: { id: string; name: string }): void {
    this.searchEpoch++;
    this.searchLoading = false;
    if (initialSource) {
      this.sourceId = initialSource.id;
      this.sourceName = initialSource.name;
      this.sourceState = this.createEndpointState(initialSource.id, initialSource.name);
    }
    this.isOpen = true;
    this.pathResult = null;
    this.statusMessage = '';
    this.ensureDomInputs();
    this.scene.markDirty();
  }

  close(): void {
    this.isOpen = false;
    this.closeEpoch++;
    this.searchEpoch++;
    this.searchLoading = false;
    this.pathResult = null;
    this.sourceState.epoch++;
    this.targetState.epoch++;
    this.removeDomInputs();
    this.onCloseCb();
    this.scene.markDirty();
  }

  isModalOpen(): boolean {
    return this.isOpen;
  }

  setSource(id: string, name: string): void {
    this.sourceId = id;
    this.sourceName = name;
    this.sourceState = this.createEndpointState(id, name);
    this.syncDomInput(this.sourceInput, this.sourceState);
  }

  setTarget(id: string, name: string): void {
    this.targetId = id;
    this.targetName = name;
    this.targetState = this.createEndpointState(id, name);
    this.syncDomInput(this.targetInput, this.targetState);
  }

  async executeSearch(): Promise<void> {
    const epoch = ++this.searchEpoch;
    const closeEpoch = this.closeEpoch;
    this.searchLoading = true;
    this.pathResult = null;
    this.scene.markDirty();

    await this.resolveEndpoint('source');
    await this.resolveEndpoint('target');
    if (epoch !== this.searchEpoch || closeEpoch !== this.closeEpoch || !this.isOpen) return;

    const source = this.sourceState.confirmed;
    const target = this.targetState.confirmed;
    if (!source || !target) {
      const unresolved = !source
        ? this.sourceState.text.trim() || '起点'
        : this.targetState.text.trim() || '目标';
      this.statusMessage = `未找到「${unresolved}」的匹配实体，请检查输入或从搜索建议中选择`;
      this.searchLoading = false;
      this.scene.markDirty();
      return;
    }
    if (source.id === target.id) {
      this.statusMessage = '起点和目标不能是同一个实体';
      this.pathResult = null;
      this.searchLoading = false;
      this.scene.markDirty();
      return;
    }
    try {
      const result = await this.source.findPath(source.id, target.id);
      if (epoch !== this.searchEpoch || closeEpoch !== this.closeEpoch || !this.isOpen) return;
      this.pathResult = result;
      this.statusMessage = result ? '' : '路径推演失败，请稍后重试';
      if (result?.found) this.onPathResultCb?.(result);
    } catch (err) {
      if (epoch !== this.searchEpoch || closeEpoch !== this.closeEpoch || !this.isOpen) return;
      console.error('findPath failed', err);
      this.pathResult = null;
    } finally {
      if (epoch === this.searchEpoch) {
        this.searchLoading = false;
        this.scene.markDirty();
      }
    }
  }

  public dispose(): void {
    this.closeEpoch++;
    this.searchEpoch++;
    this.searchLoading = false;
    this.removeDomInputs();
  }

  private async resolveEndpoint(endpoint: 'source' | 'target'): Promise<void> {
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    if (state.confirmed) return;
    const text = state.text.trim();
    if (!text) return;
    if (/^(?:wd:Q\d+|douban:.+)$/i.test(text)) {
      await this.confirmDirectId(endpoint, text, state.epoch, false);
      return;
    }
    if (state.suggestions.length === 0) {
      await this.searchEndpoint(endpoint, text, state.epoch);
    }
    const top =
      state.selectedIndex >= 0 ? state.suggestions[state.selectedIndex] : state.suggestions[0];
    if (top) this.confirmEndpoint(endpoint, top, false);
  }

  private createEndpointState(id: string, name: string): EndpointState {
    return {
      text: name,
      confirmed: { id, name, type: 'author' },
      suggestions: [],
      epoch: 0,
      selectedIndex: -1,
      composing: false,
    };
  }

  private ensureDomInputs(): void {
    if (typeof document === 'undefined' || this.inputContainer) return;
    this.inputContainer = document.createElement('div');
    this.inputContainer.setAttribute('aria-hidden', 'false');
    Object.assign(this.inputContainer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '20',
    });
    const container = document.getElementById('app-container') || document.body;
    container.appendChild(this.inputContainer);
    this.sourceInput = this.createInput('source', this.sourceState);
    this.targetInput = this.createInput('target', this.targetState);
    this.inputContainer.append(this.sourceInput, this.targetInput);
  }

  private createInput(endpoint: 'source' | 'target', state: EndpointState): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', endpoint === 'source' ? '起点线索' : '目标线索');
    Object.assign(input.style, {
      position: 'absolute',
      pointerEvents: 'auto',
      background: 'transparent',
      color: Theme.colors.textHigh,
      border: '0',
      outline: 'none',
      padding: '0',
      font: `600 13px ${Theme.fonts.serif}`,
      boxSizing: 'border-box',
    });
    input.value = state.text;
    input.addEventListener('compositionstart', () => {
      state.composing = true;
    });
    input.addEventListener('compositionend', () => {
      state.composing = false;
      this.onEndpointInput(endpoint, input.value);
    });
    input.addEventListener('input', () => {
      if (!state.composing) this.onEndpointInput(endpoint, input.value);
    });
    input.addEventListener('keydown', (event) => this.onEndpointKeydown(endpoint, event));
    return input;
  }

  private onEndpointInput(endpoint: 'source' | 'target', text: string): void {
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    state.text = text;
    state.confirmed = null;
    state.suggestions = [];
    state.selectedIndex = -1;
    const epoch = ++state.epoch;
    this.searchEpoch++;
    this.searchLoading = false;
    this.pathResult = null;
    this.statusMessage = '';
    const directId = /^(?:wd:Q\d+|douban:.+)$/i.test(text.trim());
    if (!text.trim()) {
      this.scene.markDirty();
      return;
    }
    if (directId) {
      void this.confirmDirectId(endpoint, text.trim(), epoch);
      return;
    }
    void this.searchEndpoint(endpoint, text.trim(), epoch);
    this.scene.markDirty();
  }

  private async confirmDirectId(
    endpoint: 'source' | 'target',
    id: string,
    epoch: number,
    bumpEpoch = true,
  ): Promise<void> {
    const closeEpoch = this.closeEpoch;
    const [entity] = await this.source.getNodes([id]);
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    if (epoch !== state.epoch || closeEpoch !== this.closeEpoch || !this.isOpen) return;
    if (!entity) {
      this.statusMessage = `未找到实体 ${id}`;
      this.scene.markDirty();
      return;
    }
    this.confirmEndpoint(
      endpoint,
      {
        id: entity.id,
        name: this.entityName(entity),
        type: entity.type as EntityType,
      },
      bumpEpoch,
    );
  }

  private async searchEndpoint(
    endpoint: 'source' | 'target',
    query: string,
    epoch: number,
  ): Promise<void> {
    const closeEpoch = this.closeEpoch;
    const response = await this.source.search(query);
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    if (epoch !== state.epoch || closeEpoch !== this.closeEpoch || !this.isOpen) return;
    state.suggestions = response.results;
    state.selectedIndex = response.results.length ? 0 : -1;
    this.scene.markDirty();
  }

  private confirmEndpoint(
    endpoint: 'source' | 'target',
    item: ConfirmedEntity,
    bumpEpoch = true,
  ): void {
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    state.confirmed = item;
    state.text = item.name;
    state.suggestions = [];
    state.selectedIndex = -1;
    if (bumpEpoch) {
      this.searchEpoch++;
      this.searchLoading = false;
      this.pathResult = null;
    }
    if (endpoint === 'source') {
      this.sourceId = item.id;
      this.sourceName = item.name;
    } else {
      this.targetId = item.id;
      this.targetName = item.name;
    }
    this.syncDomInput(endpoint === 'source' ? this.sourceInput : this.targetInput, state);
    this.statusMessage = '';
    this.scene.markDirty();
  }

  private onEndpointKeydown(endpoint: 'source' | 'target', event: KeyboardEvent): void {
    const state = endpoint === 'source' ? this.sourceState : this.targetState;
    if (event.isComposing || state.composing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!state.suggestions.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      state.selectedIndex =
        (state.selectedIndex + delta + state.suggestions.length) % state.suggestions.length;
      this.scene.markDirty();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const suggestion =
        state.selectedIndex >= 0 ? state.suggestions[state.selectedIndex] : undefined;
      if (suggestion) this.confirmEndpoint(endpoint, suggestion);
      else if (this.sourceState.confirmed && this.targetState.confirmed) void this.executeSearch();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (state.suggestions.length) {
        state.suggestions = [];
        state.selectedIndex = -1;
        this.scene.markDirty();
      } else this.close();
    }
  }

  private syncDomInput(input: HTMLInputElement | null, state: EndpointState): void {
    if (input && input.value !== state.text) input.value = state.text;
  }
  private removeDomInputs(): void {
    this.sourceInput?.remove();
    this.targetInput?.remove();
    this.inputContainer?.remove();
    this.sourceInput = null;
    this.targetInput = null;
    this.inputContainer = null;
  }
  private entityName(entity: {
    id: string;
    name?: string;
    labels?: Record<string, string>;
    names?: { labels?: Record<string, string>; aliases?: Record<string, string[]> };
  }): string {
    return (
      entity.name ||
      pickNodeLabel(entity.labels) ||
      pickNodeLabel(entity.names?.labels, 'zh', entity.names?.aliases) ||
      entity.id
    );
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
    const sourceInputRect = { x: modalX + 36, y: boxY + 22, w: boxW - 48, h: 20 };
    const targetX = modalX + 24 + boxW + 32;
    const targetInputRect = { x: targetX + 12, y: boxY + 22, w: boxW - 24, h: 20 };
    this.positionDomInput(this.sourceInput, sourceInputRect);
    this.positionDomInput(this.targetInput, targetInputRect);

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

    // Arrow Indicator
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 16px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('➔', modalX + 24 + boxW + 16, boxY + 24);

    // Target box
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
          const name = pickNodeLabel(labels, 'zh', n.names?.aliases) || n.id;
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
    if (this.statusMessage) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `500 12px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        truncateText(ctx, this.statusMessage, modalWidth - 48),
        modalX + modalWidth / 2,
        modalY + modalHeight - 18,
      );
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
        this.confirmEndpoint('source', { id: p.sourceId, name: p.sourceName, type: 'author' });
        this.confirmEndpoint('target', { id: p.targetId, name: p.targetName, type: 'author' });
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

  private positionDomInput(
    input: HTMLInputElement | null,
    rect: { x: number; y: number; w: number; h: number },
  ): void {
    if (!input || !this.inputContainer) return;
    input.style.left = `${rect.x}px`;
    input.style.top = `${rect.y}px`;
    input.style.width = `${Math.max(0, rect.w)}px`;
    input.style.height = `${rect.h}px`;
    input.style.display = this.isOpen ? 'block' : 'none';
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
