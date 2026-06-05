import Calendar from "@atlaskit/calendar";
import { useState } from "react";
import Lozenge from "@atlaskit/lozenge";
import type { Issue } from "../types";

interface Props {
  issues: Issue[];
}

const statusAppearance: Record<
  Issue["status"],
  "default" | "inprogress" | "moved" | "success"
> = {
  TODO: "default",
  IN_PROGRESS: "inprogress",
  REVIEW: "moved",
  DONE: "success",
};

export default function IssueCalendarView({ issues }: Props) {
  const [selectedDate, setSelectedDate] = useState("");

  const issuesByDate: Record<string, Issue[]> = {};
  for (const issue of issues) {
    const dateKey = issue.created_at.slice(0, 10);
    if (!issuesByDate[dateKey]) {
      issuesByDate[dateKey] = [];
    }
    issuesByDate[dateKey].push(issue);
  }

  const highlightedDates = Object.keys(issuesByDate);

  const selectedIssues = selectedDate ? (issuesByDate[selectedDate] ?? []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <Calendar
        month={6}
        year={2026}
        day={5}
        previouslySelected={highlightedDates}
        onSelect={(e) => {
          setSelectedDate(e.iso);
        }}
      />
      <div>
        {selectedDate ? (
          selectedIssues.length > 0 ? (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {selectedIssues.map((issue) => (
                <li
                  key={issue.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: "14px" }}>
                    {issue.title}
                  </span>
                  <Lozenge appearance={statusAppearance[issue.status]}>
                    {issue.status.replace("_", " ")}
                  </Lozenge>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "#6B778C", fontSize: "14px", margin: 0 }}>
              No issues created on {selectedDate}.
            </p>
          )
        ) : (
          <p style={{ color: "#6B778C", fontSize: "14px", margin: 0 }}>
            Select a date to see issues
          </p>
        )}
      </div>
    </div>
  );
}
