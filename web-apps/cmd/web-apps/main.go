package main

import (
	"context"
	"log"

	webapps "github.com/ByteDeskAI/bytedesk-marketplace/web-apps/webappplugin"
	pluginsdk "github.com/ByteDeskAI/bytedesk-remote-gateway-plugin-sdk"
)

func main() {
	if err := pluginsdk.ServePlugin(context.Background(), webapps.New(), pluginsdk.PluginConfig{}); err != nil {
		log.Fatal(err)
	}
}
