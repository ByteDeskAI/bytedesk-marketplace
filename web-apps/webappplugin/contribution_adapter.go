package webappplugin

import pluginsdk "github.com/ByteDeskAI/bytedesk-remote-gateway-plugin-sdk"

// This file is the only mapping between Web Apps concepts and the reusable
// Projects contribution contract. Keeping the mapping here lets the plugin adopt
// the released SDK types without coupling its UI or runtime implementation to host
// internals.

const (
	ProjectViewID        = "web-apps"
	WorkspacePanelID     = "web-apps"
	DirectoryActionID    = "create-web-app"
	CreationPanelID      = "create-web-app"
	ProjectViewLabel     = "Web Apps"
	DirectoryActionLabel = "Create Web App"
)

func projectViewContribution() pluginsdk.ProjectViewContribution {
	return pluginsdk.ProjectViewContribution{
		ID: ProjectViewID, Label: ProjectViewLabel, Icon: "globe", Order: 30,
		PanelID: WorkspacePanelID,
	}
}

func directoryActionContribution() pluginsdk.DirectoryContextActionContribution {
	return pluginsdk.DirectoryContextActionContribution{
		ID: DirectoryActionID, Label: DirectoryActionLabel, Icon: "globe", Order: 40,
		WizardPanelID: CreationPanelID,
	}
}
