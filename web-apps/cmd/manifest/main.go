package main

import (
	"encoding/json"
	"log"
	"os"

	webapps "github.com/ByteDeskAI/bytedesk-marketplace/web-apps/webappplugin"
)

func main() {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(webapps.New().Manifest()); err != nil {
		log.Fatal(err)
	}
}
