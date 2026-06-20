# ByteDesk UI Patterns

Common design patterns for the four main scenarios.

## Table of Contents
1. [Full-Page Layouts](#full-page-layouts)
2. [Modals & Drawers](#modals-drawers)
3. [Data-Dense Panels](#data-dense-panels)
4. [Micro-Interactions & Animation](#micro-interactions)

---

## Full-Page Layouts

### List Page (standard catalog view)

Structure: header → filters → table → empty state

```tsx
export default function LeadsPage() {
  const { data, isLoading } = useLeads()

  return (
    <ListPage
      title="HVAC Leads"
      actions={
        <Row gap={2}>
          <Button variant="secondary" size="sm">Export CSV</Button>
          <Button variant="primary" size="sm">Run Scan</Button>
        </Row>
      }
    >
      <FilterBar
        options={[
          { value: "az", label: "Arizona" },
          { value: "ga", label: "Georgia" },
        ]}
        value={filters}
        onChange={setFilters}
      />
      <AsyncContent loading={isLoading} empty={data.length === 0}>
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => router.push(`/leads/${row.id}`)}
        />
      </AsyncContent>
    </ListPage>
  )
}
```

**Design principles:**
- Header 40px, sticks to top
- Filter bar always visible above table (not inside a collapsible)
- Empty state centered in table area — use `<EmptyState>` with relevant icon
- Table rows have `.mc-row-hover` cursor and pointer

---

### Detail Page (two-panel)

Structure: left sidebar metadata + right main content (tabs or single panel)

```tsx
export default function LeadDetailPage({ params }: { params: { id: string } }) {
  return (
    <DetailPage
      sidebar={
        <Stack gap={4}>
          <SectionHeader title="Lead Details" />
          <Card depth="flat" padding="sm">
            <MetadataGrid lead={lead} />
          </Card>
          <Card depth="flat" padding="sm">
            <Stack gap={2}>
              <span className="mc-section-label">Actions</span>
              <Button variant="primary" size="sm">Enrich Contact</Button>
              <Button variant="secondary" size="sm">Add to Sequence</Button>
            </Stack>
          </Card>
        </Stack>
      }
      main={
        <Tabs>
          <TabList>
            <Tab id="activity">Activity</Tab>
            <Tab id="email">Email</Tab>
            <Tab id="notes">Notes</Tab>
          </TabList>
          <TabPanel id="activity"><ActivityFeed leadId={params.id} /></TabPanel>
          <TabPanel id="email"><EmailPanel leadId={params.id} /></TabPanel>
          <TabPanel id="notes"><NotesPanel leadId={params.id} /></TabPanel>
        </Tabs>
      }
    />
  )
}
```

**Design principles:**
- Sidebar 224–280px, fixed. Main panel fills remaining space.
- Sidebar uses `bg-subtle` level background, main uses `bg-surface`
- Tabs with blue underline indicator for active state
- Sections in sidebar use Card depth="flat" with sm padding for separation

---

### Dashboard Page (metric overview)

Structure: header → metric grid → charts/tables in cards

```tsx
<Stack gap={6}>
  <PageHeader title="Prospecting Dashboard" />

  <MetricGrid>
    <MetricCard label="Total Leads" value="4,422" sub="Phoenix metro" />
    <MetricCard label="Enriched" value="1,834" sub="41% coverage" />
    <MetricCard label="Deliverable Email" value="67%"
      color="var(--color-accent-green)" />
    <MetricCard label="Sequences Active" value="3" />
  </MetricGrid>

  <div className="grid grid-cols-2 gap-4">
    <Card depth="raised" padding="lg">
      <SectionHeader title="Lead Sources" />
      {/* chart */}
    </Card>
    <Card depth="raised" padding="lg">
      <SectionHeader title="Enrichment Pipeline" />
      {/* pipeline visualization */}
    </Card>
  </div>
</Stack>
```

---

## Modals & Drawers

### Confirmation Dialog

Pattern for destructive or important actions.

```tsx
<Dialog open={isOpen} onClose={() => setOpen(false)} title="Delete Lead">
  <Stack gap={5}>
    <p className="text-body" style={{ color: "var(--color-text-secondary)" }}>
      This will permanently delete <strong style={{ color: "var(--color-text-primary)" }}>
        Acme HVAC
      </strong> and all associated enrichment data. This cannot be undone.
    </p>
    <Callout variant="warning">
      Any active email sequences for this lead will also be cancelled.
    </Callout>
    <Row gap={2} justify="end">
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="danger" onClick={handleDelete} loading={isDeleting}>
        Delete Lead
      </Button>
    </Row>
  </Stack>
</Dialog>
```

**Principles:**
- Always show the affected entity name in strong/primary text
- Show consequences before the action button
- Cancel button on the left, destructive on right
- Never close a dialog automatically while a mutation is in-flight

---

### Three-Column Detail Modal

For rich detail views that need metadata + content + activity feed.

```tsx
// Modal shell
<div style={{
  display: "grid",
  gridTemplateColumns: "224px 1fr 288px",
  height: "80vh",
  background: "var(--color-bg-elevated)",
  borderRadius: "var(--radius-xl)",
  overflow: "hidden",
  boxShadow: "var(--shadow-xl)"
}}>
  {/* Left sidebar — metadata */}
  <div style={{
    background: "var(--color-bg-subtle)",
    borderRight: "1px solid var(--color-border-default)",
    padding: "var(--space-4)",
    overflowY: "auto"
  }}>
    <Stack gap={3}>
      <span className="mc-section-label">Contact</span>
      <MetadataRow label="Company" value="Acme HVAC" />
      <MetadataRow label="Owner" value="Jim Chen" />
      <MetadataRow label="Phone" value="(623) 555-0124" />
    </Stack>
  </div>

  {/* Center — main content */}
  <div style={{ overflowY: "auto", padding: "var(--space-4)" }}>
    <Tabs>
      <TabList>
        <Tab id="execution">Execution</Tab>
        <Tab id="artifacts">Artifacts</Tab>
      </TabList>
      <TabPanel id="execution">{/* content */}</TabPanel>
      <TabPanel id="artifacts">{/* content */}</TabPanel>
    </Tabs>
  </div>

  {/* Right — activity */}
  <div style={{
    borderLeft: "1px solid var(--color-border-default)",
    padding: "var(--space-4)",
    overflowY: "auto"
  }}>
    <ActivityFeed />
  </div>
</div>
```

---

### Step Wizard (multi-step modal)

```tsx
// Steps displayed as a progress indicator at the top
<Dialog open={isOpen} onClose={onClose} title="Add Lead to Sequence">
  {/* Progress indicator */}
  <Row gap={2} className="mb-6">
    {steps.map((step, i) => (
      <div key={step} className={cn(
        "flex-1 h-1 rounded-full transition-colors",
        i <= currentStep
          ? "bg-[var(--color-accent-blue)]"
          : "bg-[var(--color-border-default)]"
      )} />
    ))}
  </Row>

  {/* Step content */}
  <div className="mc-fade-up">
    {currentStep === 0 && <SelectSequenceStep />}
    {currentStep === 1 && <PersonalizeStep />}
    {currentStep === 2 && <ConfirmStep />}
  </div>

  <Row gap={2} justify="end" className="mt-6">
    {currentStep > 0 && (
      <Button variant="ghost" onClick={() => setStep(s => s - 1)}>Back</Button>
    )}
    {currentStep < steps.length - 1
      ? <Button variant="primary" onClick={() => setStep(s => s + 1)}>Continue</Button>
      : <Button variant="primary" onClick={handleSubmit}>Add to Sequence</Button>
    }
  </Row>
</Dialog>
```

---

### Drawer (side panel detail)

```tsx
<Drawer open={isOpen} onClose={() => setOpen(false)} title="Lead Details">
  <Stack gap={5}>
    <Card depth="flat" padding="sm">
      <Stack gap={2}>
        <span className="mc-section-label">Contact Information</span>
        <MetadataRow label="Company" value={lead.company} />
        <MetadataRow label="Owner" value={lead.ownerName} />
        <MetadataRow label="Email" value={lead.email} />
      </Stack>
    </Card>
    <Card depth="flat" padding="sm">
      <Stack gap={2}>
        <span className="mc-section-label">License Data</span>
        <MetadataRow label="License #" value={lead.licenseNumber} mono />
        <MetadataRow label="Status" value="Active" accent="green" />
      </Stack>
    </Card>
  </Stack>
</Drawer>
```

---

## Data-Dense Panels

### Metadata Grid

For showing labeled key-value data in compact form. Common in sidebar panels and detail views.

```tsx
// Metadata row pattern — build this as a tiny local component
function MetadataRow({ label, value, mono = false }: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <Row justify="between" gap={2}>
      <span className="mc-section-label" style={{ minWidth: "7ch" }}>
        {label}
      </span>
      <span
        className={cn("text-caption flex-1 text-right", mono && "font-mono")}
        style={{ color: "var(--color-text-secondary)" }}
      >
        {value}
      </span>
    </Row>
  )
}
```

**Design principle:** Label in `mc-section-label` (mono, 11px, disabled color, uppercase). Value right-aligned in secondary text. Mono for IDs, phone numbers, license numbers.

---

### Status Header Bar

Accent-colored left border indicating current state — used at top of execution panels.

```tsx
function StatusBar({ status, label, sub }: StatusBarProps) {
  const colorMap = {
    running: "var(--color-status-running)",
    failed: "var(--color-status-failed)",
    pending: "var(--color-status-pending)",
    completed: "var(--color-status-completed)",
  }
  return (
    <div style={{
      borderLeft: `3px solid ${colorMap[status]}`,
      paddingLeft: "var(--space-3)",
      background: status === "failed"
        ? "var(--color-bg-error-subtle)"
        : status === "running"
        ? "var(--color-bg-info-subtle)"
        : undefined,
    }}>
      <Row gap={2} align="center">
        <StatusBadge status={status} />
        <span className="text-body" style={{ color: "var(--color-text-primary)" }}>
          {label}
        </span>
        {sub && (
          <span className="text-caption" style={{ color: "var(--color-text-tertiary)" }}>
            {sub}
          </span>
        )}
      </Row>
    </div>
  )
}
```

---

### Collapsible Raw Data Section

For debug/advanced data in panels — collapsed by default.

```tsx
<Collapsible title="Raw Data" defaultOpen={false}>
  <div style={{
    background: "var(--color-bg-base)",
    border: "1px solid var(--color-border-dimmest)",
    borderRadius: "var(--radius-md)",
    padding: "var(--space-3)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-xs)",
    color: "var(--color-text-tertiary)",
    overflowX: "auto",
    maxHeight: "300px",
    overflowY: "auto"
  }}>
    <pre>{JSON.stringify(data, null, 2)}</pre>
  </div>
</Collapsible>
```

---

### Tabbed Content Panel

Multi-tab content with state preservation. Common for Execution/Artifacts/History or Activity/Email/Notes.

```tsx
<Tabs>
  <TabList>
    <Tab id="execution">
      <Row gap={1.5} align="center">
        <Zap size={12} />
        Execution
      </Row>
    </Tab>
    <Tab id="artifacts">
      Artifacts
      {artifactCount > 0 && (
        <Badge variant="blue" size="sm" className="ml-1.5">{artifactCount}</Badge>
      )}
    </Tab>
    <Tab id="history">History</Tab>
  </TabList>

  <TabPanel id="execution" className="mc-tab-enter">
    {/* execution content */}
  </TabPanel>
  <TabPanel id="artifacts" className="mc-tab-enter">
    {/* artifacts content */}
  </TabPanel>
  <TabPanel id="history" className="mc-tab-enter">
    {/* history content */}
  </TabPanel>
</Tabs>
```

**Principles:**
- Icons before label are optional but add clarity for complex panels
- Badge count on tabs shows pending items without requiring click
- Always apply `mc-tab-enter` on TabPanel for smooth transition

---

## Micro-Interactions & Animation

### Entrance animations (list items)

Use `mc-fade-up-stagger` for lists where items should enter sequentially.

```tsx
{items.map((item, index) => (
  <div
    key={item.id}
    className="mc-fade-up-stagger"
    style={{ "--index": index } as React.CSSProperties}
  >
    <LeadCard lead={item} />
  </div>
))}
```

**Rule:** Only animate entrance once — not on every re-render. Use `key` to control when animation re-fires.

---

### Framer Motion — panel slide-in

```tsx
import { motion, AnimatePresence } from "framer-motion"

<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{
        duration: 0.25,  // --duration-enter
        ease: [0.4, 0, 0.2, 1]  // --ease-out
      }}
    >
      {children}
    </motion.div>
  )}
</AnimatePresence>
```

---

### Framer Motion — staggered list

```tsx
const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 }  // --duration-stagger
  }
}
const item = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1, y: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] }
  }
}

<motion.ul variants={container} initial="hidden" animate="show">
  {leads.map(lead => (
    <motion.li key={lead.id} variants={item}>
      <LeadRow lead={lead} />
    </motion.li>
  ))}
</motion.ul>
```

---

### Loading skeleton shimmer

```tsx
// While data loads, show skeleton that matches the expected layout
{isLoading ? (
  <Stack gap={3}>
    <Skeleton height={20} width="40%" />
    <Skeleton height={14} width="70%" />
    <Skeleton height={14} width="55%" />
  </Stack>
) : (
  <ActualContent data={data} />
)}
```

**Principle:** Skeleton should match the shape of what's loading — same number of lines, approximate widths. Don't use a generic spinner for content areas.

---

### Button loading state

```tsx
<Button
  variant="primary"
  loading={isMutating}  // shows spinner, disables click
  onClick={handleSubmit}
>
  {isMutating ? "Enriching..." : "Enrich Lead"}
</Button>
```

---

### Live indicator (pulsing dot)

```tsx
// For actively running jobs
<Badge variant="green" live dot>
  Scanning
</Badge>

// Or raw — for custom layouts
<span className="mc-live-dot" style={{ background: "var(--color-accent-green)" }} />
```

---

### Validation shake

Trigger this class programmatically when form submission fails:

```tsx
const formRef = useRef<HTMLFormElement>(null)

function handleSubmit() {
  if (!isValid) {
    formRef.current?.classList.add("mc-shake")
    setTimeout(() => formRef.current?.classList.remove("mc-shake"), 400)
    return
  }
  // proceed
}
```

---

### Hover states

Standard hover patterns — always use CSS transitions:

```tsx
// For interactive rows
<div
  className="mc-row-hover transition-colors cursor-pointer"
  style={{ borderRadius: "var(--radius-md)" }}
  onClick={handleClick}
>
  {content}
</div>

// For icon buttons
<button
  className="p-1.5 rounded transition-colors"
  style={{ color: "var(--color-text-tertiary)" }}
  onMouseEnter={e => (e.currentTarget.style.color = "var(--color-text-primary)")}
  onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
>
  <MoreHorizontal size={14} />
</button>
```

**Better approach for icon buttons** — use CSS:
```css
.icon-btn {
  color: var(--color-text-tertiary);
  transition: color var(--duration-fast) var(--ease-out);
}
.icon-btn:hover { color: var(--color-text-primary); }
```

---

### Toast notification patterns

```tsx
const { toast } = useToast()

// After a successful action:
toast("Lead enriched — 3 contacts found", "success")

// After an error:
toast("Failed to connect to AZ ROC. Check your API key.", "error")

// For long-running operations:
toast("Scan started — check back in ~2 minutes", "info", 5000)

// For partial success:
toast("Imported 847 of 1,200 leads (353 duplicates skipped)", "warning", 6000)
```

**Duration guidance:** Default (3s) for quick feedback. 5-6s for messages that need reading time (long error descriptions, multi-part results).
