import { CheckCircle2, Mail, MessageSquare, Send } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const records = {
  sales: {
    summary:
      "The client is interested if onboarding can happen before June 1. Main concern is implementation lift.",
    actions: ["Send timeline and pricing", "Confirm implementation owner", "Follow up Friday morning"],
    destinations: ["Copy summary", "Call doc", "Share link"]
  },
  soccer: {
    summary:
      "Coaches agreed to move Thursday practice to Field 3, confirm which players are leaving, and collect uniform sizes before Friday's order.",
    actions: [
      "Text parents the revised Thursday practice time",
      "Confirm roster changes with Coach Elena",
      "Send final uniform sizes by Friday noon"
    ],
    destinations: ["Copy summary", "Call doc", "Share link"]
  }
};

export function CallRecordPreview({ variant = "sales" }: { variant?: "sales" | "soccer" }) {
  const record = records[variant];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge variant="success">Ready after call</Badge>
            <CardTitle className="mt-3 text-2xl">Post-call record</CardTitle>
          </div>
          <CheckCircle2 className="size-6 text-success" />
        </div>
        <CardDescription>
          Summary, decisions, action items, and follow-up copy without opening a transcript first.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
          {record.summary}
        </p>
        <div className="grid gap-2 border-t border-border pt-4 text-sm">
          {record.actions.map((item) => (
            <div className="flex items-center gap-2" key={item}>
              <CheckCircle2 className="size-4 text-success" />
              {item}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary">
            <MessageSquare className="size-4" />
            {record.destinations[0]}
          </Button>
          <Button size="sm" variant="secondary">
            <Mail className="size-4" />
            {record.destinations[1]}
          </Button>
          <Button size="sm" variant="secondary">
            <Send className="size-4" />
            {record.destinations[2]}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
