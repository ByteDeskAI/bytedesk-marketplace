package main

// Phase 12.4 (BDM-28, A15 + B7). Thin Jira client used by the SpawnModal
// "From Jira" + "From Backlog" tabs. Reads credentials from the [jira]
// block in settings.toml; honors JIRA_API_TOKEN env if settings token
// is empty.
//
//   GET /api/jira/issue?key=BDM-99      → {key, summary, description, status}
//   GET /api/jira/backlog?jql=...       → [{key, summary, status, priority}]
//
// Auth: Basic <base64(email:token)>.
// Returns 412 Precondition Failed if [jira] is not configured.

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

func jiraConfigured(s Settings) bool {
	return s.Jira.BaseURL != "" && s.Jira.Email != "" && (s.Jira.APIToken != "" || os.Getenv("JIRA_API_TOKEN") != "")
}

func jiraAuthHeader(s Settings) string {
	tok := s.Jira.APIToken
	if tok == "" {
		tok = os.Getenv("JIRA_API_TOKEN")
	}
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(s.Jira.Email+":"+tok))
}

func handleJiraIssue(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET"))
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		writeError(w, http.StatusBadRequest, errors.New("?key= required"))
		return
	}
	settings, err := deps.settings.Load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !jiraConfigured(settings) {
		writeError(w, http.StatusPreconditionFailed, errors.New("[jira] not configured in settings.toml"))
		return
	}

	u := strings.TrimRight(settings.Jira.BaseURL, "/") + "/rest/api/3/issue/" + url.PathEscape(key) + "?fields=summary,description,status,priority"
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("Authorization", jiraAuthHeader(settings))
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		writeError(w, http.StatusBadGateway, fmt.Errorf("jira %d: %s", resp.StatusCode, string(body)))
		return
	}

	var raw struct {
		Key    string `json:"key"`
		Fields struct {
			Summary     string         `json:"summary"`
			Description map[string]any `json:"description"`
			Status      struct {
				Name string `json:"name"`
			} `json:"status"`
			Priority struct {
				Name string `json:"name"`
			} `json:"priority"`
		} `json:"fields"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	out := map[string]any{
		"key":         raw.Key,
		"summary":     raw.Fields.Summary,
		"description": flattenADF(raw.Fields.Description),
		"status":      raw.Fields.Status.Name,
		"priority":    raw.Fields.Priority.Name,
	}
	writeJSON(w, http.StatusOK, out)
}

func handleJiraBacklog(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET"))
		return
	}
	jql := r.URL.Query().Get("jql")
	if jql == "" {
		jql = "statusCategory != Done ORDER BY priority DESC, updated DESC"
	}
	settings, err := deps.settings.Load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if !jiraConfigured(settings) {
		writeError(w, http.StatusPreconditionFailed, errors.New("[jira] not configured in settings.toml"))
		return
	}

	// Atlassian deprecated GET /rest/api/3/search (CHANGE-2046). The
	// replacement is POST /rest/api/3/search/jql with a JSON body and
	// nextPageToken-style pagination.
	u := strings.TrimRight(settings.Jira.BaseURL, "/") + "/rest/api/3/search/jql"
	bodyIn := map[string]any{
		"jql":        jql,
		"fields":     []string{"summary", "status", "priority"},
		"maxResults": 50,
	}
	bodyJSON, _ := json.Marshal(bodyIn)
	req, _ := http.NewRequest(http.MethodPost, u, strings.NewReader(string(bodyJSON)))
	req.Header.Set("Authorization", jiraAuthHeader(settings))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		writeError(w, http.StatusBadGateway, fmt.Errorf("jira %d: %s", resp.StatusCode, string(respBody)))
		return
	}

	var raw struct {
		Issues []struct {
			Key    string `json:"key"`
			Fields struct {
				Summary string `json:"summary"`
				Status  struct {
					Name string `json:"name"`
				} `json:"status"`
				Priority struct {
					Name string `json:"name"`
				} `json:"priority"`
			} `json:"fields"`
		} `json:"issues"`
		NextPageToken string `json:"nextPageToken,omitempty"`
	}
	if err := json.Unmarshal(respBody, &raw); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	out := make([]map[string]any, 0, len(raw.Issues))
	for _, it := range raw.Issues {
		out = append(out, map[string]any{
			"key":      it.Key,
			"summary":  it.Fields.Summary,
			"status":   it.Fields.Status.Name,
			"priority": it.Fields.Priority.Name,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// flattenADF — Atlassian Document Format → plain text. Best-effort
// recursive walk that pulls .text fields out of any nested content
// arrays. Good enough for pre-filling a prompt; users can edit.
func flattenADF(node map[string]any) string {
	if node == nil {
		return ""
	}
	var sb strings.Builder
	walkADF(node, &sb)
	return strings.TrimSpace(sb.String())
}

func walkADF(node map[string]any, sb *strings.Builder) {
	if t, ok := node["text"].(string); ok {
		sb.WriteString(t)
	}
	if t, ok := node["type"].(string); ok && (t == "paragraph" || t == "hardBreak") {
		// emit newlines for paragraph boundaries on the way back up
	}
	if content, ok := node["content"].([]any); ok {
		for _, c := range content {
			if cm, ok := c.(map[string]any); ok {
				walkADF(cm, sb)
			}
		}
		// paragraph terminator
		if t, ok := node["type"].(string); ok && t == "paragraph" {
			sb.WriteString("\n")
		}
	}
}
