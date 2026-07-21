export type ReviewDecision = 'eligible_for_human_publish' | 'needs_human_review' | 'reject' | null;

export type OperatorSubmission = {
  id: string;
  entityType: 'place_suggestion' | 'restroom_update' | 'research_lead';
  title: string;
  subtitle: string;
  category: string | null;
  note: string;
  accessDetail: string | null;
  cleanlinessRating: number | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  aiReviewStatus: 'queued' | 'reviewing' | 'reviewed' | 'error';
  aiReviewedAt: string | null;
  aiReviewError: string | null;
  aiReview: { decision?: ReviewDecision; confidence?: number; reason?: string; description?: string; proposed_tags?: string[]; concerns?: string[]; route?: string; operator_actions?: Array<{ action: string; at: string; actor?: 'autopilot' | 'operator'; applied_fields?: string[] }> } | null;
  photoUrl: string | null;
  photoPath: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
};

export type OperatorDashboard = {
  stats: { published: number; candidateLeads: number; gptApproved: number; operatorApproved: number; needsJudgment: number; gptRejected: number; reviewed: number };
  needsJudgment: OperatorSubmission[];
  gptApproved: OperatorSubmission[];
  operatorApproved: OperatorSubmission[];
  rejected: OperatorSubmission[];
  audit: OperatorSubmission[];
  autopilot: AutopilotPolicy;
};

export type AutopilotPolicy = { enabled: boolean; confidenceThreshold: number; configured: boolean };

export type ResearchLead = { id: string; name: string; address: string | null; venue_type: string; source_name: string; source_url: string | null; source_license: string | null; evidence_note: string | null; status: 'pending' | 'approved' | 'rejected'; ai_proposal: { route?: 'publish_to_map' | 'operator_publish' | 'evidence_collection' | 'needs_judgment' | 'reject'; confidence?: number; reason?: string; evidence_needed?: string; processed_at?: string } | null };
export type ResearchLeads = { stats: { total: number; triaged: number; remaining: number; rejected: number; published: number }; leads: ResearchLead[] };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Operator request failed.');
  return data;
}

export const operatorLogin = (password: string) => request('/api/operator/login', { method: 'POST', body: JSON.stringify({ password }) });
export const loadOperatorDashboard = () => request('/api/operator/dashboard') as Promise<OperatorDashboard>;
export const submitOperatorReview = (entityType: OperatorSubmission['entityType'], id: string, action: 'approve' | 'reject' | 'edit_and_requeue', note?: string) => request('/api/operator/review', { method: 'POST', body: JSON.stringify({ entityType, id, action, note }) }) as Promise<{ ok: boolean; message: string }>;
export const autoApproveGptReady = () => request('/api/operator/review', { method: 'POST', body: JSON.stringify({ action: 'auto_approve_all' }) }) as Promise<{ ok: boolean; message: string }>;
export const operatorLogout = () => request('/api/operator/logout', { method: 'POST' });
export const loadResearchLeads = () => request('/api/operator/research') as Promise<ResearchLeads>;
export const processResearchLeads = (ids?: string[]) => request('/api/operator/research', { method: 'POST', body: JSON.stringify({ ids, limit: 100 }) }) as Promise<{ ok: boolean; processed: number; routeCounts?: Record<string, number>; message: string }>;
export const publishResearchLeads = (ids: string[]) => request('/api/operator/research', { method: 'POST', body: JSON.stringify({ action: 'publish_selected', ids }) }) as Promise<{ ok: boolean; published: number; message: string }>;
export const saveAutopilotPolicy = (enabled: boolean, confidenceThreshold: number) => request('/api/operator/autopilot', { method: 'POST', body: JSON.stringify({ enabled, confidenceThreshold }) }) as Promise<AutopilotPolicy>;
export const syncApprovedPhotos = () => request('/api/operator/photos', { method: 'POST' }) as Promise<{ ok: boolean; promoted: number }>;
