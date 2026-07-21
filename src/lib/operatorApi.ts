export type ReviewDecision = 'eligible_for_human_publish' | 'needs_human_review' | 'reject' | null;

export type OperatorSubmission = {
  id: string;
  entityType: 'place_suggestion' | 'restroom_update';
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
  aiReview: { decision?: ReviewDecision; confidence?: number; reason?: string; description?: string; proposed_tags?: string[]; concerns?: string[]; operator_actions?: Array<{ action: string; at: string }> } | null;
  photoUrl: string | null;
  photoPath: string | null;
};

export type OperatorDashboard = {
  stats: { published: number; candidateLeads: number; gptApproved: number; needsJudgment: number; gptRejected: number; reviewed: number };
  needsJudgment: OperatorSubmission[];
  gptApproved: OperatorSubmission[];
  rejected: OperatorSubmission[];
  audit: OperatorSubmission[];
};

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
