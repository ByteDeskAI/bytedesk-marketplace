export interface Comment {
  id: number;
  issue_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  type: 'task' | 'bug' | 'story' | 'epic';
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
  priority: 'low' | 'medium' | 'high' | 'critical';
  epic_id: string | null;
  sprint_id: string | null;
  comments: Comment[];
  created_at: string;
  updated_at: string;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: 'PLANNING' | 'ACTIVE' | 'CLOSED';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface SprintProgress {
  total_tickets: number;
  done_tickets: number;
}

export interface Dashboard {
  project_name: string;
  key_prefix: string;
  active_sprint: string;
  sprint_progress: SprintProgress;
  columns: {
    TODO: string[];
    IN_PROGRESS: string[];
    REVIEW: string[];
    DONE: string[];
  };
  dashboard_url?: string;
}

export interface ActivityEntry {
  timestamp: string;
  action: string;
  details: string;
}

export interface StatusResponse {
  ok: boolean;
  dashboard: Dashboard;
  issues: Issue[];
  activity: ActivityEntry[];
}

export interface Doc {
  id: string;
  title: string;
  content: string;
  doc_type?: 'wiki' | 'adr' | 'plan' | 'learning' | 'brief' | 'runbook';
  doc_status?: string;
  superseded_by?: string | null;
  linked_issues?: string[];
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocsResponse {
  ok: boolean;
  count: number;
  documents: Doc[];
}

export interface DocResponse {
  ok: boolean;
  document: Doc;
}

export type ViewId = 'board' | 'backlog' | 'docs' | 'activity' | 'plan';
