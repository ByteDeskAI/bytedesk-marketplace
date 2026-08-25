# Product — ByteDesk Marketplace

Canonical product direction for `bytedesk-marketplace-server`.

## Register

product

## Product purpose

ByteDesk Marketplace is an independent, Apache-2.0, self-hostable registry for agent
plugins, skills, MCP servers, harness extensions, and related provider-native bundles.
It gives publishers one immutable release identity across several native variants and
gives consumers verifiable discovery and installation without pretending the provider
contracts are interchangeable.

It is not ByteDesk Store, a billing system, a general-purpose npm/NuGet registry, or a
runtime layer over the existing ByteDesk catalogs.

## Users

- Anonymous developers discovering public packages.
- Publishers maintaining namespaces, releases, compatibility, and trust evidence.
- Organization members consuming private packages through native feeds or `bdm`.
- Moderators resolving risk, abuse reports, appeals, and lifecycle actions.
- Self-host operators managing policy, keys, storage, recovery, and provider adapters.

## Product promises

1. A coordinate and released version are permanent and never reused.
2. Provider-native bytes remain intact and compatibility claims show their evidence.
3. Public and private package existence never crosses authorization boundaries.
4. Ratings are community opinion; signed evidence and lifecycle are registry facts.
5. Native provider delivery is used where truthful; `bdm` is the explicit fallback.
6. The public service is free and has no embedded commerce model.

## Primary journeys

- Search and filter packages by provider, contract, trust, visibility, and lifecycle.
- Inspect versions, native variants, provenance, evidence freshness, and install steps.
- Publish one canonical SemVer release from `bytedesk-package.yaml`.
- Install an exact release and record it in `bdm.lock`.
- Manage organization/team access to private namespaces and packages.
- Quarantine, review, appeal, yank, or tombstone without rewriting immutable history.

## Success criteria

A developer can determine what a package is, whether it supports their harness, which
exact bytes will install, and what evidence supports that claim from one page. A
publisher can ship a multi-provider release without the registry executing their code.
An operator can restore authority and regenerate every projection from PostgreSQL plus
the immutable content store.

