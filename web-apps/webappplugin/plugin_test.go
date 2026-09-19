package webappplugin

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	pluginsdk "github.com/ByteDeskAI/bytedesk-remote-gateway-plugin-sdk"
)

type testHost struct{}

func (testHost) Publish(pluginsdk.Envelope) error                  { return nil }
func (testHost) Subscribe(string, func(pluginsdk.Envelope)) func() { return func() {} }
func (testHost) Request(context.Context, pluginsdk.Envelope) (pluginsdk.Envelope, error) {
	return pluginsdk.Envelope{}, nil
}
func (testHost) Logger() pluginsdk.Logger           { return nil }
func (testHost) Profiling() pluginsdk.Profiler      { return pluginsdk.NopProfiler() }
func (testHost) StateDir(string) string             { return "" }
func (testHost) Every(time.Duration, func()) func() { return func() {} }
func (testHost) BumpContributions()                 {}

func TestManifestOwnsProjectViewAndDirectoryActionPanels(t *testing.T) {
	m := New().Manifest()
	if len(m.ProjectViews) != 1 || m.ProjectViews[0].ID != ProjectViewID || m.ProjectViews[0].PanelID != WorkspacePanelID {
		t.Fatalf("project view: %#v", m.ProjectViews)
	}
	if len(m.DirectoryContextActions) != 1 || m.DirectoryContextActions[0].ID != DirectoryActionID || m.DirectoryContextActions[0].WizardPanelID != CreationPanelID {
		t.Fatalf("directory action: %#v", m.DirectoryContextActions)
	}
	owned := map[string]bool{}
	for _, panel := range m.Panels {
		owned[panel.ID] = true
	}
	if !owned[m.ProjectViews[0].PanelID] || !owned[m.DirectoryContextActions[0].WizardPanelID] {
		t.Fatal("contribution references a panel not owned by this manifest")
	}
	if err := m.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestPackageManifestMatchesImplementation(t *testing.T) {
	raw, err := os.ReadFile("../plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	var m pluginsdk.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(m, New().Manifest()) {
		t.Fatal("regenerate plugin.json with go run ./cmd/manifest")
	}
}

func TestLifecycleWithdrawsOwnerLocalAssets(t *testing.T) {
	p := New()
	request := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		p.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	if got := request("/p/web-apps/assets/panel.mjs").Code; got != 503 {
		t.Fatalf("unstarted status = %d", got)
	}
	if err := p.Start(context.Background(), testHost{}); err != nil {
		t.Fatal(err)
	}
	if err := p.CheckActivation(context.Background()); err != nil {
		t.Fatal(err)
	}
	module := request("/p/web-apps/assets/panel.mjs")
	if module.Code != 200 || !strings.Contains(module.Body.String(), "export function mount(element, host)") {
		t.Fatalf("module response = %d", module.Code)
	}
	if got := request("/p/web-apps/create"); got.Code != 200 || !strings.Contains(got.Body.String(), "Update Gateway") {
		t.Fatalf("fallback response = %d", got.Code)
	}
	if err := p.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := request("/p/web-apps/assets/styles.css").Code; got != 503 {
		t.Fatalf("withdrawn status = %d", got)
	}
}
