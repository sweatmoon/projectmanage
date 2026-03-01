import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export interface Project {
  id: number
  project_name: string
  organization: string
  status: string
  deadline?: string
  notes?: string
  updated_at?: string
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
export const getProjects = () => api.get<Project[]>('/projects').then(r => r.data)
export const createProject = (d: Partial<Project>) => api.post<Project>('/projects', d).then(r => r.data)
export const updateProject = (id: number, d: Partial<Project>) => api.put<Project>(`/projects/${id}`, d).then(r => r.data)
export const deleteProject = (id: number) => api.delete(`/projects/${id}`)

// People
export const getPeople = () => api.get<Person[]>('/people').then(r => r.data)
export const createPerson = (d: Partial<Person>) => api.post<Person>('/people', d).then(r => r.data)
export const updatePerson = (id: number, d: Partial<Person>) => api.put<Person>(`/people/${id}`, d).then(r => r.data)
export const deletePerson = (id: number) => api.delete(`/people/${id}`)

// Phases
export const getPhases = (project_id?: number) =>
  api.get<Phase[]>('/phases', { params: project_id ? { project_id } : {} }).then(r => r.data)
export const createPhase = (d: Partial<Phase>) => api.post<Phase>('/phases', d).then(r => r.data)
export const updatePhase = (id: number, d: Partial<Phase>) => api.put<Phase>(`/phases/${id}`, d).then(r => r.data)
export const deletePhase = (id: number) => api.delete(`/phases/${id}`)

// Staffing
export const getStaffing = (project_id?: number) =>
  api.get<Staffing[]>('/staffing', { params: project_id ? { project_id } : {} }).then(r => r.data)
export const createStaffing = (d: Partial<Staffing>) => api.post<Staffing>('/staffing', d).then(r => r.data)
export const updateStaffing = (id: number, d: Partial<Staffing>) => api.put<Staffing>(`/staffing/${id}`, d).then(r => r.data)
export const deleteStaffing = (id: number) => api.delete(`/staffing/${id}`)

// Calendar entries
export const getCalendarEntries = (staffing_id?: number) =>
  api.get<CalendarEntry[]>('/calendar_entries', { params: staffing_id ? { staffing_id } : {} }).then(r => r.data)
export const createCalendarEntry = (d: { staffing_id: number; entry_date: string; status?: string }) =>
  api.post<CalendarEntry>('/calendar_entries', d).then(r => r.data)
export const bulkCreateEntries = (entries: { staffing_id: number; entry_date: string; status?: string }[]) =>
  api.post('/calendar_entries/bulk', entries).then(r => r.data)
export const deleteCalendarEntry = (id: number) => api.delete(`/calendar_entries/${id}`)

// Calendar toggle/month (새 API)
export const toggleCalendarEntry = (staffing_id: number, entry_date: string, status?: string) =>
  api.post('/calendar_entries/toggle', { staffing_id, entry_date, status }).then(r => r.data)

export const getMonthEntries = (year: number, month: number, staffing_ids?: number[]) =>
  api.post<CalendarEntry[]>('/calendar_entries/month', { year, month, staffing_ids }).then(r => r.data)

export const cleanupDuplicates = () =>
  api.delete('/calendar_entries/cleanup-duplicates').then(r => r.data)

export default api
