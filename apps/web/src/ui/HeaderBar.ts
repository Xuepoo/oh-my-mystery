import { Entity } from '@vectojs/core';
import type { SearchResultItem } from '@omm/shared';
import type { D1DataSource } from '../api/D1DataSource';
import { getCanvasCtx, getEventCoords, Theme } from './theme';

export interface HeaderBarOptions {
  source: D1DataSource;
  onOpenChronicles: () => void;
  onOpenPathfinder: () => void;
  onSelectSearchResult: (id: string) => void;
  onFilterChange: (type: string | null) => void;
  onToggleFullscreen: () => void;
}

export class HeaderBar extends Entity {
  private source: D1DataSource;
  private onOpenChroniclesCb: () => void;
  private onOpenPathfinderCb: () => void;
  private onSelectSearchResultCb: (id: string) => void;
  private onFilterChangeCb: (type: string | null) => void;
  private onToggleFullscreenCb: () => void;

  private searchQuery = '';
  private searchResults: SearchResultItem[] = [];
  private showSearchDropdown = false;
  private isSearching = false;
  private activeFilter: string | null = null;

  private searchInputRect = { x: 0, y: 0, w: 0, h: 0 };
  private fullscreenBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private pathfinderBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private chroniclesBtnRect = { x: 0, y: 0, w: 0, h: 0 };
  private filterPillRects: {
    type: string | null;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [];
  private dropdownItemRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private hotQueryRects: { query: string; x: number; y: number; w: number; h: number }[] = [];
  private customInputBtnRect = { x: 0, y: 0, w: 0, h: 0 };

  private readonly HOT_QUERIES = [
    '东野圭吾',
    '阿加莎·克里斯蒂',
    '江户川乱步',
    '夏洛克·福尔摩斯',
    '金田一耕助',
    '新本格',
    '直木奖',
    '密室',
  ];

  constructor(options: HeaderBarOptions) {
    super();
    this.id = 'header-bar';
    this.interactive = true;
    this.source = options.source;
    this.onOpenChroniclesCb = options.onOpenChronicles;
    this.onOpenPathfinderCb = options.onOpenPathfinder;
    this.onSelectSearchResultCb = options.onSelectSearchResult;
    this.onFilterChangeCb = options.onFilterChange;
    this.onToggleFullscreenCb = options.onToggleFullscreen;

    this.on('pointerdown', (e: any) => {
      const { x, y } = getEventCoords(e);
      this.handleClick(x, y);
    });

    // Native text input shortcut for searching
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.showSearchDropdown = false;
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        this.showSearchDropdown = true;
      }
    });
  }

  isPointInside(_x: number, y: number): boolean {
    if (this.showSearchDropdown) return y <= 400;
    return y <= 64;
  }

  setSearchQuery(q: string): void {
    this.searchQuery = q.trim();
    if (!this.searchQuery) {
      this.searchResults = [];
      return;
    }
    this.isSearching = true;
    this.source
      .search(this.searchQuery)
      .then((res) => {
        this.searchResults = res.results;
        this.showSearchDropdown = true;
      })
      .catch((err) => {
        console.error('Search failed', err);
        this.searchResults = [];
      })
      .finally(() => {
        this.isSearching = false;
      });
  }

  render(r: any): void {
    const ctx = getCanvasCtx(r);
    const w = this.scene.width;
    const isMobile = w < 768;
    const isTablet = w >= 768 && w < 1080;

    // 1. Header Bar Container Background & Luminous Border
    ctx.save();
    ctx.fillStyle = 'rgba(32, 25, 20, 0.94)';
    ctx.fillRect(0, 0, w, 64);

    ctx.strokeStyle = Theme.colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 64);
    ctx.lineTo(w, 64);
    ctx.stroke();

    // App Logo & Title
    ctx.fillStyle = Theme.colors.borderHighlight;
    ctx.font = `700 ${isMobile ? '15px' : '18px'} ${Theme.fonts.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('OH MY MYSTERY', 24, 32);

    if (!isMobile) {
      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 11px ${Theme.fonts.sans}`;
      ctx.fillText('推理知识图谱', isTablet ? 155 : 188, 32);
    }

    // 2. Search Input Box
    const searchX = isMobile ? 68 : isTablet ? 245 : 290;
    const searchW = isMobile ? Math.max(110, w - 68 - 140) : Math.min(260, w * 0.22);
    this.searchInputRect = { x: searchX, y: 14, w: searchW, h: 36 };

    ctx.fillStyle = Theme.colors.bgCard;
    ctx.beginPath();
    ctx.roundRect(searchX, 14, searchW, 36, 6);
    ctx.fill();
    ctx.strokeStyle = this.showSearchDropdown ? Theme.colors.borderHighlight : Theme.colors.border;
    ctx.stroke();

    ctx.fillStyle = this.searchQuery ? Theme.colors.textHigh : Theme.colors.textLow;
    ctx.font = `400 ${isMobile ? '11px' : '13px'} ${Theme.fonts.sans}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayText = isMobile
      ? this.searchQuery || '🔍 搜索...'
      : this.searchQuery || '🔍 搜索作家/作品/奖项... [/]';
    ctx.fillText(displayText, searchX + 10, 32);

    // 3. Entity Type Filter Pills (Desktop only)
    if (!isMobile && !isTablet) {
      let filterX = searchX + searchW + 20;
      const filters = [
        { type: null, label: '全部' },
        { type: 'author', label: '作家' },
        { type: 'work', label: '作品' },
        { type: 'award', label: '奖项' },
        { type: 'character', label: '名侦探' },
      ];

      this.filterPillRects = [];
      for (const f of filters) {
        const isSelected = this.activeFilter === f.type;
        const pillW = 56;
        const pillH = 28;
        const pillY = 18;

        this.filterPillRects.push({
          type: f.type,
          label: f.label,
          x: filterX,
          y: pillY,
          w: pillW,
          h: pillH,
        });

        ctx.fillStyle = isSelected ? Theme.colors.borderHighlight : Theme.colors.bgCard;
        ctx.beginPath();
        ctx.roundRect(filterX, pillY, pillW, pillH, 4);
        ctx.fill();

        ctx.fillStyle = isSelected ? '#1A1715' : Theme.colors.textMid;
        ctx.font = `600 11px ${Theme.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.label, filterX + pillW / 2, pillY + pillH / 2);

        filterX += pillW + 8;
      }
    } else {
      this.filterPillRects = [];
    }

    // 4. Action Buttons (Right Aligned)
    const rightMargin = w - 16;

    if (!isMobile) {
      // Fullscreen Btn
      this.fullscreenBtnRect = { x: rightMargin - 40, y: 14, w: 40, h: 36 };
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(this.fullscreenBtnRect.x, 14, 40, 36, 6);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.border;
      ctx.stroke();

      ctx.fillStyle = Theme.colors.textMid;
      ctx.font = `600 15px ${Theme.fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⛶', this.fullscreenBtnRect.x + 20, 32);

      // Pathfinder Btn
      this.pathfinderBtnRect = {
        x: this.fullscreenBtnRect.x - 114,
        y: 14,
        w: 106,
        h: 36,
      };
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(this.pathfinderBtnRect.x, 14, this.pathfinderBtnRect.w, 36, 6);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.borderHighlight;
      ctx.stroke();

      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.font = `600 12px ${Theme.fonts.sans}`;
      ctx.fillText('🔗 关系探路', this.pathfinderBtnRect.x + 53, 32);

      // Chronicles Btn
      this.chroniclesBtnRect = {
        x: this.pathfinderBtnRect.x - 122,
        y: 14,
        w: 114,
        h: 36,
      };
      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.beginPath();
      ctx.roundRect(this.chroniclesBtnRect.x, 14, this.chroniclesBtnRect.w, 36, 6);
      ctx.fill();

      ctx.fillStyle = '#1A1715';
      ctx.font = `700 12px ${Theme.fonts.sans}`;
      ctx.fillText('📖 编年史导览', this.chroniclesBtnRect.x + 57, 32);
    } else {
      // Mobile compact actions
      this.fullscreenBtnRect = { x: -100, y: -100, w: 0, h: 0 };

      this.pathfinderBtnRect = { x: rightMargin - 40, y: 14, w: 40, h: 36 };
      ctx.fillStyle = Theme.colors.bgCard;
      ctx.beginPath();
      ctx.roundRect(this.pathfinderBtnRect.x, 14, 40, 36, 6);
      ctx.fill();
      ctx.strokeStyle = Theme.colors.borderHighlight;
      ctx.stroke();
      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.font = `600 14px ${Theme.fonts.sans}`;
      ctx.fillText('🔗', this.pathfinderBtnRect.x + 20, 32);

      this.chroniclesBtnRect = {
        x: this.pathfinderBtnRect.x - 48,
        y: 14,
        w: 42,
        h: 36,
      };
      ctx.fillStyle = Theme.colors.borderHighlight;
      ctx.beginPath();
      ctx.roundRect(this.chroniclesBtnRect.x, 14, 42, 36, 6);
      ctx.fill();
      ctx.fillStyle = '#1A1715';
      ctx.font = `700 14px ${Theme.fonts.sans}`;
      ctx.fillText('📖', this.chroniclesBtnRect.x + 21, 32);
    }

    // 5. Search Results / Hot Queries Dropdown
    if (this.showSearchDropdown) {
      const dropX = searchX;
      const dropY = 56;
      const dropW = Math.max(300, searchW);

      if (this.searchResults.length > 0) {
        // Render search hits
        const itemH = 44;
        const dropH = Math.min(320, this.searchResults.length * itemH + 16);

        ctx.fillStyle = Theme.colors.bgCard;
        ctx.beginPath();
        ctx.roundRect(dropX, dropY, dropW, dropH, 8);
        ctx.fill();

        ctx.strokeStyle = Theme.colors.borderHighlight;
        ctx.lineWidth = 1;
        ctx.stroke();

        this.dropdownItemRects = [];
        this.hotQueryRects = [];
        let itemY = dropY + 8;
        for (let i = 0; i < Math.min(6, this.searchResults.length); i++) {
          const item = this.searchResults[i]!;
          this.dropdownItemRects.push({
            id: item.id,
            x: dropX,
            y: itemY,
            w: dropW,
            h: itemH,
          });

          // Type badge
          const typeColor = Theme.getNodeColor(item.type);
          ctx.fillStyle = typeColor;
          ctx.beginPath();
          ctx.roundRect(dropX + 10, itemY + 12, 48, 20, 3);
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `700 9px ${Theme.fonts.sans}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(Theme.getNodeTypeLabel(item.type).split(' / ')[0]!, dropX + 34, itemY + 22);

          // Title
          ctx.fillStyle = Theme.colors.textHigh;
          ctx.font = `600 13px ${Theme.fonts.serif}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.name, dropX + 66, itemY + (item.subtitle ? 15 : 22));

          // Subtitle
          if (item.subtitle) {
            ctx.fillStyle = Theme.colors.textLow;
            ctx.font = `400 11px ${Theme.fonts.sans}`;
            ctx.fillText(item.subtitle, dropX + 66, itemY + 30);
          }

          itemY += itemH;
        }
      } else {
        // Render Hot Queries Suggestion Panel
        const dropH = 220;
        ctx.fillStyle = Theme.colors.bgCard;
        ctx.beginPath();
        ctx.roundRect(dropX, dropY, dropW, dropH, 8);
        ctx.fill();

        ctx.strokeStyle = Theme.colors.borderHighlight;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = Theme.colors.borderHighlight;
        ctx.font = `700 11px ${Theme.fonts.sans}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('🔥 热门推理探索 (点击速查)：', dropX + 14, dropY + 14);

        this.hotQueryRects = [];
        this.dropdownItemRects = [];
        let tagX = dropX + 14;
        let tagY = dropY + 38;

        for (const query of this.HOT_QUERIES) {
          ctx.font = `500 12px ${Theme.fonts.sans}`;
          const qW = Math.round(ctx.measureText(query).width + 18);
          if (tagX + qW > dropX + dropW - 14) {
            tagX = dropX + 14;
            tagY += 32;
          }

          const qRect = { query, x: tagX, y: tagY, w: qW, h: 26 };
          this.hotQueryRects.push(qRect);

          ctx.fillStyle = 'rgba(243, 196, 118, 0.12)';
          ctx.beginPath();
          ctx.roundRect(tagX, tagY, qW, 26, 4);
          ctx.fill();

          ctx.strokeStyle = Theme.colors.border;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = Theme.colors.textHigh;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(query, tagX + qW / 2, tagY + 13);

          tagX += qW + 8;
        }

        // Custom Prompt Button
        this.customInputBtnRect = {
          x: dropX + 14,
          y: dropY + dropH - 42,
          w: dropW - 28,
          h: 30,
        };
        ctx.fillStyle = 'rgba(255, 217, 142, 0.18)';
        ctx.beginPath();
        ctx.roundRect(
          this.customInputBtnRect.x,
          this.customInputBtnRect.y,
          this.customInputBtnRect.w,
          this.customInputBtnRect.h,
          5,
        );
        ctx.fill();

        ctx.strokeStyle = Theme.colors.borderActive;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = Theme.colors.borderActive;
        ctx.font = `600 12px ${Theme.fonts.sans}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          '✏️ 键入自定义搜索词...',
          this.customInputBtnRect.x + this.customInputBtnRect.w / 2,
          this.customInputBtnRect.y + 15,
        );
      }
    }
    ctx.restore();
  }

  public handleClick(clientX: number, clientY: number): boolean {
    // 1. Dropdown Items
    if (this.showSearchDropdown) {
      for (const item of this.dropdownItemRects) {
        if (this.isInRect(clientX, clientY, item)) {
          this.showSearchDropdown = false;
          this.onSelectSearchResultCb(item.id);
          return true;
        }
      }

      // Hot Query Tags
      for (const h of this.hotQueryRects) {
        if (this.isInRect(clientX, clientY, h)) {
          this.setSearchQuery(h.query);
          return true;
        }
      }

      // Custom Input Button
      if (this.isInRect(clientX, clientY, this.customInputBtnRect)) {
        const prompt = window.prompt(
          '🔍 搜索推理作家、作品、奖项或名侦探 (中/英/日)：',
          this.searchQuery,
        );
        if (prompt !== null) {
          this.setSearchQuery(prompt);
        }
        return true;
      }
    }

    // 2. Search Input Header Click
    if (this.isInRect(clientX, clientY, this.searchInputRect)) {
      this.showSearchDropdown = !this.showSearchDropdown;
      return true;
    }

    // 3. Filter Pills
    for (const f of this.filterPillRects) {
      if (this.isInRect(clientX, clientY, f)) {
        this.activeFilter = this.activeFilter === f.type ? null : f.type;
        this.onFilterChangeCb(this.activeFilter);
        return true;
      }
    }

    // 4. Chronicles
    if (this.isInRect(clientX, clientY, this.chroniclesBtnRect)) {
      this.onOpenChroniclesCb();
      return true;
    }

    // 5. Pathfinder
    if (this.isInRect(clientX, clientY, this.pathfinderBtnRect)) {
      this.onOpenPathfinderCb();
      return true;
    }

    // 6. Fullscreen
    if (this.isInRect(clientX, clientY, this.fullscreenBtnRect)) {
      this.onToggleFullscreenCb();
      return true;
    }

    // Clicked elsewhere on header
    if (this.showSearchDropdown) {
      this.showSearchDropdown = false;
      return true;
    }

    return clientY <= 64;
  }

  private isInRect(
    x: number,
    y: number,
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
