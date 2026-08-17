import { Entity } from '@vectojs/core';
import type {
  CasefileRecommendationItem,
  EntityProfileResponse,
  EntityRecommendationsResponse,
  EntityRelationsResponse,
  ProfileField,
  RelationItem,
} from '@omm/shared';
import { pickNodeLabel } from '../scene/types';
import { getCanvasCtx, Theme } from './theme';
import { truncateText, withClip, wrapText } from './text-layout';

export type CasefileTab = 'profile' | 'relations' | 'recommendations';
export type CasefilePointerType = 'mouse' | 'pen' | 'touch';

export interface CasefileDataSource {
  fetchEntityProfile(id: string): Promise<EntityProfileResponse>;
  fetchEntityRelations(
    id: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<EntityRelationsResponse>;
  fetchEntityRecommendations(id: string): Promise<EntityRecommendationsResponse>;
}

type LazyState<T> =
  | { status: 'idle' }
  | { status: 'loading'; epoch: number }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

type RelationState =
  | { status: 'idle' }
  | { status: 'loading'; epoch: number }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      items: RelationItem[];
      nextCursor?: string;
      pageStatus: 'idle' | 'loading' | 'error';
      pageError?: string;
    };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '加载失败，请重试';
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

export function formatProfileText(profile: EntityProfileResponse): string {
  return profile.fields
    .filter((field) => field.value.trim())
    .map((field) => `${field.label}：${field.value}`)
    .join('\n');
}

export function movementCancelsActivation(
  pointerType: CasefilePointerType,
  dx: number,
  dy: number,
): boolean {
  return Math.hypot(dx, dy) > (pointerType === 'touch' ? 10 : 6);
}

export class CasefileSession {
  entityId: string | null = null;
  activeTab: CasefileTab = 'profile';
  profile: LazyState<EntityProfileResponse> = { status: 'idle' };
  relations: RelationState = { status: 'idle' };
  recommendations: LazyState<EntityRecommendationsResponse> = { status: 'idle' };

  private epoch = 0;
  private profileEpoch = 0;
  private relationsEpoch = 0;
  private recommendationsEpoch = 0;
  private relationPageEpoch = 0;
  private relationCursor400Failures = 0;
  private readonly scroll: Record<CasefileTab, number> = {
    profile: 0,
    relations: 0,
    recommendations: 0,
  };

  constructor(
    private readonly source: CasefileDataSource,
    private readonly onChange: () => void,
  ) {}

  async open(entityId: string): Promise<void> {
    this.epoch++;
    this.profileEpoch++;
    this.relationsEpoch++;
    this.recommendationsEpoch++;
    this.relationPageEpoch++;
    this.entityId = entityId;
    this.activeTab = 'profile';
    this.profile = { status: 'idle' };
    this.relations = { status: 'idle' };
    this.recommendations = { status: 'idle' };
    this.relationCursor400Failures = 0;
    this.scroll.profile = 0;
    this.scroll.relations = 0;
    this.scroll.recommendations = 0;
    this.onChange();
    await this.loadProfile();
  }

  close(): void {
    this.epoch++;
    this.profileEpoch++;
    this.relationsEpoch++;
    this.recommendationsEpoch++;
    this.relationPageEpoch++;
    this.entityId = null;
    this.profile = { status: 'idle' };
    this.relations = { status: 'idle' };
    this.recommendations = { status: 'idle' };
    this.onChange();
  }

  async activate(tab: CasefileTab): Promise<void> {
    this.activeTab = tab;
    this.onChange();
    if (tab === 'relations' && this.relations.status === 'idle') await this.loadRelations();
    if (tab === 'recommendations' && this.recommendations.status === 'idle') {
      await this.loadRecommendations();
    }
  }

  retryProfile(): Promise<void> {
    return this.loadProfile();
  }

  retryActiveTab(): Promise<void> {
    if (this.activeTab === 'relations') return this.loadRelations();
    if (this.activeTab === 'recommendations') return this.loadRecommendations();
    return this.loadProfile();
  }

  async loadMoreRelations(): Promise<void> {
    if (!this.entityId || this.relations.status !== 'ready' || !this.relations.nextCursor) return;
    if (this.relations.pageStatus === 'loading') return;

    const sessionEpoch = this.epoch;
    const pageEpoch = ++this.relationPageEpoch;
    const entityId = this.entityId;
    const cursor = this.relations.nextCursor;
    this.relations = { ...this.relations, pageStatus: 'loading', pageError: undefined };
    this.onChange();
    try {
      const response = await this.source.fetchEntityRelations(entityId, { limit: 30, cursor });
      if (!this.isCurrent(sessionEpoch, entityId) || pageEpoch !== this.relationPageEpoch) return;
      if (this.relations.status !== 'ready') return;
      const seen = new Set(this.relations.items.map((item) => item.factId));
      const items = [...this.relations.items];
      for (const item of response.items) {
        if (!seen.has(item.factId)) {
          seen.add(item.factId);
          items.push(item);
        }
      }
      this.relationCursor400Failures = 0;
      this.relations = {
        status: 'ready',
        items,
        nextCursor: response.nextCursor,
        pageStatus: 'idle',
      };
    } catch (error) {
      if (!this.isCurrent(sessionEpoch, entityId) || pageEpoch !== this.relationPageEpoch) return;
      if (errorStatus(error) === 400) this.relationCursor400Failures++;
      else this.relationCursor400Failures = 0;
      if (this.relationCursor400Failures >= 2) {
        this.relations = { status: 'idle' };
        this.relationCursor400Failures = 0;
        this.onChange();
        await this.loadRelations();
        return;
      }
      if (this.relations.status === 'ready') {
        this.relations = {
          ...this.relations,
          pageStatus: 'error',
          pageError: errorMessage(error),
        };
      }
    }
    this.onChange();
  }

  getScroll(tab: CasefileTab): number {
    return this.scroll[tab];
  }

  setScroll(tab: CasefileTab, value: number): void {
    this.scroll[tab] = Math.max(0, value);
  }

  private async loadProfile(): Promise<void> {
    if (!this.entityId) return;
    const sessionEpoch = this.epoch;
    const requestEpoch = ++this.profileEpoch;
    const entityId = this.entityId;
    this.profile = { status: 'loading', epoch: requestEpoch };
    this.onChange();
    try {
      const value = await this.source.fetchEntityProfile(entityId);
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.profileEpoch, entityId)) return;
      this.profile = { status: 'ready', value };
    } catch (error) {
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.profileEpoch, entityId)) return;
      this.profile = { status: 'error', message: errorMessage(error) };
    }
    this.onChange();
  }

  private async loadRelations(): Promise<void> {
    if (!this.entityId) return;
    const sessionEpoch = this.epoch;
    const requestEpoch = ++this.relationsEpoch;
    const entityId = this.entityId;
    this.relations = { status: 'loading', epoch: requestEpoch };
    this.onChange();
    try {
      const response = await this.source.fetchEntityRelations(entityId, { limit: 30 });
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.relationsEpoch, entityId)) return;
      this.relations = {
        status: 'ready',
        items: response.items,
        nextCursor: response.nextCursor,
        pageStatus: 'idle',
      };
      this.relationCursor400Failures = 0;
    } catch (error) {
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.relationsEpoch, entityId)) return;
      this.relations = { status: 'error', message: errorMessage(error) };
    }
    this.onChange();
  }

  private async loadRecommendations(): Promise<void> {
    if (!this.entityId) return;
    const sessionEpoch = this.epoch;
    const requestEpoch = ++this.recommendationsEpoch;
    const entityId = this.entityId;
    this.recommendations = { status: 'loading', epoch: requestEpoch };
    this.onChange();
    try {
      const value = await this.source.fetchEntityRecommendations(entityId);
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.recommendationsEpoch, entityId))
        return;
      this.recommendations = { status: 'ready', value };
    } catch (error) {
      if (!this.isRequestCurrent(sessionEpoch, requestEpoch, this.recommendationsEpoch, entityId))
        return;
      this.recommendations = { status: 'error', message: errorMessage(error) };
    }
    this.onChange();
  }

  private isCurrent(epoch: number, entityId: string): boolean {
    return epoch === this.epoch && entityId === this.entityId;
  }

  private isRequestCurrent(
    epoch: number,
    requestEpoch: number,
    currentRequestEpoch: number,
    entityId: string,
  ): boolean {
    return this.isCurrent(epoch, entityId) && requestEpoch === currentRequestEpoch;
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CopyTarget extends Rect {
  copyValue: string;
  feedbackKey: string;
}

interface NavigationTarget extends Rect {
  targetId: string;
  key: string;
}

type PointerTarget =
  | { kind: 'drag' }
  | { kind: 'scroll' }
  | { kind: 'copy'; target: CopyTarget }
  | { kind: 'navigate'; targetId: string }
  | { kind: 'action'; rect: Rect; run: () => void };

interface PointerTransaction {
  startX: number;
  startY: number;
  lastY: number;
  pointerType: CasefilePointerType;
  target: PointerTarget;
  cancelled: boolean;
}

export interface CasefileDrawerOptions {
  source: CasefileDataSource;
  onClose: () => void;
  onSelectEntity: (id: string) => void;
}

const TABS: readonly { id: CasefileTab; label: string }[] = [
  { id: 'profile', label: '档案' },
  { id: 'relations', label: '关系' },
  { id: 'recommendations', label: '推荐' },
];

export class CasefileDrawer extends Entity {
  readonly session: CasefileSession;

  private isOpen = false;
  private anchor = { x: 0, y: 0 };
  private manualPosition: { x: number; y: number } | null = null;
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };
  private pointer: PointerTransaction | null = null;
  private cardRect: Rect = { x: -1000, y: -1000, w: 0, h: 0 };
  private headerRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private contentRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private closeRect: Rect = { x: 0, y: 0, w: 44, h: 44 };
  private copyAllRect: Rect = { x: 0, y: 0, w: 44, h: 44 };
  private tabRects: { tab: CasefileTab; rect: Rect }[] = [];
  private copyTargets: CopyTarget[] = [];
  private navigationTargets: NavigationTarget[] = [];
  private retryRect: Rect | null = null;
  private loadMoreRect: Rect | null = null;
  private maxScroll: Record<CasefileTab, number> = {
    profile: 0,
    relations: 0,
    recommendations: 0,
  };
  private feedback: { key: string; state: 'success' | 'error'; token: number } | null = null;
  private feedbackToken = 0;

  constructor(private readonly options: CasefileDrawerOptions) {
    super();
    this.id = 'casefile-drawer';
    this.interactive = true;
    this.session = new CasefileSession(options.source, () => this.markDirty());
  }

  override hasPendingAnimations(): boolean {
    return (
      this.isOpen &&
      (this.session.profile.status === 'loading' ||
        this.session.relations.status === 'loading' ||
        this.session.recommendations.status === 'loading' ||
        (this.session.relations.status === 'ready' &&
          this.session.relations.pageStatus === 'loading'))
    );
  }

  open(entityId: string, anchor?: { x: number; y: number }): void {
    this.isOpen = true;
    if (anchor) this.anchor = anchor;
    this.manualPosition = null;
    this.pointer = null;
    this.feedback = null;
    void this.session.open(entityId);
    this.markDirty();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.dragging = false;
    this.pointer = null;
    this.cardRect = { x: -1000, y: -1000, w: 0, h: 0 };
    this.session.close();
    this.options.onClose();
    this.markDirty();
  }

  isDrawerOpen(): boolean {
    return this.isOpen;
  }

  getInstrumentationState(): {
    open: boolean;
    dragging: boolean;
    entityId: string | null;
    activeTab: CasefileTab;
    profileStatus: CasefileSession['profile']['status'];
    relationsStatus: CasefileSession['relations']['status'];
    recommendationsStatus: CasefileSession['recommendations']['status'];
  } {
    return {
      open: this.isOpen,
      dragging: this.dragging,
      entityId: this.session.entityId,
      activeTab: this.session.activeTab,
      profileStatus: this.session.profile.status,
      relationsStatus: this.session.relations.status,
      recommendationsStatus: this.session.recommendations.status,
    };
  }

  getInstrumentationTargets(): readonly { id: string; rect: Rect }[] {
    if (!this.isOpen) return [];
    const targets: { id: string; rect: Rect }[] = [
      { id: 'casefile.close', rect: { ...this.closeRect } },
      { id: 'casefile.copy', rect: { ...this.copyAllRect } },
      ...this.tabRects.map(({ tab, rect }) => ({ id: `casefile.tab.${tab}`, rect: { ...rect } })),
    ];
    this.copyTargets.forEach((target, index) => {
      targets.push({ id: `casefile.copy.${target.feedbackKey}`, rect: { ...target } });
      if (index === 0) targets.push({ id: 'casefile.copy.first', rect: { ...target } });
      if (
        target.feedbackKey.startsWith('relation:') ||
        target.feedbackKey.startsWith('recommendation:')
      ) {
        targets.push({ id: `casefile.row.${target.feedbackKey}`, rect: { ...target } });
      }
    });
    for (const target of this.navigationTargets) {
      targets.push({ id: `casefile.row.${target.key}.navigate`, rect: { ...target } });
    }
    return targets;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  isPointInside(x: number, y: number): boolean {
    return this.isOpen && this.inRect(x, y, this.cardRect);
  }

  handleWheel(delta: number): void {
    if (!this.isOpen) return;
    const tab = this.session.activeTab;
    this.session.setScroll(
      tab,
      Math.min(this.maxScroll[tab], this.session.getScroll(tab) + delta * 0.6),
    );
    this.markDirty();
  }

  handlePointerDown(x: number, y: number, pointerType: CasefilePointerType): boolean {
    if (!this.isPointInside(x, y)) return false;
    const target = this.hitTarget(x, y, pointerType);
    this.pointer = {
      startX: x,
      startY: y,
      lastY: y,
      pointerType,
      target,
      cancelled: false,
    };
    if (target.kind === 'drag') {
      this.dragging = true;
      this.dragOffset = { x: x - this.cardRect.x, y: y - this.cardRect.y };
    }
    return true;
  }

  handlePointerMove(x: number, y: number): boolean {
    const pointer = this.pointer;
    if (!pointer) return false;
    const moved = movementCancelsActivation(
      pointer.pointerType,
      x - pointer.startX,
      y - pointer.startY,
    );
    if (pointer.target.kind === 'drag') {
      if (!moved && !this.dragging) return true;
      const margin = 12;
      this.manualPosition = {
        x: Math.max(
          margin,
          Math.min(this.scene.width - this.cardRect.w - margin, x - this.dragOffset.x),
        ),
        y: Math.max(
          margin,
          Math.min(this.scene.height - this.cardRect.h - margin, y - this.dragOffset.y),
        ),
      };
      this.markDirty();
      return true;
    }
    if (moved) pointer.cancelled = true;
    if (pointer.cancelled && this.inRect(x, y, this.contentRect)) {
      const tab = this.session.activeTab;
      const delta = pointer.lastY - y;
      this.session.setScroll(
        tab,
        Math.min(this.maxScroll[tab], this.session.getScroll(tab) + delta),
      );
      this.markDirty();
    }
    pointer.lastY = y;
    return true;
  }

  handlePointerUp(x: number, y: number): boolean {
    const pointer = this.pointer;
    if (!pointer) return false;
    this.pointer = null;
    if (pointer.target.kind === 'drag') {
      this.dragging = false;
      return true;
    }
    if (pointer.cancelled || !this.isPointInside(x, y)) return true;
    if (pointer.target.kind === 'copy') {
      if (this.inRect(x, y, pointer.target.target)) {
        void this.copy(pointer.target.target.copyValue, pointer.target.target.feedbackKey);
      }
    } else if (pointer.target.kind === 'navigate') {
      const targetId = pointer.target.targetId;
      if (
        this.navigationTargets.some(
          (target) => target.targetId === targetId && this.inRect(x, y, target),
        )
      ) {
        this.options.onSelectEntity(targetId);
      }
    } else if (pointer.target.kind === 'action') {
      if (this.inRect(x, y, pointer.target.rect)) pointer.target.run();
    }
    return true;
  }

  handlePointerCancel(): boolean {
    if (!this.pointer) return false;
    this.pointer = null;
    this.dragging = false;
    return true;
  }

  render(renderer: unknown): void {
    if (!this.isOpen) return;
    const ctx = getCanvasCtx(renderer);
    this.layoutCard();
    this.resetHitTargets();
    this.drawCard(ctx);
    this.drawHeader(ctx);
    this.drawTabs(ctx);
    withClip(ctx, this.contentRect, () => this.drawActiveTab(ctx));
    this.drawFooterHint(ctx);
  }

  private markDirty(): void {
    this.scene?.markDirty();
  }

  private layoutCard(): void {
    const margin = 16;
    const mobile = this.scene.width < 640;
    const width = Math.min(420, this.scene.width - margin * 2);
    const height = Math.min(640, this.scene.height - 96);
    let x = mobile ? margin : this.anchor.x + 28;
    if (!mobile && x + width > this.scene.width - margin) x = this.anchor.x - width - 28;
    x = Math.max(margin, Math.min(this.scene.width - width - margin, x));
    let y = mobile
      ? 72
      : Math.max(72, Math.min(this.scene.height - height - margin, this.anchor.y - 88));
    if (this.manualPosition && !mobile) {
      x = Math.max(margin, Math.min(this.scene.width - width - margin, this.manualPosition.x));
      y = Math.max(margin, Math.min(this.scene.height - height - margin, this.manualPosition.y));
    }
    this.cardRect = { x, y, w: width, h: height };
    this.headerRect = { x, y, w: width, h: 86 };
    this.contentRect = { x: x + 16, y: y + 134, w: width - 32, h: height - 170 };
    this.copyAllRect = { x: x + width - 100, y: y + 18, w: 44, h: 44 };
    this.closeRect = { x: x + width - 52, y: y + 18, w: 44, h: 44 };
    const tabWidth = (width - 32) / TABS.length;
    this.tabRects = TABS.map((tab, index) => ({
      tab: tab.id,
      rect: { x: x + 16 + index * tabWidth, y: y + 86, w: tabWidth, h: 48 },
    }));
  }

  private resetHitTargets(): void {
    this.copyTargets = [];
    this.navigationTargets = [];
    this.retryRect = null;
    this.loadMoreRect = null;
  }

  private drawCard(ctx: CanvasRenderingContext2D): void {
    const { x, y, w, h } = this.cardRect;
    ctx.save();
    ctx.shadowColor = Theme.colors.shadowCard;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.stroke();
  }

  private drawHeader(ctx: CanvasRenderingContext2D): void {
    const profile = this.session.profile.status === 'ready' ? this.session.profile.value : null;
    const labels = profile?.entity.names.labels ?? {};
    const name = profile
      ? pickNodeLabel(labels, 'zh', profile.entity.names.aliases) || '未命名档案'
      : '人物档案';
    const type = profile?.entity.type ?? 'other';
    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(
      this.headerRect.x,
      this.headerRect.y,
      this.headerRect.w,
      this.headerRect.h,
      [12, 12, 0, 0],
    );
    ctx.fill();
    ctx.fillStyle = Theme.getNodeColor(type);
    ctx.beginPath();
    ctx.roundRect(this.cardRect.x + 20, this.cardRect.y + 18, 6, 50, 3);
    ctx.fill();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `700 21px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      truncateText(ctx, name, this.cardRect.w - 150),
      this.cardRect.x + 38,
      this.cardRect.y + 36,
    );
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.fillText(
      profile ? Theme.getNodeTypeLabel(type) : 'PROFILE FIRST',
      this.cardRect.x + 38,
      this.cardRect.y + 60,
    );
    this.drawIconButton(
      ctx,
      this.copyAllRect,
      this.feedback?.key === 'profile-all' ? this.feedback.state : 'idle',
      '⧉',
    );
    this.drawIconButton(ctx, this.closeRect, 'idle', '×');
  }

  private drawTabs(ctx: CanvasRenderingContext2D): void {
    for (const { tab, rect } of this.tabRects) {
      const active = tab === this.session.activeTab;
      ctx.fillStyle = active ? Theme.colors.bgCardHover : Theme.colors.bgParchmentDark;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      if (active) {
        ctx.fillStyle = Theme.colors.borderActive;
        ctx.fillRect(rect.x + 12, rect.y + rect.h - 3, rect.w - 24, 3);
      }
      ctx.fillStyle = active ? Theme.colors.textHigh : Theme.colors.textLow;
      ctx.font = `600 13px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        TABS.find((item) => item.id === tab)!.label,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
      );
    }
  }

  private drawActiveTab(ctx: CanvasRenderingContext2D): void {
    const tab = this.session.activeTab;
    const scroll = this.session.getScroll(tab);
    let bottom = this.contentRect.y;
    if (tab === 'profile') bottom = this.drawProfile(ctx, scroll);
    if (tab === 'relations') bottom = this.drawRelations(ctx, scroll);
    if (tab === 'recommendations') bottom = this.drawRecommendations(ctx, scroll);
    this.maxScroll[tab] = Math.max(0, bottom - this.contentRect.y - this.contentRect.h + 12);
    if (scroll > this.maxScroll[tab]) this.session.setScroll(tab, this.maxScroll[tab]);
  }

  private drawProfile(ctx: CanvasRenderingContext2D, scroll: number): number {
    const state = this.session.profile;
    if (state.status === 'loading' || state.status === 'idle') {
      this.drawLoading(ctx, '正在加载档案…');
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.status === 'error') {
      this.drawError(ctx, state.message);
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.value.fields.length === 0) {
      this.drawEmpty(ctx, '暂无更多档案信息');
      return this.contentRect.y + this.contentRect.h;
    }
    let y = this.contentRect.y + 8 - scroll;
    for (const field of state.value.fields) y = this.drawProfileField(ctx, field, y);
    return y + scroll;
  }

  private drawProfileField(ctx: CanvasRenderingContext2D, field: ProfileField, y: number): number {
    const lines = this.measureLines(ctx, field.value, this.contentRect.w - 24, 2);
    const height = Math.max(44, 26 + lines.length * 18);
    const target: CopyTarget = {
      x: this.contentRect.x,
      y,
      w: this.contentRect.w,
      h: height,
      copyValue: field.copyValue,
      feedbackKey: `profile:${field.key}`,
    };
    this.copyTargets.push(target);
    this.drawRowSurface(ctx, target, target.feedbackKey);
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(field.label, target.x + 12, y + 8);
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `400 13px ${Theme.fonts.sans}`;
    lines.forEach((line, index) => {
      ctx.fillText(line, target.x + 12, y + 25 + index * 18);
    });
    this.drawFeedback(ctx, target, target.feedbackKey);
    return y + height + 8;
  }

  private drawRelations(ctx: CanvasRenderingContext2D, scroll: number): number {
    const state = this.session.relations;
    if (state.status === 'idle' || state.status === 'loading') {
      this.drawLoading(ctx, '正在加载关系…');
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.status === 'error') {
      this.drawError(ctx, state.message);
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.items.length === 0) {
      this.drawEmpty(ctx, '暂无可展示关系');
      return this.contentRect.y + this.contentRect.h;
    }
    let y = this.contentRect.y + 8 - scroll;
    for (const item of state.items) {
      y = this.drawLinkedRow(
        ctx,
        item.label,
        item.value,
        item.copyValue,
        `relation:${item.factId}`,
        item.targetId,
        y,
      );
    }
    if (state.nextCursor) {
      this.loadMoreRect = { x: this.contentRect.x, y, w: this.contentRect.w, h: 44 };
      this.drawAction(
        ctx,
        this.loadMoreRect,
        state.pageStatus === 'loading'
          ? '正在加载…'
          : state.pageStatus === 'error'
            ? '重试加载更多'
            : '加载更多',
      );
      y += 52;
      if (state.pageStatus === 'error' && state.pageError) {
        ctx.fillStyle = '#e9a0a0';
        ctx.font = `400 11px ${Theme.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          truncateText(ctx, state.pageError, this.contentRect.w),
          this.contentRect.x + this.contentRect.w / 2,
          y,
        );
        y += 20;
      }
    }
    return y + scroll;
  }

  private drawRecommendations(ctx: CanvasRenderingContext2D, scroll: number): number {
    const state = this.session.recommendations;
    if (state.status === 'idle' || state.status === 'loading') {
      this.drawLoading(ctx, '正在加载推荐…');
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.status === 'error') {
      this.drawError(ctx, state.message);
      return this.contentRect.y + this.contentRect.h;
    }
    if (state.value.items.length === 0) {
      this.drawEmpty(ctx, '暂无推荐');
      return this.contentRect.y + this.contentRect.h;
    }
    let y = this.contentRect.y + 8 - scroll;
    for (const item of state.value.items) y = this.drawRecommendation(ctx, item, y);
    return y + scroll;
  }

  private drawRecommendation(
    ctx: CanvasRenderingContext2D,
    item: CasefileRecommendationItem,
    y: number,
  ): number {
    const subtitle = `${item.reason} · 关联度 ${(item.score * 100).toFixed(0)}%`;
    return this.drawLinkedRow(
      ctx,
      item.name,
      subtitle,
      item.copyValue,
      `recommendation:${item.targetId}`,
      item.targetId,
      y,
      item.type,
    );
  }

  private drawLinkedRow(
    ctx: CanvasRenderingContext2D,
    label: string,
    value: string,
    copyValue: string,
    feedbackKey: string,
    targetId: string | undefined,
    y: number,
    type?: string,
  ): number {
    const height = 62;
    const arrowWidth = targetId ? 44 : 0;
    const copyTarget: CopyTarget = {
      x: this.contentRect.x,
      y,
      w: this.contentRect.w - arrowWidth,
      h: height,
      copyValue,
      feedbackKey,
    };
    this.copyTargets.push(copyTarget);
    this.drawRowSurface(ctx, { ...copyTarget, w: this.contentRect.w }, feedbackKey);
    if (type) {
      ctx.fillStyle = Theme.getNodeColor(type);
      ctx.fillRect(copyTarget.x + 8, y + 12, 4, 38);
    }
    const textX = copyTarget.x + (type ? 20 : 12);
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 13px ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      truncateText(ctx, label, copyTarget.w - (textX - copyTarget.x) - 8),
      textX,
      y + 10,
    );
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `400 12px ${Theme.fonts.sans}`;
    ctx.fillText(
      truncateText(ctx, value, copyTarget.w - (textX - copyTarget.x) - 8),
      textX,
      y + 34,
    );
    this.drawFeedback(ctx, copyTarget, feedbackKey);
    if (targetId) {
      const arrow = {
        x: this.contentRect.x + this.contentRect.w - 44,
        y: y + 9,
        w: 44,
        h: 44,
        targetId,
        key: feedbackKey,
      };
      this.navigationTargets.push(arrow);
      ctx.strokeStyle = Theme.colors.border;
      ctx.beginPath();
      ctx.moveTo(arrow.x, y + 10);
      ctx.lineTo(arrow.x, y + height - 10);
      ctx.stroke();
      ctx.fillStyle = Theme.colors.borderActive;
      ctx.font = `700 20px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('›', arrow.x + 22, arrow.y + 22);
    }
    return y + height + 8;
  }

  private drawRowSurface(ctx: CanvasRenderingContext2D, rect: Rect, feedbackKey: string): void {
    ctx.fillStyle =
      this.feedback?.key === feedbackKey && this.feedback.state === 'success'
        ? 'rgba(70, 130, 90, 0.35)'
        : Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle =
      this.feedback?.key === feedbackKey && this.feedback.state === 'error'
        ? '#c66'
        : Theme.colors.border;
    ctx.stroke();
  }

  private drawFeedback(ctx: CanvasRenderingContext2D, rect: Rect, key: string): void {
    if (this.feedback?.key !== key) return;
    ctx.fillStyle = this.feedback.state === 'success' ? '#b9e2bf' : '#f1aaaa';
    ctx.font = `600 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(
      this.feedback.state === 'success' ? '已复制' : '复制失败',
      rect.x + rect.w - 8,
      rect.y + 8,
    );
  }

  private drawLoading(ctx: CanvasRenderingContext2D, label: string): void {
    const cx = this.contentRect.x + this.contentRect.w / 2;
    const cy = this.contentRect.y + this.contentRect.h / 2 - 12;
    const phase = (performance.now() / 240) % (Math.PI * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phase);
    ctx.strokeStyle = Theme.colors.borderActive;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 12, -Math.PI / 2, Math.PI * 1.15);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = Theme.colors.textMid;
    ctx.font = `500 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, cy + 24);
  }

  private drawEmpty(ctx: CanvasRenderingContext2D, label: string): void {
    ctx.fillStyle = Theme.colors.textLow;
    ctx.font = `500 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      label,
      this.contentRect.x + this.contentRect.w / 2,
      this.contentRect.y + this.contentRect.h / 2,
    );
  }

  private drawError(ctx: CanvasRenderingContext2D, message: string): void {
    const cx = this.contentRect.x + this.contentRect.w / 2;
    const cy = this.contentRect.y + this.contentRect.h / 2;
    ctx.fillStyle = '#e9a0a0';
    ctx.font = `500 12px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(truncateText(ctx, message, this.contentRect.w - 24), cx, cy - 12);
    this.retryRect = { x: cx - 64, y: cy, w: 128, h: 44 };
    this.drawAction(ctx, this.retryRect, '重试');
  }

  private drawAction(ctx: CanvasRenderingContext2D, rect: Rect, label: string): void {
    ctx.fillStyle = Theme.colors.bgCardHover;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = Theme.colors.borderHighlight;
    ctx.stroke();
    ctx.fillStyle = Theme.colors.textHigh;
    ctx.font = `600 13px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  private drawIconButton(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    state: 'idle' | 'success' | 'error',
    icon: string,
  ): void {
    ctx.fillStyle = state === 'success' ? 'rgba(70, 130, 90, 0.5)' : Theme.colors.bgParchmentDark;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = state === 'error' ? '#c66' : Theme.colors.border;
    ctx.stroke();
    ctx.fillStyle = state === 'error' ? '#f1aaaa' : Theme.colors.textHigh;
    ctx.font = `600 18px ${Theme.fonts.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      state === 'success' ? '✓' : state === 'error' ? '!' : icon,
      rect.x + 22,
      rect.y + 22,
    );
  }

  private drawFooterHint(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = Theme.colors.textMuted;
    ctx.font = `400 11px ${Theme.fonts.sans}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      '点击字段即可复制',
      this.cardRect.x + this.cardRect.w - 18,
      this.cardRect.y + this.cardRect.h - 17,
    );
  }

  private measureLines(
    ctx: CanvasRenderingContext2D,
    value: string,
    width: number,
    maxLines: number,
  ): string[] {
    ctx.font = `400 13px ${Theme.fonts.sans}`;
    return wrapText(ctx, value, width, maxLines);
  }

  private hitTarget(x: number, y: number, pointerType: CasefilePointerType): PointerTarget {
    if (this.inRect(x, y, this.closeRect)) {
      return { kind: 'action', rect: this.closeRect, run: () => this.close() };
    }
    if (this.inRect(x, y, this.copyAllRect)) {
      return {
        kind: 'action',
        rect: this.copyAllRect,
        run: () => {
          if (this.session.profile.status === 'ready')
            void this.copy(formatProfileText(this.session.profile.value), 'profile-all');
        },
      };
    }
    for (const { tab, rect } of this.tabRects) {
      if (this.inRect(x, y, rect))
        return { kind: 'action', rect, run: () => void this.session.activate(tab) };
    }
    for (const target of this.navigationTargets) {
      if (this.inRect(x, y, target)) return { kind: 'navigate', targetId: target.targetId };
    }
    for (const target of this.copyTargets) {
      if (this.inRect(x, y, target)) return { kind: 'copy', target };
    }
    if (this.retryRect && this.inRect(x, y, this.retryRect)) {
      return {
        kind: 'action',
        rect: this.retryRect,
        run: () => void this.session.retryActiveTab(),
      };
    }
    if (this.loadMoreRect && this.inRect(x, y, this.loadMoreRect)) {
      return {
        kind: 'action',
        rect: this.loadMoreRect,
        run: () => void this.session.loadMoreRelations(),
      };
    }
    if (this.inRect(x, y, this.headerRect) && pointerType !== 'touch') return { kind: 'drag' };
    return { kind: 'scroll' };
  }

  private async copy(value: string, key: string): Promise<void> {
    const token = ++this.feedbackToken;
    try {
      if (!value || typeof navigator === 'undefined' || !navigator.clipboard)
        throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      this.feedback = { key, state: 'success', token };
    } catch {
      this.feedback = { key, state: 'error', token };
    }
    this.markDirty();
    globalThis.setTimeout(() => {
      if (this.feedback?.token === token) {
        this.feedback = null;
        this.markDirty();
      }
    }, 1500);
  }

  private inRect(x: number, y: number, rect: Rect): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }
}
