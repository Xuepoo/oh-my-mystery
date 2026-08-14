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
      return data.map((e) => ({
        ...e,
        id: String(e.id),
        labels: e.names?.labels || { '': String(e.id) },
      }));
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

      const facts: KgFact[] = (data.facts || []).map((f) => ({
        source: String(f.subject_id),
        target: String(f.object_ref),
        predicate: f.predicate,
      }));

      const neighbors: KgEntity[] = (data.neighbors || []).map((n) => ({
        ...n,
        id: String(n.id),
        labels: n.names?.labels || (typeof n.labels === 'object' ? n.labels : { '': String(n.id) }),
      }));

      const neighborhood: KgNeighborhood = {
        entity: {
          ...data.entity,
          id: String(data.entity.id),
          labels:
            data.entity.names?.labels ||
            (typeof data.entity.labels === 'object' ? data.entity.labels : { '': strId }),
        },
        facts,
        neighbors,
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
      return (data.seeds || []).map((e) => ({
        ...e,
        id: String(e.id),
        labels: e.names?.labels || { '': String(e.id) },
      }));
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
