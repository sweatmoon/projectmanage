import axios from 'axios'

const api = axios.create({ baseURL: '/api/v1' })

export interface Project {
  id: number
  project_name: string
  organization: string
  status: string
  deadline?: string
  notes?: string
  updated_at?: string
  color_hue?: number
  is_won?: boolean
}

export interface Person {
  id: number
  person_name: string
  team?: string
  grade?: string
  employment_status?: string
}

export interface Phase {
  id: number
  project_id: number
  phase_name: string
  start_date?: string
  end_date?: string
  sort_order: number
}

export interface Staffing {
  id: number
  project_id: number
  phase_id: number
  category: string
  field: string
  sub_field: string
  person_id?: number
  person_name_text?: string
  md?: number
}

export interface CalendarEntry {
  id: number
  staffing_id: number
  entry_date: string
  status?: string
}

// Projects
export const getProjects = () => api.get<{items: Project[]}>('/entities/projects', { params: { limit: 500 } }).then(r => r.data.items)
export const createProject = (d: Partial<Project>) => api.post<Project>('/entities/projects', d).then(r => r.data)
export const updateProject = (id: number, d: Partial<Project>) => api.put<Project>(`/entities/projects/${id}`, d).then(r => r.data)
export const deleteProject = (id: number) => api.delete(`/entities/projects/${id}`)

// People
export const getPeople = () => api.get<{items: Person[]}>('/entities/people', { params: { limit: 500 } }).then(r => r.data.items)
export const createPerson = (d: Partial<Person>) => api.post<Person>('/entities/people', d).then(r => r.data)
export const updatePerson = (id: number, d: Partial<Person>) => api.put<Person>(`/entities/people/${id}`, d).then(r => r.data)
export const deletePerson = (id: number) => api.delete(`/entities/people/${id}`)

// Phases
export const getPhases = (project_id?: number) =>
  api.get<{items: Phase[]}>('/entities/phases', { params: { limit: 2000, ...(project_id ? { project_id } : {}) } }).then(r => r.data.items)
export const createPhase = (d: Partial<Phase>) => api.post<Phase>('/entities/phases', d).then(r => r.data)
export const updatePhase = (id: number, d: Partial<Phase>) => api.put<Phase>(`/entities/phases/${id}`, d).then(r => r.data)
export const deletePhase = (id: number) => api.delete(`/entities/phases/${id}`)

// Staffing
export const getStaffing = (project_id?: number) =>
  api.get<{items: Staffing[]}>('/entities/staffing', { params: { limit: 2000, ...(project_id ? { project_id } : {}) } }).then(r => r.data.items)
export const createStaffing = (d: Partial<Staffing>) => api.post<Staffing>('/entities/staffing', d).then(r => r.data)
export const updateStaffing = (id: number, d: Partial<Staffing>) => api.put<Staffing>(`/entities/staffing/${id}`, d).then(r => r.data)
export const deleteStaffing = (id: number) => api.delete(`/entities/staffing/${id}`)

// Calendar entries
export const getCalendarEntries = (staffing_id?: number) =>
  api.get<CalendarEntry[]>('/entities/calendar_entries', { params: staffing_id ? { staffing_id } : {} }).then(r => r.data)
export const createCalendarEntry = (d: { staffing_id: number; entry_date: string; status?: string }) =>
  api.post<CalendarEntry>('/entities/calendar_entries', d).then(r => r.data)
export const bulkCreateEntries = (entries: { staffing_id: number; entry_date: string; status?: string }[]) =>
  api.post('/entities/calendar_entries/batch', entries).then(r => r.data)
export const deleteCalendarEntry = (id: number) => api.delete(`/entities/calendar_entries/${id}`)

// Calendar toggle/month/range (새 API)
export const toggleCalendarEntry = (staffing_id: number, entry_date: string, status?: string) =>
  api.post('/calendar/toggle', { staffing_id, entry_date, status }).then(r => r.data)

export const getMonthEntries = (year: number, month: number, staffing_ids?: number[]) =>
  api.post<{ entries: CalendarEntry[] }>('/calendar/month', { year, month, staffing_ids }).then(r => r.data.entries)

export const getRangeEntries = (start_date: string, end_date: string, staffing_ids?: number[]) =>
  api.post<{ entries: CalendarEntry[] }>('/calendar/range', { start_date, end_date, staffing_ids }).then(r => r.data.entries)

export const cleanupDuplicates = () =>
  api.delete('/calendar/cleanup-duplicates').then(r => r.data)

export default api
