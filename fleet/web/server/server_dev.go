//go:build dev

package main

// Dev mode: dist/ is read from disk. esbuild's --watch mode rewrites
// those files and the next request picks up the change without
// rebuilding the Go binary. Pair with `air` for Go-side reload.
//
// `buildHandler` calls `fs.Sub(distFS, "dist")`, so distFS must be
// rooted at the parent of `dist/` — that's the server source directory
// when `air` runs from there (or whatever FLEET_WEB_ROOT points at).

import (
	"log"
	"os"
)

func init() {
	root := os.Getenv("FLEET_WEB_ROOT")
	if root == "" {
		root = "."
	}
	distFS = os.DirFS(root)
	log.Printf("dev: distFS rooted at %q (expects %q to contain a dist/ subdir)", root, root)
}
