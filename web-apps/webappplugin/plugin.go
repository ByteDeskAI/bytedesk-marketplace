// Package webappplugin implements the Gateway Web Apps plugin independently of
// the host. The host supplies resolved project, checkout, directory, principal,
// and runtime operations through the SDK boundary.
package webappplugin

import (
	"context"
	_ "embed"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"

	pluginsdk "github.com/ByteDeskAI/bytedesk-remote-gateway-plugin-sdk"
)

const Version = "0.2.0"

var requestPermissions = []string{
	"cmd.web-apps.v1.list", "cmd.web-apps.v1.create", "cmd.web-apps.v1.creation-eligibility",
	"cmd.web-apps.v1.conversation.send", "cmd.web-apps.v1.conversation.approve", "cmd.web-apps.v1.conversation.answer",
	"cmd.web-apps.v1.run.stop", "cmd.web-apps.v1.services.start", "cmd.web-apps.v1.services.stop",
	"cmd.web-apps.v1.services.logs", "cmd.web-apps.v1.preview.resolve", "cmd.web-apps.v1.preview.navigate",
	"cmd.web-apps.v1.preview.open-external",
}

//go:embed panel.mjs
var panelModule []byte

//go:embed styles.css
var styles []byte

//go:embed fallback.html
var fallback []byte

type Plugin struct{ active atomic.Bool }

func New() *Plugin         { return &Plugin{} }
func (*Plugin) ID() string { return "web-apps" }

func (p *Plugin) Manifest() pluginsdk.Manifest {
	return pluginsdk.Manifest{
		ID: p.ID(), Version: Version,
		Targets: []string{pluginsdk.TargetGateway},
		Spawn:   true, Binary: "web-apps", Socket: "plugin.sock",
		Routes: []string{"/p/web-apps/"}, Scopes: []string{"plugin:web-apps"},
		Panels: []pluginsdk.PanelSpec{
			{ID: WorkspacePanelID, Kind: WorkspacePanelID, URL: "/p/web-apps/ui", Module: "/p/web-apps/assets/panel.mjs"},
			{ID: CreationPanelID, Kind: CreationPanelID, URL: "/p/web-apps/create", Module: "/p/web-apps/assets/panel.mjs"},
		},
		ProjectViews:            []pluginsdk.ProjectViewContribution{projectViewContribution()},
		DirectoryContextActions: []pluginsdk.DirectoryContextActionContribution{directoryActionContribution()},
		Protocol: &pluginsdk.ProtocolRequirements{
			Major:    pluginsdk.ProtocolMajor,
			Required: []string{pluginsdk.FeatureScopedHost, pluginsdk.FeatureActivationCheck, pluginsdk.FeatureUIModuleMount},
		},
		Permissions: &pluginsdk.Permissions{Request: append([]string(nil), requestPermissions...)},
	}
}

func (p *Plugin) Start(ctx context.Context, host pluginsdk.Host) error {
	if host == nil {
		return fmt.Errorf("host required")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	p.active.Store(true)
	return nil
}

func (p *Plugin) CheckActivation(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !p.active.Load() {
		return fmt.Errorf("plugin not started")
	}
	return nil
}

func (p *Plugin) Stop(context.Context) error { p.active.Store(false); return nil }

func (p *Plugin) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !p.active.Load() {
			http.Error(w, "Web Apps is unavailable", http.StatusServiceUnavailable)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		path := r.URL.Path
		if strings.HasPrefix(path, "/p/web-apps") {
			path = strings.TrimPrefix(path, "/p/web-apps")
			if path == "" {
				path = "/"
			}
		}
		switch path {
		case "/healthz":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("ok"))
		case "/assets/panel.mjs":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			_, _ = w.Write(panelModule)
		case "/assets/styles.css":
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
			_, _ = w.Write(styles)
		case "/", "/ui", "/create":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(fallback)
		default:
			http.NotFound(w, r)
		}
	})
}

var _ pluginsdk.Plugin = (*Plugin)(nil)
var _ pluginsdk.HTTPPlugin = (*Plugin)(nil)
var _ pluginsdk.ActivationChecker = (*Plugin)(nil)
