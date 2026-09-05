import { AlertTriangle, Check, FileText, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, Select, TextArea } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import {
  attachToPlanner, fetchPlannerAgents, fetchPlannerSession, fetchPlannerSessions, planner,
  plannerRun, subscribePlannerRun,
} from "../../lib/api";
import { navigate, setQuery, useLocation } from "../../lib/router";
import { useBoard } from "../../lib/store";
import type { AguiEvent, PlannerAgent, PlannerSession, PlannerSummary, Proposal } from "../../lib/types";
import "../../styles/planner.css";

/**
 * The bounded goal planner.
 *
 * Bounded is the whole design, and it shows up as three refusals the surface makes on purpose.
 * There is no free composer after the goal is submitted — continued input is tied to a structured
 * decision or a proposal. Agent text is never rendered as alternating speech; every turn lands in
 * a named slot. And a proposed board write is an inspectable card with its own consequence
 * sentence, never a sentence of prose asking to be trusted.
 *
 * What the browser is NOT allowed to do is as important. It holds no agent credential, decides
 * nothing about whether an attachment is acceptable, and cannot apply a proposal it has edited —
 * the digest it sends back is checked against the one the server is holding.
 */
export default function GoalPlanner(_: ScreenProps) {
  const { query } = useLocation();
  const id = query.get("session");
  return id ? <Session id={id} /> : <SessionList />;
}

/* ── the inbox of planning conversations ──────────────────────────────────────────────── */

function SessionList() {
  const board = useBoard();
  const [rows, setRows] = useState<PlannerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [epic, setEpic] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchPlannerSessions().then(setRows).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await planner.open(goal, epic || null);
      setQuery({ session: made.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openEpics = (board?.epics ?? []).filter((e) => e.status !== "done");

  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Goal planner</h1>
          <p className="tm-screen__sub">
            Turn one repository goal into inspectable board changes. This surface cannot answer
            unrelated requests.
          </p>
        </div>
      </div>

      {error ? <ErrorPanel title="The planner refused" detail={error} /> : null}

      <section className="gp-intake" aria-labelledby="gp-intake-h">
        <h2 id="gp-intake-h">Describe one outcome</h2>
        <p className="gp-hint">
          One repository-scoped outcome, not a document. The planner inspects this repository and
          proposes governed board changes; it cannot mutate the board without an approval.
        </p>
        <Field label="Outcome" hint="One outcome, at most 4000 characters. Attach the document instead of pasting it.">
          {(props) => (
            <TextArea
              {...props}
              rows={3}
              value={goal}
              maxLength={4000}
              placeholder="Make the dispatcher survive a restart without losing claims"
              onChange={(e) => setGoal(e.currentTarget.value)}
            />
          )}
        </Field>
        <div className="gp-intake__row">
          <Field label="Target epic">
            {(props) => (
              <Select
                {...props}
                value={epic}
                placeholder="the active epic"
                options={openEpics.map((e) => ({ value: e.id, label: `${e.id} — ${e.title}` }))}
                onChange={(e) => setEpic(e.currentTarget.value)}
              />
            )}
          </Field>
          <span className="tm-grow" />
          <Button icon={<Plus size={14} />} disabled={!goal.trim() || busy} onClick={open}>
            {busy ? "Opening…" : "Start planning"}
          </Button>
        </div>
      </section>

      <h2 className="gp-list-h">Planning sessions</h2>
      {rows === null ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} />}
          title="No planning sessions yet"
        >
          A session is a conversation about one outcome that ends — imported, rejected, or cancelled.
        </EmptyState>
      ) : (
        <ul className="gp-sessions">
          {rows.map((s) => (
            <li key={s.id}>
              <button className="gp-session" onClick={() => setQuery({ session: s.id })}>
                <span className="gp-session__goal">{s.goal}</span>
                <span className="gp-session__meta">
                  <Chip kind="status" value={s.status}>{s.status}</Chip>
                  <span className="tm-mono">{s.turns} turns</span>
                  {s.attachments > 0 ? <span className="tm-mono">{s.attachments} attached</span> : null}
                  {s.epic ? <span className="tm-mono">{s.epic}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── one conversation ─────────────────────────────────────────────────────────────────── */

function Session({ id }: { id: string }) {
  const [session, setSession] = useState<PlannerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const [answer, setAnswer] = useState("");
  const [agents, setAgents] = useState<PlannerAgent[]>([]);
  const [agent, setAgent] = useState("");
  const [events, setEvents] = useState<AguiEvent[]>([]);
  const [running, setRunning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchPlannerSession(id)
      .then((s) => {
        setSession(s);
        // A session resumes from its own record, so a reload mid-approval finds the proposal
        // still there rather than starting the conversation again.
        if (s.proposal) {
          planner.propose(s.id, s.proposal.operations).then(setProposal).catch(() => {});
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    fetchPlannerAgents().then((list) => {
      setAgents(list);
      setAgent((a) => a || list[0]?.id || "");
    }).catch(() => {});
  }, []);

  /**
   * Attach to the run stream whenever one is in flight. `tm.run.absent` means there is nothing to
   * watch, which is the ordinary case for a session opened from the list — not an error.
   */
  const watch = useCallback(() => {
    return subscribePlannerRun(id, (e) => {
      if (e.type === "CUSTOM" && e.name === "tm.run.absent") return;
      setEvents((prev) => [...prev.slice(-400), e]);
      if (e.type === "RUN_FINISHED" || e.type === "RUN_ERROR") {
        setRunning(false);
        // The agent's proposal arrives on the session, not on the stream, so reload to pick it up.
        load();
      }
    });
  }, [id, load]);

  useEffect(() => {
    plannerRun.state(id).then((st) => {
      setRunning(st.running);
      if (st.running || st.events > 0) return watch();
      return undefined;
    }).catch(() => {});
  }, [id, watch]);

  const startRun = async () => {
    setError(null);
    setEvents([]);
    try {
      await plannerRun.start(id, agent);
      setRunning(true);
      watch();
      say("Planning run started.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stopRun = async () => {
    await plannerRun.cancel(id).catch(() => {});
    setRunning(false);
    say("Planning run cancelled.");
  };

  const say = (message: string) => setLive(message);

  const attach = async (files: FileList | null) => {
    if (!files?.length || !session) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        const res = await attachToPlanner(session.id, file);
        setSession((s) => (s ? { ...s, attachments: res.attachments } : s));
        say(`${file.name} attached as session context`);
      } catch (e) {
        // The server's own wording. The browser does not pre-judge a file, because a check the
        // client could do is a check an attacker can skip.
        const why = (e as Error).message;
        setError(why);
        say(why);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const apply = async () => {
    if (!session || !proposal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await planner.apply(session.id, proposal.digest);
      say(`Applied. ${res.created.length} records created.`);
      setConfirming(false);
      setProposal(null);
      load();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Answer the open question. This is the ONLY way to put text into a session after the goal, and
   * that is the bounded design rather than a missing feature: input is tied to a specific
   * elicitation, so the surface cannot drift into a general prompt box. When nothing is being
   * asked, there is nothing to type into.
   */
  const reply = async () => {
    if (!session || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await planner.turn(session.id, { role: "operator", kind: "answer", text: answer.trim() });
      setSession(next);
      setAnswer("");
      say("Answer recorded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const end = async (status: "cancelled" | "rejected") => {
    if (!session) return;
    await planner.close(session.id, status).catch((e: Error) => setError(e.message));
    load();
  };

  if (error && !session) return <ErrorPanel title="That planning session could not be opened" detail={error} />;
  if (!session) return <SkeletonRows rows={5} />;

  const openSession = session.status === "open";
  const writes = proposal?.operations.length ?? 0;
  // The last question that nothing has answered yet. A question already followed by an answer is
  // settled, so no input is offered for it.
  const lastQuestion = [...session.turns].reverse().find((t) => t.kind === "question");
  const lastAnswer = [...session.turns].reverse().find((t) => t.kind === "answer");
  const openQuestion =
    openSession && lastQuestion && (!lastAnswer || session.turns.indexOf(lastQuestion) > session.turns.indexOf(lastAnswer))
      ? lastQuestion
      : null;

  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Goal planner</h1>
          <p className="tm-screen__sub">{session.goal}</p>
        </div>
        <span className="tm-grow" />
        <Chip kind="status" value={session.status}>{session.status}</Chip>
        <Button size="sm" variant="ghost" onClick={() => navigate("/planner")}>All sessions</Button>
      </div>

      <p className="gp-scope">
        <b>Scope lock</b> Planning only: clarify the goal, inspect repository evidence, propose
        governed task-management actions, then wait for approval. Nothing here writes to the board
        until a proposal is approved.
      </p>

      {error ? <ErrorPanel title="Refused" detail={error} /> : null}

      {openSession ? (
        <section className="gp-agent" aria-labelledby="gp-agent-h">
          <h2 id="gp-agent-h">Planner agent</h2>
          {agents.length === 0 ? (
            <p className="gp-hint">
              No trusted coding agent is configured. Add one with{" "}
              <code>tm config planner '{"{"}"agents":[{"{"}"id":"codex","label":"Codex","command":"codex-acp"{"}"}]{"}"}'</code>.
              The board spawns the command you name, so this is deliberately not something that ships with entries.
            </p>
          ) : (
            <div className="gp-agent__row">
              <Field label="Agent">
                {(props) => (
                  <Select
                    {...props}
                    value={agent}
                    disabled={running}
                    options={agents.map((a) => ({ value: a.id, label: a.label }))}
                    onChange={(e) => setAgent(e.currentTarget.value)}
                  />
                )}
              </Field>
              <Chip tone={running ? "accent" : "ok"} dot>{running ? "running" : "idle"}</Chip>
              <Chip tone="warn">board writes: confirm each set</Chip>
              <span className="tm-grow" />
              {running ? (
                <Button variant="ghost" onClick={stopRun}>Cancel run</Button>
              ) : (
                <Button disabled={!agent} onClick={startRun}>Ask the planner</Button>
              )}
            </div>
          )}
          {events.length > 0 ? (
            <ol className="gp-trace" aria-label="Agent activity">
              {events.slice(-40).map((e, i) => (
                <li key={i} data-kind={e.type}>
                  <span className="tm-mono gp-trace__type">{e.type}</span>
                  <span>{describeEvent(e)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {/* Turns land in named slots. Never alternating speech bubbles. */}
      <section aria-labelledby="gp-turns-h">
        <h2 id="gp-turns-h" className="gp-list-h">Conversation</h2>
        {session.turns.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="Nothing yet"
          >
            Questions, evidence and proposals appear here as they arrive, each in its own slot.
          </EmptyState>
        ) : (
          <ol className="gp-turns">
            {session.turns.map((t, i) => (
              <li key={i} className="gp-turn" data-kind={t.kind}>
                <span className="gp-turn__kind">{t.kind}</span>
                <div>
                  <span className="gp-turn__who">{t.role}</span>
                  <p>{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {openQuestion ? (
          <form
            className="gp-answer"
            onSubmit={(e) => { e.preventDefault(); reply(); }}
            aria-labelledby="gp-answer-h"
          >
            <h3 id="gp-answer-h">Answer this decision</h3>
            <p className="gp-hint">{openQuestion.text}</p>
            <Field label="Your answer">
              {(props) => (
                <TextArea
                  {...props}
                  rows={2}
                  value={answer}
                  maxLength={20000}
                  onChange={(e) => setAnswer(e.currentTarget.value)}
                />
              )}
            </Field>
            <div className="gp-actions">
              <Button type="submit" disabled={!answer.trim() || busy}>
                {busy ? "Recording…" : "Record answer"}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="gp-attach-h">
        <h2 id="gp-attach-h" className="gp-list-h">
          Attachments <span className="gp-note">session context &middot; not board evidence</span>
        </h2>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="gp-file"
          aria-label="Attach a document as session context"
          disabled={!openSession}
          onChange={(e) => attach(e.currentTarget.files)}
        />
        {session.attachments.length > 0 ? (
          <ul className="gp-attachments">
            {session.attachments.map((a) => (
              <li key={a.sha256}>
                <Paperclip size={13} aria-hidden="true" />
                <a href={`/api/planner/${encodeURIComponent(session.id)}/attachment/${a.sha256}`}>{a.name}</a>
                <span className="tm-mono gp-note">{a.type} &middot; {a.bytes} bytes</span>
                <Chip tone="warn">untrusted context</Chip>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {proposal ? (
        <section aria-labelledby="gp-prop-h">
          <h2 id="gp-prop-h" className="gp-list-h">
            Review {writes} proposed board {writes === 1 ? "change" : "changes"}
            {proposal.ok ? null : <Chip tone="bad">cannot be applied</Chip>}
          </h2>
          <p className="gp-hint">
            Each card names the governed operation, its exact arguments and what it would do.
            Nothing is rendered as conversational prose.
          </p>
          <ol className="gp-proposals">
            {proposal.operations.map((o) => (
              <li key={o.index} className="gp-proposal" data-valid={o.valid ? "yes" : "no"}>
                <div className="gp-proposal__head">
                  <span className="tm-mono gp-proposal__n">{String(o.index).padStart(2, "0")}</span>
                  <h3>{o.summary}</h3>
                  {o.valid ? (
                    <Chip tone="ok" dot>validated</Chip>
                  ) : (
                    <Chip tone="bad" dot>refused</Chip>
                  )}
                </div>
                <p className="gp-proposal__consequence">{o.consequence}</p>
                <dl className="gp-params">
                  <div><dt>Operation</dt><dd className="tm-mono">{o.op}</dd></div>
                  {Object.entries(o.args).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="tm-mono">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                    </div>
                  ))}
                </dl>
                {o.refusal ? (
                  // Verbatim. The operator is entitled to the store's own wording.
                  <pre className="gp-refusal" role="alert">{o.refusal}</pre>
                ) : null}
              </li>
            ))}
          </ol>
          {openSession ? (
            <div className="gp-actions">
              <Button variant="ghost" onClick={() => end("rejected")}>Reject</Button>
              <Button
                data-gp="approve"
                disabled={!proposal.ok}
                onClick={() => { setReviewed(false); setConfirming(true); }}
              >
                Approve {writes} {writes === 1 ? "change" : "changes"}…
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {openSession ? (
        <div className="gp-actions gp-actions--end">
          <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => end("cancelled")}>
            Cancel session
          </Button>
        </div>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Apply ${writes} proposed board ${writes === 1 ? "change" : "changes"}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Back to review</Button>
            <Button data-gp="apply" disabled={!reviewed || busy} icon={<Check size={14} />} onClick={apply}>
              {busy ? "Applying…" : "Approve once & apply"}
            </Button>
          </>
        }
      >
        <p className="gp-consequence">
          This applies {writes} governed {writes === 1 ? "operation" : "operations"} to the shared
          task store, in order. No code and no Git refs are changed. If any operation fails, none
          of them are kept.
        </p>
        <dl className="gp-params">
          <div><dt>Approving</dt><dd className="tm-mono">{proposal?.digest.slice(0, 16)}</dd></div>
          <div><dt>Permission</dt><dd>Allow this change set once</dd></div>
        </dl>
        <p className="gp-hint">
          The approval is bound to exactly these operations. If the proposal changes before it is
          applied, the server refuses it rather than applying something you did not see.
        </p>
        <Checkbox checked={reviewed} onChange={setReviewed}>
          I reviewed the operations, their arguments and their consequences.
        </Checkbox>
      </Modal>

      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </div>
  );
}

/**
 * One line of trace, in words.
 *
 * Deliberately not the raw event: a trace is for a person watching what the agent is doing, and
 * the payloads carry whatever the agent sent. Anything without a sentence here shows its type and
 * nothing else, which is the right amount of detail for a variant this build has never seen.
 */
function describeEvent(e: AguiEvent): string {
  switch (e.type) {
    case "RUN_STARTED": return "The planner started.";
    case "RUN_FINISHED": return `The planner finished (${e.reason ?? "done"}).`;
    case "RUN_ERROR": return e.message ?? "The planner failed.";
    case "ACTIVITY_DELTA": return e.activity === "thinking" ? "Thinking…" : `Working: ${e.activity ?? ""}`;
    case "TEXT_MESSAGE_CONTENT": return e.delta ?? "";
    case "TOOL_CALL_START": return `Reading: ${e.toolName ?? "a tool"}${e.toolClass === "mutation" ? " (would write)" : ""}`;
    case "TOOL_CALL_RESULT": return e.failed ? `Refused: ${e.result ?? ""}` : "Read complete.";
    case "STATE_DELTA": return `Updated ${e.path ?? "state"}.`;
    case "CUSTOM": return e.name === "tm.permission.requested" ? "The agent asked for permission; approval happens on the proposal below." : (e.name ?? "");
    default: return "";
  }
}

/** Shown when a session is gone but its id is still in the URL. */
export function MissingSession() {
  return (
    <EmptyState
      icon={<AlertTriangle size={20} />}
      title="That planning session is gone"
      action={<Button size="sm" icon={<Trash2 size={13} />} onClick={() => navigate("/planner")}>Back to sessions</Button>}
    >
      It was applied, cancelled or removed.
    </EmptyState>
  );
}
