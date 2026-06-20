# ByteDesk Component Catalog

All components live in `src/ByteDesk.Web/src/components/`.

## Table of Contents
1. [Atoms — Core UI](#atoms-core)
2. [Atoms — Layout](#atoms-layout)
3. [Atoms — Data & Display](#atoms-data)
4. [Atoms — Modals & Overlays](#atoms-overlays)
5. [Atoms — Status & Feedback](#atoms-feedback)
6. [Atoms — Text & Utilities](#atoms-utilities)
7. [Molecules](#molecules)
8. [Organisms](#organisms)
9. [Templates](#templates)

---

## Atoms — Core UI

All in `@/components/ui/`.

### `<Card>`
Surface container. The most common layout primitive.

```tsx
<Card
  depth="flat | raised | floating"  // flat=no shadow, raised=default, floating=xl shadow
  gradient={true}                    // subtle top-light gradient (default true for raised+)
  padding="none | sm | md | lg"      // default "md"
  featured={true}                    // adds left accent line in blue
>
  {children}
</Card>
```
**Use for:** any content container that needs surface-level background. Don't re-implement with `div + style={{ background: "var(--color-bg-surface)" }}`.

---

### `<Button>`
Polymorphic action element.

```tsx
<Button
  variant="primary | secondary | ghost | danger | brand"
  size="sm | md"                // default "md"
  icon={<Pencil size={14} />}  // optional left icon
  as={Link}                    // render as Next.js Link, <a>, etc.
  href="/path"                 // used with as={Link}
  disabled
  loading
>
  Label
</Button>
```

**Variant guide:**
- `primary` → blue filled, main CTA
- `secondary` → subtle surface background, secondary actions
- `ghost` → no background, lowest emphasis
- `danger` → red filled, destructive actions
- `brand` → orange filled, upgrade/brand CTAs **only**

---

### `<Input>` / `<Textarea>`
Form text inputs.

```tsx
<Input
  label="Field Name"           // optional floating label
  placeholder="e.g. value"
  icon={<Search size={14} />}  // optional left icon
  error="Validation message"   // shows red state
  value={...}
  onChange={...}
/>
```

**Always pair with `<FormField>` for label + validation.** Don't build your own label + input layout.

---

### `<FormField>`
Label + control + help/error text molecule.

```tsx
<FormField
  label="Email Address"
  error={errors.email?.message}
  help="We'll never share your email"
>
  <Input value={...} onChange={...} />
</FormField>
```

---

### `<Badge>`
Tag/chip for categorization, status, and labeling.

```tsx
<Badge
  variant="default | blue | green | amber | red | purple | cyan | orange"
  size="sm | md"
  dot={true}       // adds colored dot before label
  live={true}      // dot pulses with mc-live-dot animation
>
  Label
</Badge>
```

**8 color variants.** Use status semantics: green=success, amber=pending, red=error, blue=info, purple=AI, orange=brand.

---

### `<Avatar>`
User/contact profile circle.

```tsx
<Avatar
  name="Ryan Helms"   // generates initials + consistent color
  src="/path.jpg"     // optional image
  size="sm | md | lg"
/>
```

---

### `<StatusDot>`
Minimal green/red indicator.

```tsx
<StatusDot ok={isHealthy} label="Gateway" />
```

---

## Atoms — Layout

### `<Stack>`
Vertical flex column with consistent gap.

```tsx
<Stack gap={4}>{children}</Stack>
// gap values map to --space-* tokens
```

### `<Row>`
Horizontal flex row with consistent gap.

```tsx
<Row gap={3} align="center" justify="between">{children}</Row>
```

### `<Divider>`
Visual separator, optional label.

```tsx
<Divider />
<Divider label="Or continue with" />
```

---

## Atoms — Data & Display

### `<DataTable>`
AG Grid wrapper with MC theming. The standard table component.

```tsx
<DataTable
  columns={[
    { field: "name", headerName: "Name", flex: 1 },
    { field: "status", headerName: "Status", width: 120,
      cellRenderer: (p) => <Badge variant="green">{p.value}</Badge> }
  ]}
  data={rows}
  keyExtractor={(row) => row.id}
  onRowClick={(row) => router.push(`/leads/${row.id}`)}
  loading={isLoading}        // shows skeleton rows
  emptyMessage="No leads yet"
/>
```

**Always add `.mc-grid` class** — the `<DataTable>` component handles this automatically. Never use `ag-theme-quartz-dark` directly without mc-grid.

---

### `<MetricCard>`
Single KPI/metric display.

```tsx
<MetricCard
  label="Total Leads"
  value="4,422"
  sub="Phoenix metro"
  color="var(--color-accent-blue)"  // optional accent color
/>
```

### `<MetricGrid>`
Responsive grid of MetricCards.

```tsx
<MetricGrid>
  <MetricCard label="Leads" value="4,422" />
  <MetricCard label="Enriched" value="1,834" />
  <MetricCard label="Deliverable" value="67%" />
</MetricGrid>
```

### `<BarGauge>`
Progress bar with label and value.

```tsx
<BarGauge label="Enrichment progress" value={67} max={100} color="green" />
```

### `<Skeleton>` / `<SkeletonCard>`
Loading placeholders with shimmer.

```tsx
<Skeleton width="60%" height={16} />
<SkeletonCard lines={3} />
```

---

## Atoms — Modals & Overlays

### `<Dialog>`
Standard modal with overlay.

```tsx
<Dialog open={isOpen} onClose={() => setOpen(false)} title="Confirm Action">
  <Stack gap={4}>
    <p className="text-body">Are you sure you want to delete this item?</p>
    <Row gap={2} justify="end">
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="danger" onClick={handleDelete}>Delete</Button>
    </Row>
  </Stack>
</Dialog>
```

### `<Drawer>`
Slide-out panel from the right.

```tsx
<Drawer open={isOpen} onClose={() => setOpen(false)} title="Details">
  {children}
</Drawer>
```

### `<Dropdown>`
Styled select/dropdown.

```tsx
<Dropdown
  options={[
    { value: "az", label: "Arizona" },
    { value: "ga", label: "Georgia" }
  ]}
  value={selected}
  onChange={setSelected}
  placeholder="Select state"
/>
```

### `<FilterBar>`
Pill-based multi-filter selector.

```tsx
<FilterBar
  options={[
    { value: "hvac", label: "HVAC" },
    { value: "plumbing", label: "Plumbing" }
  ]}
  value={activeFilters}
  onChange={setActiveFilters}
/>
```

### `<Collapsible>`
Expand/collapse section.

```tsx
<Collapsible title="Advanced Options" defaultOpen={false}>
  {children}
</Collapsible>
```

### `<Tooltip>`
Hover tooltip.

```tsx
<Tooltip content="Copies the API key to clipboard">
  <CopyButton value={apiKey} />
</Tooltip>
```

### `<Combobox>`
Searchable select.

```tsx
<Combobox
  options={contacts}
  value={selected}
  onChange={setSelected}
  searchable
  placeholder="Search contacts..."
/>
```

---

## Atoms — Status & Feedback

### `<ErrorBanner>`
Top-of-content error callout.

```tsx
<ErrorBanner message={error.message} />
```

### `<Callout>`
Inline info/warning/error/success callout.

```tsx
<Callout variant="info | warning | error | success">
  Message text here.
</Callout>
```

### `<AsyncContent>`
Loading/error/empty state wrapper.

```tsx
<AsyncContent loading={isLoading} error={error} empty={data.length === 0} emptyMessage="No results">
  {/* renders children only when not loading/error/empty */}
  {data.map(...)}
</AsyncContent>
```

### `useToast()`
Toast notification hook. Use from any component.

```tsx
const { toast } = useToast()

// Trigger:
toast("Lead enriched successfully", "success")
toast("Failed to connect to AZ ROC", "error")
toast("Running 3 enrichment jobs...", "info")
toast("Partial results returned", "warning")

// With duration:
toast("Copied!", "success", 2000)
```

---

## Atoms — Text & Utilities

### `<SectionHeader>`
Consistent section title with optional action slot.

```tsx
<SectionHeader
  title="Active Leads"
  sub="423 in pipeline"
  action={<Button size="sm" variant="secondary">Export</Button>}
/>
```

### `<Kbd>`
Keyboard shortcut display.

```tsx
Press <Kbd>⌘K</Kbd> to open command palette
```

### `<CopyButton>`
One-click copy to clipboard.

```tsx
<CopyButton value={apiKey} label="Copy API key" />
```

### `<CheckboxGroup>`
Group of labeled checkboxes.

```tsx
<CheckboxGroup
  options={[{ value: "email", label: "Email notifications" }]}
  value={selected}
  onChange={setSelected}
/>
```

---

## Molecules

Molecules live in `@/components/shared/` — they compose 2–3 atoms and may have minimal state.

### `<PageHeader>`
Top-of-page title bar with breadcrumb + actions.

```tsx
<PageHeader
  title="HVAC Leads"
  breadcrumbs={[{ label: "Prospecting", href: "/prospecting" }]}
  actions={<Button variant="primary">Run scan</Button>}
/>
```

### `<StatusBadge>`
Domain-aware status badge (maps pipeline/job status to Badge variants).

```tsx
<StatusBadge status="running" />    // → green live dot badge
<StatusBadge status="failed" />     // → red badge
<StatusBadge status="pending" />    // → amber badge
```

### `<EmptyState>`
Full empty-state illustration + message + CTA.

```tsx
<EmptyState
  icon={<Radar size={32} />}
  title="No leads scanned yet"
  description="Run a radar scan to find leads in your target area."
  action={<Button variant="primary">Start scan</Button>}
/>
```

---

## Organisms

Organisms live in domain directories (`@/components/sales/`, `@/components/tools/`, etc.) and contain business logic.

### Common patterns

**Three-column modal** (used in opportunity-detail-modal.tsx):
```
[LEFT 224px]        [CENTER 1fr]         [RIGHT 288px]
Metadata sidebar    Primary content       Activity feed / tabs
```
- Use `<Dialog>` or custom modal shell
- Left: Stack of labeled metadata rows (`.mc-label` + `.mc-value`)
- Center: Main content / execution panel
- Right: `<Tabs>` with activity, email, notes

**Mission Control panel** (pipeline-execution-panel.tsx pattern):
- `<Tabs>` for Execution / Artifacts / History
- Dense 2-column metadata grid (7-char label + value)
- Left-border accent for inline callouts
- Collapsible "Raw JSON" section for debug data
- Status header bar with `--color-status-*` left border

**Data list page** (via ListPage template):
```tsx
// See templates below
```

---

## Templates

Templates live in `@/components/templates/`.

### `<ListPage>`
Standard list/table page with filters + data table.

```tsx
<ListPage
  title="HVAC Leads"
  filters={<FilterBar options={...} />}
  table={<DataTable columns={...} data={...} />}
  actions={<Button>Export</Button>}
/>
```

### `<DetailPage>`
Two-panel detail view: sidebar + main content.

```tsx
<DetailPage
  sidebar={<LeadDetailSidebar lead={lead} />}
  main={<LeadActivityPanel lead={lead} />}
/>
```

---

## Component Selection Guide

| You want to... | Use |
|---|---|
| Show content in a box | `<Card>` |
| Show a clickable action | `<Button>` |
| Show status/category | `<Badge>` |
| Show a loading state | `<Skeleton>` + `<AsyncContent>` |
| Show a message/notification | `useToast()` or `<Callout>` |
| Show tabular data | `<DataTable>` |
| Show KPI numbers | `<MetricCard>` + `<MetricGrid>` |
| Show a popup | `<Dialog>` (modal) or `<Drawer>` (side panel) |
| Show a select menu | `<Dropdown>` or `<Combobox>` (searchable) |
| Show filter chips | `<FilterBar>` |
| Layout vertically | `<Stack>` |
| Layout horizontally | `<Row>` |
| Show a page header | `<PageHeader>` |
| Show an empty state | `<EmptyState>` |
| Show status with context | `<StatusBadge>` |
