import type {
  KgDataSource,
  KgEntity,
  KgFact,
  KgNeighborhood,
  NodeId,
} from '@vectojs/knowledge-graph';
import type {
  ChronicleTrail,
  EntityDetailResponse,
  PathfinderResult,
  SearchResponse,
} from '@omm/shared';
import { Theme } from '../ui/theme';

export class D1DataSource implements KgDataSource {
  private baseUrl: string;
  private turnstileToken: string | null = null;
  private cache = new Map<string, KgNeighborhood>();

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  setTurnstileToken(token: string | null) {
    this.turnstileToken = token;
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

  private formatNode(e: any): KgEntity & { color: string; val: number } {
    const type = e.type || 'other';
    return {
      ...e,
      id: String(e.id),
      type,
      color: Theme.getNodeColor(type),
      val: type === 'author' ? 1.4 : type === 'work' ? 1.0 : type === 'character' ? 0.9 : 0.8,
      labels: e.names?.labels || (typeof e.labels === 'object' ? e.labels : { '': String(e.id) }),
    };
  }

  async getNodes(ids?: readonly NodeId[]): Promise<readonly KgEntity[]> {
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
    _options?: { limit?: number; direction?: 'out' | 'in' | 'both' },
  ): Promise<KgNeighborhood> {
    const strId = String(id);
    if (this.cache.has(strId)) {
      return this.cache.get(strId)!;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/api/entity/${encodeURIComponent(strId)}/neighbors?limit=50`,
        {
          headers: this.getHeaders(),
        },
      );
      if (!res.ok) {
        return {
          entity: { id: strId, type: 'other', labels: { '': strId } },
          facts: [],
          neighbors: [],
        };
      }

      const data = (await res.json()) as {
        entity: any;
        facts: any[];
        neighbors: any[];
      };

      const rawNeighbors: (KgEntity & { color: string; val: number })[] = (
        data.neighbors || []
      ).map((n) => this.formatNode(n));

      const knownNodeIds = new Set<string>([
        String(data.entity.id),
        ...rawNeighbors.map((n) => String(n.id)),
      ]);

      const facts: KgFact[] = [];
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

      const neighborhood: KgNeighborhood = {
        entity: this.formatNode(data.entity),
        facts,
        neighbors: rawNeighbors,
      };

      this.cache.set(strId, neighborhood);
      return neighborhood;
    } catch (err) {
      console.error('Failed to get neighbors for', strId, err);
      return {
        entity: { id: strId, type: 'other', labels: { '': strId } },
        facts: [],
        neighbors: [],
      };
    }
  }

  async fetchSeeds(): Promise<KgEntity[]> {
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
}
