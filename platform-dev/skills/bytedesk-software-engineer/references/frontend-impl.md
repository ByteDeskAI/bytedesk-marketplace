# Frontend Implementation Patterns

Read this when building frontend features. These are the standard ByteDesk patterns — follow them exactly rather than inventing alternatives.

---

## Step 1 — API Layer

Every backend call goes through a typed domain API service. Never raw `fetch()`; browser realtime uses the shared SignalR hooks instead of direct HTTP streams.

### Check if the domain service already exists

```bash
ls src/ByteDesk.Web/src/lib/api/
# salesApi, toolsApi, aiApi, developmentApi, etc.
```

If it exists, extend it with new methods. Never create a parallel service for the same domain.

### Extending a domain API service

```typescript
// src/ByteDesk.Web/src/lib/api/{domain}.ts
import { ApiService } from "@/lib/api/base";
import type { {Type}, Create{Type}Request, Update{Type}Request } from "@/types/{domain}";

class {Domain}Api extends ApiService {
  list(params?: { page?: number; pageSize?: number; status?: string }) {
    return this.getList<{Type}>("/api/{service}/{resource}", params);
  }
  get(id: string) {
    return this.getOne<{Type}>(`/api/{service}/{resource}/${id}`);
  }
  create(data: Create{Type}Request) {
    return this.post<{Type}>("/api/{service}/{resource}", data);
  }
  update(id: string, data: Update{Type}Request) {
    return this.put<{Type}>(`/api/{service}/{resource}/${id}`, data);
  }
  archive(id: string) {
    return this.delete(`/api/{service}/{resource}/${id}`);
  }
  someAction(id: string, payload: SomeActionRequest) {
    return this.action<{Type}>(`/api/{service}/{resource}/${id}/some-action`, payload);
  }
}

export const {domain}Api = new {Domain}Api();
```

### Request/Response types

```typescript
// src/ByteDesk.Web/src/types/{domain}.ts
// Match the backend DTO exactly — camelCase, string enums
export interface {Type} {
  id: string;
  name: string;
  status: "Active" | "Archived";  // string enum — never number
  createdAt: string;              // ISO string — use formatDate() to display
}

export interface Create{Type}Request {
  name: string;
}

export interface Update{Type}Request {
  name?: string;  // all optional — PATCH semantics
}
```

---

## Step 2 — Route and Page Scaffold

### Route structure

```
src/ByteDesk.Web/src/app/(app)/
└── {domain}/
    ├── page.tsx           ← list page
    ├── new/page.tsx       ← create page (or use modal — ask user)
    └── [id]/
        └── page.tsx       ← detail page
```

`params` is a Promise in Next.js App Router — always `use(params)` to unwrap:

```typescript
import { use } from "react";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // ...
}
```

### List page (ListPage template)

```typescript
"use client";
import { ListPage } from "@/components/templates";

export default function {Domain}ListPage() {
  const { data, isLoading, error } = use{Domain}List();
  return (
    <ListPage
      title="{Domain}"
      description="Manage your {domain}."
      action={{ label: "New {Type}", href: "/{domain}/new" }}
      isLoading={isLoading}
      error={error?.message}
      empty={!data?.length}
      emptyTitle="No {domain} yet"
      emptyDescription="Create your first {type} to get started."
    >
      <{Domain}Table items={data ?? []} />
    </ListPage>
  );
}
```

### Detail page (DetailPage template)

```typescript
"use client";
import { use } from "react";
import { DetailPage } from "@/components/templates";

export default function {Type}DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: item, isLoading, error } = use{Type}(id);
  return (
    <DetailPage
      title={item?.name ?? "..."}
      breadcrumbs={[
        { label: "{Domain}", href: "/{domain}" },
        { label: item?.name ?? id },
      ]}
      isLoading={isLoading}
      error={error?.message}
    >
      {/* Organisms go here */}
    </DetailPage>
  );
}
```

---

## Step 3 — React Query Hooks

```typescript
// src/ByteDesk.Web/src/lib/hooks/use-{domain}.ts
import { useQuery } from "@tanstack/react-query";
import { {domain}Api } from "@/lib/api/{domain}";

// Query key factory — centralize keys for safe invalidation
export const {domain}Keys = {
  all: ["{domain}"] as const,
  lists: () => [...{domain}Keys.all, "list"] as const,
  list: (params?: object) => [...{domain}Keys.lists(), params] as const,
  details: () => [...{domain}Keys.all, "detail"] as const,
  detail: (id: string) => [...{domain}Keys.details(), id] as const,
};

export function use{Domain}List(params?: { status?: string }) {
  return useQuery({
    queryKey: {domain}Keys.list(params),
    queryFn: () => {domain}Api.list(params),
  });
}

export function use{Type}(id: string) {
  return useQuery({
    queryKey: {domain}Keys.detail(id),
    queryFn: () => {domain}Api.get(id),
    enabled: !!id,  // guard against undefined id from params
  });
}
```

Rules:
- Query key factory is mandatory — makes `invalidateQueries` precise and safe
- `enabled: !!id` on any detail query that depends on a route param
- No `refetchInterval` for important live state; for real-time data, use `/bytedesk-realtime-engineer` instead
- No `useState` for data that comes from the API

---

## Step 4 — UI Composition

### Component discovery (always first)

Before writing any JSX, check what already exists:

```bash
find src/ByteDesk.Web/src/components/ui -name "*.tsx" | sort      # atoms
find src/ByteDesk.Web/src/components/shared -name "*.tsx" | sort   # molecules
find src/ByteDesk.Web/src/components/{domain} -name "*.tsx" 2>/dev/null | sort
```

Options in order of preference:
1. Existing component fully covers it → use it, zero new code
2. Existing component is close → add a prop, don't duplicate
3. Nothing exists → build new; consult `/bytedesk-design` for layer placement

### All four states required for every data-driven component

```typescript
import { AsyncContent } from "@/components/ui";
import { EmptyState } from "@/components/shared";

function {Component}({ id }: { id: string }) {
  const { data, isLoading, error } = use{Type}(id);
  return (
    <AsyncContent
      loading={isLoading}
      empty={!data || data.length === 0}
      error={error?.message}
      emptyContent={<EmptyState title="No items yet" description="..." />}
    >
      {/* happy path */}
    </AsyncContent>
  );
}
```

### Design system quick rules (full rules in `.claude/rules/frontend.md`)

- Orange = upgrade/brand CTAs only (`<Button variant="brand">`)
- Blue = all other interactive elements (`<Button variant="primary">`)
- `cn()` from `@/lib/utils/cn` for conditional classes
- Formatters from `@/lib/utils/format` — never redefine (`formatDate`, `formatTimeAgo`, `formatBytes`, etc.)
- Labels: `<Label>` or `.mc-label` — never manual mono+uppercase+tracking
- Cards: `<Card>` not `<div style={{ background: "var(--color-bg-surface)" }}>`
- Status banners: `<Callout variant="error|info|warning|success">` not hand-built divs
- All tokens via `var(--color-*)` — no hardcoded hex/rgb/oklch in component files

---

## Step 5 — Mutations

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { {domain}Keys } from "@/lib/hooks/use-{domain}";

const queryClient = useQueryClient();
const { toast } = useToast();

const { mutate, isPending } = useMutation({
  mutationFn: (data: Create{Type}Request) => {domain}Api.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: {domain}Keys.lists() });
    toast("{Type} created", "success");
  },
  onError: (error) => {
    toast(error.message ?? "Failed to create {type}", "error");
  },
});
```

Key rules:
- `invalidateQueries` (not `refetchQueries`) — stale data fetches lazily
- Toast on both success and error
- `isPending` must disable the submit button
- Destructive actions need a confirmation dialog before calling mutate

### Confirmation dialog pattern

```typescript
const [confirmOpen, setConfirmOpen] = useState(false);

<Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete</Button>

<Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete {Type}?">
  <p className="text-body-sm" style={{ color: "var(--color-text-secondary)" }}>
    This action cannot be undone.
  </p>
  <Row gap={2} className="mt-4 justify-end">
    <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
    <Button variant="danger" onClick={() => { mutate(id); setConfirmOpen(false); }} disabled={isPending}>
      Delete
    </Button>
  </Row>
</Dialog>
```

---

## Step 6 — Atomize

After every implementation, find the changed files and run atomize:

```bash
git diff --name-only
```

Pass the highest common ancestor directory of all changed frontend files to atomize:

```
/bytedesk-atomize --path src/ByteDesk.Web/src/app/(app)/{domain}
# or if components/ also changed:
/bytedesk-atomize --path src/ByteDesk.Web/src
```