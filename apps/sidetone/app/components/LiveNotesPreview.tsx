import { HeartHandshake, MessageCircle, Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type NoteVariant = "personal" | "soccer";
type LiveNote = {
  label: string;
  text: string;
  time?: string;
};

const personalNotes: LiveNote[] = [
  {
    label: "What changed",
    text: "They are not asking you to fix it yet. They want you to acknowledge that it hurt."
  },
  {
    label: "Try saying",
    text: "\"I hear you. I made that feel smaller than it was, and I am sorry.\""
  },
  {
    label: "Remember after",
    text: "Follow up tonight with one concrete thing you will do differently next time."
  }
];

const soccerNotes: LiveNote[] = [
  {
    time: "02:14",
    label: "Roster",
    text: "Coach Jay says two 2012 players may leave after spring. Confirm the names before parents are updated."
  },
  {
    time: "07:38",
    label: "Schedule",
    text: "Thursday practice moves to Field 3 at 6:30 because Field 1 is double-booked."
  },
  {
    time: "13:05",
    label: "Uniforms",
    text: "Maya is placing the uniform order Friday at noon. Collect the missing sizes from the new players."
  }
];

function LiveNotesContent({
  compact = false,
  showTitle = true,
  variant = "personal"
}: {
  compact?: boolean;
  showTitle?: boolean;
  variant?: NoteVariant;
}) {
  const notes: LiveNote[] = variant === "soccer" ? soccerNotes : personalNotes;

  return (
    <>
      <CardHeader className={compact ? "gap-4 p-0" : "gap-4 p-6 md:p-8"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="accent">Live notes</Badge>
          <HeartHandshake className="size-6 text-accent" />
        </div>
        {showTitle ? (
          <CardTitle className={compact ? "text-2xl" : "max-w-3xl text-3xl md:text-4xl"}>
            For the calls where the words matter.
          </CardTitle>
        ) : null}
      </CardHeader>
      <CardContent className={compact ? "grid p-0 pt-2" : "grid px-6 pb-6 md:px-8 md:pb-8"}>
        {notes.map((note, index) => {
          const Icon = index === 1 ? MessageCircle : Sparkles;
          return (
            <div
              className="border-t border-border/70 py-4 first:border-t-0 first:pt-0 last:pb-0"
              key={note.label}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
                {note.time ? (
                  <span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-xs uppercase tracking-[0.18em]">
                    {note.time}
                  </span>
                ) : (
                  <Icon className="size-4" />
                )}
                <span>{note.label}</span>
              </div>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{note.text}</p>
            </div>
          );
        })}
      </CardContent>
    </>
  );
}

export function LiveNotesPreview({
  framed = true,
  showTitle = true,
  variant = "personal"
}: {
  framed?: boolean;
  showTitle?: boolean;
  variant?: NoteVariant;
}) {
  if (!framed) {
    return (
      <div className="py-2">
        <LiveNotesContent compact showTitle={showTitle} variant={variant} />
      </div>
    );
  }

  return (
    <Card>
      <LiveNotesContent showTitle={showTitle} variant={variant} />
    </Card>
  );
}
