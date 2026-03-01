/**
 * REST API client that replaces @metagptx/web-sdk
 * Maps client.entities.X.method() → REST API calls to /api/v1/entities/X
 * Maps client.apiCall.invoke() → direct axios calls
 */
import axios from 'axios';

const V1_ENTITIES = '/api/v1/entities';

const http = axios.create({ baseURL: '/' });

// Generic entity endpoints mapping
const ENTITY_PATHS: Record<string, string> = {
  projects: `${V1_ENTITIES}/projects`,
  people: `${V1_ENTITIES}/people`,
  phases: `${V1_ENTITIES}/phases`,
  staffing: `${V1_ENTITIES}/staffing`,
  calendar_entries: `${V1_ENTITIES}/calendar_entries`,
};

interface QueryOptions {
  query?: Record<string, any>;
  limit?: number;
  sort?: string;
  skip?: number;
}

interface EntityResponse<T = any> {
  data: {
    items: T[];
    total?: number;
  };
}

interface SingleEntityResponse<T = any> {
  data: T;
}

function createEntityClient(entityName: string) {
  const basePath = ENTITY_PATHS[entityName];
  if (!basePath) throw new Error(`Unknown entity: ${entityName}`);

  return {
    async query(options: QueryOptions = {}): Promise<EntityResponse> {
      const params: Record<string, any> = {};
      if (options.query && Object.keys(options.query).length > 0) {
        params.query = JSON.stringify(options.query);
      }
      if (options.limit) params.limit = options.limit;
      if (options.sort) params.sort = options.sort;
      if (options.skip) params.skip = options.skip;

      const res = await http.get(basePath, { params });
      // Normalize response: some endpoints return array, some return {items:[]}
      const rawData = res.data;
      if (Array.isArray(rawData)) {
        return { data: { items: rawData, total: rawData.length } };
      }
      if (rawData && Array.isArray(rawData.items)) {
        return { data: rawData };
      }
      return { data: { items: rawData || [], total: 0 } };
    },

    async get({ id }: { id: string }): Promise<SingleEntityResponse> {
      const res = await http.get(`${basePath}/${id}`);
      return { data: res.data };
    },

    async create({ data }: { data: Record<string, any> }): Promise<SingleEntityResponse> {
      const res = await http.post(basePath, data);
      return { data: res.data };
    },

    async update({ id, data }: { id: string; data: Record<string, any> }): Promise<SingleEntityResponse> {
      const res = await http.put(`${basePath}/${id}`, data);
      return { data: res.data };
    },

    async delete({ id }: { id: string }): Promise<void> {
      await http.delete(`${basePath}/${id}`);
    },
  };
}

interface ApiCallOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: any;
  params?: Record<string, any>;
}

export const client = {
  entities: {
    projects: createEntityClient('projects'),
    people: createEntityClient('people'),
    phases: createEntityClient('phases'),
    staffing: createEntityClient('staffing'),
    calendar_entries: createEntityClient('calendar_entries'),
  },

  apiCall: {
    async invoke({ url, method, data, params }: ApiCallOptions) {
      const res = await http.request({
        url,
        method,
        data,
        params,
      });
      return { data: res.data };
    },
  },
};
