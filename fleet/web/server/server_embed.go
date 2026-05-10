//go:build !dev

package main

// Production: dist/ is embedded into the binary at build time.
// In dev mode (-tags dev), server_dev.go provides a disk-backed fs.FS
// instead so esbuild rebuilds are picked up without re-embedding.

import "embed"

//go:embed all:dist
var embedFS embed.FS

func init() {
	distFS = embedFS
}
