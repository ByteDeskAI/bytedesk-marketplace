export interface Comment {
  id: number;
  issue_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
  done_at: string | null;
}

export interface SessionHandoff {
  next_step: string;
  files_in_progress: string[];
  partial_criteria_done: number[];
  created_at: string;
}

export interface IssueRisk {
  type: 'security' | 'data_loss' | 'breaking_change' | 'external_integration' | 'compliance';
  reason: string;
  flagged_at: string;
}

export type IssueStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'NEEDS_INPUT' | 'DRAFT';
export type IssueScope = 'nano' | 'small' | 'medium' | 'large' | 'research';

export interface IssueLink {
  from_id: string;
  to_id: string;
  type: 'blocks' | 'is-blocked-by' | 'relates-to' | 'duplicates' | 'is-duplicated-by' | 'clones' | 'is-cloned-by';
  created_at: string;
}

export interface RemoteLink {
  url: string;
  title: string;
  created_at: string;
}

export interface CommitLink {
  sha: string;
  short_sha: string;
  message: string;
  url: string;
  created_at: string;
}

export interface SessionSummary {
  summary: string;
  files_changed: string[];
  tests_added: string[];
  created_at: string;
}

export interface IssueCheckin {
  progress: number;
  what_done: string;
  what_remains: string;
  created_at: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  type: 'task' | 'bug' | 'story' | 'epic';
  status: IssueStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  scope: IssueScope | null;
  epic_id: string | null;
  sprint_id: string | null;
  acceptance_criteria: string[];
  criteria_done: number[];
  links: IssueLink[];
  remote_links: RemoteLink[];
  commit_links: CommitLink[];
  session_summaries: SessionSummary[];
  flagged_reason: string | null;
  flagged_options: string[];
  comments: Comment[];
  progress: number;
  checkins?: IssueCheckin[];
  created_at: string;
  updated_at: string;
  tags: string[];
  assignee: string | null;
  pinned: boolean;
  weight: number;
  reopen_count: number;
  checklist: ChecklistItem[];
  handoff: SessionHandoff | null;
  risk: IssueRisk | null;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: 'PLANNING' | 'ACTIVE' | 'CLOSED';
  duration_days: number;
  epic_ids: string[];
  created_at: string;
  started_at: string | null;
  end_date: string | null;
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
  active_sprint_id?: string | null;
  sprint_end_date?: string | null;
  sprint_progress: SprintProgress;
  columns: {
    TODO: string[];
    IN_PROGRESS: string[];
    REVIEW: string[];
    DONE: string[];
  };
  dashboard_url?: string;
  wip_limits?: Record<string, number>;
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
