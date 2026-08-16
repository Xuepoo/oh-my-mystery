import type {
  ChronicleTrail,
  EntityDetailResponse,
  PathfinderResult,
  SearchResponse,
  StatsResponse,
} from '@omm/shared';
import type { GraphLink2D, GraphNeighborhood2D, GraphNode2D, NodeId } from '../scene/types';
import { pickNodeLabel } from '../scene/types';
import { Theme } from '../ui/theme';

export class D1DataSource {
  private baseUrl: string;
  private turnstileToken: string | null = null;
  private cache = new Map<string, GraphNeighborhood2D>();
  private cacheOrder: string[] = [];
  private cacheMax = 200;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  setTurnstileToken(token: string | null) {
    this.turnstileToken = token;
  }

  private cacheSet(key: string, value: GraphNeighborhood2D) {
    if (!this.cache.has(key)) this.cacheOrder.push(key);
    this.cache.set(key, value);
    while (this.cacheOrder.length > this.cacheMax) {
      const oldest = this.cacheOrder.shift()!;
      this.cache.delete(oldest);
    }
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.turnstileToken) {
      headers['X-Turnstile-Token'] = this.turnstileToken;
    }
    return headers;
  }

  private formatNode(e: any): GraphNode2D {
    const type = e.type || 'other';
    const labels =
      e.names?.labels || (typeof e.labels === 'object' ? e.labels : { zh: String(e.id) });
    const name = pickNodeLabel(labels, 'zh') || String(e.id);

    return {
      id: String(e.id),
      type,
      name,
      color: Theme.getNodeColor(type),
      val: type === 'author' ? 1.4 : type === 'work' ? 1.0 : type === 'character' ? 0.9 : 0.8,
      labels,
    };
  }

  async getNodes(ids?: readonly NodeId[]): Promise<readonly GraphNode2D[]> {
    if (!ids || ids.length === 0) {
      return this.fetchSeeds();
    }
    try {
      const idsParam = ids.map((id) => String(id)).join(',');
      const res = await fetch(`${this.baseUrl}/api/nodes?ids=${encodeURIComponent(idsParam)}`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any[];
      return data.map((e) => this.formatNode(e));
    } catch (err) {
      console.error('Failed to get nodes', err);
      return [];
    }
  }

  async getNeighbors(
    id: NodeId,
    options?: { limit?: number; direction?: 'out' | 'in' | 'both' },
  ): Promise<GraphNeighborhood2D> {
    const strId = String(id);
    const limit = Math.min(50, Math.max(1, options?.limit ?? 50));
    const cacheKey = `${strId}:${limit}`;
    if (this.cache.has(cacheKey)) {
      const idx = this.cacheOrder.indexOf(cacheKey);
      if (idx !== -1) {
        this.cacheOrder.splice(idx, 1);
        this.cacheOrder.push(cacheKey);
      }
      return this.cache.get(cacheKey)!;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/api/entity/${encodeURIComponent(strId)}/neighbors?limit=${limit}`,
        {
          headers: this.getHeaders(),
        },
      );
      if (!res.ok) {
        return {
          entity: {
            id: strId,
            type: 'other',
            name: strId,
            color: Theme.getNodeColor('other'),
            val: 0.8,
            labels: { zh: strId },
          },
          facts: [],
          neighbors: [],
        };
      }

      const data = (await res.json()) as {
        entity: any;
        facts: any[];
        neighbors: any[];
      };

      const rawNeighbors: GraphNode2D[] = (data.neighbors || []).map((n) => this.formatNode(n));

      const knownNodeIds = new Set<string>([
        String(data.entity.id),
        ...rawNeighbors.map((n) => String(n.id)),
      ]);

      const facts: GraphLink2D[] = [];
      for (const f of data.facts || []) {
        const src = String(f.subject_id || f.source || '');
        const tgt = String(f.object_ref || f.target || '');
        if (src && tgt && knownNodeIds.has(src) && knownNodeIds.has(tgt)) {
          facts.push({
            source: src,
            target: tgt,
            predicate: f.predicate || 'relation',
          });
        }
      }

      const neighborhood: GraphNeighborhood2D = {
        entity: this.formatNode(data.entity),
        facts,
        neighbors: rawNeighbors,
      };

      this.cacheSet(cacheKey, neighborhood);
      return neighborhood;
    } catch (err) {
      console.error('Failed to get neighbors for', strId, err);
      return {
        entity: {
          id: strId,
          type: 'other',
          name: strId,
          color: Theme.getNodeColor('other'),
          val: 0.8,
          labels: { zh: strId },
        },
        facts: [],
        neighbors: [],
      };
    }
  }

  async fetchSeeds(): Promise<GraphNode2D[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/seeds`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { seeds: any[] };
      return (data.seeds || []).map((e) => this.formatNode(e));
    } catch (err) {
      console.error('Failed to fetch seed entities', err);
      return [];
    }
  }

  async fetchEntityDetails(id: string): Promise<EntityDetailResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/entity/${encodeURIComponent(id)}/details`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as EntityDetailResponse;
    } catch (err) {
      console.error('Failed to fetch entity details for', id, err);
      return null;
    }
  }

  async search(query: string): Promise<SearchResponse> {
    if (!query.trim()) return { query: '', results: [] };
    try {
      const res = await fetch(
        `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=15`,
        {
          headers: this.getHeaders(),
        },
      );
      if (!res.ok) return { query, results: [] };
      return (await res.json()) as SearchResponse;
    } catch (err) {
      console.error('Search failed', err);
      return { query, results: [] };
    }
  }

  async findPath(source: string, target: string): Promise<PathfinderResult | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/path?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`,
        { headers: this.getHeaders() },
      );
      if (!res.ok) return null;
      return (await res.json()) as PathfinderResult;
    } catch (err) {
      console.error('Find path failed', err);
      return null;
    }
  }

  async fetchChronicles(): Promise<ChronicleTrail[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chronicles`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return [];
      return (await res.json()) as ChronicleTrail[];
    } catch (err) {
      console.error('Fetch chronicles failed', err);
      return [];
    }
  }

  async fetchStats(): Promise<StatsResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/stats`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as StatsResponse;
    } catch (err) {
      console.error('Fetch stats failed', err);
      return null;
    }
  }
}
